# 来电助手 · iOS App

SwiftUI 原型，iOS 17+，只支持 iPhone、竖屏。界面暂时只有中文。

![图标与开屏](docs/icon-preview.png)

## 功能

| 页面 | 作用 |
| --- | --- |
| 连接 | 首次打开时填写服务地址（Vercel 网址）和访问口令（`DASHBOARD_TOKEN`），校验通过后口令存进钥匙串 |
| 来电 | AI 接听过的电话列表，可筛选「全部 / 需回电 / 骚扰诈骗」；下拉刷新；详情页有中文摘要、来意、诈骗风险、完整转写，可回电、复制号码、拉黑 |
| 代接设置 | 一键开启或关闭代接，分项设置与查询；iPhone 设置检查清单 |
| 我的 | 账户信息、会员入口（即将推出）、隐私说明、断开连接 |

**为什么不能一键拨打转移代码**：iOS 规定，App 打开的电话号码里只要含 `*` 或 `#`，电话 App 就不会拨出。所以 App 的做法是自动复制代码，并提示你到「电话 › 拨号键盘」长按粘贴后拨出。

## 在 Mac 上构建

需要 Xcode 15 或更新版本。

```bash
brew install xcodegen
cd ios
xcodegen generate
open CallAssistant.xcodeproj
```

1. 在 Xcode 选中 **CallAssistant** target › **Signing & Capabilities**，选择你的 Team。Bundle ID 默认是 `com.sch402.callassistant`，可以在 `project.yml` 里改。
2. 连接 iPhone，选择设备，按 ⌘R 运行。
3. 运行单元测试：⌘U。

`CallAssistant.xcodeproj` 和 `Info.plist` 由 XcodeGen 生成，不提交到仓库。增删源码文件或修改 `project.yml` 后，重新运行一次 `xcodegen generate`。

## 后端要求

App 用到这几个接口，都需要 `Authorization: Bearer <DASHBOARD_TOKEN>`：

- `GET /api/app-config`：代接号码和机主名字
- `GET /api/calls`：来电记录
- `POST /api/admin/blocklist`：拉黑号码

## 目录

```
ios/
├── project.yml                  XcodeGen 配置
├── CallAssistant/
│   ├── App/                     入口与标签页
│   ├── Features/
│   │   ├── Setup/               连接服务
│   │   ├── Calls/               来电列表与详情
│   │   ├── Forwarding/          呼叫转移代码
│   │   └── Settings/            我的
│   ├── Models/                  来电数据、转移代码
│   ├── Services/                网络请求、会话、钥匙串
│   └── Resources/Assets.xcassets  图标、开屏 Logo、主题色
├── CallAssistantTests/          单元测试
└── docs/                        图标预览与生成脚本
```

## 设计

- 主色是深青绿（浅色模式 `#246E5E`，深色模式 `#7AC4AC`），定义在 `AccentColor`。
- 图标：深青绿底，白色对话气泡里是一段声波，代表"把来电变成文字"；右上角的薄荷绿星光代表 AI。
- 开屏：深青绿背景（`LaunchBackground`），中间是白色气泡 Logo。
- 修改图标：编辑 `docs/make_icons.py` 后运行 `python3 docs/make_icons.py CallAssistant/Resources`，再把生成的 `CallAssistant/icon-preview.png` 移到 `docs/`。

## 以后要做的

- **英文**：界面文字已用 SwiftUI 的本地化写法（`Text("…")`）。在 Xcode 里新建 String Catalog（Localizable.xcstrings），构建一次会自动收集所有中文文案，补上英文翻译即可。
- **会员（应用内购买）**：「我的 › 来电助手 Pro」是预留入口。正式版用 StoreKit 2 实现订阅，服务端按订阅状态限制每月 AI 通话时长。
- **正式登录**：用 Sign in with Apple 替换访问口令，每位用户有自己的号码和来电记录。
- **来电推送**：通话结束后通过 APNs 推送摘要，诈骗电话标红。
