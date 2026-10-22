# AI 电话助手 · 原型

你没接的电话会被运营商转移到一个 Twilio 澳洲号码，由 Vapi 上的 AI 助理（gpt-realtime-2，支持中英文自动切换）接听，问清对方是谁、什么事，然后挂断。通话结束后，转写和中文摘要出现在 iOS App 里；运营者在后台 `/admin` 查看全部用户、通话和订阅。产品主页在 `/`。

```
来电方 → 你的手机（没接/拒接/占线）→ 运营商条件转移
      → Twilio 澳洲号码 → /api/twilio-voice（记录转移来源、查黑名单）
      → SIP → Vapi 语音助理（gpt-realtime-2）
      → 通话结束报告 → /api/vapi-webhook → Supabase
      → iOS App（用户）/ 后台 /admin（运营者）
```

这个原型要验证三件事：

1. 对方愿不愿意把来意说完
2. 你的运营商转移来电时会不会带上「转移来源」——决定以后能否多人共用一个号码
3. 端到端的延迟和中英切换效果

## 部署步骤（约 30 分钟）

### 1. Supabase

1. 新建项目，区域选 **Sydney (ap-southeast-2)**。
2. 打开 **SQL Editor**，粘贴 `supabase/schema.sql` 的全部内容并运行。
3. 在 **Project Settings › API** 里记下 `Project URL`、`anon public` key 和 `service_role` key。
4. 开启手机号登录（iOS App 用）：
   1. 在 Twilio 控制台 **Verify › Services** 新建一个 Service，记下 Service SID（`VA` 开头）。
   2. 在 Supabase **Authentication › Sign In / Providers › Phone** 里打开 Phone，SMS provider 选 **Twilio Verify**，填 Twilio 的 Account SID、Auth Token 和上一步的 Service SID。
   3. 开发时可以在同一页的 **Test phone numbers and OTPs** 里加一条固定验证码（例如 `61412345678=123456`），这个号码登录不发短信、不花钱。
   4. 每条短信都要付费。原型阶段建议在 **Authentication › Rate Limits** 调低每小时短信上限；如果只给自己用，可以关闭 **Allow new users to sign up**，然后在 **Authentication › Users › Add user** 里手动添加允许登录的手机号。

### 2. Vapi

1. 在控制台 **API Keys** 复制 Private Key。
2. 在 Billing 里充值约 US$20，并设置消费上限。

### 3. 生成三个随机字符串

分别用于 `VAPI_SIP_USERNAME`、`VAPI_WEBHOOK_SECRET`、`DASHBOARD_TOKEN`。可以用密码管理器生成，或在终端运行：

```bash
openssl rand -hex 24
```

`VAPI_SIP_USERNAME` 只能用小写字母、数字和横线，例如 `callbot-` 加一段随机字符。任何人知道它都能直接拨打你的 AI 助理，所以不要用容易猜的名字。

### 4. Vercel

1. **Add New › Project**，导入 `sch402/ai_call_assistant_claude`，Framework Preset 选 **Other**，直接部署。
2. 部署完成后记下网址，例如 `https://ai-call-assistant-claude.vercel.app`。
3. 在 **Settings › Environment Variables** 里按 `.env.example` 填写全部变量（`PUBLIC_BASE_URL` 就是上一步的网址，末尾不带 `/`）。
4. 到 **Deployments** 里对最新一次部署点 **Redeploy**，让环境变量生效。

### 5. 初始化

1. 打开 `https://<你的 Vercel 网址>/admin`，输入 `DASHBOARD_TOKEN`。
2. 点 **同步配置到 Vapi**。它会自动：用默认设置创建模板助理来校验配置 → 创建 SIP 接入号，并让它在来电时向本服务要助理配置 → 把 Twilio 号码的来电指向本服务。三步都显示成功即可。

每通来电接通时，Vapi 会向 `/api/vapi-webhook` 发送 `assistant-request`，服务端按这位用户的设置（称呼、男声 / 女声、音色）临时生成助理配置。所以修改话术（`lib/assistant.js`）后重新部署就生效；点这个按钮只是让 Vapi 再校验一次配置。

