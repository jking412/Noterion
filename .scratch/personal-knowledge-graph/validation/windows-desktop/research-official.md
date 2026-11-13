# Issue #3：真实 Windows Tauri 宿主与自动化官方核验

核验日期：2026-11-07（Asia/Shanghai）。本文应用 `research` 技能，复用已有 `research/tauri-rust-route.md` 与 ADR 0001，仅补充本次实际验证需要的事实。它不代替构建日志、桌面操作和重复通过证据；本机版本、运行结果以同目录的执行记录为准。

## 最小宿主的可实践路径

1. Windows 构建依赖 Microsoft C++ Build Tools、WebView2 和 Rust MSVC 工具链；Node 仅在使用 JavaScript 前端框架时需要。MSI 的 VBSCRIPT 要求属于安装包构建，不应阻塞本次直接运行最小 exe。不要以 `rustc --version` 成功推断链接器和 Windows SDK 已可用，应实际编译。[Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/#windows)。
2. 最小烟雾宿主可采用静态 HTML/JS。`app.withGlobalTauri=true` 会提供全局 Tauri API；前端用 `window.__TAURI__.core.invoke(...)` 调用 Rust。Rust 侧以 `#[tauri::command]` 定义命令，并使用 `invoke_handler(tauri::generate_handler![...])` 注册。命令可以返回序列化数据或错误；验证应断言页面显示 Rust 返回值，不能让前端自行生成成功结果。[Calling Rust from the Frontend](https://v2.tauri.app/develop/calling-rust/)。
3. `generate_context!()` 默认读取 Cargo manifest 同目录的 `tauri.conf.json`，把配置、前端资源和 ACL 等编入上下文，再交给 `Builder::run`。官方最小示例采用同一调用结构。[generate_context! 文档](https://docs.rs/tauri/latest/tauri/macro.generate_context.html)、[官方 helloworld main.rs](https://github.com/tauri-apps/tauri/blob/dev/examples/helloworld/main.rs)。
4. 直接 Cargo 构建时，显式启用 `tauri/custom-protocol` 可选择生产资源路径。例如 `cargo build --locked --features tauri/custom-protocol`；这省去 CLI 的前端构建与打包协调，因此须提前提供完整静态资源。本次仅验证桌面 exe，不代表已验证安装器。官方 crate 文档说明该 feature 会让 Tauri 按生产环境运行，通常由 CLI 管理。[tauri Cargo features](https://docs.rs/tauri/latest/tauri/#cargo-features)。
5. 配置的 `build.frontendDist` 指向资源目录时会递归嵌入文件并以 `index.html` 为入口。为隔离其他任务，用独立应用 identifier、窗口标题和数据目录。配置 `dataDirectory` 是相对本机数据目录的路径；绝对路径应通过 `WebviewWindowBuilder::data_directory` 设置。[Tauri configuration](https://v2.tauri.app/reference/config/#frontenddist)、[Window dataDirectory](https://v2.tauri.app/reference/config/#datadirectory)。

以上属于根据官方 API 形成的最小工程建议；具体依赖版本须由本次 `Cargo.toml`、`Cargo.lock` 和真实构建日志固定，不把动态 `latest` 文档地址视为版本锁。

## 真实桌面自动化与可复现备选

| 路径 | 官方依据与边界 | 本次使用建议 |
| --- | --- | --- |
| Windows UI Automation／原生鼠标键盘 | Microsoft 说明 Win32/C++ 宿主中的 WebView2 默认作为父 HWND 的子项出现在 accessibility tree。它具备原生可访问性入口，但特定页面的可读性、控件名称和可见文本仍须在实际窗口中检查。[WebView2 accessibility](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/overview-features-apis#accessibility)。 | 先读真实窗口可访问性树，再向实际输入框键入、点击按钮，并从更新后的树/截图断言结果。代理的原生 Computer Use 路径可覆盖 Tauri 窗口与 Windows 输入，不注入假 IPC。 |
| `tauri-driver`＋Microsoft Edge WebDriver | Tauri 官方支持直接 `tauri-driver` 的 Windows/Linux 路径；Windows 需要 `msedgedriver.exe`，可通过 PATH 或 `--native-driver` 指定。不匹配的驱动可能导致连接挂起。[Tauri manual setup](https://v2.tauri.app/develop/tests/webdriver/manual-setup/)。 | 如原生窗口工具不稳定，使用局部安装的驱动和 Issue 专属端口，驱动真实宿主 exe；勿误改为普通 Edge 标签页。当前未为本研究安装/执行驱动。 |
| 直接 Microsoft Edge WebDriver | Microsoft 的 WebView2 示例将 `UseWebView=true`，并将 `BinaryLocation` 指向宿主 exe；也允许通过调试端口附加到已启动的 WebView2。驱动版本须匹配应用实际使用的 WebView2 Runtime。[Microsoft WebView2 WebDriver](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/webdriver)。 | 这属于真实 WebView2 应用测试。只断言普通浏览器中的相同 HTML，或 mock `window.__TAURI__`，不能证明真实 IPC。WebDriver 不覆盖原生系统 UI，文件对话框等仍需原生自动化。 |

当前 Tauri WebDriver 首页还推荐 WebdriverIO `@wdio/tauri-service`，可以使用嵌入式服务器或原生驱动。其提供 IPC mocking 能力，但本 Issue 必须调用真实 Rust，不能把该能力用于代替往返验证。[Tauri WebDriver overview](https://v2.tauri.app/develop/tests/webdriver/)。本次已有可用原生自动化时，无需为最小验证额外引入该服务。

## 桌面运行条件与诊断

- Windows 同一时刻只有一个活动 input desktop 接收用户输入。安全屏保、Winlogon 或 UAC 会切换桌面；这不是可以从普通用户会话任意穿透的窗口遮挡问题。原生键鼠验证应保持用户会话已登录且桌面解锁，遇到锁屏或权限界面停止并记录。[Microsoft Desktops](https://learn.microsoft.com/en-us/windows/win32/winstation/desktops)。
- `SendInput` 受 UIPI 完整性级别限制，只允许向相同或较低完整性级别的应用注入；已有按下的键也可能干扰输入。因此宿主与驱动宜同一普通用户权限运行，操作后重新读取焦点与可见状态。发送事件成功本身不是目标控件收到输入的断言。[Microsoft SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)。
- 不据上述资料推断锁屏、最小化远程桌面、无交互服务会话或任意 CI 已通过。应记录实际使用的 Windows 会话、屏幕/缩放条件、工具版本和截图；未执行条件明确列为未验证。

推荐烟雾流程：启动本任务 exe → 获取唯一目标窗口 → 输入本轮唯一文本 → 点击“调用 Rust” → 等待可见结果 → 同时断言回显、Rust 标识及调用计数 → 保存窗口文本/截图和后端记录 → 关闭并重新启动同一 exe → 使用另一轮文本重复。后端记录与可见结果共同证明链路；不能只让日志自报通过。

研究过程未安装软件、未启动服务、未更改系统设置、未修改根规格/领域/ADR，未对本机成功作事实声明。
