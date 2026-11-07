# 本地交付候选：Electron、Tauri 与本机浏览器

核验日期：2026-11-07（Asia/Shanghai）。本文应用 research 技能，记录官方文档事实与本项目判断。所有技术选型仍待用户确认；没有安装、打包、运行或测量任何候选方案。

## 结论与当前约束

**建议把 Electron＋TypeScript 的桌面路线作为当前优先讨论候选，React 可作为界面组件层；构建工具单独选择，不把 Forge＋Vite 作为已稳定的默认组合。** 这是结合当前约束的工程判断，不是官方性能结论，也不是哪种框架最适合所有 AI 编程的排名。

本轮用户已明确：语言框架不设限；首期正式支持 Windows，未来考虑其他电脑系统及功能、格式、可选 AI 扩展；桌面略优先，浏览器可接受；交付应安装/解压即用，或最多接受一次简单环境安装，拒绝技术用户式部署；NAS 已取消；不要求断网能力或离线安装；规模定位为个人逐步积累。业务概念和保存边界以最新 [spec.md](../spec.md)、[CONTEXT.md](../../../CONTEXT.md) 及本聊天更晚的明确答复为准。

## 三条路线比较

| 候选 | 已核验的技术事实 | 对本项目的取舍判断（推断） |
| --- | --- | --- |
| Electron＋TypeScript | Electron 随程序嵌入 Chromium 和 Node.js，官方覆盖 Windows、macOS、Linux；主进程负责窗口和应用生命周期，渲染进程负责网页界面。[Electron Introduction](https://www.electronjs.org/docs/latest/)、[Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)。 | 符合略偏桌面、普通用户启动简单的方向；界面和本地逻辑可以使用同一主要语言。随包分发运行时有维护成本，不能据此给出未测量的包体、启动时间或内存数字。官方跨平台能力不等于本项目已经完成跨平台验收。 |
| Tauri＋TypeScript＋Rust | 官方 Windows 交付支持 MSI 或 NSIS 安装包，并列出 WebView2 下载引导、内嵌引导、离线安装器、固定版本等分发选项。[Windows Installer](https://v2.tauri.app/distribute/windows-installer/)。 | 值得保留为系统 WebView 路线。须把 WebView2 的存在、安装和版本作为交付因素，并维护前端与 Rust 本地边界。当前未提出明确包体或资源预算，尚无足够收益证明值得因此增加语言和运行时分发选择；也不能仅凭 Rust 断言 AI 难以维护。 |
| 本机浏览器＋打包后端/启动器 | 本机服务可采用的 Node 网络 API包含监听、获取地址和关闭服务等能力。[Node net API](https://nodejs.org/api/net.html)。这是底层 API 事实，不是现成应用交付方案。 | 可以实现点击启动器后打开本机页面，但需自行设计服务就绪检测、浏览器打开、端口分配、重复启动、退出入口及后台进程清理。浏览器页面与服务进程生命周期分开，不能把关闭标签页直接当作后端已退出的保证。普通用户是否仍需装运行时，取决于后端打包方式；相关打包器尚未核验，不能把运行源码命令当作完成交付。 |

## Electron 的 TypeScript 与构建工具边界

TypeScript 提供执行前的部分类型检查；用它表达界面与本地能力的接口，适合让 AI 生成代码的契约更容易审查，这是本项目判断。类型检查不能替代运行时输入校验、权限边界或领域行为验证。[TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro)、[TypeScript Basics](https://www.typescriptlang.org/docs/handbook/2/basic-types)。

**Forge 官方 Vite 插件当前仍标为 experimental，并提醒次版本可能带来破坏性变更。** 该警告针对 Forge 与 Vite 的集成，不应扩大为 Vite 本身不稳定，也不应因选了 Electron/TypeScript 就默认采用这一集成。主聊天已成功核验此官方页面；具体模板、插件版本和构建组合在路线确认后再验证。[Forge Vite Plugin](https://www.electronforge.io/config/plugins/vite)。

Electron 的主进程与渲染进程并非同一个权限环境；本地文件及数据库能力应由明确接口提供给界面。使用主进程/预加载接口的候选，不需要为了让桌面界面访问数据而额外引入本机 HTTP 服务，但接口设计和安全设置仍须落实。[Electron Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)。

开发机的 Node.js 版本与目标 Electron 内置的 Node.js 版本应分别核对；不能把本机 Node 能运行某驱动，当作最终安装包已经兼容的证据。具体 Electron 版本、SQLite 驱动及打包结果留待路线确认后验证；本报告不预选版本。

## Tauri 与离线分发的核验边界

已核实官方 Windows 安装文档列有 WebView2 的多种安装/分发模式；**不能由“支持离线安装器”直接推出当前项目已经可以在任意离线 Windows 上安装成功**。各模式的精确配置、固定运行时的更新责任、系统前提及实际打包结果仍须在采用 Tauri 时进一步核验。[Tauri Windows Installer](https://v2.tauri.app/distribute/windows-installer/)。

当前用户不要求离线安装，因此无须为了离线部署提前选固定运行时或内嵌完整安装器。Tauri 也不应因为当前开发机存在 Rust 就自动胜出；已有环境只说明开发入口存在，不代表用户确认该技术。

## 仍需验证的实现事项

- 若选择 Electron：锁定目标 Electron 后，核验 TypeScript 构建组合、主进程/预加载接口、SQLite 驱动及 Windows 安装包；未来其他系统分别打包测试。
- 若选择 Tauri：补核 Rust 开发与构建前提、WebView2 分发配置和权限接口，再比较真实安装体验；未用包体/内存传闻做决定。
- 若选择本机浏览器：核验一个具体打包后端及启动器方案，并测试端口占用、重复启动、浏览器关闭和应用退出行为。
- React 是可选界面组件层，不等于需要公开网站、SSR 或全栈 Web 框架。[React：Build from Scratch](https://react.dev/learn/build-a-react-app-from-scratch)。

本报告仅新增研究文件。未修改 technical-design.md、spec.md、CONTEXT.md 或 ADR；没有决定知识点同义识别、导入冲突、删除、搜索匹配或 AI 外发等业务边界。部分网页补核及 GitHub 源码请求遇到连接失败，因此未成功读取的细节保留为待核验；没有把失败请求当作事实证据。
