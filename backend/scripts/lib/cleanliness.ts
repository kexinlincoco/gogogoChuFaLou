/**
 * "干净"需求的标注规则与模型调用，供 eval-level1.ts（全部评论）和
 * eval-gold.ts（对比标准答案、比较模型）共用，保证两边用的是同一套规则。
 * 规则与 eval/level1/gold/标注规范.md（v3）、DECISION_LOG D-05～D-07 一致；改规则时三处一起改。
 */
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { client } from "../../src/services/ai.js";

export const NEED = "干净";
export const OBJECTS = ["房间", "床品", "卫生间", "公共区域", "用品", "整体（笼统）"] as const;
export const ISSUES = ["气味", "毛发污渍", "虫害", "其他"] as const;

const MentionSchema = z.object({
  object: z.enum(OBJECTS),
  polarity: z.enum(["positive", "negative"]),
  issue: z.enum([...ISSUES, "无"]).describe("差评的问题类型；好评填 无"),
  generic: z.boolean().describe("好评只是笼统的正面评价、没有具体说到干净（规则 11）时为 true；具体说了干净、或者是差评时为 false"),
  quote: z.string().describe("逐字摘抄的原文依据"),
});
const LabelSchema = z.object({
  items: z.array(z.object({ id: z.string(), mentions: z.array(MentionSchema).describe("没有谈到干净时为空数组") })),
});
export type Mention = z.infer<typeof MentionSchema>;

export const GUIDE = `你在给酒店评论做"干净"这一个需求的标注。把每条评论拆成若干条观点，每条观点是（对象，态度，问题类型，原文）。

【"干净"的范围】酒店提供给住客的环境是否干净：清洁、卫生、整洁、气味（烟味、霉味、臭味、异味都算不干净）、毛发污渍、虫害，以及公共区域有杂物、落叶、柳絮、垃圾没清理（算清洁不到位，问题类型填"其他"）。
【不算"干净"】打扫的频率或服务态度（"每天都来打扫"是服务）、设施新旧（"设施老旧"不等于脏）、房间大小、隔音、舒适（"床品很软""住得很舒服""睡得香"）、潮湿（"房间很潮湿""床单是潮的"，本身不算；但有霉味、潮味仍算气味·不干净）、洗护用品香不香（"沐浴露很好闻"）、酒店外面的街道巷子、评分高但没写原因。

【对象，6 选 1】
- 房间：房间整体、地面、桌面、窗台；"酒店很干净""卫生很好"等没说是哪里的，也归房间
- 床品：床单、被子、被罩、枕头（"被子很香"算床品·好评；"床很软""睡得香"是舒适，不算）
- 卫生间：马桶、淋浴、浴室、洗漱台、地漏
- 公共区域：大堂、走廊、院子、泳池、电梯、餐厅（"院子打理得很好"记为 公共区域·好评）
- 用品：毛巾、浴巾、杯具、水壶、拖鞋
- 整体（笼统）：只有正面的环境评价（"环境好""环境也行""环境安静优雅"），全文没有具体提到卫生或任何对象干不干净时，记为 整体（笼统）·好评，generic=true

【规则】
1. 同一条评论谈到不同对象，拆成多条观点，各判各的。
2. 补救不能抵消问题：房间有烟味、后来换了房 → 仍记"房间，差评，气味"；换房属于服务，不记。
3. 否定掉负面算好评："没有一点异味" → 好评。
4. 比较句按结论判："卫生比我想的要好" → 好评。
5. 否定句是差评："不太干净""不算干净" → 差评。
6. 差评填问题类型（气味 / 毛发污渍 / 虫害 / 其他），好评填"无"。水垢、灰尘、污渍算毛发污渍。
7. quote 逐字摘抄原文，不要改写、不要繁简转换。
8. 住客自己在入住期间弄脏的（如"孩子流鼻血弄到床上"）不算卫生问题，不记；只有酒店提供的环境本身不干净才算。
9. 有具体说法看具体说法：评论里只要具体提到了卫生或某个对象干不干净，就按具体说法记，不再额外记"整体（笼统）"。例："環境不錯，就是衞生不太乾淨" → 只记 房间·差评。
10. 没有谈到干净的评论，mentions 为空数组。
11. 笼统的正面评价也算干净，但 generic=true：
   - 算：对环境或院子整体的正面描述，包括氛围和安静（"环境安静""院落清幽雅致""小院很温馨""古色古香"）；对象的笼统好评（"床品超赞""杯具摆得整整齐齐""院子打理得好"）
   - 归类：院子、小院、院落 → 公共区域；房间（"房间环境很好"）→ 房间；只说"环境" → 整体（笼统）
   - 不算（不记）：设施的大小或有没有（"巨大浴缸""空间很大""有天台、露台"）、房间装饰风格（"布置温馨""简约雅致"）、舒适（"睡得香""床很软"）、整体满意（"很满意"）、酒店外面的环境（"周边安静"）
   - 具体说了干净（"床单洁白如新""楼梯扶手擦得锃亮""卫生很好"）时 generic=false`;

