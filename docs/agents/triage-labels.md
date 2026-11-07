# Triage Labels

本项目将五个标准分流角色映射到以下状态字符串。
正式工单使用 GitHub Issue 标签；本地规格文档仍可保留自身的 `Status:` 行。

| 标准角色 | 本项目状态字符串 | 含义 |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | 等待维护者评估 |
| `needs-info` | `needs-info` | 等待报告者补充信息 |
| `ready-for-agent` | `ready-for-agent` | 规格充分，可由代理独立实施 |
| `ready-for-human` | `ready-for-human` | 需要人工实施 |
| `wontfix` | `wontfix` | 不予处理 |

技能提到某个分流角色时，使用表中对应的本项目标签。分流标签和 GitHub Issue 的 open/closed 状态分别表达任务准备程度与是否完成。

如需采用已有的其他命名，修改“本项目状态字符串”列。
需要用户明确决定的询问使用 `ready-for-human`。存在依赖的 `ready-for-agent` 工单仍须等待阻塞项完成，按 `issue-tracker.md` 处理。
