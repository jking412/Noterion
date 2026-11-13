# Issue #26 双向审查

日期：2026-11-13（Asia/Shanghai）。规格为 [GitHub Issue #26](https://github.com/jking412/Noterion/issues/26)。Standards 与 Spec 由两个独立代理并行审查，不合并两轴的判断。

固定基点：`647c20566550a86056b0e6b2def81ef36e71d4fe`。该提交先整合了本地已交付的 #22 `f72bbf8` 与远端 #23/#24 基线，没有复制其他会话的未提交内容。

```powershell
git diff 647c20566550a86056b0e6b2def81ef36e71d4fe...HEAD
git log 647c20566550a86056b0e6b2def81ef36e71d4fe..HEAD --oneline
```

产品提交：

- `1ef8f47`：清理客户端文案、信息层级与 AI 反馈，修复旧取消错误污染新任务的竞态，新增公共状态回归与真实桌面验收入口。
- `d288a2a`：按真实复现修正“查看任务”跳转，启用 WebView2 原生缩放控制，并删除无消费者的旧进度状态。
- `bbccbb6`：发布 PR 时，远端 main 已前进至 `6f44e44`（#28 合并 #25）。通过明确提交整合该基线，解决原生图标/缩放和品牌图标/目录入口两处冲突，保留双方行为。历史审查基点继续固定为 `647c205`；相对最新 `origin/main` 的产品差异仍仅属于 #26。

## Standards

规则来源：`AGENTS.md`、`docs/agents/`、`CONTEXT.md`、相关 ADR，以及 code-review 技能的 Fowler smell baseline。未重复报告类型、格式与补丁工具已覆盖的事项。

初审发现 **P3 Possible Speculative Generality**：`useAiTasks()` 保留了永久为空的 `detail` / `partial`，仅测试还依赖这两个接口。已删除字段、清空语句和返回值；测试改为检查真实的等待、结果与错误行为。

对 `d288a2a` 的独立复核结论：原 P3 已关闭。`v-model:ai-mode` 保持单一状态来源，`showKnowledgeTask()` 明确激活 AI 面板并收起详情。未发现新增标准违例或需要修正的 smell。

**最终 Standards：0 项明确违例，0 项未解决判断性建议。**

对晚到的 main 兼容合并 `bbccbb6` 再次独立复核：原生图标与缩放并存，#25 品牌图标和 #26 目录入口均保留，未发现新增违例。#25 的资产与 README 来自已提交的 main，不是本任务重新制作。

## Spec

初审发现 **P2：“查看任务”不保证显示任务**。规格要求“提供实际可用的取消”及“按钮禁用/恢复与当前任务一致”。慢问答运行时切换到“片段搜索”，再从知识导入点击“查看任务”，旧实现只导航回图谱，问题与取消仍隐藏。

真实桌面红色复现见 [观察结果](issue-26-evidence/task-navigation-red-task-navigation-observation.json)：`hash=#graph`，但 `questionVisible=false`、`cancelVisible=false`，详情并未打开，排除了仅由详情遮挡的解释。该路径也排除了导航未执行的假设，原因是搜索模式仍保留为片段搜索。

修复让动作明确打开 AI 模式、收起详情并导航；同一真实路径已在最终客户端转绿，窄窗口和高缩放的补充结果见 [桌面验收](issue-26-acceptance.md)。

其余要求已核对：移除常驻路径、字符统计、保存机制说明、重复发送说明与接收计数；保留来源核对、资料选择、删除后果、目录管理和错误恢复；未更换品牌、导航结构或知识领域模型。

独立复核已核对最终 `scale150-02`、`scale200-01` 的真实客户端结果：200% 时 `questionVisible=true`、`cancelVisible=true`、`detailsVisible=false`，且取消确实中止 HTTP。基准 DPR 为 1.5，运行时 DPR 2.25 / 3 分别对应相对 150% / 200%；视口分别为 1067×667 / 800×500。W3C 快捷键未实际触发缩放的失败没有计入这些通过结果。

**最终 Spec：0 项未解决发现；原 P2 已修复并复核。**

Spec 另行复核 `bbccbb6`：任务导航、单一等待和实际取消逻辑没有在合并中丢失，未覆盖或重制 #25 资产。

合并后的最终程序 SHA-256 为 `8f0f25a509329bcc0a117d3b83e841bc4cf4b9afe589137714feac59d55ec790`。真实桌面重新执行常规核心整轮 **22 项通过**，另执行 200% 的任务导航与布局 **3 项通过**，两次运行均 `passed=true`。定向查看合并后普通与 200% 的标题栏/导航，未发现图标新增造成的遮挡。此前失败与整合前证据仍保留，结果按各自程序哈希区分。

## 机械检查的窄化说明

按 impeccable 的要求只运行了一次设计检测，结果保存在 [扫描结果](issue-26-design-scan.json)。唯一 warning 将既有 SVG `stroke-width` 的过渡识别成布局 `width` 动画；它只改变 SVG 描边，不改变盒布局，本次保留原有节点交互。扫描不代替真实界面视检。

## 验证边界

完整前端测试 4 个文件、40 条通过；既有发布脚本 4 条通过；类型检查、Vite/Tauri 原生构建、Rust 格式和补丁检查通过。公共状态测试使用受控系统边界安排竞态，不作为真实 IPC 或官方模型验证。桌面验收实际使用 Windows Tauri、WebView2、原生 Rust 存储和 HTTP/SSE 供应商夹具；本轮未调用官方 DeepSeek，未声称已验证其他 Windows 机器或所有系统 DPI 配置。

主实施代理完成了一次修改后的批量视检，覆盖导入输入、候选、资料库、AI 慢响应，以及最终 200% 的编辑、目录和任务导航。未发现需要继续打磨的实际缺陷，本轮停止视觉修改。
