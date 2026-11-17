# Worktree integration — 2026-11-17

用户要求将各 worktree 的有效修改整合到 main。原主目录为 `D:/person/application/knowledgeGraph`；本次通过应用创建专用 worktree `C:/Users/skynesser/.codex/worktrees/noterion-consolidate-20261117/knowledgeGraph`，分支为 `codex/consolidate-worktrees-20261117`。固定基点为 `a63f1cf18f038a6f53d49062b9dc417cc664dd19`。

## 合并范围

| Worktree（C 盘均在 `.codex/worktrees/` 下） | 分支或 HEAD | 处理 |
| --- | --- | --- |
| `D:/person/application/knowledgeGraph` | main / a63f1cf | 原主目录；保留未跟踪文件，集成验证完成后快进 |
| `0597/knowledgeGraph` | issue-27 / cb71e76 | 已在基点内 |
| `13f0/knowledgeGraph` | issue-26 / 6da51fc | 已在基点内 |
| `74dc/knowledgeGraph` | issue-32 / f63048b | 经 #33 分支带入多空间与文件夹导入 |
| `8393/knowledgeGraph` | issue-23 / 5d18249 | 已在基点内 |
| `bbe5/knowledgeGraph` | detached / a63f1cf | 无独立修改 |
| `c71e/knowledgeGraph` | detached / a63f1cf | 无独立修改 |
| `ea7e/knowledgeGraph` | issue-25 / 89afac4 | 已在基点内 |
| `eaeb/knowledgeGraph` | issue-31 / 275e786 | 已在基点内，模型设置及协议能力保留 |
| `noterion-acceptance/knowledgeGraph` | detached / 5fcc14e | 历史 #21 分支，核对当前实现；不以旧验收覆盖本轮结果 |
| `noterion-desktop-ui/knowledgeGraph` | detached / b18b9aa | 历史 #21 分支；有效本地客户端决策补录为 ADR，过时文档保留原处 |
| `noterion-final-integration/knowledgeGraph` | integrate-client-delivery / a63f1cf | 已在基点内 |
| `noterion-issue-33-desktop/knowledgeGraph` | issue-33 / 31d99d1 | 合并桌面布局、移除记录页及其已经整合的 #32 |
| `noterion-issue-34-recovery/knowledgeGraph` | issue-34 / df4dce9 | 合并真实来源恢复、分段重试与原文身份保护 |
| `noterion-local-store/knowledgeGraph` | detached / c435999 | 历史 #21 分支，核对当前实现；不回退当前存储模型 |
| `noterion-consolidate-20261117/knowledgeGraph` | consolidate-worktrees-20261117 | 本次专用集成区 |

生产代码合并提交为 `b0b557b`（#32/#33）和 `a69035f`（#34 与冲突解决）。[PR #35](https://github.com/jking412/Noterion/pull/35) 跟踪本次整合。

没有把试验布局分支 `codex/issue-33-layout-prototype`、历史核心 UI 原型、node_modules、旧打包文件、浏览器 profile、旧诊断运行或过时的 PG/Neo4j/模板方案混入当前产品。原工作区的未提交和未跟踪内容未删除、覆盖或重置。有效的本地客户端与 AI Native 决策补录在 ADR 0005/0006，ADR 0002/0003 标明被取代。

历史 detached 分支另外做了补丁核对，而非仅按时间排除：`git cherry -v a69035f c435999` 的 4 条提交与 `git cherry -v a69035f 5fcc14e` 的 21 条提交全部为补丁等价的 `-`。例如事务存储 `007e836→b0ee3b2`、安全 revision `df480f4→54582d3`、PDF `358b80a→85fda5f`、WebM `3fbdd15→4f507ba`、删除知识后保留图片 `5fcc14e→905ade0`。桌面旧分支的 9 条实现逐对 range-diff：7 条完全等价，另外 2 条仅离线验收文档上下文不同；合并提交 b18b9aa 没有独有的产品代码。原生存储接入 `8e78f73→168ca4c`、失败状态 `1dba33a→ac8c234`、串行拖动 `dd4dcc1→f5df626` 等均在当前实现内。未发现需要再带入的有效代码。

