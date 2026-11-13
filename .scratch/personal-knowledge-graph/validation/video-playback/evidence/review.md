# Issue #13：交付前双轴审查

固定点：`c5c4312d177f752e35788dd23f7e86b4503a5518`，初次审查目标：`9e4de175819726568e4f0a0c33a22f6ee5425133`。命令：`git diff c5c4312d177f752e35788dd23f7e86b4503a5518...HEAD -- .scratch/personal-knowledge-graph/validation/video-playback`。初审 commit list 为 `9e4de17 Validate real Windows large-video playback for #13`。

实际按 Matt code-review 技能委派两个独立代理并行审查 Standards 和 Spec。正式要求来自最新 GitHub Issue #13、spec.md Testing Decisions/T13、technical-design Q16–Q19 与 ADR0003。标准源为 AGENTS.md、docs/agents/issue-tracker.md、triage-labels.md、domain.md、CONTEXT.md 和 ADR；仓库没有另外的 CONTRIBUTING/CODING_STANDARDS。Standards 轴同时使用技能列出的 Fowler 异味基线，并区分规范与判断。

后续小差异单独复核：测试脚本的 BOM 兼容、保留带 BOM 的实际 metadata、all-06 真实复验、最终审计选择 all-05/all-06、README 数值同步，以及 app.js 末尾空行清理。Rust 与实测 exe 未改变。

## Standards

**0 项硬性违规，0 项需要处理的代码异味，无交付阻塞项。**

全部修改限定在本验证目录；前置验证目录只读复用缓存和驱动。服务复用前核对标签、固定镜像、loopback 端口与卷，没有接管其他服务或清理其他数据的路径。

Rust 鉴权、稳定对象引用、受控派生缓存和真实大视频验证符合 ADR0003。媒体与完整读取均流式消费，转发有并发与缓冲限制。前端没有整视频 base64/大 Blob，长期凭据与完整签名 URL 未进入已提交日志或持久状态；敏感扫描 PASS。

README 与 tdd-history 区分失败、行为通过但资源证据不足的早期轮次及最终完整验收，符合 issue-tracker.md“关闭前核对本 Issue 验收，不以编译或代理完成代替”。没有领域术语或 ADR 冲突。最终小差异复核仍为 0 未解决；提醒同步 README 运行编号和数值已完成。

## Spec

**发现并修复 1 项复现问题，未解决项 0，交付阻塞项 0。**

要求“交付可复现步骤和适用边界”。原 runner 直接解析 samples.json，无法处理 Windows PowerShell 5.1 的 UTF-8 BOM。已先用实际带 BOM 文件复现 SyntaxError，再补解析边界的 BOM 处理。all-06 在同一真实 exe 上通过 13 项行为断言及 39 条资源观测，完整普通 GET 的 1,277,422,426 字节摘要一致，session 和宿主均退出。

其余要求由源码和原始证据共同支持：真实 Tauri/WebView2、RustFS 与合法 1.28 GB 编码样本；起播、远距离标准指针拖动、上游非零 Range/206；精确远端字节与 416；普通 GET 全流和提前取消；内存、磁盘观测；编码兼容边界与 FFV1 原生外部窗口/播放时钟；签名 206→403→206。审查代理还视觉核对了烧录时间与 539.5 秒位置一致的实际画面。

未发现范围蔓延。云端、系统默认播放器及其他未执行事项有明确边界。可选建议 0。

Standards：发现 0、未解决 0；Spec：发现 1、已修复 1、未解决 0。两轴均无剩余交付阻塞项。
