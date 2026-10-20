# AI 电话助手 · 原型

你没接的电话会被运营商转移到一个 Twilio 澳洲号码，由 Vapi 上的 AI 助理（gpt-realtime-2，支持中英文自动切换）接听，问清对方是谁、什么事，然后挂断。通话结束后，转写和中文摘要会出现在网页面板上。

```
来电方 → 你的手机（没接/拒接/占线）→ 运营商条件转移
      → Twilio 澳洲号码 → /api/twilio-voice（记录转移来源、查黑名单）
      → SIP → Vapi 语音助理（gpt-realtime-2）
      → 通话结束报告 → /api/vapi-webhook → Supabase
      → 网页面板 /
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

1. 打开你的 Vercel 网址，输入 `DASHBOARD_TOKEN`。
2. 点 **同步配置到 Vapi**。它会自动：在 Vapi 创建助理 → 创建 SIP 接入号 → 把 Twilio 号码的来电指向本服务。三步都显示成功即可。

以后修改话术（`lib/assistant.js`）并重新部署后，再点一次这个按钮即可同步。

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

在面板点 **测试呼叫转移**。Twilio 号码会拨打你的手机，响铃后直接按 **拒接**，半分钟后点 **刷新**：

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
| `api/admin/setup.js` | 一键创建或同步 Vapi 助理、SIP 接入号和 Twilio webhook |
| `api/admin/check-forwarding.js` | 呼叫转移自测：拨打机主手机 |
| `api/forwarding-status.js` | 记录自测外呼的最终状态（无人接、拒接、被接起等），用于诊断 |
| `lib/forwarding.js` | 自测结果判定与诊断文字 |
| `api/admin/blocklist.js` | 拉黑或取消拉黑号码 |
| `lib/assistant.js` | 助理的话术、安全规则、音色、摘要和结构化字段定义 |
| `api/app-config.js` | 给 iOS App 的基础配置（代接号码、机主名字、登录手机号） |
| `api/auth-config.js` | 给 iOS App 登录用的 Supabase 地址和 anon key（公开） |
| `lib/entitlement.js` | 订阅状态（3 天宽限期）与来电接听 / 拒接判定 |
| `lib/auth.js` | 接口鉴权：`DASHBOARD_TOKEN`（网页面板）或 Supabase 登录令牌（App 用户） |
| `public/index.html` | 网页面板 |
| `ios/` | iOS App（SwiftUI），构建方法见 `ios/README.md` |
| `supabase/schema.sql` | 数据库表结构 |

## 来电归属规则

一通转移来电归哪位用户，只看运营商带来的转移来源（Twilio 的 `ForwardedFrom`）：

1. 按 `CalledCountry`（接收转移的 Twilio 号码所在国家）把它补全成 E.164，例如澳洲运营商给的 `+478558140` 补成 `+61478558140`。不用 `FromCountry`，那是原始来电方的国家。
2. 补全后必须与某位用户的登录手机号（`profiles.phone`，短信验证过）完全一致才归属，写进 `calls.user_id`。`profiles.phone` 有唯一约束，所以最多只匹配一位用户。补全不了（国家不在 `lib/phone.js` 的规则表里、长度不对）就不归属。
3. 机主（`OWNER_PHONE_NUMBER`）还没在 App 登录过时，仍按这个号码判断 `attributed`。
4. 原始参数完整保存在 `calls.raw_params`，便于核对。

App 里每位用户只看到归属给自己的来电，网页面板能看到全部。

## 订阅与拒接

用户手机上的呼叫转移保存在运营商那边，我们无法远程关闭。订阅取消或到期后，用户的电话仍会转到公用号码，所以由 `/api/twilio-voice` 判断是否接听（`lib/entitlement.js`）：

| 情况 | 处理 | `calls.status` |
| --- | --- | --- |
| 转移来源对应的用户订阅有效，或是机主 | AI 接听 | `answering` |
| 订阅到期 3 天内（宽限期） | 照常接听，App 提示续费 | `answering` |
| 宽限期已过，或订阅被停用（`revoked`） | 拒接，App 提示续费或关闭呼叫转移 | `unpaid` |
| 转移来源对应不到任何用户、没带转移来源、直接拨打公用号码 | 拒接 | `rejected` |

- 拒接用的是 `<Reject>`，在接通前完成，不调用 Vapi。拒接的来电仍会记录下来，用户能在 App 里看到自己漏接了哪些电话。
- 查询用户表或订阅表出错时，按可以接听处理，避免因数据库故障漏接付费用户。
- 没带转移来源的来电无法分辨是谁的，默认拒接。运营商不带转移来源的用户，无法使用公用号码。`ACCEPT_UNATTRIBUTED_CALLS=true` 可以恢复旧原型「全部接听、算机主的」的行为，但这样过期用户也能继续免费使用。

**手动开通订阅**（接入苹果内购之前）：用户先在 App 里登录一次，让 `profiles` 表里有他的手机号，然后在 Supabase SQL Editor 运行：

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

## 公用号码的并发

一个 Twilio 号码可以同时接很多通电话，并发数是按账户算的，不按号码算：

- **Twilio**：账户通过 Business Primary Customer Profile（企业资料）审核后，并发不限。没通过审核的新账户只能同时通 2 到 3 通电话（试用账户 5 通），而 2026 年 2 月 3 日以后升级的账户必须有 Business 资料才能不限并发。在 Twilio 控制台 **Trust Hub** 里提交企业资料。
- **Vapi**：每个账户默认同时 10 通，超出的来电会排队或失败。可以在 Vapi 控制台 **Settings › Billing** 加购并发数。

用户多了以后，并发上限取决于 Vapi 的购买量。

## 已知限制

- 所有用户共用一个 Twilio 号码。运营商不带转移来源的用户，来电会被拒接，以后需要用号码池给他分配独立号码。
- 订阅暂时在数据库里手动维护，苹果内购（StoreKit 2 + App Store Server Notifications）还没接入。过期用户只能在打开 App 时看到提醒，推送还没做。
- 黑名单对所有用户生效，所以只有机主和网页面板能拉黑；按用户分开的黑名单留到 MVP。呼叫转移自测也仍然只测机主号码。
- 手机号就是账户。号码换了或被运营商回收，需要在 Supabase 后台处理对应的用户。
- Vapi 的服务器在美国，澳洲来电每轮对话会多一段跨太平洋往返。原型阶段先实测延迟。
- 接通后 AI 不先说话，等对方开口；对方 3 秒没声音只说一句 "Hello?"。对方正常自我介绍后，AI 说 "this is <OWNER_NAME>'s AI assistant"；开场像银行、警察、移民局等高风险来电时，只说 "This is an AI phone assistant"（不带名字）；对方不自我介绍时先问是谁，弄清对方身份后再按前两种之一说明；明显诈骗直接挂断，不说任何话。音色和名字见 `.env.example`。
- 默认不保存录音，只保存转写；不做通话记录告知。如果以后面向其他用户推出，需要请律师重新评估。
- Vapi 回传的报告里如果没有带回 Twilio 的 CallSid，会退而按「来电号码 + 时间」匹配，面板上会标出来。

## 本地运行测试

```bash
npm install
npm test
```
