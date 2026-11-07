# Noterion

**A personal knowledge graph for your external brain.**

Noterion 是个人的外置大脑：长期保存学过的知识点、自己的理解及学习资料之间的联系，在需要时通过搜索找回知识、在图谱中定位，再阅读说明或打开来源。

名称融合了 **Note**（笔记、学习记录）与 **Orion**（猎户座）的意象：分散知识如同星点，个人理解与联系组成可以循线查找的知识结构。名称的完整由来与产品愿景见[正式规格](.scratch/personal-knowledge-graph/spec.md)。

## 当前进度

需求与基础技术讨论已完成，已确认包含原型、交互确认、技术验证和功能实现的 18 项任务安排。当前仓库保存规格、研究、架构决策与开发流程配置，应用功能尚未实现。

- 正式任务：[GitHub Issues](https://github.com/jking412/Noterion/issues)。
- [18 项 Issue 索引与依赖导航](.scratch/personal-knowledge-graph/issue-index.md)。
- [任务计划](.scratch/personal-knowledge-graph/task-plan.md)。
- [正式规格](.scratch/personal-knowledge-graph/spec.md)。
- [领域术语](CONTEXT.md)。
- [技术选择记录](.scratch/personal-knowledge-graph/technical-design.md)。
- [架构决策](docs/adr/)。

## 产品与技术方向

- Windows 桌面应用，采用 Tauri 与 Rust 本地核心。
- 知识点保存名称和 description；主题本身也是知识点，同一个知识点可以属于多个主题。
- 基础搜索覆盖名称与描述，选择结果后在图谱定位并显示详情及资料入口。
- PostgreSQL 保存完整正式结构化事实，Neo4j 承担可重建的图查询表示。
- 文件资料保存在可配置对象存储；链接资料保留外部地址。
- 删除知识点时保留资料文件；当前不提供回收站与删除后恢复。

完整范围、验收与暂缓事项以正式规格和最新 Issue 为准。界面原型与关键工程路径将在对应任务中验证。

## 参与开发

先阅读 [AGENTS.md](AGENTS.md) 和[工单约定](docs/agents/issue-tracker.md)，从无阻塞的 GitHub Issue 开始。需要用户作答的任务必须等待明确决定。

已有 Sandcastle 文件属于独立的开发自动化配置与示例，状态及运行限制见[说明](.sandcastle/README.md)，不代表已经启动工单执行。
