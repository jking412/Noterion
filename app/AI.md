# 模型设置与 AI 知识能力

Noterion 在现有 Windows Tauri 客户端中提供知识解析、自动查找与来源问答。三项能力共用 Rust AI 模块，并读取同一份本机正式知识；知识、资料记录和文件副本仍由本机 SQLite 与数据目录保存。

本文说明使用方式、实现职责和验证入口。实际验收结果以对应运行记录为准，下面的命令不表示验收已经执行或通过。

## 配置连接

从主导航进入 **模型设置**。选择 DeepSeek、OpenAI 兼容或 Anthropic 兼容，填写连接地址、API 密钥和完整模型 ID，然后保存或“保存并启用”。三个类型分别保留一份配置，当前启用连接统一用于解析、查找和问答。DeepSeek 预设为 `https://api.deepseek.com` 与 `deepseek-flash`；OpenAI 兼容预填 `https://api.openai.com/v1`，Anthropic 兼容预填 `https://api.anthropic.com/v1`，模型由用户填写。

“检查连接”直接使用当前表单，即使尚未保存也可检查；检查包含结构化结果、工具调用及工具结果回送。修改地址、模型或密钥、切换类型会清除旧检查提示。检查通过后仍需在实际任务中核对候选与来源。保存不自动切换启用连接，只有“保存并启用”改变全局选择。进行中的任务继续使用启动时固定的地址、协议、模型与密钥。

密钥由 Rust 写入 Windows Credential Manager，不保存到 Point、SQLite、普通配置文件、前端持久化或普通日志。输入框在保存或关闭后清空，界面只显示保存状态，不返回密钥正文。凭据按 **用户配置目录、连接类型与完整 API 根地址** 隔离；改变目标不复制旧密钥，更换知识数据目录本身不会要求重新配置同一接入。非敏感配置与当前选择保存在用户配置目录的 `model-connections.json`。第一次打开设置时迁入旧 `deepseek.json` 的地址与模型，DeepSeek 沿用原 Windows 凭据目标；旧文件不删除，迁移失败会明确反馈并保留旧内容与知识数据。

发布构建仅接受 HTTPS；调试构建额外允许本机 loopback HTTP，用于可复现的协议夹具。调试测试凭据只有同时绑定 `NOTERION_TEST_PROVIDER` 与 `NOTERION_TEST_BASE_URL` 时才会读取 `NOTERION_TEST_KEY`，通用 DeepSeek 环境密钥不再跟随任意编辑地址。

OpenAI 兼容范围为 Chat Completions，Anthropic 兼容范围为 Messages（当前 API 版本 `2026-10-21`，使用 `x-api-key`）。地址填写 API 根地址，可含 `/v1`，不包含 `/chat/completions` 或 `/messages`。兼容服务与所选模型须支持文本生成及本地函数工具；未知服务采用提示约束 JSON 和 Rust 完整校验，不盲发 DeepSeek 专用参数。Anthropic 原生 system、tool_use/tool_result、thinking 签名块、流式事件与结束原因独立适配。不包含 Responses、网页订阅、Azure、Bedrock 或多媒体 API。

## 三条使用流程

### 从普通文本整理知识

1. 打开“知识导入”，粘贴学习笔记，选择 UTF-8 的 TXT／Markdown 文件，或从资料库进入并读取已保存的文本资料。不需要标题模板、固定字段、CSV 或手写标识。
2. 选择本批关联来源并提交。解析发送本次原文、选中资料的元信息及必要的已有主题候选；选中 PDF、图片或视频只建立来源上下文，不读取或转换其正文。
3. 核对候选知识、逐字原文依据及结构推断标记。可以修改名称、描述、所属主题和资料关联，并选择新建、复用、明确更新或跳过。复用保留已有名称与描述；更新展示已有内容及采用后的内容。名称相同不会自动合并身份。
4. 确认整批采用。只有本机正式事务提交成功才提示已保存，随后可进入图谱和导入记录。修改原文后需重新解析，不能把旧候选当作新原文的解析结果采用。

输入上限为 **256 KiB UTF-8 字节**，不是字符数。长文按 UTF-8 字符边界和可用换行切为约 12,000 字节的片段，一次最多 32 段；较早的换行可能增加段数，因此低于字节上限也可能需要再分小。单段最多返回 80 个候选，整批最多 250 个；超过限制会明确失败，不会静默只采用前半部分。跨段同名点和所属主题需在整批预览中核对，不按相似名称自动合并。

