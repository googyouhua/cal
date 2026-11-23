import { openApp } from "../lib/browser.mjs";
import { S } from "../lib/selectors.mjs";
import { eq, clean } from "../lib/check.mjs";
import { appState, expressionText, resultText, resultValue, historyCount, clickKey, compute } from "../lib/dom.mjs";
import { openSettings, closeSettings } from "../lib/settings.mjs";

// Negative totals are a normal score outcome (a person can lose more than they
// earn), so the sign must survive display, history and a negative base.
export const numberNegative = {
  id: "number-negative",
  async run({ browser, artifact }) {
    const checks = [];
    const app = await openApp(browser, artifact);
    try {
      const { page } = app;

      await compute(page, "-", ["5", "12"]);
      eq(checks, "number-negative.result.expression", await expressionText(page), "5 - 12");
      eq(checks, "number-negative.result.text", await resultText(page), "-7");
      eq(checks, "number-negative.result.value", await resultValue(page), "-7");
      eq(checks, "number-negative.result.history-count", await historyCount(page), 1);
      eq(
        checks,
        "number-negative.result.history",
        await page.$eval(S.historyItem, (item) => ({
          operator: item.getAttribute("data-operator"),
          operands: JSON.parse(item.getAttribute("data-operands") || "[]"),
          base: item.getAttribute("data-base"),
          result: item.querySelector('[data-testid="history-result"]').getAttribute("data-value"),
        })),
        { operator: "-", operands: ["5", "12"], base: null, result: "-7" },
      );

      await page.click(S.keyOp);
      await openSettings(page);
      await page.click(S.baseToggle);
      await page.fill(S.baseValue, "-5");
      await closeSettings(page);
      await compute(page, "+", ["3", "2"]);
      eq(checks, "number-negative.base.expression", await expressionText(page), "-5 + 3 + 2");
      eq(checks, "number-negative.base.result-text", await resultText(page), "0");
      eq(checks, "number-negative.base.result-value", await resultValue(page), "0");
      eq(checks, "number-negative.base.state", await appState(page), "result");
      eq(
        checks,
        "number-negative.base.marker-text",
        await page.$eval(S.baseMarker, (el) => (el.textContent || "").trim()),
        "基数 -5",
      );
      const history = await page.$eval(S.historyItem, (item) => ({
        base: item.getAttribute("data-base"),
        operands: JSON.parse(item.getAttribute("data-operands") || "[]"),
      }));
      eq(checks, "number-negative.base.history-base", history.base, "-5");
      eq(checks, "number-negative.base.history-operands", history.operands, ["3", "2"]);

      clean(checks, "number-negative.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
    return checks;
  },
};

export const scenarios = [numberNegative];
