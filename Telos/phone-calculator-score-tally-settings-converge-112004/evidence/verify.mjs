#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const ROUND = String(process.argv[2] ?? process.env.KEKKAI_ROUND ?? "1").replace(/^r/i, "");
const ARTIFACT = resolveFromScript(process.env.KEKKAI_ARTIFACT || "/ws/cal_phone/index.html");
const OUT_DIR = resolveFromScript(process.env.KEKKAI_OUT_DIR || HERE);
const SHOTS_DIR = path.join(OUT_DIR, "review-shots", `r${ROUND}`);
const REVIEW_STATES = ["S1", "S2", "S3", "S4"];
const SETTINGS_KEY = "cal-phone.settings.v1";
const TOL = 1e-9;
const LAYOUT_TOL = 0.5;
const MIN_CONTROL = 43.5;
const MIN_INPUT_FONT = 15.5;

const H_IDS = ["H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H9"];
const checks = { H1: [], H2: [], H3: [], H4: [], H5: [], H6: [], H7: [], H8: [], H9: [] };
const evidence = { H1: {}, H2: {}, H3: {}, H4: {}, H5: {}, H6: {}, H7: {}, H8: {}, H9: {} };

const { launchBrowser, openApp } = await import("file:///ws/cal_phone/tests/lib/browser.mjs");
const { S } = await import("file:///ws/cal_phone/tests/lib/selectors.mjs");

const ARTIFACT_SHA256 = sha256File(ARTIFACT);
const VERIFIER_SHA256 = sha256File(SELF);
const trackedApps = [];
let browser = null;
let suiteResults = [];
let suiteFailure = null;
const renderAudit = { states: [], issues: [], metricsText: "", metricsSha256: null, manifest: null };

function resolveFromScript(value) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(HERE, value);
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
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

function brief(value, limit = 900) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function addCheck(h, id, pass, detail = "") {
  checks[h].push({ id, pass: Boolean(pass), detail: String(detail) });
}

