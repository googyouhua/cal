# Mobile layout

The calculator is built for a phone: it must fit 320 px and 390 px wide screens without sideways scrolling, keep every visible control at least 44×44 CSS px, and use at least 16 px text in inputs so mobile browsers do not zoom on focus.

## Sub-features

- `no-horizontal-overflow` keeps `scrollWidth <= clientWidth` in select, typing, result, and edit states.
- `touch-targets` sizes every visible button at or above 44×44 CSS px.
- `input-font` uses at least 16 px for the display and for operand inputs.
- `long-content` wraps long expressions and long repeating decimals instead of widening the page.
- `edit-draft-fits` keeps operand chips and the `×` remove button usable at the narrow width.
- `settings-dialog-fits` keeps the score-tally dialog inside the viewport with 44 px controls and 16 px text.
- `base-and-progress-fit` keeps the base marker and the 2 px auto-confirm progress bar from widening the page.

## How to get to it (user POV)

- Open the page on a 320 px-wide phone, then on a 390 px-wide phone.
- Choose an operator, type a long number, commit it, and compute a repeating decimal.
- Open `编辑` on a history record to see the operand chips.
- Tap the gear to open 统分设置; enable a base and an auto-confirm pause to see the marker and progress bar.

## Driving it with the Playwright driver

Preconditions:

- `doctor.mjs` reports `doctor=ok`.
- The driver is responsible for the viewport; do not resize the browser window.

- **Run both widths.** Run `node .agents/skills/verify-calculator/scripts/drive.mjs --feature mobile-layout`. It opens one browser context per viewport: 320×568 and 390×844. Each capture below appears once per width (14 total), numbered `01`–`07` for 320 and `08`–`14` for 390.
- **Select state.** For each width, assert `scrollWidth <= clientWidth`, every visible button is ≥44 wide and ≥44 tall, the display font size is ≥16 px, and capture `01-select-320x568.png` / `08-select-390x844.png`.
- **Long input.** Choose `+`, tap `1 2 3 4 5 6 7 8 9`. Assert no overflow and capture; the display may scroll internally but the page must not widen.
- **Long expression.** Press `回车`; the expression contains the nine-digit number plus the operator. Assert no overflow and capture.
- **Long result.** Reset, choose `/`, enter `1`, `回车`, `3`, `回车`, `=`. The result is `0.3333333333333333`; assert the value, no overflow, and capture.
- **Edit draft.** Reset, compute `2 + 3 =`, open `编辑`. Assert operand input font ≥16 px and both `×` buttons ≥44×44, no overflow, and capture. Close with `关闭`.
- **Settings dialog.** Tap the gear. Assert no overflow, the dialog box stays inside the viewport, every visible dialog control is ≥44×44, and the select/input font is ≥16 px; capture `06-settings-panel-320x568.png` / `13-settings-panel-390x844.png`.
- **Base and progress.** In the dialog choose a 2 s pause, enable base `10`, and close. Reset, choose `+`: the base marker is visible. Type `9`: the progress bar is active and ≤4 px tall. Neither widens the page; capture `07-base-and-progress-320x568.png` / `14-base-and-progress-390x844.png`, then reset to stop the timer.
- **Proof.** `run.json` has 14 step captures and `ok=true` with `consoleErrors=[]`.

## Gotchas

- Headless Chromium's `--window-size` has a floor near 500 px; that is why the driver sets the browser **context** viewport. Never validate 320 px from a window-size flag.
- Full-page screenshots do not prove the absence of horizontal overflow on their own — rely on the `scrollWidth/clientWidth` assertion, and inspect the screenshots for clipping.
- The keypad is enabled in `select`; all 14 keys are visible and must meet the 44 px target. Only visible controls are measured.
- The settings dialog is a native modal. Its backdrop covers the page, so measure the document, not just the panel; the 320 px panel is ~304 px wide.
- The auto-confirm progress bar is 2 px tall and opacity/visibility-toggled via `data-active`; assert the attribute and the height, not its animated width.
- `deviceScaleFactor` is 2 for legible screenshots; it does not change CSS pixel sizes.
- The 320 px case is the tight one. A change that passes at 390 px can still overflow at 320 px.
- Font size must be read from computed style; `font-size: 16px` on the base rule can be overridden by a narrower rule later in the sheet.
