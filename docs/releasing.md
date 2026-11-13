# Windows 客户端 CI 与发布

正式任务：[Issue #23](https://github.com/jking412/Noterion/issues/23)。工作流为 `.github/workflows/desktop.yml`。当前交付 Windows x64 优化版便携 ZIP，`bundle.active=false`，没有声明 MSI/NSIS 安装包或自动更新能力。

## 自动触发

| 事件 | 检查与产物 | 发布 |
| --- | --- | --- |
| 指向 main 的 PR，包括 fork | 锁定安装、类型检查、前端测试、Rust fmt/clippy/test、优化构建、打包、真实 exe smoke | 无；只有 contents:read，不提供服务密钥 |
| main push | 相同检查，通过后下载同一 job 的检查产物 | 每个完整提交 SHA 一个唯一预发布 |
| v* 标签 push | 相同检查，验证标签与各组件版本一致且提交属于 main 历史 | 正式版本 |
| Actions 手工运行 | 选择 main 或版本标签重试，clean=true 可强制不恢复或保存 npm/Cargo 缓存 | 只有 main 或有效正式标签有发布权限 |

前端与 Rust 锁文件、`.node-version`、`rust-toolchain.toml` 一起控制依赖和工具链。Actions 固定到完整 commit SHA，版本及官方依据见 `.scratch/issue-23-ci-release/research.md`。Runner 使用 `windows-2022`，操作系统镜像和 WebView2 补丁由 GitHub/Microsoft 维护；驱动每次匹配实际 WebView2 Runtime，并记录版本、签名及哈希。缓存按平台、工具链和两个锁文件失效；首次运行不依赖缓存。

## 版本与重跑

源版本由 `app/package.json` 维护，使用 `release.mjs version` 一次同步 npm 锁文件、Cargo 包与锁文件及 Tauri 配置；发布时再次拒绝不一致版本。main 预发布标识包含源版本和提交 SHA，标签包含完整 SHA；版本标签必须为 `v<源版本>`。同一 SHA 的重跑定位原版本，公开资产仅下载验证，不替换。尚未公开的失败草稿允许清理部分资产后重试。

```powershell
node app/scripts/release.mjs version --version=0.2.0
git diff -- app/package.json app/package-lock.json app/src-tauri/Cargo.toml app/src-tauri/Cargo.lock app/src-tauri/tauri.conf.json
# 将版本变更通过 PR 合入 main 后，在对应提交上创建并推送 v0.2.0。
```

同一 PR/ref 的新运行取消旧运行。main 在打包和下载验证期间继续前进时，旧提交保留为未公开草稿或明确跳过，不更新新版本。日常预发布不改变正式版本的 Latest 链接。正式发布由 GitHub 的版本比较规则选择 Latest。历史公开版本持续可下载。

## 发布门槛与故障处理

只有 `check` 全部成功后，独立 `release` job 才获得 `contents:write`。它下载该运行、该提交、该 attempt 的产物，拒绝版本/提交错配，创建私有草稿，上传全部资产，重新下载并校验 SHA-256，再从解压后的程序执行真实界面 smoke。全部通过才公开，并验证不带身份认证的公开下载入口。失败保留日志，草稿可重试；公开下载验证失败时尝试退回草稿，错误会令 job 失败。发布 token 不传给被测试的客户端。

便携 ZIP 中只有 `noterion.exe`、`README.txt` 和 `manifest.json`；Release 另附说明、manifest 和 `SHA256SUMS`。manifest 记录源码提交、源版本/分发版本、target、优化 profile、exe 哈希与构建 run。版本和资产不包含 SQLite 数据、个人配置、凭据、开发缓存或媒体样本。当前程序未签名；首次启动可能出现 Windows 信任提示。WebView2 Runtime 是运行前提，发布包不内嵌 Runtime 安装器。

本地复现：

```powershell
npm.cmd ci --prefix app --registry=https://registry.npmjs.org
npm.cmd run typecheck --prefix app
npm.cmd test --prefix app
node --test app/scripts/release.test.mjs
cargo fmt --manifest-path app/src-tauri/Cargo.toml --all -- --check
./app/build.ps1 -Release
cargo clippy --manifest-path app/src-tauri/Cargo.toml --locked --all-targets --target x86_64-pc-windows-msvc -- -D warnings
cargo test --manifest-path app/src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc
./app/scripts/setup-webdriver.ps1 -Destination app/smoke-output/webdriver
$env:SOURCE_SHA = git rev-parse HEAD
$env:SOURCE_REF = 'refs/heads/main'
$env:RUN_URL = 'https://github.com/jking412/Noterion/actions/runs/123' # 本地演练的标识，不作为真实远端证据
node app/scripts/release.mjs package --exe=app/dist-desktop/noterion.exe --output=app/release-output
node app/scripts/release.mjs verify --input=app/release-output --extract=app/release-extracted
node app/scripts/release-smoke.mjs --exe=app/release-extracted/noterion.exe --driver=app/smoke-output/webdriver/msedgedriver.exe --output=app/smoke-output/local-run-1
```

所有证据和解压目录使用新目录；重复调用时换新名称。发布脚本仅供 Actions 受信 release job 使用，普通检查无需真实 DeepSeek 密钥或付费调用。真实 smoke 通过可见界面创建知识点、完全退出、重启并检索描述，观察嵌入资源原点及隔离数据目录；不模拟 Tauri IPC。完整媒体/1–2 GB 视频、人工 PDF 视检和真实 AI 服务不属于这条 smoke，既有 #21 证据不计为本次 Runner 已执行结果。

远端执行、下载和审查证据见 `.scratch/issue-23-ci-release/`，仅完成全部验收后关闭 #23。
