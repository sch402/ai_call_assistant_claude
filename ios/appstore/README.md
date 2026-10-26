# App Store 上架指南

上架需要的文案、截图、预览视频、审核资料都在仓库里。安装包用 Xcode 上传；文案和截图用一条 fastlane 命令推到 App Store Connect；剩下几项（App Privacy、Age Rating、Subscriptions、App Previews）App Store Connect 不开放给 fastlane，需要在网页上填，答案都写在本文里。

## 文件一览

| 位置 | 内容 |
| --- | --- |
| `ios/fastlane/metadata/zh-Hans/` | Chinese (Simplified)（主语言）：Name、Subtitle、Promotional Text、Description、Keywords、Support / Marketing / Privacy Policy URL |
| `ios/fastlane/metadata/en-AU/` | English (Australia)：同上。界面是中文，英文描述里已说明 |
| `ios/fastlane/metadata/review_information/` | App Review Information：联系邮箱、演示账号、给审核人员的 Notes |
| `ios/fastlane/metadata/*.txt` | Copyright、Primary Category（Utilities）、Secondary Category（Productivity） |
| `ios/fastlane/screenshots/<语言>/` | 截图，每种语言 7 张 × 2 种尺寸（6.9" 1320×2868、6.5" 1284×2778） |
| `ios/appstore/preview/app-preview-zh-Hans.mp4` | App Preview 视频：886×1920、30fps、24 秒，适用 6.9" / 6.5" |
| `ios/appstore/preview/iap-review-subscription.png` | 订阅产品 Review Information 里的截图 |
| `ios/appstore/preview/search-*.png` | 搜索结果、产品页顶部的效果预览（自己看，不上传） |
| `supabase/review-demo.sql` | 审核演示账号的示例来电 |
| `public/support.html` | Support URL 指向的帮助页 |
| `ios/CallAssistant/Resources/PrivacyInfo.xcprivacy` | Privacy Manifest（上架必需），和下面 App Privacy 的回答一致 |

## 一、一次性准备

1. **在 App Store Connect 创建 App**：**Apps › + › New App**。
   - Platforms：iOS
   - Name：`来电助手 - AI替你接电话`（提示已被占用就换一个，同步改 `metadata/zh-Hans/name.txt`）
   - Primary Language：**Chinese (Simplified)**
   - Bundle ID：`com.homeau.callassistant`
   - SKU：随便填，例如 `callassistant`
   - User Access：Full Access

   App Apple ID 6825135310 已经存在的话，说明这一步已经做过。
2. **API Key**（给 fastlane 用）：**Users and Access › Integrations › App Store Connect API › Team Keys › Generate API Key**（第一次用要先点 Request Access），Access 选 **App Manager**。下载 `.p8`（只能下载一次，不要放进仓库），记下 **Key ID** 和页面上方的 **Issuer ID**。
3. **审核演示账号**：审核人员收不到澳洲短信，需要一个免短信的测试号码。
   - Supabase：**Authentication › Sign In / Providers › Phone › Test Phone Numbers and OTPs**，添加 `61491570006=246810`（0491 570 006 是 ACMA 保留给影视作品的虚构号码，不会打到真人）。
   - 用这个号码在 App 里登录一次（验证码 246810），完成首次引导。
   - 在 Supabase **SQL Editor** 里运行 `supabase/review-demo.sql`，写入 6 通示例来电（诈骗、推销、学校、诊所……）和陌生号码分析结果。可以重复运行。
   - 演示账号故意没有订阅，审核人员可以用 Sandbox 账号测试购买。审核期间 Vercel 的 `APPLE_ALLOW_SANDBOX` 必须是 `true`（默认就是）。
4. **装 fastlane**（Mac 上，一次）。先把最新代码拉下来：

   ```bash
   cd ~/path/to/ai_call_assistant_claude   # 你的仓库目录
   git pull origin main
   ```

   推荐用 Homebrew 装，不用碰 macOS 自带的旧版 Ruby：

   ```bash
   brew install fastlane
   ```

   之后在 `ios/` 目录直接运行 `fastlane <lane>`，不需要 `bundle install`。

   如果想用仓库里的 `ios/Gemfile`（锁定 fastlane 版本），把 gem 装到 `ios/vendor/bundle`，不要装进系统或 Homebrew 的 Ruby 目录（会报 `Bundler::PermissionError`，也不要用 sudo）：

   ```bash
   cd ios
   bundle config set --local path vendor/bundle
   bundle install
   bundle exec fastlane <lane>
   ```

