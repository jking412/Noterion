# Issue #21：最终 Standards 复核

只读复核目录：`D:/person/application/knowledgeGraph`。基线：`2fd7da8`；复核时 HEAD：`a4462162102c2ac727d403a5a2925b3427d9d94b`。交付 exe SHA-256：`6B38EA13EB301FDC1660BF472B087747FBF7BE3656317E91207CBE6656BEFEBE`。

硬性标准违反：**0**。本轮新增阻断：**0**。此前维护性判断保留 **1** 项：`app/src-tauri/src/store.rs:291` 的 `add_copied_file` 八个相邻参数可聚合为文件元数据类型，属于 Data Clumps 判断项，不影响当前交付正确性。

`app/src-tauri/src/media.rs:248` 的空间预检查使用 UTF-16 路径和 64 位调用者可用空间；调用失败拒绝复制，源文件逻辑长度大于可用空间时在创建副本前返回错误。该接口对应 Windows 官方定义的用户可用空间，包含配额限制且未截断到 32 位。[GetDiskFreeSpaceExW 官方定义](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getdiskfreespaceexw)

预检查不充当容量预留：后续读取、写入、sync、改名及正式记录提交仍逐项检查错误；失败路径清理本次 UUID 的半成品或完整但未提交副本，不返回成功快照。未通过填满磁盘来制造空间不足。

`media.rs:169` 的日志已区分主动撤销 `revoked` 与 I/O 异常 `disconnected`，聚合取消字段覆盖两者，并保留实际错误及读写字节。该修正消除了原先网络中断不设撤销标志而导致验收误等的问题。命名细节：`disconnected` 当前代表任意流 I/O 错误，包含源读取/seek 错误；分析其他故障时应同时读取 `error`，不能仅靠该布尔值断言客户端断连。这不是本轮已由客户端主动取消并独立核对字节的验收阻断。

本报告是 Standards 源码复核，不替代主聊天正在执行的真实离线桌面全流程或 Spec 轴验收。
