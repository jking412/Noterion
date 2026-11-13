# Issue #26：客户端细节与 AI 反馈验收

日期：2026-11-13（Asia/Shanghai）。本轮使用真实 Windows Tauri 客户端、WebView2、Edge WebDriver 和原生 Rust 存储/HTTP 路径。合入最新 main 已提交的品牌图标后，最终程序的核心与 AI 正常/异常整轮 **22 项通过、passed=true**；200% 相对 runtime 缩放与任务导航补证 **3 项通过、passed=true**。整合前的 150% 比例补证、历史 RED 和驱动诊断也分别保留，**不把曾因驱动缩放断言失败的整轮运行改记为成功**。机器汇总见 [issue-26-summary.json](issue-26-summary.json)。

本轮供应商是确定性的本机 HTTP/SSE 夹具，替换的是供应商响应；没有 mock 桌面 IPC、直接注入正式知识或用浏览器页面冒充客户端。本轮没有调用官方 DeepSeek，不将模拟供应商成功或错误说成官方服务结果。

## 工作区与程序

- 专用 worktree：`C:/Users/skynesser/.codex/worktrees/13f0/knowledgeGraph`。
- 分支：`codex/issue-26-ui-feedback`。
- 基线已整合远端 CI 交付；#26 修改前固定审查基点：`647c20566550a86056b0e6b2def81ef36e71d4fe`。
- 最后整合了 `origin/main` 的明确提交 `6f44e447be776ac92ec6bc00c90eb19e956e13a1`，合并提交为 `bbccbb64d3a26e6d8cc74bcaf1071d0bbbcb41c4`。保留 #25 已提交的品牌/原生图标与 #26 的任务状态、可读目录和缩放支持，没有复制其他会话的未提交资产；审查基点不变。
- 本轮所有构建目标、配置、数据、资料副本、WebView profile 与截图均在本 worktree。历史 EdgeDriver 仅作为可执行工具只读使用，没有写入共享主目录或其他会话的工作区。
- WebView2 / EdgeDriver：`136.0.3240.76`。入口实际为 `http://tauri.localhost/`，IPC 可用、文档可见；环境和程序哈希见各运行的 environment JSON。

| 程序 | SHA-256 | 本轮用途 |
| --- | --- | --- |
| 修改前 debug 客户端 | `d658807e3aa1faa91b182bd6ecfab414fa1cb4429d9754eb82641d2a2bb019f9` | 同一批关键路径的修改前截图、共享任务状态 RED、候选采用与重启 |
| 首批 UI / AI 修改后的 debug 客户端 | `ff2ea762bf110a0677e59d72fee9656572cfd9632219dd3ae21aa2cd8a6b3fae` | 21 项 UI / AI 正常与故障检查、1280/1600 长内容截图；任务导航缺陷 RED |
| 审查修复后、main 整合前 debug 客户端 | `76cb3b6bce3333347e8782e5d9dd6546e9d642bd2c71c525bf927f2ae300db0c` | 普通/高缩放任务导航、150%/200% 相对 runtime 缩放、长名称与表单操作 |
| 合入 main 品牌图标后的最终 debug 客户端 | `8f0f25a509329bcc0a117d3b83e841bc4cf4b9afe589137714feac59d55ec790` | 核心/AI 正常与异常整轮 22 项通过；200% runtime 比例、头部图标与操作边界、任务导航另 3 项通过 |

本机 loopback HTTP 供应商只在 debug 配置允许，因此上述桌面故障验收使用 debug 程序。本轮未执行优化版桌面验收；类型、构建与测试检查见 [审查记录](issue-26-review.md)。本报告不把 debug 截图当作另一个 exe 的运行证据。

## 实际覆盖

| 路径 | 本轮观察与断言 |
| --- | --- |
| 主图、知识详情与编辑 | 知识搜索、长中文/英文名称、描述阅读、编辑入口、原生新建保存；1280×800、1600×1000 及高比例 runtime 布局无水平页面溢出 |
| 学习笔记导入 | 输入、等待、取消、候选核对、原文依据、采用方式和来源字段仍可用；原生采用后重启，真实知识和描述仍在 |
| 资料库与打开资料 | 通过 UI 保存 Markdown 文件副本并读到正文；仅暂时移走本 run 唯一托管文件时显示明确错误并保留系统应用入口，恢复文件后再次读取成功 |
| 导入记录、删除与设置 | 查看真实采用记录；删除预览仍展示不可撤销和资料保留；数据目录可查阅可读路径；DeepSeek 配置通过真实设置界面保存，密钥框清空 |
| 三类 AI 正常任务 | 自动解析、查找知识、回答问题均返回可用结果；问答来源可跳回已保存知识 |
| 三类 AI 慢响应与取消 | 每处当前任务只有一个等待状态，无字符计数、原始 JSON 或校验日志；实际取消使原生 HTTP 连接结束，输入保留，再次提交成功 |
| 三类 AI 401、429、原生断连 | 每类任务均明确失败并结束 busy；输入保留、操作恢复；修正连接配置后可再次提交成功 |
| 旧答案与任务期间选择 | 再次提交后旧问题及答案在历史中可展开；慢响应、取消、失败不把旧答案放在新问题下。问题框只读，模式与文本读取选择在任务期间冻结 |
| 跨工作面状态 | 整理学习文本时，问答处使用独立任务提示和“查看任务”，不冒充正在执行问答；反向跳转会激活真实 AI 模式 |
| 任务导航与高缩放 | 慢回答→片段搜索→导入→查看任务后，AI 输入与实际取消可见；在 200% 相对 runtime 比例、已选知识详情时同样成立，并释放详情遮挡 |