## 二、从 Xcode 上传安装包

```bash
cd ios
xcodegen generate
open CallAssistant.xcodeproj
```

1. 版本号在 `project.yml`：`MARKETING_VERSION`（已改为 1.0.0）。每次上传，`CURRENT_PROJECT_VERSION`（Build）必须比上次大；在 Xcode 里改也可以，但下次 `xcodegen generate` 会被 `project.yml` 覆盖，所以建议直接改 `project.yml`。
2. 顶部 run destination 选 **Any iOS Device (arm64)**，菜单 **Product › Archive**。
3. 打包完成后自动打开 **Organizer**，选中刚才的 archive › **Distribute App** › **App Store Connect** › **Distribute**。签名用 Automatically manage signing 即可。
4. 等 10–30 分钟，App Store Connect 的 **TestFlight** 标签页里出现这个 build，Processing 结束即可。Export Compliance 已在 Info.plist 里声明（`ITSAppUsesNonExemptEncryption = NO`，只用 HTTPS），不会再问。

也可以一条命令打包上传（Build 号自动 +1）：`fastlane beta`。

## 三、推送文案和截图

```bash
cd ios
export ASC_KEY_ID=XXXXXXXXXX
export ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
export ASC_KEY_PATH=~/keys/AuthKey_XXXXXXXXXX.p8
# 审核联系人，只用于苹果联系你，不公开
export REVIEW_FIRST_NAME="名" REVIEW_LAST_NAME="姓" REVIEW_PHONE="+61 4xx xxx xxx"

fastlane metadata
```

这会创建 1.0.0 版本（如果还没有），并上传两种语言的 Name、Subtitle、Promotional Text、Description、Keywords、三个 URL、Copyright、Category、全部截图（覆盖旧的），以及 App Review Information（联系人、Sign-in information、Notes）。不会上传安装包，也不会提交审核。文案改了之后重新运行即可。

## 四、在网页上填写的部分

fastlane 推不了下面这些，按顺序在 App Store Connect 里填。

### 1. App Privacy

- **Privacy Policy URL**：`https://aicallassistantclaude.vercel.app/privacy.html`
- **Data Collection** › Get Started › "Do you or your third-party partners collect data from this app?" → **Yes, we collect data from this app**
- 勾选下面 5 项，每一项都回答：Purpose 选 **App Functionality**；Linked to the user 选 **Yes**；Used for tracking 选 **No**

| Category | Data Type | 说明 |
| --- | --- | --- |
| Contact Info | Phone Number | 登录手机号 |
| Contact Info | Name | AI 助手使用的称呼 |
| User Content | Other User Content | 来电的文字转写和摘要 |
| Identifiers | User ID | 账户 ID |
| Purchases | Purchase History | 订阅交易 |

不要勾选 **Contacts**：通讯录只在手机上匹配，不上传，按苹果的定义不算收集。没有接入任何统计或崩溃分析 SDK，**Diagnostics** 也不勾。全部填完点右上角 **Publish**。

### 2. Age Rating

**App Information › Age Rating › Edit**：所有内容类问题选 **None**；Unrestricted Web Access、User-Generated Content、Messaging and Chat、Advertising 都选 **No**。结果为 **4+**。

### 3. Pricing and Availability

- **Price**：Free（收入来自 App 内订阅）
- **App Availability**：只选 **Australia**。服务依赖澳洲运营商的呼叫转移和澳洲号码，其他国家用不了，放开会招来差评和退款。

### 4. Subscriptions

订阅产品第一次必须和 App 版本一起提交审核。

- **Subscription Group** Reference Name：`来电助手 Pro`；组的 **App Store Localization** › Subscription Group Display Name：Chinese (Simplified) `来电助手 Pro`，English (Australia) `Call Assistant Pro`
- 两个产品的 **App Store Localization**（Display Name ≤ 30 字，Description ≤ 45 字）：

| Product ID | Price | Chinese (Simplified) | English (Australia) |
| --- | --- | --- | --- |
| `com.homeau.callassistant.pro.monthly` | A$14.99 / month | 月付 · AI 代接不限分钟，按月自动续费 | Monthly · Unlimited AI answering, billed monthly |
| `com.homeau.callassistant.pro.yearly` | A$149.99 / year | 年付 · AI 代接不限分钟，按年续费，比月付省 17% | Yearly · Unlimited AI answering, save 17% |

  「·」前面填 Display Name，后面填 Description。
