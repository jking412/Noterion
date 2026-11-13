# 启动 Noterion 的 GitHub 工单自动执行

当前接入：GitHub Issues（jking412/Noterion）→ 本机 Sandcastle 0.14.0 → 本机已登录的 Codex CLI。
不要求编码 Agent 的 Docker 镜像或新增 Codex API Key。使用用户已明确同意的本机全权限执行方式。

## 直接怎样启动

在 PowerShell 中：

~~~powershell
Set-Location -LiteralPath 'D:\person\application\knowledgeGraph'

# 只读检查配置、登录、工作区和当前工单；不调用模型，不更新工单。
node .sandcastle/run.mjs --check

# 真正开始当前这一批工单。
node .sandcastle/run.mjs --run
~~~

第二条命令会调用模型、写代码、运行检查、合并到本地 main，并在 GitHub 记录结果及关闭通过验收的 Issue。
启动前必须已提交配置和现有改动；运行器不会替你提交或清理其他聊天的工作。

只看工单排队情况：

~~~powershell
node .sandcastle/run.mjs --plan
~~~

## 配置改哪里

主要配置只有 config.json。角色要求在 roles/implement.md 和 roles/review.md。

~~~json
{
  "repository": "jking412/Noterion",
  "targetBranch": "main",
  "issues": "all-open-at-start",
  "model": null,
  "maxParallel": 2,
  "firstPassParallel": 1,
  "maxRepairRounds": 3,
  "runHours": 4,
  "finishGraceMinutes": 10,
  "autoMerge": true,
  "closeCompletedIssues": true
}
~~~

- repository：正式工单仓库。
- issues：默认启动时固定当时全部 open Issue；也可以改为 [1, 3] 这样的编号数组。新发布工单留到下一批。
- model：null 表示不覆盖本机 Codex 已配置的模型；填模型 ID 才显式覆盖。
- firstPassParallel / maxParallel：首次闭环通过前同时做 1 张，成功后最多同时实施 2 张。
- maxRepairRounds：初次实施之后最多再修复 3 轮。
- runHours：到达 4 小时后停止领取新任务，正在执行的任务最多再收尾 10 分钟，然后取消并保留工作区。
- autoMerge：通过整合验证后快进合并到本地 main。
- closeCompletedIssues：验收和整合完成、证据评论写入成功后关闭 Issue。

其余超时字段已有默认配置，通常不用改。此流程不会自动推送 Git 远端或创建 PR。

## 启动后发生什么

1. **前检**：确认全局库版本、Git 提交基线、当前 main、干净工作区、Codex 登录和既有 GitHub 仓库权限。未通过就退出，不启动 Agent、不领取工单。
2. **固定批次**：从 GitHub 实时读取当时工单编号。正文、讨论、标签和依赖仍以 GitHub 为准，不在本地重建工单真相源。
3. **选任务**：只实施 open 且 ready-for-agent 的工单；同时核对原生依赖和正文 Blocked by，全部前置已关闭才可执行。ready-for-human 永不交给实施 Agent。
4. **实施**：在 sandcastle/issue-N 分支和独立 worktree 中启动本机 codex exec。实现类 Issue 进入实施阶段，不需要另找一个叫 implement 的系统命令。
5. **审查与检查**：实施者提交结果后，运行器串行执行真实 PowerShell 检查，再启动独立 Codex 审查。每项验收都须有证据，检查由运行器重跑并读取实际退出码。
6. **返修与整合**：有问题最多返修 3 轮。对最新 main 形成候选结果并重新核验，通过后才快进合并；检查结果必须对应当前候选提交。
7. **GitHub 回写**：记录本地提交、验收证据和实际命令退出码，然后关闭该 Issue。回写失败保留待同步状态，不把它当已关闭，也不在新批次盲目重做。
8. **结束**：没有可执行工单、用户中断或时间窗口到达后，保存结果报告与未完成位置。

GitHub 访问使用当前环境或既有 Git 凭据；凭据只在内存中使用，不写配置或日志。只读预检只能确认当前仓库角色，细粒度令牌的实际 Issues 写权限仍以真实写入结果为准。

## 按当前这批工单，会先做什么

2026-11-07 只读读取时已有 18 张 Issue。无前置的代理任务包括：

- #1：核心桌面体验的可点击原型。
- #3：真实 Windows 桌面验收路径验证。
- #10：对象存储接口真实兼容性验证。

首次先做 #1 验证闭环，之后 #3 和 #10 可并行。#2、#6 是用户决策工单，运行器会列为待你回答。#4 等实现工单必须等其实际前置完成，不会因为带 ready-for-agent 标签就越过依赖。

## 结果在哪里，怎样继续

每一批保存到 .sandcastle/runs/批次ID/：

- report.md：已完成、受阻、未执行及续跑命令。
- state.json：执行账本，记录分支、提交、验收证据和回写状态。
- Agent 与检查日志：用于定位具体失败。

运行期间的锁和跨批执行状态位于 .sandcastle/state/；这些是本机执行记录，不是 GitHub Issue 的副本。
相关目录已忽略，不会因生成日志使主工作区变脏。

暂停当前运行可按 Ctrl+C，等待它保存并收尾。读取报告后，用其中给出的 ID 续跑：

~~~powershell
node .sandcastle/run.mjs --resume 2026-11-07T12-00-00-000Z
~~~

实际使用报告中的真实 ID。续跑只处理原批次；会核对最新 Issue、讨论、分支和提交，不以旧提交的检查结果批准新改动。必须问用户的任务在没有新答复或要求变化时继续保持暂停。
如果因进程崩溃残留 runner.lock，先核对其中 PID 对应进程确已退出，再处理锁；不要在旧任务仍运行时启动第二个运行器。

## 验证范围

已做纯调度、依赖、报告、续跑边界和真实 PowerShell 退出码测试，以及不调用模型的 GitHub 实时读取/权限前检。
没有为了测试配置而启动任何应用实施工单，也没有实际关闭 Issue 或执行整合。
第一次真实启动仍承担端到端闭环验证，因此默认首次只同时实施一张。

main.mts 现在是兼容入口，转到 run.mjs。先前 Dockerfile、示例及旧提示保留为参考，不参与当前批处理入口。
