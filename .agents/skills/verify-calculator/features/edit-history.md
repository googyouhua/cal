# Edit a history record

Every finished calculation appears in 计算历史. Its `编辑` button reopens the record as an editable draft: each operand becomes an input with a `×` remove button, and the operator can be changed. Pressing `=` recomputes and appends a new history record.

## Sub-features

- `edit-open` turns a history record into an edit draft with one chip per operand.
- `edit-operand` changes a chip value and updates the live expression.
- `edit-remove` removes an operand chip; the expression shrinks accordingly.
- `edit-operator` switches the operator inside the draft without clearing operand chips.
- `edit-recompute` appends the recomputed record to the top of the history.
- `edit-single-operand` evaluates a one-operand draft to that operand.
- `edit-pending` clears an operand input on focus so a new value can be typed; blur restores the old one unless edited.
- `edit-cancel` closes the draft with `关闭` and restores the exact pre-edit view, leaving history untouched.
- `edit-base` shows an immutable base marker for records computed with a base.

## How to get to it (user POV)

- Compute something so 计算历史 has a record, e.g. `2 + 3 = 5`.
- Press `编辑` on that record.
- Change values in the draft inputs, press `×` to drop a number, or choose another operator.
- Press `=` to recompute, or `关闭` to leave without changes.

## Driving it with the Playwright driver

Preconditions:

- `doctor.mjs` reports `doctor=ok`.
- The page is freshly loaded.

- **Produce a record.** Run `node .agents/skills/verify-calculator/scripts/drive.mjs --feature edit-history`. It enters `2 + 3 =` and asserts result `5`, history 1 (`01-original-result.png`).
- **Open the draft.** Click `[data-testid="history-edit"]` (first record). Assertions: `data-state=edit`, `[data-testid="edit-draft"]` visible, two `operand-chip` elements with values `2` and `3`, edit operator glyph `+`, expression `2 + 3 +` (an open draft ends with the pending operator), digit display empty (`02-editing-history-record.png`).
- **Change an operand.** Fill the first `[data-testid="operand-input"]` with `10`. The expression becomes `10 + 3 +` (`03-operand-changed.png`).
- **Recompute.** Press `=`. Result `13`, expression `10 + 3`, history grows to 2, and the newest item reads `10 + 3` → `13` (`04-recomputed-record.png`).
- **Change the operator.** Open `编辑` on the newest record again, choose `*`. Assert the edit glyph is `*` and the expression is `10 * 3 *` (`05-operator-changed-while-editing.png`); press `=` → `30`, history 3.
- **Remove an operand.** Open `编辑` again, click the second `×`. One chip remains and the expression reads `10 *`; press `=` → result `10`, history 4 (`06-operand-removed-and-recomputed.png`).
- **Pending edit.** Open `编辑` on the newest record and click its operand input. The input clears and the chip gets `data-pending="true"`; clicking outside restores the original value if nothing was typed (`07-edit-pending-operand.png`).
- **Cancel.** Reopen `编辑`, change the value to `99`, click `关闭` (`[data-testid="edit-cancel"]`). The previous result/expression return, the draft disappears, and history count is unchanged (`08-edit-cancelled-restores.png`).
- **Proof.** `run.json` `ok=true`, empty `consoleErrors`, and step screenshots showing the draft, the pending value, the cancel restore, and the new history rows.

## Gotchas

- Removing every chip is allowed; `=` then does nothing until a number is entered. The empty state renders `暂无可计算数字` via CSS `::after`, so assert the chip count, not that text.
- Clicking an operand input clears it for immediate replacement and marks the chip `data-pending="true"`. Blurring restores the original unless the user typed. Do not assert the old value while the input is focused.
- `关闭` (`edit-cancel`) restores the exact pre-edit state — expression, result, operator, label — and does not add history. `=` is the only action that appends a record.
- The draft inputs are real text inputs but the on-screen keypad does not write into them while editing; the keypad writes into the main display, and `回车` appends a new operand chip. Use `fill` on `[data-testid="operand-input"]` to change an existing chip, exactly as a user typing into the field would.
- `.app[data-operator]` does not update when the operator changes inside the draft; only `[data-testid="edit-operator"]`, the expression, and the eventual result reflect it. After `=` it catches up.
- Editing does not replace the original record: the history grows. Assert both count and the newest entry.
- `编辑` buttons are per record; always scope to `.first()` for the newest record.
- A record computed with a base keeps that base when edited, shown in `[data-testid="edit-base-marker"]`; the current setting does not apply. See [score-tally-settings.md](./score-tally-settings.md).
- Negative results are valid (`2 - 5 = -3`), but the keypad has no minus sign, so create negatives through subtraction or an edited operand.
