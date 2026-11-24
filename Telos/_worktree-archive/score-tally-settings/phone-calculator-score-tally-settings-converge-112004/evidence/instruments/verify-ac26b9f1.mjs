#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const ROUND = String(process.argv[2] ?? process.env.KEKKAI_ROUND ?? "1").replace(/^r/i, "");
const ARTIFACT = resolveScriptPath(process.env.KEKKAI_ARTIFACT, path.join(HERE, "../../../index.html"));
const OUT_DIR = resolveScriptPath(process.env.KEKKAI_OUT_DIR, path.join(HERE, "attempts", "manual"));
const SHOTS_DIR = path.join(OUT_DIR, "review-shots", `r${ROUND}`);
const REVIEW_STATES = ["S1", "S2", "S3", "S4"];
const H_IDS = ["H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H9"];
const SETTINGS_KEY = "cal-phone.settings.v1";
const TOL = 1e-9;
const LAYOUT_TOL = 0.5;
const MIN_CONTROL = 43.5;
const MIN_INPUT_FONT = 15.5;

const chrome = await import(pathToFileURL("/ws/cal_phone/tests/lib/browser.mjs").href);
const selectorsModule = await import(pathToFileURL("/ws/cal_phone/tests/lib/selectors.mjs").href);
const { launchBrowser, openApp } = chrome;
const { S } = selectorsModule;

const ARTIFACT_SHA256 = sha256File(ARTIFACT);
const VERIFIER_SHA256 = sha256File(SELF);
const checks = Object.fromEntries(H_IDS.map((id) => [id, []]));
const evidence = Object.fromEntries(H_IDS.map((id) => [id, {}]));
const trackedPages = [];
let browser = null;
let suiteResults = [];
let suiteFailure = null;
const renderAudit = { states: [], issues: [], error: null, metricsText: "", metricsSha256: null, manifest: null };

function resolveScriptPath(value, fallback) {
  if (!value) return path.resolve(fallback);
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(HERE, value);
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function brief(value, limit = 500) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function fmt(value) {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function addCheck(h, id, pass, detail = "") {
  checks[h].push({ id, pass: Boolean(pass), detail: String(detail) });
}

function checkTrue(h, id, pass, detail = "") {
  addCheck(h, id, pass, pass ? detail : detail || "false");
}

function checkEq(h, id, actual, expected, detail = "") {
  const pass = isDeepStrictEqual(actual, expected);
  addCheck(
    h,
    id,
    pass,
    pass ? fmt(actual) : `expected ${fmt(expected)}, got ${fmt(actual)}${detail ? ` — ${detail}` : ""}`,
  );
}

function checkNear(h, id, actual, expected, tolerance = TOL, detail = "") {
  const number = Number(actual);
  const pass = Number.isFinite(number) && Math.abs(number - Number(expected)) <= tolerance;
  addCheck(h, id, pass, pass ? String(number) : `expected ${expected} ± ${tolerance}, got ${fmt(actual)}${detail ? ` — ${detail}` : ""}`);
}

function addEvidence(h, key, value) {
  evidence[h][key] = value;
}

async function runH(id, fn) {
  const started = Date.now();
  try {
    await fn();
  } catch (error) {
    addCheck(id, `${id.toLowerCase()}.uncaught`, false, error && error.stack ? error.stack : String(error));
  } finally {
    addEvidence(id, "elapsed_ms", Date.now() - started);
  }
}

async function ensureBrowser() {
  if (!browser) browser = await launchBrowser();
  return browser;
}

function track(app) {
  trackedPages.push({ pageErrors: app.pageErrors, consoleErrors: app.consoleErrors });
  return app;
}

async function openStandard(options = {}) {
  const app = await openApp(await ensureBrowser(), ARTIFACT, options);
  return track(app);
}

async function openCustom(options = {}) {
  const currentBrowser = await ensureBrowser();
  const contextOptions = {
    viewport: options.viewport ?? { width: 390, height: 844 },
    isMobile: options.isMobile ?? true,
    hasTouch: options.hasTouch ?? true,
  };
  if (options.reducedMotion) contextOptions.reducedMotion = options.reducedMotion;
  const context = await currentBrowser.newContext(contextOptions);
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
  if (options.cdp320) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 320,
      height: 568,
      deviceScaleFactor: 2,
      mobile: true,
    });
  }
  await page.goto(pathToFileURL(ARTIFACT).href, { waitUntil: "load" });
  return track({
    context,
    page,
    pageErrors,
    consoleErrors,
    async close() {
      await context.close();
    },
  });
}

async function withStandard(fn, options = {}) {
  const app = await openStandard(options);
  try {
    return await fn(app);
  } finally {
    await app.close();
  }
}

async function isVisible(page, selector) {
  return page.$eval(selector, (element) => {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    return element.getClientRects().length > 0;
  });
}

async function rectOf(page, selector) {
  return page.$eval(selector, (element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
  });
}

async function appState(page) {
  return page.$eval(S.app, (element) => element.dataset.state);
}

async function expressionText(page) {
  return page.$eval(S.expression, (element) => (element.textContent || "").trim());
}

async function resultValue(page) {
  return page.$eval(S.result, (element) => element.getAttribute("data-value"));
}

async function resultError(page) {
  return page.$eval(S.result, (element) => element.getAttribute("data-error"));
}

async function stateLabel(page) {
  return page.$eval("#state-label", (element) => (element.textContent || "").trim());
}

async function historyCount(page) {
  return page.locator(S.historyItem).count();
}

async function historySnapshots(page) {
  return page.$$eval(S.historyItem, (items) =>
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

async function readCore(page) {
  return page.evaluate(
    ({ appSelector, inputSelector, expressionSelector, resultSelector, historySelector }) => {
      const app = document.querySelector(appSelector);
      const input = document.querySelector(inputSelector);
      const expression = document.querySelector(expressionSelector);
      const result = document.querySelector(resultSelector);
      return {
        input: input ? input.value : null,
        expression: expression ? (expression.textContent || "").trim() : null,
        state: app ? app.dataset.state : null,
        history: document.querySelectorAll(historySelector).length,
        result: result ? result.getAttribute("data-value") : null,
        error: result ? result.getAttribute("data-error") : null,
        label: (document.querySelector("#state-label")?.textContent || "").trim(),
      };
    },
    {
      appSelector: S.app,
      inputSelector: S.calcInput,
      expressionSelector: S.expression,
      resultSelector: S.result,
      historySelector: S.historyItem,
    },
  );
}

async function pressScreen(page, key) {
  await page.locator(`${S.keypad} [data-key="${key}"]`).click();
}

async function typeScreen(page, text) {
  for (const character of String(text)) await pressScreen(page, character);
}

async function enterScreenValue(page, text) {
  await typeScreen(page, text);
  await pressScreen(page, "enter");
}

async function chooseOperator(page, operator) {
  await page.locator(`${S.picker} [data-op="${operator}"]`).click();
}

async function pressEquals(page) {
  await page.locator(S.equals).click();
}

async function pressBackspace(page) {
  await page.locator(`${S.keypad} [data-key="backspace"]`).click();
}

async function openSettingsPanel(page) {
  await page.locator('[data-testid="settings-toggle"]').click();
}

async function configureSettings(page, { autoConfirm, baseEnabled, baseText, close = true } = {}) {
  await openSettingsPanel(page);
  if (autoConfirm !== undefined) {
    await page.locator('[data-testid="settings-auto-confirm"]').selectOption(String(autoConfirm));
  }
  const toggle = page.locator('[data-testid="settings-base-toggle"]');
  if (baseEnabled !== undefined && (await toggle.isChecked()) !== baseEnabled) {
    if (baseEnabled) await toggle.check();
    else await toggle.uncheck();
  }
  if (baseText !== undefined) {
    await page.locator('[data-testid="settings-base-value"]').fill(String(baseText));
  }
  if (close) await page.locator('[data-testid="settings-done"]').click();
}

async function closeSettings(page) {
  await page.locator('[data-testid="settings-done"]').click();
}

async function waitForConfiguredSeconds(page, seconds) {
  const milliseconds = seconds > 0 ? Math.max(900, Math.ceil(seconds * 1400)) : 1200;
  await page.waitForTimeout(milliseconds);
}

async function focusInfo(page) {
  return page.evaluate(() => {
    const gear = document.querySelector('[data-testid="settings-toggle"]');
    const panel = document.querySelector('[data-testid="settings-panel"]');
    return {
      tag: document.activeElement ? document.activeElement.tagName : null,
      inPanel: Boolean(panel && panel.contains(document.activeElement)),
      gear: document.activeElement === gear,
    };
  });
}

async function dialogInfo(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[data-testid="settings-panel"]');
    const gear = document.querySelector('[data-testid="settings-toggle"]');
    return {
      tagName: dialog ? dialog.tagName : null,
      open: Boolean(dialog && dialog.open),
      modal: Boolean(dialog && dialog.matches(":modal")),
      expanded: gear ? gear.getAttribute("aria-expanded") : null,
      focusInside: Boolean(dialog && dialog.contains(document.activeElement)),
    };
  });
}

