# Score-tally settings (auto-confirm and base)

The gear in the top-right opens 统分设置. It controls **auto-confirm** — commit the current number after a pause instead of tapping `回车` — and a **base score** added as the first operand of every calculation. The third control, **auto-equals**, folds the calculation after a configured number of committed numbers; its full recipe lives in [auto-equals.md](./auto-equals.md). A fourth control, **结果后暂停输入** (`resultPause`, default 2 s), parks the keypad after every result and answers a blocked digit, `.` or Backspace with a short double tone. All three persist in `localStorage` and are independent of the in-memory history.

## Sub-features

- `settings-open` opens a modal dialog from the gear, with focus in the first control.
- `settings-close` closes via `完成`, `Esc`, or a backdrop click and returns focus to the gear.
- `settings-indicator` shows a 9 px amber dot when auto-confirm or base is active.
- `settings-auto-confirm` offers 23 steps: off, 0.2 s, 0.4 s, 0.5 s, 1 s … 10 s; default off.
- `settings-auto-commit` commits the current number after the chosen pause, with a progress bar and `已确认 X` status.
- `settings-auto-pause` restarts the timer on every keystroke; pauses while the dialog is open; skips empty, trailing-dot, and non-numeric input.
- `settings-base` adds the base as the first operand, shows it in the expression, marker, status line, and history.
- `settings-base-snapshot` freezes the base into each history record; editing an old record uses its own base.
- `settings-persist` survives a reload; reset (运算类型) does not clear settings.
- `settings-result-pause` gates digits, `.` and Backspace for 2 s after a result (0–10 s, one decimal, `0` off); its acceptance scenario is `result-pause-warning`.

## How to get to it (user POV)

- Tap the gear at the top-right of the header.
- Choose a pause in 自动确认停顿; enable 启用基数 and type a base value (0, negative, or decimal); adjust 结果后暂停输入 (default 2).
- Tap 完成, `Esc`, or outside the dialog to close.
- Type digits and stop: after the pause the number is committed automatically (never `=`).
- With base enabled, every new calculation starts from the base.

## Driving it with the Playwright driver

Preconditions:

- `doctor.mjs` reports `doctor=ok`.
- The driver starts a fresh context, so settings are at defaults: auto-confirm `0`, base off, base `0`.

- **Dialog open/close.** Run `node .agents/skills/verify-calculator/scripts/drive.mjs --feature score-tally-settings` (scenario `settings-panel`). The gear is ≥44×44 and the dialog is closed initially (`01-settings-toggle-closed.png`). Clicking it opens the native `<dialog>`, sets `aria-expanded=true`, focuses `settings-auto-confirm`, shows 23 options with `0` selected, base unchecked and its input disabled; the auto-equals field shows `0`, its accessible name contains 自动/等号, and its hint mentions `=` (`02-settings-panel-open.png`). `Esc` closes it and returns focus to the gear.
- **Configure.** Reopen, select `1.5`, enable base, fill `10`. The indicator becomes visible. `完成` closes the dialog and focuses the gear (`03-settings-configured.png`).
- **Persist.** Reload. The indicator is still visible; reopening shows `1.5`, base checked, value `10` (`04-settings-persist-after-reload.png`). A computation followed by 运算类型 leaves the indicator on.
- **Auto-confirm.** Run `--scenario auto-confirm`. It sets a 2 s pause, chooses `+`, taps `95`, and waits for expression `95 +` with the display cleared. The status label's text is `已确认 95…` (it is visibility-hidden while the overlay shows), and the visible undo hint names `95` (`01-auto-confirmed-number.png`). It then proves a keystroke restarts the timer: type `9`, wait 0.9 s, type `5`, wait 0.7 s — expression must still be empty with display `95`, then commit (`02-timer-restarts-on-keystroke.png`). `9.` is not auto-confirmed (`03-trailing-dot-not-confirmed.png`); `t=0` does nothing (`04-auto-confirm-off.png`); an open dialog pauses the timer and closing restarts it (`05-settings-panel-pauses-timer.png`).
- **Base.** Run `--scenario base-score`. Base `10` + `9.5` + `9.2` + `9` = `37.7`, expression `10 + 9.5 + 9.2 + 9`, marker `基数 10`, history `data-base="10"` (`01-base-marker-and-expression.png`, `02-base-in-sum-and-history.png`). Base off gives `27.7` (`03-base-disabled.png`); `100 / 4 = 25` (`04-base-in-division.png`); `0 * 5 = 0` (`05-base-zero.png`). Changing the base to `100` after a record and editing that record still recomputes with `10` (`06-history-keeps-base-snapshot.png`); a new calculation uses `100`; changing the base mid-entry redraws `200` and keeps the typed `5` (`07-base-changed-mid-entry.png`).
- **Proof.** Each scenario's `run.json` has `ok=true` and empty `consoleErrors`; screenshots show the dialog, marker, progress bar, and history rows.

## Gotchas

- Auto-confirm commits; it never presses `=`. After the pause the number joins the expression and the display clears, but the result stays empty until `=`.
- `9.` is deliberately not committed — wait for another digit or press `回车`. A `9.5` typed quickly is committed as one number.
- While the countdown or undo hint is visible, `#state-label` is `visibility: hidden` (the overlay carries the visible message). Read its `textContent` for the state-machine label; use `[data-testid="undo-hint"]` for what the user actually sees.
- Opening the dialog stops the timer; closing restarts the full wait, not the remaining time.
- The progress bar is 2 px and uses `data-active="true"`; assert the attribute, not the animation width.
- The base is not a divisor. `100 / 4` with base `100` is `25`; a zero divisor only comes from entered operands.
- The base marker appears only after an operator is chosen. In `select`, the base is in the settings and the status line, but not the expression.
- History keeps a base snapshot. Editing an old record never inherits the current base, and changing the base must not rewrite old results.
- Settings live in `localStorage`; history does not. Reload clears history but keeps settings — assert both, and use a fresh context for a clean default run.
- The settings dialog is a native modal: while it is open, page-level keyboard digits are ignored. Close it before driving the keypad.
