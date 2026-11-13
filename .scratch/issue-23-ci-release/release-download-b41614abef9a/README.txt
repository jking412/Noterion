Noterion 0.1.0-main.b41614abef9a
Source version: 0.1.0
Commit: b41614abef9a3011929b286e5158d4ed73a6bd38
Ref: refs/heads/main
Build: https://github.com/jking412/Noterion/actions/runs/43356740425
Target: Windows x64 (optimized release)

Extract the complete ZIP into a writable folder, then double-click noterion.exe.
Requires Windows x64 and Microsoft Edge WebView2 Runtime.
WebView2: https://developer.microsoft.com/microsoft-edge/webview2/
No Vite, Node, Python, database server or object storage service is required to run.
The executable embeds the production interface.

Knowledge and saved files are stored in a data directory. The default is data beside
the executable; an existing directory selection in the user profile takes precedence.
Use the application's data-directory control to confirm the active location.
Before upgrading, close the app and back up the COMPLETE data directory. Extract the
new program separately; keep existing data and select it from the new program.
Never replace an open database or remove the data directory during upgrade.

This portable release has no installer, auto-updater or purchased code-signing
certificate. Windows may display an unknown-publisher/SmartScreen prompt.
SHA256SUMS verifies archive, manifest and this README; manifest.json records the
executable's SHA-256. Verify downloads before starting the executable.

Runner smoke covers startup, embedded interface and real Rust local persistence.
It does not certify all media codecs, 1-2 GB video playback, external AI providers
or the full interactive desktop acceptance suite. No paid AI account is needed
for the standard CI checks.
