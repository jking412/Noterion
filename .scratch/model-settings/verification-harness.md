# Issue #31 可重复 Windows 桌面验收入口

本记录说明新验收脚本的范围和命令。运行结果由每次独立 run 的 `result.json`、`checks.json`、截图和 `fixture-requests.json` 证明；没有运行记录的项目不视为已通过。

## 入口

- `app/scripts/model-settings-acceptance.mjs`：通过 Edge WebDriver 操作真实 Tauri/WebView2 桌面。所有业务变更来自可见控件；`execute/sync` 只观察页面。
- `app/scripts/model-fixture-server.mjs`：本机 HTTP/SSE 协议夹具，三类连接使用不同合成密钥。记录路径类型、模型、工具名称、结果数量和协议违例等脱敏元数据，不保存请求头、密钥或提示正文。

默认命令不依赖真实密钥，不调用任何外部付费模型 API。夹具成功不构成 DeepSeek、OpenAI 或 Anthropic 官方服务实网通过。

## 调试构建的完整契约与业务验收

在本 worktree 构建调试 exe 后执行；`--exe` 应指向本 worktree 的实际产物，`--driver` 指向已安装且与 WebView2 版本匹配的 EdgeDriver。默认自动选择空闲本机端口，也可传 `--port`。

```powershell
node app/scripts/model-settings-acceptance.mjs --run=issue-31-contracts-001 --scenario=contracts --exe=app/src-tauri/target/x86_64-pc-windows-msvc/debug/noterion.exe --driver=你的/msedgedriver.exe
```

需要宿主允许本机 loopback 网络连接与 Windows 桌面操作。每次更换唯一 `--run=issue-31-...` 名称；脚本使用 create-new 目录，不覆盖已有结果。

覆盖内容：

1. 先通过界面创建知识点及 Markdown 文件资料，再合成旧 `deepseek.json` 与本次 run 专属 Windows 凭据，验证升级后地址、模型、旧凭据及资料可读性。不会读取或枚举其他 profile 的凭据。
2. 三类连接分别检查当前未保存的表单、执行工具及结构化回合，编辑后清除旧检查成功，保存启用并重启后保留三份配置和当前选择。
3. 改地址后不携带旧密钥；独立替换/移除密钥；检查中编辑表单时忽略旧请求的迟到响应。
4. 锁住本次 run 的配置文件模拟原子替换失败，验证 JSON 与原 Windows 凭据被保留且仍可检查。
5. 三类连接分别驱动知识解析、依据预览、候选描述修改、正式采用、真实本地检索工具、搜索定位、回答引用、来源跳转及追问。
6. 两个协议分别验证鉴权失败、限流、模型/接口不存在、空结果、截断、SSE 中断、取消关闭原生 HTTP 及随后正常任务恢复。
7. 在旧 OpenAI 工具请求等待时通过设置页启用 Anthropic，释放旧请求后验证整个旧任务仍使用 OpenAI 的模型、凭据与协议，新任务使用 Anthropic。
8. 夹具对 Chat Completions 路径/Bearer/function/tool_call_id 和 Messages 路径/x-api-key/API version/input_schema/tool_use/tool_result 顺序及标识逐项校验；Messages 响应含签名 thinking 块，下一回合须原样保留。

## 正式构建的桌面验证

正式构建拒绝 HTTP 夹具。使用另一独立 run 验证真实 release exe 的设置界面、旧配置与 Windows 凭据迁移、本机知识/资料保留、三类 HTTPS 配置保存选择及重启，以及 HTTP 目标拒绝。

```powershell
node app/scripts/model-settings-acceptance.mjs --run=issue-31-release-001 --scenario=release-smoke --exe=app/dist-desktop/noterion.exe --driver=你的/msedgedriver.exe
```

此场景使用合成密钥且不点击任何实网检查。`result.json` 对三家 `liveApiCoverage` 均记录 false。本次用户明确要求跳过实网测试；该事实只进入交付证据，软件界面不展示验收覆盖标签。

## 证据与清理

输出目录为 `.scratch/model-settings/runs/<run>/`，内含隔离 config、数据和 WebView profile、少量 PNG、JSON 结果及运行时生成的合成凭据 helper。结束时只删除本次脚本按 config 路径计算并创建的精确凭据 target；数据与证据保留。`credentialCleanup=false` 或检查失败会返回非零退出码。

脚本初步验证：两文件 `node --check` 通过；本机 HTTP 三类夹具基本请求与 SSE 完成标记自检通过（3 次请求）。完整桌面与正式构建的通过状态以 root 执行后保留的 run 记录为准。
