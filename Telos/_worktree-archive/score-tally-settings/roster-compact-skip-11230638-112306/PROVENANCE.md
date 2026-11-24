# Gate archive · roster-compact-skip-11230638-112306

- source worktree: `/ws/cal_phone`
- branch / HEAD: `score-tally-settings` / `223dbdf7c6550436c538628cb9f3106ab74c354c`
- gate status: `converged`
- STOP: `STOP: rounds=3 reason=converged P0=0`
- declared run: round 3 (`evidence/runs/hard-r3.txt`)
- declared ARTIFACT_SHA256: `9aa1325b354d7695842884040c92200175fa2ecc6f121b3008cf28a305dfdb21`
- declared TREE_SHA256: `4c10b8c5153f940f557a54199401dd613fec27c0a33b866ceda55793ab3258b3`
- declared VERIFIER_SHA256: `88af35b19523b91ab540c34393e54465c8072a0dba2dd3e59b2ee885f185ceec`
- artifact snapshot: `verified-artifact/index.html` (file sha256 `9aa1325b354d7695842884040c92200175fa2ecc6f121b3008cf28a305dfdb21`, declared `9aa1325b354d7695842884040c92200175fa2ecc6f121b3008cf28a305dfdb21`, matches declared: **yes**)
- main worktree artifact: `/ws/cal_phone/index.html` (sha256 `9aa1325b354d7695842884040c92200175fa2ecc6f121b3008cf28a305dfdb21`, matches: **yes**)
- tree at archive time (excluding this archive dir): source `f30eb2987e333ee12df1b0ee792571109fb2d12f632756579639ce1006f12c65`, main `10f4c033152c7a503b0035cd0ff159cad031fe8c64e849167cc7ee4f24f81c55`

## What this is

A frozen copy of the gate directory and the exact artifact bytes its latest hard run declared. The copied GOAL.md still
points at the source worktree; that is intentional. Keep it as a record, not as an active gate.

## What this is not

It does not extend verification to later edits in the main worktree. If the artifact changes after
`2026-11-24T00:46:06.126Z`, open a new gate in the checkout where you are changing it.
