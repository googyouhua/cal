<!-- KEKKAI-CHANNEL -->
<!--
  Kekkai environment channel (v4).
  `kekkai init <repo>` installs this SAME content as BOTH:
    <repo>/AGENTS.md   (Codex, ZCode, and Cursor read this)
    <repo>/CLAUDE.md   (Claude Code — and the Cursor agent CLI — read this)
  They are intentionally identical (AGENTS.md ≡ CLAUDE.md): the GOAL.md body is the single source of truth; the only
  per-executor difference lives in the launch command (`kekkai handoff --executor codex|claude|zcode|cursor`), not here.
  If the repo already has an AGENTS.md / CLAUDE.md, `kekkai init` wraps this block in its own markers and appends or
  replaces it in place instead of overwriting. `kekkai doctor` reports the channel as `stale` until `kekkai init` is rerun.
-->

# Goal-Gate execution protocol (Kekkai v4)

This repo is driven by **Kekkai Goal Gates**. When you are handed a `GOAL.md` (a gate), you are the **executor**: read
the gate in full plus its `./ledger.md`, then drive the gate to a terminal state. You edit business code and call the
`kekkai` subcommands in the gate's §5. You do **not** run verifiers by hand, and **GOAL.md is read-only except the
`status` lifecycle field** (`draft → in-loop` before round 1; `→ converged` before a converged STOP; blocked stays
`in-loop`). The invocation that generated a gate never executes it.

## The eight commands (§5 of every v4 gate; absolute gate path)
```
kekkai doctor --gate "<gate>" --host                 # before round 1 and after any host change
kekkai hard "<gate>"                                 # r1: independent author writes evidence/verify.mjs; later rounds replay it
kekkai soft "<gate>"                                 # only after a hard PASS: fresh AGY review over copied pixels
kekkai adhoc "<gate>" -- <command…>                  # same-round measurement admissible as 误报 basis
kekkai recast "<gate>" --reason "<why>"              # sick instrument: quarantine + fresh independent author (≤3 eras)
kekkai hard "<gate>" --final                         # terminal independent stamp at the stop candidate
kekkai lint "<gate>" --post                          # after round 1, on recovery, before STOP
kekkai close "<gate>" --by <budget|host|instrument|oscillation|human> --blocker "<one sentence>"
```
New gates freeze `model_profile: astra-flash-3.8-v1`: hard gate = `codex exec` (`gpt-6-astra` @ `max`); soft gate =
`agy -p` (`Gemini 3.8 Flash (High)`, discovery slug `gemini-3.8-flash-high`). Both are pinned by the runner from the
gate's profile — you never choose or configure a judge. Existing v4 gates without `model_profile` retain
`gpt-5.6-sol` @ `max` and `Gemini 3.1 Pro (High)`; never add, remove, or edit the profile during execution.
Requirements: `kekkai`, `node`, `codex`, and (dual gates) `agy` on
PATH; `kekkai doctor --gate <dir>` derives the real set. Screen preflight and locking apply only to explicit `requires_display: true`; headless measurements do not depend on an unlocked desktop. Missing AGY permits the admitted Codex fallback.

## Rounds vs attempts (the runner decides, not you)
- A **round** is a stamp the runner promotes into `evidence/runs/hard-r<N>.txt`: a PASS, or a changed tree, or a changed
  FAIL set. Everything else — crash, timeout, malformed output, host-polluted repeat, tamper, sick instrument — is an
  **attempt** under `evidence/attempts/`: no ledger line, no `max_rounds`, no K reset. Never hand-copy files into
  `evidence/runs/` or `evidence/instruments/`; never delete anything under `evidence/`.
- Exit codes of `kekkai hard` / `kekkai soft`: `0` promoted; `2` attempt archived (read status/messages: finish a missing final with `--final` if the round already exists; otherwise fix the cause before retrying);
  `3` stops unchanged retries (including the per-phase attempt cap); repeated FAIL uses this message —
  `KEKKAI-RUNNER: exit=3 REPEAT_LIMIT — legal moves: (1) change the business tree, (2) kekkai recast --reason, (3) kekkai close --by <tag>`;
  `4` rule refusal (read the message; do not retry as-is). The same FAIL signature twice is host pollution: the third
  run needs `--host-cleared "<what changed>"`. Repeated pipeline failure stops before more model calls; use recast for a broken instrument or close with a concrete blocker.
- The first hard-PASS round automatically gets an independent audit final. If the final FAILs an H the instrument
  PASSed, the FAIL stands: fix the code or `kekkai recast` — never rerun a final hoping for a different roll.
- A gate verifier runs up to 40 min (hard) / 12 min (soft) and prints `KEKKAI-RUNNER: alive t=<min>` heartbeats; run it in
  the foreground with a long tool timeout, never as a background task that a finished turn would kill.

## Ledger discipline (`./ledger.md`) — the convergence engine
Each round give every ID-bearing P0/P1 exactly one disposition before deriving counts: **有效** (off-ledger and verified
true → the only kind that counts → fix), **台账命中** (matches an *earlier-round* 已拍板取舍 / 不修 by claim, not
wording; a decision written this round takes effect next round), **误报** (cite `render-r<N>.txt :: key=value`,
`hard-r<N>.txt :: key=value`, or an `adhoc-r<N>-<k>.txt :: key=value` that `kekkai adhoc` wrote). P0 is never a
ledger hit. `去重后 P0` / `台账外新增 P1` are derived from the rows, never self-reported. Subjective fixes get a
same-round 拍板 row. A real gap found after hard PASS but before a valid verdict: soft cell `—: <reason>`.

## Two terminals only
`STOP: rounds=<N> reason=converged P0=0` (status `converged`; K = 2 clean rounds + independent final PASS on the same
bytes), or `STOP: rounds=<N> reason=blocked by=<budget|host|instrument|oscillation|human>` followed by
`blocker: <what is missing, who can clear it, where to resume>` (any N including 0; status stays `in-loop`; write it with
`kekkai close`). Never park a gate in-loop without a STOP line; then run `kekkai lint "<gate>" --post`.

## Hard-won gotchas (each cost a debugging round; don't rediscover)
- The soft review does **not** render: the instrument pre-renders exact-round PNGs; reviewing source is the eyeball trap.
- `jsdom` global install: if `require('jsdom')` throws, `export NODE_PATH=$(npm root -g)` then retry.
- Extract engine logic with `fs.readFileSync` + regex on `<script id="…">` + `eval` onto `globalThis`; do not refactor
  the HTML into modules just to import — it breaks the self-contained artifact.
- sha256 baselines hash the **full `<script id="…">…</script>` block INCLUDING the tags** — exactly what
  `kekkai new --baseline` computes.
- Missing accounts, dependencies, human decisions, or device permissions are preconditions: repair them or close blocked; never turn them into permanent product FAILs or extend the round budget to retry.
- Real 320px mobile render needs CDP `Emulation.setDeviceMetricsOverride`; headless Chrome `--window-size` has a
  ~500px floor, so "320px review" via window-size is fake.

<!-- KEKKAI-CHANNEL -->
