# 数据库候选：双库方案与单库对照

核验日期：2026-11-07（Asia/Shanghai）。本文是技术研究及建议，不是已确认选型，未安装数据库或实现同步。

## 当前输入

用户已选择 Tauri，对 Neo4j 与 PostgreSQL 都有兴趣，接受配置并愿意自行配置 Docker；当前先不按部署便利排序。用户的技术兴趣和学习价值是有效选型因素。未来面向普通使用者的数据库交付前提暂挂起，不据此继续追问部署细节。

研究前重读了最新 CONTEXT.md 与 spec.md。当前业务是个人长期积累：主题也是知识点，一个知识点可属于多个主题；知识关系当前先支持“所属主题”；解释文字是知识点的 description 属性；检索名称和 description；名称不同视为不同知识点，不做自动语义归并；导入累积补充；主题删除保留仍属于其他主题的共享节点，支持回收站。当前业务稿明确不进行 MVP 划分，也暂缓导入导出及备份恢复细节，本文不重新引入这些排期或交互讨论。

## 研究判断

**Tauri＋PostgreSQL＋Neo4j 可以是有价值的选择，尤其当用户希望学习关系模型、属性图及二者配合时。** 但目前的业务能力并不在技术上强制要求双库：Neo4j 自身支持全文索引，PostgreSQL 自身支持递归关系查询。双库的价值应明确为图查询、技术探索和后续扩展，由项目承担同步与一致性设计。

若继续双库，本报告推荐的结构是“PostgreSQL 保存完整业务事实，Neo4j 保存可重建的图投影”，而不是把同一知识点的基本事实分散到两个互相依赖的主库。该推荐是本项目的工程判断，尚待用户确认；**用户尚未接受最终一致或图谱短暂落后，不能将它们直接写成既定行为。**

## 三个主要对照方向

| 对照方向 | 官方事实 | 对本项目的适配判断 | 需要承担的取舍 |
| --- | --- | --- | --- |
| 仅 Neo4j | 支持 ACID 事务；节点的字符串属性可以建立全文索引；可以在一个索引内配置多个属性 | 知识点名称和 description、所属主题、资料信息和导入记录均可按明确图模型组织。对希望以图建模和 Cypher 为学习重点的用户，是直接且合理的方向 | 需要把业务管理状态也用合适的图模型表达；中文分析器、搜索语义与回收站行为仍需按真实场景验证。不能仅因有描述搜索就认为必须再加 PG |
| 仅 PostgreSQL | 支持事务、递归 WITH 查询和全文搜索；pg_trgm 提供相似字符串及 LIKE/ILIKE 的索引支持 | 所属主题、多归属、description、资料关联及回收站可以在一个关系数据模型中表达。若以统一事务和常规业务维护为重点，是合理方向 | 图遍历用 SQL 表达；不直接获得 Neo4j 的 Cypher、图工具及相应学习体验。中文短查询仍需核验，默认全文搜索配置不能视为已经满足中文要求 |
| PostgreSQL＋Apache AGE | AGE 是 PG 扩展，在单一 PG 存储中增加图模型及 openCypher，通过 SQL 中的 cypher() 函数查询；官方声明支持图、关系和 JSON 文档的 ACID 事务 | 希望同时体验 SQL 与 Cypher、又希望避免两个独立数据库间同步时，值得验证。它是替代双库的一条路线，不是再叠加在 PG＋Neo4j 上 | 需要匹配 PG/AGE 版本，处理 agtype、扩展升级与实际查询兼容。openCypher 支持不等于完全兼容 Neo4j Cypher、APOC、GDS、Bolt 或 Query API |

