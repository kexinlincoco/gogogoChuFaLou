/**
 * T4：用模型判断评论的"干净"需求，结果写进 review_aspects / review_need_labels 两张表。
 * 产品之后直接读这两张表（T6～T11），不再用关键词判断相关性。
 *
 * - 范围：默认北京全部酒店；已经用同一模型、同一规则版本判断过的评论会跳过（可以重复运行）
 * - 外语评论（有 translation 的）把中文译文交给模型，原文依据也摘自译文——页面展示的就是译文
 * - 默认只预览、不写入；加 --apply 才写入，写入前备份数据库
 * - 加 --relabel：规则版本或模型变了的评论也重新判断（先删旧结果）
 *
 * 运行：cd backend && npx tsx scripts/label-reviews.ts [--model gpt-5-mini] [--city 北京] [--apply] [--relabel]
 */
import "dotenv/config";
import path from "node:path";
import { db } from "../src/db/client.js";
import { GUIDE_VERSION, NEED, labelReviews, quoteFound, type Mention } from "./lib/cleanliness.js";

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const MODEL = arg("--model", "gpt-5-mini");
const CITY = arg("--city", "北京");
const APPLY = process.argv.includes("--apply");
const RELABEL = process.argv.includes("--relabel");
const PRICE_PER_1000 = MODEL === "gpt-5-mini" ? 0.29 : MODEL === "gpt-5.5" ? 2.68 : NaN; // 来自 eval-gold 实测（模型对比.md）

interface Row { id: string; hotel: string; text: string; translation: string | null; label_model: string | null; label_version: string | null }

async function main() {
  const rows = db
    .prepare(
      `SELECT r.id, h.name AS hotel, r.text, r.translation, l.model AS label_model, l.guide_version AS label_version
       FROM reviews r JOIN hotels h ON h.id = r.hotel_id
       LEFT JOIN review_need_labels l ON l.review_id = r.id AND l.need = ?
       WHERE h.city = ? AND r.source = 'user' ORDER BY h.name, r.id`
    )
    .all(NEED, CITY) as Row[];
  const current = (r: Row) => r.label_model === MODEL && r.label_version === GUIDE_VERSION;
  const todo = rows.filter((r) => r.label_model === null || (RELABEL && !current(r)));
  const stale = rows.filter((r) => r.label_model !== null && !current(r)).length;

  console.log(`${APPLY ? "写入" : "预览（没有写入任何数据）"}：判断「${NEED}」｜模型 ${MODEL}｜规则版本 ${GUIDE_VERSION}｜范围 ${CITY}`);
  console.log(`评论 ${rows.length} 条：已判断（当前版本）${rows.filter(current).length}，用旧版本判断的 ${stale}${stale && !RELABEL ? "（加 --relabel 才重判）" : ""}，这次要判断 ${todo.length}`);
  const byHotel = todo.reduce<Record<string, number>>((m, r) => ((m[r.hotel] = (m[r.hotel] ?? 0) + 1), m), {});
  for (const [h, n] of Object.entries(byHotel)) console.log(`  ${h}: ${n} 条`);
  console.log(`预计花费约 $${((todo.length / 1000) * PRICE_PER_1000).toFixed(2)}`);
  if (!APPLY || todo.length === 0) {
    if (!APPLY) console.log("\n确认无误后，加 --apply 写入。");
    return;
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  const backup = path.join(path.dirname(db.name), `chufalou.before-label-${stamp}.sqlite`);
  await db.backup(backup);
  console.log(`已备份数据库：${backup}`);

  const shown = new Map(todo.map((r) => [r.id, r.translation ?? r.text])); // 模型读的、页面展示的文本
  const res = await labelReviews(MODEL, todo.map((r) => ({ id: r.id, text: shown.get(r.id)! })), {
    onProgress: (d, t) => process.stdout.write(`\r已判断 ${d}/${t} 批`),
  });
  console.log();

  const delAspects = db.prepare("DELETE FROM review_aspects WHERE review_id = ? AND need = ?");
  const delLabel = db.prepare("DELETE FROM review_need_labels WHERE review_id = ? AND need = ?");
  const insAspect = db.prepare(
    `INSERT INTO review_aspects (review_id, need, object, polarity, issue, generic, quote, model, guide_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insLabel = db.prepare(`INSERT INTO review_need_labels (review_id, need, model, guide_version, mention_count, labeled_at) VALUES (?, ?, ?, ?, ?, ?)`);
  const now = new Date().toISOString();
  let written = 0, relevant = 0, mentions = 0, badQuotes = 0;
  db.transaction(() => {
    for (const [id, ms] of res.mentions as Map<string, Mention[]>) {
      delAspects.run(id, NEED);
      delLabel.run(id, NEED);
      for (const m of ms) {
        if (!quoteFound(shown.get(id)!, m.quote)) badQuotes++;
        insAspect.run(id, NEED, m.object, m.polarity, m.issue, m.generic || m.object === "整体（笼统）" ? 1 : 0, m.quote, MODEL, GUIDE_VERSION, now);
      }
      insLabel.run(id, NEED, MODEL, GUIDE_VERSION, ms.length, now);
      written++;
      if (ms.length) relevant++;
      mentions += ms.length;
    }
  })();
  const cost = (res.inputTokens * 0.25 + res.outputTokens * 2) / 1e6;
  console.log(`已写入 ${written} 条评论的判断（失败 ${res.failed.size} 条，重新运行会补上）`);
  console.log(`谈到「${NEED}」的评论 ${relevant} 条，共 ${mentions} 条观点；原文依据在评论里找不到的 ${badQuotes} 条`);
  if (MODEL === "gpt-5-mini") console.log(`实际花费约 $${cost.toFixed(3)}（${res.inputTokens} / ${res.outputTokens} tokens）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
