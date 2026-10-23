/**
 * 第 1 级验证（能不能做准），v2：三层结构。
 *
 *   第 1 层：模型把每条评论拆成"观点"：（对象，态度，问题类型，原文）
 *   第 2 层：按固定规则汇总每家酒店
 *   第 3 层：生成用户看到的一句结论 + 展开细节
 *
 * 为了能算出检索的漏检和误检，这里让模型标注 3 家酒店的【全部】评论，
 * 再拿产品检索（findMatchingReviews）的结果和它对比；同时对比 v1 的旧检索
 * 逻辑（话题标签 + 只搜"干净"），看 I-21 / I-22 修复前后的变化。
 *
 * 只读数据库。运行：cd backend && npx tsx scripts/eval-level1.ts
 * 参数：--model <模型名>（默认 gpt-5-mini）；--out <版本目录>（默认 v3）；
 *       --reuse 复用该目录 results.json 里已有的标注，只重新汇总（不调用模型）。
 * 标注规则在 scripts/lib/cleanliness.ts。
 * 结果写到仓库根目录 eval/level1/<版本>/。
 */
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NEED, OBJECTS, labelReviews, type Mention } from "./lib/cleanliness.js";
import { findMatchingReviews } from "../src/services/retrieval.js";
import { getHotel, getReviewsForHotel } from "../src/db/repo.js";
import { db } from "../src/db/client.js";
import { keywordMatchesTag, reviewMentions, toSimplified } from "../src/lib/textMatch.js";

const argValue = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const MODEL = argValue("--model") ?? "gpt-5-mini";
const VERSION = argValue("--out") ?? "v3";

// 汇总规则（第 2 层），2026-09-27 与产品负责人确认的起步默认值
const MIN_EVIDENCE = 5; // 相关评论少于这个数 → 证据不足
const FLAG_OBJECT_NEGATIVES = 2; // 同一对象差评达到这个数 → 单独提醒
const SPLIT_LOW = 0.1; // 差评占比 < 10% → 多数评价干净
const SPLIT_HIGH = 0.3; // 差评占比 > 30% → 多数评价不干净
const SHOWN_IN_DETAIL = 4; // 详情页默认展示的评论条数（I-05）

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), `../../eval/level1/${VERSION}`);

interface Row {
  hotel: string;
  id: string;
  text: string;
  retrievedV1: boolean; // 旧检索：话题标签（含评分推导的"干净"）或原文含"干净"
  retrievedV2: boolean; // 新检索：产品当前的 findMatchingReviews
  detailRank: number; // 产品详情页（prefer=干净）里的排序位置，从 1 开始
  mentions?: Mention[];
  error?: boolean;
}

