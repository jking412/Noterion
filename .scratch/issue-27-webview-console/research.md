# Issue #27：Windows / WebView2 启动与控制台事实核验

核验日期：2026-11-13（Asia/Shanghai）。只使用 Microsoft、Tauri 官方文档与 Tauri 官方源代码。本文提供观测和实验依据，**没有证明本机弹窗的根因**；不能凭截图里的 DPI、USB 或 DevTools 日志决定修复。

## 正常进程与异常窗口

WebView2 进程组通常包含一个 browser、一个或多个 renderer，以及 GPU、音频等辅助进程；使用功能时进程数量会变化。进程组与 user data folder 关联。因此必须把“后台 WebView2 存在”与“额外顶层窗口可见”分别记录，不能通过减少进程数验收。[Microsoft：Process model](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model)

## WebDriver 会改变启动条件

Microsoft 的 launch 方式让 Edge WebDriver 启动 WebView2 宿主，要求宿主启动后立即创建 WebView2，且只创建一个实例。attach 方式由其他方式先启动宿主，实例需启用 `--remote-debugging-port=<port>`，驱动通过 `DebuggerAddress` 连接该端口。WebDriver 不自动处理宿主原生 GUI 操作。普通桌面启动和这两类诊断启动应分别留证，不能视为相同条件。[Microsoft：Automate and test WebView2 apps](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/webdriver)