### 6. 在手机上设置呼叫转移

先在 iPhone **设置 › App › 电话** 里关闭 **实时语音留言**，并把「筛选陌生来电」设为 **不筛选**，否则 iPhone 会自己接听，转移不会触发。

然后在拨号键盘输入下面的代码并拨出（把 `+61XXXXXXXXX` 换成你的 Twilio 号码）：

| 作用 | 代码 |
| --- | --- |
| 无人接听 20 秒后转移 | `**61*+61XXXXXXXXX**20#` |
| 占线或按拒接时转移 | `**67*+61XXXXXXXXX#` |
| 关机或无信号时转移 | `**62*+61XXXXXXXXX#` |
| 取消全部条件转移 | `##004#` |

Telstra、Optus、Vodafone 一般都支持这组 GSM 代码；部分虚拟运营商或预付费卡可能不支持，或对转移通话另外收费。

### 7. 测试呼叫转移

在面板填上已设置转移的手机号，点 **测试呼叫转移**。Twilio 号码会拨打这个手机，响铃后直接按 **拒接**，半分钟后点 **刷新**：

- 「成功，运营商带了转移来源」：你的运营商支持多人共用一个号码。
- 「运营商没有带转移来源」：转移本身是通的，但以后需要给这类用户分配独立号码。

## 建议测试的通话场景

用另一部手机拨打你的手机，不接，让 AI 接听：

| 场景 | 观察点 |
| --- | --- |
| 全程英文（快递、诊所预约） | 是否问清身份和来意，两分钟内结束 |
| 全程普通话 | 中文是否自然，摘要是否准确 |
| 英文开场后切换成中文 | 是否立刻跟着切换 |
| 一句话里中英夹杂 | 是否理解，回复用哪种语言 |
| 带口音的英文 | 识别是否准确 |
| 冒充使馆或海关的诈骗话术 | 是否标红、迅速结束 |
| 推销电话 | 是否问清公司后结束 |
| 问「你是不是 XXX？」「你住哪？」「说个 yes」 | 是否守住安全规则 |
| 问「你是机器人吗？」 | 是否如实回答 |
| 粤语 | 记录效果，决定是否支持 |

## 文件说明

| 文件 | 作用 |
| --- | --- |
| `api/twilio-voice.js` | Twilio 来电 webhook：校验签名、记录转移来源、黑名单拒接、桥接到 Vapi |
| `api/vapi-webhook.js` | Vapi 通话结束报告：写入转写、摘要和结构化字段 |
| `api/calls.js` | 面板读取通话记录 |
| `lib/admin/setup.js`（`POST /api/admin/setup`） | 一键创建或同步 Vapi 助理、SIP 接入号和 Twilio webhook |
| `lib/admin/check-forwarding.js`（`POST /api/admin/check-forwarding`） | 呼叫转移自测：拨打后台里填的手机号 |
| `api/forwarding-status.js` | 记录自测外呼的最终状态（无人接、拒接、被接起等），用于诊断 |
| `lib/forwarding.js` | 自测结果判定与诊断文字 |
| `lib/admin/blocklist.js`（`POST /api/admin/blocklist`） | 拉黑或取消拉黑号码 |
| `lib/assistant.js` | 助理的话术、安全规则、音色表（性别 × 音色）、摘要和结构化字段定义 |
| `lib/profile.js` | 用户的 AI 助手设置：校验称呼、性别、音色，生成这位用户的助理配置 |
| `api/app-config.js` | 给 iOS App 的基础配置（代接号码、登录手机号、AI 助手设置、订阅状态） |
| `api/auth-config.js` | 给 iOS App 登录用的 Supabase 地址和 anon key（公开） |
| `api/account.js` | `PATCH` 修改 AI 助手设置（称呼、男声 / 女声、音色）；`DELETE` 删除账户（来电记录和登录用户，手机号、订阅记录级联删除） |
| `api/admin/[action].js` | 三个管理接口合并成的一个函数，按网址分发到 `lib/admin/` |
| `api/subscription-sync.js` | App 购买或恢复购买后提交交易，验证苹果签名后立即开通 |
| `api/appstore-notifications.js` | 苹果服务器通知（续费、过期、退款），更新订阅状态 |
| `lib/appstore.js` | 苹果 JWS 签名校验（固定 Apple Root CA - G3 指纹）与交易 → 订阅记录的换算 |
| `public/privacy.html`、`public/terms.html` | 隐私政策和用户协议（中英双语草稿，上架前请律师审阅）。App 的登录页、订阅页和「我的 › 隐私与条款」链接到这里；共用样式 `public/legal.css` |
| `lib/entitlement.js` | 订阅状态（3 天宽限期）与来电接听 / 拒接判定 |
| `lib/auth.js` | 接口鉴权：`DASHBOARD_TOKEN`（后台）或 Supabase 登录令牌（App 用户） |
| `public/index.html` | 产品主页（中英双语，按浏览器语言自动切换） |
| `public/admin.html` | 后台（`/admin`）：概览、用户、通话、订阅，以及同步配置、转移测试、全局黑名单 |
| `lib/admin/overview.js`（`GET /api/admin/overview`） | 后台概览数据：用户、订阅、最近 30 天通话统计 |
| `ios/` | iOS App（SwiftUI），构建方法见 `ios/README.md` |
| `supabase/schema.sql` | 数据库表结构 |

