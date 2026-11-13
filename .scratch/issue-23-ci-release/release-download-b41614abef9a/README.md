# Final public Release download and Windows acceptance

Release: [Noterion 0.1.0-main.b41614abef9a](https://github.com/jking412/Noterion/releases/tag/main-b41614abef9a3011929b286e5158d4ed73a6bd38), published by automatic main push run [43356740425](https://github.com/jking412/Noterion/actions/runs/43356740425). This is a new public Release download, not the local build or an Actions candidate.

All four assets were fetched anonymously from `https://github.com/jking412/Noterion/releases/download/main-b41614abef9a3011929b286e5158d4ed73a6bd38/`: the ZIP named in `manifest.json`, `manifest.json`, `README.txt`, and `SHA256SUMS`. No credential or paid AI key was used. The first local Node fetch timed out; Windows curl using its normal verified HTTPS stack succeeded. Metadata returned HTTP 200; the slow ZIP transfer used HTTP 200 followed by HTTP 206 resume from the same public URL. Complete hash verification, never a partial download, gated extraction and launch.

The actual downloaded ZIP is 3,758,483 bytes. SHA-256:

```text
1ef8288102aad1f255f8486de59e3c2019219adc70e956483647574bfd83af91
```

`release.mjs verify` checked the complete asset allowlist, all external checksums, expected full source commit, exact ZIP entries, embedded/external metadata equality, PE x64 header and executable hash. The downloaded executable is 10,531,328 bytes with SHA-256 `ad03bc9edb903360eb9427236c7ab13815c843d3f60c8d124e9b75e2861f4b51`, matching the original publication log. Windows ProductVersion and FileVersion both report `0.1.0`, equal to the manifest source version; see `version-info.json`.

Real smoke ran 2026-11-13 03:24:24–03:24:32 UTC (11:24 Asia/Shanghai), with `passed:true` and exit 0. The visible interface came from embedded `http://tauri.localhost/` production scripts. Standard WebDriver input/click/save created synthetic knowledge through Rust; after complete exit, a fresh process (PID 38948 → 37828) and fresh WebView profile retrieved the unique record and description through visible search. No Vite/Python server, direct database writes or injected IPC were used. WebView2/driver were `136.0.3240.76`; Node was `v24.14.0`.

The final restarted screenshot was visually inspected: unique search result, graph node, saved name and description are present. The JSON files and three screenshots are current static evidence. Worktree paths in JSON are replaced with `<worktree>`; the screenshot displays only this synthetic test's isolated path and data. Raw ZIP/exe, profiles, configuration and SQLite data stay in ignored `app/smoke-output/` and are not committed.

Reproduce after downloading the four assets to a new directory:

```powershell
$env:SOURCE_SHA='b41614abef9a3011929b286e5158d4ed73a6bd38'
node app/scripts/release.mjs verify --input=app/smoke-output/final-download --extract=app/smoke-output/another-extracted
node app/scripts/release-smoke.mjs --exe=app/smoke-output/another-extracted/noterion.exe --driver=app/smoke-output/webdriver/msedgedriver.exe --output=app/smoke-output/another-smoke
```

Use new extraction/smoke directories on each run. This validates packaged Windows startup and key Rust persistence. Full media/1–2 GB video, cross-ref queue stress and live AI provider acceptance are separate boundaries, not claims made by this result.
