# 出发喽 — 全栈实现

对应 `出发喽_PRD.md`的可运行全栈代码：React（Vite）前端 + Node/Express + SQLite 后端，AI 对话与推荐理由由 OpenAI API 驱动。这份 README 和 PRD 一样，只反映"现在长什么样"的最新状态，不记录逐条历史变更。

## 目录结构

```
backend/    Express + SQLite + OpenAI API（RAG式推荐理由生成）
frontend/   React + Vite，手机优先的响应式Web App（不是写死的静态HTML，可持续迭代/部署）
```

## 快速开始

### 1. 后端

```bash
cd backend
npm install
cp .env.example .env   # 编辑 .env，填入 OPENAI_API_KEY
npm run seed           # 导入4家真实酒店+662条真实评论 + demo账号数据（SQLite文件在 backend/data/）
npm run dev            # http://localhost:8787
```

> 如果是在`schema.sql`改动之后重新`npm run seed`，`CREATE TABLE IF NOT EXISTS`不会给已存在的旧表补新字段——需要先删掉`backend/data/chufalou.sqlite`（连同同目录下的`-shm`/`-wal`文件，如果有的话）再重新seed，否则会报"no such column"。

Demo 账号：手机号 `13800000000`，验证码固定为 `123456`（模拟短信，未接入真实网关）。这个账号在seed时会带一条"已完成但未评价"的订单，用来触发AI主动追问反馈闭环（PRD §6.3）。登录框里也有"使用demo账号快速体验"按钮，一键填好手机号+验证码。

### 2. 前端

```bash
cd frontend
npm install
npm run dev             # http://localhost:5173，会把 /api 代理到后端 8787
```

浏览器打开 http://localhost:5173 即可，打开就直接进聊天界面，不要求登录。第一次用某个手机号登录（点确认预订才会触发）时会顺带问一次"怎么称呼你"，之后同一手机号登录都会直接沿用这个名字。手机浏览器打开局域网地址（`npm run dev -- --host`）也能看到同一套响应式界面。

## 技术选型

- **前端**：Web应用（React + Vite），不是一次性画布/静态HTML，方便持续修改、随时 `npm run build` 部署。
- **AI**：真实 OpenAI API（`openai` 官方SDK，模型 `gpt-5-mini`，可在 `backend/src/services/ai.ts` 顶部一行改成别的型号），而不是规则模拟——`services/ai.ts` 负责三件事：①从对话中抽取结构化信息（目的地/日期/预算/偏好），②在真实评论里检索匹配片段（RAG的"R"，`services/retrieval.ts`），③只依据检索到的片段和后端算出的真实匹配比例生成推荐理由，不允许模型编造评论中不存在的数字或事实（PRD §6.2）。
- **数据**：真实数据——一份Kaggle上的携程/Trip.com酒店评论数据集（`/data/` 目录，4家真实酒店、662条真实中文评论：澳门银河酒店、北京索菲特大酒店、纽约中城希尔顿、杭州洲至奢选华夏之心）。`backend/src/db/seed.ts` 负责导入，且**标签/设施全部是从真实字段算出来的，没有一条是手写编的**：干净/位置好/服务好/设施好来自每条评论真实的分项评分，商务出行/亲子友好/情侣推荐/独自旅行/朋友出游来自评论真实的"出行类型"字段，大床房来自真实房型名称关键词，早餐/停车/健身房/泳池来自评论正文关键词出现次数。只有 `base_price`（价格）和"景观房型/位置"这两个偏好标签分类目前较空是真实的局限——数据集本身没有价格/精确位置信息，见"已知限制"。想换/加更多酒店时，把新的 `reviews.json` / `hotel_summary.json` 放进 `/data/` 目录、按 `seed.ts` 里的字段映射调整几个hotelId常量表即可，不需要改路由或AI逻辑。
- **图片**：4家酒店里3家已经换成真实照片（`hotels.real_image_url` 字段，来自Wikimedia Commons、已核实是对应建筑本尊，见 `services/images.ts` 顶部注释）；剩下1家（杭州洲至奢选，2020年开业的IHG精选品牌小众酒店）在Commons上找不到免费授权的照片，仍用 `photo_query` 拼关键词请求LoremFlickr的主题占位图兜底，并用酒店ID算出固定参数"锁死"结果，保证同一家酒店每次看到的都是同一张图。

