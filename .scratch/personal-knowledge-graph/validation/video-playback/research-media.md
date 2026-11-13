# Issue #13：媒体、Range、CORS 与签名到期的官方事实

核验日期：2026-11-10（Asia/Shanghai）。作为 `research` 后台任务，复用现有 [资料查看研究](../../research/material-viewing-options.md)，只补本次真实验证需要的事实；未安装软件、启动服务或操作媒体。本文的建议不是通过证据，真实结果由本目录实验记录决定。

## 可直接指导实验的结论

| 问题 | 官方事实与本次判断 | 可被实验推翻的检查 |
| --- | --- | --- |
| 支持样本 | WebView2 使用 Edge 渲染引擎。微软列出 H.264、VP8/VP9、AV1 支持；HEVC 依赖扩展与可用解码路径。优先验证 MP4/H.264/AAC，另测 WebM/VP9/Opus；不从扩展名推出编码兼容。 | 记录 `ffprobe` 的容器、编码、像素格式、尺寸、时长；真实宿主起播、时间推进与远距离拖动均须通过。 |
| 失败样本 | Chromium 官方格式清单支持 Matroska；不能以 `.mkv` 作为必然失败条件。其视频清单未列 FFV1。建议合法合成 Matroska/FFV1 作为候选，是否失败仍由当前 Runtime 决定。 | 用实际媒体错误证明失败，保留错误码；外部播放器必须真正读取缓存并显示视频，不能只记录“调用成功”。 |
| Range | 服务器可忽略 Range 并返回普通表示；`Accept-Ranges` 只表示能力。单区间 206 须用准确 `Content-Range` 描述内容。 | 同时记录请求 Range、响应状态、Content-Range、声明长度和实际消费字节；拖动要出现相应的非零区间，不能只查一个头。 |
| 无 Range | 普通 GET 不保证少传数据。流式处理与是否最终传完整对象是不同问题。 | 分别验证完整流式消费和早取消；记录应用/服务内存、上游是否停止、磁盘增长。不得完整聚合到 Rust Vec 或 JS base64/Blob。 |
| 预加载 | HTML `preload` 是提示，可被忽略；`canPlayType` 是置信判断。 | `preload=metadata`、`probably` 不能替代资源计量和真实解码。 |
| 到期 | AWS S3 在每次请求开始时检查签名；已开始下载可跨过到期继续，新连接或重试会失败。该行为不能自动推广到 RustFS。 | 短有效期 URL：先成功读取，过期后请求未缓存远端区间并断言拒绝；再从稳定引用取得新读取能力，恢复到原位置。 |

依据：[WebView2 Introduction](https://learn.microsoft.com/en-us/microsoft-edge/webview2/)、[Microsoft Edge 视频编码与解码路径](https://learn.microsoft.com/en-us/troubleshoot/microsoft-edge/development/video-playback-issues)、[Chromium Audio/Video 格式清单](https://www.chromium.org/audio-video/)、[RFC 9110 Range §14.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-14.2)、[206 §15.3.7](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.7)、[HTML preload](https://html.spec.whatwg.org/multipage/media.html#attr-media-preload)、[HTML canPlayType](https://html.spec.whatwg.org/multipage/media.html)、[AWS 签名到期](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html#PresignedUrl-Expiration)。

上述候选格式是工程选择，不构成本机或所有 Windows 设备的支持清单。FFV1 失败候选尤其须运行验证；当前文档不保证未来版本不支持它。

## CORS 必须按实际请求模式验证

HTML 媒体元素的 `crossorigin` 决定 CORS 模式。建议实验明确采用 `crossorigin="anonymous"`，记录 Tauri 页面实际 origin 和服务返回头；这样可以验证跨源能力，也避免把没有 CORS 要求的媒体请求当作 CORS 配置通过。此为本次测试设计建议。[HTML 媒体 crossorigin](https://html.spec.whatwg.org/multipage/media.html#attr-media-crossorigin)。

Fetch 的 CORS safelist 包含有起点的单区间 Range，例如 `bytes=0-`、`bytes=100-200`；suffix 与多段不能据此认定无预检。`Content-Range`、`Accept-Ranges`、`ETag` 不在默认可读响应头中；若 JS 需要检查，应显式 expose。媒体内部获取与 JS `fetch` 读取响应头的权限应分别验收。[Fetch safelisted request headers](https://fetch.spec.whatwg.org/#cors-safelisted-request-header)、[Fetch response headers](https://fetch.spec.whatwg.org/#cors-safelisted-response-header-name)。

S3 bucket CORS 可指定允许 origin、GET/HEAD、请求头及 expose headers；这不替代签名授权。建议只配置 Issue #13 自己拥有的试验 bucket/服务，不改 Issue #10 既有服务。RustFS 当前文档提供 `RUSTFS_CORS_ALLOWED_ORIGINS`：空值不添加通用 CORS 头，显式 origin 可限制访问；但这是当前文档，不能作为已锁定 `1.0.4` 的实测结果。应先使用独立资源核验其 CORS 子集。[AWS CORS 配置元素](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManageCorsUsing.html)、[RustFS CORS](https://docs.rustfs.com/en/administration/cors)、[RustFS 兼容性边界](https://docs.rustfs.com/en/reference/s3-compatibility)。

## 读取与资源测量的建议

1. 同一合法 1–2 GB 合成样本先记录源文件 SHA-256、容器、编码、时长和生成命令，再流式上传并核对对象长度。可复制播放内容延长时长，不能用尾部填零、稀疏空文件或占位 Blob 冒充大视频。
2. 支持路径采用真实对象 URL 或受控有界转发。S3 `GetObject` 支持单区间；SDK presign 给出实际请求 URI/头，但签名能力只留在内存，不落前端持久状态或证据。[S3 GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html)、[Rust SDK presign](https://docs.aws.amazon.com/sdk-for-rust/latest/dg/presigned-urls.html)。
3. 观察宿主 Rust、所有本次 WebView2 子进程、服务及缓存磁盘。以启动前基线、起播、连续播放、远距离拖动、暂停后采样描述资源变化；WebView 原生缓存不等于 JS 堆，应分别记录可取得的指标。
4. 无 Range 的 200 应保持完整表示语义并按块输出；若取消，说明取消点与实际已发送量。不要在 200 中短发却保留完整长度，不要把无 Range 请求伪装为已验证的局部读取。Range 请求可以只发送请求区间的一部分并准确声明 Content-Range，但 WebView 是否继续请求必须实测。[RFC 9110 §14.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-14.2)、[§15.3.7](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.7)。
5. 外部打开缓存从稳定引用流式写入受控目录，成功后打开完成的文件；记录磁盘成本和适用边界。操作系统默认应用或选定播放器的实际播放才是兜底证据；不存在适配软件时应明确失败，不能把 opener 返回当成解码成功。

资源数值阈值、超时和采样时间应由实验脚本明确记录。官方文档没有替本项目定义“Windows 播放任何 2 GB 视频”的统一内存上限，不应虚构通用性能承诺。本次验证也不扩展到转码、云端部署、编码插件分发或正式文件资料保存。
