---
name: verify-calculator
description: Drive and prove the mobile web calculator in this repo (index.html) — operator selection, screen-keypad entry, chained calculations, history editing, division-by-zero recovery, and 320/390 px mobile layout. Use when asked to verify a calculator change, reproduce a calculator bug through the real UI, or capture screenshots/DOM evidence that a computation path works.
---

# Verify the mobile calculator

`index.html` is the whole app: one self-contained page, Chinese UI, no build step, no external assets, no accounts, no persistence. A user picks one of `+ - * /`, types digits on an on-screen keypad, confirms each number with `回车`, presses `=` to fold the operands left to right, and can re-open any history record with `编辑`. Everything lives in page memory, so a reload is a full reset.

The surface is a mobile web UI. There is no CLI, API, or desktop build.

Paths in this skill are relative to the repo root `/ws/cal_phone`.

## Launch

The app is static; serve the repo root so `/` returns `index.html`.

```bash
bash .agents/skills/verify-calculator/scripts/launch.sh
```

- Default URL: `http://127.0.0.1:4173`. One port is one instance; use `VERIFY_PORT=4180 bash .../launch.sh` for a second instance beside the first.
- Scratch state (pid, server log) lives in `/tmp/verify-calculator/port-<port>/`. The served bytes are always the live `index.html`, so there is no stale build to rebuild.
- Ready looks like this on stdout, and it means `/` answered 200 with the calculator document:

  ```
  ready url=http://127.0.0.1:4173 run_dir=/tmp/verify-calculator/port-4173 pid=12345
  artifact_sha256=<64 hex chars>
  ```

  If it prints `FAIL port_in_use`, choose another port instead of investigating the other process.
- Teardown: `bash .agents/skills/verify-calculator/scripts/stop.sh` (same `VERIFY_PORT`). It kills only the pid it wrote and refuses to kill a process whose command line is not our `http.server`.
- Dependencies: `python3` for the server, `node` >= 22, and Playwright with cached Chromium for driving. If `doctor.mjs` reports Playwright missing, run `bash .agents/skills/verify-calculator/scripts/setup.sh` (needs network; installs into `tools/`, never into the app).
- Do not drive an instance you did not start. Two runs do not share state (no storage, no DB), so parallel ports are safe; a single port is not.

## Doctor

One read-only check, safe to run any time:

```bash
node .agents/skills/verify-calculator/scripts/doctor.mjs
# or: node .../doctor.mjs --url http://127.0.0.1:4180 --no-browser
```

It checks: our pid file is alive and owns an `http.server`; `/` returns 200; served bytes hash-equal `index.html` (right version); `<title>手机计算器</title>`; every required `data-testid` and four `data-op` hooks are present; no external `http(s)` references; viewport meta present; and — unless `--no-browser` — a real Chromium boot leaves the app in `select` state with the keypad disabled and zero console errors.

Ends with `doctor=ok` (exit 0) or `doctor=failed checks=[...]` (exit 1). `--resolve-only` only reports the Playwright version (`setup.sh` uses it).

## Drive

All driving goes through one Playwright driver. It clicks the real buttons a user clicks, asserts DOM state, and writes evidence.

```bash
node .agents/skills/verify-calculator/scripts/drive.mjs --list
node .agents/skills/verify-calculator/scripts/drive.mjs --feature addition-and-equals
node .agents/skills/verify-calculator/scripts/drive.mjs --scenario edit-history --url http://127.0.0.1:4180
node .agents/skills/verify-calculator/scripts/drive.mjs --scenario mobile-layout --headed   # watch it
```

The driver exits `0` only when every assertion passed and no page error or console error was logged. On failure it prints each failed assertion with actual vs expected and still writes the evidence directory.

Selectors are the app's stable hooks — use these, not CSS positions:

| Thing | Handle |
| --- | --- |
| App state | `.app[data-state]` = `select` / `input` / `result` / `edit` / `error` |
| State text | `#state-label` (Chinese status line) |
| Operator buttons | `[data-op="+"]` … `[data-op="/"]` (four, `aria-label` 加法/减法/乘法/除法) |
| Keypad | `[data-key="0"…"9"]`, `[data-key="."]`, `[data-key="enter"]` (回车), `[data-key="backspace"]` (退格), `[data-testid="key-equals"]` (=) |
| Digit display | `input[data-testid="calc-input"]` (readonly; keypad writes into it) |
| Expression | `[data-testid="expression"]` |
| Result | `[data-testid="result"]`, value mirrored in `data-value`, error flag in `data-error="true"` |
| Reset to operator select | `[data-testid="key-op"]` (labeled 运算类型) |
| History | `[data-testid="history-item"]`, `…-expression`, `…-result`, `[data-testid="history-edit"]` (编辑) |
| Edit draft | `[data-testid="edit-draft"]`, `…-edit-operator`, `[data-testid="operand-chip"]`, `…-operand-input`, `…-operand-remove` |

