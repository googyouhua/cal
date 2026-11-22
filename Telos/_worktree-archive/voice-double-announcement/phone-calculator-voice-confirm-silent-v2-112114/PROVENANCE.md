# Gate archive · phone-calculator-voice-confirm-silent-v2-112114

- source worktree: `/ws/cal_phone-worktrees/voice-double-announcement`
- branch / HEAD: `voice-double-announcement` / `8140ef1f9b15be5b0f9c25fad21db4f9ff0ff9fd`
- gate status: `converged`
- STOP: `STOP: rounds=1 reason=converged`
- declared run: round 1 (`evidence/runs/hard-r1.txt`)
- declared ARTIFACT_SHA256: `a593d8b82bdb81eb394085da473d7e016f6497908795b66b3eea0d6cdf950368`
- declared TREE_SHA256: `b17eb07909165278f93bab05f75f91699730df3e11e2a3d45dabc935761773a6`
- declared VERIFIER_SHA256: `c1edc3735fa4e363f617956b20e2b451cb271b3e0554cb52cb56a8fb075caf01`
- artifact snapshot: `verified-artifact/index.html` (file sha256 `a593d8b82bdb81eb394085da473d7e016f6497908795b66b3eea0d6cdf950368`, declared `a593d8b82bdb81eb394085da473d7e016f6497908795b66b3eea0d6cdf950368`, matches declared: **yes**)
- main worktree artifact: `/ws/cal_phone/index.html` (sha256 `a593d8b82bdb81eb394085da473d7e016f6497908795b66b3eea0d6cdf950368`, matches: **yes**)
- tree at archive time (excluding this archive dir): source `d6a940bfb89e33aa316b72affeea063d287740c5c8d3a8f1c1b999d173263057`, main `1b6b046401a3516c0422d397a33b7d29ab052301f450f454c6692e02689517f7`

## What this is

A frozen copy of the gate directory and the exact artifact bytes its latest hard run declared. The copied GOAL.md still
points at the source worktree; that is intentional. Keep it as a record, not as an active gate.

## What this is not

It does not extend verification to later edits in the main worktree. If the artifact changes after
`2026-11-22T00:09:32.356Z`, open a new gate in the checkout where you are changing it.
