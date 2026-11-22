# Gate archive · phone-calculator-result-pause-2-112200

- source worktree: `/ws/cal_phone-worktrees/result-pause`
- branch / HEAD: `result-pause` / `fe06f8f1d687b2b5b91a14f398693559dad0eff8`
- gate status: `converged`
- STOP: `STOP: rounds=1 reason=converged`
- declared run: round 1 (`evidence/runs/hard-r1.txt`)
- declared ARTIFACT_SHA256: `b7447a32ff5d900b4cfecd95fee25a09e7859603b1e7d264781b78c7b3eaa8f3`
- declared TREE_SHA256: `ff099aba33fdaac38a6aedfece333d4d985ad94eb7616ae0fb2b02c5906f4289`
- declared VERIFIER_SHA256: `219465474a78f0ea5d13e0eacc1f7965a09f667f66cdc36985cb97c1a9824ce0`
- artifact snapshot: `verified-artifact/index.html` (file sha256 `b7447a32ff5d900b4cfecd95fee25a09e7859603b1e7d264781b78c7b3eaa8f3`, declared `b7447a32ff5d900b4cfecd95fee25a09e7859603b1e7d264781b78c7b3eaa8f3`, matches declared: **yes**)
- main worktree artifact: `/ws/cal_phone/index.html` (sha256 `a593d8b82bdb81eb394085da473d7e016f6497908795b66b3eea0d6cdf950368`, matches: **no**)
- tree at archive time (excluding this archive dir): source `ff099aba33fdaac38a6aedfece333d4d985ad94eb7616ae0fb2b02c5906f4289`, main `84cb2cab2641734d1c47e2d5e5e92cb4c8213776d7c54751a4ac8790cf15bc72`

## What this is

A frozen copy of the gate directory and the exact artifact bytes its latest hard run declared. The copied GOAL.md still
points at the source worktree; that is intentional. Keep it as a record, not as an active gate.

## What this is not

It does not extend verification to later edits in the main worktree. If the artifact changes after
`2026-11-22T00:56:51.450Z`, open a new gate in the checkout where you are changing it.
