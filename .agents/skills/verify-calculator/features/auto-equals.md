# Auto-equals after N numbers

The gear's 统分设置 includes **自动按等号**: set how many numbers you plan to enter. Every committed number counts — screen `确认`, physical `Enter`, or auto-confirm — and when the current calculation already has an operator and N user-entered numbers, the calculator folds them exactly as if `=` was pressed: the total appears, one history row is written, and no extra tap is needed. `0` or an empty field turns it off (the default). The base is the starting operand and is **not** counted toward N.

## Sub-features

- `auto-equals-setting` — a visible 自动按等号 field in the settings dialog: `[data-testid="settings-auto-equals"]`, initial value `0`, hint `[data-testid="auto-equals-hint"]`.
- `auto-equals-range` — positive integers 1–999 take effect; `0` or empty is off; junk (`abc`, `2.5`, `1000`, `-1`) is ignored and the field falls back to the last valid value on blur or close.
- `auto-equals-persist` — the count is saved as `autoEquals` in `cal-phone.settings.v1`, survives a reload, and lights the gear indicator and 已自定义 summary.
- `auto-equals-trigger` — after a successful commit in `input` state with an operator, when the current calculation has at least N user-entered numbers, the app runs the same `=` path: result shown, state `result`, one history row.
- `auto-equals-n1` — N = 1 folds a single number into itself (`8` → `8`), with a history row.
- `auto-equals-base-excluded` — with base 10 and N = 3 the user still enters three scores; the base is added once and is not one of the three.
- `auto-equals-paths` — commits from the screen `确认`, physical `Enter`, and the auto-confirm timer all count.
- `auto-equals-no-operator` — committed numbers do not fold without an operator, and choosing an operator does not trigger; the next successful commit does.
- `auto-equals-edit-excluded` — the history edit draft (`data-state=edit`) never auto-folds.
- `auto-equals-divzero` — a zero divisor at the threshold enters the normal error state (`不能除以零`, `data-error="true"`), exactly like manual `=`.

## How to get to it (user POV)

- Tap the gear at the top-right and find 自动按等号 under 自动确认停顿.
- Type the number of scores you plan to enter, e.g. `3` (`0` or empty disables it). Tap 完成.
- Pick `+` (or another operator) and enter each score: tap digits, then 确认 — or let auto-confirm commit it.
- After the third commit the total appears by itself; no `=` tap. The operator stays selected and the next calculation starts counting from zero again.

## Driving it with the Playwright driver

Preconditions:

- `doctor.mjs` reports `doctor=ok`.
- The driver starts a fresh context, so settings are at defaults: auto-confirm `0`, base off, base `0`, auto-equals `0`.

- **Configure and persist.** The `settings-panel` scenario opens the dialog and asserts the new field: initial value `0`, accessible name containing 自动 and 等号, and a hint matching `等号|=` (`02-settings-panel-open.png` there). The `auto-equals` scenario sets `3`, then reloads at the end and re-opens the dialog: the value is still `3` and the indicator is visible.
- **Trigger at N = 3.** Run `node .agents/skills/verify-calculator/scripts/drive.mjs --feature auto-equals` (scenario `auto-equals`). Set `3`, choose `+`, commit `95` and `92`: state stays `input`, expression `95 +` then `95 + 92 +`, result empty. Commit `90`: state `result`, expression `95 + 92 + 90`, result `277`, input empty, history 1 (`01-auto-equals-after-third-number.png`). The scenario never clicks `=`.
- **N = 1.** Set `1`, choose `+`, commit `8`: result `8`, history +1 (`02-auto-equals-single-number.png`).
- **Base excluded.** Set `3` and base `10`, choose `+`, commit `95` and `92`: still `input`, expression `10 + 95 + 92 +`, no result. Commit `90`: result `287`, expression `10 + 95 + 92 + 90`, history `data-base="10"` (`03-auto-equals-with-base.png`).
- **Needs an operator.** Set `2`, commit `1` and `2` without an operator: `input`, expression `1 2`, no result. Choose `+`: still no result. Commit `3`: result `6`, expression `1 + 2 + 3` (`04-auto-equals-needs-operator.png`).
- **Edit draft is excluded.** With N = 2, commit `5` and `5` to auto-fold `10`; set N = 1; open 编辑, type `3`, press 确认: still `edit`, history unchanged, then 关闭 returns to `result` (`05-auto-equals-does-not-fire-in-edit.png`).
- **Auto-confirm counts.** Set N = 2 and auto-confirm `2`, choose `+`, type `95` and wait for the auto commit (`95 +`, no result); type `92` and wait: result `187`, state `result` (`06-auto-equals-with-auto-confirm.png`).
- **Division by zero.** Set N = 2, choose `/`, commit `5` then `0`: state `error`, result `不能除以零`, `data-error="true"` (`07-auto-equals-division-by-zero.png`).
- **Off.** Set `0`, choose `+`, commit `95`, `92`, `90`: state stays `input`, result empty; tapping `=` gives `277` (`08-auto-equals-off.png`).
- **Threshold change.** With N = 0, commit `1` and `2`, then set N = 2 and close: nothing folds. The next commit (`3`) gives `6`.
- **Proof.** `run.json` has `ok=true`, empty `consoleErrors`, eight captures.

## Gotchas

- The counter counts numbers, not digits: `9.5` is one number. The base is never counted.
- The check runs only after a successful commit. Choosing an operator, changing the threshold, or opening/closing the dialog never folds an already-satisfied count.
- An empty 确认 adds nothing and does not advance the count. `退格` on an empty display removes the last committed number and lowers the count.
- The edit draft never auto-folds, even when N would be satisfied there.
- After an auto-fold the operator is sticky, `data-state=result`, and the next typed digit starts a new calculation whose count begins at zero.
- The settings dialog pauses auto-confirm only; auto-equals is not a timer.
- `0`/empty is off; values outside 1–999 are ignored and the field restores the last valid value on blur/close.
- The trigger is equivalent to pressing `=`: division by zero, history, and the state label use the same path.
