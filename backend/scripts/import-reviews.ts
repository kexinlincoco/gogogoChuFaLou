/**
 * 增量导入：把 data/apify-data 里北京 7 家酒店还没入库的评论追加进 reviews 表——
 * 英文（I-26），以及在 data/apify-translations.json 里有中文译文的其他语言（T2.5，
 * 译文由 scripts/translate-reviews.ts 生成）。
 *
 * 和 seed.ts 的区别：seed 会清空整个数据库后重建；这里只追加数据库里还没有的评论，
 * 酒店、已有评论、账号、订单、反馈都不动。评论 ID 和内容由 src/db/apifySource.ts 生成，
 * 与 seed 完全一致，所以以后重新 seed 也会得到同样的 ID。
 *
 * 默认只预览、不写入：cd backend && npx tsx scripts/import-reviews.ts
 * 确认后写入（会先把数据库备份到 data/）：npx tsx scripts/import-reviews.ts --apply
 * 可以重复运行：已经导入过的评论会被跳过。
 */
import fs from "node:fs";
import path from "node:path";
import { db } from "../src/db/client.js";
import { APIFY_DATA_DIR, APIFY_HOTELS, apifyReviewRow, isImportableApifyReview, loadTranslations, type RawApifyReview } from "../src/db/apifySource.js";

const APPLY = process.argv.includes("--apply");

const exists = db.prepare("SELECT 1 FROM reviews WHERE id = ?");
const hotelExists = db.prepare("SELECT 1 FROM hotels WHERE id = ?");
const insert = db.prepare(
  `INSERT INTO reviews (id, hotel_id, author, source, topics, text, created_at, language, translation) VALUES (@id, @hotel_id, @author, @source, @topics, @text, @created_at, @language, @translation)`
);
const countFor = db.prepare("SELECT COUNT(*) AS n FROM reviews WHERE hotel_id = ?");

async function main() {
  const translations = loadTranslations();
  const totalBefore = (db.prepare("SELECT COUNT(*) AS n FROM reviews").get() as { n: number }).n;
  const plan: { hotel: string; hotelId: string; rows: ReturnType<typeof apifyReviewRow>[]; skipped: number; before: number }[] = [];

  for (const entry of APIFY_HOTELS) {
    if (!hotelExists.get(entry.hotelId)) throw new Error(`数据库里没有酒店 ${entry.name}（${entry.hotelId}），请先确认数据库是否完整`);
    const raw: RawApifyReview[] = JSON.parse(fs.readFileSync(path.join(APIFY_DATA_DIR, entry.file), "utf-8"));
    // 中文早已全部入库；这里补的是英文和有译文的其他语言
    const candidates = raw.filter((r) => r.language !== "zh" && isImportableApifyReview(r, translations)).map((r) => apifyReviewRow(entry.hotelId, r, translations));
    const rows = candidates.filter((row) => !exists.get(row.id));
    plan.push({ hotel: entry.name, hotelId: entry.hotelId, rows, skipped: candidates.length - rows.length, before: (countFor.get(entry.hotelId) as { n: number }).n });
  }

  console.log(`${APPLY ? "写入" : "预览（没有写入任何数据）"}：评论增量导入（英文 + 有译文的其他语言）\n`);
  console.log("酒店 | 现有评论 | 新增 | 已存在跳过 | 导入后 | 新增的语言");
  const langs = (rows: { language: string }[]) => Object.entries(rows.reduce<Record<string, number>>((m, r) => ((m[r.language] = (m[r.language] ?? 0) + 1), m), {})).map(([l, n]) => `${l}${n}`).join(" ") || "—";
  for (const p of plan) console.log(`${p.hotel} | ${p.before} | +${p.rows.length} | ${p.skipped} | ${p.before + p.rows.length} | ${langs(p.rows)}`);
  const added = plan.reduce((n, p) => n + p.rows.length, 0);
  console.log(`合计：评论 ${totalBefore} → ${totalBefore + added}（+${added}）`);
  const sample = plan.flatMap((p) => p.rows)[0];
  if (sample) console.log(`\n示例：${sample.id}｜${sample.language}｜${sample.text.slice(0, 60)}${sample.translation ? `\n　　译文：${sample.translation.slice(0, 60)}` : ""}`);

  if (!APPLY) {
    console.log("\n确认无误后，加 --apply 写入。");
    return;
  }
  if (added === 0) {
    console.log("\n没有需要导入的评论。");
    return;
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  const backup = path.join(path.dirname(db.name), `chufalou.before-import-${stamp}.sqlite`);
  await db.backup(backup);
  console.log(`\n已备份数据库：${backup}`);

  db.transaction(() => {
    for (const p of plan) for (const row of p.rows) insert.run(row);
  })();
  const totalAfter = (db.prepare("SELECT COUNT(*) AS n FROM reviews").get() as { n: number }).n;
  console.log(`已写入。评论总数：${totalAfter}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
