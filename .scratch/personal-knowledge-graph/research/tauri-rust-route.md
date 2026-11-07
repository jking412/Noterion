# Tauri v2＋Rust＋React/TypeScript 路线核验

核验日期：2026-11-07（Asia/Shanghai）。应用 research 技能，依据官方文档检索。本文是用户提出 Tauri 偏好之后的新研究记录，保留此前 [本地交付候选比较](./local-delivery-options.md) 作为讨论历史，不沿用旧报告的候选排序；未修改其他文档，也未实施应用。

## 当前建议

**按用户最新偏好，建议将 Tauri v2＋Rust 本地核心＋React/TypeScript 界面作为当前技术路线。** 用户对技术兴趣与学习价值有明确要求，Rust 与 TypeScript 并存可以接受；因此不再把语言数量最少或最简够用当作唯一选型标准。这是结合本项目和用户偏好的建议，不是“Rust 在所有场景更先进”的事实判断。数据库仍应独立讨论，选择桌面框架不会自动决定数据库类别。

## 官方能力与建议边界

| 项目 | 官方核验事实 | 本项目可采用的做法（建议） |
| --- | --- | --- |
| 本地核心和界面 | Tauri 的 Core 管理 WebView；Core 适合维护全局状态及数据库连接，WebView 执行 HTML/CSS/JavaScript 并使用系统提供的 WebView 库。[Process Model](https://v2.tauri.app/concept/process-model/)。 | Rust 处理知识点与资料的应用逻辑、导入校验、存储及文件操作；React/TypeScript 处理界面与交互。无需为了这条路线额外建立本机 HTTP 后端。 |
| 前后端调用 | 前端可用 `invoke` 调用 Rust commands，传入参数并接收结果；请求和响应需要可序列化。官方展示 Rust command 注册及前端调用方式。[IPC](https://v2.tauri.app/concept/inter-process-communication/)、[Calling Rust](https://v2.tauri.app/develop/calling-rust/)。 | 定义有边界的应用操作，避免界面任意操作文件或数据库；在 Rust 侧进行实际输入及业务校验。TypeScript 类型不会代替运行时校验。 |
| React/TypeScript 工具入口 | 官方 `create-tauri-app` 提供 React 模板与 TypeScript 选项；前端指南建议 SPA 采用 Vite，并说明前端产物是交给 WebView 的静态文件。[Create a Project](https://v2.tauri.app/start/create-project/)、[Frontend Configuration](https://v2.tauri.app/start/frontend/)。 | React＋TypeScript＋Vite 是有官方路径的候选组合。此前 Forge Vite 插件的 experimental 警告针对 Electron Forge 集成，不适用于直接判定 Tauri 的 Vite 路径。具体版本和构建结果仍需验证。 |
| 桌面平台 | 官方架构文档中的窗口、WebView 与打包组件覆盖 Windows、macOS、Linux。[Architecture](https://v2.tauri.app/concept/architecture/)。 | 首期只承诺 Windows；未来其他桌面系统分别验证构建、系统依赖、文件路径及界面行为。官方平台覆盖不是本项目已经通过兼容验收。 |

Rust 核心与 TypeScript 界面的分工为项目建议，不意味着全部业务函数都必须写在某一侧；接口仍应围绕具体应用操作设计。也不因采用 Tauri 就引入插件平台、分布式服务或额外语言后端。

## Windows：开发者要求与使用者要求

**开发与构建侧：** 官方要求 Windows 开发环境具备 Microsoft C++ Build Tools 和 WebView2；Rust 开发应使用 MSVC 工具链。采用 React/TypeScript 的 JavaScript 工具链还需要开发者安装 Node。若构建 MSI，还需满足该打包路径的 VBSCRIPT 前提。[Prerequisites](https://v2.tauri.app/start/prerequisites/)。

**普通使用者侧：** 分发目标是已构建的应用安装包。不能把上述 Rust、Node、C++ 构建工具要求转交给普通使用者。WebView2 则是 Windows 的界面运行依赖；Tauri 安装器默认可在缺失运行时时下载并执行引导安装，也有其他分发模式。[Windows Installer](https://v2.tauri.app/distribute/windows-installer/)。

结合用户不要求断网使用的答复，建议先评估普通 Windows 安装器和 WebView2 引导方式，无需先为离线安装捆绑固定版本运行时。实际安装仍需测试目标 Windows、权限、WebView2 检测及失败提示；不能承诺所有电脑都已安装 WebView2，或安装必然无需额外运行库。当前开发机是否完整具备 MSVC/C++ 构建条件尚未核查，先前 `rustc --version` 成功不能替代实际构建验证。

## Tauri 与独立数据库服务是两层

**Tauri 不会因为项目选择 Neo4j 或 PostgreSQL，就自动完成它们的捆绑、初始化和运行管理。** 这一结论来自以下文档事实与职责区分：

- Tauri 的 sidecar 需要开发者显式提供外部可执行文件、配置 `externalBin`，并为各目标架构准备对应二进制；执行还需要对应插件和权限配置。这是外部程序集成工具，并非预配置数据库发行方案。[Embedding External Binaries](https://v2.tauri.app/develop/sidecar/)。
- PostgreSQL 官方描述的是客户端/服务器模型，`postgres` 服务进程管理数据并接受连接；前端应用连接数据库不等于数据库服务器已自动安装运行。[PostgreSQL Architectural Fundamentals](https://www.postgresql.org/docs/16/tutorial-arch.html)。
- Neo4j 官方 Windows 部署有独立的下载、JDK 前提、初始化及控制台/服务启动步骤。Tauri 外壳不会代替这些数据库自身的部署职责。[Neo4j Windows Installation](https://neo4j.com/docs/operations-manual/current/installation/windows/)。

sidecar 的进程句柄提供终止能力，shell API 还支持按进程组/Windows job object 管理进程树；但“能启动和终止外部进程”不等于已实现数据库安全关闭、崩溃恢复、数据版本升级或备份。[Tauri Shell API](https://v2.tauri.app/reference/javascript/shell/)。

若后续选择独立数据库服务，仍须明确由使用者安装服务，还是由本应用提供管理和分发。后一条属于额外工程工作，应实际验证数据库的许可、运行依赖、端口、启动就绪、升级与数据恢复；本报告既不否决该路线，也不承诺已经解决。数据库的价值应由图查询、检索与维护目标决定，不能仅因桌面技术偏好就绑定选择。

## 下一步应验证什么

在用户确认整体路线后，再选定依赖版本，验证 Windows 开发构建、React/TypeScript 到 Rust 的 command 往返、目标数据库驱动及 Windows 安装包。数据库、中文检索、文件管理、导入语义和 AI 权限仍按各自证据及业务约束讨论。本文没有性能、包体或资源占用实测，也没有创建应用、安装依赖或预先确定数据库。
