import { openApp } from "../lib/browser.mjs";
import { S } from "../lib/selectors.mjs";
import { eq, clean } from "../lib/check.mjs";
import { appState, resultValue, clickKey, typeNumber, selectOperator, clickEquals } from "../lib/dom.mjs";
import { openSettings, closeSettings, settingsValues, storedSettings, STORED_SHAPE } from "../lib/settings.mjs";

// Persistence is only useful if it survives the reload the product performs on
// every open and still drives behavior, not just the panel's field values.
export const settingsStorageRoundTrip = {
  id: "settings-storage-round-trip",
  async run({ browser, artifact }) {
    const checks = [];
    const app = await openApp(browser, artifact);
    try {
      const { page } = app;

      await openSettings(page);
      await page.fill(S.resultPause, "2.5");
      await page.click(S.haptics);
      eq(checks, "settings-storage-round-trip.haptics-off", await page.$eval(S.haptics, (el) => el.checked), false);

      const stored = await storedSettings(page);
      eq(checks, "settings-storage-round-trip.stored-pause", stored.resultPause, 2.5);
      eq(checks, "settings-storage-round-trip.stored-haptics", stored.haptics, false);
      eq(checks, "settings-storage-round-trip.stored-shape", Object.keys(stored).sort(), [...STORED_SHAPE].sort());
      eq(
        checks,
        "settings-storage-round-trip.no-extra-keys",
        await page.evaluate(() => Object.keys(window.localStorage).sort()),
        ["cal-phone.settings.v1"],
      );

      await page.reload({ waitUntil: "load" });
      eq(checks, "settings-storage-round-trip.reload-state", await appState(page), "select");
      await openSettings(page);
      eq(
        checks,
        "settings-storage-round-trip.reload-controls",
        await settingsValues(page),
        { autoConfirm: "0", autoEquals: "0", resultPause: "2.5", baseEnabled: false, baseValue: "0", haptics: false },
      );

      // The persisted pause must still gate digit entry after the reload.
      await closeSettings(page);
      await selectOperator(page, "+");
      await typeNumber(page, "2");
      await clickKey(page, "enter");
      await typeNumber(page, "3");
      await clickKey(page, "enter");
      await clickEquals(page);
      eq(checks, "settings-storage-round-trip.result", await resultValue(page), "5");
      await clickKey(page, "9");
      eq(checks, "settings-storage-round-trip.blocked-digit", await page.$eval(S.calcInput, (el) => el.value), "");

      clean(checks, "settings-storage-round-trip.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
    return checks;
  },
};

export const scenarios = [settingsStorageRoundTrip];