成功采用后不长期保存整份输入文本副本。导入记录保存输入指纹、来源、贡献映射和统计；完全相同的输入由本机采用回执直接识别，不再调用模型，查看已有采用结果也不会恢复后来删除的知识。更新某次原记录时，从记录页明确进入并重新提供修改后的文本。新文本省略的旧知识或关联继续保留，不会被解释为删除。

### 用自然问题查找自己的知识

在图谱左侧切换到“AI 查找与问答”，选择“查找知识”，直接输入问题或模糊记忆。当前启用模型会规划、调整查询，Rust 实际执行名称／描述检索和主题关系读取，再将真实知识点返回供模型排序。点击结果沿用图谱定位、高亮、描述和资料入口。

“片段搜索”继续提供原有名称／描述匹配和 all／any 选择。AI 服务失败与本机未命中分别提示，不用普通搜索结果假称 AI 已成功。

### 根据来源回答并追问

选择“回答问题”，输入问题。回答先检索本机知识，并可读取用户明确选中的 Markdown／TXT 资料。问答所选文本资料合计最多 **64 KiB UTF-8 字节**；超出时要求减少选择或先分段整理为知识，不静默截取正文。仅由关联得到的资料标题、文件名和链接不等于已经读取正文。

回答区分已有知识依据、结构推断和显式允许的 AI 补充。来源按钮由 Rust 校验后的句柄生成，可跳回知识点或打开资料；只有资料而没有知识点的证据不会构造虚假节点。证据不足时说明缺失，不编造“用户曾保存过”的知识。通用知识补充默认关闭，可通过界面明确开启。

追问保留必要的近期会话，但每轮仍重新检索和核验来源。会话按当前数据目录隔离，切换目录会使旧任务和会话失效。问答和搜索均不暗中改写知识；模型没有保存或删除工具。

## 核心模块与数据契约

| 模块 | 职责 |
| --- | --- |
| `src-tauri/src/ai/mod.rs` | 注册配置、任务启动／取消和候选采用命令；管理任务、会话、数据目录状态及最终结果。 |
| `src-tauri/src/ai/provider.rs` | Chat Completions / Messages 请求转换、HTTPS、SSE、响应大小限制、完成原因、超时和有限重试。原始 JSON 中的内部句柄不直接作为界面正文。 |
| `src-tauri/src/ai/extract.rs`、`draft.rs` | 普通文本分段、严格 Point 解码、逐字依据核验、统一身份分配及 Rust 持有的候选草案。 |
| `src-tauri/src/ai/retrieve.rs` | 受控只读工具循环、真实证据集合、搜索排序和回答引用校验。 |
| `src-tauri/src/ai/credentials.rs` | 三类连接、旧配置迁移和隔离的 Windows 系统凭据；配置保存失败回滚凭据。 |
| `src-tauri/src/store_ai.rs` | 存储升级、整批采用、基线冲突校验、导入记录和幂等回执。 |
| `src/composables/useAiTasks.ts` | 前端共用任务状态和 Channel；AI 网络状态独立于本地保存状态。 |

解析输出仍采用 `store::Point`，前端对应 `KnowledgePoint`：

```ts
{
  id: string
  name: string
  description: string
  topicIds: string[]
  resourceIds: string[]
  isTheme: boolean
  color: 'docker' | 'linux' | 'mysql' | 'concurrency' | 'neutral'
}
```

原文依据、推断标记和采用选择是草案旁侧元信息。前端 `Point={x,y}` 仍只表示画布坐标，`positions` 不属于 AI 提取输出。内部标识不要求用户查看或管理。

Rust 为所有新增候选统一分配正式 UUID，再映射同批和已有引用。采用把整批变更应用到正式事务副本，继续校验名称、颜色、有效主题及资料引用、重复身份、自归属和任意长度循环；失败则整批回滚。已有内容按基线复核，单纯拖动坐标不会使知识候选过期。

