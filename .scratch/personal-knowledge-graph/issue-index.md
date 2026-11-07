# Noterion：GitHub Issue 索引

发布日期：2026-11-07（Asia/Shanghai）。

已按用户确认的安排发布 18 项任务，包含 12 项实现和 6 项原型、询问或技术验证。此文件仅用于导航；任务内容、标签、依赖与最新进度以 [GitHub Issues](https://github.com/jking412/Noterion/issues) 为准，不维护第二套本地完成状态。

| 计划序号 | GitHub Issue | 类型 | 直接阻塞项 |
| --- | --- | --- | --- |
| 01 | [[原型] 核心桌面体验的可点击原型](https://github.com/jking412/Noterion/issues/1) | 原型 | 无 |
| 02 | [[询问] 基于原型确认布局和关键操作](https://github.com/jking412/Noterion/issues/2) | 询问 | [#1](https://github.com/jking412/Noterion/issues/1) |
| 03 | [[技术验证] 验证真实 Windows 桌面验收路径](https://github.com/jking412/Noterion/issues/3) | 技术验证 | 无 |
| 04 | [[实现] 在桌面端新建、编辑并保存知识点](https://github.com/jking412/Noterion/issues/4) | 实现 | [#2](https://github.com/jking412/Noterion/issues/2)、[#3](https://github.com/jking412/Noterion/issues/3) |
| 05 | [[实现] 让知识点进入真实图谱并显示更新状态](https://github.com/jking412/Noterion/issues/5) | 实现 | [#4](https://github.com/jking412/Noterion/issues/4) |
| 06 | [[询问] 确认所属主题关系的未决边界](https://github.com/jking412/Noterion/issues/6) | 询问 | [#1](https://github.com/jking412/Noterion/issues/1) |
| 07 | [[实现] 以多个主题组织同一个知识点](https://github.com/jking412/Noterion/issues/7) | 实现 | [#5](https://github.com/jking412/Noterion/issues/5)、[#6](https://github.com/jking412/Noterion/issues/6) |
| 08 | [[实现] 搜索名称和描述并在图谱定位](https://github.com/jking412/Noterion/issues/8) | 实现 | [#5](https://github.com/jking412/Noterion/issues/5) |
| 09 | [[实现] 关联、复用并打开链接资料](https://github.com/jking412/Noterion/issues/9) | 实现 | [#4](https://github.com/jking412/Noterion/issues/4) |
| 10 | [[技术验证] 验证所用对象存储接口的真实兼容性](https://github.com/jking412/Noterion/issues/10) | 技术验证 | 无 |
| 11 | [[实现] 将文件保存到对象存储并重新打开](https://github.com/jking412/Noterion/issues/11) | 实现 | [#4](https://github.com/jking412/Noterion/issues/4)、[#10](https://github.com/jking412/Noterion/issues/10) |
| 12 | [[实现] 在应用内只读查看 PDF 和图片](https://github.com/jking412/Noterion/issues/12) | 实现 | [#11](https://github.com/jking412/Noterion/issues/11) |
| 13 | [[技术验证] 验证大视频在真实 WebView 中按需读取](https://github.com/jking412/Noterion/issues/13) | 技术验证 | [#3](https://github.com/jking412/Noterion/issues/3)、[#10](https://github.com/jking412/Noterion/issues/10) |
| 14 | [[实现] 保存并按需播放大视频资料](https://github.com/jking412/Noterion/issues/14) | 实现 | [#11](https://github.com/jking412/Noterion/issues/11)、[#13](https://github.com/jking412/Noterion/issues/13) |
| 15 | [[实现] 直接删除知识点并保留资料](https://github.com/jking412/Noterion/issues/15) | 实现 | [#8](https://github.com/jking412/Noterion/issues/8)、[#9](https://github.com/jking412/Noterion/issues/9)、[#11](https://github.com/jking412/Noterion/issues/11) |
| 16 | [[实现] 删除主题并按归属规则处理下属知识点](https://github.com/jking412/Noterion/issues/16) | 实现 | [#7](https://github.com/jking412/Noterion/issues/7)、[#15](https://github.com/jking412/Noterion/issues/15) |
| 17 | [[实现] 完整验证 Neo4j 故障下的使用与同步追赶](https://github.com/jking412/Noterion/issues/17) | 实现 | [#8](https://github.com/jking412/Noterion/issues/8)、[#9](https://github.com/jking412/Noterion/issues/9)、[#11](https://github.com/jking412/Noterion/issues/11) |
| 18 | [[实现] 提供从 PostgreSQL 重建图谱的维护能力](https://github.com/jking412/Noterion/issues/18) | 实现 | [#16](https://github.com/jking412/Noterion/issues/16)、[#17](https://github.com/jking412/Noterion/issues/17) |

原型走查与所属主题边界询问使用 `ready-for-human`，其他 16 项使用 `ready-for-agent`。分流标签不代替依赖判断。

当前无阻塞的起点是[核心桌面体验原型](https://github.com/jking412/Noterion/issues/1)、[Windows 桌面验收验证](https://github.com/jking412/Noterion/issues/3)和[对象存储兼容验证](https://github.com/jking412/Noterion/issues/10)。执行时重新检查实时依赖和领取情况。

完整图库故障演练与图谱重建仍在本次范围内，安排在主要功能之后；各主要功能自身的基本保存、同步和删除正确性随对应工单完成。