Typical user path (what the driver scripts do): pick operator → tap digits → `回车` → tap more digits → `回车` → `=`.

Feature-by-feature recipes live in [`features/README.md`](./features/README.md). Read the index first; it maps every feature to a scenario and lists the shared preconditions. A proof that drives one convenient path does not cover the other mapped entry points. The [test-case catalog](./features/TEST-CASES.md) assigns every case a stable ID, priority, expected result, and the assertion that enforces it.

## Evidence

The driver writes to `.agents/skills/verify-calculator/evidence/runs/<UTC-timestamp>-<scenario>/`:

- `run.json` — scenario, URL, viewport, `artifactSha256`, Playwright version, every assertion with actual/expected, all console lines, `failedAssertions`, `ok`.
- `steps/NN-<name>.png` — full-page screenshot after each meaningful state (action + resulting state).
- `steps/NN-<name>.aria.txt` — ARIA snapshot of `<main>` at the same moment.

Proof standards:

- Exercise the user path: click `[data-key]`, `[data-op]`, `[data-testid="history-edit"]`. Do not set values through `page.evaluate` or call internal functions — there is no test-only endpoint to cheat with, and a proof that does is invalid.
- Capture the action **and** the resulting state. A result alone does not prove that `回车` committed the number; assert the expression, the cleared input, and the result together.
- Verify side effects, not just pixels: history item count/expression/result, `result[data-value]`, `data-error`, `data-state`, disabled state of the keypad in `select`.
- Reload is a legitimate reset proof (history is in-memory: 仅当前页面). Do not report a reload-cleared history as data loss.
- A failed run is evidence too: keep `run.json`, report the failed assertion name, the actual value, and the precondition that blocked it. Never delete or overwrite an earlier run directory.
- Never copy files into an older run directory or edit `run.json`; each drive creates a new directory.

## Cleanup

```bash
bash .agents/skills/verify-calculator/scripts/stop.sh          # stops port 4173
VERIFY_PORT=4180 bash .agents/skills/verify-calculator/scripts/stop.sh
```

Cleanup removes the instance's `/tmp/verify-calculator/port-<port>/` scratch dir. It never touches `evidence/`. After cleanup, confirm the run directory still contains `run.json` and `steps/`; a cleanup that eats the proof has failed. Browser processes are closed by the driver itself; if a run is killed mid-flight, close the instance with `stop.sh` rather than killing Chromium by name.

## Helpers

All helpers are executable and meant to be invoked exactly as shown.

| Helper | Purpose |
| --- | --- |
| `scripts/launch.sh` | Start the disposable static server; prints `ready url=...` |
| `scripts/stop.sh` | Stop only the instance for that port; remove its scratch dir |
| `scripts/setup.sh` | Install Playwright into `tools/` if resolution fails |
| `scripts/doctor.mjs` | Read-only health/integrity check |
| `scripts/drive.mjs` | Scenario driver + evidence writer (`--list`) |
| `scripts/lib/playwright.mjs` | Shared Playwright resolution (skill tools → repo → `Telos/*` gates → `NODE_PATH`) |

## Known traps

- The app has no favicon; check `run.json` `consoleErrors` before blaming the page, and report the exact text if a resource error appears.
- `data-operator` on `.app` lags while editing: switching the operator in the edit draft updates `[data-testid="edit-operator"]` and the expression immediately, but `.app[data-operator]` only updates after `=`. Assert the edit-draft glyph in edit state.
- `=` first commits an uncommitted number (a user can type `8` and press `=` directly). Do not require a `回车` before `=`.
- The result of a single-operand expression equals that operand (`8` → `8`).
- After `=`, the chosen operator is sticky: type `5`, press `=` → `5`, still on the same operator.
- Empty `回车` adds nothing and must not clear the expression.
- `.` is ignored when the current entry already contains one.
- Division by zero clears the expression, shows `不能除以零` with `data-error="true"`, and can be left either by typing digits then `=` or by `运算类型` (reset).
- 320 px is the narrow case; Chromium headless honors the context viewport directly, so no window-size tricks are needed.

## Maintaining this skill

The feature map is the maintained source: when the UI changes, update the affected feature file and its scenario in `drive.mjs`, then re-run that scenario. A cadence is only worth setting if the user asks.