最终整合程序的常规证据：[22 项检查](issue-26-evidence/integrated-core-checks.json)、[整轮结果](issue-26-evidence/integrated-core-result.json)、[供应商脱敏元数据](issue-26-evidence/integrated-core-provider-metadata.json)。最终窄化证据：[200% 检查](issue-26-evidence/integrated-scale200-checks.json)、[整轮结果](issue-26-evidence/integrated-scale200-result.json)、[高缩放任务导航观察](issue-26-evidence/integrated-scale200-20-task-navigation-zoomed-observation.json)。整合前的 [21 项检查](issue-26-evidence/after-checks.json)与 [150% 检查](issue-26-evidence/scale150-checks.json)继续作为相应程序的历史证据保留。

## 缩放边界

宿主未进行页面放大时，实际 DPR 为 **1.5**。最终补证明确以此为基准：

| 相对比例 | WebView2 runtime DPR | 实际 CSS 视口 | 检查 |
| --- | --- | --- | --- |
| 150% | 2.25 | 1067×667 | main 整合前程序：长名称、正文、编辑/导入/目录与任务导航；标题、正文和表单边界断言 |
| 200% | 3 | 800×500 | main 整合前和最终整合程序均验证：同上，加已选知识后的跨页任务导航与实际取消；最终头部品牌图标没有挡住操作 |

使用 `force-device-scale-factor` 启动真实 WebView2，并对 DPR、相对比例、实际视口、正文/表单/操作边界作观察与断言。每次运行有独立 profile。没有注入 CSS，没有改变 Windows 全局 DPI；**没有声称 WebDriver Ctrl+Plus 已成功触发用户缩放快捷键**。

最初 W3C 快捷键未改变 DPR/innerWidth，运行如实失败；检查发现产品原先未启用 WebView2 zoom hotkeys，最终已启用。最终程序上的 W3C 快捷键仍未触发可观察缩放，因此使用上述原生 runtime 比例补证布局。临时 OS 快捷键探针超时，没有得出缩放结论，也未作为成功证据或交付依赖。

## 修改前后证据

| 操作面 | 修改前 | 修改后 |
| --- | --- | --- |
| 导入输入 | [长说明、默认输入名与字符数](issue-26-evidence/before-02-import-input.png) | [整理学习笔记的输入与主动作](issue-26-evidence/after-02-import-input.png) |
| 另一项 AI 任务 | [整理任务误出现在问答等待处](issue-26-evidence/before-03b-shared-task-state.png) | [简短提示与查看任务入口](issue-26-evidence/after-03b-shared-task-state.png) |
| 候选核对 | [原候选布局与机制说明](issue-26-evidence/before-04-candidates.png) | [保留依据/选择，精简说明](issue-26-evidence/after-04-candidates.png) |
| 资料库 | [保存机制常驻页脚](issue-26-evidence/before-08-library.png) | [资料、关联和操作](issue-26-evidence/after-08-library.png) |
| 知识详情 | [原图谱与详情](issue-26-evidence/before-05-graph-details.png) | [字号层级、操作与阅读](issue-26-evidence/after-05-graph-details.png) |
| 高缩放 | — | [150% 导入](issue-26-evidence/scale150-23-scaled-import.png)、[200% 编辑](issue-26-evidence/scale200-22-scaled-editor.png)、[200% 查看任务](issue-26-evidence/scale200-20-task-navigation-zoomed.png) |
| main 整合后的最终头部 | — | [最终导入](issue-26-evidence/integrated-core-02-import-input.png)、[资料库](issue-26-evidence/integrated-core-08-library.png)、[AI 等待](issue-26-evidence/integrated-core-14-answer-slow.png)、[回答结果](issue-26-evidence/integrated-core-13-ai-answer.png)、[200% 任务导航](issue-26-evidence/integrated-scale200-20-task-navigation-zoomed.png) |

## 最新 main 整合复核

PR 创建时 main 新增了 #28 所整合的 #25 品牌图标与已提交客户端基线，因此先通过上述 merge 保留双方改动，再在同一 worktree 构建和验证最终 exe。未对品牌重新设计，未加入额外视觉打磨。

