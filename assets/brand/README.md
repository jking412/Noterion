# Noterion 图标 / Icon

**Noterion = Note + Orion（猎户座）。** 分散的学习知识如星点，联系让人能循线找回。正式标志将一条连续的 **N 路径**与一个**暖金星点**结合，表达“记下来、找回来、用起来”；不描摹整幅星座，也不在小图标内加入文字。

**Noterion = Note + Orion.** Scattered learning becomes a structure you can find your way through. The mark combines a continuous **N-shaped path** with a single **warm gold point**, expressing capture, rediscovery and reuse. It does not depict a full constellation or contain small lettering.

## 文件 / Files

| 文件 / File | 用途 / Use |
| --- | --- |
| [noterion-icon.svg](noterion-icon.svg) | 可编辑正式主稿，512 × 512 坐标；唯一几何与配色来源。 / Editable master on a 512 × 512 canvas; the source of geometry and color. |
| [noterion-icon.png](noterion-icon.png) | 1024 × 1024 RGBA 高清 PNG，磁贴四周及圆角外透明。 / High-resolution RGBA PNG with transparent outer margins and corners. |
| [noterion.ico](noterion.ico) | Windows ICO，包含 16、20、24、32、40、48、64、128、256px 九个独立帧。 / Nine embedded Windows icon sizes. |
| `noterion-{size}.png` | 与 ICO 对应的九种尺寸；[16px](noterion-16.png) 与 [32px](noterion-32.png) 可直接检查原尺寸效果。 / Matching PNG exports, including actual-size 16px and 32px previews. |
| [export-brand.cjs](../../scripts/export-brand.cjs) | 从 SVG 导出上述资源并同步客户端。 / Exports the master and updates client assets. |

导出脚本同时更新 `app/src-tauri/icons/icon.ico`（EXE）、`app/src-tauri/icons/icon.png`（256px 运行窗口图标）、`app/public/favicon.svg`、`app/public/favicon.png`（32px）及 `app/public/brand-icon.png`（128px）。原生窗口使用独立 PNG，避免窗口从 ICO 第一帧的小图放大。

The exporter also updates the EXE icon, the 256px native window icon, the SVG/32px PNG favicons and the 128px in-app mark. The native window uses its own PNG to avoid enlarging the first small frame of the ICO. On Windows, `src-tauri/src/branding.rs` explicitly sets the taskbar's big icon from the same embedded ICO resource at the window's scale factor; this is separate from Tauri's title-bar icon.

## 配色与留白 / Color and spacing

| 颜色 / Color | 色值 / Hex | 角色 / Role |
| --- | --- | --- |
| 浅米 / Warm ivory | `#F5F1E8` | N 路径 / N path |
| 墨深 / Ink | `#202729` | 磁贴与星点隔离圈 / Tile and point separation |
| 暖金 / Warm gold | `#E8B66A` | 唯一星点 / Single point |
| 边界 / Edge | `#465052` | 磁贴细边 / Subtle tile outline |

- 图标外侧至少保留 **1/8 图标宽度**的安全空间；以 512px 图标计，周围留出至少 64px。源文件自带的透明边缘不替代与其他元素之间的外部留白。
- 深、浅背景均使用完整的深底磁贴，包括细边与透明圆角。不要单独抠出米色 N，也不要新增光晕、投影、渐变、第二颗星或图标内文字。
- 16px、32px 仍沿用同一几何，不增加微小细节。保持正方形比例，不拉伸、旋转或裁掉磁贴。

Leave clear space of at least **one eighth of the icon width** on every side: 64px around a 512px icon. The source's transparent margins do not replace external clear space. Use the complete dark tile on both light and dark backgrounds, including its outline and transparent corners. Do not extract the ivory N, add effects or lettering, or change the geometry at 16px/32px. Keep the square proportions and do not stretch, rotate or crop the tile.

## 重新导出 / Regenerate

修改配色或构成时先编辑 SVG，再统一导出；不要单独修改 PNG/ICO。工具只用于维护品牌资产，已导出的资源随仓库提供，客户端正式构建无需安装或运行 sharp。

Edit the SVG before changing any color or shape, then regenerate all exports together. Do not edit individual PNG/ICO files. This is an optional asset-authoring tool; normal client builds use the committed assets and do not install or run sharp.

本次导出环境中 bundled sharp 的 `package.json` 版本已核实为 **0.35.5**。要在普通 Node.js 环境复现，在仓库根目录使用以下 PowerShell 命令；依赖安装到 `.scratch/brand-tools/`，不加入 `app/package.json` 或应用锁文件：

The bundled sharp package used for this export was verified as **0.35.5**. To reproduce with a regular Node.js installation, run these PowerShell commands from the repository root. Authoring dependencies stay in `.scratch/brand-tools/`, outside the client manifest and lockfile:

```powershell
npm.cmd install --prefix .scratch/brand-tools --no-save --package-lock=false sharp@0.35.5
$env:NODE_PATH = (Resolve-Path .scratch/brand-tools/node_modules).Path
node scripts/export-brand.cjs
```

完成后检查导出的 16px/32px PNG、透明边缘及九帧 ICO，并重新构建客户端检查 EXE、窗口、任务栏与 favicon 的实际显示。

After export, inspect the 16px/32px PNGs, alpha margins and nine ICO frames, then rebuild the client and check the actual EXE, window, taskbar and favicon presentation.

## 制作记录 / Provenance

AI 概念探索保存在 [logo-exploration.png](../../.scratch/product-launch/concepts/logo-exploration.png)。正式稿在探索后以手工 SVG 几何规范化，PNG 与 ICO 均由该主稿确定性导出；正式图标不是从品牌板截图或抠图得到。概念预览不作为客户端界面截图使用。本说明记录设计与制作过程，不表示商标已注册或具有独占权。

The [AI concept exploration](../../.scratch/product-launch/concepts/logo-exploration.png) informed the direction. The final mark was then normalized as manually authored SVG geometry; PNG and ICO assets are deterministic exports of that master, not crops from a brand board. Concept artwork is not used as a client screenshot. This record does not claim trademark registration or exclusivity.