在 `ms:edgeOptions` 中，`binary` 指定宿主；WebView2 launch 的 `args` 传给宿主 exe，浏览器参数须放 `webviewOptions.additionalBrowserArguments`。`webviewOptions.userDataFolder` 指定隔离 profile；未指定时驱动建立临时目录。应记录实际进程参数，不能仅用请求的 capabilities 推断参数已经生效。[Microsoft：Capabilities and EdgeOptions](https://learn.microsoft.com/en-us/microsoft-edge/webdriver/capabilities-edge-options#webviewoptions-object)

WebView2 创建时会检查 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 等环境变量与对应策略注册表值；该参数来源的附加浏览器参数会追加到 API 的参数值。环境变量、API 参数与注册表是需要区分的来源；本任务只读检查现状，无需修改全局环境或策略。[Microsoft：CreateCoreWebView2EnvironmentWithOptions / Globals](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/webview2-idl#CreateCoreWebView2EnvironmentWithOptions)

Microsoft 将 browser flags 定位为测试、诊断用途，说明它们可能改变或移除，正式程序不应依赖这些 flag。官方列表中 `enable-logging` 表示启用 error 级别日志，`auto-open-devtools-for-tabs` 会自动打开 DevTools。文档未保证 `enable-logging` 与具体控制台窗口之间一一对应，不能因此认定本地原因。[Microsoft：WebView2 browser flags](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags)

## Windows 控制台边界

PE 的 `CONSOLE` subsystem 表示字符应用，操作系统为其提供控制台；`WINDOWS` 表示程序不需要控制台。但 subsystem 本身不能排除程序随后显式创建控制台。[Microsoft：/SUBSYSTEM](https://learn.microsoft.com/en-us/cpp/build/reference/subsystem-specify-subsystem?view=msvc-170)

GUI 或 console 进程都可用 `AllocConsole` 创建控制台，或用 `CreateProcess` 的 `CREATE_NEW_CONSOLE` 为 console 子进程创建新控制台。新控制台具有窗口与独立 I/O buffer。因此仅证明宿主是 GUI PE，不足以证明 Runtime 不会出现额外控制台；应观测真实窗口、关联 PID 与创建时间。[Microsoft：Creation of a Console](https://learn.microsoft.com/en-us/windows/console/creation-of-a-console)

`CREATE_NO_WINDOW` 仅适用于 console 应用；对非 console 程序、与 `CREATE_NEW_CONSOLE` 或 `DETACHED_PROCESS` 同用时会被忽略。它描述进程创建条件，不能泛化为“无论子程序内部行为如何都不会创建窗口”的保证。`CREATE_NEW_CONSOLE` 与 `DETACHED_PROCESS` 不能组合。[Microsoft：Process Creation Flags](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags)

## Tauri 构建边界

Tauri 官方模板在非 `debug_assertions` 构建中使用 `windows_subsystem = "windows"`，注释说明其目的为避免 Windows release 宿主额外控制台。这是宿主构建约定，不能单独解释标题为 msedgewebview2.exe 的窗口。[Tauri 官方 create-tauri-app 模板](https://github.com/tauri-apps/create-tauri-app/blob/dev/templates/_base_/src-tauri/src/main.rs.lte)

Tauri 文档区分正常 build 与 `tauri build --debug`；debug 打包程序启用开发控制台，inspector 默认只在开发或 debug 构建启用，生产中需显式 Cargo feature。验收应同时记录实际 exe 路径、SHA-256、构建方式与 PE subsystem，不能只依据文件夹名字判断正式构建。[Tauri：Debug](https://v2.tauri.app/develop/debug/)

## 对本任务观测设计的推论

以下为基于上述文档的工程推论，仍须本机实验验证：

- 对普通桌面启动、WebDriver launch、必要时 attach 分别运行同一窗口观察器，不能把诊断条件的阴性或阳性结果直接推广到普通启动。
- 使用独立 data/profile，并记录实际宿主与 Runtime 的 PID、PPID、命令行、路径和窗口出现时间，保留正常渲染进程。
- 直接断言可见顶层控制台与焦点变化，启动成功、未崩溃、DOM 渲染和后台进程存在性只能作为辅助断言。
- 在来源链和复现已明确前，保留多个可证伪假设；不凭输出内容删日志、不泛化添加隐藏参数、不强杀窗口。

## 补充核验：enable-logging 与控制台分配的源码机制

以下核验承接本地已经观察到的差异，但只说明公开上游机制：同一 release 直接启动暂未见图示控制台，EdgeDriver launch 两次观察到带 `--enable-logging --remote-debugging-port=0` 的 browser 进程及其可见控制台。本段不把相关性升级为用户原触发的因果证明。Microsoft Edge / WebView2 是 Chromium 的下游产品，不能把 Chromium 源码当成已证明 Microsoft Runtime 内部完全一致的代码。

固定查看 Chromium **136.0.7103.113** tag，避免依赖可变 main：`content/app/content_main.cc` 第 306–317 行的 Windows 分支在非 headless 且存在 `enable-logging` 时调用 `RouteStdioToConsole`；是否允许创建控制台由开关值是否等于 `handle` 决定。值为空与值为 `stderr` 都允许创建。因此，**不能宣称把它改为 `enable-logging=stderr` 就具有上游源码保证的无窗效果**。[Chromium 136 content_main.cc](https://github.com/chromium/chromium/blob/136.0.7103.113/content/app/content_main.cc#L306)

`base/process/launch_win.cc` 第 154–218 行先检测 stdout/stderr 是否已有有效 CRT 底层句柄；存在则返回。否则尝试附加父控制台；若失败、且错误不是“已附加”或父进程无效，只有允许创建时才调用 `AllocConsole`，再将 stdout/stderr 连接到 `CONOUT$`。**有效输出句柄可以使这个具体函数跳过分配控制台**；但 WebView2 启动链是否继承给定句柄仍须本机验证，不能仅给 Node 或宿主重定向就认定 Runtime 已收到。[Chromium 136 launch_win.cc](https://github.com/chromium/chromium/blob/136.0.7103.113/base/process/launch_win.cc#L154)

`chrome/common/logging_chrome.cc` 第 150–204 行对 release 默认选择文件目的地；`enable-logging=stderr` 选择系统 debug log 与 stderr。`handle` 目的地只在有子进程 type 与 log-file 时采用，browser 使用此值会报无效目的地；它是内部子进程传日志句柄的机制，不能把 `enable-logging=handle` 当成受支持的 browser 无窗日志配置。[Chromium 136 logging_chrome.cc](https://github.com/chromium/chromium/blob/136.0.7103.113/chrome/common/logging_chrome.cc#L150)

Microsoft 官方为 `ms:edgeOptions.excludeSwitches` 定义的作用是排除 EdgeDriver 默认添加的命令行开关，条目不要带 `--`。这可以在差分实验中单独排除默认 `enable-logging`，记录 Runtime 实际命令行和可见窗口结果；文档没有承诺排除它后保留全部 Runtime 日志，仍不能据此宣称符合“保留诊断日志”的要求。[Microsoft：excludeSwitches](https://learn.microsoft.com/en-us/microsoft-edge/webdriver/capabilities-edge-options#edgeoptions-object)

Chromium 官方日志指南支持 `enable-logging=stderr`，同时说明 Windows 沙箱 renderer 输出未必出现在控制台，可通过 debugger 的 `OutputDebugStringA` 读取。ChromeDriver 官方说明 Windows GUI 程序的 stderr 不会按 Linux/Mac 的方式自动保存到 driver 日志，Chrome 的文件日志可用 `CHROME_LOG_FILE`；这两份资料描述 Chrome/Chromium，**不是 WebView2 对对应变量的支持承诺**。[Chromium 日志指南](https://chromium.googlesource.com/website.git/+/main/site/for-testers/enable-logging/index.md)、[ChromeDriver Logging](https://developer.chrome.com/docs/chromedriver/logging)

本次未找到 Microsoft 官方保证“只改一个 WebView2 flag 即在 Windows 无窗且完整保留 Runtime 日志”的方案。可验证的实验方向是：单独排除 driver 默认开关确认窗口因果，再单独验证可用 stdout/stderr 句柄或日志文件实际落盘；同时保留 driver 协议、原生核心与窗口观察日志。后续结论须由真实 release、原启动方式和保留日志的正向证据支持。
