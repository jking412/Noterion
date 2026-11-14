# Issue #34 Windows 客户端回归入口

`app/scripts/import-recovery-acceptance.mjs` 通过匹配 WebView2 的 Microsoft EdgeDriver 操作真实 Tauri 窗口。业务写入只经可见控件；`execute/sync` 只读取 DOM。`app/scripts/import-recovery-fixture.mjs` 在本机 loopback 返回确定性 Chat Completions / Messages SSE，三种连接使用不同合成密钥，不调用官方或付费 API，也不记录请求头、密钥或提示正文。

## 执行

先在本专用 worktree 中使用 PowerShell 7 构建 debug exe（release 禁止 HTTP 夹具）：

```powershell
& ./app/build.ps1 -Offline
& ./app/scripts/setup-webdriver.ps1 -Destination .scratch/import-recovery/.tools/webdriver
node app/scripts/import-recovery-acceptance.mjs --run=issue-34-recovery-001
```

每轮 `--run` 必须唯一，脚本以 create-new 目录避免覆盖旧证据。可用 `--exe=绝对路径`、`--driver=绝对路径` 明确指定产物，默认产物是本 worktree 的 `app/src-tauri/target/x86_64-pc-windows-msvc/debug/noterion.exe`。Windows 桌面与 loopback 连接必须可用。

原文修改后恢复相同文本仍不得启用旧草案，可单独验证：

```powershell
node app/scripts/import-recovery-acceptance.mjs --run=issue-34-source-invalidation-001 --scenario=source-invalidation
```

仅补充采用后的成功卡片可见证据：

```powershell
node app/scripts/import-recovery-acceptance.mjs --run=issue-34-saved-card-001 --scenario=success-capture
```

此场景经原生 WebDriver 滚轮把工作区滚回保存卡片所在位置，再读取其视口位置并截图；不使用 JavaScript 改滚动位置或业务状态。

## 场景

- 三类连接分别返回同一批中的缺失依据、9 条重复依据以及空白格式差异引文，验证针对性来源修复、候选数量、每条可见引文属于真实输入、显式采用、关联资料。
- 多分段输入恢复后保留全部候选；采用后重启读取知识和关联资料。
- 原文修改后再恢复相同文本，旧草案继续不可采用。
- 无法恢复来源时调用有界、输入保留且可重试；鉴权错误只有一次请求。
- 慢 SSE 中取消真实原生连接、输入保留，随后同一文本可重试。
- 结构修正和来源修复具有不同请求目的。
- 慢响应期间通过真实数据目录弹窗切换本轮空目录，原生请求中断、候选清空；切回原目录也没有旧采用入口，已保存的知识与资料关联仍可读。
- 采集默认空白、预览、保存成功、重启、原文修改、失败、加载、取消截图；检查导入界面无内部字段/校验/开发验收信息。

## 隔离与证据

每轮 `.scratch/import-recovery/runs/<run>/` 含独立 `config/data`、WebView profile、截图、`checks.json`、`fixture-requests.json` 和 `result.json`。配置/数据目录来自 `NOTERION_CONFIG_DIR`，不会读取用户正式库。脚本结束只删除由本轮配置绝对路径和本轮服务地址计算的精确合成凭据目标，不枚举其他凭据。运行目录和下载工具被忽略，不提交数据库、profile 或合成凭据 helper。

结果须同时满足 `passed=true`、`desktopCleanup=true`、`credentialCleanup=true`。`result.json` 保存实际 exe 和 driver 的 SHA-256。夹具结果仅证明客户端恢复与协议契约；三家官方服务实网覆盖分别记录为 false，不冒充实网模型成功。正式通过状态以具体运行证据和最终报告为准。

## 2026-11-14 实际执行结果

- 基线 `issue-34-baseline-recovery-red-02`：真实客户端两次收到合成异常输出，显示用户同句错误“AI 返回结果未通过校验：AI 候选缺少可核对的原文依据。 本次未采用任何知识。”。基线 `issue-34-baseline-source-red-03`：原文修改后再还原，旧采用按钮错误地重新启用。脱敏结果及截图保留在 `evidence/baseline-*`。
- 修复后 `issue-34-recovery-green-003`：Exit 0，14 项检查全部通过；27 次本机协议请求、0 协议违例、2 次真实客户端启动；三种连接分别以 2 次请求完成缺失来源的程序片段 ID 修复、9 条来源保留与空白格式恢复，再进入 3 个候选并明确采用。长文 2 段完整得到 6 个候选。结构错误修正后缺失来源仍能独立修复，总计恰好 3 次请求。其余失败、鉴权、取消、重试、重启、原文修改还原和目录隔离检查通过。正式结果副本为 `evidence/desktop-green-{result,checks,requests}.json`。
- 补充 `issue-34-saved-card-green-001`：Exit 0，1 项检查通过，2 次本机请求；显式采用后原生滚轮滚动至“知识已保存到本机”卡片，确认卡片位于视口并截图为 `evidence/desktop-saved-card.png`，结果为 `evidence/desktop-saved-card-{result,checks}.json`。
- 两个绿色运行均使用 exe SHA-256 `1c56aa26c4ee43355c3275ba95b7af0e46113def5007f0490dd6835779d682d3`，EdgeDriver SHA-256 `76f549b492a89dbacee027ac6a726836944f04645ecaa5fa9a2045c84303d6ed`；两轮 `desktopCleanup=true`、`credentialCleanup=true`。
- 已实际查看默认空白、候选预览、保存成功卡片、重启、修改原文、无法恢复、加载、取消以及数据目录弹窗和切换后页面截图。导入流程未显示 JSON、evidence、UTF-16、内部校验日志或开发验收文案；仅保留简短真实状态、错误、字段、操作与可核对引文。
- `green-001`、`green-002` 是夹具问题：只检查末条消息，未计入协议适配器追加的 JSON-only 提醒，因此误把来源修复当作结构重出。夹具现按真实 Chat 消息和 Messages 文本块分别识别来源修复对象。产品代码和通过条件未为此放宽，临时错误分类探针已移除。
- DeepSeek、OpenAI 兼容、Anthropic 兼容的以上结果均来自确定性本机 HTTP/SSE 夹具；三家官方服务实网调用均未执行。
