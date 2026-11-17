# Desktop implementation interface (#21)

The frontend uses `window.__TAURI__.core.invoke`. All mutations resolve only after durable commit and return a full `Snapshot`. Errors reject with a readable Chinese string; the caller preserves its draft and previous data. One command runs at a time in the UI. No IDs are rendered or entered by users.

`Snapshot`: `{points, resources, positions, root, revision, spaceId, epoch, spaces}`. `spaces` is `{id,name}[]`. All points, resources, positions and revision belong to `spaceId`. Point and resource shapes match `src/domain/types.ts`; resource adds `status?: 'ready'|'missing'`, `mime`, `size`, `filename`. Internal managed path never comes from the UI. Resources use `kind: 'video'` for video. Positions are optional, keyed by point identity.

## Space context (#32)

Every data read/write command except initial `app_load` carries the expected `spaceId` and `epoch`. `desktop.invoke` supplies the current context by default; asynchronous work explicitly captures its originating context. Rust rejects stale contexts. The epoch changes even when switching A → B → A. Initial data-directory recovery can use the unloaded context, without granting access to a different loaded space.

- `space_create(name,spaceId,epoch)` → Snapshot; creates an empty space and selects it.
- `space_switch(id,spaceId,epoch)` → Snapshot; persists the recent space and advances epoch.
- `space_rename(id,name,spaceId,epoch)` → Snapshot; stable identity and existing content remain.
- `SpaceSwitcher.vue` accepts `spaces`, `currentId`, `busy`, `switchSpace(id)`, `createSpace(name)`, `renameSpace(id,name)` callbacks. App owns confirmation of discarded drafts/tasks and state reset; layout can relocate the component without duplicating state.
- Media streams capture the same context and stop serving after a switch. Managed copies share the root/files directory, while only the current space's resource records authorize access.
- Model connections and credentials remain application-level; switching spaces does not configure or overwrite them.

## Folder import (#32)

- `folder_scan(path,requestId,spaceId,epoch)` → `{scanId,files:[{id,relativePath,size,error?}],warnings:[{relativePath,error}]}`. Recursively lists case-insensitive `.md`/`.txt`, never follows symbolic links or Windows reparse entries.
- `folder_cancel_scan(requestId,spaceId,epoch)` stops that request only. Cancellation arriving before startup also rejects that request; a late cancel cannot interrupt a later scan or discard completed file capabilities.
- `folder_read(scanId,fileId,spaceId,epoch)` → `{text,sourceName}`; reads one trusted scan entry, up to 256 KiB, with strict UTF-8 decoding.
- `folder_prepare(scanId,fileId,spaceId,epoch)` → `{text,sourceName,sourceResourceId,snapshot}`; saves or reuses a durable managed source copy before explicit parsing. The source identity includes space, relative path and file content.
- `folder_discard(scanId)` releases a short-lived scan capability.
- ImportWorkspace receives `spaceId`, `epoch`, emits `snapshot` after source preparation and `dirty` for switch protection, and keeps the existing `start`, `adopt`, `cancel` interaction. Its parent remounts it on context changes.
- File states belong only to the current batch. Candidates retain their source relative path and pass the existing explicit adoption checks. Retry/cancel preserves committed knowledge; persistent adoption receipts remain space scoped.

Core commands (Rust module `store.rs`, public `Store` shared as `Arc<Mutex<Store>>`):
- `app_load()` -> Snapshot. Does not create an absent previously selected store.
- `directory_select(path: string, create: boolean)` -> Snapshot. Explicit create/open; existing data never overwritten. Persist only the directory pointer in `%LOCALAPPDATA%/Noterion/directory.json`. Default formal data root is `exe-parent/data`, only first use may create it. `NOTERION_CONFIG_DIR` overrides config/default location for isolated desktop acceptance.
- `point_save(point: KnowledgePoint, creating: boolean)` -> Snapshot. Generate identity in Rust for creates, enforce names, references, arbitrary cycle prevention.
- `delete_preview(id: string)` -> `{deletedIds, retainedIds}`.
- `point_delete(id: string, revision: number)` -> Snapshot, reject stale preview.
- `resource_add_link(title: string, url: string, pointIds: string[])` -> Snapshot.
- `resource_associate(id: string, pointIds: string[])` -> Snapshot.
- `resource_remove(id: string)` -> Snapshot; keep managed file (safe retention).
- `point_move(id: string, position: {x,y})` -> Snapshot.

Media commands (root-owned `media.rs`):
- `choose_file()` -> string|null (native file picker; only path, no bytes).
- `choose_directory()` -> string|null.
- `resource_add_file(path: string, title: string, pointIds: string[], jobId: string)` -> Snapshot. Blocking work off UI thread; buffered copy, cancel checks, sync complete file before record commit.
- `copy_cancel(jobId: string)` -> void.
- `media_open(id: string)` -> `{url, mime, size}` for managed copy, or rejects if missing. Tokenized in-process streaming HTTP endpoint supports Range/full requests and cancels when viewer closes/disconnects; no external server.
- `media_close(url: string)` -> void, revoke stream token.
- `resource_external(id: string)` -> void, system association for file/http(s) link.

Store implementation exposes `pub fn resolve_file(&self,id:&str)->Result<(PathBuf,String,u64),String>`, `pub fn add_copied_file(&mut self, file:CopiedFile, point_ids:Vec<String>)->Result<Snapshot,String>`, `pub fn files_dir(&self)->Result<PathBuf,String>`, `pub fn snapshot(&self)->Result<Snapshot,String>`. `CopiedFile` contains `id`, `filename`, `title`, `mime`, `kind` (all `String`) and `size: u64`; it describes the completely copied file before its formal resource record is committed. Managed filename is the generated identity (extension may be retained), original filename is metadata. Root does not change during a copy: compare files_dir before commit.

The desktop shell uses persistent left navigation for graph, resources and import, with application settings at the bottom. `DesktopShell` exposes a `workspace` slot for the real `SpaceSwitcher` (`spaces/currentId/busy` plus async boolean switch/create/rename callbacks). Its button opens a top-layer management dialog and remains operable when navigation is collapsed. `App` confirms discarding unfinished work and remounts context-bound panels with `root:spaceId:epoch`. Graph rendering errors have an error boundary and a reload action. The user-visible import-records page and route are removed; internal adoption receipts remain part of the storage contract.
