# Gate archive · phone-calculator-continue-edit-numbers-111511

- source worktree: `/ws/cal_phone`
- branch / HEAD: `score-tally-settings` / `2d241f1199f62007de0b6dd746c010c649939a22`
- gate status: `converged`
- STOP: `STOP: rounds=1 reason=converged`
- declared run: round 1 (`evidence/runs/hard-r1.txt`)
- declared ARTIFACT_SHA256: `fb2cbdd845306853995b0375467280faa1b23ec7462dfa2958da862ff534f3bd`
- declared TREE_SHA256: `72f1d0ac11003816be11d499514f6a68931ca9e763e9b09b608b3b2e19277bb5`
- declared VERIFIER_SHA256: `85a8db90e11517cc5a406e3f5ce4ce629b0ca8229abec8982070c3ada041fece`
- artifact snapshot: `—` (file sha256 `9aa1325b354d7695842884040c92200175fa2ecc6f121b3008cf28a305dfdb21`, declared `fb2cbdd845306853995b0375467280faa1b23ec7462dfa2958da862ff534f3bd`, matches declared: **no**, STALE — the file changed after the gate run, so no artifact snapshot was taken)
- main worktree artifact: `/ws/cal_phone/index.html` (sha256 `9aa1325b354d7695842884040c92200175fa2ecc6f121b3008cf28a305dfdb21`, matches: **yes**)
- tree at archive time (excluding this archive dir): source `9eca4377362208eaefecd75877b7fc9bbc40df9b200c1c0f03710feadd9cab83`, main `1b06f9c6f2293738a47a1f906c7aede7152bd33ad59f96f0d81980015aa2fd14`

## What this is

A frozen copy of the gate directory. The copied GOAL.md still
points at the source worktree; that is intentional. Keep it as a record, not as an active gate.

## What this is not

It does not extend verification to later edits in the main worktree. If the artifact changes after
`2026-11-24T00:53:50.991Z`, open a new gate in the checkout where you are changing it.
