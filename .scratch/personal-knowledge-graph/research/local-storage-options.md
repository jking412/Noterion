# 个人知识图谱：本地存储候选核验

核验日期：2026-11-07（Asia/Shanghai）。本文应用 research 技能，仅采用 SQLite、Node.js、Electron、Neo4j 的官方文档作为技术证据；是技术访谈的研究输入，尚非用户确认的架构决定。未安装数据库、编写应用、执行导入或开展性能测试。部分直接页面请求超时，最终技术事实以成功返回的官方文档检索内容为依据；没有将失败请求当作核验成功。

## 1. 结论与适用前提

**建议把 SQLite 作为首个需要比较和验证的存储候选：用它保存知识点、知识关系、资料关联和必要导入记录，并比较将原始学习资料作为受应用管理的普通文件保存的方案。** 这是基于安装维护目标和已确认逻辑的建议，不代表已经选定数据库、附件存放形式或具体表结构。

技术访谈的最新交接约束是：首期 Windows，优先易安装，不限制开发语言；需要为新增功能、格式、可选 AI 及未来 macOS/Linux 留出扩展空间；NAS 已取消；不把离线能力列为要求；长期规模是个人逐步积累。这不意味着必须联网或采用云端存储。业务草稿仍在并行更新，相关技术决定前应重新读取 [spec.md](../spec.md) 与 [CONTEXT.md](../../../CONTEXT.md)。

