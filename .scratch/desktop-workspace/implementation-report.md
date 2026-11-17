# Issue #33 桌面布局实施与验收

实施：2026-11-14；集成验收：2026-11-16。正式规格：[GitHub #33](https://github.com/jking412/Noterion/issues/33)。用户选择 **B：完整导航与浮动面板**。

本轮已完成 B 布局、导入记录界面移除、模型设置文案清理，以及 #32 真实空间/文件夹组件接合。最终集成客户端已通过实际 Windows 空间、批量导入、高缩放、焦点与原生标题栏操作验收。代码保存在本会话分支，尚未推送或合并主分支，#33 保持 open 供集成审阅。

## 来源与隔离

- 专用 worktree：`noterion-issue-33-desktop/knowledgeGraph`；分支 `codex/issue-33-desktop`。
- 固定基点：`a63f1cf18f038a6f53d49062b9dc417cc664dd19`；布局提交 `9dc76b3`、原生回归修复 `a10b912`、空间整合提交 `fcf6bd4`（双父 `a10b912` / `f63048b`）。只合入明确提交，未复制其他会话的未提交代码。
- 三种原型保留在 `codex/issue-33-layout-prototype`，提交 `0782f8aa3effdf5447c1adaa7171ae2db389d2bc`。该原型分支可运行 `cd app; npm run prototype:desktop`，不是生产程序入口。
- 改造前客户端由固定基点经 `git archive` 导出、独立 target 离线构建；未混入未提交源代码。来源与 SHA256 见 [baseline-provenance.json](baseline-provenance.json)。
- 所有运行使用本轮唯一配置目录、数据目录和 WebView profile。合成凭据只用于本机 HTTP/SSE 协议服务，运行结束清理；未改动日常知识或个人密钥。

## 实现结果

左侧导航统一进入知识图谱、资料库、知识导入，底部应用设置容纳模型与数据位置。顶部只保留当前页及相关动作。导航可收起；图谱搜索与详情浮于画布上，在窄画布中切换显示。资料行、候选与模型配置按组件实际可用宽度重排。

已删除 `ImportRecords.vue`、主导航、视图状态及全部用户跳转。旧 `#records` 归一到图谱。采用后直接定位存活知识、进入图谱或继续导入；更新已有知识须在新候选中明确选择更新目标。内部指纹、采用回执、来源及贡献映射继续保留，未删除已存知识、资源或文件。

模型设置保留三种连接类型、必要字段、示例和简短状态/错误；删除提供方说明、地址机制、模型能力说明、隐私长段及任务说明等常驻小字。搜索、知识编辑、资料库、图谱空态和故障态也删除不必要解释。没有把这些内容转移到 Tooltip 或折叠区。

实际检查修正了三项问题：窄窗展开搜索时重新取变化后的状态导致立即收回；下层长标签透过面板干扰阅读；从导入页查看 AI 任务时没有重新展开收起的面板。另为真实渲染边界失败提供始终可达的重新读取动作。

## 原生验证

程序是 Tauri/Rust 嵌入前端的 Windows x64 dev 构建，页面来源 `http://tauri.localhost/`，不是 Vite 网页或 mock IPC。Edge WebDriver `136.0.3240.76` 直接操作可见控件；`execute/sync` 只观察 DOM 和布局。

独立阶段最终程序 SHA256：`43ce81a791c3c893349dd0a0c0ce6fbe3f5453be69a9adba2002bee206ec5b18`。模型完整契约运行的二进制为 `987c5987…`，此后增加图谱故障恢复入口、“查看任务”面板恢复、采用结果自动进入可见区域及简化删除确认文案；相应原生回归通过。

| 检查 | 结果与证据 |
| --- | --- |
| 前端类型与单元检查 | `vue-tsc --noEmit` 通过；Vitest 6 文件、54 测试通过。 |
| Rust / 格式 | 19 个原生模型/协议/凭据测试通过；`cargo fmt --check`、`git diff --check` 通过。 |
| 原生构建 / 品牌 | 离线构建通过；9 个 PE 图标帧逐一与源 ICO 一致。未改品牌图标。 |
| 默认实际 Windows 缩放 | `issue-33-desktop-delivery-02`：最终程序 9 项通过。`captures.json` 实际 DPR=1.5；1280×800 与最小 1000×700 内容尺寸；拖动以节点 transform 实际变化断言。 |
| 较高 WebView2 缩放 | `issue-33-desktop-final-200`：8 项通过，实际 DPR=2。使用启动参数 `force-device-scale-factor=2`，不修改全局 Windows DPI。该批在最后“查看任务”修复前运行，面板与布局相同。 |
| 图谱与知识 | 搜索/定位、缩放、拖动、新建验证、长名称、编辑、自定义 #bd485d、重启保留均通过。Tab 24 次仍处于模态框，Escape 关闭并把焦点交回新建按钮。 |
| 资料 | 空态、添加验证、真实文件副本、Markdown 正文预览及窄窗口行布局通过；关联及重复贡献专项另列下方。 |
| 模型连接 | `issue-33-model-contracts-02` 36 项通过：迁移、三类独立连接、检查中/成功/鉴权失败、凭据替换/移除、地址隔离、旧检查结果失效、原子保存失败回滚、重启和 AI 任务。三种协议均经真实 Rust 请求到本机服务。 |
| 忙碌任务入口回归 | `issue-33-task-return-red` 在旧程序准确失败（展开状态 false 而期望 true）；`issue-33-task-return-green` 3 项通过，可见取消按钮且可取消。原始 JSON 的 `providerTesting` 标签误写成 release 描述，实际为本机 gated 服务；脚本已修正条件，原始证据不覆写。 |
| 图谱失败与恢复 | `issue-33-graph-recovery-01` 通过：调试构建的一次真实渲染异常进入错误界面，点击重新读取恢复。 |
| 导入错误与重试 | `issue-33-faults-final-04`：30 项通过，含鉴权、限流、网络、非法输出、取消/重试、采用、去重及长文本分块。本机协议夹具纠正阶段识别，5 个直接协议检查通过。 |
| 资料与贡献 | `issue-33-resources-final`：7 项通过，含真实副本、源文件删除后预览、默认来源、附加正文解答、删知识保留文件、重复采用不复活、失效回执过滤。 |
| 采用反馈 | `issue-33-adoption-feedback-final`：最终程序 3 项通过；采用/重复结果及两个后续动作无需测试滚动即在视口内。 |
| 独立阶段原生窗口 | WebDriver 的调整大小、最大化、还原、最小化并恢复可见、关闭会话和重启均通过。当时 Computer Use 的状态守卫阻止标题栏操作；2026-11-16 已在最终集成客户端补齐，见下节。 |

完整本机运行目录分别在 `runs/`、`.scratch/model-settings/runs/` 及 `app/validation/runs/`，不提交配置、数据库、浏览器 profile 或凭据。`environment.json` 的旧 `scale=1` 是缺省请求标记，不能当成实际 DPR；布局证据以 `captures.json` 实测值为准。

本轮未使用官方 DeepSeek/OpenAI/Anthropic 付费服务，不能把本机协议成功认定为官方实网验证。没有发布新安装包，也没有替换日常客户端。

## 最终集成验收

最终程序：`app/dist-desktop/noterion.exe`，Windows x64 dev 构建，源提交 `fcf6bd4`，SHA256 `85cd43278bf47b27007e9cb5596e2b8577f22f2eb22d46f997ed3cb0457dece2`。机器可读结果及来源见 [integrated-validation.json](integrated-validation.json)。

| 检查 | 最终结果 |
| --- | --- |
| 类型、单元与格式 | 类型检查、64 项前端测试、30 项 Rust 测试、Rust fmt 与 diff 检查通过；包含空间迁移、旧上下文拒绝、真实扫描取消、模型协议和凭据隔离。 |
| 构建与品牌 | Windows 离线构建通过；9 个 PE 图标帧与源 ICO 一致。 |
| 真实空间 | `issue-33-integrated-spaces-02` 7 组通过：旧库身份/颜色/位置/文件保留；同名知识与资料隔离；应用级模型；空间内 AI；分别采用与去重；忙碌切换取消；重启持久化。69 字名称在最小 1000×700 窗口截断，收起入口仍能打开真实管理弹窗；取消切换保留输入，确认后清空。实际 DPR=1.5。 |
| 真实文件夹 | `issue-33-integrated-folders-01` 3 组通过：3 次真实系统文件夹选择；6 条嵌套及大小写路径完整；3 份采用、3 份单独报错；候选修改后原始来源仍可打开；空目录、取消、重复重试和重启通过。1000×700 下表格边缘在视口内，工作区 scrollWidth=clientWidth=778。 |
| 高缩放与已有能力 | `issue-33-integrated-desktop-200` 9 项通过：实际 WebView DPR=2，图谱搜索/定位/缩放/实际节点拖动、长名称、自定义颜色、重启保留、资料副本/预览、模型三种空配置、最小窗口、Tab 焦点约束与 Escape 返回焦点。使用 WebView2 启动参数，未改全局 Windows DPI。 |
| 原生标题栏 | 在同一最终程序上通过 CUA 实际拖动标题栏；逐个点击最大化、还原、最小化和关闭按钮。最大化/还原以原生按钮状态及可见大小变化确认；最小化后工具明确返回 window is minimized，随后同窗口恢复；关闭后本会话窗口从系统清单消失。窗口调整大小另由真实 WebDriver 操作验证；边框拖动尝试没有足够清晰证据，不单独计通过。 |
| 清理 | 空间和文件夹运行各启动 2 次，进程/合成凭据清理均通过；最终桌面验收窗口已用原生关闭按钮关闭，runner 会话清理完成。 |

`issue-33-integrated-spaces-01` 在中断时窗口消失，4 组通过但整轮不计成功。`issue-33-integrated-full-01` 在首个系统选择器等待超时，6 组通过但整轮不计成功。工具同时返回 15×15 光标图片和完整选择器图片，后续使用对应完整截图 ID 完成原生点击；没有给产品加入测试后门或假列表。最终结果按空间 7 组、文件夹 3 组分别报告。

独立增量视觉审查实际查看 23 张空间、文件夹、设置及失败代表截图，无 P1–P3 界面问题；根会话另实际检查取消、重复重试及原生窗口行为。所有 UI 派发均重申 Product UI 规则。

## 前后预览

截图为真实客户端的 WebView 内容区域，原生标题栏不包含在 WebDriver PNG 中。测试数据包含刻意的超长知识名；AI 场景原文中的夹具字样属于输入内容，不是产品固定文案。

| 页面/状态 | 截图 |
| --- | --- |
| 改造前图谱 | [before-graph.png](screenshots/before-graph.png) |
| 改造后图谱、长名称 | [after-graph.png](screenshots/after-graph.png) |
| 改造前模型设置 | [before-models.png](screenshots/before-models.png) |
| 清理后的模型设置 | [after-models.png](screenshots/after-models.png) |
| 资料库 / 导入 | [after-resources.png](screenshots/after-resources.png)、[after-import.png](screenshots/after-import.png) |
| 最小窗口 / 200% | [minimum-details.png](screenshots/minimum-details.png)、[models-200-percent.png](screenshots/models-200-percent.png) |
| 鉴权失败 / 忙碌任务 / 图谱失败 | [model-auth-failure.png](screenshots/model-auth-failure.png)、[returned-busy-task.png](screenshots/returned-busy-task.png)、[graph-failure.png](screenshots/graph-failure.png) |
| 删除确认 / 导入采用 / 重复结果 | [delete-confirmation.png](screenshots/delete-confirmation.png)、[import-success.png](screenshots/import-success.png)、[import-duplicate.png](screenshots/import-duplicate.png) |
| 最终集成图谱 / 长空间名 | [integrated-graph.png](screenshots/integrated-graph.png)、[integrated-long-space.png](screenshots/integrated-long-space.png) |
| 收起后的空间管理 / 放弃确认 | [integrated-space-dialog.png](screenshots/integrated-space-dialog.png)、[integrated-switch-confirm.png](screenshots/integrated-switch-confirm.png) |
| 集成文件夹最小窗口 / 逐文件结果 | [integrated-folder-minimum.png](screenshots/integrated-folder-minimum.png)、[integrated-folder-results.png](screenshots/integrated-folder-results.png) |
| 空目录 / 取消 / 重试 / 200% 设置 | [integrated-folder-empty.png](screenshots/integrated-folder-empty.png)、[integrated-folder-cancelled.png](screenshots/integrated-folder-cancelled.png)、[integrated-folder-retry.png](screenshots/integrated-folder-retry.png)、[integrated-models-200.png](screenshots/integrated-models-200.png) |

独立终审实际查看了 23 张默认、空白、忙碌、成功、失败及相关弹窗截图；没有发现必须再修的视觉问题，长标签已不透入面板。截图本身不证明点击、键盘或官方实网，相关结论只取自实际运行结果。

## Standards

固定基点到 `9dc76b3` 的独立 Standards 审查：0 项明确仓库规范违反；1 项 P3 结构建议，即三个原生验收脚本的 W3C 辅助代码重复。它是维护性判断，保留为后续整理项，本次不扩展公共测试框架重构。

集成相对双父 `a10b912` / `f63048b` 再次独立审查：0 项硬性规范违反；1 项 P3 接合文档过时已修正为实际组件 API、顶层弹窗与真实验收结果。

## Spec

独立 Spec 审查发现 1 项 P2：“查看任务”未展开已收起的搜索面板。已修复，原生 red/green 回归及审查者增量复核通过。集成相对双父的独立复核未发现新增 P1–P3 回归；真实空间/文件夹接合现已通过上述最终客户端验收。

## 交付状态

- [integration-contract.md](integration-contract.md) 已更新为实际已接合契约，真实空间及文件夹导入验收完成。
- 本会话分支完成实现、必要回归及双轴审查；本地 dev 客户端可供审阅。尚未推送、合并主分支、触发远程 CI 或发布安装包。
- #33 保持 open 供代码集成审阅；本地实现验收完成不等于已经发布。
