# 概念知识图谱、企业平台与图数据库：官方证据备忘

实际联网检索日期：2026-11-07（Asia/Shanghai）。研究任务分工材料；只写此文件，不改变需求草稿或领域词汇表。事实来自官方文档，选型判断明确标为研究判断。没有安装软件或做本地功能实测。

## 结论

- Wikibase 是适合表达“实体—带类型陈述—来源”的结构化知识库软件；Wikidata 是使用它的公共知识库实例。可以借鉴其稳定 ID、别名与陈述来源模型，但不能把 Wikidata 的公共搜索服务视为自建 Wikibase 自动拥有的能力。[Wikibase API](https://www.mediawiki.org/wiki/Wikibase/API)、[Wikidata 数据访问](https://www.wikidata.org/wiki/Wikidata:Data_access)
- Stardog 代表企业语义数据整合平台：建模、映射、SPARQL、规则推理和可视工具都有不依赖生成式 AI 的路线。它解决的集成范围比个人首版“找到知识点和相关资料”更大；个人首版采用它可能增加建模与运维工作。这是适配判断，不是质量排名。[Designer](https://docs.stardog.com/stardog-applications/designer/)、[Virtual Graphs](https://docs.stardog.com/virtual-graphs/)
- Neo4j 是属性图数据库及配套工具；节点与关系语义需要应用自行定义。CSV 导入、Cypher、全文检索和 Browser 可视化证明构图不需要大模型，但数据库本身不决定怎样从简短学习笔记拆知识点。[图数据库概念](https://neo4j.com/docs/getting-started/appendix/graphdb-concepts/)、[CSV 导入](https://neo4j.com/docs/getting-started/data-import/csv-import/)

## Wikibase / Wikidata

**节点与关系。** 基础实体包括 Item 和 Property；Item 有 ID、多语言标签、描述、别名和陈述。陈述包含属性、值，可含限定符、参考来源和排序等级；值可以指向另一实体或为字面量。因此关系有明确属性意义，来源可附在具体陈述上。这里的 reference 表示陈述依据，不能直接等同于本项目“查知识点时可参阅的学习资料”。主题和操作能否建 Item 是自建库的建模选择。[官方数据模型导读](https://www.mediawiki.org/wiki/Wikibase/DataModel/Primer)

**非生成式 AI 建立方式。** 使用编辑界面或 API 增删实体、陈述、限定符与来源；`wbeditentity`、`wbsetclaim`、`wbsetreference` 等 API 明确可用。字段映射脚本可以调用这些 API；API 不替用户判断自然语言中的概念身份和关系。[API 文档](https://www.mediawiki.org/wiki/Wikibase/API)

**资料链接与附件边界。** 模型允许来源属性与值；RDF 格式说明含 URL、字符串、实体 ID、Commons media 等值类型。可以用 URL 或“资料”实体建资料关联；任意 PDF、视频、本地文件的上传、正文提取、统一索引不能仅凭这些数据类型承诺，应另行核查部署与文件系统配置。[RDF 导出及值类型](https://www.mediawiki.org/wiki/Wikibase/Indexing/RDF_Dump_Format)

**搜索。** `wbsearchentities` 按标签和别名搜实体。Wikidata 公共站有传统搜索索引；复杂关系查询使用其 SPARQL Query Service。该公共服务查询的是 Wikidata，而不是用户私有自建库。自建需部署自己的查询组件与索引，不能把公共服务 URL 直接当私有检索后端。[API 模块](https://www.mediawiki.org/wiki/Wikibase/API)、[数据访问：Search 与 WDQS](https://www.wikidata.org/wiki/Wikidata:Data_access)

**导入导出。** API 可写入结构化数据；单实体可经 `Special:EntityData` 获取 JSON/RDF，扩展名包括 `.json`、`.ttl` 等，另有 JSON/XML/RDF 数据转储。轻量 CSV 入库需映射/工具，不应声称原生直接理解用户 TXT。导出若只用 simple/truthy 视图会丢掉限定符和参考来源，不适合要求完整来源的备份。[API](https://www.mediawiki.org/wiki/Wikibase/API)、[EntityData 与导出视图](https://www.wikidata.org/wiki/Wikidata:Data_access)

**部署边界与适配判断。** 官方当前 Wikibase Suite Docker 文档要求带 IP、域名和子域的服务器，并推荐想试用类似环境的人先试 Wikibase Cloud；这是 Suite 的具体部署要求，不能扩写为所有 Wikibase 技术上都不能本地运行。对个人首版，先借鉴模型，比直接部署完整 Suite 更接近“简单起步”。[Suite Docker 文档](https://www.mediawiki.org/wiki/Wikibase/Docker)

## Stardog

**节点与关系。** Designer 以 OWL/RDFS 定义类、关系、属性；实际数据使用 RDF。注意 Designer 画布的类节点是数据模型层，不能与具体知识点实例混为一谈。[Designer 数据建模](https://docs.stardog.com/stardog-applications/designer/)

**非生成式 AI 建立方式。** 可手工建立数据模型、预设推理规则，把表格或分层数据按映射转为 RDF。Virtual Graphs 还能把 SPARQL 转成远端数据源原生查询，数据可留原处或物化入库。映射可用 SMS/SMS2、R2RML；CSV/TSV/JSON 文件导入沿用映射接口，文件导入结果实际物化，并非实时虚拟文件图。[Virtual Graphs](https://docs.stardog.com/virtual-graphs/)、[JSON/CSV 导入](https://docs.stardog.com/virtual-graphs/importing-json-csv-files)

**资料链接与附件边界。** 可在 RDF 模型中定义资料实体、URL 等属性来表达资料关联；这是应用建模能力，不能等同于已提供个人附件管理器。当前迁移指南还明确 Stardog 12 移除了旧 BITES 文档存储及文本提取功能，因此不能引用旧版本 BITES 文档承诺当下 PDF 附件全文检索。[Designer](https://docs.stardog.com/stardog-applications/designer/)、[迁移指南：BITES Removal](https://docs.stardog.com/additional-resources/migration-guide)

**搜索。** 支持 SPARQL 图查询和全文检索；全文搜索的 lexical 模式按词形匹配，semantic 模式使用向量及语言模型，两者要区分。无需生成式 AI 可用 lexical 模式。官方说明内置全文搜索针对存于 Stardog 的数据，不支持直接搜索虚拟数据源；不能把 SQL 联邦查询能力写成所有远端资料均已全文索引。[全文检索](https://docs.stardog.com/query-stardog/full-text-search)、[Virtual Graph 查询](https://docs.stardog.com/virtual-graphs/)

**导入导出。** CSV/TSV/JSON 通过 SMS2 映射导入；RDF 可 `data add` 写入并用 `data export` 导出，支持 Turtle、N-Triples、JSON-LD 等；Designer 项目有自己的导出与导入格式。数据导出需明确包含哪些 named graphs；默认只导出默认图。[文件映射导入](https://docs.stardog.com/virtual-graphs/importing-json-csv-files)、[RDF 导入](https://docs.stardog.com/stardog-cli-reference/data/data-add)、[RDF 导出](https://docs.stardog.com/stardog-cli-reference/data/data-export)、[Designer 项目](https://docs.stardog.com/stardog-applications/designer/)

**适配判断。** 有多数据源整合、统一本体或企业规则推理需求时值得进一步评估；当前个人首版仅需知识点与资料定位，主要值得借鉴“先定义数据模型、再做字段映射”，不必把企业平台作为起步依赖。未核实采购报价、各产品版本授权和团队运维成本，不作价格结论。

## Neo4j + Browser

**节点与关系。** 属性图由节点、节点标签、有向且带一种类型的关系、键值属性组成；节点可代表知识点、笔记、原始资料，关系可代表知识关系和资料关联，但这些均需项目自行建模。[属性图概念](https://neo4j.com/docs/getting-started/appendix/graphdb-concepts/)

**非生成式 AI 建立方式。** Cypher 的 `CREATE` 可显式建节点和关系；`LOAD CSV` 逐行读 CSV，配合查询语句建立图。读取 CSV 不等同于自动理解笔记内容，字段清洗和类型转换仍要显式处理。[属性图与 CREATE 示例](https://neo4j.com/docs/getting-started/appendix/graphdb-concepts/)、[LOAD CSV 官方示例](https://neo4j.com/docs/getting-started/data-import/csv-import/)

**资料链接与附件。** 可以把 URL、文件路径、标题等存为字符串属性，或者建单独资料节点再连关系；这是基于键值模型的设计选择。链接指向文件不代表数据库已上传、解析或索引该文件正文，附件生命周期与打开方式仍需应用负责。[节点关系属性类型](https://neo4j.com/docs/getting-started/appendix/graphdb-concepts/)

**搜索与可视化。** Cypher 做图模式查询；全文索引对节点或关系的字符串属性分词并返回 Lucene 相关性分数，不需要生成式 AI。Browser 把查询结果展示为图、表格等，并可展开节点；它是开发/查询工具，不是现成个人笔记产品。[全文索引](https://neo4j.com/docs/cypher-manual/current/indexes/search-indexes/full-text-indexes/)、[Browser 结果框](https://neo4j.com/docs/browser/operations/result-frames/)

**导入导出。** CSV 用 `LOAD CSV` 导入；Browser 表格查询结果可下载 CSV/JSON，图视图可下载 PNG。这是“查询结果导出”，不能写成完整数据库备份或完整笔记迁移格式。[CSV 导入](https://neo4j.com/docs/getting-started/data-import/csv-import/)、[结果导出](https://neo4j.com/docs/browser/operations/result-frames/)

**适配判断。** 适合后续应用需要多跳查询、复杂关系检索、关系属性或较大图数据时评估；当前首先验证节点粒度、别名、来源分配与搜索体验，选数据库无法替代这些需求决策。

## 已核验范围与未决事实

- 上述模型、搜索和导入导出事实已实际联网读取官方页；其中企业市场成熟度没有用“领导者”等营销排名背书，仅按官方持续维护的完整产品文档纳入代表案例。
- 没有测试中文分词、真实数据查准率、附件正文索引、性能、平台报价和版本授权；这些不能从文档存在推定。
- 各产品新增的生成式 AI/语义向量功能没有被当成传统映射或词法检索的前提；规则推理也不能误标为生成式 AI。
