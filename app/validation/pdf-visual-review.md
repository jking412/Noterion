# Actual embedded PDF review

2026-11-12. The first integrated media screenshot was captured as soon as its iframe existed and appeared blank. A focused rerun on the same formal exe waited three seconds after opening the saved PDF through the real resource-library UI.

Command: `node app/scripts/acceptance.mjs --run=issue-21-pdf-diagnostic-01 --scenario=pdf --port=33222 --exe=D:/person/application/knowledgeGraph/.scratch/personal-knowledge-graph/validation/windows-desktop/target/debug/noterion.exe --fixtures-root=D:/person/application/knowledgeGraph`.

The actual desktop screenshot `evidence/issue-21-pdf-diagnostic-01/pdf-after-3-seconds.png` was opened and visually inspected: the built-in viewer shows its toolbar, page **1 / 1**, zoom controls and the real `Noterion resource checklist` document, including its checklist and `docker stats --no-stream` command. It is not a blank iframe or a replacement HTML page. Screenshot after read-only frame observation shows the same PDF.

Read-only WebDriver frame observation returned `contentType: application/pdf`, a 909×525 embedded PDF element and the Runtime PDF plugin inventory. Its DOM body text is empty because the built-in viewer renders through its embedded plugin; that empty DOM is not the rendering verdict. The screenshot is the rendering evidence.

Actual exe SHA-256: `d8000abc375671a1863a1ce3a2665e9abe0b37a96f0114ffd9f9f35e6a2f7e1d`. WebView2/driver: `136.0.3240.76`. The runner used isolated app/profile data, closed its session and confirmed its owned host exited. This proves this actual local PDF on this Runtime; it does not assert every PDF feature or all malformed/encrypted documents work.

No bundled third-party PDF renderer is needed for the demonstrated basic read-only preview. The media scenario now waits three seconds before taking its PDF review screenshot; the iframe load event itself remains insufficient as a pass condition.