## 功能覆盖（对应PRD章节）

| PRD章节 | 实现位置 | 说明 |
|---|---|---|
| 6.1 AI对话式订酒店 | `ChatScreen.tsx` + `services/chatEngine.ts` + `routes/auth.ts` | 打开App直接进聊天，不要求登录，AI在没有称呼可用时用通用问候语；多轮追问、上下文槽位、示例快捷输入（真实覆盖城市——北京/澳门/杭州，固定展示在输入框上方的"快捷操作区"，不挂在聊天记录里）；目的地不在数据覆盖范围时AI会明说，不会假装匹配别的城市；称呼和手机号账号绑定——某个手机号第一次登录（`LoginModal.tsx`）时顺带问一次名字锁进`users.name`，以后同一手机号登录都直接沿用、不重新问（头像始终是干净的纯图标；已登录时点一下会浮现一个小的"退出登录"按钮，点它才真正退出，退出后直接回到登录弹层，同时`App.tsx`会换一个新的`sessionId`并让`ChatScreen`重新挂载，聊天记录和AI提取的上下文都清空，不会带到下一次登录里） |
| 6.2 评论驱动可解释推荐 | `services/retrieval.ts` + `services/ai.ts` 的 `generateRecommendationReasons` | 卡片可点击查看原始评论片段（`EvidenceModal.tsx`）；打开酒店详情页时评论会按和用户诉求的相关度优先排序，并展示"住客高频提到：X"的统计角标（`routes/hotels.ts` 的 `prefer` 参数 + `topReviewTopic`，都基于真实评论数据） |
| 6.3 AI主动追问反哺评论区 | `routes/followup.ts` + `components/FeedbackQuestion.tsx`（`ChatScreen.tsx`/`BookingSheet.tsx`共用）| 只剩"入住体验"这一问在聊天里问（`checkout <= 今天`才触发）——"满意度"已经挪到预订成功页立刻问，见`BookingSheet.tsx`。提问文字（"对了～你之前入住的『XX』，住下来之后感觉干净吗？"）和快捷选项/详细反馈是同一张卡片。选完快捷选项后可选文字/照片/语音详细反馈，提交前有一个默认勾选的"同意展示在评论区"复选框——不勾选的话反馈仍然写进`order_feedback`表，只是不会调用`insertAiCollectedReview`生成公开评论。点"先跳过"只结束这一次对话里的追问，订单**不会**标记为已问过，下次登录/新对话还会再问一次；跳过后的回复文案也改成了不带追问压力的"好的，不打扰你啦～"，不再说"下次再问你" |
| 第十章 指标落地 | `db/repo.ts` 的 `getMetricsSummary` + `routes/metrics.ts` + `routes/funnel.ts` + `MetricsDebugPage.tsx` | `orders.source`/`chat_turns_before_order`两个字段驱动"推荐采纳率""下单前对话轮次"；6.3的两问驱动"推荐满意度""反馈采集转化率"；`booking_funnel_events`表驱动"转化漏斗"（打开预订弹层→点确认→完成支付）；`/?debug=metrics`（不接入主导航）实时查看 |
| 6.4 手动筛选模式 | `FilterScreen.tsx` | 见下方"筛选字段详情" |
| 6.5 预订与支付闭环 | `BookingSheet.tsx` + `App.tsx` 的 `confirmAndPay` | 点击"确认预订并支付"才弹登录，登录后自动回到预订流程并保留已选信息；点一次即完成模拟支付、直接创建订单（没有单独的付款页/二次确认，试过带独立付款页的两步流程，实测容易让人漏点第二步，改回一步到位）；弹层顶部有一个不随内容滚动消失的返回按钮（AI推荐/手动筛选两个入口共用同一组件）；预订成功页会立刻附带一个满意度快问（AI推荐和手动筛选的订单都问，措辞分别是"这次AI帮你推荐的酒店，你满意吗？"/"这次预订的选择，你满意吗？"），带完整的详细反馈+展示同意选项，和`FollowupFlow`共用同一个`FeedbackQuestion`组件，不用等入住 |
| 第八章 数据假设 | `backend/src/db/seed.ts` + `services/pricing.ts` + `services/images.ts` | 真实酒店/评论数据（价格仍是模拟的，数据集本身没有价格信息）、按星级基准价+周末溢价+确定性抖动模拟动态价格、真实照片+占位图片兜底 |

