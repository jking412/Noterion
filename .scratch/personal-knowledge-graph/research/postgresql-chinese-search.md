# Noterion：PostgreSQL 中文片段搜索技术方案

核验日期：2026-11-07（Asia/Shanghai）。本文应用 research 技能，以 PostgreSQL 官方文档及官方源码站核验。只新增技术研究，不执行 SQL、不安装扩展、不生成脚本、不写入业务规格或技术决定文件。

## 1. 简明推荐

**以 PostgreSQL 参数化 `LIKE`／`ILIKE` 实现知识点 `name` 和 `description` 的片段包含匹配；查询接口接收 `match_mode = all | any`，由最终使用者选择 AND／OR。** 普通 PG 索引用于实际需要的其他查询条件，`pg_trgm` 作为包含查询的候选加速方式；是否建 GIN／GiST 索引由目标数据库中的真实查询计划和资料样本决定。

当前已确认的是“包含即可匹配”和“用户可选择多个条件之间的 AND／OR”，不是自动中文分词、语义检索或相似度排序。现有需求可以由 PG 内的字符串匹配表达，没有证据要求新增 Elasticsearch、向量库或中文分词服务。本报告不再追问排序、交互或业务细节。

本研究读取了最新 [spec.md](../spec.md) 与 [CONTEXT.md](../../../CONTEXT.md)。业务规格中的部分匹配细节尚未同步本轮答复，本文按最新技术交接记录 Q20／Q21 的确认，不修改并行业务文档。

## 2. 参数化包含匹配与转义

