#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { launchBrowser, openApp } from "../../../tests/lib/browser.mjs";
import { S } from "../../../tests/lib/selectors.mjs";

const SELF_FILE = fileURLToPath(import.meta.url);
const SELF_DIR = path.dirname(SELF_FILE);
const REPO_DIR = path.resolve(SELF_DIR, "../../..");
const TESTS_DIR = path.join(REPO_DIR, "tests");
const ARTIFACT = path.resolve(process.env.KEKKAI_ARTIFACT || path.join(REPO_DIR, "index.html"));
const ROUND_TEXT = process.argv[2] ?? process.env.KEKKAI_ROUND ?? "1";
const ROUND = Number(ROUND_TEXT);
const OUT_DIR = path.resolve(process.env.KEKKAI_OUT_DIR || path.join(SELF_DIR, "local-output"));

const HARD_IDS = Object.freeze(["H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H9"]);
const SETTINGS_KEY = "cal-phone.settings.v1";
const NUM_TOL = 1e-9;
const LAYOUT_TOL = 0.5;
const MIN_CONTROL = 43.5;
const MIN_FONT = 15.5;
const VIEWPORT = Object.freeze({ width: 390, height: 844 });
const T = Object.freeze({
  toggle: 'button[data-testid="settings-toggle"]',
  indicator: '[data-testid="settings-indicator"]',
  panel: 'dialog[data-testid="settings-panel"]',
  autoConfirm: 'select[data-testid="settings-auto-confirm"]',
  baseToggle: 'input[data-testid="settings-base-toggle"]',
  baseValue: 'input[data-testid="settings-base-value"]',
  done: 'button[data-testid="settings-done"]',
  feedback: '[data-testid="auto-confirm-feedback"]',
  progress: '[data-testid="auto-confirm-progress"]',
  countdown: '[data-testid="auto-confirm-countdown"]',
  baseMarker: '[data-testid="base-marker"]',
  editBaseMarker: '[data-testid="edit-base-marker"]',
  stateLabel: "#state-label",
  historyItem: '[data-testid="history-item"]',
  historyResult: '[data-testid="history-result"]',
  historyExpression: '[data-testid="history-expression"]',
  historyEdit: '[data-testid="history-edit"]',
  editDraft: '[data-testid="edit-draft"]',
  operandInput: 'input[data-testid="operand-input"]',
  operandChip: '[data-testid="operand-chip"]',
});

function parseReviewStates() {
  const raw =
    process.env.KEKKAI_EXPECTED_REVIEW_STATES ??
    process.env.EXPECTED_REVIEW_STATES ??
    process.env.KEKKAI_REVIEW_STATES;
  if (raw === undefined || raw === null || String(raw).trim() === "") return ["S1", "S2", "S3", "S4"];
  return String(raw)
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value && value.toLowerCase() !== "none");
}

const REVIEW_STATES = parseReviewStates();
let sharedBrowser = null;
let suiteResults = [];
const observedPageErrors = [];
const observedConsoleErrors = [];
const reviewChecks = [];
const reviewMetrics = {};

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

