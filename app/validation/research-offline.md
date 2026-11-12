# 本次 WebView2 宿主的离线验收参数

日期：2026-11-12。状态：官方资料核验完成；本文没有声称已执行离线验收。

结论：可以只为本次驱动及其宿主设置环境变量，将远程 HTTP/HTTPS 指向不可连接的本机代理，同时让应用本机地址直连。它适合检验页面、资料预览和核心操作不依赖远程网页资源；它不是操作系统级网络隔离。Microsoft 明确限定 `proxy-server` 影响 HTTP/HTTPS，因此不能据此声称 Rust、UDP 或系统外开应用的全部网络都被禁止。[WebView2 browser flags](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags?tabs=win32cpp)

## 可重现设置

先检查所选本机端口没有服务监听，例如 `34991`。不要启动代理，也不要增加 `direct://` 后备项。Chromium 官方说明：不可达的单一代理会导致 `ERR_PROXY_CONNECTION_FAILED`，`direct://` 才会明确允许失败后直连。[Chromium proxy support](https://chromium.googlesource.com/chromium/src/+/HEAD/net/docs/proxy.md)

```js
const offlineArguments = [
  '--proxy-server=http://127.0.0.1:34991',
  '--proxy-bypass-list="<-loopback>;tauri.localhost;ipc.localhost;127.0.0.1;[::1]"',
].join(' ');

// Set only this child process's environment. Keep the existing per-run
// NOTERION_CONFIG_DIR, NOTERION_WEBVIEW_DIR and fresh profile settings.
const driver = spawn(driverExe, driverArguments, {
  windowsHide: true,
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: offlineArguments,
    TAURI_WEBVIEW_AUTOMATION: 'true',
  },
});
```

`<-loopback>` 先移除 Chromium 隐式的 localhost、link-local 和未指定 IP 直连规则，再显式加回四个应用所需地址；顺序有意义。这样没有把整个局域网或 link-local 范围放进例外名单。该顺序及旁路规则语法来自 Chromium 官方说明。[Chromium bypass rules](https://chromium.googlesource.com/chromium/src/+/HEAD/net/docs/proxy.md#Proxy-bypass-rules)

环境变量是 WebView2 官方测试入口，只应用于本次新建进程；不要写注册表、修改系统代理或网卡。Microsoft 说明提升为管理员的宿主可能忽略环境设置，且这些开关只用于开发诊断。因此每次使用新的 WebView 数据目录，并核对实际 browser process 命令行包含上述两个参数，不能只记录父进程环境就认定生效。[WebView2 browser flags](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags?tabs=win32cpp)

## 必须留下的现场证据

1. 在同一 WebView2 会话中，通过 WebDriver 标准导航访问 `http://offline-probe.invalid/` 和 `https://offline-probe.invalid/`，记录代理连接失败；只看到 CSP、DNS 或证书错误不足以确认该代理参数生效。这是基于上述失败语义设计的验证步骤，尚未执行。
2. 返回 `http://tauri.localhost/`，实际完成 Rust 新建/保存、搜索、重启读取以及 PDF、图片、大视频起播和拖动；保留本机 Range 读取日志。
3. 记录 Runtime、宿主与 browser PID、实际参数和独立 profile，结束后回收本次进程。Node 协议核验请求仍由 Node 自己执行；它们不自动继承 WebView2 的代理设置，不能充当页面离线证据。
4. 系统浏览器/播放器外开不受本次 WebView2 参数控制；离线业务验证不点击远程链接，外开能力另行验收。

精确表述应为“远程 HTTP/HTTPS 在本次 WebView2 中不可用时，本地完整流程通过”。若要证明所有宿主进程均无法发送任何非 loopback 数据，仍需独立进程级网络限制或隔离环境；单靠这些浏览器参数不能作此证明。
