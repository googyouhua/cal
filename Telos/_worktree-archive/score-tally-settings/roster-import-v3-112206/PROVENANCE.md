# Gate archive · roster-import-v3-112206

- source worktree: `/ws/cal_phone`
- branch / HEAD: `score-tally-settings` / `223dbdf7c6550436c538628cb9f3106ab74c354c`
- gate status: `converged`
- STOP: `STOP: rounds=8 reason=converged P0=0`
- declared run: round 8 (`evidence/runs/hard-r8.txt`)
- declared ARTIFACT_SHA256: `ed2e034f537aeaa4a4fe98a3f2d333469447df9e13f03e1b58092a9c1bd1f400`
- declared TREE_SHA256: `af7cd82dc5733574d580a2d4a4532369e87a358960a85011d01ea7a97a0c5ffc`
- declared VERIFIER_SHA256: `0aec99f78d9e52bace2179b2af194795aa3448b44a23af975994b786eaddc1f4`
- artifact snapshot: `—` (file sha256 `9aa1325b354d7695842884040c92200175fa2ecc6f121b3008cf28a305dfdb21`, declared `ed2e034f537aeaa4a4fe98a3f2d333469447df9e13f03e1b58092a9c1bd1f400`, matches declared: **no**, STALE — the file changed after the gate run, so no artifact snapshot was taken)
- main worktree artifact: `/ws/cal_phone/index.html` (sha256 `9aa1325b354d7695842884040c92200175fa2ecc6f121b3008cf28a305dfdb21`, matches: **yes**)
- tree at archive time (excluding this archive dir): source `a340c1edb222fddd60d941a75d1f0ef11cd7ec0930fdc7041e22f1bbbd6d2602`, main `aeaf2d960c21f5eb5f4d1d9192cc900d500a0be88644d9aa6d51660a77f2cf85`

## What this is

A frozen copy of the gate directory. The copied GOAL.md still
points at the source worktree; that is intentional. Keep it as a record, not as an active gate.

## What this is not

It does not extend verification to later edits in the main worktree. If the artifact changes after
`2026-11-24T00:46:05.913Z`, open a new gate in the checkout where you are changing it.
