# Client screenshots

These are direct W3C WebDriver element screenshots of the real Windows x64 release EXE built for [Issue #25](https://github.com/jking412/Noterion/issues/25), not a browser mockup or generated UI. The `.canvas-workspace` element was captured directly so no local filesystem path appears in the public image. No page styling, data, or IPC was injected to prepare the view.

- `knowledge-graph.png`: 11 synthetic knowledge points, three themes, one point shared by Docker and Linux operations, its description, command, personal understanding and source link.
- `knowledge-search.png`: the same saved knowledge located by the `容器终端` query.

All knowledge was entered through visible create/edit forms and saved by the Rust core. The resource is a public Docker documentation link; it was associated through the resource form. No API key, personal knowledge, or live AI answer was used. The screenshot includes the source version's AI entry, while the older public prerelease does not include AI. Both README editions state this difference.

The reproduction script is [capture-client.mjs](../../.scratch/product-launch/capture-client.mjs). Driver/config/profile files remain in the ignored `app/smoke-output/` directory. Native title-bar, taskbar and EXE icon evidence is separate from these product screenshots.