/** 每一次 API 调用的原始记录，用来和 OpenAI 后台 Usage 页面核对 */
export interface CallRecord {
  requestId: string | null; // OpenAI 返回的响应 ID（chatcmpl-…）
  requestedModel: string;
  returnedModel: string; // 接口实际返回的模型名
  startedAt: string;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  reviewIds: string[];
  error?: string;
}

export interface LabelResult {
  mentions: Map<string, Mention[]>; // 评论 id → 观点；标注失败的 id 不在里面
  failed: Set<string>;
  calls: CallRecord[];
  inputTokens: number;
  outputTokens: number;
  seconds: number;
}

// gpt-4.1 系列不是推理模型，不接受 reasoning_effort
const isReasoningModel = (model: string) => !model.startsWith("gpt-4");

/** 用指定模型标注一批评论（按 batchSize 分批、concurrency 并发）。 */
export async function labelReviews(
  model: string,
  reviews: { id: string; text: string }[],
  opts: { batchSize?: number; concurrency?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<LabelResult> {
  const batchSize = opts.batchSize ?? 15;
  const queue: { id: string; text: string }[][] = [];
  for (let i = 0; i < reviews.length; i += batchSize) queue.push(reviews.slice(i, i + batchSize));
  const total = queue.length;
  const result: LabelResult = { mentions: new Map(), failed: new Set(), calls: [], inputTokens: 0, outputTokens: 0, seconds: 0 };
  const started = Date.now();
  let done = 0;

  await Promise.all(
    Array.from({ length: opts.concurrency ?? 4 }, async () => {
      for (let batch = queue.shift(); batch; batch = queue.shift()) {
        const list = batch.map((r) => `[${r.id}] ${r.text.replace(/\s+/g, " ")}`).join("\n");
        const t0 = Date.now();
        const call: CallRecord = { requestId: null, requestedModel: model, returnedModel: "", startedAt: new Date(t0).toISOString(), ms: 0, inputTokens: 0, outputTokens: 0, reviewIds: batch.map((r) => r.id) };
        result.calls.push(call);
        try {
          const res = await client.chat.completions.parse({
            model,
            ...(isReasoningModel(model) ? { reasoning_effort: "low" as const } : {}),
            messages: [
              { role: "system", content: GUIDE },
              { role: "user", content: list },
            ],
            response_format: zodResponseFormat(LabelSchema, "labels"),
          });
          call.ms = Date.now() - t0;
          call.requestId = res.id;
          call.returnedModel = res.model;
          call.inputTokens = res.usage?.prompt_tokens ?? 0;
          call.outputTokens = res.usage?.completion_tokens ?? 0;
          result.inputTokens += call.inputTokens;
          result.outputTokens += call.outputTokens;
          const byId = new Map(res.choices[0]?.message.parsed?.items.map((i) => [i.id, i.mentions]) ?? []);
          for (const r of batch) {
            const m = byId.get(r.id);
            if (m) result.mentions.set(r.id, m);
            else result.failed.add(r.id);
          }
        } catch (e) {
          call.ms = Date.now() - t0;
          call.error = (e as Error).message.slice(0, 300);
          console.error(`\n[${model}] 一批标注失败：${call.error.slice(0, 120)}`);
          for (const r of batch) result.failed.add(r.id);
        }
        opts.onProgress?.(++done, total);
      }
    })
  );
  result.seconds = (Date.now() - started) / 1000;
  return result;
}
