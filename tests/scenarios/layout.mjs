import { openApp } from "../lib/browser.mjs";
import { S } from "../lib/selectors.mjs";
import { eq, check, clean } from "../lib/check.mjs";
import { appState, measureLayout, clickHistoryEdit } from "../lib/dom.mjs";

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
];

const MIN_CONTROL = 44;
const MIN_FONT = 16;

async function compute(page, operator, values) {
  await page.click(`${S.picker} [data-op="${operator}"]`);
  for (const value of values) {
    for (const character of value) await page.click(`${S.keypad} [data-key="${character}"]`);
    await page.click(`${S.keypad} [data-key="enter"]`);
  }
  await page.click(S.equals);
}

function assertLayout(checks, prefix, metrics) {
  check(checks, `${prefix}.doc-overflow`, metrics.docOverflow <= 1, `overflow=${metrics.docOverflow}`);
  check(checks, `${prefix}.body-overflow`, metrics.bodyOverflow <= 1, `overflow=${metrics.bodyOverflow}`);
  const tooSmall = metrics.controls.filter((control) => control.width < MIN_CONTROL - 0.5 || control.height < MIN_CONTROL - 0.5);
  check(
    checks,
    `${prefix}.controls-min-size`,
    tooSmall.length === 0,
    tooSmall.length === 0
      ? `${metrics.controls.length} controls ≥ ${MIN_CONTROL}px`
      : tooSmall.map((control) => `${control.testid || control.key || control.op}:${control.width.toFixed(1)}x${control.height.toFixed(1)}`).join(", "),
  );
  check(checks, `${prefix}.calc-font`, metrics.calcFont >= MIN_FONT, `font=${metrics.calcFont}`);
  check(
    checks,
    `${prefix}.operand-fonts`,
    metrics.operandFonts.every((font) => font >= MIN_FONT),
    `fonts=${metrics.operandFonts.join(",") || "(none)"}`,
  );
}

export const layout = {
  id: "layout",
  async run({ browser, artifact }) {
    const checks = [];
    for (const viewport of VIEWPORTS) {
      const tag = `${viewport.width}x${viewport.height}`;
      const app = await openApp(browser, artifact, { viewport });
      try {
        const { page } = app;
        await compute(page, "+", ["12", "30", "8"]);
        await compute(page, "*", ["2", "3", "4"]);
        eq(checks, `layout.${tag}.result.state`, await appState(page), "result");
        assertLayout(checks, `layout.${tag}.result`, await measureLayout(page));

        await clickHistoryEdit(page, 1);
        eq(checks, `layout.${tag}.edit.state`, await appState(page), "edit");
        assertLayout(checks, `layout.${tag}.edit`, await measureLayout(page));
        clean(checks, `layout.${tag}.clean`, app.pageErrors, app.consoleErrors);
      } finally {
        await app.close();
      }
    }
    return checks;
  },
};

export const scenarios = [layout];
