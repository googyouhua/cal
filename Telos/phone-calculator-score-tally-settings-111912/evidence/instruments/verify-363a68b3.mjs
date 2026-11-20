#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { launchBrowser, openApp } from "../../../tests/lib/browser.mjs";
import { S } from "../../../tests/lib/selectors.mjs";

const SELF_PATH = fileURLToPath(import.meta.url);
const SELF_DIR = path.dirname(SELF_PATH);
const TESTS_DIR = path.resolve(SELF_DIR, "../../../tests");
const REPO_DIR = path.resolve(SELF_DIR, "../../..");
const ARTIFACT = path.resolve(process.env.KEKKAI_ARTIFACT || path.join(REPO_DIR, "index.html"));
const ROUND = Number(process.argv[2] || process.env.KEKKAI_ROUND || "1");
const OUT_DIR = path.resolve(process.env.KEKKAI_OUT_DIR || path.join(SELF_DIR, "runs"));
const REVIEW_STATES = String(
  process.env.KEKKAI_EXPECTED_REVIEW_STATES || process.env.EXPECTED_REVIEW_STATES || "S1,S2,S3,S4",
)
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value && value.toLowerCase() !== "none");

const SETTINGS_KEY = "cal-phone.settings.v1";
const NUM_TOL = 1e-9;
const LAYOUT_TOL = 0.5;
const MIN_CONTROL = 43.5;
const MIN_FONT = 15.5;
const T = Object.freeze({
  toggle: 'button[data-testid="settings-toggle"]',
  indicator: '[data-testid="settings-indicator"]',
  panel: 'dialog[data-testid="settings-panel"]',
  autoConfirm: 'select[data-testid="settings-auto-confirm"]',
  baseToggle: 'input[data-testid="settings-base-toggle"]',
  baseValue: 'input[data-testid="settings-base-value"]',
  done: 'button[data-testid="settings-done"]',
  progress: '[data-testid="auto-confirm-progress"]',
  baseMarker: '[data-testid="base-marker"]',
  editBaseMarker: '[data-testid="edit-base-marker"]',
  stateLabel: "#state-label",
  historyItem: '[data-testid="history-item"]',
  historyResult: '[data-testid="history-result"]',
  historyEdit: '[data-testid="history-edit"]',
  editDraft: '[data-testid="edit-draft"]',
  operandInput: 'input[data-testid="operand-input"]',
  operandChip: '[data-testid="operand-chip"]',
});

let sharedBrowser = null;
let reviewOutcome = { pass: false, checks: [] };
const observedPageErrors = [];
const observedConsoleErrors = [];

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

function display(value) {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(value);
  try {
    const text = JSON.stringify(value);
    return text.length > 1400 ? `${text.slice(0, 1400)}…` : text;
  } catch {
    return String(value);
  }
}

function addCheck(checks, id, pass, actual, expected) {
  checks.push({ id, pass: Boolean(pass), actual, expected });
  return Boolean(pass);
}

function eqCheck(checks, id, actual, expected) {
  return addCheck(checks, id, isDeepStrictEqual(actual, expected), actual, expected);
}

function nearCheck(checks, id, actual, expected, tolerance = NUM_TOL) {
  const number = Number(actual);
  return addCheck(
    checks,
    id,
    Number.isFinite(number) && Math.abs(number - expected) <= tolerance,
    actual,
    `${expected} ± ${tolerance}`,
  );
}

function reviewCheck(id, pass, actual, expected) {
  return addCheck(reviewOutcome.checks, id, pass, actual, expected);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function autoWaitMs(seconds) {
  return Math.ceil(Number(seconds) * 1400);
}

async function stableLayout(page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

async function waitDialog(page, open, timeout = 3000) {
  try {
    await page.waitForFunction(
      ({ selector, wanted }) => {
        const dialog = document.querySelector(selector);
        return Boolean(dialog) && dialog.open === wanted;
      },
      { selector: T.panel, wanted: open },
      { timeout },
    );
    return true;
  } catch {
    return false;
  }
}

async function waitGearFocus(page, timeout = 3000) {
  try {
    await page.waitForFunction(
      (selector) => document.activeElement === document.querySelector(selector),
      T.toggle,
      { timeout },
    );
    return true;
  } catch {
    return false;
  }
}

async function isVisible(page, selector) {
  return page.locator(selector).first().evaluate((element) => {
    const style = getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) !== 0 &&
      element.getClientRects().length > 0
    );
  });
}

async function rectOf(page, selector) {
  return page.locator(selector).first().boundingBox();
}

async function openSettings(page) {
  await page.locator(T.toggle).click();
  const opened = await waitDialog(page, true);
  if (!opened) throw new Error("settings panel did not open");
}

async function closeSettingsWithDone(page) {
  await page.locator(T.done).click();
  const closed = await waitDialog(page, false);
  if (!closed) throw new Error("settings panel did not close via done");
}

async function setSettings(page, { t, baseEnabled, baseValue } = {}) {
  await openSettings(page);
  if (t !== undefined) await page.locator(T.autoConfirm).selectOption(String(t));
  if (baseEnabled !== undefined) {
    if (baseEnabled) await page.locator(T.baseToggle).check();
    else await page.locator(T.baseToggle).uncheck();
  }
  if (baseValue !== undefined) await page.locator(T.baseValue).fill(String(baseValue));
  await closeSettingsWithDone(page);
}

async function clickKey(page, key) {
  await page.locator(`${S.keypad} [data-key="${key}"]`).click();
}

async function clickOperator(page, operator) {
  await page.locator(`${S.picker} [data-op="${operator}"]`).click();
}

async function typeNumber(page, value) {
  for (const character of String(value)) await clickKey(page, character);
}

async function enterNumber(page, value) {
  await typeNumber(page, value);
  await clickKey(page, "enter");
}

async function clickEquals(page) {
  await page.locator(S.equals).click();
}

async function appSnapshot(page) {
  const input = page.locator(S.calcInput);
  const result = page.locator(S.result);
  return {
    state: await page.locator(S.app).getAttribute("data-state"),
    operator: await page.locator(S.app).getAttribute("data-operator"),
    input: await input.inputValue(),
    expression: (await page.locator(S.expression).textContent() || "").trim(),
    resultValue: await result.getAttribute("data-value"),
    resultError: await result.getAttribute("data-error"),
    stateLabel: (await page.locator(T.stateLabel).textContent() || "").trim(),
    history: await page.locator(T.historyItem).count(),
  };
}

async function historyDetails(page) {
  return page.$$eval(T.historyItem, (items) =>
    items.map((item) => {
      const result = item.querySelector('[data-testid="history-result"]');
      const expression = item.querySelector('[data-testid="history-expression"]');
      return {
        operator: item.getAttribute("data-operator"),
        operands: JSON.parse(item.getAttribute("data-operands") || "[]"),
        base: item.getAttribute("data-base"),
        result: result ? result.getAttribute("data-value") : null,
        expression: expression ? (expression.textContent || "").trim() : "",
      };
    }),
  );
}

async function readSettings(page) {
  return page.evaluate(
    ({ autoSelector, toggleSelector, valueSelector, key }) => {
      const auto = document.querySelector(autoSelector);
      const toggle = document.querySelector(toggleSelector);
      const value = document.querySelector(valueSelector);
      let stored = null;
      let storageError = null;
      try {
        stored = localStorage.getItem(key);
      } catch (error) {
        storageError = String(error);
      }
      return {
        t: auto ? auto.value : null,
        baseChecked: Boolean(toggle && toggle.checked),
        baseDisabled: Boolean(value && value.disabled),
        baseValue: value ? value.value : null,
        stored,
        storageError,
      };
    },
    {
      autoSelector: T.autoConfirm,
      toggleSelector: T.baseToggle,
      valueSelector: T.baseValue,
      key: SETTINGS_KEY,
    },
  );
}

function recordAppErrors(tag, app) {
  for (const text of app.pageErrors) observedPageErrors.push({ tag, text: String(text) });
  for (const text of app.consoleErrors) observedConsoleErrors.push({ tag, text: String(text) });
}