PostgreSQL `LIKE` 中，`%` 表示任意长度字符串，`_` 表示一个字符；要实现任意位置包含，需要在模式两端加 `%`。用户输入中的这两个字符若表示字面内容，必须用 `ESCAPE` 机制转义。`ILIKE` 按当前 locale 进行不区分大小写匹配；这不构成中文分词。[Pattern Matching](https://www.postgresql.org/docs/current/functions-matching.html)。

建议由 Rust 查询层统一构造参数，例如选择 `!` 作为固定转义符时：先把输入中的 `!` 转为 `!!`，再将 `%`、`_` 分别转为 `!%`、`!_`，最后在两端加入 `%`，作为绑定参数传给查询。固定谓词可表达为 `name ILIKE $1 ESCAPE '!' OR description ILIKE $1 ESCAPE '!'`。这是查询语义示意，不是已实施 SQL 或 schema。

**参数绑定和 LIKE 转义解决两个不同问题：** 绑定参数让输入作为值而非 SQL 代码传入；LIKE 转义防止用户的字面 `%`、`_` 被当成通配符。不能因为用了绑定参数就省略模式转义，也不应再对参数做 SQL 字符串引号拼接。PostgreSQL 官方参数接口明确区分命令文本与参数值。[Parameterized command execution](https://www.postgresql.org/docs/current/libpq-exec.html)。

可推荐使用 `ILIKE` 兼顾常见英文命令／技术名称的大小写，这是工程建议，不能写成用户已经逐项确认了大小写与所有 Unicode 等值规则。若需要严格区分大小写，可使用同样参数和转义机制的 `LIKE`；不必为这一实现选择再次启动业务访谈。

## 3. `all`／`any` 安全组合

接口接受已经确定的检索片段集合，以及受控枚举 `match_mode`。对于每个片段，先构造“名称包含该片段，或描述包含该片段”的固定条件，再按模式组合这些条件。

| 接口值 | 条件组合方式 | 技术含义 |
| --- | --- | --- |
| `all` | 每个片段条件之间使用 AND | 每个片段都能在该知识点的名称或描述中命中 |
| `any` | 每个片段条件之间使用 OR | 任意一个片段在名称或描述中命中即可 |

Rust 只从枚举映射到固定的 `AND`／`OR` SQL 结构；片段全部用占位符绑定，不能把界面传来的任意运算符或原始文本拼进 SQL。条件需要明确括号，不能让 SQL 运算符优先级改变组合含义。

这不要求先把名称和描述拼成一段长字符串，避免拼接方式无意中制造跨字段连续片段；分别查询两个字段也有利于后续比较各自索引。用户输入如何在界面表达多个片段不在本文重设，不引入自然语言拆词或智能理解，也不替使用者固定 all 或 any。

## 4. 普通索引与 `pg_trgm` 的适用范围

### 普通 B-tree 不是任意包含索引

PG 官方说明，B-tree 可以在符合条件时用于左锚定模式，如 `'foo%'`；`'%foo%'` 这种前面带通配符的任意位置包含，不能因为建立普通文本 B-tree 就保证获得类似加速。普通索引仍可以服务其他实际过滤与关联条件，但本报告不确定表结构或添加未经需要证明的索引。[Index Types](https://www.postgresql.org/docs/current/indexes-types.html)。

### `pg_trgm` 是候选加速，不改变“包含”的语义

`pg_trgm` 提供 GIN／GiST operator class，并可加速 `LIKE`／`ILIKE`，不要求模式左锚定。它从模式中提取可用 trigram 以缩小候选集合；这不同于改用相似度阈值，采用该索引不要求把“包含即可匹配”改成模糊相似搜索。[pg_trgm index support](https://www.postgresql.org/docs/current/pgtrgm.html#PGTRGM-INDEX)。

建议在需要优化时先比较 GIN trigram 路线，并把 GiST 作为另一种可测选项；这只是查询模式下的工程起点，不是未经测试的普遍性能结论。既没有已确认的相似度最近邻排序要求，也没有必要因此引入相似度阈值或额外排序交互。

### 中文单字／双字不保证有效 trigram 筛选

PG 官方明确指出：模式没有可提取 trigram 时，会退化为全索引扫描；实际优化器也可能选择顺序扫描。`%锁%`、`%容器%` 这类任意位置单字／双字包含，不能保证有足够的固定字符构成有效 trigram。它们仍能正确进行包含匹配，问题是索引选择性和成本，而不是不允许短查询。[pg_trgm limitation](https://www.postgresql.org/docs/current/pgtrgm.html)。

官方 GIN 源码中，未提取到 trigram 会设置 `GIN_SEARCH_MODE_ALL`；LIKE 的提取经过专门的 wildcard-pattern 路径。`show_trgm` 对普通字符串可能显示带边界填充的 trigram，但不能仅据此证明同一个词放在 `%…%` 中就能有效筛选。[GIN extraction source](https://doxygen.postgresql.org/trgm__gin_8c_source.html)、[Wildcard trigram source](https://doxygen.postgresql.org/trgm__op_8c_source.html)。

上述是对模式提取机制的技术推断，不是本项目已运行的测试结果。也不能反向概括成“所有两个字的任何模式绝不可能用索引”：是否锚定、是否包含其他固定片段及字符分类都会影响可提取项。更长中文查询也仍取决于实际词字符识别与数据分布。

## 5. UTF-8、locale、ICU 与全文检索需要区分

UTF-8 能保存中文，不等于所选 locale／provider 的字符分类、大小写和索引提取都已经验证。`pg_trgm` 文档说明会忽略非词字符；源码用字符分类函数判断词字符。PG 文档同时明确 locale 参与字符分类，全文 parser 对字母的识别依赖数据库设置。因此需在实际数据库版本、容器环境和 locale／ICU 配置上核验中文样本，不能只看到 UTF-8 或 ICU 就声称已保证中文索引。[pg_trgm character rules](https://www.postgresql.org/docs/current/pgtrgm.html)、[Word-character source](https://doxygen.postgresql.org/trgm_8h_source.html)、[Locale Support](https://www.postgresql.org/docs/current/locale.html)、[Text-search parser](https://www.postgresql.org/docs/current/textsearch-parsers.html)。

工程上应使用经过验证、符合片段比较需求的字符与排序配置，不为了“中文”就直接启用忽略标点等额外等值语义。当前 PG 文档中 `ILIKE` 不支持 nondeterministic collation，而 `LIKE` 的相应支持又有版本差异；不能把任意 ICU collation 都当成可直接用于同一查询与索引的配置。[LIKE／ILIKE collation constraints](https://www.postgresql.org/docs/current/functions-matching.html)。

PG 全文检索先由 parser 产生 token，再由 dictionary 规范化。`simple` dictionary 主要对已有 token 转小写、检查停用词，不会因此自动把连续中文切成符合用户预期的词，也不等同于任意子串包含。当前需求既然是片段匹配，就不应把 `to_tsvector('simple', …)` 当作无需验证的中文搜索替代。[Parser](https://www.postgresql.org/docs/current/textsearch-parsers.html)、[Simple dictionary](https://www.postgresql.org/docs/current/textsearch-dictionaries.html#TEXTSEARCH-SIMPLE-DICTIONARY)。

## 6. 实施前应做的技术验证，不增加业务访谈

当前没有已确认的容量或响应时限数字，不能编造“达到多少条就上索引”或“中文搜索一定毫秒级”的门槛。建议在实际 PG 环境，用真实名称和描述样本检查：

- 中文单字、双字、较长片段，以及命令／中英文混合内容。
- 含字面 `%`、`_`、转义符的输入，确认结果语义不被通配符改变。
- 用户选择 all 与 any 时的相同片段集合，确认条件组合正确。
- 没有 trigram 索引及候选 GIN／GiST 下的实际计划，区分顺扫、位图／索引扫描、重检与返回行数。

用 `EXPLAIN` 检查计划；需要实际代价时，在授权的查询验证环境使用 `EXPLAIN (ANALYZE, BUFFERS)` 观察执行与 I/O。官方说明 ANALYZE 会真正执行查询；本次研究没有执行任何数据或 SQL。[Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html)。

按样本和查询计划决定索引，比仅凭“中文”增加独立检索服务更有依据。若之后的真实性能或匹配需求超出这条路线，再评估新增能力；当前先采用 PG 字符串查询、必要普通索引与候选 `pg_trgm`，不预设分词、搜索集群或向量依赖。

## 7. 主代理可优先引用的五项官方依据

1. [Pattern Matching](https://www.postgresql.org/docs/current/functions-matching.html)：片段包含、`%`／`_` 转义、ILIKE 与 collation 限制。
2. [pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html)：GIN／GiST 支持、非左锚定模式与无 trigram 退化。
3. [Command Execution Functions](https://www.postgresql.org/docs/current/libpq-exec.html)：参数值与 SQL 命令文本分离。
4. [Text-search Dictionaries](https://www.postgresql.org/docs/current/textsearch-dictionaries.html)：simple 处理 token，不自动提供中文词典分词。
5. [Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html)：以实际计划和运行数据验证索引取舍。

补充源码用于解释短模式退化及字符分类，不能代替未来目标版本测试。最终推荐保持为技术方案，不决定业务排序、摘要截取方式、界面控件或未确认性能标准。
