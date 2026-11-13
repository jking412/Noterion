# Issue #21 Windows 桌面验收

本目录以真实嵌入资源的 Tauri 程序为验收对象，使用 Microsoft Edge WebDriver 的 `webview2` 模式。业务输入、点击和拖动通过标准 W3C WebDriver；JavaScript 仅只读观察页面、环境和媒体属性，不模拟 IPC 或注入正式知识。完整结果见 [最终验收报告](final-acceptance.md) 和 [结构化汇总](final-summary.json)。

## 准备

Windows x64、已登录交互桌面、与 WebView2 Runtime 匹配的 msedgedriver、Node 24。驱动准备可复用仓库 `.scratch/personal-knowledge-graph/validation/windows-desktop/setup-webdriver.ps1`。本机实际 Runtime/Driver 为 136.0.3240.76。

构建后默认程序在 `app/dist-desktop/noterion.exe`。runner接受 `--exe`、`--driver`、`--fixtures-root`、`--port`、`--output`，不依赖开发服务器。媒体样本沿用仓库 validation/video-playback 中实际合成的 1,277,422,426 字节 MP4，以及 WebM/MKV 和原型 PDF/PNG；样本路径和生成依据在历史验证目录中，历史服务证据不替代本轮本地路径结果。

```powershell
node app/scripts/acceptance.mjs --run=issue-21-your-new-full-run --scenario=all --offline=true --exe=D:/person/application/knowledgeGraph/app/dist-desktop/noterion.exe --fixtures-root=D:/person/application/knowledgeGraph
node app/scripts/acceptance.mjs --run=issue-21-your-new-ordinary-delete --scenario=ordinarydelete --offline=true --exe=D:/person/application/knowledgeGraph/app/dist-desktop/noterion.exe --fixtures-root=D:/person/application/knowledgeGraph
```

每个run名称必须唯一，已有证据不会覆盖。默认输出在 `evidence/<run>/`，配置、数据、WebView profile 和故障夹具严格隔离在该run的 `local/`。不接触用户正式数据。故障注入涉及loopback、进程管理或该run目录权限时，执行宿主可能要求现有沙箱审批，不修改系统安全配置。

## 场景

`all` 包含新建/编辑/搜索/主题、图谱拖动/平移缩放、重启与删除、WebM、图片/PDF/大MP4、资料复用、目录可靠性、事务锁/目录权限/空间不足。`ordinarydelete` 单独补充普通知识点的成功删除与资料保留。

细分入口：`create`、`core`、`graphinteraction`、`pdf`、`webm`、`media`、`reliability`、`storagefaults`、`spacefault`。`--expect-created=INTENTIONALLY_WRONG` 是应失败的可见结果红色对照，不能计入成功断言。

`graphfailure` 要求调试构建（`./app/build.ps1 -Offline`），只在该宿主环境设置 `NOTERION_GRAPH_FAIL_ONCE=1`，使真实GraphCanvas setup抛出一次异常，由正式GraphBoundary捕获。随后通过同一真实UI保存、搜索、读取资料并恢复图谱。优化版不注入该标记，没有生产诊断按钮。

`storagefaults` 的 Python helper 只持有空 SQLite 写事务，不读取/修改facts；目录ACL故障仅作用于run内files目录，finally按原SDDL恢复。`spacefault` 设置run内稀疏源的逻辑大小超过该卷实际调用者可用空间，验证复制前拒绝，不填满磁盘；回归安全阈值会取消异常开始的复制。

## 离线和媒体证据

`--offline=true` 通过官方 `webviewOptions.additionalBrowserArguments` 配置不可达代理，启动后实际导航 HTTP/HTTPS，必须得到 `ERR_PROXY_CONNECTION_FAILED` 并核对进程参数，再返回 `http://tauri.localhost/` 执行完整本地业务。不修改系统代理、网卡、注册表或防火墙。边界是本次WebView2远程HTTP/HTTPS不可用；不声称所有OS、Rust socket或外开应用被系统级隔离。Rust核心未接入任何远程业务依赖。官方依据与失败配置修正见 [research-offline.md](research-offline.md)。

媒体断言实际解码帧、时间推进和指针拖动；范围字节与源文件独立比较，完整GET核对SHA-256，取消后核对Rust实际读写字节。每次64KiB读取而非整视频IPC、base64或大Blob。资源采样记录真实宿主/WebView2进程，工作集相加会包含共享页，不等于独占物理内存。

PDF的iframe出现或load事件不能认定内容可见。runner等待内置查看器渲染后截图，最终报告单独记录真实正文视检结论。

原始WebDriver协议、截图、HTML、Rust审计、资源采样、会话与清理状态保留在选定证据目录；local profile/测试副本不纳入源码。汇总脚本：

```powershell
node app/scripts/summarize-acceptance.mjs issue-21-offline-release-all-03 issue-21-ordinarydelete-release-01 issue-21-graphfailure-green-01 issue-21-create-red-01
```
