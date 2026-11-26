import { openApp } from "../lib/browser.mjs";
import { S } from "../lib/selectors.mjs";
import { eq, clean } from "../lib/check.mjs";
import { appState, expressionText } from "../lib/dom.mjs";
import { seedSettings } from "../lib/settings.mjs";

// The keyboard path has to be a first-class way to score: after a result, a
// digit starts a fresh calculation exactly as a keypad tap would.
export const keyboardResultState = {
  id: "keyboard-result-state",
  async run({ browser, artifact }) {
    const checks = [];
    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      // The default 2 s result pause would swallow the keypress this scenario is
      // about; the pause has its own scenario.
      await seedSettings(app, { resultPause: 0 }, "keyboard-result-state");

      await page.click(`${S.picker} [data-op="+"]`);
      await page.keyboard.press("2");
      await page.keyboard.press("Enter");
      await page.keyboard.press("3");
      await page.keyboard.press("Enter");
      await page.keyboard.press("=");
      eq(checks, "keyboard-result-state.result", await appState(page), "result");

      await page.keyboard.press("5");
      eq(checks, "keyboard-result-state.state-after-key", await appState(page), "input");
      eq(checks, "keyboard-result-state.input", await page.$eval(S.calcInput, (el) => el.value), "5");
      eq(checks, "keyboard-result-state.expression-cleared", await expressionText(page), "");

      await page.click(S.keyOp);
      eq(checks, "keyboard-result-state.reset", await appState(page), "select");

      clean(checks, "keyboard-result-state.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
    return checks;
  },
};

export const scenarios = [keyboardResultState];