async function openCustom(options, tag) {
  const context = await sharedBrowser.newContext({
    viewport: options.viewport || { width: 390, height: 844 },
    isMobile: options.isMobile !== false,
    hasTouch: options.hasTouch !== false,
    ...(options.reducedMotion ? { reducedMotion: options.reducedMotion } : {}),
  });
  if (options.initScript) await context.addInitScript(options.initScript);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(15000);
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  if (options.cdp) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", options.cdp);
  }
  await page.goto(pathToFileURL(ARTIFACT).href, { waitUntil: "load" });
  return {
    tag,
    context,
    page,
    pageErrors,
    consoleErrors,
    async close() {
      await context.close();
    },
  };
}

async function withApp(tag, options, callback) {
  const app = await openApp(sharedBrowser, ARTIFACT, options || {});
  try {
    return await callback(app);
  } finally {
    recordAppErrors(tag, app);
    await app.close();
  }
}

async function withCustom(tag, options, callback) {
  const app = await openCustom(options, tag);
  try {
    return await callback(app);
  } finally {
    recordAppErrors(tag, app);
    await app.close();
  }
}

async function runCase(checks, id, callback) {
  try {
    await callback();
  } catch (error) {
    addCheck(checks, `${id}.exception`, false, error && error.stack ? error.stack : String(error), "completes");
  }
}

async function h1(checks) {
  await withApp("H1", {}, async ({ page }) => {
    const gear = page.locator(T.toggle);
    const gearRect = await rectOf(page, T.toggle);
    eqCheck(checks, "h1.gear.visible", await isVisible(page, T.toggle), true);
    addCheck(
      checks,
      "h1.gear.size",
      gearRect && gearRect.width >= 44 && gearRect.height >= 44,
      gearRect && { width: gearRect.width, height: gearRect.height },
      "width>=44 && height>=44",
    );
    const gearRight = gearRect ? gearRect.x + gearRect.width : null;
    const gearTop = gearRect ? gearRect.y : null;
    addCheck(
      checks,
      "h1.gear.position",
      gearRight > 390 / 2 && gearTop < 100,
      { right: gearRight, top: gearTop },
      "right>195 && top<100",
    );
    eqCheck(checks, "h1.gear.haspopup", await gear.getAttribute("aria-haspopup"), "dialog");
    eqCheck(checks, "h1.gear.expanded.initial", await gear.getAttribute("aria-expanded"), "false");

    await gear.click();
    await waitDialog(page, true);
    const dialogInfo = await page.locator(T.panel).evaluate((dialog) => ({
      tagName: dialog.tagName,
      open: dialog.open,
      modal: dialog.matches(":modal"),
      focusInside: dialog.contains(document.activeElement),
      activeTag: document.activeElement ? document.activeElement.tagName : null,
    }));
    eqCheck(checks, "h1.dialog.tagName", dialogInfo.tagName, "DIALOG");
    eqCheck(checks, "h1.dialog.open", dialogInfo.open, true);
    eqCheck(checks, "h1.dialog.modal", dialogInfo.modal, true);
    eqCheck(checks, "h1.dialog.focusInside", dialogInfo.focusInside, true);
    eqCheck(checks, "h1.dialog.expanded", await gear.getAttribute("aria-expanded"), "true");

    await page.keyboard.press("Escape");
    await waitDialog(page, false);
    await waitGearFocus(page);
    eqCheck(checks, "h1.close.escape.open", await page.locator(T.panel).evaluate((dialog) => dialog.open), false);
    eqCheck(
      checks,
      "h1.close.escape.focusGear",
      await page.evaluate((selector) => document.activeElement === document.querySelector(selector), T.toggle),
      true,
    );
    eqCheck(checks, "h1.close.escape.expanded", await gear.getAttribute("aria-expanded"), "false");

    await gear.click();
    await waitDialog(page, true);
    await closeSettingsWithDone(page);
    await waitGearFocus(page);
    eqCheck(checks, "h1.close.done.open", await page.locator(T.panel).evaluate((dialog) => dialog.open), false);
    eqCheck(
      checks,
      "h1.close.done.focusGear",
      await page.evaluate((selector) => document.activeElement === document.querySelector(selector), T.toggle),
      true,
    );
    eqCheck(checks, "h1.close.done.expanded", await gear.getAttribute("aria-expanded"), "false");

    await gear.click();
    await waitDialog(page, true);
    await page.mouse.click(2, 842);
    await waitDialog(page, false);
    await waitGearFocus(page);
    eqCheck(checks, "h1.close.backdrop.open", await page.locator(T.panel).evaluate((dialog) => dialog.open), false);
    eqCheck(
      checks,
      "h1.close.backdrop.focusGear",
      await page.evaluate((selector) => document.activeElement === document.querySelector(selector), T.toggle),
      true,
    );
    eqCheck(checks, "h1.close.backdrop.expanded", await gear.getAttribute("aria-expanded"), "false");

    await openSettings(page);
    await page.locator(T.autoConfirm).selectOption("1");
    await closeSettingsWithDone(page);
    eqCheck(checks, "h1.indicator.on.visible", await isVisible(page, T.indicator), true);

    await openSettings(page);
    await page.locator(T.autoConfirm).selectOption("0");
    await page.locator(T.baseToggle).uncheck();
    await closeSettingsWithDone(page);
    eqCheck(checks, "h1.indicator.off.visible", await isVisible(page, T.indicator), false);
  });
}

async function h2(checks) {
  await withApp("H2-persist", {}, async ({ page, pageErrors, consoleErrors }) => {
    const options = await page
      .locator(T.autoConfirm)
      .evaluate((element) => Array.from(element.options).map((option) => option.value));
    const expectedOptions = Array.from({ length: 21 }, (_, index) => String(index / 2));
    eqCheck(checks, "h2.default.options", options, expectedOptions);
    eqCheck(checks, "h2.default.t", await page.locator(T.autoConfirm).inputValue(), "0");
    const initial = await readSettings(page);
    eqCheck(checks, "h2.default.baseChecked", initial.baseChecked, false);
    eqCheck(checks, "h2.default.baseDisabled", initial.baseDisabled, true);
    eqCheck(checks, "h2.default.baseValue", initial.baseValue, "0");
    addCheck(checks, "h2.default.storageKey", initial.stored === null || initial.stored === "", initial.stored, "null or empty");

    await setSettings(page, { t: 1, baseEnabled: true, baseValue: "10" });
    const stored = await page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY);
    addCheck(checks, "h2.stored.nonEmpty", typeof stored === "string" && stored.length > 0, stored, "non-empty string");

    await page.reload({ waitUntil: "load" });
    const restored = await readSettings(page);
    eqCheck(checks, "h2.reload.t", restored.t, "1");
    eqCheck(checks, "h2.reload.baseChecked", restored.baseChecked, true);
    eqCheck(checks, "h2.reload.baseValue", restored.baseValue, "10");
    eqCheck(checks, "h2.reload.baseDisabled", restored.baseDisabled, false);

    await clickOperator(page, "+");
    await enterNumber(page, "9.5");
    await clickEquals(page);
    const snap = await appSnapshot(page);
    nearCheck(checks, "h2.reload.result", snap.resultValue, 19.5);
    eqCheck(checks, "h2.history.beforeReload", snap.history, 1);

    await page.locator(S.keyOp).click();
    const afterReset = await readSettings(page);
    eqCheck(checks, "h2.reset.t", afterReset.t, "1");
    eqCheck(checks, "h2.reset.baseChecked", afterReset.baseChecked, true);
    eqCheck(checks, "h2.reset.baseValue", afterReset.baseValue, "10");

    await page.reload({ waitUntil: "load" });
    eqCheck(checks, "h2.history.afterReload", await page.locator(T.historyItem).count(), 0);
    addCheck(
      checks,
      "h2.persist.clean",
      pageErrors.length === 0 && consoleErrors.length === 0,
      { pageErrors: pageErrors.length, consoleErrors: consoleErrors.length },
      { pageErrors: 0, consoleErrors: 0 },
    );
  });

  await withCustom(
    "H2-storage-throws",
    {
      initScript: () => {
        Storage.prototype.getItem = function getItem() {
          throw new Error("storage disabled by verifier");
        };
        Storage.prototype.setItem = function setItem() {
          throw new Error("storage disabled by verifier");
        };
      },
    },
    async ({ page, pageErrors }) => {
      await setSettings(page, { t: 1 });
      await typeNumber(page, "9.5");
      await sleep(autoWaitMs(1));
      const snap = await appSnapshot(page);
      eqCheck(checks, "h2.disabledStorage.t", await page.locator(T.autoConfirm).inputValue(), "1");
      eqCheck(checks, "h2.disabledStorage.input", snap.input, "");
      addCheck(checks, "h2.disabledStorage.expression", snap.expression.includes("9.5"), snap.expression, "contains 9.5");
      eqCheck(checks, "h2.disabledStorage.state", snap.state, "input");
      eqCheck(checks, "h2.disabledStorage.pageErrors", pageErrors.length, 0);
    },
  );
}