function checkTrue(h, id, pass, detail = "") {
  addCheck(h, id, pass, detail || String(pass));
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
  addCheck(
    h,
    id,
    pass,
    pass ? String(number) : `expected ${expected} ± ${tolerance}, got ${fmt(actual)}${detail ? ` — ${detail}` : ""}`,
  );
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

async function launchHarness() {
  try {
    return await launchBrowser();
  } catch (firstError) {
    if (!/sandbox|SIGTRAP|SIGSYS|Operation not permitted|Target page, context or browser has been closed/i.test(String(firstError))) {
      throw firstError;
    }
    const require = createRequire("/ws/cal_phone/tests/package.json");
    const { chromium } = require("/ws/cal_phone/tests/node_modules/playwright");
    return chromium.launch({ headless: true, chromiumSandbox: false, args: ["--disable-gpu"] });
  }
}

async function ensureBrowser() {
  if (!browser) browser = await launchHarness();
  return browser;
}

async function closeBrowser() {
  if (!browser) return;
  const current = browser;
  browser = null;
  await current.close();
}

function track(app) {
  trackedApps.push({ pageErrors: app.pageErrors, consoleErrors: app.consoleErrors });
  return app;
}

async function openStandard(options = {}) {
  return track(await openApp(await ensureBrowser(), ARTIFACT, options));
}

async function openCustom(options = {}) {
  const current = await ensureBrowser();
  const contextOptions = {
    viewport: options.viewport || { width: 390, height: 844 },
    isMobile: options.isMobile ?? true,
    hasTouch: options.hasTouch ?? true,
  };
  if (options.reducedMotion) contextOptions.reducedMotion = options.reducedMotion;
  const context = await current.newContext(contextOptions);
  if (options.initScript) await context.addInitScript(options.initScript);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
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
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
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

async function closeSettingsPanel(page) {
  await page.locator('[data-testid="settings-done"]').click();
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
  if (close) await closeSettingsPanel(page);
}

async function readSettings(page) {
  return page.evaluate(() => ({
    t: document.querySelector('[data-testid="settings-auto-confirm"]')?.value,
    baseChecked: Boolean(document.querySelector('[data-testid="settings-base-toggle"]')?.checked),
    baseDisabled: Boolean(document.querySelector('[data-testid="settings-base-value"]')?.disabled),
    baseValue: document.querySelector('[data-testid="settings-base-value"]')?.value,
  }));
}

async function testH1() {
  const { page, pageErrors } = await openStandard({ viewport: { width: 390, height: 844 } });
  try {
    const gearSelector = 'button[data-testid="settings-toggle"]';
    const gear = await page.locator(gearSelector).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        visible: getComputedStyle(element).display !== "none" && element.getClientRects().length > 0,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, top: rect.top, bottom: rect.bottom },
        haspopup: element.getAttribute("aria-haspopup"),
        expanded: element.getAttribute("aria-expanded"),
      };
    });
    addEvidence("H1", "gear", gear);
    checkTrue("H1", "h1.gear.visible", gear.visible);
    checkTrue("H1", "h1.gear.width", gear.rect.width >= 44, String(gear.rect.width));
    checkTrue("H1", "h1.gear.height", gear.rect.height >= 44, String(gear.rect.height));
    checkTrue("H1", "h1.gear.right", gear.rect.right > 390 / 2, String(gear.rect.right));
    checkTrue("H1", "h1.gear.top", gear.rect.top < 100, String(gear.rect.top));
    checkEq("H1", "h1.gear.haspopup", gear.haspopup, "dialog");
    checkEq("H1", "h1.gear.expanded.initial", gear.expanded, "false");

    const readDialog = () =>
      page.evaluate(() => {
        const dialog = document.querySelector('dialog[data-testid="settings-panel"]');
        const gearElement = document.querySelector('button[data-testid="settings-toggle"]');
        const active = document.activeElement;
        return {
          tagName: dialog ? dialog.tagName : null,
          open: Boolean(dialog && dialog.open),
          modal: Boolean(dialog && dialog.matches(":modal")),
          expanded: gearElement ? gearElement.getAttribute("aria-expanded") : null,
          focusInside: Boolean(dialog && active && dialog.contains(active)),
          focusGear: active === gearElement,
        };
      });

    await page.locator(gearSelector).click();
    const opened = await readDialog();
    addEvidence("H1", "opened", opened);
    checkEq("H1", "h1.open.tagName", opened.tagName, "DIALOG");
    checkEq("H1", "h1.open.open", opened.open, true);
    checkEq("H1", "h1.open.modal", opened.modal, true);
    checkTrue("H1", "h1.open.focusInside", opened.focusInside);
    checkEq("H1", "h1.open.expanded", opened.expanded, "true");

    const ensureOpen = async () => {
      if (!(await page.locator('dialog[data-testid="settings-panel"]').evaluate((dialog) => dialog.open))) {
        await page.locator(gearSelector).click();
      }
    };

    const closeAndRead = async (action) => {
      const closed = page.evaluate(
        () =>
          new Promise((resolve) => {
            const dialog = document.querySelector('dialog[data-testid="settings-panel"]');
            if (!dialog || !dialog.open) {
              resolve(true);
              return;
            }
            const timer = setTimeout(() => resolve(false), 2000);
            dialog.addEventListener(
              "close",
              () => {
                clearTimeout(timer);
                resolve(true);
              },
              { once: true },
            );
          }),
      );
      await action();
      const closeEventObserved = await closed;
      return { ...(await readDialog()), closeEventObserved };
    };

    await ensureOpen();
    const escaped = await closeAndRead(() => page.keyboard.press("Escape"));
    addEvidence("H1", "escape", escaped);
    checkEq("H1", "h1.escape.closeEvent", escaped.closeEventObserved, true);
    checkEq("H1", "h1.escape.open", escaped.open, false);
    checkEq("H1", "h1.escape.expanded", escaped.expanded, "false");
    checkTrue("H1", "h1.escape.focus", escaped.focusGear);

    await ensureOpen();
    const done = await closeAndRead(() => page.locator('[data-testid="settings-done"]').click());
    addEvidence("H1", "done", done);
    checkEq("H1", "h1.done.closeEvent", done.closeEventObserved, true);
    checkEq("H1", "h1.done.open", done.open, false);
    checkEq("H1", "h1.done.expanded", done.expanded, "false");
    checkTrue("H1", "h1.done.focus", done.focusGear);

    await ensureOpen();
    const backdrop = await closeAndRead(() => page.mouse.click(2, 844 - 2));
    addEvidence("H1", "backdrop", backdrop);
    checkEq("H1", "h1.backdrop.closeEvent", backdrop.closeEventObserved, true);
    checkEq("H1", "h1.backdrop.open", backdrop.open, false);
    checkEq("H1", "h1.backdrop.expanded", backdrop.expanded, "false");
    checkTrue("H1", "h1.backdrop.focus", backdrop.focusGear);

    await openSettingsPanel(page);
    await page.locator('[data-testid="settings-auto-confirm"]').selectOption("1");
    await closeSettingsPanel(page);
    const indicatorOn = await page.locator('[data-testid="settings-indicator"]').isVisible();
    await openSettingsPanel(page);
    await page.locator('[data-testid="settings-auto-confirm"]').selectOption("0");
    const baseToggle = page.locator('[data-testid="settings-base-toggle"]');
    if (await baseToggle.isChecked()) await baseToggle.uncheck();
    await closeSettingsPanel(page);
    const indicatorOff = await page.locator('[data-testid="settings-indicator"]').isVisible();
    addEvidence("H1", "indicator", { on: indicatorOn, off: indicatorOff });
    checkEq("H1", "h1.indicator.on", indicatorOn, true);
    checkEq("H1", "h1.indicator.off", indicatorOff, false);
    addEvidence("H1", "pageErrors", pageErrors);
    checkEq("H1", "h1.pageErrors", pageErrors.length, 0, pageErrors.join(" | "));
  } finally {
    await page.context().close();
  }
}

