import { openApp } from "../lib/browser.mjs";
import { S } from "../lib/selectors.mjs";
import { eq, clean } from "../lib/check.mjs";
import { appState, expressionText, resultValue, resultError, isVisible, calcInputState } from "../lib/dom.mjs";

export const continuity = {
  id: "continuity",
  async run({ browser, artifact }) {
    const checks = [];
    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      await page.click(`${S.picker} [data-op="+"]`);
      for (const value of ["12", "30", "8"]) {
        for (const character of value) await page.click(`${S.keypad} [data-key="${character}"]`);
        await page.click(`${S.keypad} [data-key="enter"]`);
      }
      await page.click(S.equals);
      eq(checks, "continuity.first-result", await resultValue(page), "50");

      eq(checks, "continuity.result.picker-visible", await isVisible(page, S.picker), true);
      const clickable = await page.$$eval(`${S.picker} [data-op]`, (els) =>
        els.every((el) => !el.disabled && el.getClientRects().length > 0),
      );
      eq(checks, "continuity.result.operators-clickable", clickable, true);

      await page.click(`${S.picker} [data-op="*"]`);
      eq(checks, "continuity.switch.state", await appState(page), "input");
      eq(checks, "continuity.switch.history", await page.$$eval(S.historyItem, (els) => els.length), 1);
      eq(checks, "continuity.switch.expression", await expressionText(page), "");
      eq(checks, "continuity.switch.result", await resultValue(page), null);
      eq(checks, "continuity.switch.focused", (await calcInputState(page)).focused, true);
      eq(
        checks,
        "continuity.switch.keys-enabled",
        await page.$$eval(`${S.keypad} [data-key]`, (els) => els.filter((el) => el.disabled).length),
        0,
      );

      for (const value of ["2", "3", "4"]) {
        for (const character of value) await page.click(`${S.keypad} [data-key="${character}"]`);
        await page.click(`${S.keypad} [data-key="enter"]`);
      }
      await page.click(S.equals);
      eq(checks, "continuity.second-result", await resultValue(page), "24");
      eq(checks, "continuity.second-history", await page.$$eval(S.historyItem, (els) => els.length), 2);
      eq(checks, "continuity.second-top-operator", await page.$eval(S.historyItem, (el) => el.getAttribute("data-operator")), "*");

      await page.click(`${S.picker} [data-op="*"]`);
      eq(checks, "continuity.same-op.state", await appState(page), "input");
      eq(checks, "continuity.same-op.history", await page.$$eval(S.historyItem, (els) => els.length), 2);
      clean(checks, "continuity.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
    return checks;
  },
};

export const errorRecovery = {
  id: "error-recovery",
  async run({ browser, artifact }) {
    const checks = [];
    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      await page.click(`${S.picker} [data-op="/"]`);
      for (const value of ["5", "0"]) {
        for (const character of value) await page.click(`${S.keypad} [data-key="${character}"]`);
        await page.click(`${S.keypad} [data-key="enter"]`);
      }
      await page.click(S.equals);

      eq(checks, "error.state", await appState(page), "error");
      eq(checks, "error.flag", await resultError(page), "true");
      eq(checks, "error.no-value", await resultValue(page), null);
      eq(checks, "error.history", await page.$$eval(S.historyItem, (els) => els.length), 0);
      eq(checks, "error.picker-visible", await isVisible(page, S.picker), true);

      await page.click(`${S.picker} [data-op="+"]`);
      eq(checks, "error.recover.state", await appState(page), "input");
      eq(checks, "error.recover.expression", await expressionText(page), "");
      eq(checks, "error.recover.result", await resultValue(page), null);
      eq(checks, "error.recover.error-attr", await resultError(page), null);
      eq(checks, "error.recover.focused", (await calcInputState(page)).focused, true);

      for (const value of ["1", "2"]) {
        for (const character of value) await page.click(`${S.keypad} [data-key="${character}"]`);
        await page.click(`${S.keypad} [data-key="enter"]`);
      }
      await page.click(S.equals);
      eq(checks, "error.recover.result-after", await resultValue(page), "3");
      eq(checks, "error.recover.history-after", await page.$$eval(S.historyItem, (els) => els.length), 1);
      clean(checks, "error.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
    return checks;
  },
};

export const stickyOperator = {
  id: "sticky-operator",
  async run({ browser, artifact }) {
    const checks = [];
    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      await page.click(`${S.picker} [data-op="+"]`);
      for (const character of "12") await page.click(`${S.keypad} [data-key="${character}"]`);
      await page.click(`${S.picker} [data-op="*"]`);
      eq(checks, "sticky.switch-draft.value", await page.$eval(S.calcInput, (el) => el.value), "12");
      await page.click(`${S.keypad} [data-key="enter"]`);
      for (const character of "3") await page.click(`${S.keypad} [data-key="${character}"]`);
      await page.click(`${S.keypad} [data-key="enter"]`);
      await page.click(S.equals);
      eq(checks, "sticky.switch-draft.result", await resultValue(page), "36");
      eq(checks, "sticky.switch-draft.operator", await page.$eval(S.historyItem, (el) => el.getAttribute("data-operator")), "*");

      for (const value of ["5", "6"]) {
        for (const character of value) await page.click(`${S.keypad} [data-key="${character}"]`);
        await page.click(`${S.keypad} [data-key="enter"]`);
      }
      await page.click(S.equals);
      eq(checks, "sticky.continue.result", await resultValue(page), "30");
      eq(checks, "sticky.continue.history", await page.$$eval(S.historyItem, (els) => els.length), 2);
      eq(
        checks,
        "sticky.continue.top-operands",
        await page.$eval(S.historyItem, (el) => JSON.parse(el.getAttribute("data-operands") || "[]")),
        ["5", "6"],
      );

      await page.click(`${S.picker} [data-op="+"]`);
      eq(checks, "sticky.change-op.state", await appState(page), "input");
      eq(checks, "sticky.change-op.history", await page.$$eval(S.historyItem, (els) => els.length), 2);
      for (const value of ["1", "2"]) {
        for (const character of value) await page.click(`${S.keypad} [data-key="${character}"]`);
        await page.click(`${S.keypad} [data-key="enter"]`);
      }
      await page.click(S.equals);
      eq(checks, "sticky.change-op.result", await resultValue(page), "3");
      eq(checks, "sticky.change-op.history-after", await page.$$eval(S.historyItem, (els) => els.length), 3);
      clean(checks, "sticky.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
    return checks;
  },
};

export const scenarios = [continuity, errorRecovery, stickyOperator];