async function h3(checks) {
  await runCase(checks, "h3.t0", async () => {
    await withApp("H3-t0", {}, async ({ page }) => {
      await typeNumber(page, "9.5");
      await sleep(1200);
      const snap = await appSnapshot(page);
      eqCheck(checks, "h3.t0.input", snap.input, "9.5");
      eqCheck(checks, "h3.t0.expression", snap.expression, "");
    });
  });

  await runCase(checks, "h3.t05", async () => {
    await withApp("H3-t05", {}, async ({ page }) => {
      await setSettings(page, { t: 0.5 });
      await typeNumber(page, "9.5");
      await sleep(autoWaitMs(0.5));
      const snap = await appSnapshot(page);
      eqCheck(checks, "h3.t05.input", snap.input, "");
      addCheck(checks, "h3.t05.expression", snap.expression.includes("9.5"), snap.expression, "contains 9.5");
      eqCheck(checks, "h3.t05.state", snap.state, "input");
      eqCheck(checks, "h3.t05.history", snap.history, 0);
      eqCheck(checks, "h3.t05.result", snap.resultValue, null);
      addCheck(checks, "h3.t05.label", snap.stateLabel.includes("9.5"), snap.stateLabel, "contains 9.5");
    });
  });

  await runCase(checks, "h3.timerReset", async () => {
    await withApp("H3-timer-reset", {}, async ({ page }) => {
      await setSettings(page, { t: 1 });
      await clickKey(page, "9");
      await sleep(600);
      await clickKey(page, "5");
      await sleep(autoWaitMs(1));
      const snap = await appSnapshot(page);
      eqCheck(checks, "h3.timerReset.input", snap.input, "");
      eqCheck(checks, "h3.timerReset.expression", snap.expression, "95");
      eqCheck(checks, "h3.timerReset.state", snap.state, "input");
      eqCheck(checks, "h3.timerReset.history", snap.history, 0);
      addCheck(checks, "h3.timerReset.label", snap.stateLabel.includes("95"), snap.stateLabel, "contains 95");
    });
  });

  await runCase(checks, "h3.trailingDot", async () => {
    await withApp("H3-trailing-dot", {}, async ({ page }) => {
      await setSettings(page, { t: 0.5 });
      await typeNumber(page, "9.");
      await sleep(autoWaitMs(0.5));
      const before = await appSnapshot(page);
      eqCheck(checks, "h3.trailingDot.held", before.input, "9.");
      eqCheck(checks, "h3.trailingDot.expression", before.expression, "");
      await clickKey(page, "5");
      await sleep(autoWaitMs(0.5));
      const after = await appSnapshot(page);
      eqCheck(checks, "h3.trailingDot.completedInput", after.input, "");
      addCheck(checks, "h3.trailingDot.completedExpression", after.expression.includes("9.5"), after.expression, "contains 9.5");
      addCheck(checks, "h3.trailingDot.label", after.stateLabel.includes("9.5"), after.stateLabel, "contains 9.5");
    });
  });

  await runCase(checks, "h3.panelPause", async () => {
    await withApp("H3-panel-pause", {}, async ({ page }) => {
      await setSettings(page, { t: 1 });
      await typeNumber(page, "9.5");
      await openSettings(page);
      await sleep(autoWaitMs(1));
      const paused = await appSnapshot(page);
      eqCheck(checks, "h3.panelPause.whileOpenInput", paused.input, "9.5");
      eqCheck(checks, "h3.panelPause.whileOpenExpression", paused.expression, "");
      await closeSettingsWithDone(page);
      await sleep(autoWaitMs(1));
      const resumed = await appSnapshot(page);
      eqCheck(checks, "h3.panelPause.afterCloseInput", resumed.input, "");
      addCheck(checks, "h3.panelPause.afterCloseExpression", resumed.expression.includes("9.5"), resumed.expression, "contains 9.5");
    });
  });

  await runCase(checks, "h3.manualEnter", async () => {
    await withApp("H3-manual-enter", {}, async ({ page }) => {
      await setSettings(page, { t: 1 });
      await typeNumber(page, "9.5");
      await clickKey(page, "enter");
      await sleep(autoWaitMs(1));
      const snap = await appSnapshot(page);
      eqCheck(checks, "h3.manualEnter.expression", snap.expression, "9.5");
      eqCheck(checks, "h3.manualEnter.history", snap.history, 0);
      eqCheck(checks, "h3.manualEnter.input", snap.input, "");
    });
  });

  await runCase(checks, "h3.equals", async () => {
    await withApp("H3-equals", {}, async ({ page }) => {
      await setSettings(page, { t: 1 });
      await clickOperator(page, "+");
      await enterNumber(page, "9.5");
      await typeNumber(page, "9.2");
      await clickEquals(page);
      await sleep(1500);
      const snap = await appSnapshot(page);
      nearCheck(checks, "h3.equals.result", snap.resultValue, 18.7);
      eqCheck(checks, "h3.equals.history", snap.history, 1);
      eqCheck(checks, "h3.equals.input", snap.input, "");
    });
  });

  await runCase(checks, "h3.reset", async () => {
    await withApp("H3-reset", {}, async ({ page }) => {
      await setSettings(page, { t: 1 });
      await clickKey(page, "9");
      await page.locator(S.keyOp).click();
      await sleep(autoWaitMs(1));
      const snap = await appSnapshot(page);
      eqCheck(checks, "h3.reset.state", snap.state, "select");
      eqCheck(checks, "h3.reset.expression", snap.expression, "");
      eqCheck(checks, "h3.reset.input", snap.input, "");
    });
  });

  await runCase(checks, "h3.operatorChange", async () => {
    await withApp("H3-operator-change", {}, async ({ page }) => {
      await setSettings(page, { t: 1 });
      await clickKey(page, "9");
      await sleep(600);
      await clickOperator(page, "+");
      await sleep(autoWaitMs(1));
      const snap = await appSnapshot(page);
      eqCheck(checks, "h3.operatorChange.input", snap.input, "");
      const committedExpression = snap.expression.replace(/\s*[+\-*/]\s*$/, "").trim();
      eqCheck(checks, "h3.operatorChange.expression", committedExpression, "9");
      eqCheck(checks, "h3.operatorChange.state", snap.state, "input");
      addCheck(checks, "h3.operatorChange.label", snap.stateLabel.includes("9"), snap.stateLabel, "contains 9");
    });
  });

  await runCase(checks, "h3.progress", async () => {
    await withApp("H3-progress", {}, async ({ page }) => {
      await setSettings(page, { t: 1 });
      await clickKey(page, "9");
      const progressRect = await rectOf(page, T.progress);
      const before = {
        visible: await isVisible(page, T.progress),
        active: await page.locator(T.progress).getAttribute("data-active"),
        height: progressRect ? progressRect.height : null,
      };
      eqCheck(checks, "h3.progress.visible", before.visible, true);
      eqCheck(checks, "h3.progress.active", before.active, "true");
      addCheck(checks, "h3.progress.height", before.height >= 1 && before.height <= 4, before.height, "1..4px");
      await sleep(autoWaitMs(1));
      const after = {
        active: await page.locator(T.progress).getAttribute("data-active"),
        visible: await isVisible(page, T.progress),
      };
      eqCheck(checks, "h3.progress.afterActive", after.active, "false");
      eqCheck(checks, "h3.progress.afterVisible", after.visible, false);
    });
  });

  await runCase(checks, "h3.reducedMotion", async () => {
    await withCustom(
      "H3-reduced-motion",
      { reducedMotion: "reduce" },
      async ({ page }) => {
        await setSettings(page, { t: 0.5 });
        await typeNumber(page, "9.5");
        await sleep(autoWaitMs(0.5));
        const snap = await appSnapshot(page);
        eqCheck(checks, "h3.reducedMotion.input", snap.input, "");
        addCheck(checks, "h3.reducedMotion.expression", snap.expression.includes("9.5"), snap.expression, "contains 9.5");
        addCheck(checks, "h3.reducedMotion.label", snap.stateLabel.includes("9.5"), snap.stateLabel, "contains 9.5");
      },
    );
  });
}

