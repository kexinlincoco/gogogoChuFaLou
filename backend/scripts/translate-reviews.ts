/**
 * T2.5 第 1 步：把北京 7 家酒店的其他语言评论（俄、意、法、德、西等，不含中文和英文）
 * 翻译成简体中文，存到 data/apify-translations.json。
 *
 * 翻译只做一次、存成文件：增量导入（scripts/import-reviews.ts）和 seed 都读这个文件，
 * 以后重新 seed 不会丢译文，也不用重新付费翻译。只翻译文件里还没有的评论，可以重复运行。
 * 不碰数据库。
 *
 * 运行：cd backend && npx tsx scripts/translate-reviews.ts
 * 加 --redo-mixed：把"译文里混着原文"的条目删掉重译（第一次翻译时有 20 条混了原文）
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { client } from "../src/services/ai.js";
import { APIFY_DATA_DIR, APIFY_HOTELS, TRANSLATIONS_FILE, loadTranslations, type RawApifyReview, type Translation } from "../src/db/apifySource.js";

const MODEL = "gpt-5-mini";
const BATCH = 10;
const CONCURRENCY = 4;

const Schema = z.object({ items: z.array(z.object({ id: z.string(), zh: z.string() })) });

const SYSTEM = `你是酒店评论翻译。把每条评论忠实地翻译成简体中文：
- 逐句翻译，不要总结、不要删减、不要添加原文没有的内容
- 原文里的抱怨、负面评价必须保留原来的语气和具体细节（比如脏、异味、头发、虫子），不要弱化
- 人名、地名可以保留原文
- 只输出中文译文，绝对不要包含、重复或逐句对照原文（专有名词除外）
- 输出和输入的 id 一一对应`;

/** 译文里出现连续 3 个以上的外语单词，说明混进了原文（专有名词一般不超过 2 个词） */
const looksMixed = (zh: string) => /([A-Za-zÀ-ÿЀ-ӿ]{2,}[\s,.'’!:;-]+){3,}/.test(zh);

async function main() {
  const cache = loadTranslations();
  if (process.argv.includes("--redo-mixed")) {
    const mixed = Object.keys(cache).filter((id) => looksMixed(cache[id].zh));
    for (const id of mixed) delete cache[id];
    console.log(`删除混了原文的译文 ${mixed.length} 条，重新翻译`);
  }
  const todo: { id: string; language: string; text: string }[] = [];
  for (const entry of APIFY_HOTELS) {
    const raw: RawApifyReview[] = JSON.parse(fs.readFileSync(path.join(APIFY_DATA_DIR, entry.file), "utf-8"));
    for (const r of raw) {
      if (r.language === "zh" || r.language === "en" || !r.content || r.content.trim().length < 5) continue;
      const id = `apify-${r.id}`;
      if (!cache[id]) todo.push({ id, language: r.language, text: r.content.trim() });
    }
  }
  console.log(`已有译文 ${Object.keys(cache).length} 条，需要翻译 ${todo.length} 条`);
  if (todo.length === 0) return;

  const queue: (typeof todo)[] = [];
  for (let i = 0; i < todo.length; i += BATCH) queue.push(todo.slice(i, i + BATCH));
  const total = queue.length;
  let done = 0, inTok = 0, outTok = 0, failed = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let batch = queue.shift(); batch; batch = queue.shift()) {
        try {
          const res = await client.chat.completions.parse({
            model: MODEL,
            reasoning_effort: "low",
            messages: [
              { role: "system", content: SYSTEM },
              { role: "user", content: batch.map((r) => `[${r.id}] (${r.language}) ${r.text.replace(/\s+/g, " ")}`).join("\n") },
            ],
            response_format: zodResponseFormat(Schema, "translations"),
          });
          inTok += res.usage?.prompt_tokens ?? 0;
          outTok += res.usage?.completion_tokens ?? 0;
          const byId = new Map(res.choices[0]?.message.parsed?.items.map((i) => [i.id, i.zh]) ?? []);
          for (const r of batch) {
            const zh = byId.get(r.id)?.trim();
            if (zh && !looksMixed(zh)) cache[r.id] = { language: r.language, zh, model: MODEL, translatedAt: new Date().toISOString().slice(0, 10) } satisfies Translation;
            else failed++;
          }
        } catch (e) {
          failed += batch.length;
          console.error(`\n一批翻译失败：${(e as Error).message.slice(0, 120)}`);
        }
        process.stdout.write(`\r已翻译 ${++done}/${total} 批`);
      }
    })
  );
  console.log();

  const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(TRANSLATIONS_FILE, JSON.stringify(sorted, null, 1) + "\n");
  const cost = (inTok * 0.25 + outTok * 2) / 1e6;
  const stillMixed = Object.keys(sorted).filter((id) => looksMixed(sorted[id].zh));
  console.log(`完成：共 ${Object.keys(sorted).length} 条译文，失败或不合格 ${failed + (todo.length - todo.filter((r) => sorted[r.id]).length - failed)} 条；仍混有原文 ${stillMixed.length} 条；tokens ${inTok} / ${outTok}，约 $${cost.toFixed(3)}`);
  console.log(`已写入 ${TRANSLATIONS_FILE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
