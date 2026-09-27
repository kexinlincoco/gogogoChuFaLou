# 出发喽 — 酒店评论辅助浏览原型

React + Vite 前端、Node/Express + SQLite 后端。当前实现自然语言条件提取、有限样本筛选、评论检索与摘要、原文查看和关键词高亮，以及演示订单和反馈采集。

**不是已验证的酒店推荐系统，也不能真实预订酒店。** 价格由规则模拟，订单只写入本地数据库，不扣款、不锁房、不构成入住凭证。完整产品定位、能力边界与价值分析见 [出发喽_PRD.md](出发喽_PRD.md)。

## 核实的数据范围

本次核验：11 家酒店、1,382 条导入评论，北京 8 家，杭州、澳门、纽约各 1 家。源文件按 seed 的中文和文本长度条件筛选后为 662 + 720 条，与当前本地数据库一致。演示反馈可能增加运行后的评论数量。

评论来自仓库存放的历史数据，不是完整实时酒店资料；没有逐条验证真实入住。设施和标签多为评论字段或关键词推导，部分星级为人工设定，不能当作当前官方承诺。图片含外链与占位兜底。

## 快速开始

后端：

```bash
cd backend
npm install
cp .env.example .env
# 编辑 .env，配置 OPENAI_API_KEY
npm run seed
npm run dev
```

注意：`npm run seed` 会清空并重建现有用户、酒店、评论、订单和反馈等演示数据。已有数据需要保留时先备份，不要例行重跑 seed。数据库默认位于 `backend/data/chufalou.sqlite`。旧数据库的表结构不会因为 CREATE TABLE IF NOT EXISTS 自动迁移。

前端另开终端：

```bash
cd frontend
npm install
npm run dev
```

访问 `http://localhost:5173`，开发代理连接后端 `8787` 端口。演示手机号 `13800000000`，固定验证码 `123456`；没有接入短信服务。对话依赖模型配置和网络服务；筛选与演示订单不依赖模型调用。

## 已实现功能与代码入口

| 功能 | 实现 | 说明 |
|---|---|---|
| 多轮条件提取 | `backend/src/services/ai.ts`、`chatEngine.ts` | 按当前会话提取条件，不是长期偏好学习 |
| 有限候选排序 | `chatEngine.ts` | 标签及预算距离规则；预算可能放宽，不保证所有约束满足 |
| 评论检索及摘要 | `retrieval.ts`、`ai.ts` | 字面/标签匹配，最多 4 条片段；无证据时说明无法判断 |
| 评论原文及高亮 | `EvidenceModal.tsx`、`BookingSheet.tsx` | 详情当前只展示前 4 条；提及某词不代表正面认可 |
| 手动筛选 | `FilterScreen.tsx`、`routes/hotels.ts` | 模拟价格及推导标签，不查询实时库存 |
| 演示登录与订单 | `routes/auth.ts`、`routes/orders.ts` | 固定验证码，本地订单；无真实支付和供应商确认 |
| 反馈采集 | `routes/followup.ts`、`FeedbackQuestion.tsx` | 快捷回答和可选附件；没有入住核验、内容审核或语音转写 |
| 演示统计 | `db/repo.ts`、`MetricsDebugPage.tsx` | `/?debug=metrics`；入口占比、轮次、反馈分布、事件次数 |

## 重要限制

- 规则候选排序不等于可靠推荐，尤其单样本城市无法验证择优能力。
- 对话目前仍要求城市、日期、预算等字段，纯查评论场景的交互还需简化。
- 字面匹配不可靠识别同义词和否定，摘要与高亮也没有通过系统性效果评测。
- 页面标明模拟价格与演示订单；内部 API 仍保留 recommend、payment 等历史名称。
- 工具满意度及演示入住反馈在用户同意展示后，仍可能写入评论语料；尚未隔离，应优先修正，不能视作可信评论增长闭环。
- 点赞仅为前端状态，没有持久化。
- 指标受种子数据、重复事件、成功会话筛选和演示操作影响，不能证明推荐采纳、付费意愿或商业转化。
- 没有实时房型、库存、真实价格、退款退改、履约售后或生产级身份核验。

## 构建与检查

分别在前后端目录执行 `npm run typecheck`。先构建前端，再构建后端：

```bash
cd frontend
npm run build
cd ../backend
npm run build
NODE_ENV=production node dist/index.js
```

后端构建会复制前端产物并在生产模式提供页面。SQLite 需要可持久保存的磁盘；可用 `DB_PATH` 指定路径。分开部署时，前端通过 `VITE_API_BASE_URL` 指向后端，后端通过 `ALLOWED_ORIGIN` 指定来源。部署不意味着已具备公开交易平台的能力。
