import { openApp } from "../lib/browser.mjs";
import { S } from "../lib/selectors.mjs";
import { eq, clean } from "../lib/check.mjs";
import { appState, resultValue, isVisible, clickKey, typeNumber, selectOperator, clickEquals } from "../lib/dom.mjs";

// Private-mode and locked-down browsers throw on storage access. Scoring has to
// keep working from memory and the teacher has to be told the result is volatile.
export const settingsStorageDenied = {
  id: "settings-storage-denied",
  async run({ browser, artifact }) {
    const checks = [];
    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      await app.context.addInitScript(() => {
        Storage.prototype.getItem = () => {
          throw new Error("blocked");
        };
        Storage.prototype.setItem = () => {
          throw new Error("blocked");
        };
      });
      await page.reload({ waitUntil: "load" });

      eq(checks, "settings-storage-denied.state", await appState(page), "select");
      eq(checks, "settings-storage-denied.warning-visible", await isVisible(page, S.storageWarning), true);

      await selectOperator(page, "+");
      await typeNumber(page, "2");
      await clickKey(page, "enter");
      await typeNumber(page, "3");
      await clickKey(page, "enter");
      await clickEquals(page);
      eq(checks, "settings-storage-denied.result", await resultValue(page), "5");
      eq(checks, "settings-storage-denied.no-pageerrors", app.pageErrors.length, 0, app.pageErrors.join(" | "));

      clean(checks, "settings-storage-denied.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
    return checks;
  },
};

export const scenarios = [settingsStorageDenied];