async function testH1() {
  const viewport = { width: 390, height: 844 };
  await withStandard(async ({ page }) => {
    const gear = page.locator('[data-testid="settings-toggle"]');
    const gearVisible = await gear.isVisible();
    const gearRect = await rectOf(page, '[data-testid="settings-toggle"]');
    const haspopup = await gear.getAttribute("aria-haspopup");
    const initialExpanded = await gear.getAttribute("aria-expanded");
    addEvidence("H1", "gear", { visible: gearVisible, rect: gearRect, haspopup, expanded: initialExpanded });
    checkTrue("H1", "h1.gear.visible", gearVisible);
    checkTrue("H1", "h1.gear.size", gearRect.width >= 44 && gearRect.height >= 44, fmt(gearRect));
    checkTrue("H1", "h1.gear.position", gearRect.right > viewport.width / 2 && gearRect.y < 100, fmt(gearRect));
    checkEq("H1", "h1.gear.haspopup", haspopup, "dialog");
    checkEq("H1", "h1.gear.expanded.initial", initialExpanded, "false");

    await gear.click();
    const opened = await dialogInfo(page);
    addEvidence("H1", "open", opened);
    checkEq("H1", "h1.open.tagName", opened.tagName, "DIALOG");
    checkTrue("H1", "h1.open.open", opened.open);
    checkTrue("H1", "h1.open.modal", opened.modal);
    checkTrue("H1", "h1.open.focusInside", opened.focusInside);
    checkEq("H1", "h1.open.expanded", opened.expanded, "true");

    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    const escapeInfo = await dialogInfo(page);
    const escapeFocus = await focusInfo(page);
    addEvidence("H1", "escape", { dialog: escapeInfo, focus: escapeFocus });
    checkTrue("H1", "h1.close.escape.closed", !escapeInfo.open);
    checkTrue("H1", "h1.close.escape.focusGear", escapeFocus.gear);
    checkEq("H1", "h1.close.escape.expanded", escapeInfo.expanded, "false");

    await gear.click();
    await page.locator('[data-testid="settings-done"]').click();
    await page.waitForTimeout(100);
    const doneInfo = await dialogInfo(page);
    const doneFocus = await focusInfo(page);
    addEvidence("H1", "done", { dialog: doneInfo, focus: doneFocus });
    checkTrue("H1", "h1.close.done.closed", !doneInfo.open);
    checkTrue("H1", "h1.close.done.focusGear", doneFocus.gear);
    checkEq("H1", "h1.close.done.expanded", doneInfo.expanded, "false");

    await gear.click();
    await page.mouse.click(2, viewport.height - 2);
    await page.waitForTimeout(100);
    const backdropInfo = await dialogInfo(page);
    const backdropFocus = await focusInfo(page);
    addEvidence("H1", "backdrop", { dialog: backdropInfo, focus: backdropFocus });
    checkTrue("H1", "h1.close.backdrop.closed", !backdropInfo.open);
    checkTrue("H1", "h1.close.backdrop.focusGear", backdropFocus.gear);
    checkEq("H1", "h1.close.backdrop.expanded", backdropInfo.expanded, "false");

    await configureSettings(page, { autoConfirm: 1 });
    const onVisible = await isVisible(page, '[data-testid="settings-indicator"]');
    await configureSettings(page, { autoConfirm: 0, baseEnabled: false });
    const offVisible = await isVisible(page, '[data-testid="settings-indicator"]');
    addEvidence("H1", "indicator", { on: onVisible, off: offVisible });
    checkTrue("H1", "h1.indicator.on", onVisible);
    checkTrue("H1", "h1.indicator.off", !offVisible);
  });
}

async function testH2() {
  await withStandard(async ({ page }) => {
    const select = page.locator('[data-testid="settings-auto-confirm"]');
    const optionValues = await select.locator("option").evaluateAll((options) => options.map((option) => option.value));
    const expectedOptions = Array.from({ length: 21 }, (_, index) => String(index / 2));
    const selected = await select.inputValue();
    const baseToggle = page.locator('[data-testid="settings-base-toggle"]');
    const baseValue = page.locator('[data-testid="settings-base-value"]');
    const defaultBaseChecked = await baseToggle.isChecked();
    const defaultBaseDisabled = await baseValue.isDisabled();
    const defaultBaseValue = await baseValue.inputValue();
    const defaultStored = await page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY);
    addEvidence("H2", "default", {
      options: optionValues,
      selected,
      baseChecked: defaultBaseChecked,
      baseDisabled: defaultBaseDisabled,
      baseValue: defaultBaseValue,
      stored: defaultStored,
    });
    checkEq("H2", "h2.default.options", optionValues, expectedOptions);
    checkEq("H2", "h2.default.selected", selected, "0");
    checkTrue("H2", "h2.default.baseChecked", !defaultBaseChecked);
    checkTrue("H2", "h2.default.baseDisabled", defaultBaseDisabled);
    checkEq("H2", "h2.default.baseValue", defaultBaseValue, "0");
    checkTrue("H2", "h2.default.storageEmpty", defaultStored === null || defaultStored === "", fmt(defaultStored));

    await configureSettings(page, { autoConfirm: 1, baseEnabled: true, baseText: "10" });
    const stored = await page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY);
    addEvidence("H2", "stored", stored);
    checkTrue("H2", "h2.stored.nonEmpty", typeof stored === "string" && stored.length > 0, fmt(stored));

    await page.reload({ waitUntil: "load" });
    const reloadInfo = {
      t: await select.inputValue(),
      baseChecked: await baseToggle.isChecked(),
      baseDisabled: await baseValue.isDisabled(),
      baseValue: await baseValue.inputValue(),
    };
    addEvidence("H2", "reload", reloadInfo);
    checkEq("H2", "h2.reload.t", reloadInfo.t, "1");
    checkTrue("H2", "h2.reload.baseChecked", reloadInfo.baseChecked);
    checkTrue("H2", "h2.reload.baseEnabled", !reloadInfo.baseDisabled);
    checkEq("H2", "h2.reload.baseValue", reloadInfo.baseValue, "10");

    await chooseOperator(page, "+");
    await enterScreenValue(page, "9.5");
    await pressEquals(page);
    const computed = await readCore(page);
    addEvidence("H2", "compute", computed);
    checkEq("H2", "h2.compute.result", computed.result, "19.5");
    checkEq("H2", "h2.compute.history", computed.history, 1);

    await page.locator(S.keyOp).click();
    const historyBeforeReload = await historyCount(page);
    await openSettingsPanel(page);
    const retained = {
      t: await select.inputValue(),
      baseChecked: await baseToggle.isChecked(),
      baseValue: await baseValue.inputValue(),
    };
    await closeSettings(page);
    addEvidence("H2", "afterReset", { settings: retained, history: historyBeforeReload });
    checkEq("H2", "h2.afterReset.t", retained.t, "1");
    checkTrue("H2", "h2.afterReset.baseChecked", retained.baseChecked);
    checkEq("H2", "h2.afterReset.baseValue", retained.baseValue, "10");
    checkEq("H2", "h2.afterReset.history", historyBeforeReload, 1);

    await page.reload({ waitUntil: "load" });
    const historyAfterReload = await historyCount(page);
    addEvidence("H2", "historyAfterReload", historyAfterReload);
    checkEq("H2", "h2.reload.historyEmpty", historyAfterReload, 0);
  });

  const disabled = await openCustom({
    initScript: () => {
      Object.defineProperty(Storage.prototype, "getItem", {
        configurable: true,
        value() {
          throw new Error("storage getItem blocked");
        },
      });
      Object.defineProperty(Storage.prototype, "setItem", {
        configurable: true,
        value() {
          throw new Error("storage setItem blocked");
        },
      });
    },
  });
  try {
    const { page } = disabled;
    await configureSettings(page, { autoConfirm: 1 });
    await typeScreen(page, "9.5");
    await page.waitForTimeout(1400);
    const core = await readCore(page);
    addEvidence("H2", "storageDisabled", {
      ...core,
      pageErrors: disabled.pageErrors,
      consoleErrors: disabled.consoleErrors,
    });
    checkEq("H2", "h2.storageDisabled.input", core.input, "");
    checkTrue("H2", "h2.storageDisabled.expression", core.expression.includes("9.5"), core.expression);
    checkEq("H2", "h2.storageDisabled.state", core.state, "input");
    checkEq("H2", "h2.storageDisabled.history", core.history, 0);
    checkEq("H2", "h2.storageDisabled.pageErrors", disabled.pageErrors.length, 0, disabled.pageErrors.join(" | "));
  } finally {
    await disabled.close();
  }
}

