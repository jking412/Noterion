# #32 / #33 空间与导入接合约定

记录日期：2026-11-14。正式协作讨论见 [#32](https://github.com/jking412/Noterion/issues/32#issuecomment-6849577503) 与 [#33](https://github.com/jking412/Noterion/issues/33#issuecomment-6849575899)。

## 已实施的外壳边界

`app/src/components/DesktopShell.vue` 提供 `workspace` 命名插槽。它位于品牌下方、主导航上方，在图谱、资料、导入及设置之间保持相同位置。侧栏默认 208px，较窄窗口 184px；收起或宽度不超过 850px 时为 72px 图标栏。插槽容器始终 `min-width:0`，名称支持截断，管理界面通过 `ModalShell` 的原生 `dialog.showModal()` 顶层显示，脱离侧栏滚动与裁剪。

`DesktopShell` 接收 `view` 和 `disabled`，导航事件为 `navigate('graph' | 'resources' | 'import' | 'models')`，应用数据位置属于设置内部的 `data` 视图。它不读写空间或知识。`App.vue` 已在此插入 #32 真实 `SpaceSwitcher`；侧栏显示真实名称，收起后保留图标入口。入口打开顶层空间弹窗，包含真实列表、创建与重命名。

## 实际组件契约

#32 负责真实空间身份、列表、当前名称、创建、切换、重命名、持久化及数据隔离。`SpaceSwitcher.vue` 接收 `spaces/currentId/busy`，以及返回 `Promise<boolean>` 的 `switchSpace(id)/createSpace(name)/renameSpace(id,name)`。#33 仅适配入口和弹窗布局；真实调用、放弃确认和重置由 `App.vue` 负责。入口 `space-menu` 的 `data-current-space` 与实际 snapshot 一致，列表只在管理弹窗中渲染。

根组件通过 `useNoterion.spaceSwitch/Create/Rename` 接收真实 snapshot。`spaceKey=root:spaceId:epoch` 用于重新挂载资料、导入、AI 面板和预览；成功切换清除搜索、选中、预览、编辑、删除确认、AI 会话及导入候选。未保存编辑/候选/资料操作/AI 任务先触发放弃确认，取消保留当前工作。导入读文件、采用及任务均校验原空间和 epoch，迟到结果不能回灌。模型连接保持应用级配置。

文件夹入口、扫描、逐文件处理、采用/跳过/重试与当前批次反馈属于 #32 的 `ImportWorkspace` 功能。该组件必需 `spaceId/epoch`，保留 `start/adopt/cancel` 并发出 `snapshot/dirty`。#33 保留按可用容器宽度重排的输入、候选、编辑和批次清单；采用后提供进入图谱、处理下一份或继续导入，不恢复长期导入历史页面。

#32 已提供 `f63048b550a9e8619148065d6f34c0732011ba74`（`feat: isolate knowledge spaces and import note folders (#32)`）。当前进入接合，真实空间切换、长空间名、跨空间任务/候选清理及批量导入布局仍需在集成客户端验收。只合并明确提交，不复制另一会话未提交代码。

## UI 交付规则

接入任务必须再次提醒根 `AGENTS.md` Product UI：删除不必要说明性小字、常驻机制/工程解释和开发测试验收信息，不挪到 Tooltip/折叠区；只保留任务内容、操作及简短真实状态和错误。整合后在真实客户端检查默认、空白、加载、成功、失败和相关弹窗；代码检查与编译不能替代显示验收。
