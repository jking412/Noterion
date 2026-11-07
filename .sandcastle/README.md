# Sandcastle：本机 Codex CLI 的配置与使用

更新日期：2026-11-07（Asia/Shanghai）。

## 当前路线

用户已明确选择在当前 Windows 电脑上调用已登录的 Codex CLI，并接受全部执行权限。编码 Agent 不要求 Docker，也不要求另建 API Key。已通过 codex.cmd login status 只读确认当前会话可见 CLI 已登录 ChatGPT，尚未执行推理任务。

one-task.example.mjs 已改为本机 noSandbox() 路线。0.14.0 内置 Codex provider 默认使用绕过审批与文件系统沙箱的启动参数，符合用户本次明确选择；这不是普通 Codex 的默认权限模式。

数据库是否使用 Docker 继续按应用技术方案处理，此处只讨论编码 Agent。

## 工作原理与地位

    已确认的规格与本地 Markdown 工单
              ↓
    项目编排脚本：取哪张、何时并行、怎样审查和判定完成
              ↓ 使用 Sandcastle API
    Sandcastle：启动和等待 CLI、组织迭代、处理工作区和分支、收集结果
              ↓
    本机 Codex CLI：复用登录、与模型通信、修改文件和执行命令
              ↓
    项目文件、Git 提交与实际检查结果

本机模式下，Codex provider 实际启动 codex exec --json 等命令，任务文本通过 stdin 输入。模型通信和具体编码由 CLI 处理。

单次明确任务可以直接使用 Codex CLI。Sandcastle 为多次 CLI 调用、多个工作区和结果处理提供可组合 API。工单依赖、独立审查、三轮返修、四小时窗口、固定批次和完成门槛仍由项目脚本组织，安装库不会自动实现这些规则。

## 安装位置

- 版本：0.14.0。
- 全局命令：D:\tools\nodejs\sandcastle.cmd。
- 全局包：D:\tools\nodejs\node_modules\@ai-hero\sandcastle。
- 项目配置：D:\person\application\knowledgeGraph\.sandcastle。
- 项目未本地安装 Sandcastle，也没有根 package.json/node_modules。

可用管理命令：

~~~powershell
sandcastle.cmd --version
sandcastle.cmd --help
~~~

管理命令负责初始化等操作；运行任务则执行项目脚本。

## 文件与格式

| 文件 | 格式 | 当前用途 |
| --- | --- | --- |
| one-task.example.mjs | JavaScript ES 模块 | 本机单任务示例，默认仅检查，显式 --run 才执行 |
| one-task.example.md | Markdown | 填写一个已确认任务与完成条件，当前仍为占位 |
| main.mts | TypeScript 模块 | 官方整批规划/实施/审查/合并骨架，仍待适配 |
| plan-prompt.md 等 | Markdown | 官方各角色提示，尚含未配置的工单命令 |
| .env.example | KEY=value | 旧模板的可选 API Key 示例，当前本机路线不必填写 |
| Dockerfile | Dockerfile | 旧模板的容器环境，当前本机示例不使用 |

单任务示例顶部的配置：

~~~javascript
const config = {
  model: "gpt-5.4",
  taskFile: join(repoDir, ".sandcastle", "one-task.example.md"),
  maxIterations: 1,
};
~~~

model 沿用原模板值，仅展示格式，尚未核验该账户模型可用性。taskFile 指向任务文本；maxIterations 是一次 run 的迭代上限，不等于批次任务数或三轮审查返修。

核心调用：

~~~javascript
await run({
  cwd: repoDir,
  agent: codex(config.model),
  sandbox: noSandbox(),
  branchStrategy: { type: "merge-to-head" },
  promptFile: config.taskFile,
  maxIterations: config.maxIterations,
  name: "one-task-example",
});
~~~

脚本通过 npm 全局包目录解析库，不需另装 tsx/zod。此分支策略在临时分支工作后尝试合回目标分支。示例没有独立审查和完整验收门槛，不能当作已完成的整批控制器。

## 现在可以执行：检查配置

~~~powershell
Set-Location -LiteralPath 'D:\person\application\knowledgeGraph'
node .sandcastle/one-task.example.mjs --check
~~~

输出显示执行方式 local-codex-cli、全局库能否加载、任务是否待填写。省略参数也只检查，不调用模型、不读取真实凭据、不实施任务。

## 准备好之后：执行单个真实任务

先填写 one-task.example.md，确认本机 Codex 登录和模型可用，项目已有 Git 提交基线。应用实施工单仍等独立技术聊天收尾。

~~~powershell
node .sandcastle/one-task.example.mjs --run
~~~

这会在本机调用 Codex CLI，没有镜像构建步骤，也不要求新建 .env 填 API Key。占位任务未替换时会先拒绝启动。日志默认写入 .sandcastle/logs/，结束时输出提交和日志路径。

## 官方整批骨架

main.mts 仍是此前 Docker/Custom 模板，本地工单、普通包解析、tsx/zod 与约定运行规则尚未接好。官方命令 npx tsx .sandcastle/main.mts 当前不是可用的整批命令；后续正式流程应沿用用户选择的本机 CLI 路线。

完整原则见 [采纳讨论](../.scratch/personal-knowledge-graph/sandcastle-adoption.md)。

## 实际验证

- 全局版本和帮助正常，安装位置已确认。
- main.mts 语法检查通过，全局库可以导入。
- 单任务示例的语法和配置检查通过，执行方式已改为本机 CLI。
- 登录状态只读检查返回 ChatGPT 登录，没有读取或输出凭据。
- 未执行 --run、调用模型、创建容器或处理工单。

参考：[OpenAI 官方认证说明](https://learn.chatgpt.com/docs/auth)、[Sandcastle 官方快速开始](https://github.com/mattpocock/sandcastle/blob/main/docs/guide/getting-started.md)。
