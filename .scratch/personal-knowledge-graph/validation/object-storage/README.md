# Issue #10 对象存储接口验证

任务来源：[GitHub Issue #10](https://github.com/jking412/Noterion/issues/10)。程序仅操作本目录定义的隔离资源。开始时仓库提交为 `69ce7671f75cad8997534a34319d67bf956d4669`。

当前状态：**固定组合已通过**。完整套件通过 **46 项断言，另加文件流上传探针**；成功、拒绝、未完成和未知结果均有实际证据。下游 #11／#13 可复用本组合和访问契约，继续各自的资料保存／视频验证。

## 固定组合

- RustFS `1.0.4`，镜像 `sha256:ed9210d6411d77ffceb70d94b964a3cb7d225983368bc25bebe01e995293dcc2`。
- Windows x64；Rust/Cargo `1.93.1`；`aws-sdk-s3 = 1.122.0`；依赖树由 `Cargo.lock` 固定。
- HTTP 客户端为官方 `aws-smithy-http-client = 1.1.13`，Rustls/Ring；使用 SigV4，未关闭内容校验。
- endpoint `http://127.0.0.1:19100`，region `us-east-1`，path-style；bucket `issue-10-compatibility`。
- 容器 `issue-10-rustfs`、持久卷 `issue-10-object-storage-data`，测试对象前缀 `issue-10/`；故障代理仅监听 `127.0.0.1:19110`。

本机已有其他项目容器，未停止或修改它们。没有真实云账户或用户资料。随机本地试验凭据保存在被忽略的 `.local/service.env`，仅用于本地服务与 Rust 程序；不提交、不打印，不将预签名 URL 写进证据。`.local/` 同时保存局部 Cargo 缓存、编译诊断和合成样本。

## 复现

在本目录打开 PowerShell，需已运行的 Docker Engine、Rust 1.93.1 Windows MSVC 工具链，以及能访问 crates.io 的网络：

```powershell
./run-suite.ps1
./capture-environment.ps1
```

`run-suite.ps1` 启动或复用有 Issue 10 所有权标签的专用服务，检查代理端口未占用，启动自己的隐藏代理进程，并在 finally 中只停止该进程。按 `ready → probe → ranges → multipart → failures → resume → 服务重启 → ready → verify` 顺序运行；两个上传源文件在 resume 前删除。每一阶段是新的验证程序进程。最终保留只含合成样本的服务和卷供后续复用，故障代理停止。已有服务／数据卷缺少正确标签、缺少原本凭据文件或端口被占用时拒绝接管。

脚本不修改全局 Cargo 配置。注册表缓存位于本目录 `.local/cargo-home/`；本机网络需要系统代理时，脚本将现有系统代理配置仅传给当前 Cargo 子进程，不记录代理值。`Cargo.lock` 随验证程序保存，运行使用 `--locked`。本次工程的 SDK future 放到堆上，避免 Windows 调试构建的栈溢出。

单独定位阶段时，可手动启动 `python -B tools/fault_proxy.py`，再运行 `./run-validation.ps1 -Phase <阶段>`；阶段有数据依赖，应先按上述顺序建立本次样本。单独 resume 只用于未恢复的两条 unknown；恢复后重复核验使用 verify。无需重传即可运行 `./run-validation.ps1 -Phase verify`。

## 实际结果

| 路径 | 结果与证据 |
| --- | --- |
| 文件流 Put／Head／Get | 131,209 字节合成样本，中文／空格／加号 key；长度、content-type、操作标识与独立源文件摘要一致。`ranges.json` |
| Range | SDK 与临时 GET 的中部、suffix、开放终点均精确匹配字节；HTTP 206、Content-Range 和 Content-Length 正确；越界 416。`ranges.json` |
| 鉴权 | 正确 SigV4／预签名 GET 成功；匿名、错误 secret、篡改、过期、用 GET URL 执行 PUT 均 403；拒绝写入后原对象完整。缺失对象为独立的 404。`ranges.json` |
| 三分片 | 8 MiB＋8 MiB＋1,048,699 字节；全部片传完仍不可读取，完成后流式校验 17,825,915 字节。`multipart.json` |
| 非法完成与取消 | 真实 `400 InvalidPart`；取消后 `NoSuchUpload`，对象保持 404。`failures.json` |
| 200 响应体错误 | 受控代理注入 `HTTP 200 + XML InvalidPart`，SDK 返回错误，真实对象未完成；此项与 RustFS 真实兼容性分开记录。`failures.json` |
| 响应丢失 | 真实 PUT 和 complete 返回 200 后代理断开；客户端传输错误，服务器有本体，持久记录仍 unknown。`failures.json`、`proxy-events.jsonl` |
| 稳定引用与重启 | 源文件删除、不同 OS 进程，仅按稳定引用核验；两条 unknown 核验后才转 verified，failed/cancelled/receiving 保持非就绪。`resume.json`、前后引用快照 |
| 服务持久化 | 保留卷重启 RustFS，签名接口就绪后由另一新进程再次读取；四个已验证对象仍一致，四个非就绪对象仍不可读。`verify.json` |

机器可读报告与 [完整执行输出](evidence/full-suite.txt) 保存在 `evidence/`；[环境事实](evidence/environment.json) 记录镜像摘要和锁文件摘要；[TDD 记录](evidence/tdd-history.md) 同时保留红阶段与实际修正的问题。原始本地日志、依赖、凭据及合成源文件不提交。

## 验证过程与边界

实际使用 Matt 的 implement、tdd、research、diagnosing-bugs 和交付前 code-review。TDD 的约定测试边界是 Issue 的外部 S3 读写接口及重启后引用恢复；不对内部函数逐项测试。每个接口切片先运行可失败断言，再补实际路径；外部服务是真实 RustFS，故障代理只承担指定响应丢失／协议错误注入。

首次编译默认 AWS-LC 后端失败，反馈命令为 `cargo build --locked`，具体为 `jitterentropy-internal.h` 的 C1083；文件存在，但完整路径长 262 字符。临时短路径别名仍被构建过程 canonicalize 回原路径。改为 AWS 官方支持的 Rustls/Ring 客户端后继续构建；未升级全局工具链或修改系统长路径设置。研究依据见 [sdk-facts.md](sdk-facts.md)。

供后续使用的行为边界见 [access-contract.md](access-contract.md)。协议组合通过不代表 #11 的 PostgreSQL 正式保存、#13 的真实 1–2 GB 视频/WebView/编码/拖动或整桌面流程已经通过。

未执行：真实云端、TLS 部署、生产最小权限 IAM、浏览器 CORS、真实 1–2 GB 视频／编码／WebView 播放、PostgreSQL 正式提交、多节点、备份恢复、对象迁移、长时间可靠性及容器删除重建。服务持久化证据为保留卷的容器重启，不冒充容器重建。无资料自动删除策略，测试取消仅针对本次生成的 multipart。
