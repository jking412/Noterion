# Repository instructions

有任何不明白的地方，请先询问我，而不是直接开始工作，错误的完成和没完成是一样的

## Worktree isolation

- 从 Issue #23 开始，所有需要修改代码、构建/CI 脚本或依赖配置的实施会话，都必须新建该会话专用的 Git worktree 和分支；代码修改、测试与构建均在该 worktree 中进行，避免写入共享主目录或其他会话的工作区。
- 只读研究与方案会话可以使用现有目录；获得实施授权后，先创建新的专用 worktree，再开始改代码。使用应用提供的 worktree 创建与归档工具。
- 已经开始实施的 Issue #22 当前会话是本次明确例外，继续使用其原目录；此例外不适用于其他会话或后续新建的实施会话。
- 各会话只提交自身任务的修改，保留其他目录的未提交内容；需要集成时通过明确的分支提交整合，不复制或覆盖其他会话的工作。

## Agent skills

### Issue tracker

本项目使用 GitHub Issues 跟踪任务，规格和研究文档保存在 `.scratch/<feature-slug>/`。创建、读取或更新规格和工单前，先阅读 `docs/agents/issue-tracker.md`。

### Triage labels

本项目使用默认的五个分流标签。执行问题分流或设置工单状态前，先阅读 `docs/agents/triage-labels.md`。

### Domain docs

本项目采用 single-context 布局：根目录 `CONTEXT.md` 和 `docs/adr/`。探索代码前，先阅读 `docs/agents/domain.md`，并按其中规则读取领域文档。
