/**
 * 用人工标准答案（eval/level1/gold/标注表.md，60 条）评测模型，并比较多个模型。
 *
 * 四项指标（通过标准见 eval/level1/评测过程记录.md）：
 *   1. 具体证据召回率：人工判为"具体说到干净"（不是只有笼统好评）的评论，模型也识别到了多少（≥ 95%，D-12）；
 *      只有笼统好评的评论召回单独记录，不作为通过条件
 *   2. 差评召回率：人工判为"有不干净"的，模型也判出了差评（100%）
 *   3. 干净/不干净判断准确率：两边都认为相关的评论里，整体结论是否一致（≥ 90%）
 *   4. 对象归类：（对象，干净/不干净）配对的 F1（≥ 85%）
 *
 * 选型看三个维度：准确率（上面四项）、稳定性（同一模型跑多次的波动）、成本（按官方价格换算）。
 *
 * 只读数据库。运行：cd backend && npx tsx scripts/eval-gold.ts [--gold zh|en] [--runs 3] [模型1 模型2 ...]
 *   --gold zh（默认）：中文标准答案 标注表.md（60 条）→ 模型对比.md、分歧明细.md
 *   --gold en：英文标准答案 标注表_英文.md（20 条）→ 模型对比_英文.md、分歧明细_英文.md
 * 每次调用的原始记录在 gold/runs/<时间>/。
 */
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../src/db/client.js";
import { GUIDE, labelReviews, type Mention } from "./lib/cleanliness.js";

