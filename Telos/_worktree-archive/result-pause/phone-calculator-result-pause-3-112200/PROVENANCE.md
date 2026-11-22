# Gate archive · phone-calculator-result-pause-3-112200

- source worktree: `/ws/cal_phone-worktrees/result-pause`
- branch / HEAD: `result-pause` / `446d4cdfdc7a25e5459ed658c8c3e0bfae016d2b`
- gate status: `converged`
- STOP: `STOP: rounds=1 reason=converged`
- declared run: round 1 (`evidence/runs/hard-r1.txt`)
- declared ARTIFACT_SHA256: `a275e40bf0e85ec0e86bc8bda88bee15a5bde4048677594d113e1c4a31371a14`
- declared TREE_SHA256: `2ed177bb9eab7875934d9ab263c16f9fc9e1a9bfbcaff3f0a086944c61027636`
- declared VERIFIER_SHA256: `219465474a78f0ea5d13e0eacc1f7965a09f667f66cdc36985cb97c1a9824ce0`
- artifact snapshot: `verified-artifact/index.html` (file sha256 `a275e40bf0e85ec0e86bc8bda88bee15a5bde4048677594d113e1c4a31371a14`, declared `a275e40bf0e85ec0e86bc8bda88bee15a5bde4048677594d113e1c4a31371a14`, matches declared: **yes**)
- main worktree artifact: `/ws/cal_phone/index.html` (sha256 `a593d8b82bdb81eb394085da473d7e016f6497908795b66b3eea0d6cdf950368`, matches: **no**)
- tree at archive time (excluding this archive dir): source `2ed177bb9eab7875934d9ab263c16f9fc9e1a9bfbcaff3f0a086944c61027636`, main `a4e3ef9afa7147027d041a9e6e7d45ef2c7774505f6edac3c2277943f5c2fa88`

## What this is

A frozen copy of the gate directory and the exact artifact bytes its latest hard run declared. The copied GOAL.md still
points at the source worktree; that is intentional. Keep it as a record, not as an active gate.

## What this is not

It does not extend verification to later edits in the main worktree. If the artifact changes after
`2026-11-22T01:30:10.916Z`, open a new gate in the checkout where you are changing it.