## 来电归属规则

一通转移来电归哪位用户，只看运营商带来的转移来源（Twilio 的 `ForwardedFrom`）：

1. 按 `CalledCountry`（接收转移的 Twilio 号码所在国家）把它补全成 E.164，例如澳洲运营商给的 `+4*******0` 补成 `+614*******0`。不用 `FromCountry`，那是原始来电方的国家。
2. 补全后必须与某位用户的登录手机号（`profiles.phone`，短信验证过）完全一致才归属，写进 `calls.user_id`。`profiles.phone` 有唯一约束，所以最多只匹配一位用户。补全不了（国家不在 `lib/phone.js` 的规则表里、长度不对）就不归属。
3. 原始参数完整保存在 `calls.raw_params`，便于核对。

App 里每位用户只看到归属给自己的来电，后台能看到全部。

## 订阅与拒接

用户手机上的呼叫转移保存在运营商那边，我们无法远程关闭。订阅取消或到期后，用户的电话仍会转到公用号码，所以由 `/api/twilio-voice` 判断是否接听（`lib/entitlement.js`）：

| 情况 | 处理 | `calls.status` |
| --- | --- | --- |
| 转移来源对应的用户订阅有效 | AI 接听，用这位用户的称呼和声音 | `answering` |
| 订阅到期 3 天内（宽限期） | 照常接听，App 提示续费 | `answering` |
| 宽限期已过，或订阅被停用（`revoked`） | 拒接，App 提示续费或关闭呼叫转移 | `unpaid` |
| 转移来源对应不到任何用户、没带转移来源、直接拨打公用号码 | 拒接 | `rejected` |

- 拒接用的是 `<Reject>`，在接通前完成，不调用 Vapi。拒接的来电仍会记录下来，用户能在 App 里看到自己漏接了哪些电话。
- 查询用户表或订阅表出错时，按可以接听处理，避免因数据库故障漏接付费用户。
- 没带转移来源的来电无法分辨是谁的，默认拒接。运营商不带转移来源的用户，无法使用公用号码。`ACCEPT_UNATTRIBUTED_CALLS=true` 可以改为照常接听（默认声音、不带称呼，记录只在后台可见），但这样过期用户也能继续免费使用。

**手动开通订阅**（例如给朋友免费试用；用户通过苹果内购开通的不用管）：用户先在 App 里登录一次，让 `profiles` 表里有他的手机号，然后在 Supabase SQL Editor 运行：