async function testH2() {
  const first = await openStandard({ viewport: { width: 390, height: 844 } });
  try {
    const { page } = first;
    const defaults = await page.evaluate(() => ({
      options: [...document.querySelectorAll('[data-testid="settings-auto-confirm"] option')].map((option) => option.value),
      selected: document.querySelector('[data-testid="settings-auto-confirm"]')?.value,
      baseChecked: Boolean(document.querySelector('[data-testid="settings-base-toggle"]')?.checked),
      baseDisabled: Boolean(document.querySelector('[data-testid="settings-base-value"]')?.disabled),
      baseValue: document.querySelector('[data-testid="settings-base-value"]')?.value,
      stored: (() => {
        try {
          return localStorage.getItem("cal-phone.settings.v1");
        } catch (error) {
          return `ERROR:${error.message}`;
        }
      })(),
    }));
    addEvidence("H2", "defaults", defaults);
    checkEq("H2", "h2.options", defaults.options, Array.from({ length: 21 }, (_, index) => String(index / 2)));
    checkEq("H2", "h2.selected", defaults.selected, "0");
    checkEq("H2", "h2.base.checked", defaults.baseChecked, false);
    checkEq("H2", "h2.base.disabled", defaults.baseDisabled, true);
    checkEq("H2", "h2.base.value", defaults.baseValue, "0");
    checkTrue("H2", "h2.storage.initial", defaults.stored === null || defaults.stored === "", fmt(defaults.stored));

    await configureSettings(page, { autoConfirm: 1, baseEnabled: true, baseText: "10" });
    const stored = await page.evaluate(() => localStorage.getItem("cal-phone.settings.v1"));
    addEvidence("H2", "stored", stored);
    checkTrue("H2", "h2.storage.nonempty", typeof stored === "string" && stored.length > 0, fmt(stored));

    await page.reload({ waitUntil: "load" });
    const reloaded = await readSettings(page);
    addEvidence("H2", "reloaded", reloaded);
    checkEq("H2", "h2.reload.t", reloaded.t, "1");
    checkEq("H2", "h2.reload.baseChecked", reloaded.baseChecked, true);
    checkEq("H2", "h2.reload.baseValue", reloaded.baseValue, "10");

    await chooseOperator(page, "+");
    await enterScreenValue(page, "9.5");
    await pressEquals(page);
    const computed = await readCore(page);
    addEvidence("H2", "computed", computed);
    checkNear("H2", "h2.computed.result", computed.result, 19.5);
    checkEq("H2", "h2.computed.history", computed.history, 1);

    await page.locator(S.keyOp).click();
    await openSettingsPanel(page);
    const afterReset = await readSettings(page);
    await closeSettingsPanel(page);
    addEvidence("H2", "afterReset", afterReset);
    checkEq("H2", "h2.reset.t", afterReset.t, "1");
    checkEq("H2", "h2.reset.baseChecked", afterReset.baseChecked, true);
    checkEq("H2", "h2.reset.baseValue", afterReset.baseValue, "10");
    addEvidence("H2", "historyBeforeReload", computed.history);

    await page.reload({ waitUntil: "load" });
    const historyAfterReload = await page.locator(S.historyItem).count();
    addEvidence("H2", "historyAfterReload", historyAfterReload);
    checkEq("H2", "h2.reload.history", historyAfterReload, 0);

    const degraded = await openCustom({
      viewport: { width: 390, height: 844 },
      initScript: () => {
        Storage.prototype.getItem = function blockedGetItem() {
          throw new Error("storage get blocked by verifier");
        };
        Storage.prototype.setItem = function blockedSetItem() {
          throw new Error("storage set blocked by verifier");
        };
      },
    });
    try {
      await configureSettings(degraded.page, { autoConfirm: 1 });
      await typeScreen(degraded.page, "9.5");
      await degraded.page.waitForTimeout(1400);
      const degradedCore = await readCore(degraded.page);
      addEvidence("H2", "storageException", {
        core: degradedCore,
        pageErrors: degraded.pageErrors,
        consoleErrors: degraded.consoleErrors,
      });
      checkEq("H2", "h2.storageException.input", degradedCore.input, "");
      checkTrue("H2", "h2.storageException.confirmed", degradedCore.expression.includes("9.5"), degradedCore.expression);
      checkEq("H2", "h2.storageException.pageErrors", degraded.pageErrors.length, 0, degraded.pageErrors.join(" | "));
      checkEq("H2", "h2.storageException.consoleErrors", degraded.consoleErrors.length, 0, degraded.consoleErrors.join(" | "));
    } finally {
      await degraded.close();
    }
    checkEq("H2", "h2.pageErrors", first.pageErrors.length, 0, first.pageErrors.join(" | "));
  } finally {
    await first.close();
  }
}

