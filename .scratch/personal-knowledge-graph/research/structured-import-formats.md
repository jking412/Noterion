# 结构化导入与交换格式补充核验

核验日期：2026-11-07（Asia/Shanghai）。本文补充 [主研究报告](./non-ai-knowledge-graph.md)，只核验结构化输入与交换方式，使用产品官方文档、官方发布说明及格式规范；没有安装产品或执行导入测试。以下首期格式建议供需求讨论，尚未成为产品决策。

## 1. 对个人首期的建议

**建议以 Markdown 作为日常笔记入口，将 CSV／TSV 作为批量整理与交换的候选补充。** 用户已接受 Markdown 结构，在外部编写后导入；CSV／TSV 则适合用表格明确名称、别名和资料引用。两种入口都需要约定结构与字段含义，不能仅凭文件扩展名确定知识点或关系。

JSON 更适合作为程序交换、结构化导出或备份包中的数据描述候选；OPML 适合已有大纲工具的迁移；RDF／JSON-LD 适合明确需要语义图交换时再评估。这一优先次序是结合本项目个人使用、首批十几篇笔记及简单起步目标作出的判断，不要求首期同时支持所有格式。

## 2. 五类方式的第一手证据与边界

| 方式 | 已核实的产品或标准示例 | 对本项目能借鉴什么 | 必须保留的边界 |
| --- | --- | --- | --- |
| Markdown／轻量文档结构 | Heptabase 官方列出 `.md`、`.txt`、`.docx` 文档导入，并另设 Notion、Obsidian、Roam、Logseq 等专用入口。[官方导入说明](https://support.heptabase.com/en/articles/10447948-import-notes-from-other-apps) | 外部写笔记，再导入系统，是已有产品采用的路径 | 产品能读 Markdown，不代表会按我们希望的规则拆知识点；哪些标题、列表和字段有领域含义，需要本项目自行约定 |
| CSV／TSV 表格 | Neo4j 的 `LOAD CSV` 可按表头读列，分隔符可配置；官方说明支持制表符等分隔字符。[CSV 文件说明](https://neo4j.com/docs/getting-started/data-import/csv-files/) | 人可以用表格批量整理，系统按列读取；TSV 可作为同一表格模型的另一种文本编码 | 分隔符、表头、编码与字段映射仍需一致；支持 CSV 不等于任意表格都能直接变成正确图谱 |
| JSON 对象／产品数据模型 | Wikibase 的实体 JSON 用于 API、JSON dump 和 EntityData；写入接口另规定可接收的 JSON 结构。[实体 JSON](https://doc.wikimedia.org/Wikibase/master/php/docs_topics_json.html)、[写入结构](https://doc.wikimedia.org/Wikibase/master/php/docs_topics_changeop-serializations.html) | 对象和数组能承载结构化实体、名称与关联，适合程序交换 | Wikibase JSON 是特定实体模型，不是“任意 JSON 文件导入器”；本项目自定义 JSON 与它之间仍需转换 |
| OPML／大纲 | OPML 2.0 用 XML 表达树形大纲；TheBrain 15.0.542 的官方发布说明明确新增 OPML 与 XMind 导入。[OPML 规范](https://2005.opml.org/spec2.html)、[TheBrain 发布说明](https://forums.thebrain.com/post/thebrain-15-0-542-13822935) | 可迁移已经整理好的标题与子条目，减少重录大纲的工作 | 树形层次不自动等于“包含”“依赖”或“先修”等知识关系；跨枝链接和扩展属性是否保留，要按具体产品检验 |
| RDF／JSON-LD 语义图交换 | JSON-LD 1.1 是 W3C 的关联数据 JSON 序列化规范；Stardog 官方明确列出 JSON-LD、Turtle、RDF/XML 等可加载格式。[JSON-LD 1.1](https://www.w3.org/TR/json-ld11/)、[Stardog 数据加载](https://docs.stardog.com/operating-stardog/database-administration/adding-data) | 已有明确实体标识和关系词汇后，可用于标准化交换图数据 | RDF 是数据模型，JSON-LD 是相关序列化方式；普通 JSON 不会仅因改扩展名就具有同样语义 |

### CSV／TSV：格式与建图映射是两层

Neo4j 官方示例先按列建立人物和电影节点，再用另外一张表中的两端 ID 建立关系；关系类型来自写明的映射，而非系统猜测列的语义。因此，“CSV 可以导入知识图谱”准确的含义是：**已明确记录、标识和列含义后，可以按规则生成节点与边。**[Neo4j LOAD CSV](https://neo4j.com/docs/cypher-manual/current/clauses/load-csv/)。

W3C 的 CSVW 元数据规范可以描述列、数据类型、主键和外键，这也说明文件格式之外还存在解释与验证规则。可以借鉴这种思路，而不必让个人首期实现完整 CSVW。[Metadata Vocabulary for Tabular Data](https://www.w3.org/TR/tabular-metadata/)。

在本项目里，知识点、资料与两者的关联可以分别整理成表，也可以设计更便于手工填写的扁平模板；这些都是候选设计。一个知识点对应多份资料时，用多行关联还是单元格列表，都需要明确约定，不是 CSV／TSV 自带的业务规则。

### JSON：专用格式、备份和通用交换应区分

Wikibase 的官方数据结构证明 JSON 能完整表达某个特定领域模型，但这不证明任何知识产品都接受相同 JSON。是否存在导入界面、API 或恢复工具，也应分别核实。

Heptabase 的完整导出包含 `All-Data.json` 备份数据；官方将备份恢复与把 Markdown 导入另一款应用区分开。因此不能把“存在 JSON 导出”直接写成“任意 JSON 可导入”或“跨产品无损迁移”。[Heptabase 数据可迁移性说明](https://support.heptabase.com/en/articles/10364279-business-sustainability-and-data-portability)。

对本项目而言，若将来定义 JSON 交换包，还需单独说明附件内容是否随包包含、文件引用如何恢复以及版本如何识别；这些不由 JSON 语法代为决定。

### OPML：核实具体版本，不从旧教程外推

TheBrain 此处的证据明确对应 **15.0.542，2026-05-04 的发布说明**。它证明这个版本提供 OPML 导入，不能据此声称所有旧版本都有相同入口，或所有大纲扩展字段都能完整互换。

OPML 的基本单位是带属性的树节点；它适合大纲交换。若本项目要由大纲层级生成知识关系，仍需用户确认层级含义及映射规则。

### RDF／JSON-LD：结构和语义词汇需要先存在

JSON-LD 的 context 可以把简短字段名映射到明确的 IRI，标准还定义它与 RDF 之间的处理方式。对于本项目，这类交换方式的价值来自统一标识与关系词汇；它不能替用户判断某个知识点属于谁、资料与哪个知识点相关，或两条同名记录是否应该合并。

## 3. 产品能力中容易误读的地方

- **Heptabase 的 Notion 入口不等于通用 CSV 入口。** 官方要求上传 Notion 导出的 Markdown & CSV 压缩包，并说明当前主要导入页面；不能外推为任意知识点表或关系表均可直接导入。[Heptabase 导入说明](https://support.heptabase.com/en/articles/10447948-import-notes-from-other-apps)。
- **关于 Logseq，本次只核实了 Heptabase 官方描述的接收路径。** 该路径要求从 Logseq 导出标准 Markdown 压缩包，并明确不导入块级引用。本文没有据此声称 Logseq 本身支持所有表格、JSON 或 OPML 导入，也不保证块属性和关系完整迁移。[同一官方说明的 Logseq 小节](https://support.heptabase.com/en/articles/10447948-import-notes-from-other-apps)。
- **格式能解析，不等于知识已经理解。** 标题、表格列、JSON 字段和大纲层级只有结合约定才能成为本项目的知识点及关系。按确定规则转换这些结构无需生成式 AI；若要从任意自由文本补出未表达的关系，则是另一项能力。
- **可导入数据不等于已经备份资料。** 文件名、URL 或资料记录可以只是一条引用；是否包含文件内容，要看具体产品或交换包约定。用户已经确认本系统保存上传文件，外链只保留地址、失效后不归档；选择交换格式时也应继续保持这个区别。

## 4. 带回需求讨论的最小决策

建议先让用户在以下工作方式中决定优先级：Markdown 负责日常笔记；CSV／TSV 是否同时作为首期批量入口，还是先保留为后续交换方式。若选择表格入口，再确定哪些表和字段是必要的，不急于照搬某个产品模型。

以下事项继续保持未决：文首资料是否由全部知识点继承；知识关系类型及标题映射；知识点身份、同名合并与重复导入更新规则；AI 补充如何保存。**接受 Markdown 或 CSV，只代表接受一种结构化输入方式，不代表已经认可这些业务规则。**

本文只新增格式证据与候选建议，未修改需求草稿、领域词汇表或 ADR，也未编写导入代码。
