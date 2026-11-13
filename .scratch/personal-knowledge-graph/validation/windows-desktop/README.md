# Issue #3：Windows Tauri / WebView2 自动验收

任务：[验证真实 Windows 桌面验收路径](https://github.com/jking412/Noterion/issues/3)。日期：2026-11-07（Asia/Shanghai）。起始提交：`69ce7671f75cad8997534a34319d67bf956d4669`。

## 验收结论

**采用 Microsoft Edge WebDriver 的 WebView2 模式，已对真实 Tauri exe 完成两轮最终自动验收。** 每轮独立启动宿主，以标准 W3C WebDriver 接口输入、点击、读取 rendered text，断言真实 Rust command 返回后的可见结果；每轮两次成功、一次 Rust 拒绝。重启后调用计数从 1 开始；会话关闭后确认宿主已退出、驱动已停止。

用户明确要求 Computer Use 不作为验收标准。当前入口是 `webdriver-smoke.mjs`，不使用 Computer Use、可访问性索引、鼠标坐标或人工观察判定。此前 `smoke.mjs` 和 `issue3-run-*` 仅为历史试验，不计入当前验收；中断的 `issue3-final-01` 也不计成功。

真实页面为嵌入资源的 `http://tauri.localhost/`，通过 `core.invoke` 调用 Rust `issue3_roundtrip`。驱动的 binary 指向宿主 exe，返回会话 browserName 为 webview2；没有普通浏览器替身或 mock IPC。测试用 Get Element Text 和 displayed 接口断言可见结果；唯一 executeScript 只读取 URL、User-Agent、visibility 和 invoke 类型，不调用 Rust、不触发点击、不改页面。

## 固定环境和条件

| 项目 | 本次实际版本 |
| --- | --- |
| Windows | Windows 11 家庭版中文版，10.0.26200，x64 |
| Rust / Cargo | 1.93.1，x86_64-pc-windows-msvc |
| Tauri / tauri-build | 2.10.3 / 2.5.6 |
| serde / serde_json | 1.0.228 / 1.0.149 |
| Visual Studio / cl | Community 2022 17.13.35825.156 / 19.43.34808.0 |
| Windows SDK | 10.0.22621.0 |
| WebView2 / WebDriver | 136.0.3240.76 / 136.0.3240.76 |
| 测试运行时 | Node v24.14.0，PowerShell 7；无需 npm 依赖 |

474 个 Cargo 包由 Cargo.lock 固定。本机环境与真实 WebView2 进程证据见 `evidence/environment.json`；最终每轮的 session.json、launch.json 和 result.json 记录实际会话版本、PID、exe/driver 哈希及回收状态。官方依据见 [专项研究](research-webdriver.md)；[宿主研究](research-official.md) 中的 Computer Use 建议属于已被替换的历史候选。

实测是在已登录、解锁的 Windows 交互桌面；WebDriver 元素操作不抢占全局鼠标键盘，不要求人查看截图才能判断通过。未验证锁屏、RDP 最小化、无交互 CI、其他电脑/系统、安装器或升级。

新依赖、Cargo cache、target、驱动、驱动临时目录、WebView 用户数据和证据均在本目录。驱动服务使用 loopback 端口 33030，启动前检查占用；冲突时加 `--port=33031` 指定空闲端口，不接管已有服务。驱动还会为本次 WebView2 分配临时调试端口。

## 准备与构建

在 PowerShell 7 中进入本目录。已有构建产物可直接验收；首次可只读复制已有 Cargo 缓存再离线构建：

```powershell
./build.ps1 -SeedFromExistingCache -Offline
./setup-webdriver.ps1
```

没有预存依赖时去掉 -Offline，缓存复制参数也可省略。构建脚本通过 vswhere 找 C++ 工具并加载进程级 VsDevCmd，检查 Rust 版本，按 lockfile 构建。默认 custom-protocol feature 嵌入静态前端，无需开发服务器。最终成功日志为 `evidence/issue3-build-20261107-215425.txt`。

驱动准备脚本从 Microsoft 官方地址下载固定版本到 `.tools/issue3-webdriver/`，校验 ZIP/EXE SHA256 并显示版本。Runtime 升级或换机后须重新核对匹配版本。当前 Codex 沙箱会限制 Rust canonicalize、下载及 loopback/进程管理，使用已授权的沙箱外执行，不修改目录 ACL 或系统设置。

## 现场验收命令

```powershell
node ./webdriver-smoke.mjs --run-id=issue3-wd-your-first-run
if ($LASTEXITCODE -ne 0) { throw 'First acceptance failed' }
node ./webdriver-smoke.mjs --run-id=issue3-wd-your-second-run
if ($LASTEXITCODE -ne 0) { throw 'Repeated acceptance failed' }
```

每次使用新 RunId，脚本拒绝覆盖证据。无需先运行 launch.ps1，无需人工输入。流程为：

1. 启动本次驱动，以 browserName=webview2、binary=宿主 exe 创建真实会话。
2. 等待宿主启动与页面 READY，确认嵌入页面、visible 状态和 Tauri API。
3. 清空并输入 `issue3-桌面-001`，点击按钮；断言可见 `ISSUE3-桌面-001`、chars=13、call=1、真实 PID，并核对可见 JSON 详情。
4. 输入 `docker-知识-002`，点击；断言 `DOCKER-知识-002`、chars=13、call=2、同一 PID。
5. 输入三个 ASCII 空格，点击；断言 `EMPTY_REQUEST`、`Rust 拒绝空白输入`、call=3、同一 PID。
6. 保存截图、HTML、WebDriver 协议及 Rust 日志；删除会话、确认宿主退出、停止本次驱动。

预期使用独立已知字面量，不重算 Rust 算法。每次等待本次调用计数，避免读到旧结果；响应等待 15 秒，协议请求也有限时。失败写 failure.json 并退出非零。

可失败的红色对照：

```powershell
node ./webdriver-smoke.mjs --run-id=issue3-wd-your-red-control --expect-first=INTENTIONALLY_WRONG_VISIBLE_RESULT
# 预期退出码 1：实际调用 Rust 后，可见结果与故意错误预期不一致。
```

## 最终证据

| RunId | 真实 Tauri PID | 结果 |
| --- | --- | --- |
| issue3-wd-red-01 | 51440 | 预期失败，真实 Rust 结果被错误预期检出；退出码 1，会话清理 |
| issue3-wd-green-01 / green-02 | 11700 / 47304 | 初步两轮均通过三条可见断言，随后补充进程回收核验 |
| **issue3-wd-final-01** | **45364** | **2 成功＋1 Rust 拒绝；会话关闭、宿主退出、驱动停止** |
| **issue3-wd-final-02** | **3260** | **同一最终流程重复通过；调用计数重置；全部资源回收** |

最终两轮同一次命令执行的退出码为 **0**，总耗时约 **5.8 秒**。同一 exe SHA256：`DD029C5E9FF382EAB6179972A942FD363AE48D870193B1CFC3431C3E39E91311`。

每个目录含三条 assertions.jsonl（实际可见文本/详情）、session.json（真实 WebView2 模式/版本）、webdriver-events.jsonl（输入/点击/GetText 命令）、四阶段 PNG/HTML、Rust command 现场写入并 flush 的 rust-events.jsonl，以及回收状态 result.json。

```powershell
node ./verify-evidence.mjs issue3-wd-final-01 issue3-wd-final-02
```

该命令复核归档一致性，不代替现场重跑。截图供审阅，程序断言决定通过。

## 失败诊断与范围

- PowerShell Tee-Object 参数集冲突，按语法核对改为 -FilePath -Append；原构建命令通过。
- 沙箱内 Cargo unpack canonicalize 拒绝；同一缓存/工具/命令在批准的沙箱外通过，失败和成功日志均保留。
- 沙箱内下载驱动被 socket 权限拒绝；沙箱外从 Microsoft 官方地址取得匹配驱动并实际启动通过。
- 旧 launch.ps1 后台进程可能随 exec 结束被回收；当前由 WebDriver 测试进程管理宿主生命周期。
- 旧 Computer Use 的采样/关闭时序记录仅为历史，不参与最终验收。
- 未实现正式 React 界面、数据库、对象存储、业务持久化或其他 Issue，未运行整批 Sandcastle。

## 技能与审查

使用 implement 组织实现和验收，tdd 在已确认的真实桌面外部边界建立可失败断言与红→绿反馈，research 委派后台代理核验官方配置和下载源，diagnosing-bugs 处理实际反馈。宿主骨架早于测试补充，未声称整个实现严格测试先行；未新增内部模块测试边界。按 code-review 的 Standards / Spec 两轴并行复核，仅审查本目录，结果保存到 review.md。Computer Use 只属于上次历史试验，本次未调用。
