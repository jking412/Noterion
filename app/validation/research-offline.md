# 本次 WebView2 宿主的离线验收参数

日期：2026-11-12。状态：官方资料核验完成；本文没有声称已执行离线验收。

结论：通过本次 Edge WebDriver 会话的 `webviewOptions.additionalBrowserArguments`，将远程 HTTP/HTTPS 指向不可连接的本机代理，同时让应用本机地址直连。它适合检验页面、资料预览和核心操作不依赖远程网页资源；它不是操作系统级网络隔离。Microsoft 明确限定 `proxy-server` 影响 HTTP/HTTPS，因此不能据此声称 Rust、UDP 或系统外开应用的全部网络都被禁止。[WebView2 browser flags](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags?tabs=win32cpp)

## 可重现设置

先检查所选本机端口没有服务监听，例如 `34991`。不要启动代理，也不要增加 `direct://` 后备项。Chromium 官方说明：不可达的单一代理会导致 `ERR_PROXY_CONNECTION_FAILED`，`direct://` 才会明确允许失败后直连。[Chromium proxy support](https://chromium.googlesource.com/chromium/src/+/HEAD/net/docs/proxy.md)

```js
const additionalBrowserArguments = [
  'proxy-server=http://127.0.0.1:34991',
  'proxy-bypass-list=<-loopback>;tauri.localhost;ipc.localhost;127.0.0.1;[::1]',
];

// POST /session. Keep this run's isolated configuration and fresh profile.
const capabilities = { alwaysMatch: {
  browserName: 'webview2',
  'ms:edgeOptions': {
    binary: exe,
    webviewOptions: { userDataFolder: profile, additionalBrowserArguments },
  },
} };
```

`<-loopback>` 先移除 Chromium 隐式的 localhost、link-local 和未指定 IP 直连规则，再显式加回四个应用所需地址；顺序有意义。这样没有把整个局域网或 link-local 范围放进例外名单。该顺序及旁路规则语法来自 Chromium 官方说明。[Chromium bypass rules](https://chromium.googlesource.com/chromium/src/+/HEAD/net/docs/proxy.md#Proxy-bypass-rules)

Edge WebDriver 官方定义该字段为字符串列表，每个参数分别填写；`ms:edgeOptions.args` 在 WebView2 模式下传给宿主程序，不能用来配置底层 browser process。[Capabilities and EdgeOptions](https://learn.microsoft.com/en-us/microsoft-edge/webdriver/capabilities-edge-options#webviewoptions-object)

不改系统设置。每次使用新的 WebView 数据目录，核对实际 browser process 和 driver 日志确实包含两个代理参数，并确认没有冲突的 `--no-proxy-server`。[WebView2 browser flags](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags?tabs=win32cpp)

现场失败已更正了最初的配置建议：`validation/evidence/issue-21-offline-create-green-01/local/driver-1.log` 显示 EdgeDriver 136 创建宿主时重新设置 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`，其中只有驱动默认参数，没有父进程环境里设置的代理；远程网页实际加载成功。因而只给 driver 环境设置该变量不足以完成此验收。WebView2 自身会追加该环境变量的官方语义，不能证明 EdgeDriver 一定保留父进程的值。[CreateCoreWebView2EnvironmentWithOptions](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/webview2-idl?view=webview2-1.0.3537.50#createcorewebview2environmentwithoptions)

## 必须留下的现场证据

1. 在同一 WebView2 会话中，通过 WebDriver 标准导航访问 `http://offline-probe.invalid/` 和 `https://offline-probe.invalid/`，记录代理连接失败；只看到 CSP、DNS 或证书错误不足以确认该代理参数生效。这是基于上述失败语义设计的验证步骤，尚未执行。
2. 返回 `http://tauri.localhost/`，实际完成 Rust 新建/保存、搜索、重启读取以及 PDF、图片、大视频起播和拖动；保留本机 Range 读取日志。
3. 记录 Runtime、宿主与 browser PID、实际参数和独立 profile，结束后回收本次进程。Node 协议核验请求仍由 Node 自己执行；它们不自动继承 WebView2 的代理设置，不能充当页面离线证据。
4. 系统浏览器/播放器外开不受本次 WebView2 参数控制；离线业务验证不点击远程链接，外开能力另行验收。

精确表述应为“远程 HTTP/HTTPS 在本次 WebView2 中不可用时，本地完整流程通过”。若要证明所有宿主进程均无法发送任何非 loopback 数据，仍需独立进程级网络限制或隔离环境；单靠这些浏览器参数不能作此证明。
