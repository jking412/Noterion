# #32 实施与验证记录

正式需求：[Issue #32](https://github.com/jking412/Noterion/issues/32)。界面协作：[Issue #33](https://github.com/jking412/Noterion/issues/33)。

固定审查基点：`a63f1cf18f038a6f53d49062b9dc417cc664dd19`。

工作区：`C:/Users/skynesser/.codex/worktrees/74dc/knowledgeGraph`。
分支：`codex/issue-32-spaces-batch-import`。

## 模块接口

- 存储快照提供 `spaceId`、`epoch` 和 `spaces: {id,name}[]`。`space_create(name)`、`space_switch(id)` 和 `space_rename(id,name)` 返回完整快照。新建空间同时成为当前空间。改名不改变空间身份。
- `SpaceSwitcher.vue` 提供空间选择、新建和重命名。App 负责切换前处理未保存编辑、导入候选及运行中任务；`useNoterion` 管理正式快照和搜索/选择状态。#33 可以将该组件移入最终侧栏。
- 所有正式操作携带调用时的 `spaceId + epoch`。`desktop.invoke` 统一提供当前上下文；批次读取还显式绑定批次创建时的上下文。Rust 再验证空间和版本，不能依赖界面清理单独保证隔离。
- `folder_scan(path,requestId,spaceId,epoch)` 返回扫描身份、相对路径清单与逐路径警告；递归 md/txt，不跟随链接及 Windows 重解析路径。`folder_cancel_scan(requestId,spaceId,epoch)` 只取消对应请求，迟到取消不会影响新扫描。
- `folder_read(scanId,fileId,spaceId,epoch)` 只读取清单中可信文件，单文件上限沿用 256 KiB，编码或大小问题逐文件报错。
- `folder_prepare` 在用户明确开始逐文件解析时保存来源资料副本，并返回文本、相对路径、资料身份和新快照。资料身份包含空间、相对路径与内容摘要，重试和重新扫描可复用同一份来源。解析沿用 AI Native，不拼接整个目录。
- ImportWorkspace 按文件发起解析，等待用户核对/修正并采用或跳过，再推进下一文件；结果清单属于当前批次，不作为长期导入历史页。
- 模型配置与凭据保持应用级设置；知识候选、AI 会话、检索、资料与正式采用限定当前空间。

## 验证范围

按用户任务约束，测试放在实际存储/迁移接口、任务交互与切换隔离接口、真实 Windows 桌面操作接口。CI 不需要付费模型密钥。真实服务与本地模拟服务的验证结果在本文件记录，不进入产品界面。

## 结果

2026-11-14 已完成实现与以下检查。没有访问用户正式资料，所有桌面运行使用独立配置、合成旧数据库、合成 Windows 凭据及本地 HTTP/SSE 模型夹具。

| 检查 | 结果 |
| --- | --- |
| `npm run build`（含 vue-tsc） | 通过 |
| `npm test` | 64 项通过 |
| `cargo fmt --all -- --check` | 通过 |
| `cargo clippy --locked --offline --all-targets --manifest-path app/src-tauri/Cargo.toml -- -D warnings` | 通过 |
| `cargo test --locked --offline --manifest-path app/src-tauri/Cargo.toml` | 30 项通过 |
| `node --test app/scripts/release.node-test.mjs` | 4 项通过 |
| Windows 桌面空间与文件夹完整验收 `issue-32-full-05` | 8 组通过，重启 2 次，进程与模拟凭据清理通过 |
| Windows 模型设置及原生协议回归 `issue-31-issue32-regression-01` | 33 组通过，重启 3 次，进程与模拟凭据清理通过 |
| 最终文案桌面复查 `issue-32-final-spaces` | 6 组通过；实际核对 `06b-duplicate-preview.png` 无多余机制说明 |

存储回归覆盖旧 v1/v2 迁移、原始身份/颜色/关系/位置/资料内容保留，以及部分升级 DDL 失败后数据库字节完全不变；空间内幂等、空间间独立采用；A→B→A 后拒绝旧上下文；移动旧数据目录后恢复。扫描回归覆盖真实遍历线程取消、迟到取消不影响新扫描、读取失败修复重试、编码和超限不截断。

真实桌面验收建立至少两个有同名知识、不同颜色和资料的空间，实际搜索、打开资料、AI 检索与问答，验证模型设置共用、各空间上下文独立和运行中切换清空。原生选择递归样例目录，核对全部 6 条路径：3 个有效文件逐份解析、核对、采用；首份候选经人工编辑后在详情中确认，来源正文实际打开并保持原文。编码错误、空文件、超限分别显示具体原因；空目录、取消后可重试、已采用文件重复识别，以及重启后旧默认空间和各新空间的数据均通过。

`runs/issue-32-full-05/result.json` 与 `checks.json` 是完整文件夹运行结果，截图包括 `10-folder-inventory`、`11-folder-review-edited`、`11b-folder-edited-details`、`11c-folder-original-source`、`12-folder-results`、`13-folder-empty`、`14-folder-cancelled`、`15-folder-retry`、`16-restarted-space-a` 和 `17-restarted-legacy`。完整运行客户端 SHA-256 为 `26d469297d67252649a4900a901df75ca3809f4a793f7646dd036e2a4983782a`；后续仅删除重复输入状态中的多余机制文案，最终构建 SHA-256 为 `2b0e5fa3fde5f82ac014244a5806b00325b1095bacd039e13065084c80ef673d`，已在 `issue-32-final-spaces` 定向界面复查并通过。

先前运行如实保留：`full-01` 在人工选择等待期超时；`full-02` 按用户当时要求中止并已清理；`full-03/04` 因验收脚本滚动定位失败退出，后续改用实际容器边界与标准 WebDriver 滚轮完成 `full-05`。没有把这些运行计作通过。

界面已实际核对新建空间弹窗、默认输入、AI 加载、文件清单、候选核对、成功、逐文件失败、空目录、取消和重复状态。重复状态发现的多余机制说明已移除。双轴复核发现及修复见 `review.md`。

CI 已增加不需要付费密钥的真实 Windows `spaces` 场景，并收集检查结果、协议摘要及截图；本会话未触发远程 CI，也未调用官方付费模型服务。当前 #32 不依赖 #33 的布局定版；#33 可按 `app/CONTRACT.md` 接入真实组件并移除用户可见导入记录，内部回执继续保留。
