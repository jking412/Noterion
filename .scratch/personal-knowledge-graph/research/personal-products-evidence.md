# 个人知识产品：一手材料核查

实际检索日期：2026-11-07。研究辅助材料；只记录产品事实与本项目的研究判断，不构成用户批准的实施决定。

## Obsidian（已成功读取官方文档）

- **节点与边**：Graph view 的圆圈是笔记，线是笔记之间的内部链接；可选择显示标签、附件、尚未创建的链接目标，局部图可按深度展示邻居。因而“笔记图”默认不是已消歧的概念实体图。若约定一知识点一笔记，才能借笔记节点承载知识点；这是使用规范，不是自动语义识别。[官方 Graph view](https://obsidian.md/help/plugins/graph)
- **关系产生方式**：用户写 Wikilink `[[知识点]]` 或普通 Markdown 链接；可精确指向标题、块，并给同一笔记设置别名。普通内部链接只表达“链接到”，不自动赋予“前置知识”“属于”等知识关系语义；链接的显示文字也不等于关系类型。[官方 Internal links](https://obsidian.md/help/links)
- **资料关联**：笔记能够链接附件、其他文件，使用 `!` 可以嵌入；标题与块引用可定位学习笔记内部内容。块引用是 Obsidian 扩展，官方明确提示在其他软件中可能不工作。[官方 Internal links](https://obsidian.md/help/links)
- **不依赖生成式 AI 的搜索**：原生 Search 支持关键词、短语、AND/OR/排除、文件路径、标签、同一行/块/章节、属性与正则。官方明确 Search 只搜索笔记和 canvas 的**内容**；任意文件可按 `file:`/`path:` 检索名称或路径。因此不可把“支持 PDF 附件”推断为“原生搜索 PDF 正文”。[官方 Search](https://obsidian.md/help/plugins/search)
- **导入导出范围**：笔记本身是本地 vault 目录及子目录里的 Markdown 纯文本；其他编辑器可以直接读写，`.obsidian` 保存配置。既有 Markdown 可直接拖入或移动到 vault；官方 Importer 支持 Markdown/ZIP，CSV 导入可将每行转成一篇 Markdown、将列转成属性并生成 Base 表格视图。因此“数据迁出可保留原 Markdown 与附件文件”是基于文件存储机制的判断，而非声称插件界面和所有图语义跨工具无损。[官方 Data storage](https://obsidian.md/help/data-storage)、[官方 Markdown import](https://obsidian.md/help/import/markdown)、[官方 CSV import](https://obsidian.md/help/import/csv)
- **附件迁移的补核**：附件是操作系统可访问的普通文件，官方备份建议可以复制 vault 文件夹；迁移时应将原 Markdown 与附件一并保留。内部路径、块引用及插件专有数据仍需验证。[官方 Attachments](https://obsidian.md/help/attachments)、[官方 Back up files](https://obsidian.md/help/backup)（这两页由同组研究代理成功读取）

## Heptabase（由同组研究代理成功读取官方一手页面）

- **节点与边**：card 是知识容器/笔记，全部卡片在 Card Library；同一卡片可放入多个白板。`@` 提及其他卡片产生块级反向链接，Connect 工具由用户画箭头。卡片之间的视觉连接、正文链接与概念关系语义仍需分别理解；不会因为两卡相邻就自动成立领域语义。[官方 Fundamental elements](https://wiki.heptabase.com/fundamental-elements)
- **资料关联及非生成式 AI 能力**：文本笔记、PDF、白板、人工连接和双向链接均有独立的基础操作；可从文字/PDF等材料开始组织知识，无需以生成式 AI 为前提。[官方 Fundamental elements](https://wiki.heptabase.com/fundamental-elements)、[官方产品页](https://heptabase.com/)
- **搜索**：Global Search 搜索卡片、白板、聊天和标签，可筛卡片类型、是否包含白板文字/思维导图/网页内容，并按相关性或时间排序。本报告不据产品首页的速度宣传作性能保证；PDF/OCR的具体索引边界仍需按实际材料验证。[官方 User interface logic](https://wiki.heptabase.com/user-interface-logic)
- **导入**：官方导入说明列出 `.md`、`.txt`、`.docx`；Obsidian 导入可带图片附件并识别相对 Wikilink、Markdown 链接和 inline tags。官方不承诺从其他工具导入时所有结构、链接、格式完整保留。[官方 Import notes from other apps](https://support.heptabase.com/en/articles/10447948-import-notes-from-other-apps)
- **导出**：Settings → Backup → Export now 可导出全部笔记为 Markdown；完整导出包含 `All-Data.json`。官方提醒其他应用不一定保留白板布局、关系和元数据；“把 Markdown 导入另一个工具”不同于恢复 Heptabase 备份。该页面未提供所有 PDF 附件随 Markdown 完整无损迁移的充分保证，附件完整性需单独实测。[官方 Business sustainability and data portability](https://support.heptabase.com/en/articles/10364279-business-sustainability-and-data-portability)

## TheBrain

- **当前核查边界**：官方已发布 TheBrain 15。本节优先引用当前 v15 功能页和官方人员对 v15 的答复；不把旧版收费边界套用到现版本。`help.thebrain.com` 实际是移动端帮助首页，不代表桌面完整能力。[官方 v15 发布页](https://blog.thebrain.com/products/thebrain/thebrain15)
- **节点与边**：Thoughts 与 links 是基本单元，基础关系包括 parent、child、jump；Thought types 和 tags 做分类，Link Types 可使关系的含义更明确。Thought 是通用思维条目，可由用户承载主题、操作、资料等；这不是系统自动消歧的领域概念。[官方 Tutorials](https://thebrain.com/support/tutorials)
- **资料与非生成式 AI 能力**：官方教程列出独立的笔记、网页与文件附件、拖放、Thought 链接及搜索导航，同时将 AI 生成 Thoughts/Notes 单独列为功能。这证明人工建节点、人工连接与资料关联可以独立作为基础方法，不必把生成式 AI 当作图谱构建前提。[官方 Tutorials](https://thebrain.com/support/tutorials)
- **搜索**：v15 官方页列出短语、排除、音调无关匹配，按 type/tag/创建日期等筛选；并说明 Light Sync 的附件可索引与搜索、按需下载。可确认存在笔记和附件搜索；不能把这一概述扩大为“任意扫描 PDF、加密文件、音视频都能全文检索”，本次没有验证各格式提取器和 OCR 边界。[官方 v15 Search / Light Attachments](https://blog.thebrain.com/products/thebrain/thebrain15)
- **导入导出**：官方桌面教程说明有多种导入与 outline/JSON 导出；v15 官方人员 Harlan 的答复进一步确认：`File > Export > Folders` 可为每个 Thought 建目录，内含 Markdown 笔记与附件；`Markdown Files` 为每个 Thought 建 `.md` 并另设附件目录。这比“可导出 PDF 文档”更适合数据迁移。官方人员另确认 v15 的 JSON 导出与 v14 相同；但普通文档导出与完整结构导出应区分，跨工具是否正确保留 parent/jump/Link Type 仍须接收端适配及实测。[官方 Tutorials](https://thebrain.com/support/tutorials)、[官方论坛工作人员答复：v15 附件导出](https://forums.thebrain.com/post/how-to-export-parent-child-thought-with-their-attachments-13822689)、[官方论坛工作人员答复：v15 JSON 与 Light Sync](https://forums.thebrain.com/post/internal-attachments-in-v15-13725409)
- **API**：官方 REST API 可获取 Thoughts、links、attachments、notes、搜索和连接网络，并支持写入，适合需要结构化映射时做定制导入；这属于规则化程序接口，不等于依赖生成式 AI。[官方 API introduction](https://thebrain.com/blog/introducing-thebrain-api)

## 可直接用于主报告的比较摘要

| 产品 | 默认对象与关系 | 确定性基础路线 | 搜索边界 | 导入/迁出证据 | 本项目适配判断 |
| --- | --- | --- | --- | --- | --- |
| Obsidian | 笔记文件；内部链接；标签/附件可显示 | 人工模板、属性、别名、Wikilink/Markdown | 原生正文搜笔记与canvas；附件可按文件名/路径搜，不保证PDF正文 | 本地MD+普通附件；Markdown/CSV等Importer | 适合先验证“一知识点一笔记+显式资料”；typed关系需约定 |
| TheBrain | Thought；parent/child/jump；可加Link Types | 人工建Thought/Link、类型/标签、文件与网页附件、API | 有独立Search/Reports及附件索引，具体OCR/格式需实测 | outline/JSON；v15 Folders/Markdown Files可带附件 | 更接近人工概念网络；仍需定义知识点和关系词汇 |
| Heptabase | Card；白板/人工箭头；提及/反向链接 | 人工卡片、白板连接、资料阅读 | Global Search按对象/内容类别过滤；PDF全文边界需验证 | MD/TXT/DOCX导入；MD+All-Data.json导出，跨工具不保全所有布局关系 | 适合人工整理与阅读导向；不能凭图形连接默认领域语义 |

## 对本项目的暂定适配判断

Obsidian 最直接展示“结构化文字 + 显式链接 + 独立搜索”怎样构成无生成式 AI 的起点；Heptabase 展示“卡片 + 白板人工组织 + 资料阅读”的另一种交互形式。两者都需要约定知识点粒度、别名及关系语义；产品提供的连接机制本身不决定本项目的知识关系类型，也不替用户决定整篇来源如何分配给条目。

TheBrain 的 Thought、Link Type 与附件模型更直接接近本项目“知识点—知识关系—资料关联”的人工版本，但是否采用它是后续验证问题；不因产品自称知识图谱就默认满足简略 TXT 条目解析、来源分配或更新去重需求。

## 核查限制

- 本次为官方文档与产品材料核查，没有安装三款产品进行导入、导出、中文分词或附件检索实测，因此产品支持列表不能替代本项目验收。
- TheBrain 14 用户指南 PDF 的直接读取失败（约20MB，工具提示体积过大）。导出结论改用实际成功读取的当前官方教程、v15页面及工作人员答复，不把搜索摘要当成手册全文读取。
- 未为罗列候选而扩大至所有个人笔记产品；三个代表分别展示文件链接、通用Thought网络、卡片白板机制。