async function testH3() {
  await withStandard(async ({ page }) => {
    await configureSettings(page, { autoConfirm: 0 });
    await typeScreen(page, "9.5");
    await page.waitForTimeout(1200);
    const core = await readCore(page);
    addEvidence("H3", "t0", core);
    checkEq("H3", "h3.t0.input", core.input, "9.5");
    checkEq("H3", "h3.t0.expression", core.expression, "");
    checkEq("H3", "h3.t0.history", core.history, 0);
    checkEq("H3", "h3.t0.state", core.state, "input");
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
    checkEq("H3", "h3.timerReset.interimInput", interimInput, "9");
    checkEq("H3", "h3.timerReset.expression", core.expression, "95");
    checkEq("H3", "h3.timerReset.input", core.input, "");
    checkEq("H3", "h3.timerReset.history", core.history, 0);
    checkEq("H3", "h3.timerReset.state", core.state, "input");
  });

  await withStandard(async ({ page }) => {
    await configureSettings(page, { autoConfirm: 0.5 });
    await typeScreen(page, "9.");
    await page.waitForTimeout(900);
    const held = { input: await page.locator(S.calcInput).inputValue(), expression: await expressionText(page) };
    await typeScreen(page, "5");
    await page.waitForTimeout(900);
    const core = await readCore(page);
    addEvidence("H3", "trailingDot", { held, ...core });
    checkEq("H3", "h3.trailingDot.heldInput", held.input, "9.");
    checkEq("H3", "h3.trailingDot.heldExpression", held.expression, "");
    checkEq("H3", "h3.trailingDot.input", core.input, "");
    checkTrue("H3", "h3.trailingDot.expression", core.expression.includes("9.5"), core.expression);
    checkTrue("H3", "h3.trailingDot.label", core.label.includes("9.5"), core.label);
  });

  await withStandard(async ({ page }) => {
    await configureSettings(page, { autoConfirm: 1 });
    await typeScreen(page, "9.5");
    await openSettingsPanel(page);
    await page.waitForTimeout(1400);
    const whileOpen = { input: await page.locator(S.calcInput).inputValue(), expression: await expressionText(page) };
    await closeSettingsPanel(page);
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
    checkNear("H3", "h3.equals.result", core.result, 18.7);
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
    await chooseOperator(page, "+");
    await typeScreen(page, "9");
    await page.waitForTimeout(600);
    await chooseOperator(page, "*");
    await page.waitForTimeout(1400);
    const core = await readCore(page);
    const activeOperator = await page.$eval(S.app, (element) => element.dataset.operator);
    addEvidence("H3", "operatorChange", { core, activeOperator });
    checkEq("H3", "h3.operatorChange.input", core.input, "");
    checkEq("H3", "h3.operatorChange.state", core.state, "input");
    checkTrue("H3", "h3.operatorChange.expression", core.expression.includes("9"), core.expression);
    checkTrue("H3", "h3.operatorChange.label", core.label.includes("9"), core.label);
    checkEq("H3", "h3.operatorChange.operator", activeOperator, "*");
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
    addEvidence("H3", "progress", { progressVisible, progressActive, progressRect, afterActive });
    checkEq("H3", "h3.progress.visible", progressVisible, true);
    checkEq("H3", "h3.progress.active", progressActive, "true");
    checkTrue("H3", "h3.progress.height", progressRect.height >= 1 && progressRect.height <= 4, String(progressRect.height));
    checkTrue("H3", "h3.progress.afterActive", afterActive !== "true", String(afterActive));
  });

  const reduced = await openCustom({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  try {
    await configureSettings(reduced.page, { autoConfirm: 0.5 });
    await typeScreen(reduced.page, "9.5");
    await reduced.page.waitForTimeout(900);
    const core = await readCore(reduced.page);
    addEvidence("H3", "reducedMotion", core);
    checkEq("H3", "h3.reducedMotion.input", core.input, "");
    checkTrue("H3", "h3.reducedMotion.expression", core.expression.includes("9.5"), core.expression);
    checkEq("H3", "h3.reducedMotion.history", core.history, 0);
    checkTrue("H3", "h3.reducedMotion.label", core.label.includes("9.5"), core.label);
  } finally {
    await reduced.close();
  }
}

async function runBaseCase(base, operator, values) {
  return withStandard(async ({ page }) => {
    if (base !== null) await configureSettings(page, { baseEnabled: true, baseText: String(base) });
    await chooseOperator(page, operator);
    for (const value of values) await enterScreenValue(page, value);
    await pressEquals(page);
    return { core: await readCore(page), history: await historySnapshots(page) };
  });
}

async function testH4() {
  const baseOff = await runBaseCase(null, "+", ["9.5", "9.2", "9.0"]);
  addEvidence("H4", "baseOff", baseOff);
  checkNear("H4", "h4.baseOff.result", baseOff.core.result, 27.7);
  checkEq("H4", "h4.baseOff.historyCount", baseOff.history.length, 1);
  checkEq("H4", "h4.baseOff.historyBase", baseOff.history[0]?.["data-base"], null);
  checkEq("H4", "h4.baseOff.operands", baseOff.history[0]?.operands, ["9.5", "9.2", "9.0"]);

  const base10 = await withStandard(async ({ page }) => {
    await configureSettings(page, { baseEnabled: true, baseText: "10" });
    await chooseOperator(page, "+");
    const markerBefore = { visible: await isVisible(page, '[data-testid="base-marker"]'), text: await page.locator('[data-testid="base-marker"]').textContent() };
    for (const value of ["9.5", "9.2", "9.0"]) await enterScreenValue(page, value);
    await pressEquals(page);
    return {
      core: await readCore(page),
      history: await historySnapshots(page),
      markerBefore,
      markerAfter: { visible: await isVisible(page, '[data-testid="base-marker"]'), text: await page.locator('[data-testid="base-marker"]').textContent() },
    };
  });
  addEvidence("H4", "base10", base10);
  checkNear("H4", "h4.base10.result", base10.core.result, 37.7);
  checkEq("H4", "h4.base10.historyBase", base10.history[0]?.["data-base"], "10");
  checkEq("H4", "h4.base10.operands", base10.history[0]?.operands, ["9.5", "9.2", "9.0"]);
  checkTrue("H4", "h4.base10.expressionHasBase", base10.history[0]?.expression.split(/\s+/).includes("10"), base10.history[0]?.expression);
  checkEq("H4", "h4.base10.markerVisible", base10.markerAfter.visible, true);
  checkTrue("H4", "h4.base10.markerText", String(base10.markerAfter.text).includes("10"), String(base10.markerAfter.text));

  const base100 = await runBaseCase(100, "/", ["4"]);
  addEvidence("H4", "base100", base100);
  checkNear("H4", "h4.base100.result", base100.core.result, 25);

  const base0 = await runBaseCase(0, "*", ["5"]);
  addEvidence("H4", "base0", base0);
  checkNear("H4", "h4.base0.result", base0.core.result, 0);
  checkEq("H4", "h4.base0.historyBase", base0.history[0]?.["data-base"], "0");

  const baseNegative = await runBaseCase(-2.5, "+", ["1"]);
  addEvidence("H4", "baseNegative", baseNegative);
  checkNear("H4", "h4.baseNegative.result", baseNegative.core.result, -1.5);

  const noOperator = await withStandard(async ({ page }) => {
    await configureSettings(page, { baseEnabled: true, baseText: "10" });
    await enterScreenValue(page, "9.5");
    const beforeOperator = { core: await readCore(page), markerVisible: await isVisible(page, '[data-testid="base-marker"]') };
    await chooseOperator(page, "+");
    const afterOperator = {
      core: await readCore(page),
      markerVisible: await isVisible(page, '[data-testid="base-marker"]'),
      markerText: await page.locator('[data-testid="base-marker"]').textContent(),
    };
    return { beforeOperator, afterOperator };
  });
  addEvidence("H4", "noOperator", noOperator);
  checkTrue("H4", "h4.noOperator.beforeOmitsBase", !noOperator.beforeOperator.core.expression.split(/\s+/).includes("10"), noOperator.beforeOperator.core.expression);
  checkEq("H4", "h4.noOperator.beforeMarker", noOperator.beforeOperator.markerVisible, false);
  checkTrue("H4", "h4.noOperator.afterHasBase", noOperator.afterOperator.core.expression.split(/\s+/).includes("10"), noOperator.afterOperator.core.expression);
  checkTrue("H4", "h4.noOperator.afterLabel", noOperator.afterOperator.core.label.includes("10"), noOperator.afterOperator.core.label);
  checkEq("H4", "h4.noOperator.afterMarker", noOperator.afterOperator.markerVisible, true);

  const liveRedraw = await withStandard(async ({ page }) => {
    await configureSettings(page, { baseEnabled: true, baseText: "10" });
    await chooseOperator(page, "+");
    await enterScreenValue(page, "9.5");
    const before = await expressionText(page);
    await openSettingsPanel(page);
    await page.locator('[data-testid="settings-base-value"]').fill("20");
    const after = await expressionText(page);
    await closeSettingsPanel(page);
    return { before, after };
  });
  addEvidence("H4", "liveRedraw", liveRedraw);
  checkTrue("H4", "h4.liveRedraw.before", liveRedraw.before.split(/\s+/).includes("10"), liveRedraw.before);
  checkTrue("H4", "h4.liveRedraw.afterHas20", liveRedraw.after.split(/\s+/).includes("20"), liveRedraw.after);
  checkTrue("H4", "h4.liveRedraw.afterOmits10", !liveRedraw.after.split(/\s+/).includes("10"), liveRedraw.after);

  const invalidBase = await withStandard(async ({ page }) => {
    await configureSettings(page, { baseEnabled: true, baseText: "10" });
    await openSettingsPanel(page);
    const baseInput = page.locator('[data-testid="settings-base-value"]');
    await baseInput.fill("");
    const emptyDuringEdit = await baseInput.inputValue();
    await closeSettingsPanel(page);
    const restored = await baseInput.inputValue();
    await chooseOperator(page, "+");
    await enterScreenValue(page, "1");
    await pressEquals(page);
    return { emptyDuringEdit, restored, baseFinite: Number.isFinite(Number(restored)), core: await readCore(page), history: await historySnapshots(page) };
  });
  addEvidence("H4", "invalidBase", invalidBase);
  checkEq("H4", "h4.invalidBase.emptyDuringEdit", invalidBase.emptyDuringEdit, "");
  checkTrue("H4", "h4.invalidBase.restoredFinite", invalidBase.baseFinite, String(invalidBase.restored));
  checkNear("H4", "h4.invalidBase.result", invalidBase.core.result, 11);
  checkEq("H4", "h4.invalidBase.historyBase", invalidBase.history[0]?.["data-base"], "10");

  const divisionZero = await withStandard(async ({ page }) => {
    await configureSettings(page, { baseEnabled: true, baseText: "10" });
    await chooseOperator(page, "/");
    await enterScreenValue(page, "5");
    await enterScreenValue(page, "0");
    await pressEquals(page);
    return await readCore(page);
  });
  addEvidence("H4", "divisionZero", divisionZero);
  checkEq("H4", "h4.divisionZero.error", divisionZero.error, "true");
  checkEq("H4", "h4.divisionZero.value", divisionZero.result, null);
  checkEq("H4", "h4.divisionZero.history", divisionZero.history, 0);

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
    const editMarker = { visible: await isVisible(page, '[data-testid="edit-base-marker"]'), text: await page.locator('[data-testid="edit-base-marker"]').textContent() };
    const operandCount = await page.locator(S.operandInput).count();
    await page.locator(S.operandInput).nth(1).fill("5");
    await pressEquals(page);
    const afterEdit = await historySnapshots(page);
    const baseMarker = { visible: await isVisible(page, '[data-testid="base-marker"]'), text: await page.locator('[data-testid="base-marker"]').textContent() };
    return { firstResult, beforeEdit, editMarker, operandCount, afterEdit, baseMarker };
  });
  addEvidence("H4", "snapshot", snapshot);
  checkNear("H4", "h4.snapshot.firstResult", snapshot.firstResult, 15);
  checkEq("H4", "h4.snapshot.historyCount", snapshot.beforeEdit.length, 2);
  checkEq("H4", "h4.snapshot.bases", snapshot.beforeEdit.map((item) => item["data-base"]), ["20", "10"]);
  checkNear("H4", "h4.snapshot.newResult", snapshot.beforeEdit[0]?.result, 25);
  checkNear("H4", "h4.snapshot.oldResult", snapshot.beforeEdit[1]?.result, 15);
  checkEq("H4", "h4.snapshot.editMarkerVisible", snapshot.editMarker.visible, true);
  checkTrue("H4", "h4.snapshot.editMarkerText", String(snapshot.editMarker.text).includes("10"), String(snapshot.editMarker.text));
  checkEq("H4", "h4.snapshot.operandCount", snapshot.operandCount, 2);
  const old = snapshot.beforeEdit[1];
  const expectedEdited = Number(old["data-base"]) + Number(old.operands[0]) + 5;
  checkEq("H4", "h4.snapshot.editedBase", snapshot.afterEdit[0]?.["data-base"], "10");
  checkNear("H4", "h4.snapshot.editedResult", snapshot.afterEdit[0]?.result, expectedEdited);
  checkTrue(
    "H4",
    "h4.snapshot.editedExpression",
    snapshot.afterEdit[0]?.expression.split(/\s+/).includes("10") && snapshot.afterEdit[0]?.expression.split(/\s+/).includes("5"),
    snapshot.afterEdit[0]?.expression,
  );
  checkEq("H4", "h4.snapshot.baseMarkerVisible", snapshot.baseMarker.visible, true);
  checkTrue("H4", "h4.snapshot.baseMarkerText", String(snapshot.baseMarker.text).includes("20"), String(snapshot.baseMarker.text));
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
    addEvidence("H5", "inputNonEmpty", { inputBefore, inputAfter, expressionBefore, expressionAfter });
    checkEq("H5", "h5.inputNonEmpty.value", inputAfter, "9");
    checkEq("H5", "h5.inputNonEmpty.expression", expressionAfter, expressionBefore);
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
    checkTrue("H5", "h5.baseWithdraw.keepsBase", withdrawn.expression.split(/\s+/).includes("10"), withdrawn.expression);
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
    checkEq("H5", "h5.resultState.expression", after.expression, before.expression);
  });

  await withStandard(async ({ page }) => {
    await chooseOperator(page, "/");
    await enterScreenValue(page, "5");
    await enterScreenValue(page, "0");
    await pressEquals(page);
    await pressBackspace(page);
    const after = await readCore(page);
    addEvidence("H5", "errorState", after);
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
    addEvidence("H5", "editWithdraw", { initialChips, mainFocused, chipsAfterMain, operandValueBefore, operandValueAfter, chipsAfterOperand });
    checkEq("H5", "h5.editWithdraw.initialChips", initialChips, 2);
    checkEq("H5", "h5.editWithdraw.mainFocused", mainFocused, true);
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
    const { runSuite } = await import("file:///ws/cal_phone/tests/suite.mjs");
    suiteResults = await runSuite({ artifact: ARTIFACT });
  } catch (error) {
    suiteFailure = error && error.stack ? error.stack : String(error);
    suiteResults = [];
  }
  const cold = suiteResults.find((result) => result.id === "cold-start");
  const coldIds = cold ? cold.checks.map((check) => check.id) : [];
  const failed = suiteResults.filter((result) => !result.pass).map((result) => result.id);
  addEvidence("H6", "results", { count: suiteResults.length, failed, coldIds, failure: suiteFailure });
  checkEq("H6", "h6.results.length", suiteResults.length, 18, suiteFailure ? brief(suiteFailure) : "");
  checkTrue("H6", "h6.results.allPass", suiteResults.length === 18 && failed.length === 0, failed.join(",") || suiteFailure || "");
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
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height, left: value.left, right: value.right, top: value.top, bottom: value.bottom };
    };
    const controls = [...document.querySelectorAll("input,button,select")].filter(visible).map((element) => {
      const target = element.matches('input[type="checkbox"]') && element.closest("label") ? element.closest("label") : element;
      const box = target.getBoundingClientRect();
      return {
        tag: element.tagName,
        type: element.getAttribute("type"),
        testid: element.getAttribute("data-testid"),
        width: box.width,
        height: box.height,
        fontSize: parseFloat(getComputedStyle(element).fontSize),
      };
    });
    const inputFonts = [...document.querySelectorAll("input,select")].filter(visible).map((element) => parseFloat(getComputedStyle(element).fontSize));
    const gear = document.querySelector('[data-testid="settings-toggle"]');
    const panel = document.querySelector('[data-testid="settings-panel"]');
    const progress = document.querySelector('[data-testid="auto-confirm-progress"]');
    const baseMarker = document.querySelector('[data-testid="base-marker"]');
    const editMarker = document.querySelector('[data-testid="edit-base-marker"]');
    const editDraft = document.querySelector('[data-testid="edit-draft"]');
    return {
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: document.documentElement.clientHeight,
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      controls,
      minControlWidth: controls.length ? Math.min(...controls.map((control) => control.width)) : null,
      minControlHeight: controls.length ? Math.min(...controls.map((control) => control.height)) : null,
      minInputFont: inputFonts.length ? Math.min(...inputFonts) : null,
      gear: gear ? rect(gear) : null,
      panel: panel && panel.open ? rect(panel) : null,
      panelOpen: Boolean(panel && panel.open),
      state: document.querySelector("main.app")?.dataset.state,
      history: document.querySelectorAll('[data-testid="history-item"]').length,
      progressActive: progress?.getAttribute("data-active"),
      baseMarkerVisible: Boolean(baseMarker && baseMarker.getClientRects().length > 0),
      editMarkerVisible: Boolean(editMarker && editMarker.getClientRects().length > 0),
      editDraftVisible: Boolean(editDraft && editDraft.getClientRects().length > 0),
    };
  });
}

