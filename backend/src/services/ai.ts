import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import type { ChatMessage } from "../types.js";
import type { Hotel } from "../types.js";
import type { RetrievedEvidence } from "./retrieval.js";

// Swap this one string to change quality/cost — gpt-5-mini is the cost/quality
// default for a course-project demo; bump to "gpt-5" for higher-quality replies.
const MODEL = "gpt-5-mini";

export const client = new OpenAI();

export function hasApiKey(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

// ---------------------------------------------------------------------------
// Slots: what the assistant needs before it can search (PRD §6.1)
// ---------------------------------------------------------------------------
export const SlotsSchema = z.object({
  city: z.string().nullable().describe("目的地城市，如未提及则为 null"),
  checkin: z.string().nullable().describe("入住日期 YYYY-MM-DD，如未提及则为 null"),
  checkout: z.string().nullable().describe("离店日期 YYYY-MM-DD，如未提及则为 null"),
  nights: z.number().nullable().describe("如果用户只说了住几晚（如'住两晚'）而没给离店日期，把晚数写在这里，否则为 null"),
  budget_max: z.number().nullable().describe("每晚预算上限（元），如未提及则为 null"),
  guests: z.number().nullable().describe("入住人数，如未提及默认可为 2"),
  prefer: z.array(z.string()).describe("用户在意的软性偏好关键词，如 安静/海景/亲子/性价比/泳池/近地铁"),
  avoid: z.array(z.string()).describe("用户明确排除的偏好，如 靠马路/太吵"),
});
export type Slots = z.infer<typeof SlotsSchema>;

export const EMPTY_SLOTS: Slots = {
  city: null,
  checkin: null,
  checkout: null,
  nights: null,
  budget_max: null,
  guests: null,
  prefer: [],
  avoid: [],
};

const SLOT_EXTRACT_SYSTEM = `你是"出发喽"App里的酒店预订助手的信息提取模块。
你的任务：读取到目前为止的对话，把用户表达过的、和订酒店有关的结构化信息合并进已知的slots里。
规则：
- 只提取用户明确表达或能合理推断的信息，不要编造。
- 已经确定过的字段，除非用户明确修改/推翻，否则保留原值（用之前的slots作为基础）。
- 日期尽量转换为 YYYY-MM-DD；如果用户说"这周末"、"下周"这类相对时间，按当前对话发生的语境合理推断一个具体日期；实在无法确定就留空。
- prefer/avoid 是关键词数组，不要写整句话，每个词尽量简短（如"安静""海景""亲子""性价比""泳池""近地铁""不要靠马路"可以拆成 avoid:["靠马路"]）。
- guests 没提到时不要瞎猜，返回 null（前端会展示默认值，但不要把默认值当作用户说过的话写回来）。`;

export async function extractSlots(history: ChatMessage[], currentSlots: Slots): Promise<Slots> {
  const transcript = history.map((m) => `${m.role === "user" ? "用户" : "助手"}：${m.text}`).join("\n");
  const response = await client.chat.completions.parse({
    model: MODEL,
    reasoning_effort: "low", // simple extraction task — full reasoning is unnecessary latency
    messages: [
      { role: "system", content: SLOT_EXTRACT_SYSTEM },
      {
        role: "user",
        content: `已知slots（JSON）：\n${JSON.stringify(currentSlots)}\n\n对话记录：\n${transcript}\n\n请输出合并更新后的完整slots。`,
      },
    ],
    response_format: zodResponseFormat(SlotsSchema, "slots"),
  });
  return response.choices[0]?.message.parsed ?? currentSlots;
}

// ---------------------------------------------------------------------------
// Conversational reply text (follow-up question, or the intro line before cards)
// ---------------------------------------------------------------------------
function persona(userName?: string): string {
  const nameLine = userName
    ? `用户的名字/称呼是"${userName}"，可以在合适的时候自然地用这个名字称呼TA（不用每句话都叫，太刻意反而显得生硬），拉近一点距离感。`
    : "";
  return `你叫"出发喽"，一个帮用户订酒店的AI助手，语气轻松、像朋友聊天，不要有客服腔。
不要用"作为AI助手"这类自我介绍语。回复尽量简短，1-2句话，可以带一点点可爱的语气词，但不要过度使用感叹号或表情符号（最多一个"～"）。
${nameLine}`;
}

export async function askForMissingSlot(history: ChatMessage[], slots: Slots, missing: string[], userName?: string): Promise<string> {
  const transcript = history.map((m) => `${m.role === "user" ? "用户" : "助手"}：${m.text}`).join("\n");
  const fieldNames: Record<string, string> = {
    city: "目的地城市",
    checkin: "入住日期",
    checkout: "离店日期",
    budget_max: "预算（每晚大概多少钱）",
  };
  const missingLabel = missing.map((m) => fieldNames[m] ?? m).join("、");
  const response = await client.chat.completions.create({
    model: MODEL,
    reasoning_effort: "low",
    messages: [
      { role: "system", content: persona(userName) },
      {
        role: "user",
        content: `对话记录：\n${transcript}\n\n还缺少这些必填信息：${missingLabel}。请用自然的口语化方式向用户追问其中最自然的1-2项（不要机械地把字段名列出来），像朋友聊天一样。`,
      },
    ],
  });
  return response.choices[0]?.message.content ?? "跟我说说你想去哪儿玩呀？";
}

export async function introduceRecommendations(history: ChatMessage[], slots: Slots, userName?: string): Promise<string> {
  const response = await client.chat.completions.create({
    model: MODEL,
    reasoning_effort: "low",
    messages: [
      { role: "system", content: persona(userName) },
      {
        role: "user",
        content: `用户想去${slots.city ?? "某地"}，预算每晚${slots.budget_max ?? "不限"}元，偏好：${slots.prefer.join("、") || "没有特别偏好"}。
写一句话过渡语，告诉用户你已经在真实住客评论里帮TA翻了一遍、挑了几家。不要提到具体酒店名字（还没展示）。`,
      },
    ],
  });
  return response.choices[0]?.message.content ?? `帮你在${slots.city ?? "这边"}翻了一遍真实住客评论，挑了几家～`;
}

// ---------------------------------------------------------------------------
// Recommendation reasons — RAG "generate" step (PRD §6.2): the model only
// ever sees retrieved snippets + a backend-computed ratio, never asked to
// invent a percentage or a fact with no snippet behind it.
// ---------------------------------------------------------------------------
const ReasonsSchema = z.object({
  reasons: z.array(
    z.object({
      hotelId: z.string(),
      reason: z.string().describe("一句话推荐理由，20-40字，基于给定评论片段，可以引用给定的匹配比例，但不能编造比例或事实"),
    })
  ),
});

export async function generateRecommendationReasons(
  slots: Slots,
  candidates: { hotel: Hotel; evidence: RetrievedEvidence }[]
): Promise<Record<string, string>> {
  const evidenceBlock = candidates
    .map(({ hotel, evidence }) => {
      const snippets = evidence.matched.map((r) => `  - "${r.text}"`).join("\n");
      const ratioPct = Math.round(evidence.matchRatio * 100);
      return `酒店ID: ${hotel.id}\n酒店名: ${hotel.name}\n真实评论中与用户偏好相关的比例（后端已计算，不要改写数字，可自然表达）：${ratioPct}% (${evidence.matched.length}/${evidence.totalReviewCount}条)\n相关评论原文片段：\n${snippets || "  （暂无强相关片段，可基于整体评论氛围委婉表达）"}`;
    })
    .join("\n\n");

  const response = await client.chat.completions.parse({
    model: MODEL,
    reasoning_effort: "low",
    messages: [
      {
        role: "system",
        content: `你是"出发喽"的推荐理由生成模块。只能依据给定的真实评论片段和后端提供的统计比例写推荐理由，绝不能编造评论中不存在的事实或数字。
如果给定比例是0%或片段很少，就用更委婉、真实的措辞（例如"评论不多，但住过的人反馈还不错"），不要硬凑百分比说法。
每条理由一句话，20-40字，口语化，避免"该酒店"这类生硬措辞。`,
      },
      {
        role: "user",
        content: `用户偏好关键词：${slots.prefer.join("、") || "无特别偏好"}\n\n${evidenceBlock}\n\n请为每个酒店ID生成一条推荐理由。`,
      },
    ],
    response_format: zodResponseFormat(ReasonsSchema, "reasons"),
  });

  const parsed = response.choices[0]?.message.parsed;
  const map: Record<string, string> = {};
  if (parsed) {
    for (const r of parsed.reasons) map[r.hotelId] = r.reason;
  }
  return map;
}
