# Mobile layout

The calculator is built for a phone: it must fit 320 px and 390 px wide screens without sideways scrolling, keep every visible control at least 44×44 CSS px, and use at least 16 px text in inputs so mobile browsers do not zoom on focus.

## Sub-features

- `no-horizontal-overflow` keeps `scrollWidth <= clientWidth` in select, typing, result, and edit states.
- `touch-targets` sizes every visible button at or above 44×44 CSS px.
- `input-font` uses at least 16 px for the display and for operand inputs.
- `long-content` wraps long expressions and long repeating decimals instead of widening the page.
- `edit-draft-fits` keeps operand chips and the `×` remove button usable at the narrow width.

## How to get to it (user POV)

- Open the page on a 320 px-wide phone, then on a 390 px-wide phone.
- Choose an operator, type a long number, commit it, and compute a repeating decimal.
- Open `编辑` on a history record to see the operand chips.

## Driving it with the Playwright driver

Preconditions:

- `doctor.mjs` reports `doctor=ok`.
- The driver is responsible for the viewport; do not resize the browser window.

- **Run both widths.** Run `node .agents/skills/verify-calculator/scripts/drive.mjs --feature mobile-layout`. It opens one browser context per viewport: 320×568 and 390×844.
- **Select state.** For each width, assert `scrollWidth <= clientWidth`, every visible button is ≥44 wide and ≥44 tall, the display font size is ≥16 px, and capture `01-select-320x568.png` / `06-select-390x844.png`.
- **Long input.** Choose `+`, tap `1 2 3 4 5 6 7 8 9`. Assert no overflow and capture the state; the display may scroll internally but the page must not widen.
- **Long expression.** Press `回车`; the expression contains the nine-digit number plus the operator. Assert no overflow and capture.
- **Long result.** Reset, choose `/`, enter `1`, `回车`, `3`, `回车`, `=`. The result is `0.3333333333333333`; assert the value, no overflow, and capture.
- **Edit draft.** Reset, compute `2 + 3 =`, open `编辑`. Assert operand input font ≥16 px and both `×` buttons ≥44×44, no overflow, and capture.
- **Proof.** `run.json` lists 10 step captures across both widths with `ok=true` and `consoleErrors=[]`.

## Gotchas

- Headless Chromium's `--window-size` has a floor near 500 px; that is why the driver sets the browser **context** viewport. Never validate 320 px from a window-size flag.
- Full-page screenshots do not prove the absence of horizontal overflow on their own — rely on the `scrollWidth/clientWidth` assertion, and inspect the screenshots for clipping.
- The keypad is disabled in `select`, but its buttons are still visible and must meet the 44 px target; only `button:visible` elements are measured.
- `deviceScaleFactor` is 2 for legible screenshots; it does not change CSS pixel sizes.
- The 320 px case is the tight one. A change that passes at 390 px can still overflow at 320 px.
- Font size must be read from computed style; `font-size: 16px` on the base rule can be overridden by a narrower rule later in the sheet.
