import { openApp } from "../lib/browser.mjs";
import { S } from "../lib/selectors.mjs";
import { eq, clean } from "../lib/check.mjs";
import { appState, resultValue, clickKey, selectOperator, clickEquals } from "../lib/dom.mjs";
import { openSettings, closeSettings, seedSettings } from "../lib/settings.mjs";

// Stub vibration before the page loads; the app reads navigator.vibrate lazily,
// but the stub has to exist before the first keypress either way.
async function stubVibration(app) {
  await app.context.addInitScript(() => {
    window.__vibrations = [];
    const record = (...args) => {
      window.__vibrations.push(args);
      return true;
    };
    try {
      Object.defineProperty(window.navigator, "vibrate", { configurable: true, writable: true, value: record });
    } catch (error) {
      window.navigator.vibrate = record;
    }
  });
}

async function vibrations(page) {
  return page.evaluate(() => window.__vibrations);
}

async function resetVibrations(page) {
  await page.evaluate(() => {
    window.__vibrations = [];
  });
}

// 1, 2, 退格, +, 3, 确认, = — every screen key that should buzz once.
async function keypadSequence(page) {
  await clickKey(page, "1");
  await clickKey(page, "2");
  await clickKey(page, "backspace");
  await selectOperator(page, "+");
  await clickKey(page, "3");
  await clickKey(page, "enter");
  await clickEquals(page);
}

export const settingsHaptics = {
  id: "settings-haptics",
  async run({ browser, artifact }) {
    const checks = [];
    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      await stubVibration(app);

      await seedSettings(app, { haptics: true, resultPause: 0 }, "haptics-on");
      await keypadSequence(page);
      const onCalls = await vibrations(page);
      eq(checks, "settings-haptics.on.count", onCalls.length, 7);
      eq(checks, "settings-haptics.on.payloads", onCalls, Array.from({ length: 7 }, () => [10]));
      // Guard: the sequence really did compute, so the count is not vacuous.
      eq(checks, "settings-haptics.on.result", await resultValue(page), "4");
      eq(checks, "settings-haptics.on.state", await appState(page), "result");

      // The physical keyboard is a silent path by design.
      await resetVibrations(page);
      await page.click(S.keyOp);
      await page.keyboard.press("5");
      await page.keyboard.press("Enter");
      eq(checks, "settings-haptics.keyboard.state", await appState(page), "input");
      eq(checks, "settings-haptics.keyboard.calls", (await vibrations(page)).length, 0);
      eq(checks, "settings-haptics.keyboard.effect", await page.$eval(S.calcInput, (el) => el.value), "");
      eq(checks, "settings-haptics.keyboard.expression", await page.$eval(S.expression, (el) => (el.textContent || "").trim()), "5");

      await seedSettings(app, { haptics: false, resultPause: 0 }, "haptics-off");
      await keypadSequence(page);
      eq(checks, "settings-haptics.off.count", (await vibrations(page)).length, 0);
      eq(checks, "settings-haptics.off.result", await resultValue(page), "4");

      await seedSettings(app, { haptics: true, resultPause: 0 }, "haptics-toggle");
      await openSettings(page);
      eq(checks, "settings-haptics.toggle.initial", await page.$eval(S.haptics, (el) => el.checked), true);
      await page.click(S.haptics);
      eq(checks, "settings-haptics.toggle.unchecked", await page.$eval(S.haptics, (el) => el.checked), false);
      eq(
        checks,
        "settings-haptics.toggle.stored",
        await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) || "null").haptics, "cal-phone.settings.v1"),
        false,
      );

      await closeSettings(page);
      await page.reload({ waitUntil: "load" });
      eq(checks, "settings-haptics.toggle.reload-checkbox", await page.$eval(S.haptics, (el) => el.checked), false);
      await openSettings(page);
      eq(checks, "settings-haptics.toggle.reload-panel", await page.$eval(S.haptics, (el) => el.checked), false);
      await closeSettings(page);
      await resetVibrations(page);
      await clickKey(page, "1");
      eq(checks, "settings-haptics.toggle.reload-silent", (await vibrations(page)).length, 0);
      eq(checks, "settings-haptics.toggle.reload-input", await page.$eval(S.calcInput, (el) => el.value), "1");

      clean(checks, "settings-haptics.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
    return checks;
  },
};

export const scenarios = [settingsHaptics];
