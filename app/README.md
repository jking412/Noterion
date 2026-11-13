# Noterion Windows 本地客户端

正式任务：[GitHub Issue #21](https://github.com/jking412/Noterion/issues/21)。本目录是正式 Tauri + Rust + Vue 客户端源码。历史原型位于 `.scratch/personal-knowledge-graph/prototypes/core-ui/l2`，不再作为正式保存入口。

## 运行

从 [GitHub Releases](https://github.com/jking412/Noterion/releases) 下载 Windows x64 便携 ZIP，按附带的 `SHA256SUMS` 校验后，解压到本机可写目录并运行 `noterion.exe`。无需 Vite、Python、数据库服务器、Docker 或独立后台服务。需要 Windows x64 和 Microsoft Edge WebView2 Runtime；源码构建额外需要下面的开发工具。应用默认把知识和资料放在程序旁的 `data` 目录。程序目录不可写时，使用“数据目录”选择本机可写目录。

目录设置仅保存一个位置指针到 `%LOCALAPPDATA%/Noterion/directory.json`，不会把知识或资料自动改存到该目录。多个程序副本共享此位置设置。启动后界面始终显示实际使用的数据目录。

“创建新数据目录”仅接受不存在或空目录；“打开已有数据目录”要求有效的 Noterion 数据库。选择另一个目录不会搬迁、合并或清空原目录。目录失联、不可读或保存失败时保留明确错误，不把它显示成新空库；恢复路径后重新读取，或选择原有目录重新打开。

## 使用

- 在“知识图谱”新建知识点，名称必填，描述可留空。勾选“可作为主题”可用于组织其他知识点。同名记录保持独立，界面无需管理任何内部标识。
- 编辑面板内分别调整内容和所属主题，可同时选择多个主题，解除全部主题后仍保留独立点。自归属和循环会被拒绝。
- 搜索名称或描述的片段，加入多个关键词后选择全部/任意匹配。点击名称与摘要结果可定位图节点、阅读全文并打开资料。图谱可缩放、平移、拖动和沿主题浏览。
- 在资料库选择本机文件或填写完整路径，也可保存网页链接。文件会复制进当前数据目录；只有完整副本和记录都提交后才显示就绪。复制过程中可以取消。源文件后来移动或删除不会影响已保存副本。资料可关联多个知识点，解除关联仍保留资料。
- PDF、图片和支持编码的视频在应用内只读查看。视频支持播放、暂停及时间轴定位；格式支持由本机 WebView2 决定，不自动转码。读取或解码失败时使用“系统应用打开”访问本机副本。链接仅在用户明确打开时交给系统浏览器。
- 从图节点或详情操作菜单发起删除，先检查“将删除 / 将保留”和存活主题。仍属于其他主题的共享点保留；本次影响范围内失去全部主题的下属逐层删除；原有独立点和全部学习资料保留。没有回收站，确认后不可撤销。
- “知识导入”和“导入记录”保留已认可的导航位置。AI 纯文本提取尚待 [#20](https://github.com/jking412/Noterion/issues/20) 确定，当前不接云模型，也不发送本机资料。可用手工知识点录入完成其余本地流程。

## 开发与构建

环境：Windows x64，Node 版本见根 `.node-version`，Rust 及组件见根 `rust-toolchain.toml`，Visual Studio 2022 C++ x64 工具与 Windows SDK，WebView2 Runtime。npm 和 Cargo 依赖由各锁文件固定；本机原生文件选择使用 rfd，正式存储使用随程序编译的 SQLite。

在仓库根目录运行：

```powershell
cd app
npm.cmd ci
npm.cmd run typecheck
cd ..
./app/build.ps1
```

`build.ps1` 自动加载 VS 编译环境，构建并嵌入前端资源，输出 `app/dist-desktop/noterion.exe`。首次需要联网下载开发依赖，安装后的本地核心功能无需联网。缓存已就绪时可加 `-Offline`；优化版必须加 `-Release`。脚本使用正常 Cargo home，默认 target 为 `app/src-tauri/target`，也尊重调用方的 `CARGO_HOME` 和 `CARGO_TARGET_DIR`。发布与维护命令见 [发布说明](../docs/releasing.md)。

日常前端开发可用 `npm.cmd run dev` 查看布局，但普通浏览器没有本地核心，不会模拟成功保存。正式开发/验收必须构建真实 exe；仅启动网页不构成客户端运行。

## 数据和实现

唯一正式数据源为数据根目录中的 `noterion.sqlite3`，包含知识点、所属主题、资料记录及关联、节点位置和事务版本号。SQLite 使用 WAL 和 FULL 同步；退出时应连同整个数据目录保留。不要只复制正在运行的单个数据库文件。文件副本位于 `files/`，以应用生成的身份和安全扩展名存储，原文件名另作元数据。知识删除不清理这些文件。

Rust 负责完整关系校验、事务提交、目录与文件操作。文件复制使用 128 KiB 缓冲，复制未完成或失败不创建就绪资料。意外退出可能留下未登记的临时或孤立副本，它们不会出现在资料库，也不会被误认为已保存记录。当前不提供自动整库迁移、备份恢复或文件去重。

内置播放器使用进程内随机 loopback 端口和不可猜测的会话令牌读取受控副本，支持 HTTP Range、完整 GET、HEAD 和断连取消。每次请求使用 64 KiB 缓冲，最多 4 个并发读取，不把大文件传成前端 base64/Blob 或一次性 IPC。关闭预览会撤销令牌。该读取器与程序同生共退，无独立服务安装。

同一窗口串行提交操作；删除预览附带版本检查。不同进程同时编辑同一知识点时采用最后一次明确保存的内容，当前没有多窗口协同编辑功能。

## 验收和边界

真实 Windows WebView2 验收入口、驱动准备条件和运行证据见 [validation/README.md](validation/README.md)。使用标准 W3C WebDriver 操作真实 exe，脚本执行仅用于只读观察，不注入业务数据或模拟 Rust IPC。实际结果与媒体编码范围在验证报告中逐项记录；编译和类型检查不代替桌面验收。

用于隔离验收的环境变量：`NOTERION_CONFIG_DIR` 同时隔离目录指针和默认数据目录，`NOTERION_WEBVIEW_DIR` 隔离 WebView profile，`NOTERION_MEDIA_AUDIT` 指定本机文件读取证据日志。日常使用无需设置。