async function testH7() {
  const viewports = [
    { tag: "320x568", width: 320, height: 568, cdp: true },
    { tag: "390x844", width: 390, height: 844, cdp: false },
  ];
  const states = ["cold", "panel", "progress", "base-marker", "edit-draft", "two-history"];
  for (const viewport of viewports) {
    for (const state of states) {
      const app = viewport.cdp
        ? await openCustom({ viewport: { width: viewport.width, height: viewport.height }, cdp320: true })
        : await openStandard({ viewport: { width: viewport.width, height: viewport.height } });
      try {
        await setupLayoutState(app.page, state);
        const metrics = await measureLayout(app.page);
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
          editDraftVisible: metrics.editDraftVisible,
        });
        checkTrue("H7", `h7.${key}.docOverflow`, metrics.docOverflow <= 1, `${metrics.docOverflow}px`);
        checkTrue("H7", `h7.${key}.bodyOverflow`, metrics.bodyOverflow <= 1, `${metrics.bodyOverflow}px`);
        checkTrue("H7", `h7.${key}.controlsPresent`, metrics.controls.length > 0, String(metrics.controls.length));
        checkTrue(
          "H7",
          `h7.${key}.controlsMinSize`,
          metrics.controls.every((control) => control.width >= MIN_CONTROL && control.height >= MIN_CONTROL),
          `min=${Number(metrics.minControlWidth).toFixed(2)}x${Number(metrics.minControlHeight).toFixed(2)}`,
        );
        checkTrue(
          "H7",
          `h7.${key}.inputFont`,
          metrics.minInputFont === null || metrics.minInputFont >= MIN_INPUT_FONT,
          String(metrics.minInputFont),
        );
        if (state === "panel") {
          const limit = Math.min(320, metrics.viewportWidth - 16) + 1;
          checkTrue("H7", `h7.${key}.panelOpen`, metrics.panelOpen, String(metrics.panelOpen));
          checkTrue("H7", `h7.${key}.panelWidth`, Boolean(metrics.panel) && metrics.panel.width <= limit, `${metrics.panel?.width} <= ${limit}`);
          checkTrue(
            "H7",
            `h7.${key}.panelInside`,
            Boolean(metrics.panel) && metrics.panel.left >= -LAYOUT_TOL && metrics.panel.right <= metrics.viewportWidth + LAYOUT_TOL,
            fmt(metrics.panel),
          );
          checkTrue(
            "H7",
            `h7.${key}.panelBelowGear`,
            Boolean(metrics.panel && metrics.gear) && metrics.panel.top >= metrics.gear.bottom - 2,
            `${metrics.panel?.top} >= ${metrics.gear?.bottom - 2}`,
          );
          checkTrue(
            "H7",
            `h7.${key}.panelGearRight`,
            Boolean(metrics.panel && metrics.gear) && Math.abs(metrics.panel.right - metrics.gear.right) <= 16 + LAYOUT_TOL,
            `${metrics.panel?.right} vs ${metrics.gear?.right}`,
          );
        }
        if (state === "progress") checkEq("H7", `h7.${key}.progressActive`, metrics.progressActive, "true");
        if (state === "base-marker") checkEq("H7", `h7.${key}.baseMarkerVisible`, metrics.baseMarkerVisible, true);
        if (state === "edit-draft") {
          checkEq("H7", `h7.${key}.editMarkerVisible`, metrics.editMarkerVisible, true);
          checkEq("H7", `h7.${key}.editDraftVisible`, metrics.editDraftVisible, true);
          checkEq("H7", `h7.${key}.state`, metrics.state, "edit");
        }
        if (state === "two-history") checkEq("H7", `h7.${key}.history`, metrics.history, 2);
      } finally {
        await app.close();
      }
    }
  }
}

