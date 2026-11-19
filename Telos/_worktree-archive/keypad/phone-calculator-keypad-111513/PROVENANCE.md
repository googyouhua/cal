# Gate archive · phone-calculator-keypad-111513

- source worktree: `/ws/cal_phone-worktrees/keypad`
- branch / HEAD: `keypad` / `48692eb6fce14043b2306449c659ca8151526b42`
- gate status: `converged`
- STOP: `STOP: rounds=2 reason=converged`
- declared run: round 2 (`evidence/runs/hard-r2.txt`)
- declared ARTIFACT_SHA256: `630392827703060cfbccdefc549b71db6ec2656fb7870a20901aa7b6352d02a1`
- declared TREE_SHA256: `d29a0399df774e000b916fc51afe6dc31e1ddd1d9e459c54a6b774753f4d9d15`
- declared VERIFIER_SHA256: `2e2286dad8fb1932bbb989438bd5f6479daae05cd9cb89555ebc176db7eb7508`
- artifact snapshot: `verified-artifact/index.html` (file sha256 `630392827703060cfbccdefc549b71db6ec2656fb7870a20901aa7b6352d02a1`, declared `630392827703060cfbccdefc549b71db6ec2656fb7870a20901aa7b6352d02a1`, matches declared: **yes**)
- main worktree artifact: `/ws/cal_phone/index.html` (sha256 `630392827703060cfbccdefc549b71db6ec2656fb7870a20901aa7b6352d02a1`, matches: **yes**)
- tree at archive time (excluding this archive dir): source `d29a0399df774e000b916fc51afe6dc31e1ddd1d9e459c54a6b774753f4d9d15`, main `d29a0399df774e000b916fc51afe6dc31e1ddd1d9e459c54a6b774753f4d9d15`

## What this is

A frozen copy of the gate directory and the exact artifact bytes its latest hard run declared. The copied GOAL.md still
points at the source worktree; that is intentional. Keep it as a record, not as an active gate.

## What this is not

It does not extend verification to later edits in the main worktree. If the artifact changes after
`2026-11-16T12:55:01.393Z`, open a new gate in the checkout where you are changing it.