SQLite 是应用进程内的库，由应用直接读写磁盘数据库文件，不需要单独安装、启动或维护数据库服务器。这与易安装目标相符；但数据库引擎嵌入应用不等于应用整体无需打包、升级或备份设计。[SQLite Is Serverless](https://www.sqlite.org/serverless.html)、[How SQLite Works](https://www.sqlite.org/howitworks.html)。

不能因为产品名叫“知识图谱”就直接推出必须用图数据库。SQLite 官方直接提供用关系表和递归查询遍历图的示例；另一方面，图数据库有专门的路径查询表达能力，也存在嵌入式交付方式。选择应取决于实际查询与维护收益，而非节点和线的外观。[SQLite WITH：Queries Against A Graph](https://www.sqlite.org/lang_with.html#queries_against_a_graph)、[Neo4j variable-length paths](https://neo4j.com/docs/cypher-manual/current/patterns/variable-length-paths/)、[Neo4j embedded Java](https://neo4j.com/docs/java-reference/current/java-embedded/)。

## 2. SQLite 能表达什么，不能替业务决定什么

| 已确认逻辑或技术需要 | 已核验能力 | 必须保留的边界 |
| --- | --- | --- |
| 知识点之间存在“所属主题”等知识关系 | 普通记录可保存知识点，关联记录可表达有方向的关系；递归 CTE 可以遍历树或图 | 此处不确定具体 schema、允许的关系类型、循环约束或多主题规则 |
| 一个知识点可以关联多份原始资料，不同输入可以贡献同一个知识点 | 普通表及关联记录可以表达共享与多对多关系 | 共享知识点的识别、同义复用、字段覆盖及删除影响由业务决定 |
| 正式采用导入结果时需要一致地保存相关变化 | SQLite 提供事务；同一事务中的数据库变化可以整体提交或回滚 | 一次确认应包含哪些变化、如何处理冲突，不由事务边界反推 |
| 资料关联与知识关系不应出现指向不存在记录的引用 | SQLite 提供外键约束 | 外键检查需按连接显式启用并验证；不据此默认设置级联删除 |

前三行中的“可用记录表达”是依据关系模型与官方图查询示例作出的设计推断，而非现成的本项目数据模型。SQLite 支持 ACID 事务；外键支持取决于构建配置及连接设置，应用不能依赖默认状态。[SQLite transactions](https://www.sqlite.org/transactional.html)、[SQLite foreign keys](https://www.sqlite.org/foreignkeys.html)、[SQLite WITH](https://www.sqlite.org/lang_with.html)。

SQLite 的事务和关联能力可以容纳预览后采用、共享知识点、资料关联及导入贡献追踪等逻辑，但不会自动定义业务身份。“名称相同”不能据此设置为全局唯一；“同一来源”也不能据此等同于同一知识点。本报告不设计唯一约束、覆盖策略或级联策略。业务已经逐步明确的原记录更新、完全重复提示、累积导入及缺失条目处理，应在实施前以最新业务草稿复核。

事务可靠性还需要正确的同步和日志设置。不能只引用 ACID 宣传页，就把所有配置、硬件和文件操作都视为具有相同的持久性；SQLite 官方明确区分不同 `synchronous` 与日志模式的持久性条件。[SQLite PRAGMA synchronous](https://www.sqlite.org/pragma.html#pragma_synchronous)。

## 3. 原始学习资料文件与数据库应共同考虑

SQLite 官方讨论了两种保存二进制内容的方式：直接保存为数据库内 BLOB，或将本体作为独立文件保存、数据库记录其引用。其性能对比对应特定年代、系统与测试条件，不能移植成当前 Windows、任意 PDF 或未来资料大小的结论。[Internal Versus External BLOBs](https://www.sqlite.org/intern-v-extern-blob.html)。

**候选建议：** 先比较“SQLite 保存结构化记录＋应用数据目录保存原始学习资料文件”。其目的在于把图谱数据与完整资料本体的管理职责说清楚；附件目录的确切位置、是否允许移动、是否按内容去重、命名方式及打开方式均尚未决定。也保留 BLOB 方案作为可比较选项，不以未经测试的速度或大小门槛排除。

这个方案需要承认一个边界：SQLite 事务管理其数据库变化，不会因事务提交就自动保证外部普通文件与数据库一起完成同一个原子提交。由此推断，后续设计必须处理文件复制失败、写入中断以及数据库引用与文件存在性不同步的情况；具体采用临时文件、恢复记录还是其他方法，留到实现设计，不在此处引入额外业务流程。[SQLite transactions](https://www.sqlite.org/transactional.html)、[SQLite Backup API](https://www.sqlite.org/backup.html)。

按最新业务定义，用于建图的结构化导入文件与供用户重新查阅的原始学习资料按用途区分：成功入图后不要求长期保存导入文件副本；原始学习资料文件需要保存本体；导入记录不等于归档整篇笔记原文。笔记正文中作为解释、命令和学习内容保留的部分，应继续遵守业务聊天刚澄清的学习资料边界，不能仅凭扩展名处理。[项目需求草稿](../spec.md)、[项目领域词汇](../../../CONTEXT.md)。

## 4. 备份：一致的数据库副本只是其中一部分

SQLite 的 Online Backup API 能将一个数据库的内容复制到另一个数据库，允许分步复制；成功完成后得到一致的数据库快照。并发写入可能导致复制重启，因此必须检查最终完成状态，不能把启动备份当作备份成功。[SQLite Backup API](https://www.sqlite.org/backup.html)。

WAL 模式下，提交的数据可能仍位于 `-wal` 文件中；WAL 属于持久数据库状态。官方明确指出，将主数据库与对应 WAL 分离可能丢失已经提交的事务或造成损坏。因此“应用运行时随手只复制一个 .db 文件”不能作为通用的可靠备份方案；热备份优先考虑官方备份机制。若选停机复制，也需要定义并验证正常关闭、日志处理与无并发写入等条件。[SQLite WAL](https://www.sqlite.org/wal.html)、[SQLite file format](https://www.sqlite.org/fileformat.html)。

如果资料本体在数据库之外，Online Backup API 不会顺带备份这些文件。**本项目推断：** 完整恢复至少应覆盖一致数据库快照、该快照引用的原始学习资料本体，以及识别相应数据格式所需的信息。备份期间若允许变更资料，必须让数据库引用与文件集合对应同一个可恢复状态；不能简单把两个分别成功的复制动作宣称为完整一致备份。

SQLite 也提供 `VACUUM INTO` 等其他备份技术。当前只核验这些能力存在，不决定备份频率、位置、包格式、自动化方式、恢复覆盖行为或保留数量，也不把 CSV 导出当作完整备份。[SQLite backup alternatives](https://www.sqlite.org/backup.html#other_backup_techniques)。

## 5. 中文检索：选 SQLite 不等于已经解决搜索

FTS5 默认 `unicode61` 根据 Unicode 字符类别区分 token 字符和分隔符，将连续 token 字符视为一个词项。它不是中文词典分词器；据此不能保证用户输入中文短词就能命中包含该词的较长中文串。[FTS5 Unicode61](https://www.sqlite.org/fts5.html#unicode61_tokenizer)。

FTS5 的 `trigram` 将连续三个字符作为词项；官方明确说，少于三个 Unicode 字符的子串无法通过全文查询命中。`LIKE`、`GLOB` 另有索引使用和扫描条件，不能将其与全文 `MATCH` 的行为混为一谈。因此“锁”这类单字查询和两个汉字的查询，需要在最终匹配规则确定后单独验证。[FTS5 trigram](https://www.sqlite.org/fts5.html#the_trigram_tokenizer)。

**候选比较方向：** 业务规则明确后，可比较名称等字段上的确定性字符串匹配、适配中文的分词索引及其他必要方案。此处不选择搜索字段、精确与模糊的优先级、同义扩展或资料正文检索范围，也不因采用 SQLite 就默认首期引入向量库。实际容量和查询样本尚未确定，本文不承诺性能。

## 6. 如果以后选择 Node.js／Electron，接口需分别核对

Node.js 官方提供内置 `node:sqlite` 模块，用于连接 SQLite 数据库；接口及可用能力随 Node.js 发布变化。本研究只核验这一接口路径存在，不固定 Node.js 版本、具体类名或 SQLite 驱动，也不把它指定为本项目首选驱动。[Node.js SQLite API](https://nodejs.org/api/sqlite.html)。

Electron 应用运行的 Node.js 是其内嵌运行时，与开发电脑终端里安装的 Node.js 不能视为同一个对象。Electron 官方建议在应用的主进程或 preload 中读取 `process.versions` 确认实际运行版本。因此宿主 Node.js 能使用某个 SQLite 内置接口，不证明目标 Electron 包必然可用；需按实际 Electron 运行时核验。[Electron prerequisites](https://www.electronjs.org/docs/latest/tutorial/tutorial-prerequisites)、[Electron preload example](https://www.electronjs.org/docs/latest/tutorial/tutorial-preload)。

若改用第三方原生 SQLite 模块，需要核对其目标 Windows 架构及 Electron 兼容性。Electron 官方说明其 ABI 与普通 Node.js 二进制有差异，并提供 `@electron/rebuild` 和预编译模块相关指引。不能仅凭宿主 Node.js 下安装成功，就宣称 Windows 安装包可运行。[Electron Native Node Modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)。

但也不能反向概括成“所有原生模块每次都必须重新编译”：Node-API 为其 API 提供跨 Node.js 版本的 ABI 稳定性保证，前提包括只使用相应稳定 API，并核对外部库。具体模块是否使用该接口、是否提供目标预编译包、目标 Electron 是否兼容，仍需按模块验证。[Node-API ABI stability](https://nodejs.org/api/n-api.html#implications-of-abi-stability)。

未来 macOS/Linux 的方向意味着应复核这些目标平台上的驱动、文件路径及打包能力，不能将当前 Windows 可用推成跨平台已验证。这是后续验证事项，不是在本轮决定全部平台立即交付。

## 7. 与图数据库比较：承认收益，也区分交付形式

| 路线 | 可确认的技术特点 | 对本项目的取舍判断 |
| --- | --- | --- |
| SQLite 嵌入式 | 无独立数据库服务器；支持 SQL、外键、事务及递归图查询 | 易安装目标下值得先验证；复杂图查询需要自行组织 SQL 或应用逻辑，不因此承诺所有未来图分析都容易 |
| Neo4j 服务方式，作为图数据库服务的例子 | Windows 官方支持控制台程序或 Windows 服务；有数据库启动、配置及升级事项 | 若采用这种交付方式，应用需配套处理数据库运行与维护；这不是“所有图库”的共同前提 |
| Neo4j Java 嵌入式，作为嵌入图库的例子 | 官方允许把相应库 JAR 纳入 Java 应用，在同一 JVM 内运行 | 无须因此部署独立图服务，但会影响宿主技术、JVM 依赖和打包选择；不是无成本替换 SQLite |

事实来源：[SQLite serverless](https://www.sqlite.org/serverless.html)、[SQLite recursive graph queries](https://www.sqlite.org/lang_with.html)、[Neo4j Windows installation](https://neo4j.com/docs/operations-manual/current/installation/windows/)、[Neo4j embedded setup](https://neo4j.com/docs/java-reference/current/java-embedded/setup/)。最后一列为结合本项目约束的推断。

图数据库的具体收益包括专门表达可变长度路径、锚点可达节点和路径筛选等查询；Neo4j 的 Cypher 官方有相应例子。若未来业务频繁要求复杂路径查询或图算法，这些能力可以成为重新比较存储的理由；当前“搜索知识点并查看资料”和已确认的“所属主题”关系，本身尚未证明必须承担这项选型的额外依赖。[Neo4j variable-length paths](https://neo4j.com/docs/cypher-manual/current/patterns/variable-length-paths/)。

本报告没有对图库产品做全面筛选，也没有证明 SQLite 比所有图库快或小。图数据的逻辑结构、检索算法与可视化组件可以分别讨论，不必把一个存储引擎同时当成三者的答案。

## 8. 下一轮需要决定或核验的事项

- 用户是否接受“SQLite＋受应用管理的原始资料文件”作为进一步验证候选；若希望数据库内 BLOB，也应明确比较理由。
- 在业务身份、共享、字段覆盖与删除规则明确后，再设计 schema、唯一约束、事务单元和导入贡献追踪。
- 待匹配规则与实际资料样本明确后，验证中文短查询、英语命令、名称变体及预期规模下的搜索行为。
- 若采纳 Electron，选择 SQLite 接口前验证目标运行时能力、原生模块打包及 Windows 安装包中的读写和备份；宿主开发环境检查不能替代这一项。
- 备份与恢复方案需同时覆盖数据库和资料本体，实际完成恢复后才可声称可恢复；完整包格式与用户操作尚待讨论。

以上均为研究建议及待决项，没有新增首期业务要求、确定驱动或版本、实施数据迁移，或修改业务规格、领域词汇和技术决策文件。
