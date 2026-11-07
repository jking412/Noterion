# 个人知识图谱：Neo4j 与 PostgreSQL 候选核验

核验日期：2026-11-07（Asia/Shanghai）。本文应用 research 技能，使用产品官方文档、许可证页面与对应驱动项目自己的源码仓库。仅研究 Neo4j 与 PostgreSQL 两种新候选，不安装软件、不编写原型、不确定 schema、级联策略或最终选型。

## 1. 先明确“正式”的含义，再决定数据库类别

SQLite 也是数据库管理系统，只是采取嵌入式、无独立数据库服务器的架构；不能把“嵌入式”理解成“不正式”。用户已表示不希望采用 SQLite，本轮尊重这一偏好，将比较收敛到 Neo4j 与 PostgreSQL。“更正式”仍需细化成可比较的目标：希望学习和使用属性图／Cypher，还是希望有独立服务、数据库账户、管理工具与单独的数据管理方式。[SQLite architecture](https://www.sqlite.org/serverless.html)、[SQLite overview](https://www.sqlite.org/about.html)。

**条件建议：** 如果图模型与 Cypher 本身就是用户希望采用和学习的技术，优先深入 Neo4j；如果核心诉求是独立数据库服务和完整管理工具，PostgreSQL 是另一条直接可比较的路线。两者都需要解决本地数据库进程的安装、配置、启动、升级与恢复，不能因为换成 PostgreSQL 就把服务运维视为消失。此处是本项目判断，尚非用户决定。

最新技术交接指出 Tauri 为首选，具体数据库仍待确认。此前已确认的交付约束仍有效：普通使用者接受 A（安装／解压即用）或 B（首次简单安装一个环境），不接受 C（技术用户式部署）。新选型应先澄清由工程侧承担多少数据库打包与管理工作，不能默认要求最终用户自己配置数据库。

## 2. 两种数据模型都能表达已确认内容，组织方式不同

| 比较项 | Neo4j | PostgreSQL |
| --- | --- | --- |
| 核心模型 | 属性图：节点、带类型及方向的关系，节点和关系可带属性 | 关系模型：表、行、列，使用关联记录连接对象 |
| 查询语言 | Cypher，直接表达节点和关系模式；有可变长度路径等图查询语法 | SQL，通过连接、子查询等查询关联；递归 CTE 可处理层级与图遍历 |
| 已确认业务的表达 | 可将知识点、资料与导入记录等作为相应对象表达，并用关系连接 | 可用相应记录及关联表达同一业务逻辑 |
| 一致性能力 | 访问图、索引与 schema 的数据库操作在事务中执行，支持 ACID | 支持事务块提交／回滚及事务隔离 |
| 不能替用户决定的事 | 是否合并同义点、同名消歧、哪些关系代表所属主题，以及共享删除例外 | 同样不能由表结构、唯一约束或外键替用户决定这些行为 |

事实依据：[Neo4j property graph](https://neo4j.com/docs/getting-started/appendix/graphdb-concepts/)、[Cypher variable-length paths](https://neo4j.com/docs/cypher-manual/current/patterns/variable-length-paths/)、[Neo4j transactions](https://neo4j.com/docs/operations-manual/current/database-internals/transaction-management/)、[PostgreSQL table basics](https://www.postgresql.org/docs/current/ddl-basics.html)、[PostgreSQL SQL tutorial](https://www.postgresql.org/docs/current/tutorial-sql.html)、[PostgreSQL recursive queries](https://www.postgresql.org/docs/current/queries-with.html)、[PostgreSQL BEGIN](https://www.postgresql.org/docs/current/sql-begin.html)。业务表达两行为依据上述能力作出的推断，并非具体 schema。

Neo4j 的优势在于让关系和图模式成为直接操作的对象；这对于希望沿关系浏览、探索路径以及学习图查询的用户有实际意义。PostgreSQL 可以保存图的逻辑结构，并非只能处理没有联系的平面表；代价是图遍历需要用 SQL 或应用逻辑组织。没有实际查询样本、规模和测试前，不断言其中之一更快，也不把图数据库等同于能够自动理解笔记或自动识别同义。

## 3. 管理工具与 Windows 本地运行

| 比较项 | 已核验事实 | 对本项目的含义 |
| --- | --- | --- |
| Neo4j 管理／查询入口 | Neo4j Browser 是面向开发者的 Cypher 查询与结果可视化工具；数据库还提供 Cypher Shell 与 neo4j-admin 工具 | 适合检查图数据、执行查询和管理数据库；它们不替代面向个人用户的导入预览、资料打开与纠错界面 |
| Neo4j Windows 服务路线 | 官方支持 ZIP 分发、控制台运行与 Windows 服务；需要适配相应 Java 运行时和配置，服务配置或 Java 路径变化有更新／重启步骤 | 若做一体化安装，需由工程侧处理数据库与运行时生命周期；若交给用户操作，会增加部署维护负担 |
| PostgreSQL 管理入口 | pgAdmin 是独立的图形管理与开发工具，PostgreSQL 还提供命令行管理工具 | 可满足查看数据库对象和执行 SQL 等管理需求；普通用户不应被迫通过 pgAdmin 完成产品核心操作 |
| PostgreSQL Windows 安装 | PostgreSQL 官网链接 EDB 提供和托管的安装器，内含 PostgreSQL server、pgAdmin、StackBuilder；支持图形或静默安装，也提供供集成进其他安装器的二进制 ZIP | 安装器来源需正确标为 EDB；已有安装路径可借鉴，但本项目的一体化交付仍需实际验证 |
| PostgreSQL Windows 服务 | 官方 pg_ctl 支持注册 Windows 系统服务及控制启动方式 | 独立数据库服务仍需管理数据目录、账户、连接、升级和恢复；不是仅替换一个库文件 |

来源：[Neo4j Browser](https://neo4j.com/docs/browser/)、[Neo4j administration tools](https://neo4j.com/docs/operations-manual/current/neo4j-admin-neo4j-tools/)、[Neo4j Windows installation](https://neo4j.com/docs/operations-manual/current/installation/windows/)、[pgAdmin documentation](https://www.pgadmin.org/docs/pgadmin4/latest/)、[PostgreSQL Windows installers](https://www.postgresql.org/download/windows/)、[PostgreSQL pg_ctl](https://www.postgresql.org/docs/current/app-pg-ctl.html)。表格最后一列为本项目取舍分析。

“Community Edition”指产品版本，不能由这个名称推出它必须作为单独服务部署。Neo4j 官方还支持将相应库纳入 Java 应用、在同一 JVM 中嵌入运行；这条路线不同于 Tauri 的 Rust 进程内直接嵌入。若要为 Tauri 引入 JVM 或桥接层，需要另行证明收益，本轮不把它设成默认方案。[Neo4j embedded Java](https://neo4j.com/docs/java-reference/current/java-embedded/)、[Neo4j embedded setup](https://neo4j.com/docs/java-reference/current/java-embedded/setup/)。

本轮没有得到用户接受 Docker 的答复，因此不把 Docker Desktop、容器或 Compose 列为用户必须安装的前提；也不把 Neo4j Desktop 应用的安装许可与 Community Server 的许可混为一谈。

## 4. Tauri Rust 如何连接

### Neo4j：官方协议 API 与社区驱动是两类选择

当前 Neo4j 官方支持的语言驱动列表没有 Rust；官方文档把 Rust 的 `neo4rs` 放在 community-contributed libraries 一节，并注明其通过 Bolt 接入。它属于社区驱动，不能因文档列出或仓库归入 neo4j-labs 就称为 Neo4j 官方受支持的 Rust SDK。[Neo4j supported libraries](https://neo4j.com/docs/getting-started/languages-guides/)、[Neo4j community Rust driver](https://neo4j.com/docs/getting-started/languages-guides/community-drivers/#using-neo4j-from-rust)。

Neo4j 的官方 **Query API** 允许客户端通过 HTTP 执行 Cypher，官方将没有受支持语言驱动的客户端列为主要用途；它支持参数化查询、隐式事务与显式事务的提交／回滚。因此，Tauri 的 Rust 本地逻辑可通过 HTTP 客户端封装官方 Query API。这是根据协议能力作出的可行性判断，尚未在本项目实现或验证，不等于获得了官方 Rust SDK。[Query API introduction](https://neo4j.com/docs/query-api/current/)、[Query the database](https://neo4j.com/docs/query-api/current/query/)、[Query API transactions](https://neo4j.com/docs/query-api/current/transactions/)。

两条候选路径的取舍是：社区 Bolt 驱动可以复用 Rust 驱动抽象，但需核对其目标版本、特性及维护情况；官方 HTTP Query API 避开“必须有官方 Rust SDK”的前提，但认证、响应类型映射、错误及事务生命周期需要应用适配。当前旧 transactional HTTP API 已被标记弃用，应以新的 Query API 为比较对象，不沿用旧端点教程。[Neo4j HTTP API deprecation](https://neo4j.com/docs/http-api/current/)、[Query API endpoints](https://neo4j.com/docs/query-api/current/endpoints/)。

**若选 Neo4j 的条件建议：** 先比较 Rust 内封装官方 Query API 与社区 Bolt 驱动，不为获得 JavaScript 官方驱动就默认再增加 Node.js 后端或 sidecar。本轮不选库、不钉版本、不确定具体通信实现。

### PostgreSQL：Rust 生态已有社区客户端，也有 Tauri 官方集成入口

`rust-postgres` 项目提供同步 `postgres` 与异步 `tokio-postgres` 客户端。它们是独立 Rust 社区项目提供的 PostgreSQL 客户端；项目仓库及 Cargo 清单可核验其作者、源代码和许可证，不能称作 PostgreSQL 核心项目官方 Rust 驱动。[rust-postgres source](https://github.com/rust-postgres/rust-postgres)、[tokio-postgres Cargo manifest](https://github.com/rust-postgres/rust-postgres/blob/master/tokio-postgres/Cargo.toml)。

Tauri 官方 SQL 插件也列明 PostgreSQL 支持，底层使用 SQLx。这个事实说明 Tauri 官方已有 SQL 集成入口，不意味着 PostgreSQL 团队提供或支持该插件，也不决定本项目应让前端直接提交 SQL。后续可以比较官方插件与 Rust 本地逻辑内使用社区客户端的方式，按领域操作和维护目标选择。[Tauri SQL plugin](https://v2.tauri.app/zh-cn/plugin/sql/)。

## 5. 社区版与再分发：先核对许可证对象

| 组件 | 官方许可证事实 | 本轮保留的边界 |
| --- | --- | --- |
| Neo4j Community Edition | Neo4j 官方列为 GPL v3；Enterprise Edition 另属商业许可 | 是否随本项目分发数据库二进制、是否修改、是否嵌入及随包附带什么组件，应在交付设计明确后按相应条款核对 |
| PostgreSQL 核心 | PostgreSQL License，官方称为类似 BSD／MIT 的宽松开源许可；文本允许使用、复制、修改及分发，并要求保留指定声明 | 不能把核心许可证直接推广到 EDB 安装器、pgAdmin、驱动和所有附带组件 |
| 图形工具与运行时 | Neo4j 官方法律条款目录把 Community Edition 与 Neo4j Desktop 的条款分列 | 下载免费、可个人使用、可随自己的产品再分发是不同问题；工具和运行时逐项核对 |

来源仅使用：[Neo4j open-source licensing](https://neo4j.com/open-source-project/)、[Neo4j legal terms index](https://neo4j.com/legal-terms/)、[PostgreSQL License](https://www.postgresql.org/about/licence/)。本文只记录官方声明，不判断项目整体许可兼容性，不把外部服务通信或静态／动态链接模式直接推成法律结论，也不代用户选定开源许可证。

## 6. 备份与恢复是实际交付成本

Neo4j Community Edition 的官方完整 dump／load 路线要求 DBMS 离线。若采用该路线，产品需要解释和管理备份时的数据库停启；不能拿 Enterprise 的在线备份能力当作社区版默认能力。[Neo4j offline backup](https://neo4j.com/docs/operations-manual/current/backup-restore/offline-backup/)、[Neo4j restore dump](https://neo4j.com/docs/operations-manual/current/backup-restore/restore-dump/)。

PostgreSQL 的 pg_dump 可以在数据库并发使用时生成一致导出；与相应恢复工具配合可用于备份及迁移。这不等于目录复制、全实例状态和应用附件都已经被包含，也不意味着任意版本恢复已经验证。[PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html)。

两种引擎如果都把上传资料本体放在数据库外，完整恢复仍需覆盖数据库与相应资料文件；数据库更换不会消除这个责任。备份频率、保留数量、恢复覆盖行为以及数据目录由谁管理仍需访谈，不在本轮默认新增产品流程。

## 7. 下一轮应收敛的两项决定

1. **“正式”的具体目标。** 若希望真正使用图模型、学习 Cypher 并直接查询知识关系，推荐优先 Neo4j；若希望独立服务、账户及可视管理，但不特别追求图查询，推荐继续对照 PostgreSQL。当前搜索名称、文本资料和查看资料的目标，不足以单凭性能或容量排除任一候选。
2. **普通用户与工程侧的维护责任。** 推荐继续保持既有 A／B 交付体验，由工程侧承担数据库随包集成或受控首次安装、连接与生命周期管理。若希望用户手工安装数据库、设置账户和端口、管理服务并自行升级恢复，就需要用户明确修改此前拒绝 C 的约束；不能把这一改变藏在“换正式数据库”里。

技术访谈在两项回答前只形成条件建议。Tauri 首选与具体数据库可以分开确认，不需要将 React、Rust 驱动、通信 API 和数据库一起捆绑批准。

业务依据已重新读取：导入累积补充、缺失不删；解释性正文按模板自动整理为关联文本资料；MVP 搜索覆盖知识点名称及已保存文本资料；DeepSeek 在 MVP 后优先增强。删除主题及其下知识点的意向、保留上传文件本体已提出，但共享知识点、多主题、文本资料删除／恢复和级联范围仍待细化。两个数据库都不能替这些业务问题作决定。本报告不确定主键、名称唯一性、关系 schema 或删除语句，也不引入双数据库或向量数据库。
