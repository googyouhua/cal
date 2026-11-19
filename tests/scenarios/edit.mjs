import { openApp } from "../lib/browser.mjs";
import { S } from "../lib/selectors.mjs";
import { eq, clean } from "../lib/check.mjs";
import {
  appState,
  expressionText,
  resultValue,
  resultError,
  isVisible,
  historySnapshots,
  liveOperands,
  editDraftInfo,
  clickHistoryEdit,
  setOperand,
  removeOperand,
} from "../lib/dom.mjs";

async function compute(page, operator, values) {
  await page.click(`${S.picker} [data-op="${operator}"]`);
  for (const value of values) {
    for (const character of value) await page.click(`${S.keypad} [data-key="${character}"]`);
    await page.click(`${S.keypad} [data-key="enter"]`);
  }
  await page.click(S.equals);
}

export const editRecompute = {
  id: "edit-recompute",
  async run({ browser, artifact }) {
    const checks = [];
    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      await compute(page, "+", ["12", "30", "8"]);
      await compute(page, "*", ["2", "3", "4"]);
      const before = await historySnapshots(page);
      eq(checks, "edit-recompute.before.count", before.length, 2);
      eq(checks, "edit-recompute.before.top", before[0].operator, "*");

      await clickHistoryEdit(page, 1);
      eq(checks, "edit-recompute.state", await appState(page), "edit");
      eq(checks, "edit-recompute.draft-visible", await isVisible(page, S.editDraft), true);
      eq(checks, "edit-recompute.draft-operator", (await editDraftInfo(page)).operator, "+");
      eq(checks, "edit-recompute.initial-values", await liveOperands(page), ["12", "30", "8"]);

      await setOperand(page, 1, "5");
      const expression = await expressionText(page);
      eq(checks, "edit-recompute.expression-has-new", expression.includes("5"), true, expression);
      eq(checks, "edit-recompute.expression-drops-old", expression.includes("30"), false, expression);

      await page.click(S.equals);
      eq(checks, "edit-recompute.result", await resultValue(page), "25");
      eq(checks, "edit-recompute.history", await page.$$eval(S.historyItem, (els) => els.length), 3);
      eq(
        checks,
        "edit-recompute.top",
        await page.$eval(S.historyItem, (el) => ({
          operator: el.getAttribute("data-operator"),
          operands: JSON.parse(el.getAttribute("data-operands") || "[]"),
          result: el.querySelector('[data-testid="history-result"]').getAttribute("data-value"),
        })),
        { operator: "+", operands: ["12", "5", "8"], result: "25" },
      );
      eq(checks, "edit-recompute.old-entries-unchanged", (await historySnapshots(page)).slice(1), before);
      clean(checks, "edit-recompute.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
    return checks;
  },
};

export const editMulti = {
  id: "edit-multi",
  async run({ browser, artifact }) {
    const checks = [];
    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      await compute(page, "*", ["2", "3", "4"]);
      await compute(page, "+", ["1.5", "2.25"]);
      const before = await historySnapshots(page);
      eq(checks, "edit-multi.before.count", before.length, 2);

      await clickHistoryEdit(page, 1);
      eq(checks, "edit-multi.draft-operator", (await editDraftInfo(page)).operator, "*");
      await page.click(`${S.picker} [data-op="+"]`);
      eq(checks, "edit-multi.switched-operator", (await editDraftInfo(page)).operator, "+");
      eq(checks, "edit-multi.values-preserved-on-switch", await liveOperands(page), ["2", "3", "4"]);

      await setOperand(page, 0, "10");
      await setOperand(page, 2, "5");
      const expression = await expressionText(page);
      eq(checks, "edit-multi.expression-has-edits", expression.includes("10") && expression.includes("5"), true, expression);

      await removeOperand(page, 1);
      eq(checks, "edit-multi.after-remove", await liveOperands(page), ["10", "5"]);

      await page.click(`${S.keypad} [data-key="2"]`);
      await page.click(`${S.keypad} [data-key="enter"]`);
      eq(checks, "edit-multi.after-append", await liveOperands(page), ["10", "5", "2"]);

      await page.click(S.equals);
      eq(checks, "edit-multi.result", await resultValue(page), "17");
      eq(checks, "edit-multi.history", await page.$$eval(S.historyItem, (els) => els.length), 3);
      eq(
        checks,
        "edit-multi.top",
        await page.$eval(S.historyItem, (el) => ({
          operator: el.getAttribute("data-operator"),
          operands: JSON.parse(el.getAttribute("data-operands") || "[]"),
          result: el.querySelector('[data-testid="history-result"]').getAttribute("data-value"),
        })),
        { operator: "+", operands: ["10", "5", "2"], result: "17" },
      );
      eq(checks, "edit-multi.old-entries-unchanged", (await historySnapshots(page)).slice(1), before);
      clean(checks, "edit-multi.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
    return checks;
  },
};

export const editInvalid = {
  id: "edit-invalid",
  async run({ browser, artifact }) {
    const checks = [];
    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      await compute(page, "+", ["12", "30", "8"]);
      const before = await historySnapshots(page);
      await clickHistoryEdit(page, 0);

      await setOperand(page, 1, "5");
      await setOperand(page, 1, "");
      await page.click(S.equals);
      eq(checks, "edit-invalid.empty.no-history", await page.$$eval(S.historyItem, (els) => els.length), 1);
      eq(checks, "edit-invalid.empty.no-result", await resultValue(page), null);
      eq(checks, "edit-invalid.empty.state", await appState(page), "edit");

      await setOperand(page, 1, "abc");
      await page.click(S.equals);
      eq(checks, "edit-invalid.nonfinite.no-history", await page.$$eval(S.historyItem, (els) => els.length), 1);
      eq(checks, "edit-invalid.nonfinite.no-result", await resultValue(page), null);

      await setOperand(page, 1, "5");
      await page.click(S.equals);
      eq(checks, "edit-invalid.fixed.result", await resultValue(page), "25");
      eq(checks, "edit-invalid.fixed.history", await page.$$eval(S.historyItem, (els) => els.length), 2);
      eq(
        checks,
        "edit-invalid.fixed.top-operands",
        await page.$eval(S.historyItem, (el) => JSON.parse(el.getAttribute("data-operands") || "[]")),
        ["12", "5", "8"],
      );
      eq(checks, "edit-invalid.old-entry-unchanged", (await historySnapshots(page)).slice(1), before);
      eq(checks, "edit-invalid.no-pageerrors", app.pageErrors.length, 0, app.pageErrors.join(" | "));
      clean(checks, "edit-invalid.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
    return checks;
  },
};

export const editDivZero = {
  id: "edit-divzero",
  async run({ browser, artifact }) {
    const checks = [];
    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      await compute(page, "/", ["100", "5", "2"]);
      const before = await historySnapshots(page);
      await clickHistoryEdit(page, 0);
      await setOperand(page, 1, "0");
      await page.click(S.equals);

      eq(checks, "edit-divzero.state", await appState(page), "error");
      eq(checks, "edit-divzero.flag", await resultError(page), "true");
      eq(checks, "edit-divzero.no-value", await resultValue(page), null);
      eq(checks, "edit-divzero.history", await page.$$eval(S.historyItem, (els) => els.length), 1);
      eq(checks, "edit-divzero.source-unchanged", await historySnapshots(page), before);
      eq(checks, "edit-divzero.picker-visible", await isVisible(page, S.picker), true);

      await page.click(`${S.picker} [data-op="+"]`);
      eq(checks, "edit-divzero.recover.state", await appState(page), "input");
      for (const value of ["1", "2"]) {
        for (const character of value) await page.click(`${S.keypad} [data-key="${character}"]`);
        await page.click(`${S.keypad} [data-key="enter"]`);
      }
      await page.click(S.equals);
      eq(checks, "edit-divzero.recover.result", await resultValue(page), "3");
      eq(checks, "edit-divzero.recover.history", await page.$$eval(S.historyItem, (els) => els.length), 2);
      clean(checks, "edit-divzero.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
    return checks;
  },
};

export const editCancelRestore = {
  id: "edit-cancel-restore",
  async run({ browser, artifact }) {
    const checks = [];
    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      await compute(page, "+", ["12", "30", "8"]);
      await compute(page, "*", ["2", "3", "4"]);
      const before = await historySnapshots(page);
      const view = await page.evaluate(({ app: appSelector, expression, result }) => {
        const root = document.querySelector(appSelector);
        const expressionView = document.querySelector(expression);
        const resultView = document.querySelector(result);
        return {
          state: root.dataset.state,
          operator: root.getAttribute("data-operator"),
          expression: (expressionView.textContent || "").trim(),
          resultText: (resultView.textContent || "").trim(),
          resultValue: resultView.getAttribute("data-value"),
        };
      }, { app: S.app, expression: S.expression, result: S.result });

      eq(checks, "edit-cancel-restore.hidden-before", await isVisible(page, S.editCancel), false);
      await clickHistoryEdit(page, 1);
      eq(checks, "edit-cancel-restore.state", await appState(page), "edit");
      eq(checks, "edit-cancel-restore.visible", await isVisible(page, S.editCancel), true);
      eq(checks, "edit-cancel-restore.result-cleared", await resultValue(page), null);
      eq(checks, "edit-cancel-restore.inputs", await page.locator(S.operandInput).count(), 3);

      await setOperand(page, 1, "5");
      await page.locator(S.operandInput).nth(2).click();
      eq(checks, "edit-cancel-restore.pending", await page.locator('[data-pending="true"]').count(), 1);
      await page.click(S.editCancel);

      eq(checks, "edit-cancel-restore.restored-state", await appState(page), view.state);
      eq(
        checks,
        "edit-cancel-restore.restored-operator",
        await page.$eval(S.app, (el) => el.getAttribute("data-operator")),
        view.operator,
      );
      eq(checks, "edit-cancel-restore.restored-expression", await expressionText(page), view.expression);
      eq(checks, "edit-cancel-restore.restored-result", await resultValue(page), view.resultValue);
      eq(checks, "edit-cancel-restore.restored-result-text", await page.$eval(S.result, (el) => (el.textContent || "").trim()), view.resultText);
      eq(checks, "edit-cancel-restore.history", await historySnapshots(page), before);
      eq(checks, "edit-cancel-restore.no-inputs", await page.locator(S.operandInput).count(), 0);
      eq(checks, "edit-cancel-restore.no-pending", await page.locator('[data-pending="true"]').count(), 0);
      eq(checks, "edit-cancel-restore.calc-empty", await page.$eval(S.calcInput, (el) => el.value), "");
      eq(checks, "edit-cancel-restore.focused", await page.$eval(S.calcInput, (el) => document.activeElement === el), true);
      clean(checks, "edit-cancel-restore.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
    return checks;
  },
};

export const editPendingReplace = {
  id: "edit-pending-replace",
  async run({ browser, artifact }) {
    const checks = [];
    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      await compute(page, "+", ["12", "30", "8"]);
      await clickHistoryEdit(page, 0);
      const expressionBefore = await expressionText(page);

      await page.locator(S.operandInput).nth(1).click();
      const afterClick = await liveOperands(page);
      eq(checks, "edit-pending-replace.cleared", afterClick[1], "");
      eq(checks, "edit-pending-replace.others", [afterClick[0], afterClick[2]], ["12", "8"]);
      eq(checks, "edit-pending-replace.pending", await page.locator('[data-pending="true"]').count(), 1);
      eq(checks, "edit-pending-replace.expression-unchanged", await expressionText(page), expressionBefore);
      eq(
        checks,
        "edit-pending-replace.focused",
        await page.evaluate((selector) => document.activeElement === document.querySelectorAll(selector)[1], S.operandInput),
        true,
      );

      await page.locator(S.operandInput).nth(0).click();
      eq(checks, "edit-pending-replace.middle-restored", await liveOperands(page), ["", "30", "8"]);
      eq(checks, "edit-pending-replace.first-pending", await page.locator('[data-pending="true"]').count(), 1);

      await page.locator(S.operandInput).nth(2).click();
      eq(checks, "edit-pending-replace.first-restored", await liveOperands(page), ["12", "30", ""]);
      await page.click(`${S.picker} [data-op="*"]`);
      eq(checks, "edit-pending-replace.operator-restored", await liveOperands(page), ["12", "30", "8"]);
      eq(checks, "edit-pending-replace.no-pending", await page.locator('[data-pending="true"]').count(), 0);
      eq(checks, "edit-pending-replace.draft-operator", (await editDraftInfo(page)).operator, "*");
      eq(checks, "edit-pending-replace.history", await page.locator(S.historyItem).count(), 1);
      clean(checks, "edit-pending-replace.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
    return checks;
  },
};

export const editPendingRecentValue = {
  id: "edit-pending-recent-value",
  async run({ browser, artifact }) {
    const checks = [];
    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      await compute(page, "+", ["12", "30", "8"]);
      await clickHistoryEdit(page, 0);

      await page.locator(S.operandInput).nth(1).click();
      await page.keyboard.type("7");
      eq(checks, "edit-pending-recent-value.typed", await liveOperands(page), ["12", "7", "8"]);
      let expression = await expressionText(page);
      eq(checks, "edit-pending-recent-value.expression-new", expression.includes("7") && !expression.includes("30"), true, expression);

      await page.locator(S.operandInput).nth(2).click();
      eq(checks, "edit-pending-recent-value.last-cleared", await liveOperands(page), ["12", "7", ""]);
      eq(
        checks,
        "edit-pending-recent-value.last-original-retained",
        await page.locator(S.operandChip).nth(2).getAttribute("data-value"),
        "8",
      );

      await page.locator(S.operandInput).nth(1).click();
      eq(checks, "edit-pending-recent-value.middle-cleared", await liveOperands(page), ["12", "", "8"]);

      await page.locator(S.operandInput).nth(2).click();
      eq(checks, "edit-pending-recent-value.middle-recent", await liveOperands(page), ["12", "7", ""]);
      expression = await expressionText(page);
      eq(checks, "edit-pending-recent-value.expression-recent", expression.includes("7") && !expression.includes("30"), true, expression);

      await page.locator(S.operandInput).nth(0).click();
      await setOperand(page, 0, "9");
      eq(checks, "edit-pending-recent-value.first-filled", await liveOperands(page), ["9", "7", "8"]);
      eq(checks, "edit-pending-recent-value.history", await page.locator(S.historyItem).count(), 1);
      clean(checks, "edit-pending-recent-value.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
    return checks;
  },
};

export const scenarios = [
  editRecompute,
  editMulti,
  editInvalid,
  editDivZero,
  editCancelRestore,
  editPendingReplace,
  editPendingRecentValue,
];
