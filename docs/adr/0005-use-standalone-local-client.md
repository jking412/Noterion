---
status: accepted
---

# 采用本地客户端保存正式知识和资料

决定日期：2026-11-12（Asia/Shanghai）。本记录于 2026-11-17 整合历史工作区时补录；编号表示入库顺序，不改变决定日期。

用户明确将产品改为本地客户端，取消 PostgreSQL、Neo4j 和 OSS/S3。正式知识及资料文件副本保存在有写权限的本机安装目录或用户指定数据目录，不要求数据库服务器、对象服务、Docker 或独立业务后台，从而免去个人使用时的部署与跨服务维护成本；本决定取代 [ADR 0002](0002-postgresql-source-neo4j-projection.md) 和 [ADR 0003](0003-use-configurable-object-storage.md)。后续 [#21 客户端](https://github.com/jking412/Noterion/issues/21) 使用 SQLite 与本地文件实现该边界，现行多空间方案由 [ADR 0004](0004-space-scoped-local-store.md) 细化。

早期“完全不依赖外部服务”后来对 AI 能力局部调整：[ADR 0006](0006-ai-native-knowledge.md) 记录 2026-11-13 的 AI Native 决定。AI 调用需要配置模型服务并联网，仍不改变正式知识与资料在本机保存的职责。用户主动打开外部链接也继续可用。当前运行与数据目录说明见[客户端说明](../../app/README.md)。
