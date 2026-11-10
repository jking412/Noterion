# Issue #13：实际反馈、红绿与证据审计

约定边界来自正式规格 Testing Decisions 与本任务指示：真实 Windows Tauri/WebView 用户操作、对象读取和外部打开的可观察结果。不对内部 Rust 函数、组件层级或私有状态逐项测试。实际使用 Matt implement、tdd、research、diagnosing-bugs，最终按 code-review 两轴独立审查。

## Tracer 与真实桌面

- `webdriver-video.mjs --run=issue-13-red-before-host --scenario=start` 在宿主实现前运行，真实失败为缺少 exe，退出 1。此阶段仅证明缺少运行路径，不能替代真实 UI 断言的灵敏性。
- `issue-13-start-green-01`：驱动已启动，但 Node localhost fetch failed；独立 PowerShell 请求也报 socket 权限拒绝。排序假设：沙箱网络限制、代理、驱动启动异常。只改变执行权限、保持相同代码后 `issue-13-start-green-02` 实际通过。未修改系统网络或安全设置。
- `issue-13-playback-01` 通过真实元素点击、可见 PLAYING、720 秒 metadata、1280×720 视频帧、时间推进与真实 Rust PID。此轮起播约 290 ms。
- `issue-13-seek-01` 通过标准 pointer actions 拖动到约 539.5 秒；非零 Range / 真正上游 206、远端 32 字节比对和越界 416 全部通过。

## 编码失败反馈：真实红 → 绿

完整 `issue-13-all-01` 在前 10 项行为通过后，等待 FFV1 的 `video.error` 超时，退出 1。最小观测为 `readyState=4`、`duration=6`、视频宽高和解码帧均为 0、`errorCode=null`。该 Runtime 保留了 PCM 音频轨，没有可解码视频轨。

排序假设：① demux 后只剩音频，而 UI 把 metadata 载入误判为视频就绪；② 视频尺寸会稍后出现；③ 样本本身损坏。固定样本已被 ffmpeg 从三个位置解码；在持续等待后尺寸仍为零，支持①。没有将容器扩展名当作失败依据。

先把断言改为可检测真实的“错误事件或缺少视频轨”，同时要求可见 `UNSUPPORTED`。`issue-13-audio-only-red --scenario=codec` 在旧 exe 上确切失败：UI 仍显示 READY TO PLAY；`failure-media.json` 保留零视频尺寸与空错误码。随后只补 `loadedmetadata/playing` 对无视频轨的提示，不伪造浏览器错误。重建后 `issue-13-codec-green-01` 的 7 项实际断言通过；FFV1 显示 NO_VIDEO_TRACK，外部播放器有可见原生窗口且播放时钟推进到 5.95 秒。

外部 ffplay 原命令还包含它不支持的 `-nostdin`；真实 CLI `ffplay -nostdin -version` 返回 1 和 Option not found（`ffplay-invalid-option.txt`）。移除此选项，保留空 stdin。不能把 PID 返回成功当作实际解码通过。

## 资源证据缺失：审计红 → 强制观测绿

`all-02/all-03` 均返回 13 项行为通过，但独立 `verify-evidence.mjs` 读取资源时间序列时报 ENOENT。两轮因此没有被用作完整验收。旧采样器 stderr 被丢弃，无法事后确定这两次退出的根因；没有把推测写成事实。

runner 随后保存采样器 stdout/stderr，并强制要求首次真实写入、全程存活、末尾观测小于 5 秒以及完整流程至少 20 个样本。`issue-13-resource-red` 是历史运行名，其实际结果为 PASS，仅验证新观测路径可用；不冒充失败。最终 `all-04/all-05` 在同一 exe 上分别保留 37/38 条实际观测，并通过 13 项行为断言和资源覆盖条件。独立审计同时验证真正上游完整普通 GET 字节数、取消读取、媒体、签名与资源证据后才输出 summary PASS。

## 灵敏性、重复与范围

- `issue-13-negative-visible --scenario=playback --expect-playing=INTENTIONAL_MISMATCH`：真实视频已输出帧、可见结果为 PLAYING，错误字面量预期使测试退出 1，且 session 删除、宿主退出。它证明实际 UI 断言可以失败。
- 最终 `all-04/all-05` 使用相同 exe `f3b79759976cedc3117d98d59ce5208a68351acfe5199475ee152c3e63163b58`，均为新原生宿主进程。每轮完整流式读取 1,277,422,426 字节并核对独立源摘要。
- Docker 启动、Cargo canonicalize 的沙箱权限与依赖缓存源不一致均按真实错误处理。Docker Desktop 通过审批后隐藏启动；仅创建有 issue-13 标签的资源。Cargo 缓存统一到本目录 canonical crates.io 源，最终锁文件由 Cargo 生成，未保留手工合并图。离线构建/check/clippy 成功。
- 没有声称整个宿主都严格测试先行：最初 tracer 先于宿主，随后在真实外部边界上逐个增加观察；FFV1 业务修复有实际红绿，资源证据由独立审计先红后补强。不新增私有模块测试边界，不以编译或短视频替代大视频验收。

没有实质业务范围变化，没有新增用户决定。正式应用实施、云端、系统默认播放器和长时间压力等未执行项见 README。

## Spec 审查发现的 BOM 复现问题

Windows PowerShell 5.1 的 `Set-Content -Encoding utf8` 会生成带 BOM 的 JSON。旧 runner 直接 JSON.parse，和审计脚本的处理不一致。实际把 `evidence/samples.json` 保存成带 BOM 文件后，旧解析命令确切返回 SyntaxError / Unexpected token，随后才补 runner 剥离开头 BOM 的规则。元数据保留 BOM，不改变视频字节或摘要。`all-06` 再次以同一真实 exe 完成 13 项行为断言及 39 条全程资源观测，完整普通 GET 和外部播放均通过。最终独立审计采用 all-05/all-06，PASS；源码末尾空行的清理仅作静态检查，不改变媒体逻辑。
