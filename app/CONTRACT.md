# Desktop implementation interface (#21)

The frontend uses `window.__TAURI__.core.invoke`. All mutations resolve only after durable commit and return a full `Snapshot`. Errors reject with a readable Chinese string; the caller preserves its draft and previous data. One command runs at a time in the UI. No IDs are rendered or entered by users.

`Snapshot`: `{points, resources, positions, root, revision}`. Point and resource shapes match `src/domain/types.ts`; resource adds `status?: 'ready'|'missing'`, `mime`, `size`, `filename`. Internal managed path never comes from the UI. Resources use `kind: 'video'` for video. Positions are optional, keyed by point identity.

Core commands (Rust module `store.rs`, public `Store` shared as `Arc<Mutex<Store>>`):
- `app_load()` -> Snapshot. Does not create an absent previously selected store.
- `directory_select(path: string, create: boolean)` -> Snapshot. Explicit create/open; existing data never overwritten. Persist chosen root beside executable. Default root is `exe-parent/data`, only first use may create it. `NOTERION_CONFIG_DIR` overrides config/default location for isolated desktop acceptance.
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

Store implementation exposes `pub fn resolve_file(&self,id:&str)->Result<(PathBuf,String,u64),String>`, `pub fn add_copied_file(&mut self, id:String, filename:String, title:String, mime:String, kind:String, size:u64, point_ids:Vec<String>)->Result<Snapshot,String>`, `pub fn files_dir(&self)->Result<PathBuf,String>`, `pub fn snapshot(&self)->Result<Snapshot,String>`. Managed filename is the generated identity (extension may be retained), original filename is metadata. Root does not change during a copy: compare files_dir before commit.

The same L2 graph, L4 page structure and S1 styling are reused. Import and import history navigation truthfully state #20 pending. Graph rendering errors have an error boundary; facts/search/details remain available.