async function h4(checks) {
  await runCase(checks, "h4.baseOff", async () => {
    await withApp("H4-base-off", {}, async ({ page }) => {
      await clickOperator(page, "+");
      for (const value of ["9.5", "9.2", "9.0"]) await enterNumber(page, value);
      await clickEquals(page);
      const snap = await appSnapshot(page);
      const history = await historyDetails(page);
      nearCheck(checks, "h4.baseOff.result", snap.resultValue, 27.7);
      eqCheck(checks, "h4.baseOff.historyCount", history.length, 1);
      eqCheck(checks, "h4.baseOff.historyBase", history[0] && history[0].base, null);
      eqCheck(checks, "h4.baseOff.operands", history[0] && history[0].operands, ["9.5", "9.2", "9.0"]);
      addCheck(checks, "h4.baseOff.expression", history[0] && history[0].expression.includes("9.5"), history[0] && history[0].expression, "contains operands");
    });
  });

  await runCase(checks, "h4.base10", async () => {
    await withApp("H4-base-10", {}, async ({ page }) => {
      await setSettings(page, { baseEnabled: true, baseValue: "10" });
      await clickOperator(page, "+");
      const markerVisible = await isVisible(page, T.baseMarker);
      const markerText = (await page.locator(T.baseMarker).textContent() || "").trim();
      eqCheck(checks, "h4.base10.markerVisible", markerVisible, true);
      addCheck(checks, "h4.base10.markerText", markerText.includes("10"), markerText, "contains 10");
      for (const value of ["9.5", "9.2", "9.0"]) await enterNumber(page, value);
      await clickEquals(page);
      const snap = await appSnapshot(page);
      const history = await historyDetails(page);
      nearCheck(checks, "h4.base10.result", snap.resultValue, 37.7);
      eqCheck(checks, "h4.base10.historyBase", history[0] && history[0].base, "10");
      eqCheck(checks, "h4.base10.operands", history[0] && history[0].operands, ["9.5", "9.2", "9.0"]);
      addCheck(checks, "h4.base10.expression", history[0] && history[0].expression.includes("10"), history[0] && history[0].expression, "contains 10");
    });
  });

  await runCase(checks, "h4.base100", async () => {
    await withApp("H4-base-100", {}, async ({ page }) => {
      await setSettings(page, { baseEnabled: true, baseValue: "100" });
      await clickOperator(page, "/");
      await enterNumber(page, "4");
      await clickEquals(page);
      nearCheck(checks, "h4.base100.result", (await appSnapshot(page)).resultValue, 25);
    });
  });

  await runCase(checks, "h4.base0", async () => {
    await withApp("H4-base-0", {}, async ({ page }) => {
      await setSettings(page, { baseEnabled: true, baseValue: "0" });
      await clickOperator(page, "*");
      await enterNumber(page, "5");
      await clickEquals(page);
      const snap = await appSnapshot(page);
      const history = await historyDetails(page);
      nearCheck(checks, "h4.base0.result", snap.resultValue, 0);
      eqCheck(checks, "h4.base0.historyBase", history[0] && history[0].base, "0");
    });
  });

  await runCase(checks, "h4.baseNegative", async () => {
    await withApp("H4-base-negative", {}, async ({ page }) => {
      await setSettings(page, { baseEnabled: true, baseValue: "-2.5" });
      await clickOperator(page, "+");
      await enterNumber(page, "1");
      await clickEquals(page);
      nearCheck(checks, "h4.baseNegative.result", (await appSnapshot(page)).resultValue, -1.5);
    });
  });

  await runCase(checks, "h4.unselectedOperator", async () => {
    await withApp("H4-no-operator", {}, async ({ page }) => {
      await setSettings(page, { baseEnabled: true, baseValue: "10" });
      await enterNumber(page, "9.5");
      const before = await appSnapshot(page);
      addCheck(checks, "h4.unselectedOperator.expression", !before.expression.includes("10"), before.expression, "does not contain 10");
      await clickOperator(page, "+");
      const after = await appSnapshot(page);
      addCheck(checks, "h4.unselectedOperator.afterOpExpression", after.expression.includes("10"), after.expression, "contains 10");
      addCheck(checks, "h4.unselectedOperator.afterOpLabel", after.stateLabel.includes("10"), after.stateLabel, "contains 10");
    });
  });

  await runCase(checks, "h4.liveRedraw", async () => {
    await withApp("H4-live-redraw", {}, async ({ page }) => {
      await setSettings(page, { baseEnabled: true, baseValue: "10" });
      await clickOperator(page, "+");
      await enterNumber(page, "9.5");
      await openSettings(page);
      await page.locator(T.baseValue).fill("20");
      const expression = (await page.locator(S.expression).textContent() || "").trim();
      addCheck(checks, "h4.liveRedraw.contains20", expression.includes("20"), expression, "contains 20");
      addCheck(checks, "h4.liveRedraw.omits10", !expression.includes("10"), expression, "does not contain 10");
      await closeSettingsWithDone(page);
    });
  });

  await runCase(checks, "h4.invalidBase", async () => {
    await withApp("H4-invalid-base", {}, async ({ page }) => {
      await setSettings(page, { baseEnabled: true, baseValue: "10" });
      await clickOperator(page, "+");
      await typeNumber(page, "9.5");
      await openSettings(page);
      await page.locator(T.baseValue).fill("");
      const during = await page.locator(T.baseValue).inputValue();
      await closeSettingsWithDone(page);
      const restored = await page.locator(T.baseValue).inputValue();
      await clickEquals(page);
      const snap = await appSnapshot(page);
      eqCheck(checks, "h4.invalidBase.emptyShown", during, "");
      eqCheck(checks, "h4.invalidBase.restored", restored, "10");
      addCheck(checks, "h4.invalidBase.baseFinite", Number.isFinite(Number(restored)), restored, "finite");
      nearCheck(checks, "h4.invalidBase.result", snap.resultValue, 19.5);
      addCheck(checks, "h4.invalidBase.resultFinite", Number.isFinite(Number(snap.resultValue)), snap.resultValue, "finite");
    });
  });

  await runCase(checks, "h4.divZero", async () => {
    await withApp("H4-div-zero", {}, async ({ page }) => {
      await setSettings(page, { baseEnabled: true, baseValue: "10" });
      await clickOperator(page, "/");
      await enterNumber(page, "5");
      await enterNumber(page, "0");
      await clickEquals(page);
      const snap = await appSnapshot(page);
      eqCheck(checks, "h4.divZero.error", snap.resultError, "true");
      eqCheck(checks, "h4.divZero.history", snap.history, 0);
    });
  });

  await runCase(checks, "h4.snapshotEdit", async () => {
    await withApp("H4-snapshot-edit", {}, async ({ page }) => {
      await setSettings(page, { baseEnabled: true, baseValue: "10" });
      await clickOperator(page, "+");
      await enterNumber(page, "2");
      await enterNumber(page, "3");
      await clickEquals(page);
      nearCheck(checks, "h4.snapshot.firstResult", (await appSnapshot(page)).resultValue, 15);

      await setSettings(page, { baseValue: "20" });
      await clickOperator(page, "+");
      await enterNumber(page, "2");
      await enterNumber(page, "3");
      await clickEquals(page);
      const beforeEdit = await historyDetails(page);
      eqCheck(checks, "h4.snapshot.historyCount", beforeEdit.length, 2);
      eqCheck(checks, "h4.snapshot.bases", beforeEdit.map((item) => item.base), ["20", "10"]);
      eqCheck(checks, "h4.snapshot.results", beforeEdit.map((item) => item.result), ["25", "15"]);

      await page.locator(T.historyEdit).nth(1).click();
      const editMarkerVisible = await isVisible(page, T.editBaseMarker);
      const editMarker = (await page.locator(T.editBaseMarker).textContent() || "").trim();
      eqCheck(checks, "h4.snapshot.editMarkerVisible", editMarkerVisible, true);
      addCheck(checks, "h4.snapshot.editMarkerText", editMarker.includes("10"), editMarker, "contains 10");
      eqCheck(checks, "h4.snapshot.operandCount", await page.locator(T.operandInput).count(), 2);

      await page.locator(T.operandInput).nth(1).fill("5");
      await clickEquals(page);
      const afterEdit = await historyDetails(page);
      const top = afterEdit[0];
      eqCheck(checks, "h4.snapshot.editedBase", top && top.base, "10");
      nearCheck(checks, "h4.snapshot.editedResult", top && top.result, 17);
      addCheck(checks, "h4.snapshot.editedExpression", top && top.expression.includes("10"), top && top.expression, "contains 10");
      eqCheck(checks, "h4.snapshot.baseMarkerVisible", await isVisible(page, T.baseMarker), true);
      const baseMarkerText = (await page.locator(T.baseMarker).textContent() || "").trim();
      addCheck(checks, "h4.snapshot.baseMarkerText", baseMarkerText.includes("20"), baseMarkerText, "contains current base 20");
    });
  });
}

