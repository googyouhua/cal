# Gate archive · phone-calculator-score-tally-settings-converge-112004

- source worktree: `/ws/cal_phone`
- branch / HEAD: `score-tally-settings` / `2d241f1199f62007de0b6dd746c010c649939a22`
- gate status: `converged`
- STOP: `STOP: rounds=5 reason=converged P0=0`
- declared run: round 5 (`evidence/runs/hard-r5.txt`)
- declared ARTIFACT_SHA256: `31d7e739ea60e699bc70c0b7a9efd8cc592e8b1a16bbd246825665cd3fe97410`
- declared TREE_SHA256: `4cf69d5fce9590764474743fdb88c79988f42999b9199a2b328026aff66dd936`
- declared VERIFIER_SHA256: `34d6ce4357e7e52f6c7d38021d2523b1623352449c8ee1b7998d711ef88d9c64`
- artifact snapshot: `—` (file sha256 `9aa1325b354d7695842884040c92200175fa2ecc6f121b3008cf28a305dfdb21`, declared `31d7e739ea60e699bc70c0b7a9efd8cc592e8b1a16bbd246825665cd3fe97410`, matches declared: **no**, STALE — the file changed after the gate run, so no artifact snapshot was taken)
- main worktree artifact: `/ws/cal_phone/index.html` (sha256 `9aa1325b354d7695842884040c92200175fa2ecc6f121b3008cf28a305dfdb21`, matches: **yes**)
- tree at archive time (excluding this archive dir): source `e3080591ecc981cdd3c2b8e2e11981289cc1eab5a02ef732a6f8e3f2c26ba136`, main `f844aa20ae260aa77b80137f9f25630943c498a28e2b7a0084e3a09f50cc4551`

## What this is

A frozen copy of the gate directory. The copied GOAL.md still
points at the source worktree; that is intentional. Keep it as a record, not as an active gate.

## What this is not

It does not extend verification to later edits in the main worktree. If the artifact changes after
`2026-11-24T00:53:51.967Z`, open a new gate in the checkout where you are changing it.
