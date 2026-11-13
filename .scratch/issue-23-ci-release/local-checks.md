# Issue #23 local checks

Date: 2026-11-13 (Asia/Shanghai). Scope: the dedicated `codex/issue-23-windows-release` worktree, starting at `85940d8de4ca33f0486a6e3c4418f8fa67a62397`, with this issue's working changes. This record is local evidence, not proof of a GitHub-hosted run or a downloaded Release.

## Toolchain and dependencies

- Node `v24.14.0`; npm `11.9.0`.
- Rust `rustc 1.93.1 (01f6ddf75 2026-02-11)`, Cargo `1.93.1`, MSVC x64 with Visual Studio developer environment.
- The newly pinned `1.93.1` rustup alias attempted a fresh download, but waited during component downloads. That local attempt was cancelled. Local Rust checks explicitly used the already installed `RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc`, whose actual compiler version is exactly `1.93.1`. GitHub must independently install the pinned toolchain; this local alias workaround is not a Runner prerequisite.
- Used normal `CARGO_HOME`, never the historical `.scratch/.../.cargo-home` or target. The worktree initially had no `app/src-tauri/target`; local Cargo downloaded missing dependencies into its normal cache. Existing global cache entries were available, so this is not a claim of an empty Cargo cache.
- Official registry queries returned the locked versions `vue@3.5.45`, `vite@8.3.6`, and `vitest@5.1.0`; no package version downgrade was needed.

## Frontend

From `app/`:

```powershell
npm.cmd ci --cache .npm-cache
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Results: installation succeeded (88 packages); type checking passed; Vitest ran **5 test files / 54 tests**, all passed; Vite production build passed (114 transformed modules). No credentials, private media, data directory, or AI calls were required.

## Rust feedback loop

```powershell
cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
cargo clippy --locked --manifest-path app/src-tauri/Cargo.toml --all-targets --target x86_64-pc-windows-msvc -- -D warnings
cargo test --locked --manifest-path app/src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
```

Initial format check passed. Initial Clippy failed at `src/store.rs:291`, `Store::add_copied_file`: **8 arguments exceeded the 7-argument lint threshold**. The implementation grouped the six file fields into `CopiedFile` and updated the sole caller. Clippy then passed with `-D warnings` unchanged. Rust test execution passed and explicitly reported **0 tests**; that result does not validate Rust business behavior. The real packaged executable smoke must independently cover storage through the visible UI and across restart.

## Optimized Windows build

`./app/build.ps1 -Release` passed. Cargo reported `Finished release profile [optimized]` in 1m54s, compiling into this worktree's new x64 target directory. The script copied the executable to `app/dist-desktop/noterion.exe`.

- Executable size: **10,531,328 bytes**.
- SHA-256: `982a2f7f9b65f1e9d3c3f0407344f98da351bac6b11925daabc06df366c96aa4`.
- The front end was rebuilt by the script before Rust compilation. This artifact still needs real packaged/downloaded UI validation; compilation is not a launch assertion.

## Boundaries

These checks do not establish PR/main triggers, GitHub permissions, release upload/download integrity, rerun/concurrency behavior, WebView2 interaction, full large-media acceptance, or any live DeepSeek integration. Those require their own current evidence. Historical Issue #21 evidence was not reused as a current pass.
