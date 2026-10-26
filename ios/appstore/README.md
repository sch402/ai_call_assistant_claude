# App Store 上架指南

上架需要的文案、截图、预览视频、审核资料都在仓库里。安装包用 Xcode 上传；文案和截图用一条 fastlane 命令推到 App Store Connect；剩下几项（隐私问卷、年龄分级、订阅、预览视频）App Store Connect 不开放给 fastlane，需要在网页上填，答案都写在本文里。

## 文件一览

| 位置 | 内容 |
| --- | --- |
| `ios/fastlane/metadata/zh-Hans/` | 简体中文（主语言）：名称、副标题、推广文本、描述、关键词、支持 / 营销 / 隐私网址 |
| `ios/fastlane/metadata/en-AU/` | 英语（澳大利亚）：同上。界面是中文，英文描述里已说明 |
| `ios/fastlane/metadata/review_information/` | 审核信息：联系邮箱、演示账号、给审核人员的备注 |
| `ios/fastlane/metadata/*.txt` | 版权、主分类（工具）、次分类（效率） |
| `ios/fastlane/screenshots/<语言>/` | 截图，每种语言 7 张 × 2 种尺寸（6.9 英寸 1320×2868、6.5 英寸 1284×2778） |
| `ios/appstore/preview/app-preview-zh-Hans.mp4` | App 预览视频：886×1920、30fps、24 秒，适用 6.9 / 6.5 英寸 |
| `ios/appstore/preview/iap-review-subscription.png` | 订阅产品的审核截图 |
| `ios/appstore/preview/search-*.png` | 搜索结果、产品页顶部的效果预览（自己看，不上传） |
| `supabase/review-demo.sql` | 审核演示账号的示例来电 |
| `public/support.html` | 技术支持网址指向的帮助页 |
| `ios/CallAssistant/Resources/PrivacyInfo.xcprivacy` | 隐私清单（上架必需），和下面「App 隐私」的回答一致 |

## 一、一次性准备

1. **在 App Store Connect 创建 App**：App › 「+」› 新建 App。平台 iOS；名称 `来电助手 - AI替你接电话`；主要语言 **简体中文**；套装 ID `com.homeau.callassistant`；SKU 随便填（例如 `callassistant`）。如果提示名称已被占用，换一个后同步改 `metadata/zh-Hans/name.txt`。
   App Apple ID 6825135310 已经存在的话，说明这一步已经做过。
2. **API 密钥**（给 fastlane 用）：用户和访问 › 集成 › App Store Connect API › 生成密钥，权限选「App 管理」。下载 `.p8`（只能下载一次，不要放进仓库），记下 Key ID 和 Issuer ID。
3. **审核演示账号**：审核人员收不到澳洲短信，需要一个免短信的测试号码。
   - Supabase › Authentication › Sign In / Providers › Phone › Test Phone Numbers and OTPs，添加 `61491570006=246810`（0491 570 006 是 ACMA 保留给影视作品的虚构号码，不会打到真人）。
   - 用这个号码在 App 里登录一次（验证码 246810），完成首次引导。
   - 在 Supabase SQL Editor 里运行 `supabase/review-demo.sql`，写入 6 通示例来电（诈骗、推销、学校、诊所……）和陌生号码分析结果。可以重复运行。
   - 演示账号故意没有订阅，审核人员可以用沙盒账号测试购买。审核期间 Vercel 的 `APPLE_ALLOW_SANDBOX` 必须是 `true`（默认就是）。
4. **装 fastlane**（Mac 上，一次）：

   ```bash
   cd ios
   bundle install
   ```

## 二、从 Xcode 上传安装包

```bash
cd ios
xcodegen generate
open CallAssistant.xcodeproj
```

