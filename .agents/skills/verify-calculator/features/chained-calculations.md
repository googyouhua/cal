# Continue and switch calculations

After `=`, the chosen operator stays active for the next calculation, and an operator chosen mid-entry keeps the digits already typed. This is the "手机计算器" behavior the subtitle advertises: `选运算符，用屏幕数字键盘输入；= 后沿用运算符`.

## Sub-features

- `sticky-operator` keeps the last operator after a result; a new number plus `=` starts a fresh expression with that operator.
- `single-operand-result` returns the operand itself when only one number is entered.
- `switch-keeps-input` changes the operator while the display holds uncommitted digits and keeps those digits.
- `switch-updates-hint` updates the status line to `已更换为 <op>，已输入的数字会保留`.
- `explicit-reset` returns to operator selection and clears expression, result, and draft.

## How to get to it (user POV)

- Finish a calculation with `=`, then type a number and press `=` again.
- Or choose a different operator while the display already holds digits.
- Choose `运算类型` to abandon the current operator and pick a new one.

## Driving it with the Playwright driver

Preconditions:

- `doctor.mjs` reports `doctor=ok`.
- The page is freshly loaded; the operator row is visible.
- 结果后暂停输入已关闭（`resultPause=0`）：`drive.mjs` 在本场景注入该设置，因为默认 2 秒暂停会吞掉紧跟结果的数字键；暂停行为由 `settings-pause` 与 `result-pause-warning` 覆盖。

- **First result.** Run `node .agents/skills/verify-calculator/scripts/drive.mjs --feature chained-calculations`. It chooses `+`, enters `6`, `回车`, `7`, `回车`, `=` and asserts result `13`, expression `6 + 7`, history 1 (`01-first-result.png`).
- **Continue with the same operator.** Tap `5`, then `=`. The driver asserts result `5`, expression `5`, `.app[data-operator]` still `+`, history 2 (`02-continue-with-same-operator.png`). No operator selection was needed.
- **Two-operand chain.** Tap `2`, `回车`, `3`, `回车`, `=`. Result `5`, expression `2 + 3`, history 3 (`03-two-operand-chain.png`).
- **Switch operator mid-entry.** Press `运算类型` (state returns to `select`), choose `-`, tap `9`, then choose `*`. Assertions: state `input`, display still `9`, label `已更换为 *，已输入的数字会保留` (`04-operator-switch-keeps-typed-digits.png`).
- **Finish after switching.** Tap `回车` → expression `9 *`; tap `=` → result `9` and `.app[data-operator]` is `*`.
- **Proof.** `run.json` has `ok=true`, `consoleErrors=[]`, and the four step screenshots.

## Gotchas

- The sticky operator is per-page only; a reload returns to `select`.
- Pressing `=` immediately after a result with an empty display does nothing — there is no number to fold.
- "Keep typed digits" applies only to an uncommitted number in the display. Already committed operands are kept too, but the expression is rebuilt from the new operator, e.g. `12 +` becomes `12 *` before more input.
- Switching operator is not the same as `运算类型`: switching keeps the draft, reset clears it. Do not assert a cleared expression after a switch.
- `data-operator` on `.app` tracks the committed operator, not the live selection in the edit draft (see the edit-history feature).
