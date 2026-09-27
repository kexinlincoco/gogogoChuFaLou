# 出发喽

酒店**评论辅助浏览原型**：用户用自然语言说出需求 → 在样本酒店里筛出候选 → 找到相关评论并高亮 → 核对原文。**不是订房平台**，价格和订单都是模拟的。

- 进度和下一步：[进度与下一步.md](进度与下一步.md)，每次开工先看第 4 节
- 完整产品分析：[出发喽_PRD.md](出发喽_PRD.md)

## 目标与成功指标

- **目标**：帮用户更快找到和自己关心的点（安静、卫生、早餐……）相关的评论，并且不产生误判；同时做成可以放进作品集的项目
- **成功指标**（用户测试，还没做）：和普通评论列表相比，①找到有效证据的时间更短 ②结论错误率不上升 ③证据不足时能判断"无法判断"
- **不算成功的**：演示订单变多、AI 入口占比升高

## 关键限制

- 数据：11 家酒店、1,382 条历史评论（北京 8 家，杭州、澳门、纽约各 1 家），不是实时数据
- 检索用字面/标签匹配，不是语义检索，识别不了否定（"不安静"）
- 对话依赖 OpenAI（`gpt-5-mini`，Key 放在 `backend/.env`）；筛选和订单不依赖模型
- 登录固定验证码 `123456`，没有真实支付和库存
- ⚠️ **不要随手运行 `npm run seed`**：它会清空并重建整个数据库

## 启动

```bash
cd backend && npm run dev      # :8787
cd frontend && npm run dev     # :5173，/api 代理到 8787
```

检查：分别在前后端目录运行 `npm run typecheck`。指标页：`http://localhost:5173/?debug=metrics`

## 功能 → 代码位置

| 功能 | 后端 | 前端 |
|---|---|---|
| 对话入口、多轮流程 | `routes/chat.ts` → `services/chatEngine.ts` 的 `handleTurn` | `components/ChatScreen.tsx` |
| 从对话提取条件（城市/日期/预算/偏好） | `services/ai.ts` 的 `extractSlots`，缺字段时用 `askForMissingSlot` 追问 | — |
| 必填字段 | `chatEngine.ts` 的 `REQUIRED_FIELDS` | — |
| 候选打分、排序、放宽预算 | `chatEngine.ts` 的 `scoreHotel`、`matchHotels` | `HotelCard.tsx`、`HotelWaterfall.tsx` |
| 评论检索（给摘要用） | `services/retrieval.ts` 的 `retrieveEvidence` | — |
| 推荐理由、摘要生成 | `ai.ts` 的 `generateRecommendationReasons`、`introduceRecommendations` | — |
| 关键词与标签匹配 | `lib/textMatch.ts` | `lib/highlight.tsx`（前端高亮，两边逻辑要保持一致） |
| 评论原文弹窗 | — | `EvidenceModal.tsx` |
| 手动筛选 | `routes/hotels.ts`（`GET /`）→ `db/repo.ts` 的 `listHotels` | `FilterScreen.tsx` |
| 酒店详情、评论排序、高频话题 | `routes/hotels.ts`（`GET /:id`，参数 `prefer`）、`repo.ts` 的 `topReviewTopics` | `BookingSheet.tsx` |
| 模拟价格 | `services/pricing.ts` | — |
| 酒店图片 | `services/images.ts` | — |
| 演示登录 | `routes/auth.ts` | `LoginModal.tsx` |
| 演示订单 | `routes/orders.ts`、`repo.ts` 的 `createOrder` | `BookingSheet.tsx` |
| 订单后追问、反馈（会写进 reviews 表） | `routes/followup.ts`、`repo.ts` 的 `insertAiCollectedReview` | `FeedbackQuestion.tsx` |
| 行为事件、指标 | `routes/funnel.ts`、`routes/metrics.ts`、`repo.ts` 的 `getMetricsSummary` | `MetricsDebugPage.tsx` |
| 页面切换（对话/筛选）、登录状态 | — | `App.tsx` |
| 前端 API 调用 | — | `api/client.ts` |

后端路径相对 `backend/src/`，前端路径相对 `frontend/src/`（组件在 `components/`）。

## 项目结构

```
出发喽/
├── CLAUDE.md                 本文件
├── 进度与下一步.md            进度、决策、待办
├── 出发喽_PRD.md              产品定位与分析
├── backend/                  Express + SQLite（TypeScript）
│   ├── src/index.ts          入口，挂载 /api/* 路由
│   ├── src/routes/           接口：chat hotels auth orders followup funnel metrics
│   ├── src/services/         业务逻辑：ai chatEngine retrieval pricing images
│   ├── src/db/               schema.sql（6 张表）、client、repo（所有 SQL）、seed
│   ├── src/lib/textMatch.ts  关键词匹配
│   ├── src/types.ts          共享类型
│   └── data/chufalou.sqlite  本地数据库
├── frontend/                 React + Vite
│   └── src/{App.tsx, components/, api/, lib/highlight.tsx, styles/tokens.css, types.ts}
├── data/                     原始评论数据（csv/json、apify-data），由 seed 导入
├── 作品集/                    作品集截图
├── 视觉效果/                  配色等视觉稿
└── output/ tmp/              导出的 PDF 等产物
```

数据库表：`hotels`、`reviews`、`users`、`orders`、`order_feedback`、`booking_funnel_events`。

## 协作约定

- 找代码先查上面的对照表，不要全仓扫描
- 做完一步就更新 `进度与下一步.md`；新增功能或移动文件时同步更新本文件的对照表