async function testH3() {
  await withStandard(async ({ page }) => {
    await typeScreen(page, "9.5");
    await page.waitForTimeout(1200);
    const core = await readCore(page);
    addEvidence("H3", "t0", { input: core.input, expression: core.expression, history: core.history, result: core.result, state: core.state });
    checkEq("H3", "h3.t0.input", core.input, "9.5");
    checkEq("H3", "h3.t0.expression", core.expression, "");
    checkEq("H3", "h3.t0.history", core.history, 0);
    checkEq("H3", "h3.t0.result", core.result, null);
  });

  await withStandard(async ({ page }) => {
    await configureSettings(page, { autoConfirm: 0.5 });
    await typeScreen(page, "9.5");
    await page.waitForTimeout(900);
    const core = await readCore(page);
    addEvidence("H3", "t05", core);
    checkEq("H3", "h3.t05.input", core.input, "");
    checkTrue("H3", "h3.t05.expression", core.expression.includes("9.5"), core.expression);
    checkEq("H3", "h3.t05.state", core.state, "input");
    checkEq("H3", "h3.t05.history", core.history, 0);
    checkEq("H3", "h3.t05.result", core.result, null);
    checkTrue("H3", "h3.t05.label", core.label.includes("9.5"), core.label);
  });

  await withStandard(async ({ page }) => {
    await configureSettings(page, { autoConfirm: 1 });
    await typeScreen(page, "9");
    await page.waitForTimeout(600);
    const interimInput = await page.locator(S.calcInput).inputValue();
    await typeScreen(page, "5");
    await page.waitForTimeout(1400);
    const core = await readCore(page);
    addEvidence("H3", "timerReset", { interimInput, ...core });
    checkEq("H3", "h3.timerReset.expression", core.expression, "95");
    checkEq("H3", "h3.timerReset.input", core.input, "");
    checkEq("H3", "h3.timerReset.history", core.history, 0);
    checkEq("H3", "h3.timerReset.state", core.state, "input");
  });

  await withStandard(async ({ page }) => {
    await configureSettings(page, { autoConfirm: 0.5 });
    await typeScreen(page, "9.");
    await page.waitForTimeout(900);
    const heldInput = await page.locator(S.calcInput).inputValue();
    const heldExpression = await expressionText(page);
    await typeScreen(page, "5");
    await page.waitForTimeout(900);
    const core = await readCore(page);
    addEvidence("H3", "trailingDot", { heldInput, heldExpression, ...core });
    checkEq("H3", "h3.trailingDot.heldInput", heldInput, "9.");
    checkEq("H3", "h3.trailingDot.heldExpression", heldExpression, "");
    checkEq("H3", "h3.trailingDot.completedInput", core.input, "");
    checkTrue("H3", "h3.trailingDot.completedExpression", core.expression.includes("9.5"), core.expression);
  });

  await withStandard(async ({ page }) => {
    await configureSettings(page, { autoConfirm: 1 });
    await typeScreen(page, "9.5");
    await openSettingsPanel(page);
    await page.waitForTimeout(1400);
    const whileOpen = {
      input: await page.locator(S.calcInput).inputValue(),
      expression: await expressionText(page),
    };
    await closeSettings(page);
    await page.waitForTimeout(1400);
    const afterClose = await readCore(page);
    addEvidence("H3", "panelPause", { whileOpen, afterClose });
    checkEq("H3", "h3.panelPause.inputWhileOpen", whileOpen.input, "9.5");
    checkEq("H3", "h3.panelPause.expressionWhileOpen", whileOpen.expression, "");
    checkEq("H3", "h3.panelPause.inputAfterClose", afterClose.input, "");
    checkTrue("H3", "h3.panelPause.expressionAfterClose", afterClose.expression.includes("9.5"), afterClose.expression);
  });

  await withStandard(async ({ page }) => {
    await configureSettings(page, { autoConfirm: 1 });
    await typeScreen(page, "9.5");
    await pressScreen(page, "enter");
    await page.waitForTimeout(1400);
    const core = await readCore(page);
    addEvidence("H3", "manualEnter", core);
    checkEq("H3", "h3.manualEnter.expression", core.expression, "9.5");
    checkEq("H3", "h3.manualEnter.history", core.history, 0);
    checkEq("H3", "h3.manualEnter.input", core.input, "");
  });

  await withStandard(async ({ page }) => {
    await configureSettings(page, { autoConfirm: 1 });
    await chooseOperator(page, "+");
    await enterScreenValue(page, "9.5");
    await typeScreen(page, "9.2");
    await pressEquals(page);
    await page.waitForTimeout(1500);
    const core = await readCore(page);
    addEvidence("H3", "equals", core);
    checkEq("H3", "h3.equals.result", core.result, "18.7");
    checkEq("H3", "h3.equals.history", core.history, 1);
    checkEq("H3", "h3.equals.input", core.input, "");
    checkEq("H3", "h3.equals.state", core.state, "result");
  });

  await withStandard(async ({ page }) => {
    await configureSettings(page, { autoConfirm: 1 });
    await typeScreen(page, "9");
    await page.locator(S.keyOp).click();
    await page.waitForTimeout(1400);
    const core = await readCore(page);
    addEvidence("H3", "reset", core);
    checkEq("H3", "h3.reset.state", core.state, "select");
    checkEq("H3", "h3.reset.expression", core.expression, "");
    checkEq("H3", "h3.reset.input", core.input, "");
    checkEq("H3", "h3.reset.history", core.history, 0);
  });

  await withStandard(async ({ page }) => {
    await configureSettings(page, { autoConfirm: 1 });
    await typeScreen(page, "9");
    await page.waitForTimeout(600);
    await chooseOperator(page, "+");
    await page.waitForTimeout(1400);
    const core = await readCore(page);
    addEvidence("H3", "operatorChange", core);
    checkEq("H3", "h3.operatorChange.input", core.input, "");
    checkEq("H3", "h3.operatorChange.state", core.state, "input");
    checkTrue("H3", "h3.operatorChange.committedValue", core.expression.includes("9"), core.expression);
    checkTrue("H3", "h3.operatorChange.label", core.label.includes("9"), core.label);
    checkEq("H3", "h3.operatorChange.history", core.history, 0);
  });

  await withStandard(async ({ page }) => {
    await configureSettings(page, { autoConfirm: 1 });
    await typeScreen(page, "9");
    const progressVisible = await isVisible(page, '[data-testid="auto-confirm-progress"]');
    const progressActive = await page.locator('[data-testid="auto-confirm-progress"]').getAttribute("data-active");
    const progressRect = await rectOf(page, '[data-testid="auto-confirm-progress"]');
    await page.waitForTimeout(1400);
    const afterActive = await page.locator('[data-testid="auto-confirm-progress"]').getAttribute("data-active");
    addEvidence("H3", "progress", { visible: progressVisible, active: progressActive, rect: progressRect, afterActive });
    checkTrue("H3", "h3.progress.visible", progressVisible);
    checkEq("H3", "h3.progress.active", progressActive, "true");
    checkTrue("H3", "h3.progress.height", progressRect.height >= 1 && progressRect.height <= 4, fmt(progressRect));
    checkTrue("H3", "h3.progress.afterActive", afterActive !== "true", String(afterActive));
  });

  const reduced = await openCustom({ reducedMotion: "reduce" });
  try {
    const { page } = reduced;
    await configureSettings(page, { autoConfirm: 0.5 });
    await typeScreen(page, "9.5");
    await page.waitForTimeout(900);
    const core = await readCore(page);
    addEvidence("H3", "reducedMotion", core);
    checkEq("H3", "h3.reducedMotion.input", core.input, "");
    checkTrue("H3", "h3.reducedMotion.expression", core.expression.includes("9.5"), core.expression);
    checkEq("H3", "h3.reducedMotion.history", core.history, 0);
    checkTrue("H3", "h3.reducedMotion.label", core.label.includes("9.5"), core.label);
  } finally {
    await reduced.close();
  }
}

