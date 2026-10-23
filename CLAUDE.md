# 出发喽

酒店**评论辅助浏览原型**：用户用自然语言说出需求 → 在样本酒店里筛出候选 → 找到相关评论并高亮 → 核对原文。**不是订房平台**，价格和订单都是模拟的。

**每次开工先读 [PROJECT_STATUS.md](PROJECT_STATUS.md) 的「下次从这里开始」。**

| 文件 | 回答什么 | 什么时候更新 |
|---|---|---|
| [PROJECT_STATUS.md](PROJECT_STATUS.md) | 现在做到哪了？ | 每次工作结束 |
| [ISSUE_TRACKER.md](ISSUE_TRACKER.md) | 还有哪些问题？优先级？ | 发现或解决问题时 |
| [DECISION_LOG.md](DECISION_LOG.md) | 为什么当时这么决定？ | 真正做出产品决策时 |
| [PRD.md](PRD.md) | 产品最终应该是什么？ | 决策确定后 |

## 目标与成功指标

- **目标**：帮用户更快找到和自己关心的点（安静、卫生、早餐……）相关的评论，并且不产生误判；同时做成可以放进作品集的项目
- **成功指标**（用户测试，还没做）：和普通评论列表相比，①找到有效证据的时间更短 ②结论错误率不上升 ③证据不足时能判断"无法判断"
- **不算成功的**：演示订单变多、AI 入口占比升高

## 关键限制

- 数据：11 家酒店、1,504 条评论（北京 8 家，杭州、澳门、纽约各 1 家）。原始数据 1,762 条（Kaggle 800 + Apify 962），保留中文和北京 7 家酒店的英文，筛掉 258 条：其他语言 164 条，以及北京以外酒店的英文 94 条；是历史数据，不是实时数据
- 产品里的检索用字面匹配（已排除按评分推导的标签；"干净"有中英文相关词表），不是语义检索，判断不了好评还是差评。模型判断目前只在评测脚本里用，还没接入产品（I-25）
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
| 从对话提取条件（城市/日期/预算/偏好/标准需求） | `services/ai.ts` 的 `extractSlots`（`needs` 是固定选项的标准需求，目前只有"干净"），缺字段时用 `askForMissingSlot` 追问；`chatEngine.ts` 的 `applyNeeds` 以 `needs` 为准，修正偏好列表 | — |
| 必填字段 | `chatEngine.ts` 的 `REQUIRED_FIELDS` | — |
| 候选打分、排序、放宽预算 | `chatEngine.ts` 的 `scoreHotel`、`matchHotels` | `HotelCard.tsx`、`HotelWaterfall.tsx` |
| 评论检索（给摘要用） | `services/retrieval.ts` 的 `retrieveEvidence` | — |
| 推荐理由、摘要生成 | `ai.ts` 的 `generateRecommendationReasons`、`introduceRecommendations` | — |
| 判断评论是否和需求相关（繁简统一、中英文相关说法、排除按评分推导的标签） | `lib/textMatch.ts` 的 `reviewMentions`、`NEED_TERMS`（中文）、`NEED_PATTERNS_EN`（英文，整词、不分大小写）、`RATING_DERIVED_TOPICS` | `lib/highlight.tsx`（前端高亮，两边逻辑要保持一致） |
| 导入评论数据 | `db/apifySource.ts`（北京 7 家的清单和评论处理规则，下面两个共用）、`db/seed.ts`（清空后全量重建，⚠️ 会清空数据库）、`backend/scripts/import-english-reviews.ts`（增量导入英文，默认只预览，`--apply` 才写入并先备份） | — |
| 软需求评测（第 1 级验证） | `backend/scripts/lib/cleanliness.ts`（"干净"的标注规则，人和模型共用）；`eval-level1.ts`（全部评论 + 每家酒店结论 + 详情页排序检查，`--model`、`--out`、`--reuse`）；`eval-gold.ts`（对照标准答案、比较模型）。结果在 `eval/level1/`，标准答案在 `eval/level1/gold/`；`eval-intent.ts`（需求识别测试，结果在 `eval/level1/需求识别/`） | — |
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
├── PROJECT_STATUS.md         当前进度、下次从哪开始
├── ISSUE_TRACKER.md          问题清单与优先级
├── DECISION_LOG.md           产品决策记录
├── PRD.md                    产品定位与分析
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
├── eval/level1/              第 1 级验证：v1～v3 各轮结果、gold/（标注规范、标准答案、模型对比）、评测过程记录.md
├── data/                     原始评论数据（csv/json、apify-data），由 seed 导入
├── 作品集/                    作品集截图
├── 视觉效果/                  配色等视觉稿
└── output/ tmp/              导出的 PDF 等产物
```

数据库表：`hotels`、`reviews`、`users`、`orders`、`order_feedback`、`booking_funnel_events`。

## 协作约定

- 找代码先查上面的对照表，不要全仓扫描
- 工作结束时更新 PROJECT_STATUS.md；发现或解决问题时更新 ISSUE_TRACKER.md（用 I-xx 编号）；做出产品决策时追加到 DECISION_LOG.md（用 D-xx 编号），再同步 PRD
- 新增功能或移动文件时，同步更新本文件的对照表
- 往项目文档（STATUS、ISSUE_TRACKER、DECISION_LOG、PRD、CLAUDE.md、eval/ 下的文档）里加任何内容之前，先把要改的文件、位置和具体内容给用户确认，确认后再写入
