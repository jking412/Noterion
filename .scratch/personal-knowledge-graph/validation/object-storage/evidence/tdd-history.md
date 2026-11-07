# 外部接口红绿验证记录

测试边界来自 Issue #10 已明确的实际 S3 接口与程序重启恢复。以下是本聊天实际执行结果摘要，完整最终结果见各阶段 JSON 与 `full-suite.txt`。红阶段使用尚未实现的接收适配路径，防止没有执行接口检查也报告通过；绿阶段实际访问固定 RustFS。没有为私有函数另建测试。

| 切片 | 先执行的红阶段 | 补齐后的真实绿阶段 |
| --- | --- | --- |
| 文件流上传 | `run-validation.ps1 -Phase probe` → `RED: file upload adapter has not been implemented`，exit 1 | 文件流上传后 GET 与源内容 SHA-256 一致 |
| Range／鉴权 | `-Phase ranges` → 普通读写先通过，随后 `RED: Range/auth acceptance adapter not implemented`，exit 1 | 三种 Range 在 SDK／预签名 GET 均精确匹配；416、403 与过期等负例通过 |
| Multipart | `-Phase multipart` → `RED: multipart acceptance adapter not implemented`，exit 1 | 三片传完仍 404；完成后 17,825,915 字节一致 |
| 失败／未知结果 | `-Phase failures` → `RED: failure and unknown-result acceptance adapter not implemented`，exit 1 | 真实非法完成／取消、注入 200 错误、两类真实写入后响应丢失及非就绪状态均通过 |
| 重启恢复 | `-Phase resume` → `RED: restart acceptance adapter not implemented`，exit 1 | 移除两份合成源文件，新 OS 进程按持久引用读取；两条 unknown 核验后才变 verified |

实现过程中实际捕获并修正的其他失败：

1. Cargo 默认直连无法下载索引；使用已存在的系统代理，只传给局部 Cargo 子进程，未改系统网络设置。
2. AWS-LC 原生依赖的 262 字符头文件路径触发 C1083；短路径别名被 canonicalize 还原，改用 AWS 官方支持的 Rustls/Ring 客户端。SigV4 与内容校验仍开启。
3. 调试模式下较大的 SDK async 状态触发 Windows 栈溢出；同一 `failures` 命令可以复现。将请求 future 放到堆上后，同一命令进入所有接口断言并通过，未增大全局线程栈。
4. 栈溢出留下了一条真实 receiving 记录，最初“本次故障用例数量”断言把旧用例也计入而失败；修正为仅计本次新增用例，旧未完成记录仍保留、不误标就绪。最终完整套件从新 run ID 建立独立样本。
5. 服务刚重启后一次读取失败，随后相同命令通过。最终套件新增最多 30 次的签名 HEAD bucket 就绪检查，不把容器进程存在当作 S3 已就绪；最终就绪状态序列见 `ready.json`。

`HTTP 200 + XML InvalidPart` 是受控协议响应注入，未转发真实完成请求；不能描述成 RustFS 自发产生该错误。PUT／completion 的响应丢失则确实在真实 RustFS 返回 HTTP 200 后发生，`proxy-events.jsonl` 留下脱敏状态证据。
