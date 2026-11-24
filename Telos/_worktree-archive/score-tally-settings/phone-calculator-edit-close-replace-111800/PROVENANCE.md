# Gate archive · phone-calculator-edit-close-replace-111800

- source worktree: `/ws/cal_phone`
- branch / HEAD: `score-tally-settings` / `2d241f1199f62007de0b6dd746c010c649939a22`
- gate status: `converged`
- STOP: `STOP: rounds=3 reason=converged`
- declared run: round 3 (`evidence/runs/hard-r3.txt`)
- declared ARTIFACT_SHA256: `1a9f6d64f88747a9818b46f8943bc30cbf52d62e82e60559164291293d124f5b`
- declared TREE_SHA256: `d5d47e388b72d8c6fbafb037a99f9ebe3b634e7fedd7da81283698bbb1b5f0ce`
- declared VERIFIER_SHA256: `132ba362301633df7f0e4b814dba87b77e517107c731e81077e1b02d0ec9096d`
- artifact snapshot: `—` (file sha256 `9aa1325b354d7695842884040c92200175fa2ecc6f121b3008cf28a305dfdb21`, declared `1a9f6d64f88747a9818b46f8943bc30cbf52d62e82e60559164291293d124f5b`, matches declared: **no**, STALE — the file changed after the gate run, so no artifact snapshot was taken)
- main worktree artifact: `/ws/cal_phone/index.html` (sha256 `9aa1325b354d7695842884040c92200175fa2ecc6f121b3008cf28a305dfdb21`, matches: **yes**)
- tree at archive time (excluding this archive dir): source `547cf650e68da6dffb6c9e8fc1c679b20464ff94f7adac4c6b3e77c53fcf14a3`, main `f635a5e959eeceff7de5577c7afc17108934cddc185945bb18b5b3d47835db68`

## What this is

A frozen copy of the gate directory. The copied GOAL.md still
points at the source worktree; that is intentional. Keep it as a record, not as an active gate.

## What this is not

It does not extend verification to later edits in the main worktree. If the artifact changes after
`2026-11-24T00:53:51.124Z`, open a new gate in the checkout where you are changing it.
