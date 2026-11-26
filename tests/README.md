# Shared acceptance suite · cal_phone

The browser harness and regression scenarios for `/ws/cal_phone/index.html` live here so
that each Kekkai gate does not re-implement them. A gate's `evidence/verify.mjs` remains
the independent instrument: it maps this suite's results onto **its own** H table, adds
the assertions that are new to that gate, and writes the Kekkai stamp.

## Run

```sh
cd tests && npm install     # once; playwright@1.64.0, browsers already cached
node tests/suite.mjs
node tests/suite.mjs --list
node tests/suite.mjs --only compute,edit-multi
node tests/suite.mjs --json
node tests/suite.mjs --artifact /path/to/index.html
```

Exit code is `0` only when every scenario passes. Each check has a stable id such as
`edit-multi.after-append`, so a gate verifier can cite it directly in a FAIL detail.

## Layout

```text
tests/
  lib/selectors.mjs   stable data-testid / data-op / data-key hooks
  lib/browser.mjs     playwright resolution, context/page, pageerror + console capture
  lib/dom.mjs         interactions and readers (state, history, operand inputs, layout)
  lib/check.mjs       check / eq / near / clean
  scenarios/core.mjs          self-contained, cold-start, compute, arithmetic, history, reset
  scenarios/continuity.mjs    continuity, error-recovery, sticky-operator
  scenarios/edit.mjs          edit-recompute, edit-multi, edit-invalid, edit-divzero
  scenarios/layout.mjs        320×568 and 390×844, result and edit states
  scenarios/determinism.mjs   two fresh contexts, same sequence, identical history
  lib/roster.mjs               roster helpers (utf8/gbk buffers, import/paste, rows, download, csv parse)
  scenarios/roster-import.mjs  encodings, delimiters, RFC 4180, headers, alignment, rejections, paste, sample
  scenarios/roster-map.mjs     four-role mapping, mutual exclusion, live recompute, roles persistence
  scenarios/roster-mode.mjs    keep/clear merge, counts, duplicates, reselect, cancel/Esc
  scenarios/roster-fill.mjs    confirm reset, cancel/Esc, sequential fill, full roster, auto-confirm/keyboard guards
  scenarios/roster-edit.mjs    in-place edit, floating draft, switch protection, persistence, no-roster append
  scenarios/roster-export.mjs  BOM/CRLF, roles mapping, added columns, escaping, filenames, reimport
  scenarios/roster-storage.mjs storage shape, reload recovery, clear, unavailable/bad-data degradation
  scenarios/roster-dialog.mjs  voice queue cleanup on confirm; pause/auto-equals/base fill behavior
  scenarios/roster-determinism.mjs two fresh contexts, same import+fill+edit, deep-compare rows/storage/CSV
  scenarios/roster-layout.mjs  320/390 overflow, 44px targets, font sizes, focus, list semantics
  scenarios/roster-compact.mjs compact roster rows, headcount, min-width guarantees
  scenarios/roster-two-line.mjs  two-line roster rows: 学号+姓名 on line 1, expression+score+编辑 on line 2, no ellipsis at 320/390
  lib/settings.mjs             calc-settings helpers: one-shot seeding, panel open/close, stored shape, stored values
  lib/audio.mjs                recording AudioContext double: counts oscillator starts for the pause warning
  scenarios/settings-pause.mjs 结果后暂停输入: digit blocking, timer expiry by polling, operator passthrough, panel clamp/persist
  scenarios/result-pause-warning.mjs 默认 2 秒暂停、2 秒释放、被拦截键双音警告、按键路径、语音解耦、0 关闭、旧值不迁移
  scenarios/settings-storage-corrupt.mjs     corrupt JSON and out-of-range values fall back per field
  scenarios/settings-storage-round-trip.mjs  panel write, stored shape, reload, persisted pause still gates input
  scenarios/settings-storage-denied.mjs      localStorage throwing: visible warning, in-memory scoring
  scenarios/settings-haptics.mjs 按键震动: on/off counts, on-screen keys only, panel toggle persistence
  scenarios/number-negative.mjs          negative result, negative base
  scenarios/number-float-display.mjs     float64 formatting: 0.1+0.2, 1/3, 20-digit operand
  scenarios/number-literal-preserved.mjs leading zeros and a bare dot stay literal in expression and history
  scenarios/number-decimal-sum.mjs       9.5 + 9.2 + 9 does not drift
  scenarios/keyboard-dialog.mjs          modal dialog swallows physical keys; Esc returns focus to the gear
  scenarios/keyboard-result-state.mjs    a digit after a result starts a new calculation
  scenarios/keyboard-edit-draft.mjs      keyboard entry appends an operand to the edit draft; Esc characterization
  scenarios/keyboard-operand-input.mjs   a focused operand input keeps its own keystrokes
  evidence/roster-two-line.mjs  PNG + metrics evidence run for the two-line rows (320/390, 50-row, red/green/suite logs)
  examples/verify-adapter.mjs  runnable example of a Kekkai instrument
  suite.mjs                   CLI + `runSuite({ artifact, only })`
```

`node_modules/` is gitignored, so it is not part of `TREE_SHA256` (`git ls-files
--exclude-standard` skips it).

## Wiring a gate verifier

```js
import { runSuite } from "../../../tests/suite.mjs";

const artifact = process.env.KEKKAI_ARTIFACT ?? "../../../index.html";
const results = await runSuite({ artifact, only: ["self-contained", "layout", "compute"] });
// Map scenario results onto this gate's H ids, add gate-specific checks, then write
// hard-r<N>.txt to process.env.KEKKAI_OUT_DIR with the required Kekkai header/block.
```

Four rules, all inherited from the runner contract:

1. **Honor `KEKKAI_ARTIFACT`.** The mutation check truncates the artifact, copies it to a
   scratch path, and reruns the instrument with that env. The suite already takes the path
   as an argument; never hardcode `/ws/cal_phone/index.html`.
2. **Honor `KEKKAI_OUT_DIR`.** The suite returns data; the gate's `verify.mjs` owns the
   stamp (`ROUND:`, `ARTIFACT_SHA256:`, `VERIFIER_SHA256:`, `H<n> PASS|FAIL — …`,
   `HARD: PASS|FAIL (…)`) and writes it to `KEKKAI_OUT_DIR`.
3. **Keep mutation discrimination.** A truncated artifact must flip at least one
   previously passing H to FAIL. The scenarios assert behavior, so they do; run
   `node tests/suite.mjs --artifact <truncated-copy>` to confirm after changing scenarios.
4. **Keep independence.** This directory is business code the executor can edit. A gate
   that cares about a stable regression baseline should pin the sha256 of the suite files
   in its §3 prompt or an H check. Contract-specific assertions belong in the gate's
   `verify.mjs`, not only in a "suite passed" roll-up. The independent final still
   re-derives checks without reading the instrument.

## Current baseline vs. the next gate

`cold-start` defaults to the current product: numeric keys are **disabled** until an
operator is chosen. The draft `phone-calculator-number-entry-111612` intentionally reverses
that. Its verifier should use `coldStart({ keyMode: "enabled" })` (see
`scenarios/core.mjs`) and keep the rest of the suite as regression coverage.

## Adding a scenario

Add a file under `scenarios/`, export `{ id, run({ browser, artifact }) }` (or an array
`scenarios`), return an array of `check/eq/near` results, and include it in `suite.mjs`.
Prefer a fresh context per scenario; always assert `clean(...)` at the end.