async function baseCase(base, operator, values) {
  return withStandard(async ({ page }) => {
    if (base !== null) await configureSettings(page, { baseEnabled: true, baseText: String(base) });
    await chooseOperator(page, operator);
    for (const value of values) await enterScreenValue(page, value);
    await pressEquals(page);
    return { core: await readCore(page), history: await historySnapshots(page) };
  });
}

async function testH4() {
  const baseOff = await baseCase(null, "+", ["9.5", "9.2", "9.0"]);
  addEvidence("H4", "baseOff", baseOff);
  checkNear("H4", "h4.baseOff.result", baseOff.core.result, 27.7);
  checkEq("H4", "h4.baseOff.historyCount", baseOff.history.length, 1);
  checkEq("H4", "h4.baseOff.historyBase", baseOff.history[0]?.["data-base"], null);
  checkEq("H4", "h4.baseOff.operands", baseOff.history[0]?.operands, ["9.5", "9.2", "9.0"]);

  const base10 = await withStandard(async ({ page }) => {
    await configureSettings(page, { baseEnabled: true, baseText: "10" });
    await chooseOperator(page, "+");
    const markerBefore = {
      visible: await isVisible(page, '[data-testid="base-marker"]'),
      text: await page.locator('[data-testid="base-marker"]').textContent(),
    };
    for (const value of ["9.5", "9.2", "9.0"]) await enterScreenValue(page, value);
    await pressEquals(page);
    return {
      core: await readCore(page),
      history: await historySnapshots(page),
      markerBefore,
      markerAfter: {
        visible: await isVisible(page, '[data-testid="base-marker"]'),
        text: await page.locator('[data-testid="base-marker"]').textContent(),
      },
    };
  });
  addEvidence("H4", "base10", base10);
  checkNear("H4", "h4.base10.result", base10.core.result, 37.7);
  checkEq("H4", "h4.base10.historyBase", base10.history[0]?.["data-base"], "10");
  checkEq("H4", "h4.base10.operands", base10.history[0]?.operands, ["9.5", "9.2", "9.0"]);
  checkTrue("H4", "h4.base10.expressionHasBase", base10.history[0]?.expression.split(" ").includes("10"), base10.history[0]?.expression);
  checkTrue("H4", "h4.base10.markerVisible", base10.markerAfter.visible);
  checkTrue("H4", "h4.base10.markerText", String(base10.markerAfter.text).includes("10"), String(base10.markerAfter.text));

  const base100 = await baseCase(100, "/", ["4"]);
  addEvidence("H4", "base100", base100);
  checkNear("H4", "h4.base100.result", base100.core.result, 25);

  const base0 = await baseCase(0, "*", ["5"]);
  addEvidence("H4", "base0", base0);
  checkNear("H4", "h4.base0.result", base0.core.result, 0);
  checkEq("H4", "h4.base0.historyBase", base0.history[0]?.["data-base"], "0");

  const baseNegative = await baseCase(-2.5, "+", ["1"]);
  addEvidence("H4", "baseNegative", baseNegative);
  checkNear("H4", "h4.baseNegative.result", baseNegative.core.result, -1.5);

  const noOperator = await withStandard(async ({ page }) => {
    await configureSettings(page, { baseEnabled: true, baseText: "10" });
    await enterScreenValue(page, "9.5");
    const without = {
      expression: await expressionText(page),
      markerVisible: await isVisible(page, '[data-testid="base-marker"]'),
    };
    await chooseOperator(page, "+");
    const withOperator = {
      expression: await expressionText(page),
      label: await stateLabel(page),
      markerVisible: await isVisible(page, '[data-testid="base-marker"]'),
    };
    return { without, withOperator };
  });
  addEvidence("H4", "noOperator", noOperator);
  checkTrue("H4", "h4.noOperator.expressionWithoutBase", !noOperator.without.expression.includes("10"), noOperator.without.expression);
  checkTrue("H4", "h4.noOperator.expressionWithBase", noOperator.withOperator.expression.includes("10"), noOperator.withOperator.expression);
  checkTrue("H4", "h4.noOperator.labelWithBase", noOperator.withOperator.label.includes("10"), noOperator.withOperator.label);

  const liveRedraw = await withStandard(async ({ page }) => {
    await configureSettings(page, { baseEnabled: true, baseText: "10" });
    await chooseOperator(page, "+");
    await enterScreenValue(page, "9.5");
    const before = await expressionText(page);
    await openSettingsPanel(page);
    await page.locator('[data-testid="settings-base-value"]').fill("20");
    const after = await expressionText(page);
    await closeSettings(page);
    return { before, after };
  });
  addEvidence("H4", "liveRedraw", liveRedraw);
  checkTrue("H4", "h4.liveRedraw.contains20", liveRedraw.after.includes("20"), liveRedraw.after);
  checkTrue("H4", "h4.liveRedraw.omits10", !liveRedraw.after.split(/[^0-9.+-]+/).includes("10"), liveRedraw.after);

  const invalidBase = await withStandard(async ({ page }) => {
    await configureSettings(page, { baseEnabled: true, baseText: "10" });
    await openSettingsPanel(page);
    const input = page.locator('[data-testid="settings-base-value"]');
    await input.fill("");
    const emptyDuringEdit = await input.inputValue();
    await closeSettings(page);
    const restored = await input.inputValue();
    await chooseOperator(page, "+");
    await enterScreenValue(page, "9.5");
    await pressEquals(page);
    const core = await readCore(page);
    const history = await historySnapshots(page);
    return { emptyDuringEdit, restored, baseFinite: Number.isFinite(Number(restored)), core, history };
  });
  addEvidence("H4", "invalidBase", invalidBase);
  checkTrue("H4", "h4.invalidBase.baseFinite", invalidBase.baseFinite, String(invalidBase.restored));
  checkNear("H4", "h4.invalidBase.result", invalidBase.core.result, 19.5);
  checkEq("H4", "h4.invalidBase.historyBase", invalidBase.history[0]?.["data-base"], "10");

  const divZero = await withStandard(async ({ page }) => {
    await configureSettings(page, { baseEnabled: true, baseText: "10" });
    await chooseOperator(page, "/");
    await enterScreenValue(page, "5");
    await enterScreenValue(page, "0");
    await pressEquals(page);
    return readCore(page);
  });
  addEvidence("H4", "divZero", divZero);
  checkEq("H4", "h4.divZero.error", divZero.error, "true");
  checkEq("H4", "h4.divZero.value", divZero.result, null);
  checkEq("H4", "h4.divZero.history", divZero.history, 0);

  const snapshot = await withStandard(async ({ page }) => {
    await configureSettings(page, { baseEnabled: true, baseText: "10" });
    await chooseOperator(page, "+");
    await enterScreenValue(page, "2");
    await enterScreenValue(page, "3");
    await pressEquals(page);
    const firstResult = await resultValue(page);
    await configureSettings(page, { baseEnabled: true, baseText: "20" });
    await chooseOperator(page, "+");
    await enterScreenValue(page, "2");
    await enterScreenValue(page, "3");
    await pressEquals(page);
    const beforeEdit = await historySnapshots(page);
    await page.locator(S.historyEdit).nth(1).click();
    const editMarker = {
      visible: await isVisible(page, '[data-testid="edit-base-marker"]'),
      text: await page.locator('[data-testid="edit-base-marker"]').textContent(),
    };
    const operandCount = await page.locator(S.operandInput).count();
    await page.locator(S.operandInput).nth(1).fill("5");
    await pressEquals(page);
    const afterEdit = await historySnapshots(page);
    const marker = {
      visible: await isVisible(page, '[data-testid="base-marker"]'),
      text: await page.locator('[data-testid="base-marker"]').textContent(),
    };
    return { firstResult, beforeEdit, editMarker, operandCount, afterEdit, marker };
  });
  addEvidence("H4", "snapshot", snapshot);
  checkNear("H4", "h4.snapshot.firstResult", snapshot.firstResult, 15);
  checkEq("H4", "h4.snapshot.historyCount", snapshot.beforeEdit.length, 2);
  checkEq("H4", "h4.snapshot.bases", snapshot.beforeEdit.map((item) => item["data-base"]), ["20", "10"]);
  checkEq("H4", "h4.snapshot.results", snapshot.beforeEdit.map((item) => item.result), ["25", "15"]);
  checkTrue("H4", "h4.snapshot.editMarkerVisible", snapshot.editMarker.visible);
  checkTrue("H4", "h4.snapshot.editMarkerText", String(snapshot.editMarker.text).includes("10"), String(snapshot.editMarker.text));
  checkEq("H4", "h4.snapshot.operandCount", snapshot.operandCount, 2);
  const old = snapshot.beforeEdit[1];
  const expectedEdited = Number(old["data-base"]) + Number(old.operands[0]) + 5;
  checkEq("H4", "h4.snapshot.editedBase", snapshot.afterEdit[0]?.["data-base"], "10");
  checkNear("H4", "h4.snapshot.editedResult", snapshot.afterEdit[0]?.result, expectedEdited);
  checkTrue("H4", "h4.snapshot.editedExpression", snapshot.afterEdit[0]?.expression.includes("10") && snapshot.afterEdit[0]?.expression.includes("5"), snapshot.afterEdit[0]?.expression);
  checkTrue("H4", "h4.snapshot.baseMarkerVisible", snapshot.marker.visible);
  checkTrue("H4", "h4.snapshot.baseMarkerText", String(snapshot.marker.text).includes("20"), String(snapshot.marker.text));
}