1. 版本号在 `project.yml`：`MARKETING_VERSION`（已改为 1.0.0）。每次上传，构建号 `CURRENT_PROJECT_VERSION` 必须比上次大；在 Xcode 里改了也可以，但下次 `xcodegen generate` 会被 `project.yml` 覆盖，所以建议直接改 `project.yml`。
2. 顶部设备选 **Any iOS Device (arm64)**，菜单 Product › Archive。
3. 打包完成后自动打开 Organizer，选中刚才的包 › **Distribute App** › **App Store Connect** › Distribute。签名用自动管理即可。
4. 等 10–30 分钟，App Store Connect › TestFlight 里出现这个构建版本，状态变为「可供测试」。出口合规已在 Info.plist 里声明（`ITSAppUsesNonExemptEncryption = NO`，只用 HTTPS），不会再问。

也可以一条命令打包上传（构建号自动 +1）：`bundle exec fastlane beta`。

## 三、推送文案和截图

```bash
cd ios
export ASC_KEY_ID=XXXXXXXXXX
export ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
export ASC_KEY_PATH=~/keys/AuthKey_XXXXXXXXXX.p8
# 审核联系人，只用于苹果联系你，不公开
export REVIEW_FIRST_NAME=名 REVIEW_LAST_NAME=姓 REVIEW_PHONE="+61 4xx xxx xxx"

bundle exec fastlane metadata
```

这会创建 1.0.0 版本（如果还没有），并上传两种语言的名称、副标题、推广文本、描述、关键词、三个网址、版权、分类、全部截图（覆盖旧的），以及审核联系人、演示账号和备注。不会上传安装包，也不会提交审核。文案改了之后重新运行即可。

## 四、在网页上填写的部分

fastlane 推不了下面这些，按顺序在 App Store Connect 里填。

### 1. App 隐私（App › App 隐私）

- 隐私政策网址：`https://aicallassistantclaude.vercel.app/privacy.html`
- 「你或你的第三方合作伙伴是否从此 App 收集数据？」→ **是**
- 勾选下面 5 项，每一项都回答：用途 **App 功能**；**与用户身份关联**；**不用于追踪**

| 类别 | 数据类型 | 说明 |
| --- | --- | --- |
| 联系信息 | 电话号码 | 登录手机号 |
| 联系信息 | 姓名 | AI 助手使用的称呼 |
| 用户内容 | 其他用户内容 | 来电的文字转写和摘要 |
| 标识符 | 用户 ID | 账户 ID |
| 购买项目 | 购买历史记录 | 订阅交易 |

不要勾选「通讯录」：通讯录只在手机上匹配，不上传，按苹果的定义不算收集。没有接入任何统计或崩溃分析 SDK，「诊断」也不勾。

### 2. 年龄分级（App 信息 › 年龄分级）

所有内容类问题选「无」；「不受限制的网页访问」「用户生成内容」「消息和聊天」「广告」都选「否」。结果为 **4+**。

### 3. 价格与销售范围

- 价格：**免费**（收入来自 App 内订阅）
- 销售范围：只选 **澳大利亚**。服务依赖澳洲运营商的呼叫转移和澳洲号码，其他国家用不了，放开会招来差评和退款。

### 4. 订阅（App › 订阅）

订阅产品第一次必须和 App 版本一起提交审核。

- 订阅组参考名称：`来电助手 Pro`；组的本地化显示名称：简体中文 `来电助手 Pro`，英语（澳大利亚）`Call Assistant Pro`
- 两个产品的本地化（显示名称 ≤ 30 字，描述 ≤ 45 字）：

| 产品 ID | 价格 | 简体中文 | 英语（澳大利亚） |
| --- | --- | --- | --- |
| `com.homeau.callassistant.pro.monthly` | A$14.99 / 月 | 月付 · AI 代接不限分钟，按月自动续费 | Monthly · Unlimited AI answering, billed monthly |
| `com.homeau.callassistant.pro.yearly` | A$149.99 / 年 | 年付 · AI 代接不限分钟，按年续费，比月付省 17% | Yearly · Unlimited AI answering, save 17% |

  「·」前面填显示名称，后面填描述。
- 每个产品的「审核信息 › 屏幕快照」上传 `ios/appstore/preview/iap-review-subscription.png`，审核备注可以写「在 我的 › 来电助手 Pro 或来电列表顶部的提示条打开订阅页」。
- 版本页面最下方「App 内购买项目和订阅」里，把两个产品加到这个版本。

