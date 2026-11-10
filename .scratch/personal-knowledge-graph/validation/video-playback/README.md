# Issue #13：真实 Windows WebView 大视频按需读取

任务来源：[Issue #13](https://github.com/jking412/Noterion/issues/13)。本目录只验证资料查看路径；正式应用功能、PostgreSQL 资料保存、安装器和其他 Issue 不在本次实现中。开始时共享 checkout 为 `main`，基点 `c5c4312d177f752e35788dd23f7e86b4503a5518`。其他聊天的文件与服务未纳入本任务修改。

最终证据以 `evidence/summary.json`、各运行目录和 `evidence/review.md` 为准。早期播放通过但缺少进程资源时间序列的 `all-02/all-03` 仅作为行为证据；最终验收采用强制采样的 `all-04/all-05`，每次均独立启动、删除 WebDriver session 并确认真实宿主退出。错误预期对照应当失败。

## 固定环境与真实样本

- Windows x64，Tauri `2.10.3` / tauri-build `2.5.6`，Rust `1.93.1`，完整版本锁在 `Cargo.lock`。
- 实际 WebView2 Runtime 与 Microsoft Edge WebDriver 均为 `136.0.3240.76`。驱动只读复用 Issue #3 的 `.tools/issue3-webdriver/msedgedriver.exe`；直接由 WebDriver 的 `webview2` 模式启动本目录 exe，不使用 Computer Use 或浏览器 mock IPC。
- RustFS `1.0.4`，实际镜像摘要 `sha256:ed9210d6411d77ffceb70d94b964a3cb7d225983368bc25bebe01e995293dcc2`；`aws-sdk-s3 =1.122.0`，官方 Rustls/Ring HTTP 客户端 `aws-smithy-http-client =1.1.13`。
- 对象服务只绑定 `127.0.0.1:19300`，容器 `issue-13-rustfs`、卷 `issue-13-object-storage-data`，标签 `noterion.issue=13`；bucket `issue-13-video`，key 以 `issue-13/` 开头。未接管 Issue #10 及其他服务或数据。
- `ffmpeg/ffprobe/ffplay 9.0.1` 已安装。播放器是本次明确选择的外部 ffplay，未声称已验收 Windows 任意默认播放器或软件分发。

| 样本 | 实际内容 | 实际结果 |
| --- | --- | --- |
| MP4 / H.264 Constrained Baseline、yuv420p / AAC | **1,277,422,426 字节**，720 秒，1280×720 / 30 fps，faststart | 真实起播、远距离拖动及继续播放；上游实际 206 与非零 Range |
| WebM / VP9 / Opus | 1,845,591 字节，12 秒 | 真实起播、指针拖动、解码帧与时间推进 |
| Matroska / FFV1 / PCM | 10,937,767 字节，6 秒 | 本 Runtime 只接受音频轨，视频宽高与解码帧均为零，无 `video.error`；明确提示 `NO_VIDEO_TRACK` 后从对象服务生成校验缓存，在外部窗口播放至约 5.95 秒 |

全部媒体均为动态测试画面与正弦音，没有用户资料。主视频实际编码 packet 共 1,276,798,578 字节，占文件 99.95%，使用 CRF 编码，没有恒码率 filler、尾部填零或稀疏占位文件。三个文件分别从开头、中部、结尾附近实际解码，9 项均通过。生成命令、完整 ffprobe、大小、摘要与解码记录在 `evidence/samples.json`。主样本 SHA-256：`4c93ae3aba536be8a84d0498a2460dfab67fc309803eb2120613e0abd8ff00a7`。

`--upload` 用 Rust SDK 按 8 MiB 文件区间上传，然后完整流式读回核对独立源摘要。`evidence/objects.json` 只保存稳定连接身份、bucket/key、大小、mime 与摘要。所有播放运行是上传完成后的新宿主进程。

## 采用的读取路径与实测行为

`HTML video → 宿主内 127.0.0.1:19310 临时入口 → Rust S3 GetObject → RustFS`。入口限固定样本和当前会话 token，不接受任意 endpoint 或磁盘路径。服务与 Tauri 生命周期相同，不增加常驻转发进程。前端只将临时入口设为媒体源，不接收整个文件的 IPC、base64 或大 Blob。

应用自写缓冲为每连接 64 KiB，最多 4 个活动连接，请求头上限 16 KiB，读写有超时。SDK、TCP、WebView 和 GPU 仍有自己的缓存，**64 KiB 不是整个程序的总内存上限**。用户代理可以先请求 `bytes=0-`，再在缓冲足够时取消；这不等于客户端读完该开放区间。日志用官方 SDK interceptor 记录真正上游状态，同时记录请求 Range、上游 Range、Content-Range、声明长度、实际读写字节、取消及耗时。

最终两轮实际包括：

1. 主样本起播并输出解码帧，拖动到约 539.5 秒后继续播放。对象服务收到 `bytes=954630144-`，真实返回 206；未读完余下约 323 MB 即停止读取。
2. `bytes=1000000000-1000000031` 实际返回 32 字节，与源文件同一远端位置一致；越界区间在对象服务及转发端均为 416。
3. `no-range` 诊断模式主动忽略客户端 Range，上游执行真正普通 GET，下游如实返回 200 和全对象长度。WebView 可以起播；此模式不承诺远端拖动。
4. 另一个无 Range HTTP 客户端完整消费 1,277,422,426 字节，按块计算摘要并匹配源文件；另一次在约 8 MiB 取消，上游实际读取低于预先声明的 64 MiB 实验界限。普通 GET 取消不是伪造完整成功响应。
5. 所有媒体元素明确使用 `crossorigin="anonymous"`。受控入口只允许实际页面 origin `http://tauri.localhost`，暴露必要响应头。真实跨源媒体加载与播放通过。
6. 直接签名路径仅作协议探针：前端只请求 32 字节且先要求 206 / 正确长度，6.5 秒后用旧签名读取新区域返回 403，再由稳定引用生成新签名后恢复 206。直接 RustFS 响应的 `Content-Range` 与 ACAO 不是本配置下可供 JS 读取的暴露头，探针记录为 `null`；浏览器成功读取响应体本身证明 CORS 允许该读取。正式验证采用受控转发，不依赖前端长持临时签名或其自动续期。

完整普通 GET 最终仍传输了整个对象；有界流式处理不会把它变成按需请求。需要远距离拖动时应采用实测 Range 路径。`preload` 与 `canPlayType` 均没有被用作通过条件。[官方事实与适用范围](research-media.md) 仅支持实验设计，不能代替上述执行证据。

## 资源证据与适用边界

`evidence/summary.json` 汇总最终两轮的起播、拖动、应用 RSS/私有字节、WebView 进程组 RSS/私有字节、实际记录的 JS heap、profile 磁盘、全流客户端峰值与取消字节。原始 Windows 观测在运行目录的 `resources.jsonl`：约每 0.5 秒加采集耗时，实际时间戳保留。进程组 RSS 会重复计入共享页，不能当作精确物理内存；JS heap 记录值也不是所有瞬时分配的证明。

对象服务由 `sample-service.ps1` 独立记录，Docker CLI 采样实际约 2 秒一次。`service-resources.jsonl` 覆盖上传及先前完整播放轮次。`service-memory-detail.json` 显示一次约 1.66 GB 的 cgroup 使用中 file 类约 1.42 GB，而 RustFS 进程 RSS 约 257 MiB；最终 `service-memory-final.json` 中 file 类降到约 94 MB、进程 RSS 约 294 MiB，期间未重启或改配置。必须为对象服务与操作系统页缓存另留资源，不能把前端有界误写成整个对象服务始终只占 64 KiB。

内置播放没有创建整视频查看副本；WebView 自身 profile 的磁盘成本单独采样。外部打开需要完整本机派生缓存，本次 FFV1 缓存 **10,937,767 字节**；若外开大文件，磁盘成本随文件大小增长。缓存不是正式来源，没有扩展自动清理、外部编辑或通用转码政策。

本次只证明当前活动 Windows 桌面、固定 Runtime/服务/SDK、这些真实编码样本和本机 loopback 路径。未验收真实云端、TLS、远程网络波动、过期临时云凭据刷新、锁屏/RDP/无人值守 CI、2 GiB 边界、所有 MP4 编码、HEVC 插件、安装包分发、自动转码、系统默认播放器及长时间压力。1–2 GB 是实际场景，未被写成产品文件上限或统一性能门槛。

## 复现

前置条件：上述 Windows 工具链、正在运行的 Docker Engine、ffmpeg/ffplay、匹配的 WebDriver。当前 Codex 沙箱内无法使用本机 socket 或 Docker pipe，Rust canonicalize 也曾被拒绝；本次相应动作通过自动审批的沙箱外执行完成，不修改全局安全、代理或工具链设置。普通本机 PowerShell 不需要人为模拟该沙箱限制。

```powershell
cd D:\person\application\knowledgeGraph\.scratch\personal-knowledge-graph\validation\video-playback
./generate-samples.ps1
./start-service.ps1
./build.ps1 -SeedFromExistingCache -Offline
./run-validation.ps1 -Phase upload
node ./webdriver-video.mjs --run=issue-13-new-full-a --scenario=all
node ./webdriver-video.mjs --run=issue-13-new-full-b --scenario=all
```

`generate-samples.ps1` 拒绝覆盖现有样本；已有本次样本时跳过生成。`start-service.ps1` 核对标签、固定镜像、唯一 loopback 端口和卷，拒绝接管所有权不符资源。首次没有前置缓存时用 `build.ps1` 在线构建；`-SeedFromExistingCache` 只读复制 Issue #3/#10 缓存到本目录 `.local/cargo-home`，不写前置目录。锁文件已由 Cargo 生成，正常构建使用 `--locked`。

每次 run ID 必须全新，runner 拒绝覆盖旧证据。`--scenario=start/playback/seek/codec/all` 可缩短反馈；完整验收使用 `all`。`sample-resources.ps1` 的首次写入、运行存活和最后观测覆盖是通过条件，采样器 stderr 放在忽略的 `.local/runs/<id>/`。服务端另开窗口执行 `./sample-service.ps1 -Seconds 120 -Phase replay`。`verify-evidence.mjs` 是本次交付的固定证据审计，固定核对 `all-04/all-05` 和错误预期对照；新运行按同一字段人工或调整审计的运行名核对。

随机本地凭据只在忽略的 `.local/service.env` 与 Rust/服务环境中。完整签名 URL、临时入口 token、驱动原始日志、WebView profile、Cargo 缓存与真实媒体均留在忽略目录，未提交；截图与证据只显示安全 metadata。测试退出后回收自己创建的宿主/驱动；外部 ffplay 在 6 秒样本结束后自动退出。隔离对象容器、卷及合成对象保留供复现，没有删除已有数据。

实施实际使用 implement、tdd、research、diagnosing-bugs；红绿与实际故障见 `evidence/tdd-history.md`。交付前 Standards 与 Spec 两轴并行 code-review 的结果见 `evidence/review.md`。