async function testH5() {
  await withStandard(async ({ page }) => {
    await chooseOperator(page, "+");
    await enterScreenValue(page, "9.5");
    await enterScreenValue(page, "9.2");
    await pressBackspace(page);
    const first = await readCore(page);
    await pressBackspace(page);
    const second = await readCore(page);
    addEvidence("H5", "withdraw", { first, second });
    checkTrue("H5", "h5.withdraw.firstExpression", !first.expression.includes("9.2"), first.expression);
    checkTrue("H5", "h5.withdraw.firstLabel", first.label.includes("9.2"), first.label);
    checkEq("H5", "h5.withdraw.firstState", first.state, "input");
    checkEq("H5", "h5.withdraw.firstHistory", first.history, 0);
    checkTrue("H5", "h5.withdraw.secondExpression", !second.expression.includes("9.5") && !second.expression.includes("9.2"), second.expression);
    checkTrue("H5", "h5.withdraw.secondLabel", second.label.includes("9.5"), second.label);
    checkEq("H5", "h5.withdraw.secondHistory", second.history, 0);
    checkEq("H5", "h5.withdraw.secondState", second.state, "input");
  });

  await withStandard(async ({ page }) => {
    await chooseOperator(page, "+");
    await enterScreenValue(page, "9.5");
    const expressionBefore = await expressionText(page);
    await typeScreen(page, "95");
    const inputBefore = await page.locator(S.calcInput).inputValue();
    await pressBackspace(page);
    const inputAfter = await page.locator(S.calcInput).inputValue();
    const expressionAfter = await expressionText(page);
    addEvidence("H5", "nonEmptyInput", { inputBefore, inputAfter, expressionBefore, expressionAfter });
    checkEq("H5", "h5.nonEmptyInput.value", inputAfter, "9");
    checkEq("H5", "h5.nonEmptyInput.expressionUnchanged", expressionAfter, expressionBefore);
  });

  await withStandard(async ({ page }) => {
    await configureSettings(page, { baseEnabled: true, baseText: "10" });
    await chooseOperator(page, "+");
    await enterScreenValue(page, "9.5");
    await enterScreenValue(page, "9.2");
    await pressBackspace(page);
    await pressBackspace(page);
    const withdrawn = await readCore(page);
    await enterScreenValue(page, "1");
    await enterScreenValue(page, "1");
    await pressEquals(page);
    const continued = await readCore(page);
    addEvidence("H5", "baseWithdraw", { withdrawn, continued });
    checkTrue("H5", "h5.baseWithdraw.keepsBase", withdrawn.expression.includes("10"), withdrawn.expression);
    checkTrue("H5", "h5.baseWithdraw.omitsOperands", !withdrawn.expression.includes("9.5") && !withdrawn.expression.includes("9.2"), withdrawn.expression);
    checkEq("H5", "h5.baseWithdraw.state", withdrawn.state, "input");
    checkEq("H5", "h5.baseWithdraw.history", withdrawn.history, 0);
    checkNear("H5", "h5.baseWithdraw.continuedResult", continued.result, 12);
  });

  await withStandard(async ({ page }) => {
    await chooseOperator(page, "+");
    await enterScreenValue(page, "1");
    await enterScreenValue(page, "2");
    await pressEquals(page);
    const before = await readCore(page);
    await pressBackspace(page);
    const after = await readCore(page);
    addEvidence("H5", "resultState", { before, after });
    checkEq("H5", "h5.resultState.state", after.state, "result");
    checkNear("H5", "h5.resultState.result", after.result, 3);
    checkEq("H5", "h5.resultState.history", after.history, 1);
  });

  await withStandard(async ({ page }) => {
    await chooseOperator(page, "/");
    await enterScreenValue(page, "5");
    await enterScreenValue(page, "0");
    await pressEquals(page);
    const before = await appState(page);
    await pressBackspace(page);
    const after = await readCore(page);
    addEvidence("H5", "errorState", { before, after });
    checkEq("H5", "h5.errorState.state", after.state, "error");
    checkEq("H5", "h5.errorState.error", after.error, "true");
    checkEq("H5", "h5.errorState.history", after.history, 0);
  });

  await withStandard(async ({ page }) => {
    await configureSettings(page, { baseEnabled: true, baseText: "10" });
    await chooseOperator(page, "+");
    await enterScreenValue(page, "2");
    await enterScreenValue(page, "3");
    await pressEquals(page);
    await page.locator(S.historyEdit).first().click();
    const initialChips = await page.locator(S.operandChip).count();
    await page.locator(S.calcInput).click();
    const mainFocused = await page.evaluate(() => document.activeElement === document.querySelector('[data-testid="calc-input"]'));
    await page.keyboard.press("Backspace");
    const chipsAfterMain = await page.locator(S.operandChip).count();
    await page.locator(S.operandInput).first().click();
    const operandValueBefore = await page.locator(S.operandInput).first().inputValue();
    await page.keyboard.press("Backspace");
    const operandValueAfter = await page.locator(S.operandInput).first().inputValue();
    const chipsAfterOperand = await page.locator(S.operandChip).count();
    addEvidence("H5", "editWithdraw", {
      initialChips,
      mainFocused,
      chipsAfterMain,
      operandValueBefore,
      operandValueAfter,
      chipsAfterOperand,
    });
    checkEq("H5", "h5.editWithdraw.initialChips", initialChips, 2);
    checkTrue("H5", "h5.editWithdraw.mainFocused", mainFocused);
    checkEq("H5", "h5.editWithdraw.chipsAfterMain", chipsAfterMain, 1);
    checkEq("H5", "h5.editWithdraw.chipsAfterOperand", chipsAfterOperand, 1);
    checkEq("H5", "h5.editWithdraw.operandValueAfter", operandValueAfter, operandValueBefore);
  });

  await withStandard(async ({ page }) => {
    await pressBackspace(page);
    const core = await readCore(page);
    addEvidence("H5", "coldEmpty", core);
    checkEq("H5", "h5.coldEmpty.state", core.state, "select");
    checkEq("H5", "h5.coldEmpty.expression", core.expression, "");
    checkEq("H5", "h5.coldEmpty.input", core.input, "");
    checkEq("H5", "h5.coldEmpty.history", core.history, 0);
  });
}

