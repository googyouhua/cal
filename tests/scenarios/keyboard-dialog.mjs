import { openApp } from "../lib/browser.mjs";
import { S } from "../lib/selectors.mjs";
import { eq, clean } from "../lib/check.mjs";
import { appState, expressionText } from "../lib/dom.mjs";
import { openSettings } from "../lib/settings.mjs";

// The settings dialog is modal. A physical keypress while it is open must not
// reach the calculator underneath, and Escape must hand focus back to the gear.
export const keyboardDialog = {
  id: "keyboard-dialog",
  async run({ browser, artifact }) {
    const checks = [];
    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      await openSettings(page);

      await page.keyboard.press("7");
      eq(checks, "keyboard-dialog.input", await page.$eval(S.calcInput, (el) => el.value), "");
      eq(checks, "keyboard-dialog.state", await appState(page), "select");
      eq(checks, "keyboard-dialog.expression", await expressionText(page), "");

      await page.keyboard.press("Escape");
      await page.waitForFunction((selector) => document.querySelector(selector).open === false, S.settingsPanel);
      eq(checks, "keyboard-dialog.closed", await page.$eval(S.settingsPanel, (el) => el.open), false);
      eq(
        checks,
        "keyboard-dialog.focus-returned",
        await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null),
        "settings-toggle",
      );
      eq(checks, "keyboard-dialog.aria-expanded", await page.$eval(S.settingsToggle, (el) => el.getAttribute("aria-expanded")), "false");

      clean(checks, "keyboard-dialog.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
    return checks;
  },
};

export const scenarios = [keyboardDialog];
