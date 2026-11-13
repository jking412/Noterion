# Issue #23 independent review

Fixed base: `85940d8de4ca33f0486a6e3c4418f8fa67a62397` (the clean initial worktree HEAD). First implementation: `0f5310b4593e856f85f0b451921a8faeb6008154`. Command: `git diff 85940d8...HEAD`; inherited #21 / local-main commits and concurrent #22 work are outside this review.

## Standards

One documented contract mismatch: `Store::add_copied_file` now accepts `CopiedFile` plus knowledge-point identities, while `app/CONTRACT.md` still described individual parameters. The unique caller was correct. Fixed the contract with the actual signature and copied-file fields. No other documented-standard violation or actionable Fowler smell was reported.

Standards: 1 finding, resolved; worst finding was the low-risk contract mismatch.

## Spec

One concurrency defect: a shared release concurrency group with the default single pending slot could evict a waiting main/tag publication when another ref queued. Added the documented `queue: max` policy while retaining main SHA freshness checks. Non-blocking mismatch: a historical main rerun returned before checking an existing public release. Moved the freshness guard after the immutable-existing-release verification.

An additional recovery finding was reported during review: `github.run_attempt` changes on a failed-release-only rerun, although the successful check job does not rerun. The release job now downloads the immutable artifact ID output by the successful check job, retaining its checked origin.

Spec: 2 actionable findings and 1 behavior/documentation mismatch, resolved. Worst finding was the pending release eviction. Real remote execution and publication evidence remain separate completion gates.

## Final acceptance review

After the actual main publication, anonymous Windows download/start, same-ref cancellation and selected-release-job retry, the independent Spec reviewer found no remaining blocking acceptance item. Formal tags are an optional route; their version rules are covered by CLI tests. Multi-tag queue stress and exhaustive failure injection at every upload stage were not claimed. Final public-download static JSON, version metadata and screenshots are retained alongside the run record.