### 5. App 预览视频（可选）

在 1.0.0 版本页面，简体中文 › iPhone 6.9 英寸 › 预览视频，拖入 `ios/appstore/preview/app-preview-zh-Hans.mp4`。苹果会让你选一帧做封面，建议选 3 秒左右（出现第一通来电时）。

### 6. 选择构建版本并提交

版本页面 › 构建版本 › 选择第二步上传的包 › 存储 › **添加以供审核** › 提交。审核一般 1–2 天。建议「手动发布此版本」，审核通过后自己点发布。

## 文案速查

直接复制文件内容即可。字数限制是 App Store Connect 的上限。

| 字段 | 上限 | 中文 | 英文 |
| --- | --- | --- | --- |
| 名称 | 30 | `来电助手 - AI替你接电话` | `Call Assistant: AI Answers` |
| 副标题 | 30 | `没接的电话，AI接听并发中文摘要` | `Missed calls, answered by AI` |
| 推广文本 | 170 | `metadata/zh-Hans/promotional_text.txt` | `metadata/en-AU/promotional_text.txt` |
| 描述 | 4000 | `metadata/zh-Hans/description.txt` | `metadata/en-AU/description.txt` |
| 关键词 | 100 | `metadata/zh-Hans/keywords.txt` | `metadata/en-AU/keywords.txt` |
| 技术支持网址 | | `https://aicallassistantclaude.vercel.app/support.html` | 同左 |
| 营销网址 | | `https://aicallassistantclaude.vercel.app/` | 同左 |
| 隐私政策网址 | | `https://aicallassistantclaude.vercel.app/privacy.html` | 同左 |
| 版权 | | `2026 Global Link Technology Pty Ltd` | |

- 搜索结果里显示：图标、名称、副标题、前 3 张截图，所以前 3 张放的是来电列表、中文摘要、诈骗识别。
- 关键词不用重复名称和副标题里已有的词（苹果会自动收录），逗号分隔、不加空格。
- 推广文本随时可以改，不需要重新审核；其余文案改了要随下一个版本提交。
- 以后换成自己的域名，改三个 `*_url.txt` 和 `support.html` 里的链接，重新运行 `fastlane metadata`。

## 重新生成截图和视频

截图和视频都是脚本生成的：按 App 的 SwiftUI 界面用 HTML 复刻（数据在 `demo-data.mjs`，和审核演示账号是同一份），再用 Playwright 渲染。改了界面、文案或示例数据后：

```bash
node ios/appstore/render-screenshots.mjs   # 截图 + 搜索结果预览 + 内购审核截图
node ios/appstore/render-preview.mjs       # 预览视频（需要 ffmpeg）
node ios/appstore/demo-data.mjs > supabase/review-demo.sql
```

需要 Node 18+、Playwright（`npm i -g playwright && npx playwright install chromium`）和中文字体 Noto Sans SC（没有会退回系统字体）。截图标题在 `render-screenshots.mjs` 的 `SHOTS`。

## 注意

- **截图要和 App 一致**：截图是按 App 代码复刻的，界面和真机一样。以后改了界面，记得同步改脚本重新生成，否则可能因「截图与 App 不符」被拒（审核指南 2.3.3）。
- **预览视频**：审核指南 2.3.4 要求预览视频使用 App 本身的画面。这段视频是复刻界面渲染的，内容与真实操作一致；如果被拒，在模拟器里用 `xcrun simctl io booted recordVideo preview.mov` 录一段真实操作替换，或者先不上传预览视频（它是可选的）。
- **卖家名称**：App Store 上显示的开发者名称来自 Apple 开发者账户（目前是 Everyone Delivery Pty Ltd），不能在这里改。要显示 Global Link Technology Pty Ltd，需要联系苹果修改账户的法律实体名称，或者把 App 转移到新公司的开发者账户。
- **审核备注**已写明：如何登录、为什么在澳洲以外无法测试真实来电、订阅入口、通讯录用途、删除账户入口。改了 App 流程要同步改 `review_information/notes.txt`。
