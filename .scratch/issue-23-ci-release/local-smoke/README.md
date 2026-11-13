# 本机优化便携包的真实客户端 smoke

执行时间：2026-11-13 10:49（Asia/Shanghai）。这是当前独立 worktree 的本机隔离验收，**不代表 GitHub Runner 已通过，也不是从 GitHub Release 下载后的验收**。完整媒体、大视频及真实 AI 服务验收不在本 smoke 范围。

本次新构建的优化 exe 先经 `release.mjs package` 生成便携 ZIP，再经 `release.mjs verify` 校验并解压；WebDriver 启动的是本次解压出的 exe。未使用旧 `.scratch` 程序或历史验证数据。包仅包含 exe、README 和 manifest；外部同时提供 SHA256SUMS。

- 源码标识：`0f5310b4593e856f85f0b451921a8faeb6008154`。
- 版本：`0.1.0-main.0f5310b4593e`；Windows x64，Cargo `release` 优化构建。
- exe：10,531,328 字节；SHA256 `982a2f7f9b65f1e9d3c3f0407344f98da351bac6b11925daabc06df366c96aa4`。
- ZIP：3,757,767 字节；SHA256 `cbfea48f63c301f6250c7e26b32f163db816a6bae71ce45cc123cd33cd3730cc`。
- Node：`v24.14.0`。WebView2 Runtime / EdgeDriver：`136.0.3240.76`。驱动签名和来源见 `driver-provenance.json`。
- 本机打包时按任务指定填写的 run URL 为 `https://github.com/jking412/Noterion/actions/runs/43354260034`；该 URL 对应既有的远端失败 run，只用于本机包的源码追溯，**不能据此声称该 Runner 构建成功**。

结果：进程返回码 0，`result.json` 的 `passed=true`，三项界面边界检查全部通过。

1. 真实 exe 打开可见 `http://tauri.localhost/` 页面；生产 JavaScript 来自嵌入原点，存在真实 Tauri 接口，实际数据目录位于本次独立配置目录。
2. 通过 WebDriver 的输入、点击和保存操作创建合成知识点“Release smoke: 保存后重启”，详情呈现保存后的描述，无存储错误。未注入 IPC、未写数据库造数据。
3. 客户端完全退出后，以不同的应用进程和新的 WebView profile 再启动；通过可见搜索找到唯一结果并核对原名称、描述。首次 PID `36732`，重启 PID `32176`。

初次受限 sandbox 执行时，EdgeDriver 已监听 localhost，但 Node 的 loopback fetch 被权限环境阻断，随后受限 token 的进程清理也被拒。保留该失败结果后，以同一脚本、同一包、同一驱动在授权的本机桌面权限下重试；约 6 秒完成全部检查，证明权限限制与客户端行为已区分。未为此修改业务代码或放宽断言。

本机原始包、解压目录、完整 WebDriver 日志、隔离配置/profile/数据均在被 Git 忽略的 `app/smoke-output/`，不纳入提交。本目录只保留静态结果、驱动来源和合成数据的界面截图；JSON 中本机 worktree 路径替换为 `<worktree>`。

```powershell
$env:SOURCE_SHA='0f5310b4593e856f85f0b451921a8faeb6008154'
$env:SOURCE_REF='refs/heads/main'
$env:RUN_URL='https://github.com/jking412/Noterion/actions/runs/43354260034'
node app/scripts/release.mjs package --exe=app/dist-desktop/noterion.exe --output=app/smoke-output/local-package-01
node app/scripts/release.mjs verify --input=app/smoke-output/local-package-01 --commit=$env:SOURCE_SHA --extract=app/smoke-output/local-extracted-01
node app/scripts/release-smoke.mjs --exe=app/smoke-output/local-extracted-01/noterion.exe --driver=app/smoke-output/webdriver/msedgedriver.exe --output=app/smoke-output/local-smoke-02
```

重复运行时需要使用新的空打包、解压、smoke 输出路径；不得复用旧 smoke 数据。
