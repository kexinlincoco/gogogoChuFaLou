import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH ?? "./data/chufalou.sqlite";
const resolvedPath = path.isAbsolute(dbPath) ? dbPath : path.join(process.cwd(), dbPath);

fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

export const db = new Database(resolvedPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
db.exec(schema);

// 已有数据库的增量迁移：CREATE TABLE IF NOT EXISTS 不会给旧表加列，这里补上（T2.5）。
// 只加列、不删不改数据；旧评论默认 language='zh'，英文评论再按内容回填为 'en'。
const reviewColumns = new Set((db.prepare("PRAGMA table_info(reviews)").all() as { name: string }[]).map((c) => c.name));
if (!reviewColumns.has("language")) {
  db.exec(`ALTER TABLE reviews ADD COLUMN language TEXT NOT NULL DEFAULT 'zh'`);
  db.exec(`UPDATE reviews SET language = 'en' WHERE id LIKE 'apify-%' AND text NOT GLOB '*[一-龥]*'`);
}
if (!reviewColumns.has("translation")) db.exec(`ALTER TABLE reviews ADD COLUMN translation TEXT`);
