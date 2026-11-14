# Issue #33：Cherry Studio 布局参考核对

查阅日期：2026-11-14（Asia/Shanghai）。正式任务来源：[Noterion #33](https://github.com/jking412/Noterion/issues/33)。用户已选择原型 **B：完整导航与浮动面板**；本记录解释参考依据，不替代工单验收，也不表示最终客户端已经验收。

## 核对方式与来源

实际打开并查看了官方仓库中的两张原始 WebP 图片，按图片中的可见布局记录观察。官方 README 与使用文档另外用于核对页面身份和侧栏能力。图片链接指向 `main`，可能随上游更新；以下观察以本次查阅内容为准。

| 来源 | 本次用途 |
| --- | --- |
| [Cherry Studio 官方仓库 README](https://github.com/CherryHQ/cherry-studio#-screenshots) | README 将 Model providers 与 Knowledge bases 列为不同工作区域，核对参考产品的功能背景。 |
| [官方知识管理截图](https://github.com/CherryHQ/cherry-studio/blob/main/.github/images/readme/knowledge-light-en.webp)（[原图](https://raw.githubusercontent.com/CherryHQ/cherry-studio/main/.github/images/readme/knowledge-light-en.webp)） | 直接观察全局侧栏、知识库列表、当前内容区和任务操作的位置。 |
| [官方模型设置截图](https://github.com/CherryHQ/cherry-studio/blob/main/.github/images/readme/provider-light-en.webp)（[原图](https://raw.githubusercontent.com/CherryHQ/cherry-studio/main/.github/images/readme/provider-light-en.webp)） | 直接观察设置分类、提供方列表与配置区域的层级。 |
| [官方使用文档](https://www.cherryai.com/docs/en/) | 文档的 “Custom Sidebar Menu” 条目明确说明侧栏功能可以隐藏或重排；这说明侧栏承载功能导航，不要求 Noterion 同时实现这些自定义能力。 |

## 实际可见的信息组织

知识管理截图从左到右呈现窄的全局图标侧栏、知识库名称列表、当前知识库的资料表格。全局侧栏中的知识库图标有选中背景，帮助与设置位于底部。知识库列表又以填充背景标明当前项；主内容顶部重复当前知识库名称，并在附近放置测试、设置、添加来源等当前任务操作。资料表格占据主要宽度，列出名称、类型、状态和更新时间。截图顶部还有工作区域标签，因此不能把它描述成“只有左侧导航”。这些是静态图片的可见事实，未通过截图推断切换、保存或隔离的实际行为。[来源：官方知识管理截图](https://github.com/CherryHQ/cherry-studio/blob/main/.github/images/readme/knowledge-light-en.webp)。

模型设置截图使用设置自身的层级：左列为设置分类，中列为模型提供方，右列为选中提供方的 API Key、地址和模型。分类与提供方各有独立的选中态；右侧配置只围绕当前提供方展开。它没有把主工作区的所有业务导航再次横向堆在配置上方。这里采用的是“先选择类别，再选择对象，再编辑该对象”的组织原则，不照搬其全部字段、模型目录或提供方能力。[来源：官方模型设置截图](https://github.com/CherryHQ/cherry-studio/blob/main/.github/images/readme/provider-light-en.webp)。

## B 方案在 Noterion 中的对应

以下是基于上述观察和 Noterion 任务作出的设计判断，不是对 Cherry Studio 功能或交互的额外事实主张。

| 采用原则 | Noterion B 方案的对应 | 选择理由与边界 |
| --- | --- | --- |
| 全局导航位置稳定，选中态明确 | 左侧完整文字导航提供知识图谱、资料库、知识导入；底部进入应用设置。顶部显示当前页面及相关操作。 | Noterion 主要入口较少，完整文字比永久窄图标更适合直接识别；用户已明确选择 B。窄窗口与手动收起仍需保持可达。 |
| 当前上下文拥有固定位置 | 左栏品牌下方保留当前空间入口容器，在业务页与设置页保持位置一致。 | #32 负责真实身份、创建、切换、重命名与数据隔离；#33 负责容器、宽度和层级。当前静态单库名称不构成多空间能力，最终接入只使用已提交的正式组件。 |
| 主内容拥有尽可能多的操作空间 | 图谱画布为主工作区；搜索与知识详情在其上浮动，资料库、导入与设置使用同一外壳。 | 浮动搜索/详情是为了 Noterion 的图谱定位、拖动与缩放作出的选择，不能声称来自上述 Cherry Studio 截图。面板遮挡、窄窗口切换与焦点需要在真实客户端验收。 |
| 操作归于相关任务 | 图谱标题区放搜索与新建知识点，资料操作归资料库，候选核对与采用归知识导入。 | 避免每页重复一排全局菜单，让页面主要空间留给当前任务。导入成功可进入图谱、定位知识或继续导入。 |
| 设置内部区分类别与对象 | 应用设置区分模型设置、数据位置；模型配置按连接类型选择并显示对应字段。 | 保留现有连接检查、保存、启用和凭据隔离；不因视觉参考引入新的提供方聚合或模型目录功能。 |

当前实现核对点：`app/src/components/DesktopShell.vue` 提供统一外壳及 `workspace` / `actions` 插槽；`app/src/App.vue` 放置页面、空间容器及图谱浮动面板。此记录只核对布局意图，具体行为和界面状态以本次真实 Windows 客户端验收报告为准。

## 保留范围与排除项

Noterion 保留已确认的品牌、新图标、个人知识图谱定位和原生 Windows 窗口。上述截图中的标签式多工作区、聊天、助手、绘图、翻译、MCP、Skills、渠道、提供方市场及完整设置目录不随参考一起引入。官方 README 表明这些属于 Cherry Studio 自身更广的 AI 工作站功能；#33 的交付仍限于工单约定的知识工作区与既有能力。[来源：官方 README](https://github.com/CherryHQ/cherry-studio)。

文案规则直接来自 Noterion 根 `AGENTS.md`，不由参考产品决定：正式 UI 只保留任务需要的内容、操作与真实状态；不必要的说明性小字、常驻机制解释、工程术语及开发/测试/验收信息直接删除，不转移到 Tooltip 或折叠区。必要字段标签、输入示例和简短可操作的状态与错误保留。模型设置与所有修改页面的默认、空白、加载、成功、失败及相关弹窗都需要实际查看；本研究不是该项验收的替代证据。
