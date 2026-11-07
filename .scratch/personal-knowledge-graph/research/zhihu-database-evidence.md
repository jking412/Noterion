# 知乎使用什么数据库：一手证据核验

核验日期：2026-11-07（Asia/Shanghai）。

问题按用户原话理解为“知乎一般用什么数据库，是 Neo4j 吗？”本文只核验知乎公开的数据库实践，不决定本项目的数据库，也不将用户问题改成其他产品。

## 可直接用于答复的结论

**公开一手资料不足以支持“知乎一般使用 Neo4j”这一概括。已核验的资料显示，知乎在不同系统中使用过 TiDB、MySQL，并有 NebulaGraph 图数据库的工程实践。** 各案例的业务范围和时间不同，不能把其中任何一种当作知乎全站唯一数据库，更不能据此断言 2026 年知乎的完整现网架构。

## 主要证据

| 时间 | 一手来源与身份 | 能确认的范围 | 不能外推的内容 |
| --- | --- | --- | --- |
| 2021-08-17 | PingCAP 官方案例，署名 Mengyu Hu（知乎平台工程师）；日期由 PingCAP 官方博客源码的 front matter 核验 | 文章明确说明 Apache Hive Metastore 从 MySQL 迁移到 TiDB；还介绍用 TiDB 保存 HDFS 元数据及目录大小缓存，服务 Hive 大查询预警和 NameNode 请求优化 | 这证明这些大数据基础设施的历史选型，不证明知乎所有用户、问题、回答表当前都用同一数据库 |
| 2021-10-11 | NebulaGraph 官方技术社区整理的 Norm on nLive 播客，介绍知乎反欺诈团队工程师吴振胜的实践；NebulaGraph 官方手册将其列为生态工具资料 | 反欺诈业务使用图谱关联和图实时计算能力；知乎工程师开发了面向 NebulaGraph nGQL 的 Go ORM Norm。知乎官方 GitHub 仓库可以交叉核验工具及其图数据库接口 | 不能扩大成知乎全站主存储是 NebulaGraph，也不能凭此声称知乎其他业务从未使用 Neo4j |
| 2024-10-16 | PingCAP 官方博客，署名 Xiaolei Dai（知乎数据库负责人）；日期可由 PingCAP 官方博客目录交叉核验 | 介绍知乎数十套 TiDB 数据库、PB 级数据的同城数据中心在线迁移，讨论 Placement Rules、TiCDC 等技术 | 这是 TiDB 数据库迁移案例，不是知乎全部存储技术的盘点 |

第一项的正文与日期来源：[PingCAP：TiDB 与 Hive/HDFS 实践](https://www.pingcap.com/case-study/boosting-big-data-performance-by-combining-tidb-with-hive-and-hdfs/)、[PingCAP 官方博客源码](https://github.com/pingcap/blog/blob/master/boosting-big-data-performance-by-combining-tidb-with-hive-and-hdfs.md)。

第二项的正文与交叉验证：[NebulaGraph：Norm 知乎开源的 ORM 工具](https://discuss.nebula-graph.com.cn/t/topic/6423)、[知乎官方 GitHub：zhihu/norm](https://github.com/zhihu/norm)、[NebulaGraph 官方生态工具手册](https://docs.nebula-graph.com.cn/3.8.0/20.appendix/6.eco-tool-version/)。Norm README 明确支持构造点、边的 nGQL，并解析 Nebula 执行结果。知乎 GitHub 主页自述为官方帐号，并链接其工程技术专栏，可辅助核实仓库所属主体：[知乎官方 GitHub 主页](https://github.com/zhihu)。

访问状态补充：本次网页工具可直接读取 github.com/zhihu/norm 及 raw.githubusercontent.com/zhihu/norm/master/README.md，返回内容未显示 Community Fork 字样，也未显示迁移到外部镜像的地址；GitHub API 元数据入口无法由该工具访问，未核实底层 HTTP 重定向链。最终结论依靠 2021 年官方社区文章与公开仓库内容交叉确认“知乎工程师曾公开相关项目”，不以链接可读推导 2026 年仍在生产使用、持续维护或全站部署。

第三项的正文与日期来源：[PingCAP：知乎 PB 级 TiDB 数据库迁移](https://www.pingcap.com/blog/from-plan-to-execution-zhihus-guide-to-petabyte-scale-tidb-database-migration/)、[PingCAP 官方 TiCDC 博客目录](https://www.pingcap.com/ko/blog/?tag=ticdc)。目录中列出该文章日期为 2024-10-16；文章代码中的 2024-06-30 是备份路径示例日期，不当作文章发布日期。

## 补充历史证据

PingCAP 官方博客源码还保留 2019-08-21 的知乎案例，署名 Xiaoguang Sun（知乎后端搜索负责人、TiKV 维护者）。文章明确将 TiDB 的使用范围限定在 Moneta——记录用户已经读过的内容、供推荐流过滤使用的应用，进一步说明应按业务系统回答数据库问题。[2019 年知乎 Moneta 案例源码](https://github.com/pingcap/blog/blob/master/lesson-learned-from-queries-over-1.3-trillion-rows-of-data-within-milliseconds-of-response-time-at-zhihu.md)。

## Neo4j 证据边界

本次检索包含知乎官方 GitHub、知乎技术团队相关公开入口，以及 PingCAP、NebulaGraph、Neo4j 官方站点。**没有核验到直接证明“知乎全站以 Neo4j 为一般主数据库”的一手资料。** 这属于本次检索的证据边界，不等于证明知乎从未在任何系统使用 Neo4j。

没有采用知乎网站上任意用户发表的 Neo4j 教程、第三方爬虫或“仿知乎”项目的数据库配置，作为知乎公司现网选型的证据。

## 本项目的使用边界

以上回答的是知乎这一大型平台的公开历史实践。用户已表达 Tauri 倾向并排除 SQLite，项目数据库仍未确定；本文没有据知乎案例推荐 NebulaGraph、TiDB、MySQL 或 Neo4j，也没有修改技术设计、业务草稿、领域词汇或 ADR。
