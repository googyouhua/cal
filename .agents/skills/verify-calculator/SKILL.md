---
name: verify-calculator
description: Drive and prove the mobile calculator in this repo (index.html) — score-tally settings (auto-confirm, base score, auto-equals after N numbers), optional-operator keypad entry, backspace undo, chained calculations, history editing/cancel, division-by-zero recovery, and 320/390 px mobile layout. Use when asked to verify a calculator change, reproduce a calculator bug through the real UI, or capture screenshots/DOM evidence that a computation path works.
---

# Verify the mobile calculator

`index.html` is the whole app: one self-contained page, Chinese UI, no build step, no external assets, no accounts. A user picks one of `+ - * /` (optional — digits are accepted first), types on the on-screen keypad or a physical keyboard, confirms each number with `回车`, presses `=` to fold operands left to right, and can re-open any history record with `编辑` or leave it with `关闭`.

The app is also used for **统分** (score tallying). A gear in the top-right opens 统分设置: auto-confirm after a pause, a base score added as the first operand of every calculation, and auto-equals — fold automatically after a configured number of committed numbers. Settings persist in `localStorage` (`cal-phone.settings.v1`); history is in-memory only, so a reload clears history but keeps settings.

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
- Do not drive an instance you did not start. The app keeps no shared state, so parallel ports are safe; a single port is not. Settings live in the browser context's `localStorage`: every `drive.mjs` scenario opens a fresh context, so it starts at defaults; a reused context keeps the previous run's settings.
- The repo also ships its own acceptance suite in `tests/` (see Drive). It is the shared regression baseline; this skill is the evidence-capture layer on top of the same app.

## Doctor

One read-only check, safe to run any time:

```bash
node .agents/skills/verify-calculator/scripts/doctor.mjs
# or: node .../doctor.mjs --url http://127.0.0.1:4180 --no-browser
```

It checks: our pid file is alive and owns an `http.server`; `/` returns 200; served bytes hash-equal `index.html` (right version); `<title>手机计算器</title>`; every required `data-testid` (including the settings dialog, auto-equals field, base marker, auto-confirm progress, edit cancel) and four `data-op` hooks are present; no external `http(s)` references; viewport meta present; and — unless `--no-browser` — a real Chromium boot leaves the app in `select` state with all 14 keys enabled, a settings dialog that opens and closes, 24 auto-confirm options, and zero console errors.

Ends with `doctor=ok` (exit 0) or `doctor=failed checks=[...]` (exit 1). `--resolve-only` only reports the Playwright version (`setup.sh` uses it).

## Drive

All driving goes through one Playwright driver. It clicks the real buttons a user clicks, asserts DOM state, and writes evidence.

```bash
node .agents/skills/verify-calculator/scripts/drive.mjs --list
node .agents/skills/verify-calculator/scripts/drive.mjs --feature score-tally-settings
node .agents/skills/verify-calculator/scripts/drive.mjs --scenario base-score --url http://127.0.0.1:4180
node .agents/skills/verify-calculator/scripts/drive.mjs --scenario auto-confirm --headed   # watch it
```

The driver exits `0` only when every assertion passed and no page error or console error was logged. On failure it prints each failed assertion with actual vs expected and still writes the evidence directory.

| Scenario | Feature | Covers |
| --- | --- | --- |
| `basic-addition` | addition-and-equals | select → enter → commit → `=` → history → reload |
| `operator-coverage` | addition-and-equals | `+ - * /` and decimals |
| `number-entry` | number-entry | digits before an operator, physical keyboard, dot, backspace, empty `回车` |
| `backspace-undo` | backspace-undo | undo committed operands, edit-state undo, no undo after `=` |
| `settings-panel` | score-tally-settings | gear, dialog, Esc/focus, indicator, auto-equals field defaults, persistence after reload |
| `auto-confirm` | score-tally-settings | pause-to-confirm, timer restart, trailing dot, off, dialog pause |
| `base-score` | score-tally-settings | base in expression/history, off, `/` and `*`, frozen snapshot, live change |
| `auto-equals` | auto-equals | N committed numbers fold automatically, N=1, base excluded, no-operator/edit/off/division edge cases, persistence |
| `sticky-chaining` | chained-calculations | sticky operator, operator switch keeps digits, reset |
| `edit-history` | edit-history | edit, recompute, switch operator, remove, pending edit, cancel |
| `division-by-zero` | division-by-zero | error state, recovery by typing, `0/5`, reset |
| `mobile-layout` | mobile-layout | 320/390, settings panel, base marker, progress bar |

