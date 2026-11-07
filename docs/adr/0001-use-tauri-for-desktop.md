# 采用 Tauri 作为桌面应用框架

用户在技术访谈中明确选择 Tauri，希望个人项目采用自己更感兴趣的技术。项目采用 Tauri 作为桌面框架，以 Rust 本地核心与 WebView 界面之间的明确接口组织应用；首期正式支持 Windows，未来其他电脑系统分别打包和验证。

此前考虑过 Electron 的单一主要语言路线。本项目接受 Tauri 带来的 Rust/前端边界与系统 WebView 验证工作，以满足用户希望使用 Tauri 的技术偏好；这不是对所有项目的语言优劣排名。React/TypeScript 是当前界面推荐，具体前端工具链与数据库独立讨论，本决策不选定数据库，也不授权进入应用实现。

确认日期：2026-11-07（Asia/Shanghai）。访谈依据见 [技术选择记录](../../.scratch/personal-knowledge-graph/technical-design.md)，技术事实见 [Tauri 官方进程模型](https://v2.tauri.app/concept/process-model/)。
