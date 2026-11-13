# Issue #3：真实 Tauri WebView2 的 WebDriver 验收路径

核验日期：2026-11-07（Asia/Shanghai）。应用 `research`，承接用户最新要求：Computer Use 不作为验收标准。本文仅核验替代路径，实际通过须由本目录的 WebDriver 执行证据证明。未安装驱动、未运行服务、未修改其他文件。

## 结论

可以直接使用 Microsoft Edge WebDriver 的 **WebView2 模式**驱动真实 Tauri exe，再以 W3C WebDriver 的元素输入、点击、可见文本和截图接口验收。最小宿主启动时立即创建单个 WebView2，符合 Microsoft 的 launch 路径条件；可优先直接由驱动启动宿主，省去 Computer Use 与普通浏览器替身。[Microsoft WebView2 WebDriver：launch 与 attach](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/webdriver#step-4-choosing-whether-microsoft-edge-webdriver-should-launch-your-app-or-attach-to-it)。

## 准确的新会话 JSON

Microsoft 文档以 C# `EdgeOptions.UseWebView=true` 演示。Selenium 官方源码明确其实际作用是把 `browserName` 设为 `webview2`，而非发送名为 `useWebView` 的扩展字段；`ms:edgeOptions` 是具体选项容器。[Selenium EdgeOptions 源码](https://github.com/SeleniumHQ/selenium/blob/trunk/dotnet/src/webdriver/Edge/EdgeOptions.cs)。

向本任务独占的 `msedgedriver` 端口发 `POST /session`：

```json
{
  "capabilities": {
    "alwaysMatch": {
      "browserName": "webview2",
      "ms:edgeOptions": {
        "binary": "D:\\person\\application\\knowledgeGraph\\.scratch\\personal-knowledge-graph\\validation\\windows-desktop\\target\\debug\\issue3-windows-smoke.exe",
        "webviewOptions": {
          "userDataFolder": "D:\\person\\application\\knowledgeGraph\\.scratch\\personal-knowledge-graph\\validation\\windows-desktop\\evidence\\issue3-wd-new-run\\webview-data"
        }
      }
    }
  }
}
```

`binary` 指向宿主。`args` 是传给宿主的参数；WebView2 浏览器参数应放 `webviewOptions.additionalBrowserArguments`。`userDataFolder` 可隔离本次运行数据。应确保驱动进程继承宿主需要的 `ISSUE3_*` 环境，并将其用户数据配置与宿主的绝对 `data_directory` 指向同一目录。[Microsoft Edge capabilities](https://learn.microsoft.com/en-us/microsoft-edge/webdriver/capabilities-edge-options#edgeoptions-object)、[webviewOptions](https://learn.microsoft.com/en-us/microsoft-edge/webdriver/capabilities-edge-options#webviewoptions-object)。最后一句是本宿主的工程推断，须实际启动核验。

若 launch 不兼容，则由测试进程直接启动宿主并使该实例的 WebView2 获得 `--remote-debugging-port=<独占端口>`，新会话改为 `browserName=webview2` 与 `ms:edgeOptions.debuggerAddress="127.0.0.1:<端口>"`，不再传 `binary`。Microsoft 明确支持此 attach 路径。[Microsoft attach 步骤](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/webdriver#step-4b-attaching-microsoft-edge-webdriver-to-a-running-webview2-app)。调试仅限测试实例，不修改系统注册表或其他应用。

## Tauri 官方路径的交叉核对

Tauri `tauri-driver` 在 Windows 使用原生 `msedgedriver.exe`；可从 PATH 找到，或以 `--native-driver` 指定。它是中介，直接使用原生驱动同样能驱动 WebView2。[Tauri manual setup](https://v2.tauri.app/develop/tests/webdriver/manual-setup/)。

Tauri 官方源码把 `tauri:options.application` 映射为 `browserName="webview2"`、`ms:edgeOptions.binary`，并加 `ms:edgeChromium=true`；`webviewOptions` 原样转发。原生驱动启动环境还设置 `TAURI_AUTOMATION=true` 与 `TAURI_WEBVIEW_AUTOMATION=true`。这些是 dev 分支在核验时的实现证据，不是本验证已经固定安装的 `tauri-driver` 版本。[capabilities 映射](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-driver/src/server.rs)、[原生驱动启动](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-driver/src/webdriver.rs)。本次可直接走原生驱动，避免再增加一个中介进程。

## 固定 136.0.3240.76 驱动下载

驱动版本应匹配**宿主实际使用的 WebView2 Runtime**，而非另一份普通 Edge 浏览器的版本。[Microsoft 版本要求](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/webdriver#step-2-install-microsoft-edge-webdriver)。现有 `evidence/environment.json` 已实测宿主使用 `136.0.3240.76`。

本机于核验时，以沙箱外只读 HEAD 请求确认下列官方地址可用：

- 下载：[Microsoft Edge Driver 136.0.3240.76 x64 ZIP](https://msedgedriver.microsoft.com/136.0.3240.76/edgedriver_win64.zip)。
- HTTP `200 OK`，`Content-Type: application/x-zip-compressed`。
- `Content-Length: 10973922`；`Content-MD5: JNaVQDuX8wzvrlRj7sPxDw==`。
- `Last-Modified: Thu, 15 May 2025 17:43:13 GMT`。

旧 `msedgedriver.azureedge.net` 地址在本机 DNS 解析失败。沙箱内两个域名均无法解析，因此网络失败须区分沙箱权限与资源不存在；最终下载应保留来源、驱动 `--version` 与 SHA256，不只依赖本 HEAD 记录。官方产品入口为 [Microsoft Edge WebDriver](https://developer.microsoft.com/en-us/microsoft-edge/tools/webdriver/)。

## 验收断言建议

用标准接口查找 `#request`，清空并发送文本，点击提交按钮，再轮询读取 `#status` 的 rendered text。断言已知字面量、调用次数和实际 Rust PID；归档截图与独立 Rust 记录。不要通过 `executeScript` 直接调用 command 或改写结果。W3C 为元素清空、输入、点击、获取文本及截图规定了对应端点。[W3C WebDriver 接口](https://www.w3.org/TR/webdriver2/#endpoints)。

推荐至少两次独立启动同一 exe，运行相同成功与拒绝场景；一次错误预期必须使测试退出失败。删除会话和进程回收应由测试 runner 明确处理，只清理本次创建的进程。活动桌面、锁屏、RDP、CI 与安装器能力仍按实际执行如实记录，不因采用 WebDriver 自动扩张已验证环境。