function display(value, limit = 1400) {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(value);
  try {
    const encoded = JSON.stringify(value);
    return encoded.length > limit ? `${encoded.slice(0, limit)}…` : encoded;
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timerWaitSeconds(seconds) {
  if (Number(seconds) === 0.5) return 900;
  return Math.max(900, Math.ceil(Number(seconds) * 1400));
}

async function runCase(checks, id, callback) {
  try {
    await callback();
  } catch (error) {
    addCheck(checks, `${id}.exception`, false, error && error.stack ? error.stack : String(error), "completes");
  }
}

function recordErrors(tag, app) {
  for (const error of app.pageErrors) observedPageErrors.push({ tag, text: String(error) });
  for (const error of app.consoleErrors) observedConsoleErrors.push({ tag, text: String(error) });
}

async function withOpen(tag, options, callback) {
  const app = await openApp(sharedBrowser, ARTIFACT, options || {});
  try {
    return await callback(app);
  } finally {
    recordErrors(tag, app);
    await app.close();
  }
}

async function openCustom(options, tag) {
  const context = await sharedBrowser.newContext({
    viewport: options.viewport || VIEWPORT,
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

async function withCustom(tag, options, callback) {
  const app = await openCustom(options, tag);
  try {
    return await callback(app);
  } finally {
    recordErrors(tag, app);
    await app.close();
  }
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

async function closeSettingsDone(page) {
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
  await closeSettingsDone(page);
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
  return {
    state: await page.locator(S.app).getAttribute("data-state"),
    operator: await page.locator(S.app).getAttribute("data-operator"),
    input: await page.locator(S.calcInput).inputValue(),
    expression: ((await page.locator(S.expression).textContent()) || "").trim(),
    resultValue: await page.locator(S.result).getAttribute("data-value"),
    resultError: await page.locator(S.result).getAttribute("data-error"),
    stateLabel: ((await page.locator(T.stateLabel).textContent()) || "").trim(),
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
        "data-base": item.getAttribute("data-base"),
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
        options: auto ? Array.from(auto.options).map((option) => option.value) : [],
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

async function h1(checks) {
  await withOpen("H1", {}, async ({ page }) => {
    const gear = page.locator(T.toggle);
    const gearRect = await rectOf(page, T.toggle);
    eqCheck(checks, "h1.gear.visible", await isVisible(page, T.toggle), true);
    addCheck(
      checks,
      "h1.gear.size",
      Boolean(gearRect && gearRect.width >= 44 && gearRect.height >= 44),
      gearRect && { width: gearRect.width, height: gearRect.height },
      "width>=44 && height>=44",
    );
    addCheck(
      checks,
      "h1.gear.position",
      Boolean(gearRect && gearRect.x + gearRect.width > VIEWPORT.width / 2 && gearRect.y < 100),
      gearRect && { right: gearRect.x + gearRect.width, top: gearRect.y },
      "right>195 && top<100",
    );
    eqCheck(checks, "h1.gear.haspopup", await gear.getAttribute("aria-haspopup"), "dialog");
    eqCheck(checks, "h1.gear.expanded.initial", await gear.getAttribute("aria-expanded"), "false");

    await gear.click();
    eqCheck(checks, "h1.open.dialogOpened", await waitDialog(page, true), true);
    const opened = await page.locator(T.panel).evaluate((dialog) => ({
      tagName: dialog.tagName,
      open: dialog.open,
      modal: dialog.matches(":modal"),
      focusInside: dialog.contains(document.activeElement),
      activeTag: document.activeElement ? document.activeElement.tagName : null,
    }));
    eqCheck(checks, "h1.open.tagName", opened.tagName, "DIALOG");
    eqCheck(checks, "h1.open.open", opened.open, true);
    eqCheck(checks, "h1.open.modal", opened.modal, true);
    eqCheck(checks, "h1.open.focusInside", opened.focusInside, true);
    eqCheck(checks, "h1.open.expanded", await gear.getAttribute("aria-expanded"), "true");

    await page.keyboard.press("Escape");
    eqCheck(checks, "h1.close.escape.closed", await waitDialog(page, false), true);
    eqCheck(checks, "h1.close.escape.focusGear", await waitGearFocus(page), true);
    eqCheck(checks, "h1.close.escape.open", await page.locator(T.panel).evaluate((dialog) => dialog.open), false);
    eqCheck(checks, "h1.close.escape.expanded", await gear.getAttribute("aria-expanded"), "false");

    await gear.click();
    await waitDialog(page, true);
    await closeSettingsDone(page);
    eqCheck(checks, "h1.close.done.focusGear", await waitGearFocus(page), true);
    eqCheck(checks, "h1.close.done.open", await page.locator(T.panel).evaluate((dialog) => dialog.open), false);
    eqCheck(checks, "h1.close.done.expanded", await gear.getAttribute("aria-expanded"), "false");

    await gear.click();
    await waitDialog(page, true);
    await page.mouse.click(2, VIEWPORT.height - 2);
    eqCheck(checks, "h1.close.backdrop.closed", await waitDialog(page, false), true);
    eqCheck(checks, "h1.close.backdrop.focusGear", await waitGearFocus(page), true);
    eqCheck(checks, "h1.close.backdrop.open", await page.locator(T.panel).evaluate((dialog) => dialog.open), false);
    eqCheck(checks, "h1.close.backdrop.expanded", await gear.getAttribute("aria-expanded"), "false");

    await openSettings(page);
    await page.locator(T.autoConfirm).selectOption("1");
    await closeSettingsDone(page);
    eqCheck(checks, "h1.indicator.on", await isVisible(page, T.indicator), true);

    await openSettings(page);
    await page.locator(T.autoConfirm).selectOption("0");
    await page.locator(T.baseToggle).uncheck();
    await closeSettingsDone(page);
    eqCheck(checks, "h1.indicator.off", await isVisible(page, T.indicator), false);
  });
}

async function h2(checks) {
  await withOpen("H2-persist", {}, async ({ page, pageErrors, consoleErrors }) => {
    const initial = await readSettings(page);
    const expectedOptions = Array.from({ length: 21 }, (_, index) => String(index / 2));
    eqCheck(checks, "h2.default.options", initial.options, expectedOptions);
    eqCheck(checks, "h2.default.selected", initial.t, "0");
    eqCheck(checks, "h2.default.baseChecked", initial.baseChecked, false);
    eqCheck(checks, "h2.default.baseDisabled", initial.baseDisabled, true);
    eqCheck(checks, "h2.default.baseValue", initial.baseValue, "0");
    addCheck(
      checks,
      "h2.default.storageEmpty",
      initial.stored === null || initial.stored === "",
      initial.stored,
      "null or empty",
    );

    await setSettings(page, { t: 1, baseEnabled: true, baseValue: "10" });
    const stored = await page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY);
    addCheck(checks, "h2.stored.nonEmpty", typeof stored === "string" && stored.length > 0, stored, "non-empty");

    await page.reload({ waitUntil: "load" });
    const restored = await readSettings(page);
    eqCheck(checks, "h2.reload.t", restored.t, "1");
    eqCheck(checks, "h2.reload.baseChecked", restored.baseChecked, true);
    eqCheck(checks, "h2.reload.baseDisabled", restored.baseDisabled, false);
    eqCheck(checks, "h2.reload.baseValue", restored.baseValue, "10");

    await clickOperator(page, "+");
    await enterNumber(page, "9.5");
    await clickEquals(page);
    const computed = await appSnapshot(page);
    nearCheck(checks, "h2.compute.result", computed.resultValue, 19.5);
    eqCheck(checks, "h2.compute.history", computed.history, 1);

    await page.locator(S.keyOp).click();
    const afterReset = await readSettings(page);
    eqCheck(checks, "h2.reset.t", afterReset.t, "1");
    eqCheck(checks, "h2.reset.baseChecked", afterReset.baseChecked, true);
    eqCheck(checks, "h2.reset.baseValue", afterReset.baseValue, "10");

    await clickOperator(page, "+");
    await enterNumber(page, "9.5");
    await clickEquals(page);
    addCheck(checks, "h2.preReload.history", (await appSnapshot(page)).history >= 1, (await appSnapshot(page)).history, ">=1");
    await page.reload({ waitUntil: "load" });
    eqCheck(checks, "h2.reload.historyEmpty", await page.locator(T.historyItem).count(), 0);
    eqCheck(checks, "h2.normal.pageErrors", pageErrors.length, 0);
    eqCheck(checks, "h2.normal.consoleErrors", consoleErrors.length, 0);
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
      await sleep(timerWaitSeconds(1));
      const snap = await appSnapshot(page);
      eqCheck(checks, "h2.storageDisabled.t", await page.locator(T.autoConfirm).inputValue(), "1");
      eqCheck(checks, "h2.storageDisabled.input", snap.input, "");
      addCheck(
        checks,
        "h2.storageDisabled.expression",
        snap.expression.includes("9.5"),
        snap.expression,
        "contains 9.5",
      );
      eqCheck(checks, "h2.storageDisabled.state", snap.state, "input");
      eqCheck(checks, "h2.storageDisabled.history", snap.history, 0);
      eqCheck(checks, "h2.storageDisabled.pageErrors", pageErrors.length, 0);
    },
  );
}

async function h3(checks) {
  await runCase(checks, "h3.t0", async () => {
    await withOpen("H3-t0", {}, async ({ page }) => {
      await typeNumber(page, "9.5");
      await sleep(1200);
      const snap = await appSnapshot(page);
      eqCheck(checks, "h3.t0.input", snap.input, "9.5");
      eqCheck(checks, "h3.t0.expression", snap.expression, "");
      eqCheck(checks, "h3.t0.history", snap.history, 0);
      eqCheck(checks, "h3.t0.result", snap.resultValue, null);
    });
  });

  await runCase(checks, "h3.t05", async () => {
    await withOpen("H3-t05", {}, async ({ page }) => {
      await setSettings(page, { t: 0.5 });
      await typeNumber(page, "9.5");
      await sleep(timerWaitSeconds(0.5));
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
    await withOpen("H3-timer-reset", {}, async ({ page }) => {
      await setSettings(page, { t: 1 });
      await clickKey(page, "9");
      await sleep(600);
      eqCheck(checks, "h3.timerReset.interimInput", await page.locator(S.calcInput).inputValue(), "9");
      await clickKey(page, "5");
      await sleep(timerWaitSeconds(1));
      const snap = await appSnapshot(page);
      eqCheck(checks, "h3.timerReset.input", snap.input, "");
      eqCheck(checks, "h3.timerReset.expression", snap.expression, "95");
      eqCheck(checks, "h3.timerReset.state", snap.state, "input");
      eqCheck(checks, "h3.timerReset.history", snap.history, 0);
      addCheck(checks, "h3.timerReset.label", snap.stateLabel.includes("95"), snap.stateLabel, "contains 95");
    });
  });

  await runCase(checks, "h3.trailingDot", async () => {
    await withOpen("H3-trailing-dot", {}, async ({ page }) => {
      await setSettings(page, { t: 0.5 });
      await typeNumber(page, "9.");
      await sleep(timerWaitSeconds(0.5));
      const held = await appSnapshot(page);
      eqCheck(checks, "h3.trailingDot.heldInput", held.input, "9.");
      eqCheck(checks, "h3.trailingDot.heldExpression", held.expression, "");
      await clickKey(page, "5");
      await sleep(timerWaitSeconds(0.5));
      const completed = await appSnapshot(page);
      eqCheck(checks, "h3.trailingDot.completedInput", completed.input, "");
      addCheck(
        checks,
        "h3.trailingDot.completedExpression",
        completed.expression.includes("9.5"),
        completed.expression,
        "contains 9.5",
      );
      addCheck(
        checks,
        "h3.trailingDot.label",
        completed.stateLabel.includes("9.5"),
        completed.stateLabel,
        "contains 9.5",
      );
    });
  });

  await runCase(checks, "h3.panelPause", async () => {
    await withOpen("H3-panel-pause", {}, async ({ page }) => {
      await setSettings(page, { t: 1 });
      await typeNumber(page, "9.5");
      await openSettings(page);
      await sleep(timerWaitSeconds(1));
      const paused = await appSnapshot(page);
      eqCheck(checks, "h3.panelPause.inputWhileOpen", paused.input, "9.5");
      eqCheck(checks, "h3.panelPause.expressionWhileOpen", paused.expression, "");
      await closeSettingsDone(page);
      await sleep(timerWaitSeconds(1));
      const resumed = await appSnapshot(page);
      eqCheck(checks, "h3.panelPause.inputAfterClose", resumed.input, "");
      addCheck(
        checks,
        "h3.panelPause.expressionAfterClose",
        resumed.expression.includes("9.5"),
        resumed.expression,
        "contains 9.5",
      );
    });
  });

  await runCase(checks, "h3.manualEnter", async () => {
    await withOpen("H3-manual-enter", {}, async ({ page }) => {
      await setSettings(page, { t: 1 });
      await typeNumber(page, "9.5");
      await clickKey(page, "enter");
      await sleep(timerWaitSeconds(1));
      const snap = await appSnapshot(page);
      eqCheck(checks, "h3.manualEnter.expression", snap.expression, "9.5");
      eqCheck(checks, "h3.manualEnter.history", snap.history, 0);
      eqCheck(checks, "h3.manualEnter.input", snap.input, "");
    });
  });

  await runCase(checks, "h3.equals", async () => {
    await withOpen("H3-equals", {}, async ({ page }) => {
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
      eqCheck(checks, "h3.equals.state", snap.state, "result");
    });
  });

  await runCase(checks, "h3.reset", async () => {
    await withOpen("H3-reset", {}, async ({ page }) => {
      await setSettings(page, { t: 1 });
      await clickKey(page, "9");
      await page.locator(S.keyOp).click();
      await sleep(timerWaitSeconds(1));
      const snap = await appSnapshot(page);
      eqCheck(checks, "h3.reset.state", snap.state, "select");
      eqCheck(checks, "h3.reset.expression", snap.expression, "");
      eqCheck(checks, "h3.reset.input", snap.input, "");
      eqCheck(checks, "h3.reset.history", snap.history, 0);
    });
  });

  await runCase(checks, "h3.operatorChange", async () => {
    await withOpen("H3-operator-change", {}, async ({ page }) => {
      await setSettings(page, { t: 1 });
      await clickKey(page, "9");
      await sleep(600);
      await clickOperator(page, "+");
      await sleep(timerWaitSeconds(1));
      const snap = await appSnapshot(page);
      eqCheck(checks, "h3.operatorChange.input", snap.input, "");
      eqCheck(checks, "h3.operatorChange.state", snap.state, "input");
      eqCheck(checks, "h3.operatorChange.committedValue", snap.expression.replace(/\s*[+\-*/]\s*$/, "").trim(), "9");
      addCheck(
        checks,
        "h3.operatorChange.label",
        snap.stateLabel.includes("9"),
        snap.stateLabel,
        "contains 9",
      );
      eqCheck(checks, "h3.operatorChange.history", snap.history, 0);
    });
  });

  await runCase(checks, "h3.progress", async () => {
    await withOpen("H3-progress", {}, async ({ page }) => {
      await setSettings(page, { t: 1 });
      await clickKey(page, "9");
      const progressRect = await rectOf(page, T.progress);
      eqCheck(checks, "h3.progress.visible", await isVisible(page, T.progress), true);
      eqCheck(checks, "h3.progress.active", await page.locator(T.progress).getAttribute("data-active"), "true");
      addCheck(
        checks,
        "h3.progress.height",
        Boolean(progressRect && progressRect.height >= 1 && progressRect.height <= 4),
        progressRect && progressRect.height,
        "1..4px",
      );
      await sleep(timerWaitSeconds(1));
      eqCheck(checks, "h3.progress.afterActive", await page.locator(T.progress).getAttribute("data-active"), "false");
      eqCheck(checks, "h3.progress.afterVisible", await isVisible(page, T.progress), false);
    });
  });

  await runCase(checks, "h3.reducedMotion", async () => {
    await withCustom("H3-reduced-motion", { reducedMotion: "reduce" }, async ({ page }) => {
      await setSettings(page, { t: 0.5 });
      await typeNumber(page, "9.5");
      await sleep(timerWaitSeconds(0.5));
      const snap = await appSnapshot(page);
      eqCheck(checks, "h3.reducedMotion.input", snap.input, "");
      addCheck(
        checks,
        "h3.reducedMotion.expression",
        snap.expression.includes("9.5"),
        snap.expression,
        "contains 9.5",
      );
      eqCheck(checks, "h3.reducedMotion.history", snap.history, 0);
      addCheck(
        checks,
        "h3.reducedMotion.label",
        snap.stateLabel.includes("9.5"),
        snap.stateLabel,
        "contains 9.5",
      );
    });
  });
}

async function h4(checks) {
  await runCase(checks, "h4.baseOff", async () => {
    await withOpen("H4-base-off", {}, async ({ page }) => {
      await clickOperator(page, "+");
      for (const value of ["9.5", "9.2", "9.0"]) await enterNumber(page, value);
      await clickEquals(page);
      const snap = await appSnapshot(page);
      const history = await historyDetails(page);
      nearCheck(checks, "h4.baseOff.result", snap.resultValue, 27.7);
      eqCheck(checks, "h4.baseOff.historyCount", history.length, 1);
      eqCheck(checks, "h4.baseOff.historyBase", history[0] && history[0]["data-base"], null);
      eqCheck(checks, "h4.baseOff.operands", history[0] && history[0].operands, ["9.5", "9.2", "9.0"]);
    });
  });

  await runCase(checks, "h4.base10", async () => {
    await withOpen("H4-base-10", {}, async ({ page }) => {
      await setSettings(page, { baseEnabled: true, baseValue: "10" });
      await clickOperator(page, "+");
      eqCheck(checks, "h4.base10.markerVisible", await isVisible(page, T.baseMarker), true);
      addCheck(
        checks,
        "h4.base10.markerText",
        ((await page.locator(T.baseMarker).textContent()) || "").includes("10"),
        ((await page.locator(T.baseMarker).textContent()) || "").trim(),
        "contains 10",
      );
      for (const value of ["9.5", "9.2", "9.0"]) await enterNumber(page, value);
      await clickEquals(page);
      const snap = await appSnapshot(page);
      const history = await historyDetails(page);
      nearCheck(checks, "h4.base10.result", snap.resultValue, 37.7);
      eqCheck(checks, "h4.base10.historyBase", history[0] && history[0]["data-base"], "10");
      eqCheck(checks, "h4.base10.operands", history[0] && history[0].operands, ["9.5", "9.2", "9.0"]);
      addCheck(
        checks,
        "h4.base10.expression",
        Boolean(history[0] && history[0].expression.includes("10")),
        history[0] && history[0].expression,
        "contains 10",
      );
    });
  });

  await runCase(checks, "h4.base100", async () => {
    await withOpen("H4-base-100", {}, async ({ page }) => {
      await setSettings(page, { baseEnabled: true, baseValue: "100" });
      await clickOperator(page, "/");
      await enterNumber(page, "4");
      await clickEquals(page);
      nearCheck(checks, "h4.base100.result", (await appSnapshot(page)).resultValue, 25);
    });
  });

  await runCase(checks, "h4.base0", async () => {
    await withOpen("H4-base-0", {}, async ({ page }) => {
      await setSettings(page, { baseEnabled: true, baseValue: "0" });
      await clickOperator(page, "*");
      await enterNumber(page, "5");
      await clickEquals(page);
      const snap = await appSnapshot(page);
      const history = await historyDetails(page);
      nearCheck(checks, "h4.base0.result", snap.resultValue, 0);
      eqCheck(checks, "h4.base0.historyBase", history[0] && history[0]["data-base"], "0");
    });
  });

  await runCase(checks, "h4.baseNegative", async () => {
    await withOpen("H4-base-negative", {}, async ({ page }) => {
      await setSettings(page, { baseEnabled: true, baseValue: "-2.5" });
      await clickOperator(page, "+");
      await enterNumber(page, "1");
      await clickEquals(page);
      nearCheck(checks, "h4.baseNegative.result", (await appSnapshot(page)).resultValue, -1.5);
    });
  });

  await runCase(checks, "h4.noOperator", async () => {
    await withOpen("H4-no-operator", {}, async ({ page }) => {
      await setSettings(page, { baseEnabled: true, baseValue: "10" });
      await enterNumber(page, "9.5");
      const before = await appSnapshot(page);
      addCheck(
        checks,
        "h4.noOperator.expressionWithoutBase",
        !before.expression.includes("10"),
        before.expression,
        "does not contain 10",
      );
      await clickOperator(page, "+");
      const after = await appSnapshot(page);
      addCheck(
        checks,
        "h4.noOperator.expressionWithBase",
        after.expression.includes("10"),
        after.expression,
        "contains 10",
      );
      addCheck(
        checks,
        "h4.noOperator.labelWithBase",
        after.stateLabel.includes("10"),
        after.stateLabel,
        "contains 10",
      );
    });
  });

  await runCase(checks, "h4.liveRedraw", async () => {
    await withOpen("H4-live-redraw", {}, async ({ page }) => {
      await setSettings(page, { baseEnabled: true, baseValue: "10" });
      await clickOperator(page, "+");
      await enterNumber(page, "9.5");
      await openSettings(page);
      await page.locator(T.baseValue).fill("20");
      const expression = ((await page.locator(S.expression).textContent()) || "").trim();
      addCheck(checks, "h4.liveRedraw.contains20", expression.includes("20"), expression, "contains 20");
      addCheck(checks, "h4.liveRedraw.omits10", !expression.includes("10"), expression, "does not contain 10");
      await closeSettingsDone(page);
    });
  });

  await runCase(checks, "h4.invalidBase", async () => {
    await withOpen("H4-invalid-base", {}, async ({ page }) => {
      await setSettings(page, { baseEnabled: true, baseValue: "10" });
      await clickOperator(page, "+");
      await typeNumber(page, "9.5");
      await openSettings(page);
      await page.locator(T.baseValue).fill("");
      eqCheck(checks, "h4.invalidBase.emptyDuringEdit", await page.locator(T.baseValue).inputValue(), "");
      await closeSettingsDone(page);
      const restored = await page.locator(T.baseValue).inputValue();
      eqCheck(checks, "h4.invalidBase.restored", restored, "10");
      addCheck(checks, "h4.invalidBase.baseFinite", Number.isFinite(Number(restored)), restored, "finite");
      await clickEquals(page);
      const snap = await appSnapshot(page);
      nearCheck(checks, "h4.invalidBase.result", snap.resultValue, 19.5);
      addCheck(
        checks,
        "h4.invalidBase.resultFinite",
        Number.isFinite(Number(snap.resultValue)),
        snap.resultValue,
        "finite",
      );
    });
  });

  await runCase(checks, "h4.divZero", async () => {
    await withOpen("H4-div-zero", {}, async ({ page }) => {
      await setSettings(page, { baseEnabled: true, baseValue: "10" });
      await clickOperator(page, "/");
      await enterNumber(page, "5");
      await enterNumber(page, "0");
      await clickEquals(page);
      const snap = await appSnapshot(page);
      eqCheck(checks, "h4.divZero.error", snap.resultError, "true");
      eqCheck(checks, "h4.divZero.history", snap.history, 0);
      eqCheck(checks, "h4.divZero.value", snap.resultValue, null);
    });
  });

  await runCase(checks, "h4.snapshotEdit", async () => {
    await withOpen("H4-snapshot-edit", {}, async ({ page }) => {
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
      eqCheck(checks, "h4.snapshot.bases", beforeEdit.map((item) => item["data-base"]), ["20", "10"]);
      eqCheck(checks, "h4.snapshot.results", beforeEdit.map((item) => item.result), ["25", "15"]);

      await page.locator(T.historyEdit).nth(1).click();
      const editMarker = ((await page.locator(T.editBaseMarker).textContent()) || "").trim();
      eqCheck(checks, "h4.snapshot.editMarkerVisible", await isVisible(page, T.editBaseMarker), true);
      addCheck(checks, "h4.snapshot.editMarkerText", editMarker.includes("10"), editMarker, "contains 10");
      eqCheck(checks, "h4.snapshot.operandCount", await page.locator(T.operandInput).count(), 2);

      await page.locator(T.operandInput).nth(1).fill("5");
      await clickEquals(page);
      const afterEdit = await historyDetails(page);
      const top = afterEdit[0];
      eqCheck(checks, "h4.snapshot.editedBase", top && top["data-base"], "10");
      nearCheck(checks, "h4.snapshot.editedResult", top && top.result, 10 + 2 + 5);
      addCheck(
        checks,
        "h4.snapshot.editedExpression",
        Boolean(top && top.expression.includes("10")),
        top && top.expression,
        "contains 10",
      );
      eqCheck(checks, "h4.snapshot.baseMarkerVisible", await isVisible(page, T.baseMarker), true);
      const baseMarkerText = ((await page.locator(T.baseMarker).textContent()) || "").trim();
      addCheck(
        checks,
        "h4.snapshot.baseMarkerText",
        baseMarkerText.includes("20"),
        baseMarkerText,
        "contains current base 20",
      );
    });
  });
}

async function h5(checks) {
  await runCase(checks, "h5.withdraw", async () => {
    await withOpen("H5-withdraw", {}, async ({ page }) => {
      await clickOperator(page, "+");
      await enterNumber(page, "9.5");
      await enterNumber(page, "9.2");
      await page.locator(`${S.keypad} [data-key="backspace"]`).click();
      const first = await appSnapshot(page);
      addCheck(
        checks,
        "h5.withdraw.firstLabel",
        first.stateLabel.includes("9.2"),
        first.stateLabel,
        "contains 9.2",
      );
      addCheck(
        checks,
        "h5.withdraw.firstExpression",
        first.expression.includes("9.5") && !first.expression.includes("9.2"),
        first.expression,
        "keeps 9.5 and omits 9.2",
      );
      eqCheck(checks, "h5.withdraw.firstState", first.state, "input");
      eqCheck(checks, "h5.withdraw.firstHistory", first.history, 0);
      await page.locator(`${S.keypad} [data-key="backspace"]`).click();
      const second = await appSnapshot(page);
      addCheck(
        checks,
        "h5.withdraw.secondLabel",
        second.stateLabel.includes("9.5"),
        second.stateLabel,
        "contains 9.5",
      );
      eqCheck(checks, "h5.withdraw.secondExpression", second.expression, "");
      eqCheck(checks, "h5.withdraw.secondHistory", second.history, 0);
    });
  });

  await runCase(checks, "h5.nonEmptyInput", async () => {
    await withOpen("H5-non-empty-input", {}, async ({ page }) => {
      await clickOperator(page, "+");
      await enterNumber(page, "9.5");
      await typeNumber(page, "95");
      const beforeExpression = ((await page.locator(S.expression).textContent()) || "").trim();
      await page.locator(`${S.keypad} [data-key="backspace"]`).click();
      const after = await appSnapshot(page);
      eqCheck(checks, "h5.nonEmptyInput.value", after.input, "9");
      eqCheck(checks, "h5.nonEmptyInput.expression", after.expression, beforeExpression);
      eqCheck(checks, "h5.nonEmptyInput.history", after.history, 0);
    });
  });

  await runCase(checks, "h5.baseWithdraw", async () => {
    await withOpen("H5-base-withdraw", {}, async ({ page }) => {
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
    await withOpen("H5-result-state", {}, async ({ page }) => {
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
    await withOpen("H5-error-state", {}, async ({ page }) => {
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
    await withOpen("H5-edit-withdraw", {}, async ({ page }) => {
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
      eqCheck(checks, "h5.editWithdraw.chipsAfterOperand", await page.locator(T.operandChip).count(), 1);
      eqCheck(
        checks,
        "h5.editWithdraw.operandInputValue",
        await page.locator(T.operandInput).first().inputValue(),
        "",
      );
    });
  });

  await runCase(checks, "h5.coldEmpty", async () => {
    await withOpen("H5-cold-empty", {}, async ({ page }) => {
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
  const { runSuite } = await import("file:///ws/cal_phone/tests/suite.mjs");
  suiteResults = await runSuite({ artifact: ARTIFACT });
  eqCheck(checks, "h6.resultCount", suiteResults.length, 18);
  const failed = suiteResults.filter((result) => !result.pass);
  addCheck(checks, "h6.allPass", failed.length === 0, failed.map((result) => result.id), []);
  const cold = suiteResults.find((result) => result.id === "cold-start");
  const coldIds = cold ? cold.checks.map((item) => item.id) : [];
  addCheck(
    checks,
    "h6.coldStart.keysEnabled",
    coldIds.includes("cold-start.keys-enabled"),
    coldIds,
    "contains cold-start.keys-enabled",
  );
  addCheck(
    checks,
    "h6.coldStart.keysDisabledAbsent",
    !coldIds.includes("cold-start.keys-disabled"),
    coldIds,
    "omits cold-start.keys-disabled",
  );
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

function minOf(values) {
  return values.length ? Math.min(...values) : null;
}

function assertLayout(checks, prefix, metrics, viewport) {
  addCheck(checks, `${prefix}.viewport`, metrics.viewportWidth === viewport.width, metrics.viewportWidth, viewport.width);
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
      ? {
          count: metrics.controls.length,
          minWidth: minOf(metrics.controls.map((item) => item.width)),
          minHeight: minOf(metrics.controls.map((item) => item.height)),
        }
      : small.map((control) => `${controlName(control)}:${control.width.toFixed(1)}x${control.height.toFixed(1)}`),
    `all >=${MIN_CONTROL}x${MIN_CONTROL}`,
  );
  const inputOrSelect = metrics.controls.filter((control) => control.tag === "INPUT" || control.tag === "SELECT");
  const badFont = inputOrSelect.filter((control) => control.fontSize < MIN_FONT - 1e-9);
  addCheck(
    checks,
    `${prefix}.fonts`,
    badFont.length === 0,
    badFont.length === 0
      ? { count: inputOrSelect.length, min: minOf(inputOrSelect.map((item) => item.fontSize)) }
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
      addCheck(
        checks,
        `${prefix}.panel.belowGear`,
        panel.top >= gear.bottom - 2,
        { panelTop: panel.top, gearBottom: gear.bottom },
        "panel top >= gear bottom-2",
      );
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
      const prefix = `h7.${viewport.width}x${viewport.height}.${state}`;
      await runCase(checks, prefix, async () => {
        const callback = async ({ page }) => {
          await setupLayoutState(page, state);
          await sleep(150);
          const metrics = await measureLayout(page, `${viewport.width}x${viewport.height}:${state}`);
          assertLayout(checks, `h7.${viewport.width}x${viewport.height}.${state}`, metrics, viewport);
          if (state === "progress") {
            eqCheck(checks, `${prefix}.progress.active`, metrics.progressActive, "true");
          }
          if (state === "base-marker") {
            eqCheck(checks, `${prefix}.baseMarker.visible`, metrics.baseMarkerVisible, true);
          }
          if (state === "edit-draft") {
            eqCheck(checks, `${prefix}.editDraft.visible`, metrics.editDraftVisible, true);
            eqCheck(checks, `${prefix}.editMarker.visible`, metrics.editBaseMarkerVisible, true);
          }
          if (state === "two-history") {
            eqCheck(checks, `${prefix}.history.count`, metrics.historyCount, 2);
          }
        };
        if (viewport.cdp) {
          await withCustom(
            `H7-${viewport.width}x${viewport.height}-${state}`,
            {
              viewport: { width: viewport.width, height: viewport.height },
              cdp: { width: 320, height: 568, deviceScaleFactor: 2, mobile: true },
            },
            callback,
          );
        } else {
          await withOpen(
            `H7-${viewport.width}x${viewport.height}-${state}`,
            { viewport: { width: viewport.width, height: viewport.height } },
            callback,
          );
        }
      });
    }
  }
}

function externalReferenceUrls(html) {
  const urls = [];
  const patterns = [
    /<script\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    /<link\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^'")\s;]+))/gi,
    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')]+))\s*\)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const value = match[1] ?? match[2] ?? match[3] ?? "";
      if (/^(?:https?:)?\/\//i.test(value.trim())) urls.push(value.trim());
    }
  }
  return urls;
}

function suiteCleanFailures() {
  return suiteResults.flatMap((result) =>
    result.checks.filter((check) => check.id.endsWith(".clean") && !check.pass).map((check) => ({
      scenario: result.id,
      check: check.id,
      detail: check.detail,
    })),
  );
}

async function h8(checks) {
  const html = fs.readFileSync(ARTIFACT, "utf8");
  const refs = externalReferenceUrls(html);
  eqCheck(checks, "h8.htmlClose", /<\/html>\s*$/i.test(html), true);
  addCheck(checks, "h8.bytes", Buffer.byteLength(html) >= 1024, Buffer.byteLength(html), ">=1024");
  eqCheck(checks, "h8.externalRefs", refs, []);
  eqCheck(checks, "h8.pageErrors", observedPageErrors, []);
  eqCheck(checks, "h8.consoleErrors", observedConsoleErrors, []);
  eqCheck(checks, "h8.suiteCleanChecks", suiteCleanFailures(), []);
  const failedReviewChecks = reviewChecks.filter((check) => !check.pass);
  if (REVIEW_STATES.length) {
    addCheck(
      checks,
      "h8.reviewArtifacts",
      reviewChecks.length > 0 && failedReviewChecks.length === 0,
      failedReviewChecks.map((check) => ({ id: check.id, actual: check.actual, expected: check.expected })),
      [],
    );
  }
}

async function h9(checks) {
  const sequences = [];
  for (const index of [1, 2]) {
    await runCase(checks, `h9.run${index}`, async () => {
      await withOpen(`H9-run-${index}`, {}, async ({ page }) => {
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
  eqCheck(checks, "h9.recordsRunTwo", sequences[1] ? sequences[1].length : null, 1);
  eqCheck(checks, "h9.deepEqual", sequences[0], sequences[1]);
  addCheck(
    checks,
    "h9.fields",
    Boolean(
      sequences[0] &&
        sequences[0][0] &&
        ["operator", "operands", "data-base", "result", "expression"].every((key) =>
          Object.prototype.hasOwnProperty.call(sequences[0][0], key),
        ),
    ),
    sequences[0],
    "operator/operands/data-base/result/expression",
  );
  nearCheck(checks, "h9.result", sequences[0] && sequences[0][0] && sequences[0][0].result, 37.7);
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
  const chunks = [];
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
      chunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported PNG color type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(chunks));
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
    colors.add(pixels.subarray(index, index + channels).toString("hex"));
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
  return {
    ...metrics,
    settings,
    minControlWidth: minOf(metrics.controls.map((control) => control.width)),
    minControlHeight: minOf(metrics.controls.map((control) => control.height)),
    minInputFont: minOf(
      metrics.controls
        .filter((control) => control.tag === "INPUT" || control.tag === "SELECT")
        .map((control) => control.fontSize),
    ),
  };
}

async function setupRenderState(page, state) {
  if (state === "S1") return { inputDone: null };
  if (state === "S2") {
    await openSettings(page);
    return { inputDone: null };
  }
  if (state === "S3") {
    await setSettings(page, { t: 10, baseEnabled: true, baseValue: "10" });
    await clickOperator(page, "+");
    await enterNumber(page, "9.5");
    await typeNumber(page, "9.2");
    return { inputDone: Date.now() };
  }
  if (state === "S4") {
    await openSettings(page);
    await page.locator(T.baseToggle).check();
    await page.locator(T.baseValue).fill("10");
    return { inputDone: null };
  }
  throw new Error(`unknown review state: ${state}`);
}

async function runReviewShots() {
  if (!REVIEW_STATES.length) return;
  const shotDir = path.join(OUT_DIR, "review-shots", `r${ROUND}`);
  fs.mkdirSync(shotDir, { recursive: true });
  const expectedFiles = REVIEW_STATES.map((state) => `${state}.png`).sort();
  const records = [];

  for (const state of REVIEW_STATES) {
    await runCase(reviewChecks, `render.${state}`, async () => {
      const callback = async ({ page }) => {
        const setup = await setupRenderState(page, state);
        await sleep(state === "S3" ? 80 : 150);
        const activeBefore = await page.locator(T.progress).getAttribute("data-active");
        const metrics = await captureRenderMetrics(page, state);
        const screenshot = await page.screenshot({ fullPage: false });
        const captureMs = setup.inputDone === null ? null : Date.now() - setup.inputDone;
        const activeAfter = await page.locator(T.progress).getAttribute("data-active");
        const filename = `${state}.png`;
        const file = path.join(shotDir, filename);
        fs.writeFileSync(file, screenshot);
        const image = decodePng(screenshot);
        const record = {
          file,
          filename,
          sha256: sha256(screenshot),
          width: image.width,
          height: image.height,
          bytes: image.bytes,
          uniqueColors: image.uniqueColors,
          nonTransparent: image.nonTransparent,
          captureMs,
          activeBefore,
          activeAfter,
        };
        records.push(record);
        reviewMetrics[state] = { ...metrics, record };

        eqCheck(reviewChecks, `render.${state}.exists`, fs.existsSync(file), true);
        addCheck(reviewChecks, `render.${state}.size`, image.width >= 240 && image.height >= 160, {
          width: image.width,
          height: image.height,
        }, ">=240x160");
        addCheck(reviewChecks, `render.${state}.nonEmpty`, image.bytes > 0, image.bytes, ">0");
        addCheck(
          reviewChecks,
          `render.${state}.nonSolid`,
          image.uniqueColors > 1 && image.nonTransparent > 0,
          { uniqueColors: image.uniqueColors, nonTransparent: image.nonTransparent },
          "uniqueColors>1 && nonTransparent>0",
        );
        addCheck(reviewChecks, `render.${state}.docOverflow`, metrics.docOverflow <= 1, metrics.docOverflow, "<=1");
        addCheck(reviewChecks, `render.${state}.bodyOverflow`, metrics.bodyOverflow <= 1, metrics.bodyOverflow, "<=1");

        if (state === "S1") {
          eqCheck(reviewChecks, "render.S1.state", metrics.state, "select");
          eqCheck(reviewChecks, "render.S1.history", metrics.historyCount, 0);
          eqCheck(reviewChecks, "render.S1.panelOpen", metrics.panelOpen, false);
          eqCheck(reviewChecks, "render.S1.t", metrics.settings.t, "0");
          eqCheck(reviewChecks, "render.S1.baseEnabled", metrics.settings.baseEnabled, false);
        } else if (state === "S2") {
          eqCheck(reviewChecks, "render.S2.panelOpen", metrics.panelOpen, true);
          eqCheck(reviewChecks, "render.S2.panelVisible", metrics.panelVisible, true);
          eqCheck(reviewChecks, "render.S2.gearVisible", metrics.gearVisible, true);
        } else if (state === "S3") {
          eqCheck(reviewChecks, "render.S3.t", metrics.settings.t, "10");
          eqCheck(reviewChecks, "render.S3.baseEnabled", metrics.settings.baseEnabled, true);
          eqCheck(reviewChecks, "render.S3.baseValue", metrics.settings.baseValue, "10");
          eqCheck(reviewChecks, "render.S3.progressActiveBefore", activeBefore, "true");
          eqCheck(reviewChecks, "render.S3.progressActiveAfter", activeAfter, "true");
          eqCheck(reviewChecks, "render.S3.progressVisible", metrics.progressVisible, true);
          addCheck(reviewChecks, "render.S3.captureUnderOneSecond", captureMs !== null && captureMs < 1000, captureMs, "<1000ms");
          eqCheck(reviewChecks, "render.S3.baseMarkerVisible", metrics.baseMarkerVisible, true);
        } else if (state === "S4") {
          eqCheck(reviewChecks, "render.S4.viewportWidth", metrics.viewportWidth, 320);
          eqCheck(reviewChecks, "render.S4.panelOpen", metrics.panelOpen, true);
          eqCheck(reviewChecks, "render.S4.baseEnabled", metrics.settings.baseEnabled, true);
          eqCheck(reviewChecks, "render.S4.baseValue", metrics.settings.baseValue, "10");
          eqCheck(reviewChecks, "render.S4.gearVisible", metrics.gearVisible, true);
        }
      };

      if (state === "S4") {
        await withCustom(
          `render-${state}`,
          {
            viewport: { width: 320, height: 568 },
            cdp: { width: 320, height: 568, deviceScaleFactor: 2, mobile: true },
          },
          callback,
        );
      } else {
        await withOpen(`render-${state}`, { viewport: VIEWPORT }, callback);
      }
    });
  }

  const hashes = records.map((record) => record.sha256);
  addCheck(reviewChecks, "render.uniqueHashes", new Set(hashes).size === REVIEW_STATES.length, new Set(hashes).size, REVIEW_STATES.length);
  eqCheck(reviewChecks, "render.directory.exact", fs.readdirSync(shotDir).sort(), expectedFiles);
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
    text: `${id} ${pass ? "PASS" : "FAIL"} — checks=${checks.length} failed=${failed.length}; ${evidence}`,
  };
}

function renderTextForReview(artifactHash, verifierHash) {
  const lines = [
    `ROUND: ${ROUND}`,
    `ARTIFACT_SHA256: ${artifactHash}`,
    `VERIFIER_SHA256: ${verifierHash}`,
  ];
  for (const state of REVIEW_STATES) {
    const metrics = reviewMetrics[state];
    if (!metrics) {
      lines.push(`${state}.missing=true`);
      continue;
    }
    const record = metrics.record;
    lines.push(
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
      `${state}.file=${record.filename}`,
      `${state}.image_width=${record.width}`,
      `${state}.image_height=${record.height}`,
      `${state}.image_bytes=${record.bytes}`,
      `${state}.image_sha256=${record.sha256}`,
      `${state}.unique_colors=${record.uniqueColors}`,
      `${state}.progress_active_before=${record.activeBefore ?? "n/a"}`,
      `${state}.progress_active_after=${record.activeAfter ?? "n/a"}`,
      `${state}.capture_ms=${record.captureMs ?? "n/a"}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function writeManifest(artifactHash, verifierHash, metricsBytes, records) {
  const manifest = {
    round: ROUND,
    artifact_sha256: artifactHash,
    verifier_sha256: verifierHash,
    metrics_sha256: sha256(metricsBytes),
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

async function main() {
  if (!Number.isInteger(ROUND) || ROUND < 1) throw new Error(`invalid round: ${ROUND_TEXT}`);
  if (!fs.existsSync(ARTIFACT)) throw new Error(`artifact not found: ${ARTIFACT}`);
  if (!fs.existsSync(path.join(TESTS_DIR, "suite.mjs"))) throw new Error(`suite not found: ${TESTS_DIR}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const artifactHash = sha256File(ARTIFACT);
  const verifierHash = sha256File(SELF_FILE);
  const checksByH = new Map(HARD_IDS.map((id) => [Number(id.slice(1)), []]));
  sharedBrowser = await launchBrowser();

  try {
    for (const [id, fn] of [
      [1, h1],
      [2, h2],
      [3, h3],
      [4, h4],
      [5, h5],
      [6, h6],
      [7, h7],
      [9, h9],
    ]) {
      const checks = checksByH.get(id);
      try {
        await fn(checks);
      } catch (error) {
        addCheck(checks, `h${id}.exception`, false, error && error.stack ? error.stack : String(error), "completes");
      }
    }

    try {
      await runReviewShots();
    } catch (error) {
      addCheck(reviewChecks, "render.exception", false, error && error.stack ? error.stack : String(error), "completes");
    }

    const h8Checks = checksByH.get(8);
    try {
      await h8(h8Checks);
    } catch (error) {
      addCheck(h8Checks, "h8.exception", false, error && error.stack ? error.stack : String(error), "completes");
    }
  } finally {
    await sharedBrowser.close();
  }

  const results = HARD_IDS.map((id) => hLine(id, checksByH.get(Number(id.slice(1))) || []));
  const failedIds = results.filter((result) => !result.pass).map((result) => result.id);
  const hardText = [
    `ROUND: ${ROUND}`,
    `ARTIFACT_SHA256: ${artifactHash}`,
    `VERIFIER_SHA256: ${verifierHash}`,
    ...results.map((result) => result.text),
    failedIds.length ? `HARD: FAIL (${failedIds.join(",")})` : "HARD: PASS",
  ].join("\n") + "\n";
  fs.writeFileSync(path.join(OUT_DIR, `hard-r${ROUND}.txt`), hardText);

  if (REVIEW_STATES.length) {
    const renderText = renderTextForReview(artifactHash, verifierHash);
    const renderBytes = Buffer.from(renderText, "utf8");
    fs.writeFileSync(path.join(OUT_DIR, `render-r${ROUND}.txt`), renderBytes);
    const shotRecords = REVIEW_STATES.map((state) => reviewMetrics[state] && reviewMetrics[state].record).filter(Boolean);
    writeManifest(artifactHash, verifierHash, renderBytes, shotRecords);
  }

  process.stdout.write(hardText);
  process.exitCode = failedIds.length ? 1 : 0;
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exitCode = 2;
});
