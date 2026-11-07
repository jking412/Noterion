# Noterion：Rust 本地核心与基础库建议

核验日期：2026-11-07（Asia/Shanghai）。仅方案与官方资料研究，未创建应用、安装依赖、运行数据库或锁定版本。研究前已重读最新 spec.md、CONTEXT.md 与技术记录。

用户已确认片段可以命中较长名称或 description；多关键词的 AND/OR 由使用者选择。本报告承接这些结果，不继续追问业务规则或重开业务 Grill。正式规格以完整桌面用户操作为主要验收边界，不改为每个内部模块单独验收，也不新增 MVP 排期。

## 一套可维护的默认建议

推荐在一个 Tauri 应用内采用 **Rust 模块化核心＋SQLx/PostgreSQL＋Neo4j 官方 HTTP Query API/reqwest＋Tokio＋serde＋aws-sdk-s3**。图更新推荐用 PG 同事务 outbox 和应用内后台任务组织，不引入 Kafka、额外 Web 后端或同步微服务。

这些是工程推荐，供技术主线收敛，不把每个小库作为新的用户选择题。“适合 AI 辅助开发”在这里指接口明确、SQL 可读、输入输出有类型、错误可观察且结果可验证；不声称这套组合在所有项目或模型下最优。

## 1. 模块边界：业务核心独立于桌面框架

| 职责 | 推荐边界 |
| --- | --- |
| 领域逻辑 | 普通 Rust 类型和函数，表达知识点、主题关系、共享保留及回收状态等已定规则；不引用 Tauri 窗口、SQLx 行类型、HTTP 响应或 S3 SDK 对象 |
| 应用操作 | 组织搜索、编辑、删除、资料访问等用例，决定事务边界，调用持久化、图查询和文件访问能力；不直接操纵界面控件 |
| 基础设施适配 | 分别封装 PostgreSQL、Neo4j HTTP、S3 对象接口与配置读取；将外部错误转换为应用可理解的结果 |
| IPC 命令 | 接收类型化请求、执行边界校验、调用应用操作并返回结构化结果；保持薄层，不堆放领域规则或拼接原始 SQL |
| 投影后台任务 | 从 PG 读取待处理变更、更新 Neo4j 并记录进度；复用应用操作和图适配边界，负责失败恢复 |

这些是同一进程中的职责，不要求每层独立 crate、通用仓储框架或插件平台。接口只建在需要隔离外部系统的位置，避免为所有结构套一层抽象。

