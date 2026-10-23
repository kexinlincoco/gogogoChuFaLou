/**
 * 增量导入：把 data/apify-data 里北京 7 家酒店的英文评论追加进 reviews 表（I-26）。
 *
 * 和 seed.ts 的区别：seed 会清空整个数据库后重建；这里只追加数据库里还没有的评论，
 * 酒店、已有评论、账号、订单、反馈都不动。评论 ID 和内容由 src/db/apifySource.ts 生成，
 * 与 seed 完全一致，所以以后重新 seed 也会得到同样的 ID。
 *
 * 默认只预览、不写入：cd backend && npx tsx scripts/import-english-reviews.ts
 * 确认后写入（会先把数据库备份到 data/）：npx tsx scripts/import-english-reviews.ts --apply
 * 可以重复运行：已经导入过的评论会被跳过。
 */
import fs from "node:fs";
import path from "node:path";
import { db } from "../src/db/client.js";
import { APIFY_DATA_DIR, APIFY_HOTELS, apifyReviewRow, isImportableApifyReview, type RawApifyReview } from "../src/db/apifySource.js";

const APPLY = process.argv.includes("--apply");
const LANGUAGE = "en";

const exists = db.prepare("SELECT 1 FROM reviews WHERE id = ?");
const hotelExists = db.prepare("SELECT 1 FROM hotels WHERE id = ?");
const insert = db.prepare(
  `INSERT INTO reviews (id, hotel_id, author, source, topics, text, created_at) VALUES (@id, @hotel_id, @author, @source, @topics, @text, @created_at)`
);
const countFor = db.prepare("SELECT COUNT(*) AS n FROM reviews WHERE hotel_id = ?");

async function main() {
  const totalBefore = (db.prepare("SELECT COUNT(*) AS n FROM reviews").get() as { n: number }).n;
  const plan: { hotel: string; hotelId: string; rows: ReturnType<typeof apifyReviewRow>[]; skipped: number; before: number }[] = [];

  for (const entry of APIFY_HOTELS) {
    if (!hotelExists.get(entry.hotelId)) throw new Error(`数据库里没有酒店 ${entry.name}（${entry.hotelId}），请先确认数据库是否完整`);
    const raw: RawApifyReview[] = JSON.parse(fs.readFileSync(path.join(APIFY_DATA_DIR, entry.file), "utf-8"));
    const candidates = raw.filter((r) => r.language === LANGUAGE && isImportableApifyReview(r)).map((r) => apifyReviewRow(entry.hotelId, r));
    const rows = candidates.filter((row) => !exists.get(row.id));
    plan.push({ hotel: entry.name, hotelId: entry.hotelId, rows, skipped: candidates.length - rows.length, before: (countFor.get(entry.hotelId) as { n: number }).n });
  }

  console.log(`${APPLY ? "写入" : "预览（没有写入任何数据）"}：英文评论增量导入\n`);
  console.log("酒店 | 现有评论 | 新增英文 | 已存在跳过 | 导入后");
  for (const p of plan) console.log(`${p.hotel} | ${p.before} | +${p.rows.length} | ${p.skipped} | ${p.before + p.rows.length}`);
  const added = plan.reduce((n, p) => n + p.rows.length, 0);
  console.log(`合计：评论 ${totalBefore} → ${totalBefore + added}（+${added}）`);
  const sample = plan.flatMap((p) => p.rows)[0];
  if (sample) console.log(`\n示例：${sample.id}｜${sample.author}｜${sample.created_at}｜${sample.text.slice(0, 80)}`);

  if (!APPLY) {
    console.log("\n确认无误后，加 --apply 写入。");
    return;
  }
  if (added === 0) {
    console.log("\n没有需要导入的评论。");
    return;
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  const backup = path.join(path.dirname(db.name), `chufalou.before-english-import-${stamp}.sqlite`);
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