async function h5(checks) {
  await runCase(checks, "h5.withdraw", async () => {
    await withApp("H5-withdraw", {}, async ({ page }) => {
      await clickOperator(page, "+");
      await enterNumber(page, "9.5");
      await enterNumber(page, "9.2");
      await page.locator(`${S.keypad} [data-key="backspace"]`).click();
      const first = await appSnapshot(page);
      addCheck(checks, "h5.withdraw.firstLabel", first.stateLabel.includes("9.2"), first.stateLabel, "contains 9.2");
      addCheck(checks, "h5.withdraw.firstExpression", !first.expression.includes("9.2"), first.expression, "omits 9.2");
      eqCheck(checks, "h5.withdraw.state", first.state, "input");
      eqCheck(checks, "h5.withdraw.history", first.history, 0);
      await page.locator(`${S.keypad} [data-key="backspace"]`).click();
      const second = await appSnapshot(page);
      addCheck(checks, "h5.withdraw.secondLabel", second.stateLabel.includes("9.5"), second.stateLabel, "contains 9.5");
      eqCheck(checks, "h5.withdraw.secondExpression", second.expression, "");
    });
  });

  await runCase(checks, "h5.nonEmptyInput", async () => {
    await withApp("H5-non-empty-input", {}, async ({ page }) => {
      await clickOperator(page, "+");
      await enterNumber(page, "9.5");
      await typeNumber(page, "95");
      const beforeExpression = (await page.locator(S.expression).textContent() || "").trim();
      await page.locator(`${S.keypad} [data-key="backspace"]`).click();
      const after = await appSnapshot(page);
      eqCheck(checks, "h5.nonEmptyInput.value", after.input, "9");
      eqCheck(checks, "h5.nonEmptyInput.expression", after.expression, beforeExpression);
    });
  });

  await runCase(checks, "h5.baseWithdraw", async () => {
    await withApp("H5-base-withdraw", {}, async ({ page }) => {
      await setSettings(page, { baseEnabled: true, baseValue: "10" });
      await clickOperator(page, "+");
      await enterNumber(page, "9.5");
      await enterNumber(page, "9.2");
      await page.locator(`${S.keypad} [data-key="backspace"]`).click();
      await page.locator(`${S.keypad} [data-key="backspace"]`).click();
      const withdrawn = await appSnapshot(page);
      addCheck(checks, "h5.baseWithdraw.keepsBase", withdrawn.expression.includes("10"), withdrawn.expression, "contains 10");
      addCheck(
        checks,
        "h5.baseWithdraw.omitsOperands",
        !withdrawn.expression.includes("9.5") && !withdrawn.expression.includes("9.2"),
        withdrawn.expression,
        "omits 9.5 and 9.2",
      );
      eqCheck(checks, "h5.baseWithdraw.state", withdrawn.state, "input");
      eqCheck(checks, "h5.baseWithdraw.history", withdrawn.history, 0);
      await enterNumber(page, "1");
      await enterNumber(page, "1");
      await clickEquals(page);
      nearCheck(checks, "h5.baseWithdraw.continuedResult", (await appSnapshot(page)).resultValue, 12);
    });
  });

  await runCase(checks, "h5.resultState", async () => {
    await withApp("H5-result-state", {}, async ({ page }) => {
      await clickOperator(page, "+");
      await enterNumber(page, "1");
      await enterNumber(page, "2");
      await clickEquals(page);
      await page.locator(`${S.keypad} [data-key="backspace"]`).click();
      const snap = await appSnapshot(page);
      eqCheck(checks, "h5.resultState.state", snap.state, "result");
      nearCheck(checks, "h5.resultState.result", snap.resultValue, 3);
      eqCheck(checks, "h5.resultState.history", snap.history, 1);
    });
  });

  await runCase(checks, "h5.errorState", async () => {
    await withApp("H5-error-state", {}, async ({ page }) => {
      await clickOperator(page, "/");
      await enterNumber(page, "5");
      await enterNumber(page, "0");
      await clickEquals(page);
      const before = await appSnapshot(page);
      eqCheck(checks, "h5.errorState.before", before.state, "error");
      await page.locator(`${S.keypad} [data-key="backspace"]`).click();
      const after = await appSnapshot(page);
      eqCheck(checks, "h5.errorState.state", after.state, "error");
      eqCheck(checks, "h5.errorState.error", after.resultError, "true");
      eqCheck(checks, "h5.errorState.history", after.history, 0);
    });
  });

  await runCase(checks, "h5.editWithdraw", async () => {
    await withApp("H5-edit-withdraw", {}, async ({ page }) => {
      await setSettings(page, { baseEnabled: true, baseValue: "10" });
      await clickOperator(page, "+");
      await enterNumber(page, "2");
      await enterNumber(page, "3");
      await clickEquals(page);
      await page.locator(T.historyEdit).first().click();
      eqCheck(checks, "h5.editWithdraw.initialChips", await page.locator(T.operandChip).count(), 2);
      await page.locator(S.calcInput).focus();
      eqCheck(
        checks,
        "h5.editWithdraw.mainFocused",
        await page.evaluate((selector) => document.activeElement === document.querySelector(selector), S.calcInput),
        true,
      );
      await page.keyboard.press("Backspace");
      eqCheck(checks, "h5.editWithdraw.chipsAfterMain", await page.locator(T.operandChip).count(), 1);
      await page.locator(T.operandInput).first().click();
      await page.keyboard.press("Backspace");
      const chipCount = await page.locator(T.operandChip).count();
      const inputValue = await page.locator(T.operandInput).first().inputValue();
      eqCheck(checks, "h5.editWithdraw.chipsAfterOperand", chipCount, 1);
      eqCheck(checks, "h5.editWithdraw.operandInputValue", inputValue, "");
    });
  });

  await runCase(checks, "h5.coldEmpty", async () => {
    await withApp("H5-cold-empty", {}, async ({ page }) => {
      await page.locator(`${S.keypad} [data-key="backspace"]`).click();
      const snap = await appSnapshot(page);
      eqCheck(checks, "h5.coldEmpty.state", snap.state, "select");
      eqCheck(checks, "h5.coldEmpty.expression", snap.expression, "");
      eqCheck(checks, "h5.coldEmpty.input", snap.input, "");
      eqCheck(checks, "h5.coldEmpty.history", snap.history, 0);
    });
  });
}

async function h6(checks) {
  const started = Date.now();
  const suitePath = path.join(TESTS_DIR, "suite.mjs");
  const suite = await import(pathToFileURL(suitePath).href);
  const results = await suite.runSuite({ artifact: ARTIFACT });
  eqCheck(checks, "h6.resultCount", results.length, 18);
  const failed = results.filter((result) => !result.pass);
  addCheck(checks, "h6.allPass", failed.length === 0, failed.map((result) => result.id), []);
  const cold = results.find((result) => result.id === "cold-start");
  const ids = cold ? cold.checks.map((item) => item.id) : [];
  addCheck(checks, "h6.coldStart.keysEnabled", ids.includes("cold-start.keys-enabled"), ids, "contains cold-start.keys-enabled");
  addCheck(
    checks,
    "h6.coldStart.keysDisabledAbsent",
    !ids.includes("cold-start.keys-disabled"),
    ids,
    "omits cold-start.keys-disabled",
  );
  addCheck(checks, "h6.elapsedMs", true, Date.now() - started);
}

