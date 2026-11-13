# Issue #23 remote execution evidence

All times below are UTC, as recorded by GitHub. This file records actual results; an unexecuted release path is not marked accepted.

## Source provenance

Dedicated worktree: `C:/Users/skynesser/.codex/worktrees/8393/knowledgeGraph`; task branch `codex/issue-23-windows-release`. Initial clean HEAD / fixed review base: `85940d8de4ca33f0486a6e3c4418f8fa67a62397`. Remote main at start: `87d6ffe9885b5f121fcffa97474786cbe501675f`. This branch inherits 47 previously committed baseline changes, including the completed #21 client. No uncommitted files were copied from the shared working directory. The task PR is [#24](https://github.com/jking412/Noterion/pull/24).

## First cold run: failure correctly blocks delivery

[Run 43354260034](https://github.com/jking412/Noterion/actions/runs/43354260034), PR head `0f5310b4593e856f85f0b451921a8faeb6008154`, tested merge commit `ec2bb33c000894bdb49325e13b61ec22bf7673fd`. Runner `2.338.2`; Windows Server 2022 image `20261101.353.1`. Log confirms Node `v24.14.0`, npm `11.9.0`, installation of Rust `1.93.1-x86_64-pc-windows-msvc`, cache miss, locked npm installation, and successful typecheck.

2026-11-13 02:45:20: all 54 frontend tests passed, but Vitest also discovered the new Node-native `scripts/release.test.mjs` and rejected it with `No test suite found`. The check job failed; build/package/upload were skipped, and release was skipped. No release candidate was uploaded and no Release was created by this run.

The exact `npm test` failure was reproduced locally, then the Node-native suite was renamed to `release.node-test.mjs`, outside Vitest's discovery glob. Both intended test commands then passed: 54 frontend tests and 4 asset-boundary tests. No tests were ignored or allowed to fail.

## Cold Runner success

[Run 43354692958](https://github.com/jking412/Noterion/actions/runs/43354692958) completed successfully on PR head `23b6d7eda817efbe62157f1c7916b20c56ad4052`, testing merge commit `674a624f177b0c0d60b56b0b5d84e3275a03304f`. All check steps passed; the release job was skipped as required for a PR. The log explicitly reports a cache miss, then a new optimized release build in 4m51s, strict Clippy in 2m07s, Rust test compilation in 1m15s (0 Rust unit tests), and Microsoft-signed matching EdgeDriver `131.0.2903.86`.

Real packaged-client smoke ran 2026-11-13 02:57:50–02:58:00. It passed embedded production origin/script checks, a visible knowledge-point save through Rust, complete exit and retrieval in a new process (PID 4684 → 3504). Downloaded static evidence is retained in `cold-run-43354692958/`: result, executable/driver inputs, driver provenance and the actual restarted UI screenshot. Visual inspection confirmed the saved name, description and unique search result; no development server or injected IPC was used.

Candidate artifact ID `14005792718` is bound to the successful check; smoke evidence artifact ID `14005573279`. This is Actions candidate evidence, not proof of a public Release. A final publishing-only correction still requires a fresh PR check before merge.

## Final PR and automatic main publication

[Final PR run 43356207020](https://github.com/jking412/Noterion/actions/runs/43356207020) passed on final head `90e3c0aff0f172442aaef1447170af1037b4e52e`. The user explicitly authorized merging that green PR together with its 47 committed prerequisites. PR #24 was merged as `b41614abef9a3011929b286e5158d4ed73a6bd38`; no shared local main checkout was changed or pushed.

The main push automatically triggered [run 43356740425](https://github.com/jking412/Noterion/actions/runs/43356740425). Its independent Windows Runner again reported a cache miss and passed all checks, an optimized build in 4m38s, strict Clippy, Rust test compilation (0 unit tests), and the real packaged-client smoke. Check job `131660439140` had `Contents: read`. Checked release candidate artifact ID: `14007305734`.

Release job `131664068613` had `Contents: write`, downloaded that checked artifact, verified/extracted it, staged a draft, uploaded/downloaded all four assets, and ran the downloaded real client. At 2026-11-13 03:17:29 UTC it reported successful publication and anonymous public download verification. Both jobs completed successfully.

Public result: [Noterion 0.1.0-main.b41614abef9a](https://github.com/jking412/Noterion/releases/tag/main-b41614abef9a3011929b286e5158d4ed73a6bd38). Assets are the optimized Windows x64 portable ZIP, `SHA256SUMS`, `manifest.json`, and `README.txt` (GitHub additionally displays its automatic source archives). The manifest retains source commit `b41614abef9a3011929b286e5158d4ed73a6bd38`, source version `0.1.0`, the main push run URL, `release` profile and target `x86_64-pc-windows-msvc`. Published exe SHA-256: `ad03bc9edb903360eb9427236c7ab13815c843d3f60c8d124e9b75e2861f4b51`; size 10,531,328 bytes.

## Concurrent invocation and idempotent retry

Two manual main invocations used the same immutable SHA. [Run 43358128662](https://github.com/jking412/Noterion/actions/runs/43358128662) was cancelled when [run 43358309043](https://github.com/jking412/Noterion/actions/runs/43358309043) replaced it. The cancelled run did not publish; the original successful main-push run and public assets remained available. This exercised same-ref cancellation, not a multi-tag queue stress test.

Run 43358309043 passed checks, real desktop smoke and release validation. Its newly compiled candidate exe SHA was `3022d54c142d37eba0ec1971832d25bba3e74a6d888427381b64359576315bce`, whereas the original public executable remained `ad03bc9e...f4b51`. The release job downloaded and verified the original publication and explicitly reported no duplicate and no asset replacement. This verifies the intended immutable-public-version behavior even when rebuild bytes differ; it does not claim bit-for-bit compiler reproducibility.

Next, only release job `131666570421` was requested to rerun. Attempt 2 reused successful check artifact ID `14007237279` from attempt 1, rather than inventing an attempt-2 candidate name. New release job `131667125860` downloaded that exact artifact ID, again verified the original public client, and completed successfully at 03:25:43 UTC. Its log records: `Rerun published no duplicate and replaced no assets.` Attempt-2 diagnostic artifact ID: `14007316674`.

## Final public-download Windows acceptance

See `release-download-b41614abef9a/` for anonymous direct Release downloads, complete SHA-256 validation, Windows executable version metadata, fresh-process UI save/restart/search results and screenshots. Package/profile/data directories stay outside source in ignored local output. The downloaded executable matches the published `ad03bc9e...f4b51` hash, not a local build or Actions candidate.

## Boundaries

This delivery covers Windows x64 portable distribution, key embedded-UI/Rust-persistence smoke, real PR/main/manual runs, failure blocking, same-ref cancellation and selected-job retry. Version-tag rules are covered by CLI behavior tests and independent review; no official version tag was created as part of the initial daily prerelease. Cross-ref queue configuration was reviewed, but no multi-tag stress run was performed. Full 1–2 GB media, exhaustive fault injection at every upload stage and live AI services remain outside this CI smoke. Historical #21 media evidence is not counted as current Runner acceptance.
