# Gate archive · phone-calculator-voice-double-announcement-112111

- source worktree: `/ws/cal_phone-worktrees/voice-double-announcement`
- branch / HEAD: `voice-double-announcement` / `8140ef1f9b15be5b0f9c25fad21db4f9ff0ff9fd`
- gate status: `converged`
- STOP: `STOP: rounds=1 reason=converged`
- declared run: round 1 (`evidence/runs/hard-r1.txt`)
- declared ARTIFACT_SHA256: `620ab30da006d23def3b30456a669d8083fba868b7490dfee6645195d7eab0c9`
- declared TREE_SHA256: `a6ef39391d880078b93bcbda970e004515b20b6a0f806f200ab0aa8a3ac1c4e9`
- declared VERIFIER_SHA256: `9d8882ae776fb7aad15ba5500a8b6c222ac5bc1976bf5bf00af3a78f2bdd1184`
- artifact snapshot: `—` (file sha256 `a593d8b82bdb81eb394085da473d7e016f6497908795b66b3eea0d6cdf950368`, declared `620ab30da006d23def3b30456a669d8083fba868b7490dfee6645195d7eab0c9`, matches declared: **no**, STALE — the file changed after the gate run, so no artifact snapshot was taken)
- main worktree artifact: `/ws/cal_phone/index.html` (sha256 `a593d8b82bdb81eb394085da473d7e016f6497908795b66b3eea0d6cdf950368`, matches: **yes**)
- tree at archive time (excluding this archive dir): source `d6a940bfb89e33aa316b72affeea063d287740c5c8d3a8f1c1b999d173263057`, main `631d4ba5132ae09072b6e882815241eea01abfcc29b5ac261d44724e55778ed5`

## What this is

A frozen copy of the gate directory. The copied GOAL.md still
points at the source worktree; that is intentional. Keep it as a record, not as an active gate.

## What this is not

It does not extend verification to later edits in the main worktree. If the artifact changes after
`2026-11-22T00:09:32.443Z`, open a new gate in the checkout where you are changing it.