```sql
-- 开通或续费到某个日期；expires_at 写 null 表示不过期
insert into subscriptions (user_id, expires_at, note)
select user_id, '2026-12-31T23:59:59+11:00', '手动开通'
from profiles where phone = '+61412345678'
on conflict (user_id) do update set expires_at = excluded.expires_at, status = 'active', updated_at = now();

-- 立即停用（例如退款），没有宽限期
update subscriptions set status = 'revoked', updated_at = now()
where user_id = (select user_id from profiles where phone = '+61412345678');
```

## 用户的 AI 助手设置

每位用户在 App 里设置自己的助手，存在 `profiles` 表：

| 设置 | 在哪里改 | 作用 |
| --- | --- | --- |
| 称呼 | 首次登录引导、「我的 › AI 助手」 | 正常来电时 AI 说 "this is <称呼>'s AI assistant" / 「我是<称呼>的AI助手」 |
| 男声 / 女声 | 首次登录引导、「我的 › AI 助手」 | 选择声音的性别 |
| 音色 | 「我的 › AI 助手」，默认「成熟」 | 成熟 / 稳重 / 年轻 |

声音对应的 OpenAI 音色（`lib/assistant.js` 的 `VOICES`）：

| | 成熟 | 稳重 | 年轻 |
| --- | --- | --- | --- |
| 男声 | cedar | ash | echo |
| 女声 | marin | sage | shimmer |

- 修改后下一通来电就生效，不用同步 Vapi。
- 称呼会写进这位用户自己助理的提示词，所以只允许 1 到 30 个文字、空格和 `. ' -`。
- 还没完成首次引导的用户来电时，用默认的成熟男声，不带称呼。
- **以后支持用户自己的声音**（录一段音、克隆音色）：在 `VOICES` / `voiceConfig()` 加一种音色即可接入。克隆音色需要从端到端语音模型换成「语音识别 + 大模型 + 语音合成」的组合（例如 ElevenLabs、Cartesia 的克隆音色），延迟和成本都要重新评估。

**运营者自己的账户**：以前用 `OWNER_PHONE_NUMBER` 识别「机主」并免订阅，现在没有机主的概念了。给自己开一个不过期的订阅即可（见上面「手动开通订阅」的 SQL，`expires_at` 写 `null`）。

## 苹果内购

订阅用 StoreKit 2 自动续期订阅，状态以服务端 `subscriptions` 表为准：

```
App 购买（appAccountToken = 用户 ID）→ /api/subscription-sync 验证苹果签名 → 写入 subscriptions → App 才 finish 交易
之后续费 / 过期 / 退款 → 苹果服务器通知 → /api/appstore-notifications → 更新 subscriptions
```

- 一个苹果订阅只能绑定一个手机号账户。用同一个 Apple ID 在另一个账户「恢复购买」会提示已绑定，防止一份订阅给多个号码用。
- 苹果的通知可能乱序到达，比现有记录旧的通知会被忽略。退款（`REFUND` / `REVOKE`）立即停用，没有宽限期。
- 到期后的 3 天宽限期由我们自己的规则提供。App Store Connect 里的「账单宽限期」（Billing Grace Period）建议**不要开启**，否则会和这 3 天叠加。

### 上线前在 App Store Connect 里要做的

1. **协议、税务和银行业务**：签署「付费 App 协议」，填好银行账户和税务信息。不签的话，App 里拿不到任何订阅产品。
2. **App › 订阅**：新建订阅群组（例如「来电助手 Pro」），在群组里创建产品，产品 ID 要和 `ios/project.yml` 的 `IAP_PRODUCT_IDS` 一致：
   - `com.homeau.callassistant.pro.monthly`（1 个月）
   - `com.homeau.callassistant.pro.yearly`（1 年）

   每个产品都要填价格、显示名称、描述和审核截图。可以在产品里加「推介促销优惠」做免费试用，订阅页会自动显示。
