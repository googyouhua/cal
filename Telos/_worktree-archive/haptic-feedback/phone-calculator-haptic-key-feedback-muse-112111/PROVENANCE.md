# Gate archive · phone-calculator-haptic-key-feedback-muse-112111

- source worktree: `/ws/cal_phone-worktrees/haptics`
- branch / HEAD: `haptic-feedback` / `d6a48e6fb4efce879356ad35e71f126ff06e2a13`
- gate status: `converged`
- STOP: `STOP: rounds=1 reason=converged`
- declared run: round 1 (`evidence/runs/hard-r1.txt`)
- declared ARTIFACT_SHA256: `113cc7e749e6adcaf34ffcd9fd5005408d75a090ac01215f5c8eacc227363d45`
- declared TREE_SHA256: `4c455709e61864133f5272e006847431d6e2d86641e85baa869fbc7a4698a450`
- declared VERIFIER_SHA256: `84200c8953aba56d52321f54ea4a0d7d92496eab5346b47a8dfb3d9342b57906`
- artifact snapshot: `verified-artifact/index.html` (file sha256 `113cc7e749e6adcaf34ffcd9fd5005408d75a090ac01215f5c8eacc227363d45`, declared `113cc7e749e6adcaf34ffcd9fd5005408d75a090ac01215f5c8eacc227363d45`, matches declared: **yes**)
- main worktree artifact: `/ws/cal_phone/index.html` (sha256 `10e98f81de845651b49d463b3a0839a98b87399a961fc68231107b59c2198693`, matches: **no**)
- tree at archive time (excluding this archive dir): source `4c455709e61864133f5272e006847431d6e2d86641e85baa869fbc7a4698a450`, main `178272833c30edd67967527d771c971cff76662c5f825cc3fe2b48ea419801bf`

## What this is

A frozen copy of the gate directory and the exact artifact bytes its latest hard run declared. The copied GOAL.md still
points at the source worktree; that is intentional. Keep it as a record, not as an active gate.

## What this is not

It does not extend verification to later edits in the main worktree. If the artifact changes after
`2026-11-21T12:42:05.553Z`, open a new gate in the checkout where you are changing it.
