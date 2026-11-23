import { openApp } from "../lib/browser.mjs";
import { S } from "../lib/selectors.mjs";
import { eq, clean } from "../lib/check.mjs";
import { appState, liveOperands } from "../lib/dom.mjs";
import { seedSettings } from "../lib/settings.mjs";

// While a teacher is correcting one operand, the rest of the screen must not
// swallow those keystrokes into the calculator input behind the draft.
export const keyboardOperandInput = {
  id: "keyboard-operand-input",
  async run({ browser, artifact }) {
    const checks = [];
    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      await seedSettings(app, { resultPause: 0 }, "keyboard-operand-input");

      await page.click(`${S.picker} [data-op="+"]`);
      await page.keyboard.press("2");
      await page.keyboard.press("Enter");
      await page.keyboard.press("3");
      await page.keyboard.press("Enter");
      await page.keyboard.press("=");
      await page.click(S.historyEdit);

      // A keystroke with no operand focused still goes to the calculator input,
      // which proves the next assertion is not vacuous.
      await page.keyboard.press("4");
      eq(checks, "keyboard-operand-input.input-primed", await page.$eval(S.calcInput, (el) => el.value), "4");

      await page.locator(S.operandInput).nth(0).click();
      eq(
        checks,
        "keyboard-operand-input.focused",
        await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null),
        "operand-input",
      );
      await page.keyboard.press("5");
      eq(checks, "keyboard-operand-input.operand-value", (await liveOperands(page))[0], "5");
      eq(checks, "keyboard-operand-input.calc-input-untouched", await page.$eval(S.calcInput, (el) => el.value), "4");
      eq(checks, "keyboard-operand-input.chip-value", await page.locator(S.operandChip).nth(0).getAttribute("data-value"), "5");
      eq(checks, "keyboard-operand-input.state", await appState(page), "edit");

      clean(checks, "keyboard-operand-input.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
    return checks;
  },
};

export const scenarios = [keyboardOperandInput];
