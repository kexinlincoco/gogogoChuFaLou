/**
 * T1 需求识别测试（链路第 ① 步）：用户说一句话，产品能不能识别出"在意干净"。
 *
 * 走产品的真实路径：extractSlots（gpt-5-mini）→ applyNeeds（意图归一化）→ 看最终的
 * prefer 里有没有对应"干净"的关键词（产品只用 prefer 去找评论）。
 * 测试集：eval/level1/需求识别/t1-第1次.json 里的 30 句（cat / phrase / want）。
 * 通过标准：应该识别的识别率 ≥95%，不该识别的误判为 0。
 *
 * 运行：cd backend && npx tsx scripts/eval-intent.ts [--runs 3]
 * 每次运行的结果写到 eval/level1/需求识别/runs/<时间>.json
 */
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EMPTY_SLOTS, extractSlots } from "../src/services/ai.js";
import { applyNeeds } from "../src/services/chatEngine.js";
import { keywordRefersToNeed } from "../src/lib/textMatch.js";

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../eval/level1/需求识别");
const runsIdx = process.argv.indexOf("--runs");
const RUNS = runsIdx >= 0 ? Number(process.argv[runsIdx + 1]) : 3;
const PREFIX = "下周五去北京住两晚，预算 600。";

const cases = (JSON.parse(readFileSync(resolve(DIR, "t1-第1次.json"), "utf8")) as { cat: string; phrase: string; want: boolean }[]).map(({ cat, phrase, want }) => ({ cat, phrase, want }));

async function runOnce() {
  return Promise.all(
    cases.map(async (c) => {
      const msg = [{ role: "user" as const, text: PREFIX + c.phrase }];
      const raw = await extractSlots(msg, msg, { ...EMPTY_SLOTS });
      const slots = applyNeeds(raw);
      const got = slots.prefer.some((k) => keywordRefersToNeed(k, "干净"));
      return { ...c, needs: raw.needs, rawPrefer: raw.prefer, avoid: raw.avoid, prefer: slots.prefer, got, ok: got === c.want };
    })
  );
}

async function main() {
  const runs: Awaited<ReturnType<typeof runOnce>>[] = [];
  for (let i = 0; i < RUNS; i++) runs.push(await runOnce());
  const pos = cases.filter((c) => c.want).length, neg = cases.length - pos;
  runs.forEach((rs, i) => {
    const hit = rs.filter((r) => r.want && r.got).length, fp = rs.filter((r) => !r.want && r.got).length;
    console.log(`第 ${i + 1} 次：识别率 ${hit}/${pos}（${((hit / pos) * 100).toFixed(1)}%），误判 ${fp}/${neg}`);
  });
  const unstable = cases.filter((_, i) => new Set(runs.map((rs) => rs[i].got)).size > 1);
  console.log(`${RUNS} 次结果不一致的句子：${unstable.length} 句${unstable.length ? "（" + unstable.map((c) => c.phrase).join("、") + "）" : ""}`);
  const wrong = cases.map((c, i) => ({ c, bad: runs.filter((rs) => !rs[i].ok).length, last: runs[runs.length - 1][i] })).filter((x) => x.bad > 0);
  if (wrong.length) {
    console.log("\n出错的句子（出错次数 / 最后一次的提取结果）：");
    for (const w of wrong) console.log(`  [${w.c.cat}] ${w.c.phrase}：错 ${w.bad}/${RUNS} 次；needs=${JSON.stringify(w.last.needs)} prefer=${JSON.stringify(w.last.rawPrefer)} avoid=${JSON.stringify(w.last.avoid)}`);
  }
  mkdirSync(resolve(DIR, "runs"), { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  writeFileSync(resolve(DIR, "runs", `${stamp}.json`), JSON.stringify({ model: "gpt-5-mini", prefix: PREFIX, runs }, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
