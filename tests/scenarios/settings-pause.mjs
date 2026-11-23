import { openApp } from "../lib/browser.mjs";
import { S } from "../lib/selectors.mjs";
import { check, eq, clean } from "../lib/check.mjs";
import { clickKey, compute } from "../lib/dom.mjs";
import { openSettings, closeSettings, seedSettings, storedSettings } from "../lib/settings.mjs";

const PAUSE_FIELD = S.resultPause;

async function snapshot(page) {
  return page.evaluate(
    ({ input, expression, result, root }) => {
      const field = document.querySelector(input);
      const expressionView = document.querySelector(expression);
      const resultView = document.querySelector(result);
      const appRoot = document.querySelector(root);
      return {
        input: field.value,
        expression: (expressionView.textContent || "").trim(),
        resultText: (resultView.textContent || "").trim(),
        resultValue: resultView.getAttribute("data-value"),
        state: appRoot.dataset.state,
        operator: appRoot.getAttribute("data-operator"),
      };
    },
    { input: S.calcInput, expression: S.expression, result: S.result, root: S.app },
  );
}

// 结果后暂停输入 parks the keypad for N seconds after every result so a teacher
// can read the total before the next student starts. Digits and Backspace are
// discarded; operators still start a new calculation.
export const settingsPause = {
  id: "settings-pause",
  async run({ browser, artifact }) {
    const checks = [];
    const app = await openApp(browser, artifact);
    try {
      const { page } = app;

      // ---- default (1 s) ----
      await compute(page, "+", ["5", "6"]);
      let view = await snapshot(page);
      eq(checks, "settings-pause.default.result", view.resultText, "11");
      eq(checks, "settings-pause.default.result-value", view.resultValue, "11");
      eq(checks, "settings-pause.default.expression", view.expression, "5 + 6");
      eq(checks, "settings-pause.default.state", view.state, "result");

      await clickKey(page, "9");
      view = await snapshot(page);
      eq(checks, "settings-pause.default.blocked-digit", view.input, "");
      eq(checks, "settings-pause.default.blocked-expression", view.expression, "5 + 6");
      eq(checks, "settings-pause.default.blocked-result", view.resultValue, "11");
      eq(checks, "settings-pause.default.blocked-state", view.state, "result");

      await clickKey(page, "backspace");
      view = await snapshot(page);
      eq(checks, "settings-pause.default.backspace-input", view.input, "");
      eq(checks, "settings-pause.default.backspace-expression", view.expression, "5 + 6");
      eq(checks, "settings-pause.default.backspace-result", view.resultValue, "11");
      eq(checks, "settings-pause.default.backspace-state", view.state, "result");

      await page.click(`${S.picker} [data-op="-"]`);
      view = await snapshot(page);
      eq(checks, "settings-pause.default.operator-applied", view.operator, "-");
      eq(checks, "settings-pause.default.operator-state", view.state, "input");
      eq(checks, "settings-pause.default.operator-clears-result", view.resultValue, null);
      await clickKey(page, "8");
      view = await snapshot(page);
      eq(checks, "settings-pause.default.operator-digit-accepted", view.input, "8");

      // ---- 0 disables the pause ----
      await seedSettings(app, { resultPause: 0 }, "pause-zero");
      await compute(page, "+", ["5", "6"]);
      await clickKey(page, "9");
      view = await snapshot(page);
      eq(checks, "settings-pause.zero.digit-accepted", view.input, "9");
      eq(checks, "settings-pause.zero.state", view.state, "input");
      eq(checks, "settings-pause.zero.result-cleared", view.resultValue, null);
      eq(checks, "settings-pause.zero.expression-cleared", view.expression, "");

      // ---- the pause ends by time, not instantly ----
      // 0.5 s leaves room for the round trips between the result and the first
      // poll, so "at least two polls needed" cannot flake into a false pass.
      await seedSettings(app, { resultPause: 0.5 }, "pause-restore");
      await compute(page, "+", ["5", "6"]);
      await page.evaluate(() => {
        window.__pausePolls = 0;
      });
      // Poll the product's own timer: each poll presses the blocked digit and
      // stops as soon as the digit is accepted. No fixed sleep is involved.
      await page.waitForFunction(
        ({ keySelector }) => {
          window.__pausePolls += 1;
          const field = document.querySelector('input[data-testid="calc-input"]');
          if (field.value === "") {
            const key = document.querySelector(keySelector);
            if (key) key.click();
          }
          return field.value !== "";
        },
        { keySelector: `${S.keypad} [data-key="9"]` },
        { polling: 20, timeout: 10000 },
      );
      const polls = await page.evaluate(() => window.__pausePolls);
      check(checks, "settings-pause.restore.polls", polls >= 2, `polls=${polls} (>=2 proves the pause blocked the first press)`);
      view = await snapshot(page);
      eq(checks, "settings-pause.restore.accepted", view.input, "9");
      eq(checks, "settings-pause.restore.state", view.state, "input");
      eq(checks, "settings-pause.restore.expression-cleared", view.expression, "");

      // ---- panel validation and persistence ----
      await openSettings(page);
      const previous = await page.$eval(PAUSE_FIELD, (el) => el.value);
      await page.fill(PAUSE_FIELD, "12");
      eq(checks, "settings-pause.panel.reject-keeps-typing", await page.$eval(PAUSE_FIELD, (el) => el.value), "12");
      await page.locator(PAUSE_FIELD).blur();
      eq(checks, "settings-pause.panel.revert-on-blur", await page.$eval(PAUSE_FIELD, (el) => el.value), previous);
      eq(checks, "settings-pause.panel.reject-not-persisted", (await storedSettings(page)).resultPause, 0.5);

      await page.fill(PAUSE_FIELD, "2.5");
      await page.locator(PAUSE_FIELD).blur();
      eq(checks, "settings-pause.panel.accepted", await page.$eval(PAUSE_FIELD, (el) => el.value), "2.5");
      eq(checks, "settings-pause.panel.persisted", (await storedSettings(page)).resultPause, 2.5);
      await closeSettings(page);
      eq(checks, "settings-pause.panel.survives-close", await page.$eval(PAUSE_FIELD, (el) => el.value), "2.5");

      await page.reload({ waitUntil: "load" });
      await openSettings(page);
      eq(checks, "settings-pause.panel.visible-after-reload", await page.$eval(PAUSE_FIELD, (el) => el.value), "2.5");
      eq(checks, "settings-pause.panel.persisted-after-reload", (await storedSettings(page)).resultPause, 2.5);

      clean(checks, "settings-pause.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
    return checks;
  },
};

export const scenarios = [settingsPause];
