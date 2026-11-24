# Gate archive · phone-calculator-111507

- source worktree: `/ws/cal_phone`
- branch / HEAD: `score-tally-settings` / `2d241f1199f62007de0b6dd746c010c649939a22`
- gate status: `converged`
- STOP: `STOP: rounds=1 reason=converged`
- declared run: round 1 (`evidence/runs/hard-r1.txt`)
- declared ARTIFACT_SHA256: `0d408190bfc24a036aef696c62c46ed1d6ec97f885e3bd5c7530e1cc660e3d8f`
- declared TREE_SHA256: `32734f1a4e933e929b51791c027d2a9ac6964ee519b2b8e90c1db5c9e09e179d`
- declared VERIFIER_SHA256: `57c774e414b10f5d07b7bcdbdb837124fb68899b3af9467d59adf19ab399f0a6`
- artifact snapshot: `—` (file sha256 `9aa1325b354d7695842884040c92200175fa2ecc6f121b3008cf28a305dfdb21`, declared `0d408190bfc24a036aef696c62c46ed1d6ec97f885e3bd5c7530e1cc660e3d8f`, matches declared: **no**, STALE — the file changed after the gate run, so no artifact snapshot was taken)
- main worktree artifact: `/ws/cal_phone/index.html` (sha256 `9aa1325b354d7695842884040c92200175fa2ecc6f121b3008cf28a305dfdb21`, matches: **yes**)
- tree at archive time (excluding this archive dir): source `90db41d028fa29885bcfcd363e22a33d6de9d8a8f3172f193661b8dc2ee5af59`, main `53ff872f955f9e6391725bf93c516a5848e6d27f7ec15ae7f0639984cd63b37d`

## What this is

A frozen copy of the gate directory. The copied GOAL.md still
points at the source worktree; that is intentional. Keep it as a record, not as an active gate.

## What this is not

It does not extend verification to later edits in the main worktree. If the artifact changes after
`2026-11-24T00:53:50.817Z`, open a new gate in the checkout where you are changing it.