const DEFAULT_MODELS = ["gpt-5-mini", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.5", "gpt-4.1-mini"];
const runsIdx = process.argv.indexOf("--runs");
const RUNS = runsIdx >= 0 ? Number(process.argv[runsIdx + 1]) : 3;
const goldIdx = process.argv.indexOf("--gold");
const LANG = goldIdx >= 0 ? process.argv[goldIdx + 1] : "zh";
const SHEET = LANG === "en"
  ? { table: "标注表_英文.md", key: "_key_英文.json", report: "模型对比_英文.md", diffs: "分歧明细_英文.md", title: "英文标准答案", size: 20 }
  : { table: "标注表.md", key: "_key.json", report: "模型对比.md", diffs: "分歧明细.md", title: "人工标准答案", size: 60 };
const OPTS = new Set(["--runs", "--gold"]);
const cliModels = process.argv.slice(2).filter((a, i, all) => !OPTS.has(a) && !OPTS.has(all[i - 1]));
const models = cliModels.length ? cliModels : DEFAULT_MODELS;

// 美元 / 100 万 tokens（标准价，非 Batch）。来源：https://developers.openai.com/api/docs/pricing ，2026-10-05 查询。
// 价格会变，用之前请核对。推理模型的推理过程计入输出 tokens。
const PRICE: Record<string, { input: number; output: number }> = {
  "gpt-5-mini": { input: 0.25, output: 2.0 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, output: 1.25 },
  "gpt-5.5": { input: 5.0, output: 30.0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
};
const GOLD_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../eval/level1/gold");
const PASS = { specRecall: 0.95, negRecall: 1, verdict: 0.9, objectF1: 0.85 }; // D-12：召回看"具体证据"

// ---- 读取标准答案 ----
const COLS = ["房间", "床品", "卫生间", "公共区域", "用品", "整体（笼统）"] as const;
interface Gold {
  n: string;
  id: string;
  hotel: string;
  text: string;
  relevant: boolean;
  pairs: Set<string>; // "对象|干净" 或 "对象|不干净"
  issues: Map<string, string>; // 对象 → 问题类型（只记不干净的）
  generic: Set<string>; // 标为"干净-笼统"的对象（"整体（笼统）"那一列本身就是笼统）
  source: "人工" | "预标+审核";
}

const key = JSON.parse(readFileSync(resolve(GOLD_DIR, SHEET.key), "utf8")) as { n: number | string; id: string; hotel: string }[];
const keyByN = new Map(key.map((k) => [String(k.n), k]));
const gold: Gold[] = [];
for (const line of readFileSync(resolve(GOLD_DIR, SHEET.table), "utf8").split("\n")) {
  const m = line.match(/^\|\s*(E?\d+)\s*\|/);
  if (!m) continue;
  const c = line.trim().replace(/^\||\|$/g, "").split("|").map((x) => x.trim());
  const n = c[0];
  const k = keyByN.get(n)!;
  const pairs = new Set<string>();
  const issues = new Map<string, string>();
  const generic = new Set<string>();
  COLS.forEach((obj, i) => {
    const v = c[3 + i];
    if (!v) return;
    const neg = v.startsWith("不干净");
    pairs.add(`${obj}|${neg ? "不干净" : "干净"}`);
    if (neg) issues.set(obj, v.split("-")[1] === "未说明" ? "其他" : v.split("-")[1]);
    if (!neg && (v === "干净-笼统" || obj === "整体（笼统）")) generic.add(obj);
  });
  gold.push({ n, id: k.id, hotel: k.hotel, text: c[1], relevant: c[2] === "是", pairs, issues, generic, source: LANG === "zh" && Number(n) <= 40 ? "人工" : "预标+审核" });
}
if (gold.length !== SHEET.size) throw new Error(`${SHEET.title}应有 ${SHEET.size} 条，读到 ${gold.length} 条`);
// 用数据库原文（标注表里的原文为了表格显示压缩过空白）
const textById = new Map((db.prepare(`SELECT id, text FROM reviews WHERE id IN (${gold.map(() => "?").join(",")})`).all(...gold.map((g) => g.id)) as { id: string; text: string }[]).map((r) => [r.id, r.text]));

// ---- 模型结果 → 同样的格式 ----
const toPairs = (ms: Mention[]) => new Set(ms.map((m) => `${m.object}|${m.polarity === "negative" ? "不干净" : "干净"}`));
const hasNeg = (pairs: Set<string>) => [...pairs].some((p) => p.endsWith("|不干净"));
// 具体证据：有差评，或者有不是笼统的好评（D-10）
const isSpecific = (g: Gold) => [...g.pairs].some((p) => { const [obj, pol] = p.split("|"); return pol === "不干净" || !g.generic.has(obj); });

interface Score {
  model: string;
  relRecall: number;
  relPrecision: number;
  negRecall: number;
  negTotal: number;
  verdict: number;
  objP: number;
  objR: number;
  objF1: number;
  specRecall: number; // 具体证据召回
  genRecall: number; // 只有笼统好评的评论的召回
  genericAgree: number; // 两边都判为"某对象·干净"时，"是否笼统"一致的比例
  genericN: number;
  bySource: Record<string, { relRecall: number; verdict: number }>;
  failed: number;
  seconds: number;
  inTok: number;
  outTok: number;
  diffs: { g: Gold; model: Set<string>; kind: string }[];
}

function score(model: string, res: Awaited<ReturnType<typeof labelReviews>>): Score {
  const diffs: Score["diffs"] = [];
  const calc = (gs: Gold[]) => {
    let relTP = 0, relGold = 0, relModel = 0, negHit = 0, negGold = 0, vOk = 0, vN = 0, pTP = 0, pModel = 0, pGold = 0, gOk = 0, gN = 0, sG = 0, sHit = 0, oG = 0, oHit = 0;
    for (const g of gs) {
      const mp = toPairs(res.mentions.get(g.id) ?? []);
      const mRel = mp.size > 0;
      if (g.relevant) relGold++;
      if (mRel) relModel++;
      if (g.relevant && mRel) relTP++;
      if (g.relevant && isSpecific(g)) { sG++; if (mRel) sHit++; }
      if (g.relevant && !isSpecific(g)) { oG++; if (mRel) oHit++; }
      if (hasNeg(g.pairs)) {
        negGold++;
        if (hasNeg(mp)) negHit++;
      }
      if (g.relevant && mRel) {
        vN++;
        if (hasNeg(g.pairs) === hasNeg(mp)) vOk++;
      }
      pGold += g.pairs.size;
      pModel += mp.size;
      for (const p of mp) if (g.pairs.has(p)) pTP++;
      const ms = res.mentions.get(g.id) ?? [];
      for (const p of mp) {
        const [obj, pol] = p.split("|");
        if (pol !== "干净" || !g.pairs.has(p)) continue;
        gN++;
        const modelGeneric = obj === "整体（笼统）" || ms.some((m) => m.object === obj && m.polarity === "positive" && m.generic);
        if (modelGeneric === g.generic.has(obj)) gOk++;
      }
    }
    const pP = pModel ? pTP / pModel : 0, pR = pGold ? pTP / pGold : 0;
    return { relRecall: relGold ? relTP / relGold : 1, relPrecision: relModel ? relTP / relModel : 1, negRecall: negGold ? negHit / negGold : 1, negGold, verdict: vN ? vOk / vN : 1, pP, pR, f1: pP + pR ? (2 * pP * pR) / (pP + pR) : 0, gAgree: gN ? gOk / gN : 1, gN, spec: sG ? sHit / sG : 1, gen: oG ? oHit / oG : 1 };
  };
  for (const g of gold) {
    const mp = toPairs(res.mentions.get(g.id) ?? []);
    const mRel = mp.size > 0;
    let kind = "";
    if (g.relevant && !mRel) kind = hasNeg(g.pairs) ? "❗漏掉差评" : "漏掉（人工认为谈到了干净）";
    else if (!g.relevant && mRel) kind = "多判（人工认为没谈到）";
    else if (g.relevant && hasNeg(g.pairs) !== hasNeg(mp)) kind = "干净/不干净判断不一致";
    else if ([...g.pairs].sort().join() !== [...mp].sort().join()) kind = "对象归类不一致";
    if (kind) diffs.push({ g, model: mp, kind });
  }
  const all = calc(gold);
  const bySource: Score["bySource"] = {};
  for (const src of ["人工", "预标+审核"]) {
    const r = calc(gold.filter((g) => g.source === src));
    bySource[src] = { relRecall: r.relRecall, verdict: r.verdict };
  }
  return {
    model, relRecall: all.relRecall, relPrecision: all.relPrecision, negRecall: all.negRecall, negTotal: all.negGold,
    verdict: all.verdict, objP: all.pP, objR: all.pR, objF1: all.f1, specRecall: all.spec, genRecall: all.gen, genericAgree: all.gAgree, genericN: all.gN, bySource,
    failed: res.failed.size, seconds: res.seconds, inTok: res.inputTokens, outTok: res.outputTokens, diffs,
  };
}

async function main() {
  const reviews = gold.map((g) => ({ id: g.id, text: textById.get(g.id) ?? g.text }));
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  const runDir = resolve(GOLD_DIR, "runs", stamp);
  mkdirSync(runDir, { recursive: true });
  console.log(`标准答案：${gold.length} 条（谈到干净 ${gold.filter((g) => g.relevant).length} 条，含差评 ${gold.filter((g) => hasNeg(g.pairs)).length} 条）；每个模型跑 ${RUNS} 次；原始记录 → ${runDir}`);

  interface ModelRuns { model: string; scores: Score[]; results: Awaited<ReturnType<typeof labelReviews>>[] }
  const all: ModelRuns[] = await Promise.all(
    models.map(async (model) => {
      const mr: ModelRuns = { model, scores: [], results: [] };
      for (let run = 1; run <= RUNS; run++) {
        const res = await labelReviews(model, reviews, { concurrency: 4 });
        mr.results.push(res);
        mr.scores.push(score(model, res));
        writeFileSync(
          resolve(runDir, `${model}-run${run}.json`),
          JSON.stringify({ model, run, guide: GUIDE, calls: res.calls, labels: Object.fromEntries(res.mentions), failed: [...res.failed] }, null, 2)
        );
        console.log(`${model} 第 ${run} 次完成（${res.seconds.toFixed(0)} 秒，失败 ${res.failed.size} 条）`);
      }
      return mr;
    })
  );

  const pct = (x: number) => `${(x * 100).toFixed(1).replace(/\.0$/, "")}%`;
  const range = (xs: number[]) => (Math.min(...xs) === Math.max(...xs) ? pct(xs[0]) : `${pct(Math.min(...xs))}～${pct(Math.max(...xs))}`);
  const usd = (r: Awaited<ReturnType<typeof labelReviews>>, model: string) => {
    const p = PRICE[model];
    return p ? (r.inputTokens * p.input + r.outputTokens * p.output) / 1e6 : NaN;
  };
  const passAll = (s: Score) => s.specRecall >= PASS.specRecall && s.negRecall >= PASS.negRecall && s.verdict >= PASS.verdict && s.objF1 >= PASS.objectF1 && s.failed === 0;

  let md = `# 模型对比：「干净」识别（对照${SHEET.title} ${SHEET.size} 条）\n\n生成时间：${new Date().toISOString().slice(0, 16).replace("T", " ")}｜规则：标注规范 v3（\`backend/scripts/lib/cleanliness.ts\`）｜推理模型统一 reasoning_effort=low｜每个模型跑 ${RUNS} 次｜原始调用记录：\`gold/runs/${stamp}/\`\n\n`;
  md += `标准答案：${SHEET.size} 条，其中谈到干净 ${gold.filter((g) => g.relevant).length} 条、含差评 ${gold.filter((g) => hasNeg(g.pairs)).length} 条。${LANG === "zh" ? "第 1–40 条人工独立标注，第 41–60 条 Claude 预标、人工审核。" : "全部由 Claude 按规范预标、人工逐条审核同意（2026-10-22）。"}**标准答案还没仲裁**（见分歧明细），以下数字会因仲裁而变化。\n\n`;

  md += `## 一、准确率（${RUNS} 次运行的最低～最高）\n\n| 模型 | ① 具体证据召回（≥95%） | ② 差评召回（100%） | ③ 干净/不干净准确（≥90%） | ④ 对象归类 F1（≥85%） | ${RUNS} 次里四项全过的次数 | 参考：笼统好评召回 | 参考：全部相关召回 |\n|---|---|---|---|---|---|---|---|\n`;
  for (const m of all) {
    const sc = m.scores;
    md += `| ${m.model} | ${range(sc.map((s) => s.specRecall))} | ${range(sc.map((s) => s.negRecall))} | ${range(sc.map((s) => s.verdict))} | ${range(sc.map((s) => s.objF1))} | ${sc.filter(passAll).length} / ${RUNS} | ${range(sc.map((s) => s.genRecall))} | ${range(sc.map((s) => s.relRecall))} |\n`;
  }

  md += `\n**笼统好评标记**（两边都判为"某对象·干净"时，"是否笼统"是否一致，D-10）：` + all.map((m) => `${m.model} ${range(m.scores.map((s) => s.genericAgree))}`).join("；") + "\n";
  md += `\n## 二、稳定性（同一条评论，${RUNS} 次结果是否一样）\n\n| 模型 | "是否谈到干净"${RUNS} 次一致 | 完整判断（对象 + 干净/不干净）${RUNS} 次一致 | 失败的调用 |\n|---|---|---|---|\n`;
  for (const m of all) {
    let relSame = 0, fullSame = 0;
    for (const g of gold) {
      const sets = m.results.map((r) => [...toPairs(r.mentions.get(g.id) ?? [])].sort().join());
      if (new Set(sets.map((x) => x !== "")).size === 1) relSame++;
      if (new Set(sets).size === 1) fullSame++;
    }
    const failedCalls = m.results.reduce((n, r) => n + r.calls.filter((c) => c.error).length, 0);
    md += `| ${m.model} | ${relSame} / ${gold.length}（${pct(relSame / gold.length)}） | ${fullSame} / ${gold.length}（${pct(fullSame / gold.length)}） | ${failedCalls} |\n`;
  }

  md += `\n## 三、成本与速度\n\n价格来源：[OpenAI 官方定价](https://developers.openai.com/api/docs/pricing)（2026-10-05 查询，标准价）。\n\n| 模型 | 价格（输入 / 输出，每百万 tokens） | 每次 ${gold.length} 条：输入 / 输出 tokens（平均） | 每次 ${gold.length} 条花费 | 折算每 1,000 条评论 | 单次调用平均耗时 |\n|---|---|---|---|---|---|\n`;
  for (const m of all) {
    const p = PRICE[m.model];
    const avg = (f: (r: Awaited<ReturnType<typeof labelReviews>>) => number) => m.results.reduce((n, r) => n + f(r), 0) / m.results.length;
    const cost = avg((r) => usd(r, m.model));
    const calls = m.results.flatMap((r) => r.calls.filter((c) => !c.error));
    md += `| ${m.model} | ${p ? `$${p.input} / $${p.output}` : "未知"} | ${Math.round(avg((r) => r.inputTokens)).toLocaleString()} / ${Math.round(avg((r) => r.outputTokens)).toLocaleString()} | $${cost.toFixed(4)} | $${((cost / gold.length) * 1000).toFixed(3)} | ${(calls.reduce((n, c) => n + c.ms, 0) / calls.length / 1000).toFixed(1)} 秒 |\n`;
  }
  md += `\n全部 1,504 条评论只需要判断一次（结果存进数据库），所以总成本约等于"每 1,000 条"那一列 × 1.5。\n`;

  md += `\n## 四、怎么核对这些调用真的发生过\n\n1. 原始记录在 \`eval/level1/gold/runs/${stamp}/\`：每个文件是一个模型的一次运行，里面每次调用都有 **requestId**（OpenAI 返回的响应 ID）、**returnedModel**（接口实际返回的模型名）、开始时间、耗时和 tokens\n2. 登录 OpenAI 后台 Usage 页面（https://platform.openai.com/usage），按日期和模型筛选，对照下表的调用次数和 tokens\n\n| 请求的模型 | 接口实际返回的模型名 | 调用次数 | 输入 tokens 合计 | 输出 tokens 合计 | 第一个 requestId |\n|---|---|---|---|---|---|\n`;
  for (const m of all) {
    const calls = m.results.flatMap((r) => r.calls);
    const returned = [...new Set(calls.map((c) => c.returnedModel).filter(Boolean))].join("、");
    md += `| ${m.model} | ${returned} | ${calls.length} | ${calls.reduce((n, c) => n + c.inputTokens, 0).toLocaleString()} | ${calls.reduce((n, c) => n + c.outputTokens, 0).toLocaleString()} | \`${calls.find((c) => c.requestId)?.requestId ?? "—"}\` |\n`;
  }

  md += `\n## 五、分歧类型（第 1 次运行）\n\n| 模型 | ❗漏掉差评 | 漏掉 | 多判 | 干净/不干净不一致 | 对象归类不一致 |\n|---|---|---|---|---|---|\n`;
  for (const m of all) {
    const s = m.scores[0];
    const c = (k: string) => s.diffs.filter((d) => d.kind.startsWith(k)).length;
    md += `| ${m.model} | ${c("❗")} | ${c("漏掉（")} | ${c("多判")} | ${c("干净/不干净")} | ${c("对象归类")} |\n`;
  }
  md += `\n每条分歧的原文和两边的判断见 [${SHEET.diffs}](${SHEET.diffs})。\n`;
  writeFileSync(resolve(GOLD_DIR, SHEET.report), md);

  let diffMd = `# 分歧明细（每个模型第 1 次运行）\n\n分歧 ≠ 模型错：可能是模型错、标准答案错，或者规则没写清。需要人工逐条仲裁后，才能算作 bad case。\n\n`;
  const fmt = (p: Set<string>) => [...p].map((x) => x.replace("|", "·")).join("；") || "没谈到";
  for (const m of all) {
    const s = m.scores[0];
    diffMd += `## ${m.model}（${s.diffs.length} 条分歧）\n\n| # | 类型 | 评论原文 | 人工 | 模型 |\n|---|---|---|---|---|\n`;
    for (const d of s.diffs) diffMd += `| ${d.g.n} | ${d.kind} | ${d.g.text.replace(/\s+/g, " ").replace(/\|/g, "｜")} | ${fmt(d.g.pairs)} | ${fmt(d.model)} |\n`;
    diffMd += "\n";
  }
  writeFileSync(resolve(GOLD_DIR, SHEET.diffs), diffMd);
  console.log("\n" + md);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