// "其他" = 只说了"不太干净""卫生不行"，没说具体是什么问题
const issueName = (i: string) => (i === "其他" ? "未说明具体问题" : i);
const issueList = (issues: Record<string, number>) => Object.entries(issues).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${issueName(k)}×${v}`).join("、");

const norm = (x: string) => toSimplified(x).replace(/\s+/g, "");
// 模型常把"衞"写成"衛"、或用省略号截断长句：统一简体、去空白、按省略号分段后再核对
const quoteReal = (text: string, quote: string) => quote.split(/\.\.\.|…/).every((p) => !p.trim() || norm(text).includes(norm(p)));

// ---------- 第 2 层：汇总规则 ----------
interface HotelSummary {
  hotel: string;
  relevant: number;
  withNegative: number;
  byObject: Record<string, { pos: number; neg: number; issues: Record<string, number> }>;
  flags: string[];
  verdict: string;
}

function summarize(hotel: string, rows: Row[]): HotelSummary {
  const relevant = rows.filter((r) => r.mentions && r.mentions.length > 0);
  const withNegative = relevant.filter((r) => r.mentions!.some((m) => m.polarity === "negative")).length;
  const byObject: HotelSummary["byObject"] = {};
  for (const o of OBJECTS) byObject[o] = { pos: 0, neg: 0, issues: {} };
  // 一律按"评论条数"计数：一条长差评在同一对象下列了三种问题，
  // 这个对象也只算 1 条差评（问题类型各记 1 次），否则会把一个人的吐槽放大成"3 条差评"。
  for (const r of relevant) {
    for (const o of OBJECTS) {
      const ms = r.mentions!.filter((m) => m.object === o);
      const b = byObject[o];
      if (ms.some((m) => m.polarity === "negative")) {
        b.neg++;
        for (const issue of new Set(ms.filter((m) => m.polarity === "negative").map((m) => m.issue))) b.issues[issue] = (b.issues[issue] ?? 0) + 1;
      } else if (ms.length > 0) b.pos++;
    }
  }

  const flags: string[] = [];
  let verdict: string;
  if (relevant.length < MIN_EVIDENCE) {
    verdict = `证据不足（只有 ${relevant.length} 条评论提到干净）`;
  } else {
    const pestReviews = relevant.filter((r) => r.mentions!.some((m) => m.issue === "虫害")).length;
    if (pestReviews > 0) flags.push(`有 ${pestReviews} 条评论提到虫害`);
    for (const o of OBJECTS) {
      const b = byObject[o];
      if (b.neg >= FLAG_OBJECT_NEGATIVES) {
        flags.push(`${o}有 ${b.neg} 条差评（${issueList(b.issues)}）`);
      }
    }
    const share = withNegative / relevant.length;
    verdict = share < SPLIT_LOW ? "多数评价干净" : share > SPLIT_HIGH ? "多数评价不干净" : "评价有分歧";
    // D-10：只有笼统好评（没有具体说到干净）的评论单独统计
    const genericOnly = relevant.filter((r) => r.mentions!.every((m) => m.polarity === "positive" && (m.generic || m.object === "整体（笼统）"))).length;
    verdict += `（${relevant.length} 条相关评论，其中 ${genericOnly} 条只是笼统好评；${withNegative} 条含差评，占 ${Math.round(share * 100)}%）`;
  }
  return { hotel, relevant: relevant.length, withNegative, byObject, flags, verdict };
}

async function main() {
  const hzg = db.prepare("SELECT id FROM hotels WHERE name LIKE '%皇城根%'").get() as { id: string };
  const hotelIds = [hzg.id, "130505294" /* 汉庭(前门店) */, "1286148" /* 北京索菲特 */];

  const rows: Row[] = [];
  for (const hid of hotelIds) {
    const hotel = getHotel(hid)!;
    const v2 = new Set(findMatchingReviews(hid, [NEED]).matched.map((r) => r.id));
    const all = getReviewsForHotel(hid);
    // 与 routes/hotels.ts 详情页一致：按命中的偏好数做稳定排序
    const detailOrder = [...all].sort((a, b) => Number(reviewMentions(b, NEED)) - Number(reviewMentions(a, NEED)));
    const rank = new Map(detailOrder.map((r, i) => [r.id, i + 1]));
    for (const r of all) {
      const v1 = r.topics.some((t) => keywordMatchesTag(NEED, t)) || norm(r.text).includes(NEED);
      rows.push({ hotel: hotel.name, id: r.id, text: r.text, retrievedV1: v1, retrievedV2: v2.has(r.id), detailRank: rank.get(r.id)! });
    }
  }

  const resultsPath = resolve(OUT_DIR, "results.json");
  if (process.argv.includes("--reuse") && existsSync(resultsPath)) {
    const saved = new Map((JSON.parse(readFileSync(resultsPath, "utf8")).rows as Row[]).map((r) => [r.id, r]));
    for (const r of rows) Object.assign(r, { mentions: saved.get(r.id)?.mentions, error: saved.get(r.id)?.error ?? !saved.has(r.id) });
    console.log("复用已有标注，只重新汇总");
  } else {
    const res = await labelReviews(MODEL, rows, { onProgress: (d, t) => process.stdout.write(`\r已标注 ${d}/${t} 批`) });
    console.log();
    for (const r of rows) {
      if (res.mentions.has(r.id)) r.mentions = res.mentions.get(r.id);
      else r.error = true;
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resultsPath, JSON.stringify({ need: NEED, model: MODEL, rows }, null, 2));

  const hotels = [...new Set(rows.map((r) => r.hotel))];
  const isRelevant = (r: Row) => !!r.mentions && r.mentions.length > 0;
  const isNeg = (r: Row) => !!r.mentions?.some((m) => m.polarity === "negative");
  const pct = (a: number, b: number) => (b === 0 ? "—" : `${Math.round((a / b) * 100)}%`);

  let md = `# 第 1 级验证 ${VERSION}：「${NEED}」三层结构\n\n模型：${MODEL}｜生成时间：${new Date().toISOString().slice(0, 16).replace("T", " ")}｜标注规则：\`backend/scripts/lib/cleanliness.ts\`（标注规范 v3）\n\n`;
  md += `以 3 家酒店**全部评论**的模型标注作为参照（"相关" = 至少有一条关于干净的观点）。\n\n`;

  md += `## 一、检索修复前后对比（I-21 误检、I-22 漏检）\n\n`;
  md += `| 酒店 | 真正相关 | 其中含差评 | 旧检索：找到相关 | 旧检索：误检 | 旧检索：漏掉的差评 | 新检索：找到相关 | 新检索：误检 | 新检索：漏掉的差评 |\n|---|---|---|---|---|---|---|---|---|\n`;
  const tot = { rel: 0, neg: 0, v1hit: 0, v1fp: 0, v1negMiss: 0, v2hit: 0, v2fp: 0, v2negMiss: 0 };
  for (const h of hotels) {
    const rs = rows.filter((r) => r.hotel === h && !r.error);
    const rel = rs.filter(isRelevant);
    const neg = rs.filter(isNeg);
    const s = {
      rel: rel.length,
      neg: neg.length,
      v1hit: rel.filter((r) => r.retrievedV1).length,
      v1fp: rs.filter((r) => r.retrievedV1 && !isRelevant(r)).length,
      v1negMiss: neg.filter((r) => !r.retrievedV1).length,
      v2hit: rel.filter((r) => r.retrievedV2).length,
      v2fp: rs.filter((r) => r.retrievedV2 && !isRelevant(r)).length,
      v2negMiss: neg.filter((r) => !r.retrievedV2).length,
    };
    for (const k of Object.keys(tot) as (keyof typeof tot)[]) tot[k] += s[k];
    md += `| ${h} | ${s.rel} | ${s.neg} | ${s.v1hit}（${pct(s.v1hit, s.rel)}） | ${s.v1fp} | ${s.v1negMiss} / ${s.neg} | ${s.v2hit}（${pct(s.v2hit, s.rel)}） | ${s.v2fp} | ${s.v2negMiss} / ${s.neg} |\n`;
  }
  md += `| **合计** | ${tot.rel} | ${tot.neg} | ${tot.v1hit}（${pct(tot.v1hit, tot.rel)}） | ${tot.v1fp} | ${tot.v1negMiss} / ${tot.neg} | ${tot.v2hit}（${pct(tot.v2hit, tot.rel)}） | ${tot.v2fp} | ${tot.v2negMiss} / ${tot.neg} |\n\n`;
  md += `- **找到相关**：真正相关的评论里，检索找到了多少（召回率）\n- **误检**：检索找到、但其实没谈干净的评论数\n- **漏掉的差评**：含差评的评论里，检索没找到的数量\n\n`;

  md += `## 二、用户会看到的结论（第 3 层）\n\n汇总规则：少于 ${MIN_EVIDENCE} 条相关评论 → 证据不足；出现虫害，或同一对象差评 ≥ ${FLAG_OBJECT_NEGATIVES} 条 → ⚠️ 单独提醒；差评占比 < ${SPLIT_LOW * 100}% 多数评价干净，${SPLIT_LOW * 100}%–${SPLIT_HIGH * 100}% 有分歧，> ${SPLIT_HIGH * 100}% 多数评价不干净。\n\n`;
  for (const h of hotels) {
    const s = summarize(h, rows.filter((r) => r.hotel === h && !r.error));
    md += `### ${s.hotel}\n\n> **干净：${s.verdict}**${s.flags.length ? `\n> ⚠️ ${s.flags.join("；")}` : ""}\n\n`;
    md += `<details><summary>展开细节</summary>\n\n| 对象 | 好评 | 差评 | 差评的问题类型 |\n|---|---|---|---|\n`;
    for (const o of OBJECTS) {
      const b = s.byObject[o];
      if (b.pos + b.neg === 0) continue;
      md += `| ${o} | ${b.pos} | ${b.neg} | ${issueList(b.issues) || "—"} |\n`;
    }
    const negQuotes = rows
      .filter((r) => r.hotel === s.hotel)
      .flatMap((r) => (r.mentions ?? []).filter((m) => m.polarity === "negative").map((m) => `- ${m.object}｜${issueName(m.issue)}：「${m.quote}」`));
    if (negQuotes.length) md += `\n差评原文：\n\n${negQuotes.join("\n")}\n`;
    md += `\n</details>\n\n`;
  }

  // ---- 优先返回检查：详情页排在最前面的评论，是不是真的在谈干净？差评有没有排上来？ ----
  md += `## 三、详情页是否优先返回"干净"相关评论\n\n产品详情页（带 prefer=干净）默认只展示前 ${SHOWN_IN_DETAIL} 条。这里检查前 ${SHOWN_IN_DETAIL} 条和前 20 条里，真正谈到干净的有几条、差评排在第几位。\n\n| 酒店 | 前 ${SHOWN_IN_DETAIL} 条中相关 | 前 20 条中相关 | 含差评的评论排在第几位 |\n|---|---|---|---|\n`;
  for (const h of hotels) {
    const rs = rows.filter((r) => r.hotel === h && !r.error).sort((a, b) => a.detailRank - b.detailRank);
    const topN = rs.slice(0, SHOWN_IN_DETAIL).filter(isRelevant).length;
    const top20 = rs.slice(0, 20).filter(isRelevant).length;
    const negRanks = rs.filter(isNeg).map((r) => r.detailRank);
    md += `| ${h} | ${topN} / ${SHOWN_IN_DETAIL} | ${top20} / 20 | ${negRanks.length ? negRanks.join("、") : "没有差评"} |\n`;
  }
  md += `\n排在第 ${SHOWN_IN_DETAIL + 1} 位以后的差评，用户默认看不到。\n\n`;

  const allMentions = rows.flatMap((r) => (r.mentions ?? []).map((m) => ({ r, m })));
  const fake = allMentions.filter(({ r, m }) => !quoteReal(r.text, m.quote));
  md += `## 四、模型输出质量\n\n- 共拆出 ${allMentions.length} 条观点，来自 ${rows.filter(isRelevant).length} 条评论\n- 原文依据在评论里找不到：${fake.length} 条${fake.length ? "（" + fake.slice(0, 3).map(({ m }) => `「${m.quote.slice(0, 20)}」`).join("、") + "）" : ""}\n- 标注失败：${rows.filter((r) => r.error).length} 条评论\n\n下一步：在「抽查表.md」里核对观点拆分是否正确。\n`;
  writeFileSync(resolve(OUT_DIR, "汇总.md"), md);

  // ---- 抽查表：20 条评论，重点看拆分和差评 ----
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const shuffle = <T,>(a: T[]) => a.map((x) => [rand(), x] as const).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
  const pick: Row[] = [];
  const take = (rs: Row[], n: number) => {
    for (const r of shuffle(rs)) {
      if (pick.length >= 20 || n <= 0) break;
      if (!pick.includes(r)) (pick.push(r), n--);
    }
  };
  take(rows.filter((r) => (r.mentions?.length ?? 0) >= 2), 6); // 拆成多条观点的
  take(rows.filter(isNeg), 6); // 含差评的
  take(rows.filter((r) => r.retrievedV2 && !isRelevant(r)), 3); // 新检索的误检
  take(rows.filter((r) => isRelevant(r) && !isNeg(r)), 3);
  take(rows.filter((r) => !isRelevant(r)), 2);
  const PCN: Record<string, string> = { positive: "好评", negative: "差评" };
  const cell = (s: string) => s.replace(/\s+/g, " ").replace(/\|/g, "｜");
  let sheet = `# 抽查表 v2：观点拆分\n\n核对模型对每条评论的**拆分**是否正确：对象对不对、好评差评对不对、有没有漏拆或多拆。在「你的判断」一栏填 ✅（全对），或写出哪里不对。\n\n| # | 酒店 | 评论原文 | 模型拆出的观点 | 你的判断 |\n|---|---|---|---|---|\n`;
  pick.forEach((r, i) => {
    const ms = (r.mentions ?? []).map((m) => cell(`${m.object}／${PCN[m.polarity]}${m.issue !== "无" ? "／" + issueName(m.issue) : ""}：${m.quote}`)).join("<br>") || "（没提到干净）";
    sheet += `| ${i + 1} | ${r.hotel} | ${cell(r.text)} | ${ms} |  |\n`;
  });
  writeFileSync(resolve(OUT_DIR, "抽查表.md"), sheet);

  console.log(md);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