## 冲突解决

- 保留 #32 的 `space_id + epoch` 检查、文件夹逐文件处理和切换失效边界，同时采用 #34 的来源修复和完整分段缓存。
- 缓存键显式包含空间身份；切换上下文清空缓存。候选校验再次检查当前空间，避免恢复结果跨上下文使用。
- 保留 #33 的桌面导入页及采用结果卡片；加入原文修改后的粘性失效保护。用户修改原文后即使再改回去，也须重新整理。
- 更新恢复验收脚本的可见导航、成功卡片和数据目录入口；没有向正式产品加入测试入口或恢复已移除的导入记录页。
- 发布 smoke 的旧根地址相等判断不兼容新布局的 `#graph`，改为核对嵌入页面的 origin/path，继续检查真实 IPC、可见窗口和嵌入资源；语法检查通过，完整发布 smoke 由 CI 执行。
- 新增集成回归：部分分段失败后切换空间，新空间重新解析全部原文，旧任务失效，采用只写入新空间。

## 实际检查

- `npm ci`、前端 typecheck、production build 通过；Vitest 8 个文件共 66 项通过。
- 发布资产契约 4 项通过；Rust fmt、45 项 Rust 测试、all-targets clippy `-D warnings` 通过。
- 初次受限进程不允许本机 HTTP/Windows 凭据操作，未将其失败运行计为通过；允许这些测试所需操作后完整复验 45 项通过。
- debug 和 optimized Windows 客户端均构建成功；两者的 9 个 PE 图标帧均与品牌 ICO 逐帧一致。
- debug exe SHA-256：`2917b4846846803206d3fb9bb2459fb7fd6541e1e5573671624a802d038aafcc`。
- optimized exe SHA-256：`3427fd9ad086a2e6415f4ef505c70c63803452a49173399dc0e8ddb5775281be`。
- 真实 Windows 来源恢复验收 `issue-34-integration-20261117-01`：20 项检查通过，42 次本机 HTTP/SSE 请求，三种协议、两次启动，进程与隔离凭据均清理。默认、候选、保存成功、编辑失效、失败、加载、取消和目录弹窗截图已实际查看，未发现本轮禁用的产品文案。
- 多空间与文件夹 `issue-33-integration-full-20261117-01`：9 项检查全部通过、2 次启动、14 次本机请求、0 协议违例，包含迁移、同名知识隔离、颜色、资料原文、跨空间重复输入、慢任务取消、6 份递归目标文件的逐文件结果、空目录与重试。3 次原生目录选择均通过真实 Windows 选择器完成；进程和隔离凭据清理成功。
- 桌面布局 `issue-33-integration-layout-20261117-01`：9 项全部通过，包含原生最大化/最小化/恢复、键盘、图谱缩放和拖动、搜索、知识颜色、资料预览、最小窗口与重启持久化。两轮共生成 58 张原图，审查者实际查看其中 16 张代表图，无阻止集成的问题。检查完成后的原生窗口核对被用户 Escape 停止，没有继续接管本机界面；两脚本此前已正常结束且进程清理完成。
- 优化程序已本地构建并核对图标和 SHA；本轮没有在本机额外执行该 optimized 文件的桌面 smoke。PR/main 的 CI 将执行其独立打包、校验和 packaged-client smoke，结果以 GitHub Actions 对应提交为准，不把 debug 验收混称为 optimized 产物验收。

以上模型协议验收使用确定性本机服务；没有调用 DeepSeek/OpenAI/Anthropic 官方付费 API，不将模拟服务结果描述为官方实网通过。

## Standards

独立只读审查 `a63f1cf...a69035f`：未发现硬性仓库规范违反，也没有足以要求本轮重构的 smell。已核对 Product UI 规则与空间写入边界；不将传递上下文字段本身认定为结构缺陷。

## Spec

独立只读核对 #32/#33/#34：未发现新增 P1–P3 问题。空间隔离、迁移、逐文件结果、左侧布局、移除记录入口和有界来源修复均有实现；真实客户端验收另按上节记录。

两轴审查结果分别为 Standards 0 项、Spec 0 项；代码审查不代替实际界面验收。
