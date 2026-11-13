# Issue #21 independent Spec review

Reviewed integration directory: `D:/person/application/knowledgeGraph`.
Initial base: `2fd7da8`; initial review: `85e0118`; focused fix review: `6690c85` plus the current working tree, 2026-11-12 (Asia/Shanghai).

The reviewer fetched the current GitHub Issue #21 body and all comments through the GitHub connector. There were no comments. Repository instructions, domain glossary, ADR 0001/0004 and the desktop implementation contract were read.

## Findings and resolution

1. **P2 — unread resource storage appeared as an empty library.** The initial library rendered count zero and first-resource onboarding even when no formal data had loaded. This contradicted the requirement that storage failure must not appear as an empty library. Fixed by `6ff141a`: count, toolbar, list, empty onboarding and ready footer are conditional on `enabled`; an explicit unread state replaces them. `App.vue` passes `loaded` as `enabled`. Focused code review confirms the triggering path is covered.

2. **P2 — a graph drag during another write could be silently discarded.** The graph originally accepted a local move while the shared command runner refused busy commands; the local position could remain visible without a durable commit. Fixed by `f5df626`: `busy` reaches the graph, prevents new drags, stops movement and cancels an existing drag if another operation starts. A failed position save recreates the graph from the committed snapshot. Browsing remains available. Focused code review confirms the original drop path no longer leaves an uncommitted projection visible.

**Open Spec findings from this review: 0. No new blocking issue found in the focused follow-up.** No new business scope was identified. This review does not certify unexecuted acceptance conditions or stand in for the parent agent's final offline release run.

## Evidence boundary

The reviewer read `app/validation/evidence/issue-21-graphfailure-green-01/result.json` and `assertions.json`: PASS, three assertions, one real desktop launch, owned host exited. These cover contained graph setup failure while saving/searching/reading details, resource access while the graph subtree has failed, and recovery from current facts. The reviewer did not personally run that process or the later offline release acceptance, and therefore does not claim those as independently executed tests.

The parent reports separate core, media and directory reliability acceptance runs; final delivery evidence should link their actual results and the final release executable hash.
