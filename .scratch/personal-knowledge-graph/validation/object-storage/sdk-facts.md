# Issue #10：固定 SDK 组合的一手事实补充

核验日期：2026-11-07（Asia/Shanghai）。应用 Matt 的 `research` 技能，由后台子代理仅补足本次接口试验缺失的事实；不重新比较对象产品，不修改正式规格或 ADR。本文是源码与官方资料核验，实际通过与失败以同目录运行证据为准。

## SDK 与编译器

固定 `aws-sdk-s3 = 1.122.0`。AWS SDK 官方 `release-2026-02-03` 源码中的 `sdk/s3/Cargo.toml` 同时声明版本 `1.122.0` 和最低 Rust `1.88.0`；因此本机 Rust `1.93.1` 满足该 crate 自身声明的编译器下限。此版本的默认特性包含 Tokio 文件流、默认 HTTPS 客户端和 rustls。[固定发行源码清单](https://raw.githubusercontent.com/awslabs/aws-sdk-rust/release-2026-02-03/sdk/s3/Cargo.toml)。

上述判断不等于整棵依赖树已编译：传递依赖采用版本范围，必须保留本次解析的 `Cargo.lock`，以 `--locked` 实际构建结果作为完整组合兼容证据。采用 Rust 版本感知解析仅用于选择声明兼容的依赖，不能替代构建验证；本次无须为追逐最新 SDK 升级全局工具链。

## 文件流与分片

固定发行的 `ByteStream` 提供 `from_path`、`read_from`、逐块读取及 `into_async_read`。`collect` 会聚合完整内容，适合小范围断言；大文件下载应逐块读取或使用异步 reader。[固定发行 ByteStream 源码](https://raw.githubusercontent.com/awslabs/aws-sdk-rust/release-2026-02-03/sdk/aws-smithy-types/src/byte_stream.rs)。

`FsBuilder::path` 构建可重新打开路径的可重试流；`offset` 与 `length(Length::Exact(n))` 组合读取文件的指定片段，构建时会核对偏移和长度是否超出文件。传输期间应保持源文件内容不变。它提供分片请求体，不自动管理 multipart 会话或恢复策略。[固定发行 FsBuilder 源码](https://raw.githubusercontent.com/awslabs/aws-sdk-rust/release-2026-02-03/sdk/aws-smithy-types/src/byte_stream/bytestream_util.rs)。

本版本 S3 crate 已通过 `aws_sdk_s3::primitives` 重导出 `ByteStream`、`FsBuilder` 和 `Length`；不必仅为使用 `Length` 新增直接 Smithy 类型依赖。[固定发行 S3 primitives 源码](https://raw.githubusercontent.com/awslabs/aws-sdk-rust/release-2026-02-03/sdk/s3/src/primitives.rs)。

## Multipart 完成响应

AWS 官方说明完成请求即使初始 HTTP 状态为 200，响应体仍可能表示失败，SDK 会识别并按配置处理。因此调用方必须检查 `send().await` 的完整结果。[CompleteMultipartUpload API](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CompleteMultipartUpload.html)。

固定 SDK 源码进一步确认：完成操作的响应反序列化器调用 `body_is_error`，即使 HTTP 状态成功也可强制进入错误解析分支。试验可用独立代理注入 HTTP 200 XML 错误验证该路径；必须标记为受控协议注入，不声称 RustFS 自身实际产生过此响应。[固定发行完成操作源码](https://raw.githubusercontent.com/awslabs/aws-sdk-rust/release-2026-02-03/sdk/s3/src/operation/complete_multipart_upload.rs)。

## 参考对象服务

沿既有报告固定 RustFS `1.0.4`。官方存在该发行，发行页指向提交 `4633794`；不由发行说明推断 Noterion 所需接口已经兼容。[RustFS 1.0.4 官方发行](https://github.com/rustfs/rustfs/releases/tag/1.0.4)。

根代理实际拉取镜像后记录的摘要为 `sha256:ed9210d6411d77ffceb70d94b964a3cb7d225983368bc25bebe01e995293dcc2`；这是本次本地观测值，后续启动脚本按该摘要固定。隔离端点、凭据、持久化与接口兼容均由实际运行验收，不将官网资料当作运行结果。
