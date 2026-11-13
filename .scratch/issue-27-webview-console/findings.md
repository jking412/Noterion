# Issue #27：测试启动控制台观测与停止决定

2026-11-13（Asia/Shanghai）。用户确认弹窗时由之前的验证或测试脚本启动，并决定此问题可以忽略。本次停止实施；未修改产品代码或正式验证脚本，不声明已修复。GitHub Issue 按用户决定作为 `not_planned` 处理。

## 已核实的范围

起始 HEAD 为 `f72bbf8f27284b600d503178a43628a66ca3e1a1`。在本任务专用 `codex/issue-27-webview-console` 分支整合已提交的 Windows Release 基线后，诊断基点为 `24a83a260f35fb90ad8dcd71b25d4db8c97b61dd`。仅构建自己的 worktree，不复制其他会话内容。

本轮 Release 使用 `./app/build.ps1 -Release -Offline` 构建，PE subsystem 为 2（Windows GUI），SHA-256 为 `6395fafff42548f06c7026144bf84e884035c570b32ba5eb5060a8abf504d40b`。本机实际使用的 Runtime 与验签驱动均为 `136.0.3240.76`。

| 场景 | 窗口采样 | 观测时间 | 图示控制台 |
| --- | ---: | ---: | --- |
| 同 Release 直接启动，无驱动、无附加浏览器参数 | 275 | 30.661 秒 | 0 |
| 既有 release-smoke 两次启动、保存、重启读取 | 246 | 27.507 秒 | 2 |
| 最小默认 WebDriver 启动，仅初始化、等待、退出 | 173 | 19.381 秒 | 1 |
| 重复最小默认 WebDriver 启动 | 510 | 57.008 秒 | 1 |

失败判据是可见顶层 `ConsoleWindowClass` 且标题含 `msedgewebview2.exe`，不是后台进程存在或主界面未崩溃。四个控制台均由本轮隔离 Noterion 实例的 browser 子进程拥有，父进程链关联到本轮 EdgeDriver；不是其他会话的窗口。最小两轮显式 root 关联也成立。实际浏览器参数包含 `--enable-logging` 和 `--remote-debugging-port=0`。直接启动的一轮没有这两项。

普通启动主窗口可见并正常响应关闭；既有 release-smoke 的真实 Rust 保存和新进程重启读取通过。两次最小复现通过 W3C 关闭实际 WebView 窗口，确认宿主与驱动均退出，清理无错误。没有终止其他会话或全局 WebView2 进程；所有测试数据与 profile 均隔离。

## 结论与未完成边界

用户截图现象在测试脚本启动条件下可重复出现，且不依赖知识保存、AI 或资料预览操作。普通直接启动本次未观察到该现象。用户也确认原使用场景为测试脚本启动，因此决定停止修复。

这不能推广为“所有正式使用永远不会出现”。单变量实验尚未执行，尚不能把本地因果关系最终锁定到 `enable-logging` 或其他具体参数。上游机制与官方事实见 [research.md](research.md)。没有修复前后对照，不勾选 Issue 的已修复验收项。

本次已通过前端类型检查、32 项前端测试和优化构建。未执行完整 AI/媒体回归或修复审查，因为用户已取消修复。

## 保留的证据与复现

- 用户原图：[evidence/user-console.png](evidence/user-console.png)。
- 脱敏结构化汇总：[evidence/observation-summary.json](evidence/observation-summary.json)。
- 本目录保留 `observe-webview-windows.ps1`、`normal-launch.ps1`、`diagnose-launch.mjs`、`observe-diagnose.ps1`，全部为明确的诊断工具，不是正式发布或 CI 验收入口。
- 原始窗口 JSONL、PID/PPID/参数、动作、截图、构建输入及退出结果在本 worktree 忽略的 `evidence/<run>/`；隔离依赖在 `local/`。不公开这些原始本机路径与元数据。

重新运行时从 worktree 根目录调用以下命令，使用新名称，并先构建自己的 Release 与准备匹配驱动到本目录的 `local/tools/`：

```powershell
./.scratch/issue-27-webview-console/normal-launch.ps1 -Run normal-new-01 -Seconds 30
./.scratch/issue-27-webview-console/observe-diagnose.ps1 -Run minimal-new-01 -Hold 15
```

窗口观察依赖交互 Windows 桌面与 CIM 权限。目标采样间隔 100ms，实际最大间隔记录于每轮 summary；周期采样可能漏过更短的瞬时窗口。`NO_CONSOLE_OBSERVED` 仅表示本轮观测结果，绝不等同修复完成。