- 每个产品的 **Review Information › Screenshot** 上传 `ios/appstore/preview/iap-review-subscription.png`；Review Notes 可以写：`Open the subscription screen from 我的 (Me) > 来电助手 Pro, or the banner at the top of the 来电 (Calls) tab.`
- 版本页面下方 **In-App Purchases and Subscriptions** 里点 **Select In-App Purchases or Subscriptions**，把两个产品加到这个版本。

### 5. App Previews（可选）

1.0.0 版本页面 › 语言切到 **Chinese (Simplified)** › **Previews and Screenshots** › **iPhone 6.9" Display**，把 `ios/appstore/preview/app-preview-zh-Hans.mp4` 拖进去。上传后可以设置 **Poster Frame**，建议选 3 秒左右（出现第一通来电时）。

### 6. 选择 build 并提交

版本页面 › **Build** › **Add Build** › 选第二步上传的 build › **Done** › **Save**。**App Store Version Release** 建议选 **Manually release this version**。然后点右上角 **Add for Review** › **Submit for Review**。审核一般 1–2 天，通过后自己点 **Release This Version**。

## 文案速查

直接复制文件内容即可。字数限制是 App Store Connect 的上限。

| 字段 | 上限 | Chinese (Simplified) | English (Australia) |
| --- | --- | --- | --- |
| Name | 30 | `来电助手 - AI替你接电话` | `Call Assistant: AI Answers` |
| Subtitle | 30 | `没接的电话，AI接听并发中文摘要` | `Missed calls, answered by AI` |
| Promotional Text | 170 | `metadata/zh-Hans/promotional_text.txt` | `metadata/en-AU/promotional_text.txt` |
| Description | 4000 | `metadata/zh-Hans/description.txt` | `metadata/en-AU/description.txt` |
| Keywords | 100 | `metadata/zh-Hans/keywords.txt` | `metadata/en-AU/keywords.txt` |
| Support URL | | `https://aicallassistantclaude.vercel.app/support.html` | 同左 |
| Marketing URL | | `https://aicallassistantclaude.vercel.app/` | 同左 |
| Privacy Policy URL | | `https://aicallassistantclaude.vercel.app/privacy.html` | 同左 |
| Copyright | | `2026 Global Link Technology Pty Ltd` | |

- 搜索结果里显示：图标、Name、Subtitle、前 3 张截图，所以前 3 张放的是来电列表、中文摘要、诈骗识别。
- Keywords 不用重复 Name 和 Subtitle 里已有的词（苹果会自动收录），逗号分隔、不加空格。
- Promotional Text 随时可以改，不需要重新审核；其余文案改了要随下一个版本提交。
- 以后换成自己的域名，改三个 `*_url.txt` 和 `support.html` 里的链接，重新运行 `fastlane metadata`。

## 重新生成截图和视频

截图和视频都是脚本生成的：按 App 的 SwiftUI 界面用 HTML 复刻（数据在 `demo-data.mjs`，和审核演示账号是同一份），再用 Playwright 渲染。改了界面、文案或示例数据后：

```bash
node ios/appstore/render-screenshots.mjs   # 截图 + 搜索结果预览 + 内购审核截图
node ios/appstore/render-preview.mjs       # 预览视频（需要 ffmpeg：brew install ffmpeg）
node ios/appstore/demo-data.mjs > supabase/review-demo.sql
```

需要 Node 18+、Playwright（`npm i -g playwright && npx playwright install chromium`）和中文字体 Noto Sans SC（没有会退回系统字体）。截图标题在 `render-screenshots.mjs` 的 `SHOTS`。

## 注意

- **截图要和 App 一致**：截图是按 App 代码复刻的，界面和真机一样。以后改了界面，记得同步改脚本重新生成，否则可能因「截图与 App 不符」被拒（App Review Guidelines 2.3.3）。
- **App Preview**：Guidelines 2.3.4 要求预览视频使用 App 本身的画面。这段视频是复刻界面渲染的，内容与真实操作一致；如果被拒，在 Simulator 里用 `xcrun simctl io booted recordVideo preview.mov` 录一段真实操作替换，或者先不上传（它是可选的）。
- **Seller 名称**：App Store 上显示的开发者名称来自 Apple Developer 账户（目前是 Everyone Delivery Pty Ltd），不能在这里改。要显示 Global Link Technology Pty Ltd，需要联系苹果修改账户的法律实体名称，或者把 App 转移（App Transfer）到新公司的开发者账户。
- **Notes** 已写明：如何登录、为什么在澳洲以外无法测试真实来电、订阅入口、通讯录用途、删除账户入口。改了 App 流程要同步改 `review_information/notes.txt`。
