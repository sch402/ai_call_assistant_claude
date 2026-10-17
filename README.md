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
3. 在 **Project Settings › API** 里记下 `Project URL` 和 `service_role` key。

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
| `api/admin/check-forwarding.js` | 呼叫转移自测 |
| `api/admin/blocklist.js` | 拉黑或取消拉黑号码 |
| `lib/assistant.js` | 助理的话术、安全规则、音色、摘要和结构化字段定义 |
| `public/index.html` | 网页面板 |
| `supabase/schema.sql` | 数据库表结构 |

## 已知限制

- 只支持一个机主（`OWNER_PHONE_NUMBER`），多用户和号码池留到 MVP 阶段。
- Vapi 的服务器在美国，澳洲来电每轮对话会多一段跨太平洋往返。原型阶段先实测延迟。
- 开场白固定用英文（"Hello, Michael speaking. Who's calling please?"，名字取自 ASSISTANT_NAME）；对方说中文后 AI 会切换。音色和名字见 `.env.example` 的 ASSISTANT_VOICE、ASSISTANT_NAME。
- 默认不保存录音，只保存转写；开场默认不做通话记录告知（`RECORDING_NOTICE=true` 可开启）。如果以后面向其他用户推出，需要请律师重新评估。
- Vapi 回传的报告里如果没有带回 Twilio 的 CallSid，会退而按「来电号码 + 时间」匹配，面板上会标出来。

## 本地运行测试

```bash
npm install
npm test
```
