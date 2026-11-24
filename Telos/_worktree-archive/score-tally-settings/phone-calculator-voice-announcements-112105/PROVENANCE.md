# Gate archive · phone-calculator-voice-announcements-112105

- source worktree: `/ws/cal_phone`
- branch / HEAD: `score-tally-settings` / `2d241f1199f62007de0b6dd746c010c649939a22`
- gate status: `converged`
- STOP: `STOP: rounds=7 reason=converged P0=0`
- declared run: round 7 (`evidence/runs/hard-r7.txt`)
- declared ARTIFACT_SHA256: `26224e9c1c4bd44f228d4a408cd73a7de5048ac99988252c1471e1a10dddda55`
- declared TREE_SHA256: `4adb9b4d8d54447f1b47a4e46601a35db7080a0027817171a75a3faa5ade11e7`
- declared VERIFIER_SHA256: `ecc43a8b02144aa1544a7d1fe557f4c79fe3f276dcf0f911556298d17db63696`
- artifact snapshot: `—` (file sha256 `9aa1325b354d7695842884040c92200175fa2ecc6f121b3008cf28a305dfdb21`, declared `26224e9c1c4bd44f228d4a408cd73a7de5048ac99988252c1471e1a10dddda55`, matches declared: **no**, STALE — the file changed after the gate run, so no artifact snapshot was taken)
- main worktree artifact: `/ws/cal_phone/index.html` (sha256 `9aa1325b354d7695842884040c92200175fa2ecc6f121b3008cf28a305dfdb21`, matches: **yes**)
- tree at archive time (excluding this archive dir): source `476cfc36230acff149eff059f3241a5471910ec175afe37db8a177665d8d0b7d`, main `0172e0e44ec6c406f8985f2704db0573ae8728bbd4722d04cfd23996bb8c771c`

## What this is

A frozen copy of the gate directory. The copied GOAL.md still
points at the source worktree; that is intentional. Keep it as a record, not as an active gate.

## What this is not

It does not extend verification to later edits in the main worktree. If the artifact changes after
`2026-11-24T00:53:52.387Z`, open a new gate in the checkout where you are changing it.
