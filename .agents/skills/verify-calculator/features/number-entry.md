# Enter numbers

A user can type digits before choosing an operator, use either the on-screen keypad or a physical keyboard, and correct the draft with `退格`. Digits stay out of the expression until `回车` (or auto-confirm) commits them.

## Sub-features

- `entry-optional-operator` accepts digits in `select` and moves to `input` without an operator.
- `entry-commit-without-operator` commits a number with `回车` even before an operator is chosen.
- `entry-keyboard` accepts physical digits, `Enter`, `=`, and `Backspace` on the page.
- `entry-dot` appends one decimal point and ignores a second.
- `entry-backspace` deletes one character from the display.
- `entry-empty-enter` adds no operand and leaves the expression alone.
- `entry-single-operand` evaluates a one-number expression to that number.

## How to get to it (user POV)

- Open the page and tap digits immediately — no operator required.
- Tap `+ - * /` at any point to attach an operator; committed digits are kept.
- Use a physical keyboard anywhere on the page except inside an operand input or the settings dialog.
- Tap `退格` to correct the current entry; `回车` to commit it.

## Driving it with the Playwright driver

Preconditions:

- `doctor.mjs` reports `doctor=ok`.
- The page is freshly loaded with default settings.

- **Type before choosing an operator.** Run `node .agents/skills/verify-calculator/scripts/drive.mjs --feature number-entry`. It taps `12`. Assertions: state `input`, display `12`, expression empty, label `请输入数字，或先选择运算类型` (`01-typed-before-choosing-operator.png`).
- **Commit without an operator.** Tap `回车`. Expression becomes `12`; label becomes `已确认 12，可继续输入或按 = 计算`.
- **Choose the operator afterwards.** Choose `+`; expression becomes `12 +`, then enter `3`, `=`. Result `15`, history 1 (`02-operator-chosen-after-entry.png`).
- **Decimal and backspace.** Reset, choose `+`, tap `7 . . 5`. Display `7.5` (second dot ignored). Two `退格` presses give `7.` then `7` (`03-duplicate-dot-ignored.png`, `04-backspace-trims-entry.png`).
- **Empty `回车`.** Commit `7`, then press `回车` on the empty display. Expression stays `7 +`, history unchanged (`05-empty-enter-adds-nothing.png`).
- **Single operand.** Press `=`; result `7`, history 1 (`06-single-operand-result.png`).
- **Physical keyboard.** Reset, choose `+`, type `45`, `Enter`, `5`, `Enter`, `=`. Result `50`, expression `45 + 5` (`07-physical-keyboard-entry.png`). `Backspace` clears a typed digit.
- **Proof.** `run.json` `ok=true`, empty `consoleErrors`, seven step captures.

## Gotchas

- The keypad is not disabled in `select`; a digit starts the draft. Assertions that expect disabled keys are stale.
- `+ - * /` is only needed to evaluate. A committed number without an operator shows in the expression but `=` does nothing.
- The physical-keyboard handler ignores events from the settings dialog and operand inputs; don't assert page-level keys while the dialog is open.
- `退格` on an empty display is **not** a no-op any more: in `input`/`edit` it undoes the last committed operand. See [backspace-undo.md](./backspace-undo.md).
- The display input is readonly; tapping it does not open a native keyboard. All entry is through the keypad, physical keys, or auto-confirm.