async function testH9() {
  const run = () =>
    withStandard(async ({ page }) => {
      await configureSettings(page, { autoConfirm: 0, baseEnabled: true, baseText: "10" });
      await chooseOperator(page, "+");
      for (const value of ["9.5", "9.2", "9.0"]) await enterScreenValue(page, value);
      await pressEquals(page);
      return { history: await historySnapshots(page), core: await readCore(page) };
    });
  const first = await run();
  const second = await run();
  addEvidence("H9", "first", first);
  addEvidence("H9", "second", second);
  checkEq("H9", "h9.first.records", first.history.length, 1);
  checkEq("H9", "h9.second.records", second.history.length, 1);
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
      return { x: value.x, y: value.y, width: value.width, height: value.height, left: value.left, right: value.right, top: value.top, bottom: value.bottom };
    };
    const controls = [...document.querySelectorAll("input,button,select")].filter(visible).map((element) => {
      const target = element.matches('input[type="checkbox"]') && element.closest("label") ? element.closest("label") : element;
      const box = target.getBoundingClientRect();
      return { width: box.width, height: box.height, fontSize: parseFloat(getComputedStyle(element).fontSize), tag: element.tagName };
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

async function waitForLayout(page) {
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    return true;
  });
}

async function renderReviewStates() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const captures = [
    {
      name: "S1",
      mode: "390",
      setup: async () => null,
    },
    {
      name: "S2",
      mode: "390",
      setup: async (page) => {
        await configureSettings(page, { autoConfirm: 1, baseEnabled: true, baseText: "10", close: false });
        return null;
      },
    },
    {
      name: "S3",
      mode: "390",
      setup: async (page) => {
        await configureSettings(page, { autoConfirm: 10, baseEnabled: true, baseText: "10" });
        await chooseOperator(page, "+");
        await enterScreenValue(page, "9.5");
        await typeScreen(page, "9.2");
        return Date.now();
      },
    },
    {
      name: "S4",
      mode: "320",
      setup: async (page) => {
        await configureSettings(page, { baseEnabled: true, baseText: "10", close: false });
        return null;
      },
    },
  ];

  for (const capture of captures) {
    let app = null;
    try {
      app = capture.mode === "320"
        ? await openCustom({ viewport: { width: 320, height: 568 }, cdp320: true })
        : await openStandard({ viewport: { width: 390, height: 844 } });
      const { page } = app;
      const sinceInput = await capture.setup(page);
      await waitForLayout(page);
      const before = await collectReviewMetrics(page);
      const file = path.join(SHOTS_DIR, `${capture.name}.png`);
      const shotStarted = Date.now();
      await page.screenshot({ path: file, fullPage: false });
      const captureMs = Date.now() - shotStarted;
      const progressActiveAfter = await page.locator('[data-testid="auto-confirm-progress"]').getAttribute("data-active");
      const bytes = fs.readFileSync(file);
      const png = inspectPng(bytes);
      const totalSinceInput = sinceInput ? Date.now() - sinceInput : null;
      const metrics = {
        ...before,
        file: `${capture.name}.png`,
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
      renderAudit.states.push({ name: capture.name, metrics });

      if (bytes.length === 0) renderAudit.issues.push(`${capture.name}: empty PNG`);
      if (png.uniqueColors <= 1) renderAudit.issues.push(`${capture.name}: solid PNG`);
      if (png.width < 240 || png.height < 160) renderAudit.issues.push(`${capture.name}: undersized ${png.width}x${png.height}`);
      if (capture.name === "S1" && (before.state !== "select" || before.history !== 0 || before.panelOpen)) {
        renderAudit.issues.push(`S1: not a cold default state`);
      }
      if (capture.name === "S2" || capture.name === "S4") {
        if (!before.panelOpen) renderAudit.issues.push(`${capture.name}: settings panel not open`);
        if (!before.settingsBaseEnabled || before.settingsBaseValue !== "10") renderAudit.issues.push(`${capture.name}: base 10 missing`);
      }
      if (capture.name === "S2" && before.settingsT !== "1") renderAudit.issues.push(`S2: t=${before.settingsT}`);
      if (capture.name === "S3") {
        if (before.settingsT !== "10" || !before.settingsBaseEnabled || before.settingsBaseValue !== "10") {
          renderAudit.issues.push(`S3: t/base not 10/10`);
        }
        if (before.progressActive !== "true" || progressActiveAfter !== "true") {
          renderAudit.issues.push(`S3: progress not active before/after screenshot`);
        }
        if (!(totalSinceInput !== null && totalSinceInput < 1000)) {
          renderAudit.issues.push(`S3: screenshot ${totalSinceInput}ms after input`);
        }
      }
      if (capture.name === "S4" && (png.width !== 320 || png.height !== 568)) {
        renderAudit.issues.push(`S4: CDP viewport rendered ${png.width}x${png.height}`);
      }
      if (before.docOverflow > 1 || before.bodyOverflow > 1) {
        renderAudit.issues.push(`${capture.name}: overflow doc=${before.docOverflow} body=${before.bodyOverflow}`);
      }
      if (app.pageErrors.length || app.consoleErrors.length) {
        renderAudit.issues.push(`${capture.name}: page errors ${fmt(app.pageErrors)} console errors ${fmt(app.consoleErrors)}`);
      }
    } catch (error) {
      renderAudit.issues.push(`${capture.name}: ${error && error.stack ? error.stack : String(error)}`);
    } finally {
      if (app) await app.close();
    }
  }

  const actualFiles = fs.existsSync(SHOTS_DIR) ? fs.readdirSync(SHOTS_DIR).sort() : [];
  const expectedFiles = REVIEW_STATES.map((name) => `${name}.png`).sort();
  if (!isDeepStrictEqual(actualFiles, expectedFiles)) renderAudit.issues.push(`review files ${fmt(actualFiles)} != ${fmt(expectedFiles)}`);
  const imageHashes = renderAudit.states.map((state) => state.metrics.image_sha256);
  if (new Set(imageHashes).size !== imageHashes.length) renderAudit.issues.push("duplicate screenshot contents");

  const header = [`ROUND: ${ROUND}`, `ARTIFACT_SHA256: ${ARTIFACT_SHA256}`, `VERIFIER_SHA256: ${VERIFIER_SHA256}`];
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
  const pageErrors = trackedApps.flatMap((app) => app.pageErrors);
  const consoleErrors = trackedApps.flatMap((app) => app.consoleErrors);
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
  addEvidence("H8", "metricsSha256", renderAudit.metricsSha256);
  checkTrue("H8", "h8.htmlClose", /<\/html>\s*$/i.test(html));
  checkTrue("H8", "h8.bytes", Buffer.byteLength(html) >= 1024, String(Buffer.byteLength(html)));
  checkEq("H8", "h8.externalRefs", external.length, 0, fmt(external));
  checkEq("H8", "h8.pageErrors", pageErrors.length, 0, pageErrors.join(" | "));
  checkEq("H8", "h8.consoleErrors", consoleErrors.length, 0, consoleErrors.join(" | "));
  checkEq("H8", "h8.suiteCleanFailures", suiteCleanFailures.length, 0, suiteCleanFailures.join(","));
  checkEq("H8", "h8.reviewArtifacts", renderAudit.issues.length, 0, renderAudit.issues.join(" | "));
  checkEq("H8", "h8.reviewFiles", shotFiles, REVIEW_STATES.map((name) => `${name}.png`).sort());
}