| 新运行 | 程序 | 结果 | 本轮意义 |
| --- | --- | --- | --- |
| `issue-26-integrated-core-01` | 最终 `8f0f25a5…` | 22 项 PASS，整轮 `passed=true` | 清理后的正式 runner 重新覆盖全部核心、三类 AI 正常/慢/取消/401/429/断连/重试、文件恢复、候选保存重启、1280/1600 长名称与导航操作 |
| `issue-26-integrated-scale200-01` | 同一最终 exe | 3 项 PASS，整轮 `passed=true` | 新头部与图标在实际 DPR3、800×500 视口下可操作；正文/表单边界、普通及已选知识后的任务导航和实际取消均通过 |

两次运行均使用新 config/data/profile，程序哈希一致，见 [核心环境](issue-26-evidence/integrated-core-environment.json)与 [200% 环境](issue-26-evidence/integrated-scale200-environment.json)。历史截图、失败结果与整合前程序的验证边界没有覆盖或改名。

## 真实缺陷与失败记录

1. **共享任务错配已复现并修复。** 修改前慢解析时，问答面板显示“正在整理知识”及原始 detail，并出现问答取消控件。专门断言为 RED；修改后问答面板只显示另一项任务的简短提示与入口。[修改前观察](issue-26-evidence/before-shared-task-reproduction.json)。
2. **查看任务没有切换查找模式已复现并修复。** 慢回答后切到片段搜索，再从导入查看任务，仅切回 `#graph`，问题与取消仍不可见。最终普通窗口及高缩放均可正确跳转并实际取消。[RED 观察](issue-26-evidence/task-navigation-red-task-navigation-observation.json)、[最终 GREEN](issue-26-evidence/scale200-20-task-navigation-zoomed-observation.json)。
3. **验收脚本将只读误当禁用。** `issue-26-after-01` 通过解析/查找故障路径后，对问题框错误断言 `enabled=false`；实际产品有意使用 readonly 保留选择和复制。修正为观察 `readOnly=true` 后，`after-02` 的相关路径通过。[原失败](issue-26-evidence/after-readonly-assertion-failure.json)。
4. **缩放驱动的未完成结果保留。** `after-02` 保留 21 项 PASS，但整个 run 的 `passed=false`，因为最后快捷键缩放断言失败。`final-01` 的普通任务导航已通过，快捷键缩放仍未生效。后续 `scale150-02`、`scale200-01` 独立补齐所需布局/导航边界；未覆盖或改写先前失败。[常规整轮结果](issue-26-evidence/after-result.json)、[最终快捷键探针失败](issue-26-evidence/keyboard-zoom-inconclusive-failure.json)。
5. `scale150-01` 的启动 DPR=1.5 与宿主基准相同，只是基准等效探针，不计为 150% 相对放大。正式 150% 证据为 DPR=2.25 的 `scale150-02`。

上述失败均为当时的诊断运行，旧结果和日志保持原样。`after-01`、`after-02`、`zoom-01` 的产品源码来自 `1ef8f474aad3ed6bb1fd1d148df1c4576ed21a8c`；`final-01` 及两个最终比例补证的产品源码来自 `d288a2a9be3b91f4e5936193ea4496d3ab3d4408`。当时诊断命令分别是默认 `--phase=after`、`--scenario=zoom`、`--scenario=final`，run 名称与对应 result JSON 一致。现行 runner 已删除没有得出成功结论的快捷键诊断分支，默认 before/after 只执行可复用核心与 1280/1600 检查；正式窄入口仅保留 task-navigation 和 scaled。没有为清理脚本再重复桌面验收，清理后 `node --check` 通过。

## 复现与输出

先在本 worktree 构建 debug 客户端，使用与 WebView2 Runtime 匹配的 EdgeDriver。所有业务变更均通过可见 W3C 控件；页面 JavaScript 仅观察。真实 run 原始输出在 `app/validation/issue-26-runs/<run>/`，该目录忽略本地 config/profile/data；源码仅保留 [issue-26-evidence](issue-26-evidence/) 中明确选取的截图和脱敏结果。

最终任务导航和高缩放复现示例，`--driver` 指向本机已有的匹配版本：

```powershell
node app/scripts/ui-refinement-acceptance.mjs --run=issue-26-navigation-recheck --phase=after --scenario=task-navigation --driver=C:/tools/msedgedriver.exe
node app/scripts/ui-refinement-acceptance.mjs --run=issue-26-scale150-recheck --phase=after --scenario=scaled --scale=2.25 --baseline-dpr=1.5 --driver=C:/tools/msedgedriver.exe
node app/scripts/ui-refinement-acceptance.mjs --run=issue-26-scale200-recheck --phase=after --scenario=scaled --scale=3 --baseline-dpr=1.5 --driver=C:/tools/msedgedriver.exe
```

重新运行时应先观察本机基准 DPR，按其 1.5 倍或 2 倍设置 runtime DPR，不能直接假设基准为 1。每个 run 名称必须唯一；已有证据不会覆盖。

本轮未重跑官方模型、所有 PDF/视频编码、全量媒体压力与其他 Windows 机器；本轮文件预览回归是实际 Markdown 副本与缺失恢复。前述通过结果仅适用于表中实际覆盖路径，既有验收文档不替代本轮运行证据。