Neo4j 事实：[事务行为](https://neo4j.com/docs/operations-manual/current/database-internals/)、[全文索引](https://neo4j.com/docs/cypher-manual/current/indexes/search-indexes/full-text-indexes/)。全文索引默认随事务同步更新，也可显式配置最终一致；不能把可选异步模式当成 Neo4j 必然存在搜索延迟的依据。[Neo4j 索引配置](https://neo4j.com/docs/operations-manual/current/performance/index-configuration/)。

PostgreSQL 事实：[事务](https://www.postgresql.org/docs/current/tutorial-transactions.html)、[递归 WITH](https://www.postgresql.org/docs/current/queries-with.html)、[全文搜索机制](https://www.postgresql.org/docs/current/textsearch-intro.html)、[pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html)。这些功能说明可选实现路径，不构成当前个人库规模上的性能比较结论。

AGE 事实：[官方项目 README](https://github.com/apache/age)、[官方 FAQ 的 ACID 说明](https://age.apache.org/faq/)、[cypher() 查询格式](https://age.apache.org/age-manual/master/intro/cypher.html)、[SQL 与 Cypher 混合查询](https://age.apache.org/age-manual/master/advanced/advanced.html)。同一存储不会自动把任意业务关系表变成图模型；数据映射和一致性仍需设计，只是可以在 PG 的事务边界内处理。

## AGE 版本与 Rust／HTTP 集成界线

核验时 AGE 官方下载页给出的版本配对如下；不把开发主分支版本号当作所有 PG 大版本通用的稳定发行包。

| PostgreSQL 大版本 | 下载页列出的 AGE 发行版 |
| --- | --- |
| 18 | 1.7.0 |
| 14、15、16、17 | 1.6.0 |
| 11、12、13 | 1.5.0 |

来源：[Apache AGE 官方下载页](https://age.apache.org/download/)。当前 GitHub README 列出支持 PG 11—18；旧 FAQ、quickstart、手册 setup 页面仍有只到 15/16 的旧表述，因此实际采用时按选定 PG 大版本对应的发行包、发行说明和验证结果锁定组合，不直接照抄某个旧页面。这里列出历史版本支持，不建议因 AGE 有旧版包就采用已停止上游维护的 PG 版本。

Rust 集成有两层需要区分：AGE 的网络连接与存储基于 PostgreSQL，可由 Rust 的 PG 客户端在数据库连接上执行包含 cypher() 的 SQL；也有 AGE 专用 Rust connector。官方将 Go、Java、Node.js、Python 列入 Built-in，将 Rust 项目明确列为 Community-driven。[AGE 官方驱动分类](https://age.apache.org/download/)、[官方列出的社区 Rust connector](https://github.com/Dzordzu/rust-apache-age)。存在连接路径不等于本项目已经验证其事务、错误处理和版本兼容。

AGE 返回自定义 agtype；官方将其定义为 JSON 的超集，节点、边等表示不能一律当作普通 JSON 或标准 PG 标量直接解码。Rust 路线需要验证连接初始化、参数化调用、结果解码及错误回滚。[agtype 官方说明](https://age.apache.org/age-manual/master/intro/types.html)、[cypher() 格式](https://age.apache.org/age-manual/master/intro/cypher.html)。

HTTP 边界：AGE 不是 Neo4j 的 HTTP Query API 或 Bolt 服务器。Tauri 的 Rust Core 可以持有 PG 连接并向界面提供受控命令；若另外需要 HTTP 服务入口，需要选择或实现适配层，不因 AGE 支持 Cypher 就默认已经具备 Neo4j 的协议兼容。上述为依据 PG 协议和 cypher() 接口作出的集成判断，尚未做连通性试验。

## 补充的独立产品：SurrealDB

按用户对其他合适数据库的兴趣，额外保留 SurrealDB 作为简短备选。它与 AGE、Neo4j、PG 是替代方向，不建议叠加组成更多数据库服务。

- 官方 Rust SDK 支持连接数据库实例，也支持在 Rust 应用中嵌入运行数据库；是否采用服务模式或嵌入模式可分别选择，不把嵌入能力强加为交付要求。[SurrealDB Rust SDK](https://surrealdb.com/docs/reference/rust)。
- 其核心记录是文档，图边也是记录，使用 RELATE 创建，图关系与文档共享同一存储体系。这提供了在一个产品内表达属性和关系的另一条路线。[SurrealDB 数据模型架构](https://surrealdb.com/docs/learn/data-models/architecture)。
- 本项目判断：与 Tauri/Rust 的技术组合值得试验，也能减少双库同步问题；代价是学习 SurrealQL 及其模型，并独立验证搜索、事务、迁移和工具链。不能把它称为 PostgreSQL 或 Neo4j 的无成本替代品。官网文档同时包含不同产品/SDK 版本的说明，正式比较前应锁定版本与 Rust 最低版本；本文未选择其版本、执行安装或比较性能。

## 对“PG 事实源＋Neo4j 图投影”的独立审查

该方案可成立，但只有清楚定义两者职责后，才是可审查的设计：

1. **PG 保存完整事实。** 不仅是知识点名称和 description，还应包含重建图所需的主题关系、资料关联、稳定标识及有效/回收状态。Neo4j 内的业务图是这些事实的派生表示；资料文件本体怎样保存不由本文决定。
2. **应用写入走唯一入口。** 业务修改在 PG 中提交；可以把同次修改的待同步事件写入同一 PG 事务，再由应用同步图投影。这是建议的可靠同步模式，不是用户已选定实现。Neo4j 中不能再保留一份只在图里存在、无法从 PG 恢复的关键业务事实。
3. **同步至少处理新增、属性变更、关系变更、删除与恢复。** 同一变更重复投递不应产生重复关系；失败需要重试、可观察状态和对账。主题删除对共享节点的影响应由业务核心统一计算，然后投影，不让两个数据库各自实现不同的级联规则。
4. **用户尚未接受图延迟。** “PG 保存成功、Neo4j 尚未更新”是现实的中间状态；可重建并不决定界面应该显示什么。后续应确认图谱立即可见、等待同步、提示未同步或阻止部分操作的体验；现在不把任何一种写成默认行为。
5. **双库提交需要显式协调。** PG 与 Neo4j 各自支持事务，不会因应用依次调用两者就自动成为一次共同原子提交。PG 成功而 Neo4j 失败需要预定处理；简单地“写两次、出错就返回失败”会留下难解释的数据状态。
6. **技术学习收益是正当理由。** 双库可以让项目同时实践关系建模、Cypher、图查询和投影同步；当前业务关系少并不否定这一价值。但应把这项投入讲清楚，不能把双库包装成名称/描述搜索的技术必需。

第 2、3、5 项为结合两套事务接口的工程推断与建议；基础事实来源为 [PostgreSQL 事务说明](https://www.postgresql.org/docs/current/tutorial-transactions.html) 和 [Neo4j 事务说明](https://neo4j.com/docs/operations-manual/current/database-internals/)。本文没有声称实现跨库分布式事务在所有技术条件下绝对不可能，而是指出当前候选没有自动获得这项保证。

不建议将“知识点和主题关系只放 Neo4j，描述/资料/回收记录只放 PG”作为未经设计的自然分工：一个知识点详情、一次主题删除或一次恢复都可能跨库；搜索结果与图节点也可能在中间状态互相缺失。两个数据库都各自保留不可替代的事实，会增加应用连接查询、故障解释和整体数据恢复的要求。这是对当前需求操作边界的推断，不是数据库产品能力的缺陷。

## 供后续讨论使用的建议

- 若用户希望同时使用 PG 与 Neo4j，可以推荐完整的单事实源＋图投影结构，并先确认其职责分工；随后单独讨论可见性和同步失败行为。
- 若更希望直接以图作为项目核心，Neo4j 单库是一条完整候选，不必为了“正式程度”再加 PG。
- 若用户主要想在一个数据库中同时使用 SQL 和 Cypher，AGE 值得做有限技术验证；SurrealDB 则是独立多模型产品的备选。二者均不与 PG＋Neo4j 叠加。
- 当前不重新讨论 Docker 配置便利、完整导入导出、备份恢复流程或版本排期；也不在本研究中确定名称唯一约束、搜索排序、回收站保留期限和文件存储格式。
