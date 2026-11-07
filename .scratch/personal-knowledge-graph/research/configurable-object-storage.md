# Noterion：可配置 S3 兼容对象存储接口

核验日期：2026-11-07（Asia/Shanghai）。本文应用 research 技能，读取最新 Noterion 业务规格、领域文档与已接受的数据库分工，核验 AWS 官方 Rust SDK 文档、API 文档及其发布的 crate 文档。仅提出可配置接口与工程建议，不写实现代码、不选择镜像、不部署、不创建 bucket、不连接用户服务或上传资料。RustFS 产品状态由另一份研究负责，本文不重复调查。

## 1. 可以直接采用的工程推荐

用户已选择对象存储承载文件本体，允许连接本地自部署或云端服务；PDF、图片、文档及单文件 1–2 GB 视频均是实际使用内容。PG 继续权威管理资料元信息和关联，Neo4j 继续作为可重建图表示。查看方式由工程侧安排，不再要求用户选择内置或外部软件。

**推荐：在 Tauri 的 Rust 本地逻辑内封装 AWS 官方 Rust S3 SDK，使用可配置的 S3 兼容连接。** 用户决定连接哪个服务、提供该服务要求的配置；工程侧负责 SDK、签名、流式传输、分片、重试和错误适配，无须让用户比较 Rust S3 库。SDK 支持自定义 endpoint 和凭据来源，为连接兼容服务提供接口基础；但没有保证所有兼容服务都实现 AWS 的全部行为。[AWS SDK for Rust endpoints](https://docs.aws.amazon.com/sdk-for-rust/latest/dg/endpoints.html)、[Rust credential providers](https://docs.aws.amazon.com/sdk-for-rust/latest/dg/credproviders.html)。

“AWS SDK”是客户端库的来源，不是强制使用 AWS 云服务。连接非 AWS 的兼容服务时，使用该服务的 endpoint、bucket 和凭据；不要求用户为了使用 Noterion 注册 AWS 账号。这个结论取决于具体服务确实兼容所用协议子集，是根据自定义端点与凭据接口作出的项目推断。

## 2. 配置项：服务事实与内部对象身份分开

| 项目 | 用途与已核验能力 | Noterion 推荐处理 |
| --- | --- | --- |
| Endpoint | SDK 支持 `endpoint_url`；该值仍参与默认 endpoint 解析，不等于完全替换解析器 | 配置目标 S3 API 地址；用户提供服务地址，不从“本地／云端”标签猜测实际地址 |
| Region | 是 SDK 配置及签名范围的一部分 | 使用目标服务要求的值；不能因本地服务无实际地域就任意省略或对所有提供方固定一个值 |
| Bucket | 对象所在的命名空间，由 S3 请求指定 | 使用用户选定的 bucket；本报告不默认授权自动建桶或修改已有桶配置 |
| Object key | 同一 bucket 内定位对象的键 | 由应用生成和保存稳定引用；原始文件名用于展示，不直接充当必须唯一的对象身份 |
| Credentials | SDK 可显式配置凭据 provider；临时凭据可能还带 session token | 使用已选连接的凭据来源；值来自部署配置，不属于领域数据或图投影 |
| Path-style／virtual-hosted-style | SDK 的 `force_path_style` 可控制 bucket 寻址方式 | 作为服务兼容配置；可用产品预设和高级选项，不要求普通用户研究协议 |
| 逻辑连接标识 | 应用层用来区分本体属于哪个存储位置 | 与 bucket、key 一起保持对象可解析；这是工程建议，不是已定 schema |

官方接口依据：[Endpoint resolution](https://docs.aws.amazon.com/sdk-for-rust/latest/dg/endpoints.html)、[S3 config builder](https://docs.rs/aws-sdk-s3/latest/aws_sdk_s3/config/struct.Builder.html)、[Rust GetObject builder](https://docs.rs/aws-sdk-s3/latest/aws_sdk_s3/operation/get_object/builders/struct.GetObjectFluentBuilder.html)、[Credential providers](https://docs.aws.amazon.com/sdk-for-rust/latest/dg/credproviders.html)。最后一列为 Noterion 的工程判断。

默认 SDK 凭据链会检查环境、共享配置等来源。面向可配置兼容服务时，推荐明确选择凭据来源，避免用户以为连接的是自部署服务、实际却静默采用开发机中另一套认证配置。是否支持现有 SDK profile 可作为工程扩展，不必现在让用户选认证库。凭据由 Rust 连接层使用，不能为了方便调用就把长期 secret 放进图数据、前端构建产物或日志；具体本机密钥保管机制另按项目实现设计选择。[Explicit providers and default chain](https://docs.aws.amazon.com/sdk-for-rust/latest/dg/credproviders.html)。

Path-style 等设置应按实际服务核验。普通本地地址往往需要避免依赖 bucket 子域名解析，但不能因此对所有云端或所有 bucket 类型强制 path-style。若确有特殊寻址要求再比较自定义解析器，不先自行重写 SDK endpoint 规则。[AWS SDK endpoint parameters](https://docs.aws.amazon.com/sdk-for-rust/latest/dg/endpoints.html)。

## 3. 官方 Rust SDK 已具备的传输能力

| 能力 | 官方证据 | 对本项目的意义 |
| --- | --- | --- |
| 文件流上传 | 官方 Rust 示例使用 `ByteStream` 从文件构造上传体 | 可以避免把 1–2 GB 视频先完整读入内存；实际传输和重试仍需验证 |
| 流式下载 | 官方底层 `ByteStream` 可转异步读取接口 | 按流读取、缓存或转交查看组件，而不是默认聚合整个对象 |
| Range 读取 | Rust `GetObject` builder 提供 `range` | 可按字节段获取内容；播放器拖动等行为还需要对应客户端适配 |
| Multipart upload | 官方 Rust 示例包含创建上传、上传各部分和完成上传 | 为大文件提供分片及失败处理基础；SDK 提供 API 不等于产品已经自动具备断点续传 |
| Presigned request | SDK 操作 builder 提供 `presigned()` | 可在需要时生成短期读取请求；不必暴露长期凭据给查看端 |

来源：[Rust S3 examples](https://docs.aws.amazon.com/sdk-for-rust/latest/dg/rust_s3_code_examples.html)、[Official ByteStream source](https://docs.rs/aws-smithy-types/latest/src/aws_smithy_types/byte_stream.rs.html)、[Rust Range API](https://docs.rs/aws-sdk-s3/latest/aws_sdk_s3/operation/get_object/builders/struct.GetObjectFluentBuilder.html)、[Rust presigning](https://docs.aws.amazon.com/sdk-for-rust/latest/dg/presigned-urls.html)。

推荐工程侧采用有界的流式处理和大文件分片路径，不让用户选择分片尺寸、并发数或 SDK 方法。具体阈值、资源上限、重试策略和库版本在目标服务验证后选定，不以本报告承诺上传速度或所有格式的播放效果。

## 4. 稳定对象引用不能是临时签名 URL

PG 保存正式资料身份、对象存储位置引用及必要元信息；读取时再由该引用生成请求。临时签名 URL 有有效期，并可能受底层凭据有效期影响，所以不能把它当成资料永久地址写入正式记录。[Presigned URL expiration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)。

本项目建议以逻辑连接、bucket、key 等必要信息表达本体位置；这只是对象可定位的原则，不决定数据库字段或对象命名方案。更换默认 endpoint 不应让旧对象引用悄悄指向另一台服务；迁移存量本体不是修改一个配置字符串就自然完成。无需为了这个原则立即加入多存储管理产品或自动迁移功能。

对象 key 不应自动等同于内容哈希；ETag 也不能无条件当作 MD5 或去重依据。AWS 官方明确多种情况下 ETag 不等于对象内容的 MD5。去重和文件版本策略仍未确认，不能借接口设计默认加入。[S3 object metadata and ETag](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingMetadata.html)。

## 5. 上传完成、PG 提交和图更新是三个边界

已有决定是 PG 提交后确认结构化保存、图更新状态单独记录。它不允许把尚未上传完成的文件称为已长期保存。对象请求与 PG 事务属于独立持久化边界；资料接收流程必须区分本体进度、正式记录是否接纳，以及图投影是否更新。

| 边界 | 工程侧需要保证什么 |
| --- | --- |
| 开始／进行中的上传 | 可记录处理状态，但不能显示成本体已就绪 |
| 所有分片传完 | 还需正确完成 multipart 请求，不能只按部分上传成功判断 |
| 对象完成 | 检查 SDK 返回结果及必要对象信息，再按选定的流程接纳到 PG 正式记录 |
| PG 正式提交 | 正式资料状态与本体实际情况相符；图更新可以继续独立处理 |
| 中途失败或结果未知 | 留下可识别、可重试或可修正的状态，不能吞错；不在此处规定清理、覆盖或去重策略 |

一个具体原因是 AWS 官方说明 `CompleteMultipartUpload` 初始 HTTP `200 OK` 中也可能带最终错误；官方 SDK 会解析并处理相应错误。应用应使用完整的 SDK 操作结果，不能自行只检查状态码就标记上传成功。兼容服务的完成行为仍需验证。[CompleteMultipartUpload result handling](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CompleteMultipartUpload.html)。

这属于工程正确性，不需要用户逐项批准内部状态字段，也不构成新的上传交互规格。PG 权威元信息与对象服务权威承载字节并不冲突；Neo4j 不可用时，读取资料不应依赖图投影，但仍需要 PG 与对应对象后端可用。

## 6. 本地 Docker 与云端是连接配置差异，不是两套应用

本地服务和云端兼容服务可以采用同一 Rust 接口，分别配置 endpoint、region、bucket、认证及寻址方式。Noterion 不必为支持云端新增业务后端、网关或本地 HTTP 服务，也不必把对象存储实现绑死在某个产品镜像。

实际 endpoint 要对发起请求的进程可达。桌面应用、Docker 容器与外部查看程序可能处于不同网络位置；容器内部服务名并不自动成为桌面可访问地址。如果向查看端提供签名 URL，生成时必须考虑该端实际可访问的地址，不能生成后随意改 host：SigV4 官方签名范围包含 HTTP host。[SigV4 query-string signing](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-query-string-auth.html)。

“支持用户配置云端”只决定能力方向；本次研究未连接任何用户 endpoint、取得凭据或上传资料。实际使用由用户选择并配置自己的服务，不能把本地配置自动替换为 AWS 默认地址。用户没有现成云账号也可以选择兼容的本地部署。

## 7. S3 兼容性应按 Noterion 使用的子集验收

自定义 endpoint 和 S3 API 名称只证明可以发起请求，不证明服务支持全部 AWS 特性。工程侧应针对选定版本验证本项目所用的 Put／Get／Head、分片、Range、签名、对象元信息和错误语义；涉及删除分片或对象的技术接口，不得据此默认启用资料自动删除。

SDK 也可能发送特定校验和或流式编码等请求属性。出现兼容问题时，需要按官方 SDK 能力与产品文档定位，不把“关闭所有校验”当作通用方案，也不预先加入大量未经验证的提供方分支。本报告不宣称 RustFS 或任何其他实现已经通过这些检查，其产品状态与支持范围由独立研究提供。

## 8. 可适用的具体方案与真正待决项

**当前可以形成工程推荐方案：** Tauri 界面通过本地接口调用 Rust；Rust 使用官方 `aws-sdk-s3` 适配可配置 S3 连接；PG 保存资料身份、稳定本体引用及真实的接收状态；1–2 GB 视频采用流式与 multipart 路径；读取按格式和环境选择流、短期只读 URL 或受控临时缓存，再以内置或系统软件查看。临时缓存不成为新的正式本体存储后端，不要求用户维护它。

该方案是推荐，尚未锁定 crate 版本、凭据保管实现、缓存策略或具体对象产品。查看方式已交由工程侧决定，不再以“内置还是外部”为访谈问题。

**无需再问用户：** 选哪个 Rust SDK、如何签名、path-style 的底层原理、分片尺寸、是否把整个视频读入内存、是否保存临时签名 URL。这些应由工程师根据服务配置和兼容验证直接处理。

**真正可能需要用户决定的事项仅有：**

1. 默认参考部署／首次实际验证要面向本地自部署，还是用户已有的兼容云服务；若用户只要求两者都可配置，不必现在逼其二选一，也不能据此要求其开云账号。
2. 是否明确需要同时连接多个存储位置并逐份选择，还是一个实例使用一个当前连接即可。没有前者需求时，建议先按单个当前连接设计，并保持已有资料引用不被配置修改误指向；不要未经要求扩展成多云管理平台。
3. 真正进入连接配置或部署时，才需要准确服务地址、bucket、region 与凭据来源。它们是部署事实而非库选型偏好，本次研究不索取秘密或发起写入。

导入、备份恢复及版本排期继续遵守暂缓要求；本报告不为这些主题追加问题。