`--feature` maps a feature to its default scenario (see `--list`); other scenarios in the same feature are reached with `--scenario`.

### Repo acceptance suite

`tests/` contains the repository's shared Playwright suite (18 scenarios, 206 checks). Run it as an independent regression signal:

```bash
cd tests && node suite.mjs            # exit 0 only if every scenario passes
node suite.mjs --only compute,edit-multi
```

It loads the artifact over `file://`, so it does not exercise `localStorage` persistence and does not capture screenshots. Use it when calculator logic or history/edit semantics change; use this skill's driver for score-tally settings, persistence, evidence, and user-path screenshots. If the two disagree, treat the repo suite's behavior checks as the regression baseline and investigate the difference before trusting either.

Selectors are the app's stable hooks — use these, not CSS positions:

| Thing | Handle |
| --- | --- |
| App state | `.app[data-state]` = `select` / `input` / `result` / `edit` / `error` |
| State text | `#state-label` (Chinese status line) |
| Operator buttons | `[data-op="+"]` … `[data-op="/"]` (four, `aria-label` 加法/减法/乘法/除法) |
| Keypad | `[data-key="0"…"9"]`, `[data-key="."]`, `[data-key="enter"]` (回车), `[data-key="backspace"]` (退格), `[data-testid="key-equals"]` (=) |
| Digit display | `input[data-testid="calc-input"]` (readonly; keypad/keyboard writes into it) |
| Expression / result | `[data-testid="expression"]`, `[data-testid="result"]` (`data-value`, `data-error="true"`) |
| Reset to operator select | `[data-testid="key-op"]` (运算类型; disabled only in `select`) |
| Settings | `[data-testid="settings-toggle"]`, `…-panel"` (native `<dialog>`), `…-auto-confirm"` (`<select>`), `…-auto-equals"` (count input), `[data-testid="auto-equals-hint"]`, `…-base-toggle"`, `…-base-value"`, `…-done"`, `…-indicator"`, `…-summary"` |
| Auto-confirm / base | `[data-testid="auto-confirm-progress"][data-active]`, `[data-testid="base-marker"]`, `[data-testid="edit-base-marker"]` |
| History | `[data-testid="history-item"]` (`data-operator`, `data-operands`, `data-base`), `…-expression`, `…-result`, `…-edit` (编辑) |
| Edit draft | `[data-testid="edit-draft"]`, `…-edit-operator`, `[data-testid="edit-cancel"]` (关闭), `…-operand-chip`, `…-operand-input`, `…-operand-remove` |

Typical user path: pick operator (or type first) → tap digits → `回车` → tap more digits → `回车` → `=`.

Feature-by-feature recipes live in [`features/README.md`](./features/README.md). Read the index first; it maps every feature to a scenario and lists the shared preconditions. A proof that drives one convenient path does not cover the other mapped entry points. The [test-case catalog](./features/TEST-CASES.md) assigns every case a stable ID, priority, expected result, and the assertion that enforces it.

## Evidence

The driver writes to `.agents/skills/verify-calculator/evidence/runs/<UTC-timestamp>-<scenario>/`:

- `run.json` — scenario, URL, viewport, `artifactSha256`, Playwright version, every assertion with actual/expected, all console lines, `failedAssertions`, `ok`.
- `steps/NN-<name>.png` — full-page screenshot after each meaningful state (action + resulting state).
- `steps/NN-<name>.aria.txt` — ARIA snapshot of `<main>` at the same moment.

Proof standards:

