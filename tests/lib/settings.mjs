import { S } from "./selectors.mjs";

export const SETTINGS_KEY = "cal-phone.settings.v1";

// The product reads settings once at startup, so a seeded payload needs a reload.
// The marker keeps the seed to exactly one document load: otherwise the
// verification reload in a round-trip test re-applies the seed over the value the
// panel just saved. It lives in sessionStorage, so it never appears in
// localStorage evidence and the product never reads it.
const SEED_MARKER_KEY = "cal-phone.test-seed";

export async function seedSettings(app, settings, tag) {
  await app.context.addInitScript(
    ({ key, raw, markerKey, tag: allowOnce }) => {
      const done = String(window.sessionStorage.getItem(markerKey) ?? "").split(",");
      if (done.includes(allowOnce)) return;
      window.localStorage.setItem(key, raw);
      window.sessionStorage.setItem(markerKey, [...done, allowOnce].join(","));
    },
    { key: SETTINGS_KEY, raw: JSON.stringify(settings), markerKey: SEED_MARKER_KEY, tag },
  );
  await app.page.reload({ waitUntil: "load" });
}

// Seeding an unparseable payload cannot go through JSON.stringify.
export async function seedRawSettings(app, raw, tag) {
  await app.context.addInitScript(
    ({ key, value, markerKey, tag: allowOnce }) => {
      const done = String(window.sessionStorage.getItem(markerKey) ?? "").split(",");
      if (done.includes(allowOnce)) return;
      window.localStorage.setItem(key, value);
      window.sessionStorage.setItem(markerKey, [...done, allowOnce].join(","));
    },
    { key: SETTINGS_KEY, value: raw, markerKey: SEED_MARKER_KEY, tag },
  );
  await app.page.reload({ waitUntil: "load" });
}

export async function openSettings(page) {
  await page.click(S.settingsToggle);
  await page.waitForFunction((selector) => document.querySelector(selector).open === true, S.settingsPanel);
}

export async function closeSettings(page) {
  await page.keyboard.press("Escape");
  await page.waitForFunction((selector) => document.querySelector(selector).open === false, S.settingsPanel);
}

export async function settingsValues(page) {
  return page.evaluate((selectors) => ({
    autoConfirm: document.querySelector(selectors.autoConfirm).value,
    autoEquals: document.querySelector(selectors.autoEquals).value,
    resultPause: document.querySelector(selectors.resultPause).value,
    baseEnabled: document.querySelector(selectors.baseToggle).checked,
    baseValue: document.querySelector(selectors.baseValue).value,
    haptics: document.querySelector(selectors.haptics).checked,
  }), {
    autoConfirm: S.autoConfirm,
    autoEquals: S.autoEquals,
    resultPause: S.resultPause,
    baseToggle: S.baseToggle,
    baseValue: S.baseValue,
    haptics: S.haptics,
  });
}

export async function storedSettings(page) {
  return page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) || "null"), SETTINGS_KEY);
}

export const STORED_SHAPE = Object.freeze([
  "autoConfirm",
  "autoEquals",
  "baseEnabled",
  "baseValue",
  "haptics",
  "resultPause",
  "voiceKeys",
  "voiceResult",
]);