async function testH6() {
  try {
    const suite = await import(pathToFileURL("/ws/cal_phone/tests/suite.mjs").href);
    suiteResults = await suite.runSuite({ artifact: ARTIFACT });
  } catch (error) {
    suiteFailure = error && error.stack ? error.stack : String(error);
    suiteResults = [];
  }
  const cold = suiteResults.find((result) => result.id === "cold-start");
  const coldIds = cold ? cold.checks.map((check) => check.id) : [];
  const failed = suiteResults.filter((result) => !result.pass).map((result) => result.id);
  const allPass = suiteResults.length === 18 && failed.length === 0;
  addEvidence("H6", "results", { count: suiteResults.length, failed, coldIds });
  checkEq("H6", "h6.results.length", suiteResults.length, 18, suiteFailure ? brief(suiteFailure) : "");
  checkTrue("H6", "h6.all.pass", allPass, failed.join(","));
  checkTrue("H6", "h6.coldStart.keysEnabled", coldIds.includes("cold-start.keys-enabled"), fmt(coldIds));
  checkTrue("H6", "h6.coldStart.keysDisabledAbsent", !coldIds.includes("cold-start.keys-disabled"), fmt(coldIds));
}

async function setupLayoutState(page, state) {
  if (state === "cold") return;
  if (state === "panel") {
    await openSettingsPanel(page);
    return;
  }
  if (state === "progress") {
    await configureSettings(page, { autoConfirm: 10, baseEnabled: true, baseText: "10" });
    await chooseOperator(page, "+");
    await enterScreenValue(page, "9.5");
    await typeScreen(page, "9.2");
    await page.waitForTimeout(100);
    return;
  }
  if (state === "base-marker") {
    await configureSettings(page, { baseEnabled: true, baseText: "10" });
    await chooseOperator(page, "+");
    await enterScreenValue(page, "9.5");
    return;
  }
  if (state === "edit-draft") {
    await configureSettings(page, { baseEnabled: true, baseText: "10" });
    await chooseOperator(page, "+");
    await enterScreenValue(page, "2");
    await enterScreenValue(page, "3");
    await pressEquals(page);
    await page.locator(S.historyEdit).first().click();
    return;
  }
  if (state === "two-history") {
    await chooseOperator(page, "+");
    await enterScreenValue(page, "2");
    await enterScreenValue(page, "3");
    await pressEquals(page);
    await chooseOperator(page, "*");
    await enterScreenValue(page, "2");
    await enterScreenValue(page, "4");
    await pressEquals(page);
  }
}

async function measureLayout(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
      return element.getClientRects().length > 0;
    };
    const controls = [...document.querySelectorAll("input,button,select")].filter(visible).map((element) => {
      const target = element.matches('input[type="checkbox"]') && element.closest("label") ? element.closest("label") : element;
      const rect = target.getBoundingClientRect();
      return {
        tag: element.tagName,
        type: element.getAttribute("type"),
        testid: element.getAttribute("data-testid"),
        width: rect.width,
        height: rect.height,
        fontSize: parseFloat(getComputedStyle(element).fontSize),
      };
    });
    const inputs = [...document.querySelectorAll("input,select")].filter(visible).map((element) => parseFloat(getComputedStyle(element).fontSize));
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height, left: value.left, right: value.right, top: value.top, bottom: value.bottom };
    };
    const gear = document.querySelector('[data-testid="settings-toggle"]');
    const panel = document.querySelector('[data-testid="settings-panel"]');
    return {
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: document.documentElement.clientHeight,
      controls,
      minControlWidth: controls.length ? Math.min(...controls.map((control) => control.width)) : null,
      minControlHeight: controls.length ? Math.min(...controls.map((control) => control.height)) : null,
      minInputFont: inputs.length ? Math.min(...inputs) : null,
      gear: gear ? rect(gear) : null,
      panel: panel && panel.open ? rect(panel) : null,
      panelOpen: Boolean(panel && panel.open),
      state: document.querySelector("main.app")?.dataset.state,
      history: document.querySelectorAll('[data-testid="history-item"]').length,
      progressActive: document.querySelector('[data-testid="auto-confirm-progress"]')?.getAttribute("data-active"),
      baseMarkerVisible: Boolean(document.querySelector('[data-testid="base-marker"]') && document.querySelector('[data-testid="base-marker"]').getClientRects().length),
      editMarkerVisible: Boolean(document.querySelector('[data-testid="edit-base-marker"]') && document.querySelector('[data-testid="edit-base-marker"]').getClientRects().length),
    };
  });
}

async function testH7() {
  const viewports = [
    { width: 320, height: 568, tag: "320x568", cdp: true },
    { width: 390, height: 844, tag: "390x844", cdp: false },
  ];
  const states = ["cold", "panel", "progress", "base-marker", "edit-draft", "two-history"];
  for (const viewport of viewports) {
    for (const state of states) {
      const app = viewport.cdp
        ? await openCustom({ viewport: { width: viewport.width, height: viewport.height }, cdp320: true })
        : await openStandard({ viewport: { width: viewport.width, height: viewport.height } });
      try {
        const { page } = app;
        await setupLayoutState(page, state);
        await page.waitForTimeout(150);
        const metrics = await measureLayout(page);
        const key = `${viewport.tag}.${state}`;
        addEvidence("H7", key, {
          viewport: `${metrics.viewportWidth}x${metrics.viewportHeight}`,
          docOverflow: metrics.docOverflow,
          bodyOverflow: metrics.bodyOverflow,
          controls: metrics.controls.length,
          minWidth: metrics.minControlWidth,
          minHeight: metrics.minControlHeight,
          minInputFont: metrics.minInputFont,
          panel: metrics.panel,
          gear: metrics.gear,
          history: metrics.history,
          progressActive: metrics.progressActive,
          baseMarkerVisible: metrics.baseMarkerVisible,
          editMarkerVisible: metrics.editMarkerVisible,
        });
        checkTrue("H7", `h7.${key}.docOverflow`, metrics.docOverflow <= 1, `${metrics.docOverflow}px`);
        checkTrue("H7", `h7.${key}.bodyOverflow`, metrics.bodyOverflow <= 1, `${metrics.bodyOverflow}px`);
        checkTrue("H7", `h7.${key}.controlsPresent`, metrics.controls.length > 0, String(metrics.controls.length));
        checkTrue(
          "H7",
          `h7.${key}.controlsMinSize`,
          metrics.controls.every((control) => control.width >= MIN_CONTROL && control.height >= MIN_CONTROL),
          `min=${metrics.minControlWidth.toFixed(2)}x${metrics.minControlHeight.toFixed(2)}`,
        );
        checkTrue(
          "H7",
          `h7.${key}.inputFont`,
          metrics.minInputFont === null || metrics.minInputFont >= MIN_INPUT_FONT,
          String(metrics.minInputFont),
        );
        if (state === "panel") {
          const limit = Math.min(320, metrics.viewportWidth - 16) + 1;
          checkTrue("H7", `h7.${key}.panelOpen`, metrics.panelOpen);
          checkTrue("H7", `h7.${key}.panelWidth`, metrics.panel.width <= limit, `${metrics.panel.width} <= ${limit}`);
          checkTrue(
            "H7",
            `h7.${key}.panelInside`,
            metrics.panel.left >= -LAYOUT_TOL && metrics.panel.right <= metrics.viewportWidth + LAYOUT_TOL,
            fmt(metrics.panel),
          );
          checkTrue("H7", `h7.${key}.panelBelowGear`, metrics.panel.top >= metrics.gear.bottom - 2, `${metrics.panel.top} >= ${metrics.gear.bottom - 2}`);
          checkTrue(
            "H7",
            `h7.${key}.panelGearRight`,
            Math.abs(metrics.panel.right - metrics.gear.right) <= 16 + LAYOUT_TOL,
            `${metrics.panel.right} vs ${metrics.gear.right}`,
          );
        }
        if (state === "progress") checkEq("H7", `h7.${key}.progressActive`, metrics.progressActive, "true");
        if (state === "base-marker") checkTrue("H7", `h7.${key}.baseMarkerVisible`, metrics.baseMarkerVisible);
        if (state === "edit-draft") {
          checkTrue("H7", `h7.${key}.editMarkerVisible`, metrics.editMarkerVisible);
          checkTrue("H7", `h7.${key}.editDraftVisible`, metrics.state === "edit", String(metrics.state));
        }
        if (state === "two-history") checkEq("H7", `h7.${key}.history`, metrics.history, 2);
      } finally {
        await app.close();
      }
    }
  }
}