### 筛选字段详情（`FilterScreen.tsx`）

- **目的地/价格区间（v0.15修正）**：目的地默认"不限"（展示全部4家真实覆盖城市），价格区间默认¥300–¥1800、滑块上限2000——之前默认目的地写死"三亚"（零覆盖）、滑块上限写死1200（低于澳门1280/纽约1680的基准价），导致默认打开是"查看0家酒店"、且澳门/纽约两家酒店无论怎么调滑块都进不了结果，v0.12换真实数据集时没人发现这个遗留问题。
- **星级**：5颗可点亮的星形图标，点亮第N颗＝"N星及以下"，默认不限星级。
- **设施**：早餐 / 停车 / 健身房（WiFi、空调、泳池都曾经在这个列表里，因为"每家酒店都有"或"和偏好标签概念重叠"先后被拿掉，见PRD v0.5-v0.11的变更记录）。
- **偏好标签**：分组规则（`FilterScreen.tsx` 的 `TAG_CATEGORIES`）是写死的三组——位置 / 景观房型 / 适合人群——但组内具体标签是从 `/api/hotels/tags` 动态拉取的真实数据，换成真实的4家酒店数据后，"位置"和"景观房型"这两组目前只有"大床房"等个别标签能对上号（数据集没有精确位置/景观信息），干净/位置好/服务好/设施好这几个真实评分衍生出的标签会自动落进"其他偏好"兜底分组；命中其中任意一个标签即算匹配（不要求同时满足全部勾选项）。
- **排序**：目前固定"价格从低到高"，和"查看X家酒店"按钮做成一体，居中显示在同一个按钮里，不是独立可选的下拉菜单。

## 已知限制 / 尚未做的事

- **没有配置 `OPENAI_API_KEY` 时**，`/api/chat` 会直接返回一句提示文案，其余功能（筛选、预订、AI追问反馈闭环）完全不受影响。
- `services/ai.ts` 里模型默认是 `gpt-5-mini`，追求更好的对话质量可以改成 `gpt-5`；成本敏感可以改 `gpt-5-nano`。配置好key之后建议自己先聊几轮，重点测一下PRD §9提到的"多轮修改条件""上下文保持"这两个验收重点。
- 点赞、页面内的"喜欢数"是纯前端展示效果，没有写回数据库。
- 支付是模拟的（PRD §8 允许），点击"确认预订并支付"必定成功，没有真实支付网关。
- 手机号验证码是固定值 `123456`，没有接入短信服务商。
- "怎么称呼你"这个名字现在和手机号账号绑定，存在后端`users.name`字段，不是本地localStorage；同一手机号换设备登录也会看到同一个名字，见PRD §6.1、§12。
- 排序方式目前只有"价格从低到高"一种，UI上没有切换入口。
- **只有4家真实酒店、每个城市各1家**，"双列瀑布流展示4家酒店"这个视觉设计目前会退化成单卡片；这4家又都是评分很高的优质酒店，标签会显得每家都很全面（一张卡片可能贴7-8个标签），不像"精选1-2个亮点"那么克制。想要更有区分度的效果，需要更多、更参差的真实酒店数据（比如自己爬虫补充）。
- **杭州洲至奢选酒店没有真实照片**（Wikimedia Commons上没有收录这家2020年开业的小众品牌酒店），仍用主题占位图；澳门银河酒店的照片是整个Galaxy Macau度假村外观，不保证是数据集里specifically指代的那一栋塔楼（该度假村内有7座不同品牌的酒店塔楼）。
- AI从对话里提取的偏好关键词是自由文本（比如可能提取出"商务酒店"这种没有在真实标签词表里的词），不一定和评论数据里真实存在的标签（如"商务出行"）精确匹配——这种情况下"评论优先排序"和"住客高频提到"这两个功能仍然正常工作（他们各自基于精确匹配的关键词和全量统计），只是那一条没有精确匹配的偏好词本身不会生效。
- 涉及的4家酒店的照片来自Wikimedia Commons（知识共享许可），如果这个项目要展示给课程以外的人看，请在页面上补充图片来源和许可信息。
- **指标样本量还很小**：`/?debug=metrics`能看到真实的采纳率/满意度数字，但目前只有4家酒店、订单量级小，这些数字现在只能验证"埋点和流程本身跑得通"，还谈不上统计显著性。
- **"推荐采纳率"测的是点确认，不是真实付费意愿**：点击"确认预订并支付"必定成功、零摩擦，这一段本身不会流失。`/?debug=metrics`的转化漏斗里"打开详情但没点确认"这一段能看到真实流失，是这条局限之外一个独立的信号——理解采纳率这个数字时仍要当心，见PRD §9。
- **语音反馈不进入检索/统计**：6.3新增的语音详细反馈只存音频、不做转写，不会被评论关键词检索或"住客高频提到"统计捕捉到，也没有接入内容审核（文字/照片/语音这三种可选详细反馈目前都没有审核机制，见PRD §9）。

