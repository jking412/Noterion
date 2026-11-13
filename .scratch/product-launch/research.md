# Noterion 推广入口与 Windows 图标接入调研

核实日期：2026-11-13（Asia/Shanghai）。正式任务：[Issue #25](https://github.com/jking412/Noterion/issues/25)。本记录仅调查官方 README、项目发布事实及 Tauri/Windows 接入方式，不替代本次图标的构建与真实显示验收。

本次工作区由 `f72bbf8f27284b600d503178a43628a66ca3e1a1`（已提交的 #22 AI 实现）与远端 `b41614abef9a3011929b286e5158d4ed73a6bd38`（已合并的 #23 发布流水线）整合而来；正式实施审查基点是 `012af109e3abc999b538ef0003e3e764f6fa888a`。未读取或迁入其他工作区的未提交文件。

## 1. 官方 README 参考及采用原则

| 官方原文 | 观察到的信息组织 | 本项目采用原则 |
| --- | --- | --- |
| [Joplin / dev README](https://github.com/laurent22/joplin/blob/dev/README.md) | 图标附近用简短正文说明用途、可检索内容和本地访问，紧接真实界面，再转向帮助、社区和贡献。离线访问与可选同步分别说明。 | 先回答访客能解决什么问题，以真实截图支撑；把本地知识访问和需要联网的 AI 分开表达。不能借用其多平台、同步或许可承诺。 |
| [Logseq / master README](https://github.com/logseq/logseq/blob/master/README.md) | 名称和一句定位后提供集中导航与突出下载入口，正文说明用途、版本形态和使用入口，开发文档靠后。 | 首屏提供清楚下载与语言切换；在下载附近解释预发布成熟度和功能范围，快速开始面向普通使用者。不能用不存在的正式 Latest 版本代替当前预发布入口。 |
| [AFFiNE / canary README](https://github.com/toeverything/AFFiNE/blob/canary/README.md) | 首屏集中名称、定位、产品视觉和可操作入口；特性用实际工作收益展开，贡献与反馈放在后面。 | 以“记下来、找回来、用起来”的真实行为组织特性，开发细节保持精简入口；不复制原文、Logo、主视觉或其协作、跨平台承诺。 |

本项目据此形成自己的节奏：图标与定位 → 下载/上手 → 真实界面与 Docker 场景 → 核心流程 → 本地和 AI 边界 → 精简开发与反馈入口。参考只用于结构，没有沿用其品牌资产或文案。

## 2. 当前公开下载事实

通过 GitHub 连接器读取[项目 Releases](https://github.com/jking412/Noterion/releases)，核实时仅有一个公开版本，且为 **prerelease**：

| 项目 | 核实值 |
| --- | --- |
| 名称 | `Noterion 0.1.0-main.b41614abef9a` |
| 完整标签 | `main-b41614abef9a3011929b286e5158d4ed73a6bd38` |
| 对应提交 | `b41614abef9a3011929b286e5158d4ed73a6bd38` |
| 公开时间 | 2026-11-13 11:17:27（Asia/Shanghai；API 为 `2026-11-13T03:17:27Z`） |
| 正式构建 | [GitHub Actions run 43356740425](https://github.com/jking412/Noterion/actions/runs/43356740425) |
| 发布页面 | [该预发布的固定页面](https://github.com/jking412/Noterion/releases/tag/main-b41614abef9a3011929b286e5158d4ed73a6bd38) |
| ZIP | [Noterion-0.1.0-main.b41614abef9a-windows-x64.zip](https://github.com/jking412/Noterion/releases/download/main-b41614abef9a3011929b286e5158d4ed73a6bd38/Noterion-0.1.0-main.b41614abef9a-windows-x64.zip)，3,758,483 字节 |
| ZIP SHA-256 | `1ef8288102aad1f255f8486de59e3c2019219adc70e956483647574bfd83af91` |
| 包内程序 | `noterion.exe`，10,531,328 字节 |
| EXE SHA-256 | `ad03bc9edb903360eb9427236c7ab13815c843d3f60c8d124e9b75e2861f4b51` |

已在本任务专用 worktree 内实际下载 ZIP，检查长度、完整 SHA-256 和 ZIP 目录，并从压缩条目直接读取 EXE 计算 SHA-256。结果分别与 GitHub 资产 digest 和 [manifest.json](https://github.com/jking412/Noterion/releases/download/main-b41614abef9a3011929b286e5158d4ed73a6bd38/manifest.json) 一致；ZIP 仅有 `noterion.exe`、`README.txt`、`manifest.json` 三个文件。此次研究没有运行旧程序，旧程序的运行验收是 #23 交付证据；本 Issue 仍须运行本任务新构建的程序。

发布另有 [SHA256SUMS](https://github.com/jking412/Noterion/releases/download/main-b41614abef9a3011929b286e5158d4ed73a6bd38/SHA256SUMS)、[README.txt](https://github.com/jking412/Noterion/releases/download/main-b41614abef9a3011929b286e5158d4ed73a6bd38/README.txt)。发布说明明确是 Windows x64 便携程序，需解压到可写目录并具备 WebView2 Runtime，程序未签名；不需要开发服务器。只存在预发布时，推广入口应使用 Releases 列表或核实后的固定页面，避免默认认为 `/releases/latest` 能定位该预发布。[发布元信息](https://github.com/jking412/Noterion/releases/tag/main-b41614abef9a3011929b286e5158d4ed73a6bd38)

## 3. 公开包与当前源码的功能边界

**公开包 b41614a：已有本地知识点、主题、多主题共用、图谱、名称/描述片段搜索、资料副本和查看等功能；没有 DeepSeek 自动解析、自动搜索或自动解答。** 直接读取发布提交的 [`app/README.md`](https://github.com/jking412/Noterion/blob/b41614abef9a3011929b286e5158d4ed73a6bd38/app/README.md)，其中仍说明 AI 待接入；该树中不存在 `app/AI.md`。这比依据当前 Issue 的 open/closed 判断功能更可靠。

**本任务整合源码：已含 f72bbf8 的 DeepSeek AI 三项能力及真实服务验收材料，但核实时尚无包含它的公开 Release。** 本地 [`app/AI.md`](../../app/AI.md) 描述配置、文本解析后预览与整批采用、本地知识检索、带来源问答及追问；[`app/validation/ai-acceptance.md`](../../app/validation/ai-acceptance.md) 和 [`ai-final-summary.json`](../../app/validation/ai-final-summary.json) 记录官方服务正常流程 6 项、模拟故障 29 项、资料流程 7 项、界面回归 2 项、旧库迁移 1 项及本地回归 39 项。文档载明真实调用 `https://api.deepseek.com`、`deepseek-flash`。这些是已提交的既有验收证据，不能写成本次新图标构建已复验这些 AI 流程，也不能暗示上述旧公开包已包含它们。[#22 正式要求](https://github.com/jking412/Noterion/issues/22)

README 应在 AI 特性及配置步骤旁标明“当前源码已支持；上方已核实的旧公开预发布尚未包含，待包含此提交的新发布后可直接下载”。旧包首个知识流程应采用手工录入，因此下载后的新用户可直接完成。

准确边界来自 [`app/README.md`](../../app/README.md)、[`app/AI.md`](../../app/AI.md) 和正式 Rust 源码：

- 知识记录和资料副本保存在本机 SQLite 与资料目录，默认在程序旁 `data/`。`%LOCALAPPDATA%/Noterion/directory.json` 只保存目录位置指针；界面显示实际目录，可创建新目录或打开已有目录，切换不自动迁移、合并或清空旧内容。
- 手工编辑、已有知识访问和本地片段搜索可离线使用；外部链接在用户主动打开时交给系统浏览器，目标网站可能需要网络。PDF、图片与支持的视频可查看，视频兼容由本机 WebView2 决定，不承诺全部编码或自动转码。
- DeepSeek 需要联网和用户自己的 API key，向所配置接入地址发送本次任务所需文本、问题及知识上下文；解析和明确选择的 Markdown/TXT 读取有各自范围限制。不能宣传“全部内容从不外发”或“AI 完全离线”。
- 密钥保存到 Windows Credential Manager；自定义 HTTPS 接入地址会改变接收文本与凭据的服务方。AI 不默认扫描上传整个目录，不自动读取 PDF/图片/视频正文，不提供互联网搜索、OCR 或音视频转文本。AI 不可用不等于本地数据不可用。
- 当前交付和验收平台是 Windows x64，已有真实环境为 Windows 11。没有可据以承诺 macOS/Linux、云同步、自动更新或通用备份恢复的本次交付证据。

## 4. Tauri 与 Windows 图标：三个独立入口

### EXE 内嵌资源

Tauri 官方将 Windows 图标定义为 `icon.ico`，并提供图标导出命令。[Tauri App Icons](https://v2.tauri.app/develop/icons/)

本项目锁定 `tauri-build = 2.5.6`、`tauri = 2.10.3`、`tauri-codegen = 2.5.5`。已直接读取本机 Cargo 官方 crate 缓存，其 `.cargo_vcs_info.json` 都指向上游提交 `9b17a7aeae9a83222ffe829aa4e2d8a5ba6bed8c`，因此以下结论按实际版本源码核对，而非只用最新版文档推断：`tauri-build` Windows 路径从 `bundle.icon` 取首个 `.ico`，回退 `icons/icon.ico`，用资源 ID `32512` 嵌入程序。此过程并不依赖 `bundle.active=true`，本项目便携 EXE 也适用。[实际版本 tauri-build 源码](https://github.com/tauri-apps/tauri/blob/9b17a7aeae9a83222ffe829aa4e2d8a5ba6bed8c/crates/tauri-build/src/lib.rs)

推荐保留 `bundle.active=false` 的便携路线，更换有效多尺寸 `icons/icon.ico`。`build.rs` 显式声明 `cargo:rerun-if-changed=icons/icon.ico` 能保证仅更换图标时重新生成 PE 资源。不能以更换 favicon 代替 EXE 资源验收。

### 运行窗口与任务栏

实际版本中，`generate_context!` 在 Windows 读取上述 ICO 作为默认窗口图标；`WindowManager::prepare_window` 仅在窗口未显式提供 icon 时套用此默认值。[context.rs](https://github.com/tauri-apps/tauri/blob/9b17a7aeae9a83222ffe829aa4e2d8a5ba6bed8c/crates/tauri-codegen/src/context.rs)、[manager/window.rs](https://github.com/tauri-apps/tauri/blob/9b17a7aeae9a83222ffe829aa4e2d8a5ba6bed8c/crates/tauri/src/manager/window.rs)

**关键细节：** `CachedIcon::new_ico()` 直接解码 `icon_dir.entries()[0]`，不自动选择最大帧。若导出器把 16px 放第一帧，默认窗口图标可能由 16px 放大。[实际版本 image.rs](https://github.com/tauri-apps/tauri/blob/9b17a7aeae9a83222ffe829aa4e2d8a5ba6bed8c/crates/tauri-codegen/src/image.rs)

推荐在现有 `WebviewWindowBuilder` 上显式使用 256px RGBA PNG：

```rust
.icon(tauri::include_image!("icons/icon.png"))?
```

宏在编译期转为 `Image`，相对路径从 `CARGO_MANIFEST_DIR` 解析；不必为了运行时 PNG 解码新增 `image-png` 依赖功能。256px 为此用途提供足够分辨率，避免把高清宣传 PNG 的百万像素原始数据嵌入窗口资源。[官方 include_image 文档](https://docs.rs/tauri/latest/tauri/macro.include_image.html)、[本版本宏源码](https://github.com/tauri-apps/tauri/blob/9b17a7aeae9a83222ffe829aa4e2d8a5ba6bed8c/crates/tauri-macros/src/lib.rs)

此为接入建议，最终仍须运行本任务正式构建，在真实窗口、任务栏及 EXE 图标中观察并留证；文件存在、配置正确或旧缓存缩略图都不能替代观察。

### 前端 favicon 和产品内标识

当前 `app/index.html` 用 `<link rel="icon" href="/favicon.svg" type="image/svg+xml">` 引用 `app/public/favicon.svg`；这属于页面/浏览器标识，与 Windows 原生资源分开。可沿用此入口，改成同一原创标志，并检查 Vite 构建后实际文件与前端可见标识。[HTML 标准 rel=icon](https://html.spec.whatwg.org/multipage/links.html#rel-icon)

## 5. WebView2 与许可证

微软明确生产环境应具备 **WebView2 Runtime**，不能将安装了 Edge 浏览器当作充分条件；Windows 11 自带及大多数 Windows 10 设备已有 Runtime，仍应说明缺失时的官方安装入口。[Microsoft 分发指南](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)、[官方 Runtime 下载](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

Tauri 安装包可下载/嵌入 Runtime 安装器，但当前项目交付的是便携 ZIP，发布包没有这种安装器。README 直接说明预先安装 Runtime；不要把 Tauri 安装包默认引导安装的行为写成当前 ZIP 已实现。[Tauri Windows Installer](https://v2.tauri.app/distribute/windows-installer/)、[项目发布维护说明](../../docs/releasing.md)

`git ls-tree -r --name-only` 检查本任务基线和 `origin/main` 均未发现根项目 `LICENSE`/`COPYING` 文件；当前前端和 Rust 包元数据也未声明项目许可证。依赖自身的许可证不构成 Noterion 项目许可。推广文案可以如实写“仓库尚未声明项目许可证”，不能自行选择 MIT/Apache、增加开源许可徽章或声称已获某许可证授权。本 Issue 不需要为补写产品 README 擅自确定许可。