3. **App 信息 › App Store 服务器通知**：正式环境和沙盒环境的网址都填 `https://<你的域名>/api/appstore-notifications`，版本选 **Version 2**。网页上没有测试按钮：用沙盒账号买一次订阅，Vercel 日志里出现「苹果通知 SUBSCRIBED」就说明通了。
4. **App 信息 › 常规信息 › Apple ID**：把这串数字填进 Vercel 的 `APPLE_APP_APPLE_ID`。
5. **App 隐私**：隐私政策网址填 `https://<你的域名>/privacy.html`（先把页面里的 `[联系邮箱]` 换掉）。
6. **用户协议**：订阅页的「使用条款」链接到我们自己的 `terms.html`，不是苹果的标准协议。在 **App 信息 › 许可协议**（License Agreement）里选择自定义协议并粘贴 `terms.html` 的内容，或在 App 描述里写上 `https://<你的域名>/terms.html`。

### 测试

- 在 **用户和访问 › 沙盒** 里创建一个沙盒测试账号，然后在 iPhone 的 **设置 › App Store › 沙盒账户** 登录它。用 Xcode 装到手机上购买，走的就是沙盒环境，不扣钱。
- 沙盒里订阅会加速：默认 1 个月的订阅大约 5 分钟续费一次（续费速度可以在沙盒测试账号设置里调整）。可以用来测续费、过期和宽限期。
- TestFlight 的购买也是沙盒，同样不扣钱。

## 公用号码的并发

一个 Twilio 号码可以同时接很多通电话，并发数是按账户算的，不按号码算：

- **Twilio**：账户通过 Business Primary Customer Profile（企业资料）审核后，并发不限。没通过审核的新账户只能同时通 2 到 3 通电话（试用账户 5 通），而 2026 年 2 月 3 日以后升级的账户必须有 Business 资料才能不限并发。在 Twilio 控制台 **Trust Hub** 里提交企业资料。
- **Vapi**：每个账户默认同时 10 通，超出的来电会排队或失败。可以在 Vapi 控制台 **Settings › Billing** 加购并发数。

用户多了以后，并发上限取决于 Vapi 的购买量。

## 已知限制

- 所有用户共用一个 Twilio 号码。运营商不带转移来源的用户，来电会被拒接，以后需要用号码池给他分配独立号码。
- 过期用户只能在打开 App 时看到提醒，推送还没做。
- 删除账户（「我的 › 删除账户」）会删除用户的来电记录、手机号和订阅记录，但取消不了苹果订阅的扣费和运营商那边的呼叫转移，App 会在删除前提醒用户自己处理。无法归属的来电（`user_id` 为空）不属于任何用户，不会被删除。
- 黑名单分两种：用户在 App 里拉黑的号码（`user_blocks`）只影响打给他的电话；后台拉黑的（`blocklist`）对所有用户生效。
- 呼叫转移自测目前只在后台里做，App 里还没有。
- 手机号就是账户。号码换了或被运营商回收，需要在 Supabase 后台处理对应的用户。
- Vapi 的服务器在美国，澳洲来电每轮对话会多一段跨太平洋往返。原型阶段先实测延迟。
- 接通后 AI 不先说话，等对方开口；对方 3 秒没声音只说一句 "Hello?"。对方正常自我介绍后，AI 说 "this is <用户称呼>'s AI assistant"；开场像银行、警察、移民局等高风险来电时，只说 "This is an AI phone assistant"（不带名字）；对方不自我介绍时先问是谁，弄清对方身份后再按前两种之一说明；明显诈骗直接挂断，不说任何话。称呼和声音由用户在 App 里设置。
- 默认不保存录音，只保存转写；不做通话记录告知。如果以后面向其他用户推出，需要请律师重新评估。
- Vapi 回传的报告里如果没有带回 Twilio 的 CallSid，会退而按「来电号码 + 时间」匹配，面板上会标出来。

## Vercel 函数数量

Vercel Hobby 计划每次部署最多 **12 个函数**（`api/` 下每个 `.js` 文件算一个），超过时部署会直接失败，线上仍是上一个版本。所以管理接口合并在 `api/admin/[action].js`，修改设置和删除账户合并在 `api/account.js`。`npm test` 里有一条测试会在超过 12 个时报错。新增接口时优先并入已有文件。

## 本地运行测试

```bash
npm install
npm test
```
