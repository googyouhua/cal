import { openApp } from "../lib/browser.mjs";
import { S } from "../lib/selectors.mjs";
import { eq, clean } from "../lib/check.mjs";
import { expressionText, resultText, clickKey, typeNumber, selectOperator, clickEquals } from "../lib/dom.mjs";
import { seedSettings } from "../lib/settings.mjs";

// A teacher types on a phone keypad and may lead with zeros or start with ".";
// the expression and the history keep what was typed, while the value is numeric.
export const numberLiteralPreserved = {
  id: "number-literal-preserved",
  async run({ browser, artifact }) {
    const checks = [];
    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      await seedSettings(app, { resultPause: 0 }, "literal-preserved");

      await selectOperator(page, "+");
      await typeNumber(page, "007");
      await clickKey(page, "enter");
      await typeNumber(page, ".5");
      await clickEquals(page);

      eq(checks, "number-literal-preserved.expression", await expressionText(page), "007 + .5");
      eq(checks, "number-literal-preserved.result-text", await resultText(page), "7.5");
      eq(
        checks,
        "number-literal-preserved.history-operands",
        await page.$eval(S.historyItem, (item) => JSON.parse(item.getAttribute("data-operands") || "[]")),
        ["007", ".5"],
      );

      clean(checks, "number-literal-preserved.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
    return checks;
  },
};

export const scenarios = [numberLiteralPreserved];
