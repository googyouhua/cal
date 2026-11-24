# Gate archive · phone-calculator-history-111508

- source worktree: `/ws/cal_phone`
- branch / HEAD: `score-tally-settings` / `2d241f1199f62007de0b6dd746c010c649939a22`
- gate status: `converged`
- STOP: `STOP: rounds=1 reason=converged`
- declared run: round 1 (`evidence/runs/hard-r1.txt`)
- declared ARTIFACT_SHA256: `7decfae74dc48b98f25e643828185e71973792ad0d99a81fbab8aef95a108f28`
- declared TREE_SHA256: `db9d3c7cbe26a5d8adddbd7e09ec5bc971ab10860c7241af3ae870cc513b330d`
- declared VERIFIER_SHA256: `bbab4674d89ce6d7cfc9f53d50d9244b87188409aa3ff32ad3544c0b59bb763f`
- artifact snapshot: `—` (file sha256 `9aa1325b354d7695842884040c92200175fa2ecc6f121b3008cf28a305dfdb21`, declared `7decfae74dc48b98f25e643828185e71973792ad0d99a81fbab8aef95a108f28`, matches declared: **no**, STALE — the file changed after the gate run, so no artifact snapshot was taken)
- main worktree artifact: `/ws/cal_phone/index.html` (sha256 `9aa1325b354d7695842884040c92200175fa2ecc6f121b3008cf28a305dfdb21`, matches: **yes**)
- tree at archive time (excluding this archive dir): source `f32d09fec4198e841f1a8b80485911a4b0013bd39b7700ec644c3c611ae1191b`, main `92aff462c4a86564bc500b5ac7d925cd043f3b7f75f4432ce1ed23f3db9c4fa5`

## What this is

A frozen copy of the gate directory. The copied GOAL.md still
points at the source worktree; that is intentional. Keep it as a record, not as an active gate.

## What this is not

It does not extend verification to later edits in the main worktree. If the artifact changes after
`2026-11-24T00:53:51.212Z`, open a new gate in the checkout where you are changing it.