async function testH9() {
  const run = async () =>
    withStandard(async ({ page }) => {
      await configureSettings(page, { autoConfirm: 0, baseEnabled: true, baseText: "10" });
      await chooseOperator(page, "+");
      for (const value of ["9.5", "9.2", "9.0"]) await enterScreenValue(page, value);
      await pressEquals(page);
      return { history: await historySnapshots(page), core: await readCore(page) };
    });
  const first = await run();
  const second = await run();
  const sequenceCount = [first, second].filter(Boolean).length;
  addEvidence("H9", "first", first);
  addEvidence("H9", "second", second);
  checkEq("H9", "h9.sequenceCount", sequenceCount, 2);
  checkEq("H9", "h9.records", first.history.length, 1);
  checkEq("H9", "h9.recordsRunTwo", second.history.length, 1);
  checkTrue("H9", "h9.deepEqual", isDeepStrictEqual(first.history, second.history), `${fmt(first.history)} vs ${fmt(second.history)}`);
  checkNear("H9", "h9.result", first.core.result, 37.7);
}

function countExternalReferences(html) {
  const urls = [];
  const patterns = [
    /<script\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    /<link\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi,
    /url\(\s*["']?([^"')]+)["']?\s*\)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) urls.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return urls.filter((url) => /^(?:https?:)?\/\//i.test(String(url).trim()));
}

function inspectPng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(signature)) throw new Error("not a PNG");
  let offset = 8;
  let width = null;
  let height = null;
  let bitDepth = null;
  let colorType = null;
  let interlace = null;
  const idat = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  if (!width || !height || bitDepth !== 8 || interlace !== 0 || ![2, 6].includes(colorType)) {
    throw new Error(`unsupported PNG IHDR ${width}x${height} depth=${bitDepth} color=${colorType} interlace=${interlace}`);
  }
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const colors = new Set();
  let previous = Buffer.alloc(stride);
  let position = 0;
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y += 1) {
    const filter = raw[position];
    position += 1;
    const row = Buffer.from(raw.subarray(position, position + stride));
    position += stride;
    for (let index = 0; index < stride; index += 1) {
      const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
      const up = previous[index];
      const upperLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paeth(left, up, upperLeft);
      else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
      row[index] = (row[index] + predictor) & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      const index = x * bytesPerPixel;
      colors.add(`${row[index]},${row[index + 1]},${row[index + 2]}`);
    }
    previous = row;
  }
  return { width, height, uniqueColors: colors.size };
}

async function collectReviewMetrics(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
      return element.getClientRects().length > 0;
    };
    const rect = (element) => {
      if (!element || !visible(element)) return null;
      const value = element.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom };
    };
    const controls = [...document.querySelectorAll("input,button,select")].filter(visible).map((element) => {
      const target = element.matches('input[type="checkbox"]') && element.closest("label") ? element.closest("label") : element;
      const value = target.getBoundingClientRect();
      return { width: value.width, height: value.height, fontSize: parseFloat(getComputedStyle(element).fontSize), tag: element.tagName };
    });
    const inputFonts = [...document.querySelectorAll("input,select")].filter(visible).map((element) => parseFloat(getComputedStyle(element).fontSize));
    const gear = document.querySelector('[data-testid="settings-toggle"]');
    const panel = document.querySelector('[data-testid="settings-panel"]');
    const progress = document.querySelector('[data-testid="auto-confirm-progress"]');
    const baseMarker = document.querySelector('[data-testid="base-marker"]');
    const editMarker = document.querySelector('[data-testid="edit-base-marker"]');
    const editDraft = document.querySelector('[data-testid="edit-draft"]');
    return {
      state: document.querySelector("main.app")?.dataset.state,
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      gearVisible: Boolean(gear && visible(gear)),
      gearRect: rect(gear),
      panelOpen: Boolean(panel && panel.open),
      panelVisible: Boolean(panel && panel.open && visible(panel)),
      panelRect: rect(panel),
      progressVisible: Boolean(progress && visible(progress)),
      progressActive: progress ? progress.getAttribute("data-active") : null,
      progressRect: rect(progress),
      baseMarkerVisible: Boolean(baseMarker && visible(baseMarker)),
      baseMarkerRect: rect(baseMarker),
      editMarkerVisible: Boolean(editMarker && visible(editMarker)),
      editDraftVisible: Boolean(editDraft && visible(editDraft)),
      settingsT: document.querySelector('[data-testid="settings-auto-confirm"]')?.value,
      settingsBaseEnabled: Boolean(document.querySelector('[data-testid="settings-base-toggle"]')?.checked),
      settingsBaseValue: document.querySelector('[data-testid="settings-base-value"]')?.value,
      history: document.querySelectorAll('[data-testid="history-item"]').length,
      controls: controls.length,
      minControlWidth: controls.length ? Math.min(...controls.map((control) => control.width)) : null,
      minControlHeight: controls.length ? Math.min(...controls.map((control) => control.height)) : null,
      minInputFont: inputFonts.length ? Math.min(...inputFonts) : null,
    };
  });
}

function rectText(rect) {
  if (!rect) return "none";
  return `${rect.x.toFixed(1)},${rect.y.toFixed(1)},${rect.width.toFixed(1)},${rect.height.toFixed(1)}`;
}

function metricLinesForState(name, metrics) {
  const fields = [
    ["state", metrics.state],
    ["doc_overflow", metrics.docOverflow],
    ["body_overflow", metrics.bodyOverflow],
    ["gear_visible", metrics.gearVisible],
    ["gear_rect", rectText(metrics.gearRect)],
    ["panel_open", metrics.panelOpen],
    ["panel_visible", metrics.panelVisible],
    ["panel_rect", rectText(metrics.panelRect)],
    ["progress_visible", metrics.progressVisible],
    ["progress_active", metrics.progressActive],
    ["progress_rect", rectText(metrics.progressRect)],
    ["base_marker_visible", metrics.baseMarkerVisible],
    ["base_marker_rect", rectText(metrics.baseMarkerRect)],
    ["edit_base_marker_visible", metrics.editMarkerVisible],
    ["edit_draft_visible", metrics.editDraftVisible],
    ["settings_t", metrics.settingsT],
    ["settings_base_enabled", metrics.settingsBaseEnabled],
    ["settings_base_value", metrics.settingsBaseValue],
    ["history_count", metrics.history],
    ["visible_controls", metrics.controls],
    ["min_control_width", metrics.minControlWidth],
    ["min_control_height", metrics.minControlHeight],
    ["min_input_font", metrics.minInputFont],
    ["file", metrics.file],
    ["image_width", metrics.image_width],
    ["image_height", metrics.image_height],
    ["image_bytes", metrics.image_bytes],
    ["image_sha256", metrics.image_sha256],
    ["unique_colors", metrics.unique_colors],
    ["progress_active_before", metrics.progress_active_before],
    ["progress_active_after", metrics.progress_active_after],
    ["capture_ms", metrics.capture_ms],
    ["since_input_ms", metrics.since_input_ms],
  ];
  return fields.map(([key, value]) => `${name}.${key}=${value === null || value === undefined ? "none" : value}`);
}