数据库从 v1 事务升级到 v2，仅新增导入记录和采用回执表，保留既有 facts、身份、位置与资料目录。正式知识、导入记录和回执同事务提交；相同采用请求重试不会重复写入，相同请求标识但内容不同会被拒绝。精确重复输入返回已采用记录，不恢复后来删除的点。旧 v1 客户端会拒绝 v2 数据，当前不提供降级迁移。

## 失败、取消与范围

界面显示真实的读取、解析、检索、接收、校验、完成、取消和失败状态。未配置、鉴权失败、余额不足、限流、网络／超时、空白或截断输出、非法字段／引用／循环、候选冲突和正式存储失败分别反馈；适合重试的暂时故障仅有限重试。模型返回 HTTP 成功或合法 JSON，都不足以表示候选可以采用。

取消会停止本地请求和后续任务，忽略迟到结果并保留输入；未完成的 JSON 不成为成功候选。已经提交的采用仍如实显示已采用，不将界面关闭或取消报告成数据库回滚。客户端无法承诺撤销供应商已发生的计算或用量。

AI 不可用时，已有知识、本机资料、手工编辑和本地片段搜索仍可使用。网络等待期间不持有 Store 锁，不把模型调用显示成“正在保存到本机”。

当前范围不包含互联网搜索、整库后台扫描／上传、PDF／图片 OCR、音视频或其他原格式转文本，也不恢复外部数据库、对象存储或独立业务后台。PDF、图片和视频继续作为学习资料访问。引用校验保证来源真实存在并属于本轮读取，不能代替对模型理解是否忠于证据的核对。

## 构建和验证

需要 Windows、Rust／MSVC 与 Visual Studio C++ 工具链、Node.js，以及本机 WebView2。以下命令从仓库根目录执行。首次准备依赖时先运行 `npm ci --prefix app`，并为构建脚本使用的 Cargo 缓存下载锁定依赖：

```powershell
$env:CARGO_HOME = Join-Path (Get-Location) '.scratch/personal-knowledge-graph/validation/windows-desktop/.cargo-home'
cargo fetch --locked --manifest-path app/src-tauri/Cargo.toml
./app/build.ps1 -Offline
```

构建脚本嵌入前端资源，并将可执行文件放到 `app/dist-desktop/noterion.exe`。发布构建使用 `./app/build.ps1 -Release`；依赖已缓存时也可同时传 `-Offline`。前端检查入口为 `npm run typecheck --prefix app` 和 `npm test --prefix app`。

真实桌面验证使用匹配本机 WebView2 的 Edge WebDriver。模型设置与两协议验收入口为 `model-settings-acceptance.mjs`；所有数据与配置写入唯一 `.scratch/model-settings/runs/issue-31-.../`，不会覆盖日常配置。脚本通过可见控件操作实际 Windows 客户端，夹具只提供模型响应，本地知识工具、候选采用和凭据保存由真实 Rust 执行。

```powershell
# 调试构建：三类连接、迁移、全部 AI 业务、故障恢复与任务切换。
./app/build.ps1 -Offline
node app/scripts/model-settings-acceptance.mjs --run=issue-31-contracts-your-run --exe=app/src-tauri/target/x86_64-pc-windows-msvc/debug/noterion.exe --driver=你的/msedgedriver.exe

# 正式构建：HTTPS 策略、迁移、设置与重启，不发送外部模型请求。
./app/build.ps1 -Offline -Release
node app/scripts/model-settings-acceptance.mjs --run=issue-31-release-your-run --scenario=release-smoke --exe=app/dist-desktop/noterion.exe --driver=你的/msedgedriver.exe

cargo test --locked --target x86_64-pc-windows-msvc --manifest-path app/src-tauri/Cargo.toml
```

标准 Windows CI 运行两协议的 Rust HTTP/SSE 契约测试和调试客户端桌面场景，不需要付费密钥；发布候选仍由正式构建打包。结果 JSON、夹具协议统计和截图分别记录在运行目录。测试只创建并清理本轮专用合成 Windows 凭据，不枚举其他用户配置或密钥。

`app/scripts/ai-acceptance.mjs` 与此前 `app/validation/ai-acceptance.md` 属于 Issue #22 历史客户端入口和记录，其 DeepSeek 模态框选择器不适用于当前设置页。当前研究、验收和审查记录位于 `.scratch/model-settings/`；本机夹具通过与官方实网验证分别记录，不能相互冒充。