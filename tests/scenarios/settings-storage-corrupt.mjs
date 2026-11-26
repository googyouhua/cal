import { openApp } from "../lib/browser.mjs";
import { eq, clean } from "../lib/check.mjs";
import { appState } from "../lib/dom.mjs";
import { openSettings, settingsValues, seedRawSettings } from "../lib/settings.mjs";

// A hand-edited, half-written, or version-skewed payload must degrade to the
// defaults that keep scoring possible, and must never take the page down.
export const settingsStorageCorrupt = {
  id: "settings-storage-corrupt",
  async run({ browser, artifact }) {
    const checks = [];
    const app = await openApp(browser, artifact);
    try {
      const { page } = app;

      await seedRawSettings(app, "{not json", "storage-corrupt");
      eq(checks, "settings-storage-corrupt.state", await appState(page), "select");
      eq(checks, "settings-storage-corrupt.no-pageerrors", app.pageErrors.length, 0, app.pageErrors.join(" | "));
      await openSettings(page);
      eq(
        checks,
        "settings-storage-corrupt.defaults",
        await settingsValues(page),
        { autoConfirm: "0", autoEquals: "0", resultPause: "2", baseEnabled: false, baseValue: "0", haptics: true },
      );

      // Well-formed JSON can still carry values the product cannot honor. Each
      // out-of-range field falls back on its own; the valid one survives.
      await seedRawSettings(
        app,
        JSON.stringify({ autoConfirm: 999, autoEquals: -3, resultPause: 99, baseEnabled: true, baseValue: "abc", haptics: "no" }),
        "storage-out-of-range",
      );
      eq(checks, "settings-storage-corrupt.range-state", await appState(page), "select");
      await openSettings(page);
      eq(
        checks,
        "settings-storage-corrupt.range-controls",
        await settingsValues(page),
        { autoConfirm: "0", autoEquals: "0", resultPause: "2", baseEnabled: true, baseValue: "0", haptics: true },
      );

      clean(checks, "settings-storage-corrupt.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
    return checks;
  },
};

export const scenarios = [settingsStorageCorrupt];
