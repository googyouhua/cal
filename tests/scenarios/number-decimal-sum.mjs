import { openApp } from "../lib/browser.mjs";
import { eq, clean } from "../lib/check.mjs";
import { expressionText, resultText, resultValue, compute } from "../lib/dom.mjs";
import { seedSettings } from "../lib/settings.mjs";

// The app's whole purpose is summing decimal scores; 9.5 + 9.2 + 9 is the
// realistic classroom case where a naive accumulation starts to drift.
export const numberDecimalSum = {
  id: "number-decimal-sum",
  async run({ browser, artifact }) {
    const checks = [];
    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      await seedSettings(app, { resultPause: 0 }, "decimal-sum");

      await compute(page, "+", ["9.5", "9.2", "9"]);
      eq(checks, "number-decimal-sum.expression", await expressionText(page), "9.5 + 9.2 + 9");
      eq(checks, "number-decimal-sum.result-text", await resultText(page), "27.7");
      eq(checks, "number-decimal-sum.result-value", await resultValue(page), "27.7");

      clean(checks, "number-decimal-sum.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
    return checks;
  },
};

export const scenarios = [numberDecimalSum];
