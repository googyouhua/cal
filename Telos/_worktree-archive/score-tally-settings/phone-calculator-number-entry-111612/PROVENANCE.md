# Gate archive · phone-calculator-number-entry-111612

- source worktree: `/ws/cal_phone`
- branch / HEAD: `score-tally-settings` / `2d241f1199f62007de0b6dd746c010c649939a22`
- gate status: `in-loop`
- STOP: `STOP: rounds=4 reason=blocked by=instrument`
- declared run: round 4 (`evidence/runs/hard-r4.txt`)
- declared ARTIFACT_SHA256: `d97565f096ed1c336eae9eac9ec75b1cc980bef6c0318027018a3f2291a8486a`
- declared TREE_SHA256: `6185a012a3530c77ceda6f97701470d3ba31cd2766b07292e8fbf020e6fd2126`
- declared VERIFIER_SHA256: `08aab274e6d3d6d1368a605766493180e0bfcc0d9ddc96a67914ed8bb085a495`
- artifact snapshot: `—` (file sha256 `9aa1325b354d7695842884040c92200175fa2ecc6f121b3008cf28a305dfdb21`, declared `d97565f096ed1c336eae9eac9ec75b1cc980bef6c0318027018a3f2291a8486a`, matches declared: **no**, STALE — the file changed after the gate run, so no artifact snapshot was taken)
- main worktree artifact: `/ws/cal_phone/index.html` (sha256 `9aa1325b354d7695842884040c92200175fa2ecc6f121b3008cf28a305dfdb21`, matches: **yes**)
- tree at archive time (excluding this archive dir): source `60b0ac37e4eefdbb04d645b5abd48f64512f354a27f0814d20ccdeda15a20162`, main `ec885dd3babc57f2e343edbfc5c14bb42f541f885e1c4cc1d127613973976ca1`

## What this is

A frozen copy of the gate directory. The copied GOAL.md still
points at the source worktree; that is intentional. Keep it as a record, not as an active gate.

## What this is not

It does not extend verification to later edits in the main worktree. If the artifact changes after
`2026-11-24T00:53:51.331Z`, open a new gate in the checkout where you are changing it.
