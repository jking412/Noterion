# 文件资料的两种查看体验

核验日期：2026-11-07（Asia/Shanghai）。应用 research 技能，只核验官方文档及项目源码，没有安装插件、实现预览或运行样本。用户已明确：PDF、图片、文档及单文件 1–2GB 的本地视频都是真实场景；文件由系统管理，只需查看，不要求在系统外编辑、移动或改名。**文件保存后端与查看体验尚未选择。**

后续决定（同日）：用户已选择对象存储（本地或云端可配置），并把内置/外部查看交给代理决定。Noterion 当前默认内置只读查看 PDF、图片及支持的视频，外部打开兜底，详见 [ADR 0003](../../../docs/adr/0003-use-configurable-object-storage.md)。以下保留选择前的技术比较，不改变格式与大视频验证边界。

## 先区分两个维度

“保存在哪里”决定文件字节的存储和读取方式；“怎样查看”决定点击资料后的窗口与交互。应用管理的本机文件既可以外部打开，也可以内置预览；对象服务里的文件同样可以配内置读取或先落到本机缓存再外部打开。两者有不同的工程代价，不能由“系统保存本体”或“只查看”推出必须内置播放器，也不能由“希望内置”推出必须使用对象存储。

## 两条体验路线

| 体验 | 官方可用路径 | 价值与代价（本项目判断） |
| --- | --- | --- |
| **系统默认软件打开** | Tauri opener 的 `openPath` 接收本地路径，交给系统默认应用，也可以指定应用；打开范围需受控。[Tauri Opener API](https://v2.tauri.app/reference/javascript/opener/)。 | 复用用户已有 PDF 阅读器、图片查看器、视频播放器和办公软件，适合多种文档；会切换窗口，依赖目标电脑已安装并关联适当程序。插件不是解码器，也不会自动保证外部程序不能改写文件。 |
| **应用内只读预览** | Tauri 可将受允许的本机路径转换为 WebView 可加载 URL；图片可采用网页显示路径；PDF.js 提供 PDF 解析、显示层及可改造的 viewer。[Tauri convertFileSrc](https://v2.tauri.app/reference/javascript/api/namespacecore/#convertfilesrc)、[PDF.js Getting Started](https://mozilla.github.io/pdf.js/getting_started/)。 | 阅读时保留知识点与资料上下文，可以统一翻页、缩放和播放交互；应用需负责受控读文件、预览生命周期、加载失败及视频兼容。PDF.js 面向 PDF，不能据此承诺 Word 等所有文档也能原样预览。 |

内置“只读”可设计为仅展示和导航、不提供编辑保存入口；这不是 Tauri 或 PDF.js 自动施加的操作系统级写保护。外部打开也不等于用户需要维护外部文件，仍可打开系统管理的那份资料。若要技术上强制任何外部程序都不能修改，则是额外的权限或查看副本设计，当前没有该要求。

## 大视频：必须验证局部读取，而非整文件传给界面

**1–2GB 视频不应作为一个完整字节数组读入 Rust 或 JavaScript，再经 IPC、Base64 或整块 Blob 交给播放器。** 这是针对已确认文件规模的工程建议，应采用有边界的流式读取，支持播放器按需读取和拖动播放位置。

Tauri `convertFileSrc` 的官方要求是启用 asset protocol、配置允许的文件 scope，并在 CSP 中允许对应来源；它不是对任意路径的默认开放。[Tauri Core API](https://v2.tauri.app/reference/javascript/api/namespacecore/#convertfilesrc)。

**源码核验发现一个不能省略的限制：** 当前公开的 Tauri asset handler 在有 `Range` 时定位并读取指定区间，返回 `206 Partial Content`；但没有 `Range` 的普通 GET 分支仍会创建按文件长度分配的缓冲并 `read_to_end`。所以“使用 asset protocol”不自动等于任何请求都不会整文件载入内存。[Tauri asset.rs 源码](https://docs.rs/tauri/latest/src/tauri/protocol/asset.rs.html)。

若选内置视频，应在锁定 Tauri/WebView 版本后核验实际播放器的请求、内存和拖动行为；必要时提供受控协议或受控流式读取接口，显式处理范围、长度及无范围请求。HTTP Range 用于获取资源局部内容，适合媒体随机访问，但不会替应用完成权限和资源上限设计。[Mozilla HTTP Range Requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests)。本次没有验证 1–2GB 样本，不承诺任何现成方案已通过这一要求。

## 视频容器与解码不是同一层

Windows 的 WebView2 使用 Microsoft Edge 渲染引擎。[Microsoft WebView2 Introduction](https://learn.microsoft.com/en-us/microsoft-edge/webview2/)。微软的 Edge 官方排障资料明确：不是所有视频编码都原生支持，H.265/HEVC 有扩展、授权及解码路径等条件；Windows 的官方编码表也提示可选编码包和设备差异。[Microsoft Edge Video Playback](https://learn.microsoft.com/en-us/troubleshoot/microsoft-edge/development/video-playback-issues)、[Windows Supported Codecs](https://learn.microsoft.com/en-us/windows/apps/develop/media-authoring-processing/supported-codecs)。

据此，本项目不能仅按 `.mp4` 扩展名承诺内置播放成功：MP4 是容器，同一扩展名可以装不同视频和音频编码。应检查播放失败并给出外部打开入口，按真实样本验证；这里没有得到一张可直接作为本项目 WebView2 兼容承诺的完整编码清单，也不默认增加自动转码、FFmpeg 分发或改变原始资料格式。

## 与保存后端的配合

| 本体后端候选 | 系统默认软件打开 | 应用内预览 |
| --- | --- | --- |
| 应用管理的本机文件 | 校验资料身份和路径后，直接交本地路径给 opener；无需由本应用先读完整视频。 | 用允许范围内的 asset URL 或受控读取；大视频需按上文验证实际局部读取。 |
| 本机自部署对象服务 | `openPath` 需要本机路径，通常需把对象流式保存为受控临时/缓存文件再打开；会增加磁盘占用、等待和缓存生命周期工作。 | 可通过有授权的对象 URL 或应用转发进行读取；需核验所选服务和前端路径的 Range、Content-Type、权限及失败行为，不能把“对象存在”当作播放器已兼容。 |

对象接口具备局部读取是有官方例子的：S3 的 `GetObject` 支持单个字节范围并返回相应部分。[S3 GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html)。这只证明该接口能力的存在，**不表示本项目使用云端 S3，也不表示任意自部署兼容服务已完成端到端验证**。文件存入 PG 等其他后端也要提供适合大对象的读取路径，不能从数据库选型直接推出可用播放器。

## 给下一轮的建议

可让用户选择：**A，点击资料交系统默认软件；B，尽量在应用内只读预览 PDF、图片及可支持的视频，其他文档或不支持的编码提供外部打开。**

结合“从知识点快速查阅资料”的场景，我更推荐 **B 并保留外部打开**：它能保留知识图谱上下文；代价是明确承担预览组件、受控读取及媒体样本兼容验证。这是体验取舍建议，尚未成为需求，不以最少代码为唯一标准，也不把内置预览当作用户已经要求的功能。

若用户更重视复用熟悉的阅读器/播放器并接受窗口切换，A 同样完整满足“能够查看”。保存后端仍可在这两种体验之外单独选择；本报告没有选择本机目录、对象服务或数据库本体存储，没有展开导入导出和备份恢复，也未修改技术设计、业务稿或 ADR。
