# Calculator verification map

This directory is the maintained source for proving the user-facing behavior of the mobile calculator (`/ws/cal_phone/index.html`). Read this index, then use the matching feature file as the recipe. The app has one surface: a mobile web page.

## Baseline preconditions

- Launch the app with `bash .agents/skills/verify-calculator/scripts/launch.sh` and use the printed URL (default `http://127.0.0.1:4173`).
- Require `node .agents/skills/verify-calculator/scripts/doctor.mjs` to print `doctor=ok` before trusting any run.
- There is no seed data, no account, and no auth. Each page load starts empty; history is in-memory and disappears on reload.
- Never drive an instance this run did not start. Ports are the isolation boundary; the app keeps no shared state, so two ports can run side by side.
- 320×568 is the narrow viewport; 390×844 is the reference phone. Do not "simulate" 320 px with a window-size flag — the driver sets the browser context viewport.

## Driving conventions

- Every recipe starts from a freshly loaded page in `select` state unless its preconditions say otherwise.
- Drive by clicking the app's own controls — `[data-op]`, `[data-key]`, `[data-testid="history-edit"]` — never by writing into the display or calling page internals.
- Treat the driver commands literally. Run them from the repo root; they resolve their own paths.
- One driver invocation covers one feature and writes one evidence directory. Do not append to an existing run.

## Proof and skip reporting

- Capture the action and the resulting state, not only the final screen: expression, result, input value, history entries, and `data-state`.
- The driver saves a screenshot and an ARIA snapshot per step plus `run.json`; that set is the proof.
- Report a failure with the failed assertion name, its actual value, and the precondition that was unmet.
- Do not report a feature as verified through a neighbouring path. If a mapped entry point cannot be reached, report it as unverified.
- Keep failed runs. Evidence directories are append-only.

## Features

| Feature | Scenario | File |
| --- | --- | --- |
| Choose an operator and compute a result (all four operators, decimals, history) | `basic-addition`, `operator-coverage` | [addition-and-equals.md](./addition-and-equals.md) |
| Type, backspace, and reject a second decimal point | `input-editing` | [addition-and-equals.md](./addition-and-equals.md) |
| Continue a calculation after `=` and switch operators without losing typed digits | `sticky-chaining` | [chained-calculations.md](./chained-calculations.md) |
| Re-open a history record, change it, and recompute | `edit-history` | [edit-history.md](./edit-history.md) |
| Division by zero shows an error and recovers | `division-by-zero` | [division-by-zero.md](./division-by-zero.md) |
| Usable at 320 px and 390 px with 44 px targets | `mobile-layout` | [mobile-layout.md](./mobile-layout.md) |

Every case has a stable ID, priority, preconditions, expected result, and the assertion that enforces it: see the [test-case catalog](./TEST-CASES.md).
