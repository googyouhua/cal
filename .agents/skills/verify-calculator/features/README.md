# Calculator verification map

This directory is the maintained source for proving the user-facing behavior of the mobile calculator (`/ws/cal_phone/index.html`). Read this index, then use the matching feature file as the recipe. The app has one surface: a mobile web page.

## Baseline preconditions

- Launch the app with `bash .agents/skills/verify-calculator/scripts/launch.sh` and use the printed URL (default `http://127.0.0.1:4173`).
- Require `node .agents/skills/verify-calculator/scripts/doctor.mjs` to print `doctor=ok` before trusting any run.
- There is no seed data, account, or auth. Each page load starts with empty history; 统分设置 persist in `localStorage` (`cal-phone.settings.v1`) and survive reloads.
- Every `drive.mjs` scenario opens a fresh browser context, so settings start at defaults (auto-confirm off, base off, base `0`, auto-equals off). A reused context keeps the previous settings — use a new context, not a manual reset, for isolation.
- Never drive an instance this run did not start. Ports isolate instances; the app keeps no shared server state.
- 320×568 is the narrow viewport; 390×844 is the reference phone. Do not "simulate" 320 px with a window-size flag — the driver sets the browser context viewport.

## Driving conventions

- Every recipe starts from a freshly loaded page in `select` state unless its preconditions say otherwise.
- Drive by clicking the app's own controls — `[data-op]`, `[data-key]`, `[data-testid="history-edit"]`, `[data-testid="settings-toggle"]` — never by writing into the display or calling page internals.
- Treat the driver commands literally. Run them from the repo root; they resolve their own paths.
- The keypad is enabled in `select`; digits typed before an operator start an `input` draft.
- One driver invocation covers one scenario and writes one evidence directory. Do not append to an existing run.

## Proof and skip reporting

- Capture the action and the resulting state, not only the final screen: expression, result, input value, history entries (including `data-base`), settings indicator, and `data-state`.
- The driver saves a screenshot and an ARIA snapshot per step plus `run.json`; that set is the proof.
- Settings persistence must be proved by reloading and re-opening the dialog, not by reading the live controls.
- Report a failure with the failed assertion name, its actual value, and the precondition that was unmet.
- Do not report a feature as verified through a neighbouring path. If a mapped entry point cannot be reached, report it as unverified.
- Keep failed runs. Evidence directories are append-only.

## Features

| Feature | Scenario | File |
| --- | --- | --- |
| Choose an operator and compute a result (all four operators, decimals, history) | `basic-addition`, `operator-coverage` | [addition-and-equals.md](./addition-and-equals.md) |
| Type digits before choosing an operator, with keypad or physical keyboard | `number-entry` | [number-entry.md](./number-entry.md) |
| Backspace deletes a character or undoes the last committed number | `backspace-undo` | [backspace-undo.md](./backspace-undo.md) |
| Continue a calculation after `=` and switch operators without losing typed digits | `sticky-chaining` | [chained-calculations.md](./chained-calculations.md) |
| Re-open a history record, change it, recompute, or cancel | `edit-history` | [edit-history.md](./edit-history.md) |
| Division by zero shows an error and recovers | `division-by-zero` | [division-by-zero.md](./division-by-zero.md) |
| Gear settings: auto-confirm, base score, persistence | `settings-panel`, `auto-confirm`, `base-score` | [score-tally-settings.md](./score-tally-settings.md) |
| Fold automatically after N committed numbers (auto-equals) | `auto-equals` | [auto-equals.md](./auto-equals.md) |
| Usable at 320 px and 390 px, including the settings dialog and base marker | `mobile-layout` | [mobile-layout.md](./mobile-layout.md) |

Every case has a stable ID, priority, preconditions, expected result, and the assertion that enforces it: see the [test-case catalog](./TEST-CASES.md).
