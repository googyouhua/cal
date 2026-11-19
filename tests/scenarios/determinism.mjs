import { openApp } from "../lib/browser.mjs";
import { S } from "../lib/selectors.mjs";
import { eq, clean } from "../lib/check.mjs";
import { historySnapshots, clickHistoryEdit, setOperand } from "../lib/dom.mjs";

async function compute(page, operator, values) {
  await page.click(`${S.picker} [data-op="${operator}"]`);
  for (const value of values) {
    for (const character of value) await page.click(`${S.keypad} [data-key="${character}"]`);
    await page.click(`${S.keypad} [data-key="enter"]`);
  }
  await page.click(S.equals);
}

async function runSequence(browser, artifact) {
  const app = await openApp(browser, artifact);
  try {
    const { page } = app;
    await compute(page, "+", ["12", "30", "8"]);
    await compute(page, "*", ["2", "3", "4"]);
    await clickHistoryEdit(page, 1);
    await setOperand(page, 1, "5");
    await page.click(S.equals);
    return {
      history: await historySnapshots(page),
      pageErrors: app.pageErrors,
      consoleErrors: app.consoleErrors,
    };
  } finally {
    await app.close();
  }
}

export const determinism = {
  id: "determinism",
  async run({ browser, artifact }) {
    const checks = [];
    const first = await runSequence(browser, artifact);
    const second = await runSequence(browser, artifact);

    eq(checks, "determinism.first.records", first.history.length, 3);
    eq(checks, "determinism.history-equal", first.history, second.history);
    clean(checks, "determinism.first.clean", first.pageErrors, first.consoleErrors);
    clean(checks, "determinism.second.clean", second.pageErrors, second.consoleErrors);

    const fresh = await openApp(browser, artifact);
    try {
      eq(checks, "determinism.fresh-context.history", await fresh.page.$$eval(S.historyItem, (els) => els.length), 0);
      clean(checks, "determinism.fresh-context.clean", fresh.pageErrors, fresh.consoleErrors);
    } finally {
      await fresh.close();
    }
    return checks;
  },
};

export const scenarios = [determinism];
