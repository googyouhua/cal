import { openApp } from "../lib/browser.mjs";
import { S } from "../lib/selectors.mjs";
import { eq, clean } from "../lib/check.mjs";
import { appState, expressionText, isVisible, liveOperands } from "../lib/dom.mjs";
import { seedSettings } from "../lib/settings.mjs";

// Editing a record accepts a new operand from the keypad; the physical keyboard
// must reach the same path, and Enter must commit it into the draft.
export const keyboardEditDraft = {
  id: "keyboard-edit-draft",
  async run({ browser, artifact }) {
    const checks = [];
    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      await seedSettings(app, { resultPause: 0 }, "keyboard-edit-draft");

      await page.click(`${S.picker} [data-op="+"]`);
      await page.keyboard.press("2");
      await page.keyboard.press("Enter");
      await page.keyboard.press("3");
      await page.keyboard.press("Enter");
      await page.keyboard.press("=");
      await page.click(S.historyEdit);
      eq(checks, "keyboard-edit-draft.state", await appState(page), "edit");

      await page.keyboard.press("7");
      eq(checks, "keyboard-edit-draft.input", await page.$eval(S.calcInput, (el) => el.value), "7");
      eq(checks, "keyboard-edit-draft.state-unchanged", await appState(page), "edit");

      await page.keyboard.press("Enter");
      eq(checks, "keyboard-edit-draft.operand-count", await page.locator(S.operandInput).count(), 3);
      eq(checks, "keyboard-edit-draft.operands", await liveOperands(page), ["2", "3", "7"]);
      // The live draft expression keeps the pending operator as its trailing
      // token, so the appended operand reads "2 + 3 + 7 +".
      eq(checks, "keyboard-edit-draft.expression", await expressionText(page), "2 + 3 + 7 +");
      eq(checks, "keyboard-edit-draft.input-cleared", await page.$eval(S.calcInput, (el) => el.value), "");
      const label = await page.$eval("#state-label", (el) => (el.textContent || "").trim());
      eq(checks, "keyboard-edit-draft.announced", label, "已加入 7，可继续编辑或按 = 重算");

      // Characterization, not a desired contract: Escape closes the settings and
      // import dialogs but leaves this draft open. Raised as a product question;
      // these checks record today's behavior so a decision is a visible change.
      await page.keyboard.press("Escape");
      eq(checks, "keyboard-edit-draft.escape-operand-count", await page.locator(S.operandInput).count(), 3);
      eq(checks, "keyboard-edit-draft.escape-draft-visible", await isVisible(page, S.editDraft), true);
      eq(checks, "keyboard-edit-draft.escape-state", await appState(page), "edit");

      clean(checks, "keyboard-edit-draft.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
    return checks;
  },
};

export const scenarios = [keyboardEditDraft];