async function measureLayout(page, label) {
  return page.evaluate(
    ({ selectors, label }) => {
      const visible = (element) => {
        if (!element) return false;
        const style = getComputedStyle(element);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) !== 0 &&
          element.getClientRects().length > 0
        );
      };
      const rect = (element) => {
        if (!visible(element)) return null;
        const box = element.getBoundingClientRect();
        return {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
        };
      };
      const controls = [];
      for (const element of document.querySelectorAll("input, button, select")) {
        const target = element.type === "checkbox" ? element.closest("label") || element : element;
        if (!visible(target)) continue;
        const box = target.getBoundingClientRect();
        controls.push({
          tag: element.tagName,
          testid: element.getAttribute("data-testid"),
          key: element.getAttribute("data-key"),
          op: element.getAttribute("data-op"),
          type: element.getAttribute("type"),
          width: box.width,
          height: box.height,
          fontSize: parseFloat(getComputedStyle(target).fontSize),
        });
      }
      const panel = document.querySelector(selectors.panel);
      const gear = document.querySelector(selectors.toggle);
      const progress = document.querySelector(selectors.progress);
      const baseMarker = document.querySelector(selectors.baseMarker);
      const editBaseMarker = document.querySelector(selectors.editBaseMarker);
      const editDraft = document.querySelector(selectors.editDraft);
      return {
        label,
        state: document.querySelector("main.app[data-state]").getAttribute("data-state"),
        viewportWidth: document.documentElement.clientWidth,
        viewportHeight: document.documentElement.clientHeight,
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
        controls,
        gearVisible: visible(gear),
        gearRect: rect(gear),
        panelOpen: Boolean(panel && panel.open),
        panelVisible: visible(panel),
        panelRect: rect(panel),
        progressVisible: visible(progress),
        progressActive: progress ? progress.getAttribute("data-active") : null,
        progressRect: rect(progress),
        baseMarkerVisible: visible(baseMarker),
        baseMarkerRect: rect(baseMarker),
        editBaseMarkerVisible: visible(editBaseMarker),
        editDraftVisible: visible(editDraft),
        historyCount: document.querySelectorAll(selectors.historyItem).length,
      };
    },
    { selectors: T, label },
  );
}

async function setupLayoutState(page, state) {
  if (state === "cold") return;
  if (state === "panel") {
    await openSettings(page);
    return;
  }
  if (state === "progress") {
    await setSettings(page, { t: 10, baseEnabled: true, baseValue: "10" });
    await clickOperator(page, "+");
    await enterNumber(page, "9.5");
    await typeNumber(page, "9.2");
    return;
  }
  if (state === "base-marker") {
    await setSettings(page, { baseEnabled: true, baseValue: "10" });
    await clickOperator(page, "+");
    return;
  }
  if (state === "edit-draft") {
    await setSettings(page, { baseEnabled: true, baseValue: "10" });
    await clickOperator(page, "+");
    await enterNumber(page, "2");
    await enterNumber(page, "3");
    await clickEquals(page);
    await page.locator(T.historyEdit).first().click();
    return;
  }
  if (state === "two-history") {
    await setSettings(page, { baseEnabled: true, baseValue: "10" });
    await clickOperator(page, "+");
    await enterNumber(page, "9.5");
    await enterNumber(page, "9.2");
    await clickEquals(page);
    await clickOperator(page, "+");
    await enterNumber(page, "9.0");
    await clickEquals(page);
    return;
  }
  throw new Error(`unknown layout state: ${state}`);
}

function controlName(control) {
  return control.testid || control.key || control.op || control.type || control.tag;
}

function assertLayout(checks, prefix, metrics, viewport) {
  addCheck(checks, `${prefix}.docOverflow`, metrics.docOverflow <= 1, metrics.docOverflow, "<=1");
  addCheck(checks, `${prefix}.bodyOverflow`, metrics.bodyOverflow <= 1, metrics.bodyOverflow, "<=1");
  const small = metrics.controls.filter(
    (control) => control.width < MIN_CONTROL - 1e-9 || control.height < MIN_CONTROL - 1e-9,
  );
  addCheck(
    checks,
    `${prefix}.controls`,
    small.length === 0,
    small.length === 0
      ? { count: metrics.controls.length, minWidth: Math.min(...metrics.controls.map((item) => item.width)), minHeight: Math.min(...metrics.controls.map((item) => item.height)) }
      : small.map((control) => `${controlName(control)}:${control.width.toFixed(1)}x${control.height.toFixed(1)}`),
    `all >=${MIN_CONTROL}x${MIN_CONTROL}`,
  );
  const badFont = metrics.controls.filter(
    (control) => (control.tag === "INPUT" || control.tag === "SELECT") && control.fontSize < MIN_FONT - 1e-9,
  );
  addCheck(
    checks,
    `${prefix}.fonts`,
    badFont.length === 0,
    badFont.length === 0
      ? { count: metrics.controls.filter((control) => control.tag === "INPUT" || control.tag === "SELECT").length, min: Math.min(...metrics.controls.filter((control) => control.tag === "INPUT" || control.tag === "SELECT").map((control) => control.fontSize)) }
      : badFont.map((control) => `${controlName(control)}:${control.fontSize}px`),
    `input/select >=${MIN_FONT}px`,
  );
  if (metrics.panelOpen) {
    const panel = metrics.panelRect;
    const gear = metrics.gearRect;
    const expectedWidth = Math.min(320, viewport.width - 16);
    addCheck(checks, `${prefix}.panel.present`, Boolean(panel && gear), { panel, gear }, "panel and gear rects");
    if (panel && gear) {
      addCheck(checks, `${prefix}.panel.width`, panel.width <= expectedWidth + 1, panel.width, `<=${expectedWidth + 1}`);
      addCheck(
        checks,
        `${prefix}.panel.inside`,
        panel.left >= -LAYOUT_TOL && panel.right <= viewport.width + LAYOUT_TOL,
        { left: panel.left, right: panel.right, viewport: viewport.width },
        "inside viewport",
      );
      addCheck(checks, `${prefix}.panel.belowGear`, panel.top >= gear.bottom - 2, { panelTop: panel.top, gearBottom: gear.bottom }, "panel top >= gear bottom-2");
      addCheck(
        checks,
        `${prefix}.panel.rightAlign`,
        Math.abs(panel.right - gear.right) <= 16,
        Math.abs(panel.right - gear.right),
        "<=16",
      );
    }
  }
}

async function h7(checks) {
  const viewports = [
    { width: 320, height: 568, cdp: true },
    { width: 390, height: 844, cdp: false },
  ];
  const states = ["cold", "panel", "progress", "base-marker", "edit-draft", "two-history"];
  for (const viewport of viewports) {
    for (const state of states) {
      const tag = `H7-${viewport.width}x${viewport.height}-${state}`;
      await runCase(checks, `h7.${viewport.width}x${viewport.height}.${state}`, async () => {
        const callback = async ({ page }) => {
          await setupLayoutState(page, state);
          await stableLayout(page);
          const metrics = await measureLayout(page, `${viewport.width}x${viewport.height}:${state}`);
          assertLayout(checks, `h7.${viewport.width}x${viewport.height}.${state}`, metrics, viewport);
          if (state === "progress") {
            eqCheck(checks, `h7.${viewport.width}x${viewport.height}.progress.active`, metrics.progressActive, "true");
          }
          if (state === "base-marker") {
            eqCheck(checks, `h7.${viewport.width}x${viewport.height}.baseMarker.visible`, metrics.baseMarkerVisible, true);
          }
          if (state === "edit-draft") {
            eqCheck(checks, `h7.${viewport.width}x${viewport.height}.editDraft.visible`, metrics.editDraftVisible, true);
            eqCheck(
              checks,
              `h7.${viewport.width}x${viewport.height}.editMarker.visible`,
              metrics.editBaseMarkerVisible,
              true,
            );
          }
          if (state === "two-history") {
            eqCheck(checks, `h7.${viewport.width}x${viewport.height}.history.count`, metrics.historyCount, 2);
          }
        };
        if (viewport.cdp) {
          await withCustom(
            tag,
            {
              viewport: { width: viewport.width, height: viewport.height },
              cdp: {
                width: 320,
                height: 568,
                deviceScaleFactor: 2,
                mobile: true,
              },
            },
            callback,
          );
        } else {
          await withApp(tag, { viewport: { width: viewport.width, height: viewport.height } }, callback);
        }
      });
    }
  }
}

