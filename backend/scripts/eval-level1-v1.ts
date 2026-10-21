/**
 * 第 1 级验证（能不能做准）：对 1 个软需求 × 3 家北京酒店，
 *   1. 用产品现有的检索（findMatchingReviews）找出"相关评论"；
 *   2. 另外用同义词捞出检索漏掉的候选，估计漏检；
 *   3. 让模型逐条判断：好评 / 差评 / 好坏参半 / 没提到，并摘出原文依据；
 *   4. 输出全部结果 + 30 条分层抽样的人工抽查表。
 *
 * 只读数据库，不写入任何数据。运行：
 *   cd backend && npx tsx scripts/eval-level1-v1.ts
 * 结果写到仓库根目录的 eval/level1/v1/。已被 eval-level1.ts（v2）取代。注意：它调用的产品检索已经修改（I-21、I-22），现在重跑的结果不会和 v1 存档一致。
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { client } from "../src/services/ai.js";
import { findMatchingReviews } from "../src/services/retrieval.js";
import { getHotel } from "../src/db/repo.js";
import { db } from "../src/db/client.js";
import { toSimplified } from "../src/lib/textMatch.js";
import type { Review } from "../src/types.js";

const NEED = "干净";
// 同义/相关说法：只用来估计产品检索漏掉了多少，不参与产品检索本身。
const RECALL_PROBES = ["卫生", "脏", "整洁", "清洁", "异味", "霉", "污渍", "头发", "灰尘", "味道"];
const HOTEL_IDS = ["130505294" /* 汉庭(前门店) */, "1286148" /* 北京索菲特 */];
const HOTEL_NAME_LIKE = "皇城根";
const MODEL = "gpt-5-mini";
const BATCH = 15;
const CONCURRENCY = 4;

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../eval/level1/v1");

const LabelSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      label: z.enum(["positive", "negative", "mixed", "not_mentioned"]),
      quote: z.string().describe("评论原文中关于该需求的那一小段，逐字摘抄；not_mentioned 时为空字符串"),
    })
  ),
});

const LABEL_CN: Record<string, string> = { positive: "好评", negative: "差评", mixed: "好坏参半", not_mentioned: "没提到" };

interface Row {
  hotel: string;
  id: string;
  retrieved: boolean; // 产品检索是否命中
  via: "topic" | "text" | "probe"; // 命中途径：话题标签 / 原文关键词 / 同义词探测（产品没命中）
  text: string;
  label?: string;
  quote?: string;
  quoteVerified?: boolean; // 摘抄是否真的出现在原文里（防止模型编造）
}

async function classify(batch: Row[]): Promise<void> {
  const list = batch.map((r) => `[${r.id}] ${r.text.replace(/\s+/g, " ")}`).join("\n");
  const res = await client.chat.completions.parse({
    model: MODEL,
    reasoning_effort: "low",
    messages: [
      {
        role: "system",
        content: `你在给酒店评论做标注。只判断每条评论对"${NEED}"（卫生、清洁程度）这一个方面的态度：
- positive：明确说干净、卫生好
- negative：明确说不干净、脏、有异味、卫生差（注意"不太干净""不算干净"等否定都是 negative）
- mixed：同一条评论里对干净既有肯定又有否定
- not_mentioned：没有谈到干净/卫生（只是评分高、或只说了别的方面，都算 not_mentioned）
quote 必须逐字摘抄原文，不要改写、不要繁简转换。`,
      },
      { role: "user", content: list },
    ],
    response_format: zodResponseFormat(LabelSchema, "labels"),
  });
  const parsed = res.choices[0]?.message.parsed;
  const byId = new Map(parsed?.items.map((i) => [i.id, i]) ?? []);
  for (const r of batch) {
    const it = byId.get(r.id);
    r.label = it?.label ?? "error";
    r.quote = it?.quote ?? "";
    // 模型常把"衞"写成"衛"、或用省略号截断长句，所以统一成简体、去掉空白、按省略号分段后再核对。
    const norm = (x: string) => toSimplified(x).replace(/\s+/g, "");
    const t = norm(r.text);
    r.quoteVerified = !r.quote || r.quote.split(/\.\.\.|…/).every((part) => !part.trim() || t.includes(norm(part)));
  }
}

