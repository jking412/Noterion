# Issue #23 remote execution evidence

All times below are UTC, as recorded by GitHub. This file records actual results; an unexecuted release path is not marked accepted.

## Source provenance

Dedicated worktree: `C:/Users/skynesser/.codex/worktrees/8393/knowledgeGraph`; task branch `codex/issue-23-windows-release`. Initial clean HEAD / fixed review base: `85940d8de4ca33f0486a6e3c4418f8fa67a62397`. Remote main at start: `87d6ffe9885b5f121fcffa97474786cbe501675f`. This branch inherits 47 previously committed baseline changes, including the completed #21 client. No uncommitted files were copied from the shared working directory. The task PR is [#24](https://github.com/jking412/Noterion/pull/24).

## First cold run: failure correctly blocks delivery

[Run 43354260034](https://github.com/jking412/Noterion/actions/runs/43354260034), PR head `0f5310b4593e856f85f0b451921a8faeb6008154`, tested merge commit `ec2bb33c000894bdb49325e13b61ec22bf7673fd`. Runner `2.338.2`; Windows Server 2022 image `20261101.353.1`. Log confirms Node `v24.14.0`, npm `11.9.0`, installation of Rust `1.93.1-x86_64-pc-windows-msvc`, cache miss, locked npm installation, and successful typecheck.

2026-11-13 02:45:20: all 54 frontend tests passed, but Vitest also discovered the new Node-native `scripts/release.test.mjs` and rejected it with `No test suite found`. The check job failed; build/package/upload were skipped, and release was skipped. No release candidate was uploaded and no Release was created by this run.

The exact `npm test` failure was reproduced locally, then the Node-native suite was renamed to `release.node-test.mjs`, outside Vitest's discovery glob. Both intended test commands then passed: 54 frontend tests and 4 asset-boundary tests. No tests were ignored or allowed to fail.

## Remaining acceptance

Second clean Runner build/smoke, main push publication, public asset download/start, idempotent rerun and concurrent release evidence are still pending. #23 remains open until its full acceptance is met.