async function h9(checks) {
  const sequences = [];
  for (const index of [1, 2]) {
    await runCase(checks, `h9.run${index}`, async () => {
      await withApp(`H9-run-${index}`, {}, async ({ page }) => {
        await setSettings(page, { t: 0, baseEnabled: true, baseValue: "10" });
        await clickOperator(page, "+");
        for (const value of ["9.5", "9.2", "9.0"]) await enterNumber(page, value);
        await clickEquals(page);
        sequences.push(await historyDetails(page));
      });
    });
  }
  eqCheck(checks, "h9.sequenceCount", sequences.length, 2);
  eqCheck(checks, "h9.records", sequences[0] ? sequences[0].length : null, 1);
  eqCheck(checks, "h9.deepEqual", sequences[0], sequences[1]);
  addCheck(
    checks,
    "h9.fields",
    Boolean(
      sequences[0] &&
        sequences[0][0] &&
        ["operator", "operands", "base", "result", "expression"].every((key) =>
          Object.prototype.hasOwnProperty.call(sequences[0][0], key),
        ),
    ),
    sequences[0],
    "operator/operands/base/result/expression",
  );
}

function externalReferenceUrls(html) {
  const urls = [];
  const attribute = /<(?:script|link|img)\b[^>]*\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  for (const match of html.matchAll(attribute)) urls.push(match[1] ?? match[2] ?? match[3] ?? "");
  const imports = /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^'")\s;]+))/gi;
  for (const match of html.matchAll(imports)) urls.push(match[1] ?? match[2] ?? match[3] ?? "");
  const cssUrls = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')]+))\s*\)/gi;
  for (const match of html.matchAll(cssUrls)) urls.push(match[1] ?? match[2] ?? match[3] ?? "");
  return urls.map((url) => url.trim()).filter((url) => /^(?:https?:)?\/\//i.test(url));
}

async function h8(checks) {
  const html = fs.readFileSync(ARTIFACT, "utf8");
  const refs = externalReferenceUrls(html);
  eqCheck(checks, "h8.htmlClose", /<\/html>\s*$/i.test(html), true);
  addCheck(checks, "h8.bytes", Buffer.byteLength(html) >= 1024, Buffer.byteLength(html), ">=1024");
  eqCheck(checks, "h8.externalRefs", refs, []);
  eqCheck(checks, "h8.pageErrors", observedPageErrors.length, 0);
  eqCheck(checks, "h8.consoleErrors", observedConsoleErrors.length, 0);
  if (REVIEW_STATES.length) {
    addCheck(
      checks,
      "h8.reviewArtifacts",
      reviewOutcome.pass,
      reviewOutcome.checks.filter((check) => !check.pass),
      [],
    );
  }
}

function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) {
    throw new Error("not a PNG");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported PNG color type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let rawOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset++];
    const row = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? pixels[row + x - channels] : 0;
      const up = y > 0 ? pixels[row - stride + x] : 0;
      const upLeft = x >= channels && y > 0 ? pixels[row - stride + x - channels] : 0;
      const value = raw[rawOffset++];
      let decoded;
      if (filter === 0) decoded = value;
      else if (filter === 1) decoded = value + left;
      else if (filter === 2) decoded = value + up;
      else if (filter === 3) decoded = value + Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        decoded = value + predictor;
      } else {
        throw new Error(`unsupported PNG filter ${filter}`);
      }
      pixels[row + x] = decoded & 0xff;
    }
  }
  const colors = new Set();
  let nonTransparent = 0;
  for (let index = 0; index < pixels.length; index += channels) {
    const color = pixels.subarray(index, index + channels).toString("hex");
    colors.add(color);
    if (channels < 4 || pixels[index + 3] !== 0) nonTransparent += 1;
  }
  return { width, height, uniqueColors: colors.size, nonTransparent, bytes: buffer.length };
}

function rectText(rect) {
  if (!rect) return "none";
  return `${rect.x.toFixed(1)},${rect.y.toFixed(1)},${rect.width.toFixed(1)},${rect.height.toFixed(1)}`;
}

async function captureRenderMetrics(page, state) {
  const metrics = await measureLayout(page, state);
  const settings = await page.evaluate(
    ({ autoSelector, baseToggleSelector, baseValueSelector }) => ({
      t: document.querySelector(autoSelector).value,
      baseEnabled: document.querySelector(baseToggleSelector).checked,
      baseValue: document.querySelector(baseValueSelector).value,
    }),
    { autoSelector: T.autoConfirm, baseToggleSelector: T.baseToggle, baseValueSelector: T.baseValue },
  );
  const dataMinWidth = Math.min(...metrics.controls.map((control) => control.width));
  const dataMinHeight = Math.min(...metrics.controls.map((control) => control.height));
  const dataFonts = metrics.controls
    .filter((control) => control.tag === "INPUT" || control.tag === "SELECT")
    .map((control) => control.fontSize);
  return {
    ...metrics,
    settings,
    minControlWidth: Number.isFinite(dataMinWidth) ? dataMinWidth : null,
    minControlHeight: Number.isFinite(dataMinHeight) ? dataMinHeight : null,
    minInputFont: dataFonts.length ? Math.min(...dataFonts) : null,
  };
}