async function main() {
  const hzg = db.prepare("SELECT id FROM hotels WHERE name LIKE ?").get(`%${HOTEL_NAME_LIKE}%`) as { id: string };
  const hotelIds = [hzg.id, ...HOTEL_IDS];

  const rows: Row[] = [];
  for (const hid of hotelIds) {
    const hotel = getHotel(hid)!;
    const { all, matched } = findMatchingReviews(hid, [NEED]);
    const matchedIds = new Set(matched.map((r) => r.id));
    const push = (r: Review, retrieved: boolean, via: Row["via"]) => rows.push({ hotel: hotel.name, id: r.id, retrieved, via, text: r.text });
    for (const r of matched) push(r, true, r.topics.some((t) => t.includes(NEED)) ? "topic" : "text");
    for (const r of all) {
      if (matchedIds.has(r.id)) continue;
      const s = toSimplified(r.text);
      if (RECALL_PROBES.some((p) => s.includes(p))) push(r, false, "probe");
    }
  }

  const batches: Row[][] = [];
  for (let i = 0; i < rows.length; i += BATCH) batches.push(rows.slice(i, i + BATCH));
  let done = 0;
  const queue = [...batches];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let b = queue.shift(); b; b = queue.shift()) {
        await classify(b);
        done++;
        process.stdout.write(`\r已标注 ${done}/${batches.length} 批`);
      }
    })
  );
  console.log();

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, "results.json"), JSON.stringify({ need: NEED, model: MODEL, rows }, null, 2));

  // ---- 汇总 ----
  const hotels = [...new Set(rows.map((r) => r.hotel))];
  const count = (rs: Row[], label: string) => rs.filter((r) => r.label === label).length;
  let summary = `# 第 1 级验证：「${NEED}」× 3 家酒店\n\n模型：${MODEL}（reasoning_effort=low）｜生成时间：${new Date().toISOString().slice(0, 16).replace("T", " ")}\n\n`;
  summary += `## 检索结果：产品检索找到的评论里，有多少真的在谈${NEED}？\n\n| 酒店 | 检索命中 | 其中经话题标签命中 | 真的谈到${NEED} | 没提到（误检） | 好评 | 差评 | 好坏参半 |\n|---|---|---|---|---|---|---|---|\n`;
  for (const h of hotels) {
    const rs = rows.filter((r) => r.hotel === h && r.retrieved);
    const nm = count(rs, "not_mentioned");
    summary += `| ${h} | ${rs.length} | ${rs.filter((r) => r.via === "topic").length} | ${rs.length - nm} | ${nm} | ${count(rs, "positive")} | ${count(rs, "negative")} | ${count(rs, "mixed")} |\n`;
  }
  summary += `\n## 漏检：产品检索没找到、但其实在谈${NEED}的评论\n\n用同义词（${RECALL_PROBES.join("、")}）捞出候选，再由模型判断。\n\n| 酒店 | 同义词候选 | 其中真的谈到${NEED}（漏检） | 漏检里的差评 |\n|---|---|---|---|\n`;
  for (const h of hotels) {
    const rs = rows.filter((r) => r.hotel === h && !r.retrieved);
    const missed = rs.filter((r) => r.label !== "not_mentioned" && r.label !== "error");
    summary += `| ${h} | ${rs.length} | ${missed.length} | ${count(missed, "negative") + count(missed, "mixed")} |\n`;
  }
  const unverified = rows.filter((r) => r.quoteVerified === false).length;
  const errors = rows.filter((r) => r.label === "error").length;
  summary += `\n## 模型输出质量\n\n- 摘抄的原文依据在评论里找不到（疑似编造）：${unverified} 条\n- 标注失败：${errors} 条\n\n下一步：在「抽查表.md」里逐条填写你的判断，算出模型和人工的一致率。\n`;
  writeFileSync(resolve(OUT_DIR, "汇总.md"), summary);

  // ---- 30 条分层抽样 ----
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const shuffle = <T,>(a: T[]) => a.map((x) => [rand(), x] as const).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
  const negation = /不(太|够|算|是很|怎么)?(干净|卫生)/;
  const pick: Row[] = [];
  const take = (rs: Row[], n: number) => {
    for (const r of shuffle(rs)) {
      if (pick.length >= 30 || n <= 0) break;
      if (!pick.includes(r)) (pick.push(r), n--);
    }
  };
  take(rows.filter((r) => negation.test(toSimplified(r.text))), 5); // 否定句优先
  take(rows.filter((r) => r.label === "negative" || r.label === "mixed"), 7);
  take(rows.filter((r) => r.retrieved && r.via === "topic" && r.label === "not_mentioned"), 5); // 话题标签误检
  take(rows.filter((r) => !r.retrieved && r.label !== "not_mentioned"), 4); // 漏检
  take(rows.filter((r) => r.label === "positive"), 6);
  take(rows, 30);

  let sheet = `# 人工抽查表：「${NEED}」\n\n对每条评论，判断它对"${NEED}"的态度，在「你的判断」一栏填：**好评 / 差评 / 好坏参半 / 没提到**。填完后告诉我，我来算一致率。\n\n`;
  sheet += `| # | 酒店 | 检索 | 评论原文 | 模型判断 | 模型摘抄的依据 | 你的判断 |\n|---|---|---|---|---|---|---|\n`;
  pick.forEach((r, i) => {
    const via = r.retrieved ? (r.via === "topic" ? "命中（话题标签）" : "命中（原文）") : "漏检";
    const text = r.text.replace(/\s+/g, " ").replace(/\|/g, "｜");
    sheet += `| ${i + 1} | ${r.hotel} | ${via} | ${text} | ${LABEL_CN[r.label ?? ""] ?? r.label} | ${(r.quote ?? "").replace(/\|/g, "｜")} |  |\n`;
  });
  writeFileSync(resolve(OUT_DIR, "抽查表.md"), sheet);

  console.log(summary);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
