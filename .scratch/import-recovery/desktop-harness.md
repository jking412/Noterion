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
- 三种连接各自验证合法部分候选附带非空 `warnings`：先不显示部分预览或采用入口，完整原文最多重提一次；恢复后保留 Docker、进入容器终端及 Linux 全部候选再显式采用。持续声明未完成则简短失败、输入保留且没有候选/采用入口；同输入重试必须重新请求，不复用为完整缓存。
- 慢响应期间通过真实数据目录弹窗切换本轮空目录，原生请求中断、候选清空；切回原目录也没有旧采用入口，已保存的知识与资料关联仍可读。
- 采集默认空白、预览、保存成功、重启、原文修改、失败、加载、取消截图；检查导入界面无内部字段/校验/开发验收信息。

## 隔离与证据

每轮 `.scratch/import-recovery/runs/<run>/` 含独立 `config/data`、WebView profile、截图、`checks.json`、`fixture-requests.json` 和 `result.json`。配置/数据目录来自 `NOTERION_CONFIG_DIR`，不会读取用户正式库。脚本结束只删除由本轮配置绝对路径和本轮服务地址计算的精确合成凭据目标，不枚举其他凭据。运行目录和下载工具被忽略，不提交数据库、profile 或合成凭据 helper。

结果须同时满足 `passed=true`、`desktopCleanup=true`、`credentialCleanup=true`。`result.json` 保存实际 exe 和 driver 的 SHA-256。夹具结果仅证明客户端恢复与协议契约；三家官方服务实网覆盖分别记录为 false，不冒充实网模型成功。正式通过状态以具体运行证据和最终报告为准。

## 2026-11-14 实际执行结果

以下绿色运行属于旧产物的历史证据。当前最终代码的验收以文末“最终产物复验”中的新运行与新 SHA-256 为准；保留原始记录，不把旧运行视作新产物的结果。

- 基线 `issue-34-baseline-recovery-red-02`：真实客户端两次收到合成异常输出，显示用户同句错误“AI 返回结果未通过校验：AI 候选缺少可核对的原文依据。 本次未采用任何知识。”。基线 `issue-34-baseline-source-red-03`：原文修改后再还原，旧采用按钮错误地重新启用。脱敏结果及截图保留在 `evidence/baseline-*`。
- 修复后 `issue-34-recovery-green-003`：Exit 0，14 项检查全部通过；27 次本机协议请求、0 协议违例、2 次真实客户端启动；三种连接分别以 2 次请求完成缺失来源的程序片段 ID 修复、9 条来源保留与空白格式恢复，再进入 3 个候选并明确采用。长文 2 段完整得到 6 个候选。结构错误修正后缺失来源仍能独立修复，总计恰好 3 次请求。其余失败、鉴权、取消、重试、重启、原文修改还原和目录隔离检查通过。正式结果副本为 `evidence/desktop-green-{result,checks,requests}.json`。
- 补充 `issue-34-saved-card-green-001`：Exit 0，1 项检查通过，2 次本机请求；显式采用后原生滚轮滚动至“知识已保存到本机”卡片，确认卡片位于视口并截图为 `evidence/desktop-saved-card.png`，结果为 `evidence/desktop-saved-card-{result,checks}.json`。
- 两个绿色运行均使用 exe SHA-256 `1c56aa26c4ee43355c3275ba95b7af0e46113def5007f0490dd6835779d682d3`，EdgeDriver SHA-256 `76f549b492a89dbacee027ac6a726836944f04645ecaa5fa9a2045c84303d6ed`；两轮 `desktopCleanup=true`、`credentialCleanup=true`。
- 已实际查看默认空白、候选预览、保存成功卡片、重启、修改原文、无法恢复、加载、取消以及数据目录弹窗和切换后页面截图。导入流程未显示 JSON、evidence、UTF-16、内部校验日志或开发验收文案；仅保留简短真实状态、错误、字段、操作与可核对引文。
- `green-001`、`green-002` 是夹具问题：只检查末条消息，未计入协议适配器追加的 JSON-only 提醒，因此误把来源修复当作结构重出。夹具现按真实 Chat 消息和 Messages 文本块分别识别来源修复对象。产品代码和通过条件未为此放宽，临时错误分类探针已移除。
- DeepSeek、OpenAI 兼容、Anthropic 兼容的以上结果均来自确定性本机 HTTP/SSE 夹具；三家官方服务实网调用均未执行。

## 2026-11-14 最终产物复验（含未完成声明）

- 最终 exe SHA-256 为 `42df96febfbc67e421dda2321797fb78a73b7637bf7655f10733dbbbadba6a8b`；EdgeDriver SHA-256 为 `76f549b492a89dbacee027ac6a726836944f04645ecaa5fa9a2045c84303d6ed`。本轮结果取代旧 SHA `1c56aa26…682d3` 对最终代码的验收，`green-003` 与旧成功卡片运行只保留为历史。
- `issue-34-recovery-final-001`：Exit 0、`passed=true`、20 项检查全部通过、42 次本机协议请求、0 协议违例、2 次真实客户端启动；`desktopCleanup=true`、`credentialCleanup=true`。完整结果、检查和脱敏请求为 `evidence/desktop-final-{result,checks,requests}.json`。
- 新增的 6 项检查覆盖三种连接各自的可恢复和持续未完成声明。首次只返回 Linux 合法候选并声明 Docker 未处理；第二次响应由夹具等待门暂停，真实桌面仍显示简短加载状态，候选和采用入口均不存在。放行后可恢复场景恰好 2 次请求得到全部 3 个候选、逐条真实引文并显式采用。持续声明场景恰好 2 次请求后简短失败，输入完整保留，无预览/采用；同输入重新整理真实新增 1 次请求并得到 3 个候选。
- 等待门只控制本机模拟服务响应，不调用产品内部命令或修改页面状态。元数据仅记录 `warningAttempt`、`warningResponse`、`fullInputRetry`、`returnedCandidates` 等脱敏事实，不保存请求提示正文或鉴权头。两脚本语法检查通过；三协议乘两种模式的本机 HTTP/SSE 夹具自检共 6 项通过。
- `issue-34-saved-card-final-001`：Exit 0、`passed=true`、1 项检查通过、2 次本机请求、1 次真实客户端启动；两项清理均为 true，同一最终 exe SHA。实际原生 WebDriver 滚轮使保存卡片进入视口，截图和结果为 `evidence/desktop-final-saved-card.png`、`evidence/desktop-final-saved-card-{result,checks}.json`。
- 已逐张实际查看完整运行的 33 张截图和独立成功卡片截图，覆盖三种连接默认空白、候选预览、采用后状态、warning 重提加载/完整预览/保存成功/持续失败，以及多段、重启、原文修改、来源失败、普通加载、取消、数据目录弹窗与切换后页面。全部副本采用 `evidence/desktop-final-*.png` 前缀。`03-adopted-*` 仅拍到原文依据底部和保存 toast；成功卡片的清晰可见证据为 `14-warning-saved-*` 和独立 `desktop-final-saved-card.png`。
- 实际可见状态保持“正在整理知识”“暂时无法整理这段内容，请重试。”“已取消，输入已保留。”等简短文案；没有把模型未完成声明、`warnings`、JSON、evidence、内部校验、工程机制说明或开发验收信息显示到产品界面。
- 本轮仍只证明真实客户端对确定性本机 HTTP/SSE 模拟服务的行为；DeepSeek、OpenAI 兼容、Anthropic 兼容的官方服务实网覆盖分别为 false，均未执行官方 API 调用。旧证据未覆盖或改写。
