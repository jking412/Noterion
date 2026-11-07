# 成熟知识图谱产品与不依赖生成式 AI 的简单构建方法

实际检索日期：2026-11-07（Asia/Shanghai）。研究对象：个人知识图谱项目。本文为研究建议，供继续需求访谈使用，不代表用户已批准产品选型、输入格式、来源分配或自动入图规则。

## 1. 先给结论

**本项目可以从“显式知识点＋显式资料关联＋简单搜索”开始，生成式 AI 不是首版构建知识图谱的必要条件。** 首版目标已经是“找到知识点和相关资料”，不必先完成任意自然语言理解、自动关系推理或直接回答操作命令。项目依据见现有 [需求访谈草稿](../spec.md) 与 [领域文档](../../../CONTEXT.md)。

本次建议先验证两个方向：

1. **每个知识点一页的人工结构化笔记。** 用现成笔记产品，手工明确知识点、别名、资料链接和少量关系，先观察是否已经能找回资料。双向链接和图谱浏览可以辅助导航。以 Obsidian 为代表的笔记图主要连接笔记文件，是否把它当作知识点图，取决于“一页是否只表达一个知识点”的内容约定。[Obsidian Graph view](https://obsidian.md/help/plugins/graph)。
2. **一篇笔记按固定结构确定性抽取。** 保留用户熟悉的 TXT/Markdown 输入，通过明确规则识别知识点、资料 ID 和关系，不要求先购买企业平台或部署图数据库。规则只能兑现输入与约定明确表达的信息；标题、缩进、共现都不能无条件变成“依赖”“前置知识”等语义关系。

第三个备选是 **CSV 知识点表、资料表、关系表**，适合需要稳定 ID、跨笔记汇合和可审查批量导入时验证。Wikibase、企业平台与图数据库提供更强的数据建模或查询能力，但对当前个人检索目标，选择它们还需要证明额外配置与维护的收益。以上优先次序是本报告的判断，不是已确认决策。

**产品选择必须先分清对象：** 笔记关联图连接文档或卡片；概念／实体图谱以稳定实体和带类型的陈述为中心；企业平台处理多源整合、映射与查询；图数据库与可视化工具提供存储、查询和展示能力。它们都能画节点与线，但提供的知识组织工作不同。下文逐项列出第一手证据。

历史上已有可复用的基础：SKOS 在 2009 年规范了概念、首选标签、替代标签及层级／相关关系；R2RML 在 2012 年定义了关系数据到 RDF 的映射。它们依靠标识、数据结构和规则，而不以生成式 AI 为前提。这说明可借鉴成熟方法，**不意味着本项目必须实现 RDF 或这些完整标准**。[W3C SKOS Reference](https://www.w3.org/TR/skos-reference/)、[W3C R2RML](https://www.w3.org/TR/r2rml/)。

## 2. 范围、证据与判断方式

### 2.1 本项目已确认与未确认的边界

- 知识点既可以是“Docker”“MySQL 锁”这样的主题，也可以是“进入容器终端”这样的具体操作。
- 首版重点是独立搜索入口，以及定位到知识点、学习笔记和原始资料；图谱浏览相对次要。
- 学习笔记可以极简；原始资料可以只保存关联，不要求先读取视频、网页或 PDF 正文。
- 一个知识点可以关联多份资料；**文首资料是否由条目继承、不同来源如何分配、同名如何合并、AI 补充是否入图仍未确定**。

这些均来自本项目的 [需求访谈草稿](../spec.md) 和 [领域文档](../../../CONTEXT.md)，不是对市场产品的推断。

### 2.2 研究方法及“成熟、可用”的口径

采用后台并行研究，核查厂商官方帮助、官方源码／数据模型、W3C 标准与项目官方文档。本文中的产品事实与本项目建议分开书写。产品入选依据是：能找到可核验的数据模型或稳定使用说明，以及检索、资料组织和数据进出路径，且能代表一种不同的产品思路；不依据市场排名或未经核实的用户量。**这是一份文档层面的产品与方法研究，没有安装试用、购买、运行导入或做性能测试。**

优先比较 Obsidian、TheBrain、Heptabase、Wikibase、Stardog、Neo4j。Logseq、Anytype、TiddlyWiki 是后续可扩充候选；本报告没有逐项验证其全部能力，未入主表不表示它们不适合。由于产品持续变化，未核验的价格、套餐权益、同步行为和版本兼容性不作为选型依据。

跨会话临时交接文件在本聊天不可读；已按交接要求以项目需求、领域文档和委派消息继续。联网检索存在个别超时，最终结论以研究代理成功读取的第一手内容为依据，不把失败请求当作核验成功。

## 3. 代表性产品：它们究竟在连接什么

### 3.1 先按产品层次区分

| 代表产品与层次 | 节点代表什么 | 关系如何产生；基础能力是否需要生成式 AI |
| --- | --- | --- |
| **Obsidian：笔记／文档关联图** | 默认是笔记；图可额外显示附件、标签等 | 用户写内部链接，图与反向链接反映这些链接；基础组织与搜索不需要生成式 AI。[Graph view](https://obsidian.md/help/plugins/graph)、[Internal links](https://obsidian.md/help/links) |
| **TheBrain：个人链接式知识组织产品** | Thought，可由用户表示主题、想法或资料入口 | 人工创建父、子、jump 关系，并使用类型、标签和链接类型；这些已有基础操作可独立于 AI 功能使用。[官方教程目录](https://thebrain.com/support/tutorials) |
| **Heptabase：卡片／白板知识组织产品** | 卡片是笔记／知识容器，同卡片可置于多个白板 | 人工白板连接、正文提及和反向链接；基础卡片与资料组织不以生成式 AI 为前提。[Fundamental Elements](https://wiki.heptabase.com/fundamental-elements) |
| **Wikibase：概念／实体知识图谱系统** | Item 与 Property，有稳定标识；陈述可带限定条件和参考来源 | 人工或程序按属性写陈述；结构化数据模型无需生成式 AI。[DataModel Primer](https://www.mediawiki.org/wiki/Wikibase/DataModel/Primer) |
| **Stardog：企业知识图谱平台** | 以业务语义模型组织多源数据，而非默认每页笔记一个节点 | 通过映射访问外部数据，结合图查询等功能；虚拟图映射本身无需生成式 AI。[Virtual Graphs](https://docs.stardog.com/virtual-graphs/) |
| **Neo4j＋Browser：图数据库与查询可视化基础设施** | 由应用定义的带标签节点、关系及属性 | 导入映射或查询语句显式创建关系；CSV 导入本身无需生成式 AI。[CSV import](https://neo4j.com/docs/getting-started/data-import/csv-import/) |

表中“不需要生成式 AI”指所列基础路径可由结构与操作完成，不是声称这些产品没有 AI 功能。节点的业务含义仍由用户／建模者确定：Thought 或卡片可以承载知识点，但不会因此自动完成同义合并、同名消歧或关系验证。

### 3.2 Obsidian：最直接的文字、链接与搜索对照

- **知识点与关系：** 默认图是笔记链接图；内部链接可以定位到文件、标题或块，支持 Wikilink 与 Markdown 链接。要让图上的节点成为本项目知识点，需要约定“一页一知识点”或其他明确粒度。“前置知识”“相关主题”等关系含义不会由普通链接自动产生。[Graph view](https://obsidian.md/help/plugins/graph)、[Internal links](https://obsidian.md/help/links)。
- **资料与检索：** 可以链接／嵌入附件。原生 Search 支持关键词、短语、属性、标签、路径与正则等；官方明确内容搜索范围是笔记与 canvas，任意文件可按名称／路径查找。**因此不能把支持 PDF 附件等同于原生搜索 PDF 正文。**[Attachments](https://obsidian.md/help/attachments)、[Search](https://obsidian.md/help/plugins/search)。
- **导入导出：** 笔记是 vault 中的本地 Markdown，附件也是普通文件；已有目录可打开为 vault，Markdown 文件／目录可移入；Importer 提供其他工具格式的转换。复制整个 vault 是官方列出的备份方式，因此迁出可以保留 Markdown 与附件文件；但专有块引用或插件数据的跨工具兼容性需单独检验，不能据此宣称有无损的语义关系导出。[Data storage](https://obsidian.md/help/data-storage)、[Import Markdown](https://obsidian.md/help/import/markdown)、[官方 Importer 仓库](https://github.com/obsidianmd/obsidian-importer)、[Back up your files](https://obsidian.md/help/backup)。

**本项目判断：** 适合作为方案 A 的第一组验证工具，直接观察“按知识点组织＋逐点资料链接”是否已解决查找问题。若需要统一关系类型、结构化跨笔记汇合或导入校验，还需要约定内容结构或扩展能力。

### 3.3 TheBrain：手工链接与附件组织更突出的个人产品

- **知识点与关系：** 官方教程围绕 Thought 及父／子／jump 关系展开，另有类型、标签和链接类型。它比普通页面链接提供更多人工组织手段；但父子关系对应本项目的“相关主题”“组成”还是其他含义，仍须用户决定，不能直接套成已确认本体。[官方教程](https://thebrain.com/support/tutorials)。
- **资料与检索：** Thought 可带笔记、网页和文件附件。所核验的 TheBrain 15 官方说明列出独立 Search／Reports、短语／排除与类型、标签、日期过滤，也介绍附件索引；这不应外推为所有文件格式、扫描 PDF 或中文搜索质量都已实测。[官方教程](https://thebrain.com/support/tutorials)、[TheBrain 15 官方功能说明](https://blog.thebrain.com/products/thebrain/thebrain15)。
- **导入导出：** 官方教程列有 outline／JSON 导出；官方支持人员说明，第 15 版可按 Thought 导出文件夹，含 Markdown 与附件，也可导出各 Thought 的 Markdown 并集中附件。**这是特定版本／格式的导出路径，不证明其关系、标签等全部元数据在其他产品无损恢复。** 现有材料不足以确认本项目极简 TXT 的直接批量导入映射，故不把它算作已具备的零配置入口。[官方教程](https://thebrain.com/support/tutorials)、[官方支持人员对导出结构的答复](https://forums.thebrain.com/post/how-to-export-parent-child-thought-with-their-attachments-13822689)。

**本项目判断：** 可作为人工建立知识点、关系和多资料入口的对照产品。是否值得采用取决于搜索／附件体验，以及关系和资料导出的保真程度；不能只凭可视化图的吸引力做决定。

### 3.4 Heptabase：卡片、白板和阅读组织的对照

- **知识点与关系：** card 是笔记／知识容器；同一卡片可出现于多个白板。`@` 提及与反向链接、用户手画箭头是不同的连接方式。卡片相邻或存在箭头不自动等于已经定义了本项目知识关系。[Fundamental Elements](https://wiki.heptabase.com/fundamental-elements)。
- **资料与检索：** 官方基础教程包含 TXT／PDF 上传；Global Search 覆盖卡片、白板、聊天和标签，并支持过滤／排序。PDF／OCR 与其他资料正文的具体检索覆盖仍需用真实文件验证，不能由“可以上传”推断。[Fundamental Elements](https://wiki.heptabase.com/fundamental-elements)、[User Interface Logic](https://wiki.heptabase.com/user-interface-logic)。
- **导入导出：** 官方说明支持 Markdown、TXT、DOCX 导入；全部笔记可导出 Markdown，完整导出另含 `All-Data.json`。官方明确提醒跨应用导入不一定保留白板布局、关系和元数据；本次材料也不足以保证全部 PDF 附件随 Markdown 无损迁移。[Import notes](https://support.heptabase.com/en/articles/10447948-import-notes-from-other-apps)、[Data portability](https://support.heptabase.com/en/articles/10364279-business-sustainability-and-data-portability)。

**本项目判断：** 适合验证“卡片化与白板组织是否帮助学习、阅读和回忆”。当前图谱浏览优先级较低，因此白板体验本身不足以证明它比简单文字检索更适合首版。

### 3.5 Wikibase：最值得借鉴的是身份、陈述和来源模型

- **知识点与关系：** Item 有标识、标签、描述、别名及陈述；Property 表达陈述的属性，值可指向另一实体或为字面量，陈述可带限定符与参考来源。主题与操作都可以由自建库的模型承载，但是否合并为同一实体需要人工／程序规则决定。**陈述的 reference 是依据，不自动等同于本项目“查知识点时可参阅的资料关联”。**[Wikibase DataModel Primer](https://www.mediawiki.org/wiki/Wikibase/DataModel/Primer)。
- **资料与检索：** 可以用 URL 字段或独立“资料”实体建关联；存在 URL／媒体等数据类型不保证已提供任意 PDF 上传、正文提取与统一索引。`wbsearchentities` 可按标签和别名搜索；Wikidata 公共 SPARQL 服务查询 Wikidata 数据，自建 Wikibase 的查询与索引组件需要自行配置。[RDF 值类型](https://www.mediawiki.org/wiki/Wikibase/Indexing/RDF_Dump_Format)、[Wikibase API](https://www.mediawiki.org/wiki/Wikibase/API)、[Wikidata Data access](https://www.wikidata.org/wiki/Wikidata:Data_access)。
- **导入导出：** 编辑界面和 API 可显式写实体、陈述及参考来源；自定义 CSV 仍需映射与工具。`Special:EntityData` 支持单实体 JSON／RDF，另有数据转储；选择简化／truthy 导出视图时不能期待保留全部限定符和来源，需按导出范围核实。[API](https://www.mediawiki.org/wiki/Wikibase/API)、[数据访问与 EntityData](https://www.wikidata.org/wiki/Wikidata:Data_access)。

**本项目判断：** 稳定 ID、多名称、带类型关系和精细来源值得借鉴；部署完整系统应等到结构化查询与维护需求明确后再评估。Wikidata 是使用 Wikibase 的公共知识库，不能把公共实例的现成服务当作私有部署自动具备的功能。

### 3.6 Stardog：面向多源整合的企业平台

- **知识点与关系：** 数据以 RDF 表达，Designer 提供 OWL／RDFS 数据模型设计；设计画布上的“类”与实际知识点实例是不同层。Virtual Graphs 按映射将外部数据暴露为可查询图，部分场景也可物化；JSON／CSV 文件可按映射导入。模型、字段映射、SPARQL 与规则推理有不依赖生成式 AI 的路线。[Designer](https://docs.stardog.com/stardog-applications/designer/)、[Virtual Graphs](https://docs.stardog.com/virtual-graphs/)、[JSON／CSV importing](https://docs.stardog.com/virtual-graphs/importing-json-csv-files)。
- **资料与检索：** 可建资料实体和 URL 属性，但这属于应用建模，不等同于个人附件管理器。全文检索的 lexical 与使用语言模型的 semantic 模式需要区分；内置全文检索不直接覆盖虚拟数据源。当前迁移指南明确 Stardog 12 移除了旧 BITES 文档存储／文本提取功能，**不能引用旧功能替当前 PDF 检索作保证**。[Full-text search](https://docs.stardog.com/query-stardog/full-text-search)、[Migration guide](https://docs.stardog.com/additional-resources/migration-guide)。
- **导入导出：** CSV／TSV／JSON 走显式映射；RDF 可经 `data add` 与 `data export` 进出，导出要指定所需图范围；Designer 项目另有模型／项目导入导出机制。数据导出、项目导出与附件备份不是同一件事。[文件映射](https://docs.stardog.com/virtual-graphs/importing-json-csv-files)、[data add](https://docs.stardog.com/stardog-cli-reference/data/data-add)、[data export](https://docs.stardog.com/stardog-cli-reference/data/data-export)、[Designer](https://docs.stardog.com/stardog-applications/designer/)。

**本项目判断：** 当多源数据整合、统一模型和复杂查询成为实际问题时值得再评估。当前更适合借鉴“先定义模型、再映射数据”的方法；本次没有依据价格或性能数字作采购建议。

### 3.7 Neo4j＋Browser：能存图、查图和画图，内容模型仍需自己定义

- **知识点与关系：** 属性图提供带标签的节点、有向且带类型的关系、键值属性。知识点、学习笔记和原始资料可以各自建节点，知识关系与资料关联各用不同类型，但这些是本项目需要定义的模型。`CREATE`／`LOAD CSV` 按语句显式建图，不依赖生成式 AI，也不会自行理解极简笔记。[Graph database concepts](https://neo4j.com/docs/getting-started/appendix/graphdb-concepts/)、[LOAD CSV 示例](https://neo4j.com/docs/getting-started/data-import/csv-import/)。
- **资料、检索与展示：** URL／文件路径可作为字符串属性或资料节点字段；保存路径不等于上传、解析或索引文件正文。Cypher 提供图模式查询，全文索引检索已存的字符串属性；Browser 把查询结果展示为图或表格。Browser 是查询工具，仍需要应用层来提供个人笔记的录入与资料阅读体验。[属性图概念](https://neo4j.com/docs/getting-started/appendix/graphdb-concepts/)、[全文索引](https://neo4j.com/docs/cypher-manual/current/indexes/search-indexes/full-text-indexes/)、[Browser result frames](https://neo4j.com/docs/browser/operations/result-frames/)。
- **导入导出：** CSV 可经 `LOAD CSV` 与映射语句导入；Browser 可导出查询结果为 CSV／JSON、图视图为 PNG。这是结果集导出，不能当作完整数据库备份或完整笔记迁移方案。[CSV import](https://neo4j.com/docs/getting-started/data-import/csv-import/)、[结果导出](https://neo4j.com/docs/browser/operations/result-frames/)。

**本项目判断：** 以后确有复杂关系查询需求时，可作为存储基础设施候选；现在选择它无法替代知识点粒度、来源分配、别名及纠错方式的需求决定。首版完全可以先用普通表保存同一逻辑模型。

### 3.8 对个人首版的比较判断

这六项不是同一采购层次的可直接替换品。Obsidian、TheBrain、Heptabase 主要帮助人组织与查找个人内容；Wikibase 更直接提供实体、属性与陈述模型；Stardog 与 Neo4j 则需要数据建模、映射和应用配置才能形成符合本项目的体验。对于当前最低成功标准，优先用现成个人工具或确定性结构笔记验证录入与搜索价值，收益更容易观察。企业平台与图库保留为后续证据驱动的选项，而不是“叫知识图谱就必须部署”的前提。

## 4. 不依赖生成式 AI 的构建方法，以及各自能证明什么

### 4.1 方法比较

| 方法 | 输入需要表达什么 | 可以确定地产生什么 | 不能直接推出什么 |
| --- | --- | --- | --- |
| 显式链接／双向链接 | 用户写明 A 链接 B；[内部链接](https://obsidian.md/help/links)、[反向链接](https://obsidian.md/help/plugins/backlinks) | A 指向 B；反向索引显示 B 被 A 引用 | 链接本身不说明“依赖”“包含”“用于”；反向链接不是新的独立证据 |
| 标题与列表层级 | 约定哪些标题／条目是知识点，哪些是说明或元数据；[CommonMark 结构定义](https://spec.commonmark.org/0.31.2/) | 笔记章节、条目所属位置、结构父子；在用户确认映射规则后可生成约定关系 | 缩进不天然表示概念上的组成、类别或先修关系；列表顺序也不天然表示操作步骤 |
| 标签和结构化字段 | 类型、别名、来源、关系字段等明示值；[Tags](https://obsidian.md/help/tags)、[Properties](https://obsidian.md/help/properties) | 按字段筛选；按指定字段连接记录 | 同标签不等于知识点相同；共享标签不等于互相依赖 |
| CSV／JSON 映射 | 明确 ID、列／字段含义、引用目标和关系类型；[CSVW Primer](https://www.w3.org/TR/tabular-data-primer/)、[JSON-LD](https://www.w3.org/TR/json-ld11/) | 按映射建立知识点、资料和关系；外键式关联；按稳定 ID 检查重复标识 | 任意 JSON 不能无配置自动成为正确知识图谱；重复导入的更新／合并规则另定；格式解析不等于语义理解 |
| 词典、别名与词串匹配 | 人工维护的名称、别名及其目标 ID；[SKOS 标签](https://www.w3.org/TR/skos-reference/#labels)、[PhraseMatcher](https://spacy.io/usage/rule-based-matching#phrasematcher) | 将已知词串定位到候选知识点；按显式词典匹配 | 未收录说法、同名异义、跨句省略；别名命中也不必然证明上下文指的是该知识点 |
| 预设关系规则 | 经确认的模式，如结构字段 `相关主题: K1`；[规则匹配](https://spacy.io/usage/rule-based-matching)、[RDFS](https://www.w3.org/TR/rdf-schema/) | 可说明规则依据的带类型关系 | 规则没有写到、输入也未表达的关系；规则错误仍会稳定地产生错误 |
| 共现统计 | 预先定义同一篇、同一段等统计窗口；[Church 与 Hanks 1990 原论文](https://aclanthology.org/J90-1003.pdf) | 同时出现次数、相关候选排序 | 共现不证明同义、因果、依赖、包含或先修关系 |
| 传统 NLP／统计机器学习 | 分词、词性、实体类别／训练样本／统计模型等；[spaCy 统计 NER](https://spacy.io/usage/linguistic-features#named-entities) | 候选实体、词组、相似资料或可能关系 | 预测结果不保证正确，且通用模型不保证识别“进入容器终端”这种项目内知识点 |

表中的“不能推出”是针对本项目的建模判断。词典与规则的可行性可参见 spaCy 官方文档：规则适合已知词表或明确模式，可单用或与统计模型组合；`PhraseMatcher` 匹配词组，并不要求生成式模型。[spaCy Rule-based matching](https://spacy.io/usage/rule-based-matching)。

结构化数据的成熟先例包括：SKOS 的标签与概念关系；R2RML 的逻辑表、主客体映射与连接；CSVW 以表格元数据描述列、数据类型和引用，并支持转换为 RDF／JSON。**CSVW Primer 是解释性 Working Group Note，不应被称为规范性 Recommendation。** 这些资料支持“显式映射可建图”，不支持“任意原文可零配置理解”。[SKOS](https://www.w3.org/TR/skos-reference/)、[R2RML](https://www.w3.org/TR/r2rml/)、[CSVW Primer](https://www.w3.org/TR/tabular-data-primer/)。

### 4.2 四种关系依据应分别保留

建议在后续访谈中区分以下依据；这是便于纠错的研究建议，尚未定为产品字段：

1. **显式关系**：用户填写“进入容器终端 → 相关主题 → Docker”。系统保存这条明确表达。
2. **结构映射**：用户确认“二级标题为主题，其下首层条目为该主题下的知识点”，系统依据这项约定建边。应能回到笔记位置和所用规则。
3. **共现**：Docker 与 MySQL 出现在同一篇笔记，只能说明在这个窗口共同出现。可以作为浏览候选，不能据此断言二者有特定知识关系。
4. **语义推断**：根据模型、领域规则或本体推出输入未直接写出的关系。逻辑规则推理也可以不使用生成式 AI，但前提规则、本体和数据都需要正确；统计模型的预测与逻辑蕴含也应区分。

RDF 标准规定图如何表示主语、谓语、宾语，并不会替用户决定每条关系是否成立。RDFS 的类别／属性推导基于已经给定的语义条件；它不是读取任意学习笔记并自动理解含义。[RDF 1.1 Concepts](https://www.w3.org/TR/rdf11-concepts/)、[RDF Schema 1.1](https://www.w3.org/TR/rdf-schema/)。

### 4.3 “不用生成式 AI”与“绝无 AI”不同

- 标题识别、CSV 字段映射、用户指定关系、精确词典、字符串搜索和共现计数，都可以设计为不调用机器学习模型的确定性流程。
- 传统 NLP 工具既可能使用规则，也可能使用统计学习。spaCy 的命名实体识别根据训练得到的统计模型预测实体类别，可能误判；使用它仍属于使用机器学习，不能因为“没有大模型”就称为完全没有 AI。[spaCy Named Entity Recognition](https://spacy.io/usage/linguistic-features#named-entities)。
- 全文检索与排序也不必生成答案。SQLite FTS5 提供词项、前缀、邻近检索和 BM25 排序等功能，可以把匹配资料列出来，无须生成式 AI。[SQLite FTS5](https://sqlite.org/fts5.html)。

对本项目的含义是：先做好名称、显式别名和资料关联即可验证核心目标；传统 NLP、向量相似检索或生成式 AI 可以作为以后独立验证的增强能力，不应据此倒推为首版依赖。

## 5. 用同一份小笔记比较三条简单路线

### 5.1 先说明极简 TXT 的信息上限

假设原笔记只有：

```text
https://example.org/course
1. Docker
2. 进入容器终端
3. MySQL 锁
```

在“编号条目是候选知识点”这一规则得到确认后，可以确定地读出一个笔记、一个 URL 和三个候选名称。**仍不能仅凭这段文本确定：** 第二项是否属于第一项；三个条目是否都关联这个 URL；URL 是否确实覆盖每个主题。可以保存原文与位置，并把解析结果交给用户检查。是否把文首 URL 分配给所有知识点，要回到访谈确认，不能把研究示例的选择当作默认规则。

### 5.2 三条路线共用的演示输入

以下是**人为补齐结构的演示数据**。`example.org`、资料文件名和视频位置都是示意，不是实际教程，也不构成 Docker／MySQL 操作正确性说明。ID、字段语法、类型和“相关主题”只是为了比较方案，均未被确认为项目格式。每个知识点都逐点指定资料，故本例无须假设来源继承。

```markdown
笔记: N1

资料:
S1 | 视频 | Docker 与 MySQL 入门 | https://example.org/course
S2 | PDF | MySQL 锁速查 | ./materials/mysql-locks.pdf

## K1 | Docker | 主题
别名: -
资料: S1@00:00:00
- K2 | 进入容器终端 | 操作
  别名: docker exec; 进入Docker终端
  资料: S1@00:12:30

## K3 | MySQL 锁 | 主题
别名: MySQL锁
资料: S1@00:30:00
- K4 | 查看锁等待 | 操作
  别名: 锁等待查询
  资料: S1@00:38:00; S2@p3

显式关系:
K2 | 相关主题 | K1
K4 | 相关主题 | K3
```

`@00:12:30` 和 `@p3` 在这里是资料定位字段。保存这类字段不等于所有播放器／PDF 查看器都会自动跳转；打开与跳转行为需要在选定客户端上另外验证。

### 5.3 三方案都应保留的逻辑结果

| ID | 知识点 | 类型 | 别名 | 显式资料关联 |
| --- | --- | --- | --- | --- |
| K1 | Docker | 主题 | 无 | S1，00:00:00 |
| K2 | 进入容器终端 | 操作 | docker exec；进入Docker终端 | S1，00:12:30 |
| K3 | MySQL 锁 | 主题 | MySQL锁 | S1，00:30:00 |
| K4 | 查看锁等待 | 操作 | 锁等待查询 | S1，00:38:00；S2，第 3 页 |

知识关系只有两条：`K2 —相关主题→ K1`、`K4 —相关主题→ K3`。另外保存五条知识点与资料的关联，以及四个知识点在 N1 的原文定位。N1 与 S1／S2 分别是学习笔记和原始资料记录，**不应为了画图就把它们全都叫作知识点**。底层可以统一存成带类型的节点，也可以使用普通表；这一逻辑结果不依赖图数据库。

若保留标题／列表的结构父子，它表达的是本笔记的组织结构；本例的两条知识关系来自“显式关系”区。不能再把缩进额外解释为“先学 Docker 才能学 MySQL”或“查看锁等待依赖进入容器终端”。

统一用以下搜索规则作方案验证：检索标题和显式别名，名称精确匹配优先，其次别名精确匹配，再做子串匹配；不读取原始资料正文，不进行语义扩展。这是**拟定的演示验收规则，未实际运行，也不是某个产品开箱即用的统一行为**。

| 搜索输入 | 预期知识点结果 | 应显示的资料 | 解释 |
| --- | --- | --- | --- |
| `进入容器终端` | K2 | S1，00:12:30，并可回到 N1 对应条目 | 标题精确匹配 |
| `docker exec` | K2 | 同上 | 由显式别名命中，不是模型自动理解 |
| `锁` | K3、K4 | K3 对应 S1，00:30:00；K4 对应 S1，00:38:00 与 S2，第 3 页 | 中文单字子串匹配；不能把 S2 错配给 K3 |
| `MySQL锁` | K3 | S1，00:30:00 | 由显式别名命中 |
| `排查数据库慢` | 无结果 | 不编造个人资料关联 | 原文与别名没有这些说法；可提示更换关键词，是否增加 AI 问答另议 |

**中文检索需要单独验证。** FTS5 的默认 `unicode61` 不是对中文词语切分效果的保证；trigram 的 `MATCH` 对不足三个 Unicode 字符的词项没有命中。像“锁”这样的短查询，可在小规模验证中使用名称／别名的普通子串匹配，或另选经验证的分词／检索方案。不能仅因为“用了全文索引”就假定中文搜索已经解决。[SQLite FTS5：tokenizers 与 trigram](https://sqlite.org/fts5.html#tokenizers)。

### 5.4 方案 A：每个知识点一页，人工明确关联

**输入处理：** 将同一演示笔记人工整理为四篇知识点笔记；保留 N1 原文。K2 页面填写别名、S1 的链接和定位，并写明“相关主题：链接到 K1”。K4 页面填入两份资料，链接 K3。资料可使用链接或单独资料页管理。

**结果与操作：** 四篇知识点笔记对应 K1—K4；笔记链接支持前向／反向导航。搜索“docker exec”应能通过实际保存的别名文本找到 K2，再打开 S1。现成产品的检索字段、排序和别名行为需按上一表逐项试用；如果图只识别普通链接，“相关主题”文字只是人工约定，不会自动成为可按类型查询的边。

**优点：** 无需设计解析器，纠错直接编辑原文；可先检验“知识点作为独立入口”是否有用。Obsidian 是这条路线的代表性候选；TheBrain 可作为手工链接与资料附件体验的对照。具体产品事实见第 3 节。

**局限：** 一页一知识点会增加整理工作；同名合并与稳定 ID 仍需约定；普通笔记图的边未必保留关系类型。将 K4 的一份资料误填给 K3，产品不会因为关系“看起来合理”就自动纠正。

### 5.5 方案 B：单篇结构笔记，确定性规则抽取

**输入处理：** 使用第 5.2 节的同一份结构笔记，固定识别 `K`／`S` ID、知识点行、别名字段、逐点资料引用和显式关系行。标题与列表用于定位；“资料”“别名”等元数据不成为知识点。未知资料 ID、重复 ID 或不能识别的关系类型应产生待检查项，不静默猜测。

**结果与操作：** 得到第 5.3 节完全相同的四个知识点、两条知识关系、五条资料关联和四个原文定位。用普通表或 JSON 保存都能完成；搜索读知识点标题／别名索引，结果列出原文位置及其逐点资料。无需在这一阶段从视频／PDF 内容提取信息。

**优点：** 接近现有 TXT／Markdown 笔记习惯，可批量重复解析，结果可以解释为“哪一行、哪条规则产生”。不调用生成式 AI，也可完全不调用机器学习模型。

**局限：** 用户要遵守约定语法；规则没有覆盖的笔记需要人工整理。编号条目到底代表主题、操作还是纯说明，必须提前约定；不应让规则任意猜。笔记改名、知识点改名及重复导入如何处理，仍需要后续确定稳定 ID 与更新规则。本报告仅提出研究方向，没有编写解析器。

### 5.6 方案 C：显式 CSV 表，作为跨笔记汇合或导入的备选

**输入处理：** 人工将同一笔记整理为知识点表、资料表和关系表；另保留 N1 及原文位置。示意字段如下，实际字段尚待讨论：

```text
知识点表: id, name, kind, aliases
资料表: id, kind, title, locator
知识关系表: from_id, relation_type, to_id
资料关联表: knowledge_id, source_id, position
笔记定位表: knowledge_id, note_id, anchor
```

**结果与操作：** 表格记录仍是 K1—K4、S1—S2、两条知识关系与五条资料关联。知识点用 ID 汇合，名称与别名用于搜索，关系表用于按类型浏览。搜索“锁”仍返回 K3 与 K4，并逐个读取资料关联表；不从“同属 N1”推导两者共享全部资料。

**优点：** ID、关系类型和多对多资料关联容易检查，适合跨笔记去重与人工审核。未来若需要图数据库／RDF，可另写显式映射；CSVW 与 R2RML 是成熟映射思想的参考，其中 R2RML 面向关系数据库，不是任意 CSV 的直接导入协议。[CSVW Primer](https://www.w3.org/TR/tabular-data-primer/)、[R2RML](https://www.w3.org/TR/r2rml/)。

**局限：** 日常记录会比自由笔记繁琐；表格本身不提供完整的资料阅读与笔记编辑体验。导入 Wikibase、Stardog、Neo4j 各需相应模型与映射，并非换文件扩展名即可通用；在个人首版未证明需要这些能力前，没有必要因此引入整个平台。

### 5.7 三方案的选择依据

| 方向 | 录入方式 | 关系含义由谁确定 | 最适合先验证什么 | 主要代价 |
| --- | --- | --- | --- | --- |
| A：每知识点一页 | 人工整理笔记与资料链接 | 人填写；产品链接不一定有类型 | 独立知识点入口是否帮助找回资料 | 页面维护与重复知识点管理 |
| B：单篇结构笔记 | 遵守少量字段／层级约定 | 显式关系行或用户确认的映射规则 | 原有笔记能否以可接受工作量批量整理 | 语法约束、解析与更新规则 |
| C：CSV 显式表 | 人工维护记录及 ID | 关系表与映射配置 | 多对多资料关联、跨笔记汇合是否需要更严格结构 | 表格录入负担、界面／导入工作 |

## 6. 建议先验证的方向与带回访谈的问题

### 6.1 少量真实资料即可开始的验证

这是后续验证建议，不是本次已执行事项：由用户选一小组真实笔记，至少包括极简 TXT、一个主题与具体操作并存的笔记、同名或别名重复的笔记，以及一个知识点对应多份资料的情况。先用 A 验证知识点与资料入口，再判断 B 是否减少整理工作；确有跨笔记汇合压力时再验证 C。

比较时保持同一批笔记与同一批查找问题，记录以下结果：能否搜到目标知识点；是否显示正确资料与原文位置；错误关联是否容易发现和修改；导出后是否仍能恢复名称、别名、关系类型和资料定位。对于“进入容器终端”的场景，找到知识点并打开正确资料即可达到当前最低目标，无须把自动生成命令作为验收前提。

建议特意测试两个反例：只有文首 URL 时，不应在规则未确认前把全部条目关联到该来源；两个知识点同篇出现时，不应自动产生“依赖”关系。另用“锁”与“docker exec”检验中文短查询和显式别名。这里是可观察的验证目标，不是运行结果或性能承诺。

### 6.2 带回原访谈的五个待决问题

1. **最少整理负担：** 更愿意每知识点一页，还是保留一篇笔记并补少量字段？可否先用真实笔记对照两种方式？
2. **资料分配：** 文首唯一来源是否默认关联全部条目；多来源时是逐点指定、限定到章节，还是先作为待确认候选？
3. **首批关系：** 首版是否只需“相关主题”这一小类显式关系；标题／缩进可否按固定约定产生关系，还是仅保留笔记结构？
4. **身份与别名：** 相同名称是否先提示用户选择已有知识点；同名异义如何区分；是否接受少量稳定 ID 或别名维护？
5. **搜索边界：** 首版只搜名称、别名与笔记，还是还要读取部分原始资料正文；对没有关键词命中的口语问法，先无结果提示是否可接受？

设备、部署、备份、更新／删除和重复导入规则依然需要后续访谈，但不应妨碍先验证上述录入与检索价值。AI 问答、通用知识补充及是否保存入图，也应在这些基础规则明确后独立讨论。

## 7. 证据留存与研究限制

完整结论以本文为主；并行研究的第一手证据摘记另存于同目录：

- [个人产品证据](personal-products-evidence.md)
- [实体图谱、企业平台与数据库证据](semantic-enterprise-evidence.md)
- [非生成式构建方法证据](non-generative-methods-evidence.md)

引用主要为官方在线文档，其“latest”页面可能更新。产品的资料导入、中文搜索、附件内容索引和导出恢复是否符合实际使用要求，仍需使用用户真实笔记做试用，本文不把官方功能说明等同于已完成端到端验收。报告中的示例是可检查的设计推演，不是已实现功能；未修改需求草稿、词汇表或架构决策。
