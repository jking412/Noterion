# Issue #23：Windows CI / Release 官方事实核对

核对日期：2026-11-13（Asia/Shanghai）。本文件是实施依据和设计建议；不是运行成功或业务验收证据。正式要求见 [Issue #23](https://github.com/jking412/Noterion/issues/23)。

## 触发、权限和同提交来源

建议单一工作流声明 `pull_request`、`push.branches: [main]`、`push.tags: ['v*']` 和 `workflow_dispatch`。PR 的 SHA 通常是测试合并提交；push 是实际推送提交。手工输入如果允许任意 ref，必须解析成不可变 SHA，再验证来源，而不能仅用输入字符串当成可信 main。`workflow_dispatch` 工作流文件需已存在默认分支。不要使用 `pull_request_target` 运行贡献者源码。[GitHub 事件参考](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)

默认 `permissions: contents: read`，只在通过所有前置 job 的发布 job 开 `contents: write`；禁用 checkout 凭据持久化。GitHub 文档说明 action 即使没有显式传 token 也能访问 `github.token`，所以权限必须从 job 层限制。普通 PR 无需任何业务 secret。[GITHUB_TOKEN 权限](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token)

在只读 Windows job 中检查、构建、真实 smoke 和打包；发布 job 下载该 job 的指定 artifact，不重编译其他提交。manifest 记录完整 SHA，发布前同时验证当前 checkout、manifest、tag 实际指向，避免只有 release 名字正确。

## 可固定的工具与 Actions

Node `24.14.0` 有正式 LTS 发布，可与本机版本保持一致；精确固定而不是 `24` / `lts/*`。[Node 24.14.0 发布](https://nodejs.org/en/blog/release/v24.14.0)

Rust `1.93.1` 有正式发布，修复包括 rustfmt / clippy 回归；可通过 `rust-toolchain.toml` 固定 `1.93.1-x86_64-pc-windows-msvc`，组件 `rustfmt`、`clippy`。[Rust 官方发布](https://blog.rust-lang.org/2026/02/12/Rust-1.93.1/)

以下 SHA 均核对官方仓库 release 或 tag 对应 commit，而不是记忆推测：

| Action | 版本与完整 SHA | 官方依据 |
| --- | --- | --- |
| checkout | v6.0.3 `df4cb1c069e1874edd31b4311f1884172cec0e10` | [release](https://github.com/actions/checkout/releases/tag/v6.0.3)、[commit](https://github.com/actions/checkout/commit/df4cb1c069e1874edd31b4311f1884172cec0e10) |
| setup-node | v6.2.0 `6044e13b5dc448c55e2357c09f80417699197238` | [release](https://github.com/actions/setup-node/releases/tag/v6.2.0)、[commit](https://github.com/actions/setup-node/commit/6044e13b5dc448c55e2357c09f80417699197238) |
| cache | v5.0.1 `9255dc7a253b0ccc959486e2bca901246202afeb` | [commit](https://github.com/actions/cache/commit/9255dc7a253b0ccc959486e2bca901246202afeb)（GitHub API 以 `v5.0.1` 解析核对） |
| upload-artifact | v6.0.0 `b7c566a772e6b6bfb58ed0dc250532a479d7789f` | [release](https://github.com/actions/upload-artifact/releases/tag/v6.0.0)、[commit](https://github.com/actions/upload-artifact/commit/b7c566a772e6b6bfb58ed0dc250532a479d7789f) |
| download-artifact | v7.0.0 `37930b1c2abaa49bbe596cd826c3c89aef350131` | [release](https://github.com/actions/download-artifact/releases/tag/v7.0.0)、[commit](https://github.com/actions/download-artifact/commit/37930b1c2abaa49bbe596cd826c3c89aef350131) |

这些 action 使用 Node24 runtime，要求 runner 至少 `2.327.1`；现代 GitHub 托管 Windows runner 满足对应路线，实际运行仍须记录镜像版本。[checkout 说明](https://github.com/actions/checkout)、[artifact runtime 要求](https://github.com/actions/upload-artifact/releases/tag/v6.0.0)、[cache 固定版本说明](https://raw.githubusercontent.com/actions/cache/9255dc7a253b0ccc959486e2bca901246202afeb/README.md)

缓存建议仅 `~/.cargo/registry`、`~/.cargo/git`、本 worktree 的 `app/src-tauri/target`，key 包含 Windows 镜像/架构、精确 Rust、Cargo.lock、构建配置；npm 用 setup-node 对 `app/package-lock.json` 的内置 cache。不要缓存用户 config/data。cache 是加速：始终执行 npm ci、检查和 cargo --locked。需要证明冷缓存时使用独立 key 或显式不恢复缓存，不以已有缓存成功证明冷构建。[cache key/path 行为](https://raw.githubusercontent.com/actions/cache/9255dc7a253b0ccc959486e2bca901246202afeb/README.md)

## 发布事务、重跑与并发

建议 main 预发布 tag 用 `build-<完整SHA>`，显示版本用 `0.1.0-main.<SHA12>`，正式版 tag 必须为与源码统一版本对应的 `v0.1.0`。源码版本是单一维护源并有同步校验，提交 SHA 单独记录，不能把不同提交覆盖进相同发布。无需移动 latest/main 浮动 tag。

先创建 draft，再上传完整白名单资产，重新下载并校验，然后改 `draft=false`。未发布 draft 只有有 push 权限用户可见；发布 API 可设 `target_commitish`、`prerelease` 和 `make_latest`。预发布显式 `make_latest=false`，避免慢旧构建影响正式 Latest。[Releases REST API](https://docs.github.com/en/rest/releases/releases)

CLI 也支持 `--draft`、`--target <完整SHA>`、`--prerelease`、`--latest=false`。官方明确 create + upload + publish 是分立请求，不是原子事务，所以不能在上传之前公布成功。[gh release create](https://cli.github.com/manual/gh_release_create)

建议发布临界区 `concurrency` 固定全仓库发布组、`cancel-in-progress: false`，检查/构建阶段可按 PR/ref 取消旧任务。并发只保证互斥，任务顺序不能按 dispatch 次序推断；发布前重新读取 main HEAD，过期 main 作业不创建新公开 release（已发布该提交则允许只读幂等验证）。正式 tag 必须解析到检查过的 SHA，禁止移动 tag。[GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)

幂等建议：不存在 release → 新 draft；同 tag draft → 校验来源后恢复上传；同 tag published → 下载原资产、对比 SHA/manifest，完全一致即成功，不覆盖。上传失败保留不可公开 draft 以便重试。打包应含稳定可复算内容；ZIP时间戳或run URL变化会导致重跑字节变化，需稳定 ZIP时间戳并将 run provenance 同提交规则定清楚，或已发布时验证原 manifest 内部一致而不是要求新构建ZIP碰巧字节相同。禁用 `--clobber` 已发布资产。

## WebView2 / 真实便携程序 smoke

`bundle.active=false` 时按实际 exe 做 ZIP，不能声称提供 MSI/NSIS。Tauri Windows 安装说明单独描述 WebView2 安装策略；便携 ZIP 应把 Windows x64 + WebView2 Runtime 作为明确前提。[Tauri Windows 分发](https://v2.tauri.app/distribute/windows-installer/)

Microsoft Edge WebDriver 支持启动单 WebView2 实例的真实应用，或附加调试端口；driver 必须匹配实际 WebView2 Runtime。当前仓库 acceptance 的直接 WebDriver `browserName: webview2` / `ms:edgeOptions.binary` 路线可沿用，不必编译新的测试插件进发布包。[Microsoft WebView2 自动化](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/webdriver)

64位 Windows 检查以下两处 `pv`，有效版本必须大于 `0.0.0.0`：

```text
HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}
HKCU\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}
```

缺失时可从 Microsoft 官方下载 Evergreen Bootstrapper，以 `/silent /install` 执行，然后重新检测，失败应阻断。不要猜浏览器 Edge 安装版本就是 Runtime 版本，也不要改用户机器注册表来伪造已安装。[Microsoft Runtime 分发与检测](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)

下载 `https://msedgedriver.microsoft.com/<Runtime版本>/edgedriver_win64.zip`，官方目录提供各版本文件；exact patch 不存在时只能显式选择相同前三段 build 的 driver 并记录实际版本。[Microsoft driver 官方目录](https://msedgedriver.microsoft.com/catalog/index.html)、[Microsoft driver 版本规则](https://learn.microsoft.com/en-us/microsoft-edge/webdriver-chromium?tabs=python)

真实 smoke 使用测试目录隔离 `NOTERION_CONFIG_DIR`、`NOTERION_WEBVIEW_DIR`，从解压后的 exe 启动，观察 `tauri.localhost` 和真实 UI，用户动作建立知识点、重启再检索，证明 Rust 持久化；不能通过 JS 模拟IPC。额外Browser参数放 `webviewOptions.additionalBrowserArguments`；普通 `args` 会传给宿主exe。可用不可达代理阻断WebView远程HTTP/HTTPS，保留tauri/loopback；记录边界，不声称阻断全部OS网络。[Edge capabilities](https://learn.microsoft.com/en-us/microsoft-edge/webdriver/capabilities-edge-options)

Runner smoke 只覆盖可重现的启动/持久化关键路径。大视频、特定媒体编码和完整交互桌面仍须使用独立真实环境，不能搬用历史 #21 证据冒充本次 Runner 全量验收。