async function renderReviewStates() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const capture = async (name, mode, setup) => {
    let app = null;
    try {
      app = mode === "320"
        ? await openCustom({ viewport: { width: 320, height: 568 }, cdp320: true })
        : await openStandard({ viewport: { width: 390, height: 844 } });
      const { page } = app;
      const sinceInput = await setup(page);
      await page.waitForTimeout(name === "S3" ? 100 : 250);
      const before = await collectReviewMetrics(page);
      const file = path.join(SHOTS_DIR, `${name}.png`);
      const shotStarted = Date.now();
      await page.screenshot({ path: file, fullPage: false });
      const captureMs = Date.now() - shotStarted;
      const progressActiveAfter = await page.locator('[data-testid="auto-confirm-progress"]').getAttribute("data-active");
      const bytes = fs.readFileSync(file);
      const png = inspectPng(bytes);
      const totalSinceInput = sinceInput ? Date.now() - sinceInput : null;
      const metrics = {
        ...before,
        file: `${name}.png`,
        image_width: png.width,
        image_height: png.height,
        image_bytes: bytes.length,
        image_sha256: sha256Buffer(bytes),
        unique_colors: png.uniqueColors,
        progress_active_before: before.progressActive,
        progress_active_after: progressActiveAfter,
        capture_ms: captureMs,
        since_input_ms: totalSinceInput,
      };
      renderAudit.states.push({ name, metrics });
      if (bytes.length === 0) renderAudit.issues.push(`${name}: empty PNG`);
      if (png.uniqueColors <= 1) renderAudit.issues.push(`${name}: solid PNG`);
      if (png.width < 240 || png.height < 160) renderAudit.issues.push(`${name}: undersized ${png.width}x${png.height}`);
      if (name === "S3") {
        if (before.progressActive !== "true" || progressActiveAfter !== "true") {
          renderAudit.issues.push(`S3: progress not active before/after screenshot`);
        }
        if (!(totalSinceInput !== null && totalSinceInput < 1000)) {
          renderAudit.issues.push(`S3: screenshot ${totalSinceInput}ms after input`);
        }
      }
      if (name === "S2" || name === "S4") {
        if (!before.panelOpen) renderAudit.issues.push(`${name}: settings panel not open`);
      }
      if (name === "S2" || name === "S3" || name === "S4") {
        if (!before.settingsBaseEnabled || before.settingsBaseValue !== "10") {
          renderAudit.issues.push(`${name}: base setting missing`);
        }
      }
      if (name === "S4" && (png.width !== 320 || png.height !== 568)) {
        renderAudit.issues.push(`S4: CDP viewport rendered ${png.width}x${png.height}`);
      }
      return metrics;
    } catch (error) {
      renderAudit.issues.push(`${name}: ${error && error.stack ? error.stack : String(error)}`);
      return null;
    } finally {
      if (app) await app.close();
    }
  };

  await capture("S1", "390", async () => null);
  await capture("S2", "390", async (page) => {
    await configureSettings(page, { autoConfirm: 1, baseEnabled: true, baseText: "10", close: false });
    return null;
  });
  await capture("S3", "390", async (page) => {
    await configureSettings(page, { autoConfirm: 10, baseEnabled: true, baseText: "10" });
    await chooseOperator(page, "+");
    await enterScreenValue(page, "9.5");
    const since = Date.now();
    await typeScreen(page, "9.2");
    return since;
  });
  await capture("S4", "320", async (page) => {
    await configureSettings(page, { baseEnabled: true, baseText: "10", close: false });
    return null;
  });

  const actual = fs.readdirSync(SHOTS_DIR).sort();
  const expected = REVIEW_STATES.map((name) => `${name}.png`).sort();
  if (!isDeepStrictEqual(actual, expected)) renderAudit.issues.push(`review files ${fmt(actual)} != ${fmt(expected)}`);
  const hashes = renderAudit.states.map((state) => state.metrics.image_sha256);
  if (new Set(hashes).size !== hashes.length) renderAudit.issues.push("duplicate review screenshots");
  const header = [
    `ROUND: ${ROUND}`,
    `ARTIFACT_SHA256: ${ARTIFACT_SHA256}`,
    `VERIFIER_SHA256: ${VERIFIER_SHA256}`,
  ];
  const lines = [...header];
  for (const state of renderAudit.states) lines.push(...metricLinesForState(state.name, state.metrics));
  if (renderAudit.issues.length) lines.push(`render_issues=${fmt(renderAudit.issues)}`);
  renderAudit.metricsText = `${lines.join("\n")}\n`;
  const metricsPath = path.join(OUT_DIR, `render-r${ROUND}.txt`);
  fs.writeFileSync(metricsPath, renderAudit.metricsText);
  renderAudit.metricsSha256 = sha256File(metricsPath);
  renderAudit.manifest = {
    round: Number(ROUND),
    artifact_sha256: ARTIFACT_SHA256,
    verifier_sha256: VERIFIER_SHA256,
    metrics_sha256: renderAudit.metricsSha256,
    shots: renderAudit.states.map((state) => ({
      file: state.metrics.file,
      sha256: state.metrics.image_sha256,
      width: state.metrics.image_width,
      height: state.metrics.image_height,
    })),
    adhoc: [],
  };
  fs.writeFileSync(path.join(OUT_DIR, `manifest-r${ROUND}.json`), `${JSON.stringify(renderAudit.manifest, null, 2)}\n`);
}

async function testH8() {
  const html = fs.readFileSync(ARTIFACT, "utf8");
  const external = countExternalReferences(html);
  const artifactShaEnd = sha256File(ARTIFACT);
  const pageErrors = trackedPages.flatMap((page) => page.pageErrors);
  const consoleErrors = trackedPages.flatMap((page) => page.consoleErrors);
  const suiteCleanFailures = suiteResults
    .flatMap((result) => result.checks || [])
    .filter((check) => check.id.endsWith(".clean") && !check.pass)
    .map((check) => check.id);
  const shotFiles = fs.existsSync(SHOTS_DIR) ? fs.readdirSync(SHOTS_DIR).sort() : [];
  addEvidence("H8", "htmlClose", /<\/html>\s*$/i.test(html));
  addEvidence("H8", "bytes", Buffer.byteLength(html));
  addEvidence("H8", "externalRefs", external);
  addEvidence("H8", "pageErrors", pageErrors);
  addEvidence("H8", "consoleErrors", consoleErrors);
  addEvidence("H8", "suiteCleanFailures", suiteCleanFailures);
  addEvidence("H8", "reviewFiles", shotFiles);
  addEvidence("H8", "reviewIssues", renderAudit.issues);
  addEvidence("H8", "artifactStable", artifactShaEnd === ARTIFACT_SHA256);
  checkTrue("H8", "h8.htmlClose", /<\/html>\s*$/i.test(html));
  checkTrue("H8", "h8.bytes", Buffer.byteLength(html) >= 1024, String(Buffer.byteLength(html)));
  checkEq("H8", "h8.externalRefs", external.length, 0, fmt(external));
  checkEq("H8", "h8.pageErrors", pageErrors.length, 0, pageErrors.join(" | "));
  checkEq("H8", "h8.consoleErrors", consoleErrors.length, 0, consoleErrors.join(" | "));
  checkEq("H8", "h8.suiteCleanFailures", suiteCleanFailures.length, 0, suiteCleanFailures.join(","));
  checkTrue("H8", "h8.artifactStable", artifactShaEnd === ARTIFACT_SHA256);
  checkEq("H8", "h8.reviewArtifacts", renderAudit.issues.length, 0, renderAudit.issues.join(" | "));
  checkEq("H8", "h8.reviewFiles", shotFiles, REVIEW_STATES.map((name) => `${name}.png`).sort());
}

function hardLine(h) {
  const failed = checks[h].filter((check) => !check.pass);
  const details = Object.entries(evidence[h] || {}).map(([key, value]) => `${h.toLowerCase()}.${key}=${fmt(value)}`);
  const failedText = failed.map((check) => `${check.id}: ${brief(check.detail, 700)}`);
  return `${h} ${failed.length === 0 ? "PASS" : "FAIL"} — checks=${checks[h].length} failed=${failed.length}${failedText.length ? `; ${failedText.join("; ")}` : ""}${details.length ? `; ${details.join("; ")}` : ""}`;
}

function writeHard() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const lines = [
    `ROUND: ${ROUND}`,
    `ARTIFACT_SHA256: ${ARTIFACT_SHA256}`,
    `VERIFIER_SHA256: ${VERIFIER_SHA256}`,
  ];
  for (const h of H_IDS) lines.push(hardLine(h));
  const failedH = H_IDS.filter((h) => checks[h].some((check) => !check.pass));
  lines.push(failedH.length === 0 ? "HARD: PASS" : `HARD: FAIL (${failedH.join(",")})`);
  const text = `${lines.join("\n")}\n`;
  fs.writeFileSync(path.join(OUT_DIR, `hard-r${ROUND}.txt`), text);
  process.stdout.write(text);
  return failedH.length === 0;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await runH("H1", testH1);
  await runH("H2", testH2);
  await runH("H3", testH3);
  await runH("H4", testH4);
  await runH("H5", testH5);
  await runH("H6", testH6);
  await runH("H7", testH7);
  await runH("H9", testH9);
  try {
    await renderReviewStates();
  } catch (error) {
    renderAudit.issues.push(error && error.stack ? error.stack : String(error));
  } finally {
    if (browser) await browser.close();
  }
  await runH("H8", testH8);
  const pass = writeHard();
  process.exitCode = pass ? 0 : 1;
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exitCode = 2;
});