function hardLine(h) {
  const failed = checks[h].filter((check) => !check.pass);
  const failedText = failed.map((check) => `${check.id}: ${brief(check.detail, 700)}`).join("; ");
  const measured = Object.entries(evidence[h] || {}).map(([key, value]) => `${h.toLowerCase()}.${key}=${fmt(value)}`).join("; ");
  return `${h} ${failed.length === 0 ? "PASS" : "FAIL"} — checks=${checks[h].length} failed=${failed.length}${failedText ? `; ${failedText}` : ""}${measured ? `; ${measured}` : ""}`;
}

function writeHard() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const lines = [`ROUND: ${ROUND}`, `ARTIFACT_SHA256: ${ARTIFACT_SHA256}`, `VERIFIER_SHA256: ${VERIFIER_SHA256}`];
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
  try {
    await closeBrowser();
  } catch (error) {
    addCheck("H5", "h5.browser.close", false, error && error.stack ? error.stack : String(error));
  }
  await runH("H6", testH6);
  await runH("H7", testH7);
  await runH("H9", testH9);
  try {
    await renderReviewStates();
  } catch (error) {
    renderAudit.issues.push(error && error.stack ? error.stack : String(error));
  } finally {
    try {
      await closeBrowser();
    } catch (error) {
      renderAudit.issues.push(`browser close: ${error && error.stack ? error.stack : String(error)}`);
    }
  }
  await runH("H8", testH8);
  process.exitCode = writeHard() ? 0 : 1;
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exitCode = 2;
});
