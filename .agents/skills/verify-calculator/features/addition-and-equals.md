# Compute a result

A user selects one operator, enters numbers on the on-screen keypad, confirms each number with `回车`, and presses `=` to see the full expression and the folded result. Every computation is appended to the on-page history.

## Sub-features

- `select-operator` reveals the keypad only after one of `+ - * /` is chosen.
- `enter-number` types digits into the display; digits stay out of the expression until `回车`.
- `commit-number` appends the confirmed number to the expression and clears the display.
- `equals` folds all operands left to right with the chosen operator and shows expression + result.
- `history-append` adds the finished expression and result to 计算历史, newest first.
- `reload-reset` clears everything on reload because history is per-page (仅当前页面).
- `operator-coverage` produces correct results for `+ - * /` and decimal operands.

## How to get to it (user POV)

- Open the page: the operator row (`+ - * /`) is visible and the keypad is disabled.
- Choose an operator, for example `+`.
- Tap digits, tap `回车`; repeat for more numbers.
- Tap `=`; read the expression above and the amber result below.
- Choose `运算类型` to return to operator selection before a new calculation.

## Driving it with the Playwright driver

Preconditions:

- `doctor.mjs` reports `doctor=ok` for the URL.
- The page was loaded by this run and has not been driven yet.

- **Initial state.** Open the page. Run `node .agents/skills/verify-calculator/scripts/drive.mjs --feature addition-and-equals`. Assertions `initial.state=select`, `initial.keypad_disabled=true`, `initial.operator_choices=4`, `initial.history=0` pass; step `01-initial-select.png` is captured.
- **Select operator.** Choose `+`. The driver clicks `[data-op="+"]`; `operator.state=input`, `operator.keypad_enabled=true`, and the label reads `已选择 +，请输入数字` (`02-operator-selected.png`).
- **Type before commit.** Tap `1 2`. The display holds `12` while `[data-testid="expression"]` is still empty (`03-digits-before-enter.png`). This is the proof that typing alone does not commit.
- **Commit.** Tap `回车`. The expression becomes `12 +` and the display clears.
- **Second operand.** Tap `3 0` then `回车`. The expression becomes `12 + 30`.
- **Equals.** Tap `=`. `data-state=result`, result text and `data-value` are `42`, expression stays `12 + 30`, history has one entry reading `12 + 30` → `42` (`04-sum-result-and-history.png`).
- **Reload.** Reload the page. `data-state=select` and history count is `0` (`05-reload-clears-in-memory-history.png`).
- **All operators.** Run `node .agents/skills/verify-calculator/scripts/drive.mjs --scenario operator-coverage`. It resets between cases and asserts: `12+30+8=50`, `10-4-3=3`, `2*3*4=24`, `100/5/2=10`, `1.5+2.25=3.75`, with one screenshot per case and a growing history count.
- **Editing keys.** Run `node .agents/skills/verify-calculator/scripts/drive.mjs --scenario input-editing`. It types `7..5` (second `.` ignored → `7.5`), backspaces to `7.` then `7`, commits, presses `回车` again on an empty display (no operand, no history), backspaces on empty (no-op), then `=` → `7`. Four screenshots.
- **Proof.** Inspect `run.json` (`ok=true`, empty `consoleErrors`) and the `steps/*.png` + `steps/*.aria.txt` pairs in the printed evidence directory.

## Gotchas

- The keypad is disabled in `select`; clicking a digit before choosing an operator does nothing by design.
- `回车` is the commit key, not `=`. Only `=` folds the operands; do not assert a result before pressing it.
- The expression for a single committed operand already shows the operator (`12 +`); this is intentional, not a bug.
- The history caption says 仅当前页面. A reload clearing history is the contract, not a regression.
- Results use JavaScript float64: `1/3` renders `0.3333333333333333`. Do not round in assertions.
- `退格` deletes only the last character of the display; on an empty display it is a no-op and must not throw.
