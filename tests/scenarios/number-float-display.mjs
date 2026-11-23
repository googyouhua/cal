import { openApp } from "../lib/browser.mjs";
import { S } from "../lib/selectors.mjs";
import { eq, clean } from "../lib/check.mjs";
import { expressionText, resultText, resultValue, clickKey, typeNumber, selectOperator, clickEquals } from "../lib/dom.mjs";
import { seedSettings } from "../lib/settings.mjs";

// The product formats with String(value) over float64 and never rounds. These
// checks pin that contract so a future "prettier" formatter is a visible change.
export const numberFloatDisplay = {
  id: "number-float-display",
  async run({ browser, artifact }) {
    const checks = [];
    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      await seedSettings(app, { resultPause: 0 }, "float-display");

      await selectOperator(page, "+");
      await typeNumber(page, "0.1");
      await clickKey(page, "enter");
      await typeNumber(page, "0.2");
      await clickEquals(page);
      eq(checks, "number-float-display.sum.expression", await expressionText(page), "0.1 + 0.2");
      eq(checks, "number-float-display.sum.result-text", await resultText(page), "0.30000000000000004");
      eq(checks, "number-float-display.sum.result-value", await resultValue(page), "0.30000000000000004");
      eq(
        checks,
        "number-float-display.sum.history-result",
        await page.$eval(S.historyItem, (item) => item.querySelector('[data-testid="history-result"]').getAttribute("data-value")),
        "0.30000000000000004",
      );

      await selectOperator(page, "/");
      await typeNumber(page, "1");
      await clickKey(page, "enter");
      await typeNumber(page, "3");
      await clickEquals(page);
      eq(checks, "number-float-display.third.result-text", await resultText(page), "0.3333333333333333");
      eq(checks, "number-float-display.third.result-value", await resultValue(page), "0.3333333333333333");

      // 20 digits are beyond float64 precision: the operand stays literal, the
      // result is whatever float64 holds, and the two are allowed to differ.
      await selectOperator(page, "+");
      await typeNumber(page, "12345678901234567890");
      await clickEquals(page);
      eq(checks, "number-float-display.long.expression", await expressionText(page), "12345678901234567890");
      eq(checks, "number-float-display.long.result-text", await resultText(page), "12345678901234567000");
      eq(
        checks,
        "number-float-display.long.history-operands",
        await page.$eval(S.historyItem, (item) => JSON.parse(item.getAttribute("data-operands") || "[]")),
        ["12345678901234567890"],
      );

      clean(checks, "number-float-display.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
    return checks;
  },
};

export const scenarios = [numberFloatDisplay];
