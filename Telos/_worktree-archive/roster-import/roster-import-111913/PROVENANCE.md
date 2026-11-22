# Gate archive · roster-import-111913

- source worktree: `/ws/cal_phone-worktrees/roster-import`
- branch / HEAD: `roster-import` / `295517cfa4da47f9db366ab01e80cb6feb18abd0`
- gate status: `in-loop`
- STOP: `—`
- declared run: round 3 (`evidence/runs/hard-r3.txt`)
- declared ARTIFACT_SHA256: `d482b35002911561747c303b511e2f14ab250edcba86fd5150716a1eef69c62d`
- declared TREE_SHA256: `1e6115483ab4128f0f3c95cdbfe542d5aa126b2184ad37c359c706deff38f52a`
- declared VERIFIER_SHA256: `d6a7e493cd9ae177e0c3a8c84ba91e5f363f2c9cd711350275c24275fc68037b`
- artifact snapshot: `verified-artifact/index.html` (file sha256 `d482b35002911561747c303b511e2f14ab250edcba86fd5150716a1eef69c62d`, declared `d482b35002911561747c303b511e2f14ab250edcba86fd5150716a1eef69c62d`, matches declared: **yes**)
- main worktree artifact: `/ws/cal_phone/index.html` (sha256 `a275e40bf0e85ec0e86bc8bda88bee15a5bde4048677594d113e1c4a31371a14`, matches: **no**)
- tree at archive time (excluding this archive dir): source `1e6115483ab4128f0f3c95cdbfe542d5aa126b2184ad37c359c706deff38f52a`, main `85ef6f8c9334e6f63c99e10de58d737c1aeba376827dbdd6221828a49e3378c5`

## What this is

A frozen copy of the gate directory and the exact artifact bytes its latest hard run declared. The copied GOAL.md still
points at the source worktree; that is intentional. Keep it as a record, not as an active gate.

## What this is not

It does not extend verification to later edits in the main worktree. If the artifact changes after
`2026-11-22T01:51:32.040Z`, open a new gate in the checkout where you are changing it.
