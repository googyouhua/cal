# Backspace and undo

`退格` is a two-mode control: with text in the display it deletes the last character; with an empty display in `input` or `edit` it removes the last committed number and says `已撤回 X`. After `=` the result is not undoable — use the history's `编辑`.

## Sub-features

- `undo-char` deletes one character from a non-empty display.
- `undo-last-operand` removes the most recently committed number in `input`.
- `undo-all` removes one operand per press until the expression is empty.
- `undo-edit-draft` removes the last chip while editing.
- `undo-not-in-result` leaves a finished result untouched.
- `undo-base-safe` never removes the base, only entered operands.

## How to get to it (user POV)

- Type digits, then tap `退格` to correct them.
- After committing numbers, leave the display empty and tap `退格` to take back the last number.
- In the edit draft, leave the operand inputs alone and tap `退格` to drop the last chip.
- After `=`, open `编辑` if a finished record must change.

## Driving it with the Playwright driver

Preconditions:

- `doctor.mjs` reports `doctor=ok`.
- Default settings (no base).

- **Undo the last operand.** Run `node .agents/skills/verify-calculator/scripts/drive.mjs --feature backspace-undo`. It chooses `+`, commits `9.5` and `9.2`, then presses `退格`. Expression becomes `9.5 +`, label `已撤回 9.2` (`01-undo-last-operand.png`).
- **Undo everything.** Press `退格` again: expression empty, label `已撤回 9.5`. A third press changes nothing (`02-undo-exhausted.png`).
- **Result is not undoable.** Commit `7`, press `=` → result `7`. Press `退格`; result and state stay (`03-result-is-not-undoable.png`).
- **Undo in the edit draft.** Compute `2 + 3 =`, open `编辑`, press `退格`. One chip remains, expression `2 +`, label `已撤回 3` (`04-undo-in-edit-draft.png`).
- **Proof.** `run.json` `ok=true`, empty `consoleErrors`, four step captures.

## Gotchas

- Undo only fires when the display is empty; otherwise `退格` is a character delete.
- `result` and `error` states are never undone; typing a digit there starts a new calculation.
- Undo does not touch the base. With base `10` and all operands undone, the expression still shows `10`.
- In `edit`, undo removes from `editDraft`; it never changes the stored history record until `=` recomputes.
- Do not assert a count of "operands" from the DOM — the expression text is the observable state.
