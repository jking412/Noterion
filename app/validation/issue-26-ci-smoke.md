# Issue #26：发布 smoke 的真实 RED → GREEN

日期：2026-11-13（Asia/Shanghai）。CI [run 43382481222 / job 131743266731](https://github.com/jking412/Noterion/actions/runs/43382481222/job/131743266731) 的 smoke 仍在读取已从产品界面删除的 `.storage-location`。本次只修复验证脚本，不修改产品或重新构建。

使用本 worktree 的真实 Windows debug 客户端，SHA-256 为 `8f0f25a509329bcc0a117d3b83e841bc4cf4b9afe589137714feac59d55ec790`；EdgeDriver / WebView2 为 `136.0.3240.76`。所有配置、数据、profile 与输出均隔离于本 worktree 的 `app/validation/issue-26-runs/`，没有读取用户数据或 AI 密钥。

| 运行 | 结果 | 证据 |
| --- | --- | --- |
| `issue-26-release-smoke-red`，原脚本 | 退出 1、`passed=false`；启动后第 144 行查找 `.storage-location` 得到 `no such element`，尚未执行保存 | [RED result](issue-26-evidence/release-smoke-red-result.json) |
| `issue-26-release-smoke-green`，修复脚本 | 退出 0、`passed=true`；3 项 PASS、2 次真实客户端进程启动 | [GREEN result](issue-26-evidence/release-smoke-green-result.json)、[两次启动观察](issue-26-evidence/release-smoke-green-launches.json)、[程序/驱动哈希](issue-26-evidence/release-smoke-green-inputs.json) |

修复后的每次启动会通过真实可见 UI 点击“数据目录”，读取 `#data-directory` 的 `value`，断言是可读 Windows 路径，并在 Windows 路径规范化后与本 run 的 `isolated-config/data` **精确相等**；关闭设置后继续原有的保存、退出、新进程重启和从磁盘读取检查。保留且收紧了隔离断言，没有通过删除路径验证来绕过失败。

复现命令如下，分别使用唯一 RED/GREEN 输出目录；RED 在修复前执行，原始结果保持不变：

```powershell
node app/scripts/release-smoke.mjs --exe=C:/Users/skynesser/.codex/worktrees/13f0/knowledgeGraph/app/dist-desktop/noterion.exe --driver=D:/person/application/knowledgeGraph/.scratch/personal-knowledge-graph/validation/windows-desktop/.tools/issue3-webdriver/msedgedriver.exe --output=C:/Users/skynesser/.codex/worktrees/13f0/knowledgeGraph/app/validation/issue-26-runs/issue-26-release-smoke-red
node app/scripts/release-smoke.mjs --exe=C:/Users/skynesser/.codex/worktrees/13f0/knowledgeGraph/app/dist-desktop/noterion.exe --driver=D:/person/application/knowledgeGraph/.scratch/personal-knowledge-graph/validation/windows-desktop/.tools/issue3-webdriver/msedgedriver.exe --output=C:/Users/skynesser/.codex/worktrees/13f0/knowledgeGraph/app/validation/issue-26-runs/issue-26-release-smoke-green
node --check app/scripts/release-smoke.mjs
```

`node --check` 与 `git diff --check` 通过。`rg` 检查 `app/scripts` 后，没有其他 runner 依赖 `.storage-location`；旧 `acceptance.mjs` 已经使用真实数据目录设置读取路径，无需改动。本轮本地 GREEN 验证的是同一产品 exe 上的发布 smoke 行为，不声称新的远端 CI 已通过，也不将 debug 运行当作优化版桌面验收。
