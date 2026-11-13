# Issue #31：模型设置与协议接入研究

核对日期：2026-11-13（Asia/Shanghai）。规格来源：[Issue #31](https://github.com/jking412/Noterion/issues/31)。本记录保存资料、设计取舍与协议依据，不作为另一套工单状态。

## 成熟软件的实际做法

### Chatbox

已打开并阅读官方 [Model Configuration](https://docs.chatboxai.app/en/guides/providers)：侧栏设置进入模型提供商，选择 API 类型，填写 API Host、密钥与模型，保存后检查连接。指南把连接信息放在集中设置中，聊天界面只负责使用。文档包含实际界面截图链接；浏览工具未能直接取得其中一张 GitBook 图片，因此不把它记为已完成的逐像素截图审阅。

采用其“集中设置 → 选择连接类型 → 基础字段 → 检查”的任务顺序。Noterion 只保留三个固定类型，不复制添加任意数量提供商、能力开关和多模型选择。

### Cherry Studio

通过 GitHub 文件接口实际读取当前源码，未以 README 代替设置界面研究：

- [ProviderEditorDrawer.tsx](https://github.com/CherryHQ/cherry-studio/blob/main/src/renderer/pages/settings/ProviderSettings/ProviderList/ProviderEditorDrawer.tsx)，文件 blob SHA `4df7b1d8208061d28f993bdceecfbf30ba2017a8`：常用自定义文本协议是 OpenAI Chat Completions 与 Anthropic Messages；表单集中编辑地址和 API 密钥；地址字段关联行内错误和描述；密钥默认密码遮蔽；次要 endpoint 收到展开区。
- [ProviderListGroup.tsx](https://github.com/CherryHQ/cherry-studio/blob/main/src/renderer/pages/settings/ProviderSettings/ProviderList/ProviderListGroup.tsx)，文件 blob SHA `1c4c6d4b8d0348873ca03f5f0f19b48b22bd5a82`：提供商在独立列表中选择，显示启用状态，支持分组及新增同厂商实例。

采用提供商列表与编辑区分离、字段附近给出校验、密码遮蔽及明确启用状态。舍弃同厂商多实例、拖拽分组、Logo、自定义多 endpoint、OAuth、云 IAM、多密钥路由等。三类各一份连接及一个当前启用选择，足以支撑本产品三项 AI 业务。

路径核对说明：旧式 `src/renderer/src/pages/settings/ModelSettings/index.tsx` 与猜测的 ProviderSettings `index.tsx` 返回 404，成功路径如上。未宣称旧 `docs.cherry-ai.com/pre-basic/providers` 已读取。

## 默认值与明确协议范围

| 类型 | 建议保存的 Base URL | 明确请求协议 | 模型处理 |
| --- | --- | --- | --- |
| DeepSeek | `https://api.deepseek.com` | `POST /chat/completions` | 官方预设 `deepseek-flash`，允许修改 |
| OpenAI 兼容 | `https://api.openai.com/v1` | `POST /chat/completions` | 用户填服务提供的完整 ID |
| Anthropic 兼容 | `https://api.anthropic.com/v1` | `POST /messages` | 用户填服务提供的完整 ID |

DeepSeek 当前首页示例为 `deepseek-flash`，现由 V4.1-Flash-1017 服务；另列 `deepseek-v4-pro`。OpenAI 当前 Chat Completions 示例为 `gpt-6-astra`；Anthropic 当前 Messages 示例为 `claude-opus-5-5`。兼容类型不锁死这些官方示例，也不把模型名称匹配当作能力证明。[DeepSeek 首次接入](https://api-docs.deepseek.com/)，[OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)，[Anthropic Create a Message](https://platform.claude.com/docs/en/api/http/messages/create)

这是 Chat Completions 和 Messages 的文本接入，不能宣传为支持全部 OpenAI API、Responses、网页订阅、Azure、Bedrock 或多媒体能力。

## OpenAI Chat Completions 与 DeepSeek

OpenAI 使用 Bearer 鉴权，消息为角色与 content，函数工具声明为 `type:function`/`function`，模型返回 `tool_calls`，工具结果通过对应 `tool_call_id` 回送。流式为 completion chunk；应检查最终 `finish_reason`，`length` 是截断，`content_filter` 不可当作成功结果。参数支持因模型而异，不能对兼容服务无条件发送某厂商扩展。[Chat Completions 参考](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)

`max_tokens` 已弃用且不适用于 o-series；`max_completion_tokens` 包含可见与推理 token。兼容服务可能只实现部分参数，因此简洁适配宜减少可选参数，保留响应体大小限制、截止时间与截断判定。[OpenAI 参数定义](https://developers.openai.com/api/reference/go/resources/chat/subresources/completions/methods/create)

DeepSeek 的 JSON 模式要求 `response_format:{type:json_object}`，提示中包含 JSON 及目标例子；即使结束原因为 stop，也可能返回全空格，必须拒绝空结果。JSON 语法成功不能替代正式 Point 的语义校验。[DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode/)

DeepSeek 的 `thinking` 为专用控制，当前默认 enabled/high；工具指南包含明确的 non-thinking 示例。可在 DeepSeek 预设中禁用 thinking，以维持既有简洁工具循环，但不得向 OpenAI 或 Anthropic 兼容连接照发该参数。[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)，[Tool Calls](https://api-docs.deepseek.com/guides/tool_calls/)

对未知兼容模型，采用提示约束 JSON、严格 Rust 解码与引用/事实校验，不假称拥有服务端 JSON schema 保证。工具能力由真实工具循环验证，连接检查不能仅以 HTTP 200 为成功依据。

## Anthropic Messages 的实质差异

### 请求与鉴权

官方服务为 `https://api.anthropic.com`。当前官方鉴权首推 Bearer；`x-api-key` 仍受支持，适用于常见 Messages 兼容入口。API 请求须有 `anthropic-version` 与 JSON Content-Type。未限定 workspace 的新式密钥可能需要 workspace header；本 Issue 的基础字段不扩展云身份配置，使用者应提供可直接调用的服务与密钥，并在权限错误时明确提示。[API overview](https://platform.claude.com/docs/en/api/overview)

当前 API 版本为 **2026-10-21**。此版本移除了 `temperature`、`top_p`、`top_k`，携带任一个会导致 400。不能沿用旧记忆盲发这些字段；`2023-06-01` 仍在版本历史中，但不能未经说明把它写成当前版本。[API versions](https://platform.claude.com/docs/en/api/versioning)

Messages 有顶层 `system`，请求须指定 `max_tokens`，文本可用字符串或 text 内容块。自定义工具定义用 `name`、`description`、`input_schema`，不是 OpenAI function 包装。结构化输出如使用官方能力则字段为 `output_config.format`，不是 `response_format`；为兼容服务减少猜测时，可依提示输出并由 Rust 完整校验。[Create a Message](https://platform.claude.com/docs/en/api/http/messages/create)，[Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools)，[Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)

### 工具循环与流式

工具调用为 assistant 的 `tool_use` 块，包含 id、name、对象 input；结果放在紧接的 user 消息中，用 `tool_result` 与 `tool_use_id` 关联。多结果合并在同一 user 内容数组中，结果块必须排在其他文字之前；本产品只提供本地只读工具。[Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)

SSE 按 `message_start`、每个 index 的 `content_block_start/delta/stop`、`message_delta`、`message_stop` 组装；text_delta 和 input_json_delta 分别处理。工具 partial_json 必须完整拼接后再解码，不因网络分包猜测 JSON 边界。ping 与新增事件类型应兼容，error 事件即使在 HTTP 200 之后仍是失败。Anthropic 没有 OpenAI 的 `[DONE]` 结束标记。[Streaming messages](https://platform.claude.com/docs/en/build-with-claude/streaming)

结束原因需区分 `end_turn`、`tool_use`、`max_tokens`、`model_context_window_exceeded`、`refusal` 和 `pause_turn`。截断、拒绝和不支持的服务端暂停不能生成可采用候选；本产品无自动 fallback，不照搬文档的换模型策略。[Stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons)

现行部分模型始终思考，拒绝 `thinking:disabled`；新模型也可能拒绝强制工具选择。应省略不必要 thinking/强制工具字段，并保存 thinking/redacted_thinking 内容块与签名原样回送工具轮次，不能丢弃后假称兼容。追问开始新的检索上下文时，只保留已验证业务摘要，避免重写签名绑定的原始工具历史。[API errors 与验证错误](https://platform.claude.com/docs/en/api/errors)

## 落地原则与验证边界

以下为本项目从资料与 Issue 要求推导的实施决策，不是外部软件的既有承诺：

1. 主导航增加“模型设置”，保持现有页面语言、字重、边框和间距；不重做全局导航。
2. 三个固定连接分别保存地址、模型和独立凭据，只有一个当前启用项；三项 AI 业务共用同一选择。
3. 检查直接使用界面当前表单并返回其对应结果；编辑地址、模型或密钥后撤销旧成功提示。
4. 密钥只经 Rust 进入 Windows 凭据，不从系统读取明文给前端；更换目标不得自动带上旧凭据。
5. 每次任务启动固定配置、密钥和协议，之后多轮工具调用使用同一客户端；切换设置不改写进行中的任务。
6. 提示 JSON 与工具调用都属于能力要求，连接成功并不证明所有业务成功。解析、搜索、来源问答、追问、取消和候选采用分别验收。
7. 401、403、404、限流、计费、网络超时、读取超时、SSE 中断、空输出、截断输出分别形成可恢复错误。DeepSeek 官方还区分 402 余额不足、422 参数错误与 503 过载。[DeepSeek 错误码](https://api-docs.deepseek.com/quick_start/error_codes/)
8. 无密钥的标准 CI 使用两个协议的本地契约夹具；真实凭据仅在拥有并被授权使用时验证，记录真实服务与未覆盖范围，不把模拟标注为官方实测。

本记录只证明资料已核对与设计取舍已形成；实际实现及测试结果见本目录后续验证记录。
