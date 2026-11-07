# Noterion 前端与图组件技术核验

核验日期：2026-11-07（Asia/Shanghai）。应用 research 技能，只使用官方文档及项目仓库。本文是技术推荐，未安装依赖、创建应用、运行样本或修改技术设计、规格与 ADR。Tauri 已确认；本文不把其选择自动扩展为全部前端库已经获用户确认。

## 推荐组合

**建议 Noterion 采用 React＋TypeScript＋Vite，图组件采用 Cytoscape.js，普通控件可采用可替换的 Ant Design。** 图组件置于独立适配层，业务操作通过 Rust 应用接口进入 PG，不把图组件当作正式数据模型或删除规则的实现者。Sigma.js＋Graphology 是有效备选，当前未发现必须用它推翻 Cytoscape.js 推荐的需求或实测证据。

## Tauri 的前端路径

Tauri 官方脚手架提供 React 和 TypeScript 选项；前端配置指南推荐 SPA 使用 Vite，并要求提供可由 WebView 加载的静态前端产物，不原生采用 SSR 服务模式。[Create a Project](https://v2.tauri.app/start/create-project/)、[Frontend Configuration](https://v2.tauri.app/start/frontend/)。因此本项目推荐静态 SPA，不增加 Next.js、独立 Node Web 服务或第二套全栈框架。Vite 是开发/构建工具，不是要求最终用户另启动的前端服务。

React 负责搜索、详情、表单、查看器及选择状态；图容器由图组件控制。React 官方提供通过 Effect 与非 React 控件同步的方法。[React useEffect](https://react.dev/reference/react/useEffect)。建议在适配层维护图实例、订阅及清理，按变化更新图数据，避免每次 React 渲染都重建整个图；这一分工是本项目工程建议，不依赖未经核验的第三方 React 包装器。

## Cytoscape.js 与 Sigma.js/Graphology

| 路线 | 核验事实 | 对 Noterion 的判断 |
| --- | --- | --- |
| **Cytoscape.js** | 提供节点/边数据、事件、样式、布局、ID 查询及视口 API，适合构建交互图。[官方 API](https://js.cytoscape.org/)。官方有持续发布记录。[Releases](https://github.com/cytoscape/cytoscape.js/releases)。 | 更直接覆盖当前的关系浏览、节点定位、选择突出和动态资料展开；推荐作为默认图适配器。其图内数据只是界面表示，不是业务持久化。 |
| **Sigma.js＋Graphology** | Sigma 从 Graphology 读取图数据并进行 WebGL 渲染；Graphology 支持有向/无向/混合图及事件，提供布局、遍历等标准库。[Sigma Quickstart](https://www.sigmajs.org/docs/)、[Graphology](https://graphology.github.io/)。 | 同样能够实现点击、高亮和关系图，适合将可视化渲染与图数据工具分开组合。若后续测量显示 GPU 渲染是主要瓶颈，值得复评；当前不能仅凭 WebGL 就推断它必然更适合全部交互。 |

渲染方式需要按当前版本说明：Cytoscape.js 官方曾发布 WebGL renderer preview，并说明 Canvas 与 WebGL 的样式和性能取舍，不能说它永久只有 Canvas。[官方 WebGL 说明](https://blog.js.cytoscape.org/2025/01/13/webgl-preview/)。建议以所锁定稳定版本的标准渲染路径验证当前交互，额外渲染模式按样式支持及真实测量评估，不把预览或未来重构能力写成已完成交付。

Sigma 当前官网覆盖 v4，官方发行页已列出 `sigma@4.0.4`；不能引用旧版文档的 alpha 提示断言当前 v4 仍是 alpha。v4 使用 WebGL2，调整了样式、primitives 和标签渲染等接口。[Sigma Releases](https://github.com/jacomyal/sigma.js/releases)、[Lifecycle](https://www.sigmajs.org/concepts/lifecycle/)。因此采用时需锁定同一代文档及包版本，不混用 v3/v4 教程。此处报告核验时的状态，不预先选定项目依赖版本。

两条路线均有真实 API 与维护活动，以上推荐依据是项目交互及集成方式，而非将其中一条说成过时。没有进行两库或两组件的性能对比，没有用户已确认的节点规模或“万节点流畅”承诺。

## 与已确认功能的技术映射

以下是推荐的实现职责，不新增页面流程、按钮或业务规则。

| 已确认能力 | 建议的图适配方式 | 应用仍需负责 |
| --- | --- | --- |
| 主图默认知识点，关系浏览 | 将查询结果映射为稳定知识点 ID 的节点，以及显式所属主题边。 | 查询范围、资料信息与当前正式状态由应用提供，不能把界面中没加载到的对象视为不存在。 |
| 搜索点击定位并突出 | 根据知识点 ID 找到图元素，改变选择样式并移动视口；Cytoscape 的 ID 与视口 API 有对应能力。[ID 查询](https://js.cytoscape.org/#cy.getElementById)、[视口 API](https://js.cytoscape.org/#viewport-manipulation)。 | 未加载目标需获取相应图数据；副本更新中或 Neo4j 不可用时遵守已确认状态政策，不能假报无结果。 |
| 主题多归属 | **同一节点连接多个主题节点，使用多条普通边。** | 不复制同一知识点，也不把多归属解释成多个独立实体。 |
| 资料按需展开 | 应用获取资料引用后增补带类型的显示节点/边，收起时仅改变显示集合。 | 资料身份、信息和关联仍由 PG 正式记录决定；本体按已选对象存储和查看路径处理。 |
| 图上编辑、删除 | 图事件转成应用命令，应用返回结果后更新显示。 | PG 正式保存、共享节点保留、主题删除影响和回收状态按业务规则处理，不能以 `cy.remove()` 代替业务删除。 |

多主题尤其不能误用 Cytoscape 的 compound `parent` 字段：该字段表达图显示中的包含父节点，不是本项目可多对多的所属主题语义。官方分别定义普通边的 source/target 与 compound parent，采用普通关系边是本项目据此作出的建模建议。[Elements 与 Compound Nodes](https://js.cytoscape.org/#notation/elements-json)。

适配层应暴露应用实际需要的“更新显示集合、选中目标、定位目标、更新状态、销毁实例”等操作，不向业务代码散布整套图库 API。它既便于测试，也保留以后替换 renderer 的空间；不提前建设多渲染引擎插件平台。

## 普通 UI 控件与验证边界

可采用 Ant Design 为输入、列表、表单和反馈提供基础控件。官方说明其为 React 组件库、提供 TypeScript 类型和主题能力。[Ant Design of React](https://ant.design/docs/react/introduce/)。这是可替换的组件层推荐，不选择 Ant Design Pro、Umi 或另一套应用框架，也不让控件库决定业务流程和图布局。

后续验证应覆盖：固定包版本与 TypeScript 构建、Tauri WebView 中点击和定位、增量展开后的状态、组件清理、图更新中与故障显示，以及代表性图数据的加载/布局/缩放。图量、边密度、标签、样式、布局算法、WebView 和显卡都会影响实际体验，应测量后再给容量或性能结论。图谱组件本身不代替后端图查询，也不改变 PG 权威和 Neo4j 可重建副本的已选架构。

用户已确认片段匹配，AND/OR 可由最终用户选择；前端只表达查询条件，不因本次图组件选择改变搜索规则。本文不继续追问颜色、按钮或布局偏好，不重开导入导出、备份恢复或部署细节。
