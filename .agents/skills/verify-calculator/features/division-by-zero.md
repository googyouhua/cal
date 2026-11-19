# Division by zero

Dividing by zero must not crash the page. The calculator enters a visible error state, explains the problem in the status line and the result area, adds nothing to history, and offers two ways out: type a number and press `=`, or press `运算类型` and start over.

## Sub-features

- `error-state` sets `data-state=error` and shows `不能除以零` in the result area.
- `error-flag` sets `data-error="true"` on the result element and drops any stale `data-value`.
- `error-hint` explains recovery in `#state-label`.
- `error-no-history` leaves the history untouched.
- `recover-by-typing` starts a new calculation with the same operator from the error state.
- `recover-by-reset` returns to operator selection with expression and result cleared.

## How to get to it (user POV)

- Choose `/`, enter `5`, `回车`, enter `0`, `回车`, press `=`.
- To continue: type a number and press `=`; or press `运算类型` and choose a new operator.

## Driving it with the Playwright driver

Preconditions:

- `doctor.mjs` reports `doctor=ok`.
- The page is freshly loaded with empty history.

- **Produce the error.** Run `node .agents/skills/verify-calculator/scripts/drive.mjs --feature division-by-zero`. It enters `5 / 0 =`. Assertions: `data-state=error`, result text `不能除以零`, `data-error="true"`, expression empty, history 0, status line contains `不能除以零` (`01-division-by-zero-error.png`).
- **Recover by typing.** Tap `8`, then `=`. Assertions: `data-state=result`, result `8`, `.app[data-operator]` still `/`, history 1 (`02-recovered-by-typing.png`). The error clears and no exception was logged.
- **Zero dividend is not an error.** Reset, choose `/`, enter `0`, `回车`, `5`, `回车`, `=`. Result `0`, state `result`, history 2 (`03-zero-dividend-is-not-an-error.png`).
- **Recover by reset.** Reproduce the error (`9 / 0 =`), then press `[data-testid="key-op"]` (运算类型). Assertions: `data-state=select`, expression empty, result empty, keypad disabled (`04-recovered-by-operator-reset.png`).
- **Proof.** `run.json` `ok=true`, `consoleErrors=[]`, and the four step screenshots.
- **Determinism.** Run the scenario twice; both `run.json` files report the same result strings and the same assertion names.

## Gotchas

- The error clears the expression on purpose; do not assert a lingering `5 / 0`.
- `data-value` is removed in the error state — assert its absence, not the old result.
- A `0` typed as the first operand is not an error (`0 / 5 = 0`). Only a zero divisor triggers it.
- Recovery by typing uses the retained operator: after `/`, typing `8` and `=` yields `8`, not `5 / 8`.
- Do not treat the Chinese error string as an exception; the page reports no console error and does not throw.