- Exercise the user path: click `[data-key]`, `[data-op]`, `[data-testid="history-edit"]`, `[data-testid="settings-toggle"]`. Do not set values through `page.evaluate` or call internal functions — there is no test-only endpoint to cheat with, and a proof that does is invalid.
- Capture the action **and** the resulting state. A result alone does not prove that `回车` committed the number; assert the expression, the cleared input, and the result together.
- Verify side effects, not just pixels: history count/expression/result/base, `result[data-value]`, `data-error`, `data-state`, disabled state, the settings indicator, `localStorage` after reload.
- Settings persistence is a real side effect: reload and re-open the dialog rather than trusting the live controls.
- Reload is a legitimate reset proof for history (仅当前页面). Do not report reload-cleared history as data loss, and do not assert settings cleared by reload.
- A failed run is evidence too: keep `run.json`, report the failed assertion name, the actual value, and the precondition that blocked it. Never delete or overwrite an earlier run directory.

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

- The keypad is enabled in `select`. Digits typed before an operator start an `input` draft with the prompt `请输入数字，或先选择运算类型`; do not assert disabled keys.
- `=`, when there is no operator, does nothing (operands can be committed, but folding needs an operator).
- `退格` has two modes: with text in the display it deletes one character; with an empty display in `input`/`edit` it **undoes the last committed operand** and says `已撤回 X`. In `result`/`error` it does nothing.
- The base is the first operand, not a divisor: `base 100 / 4 = 25`, and division-by-zero only checks entered operands. Base `0` is valid (`0 * 5 = 0`).
- History stores the base snapshot. Changing the base later does not change old records, and editing an old record recomputes with **its** base. New calculations use the current base.
- The base marker (`基数 10`) is visible only after an operator is chosen; the edit draft shows the record's base in `[data-testid="edit-base-marker"]`.
- Auto-confirm only fires when `t > 0`, the settings dialog is closed, the display is non-empty, and it does not end with `.`. Any keypress restarts the timer; opening the dialog pauses it and closing restarts the full wait. It calls the same commit as `回车` — it never presses `=`, but its commit does count toward auto-equals.
- While `input`/`edit` is open, the expression ends with the pending operator (`12 +`, `12 + 30 +`); `=` settles it into the final expression without the trailing operator (`12 + 30`). Assert the trailing operator in live states and the settled text after `=`.
- Auto-equals fires only after a successful commit (screen `确认`, physical `Enter`, or auto-confirm). The count is committed numbers, not digits, and the base is not counted. Choosing an operator, changing N, or closing the dialog never folds an already-satisfied count; the `edit` draft never folds at all. `0`/empty is off; 1–999 is accepted; N=1 folds one number into itself.
- While the countdown or undo-hint overlay is visible, `#state-label` is `visibility: hidden` and `innerText` is empty; read `textContent` for the state-machine message and `[data-testid="undo-hint"]` for the visible status.
- Settings persist in `localStorage`; a reload keeps them while history is cleared. Every driver scenario uses a fresh context, so defaults apply unless the scenario configures settings.
- `data-operator` on `.app` lags while editing: switching the operator in the edit draft updates `[data-testid="edit-operator"]` and the expression immediately, but `.app[data-operator]` only updates after `=`. Assert the edit-draft glyph in edit state.
- Clicking an operand input clears it for immediate replacement (`data-pending="true"`); blurring restores the original unless the user typed. `关闭` (`edit-cancel`) restores the whole pre-edit view and leaves history untouched.
- `=` first commits an uncommitted number (type `8` and press `=` directly). Do not require a `回车` before `=`.
- The result of a single-operand expression equals that operand (`8` → `8`).
- After `=`, the chosen operator is sticky: type `5`, press `=` → `5`, still on the same operator.
- `0 / 5 = 0` is not an error; only a zero divisor enters the error state.
- 320 px is the narrow case; Chromium headless honors the context viewport directly, so no window-size tricks are needed. The settings dialog is 304 px wide at 320 px and must not overflow.

## Maintaining this skill

The feature map is the maintained source: when the UI changes, update the affected feature file and its scenario in `drive.mjs`, then re-run that scenario. Keep the repo's `tests/suite.mjs` green as the independent regression baseline. A cadence is only worth setting if the user asks.
