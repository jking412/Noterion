# Matt Pocock 的 AFK Agent 项目：Sandcastle 与 Ralph

调研日期：2026-11-07（Asia/Shanghai）。只读核验；未安装依赖、初始化工具、运行代理或修改 Noterion 规格。

## 结论

用户记忆中的“Matt 做的、用于运行 AFK agents 的项目”，最吻合的是 **Sandcastle**，官方仓库为 [mattpocock/sandcastle](https://github.com/mattpocock/sandcastle)，文档入口为 [AI Hero / Sandcastle](https://www.aihero.dev/sandcastle)。它是编排沙箱内编码代理的 TypeScript 库，可以组合循环执行、分支隔离、审查与并行工作。

**Noterion 后续开发可以评估使用它。** 当前官方文档已提供 Codex agent provider；项目的 Windows 使用环境也有相应沙箱路径。不过，本地 Markdown 工单需要定制接入，Noterion 的构建、数据库依赖与桌面验收也必须在执行环境中准备好。本结论是可适配性判断，不代表已经完成接入验证。[Agent providers](https://github.com/mattpocock/sandcastle/blob/main/docs/guide/agent-providers.md)、[Getting started](https://github.com/mattpocock/sandcastle/blob/main/docs/guide/getting-started.md)、[Init](https://github.com/mattpocock/sandcastle/blob/main/docs/guide/init.md)。

## 三个概念分别是什么

| 名称 | 一手来源确认的含义 |
| --- | --- |
| AFK | Away From Keyboard：用户启动会话后离开，由代理无人值守执行的一种工作模式。Matt 明确保留事前对齐和事后人工审查。[AFK 定义](https://www.aihero.dev/ai-coding-dictionary/afk) |
| Ralph / Ralph Loop | 循环运行编码代理的方法：根据需求或任务记录挑选工作、实施并提交。Matt 的官方 Workshop 同时介绍有人参与和 AFK 两种运行方式。[Ralph Workshop](https://www.aihero.dev/getting-started-m2c6l) |
| Sandcastle | Matt 的公开项目，通过程序 API 运行代理、配置沙箱和 Git 分支策略，可用来搭建 AFK 工作流。[官方仓库](https://github.com/mattpocock/sandcastle) |

因此，“AFK”不单独指某一个软件；“Ralph”描述循环方法；“Sandcastle”是最符合本次项目线索的具体工具。最后一项身份判断是根据用户描述与仓库定位作出的推断。

## Sandcastle 当前实际提供什么

### 库能力

- 用 run() 启动指定编码代理，收集每次执行产生的提交和执行结果；一次运行默认一轮，可通过 maxIterations 增加循环次数。[Core concepts](https://github.com/mattpocock/sandcastle/blob/main/docs/guide/core-concepts.md)、[Iterations](https://github.com/mattpocock/sandcastle/blob/main/docs/guide/iterations.md)。
- 当前自带 Claude Code、Codex、Pi、Copilot、Cursor、OpenCode 的 agent providers。Codex 是文档明确列出的现有适配，不是从“skills 可通用”推导出来的。[Agent providers](https://github.com/mattpocock/sandcastle/blob/main/docs/guide/agent-providers.md)。
- 可配置在当前工作区执行、在临时分支执行并合并，或在指定分支/worktree 执行。Docker 等 bind-mount provider 默认采用 head，意味着默认就可能修改宿主工作区；是否使用独立分支应明确配置。[Branch strategies](https://github.com/mattpocock/sandcastle/blob/main/docs/guide/branch-strategies.md)。
- 支持通过提示模板加入任务、近期提交等上下文；引擎不限定工单系统或具体工作流程。任务怎么挑、依赖怎么判断和完成标准是什么，仍需要由提示及编排说明清楚。[Prompts](https://github.com/mattpocock/sandcastle/blob/main/docs/guide/prompts.md)。
- 可以配置宿主或沙箱内的准备命令，以便在代理开始之前准备依赖。具体项目的编译、检查和测试不会因为选择了沙箱就自动具备。[Hooks](https://github.com/mattpocock/sandcastle/blob/main/docs/guide/hooks.md)。

### 模板能力

当前 init 提供五种模板：空白、顺序循环、顺序实施加审查、并行规划后分支实施与合并、并行规划加逐分支审查与合并。它们把库能力组合成现成工作流，但模板中的任务来源、项目命令和完成约定仍需要符合使用项目。[Init / Templates](https://github.com/mattpocock/sandcastle/blob/main/docs/guide/init.md)。

这意味着可以搭建“取任务 → 实施 → 检查/审查 → 处理分支结果 → 下一项”的自动执行流程；不能由此推导系统会自动替用户完成需求取舍、补齐未知产品行为或确认桌面体验。后半句是对能力边界的解释，也符合 Matt 的 [AFK 定义](https://www.aihero.dev/ai-coding-dictionary/afk)。

## Windows、Codex 与本地工单的适配

| 方面 | 官方事实 | 对 Noterion 的含义（推断） |
| --- | --- | --- |
| 编码代理 | Agent providers 文档有 codex()；CLI init 的 --agent 列出 codex。[文档](https://github.com/mattpocock/sandcastle/blob/main/docs/guide/agent-providers.md)、[CLI](https://github.com/mattpocock/sandcastle/blob/main/docs/guide/cli.md) | 可以评估继续使用 Codex 作为被编排的编码代理；这不等于已能直接调度当前 Codex 桌面聊天。 |
| Windows 沙箱 | 当前 init 在 Windows 的 WSL2 中提供 bwrap；Windows 原生环境只提供 Docker、Podman。[Init](https://github.com/mattpocock/sandcastle/blob/main/docs/guide/init.md) | 当前 PowerShell/Windows 工作环境有可评估路径，需选择并实际验证对应 provider。 |
| 工单来源 | init 内置 GitHub Issues、Beads、Custom；Custom 会生成需要继续配置的骨架和设置提示。[Init](https://github.com/mattpocock/sandcastle/blob/main/docs/guide/init.md) | 本项目现有本地 Markdown 工单可以作为 Custom 接入目标，但不能宣称开箱即可识别其状态、依赖和完成条件。 |
| Git | Getting started 将 Git 列为前提，分支与合并策略基于 Git。[Getting started](https://github.com/mattpocock/sandcastle/blob/main/docs/guide/getting-started.md)、[Branch strategies](https://github.com/mattpocock/sandcastle/blob/main/docs/guide/branch-strategies.md) | Noterion 需先具备明确的代码与提交基线，再验证分支型自动执行。 |
| 技术栈 | Sandcastle 的 TypeScript 是编排脚本所用语言；官方允许定制执行环境和项目依赖。[Init](https://github.com/mattpocock/sandcastle/blob/main/docs/guide/init.md)、[Hooks](https://github.com/mattpocock/sandcastle/blob/main/docs/guide/hooks.md) | 不要求将 Noterion 的 Rust 本地核心改成 TypeScript；应准备其现有技术路线所需的工具和服务。 |

旧版 Ralph Workshop 的 AFK 示例明确要求 Claude Code，平台为 macOS 或 Linux/WSL，不支持 Windows/PowerShell。该限制属于那套示例，不可直接套用到当前 Sandcastle；当前 Sandcastle 的 agent providers 与 init 文档已给出上述不同能力。[Workshop 原文](https://www.aihero.dev/getting-started-m2c6l)。

WSL2 的 bwrap 路线还有具体边界：官方要求仓库位于 Linux 文件系统，沙箱隐藏 Windows 挂载及互操作入口，无法调用 Windows .exe。因此，不能承诺本项目当前 D 盘工作目录可以沿该路线原地运行；这只是可选路线之一，需与 Docker/Podman 路线分别核验。[Sandbox providers / bwrap on Windows](https://github.com/mattpocock/sandcastle/blob/main/docs/guide/sandbox-providers.md)。Tauri 官方也区分 Windows 安装包构建条件：MSI 需在 Windows 生成，NSIS 跨编译另有条件；最终 Windows 构建和桌面验证仍须实际执行。[Tauri Windows Installer](https://v2.tauri.app/distribute/windows-installer/)。

## “全自动”的实际边界

Matt 的 AFK 定义把输入和检查分到三个阶段：运行前通过需求对齐与规格减少歧义；运行中依赖自动检查和审查；运行后产生供人审查的结果。定义明确说明 AFK 不取消人工审查。[AFK](https://www.aihero.dev/ai-coding-dictionary/afk)。

因此，这里适合自动化的是**定义清楚的实施工作**。例如，一个已确定验收条件的知识点搜索任务，可以由代理修改代码、运行项目检查并提交结果。尚未确定的资料查看行为、产品边界或用户取舍，不能因为启用 AFK 就视为已决定。这里是对 Noterion 当前状态的应用判断。

## Noterion 建议接入时机

以下是根据本项目当前情况提出的建议，不是已经确认的产品或技术决定：

1. 按用户要求等待独立技术讨论收尾，并把已确认内容同步到正式规格。
2. 通过 to-tickets 形成自包含的实施工单，包含真正的阻塞关系与可观察的验收条件。
3. 在项目实现基线、构建和测试命令具备后，先以一张范围清楚的工单验证 Sandcastle + Codex + 选定沙箱的完整路径。
4. 如保留本地 Markdown 跟踪，适配 Custom 模板的工单读取、领取、阻塞判断与完成记录；无需仅为采用 Sandcastle 就改用 GitHub Issues。
5. 首次可优先评估顺序实施加审查模板，保留人工检查结果；确认执行与验收可靠后，再评估真正互不阻塞工单的并行规划模板。

需要实际核验的项目适配点包括：Rust 与界面构建工具、PostgreSQL/Neo4j 与对象存储测试依赖、每次执行的数据隔离，以及 Windows 桌面应用的完整用户操作验收。仅凭 Sandcastle 已支持某个沙箱，不能宣称 Noterion 的 Windows 安装包、桌面图谱操作和资料打开均已通过验证。

## 当前状态与证据边界

- 官方仓库是公开、MIT 许可项目，并有专门文档入口；本次读取的 main 分支 package.json 为 0.14.0。它是本次源代码快照的版本，不当作已核验的 npm 最新发行版本。[仓库](https://github.com/mattpocock/sandcastle)、[package.json](https://github.com/mattpocock/sandcastle/blob/main/package.json)。
- Changelog 持续列出 provider、会话、初始化和运行行为的变化，接入时应按选定版本核验，不照搬旧视频的 API 或平台限制。[Changelog](https://github.com/mattpocock/sandcastle/blob/main/CHANGELOG.md)。
- 本次不能仅凭文档或版本号判断其对所有工程场景的成熟度；未安装、运行、测量或验证 Noterion 集成。
- software-factory 曾作为搜索线索出现，但本次直接访问相应 GitHub 地址返回 404，没有足够一手证据认定它是当前可用项目，或认定它与 Sandcastle 存在更名关系。不将该线索作为推荐依据。
