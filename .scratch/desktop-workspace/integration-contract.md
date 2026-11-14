# #32 / #33 空间与导入接合约定

记录日期：2026-11-14。正式协作讨论见 [#32](https://github.com/jking412/Noterion/issues/32#issuecomment-6849577503) 与 [#33](https://github.com/jking412/Noterion/issues/33#issuecomment-6849575899)。

## 已实施的外壳边界

`app/src/components/DesktopShell.vue` 提供 `workspace` 命名插槽。它位于品牌下方、主导航上方，在图谱、资料、导入及设置之间保持相同位置。侧栏默认 208px，较窄窗口 184px；收起或宽度不超过 850px 时为 72px 图标栏。插槽容器始终 `min-width:0`，名称内容应支持截断，菜单应通过 Teleport/popover 脱离侧栏滚动与裁剪。

`DesktopShell` 接收 `view` 和 `disabled`，导航事件为 `navigate('graph' | 'resources' | 'import' | 'models')`，应用数据位置属于设置内部的 `data` 视图。它不读写空间或知识，不创建假列表。当前 `App.vue` 插入“本机知识”单数据根标识；该名称不是可点击的空间切换器。

## #32 提供后才接入的功能

#32 负责真实空间身份、列表、当前名称、创建、切换、重命名、持久化及数据隔离。提议组件 `SpaceSwitcher.vue` 由其 composable 驱动，接收 `disabled: boolean`，成功切换后发出 `changed`；最终名称以 #32 明确提交协商。

根组件接到成功切换后需重新读取当前空间 snapshot，清除搜索、选中、预览、编辑、删除确认、AI 会话及导入候选；正在运行的任务、迟到结果和未保存编辑由双方真实契约处理。模型连接保持应用级配置，不能跟随知识空间错误复制或覆盖凭据。

文件夹入口、扫描、逐文件处理、采用/跳过/重试与当前批次反馈属于 #32 的 `ImportWorkspace` 功能。#33 的输入、候选和编辑布局按可用容器宽度重排；不得再引入长期导入历史页面。

#32 已提供 `f63048b550a9e8619148065d6f34c0732011ba74`（`feat: isolate knowledge spaces and import note folders (#32)`）。当前进入接合，真实空间切换、长空间名、跨空间任务/候选清理及批量导入布局仍需在集成客户端验收。只合并明确提交，不复制另一会话未提交代码。

## UI 交付规则

接入任务必须再次提醒根 `AGENTS.md` Product UI：删除不必要说明性小字、常驻机制/工程解释和开发测试验收信息，不挪到 Tooltip/折叠区；只保留任务内容、操作及简短真实状态和错误。整合后在真实客户端检查默认、空白、加载、成功、失败和相关弹窗；代码检查与编译不能替代显示验收。