Tauri 官方命令机制允许传参、返回值、错误和 async 命令；其运行时模块使用 Tokio 并公开任务调度能力。推荐复用这一异步运行时，不为每次调用建立新运行时。界面调用“搜索知识点”“保存知识点”等应用能力，不接收任意 SQL/Cypher 执行入口。长期数据库/S3 凭据由 Rust 侧配置持有，不发送给渲染端；临时预签名访问结果与长期凭据分别处理。[Tauri 命令](https://v2.tauri.app/develop/calling-rust/)、[Tauri 异步运行时](https://docs.rs/tauri/latest/tauri/async_runtime/index.html)。

## 2. PostgreSQL：SQLx、迁移与离线查询元信息

SQLx 提供 PostgreSQL 驱动、连接池、参数化查询、可选编译期查询检查和迁移支持。推荐直接保留可读 SQL；固定查询优先使用 query!/query_as! 等宏，需要动态组合 AND/OR 时使用受控语法分支和绑定参数，不能拼接用户输入为 SQL。动态查询不因项目使用 SQLx 就自动获得与静态宏相同的编译期检查范围。

开发与交付应分开：

1. 开发者在匹配 schema 的开发 PG 上执行 cargo sqlx prepare，生成并维护 .sqlx 查询元信息。
2. 将元信息纳入版本管理，常规构建可用 SQLX_OFFLINE=true，避免构建时意外连接 DATABASE_URL 指向的数据库。
3. 开发/CI 在需要时用 prepare --check 对照实际 schema 与查询，检查缓存是否陈旧。这一步仍需匹配的开发数据库，不能把缓存误当作数据库行为测试。
4. 普通使用者安装预编译桌面包，不执行 cargo、prepare 或 sqlx-cli，也不需要为了“编译检查”先连接数据库。应用运行时仍需已配置的 PG 服务；这与构建是否需要活动数据库是两件事。

迁移可通过 SQLx migrate! 嵌入发行二进制，由应用受控地执行；不要求普通用户另装迁移 CLI。发布构建需要确认新增迁移已被重新嵌入、迁移顺序与历史一致。官方也记录了迁移目录变更的编译监视及跨平台行尾对校验值的影响；具体升级流程继续在实现设计中处理，不以“有迁移库”承诺所有升级自动安全。

主要依据：[SQLx 官方 CLI：迁移与 .sqlx 离线构建](https://github.com/transact-rs/sqlx/blob/main/sqlx-cli/README.md)、[SQLx 迁移宏](https://docs.rs/sqlx/latest/sqlx/macro.migrate.html)。旧 launchbadge/sqlx 官方 URL 在本次核验时重定向到 transact-rs/sqlx；本文不固定 SQLx 或 PostgreSQL 版本。

## 3. Neo4j：默认官方 Query API，neo4rs 作有限替代

**推荐先用 reqwest 调用 Neo4j 官方 HTTP Query API，并封装为一个图适配模块。** 官方将该 API 定位为没有受支持语言驱动时的应用接入路径；它执行参数化 Cypher，也提供事务接口。应使用当前 Query API，不据旧教程默认采用已弃用的旧 HTTP API。选定服务器版本后核对端点与启用配置，不因“使用 Neo4j”就认为所有旧镜像都支持相同接口。

必须处理的协议细节：

- 当前文档说明普通查询请求会返回 202，即使 Cypher 执行失败也不能仅靠 HTTP 状态判定成功；解析错误字段并转换为应用错误。
- 网络超时不一定证明服务器没有提交。图更新需要稳定应用 ID、幂等操作与版本/顺序控制，再决定重试；不将 Neo4j elementId 当作跨事务、重建后稳定的业务身份。
- HTTP 超时、认证失败、Neo4j 查询错误及图更新落后分别处理。图失败不能映射成“没有关系”。

neo4rs 是真实的 Rust/Bolt 选择，当前由 Neo4j Labs 孵化；其 README 明确为实验项目，不属于受支持产品线，且仍声明功能与 Bolt 版本范围有限。若后续需要其会话或结果处理接口，可以在同一图适配边界内评估，不能因此宣称已获得官方 Rust 产品驱动或任意 Neo4j 版本兼容。当前不同时引入两套接入实现，也不为获取其他语言的官方驱动增加 Node/Python 服务。

主要依据：[Neo4j Query API 介绍](https://neo4j.com/docs/query-api/current/)、[查询与响应语义](https://neo4j.com/docs/query-api/current/query/)、[neo4rs 项目说明](https://github.com/neo4j-labs/neo4rs)。HTTP 推荐基于当前调用边界和官方协议说明，不是与 Bolt 做过性能对比的结果。

## 4. reqwest、Tokio 与 serde 的职责

reqwest 官方文档说明其异步 Client 依赖 Tokio，支持 JSON 等请求体，并建议复用 Client 以使用连接池。推荐在应用状态中复用 PG 连接池、HTTP Client 与 S3 Client；网络调用使用 async，确有阻塞/重计算的工作再通过合适执行路径隔离，不把大文件收发放到界面线程。

serde/serde_json 用于 IPC 与外部 JSON 的序列化和反序列化；Rust enum 可明确表达 AND/OR 等有限选择。成功反序列化不证明语义合法：身份格式、已定字段约束、跨字段关系及当前对象状态仍由边界/领域逻辑检查。未知字段、可选字段和错误结构要采用明确策略，不新增一个尚未证明必要的通用校验框架。

此分工有助于发现 AI 生成代码的契约错误，但不能证明共享节点删除、搜索或故障行为符合要求。主要依据：[reqwest 官方 crate 文档](https://docs.rs/reqwest/latest/reqwest/)、[serde 属性与类型表示](https://serde.rs/container-attrs.html)。

## 5. S3：沿用已选对象接口，采用 aws-sdk-s3

推荐 Rust Core 以 aws-sdk-s3 操作对象，并封装项目需要的上传、读取、分段与临时访问能力。AWS 官方 Rust SDK 支持自定义 endpoint 和预签名请求；使用 SDK 不等于必须创建 AWS 账户，实际请求目标取决于配置及所选兼容服务。

PG 保存正式资料记录与稳定对象引用，临时 URL 在访问时生成；渲染端不持有长期 S3 keys。大视频访问沿用内置优先、外部兜底方向，读取提供流式/Range 路径，不默认完整载入内存或先下载完大视频。具体服务器、签名请求头及 API 差异仍按选定服务核验，不由 SDK 存在直接推导兼容性。

主要依据：[AWS Rust SDK endpoint 配置](https://docs.aws.amazon.com/sdk-for-rust/latest/dg/endpoints.html)、[预签名请求](https://docs.aws.amazon.com/sdk-for-rust/latest/dg/presigned-urls.html)。本地候选事实见 [对象存储产品研究](./object-storage-product-choice.md)，本文不重新筛选产品。

## 6. 同事务 outbox 与应用内后台任务

推荐在一个 PG 事务中保存正式变更及待投影记录，提交后按已确认 Q14 告知正式保存完成；后台任务从已提交记录推进 Neo4j。这样 PG 保存成功而进程退出时，待处理工作仍在数据库中，不依赖内存队列保存事实。

后台处理建议覆盖：有界批次、稳定事件/实体标识、顺序或版本检查、重复处理幂等、可重试错误分类、待处理状态及重建协作。收到 Neo4j 成功结果后再记录处理完成；响应丢失时允许重复尝试但不产生重复节点或回放旧状态。删除、恢复也需要投影，不由图适配模块另行决定业务级联。

此模式可由 Rust 任务直接读取 PG 并调用 Neo4j，不要求 Kafka、CDC 服务、消息队列或常驻同步微服务。AWS 模式文档中的托管服务只是其示例，不是 Noterion 的新增依赖。[官方 transactional outbox 模式](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)。

工程边界：

- 后台任务随桌面应用运行时，应用完全退出后不继续执行；未处理记录可在下次启动续处理。不默认新增关窗后常驻服务。
- 按已确认 Q15，Neo4j 不可用时保留待投影记录，其他相应组件正常时继续 PG 基础读写和资料访问；恢复须赶上正式变化，再恢复“最新图”入口。
- Outbox 只将 PG 事实与待处理记录纳入同一次事务，不把 Neo4j 提交或对象上传自动变为 PG 原子操作。上传未完成、正式资料记录未就绪时，不能套用 Q14 把文件显示为可打开。
- 重试间隔、并发、批量大小及具体表结构属于后续工程设计，本文不锁定数值或版本。

## 验证与选型状态

类型、SQL 查询元信息、格式与静态检查是开发侧质量检查；用户验收继续以正式规格的完整桌面操作为主：搜索后定位、共享知识维护、删除恢复、资料查看、重启持久化与图副本重建。协议错误和重试可通过应用操作边界补充必要集成验证，不为每个内部模块强制建立单独验收接口。

本报告推荐的库和模块边界仍需技术主线确认后形成实现决定。未锁定具体版本，未决定新测试框架，未创建代码或配置，也未修改已确认业务规则。
