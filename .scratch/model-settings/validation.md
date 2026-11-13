# Issue #31 验证记录

核对日期：2026-11-13（Asia/Shanghai）。规格：[Issue #31](https://github.com/jking412/Noterion/issues/31)。独立分支 `codex/issue-31-model-settings`，固定审查基点 `d0793a68cdc1d1812b550a5c792731f94861bbd7`。

## 已完成的实现与操作

主导航新增正式“模型设置”页，三类连接分别保存一份地址、模型和 Windows 凭据，显式选择一个用于三项业务。DeepSeek 保留官方预设及旧凭据目标；兼容类型允许手填完整模型 ID。检查直接使用当前表单，字段与连接类型变更使旧结果失效。

Chat Completions 与 Messages 分别转换请求、system、工具调用/结果、流式事件及完成原因。Anthropic 保留签名 thinking 内容块，最终结构化回合保留工具定义并禁用继续调用工具。未知兼容服务不接收 DeepSeek 专用参数；所有候选与来源仍由原有 Rust 业务校验。

## 验证结果

| 检查 | 结果与证据 |
| --- | --- |
| 前端类型与正式资源构建 | `npm run build --prefix app` 通过（包含 vue-tsc） |
| 前端测试 | 6 文件、54 项通过，含检查过期/迟到、保存失败/输入保留与任务服务标签 |
| Rust 测试 | 19 项通过，含真实 45 秒静默 SSE 读取超时与关闭端口连接故障；测试总耗时 45.01 秒 |
| Rust 格式与严格诊断 | `cargo fmt -- --check` 与 `cargo clippy --locked --offline --all-targets --target x86_64-pc-windows-msvc -- -D warnings` 通过；首次 clippy 两条等价简化已修正 |
| 发布资产契约 | `node --test app/scripts/release.node-test.mjs`，4 项通过 |
| Windows Debug / Release | 均成功构建；两者 PE 的 9 个图标帧与源 ICO 一致，Shell 图标提取通过 |
| 真实桌面协议/业务 | `issue-31-contracts-isolated`，33 项通过、90 个原生 HTTP/SSE 请求、0 协议违例、3 次应用启动；[结果](evidence/desktop-result.json)、[逐项检查](evidence/desktop-checks.json)、[协议统计](evidence/fixture-requests.json) |
| 最终 Release 桌面 | `issue-31-release-cleanup`，5 项通过、3 次启动，HTTPS 策略、旧配置/凭据迁移、知识与资料保留、三类保存与选择重启持久化、1000px 最小宽度无水平溢出；[结果](evidence/release-result.json)、[检查](evidence/release-checks.json) |
| 界面检查 | 初次批量检查三类设置、候选和问答截图；修正一处重复密钥状态文案后，确认最终 Release 正常及最小窗口截图。机械设计扫描返回空发现 |

最终正式 exe：`app/dist-desktop/noterion.exe`，12,952,064 字节，SHA-256 `9005e2148eb971b741efc8dadc01b3397ca773bc4e0760d2164e6ec57b99f37d`。

## 桌面证据所证明的行为

- 三类各自检查当前未保存表单，修改后旧成功提示立即消失；检查中修改后迟到结果不出现。三类保存及当前选择在重启后保留。
- 旧 `deepseek.json` 与本轮专用合成 Windows 凭据迁移可用；迁移前经 UI 保存的知识点和 Markdown 文件资料迁移后可读。锁住配置文件造成原子替换失败后，原 JSON 与原凭据恢复，仍可检查。
- 改变目标后不会带旧密钥，替换及移除凭据状态准确。本轮创建的精确合成凭据全部清理，不枚举其他 profile。
- 三类分别完成普通文本解析、候选原文依据预览、描述修改、正式整批采用；搜索实际执行本机工具，回答引用可跳回已有知识，追问继续重新检索。
- 两协议分别验证鉴权失败、限流、模型/接口不存在、空结果、截断、流式中断；输入保留，无候选或知识误写。取消关闭实际 HTTP 流，之后正常任务恢复。
- 正在进行的 OpenAI 工具请求期间启用 Anthropic，整个旧任务仍使用原模型、凭据和协议；随后新任务切为 Anthropic。

HTTP 连接上限 10 秒、读取无数据上限 45 秒、单次请求上限 120 秒、业务任务总上限 5 分钟、连接检查总上限 90 秒。取消与慢流的真实桌面行为已验证；本机 HTTP 契约实际等待 45 秒验证读取超时，另验证关闭本机端口的可恢复连接故障及错误脱敏。

## 边界与运行说明

用户明确要求本次跳过实网模型调用；三家官方服务实网均未执行。本机夹具不代表官方模型实测。该说明只出现在交付和工单证据中，软件界面没有添加测试覆盖标签。当前接入范围为 Chat Completions / Messages 文本与本地工具能力，不能推断所有模型或全部 API 都支持。

首次 `issue-31-contracts-01` 未进入应用，固定 EdgeDriver 端口返回空 HTTP 响应；改用空闲端口后完整场景通过。验收脚本已默认自动选空闲端口，最终 Release 运行验证该路径。原始运行目录被忽略，版本化证据移除了本机绝对路径，不包含 profile、数据文件或凭据正文。

标准 Windows CI 已接入无付费密钥的本机契约与真实桌面场景，正式发布候选仍使用 Release exe；本次未声称远程 GitHub Actions 已运行。可重复命令见 [验收入口](verification-harness.md)。

补审已修正合成凭据删除错误和会话退出清理路径。最终完整场景与 Release 场景的 credentialCleanup、desktopCleanup 均为 true；旧运行的 63 个精确合成目标独立确认全部已不存在，见 evidence/cleanup-verification.json。一次并行启动两个桌面场景使重启可见性等待超时，最终完整场景已串行独立通过；CI 只串行运行一个模型验收场景。