## 部署

SQLite要写文件到磁盘，所以后端不能用Vercel/Netlify那种"函数即用即走、不留状态"的托管方式，得选一个能挂**持久磁盘**的Node托管（Render、Railway、Fly.io，或者自己的服务器/VPS都行，下面以Render举例，其他平台步骤类似）。

### 推荐方式：前后端合并成一个服务部署（最省事）

后端已经改造成"生产环境下顺便把前端也一起serve了"（见 `backend/src/index.ts` 的 `NODE_ENV === "production"` 分支），这样只需要部署**一个**服务、一个域名，不用管跨域、不用给前端配后端地址。

**本地先验证一遍构建流程**（强烈建议部署前跑一次）：

```bash
cd frontend && npm run build         # 产出 frontend/dist
cd ../backend && npm run build       # 编译TS + 自动把 schema.sql 和 frontend/dist 拷进 backend/dist/
NODE_ENV=production node dist/index.js   # 单进程跑起来，前端+API都在这一个端口上
```

打开 http://localhost:8787 应该能看到完整的App（不是8787端口报API错误、5173端口才有界面那种割裂状态）。

**部署到 Render**：

1. 把整个仓库推到GitHub（`backend/`、`frontend/`、`出发喽_PRD.md` 都在一个仓库里）。
2. Render控制台 → New → Web Service → 选这个仓库。
3. 关键配置：
   - **Root Directory**：留空（仓库根目录，因为build命令要同时碰 `frontend/` 和 `backend/`）
   - **Build Command**：`cd frontend && npm install && npm run build && cd ../backend && npm install && npm run build`
   - **Start Command**：`cd backend && npm start`
   - **Environment**：加 `OPENAI_API_KEY`（你的key）、`NODE_ENV=production`、`DB_PATH=/data/chufalou.sqlite`
4. **加一块持久磁盘**（Render叫Disk）：Mount Path 填 `/data`，大小1GB足够。这一步不做的话，每次重新部署SQLite数据都会被清空（demo账号、订单历史都没了）。
5. 部署完成后跑一次种子数据：Render控制台的Shell里执行 `cd backend && npm run seed`（只需要跑一次，后面重新部署不用再跑，除非你想清空重置）。

其他平台（Railway/Fly.io/自己的VPS）思路完全一样：装Node、跑上面那两条build命令、把 `DB_PATH` 指向一个会持久化的目录、设置 `OPENAI_API_KEY`、启动 `node backend/dist/index.js`。

### 备选方式：前后端分开部署

如果更想把前端放CDN型静态托管（Vercel/Netlify/Cloudflare Pages，访问速度更快），后端单独部署到能挂磁盘的服务上（Vercel本身不行——它的Serverless Function不留状态，SQLite文件每次调用后都不保留）：

1. **后端**（Render/Railway/Fly.io等）：和上面合并部署的配置一样，额外加一个环境变量 `ALLOWED_ORIGIN=https://your-frontend.vercel.app`（逗号分隔可填多个），把CORS限制到你的前端域名。不填则默认允许所有来源（`backend/src/index.ts`）。
2. **前端**（Vercel/Netlify/Cloudflare Pages）：Build Command `npm run build`，Output Directory `dist`；设置环境变量 `VITE_API_BASE_URL=https://your-backend.onrender.com`（指向后端完整域名，不要带结尾斜杠），否则前端会按同源相对路径 `/api/...` 请求，分开部署时会打到Vercel自己身上而不是后端（`frontend/src/api/client.ts`）。
