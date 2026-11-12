# Issue #21 real Windows desktop acceptance

The runner starts the actual embedded-resource Tauri executable with Microsoft Edge WebDriver's `webview2` mode. It never starts a browser substitute or development server. All business mutations use visible controls through standard W3C WebDriver. JavaScript execution only observes environment, image and video properties.

Use a matching installed WebView2 Runtime and driver. On the development machine the existing fixed driver is in `.scratch/personal-knowledge-graph/validation/windows-desktop/.tools/issue3-webdriver/`. The runner accepts explicit executable, driver and fixture repository paths, so it can run from a managed worktree or the integrated checkout. Node's built-in libraries are sufficient.

```powershell
node app/scripts/acceptance.mjs --run=issue-21-create-red --scenario=create --exe=D:/person/application/knowledgeGraph/.scratch/personal-knowledge-graph/validation/windows-desktop/target/debug/noterion.exe --fixtures-root=D:/person/application/knowledgeGraph --expect-created=INTENTIONALLY_WRONG
# Must fail on the actual displayed knowledge name after creating it.
node app/scripts/acceptance.mjs --run=issue-21-create-green --scenario=create --exe=D:/person/application/knowledgeGraph/.scratch/personal-knowledge-graph/validation/windows-desktop/target/debug/noterion.exe --fixtures-root=D:/person/application/knowledgeGraph
node app/scripts/acceptance.mjs --run=issue-21-core-new --scenario=core --exe=D:/person/application/knowledgeGraph/.scratch/personal-knowledge-graph/validation/windows-desktop/target/debug/noterion.exe --fixtures-root=D:/person/application/knowledgeGraph
node app/scripts/acceptance.mjs --run=issue-21-media-new --scenario=media --exe=D:/person/application/knowledgeGraph/.scratch/personal-knowledge-graph/validation/windows-desktop/target/debug/noterion.exe --fixtures-root=D:/person/application/knowledgeGraph
```

Every run ID must be new. Evidence is written below `app/validation/evidence/<run>/` unless `--output` is supplied. The runner creates isolated app configuration, data and WebView profiles there. It retains all evidence and never deletes the user's configured data. Launching an application under test and controlling loopback sockets can require the execution environment's existing sandbox escalation mechanism; this does not require changing Windows security settings.

`create` is the tight first vertical slice. `core` additionally covers same names, empty descriptions, literal search/all/any, shared editing, detachment, multi-level cycle rejection, normal/abnormal restart and cascading deletion. `media` uses real local file additions and the existing synthetic sample files, observes decoded image/video frames, seeks through the timeline, compares a distant byte interval, streams a complete ordinary GET and cancels another. `all` combines the scenarios.

The media run deliberately emits `pdf-manual-inspection.json`: **an iframe element or its load event is insufficient evidence of rendered PDF**. Inspect the real desktop screenshot and PDF viewer; retain that review separately. A runner PASS is scoped to the automated assertions recorded in `assertions.json`, and is not alone a statement that every checkbox in #21 has passed. Actual server byte/cancellation and Windows process resource evidence must accompany media acceptance. Source samples and previous object-service evidence remain independent historical records, not evidence that the formal local path already passed.

The runner records executable/driver SHA-256, real session/host PID, protocol operations, rendered text, screenshots and HTML. It checks owned-host exit on cleanup, including abnormal termination scenarios. Raw HTML and profile files are local diagnostic artifacts; do not publish them without reviewing for personal paths and transient stream tokens.