async function runReviewShots() {
  if (!REVIEW_STATES.length) return;
  const shotDir = path.join(OUT_DIR, "review-shots", `r${ROUND}`);
  fs.mkdirSync(shotDir, { recursive: true });
  const records = [];
  const expected = new Set(REVIEW_STATES.map((state) => `${state}.png`));
  const renderMetrics = {};

  for (const state of REVIEW_STATES) {
    await runCase(reviewOutcome.checks, `render.${state}`, async () => {
      const isNarrow = state === "S4";
      const tag = `render-${state}`;
      const callback = async ({ page }) => {
        if (state === "S1") {
          await stableLayout(page);
        } else if (state === "S2") {
          await openSettings(page);
          await stableLayout(page);
        } else if (state === "S3") {
          await setSettings(page, { t: 10, baseEnabled: true, baseValue: "10" });
          await clickOperator(page, "+");
          await enterNumber(page, "9.5");
          const started = Date.now();
          await typeNumber(page, "9.2");
          await stableLayout(page);
          const before = await page.locator(T.progress).getAttribute("data-active");
          const shotBuffer = await page.screenshot({ scale: "css" });
          const elapsed = Date.now() - started;
          const after = await page.locator(T.progress).getAttribute("data-active");
          const file = path.join(shotDir, `${state}.png`);
          fs.writeFileSync(file, shotBuffer);
          const png = decodePng(shotBuffer);
          const metrics = await captureRenderMetrics(page, state);
          const record = {
            state,
            file,
            filename: `${state}.png`,
            sha256: sha256(shotBuffer),
            width: png.width,
            height: png.height,
            bytes: shotBuffer.length,
            uniqueColors: png.uniqueColors,
            nonTransparent: png.nonTransparent,
            captureMs: elapsed,
          };
          records.push(record);
          renderMetrics[state] = { ...metrics, beforeActive: before, afterActive: after, record };
          reviewCheck(`render.${state}.activeBefore`, before === "true", before, "true");
          reviewCheck(`render.${state}.activeAfter`, after === "true", after, "true");
          reviewCheck(`render.${state}.underOneSecond`, elapsed < 1000, elapsed, "<1000ms");
          return;
        } else if (state === "S4") {
          await setSettings(page, { baseEnabled: true, baseValue: "10" });
          await openSettings(page);
          await stableLayout(page);
        } else {
          throw new Error(`unsupported review state ${state}`);
        }

        const shotBuffer = await page.screenshot({ scale: "css" });
        const file = path.join(shotDir, `${state}.png`);
        fs.writeFileSync(file, shotBuffer);
        const png = decodePng(shotBuffer);
        const metrics = await captureRenderMetrics(page, state);
        const record = {
          state,
          file,
          filename: `${state}.png`,
          sha256: sha256(shotBuffer),
          width: png.width,
          height: png.height,
          bytes: shotBuffer.length,
          uniqueColors: png.uniqueColors,
          nonTransparent: png.nonTransparent,
          captureMs: null,
        };
        records.push(record);
        renderMetrics[state] = { ...metrics, record };
      };

      if (isNarrow) {
        await withCustom(
          tag,
          {
            viewport: { width: 320, height: 568 },
            cdp: { width: 320, height: 568, deviceScaleFactor: 2, mobile: true },
          },
          callback,
        );
      } else {
        await withApp(tag, { viewport: { width: 390, height: 844 } }, callback);
      }
    });
  }

  for (const state of REVIEW_STATES) {
    const record = records.find((item) => item.state === state);
    reviewCheck(`render.${state}.exists`, Boolean(record), Boolean(record), true);
    if (!record) continue;
    reviewCheck(`render.${state}.size`, record.width >= 240 && record.height >= 160, { width: record.width, height: record.height }, ">=240x160");
    reviewCheck(`render.${state}.nonEmpty`, record.bytes > 0, record.bytes, ">0");
    reviewCheck(`render.${state}.nonSolid`, record.uniqueColors > 1 && record.nonTransparent > 0, {
      uniqueColors: record.uniqueColors,
      nonTransparent: record.nonTransparent,
    }, "more than one color");
  }
  const hashes = records.map((record) => record.sha256);
  reviewCheck("render.uniqueHashCount", new Set(hashes).size, REVIEW_STATES.length, REVIEW_STATES.length);
  const entries = fs.readdirSync(shotDir).sort();
  eqCheck(reviewOutcome.checks, "render.directory.exact", entries, Array.from(expected).sort());

  const artifactHash = sha256File(ARTIFACT);
  const verifierHash = sha256File(SELF_PATH);
  const renderLines = [
    `ROUND: ${ROUND}`,
    `ARTIFACT_SHA256: ${artifactHash}`,
    `VERIFIER_SHA256: ${verifierHash}`,
  ];
  for (const state of REVIEW_STATES) {
    const metrics = renderMetrics[state];
    if (!metrics) {
      renderLines.push(`${state}.missing=true`);
      continue;
    }
    renderLines.push(
      `${state}.viewport=${metrics.viewportWidth}x${metrics.viewportHeight}`,
      `${state}.state=${metrics.state}`,
      `${state}.doc_overflow=${metrics.docOverflow}`,
      `${state}.body_overflow=${metrics.bodyOverflow}`,
      `${state}.gear_visible=${metrics.gearVisible}`,
      `${state}.gear_rect=${rectText(metrics.gearRect)}`,
      `${state}.panel_open=${metrics.panelOpen}`,
      `${state}.panel_visible=${metrics.panelVisible}`,
      `${state}.panel_rect=${rectText(metrics.panelRect)}`,
      `${state}.progress_visible=${metrics.progressVisible}`,
      `${state}.progress_active=${metrics.progressActive}`,
      `${state}.progress_rect=${rectText(metrics.progressRect)}`,
      `${state}.base_marker_visible=${metrics.baseMarkerVisible}`,
      `${state}.base_marker_rect=${rectText(metrics.baseMarkerRect)}`,
      `${state}.edit_base_marker_visible=${metrics.editBaseMarkerVisible}`,
      `${state}.edit_draft_visible=${metrics.editDraftVisible}`,
      `${state}.settings_t=${metrics.settings.t}`,
      `${state}.settings_base_enabled=${metrics.settings.baseEnabled}`,
      `${state}.settings_base_value=${metrics.settings.baseValue}`,
      `${state}.history_count=${metrics.historyCount}`,
      `${state}.visible_controls=${metrics.controls.length}`,
      `${state}.min_control_width=${metrics.minControlWidth}`,
      `${state}.min_control_height=${metrics.minControlHeight}`,
      `${state}.min_input_font=${metrics.minInputFont}`,
      `${state}.file=${metrics.record.filename}`,
      `${state}.image_width=${metrics.record.width}`,
      `${state}.image_height=${metrics.record.height}`,
      `${state}.image_bytes=${metrics.record.bytes || (fs.statSync(metrics.record.file).size)}`,
      `${state}.image_sha256=${metrics.record.sha256}`,
      `${state}.unique_colors=${metrics.record.uniqueColors}`,
      `${state}.progress_active_before=${metrics.beforeActive ?? "n/a"}`,
      `${state}.progress_active_after=${metrics.afterActive ?? "n/a"}`,
      `${state}.capture_ms=${metrics.record.captureMs ?? "n/a"}`,
    );
  }
  const renderText = `${renderLines.join("\n")}\n`;
  const renderBytes = Buffer.from(renderText, "utf8");
  fs.writeFileSync(path.join(OUT_DIR, `render-r${ROUND}.txt`), renderBytes);
  const manifest = {
    round: ROUND,
    artifact_sha256: artifactHash,
    verifier_sha256: verifierHash,
    metrics_sha256: sha256(renderBytes),
    shots: records.map((record) => ({
      file: record.filename,
      sha256: record.sha256,
      width: record.width,
      height: record.height,
    })),
    adhoc: [],
  };
  fs.writeFileSync(path.join(OUT_DIR, `manifest-r${ROUND}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
}

function hLine(id, checks) {
  const failed = checks.filter((check) => !check.pass);
  const pass = checks.length > 0 && failed.length === 0;
  const evidence = checks
    .map((check) => {
      const suffix = check.pass ? "" : ` [expected ${display(check.expected)}]`;
      return `${check.id}=${display(check.actual)}${suffix}`;
    })
    .join("; ");
  return {
    id,
    pass,
    text: `H${id} ${pass ? "PASS" : "FAIL"} — checks=${checks.length} failed=${failed.length}; ${evidence}`,
  };
}

async function main() {
  if (!Number.isInteger(ROUND) || ROUND < 1) throw new Error(`invalid round: ${process.argv[2]}`);
  if (!fs.existsSync(ARTIFACT)) throw new Error(`artifact not found: ${ARTIFACT}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const artifactHash = sha256File(ARTIFACT);
  const verifierHash = sha256File(SELF_PATH);
  sharedBrowser = await launchBrowser();
  const checksByH = new Map();
  const hFunctions = [
    [1, h1],
    [2, h2],
    [3, h3],
    [4, h4],
    [5, h5],
    [6, h6],
    [7, h7],
    [9, h9],
  ];

  try {
    for (const [id, fn] of hFunctions) {
      const checks = [];
      checksByH.set(id, checks);
      try {
        await fn(checks);
      } catch (error) {
        addCheck(checks, `h${id}.exception`, false, error && error.stack ? error.stack : String(error), "completes");
      }
    }

    try {
      await runReviewShots();
    } catch (error) {
      addCheck(reviewOutcome.checks, "render.exception", false, error && error.stack ? error.stack : String(error), "completes");
    }
    reviewOutcome.pass = reviewOutcome.checks.length > 0 && reviewOutcome.checks.every((check) => check.pass);

    const h8Checks = [];
    checksByH.set(8, h8Checks);
    try {
      await h8(h8Checks);
    } catch (error) {
      addCheck(h8Checks, "h8.exception", false, error && error.stack ? error.stack : String(error), "completes");
    }
  } finally {
    await sharedBrowser.close();
  }

  const results = [];
  for (let id = 1; id <= 9; id += 1) results.push(hLine(id, checksByH.get(id) || []));
  const failedIds = results.filter((result) => !result.pass).map((result) => `H${result.id}`);
  const lines = [
    `ROUND: ${ROUND}`,
    `ARTIFACT_SHA256: ${artifactHash}`,
    `VERIFIER_SHA256: ${verifierHash}`,
    ...results.map((result) => result.text),
    failedIds.length ? `HARD: FAIL (${failedIds.join(",")})` : "HARD: PASS",
  ];
  const hardText = `${lines.join("\n")}\n`;
  fs.writeFileSync(path.join(OUT_DIR, `hard-r${ROUND}.txt`), hardText);
  process.stdout.write(hardText);
  process.exitCode = failedIds.length ? 1 : 0;
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exitCode = 2;
});
