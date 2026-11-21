#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const DEFAULT_ARTIFACT = "/ws/cal_phone/index.html";
const SETTINGS_KEY = "cal-phone.settings.v1";

const fromHere = (value) => (path.isAbsolute(value) ? value : path.join(HERE, value));
const artifact = fromHere(process.env.KEKKAI_ARTIFACT || DEFAULT_ARTIFACT);
const outDir = process.env.KEKKAI_OUT_DIR ? fromHere(process.env.KEKKAI_OUT_DIR) : path.join(HERE, "scratch");
const round = String(process.argv[2] ?? process.env.KEKKAI_ROUND ?? "1");
const artifactUrl = pathToFileURL(artifact).href;

const S = Object.freeze({
  app: "main.app[data-state]",
  keypad: '[data-testid="keypad"]',
  picker: '[data-testid="op-picker"]',
  input: '[data-testid="calc-input"]',
  expression: '[data-testid="expression"]',
  result: '[data-testid="result"]',
  keyEquals: '[data-testid="key-equals"]',
  keyOp: '[data-testid="key-op"]',
  historyItem: '[data-testid="history-item"]',
  historyResult: '[data-testid="history-result"]',
  historyExpression: '[data-testid="history-expression"]',
  historyEdit: '[data-testid="history-edit"]',
  editCancel: '[data-testid="edit-cancel"]',
  baseMarker: '[data-testid="base-marker"]',
  settingsToggle: '[data-testid="settings-toggle"]',
  settingsPanel: '[data-testid="settings-panel"]',
  settingsIndicator: '[data-testid="settings-indicator"]',
  settingsSummary: '[data-testid="settings-summary"]',
  autoEquals: '[data-testid="settings-auto-equals"]',
  autoEqualsHint: '[data-testid="auto-equals-hint"]',
  autoConfirm: '[data-testid="settings-auto-confirm"]',
  baseToggle: '[data-testid="settings-base-toggle"]',
  baseValue: '[data-testid="settings-base-value"]',
  settingsDone: '[data-testid="settings-done"]',
});

const observedPages = [];

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function safeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function fmt(value) {
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function add(checks, id, pass, detail = "") {
  const ok = Boolean(pass);
  checks.push({ id, pass: ok, detail: safeText(detail) });
  return ok;
}

function eq(checks, id, actual, expected, note = "") {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  const detail = pass
    ? `${fmt(actual)}${note ? ` (${note})` : ""}`
    : `expected ${fmt(expected)}, got ${fmt(actual)}${note ? ` — ${note}` : ""}`;
  return add(checks, id, pass, detail);
}

function near(checks, id, actual, expected, note = "") {
  const value = Number(actual);
  const pass = Number.isFinite(value) && Math.abs(value - expected) <= 1e-9;
  const detail = pass
    ? `${fmt(actual)} ≈ ${expected}${note ? ` (${note})` : ""}`
    : `expected ${expected} ± 1e-9, got ${fmt(actual)}${note ? ` — ${note}` : ""}`;
  return add(checks, id, pass, detail);
}

function ok(checks, id, pass, detail) {
  return add(checks, id, pass, detail);
}

function evidenceFor(checks, limit = 12000) {
  const failed = checks.filter((check) => !check.pass);
  const selected = failed.length ? failed.slice(0, 8) : checks;
  const text = selected.map((check) => `${check.id}=${check.detail || "ok"}`).join("; ");
  return `${failed.length ? `failed=${failed.length}/${checks.length}; ` : ""}${text.slice(0, limit)}${text.length > limit ? "…" : ""}`;
}

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

async function launchBrowser() {
  const require = createRequire("/ws/cal_phone/tests/package.json");
  const { chromium } = require("playwright");
  try {
    return await chromium.launch({ headless: true, timeout: 60000 });
  } catch (first) {
    try {
      return await chromium.launch({
        headless: true,
        chromiumSandbox: false,
        args: ["--disable-gpu"],
        timeout: 60000,
      });
    } catch (second) {
      throw new Error(`Playwright/Chromium unavailable: ${first.message} | fallback: ${second.message}`);
    }
  }
}

async function openApp(browser, { width = 390, height = 844 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(20000);
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error && error.stack ? error.stack : error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  observedPages.push({ pageErrors, consoleErrors });
  try {
    if (width === 320) {
      const session = await context.newCDPSession(page);
      await session.send("Emulation.setDeviceMetricsOverride", {
        width: 320,
        height: 568,
        deviceScaleFactor: 2,
        mobile: true,
      });
    }
    await page.goto(artifactUrl, { waitUntil: "load" });
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
  return {
    context,
    page,
    pageErrors,
    consoleErrors,
    async close() {
      await context.close().catch(() => {});
    },
  };
}

async function useApp(browser, fn, options) {
  const app = await openApp(browser, options);
  try {
    return await fn(app.page, app);
  } finally {
    await app.close();
  }
}

async function isVisible(page, selector) {
  return page.$eval(selector, (el) => {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    return el.getClientRects().length > 0;
  });
}

async function openSettings(page) {
  const isOpen = await page.$eval(S.settingsPanel, (el) => el.open === true);
  if (!isOpen) {
    await page.click(S.settingsToggle);
    await page.waitForFunction((selector) => document.querySelector(selector)?.open === true, S.settingsPanel);
  }
}

async function closeSettings(page) {
  const isOpen = await page.$eval(S.settingsPanel, (el) => el.open === true);
  if (isOpen) await page.click(S.settingsDone);
  await page.waitForFunction((selector) => document.querySelector(selector)?.open === false, S.settingsPanel);
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.getAttribute("aria-expanded") === "false",
    S.settingsToggle,
  );
}

async function setSettings(page, { autoEquals, autoConfirm, base } = {}) {
  await openSettings(page);
  if (autoEquals !== undefined) await page.fill(S.autoEquals, String(autoEquals));
  if (autoConfirm !== undefined) await page.selectOption(S.autoConfirm, String(autoConfirm));
  if (base !== undefined) {
    const checked = await page.$eval(S.baseToggle, (el) => el.checked === true);
    if (!checked) await page.click(S.baseToggle);
    await page.fill(S.baseValue, String(base));
  }
  await closeSettings(page);
}

async function chooseOperator(page, operator) {
  await page.click(`${S.picker} [data-op="${operator}"]`);
}

async function clickKey(page, key) {
  await page.click(`${S.keypad} [data-key="${key}"]`);
}

async function commitNumber(page, display) {
  for (const character of String(display)) await clickKey(page, character);
  await clickKey(page, "enter");
}

async function readSettings(page) {
  return page.evaluate((key) => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? null : JSON.parse(raw);
    } catch (error) {
      return { __parseError: String(error) };
    }
  }, SETTINGS_KEY);
}

async function readHistory(page) {
  return page.$$eval(S.historyItem, (items) =>
    items.map((item) => {
      const expression = item.querySelector('[data-testid="history-expression"]');
      const result = item.querySelector('[data-testid="history-result"]');
      let operands = null;
      try {
        operands = JSON.parse(item.getAttribute("data-operands") || "[]");
      } catch (error) {
        operands = { __parseError: String(error) };
      }
      return {
        operator: item.getAttribute("data-operator"),
        operands,
        base: item.getAttribute("data-base"),
        expression: expression ? (expression.textContent || "").trim() : null,
        resultValue: result ? result.getAttribute("data-value") : null,
        resultText: result ? (result.textContent || "").trim() : null,
      };
    }),
  );
}

async function readState(page) {
  const [state, expression, resultText, resultValue, inputValue, historyCount] = await Promise.all([
    page.$eval(S.app, (el) => el.dataset.state),
    page.$eval(S.expression, (el) => (el.textContent || "").trim()),
    page.$eval(S.result, (el) => (el.textContent || "").trim()),
    page.$eval(S.result, (el) => el.getAttribute("data-value")),
    page.inputValue(S.input),
    page.$$eval(S.historyItem, (items) => items.length),
  ]);
  return { state, expression, resultText, resultValue, inputValue, historyCount };
}

async function readSnapshot(page) {
  const state = await readState(page);
  const history = await readHistory(page);
  const settings = await readSettings(page);
  return {
    state: state.state,
    expression: state.expression,
    resultValue: state.resultValue,
    resultText: state.resultText,
    inputValue: state.inputValue,
    history,
    settings,
  };
}

function comparableHistory(history) {
  return history.map((item) => ({
    operator: item.operator,
    operands: item.operands,
    base: item.base,
    expression: item.expression,
    resultValue: item.resultValue,
  }));
}

function checkResult(checks, prefix, state, { expectedState, expectedExpression, expectedResult, expectedHistory }) {
  eq(checks, `${prefix}.state`, state.state, expectedState);
  eq(checks, `${prefix}.expression`, state.expression, expectedExpression);
  eq(checks, `${prefix}.input`, state.inputValue, "");
  eq(checks, `${prefix}.history-count`, state.historyCount, expectedHistory);
  if (expectedResult === null) {
    eq(checks, `${prefix}.result-text`, state.resultText, "");
    eq(checks, `${prefix}.result-value`, state.resultValue, null);
  } else {
    near(checks, `${prefix}.result-text`, state.resultText, expectedResult);
    near(checks, `${prefix}.result-value`, state.resultValue, expectedResult);
  }
}

async function H1(browser) {
  const checks = [];
  await useApp(browser, async (page) => {
    await openSettings(page);
    ok(checks, "H1.auto-equals-visible", await isVisible(page, S.autoEquals), `visible=${await isVisible(page, S.autoEquals)}`);
    eq(checks, "H1.initial-value", await page.inputValue(S.autoEquals), "0");
    const name = await page.$eval(
      S.autoEquals,
      (el) => el.getAttribute("aria-label") || (el.labels && el.labels[0] && el.labels[0].textContent) || "",
    );
    ok(
      checks,
      "H1.accessible-name",
      name.includes("自动") && name.includes("等号"),
      `name=${fmt(name)} contains-auto=${name.includes("自动")} contains-equals=${name.includes("等号")}`,
    );
    const hintVisible = await isVisible(page, S.autoEqualsHint);
    const hint = await page.$eval(S.autoEqualsHint, (el) => (el.textContent || "").trim());
    ok(checks, "H1.hint-visible", hintVisible, `visible=${hintVisible}`);
    ok(checks, "H1.hint-text", hint.length > 0 && /等号|=/.test(hint), `hint=${fmt(hint)}`);

    await page.fill(S.autoEquals, "3");
    let stored = await readSettings(page);
    ok(
      checks,
      "H1.store-3",
      stored && Number.isInteger(stored.autoEquals) && stored.autoEquals === 3,
      `settings=${fmt(stored)}`,
    );
    const indicatorVisible = await isVisible(page, S.settingsIndicator);
    const summaryVisible = await isVisible(page, S.settingsSummary);
    ok(checks, "H1.indicator-visible", indicatorVisible, `visible=${indicatorVisible}`);
    ok(checks, "H1.summary-visible", summaryVisible, `visible=${summaryVisible}`);
    await closeSettings(page);
    const afterCloseVisible = await isVisible(page, S.settingsIndicator);
    ok(checks, "H1.indicator-after-close", afterCloseVisible, `visible=${afterCloseVisible}`);

    await page.reload({ waitUntil: "load" });
    await openSettings(page);
    eq(checks, "H1.reload-value-3", await page.inputValue(S.autoEquals), "3");
    stored = await readSettings(page);
    ok(checks, "H1.reload-store-3", stored && stored.autoEquals === 3, `settings=${fmt(stored)}`);

    await page.fill(S.autoEquals, "0");
    stored = await readSettings(page);
    ok(checks, "H1.store-0", stored && stored.autoEquals === 0, `settings=${fmt(stored)}`);
    const visibleAtZero = await isVisible(page, S.settingsIndicator);
    ok(checks, "H1.indicator-hidden-at-0", !visibleAtZero, `visible=${visibleAtZero}`);
    await closeSettings(page);
    await page.reload({ waitUntil: "load" });
    await openSettings(page);
    eq(checks, "H1.reload-value-0", await page.inputValue(S.autoEquals), "0");

    for (const invalid of ["abc", "2.5", "1000", "-1"]) {
      await openSettings(page);
      await page.fill(S.autoEquals, invalid);
      await closeSettings(page);
      await openSettings(page);
      eq(checks, `H1.invalid-${invalid}.value`, await page.inputValue(S.autoEquals), "0");
      stored = await readSettings(page);
      ok(checks, `H1.invalid-${invalid}.store`, stored && stored.autoEquals === 0, `settings=${fmt(stored)}`);
    }

    await page.fill(S.autoEquals, "999");
    stored = await readSettings(page);
    ok(checks, "H1.store-999", stored && stored.autoEquals === 999, `settings=${fmt(stored)}`);
    eq(checks, "H1.value-999", await page.inputValue(S.autoEquals), "999");
  });
  return checks;
}

async function H2(browser) {
  const checks = [];
  await useApp(browser, async (page) => {
    await setSettings(page, { autoEquals: 3 });
    await chooseOperator(page, "+");
    await commitNumber(page, "95");
    checkResult(checks, "H2.n3.first", await readState(page), {
      expectedState: "input",
      expectedExpression: "95 +",
      expectedResult: null,
      expectedHistory: 0,
    });
    await commitNumber(page, "92");
    checkResult(checks, "H2.n3.second", await readState(page), {
      expectedState: "input",
      expectedExpression: "95 + 92 +",
      expectedResult: null,
      expectedHistory: 0,
    });
    await commitNumber(page, "90");
    checkResult(checks, "H2.n3.third", await readState(page), {
      expectedState: "result",
      expectedExpression: "95 + 92 + 90",
      expectedResult: 277,
      expectedHistory: 1,
    });
    const history = await readHistory(page);
    eq(checks, "H2.n3.history-count", history.length, 1);
    eq(checks, "H2.n3.history-operator", history[0]?.operator, "+");
    eq(checks, "H2.n3.history-operands", history[0]?.operands, ["95", "92", "90"]);
    near(checks, "H2.n3.history-result", history[0]?.resultValue, 277);
  });

  await useApp(browser, async (page) => {
    await setSettings(page, { autoEquals: 1 });
    await chooseOperator(page, "+");
    await commitNumber(page, "8");
    checkResult(checks, "H2.n1", await readState(page), {
      expectedState: "result",
      expectedExpression: "8",
      expectedResult: 8,
      expectedHistory: 1,
    });
  });

  await useApp(browser, async (page) => {
    await setSettings(page, { autoEquals: 5 });
    await chooseOperator(page, "+");
    for (const value of ["1", "2", "3", "4"]) {
      await commitNumber(page, value);
      checkResult(checks, `H2.n5.${value}`, await readState(page), {
        expectedState: "input",
        expectedExpression: `${value === "1" ? "1 +" : value === "2" ? "1 + 2 +" : value === "3" ? "1 + 2 + 3 +" : "1 + 2 + 3 + 4 +"}`,
        expectedResult: null,
        expectedHistory: 0,
      });
    }
    await commitNumber(page, "5");
    checkResult(checks, "H2.n5.fifth", await readState(page), {
      expectedState: "result",
      expectedExpression: "1 + 2 + 3 + 4 + 5",
      expectedResult: 15,
      expectedHistory: 1,
    });
  });

  await useApp(browser, async (page) => {
    await setSettings(page, { autoEquals: 0 });
    await chooseOperator(page, "+");
    await commitNumber(page, "95");
    await commitNumber(page, "92");
    await commitNumber(page, "90");
    checkResult(checks, "H2.n0.before-equals", await readState(page), {
      expectedState: "input",
      expectedExpression: "95 + 92 + 90 +",
      expectedResult: null,
      expectedHistory: 0,
    });
    await page.click(S.keyEquals);
    checkResult(checks, "H2.n0.after-equals", await readState(page), {
      expectedState: "result",
      expectedExpression: "95 + 92 + 90",
      expectedResult: 277,
      expectedHistory: 1,
    });
  });

  await useApp(browser, async (page) => {
    await setSettings(page, { autoEquals: 3 });
    await chooseOperator(page, "+");
    await commitNumber(page, "100");
    await commitNumber(page, "9.5");
    await commitNumber(page, "9.");
    const state = await readState(page);
    checkResult(checks, "H2.numeric", state, {
      expectedState: "result",
      expectedExpression: "100 + 9.5 + 9.",
      expectedResult: 118.5,
      expectedHistory: 1,
    });
  });
  return checks;
}

async function H3(browser) {
  const checks = [];

  await useApp(browser, async (page) => {
    await setSettings(page, { autoEquals: 2, autoConfirm: 1 });
    await chooseOperator(page, "+");
    await clickKey(page, "9");
    await clickKey(page, "5");
    await page.waitForTimeout(1400);
    checkResult(checks, "H3.a.first", await readState(page), {
      expectedState: "input",
      expectedExpression: "95 +",
      expectedResult: null,
      expectedHistory: 0,
    });
    await clickKey(page, "9");
    await clickKey(page, "2");
    await page.waitForTimeout(1400);
    checkResult(checks, "H3.a.second", await readState(page), {
      expectedState: "result",
      expectedExpression: "95 + 92",
      expectedResult: 187,
      expectedHistory: 1,
    });
    await page.waitForTimeout(1200);
    const stable = await readState(page);
    eq(checks, "H3.a.stable.history", stable.historyCount, 1);
    near(checks, "H3.a.stable.result", stable.resultValue, 187);
  });

  await useApp(browser, async (page) => {
    await setSettings(page, { autoEquals: 2 });
    await chooseOperator(page, "+");
    await page.keyboard.type("95");
    await page.keyboard.press("Enter");
    await page.keyboard.type("92");
    await page.keyboard.press("Enter");
    checkResult(checks, "H3.b.keyboard", await readState(page), {
      expectedState: "result",
      expectedExpression: "95 + 92",
      expectedResult: 187,
      expectedHistory: 1,
    });
  });

  await useApp(browser, async (page) => {
    await setSettings(page, { autoEquals: 3, base: 10 });
    await chooseOperator(page, "+");
    await commitNumber(page, "95");
    await commitNumber(page, "92");
    checkResult(checks, "H3.c.before-third", await readState(page), {
      expectedState: "input",
      expectedExpression: "10 + 95 + 92 +",
      expectedResult: null,
      expectedHistory: 0,
    });
    await commitNumber(page, "90");
    checkResult(checks, "H3.c.third", await readState(page), {
      expectedState: "result",
      expectedExpression: "10 + 95 + 92 + 90",
      expectedResult: 287,
      expectedHistory: 1,
    });
    const history = await readHistory(page);
    eq(checks, "H3.c.history-base", history[0]?.base, "10");
    const markerVisible = await isVisible(page, S.baseMarker);
    const marker = await page.$eval(S.baseMarker, (el) => (el.textContent || "").trim());
    ok(
      checks,
      "H3.c.base-marker",
      markerVisible && marker.includes("10"),
      `visible=${markerVisible}; text=${fmt(marker)}`,
    );
  });

  await useApp(browser, async (page) => {
    await setSettings(page, { autoEquals: 2 });
    await chooseOperator(page, "+");
    await commitNumber(page, "1");
    checkResult(checks, "H3.d.before-empty", await readState(page), {
      expectedState: "input",
      expectedExpression: "1 +",
      expectedResult: null,
      expectedHistory: 0,
    });
    await clickKey(page, "enter");
    checkResult(checks, "H3.d.empty-enter", await readState(page), {
      expectedState: "input",
      expectedExpression: "1 +",
      expectedResult: null,
      expectedHistory: 0,
    });
    await commitNumber(page, "2");
    checkResult(checks, "H3.d.second", await readState(page), {
      expectedState: "result",
      expectedExpression: "1 + 2",
      expectedResult: 3,
      expectedHistory: 1,
    });
  });

  await useApp(browser, async (page) => {
    await setSettings(page, { autoEquals: 3 });
    await chooseOperator(page, "+");
    await commitNumber(page, "1");
    await commitNumber(page, "2");
    checkResult(checks, "H3.e.before-backspace", await readState(page), {
      expectedState: "input",
      expectedExpression: "1 + 2 +",
      expectedResult: null,
      expectedHistory: 0,
    });
    await clickKey(page, "backspace");
    checkResult(checks, "H3.e.after-backspace", await readState(page), {
      expectedState: "input",
      expectedExpression: "1 +",
      expectedResult: null,
      expectedHistory: 0,
    });
    await commitNumber(page, "3");
    await commitNumber(page, "4");
    checkResult(checks, "H3.e.after-third-fourth", await readState(page), {
      expectedState: "result",
      expectedExpression: "1 + 3 + 4",
      expectedResult: 8,
      expectedHistory: 1,
    });
  });

  await useApp(browser, async (page) => {
    await setSettings(page, { autoEquals: 2 });
    await commitNumber(page, "1");
    await commitNumber(page, "2");
    checkResult(checks, "H3.f.no-operator", await readState(page), {
      expectedState: "input",
      expectedExpression: "1 2",
      expectedResult: null,
      expectedHistory: 0,
    });
    await chooseOperator(page, "+");
    const afterOperator = await readState(page);
    eq(checks, "H3.f.after-operator.state", afterOperator.state, "input");
    eq(checks, "H3.f.after-operator.result", afterOperator.resultValue, null);
    eq(checks, "H3.f.after-operator.history", afterOperator.historyCount, 0);
    await commitNumber(page, "3");
    checkResult(checks, "H3.f.after-third", await readState(page), {
      expectedState: "result",
      expectedExpression: "1 + 2 + 3",
      expectedResult: 6,
      expectedHistory: 1,
    });
  });

  await useApp(browser, async (page) => {
    await setSettings(page, { autoEquals: 0 });
    await chooseOperator(page, "+");
    await commitNumber(page, "5");
    await commitNumber(page, "5");
    await page.click(S.keyEquals);
    checkResult(checks, "H3.g.initial-result", await readState(page), {
      expectedState: "result",
      expectedExpression: "5 + 5",
      expectedResult: 10,
      expectedHistory: 1,
    });
    await setSettings(page, { autoEquals: 1 });
    await page.click(S.historyEdit);
    eq(checks, "H3.g.edit-state", await page.$eval(S.app, (el) => el.dataset.state), "edit");
    await clickKey(page, "3");
    await clickKey(page, "enter");
    const edited = await readState(page);
    eq(checks, "H3.g.still-edit", edited.state, "edit");
    eq(checks, "H3.g.history-still-one", edited.historyCount, 1);
    eq(checks, "H3.g.result-still-ten", edited.resultValue, "10");
    await page.click(S.editCancel);
    const cancelled = await readState(page);
    eq(checks, "H3.g.cancel-state", cancelled.state, "result");
    near(checks, "H3.g.cancel-result", cancelled.resultValue, 10);
  });

  await useApp(browser, async (page) => {
    await setSettings(page, { autoEquals: 2 });
    await chooseOperator(page, "/");
    await commitNumber(page, "5");
    const before = await readState(page);
    eq(checks, "H3.h.before-zero.result", before.resultValue, null);
    eq(checks, "H3.h.before-zero.history", before.historyCount, 0);
    await commitNumber(page, "0");
    const failed = await readState(page);
    eq(checks, "H3.h.state", failed.state, "error");
    eq(checks, "H3.h.error-attr", await page.$eval(S.result, (el) => el.getAttribute("data-error")), "true");
    eq(checks, "H3.h.error-text", failed.resultText, "不能除以零");
    eq(checks, "H3.h.history", failed.historyCount, 0);
  });

  await useApp(browser, async (page) => {
    await setSettings(page, { autoEquals: 0 });
    await chooseOperator(page, "+");
    await commitNumber(page, "1");
    await commitNumber(page, "2");
    checkResult(checks, "H3.i.before-change", await readState(page), {
      expectedState: "input",
      expectedExpression: "1 + 2 +",
      expectedResult: null,
      expectedHistory: 0,
    });
    await setSettings(page, { autoEquals: 2 });
    const afterChange = await readState(page);
    eq(checks, "H3.i.after-change.state", afterChange.state, "input");
    eq(checks, "H3.i.after-change.result", afterChange.resultValue, null);
    eq(checks, "H3.i.after-change.history", afterChange.historyCount, 0);
    await commitNumber(page, "3");
    checkResult(checks, "H3.i.after-third", await readState(page), {
      expectedState: "result",
      expectedExpression: "1 + 2 + 3",
      expectedResult: 6,
      expectedHistory: 1,
    });
  });

  return checks;
}

async function H4(browser) {
  const checks = [];
  let automatic = null;
  await useApp(browser, async (page) => {
    await setSettings(page, { autoEquals: 3 });
    await chooseOperator(page, "+");
    await commitNumber(page, "95");
    await commitNumber(page, "92");
    await commitNumber(page, "90");
    automatic = await readSnapshot(page);
    eq(checks, "H4.A.state", automatic.state, "result");
    near(checks, "H4.A.result", automatic.resultValue, 277);
    eq(checks, "H4.A.history", automatic.history.length, 1);
    await page.waitForTimeout(500);
    eq(checks, "H4.A.stable-history", (await readState(page)).historyCount, 1);

    await commitNumber(page, "85");
    await commitNumber(page, "86");
    const beforeThird = await readState(page);
    eq(checks, "H4.A.next.before-third.state", beforeThird.state, "input");
    eq(checks, "H4.A.next.before-third.result", beforeThird.resultValue, null);
    await commitNumber(page, "87");
    const secondResult = await readState(page);
    checkResult(checks, "H4.A.next.third", secondResult, {
      expectedState: "result",
      expectedExpression: "85 + 86 + 87",
      expectedResult: 258,
      expectedHistory: 2,
    });
    const history = await readHistory(page);
    eq(checks, "H4.A.next.newest-operands", history[0]?.operands, ["85", "86", "87"]);
    near(checks, "H4.A.next.old-result", history[1]?.resultValue, 277);
  });

  let manual = null;
  await useApp(browser, async (page) => {
    await setSettings(page, { autoEquals: 0 });
    await chooseOperator(page, "+");
    await commitNumber(page, "95");
    await commitNumber(page, "92");
    await commitNumber(page, "90");
    await page.click(S.keyEquals);
    manual = await readSnapshot(page);
  });

  eq(checks, "H4.equivalent.state", automatic.state, manual.state);
  eq(checks, "H4.equivalent.expression", automatic.expression, manual.expression);
  eq(checks, "H4.equivalent.result-text", automatic.resultText, manual.resultText);
  eq(checks, "H4.equivalent.result-value", automatic.resultValue, manual.resultValue);
  eq(checks, "H4.equivalent.history-count", automatic.history.length, manual.history.length);
  eq(checks, "H4.equivalent.history", comparableHistory(automatic.history), comparableHistory(manual.history));

  await useApp(browser, async (page) => {
    await setSettings(page, { autoEquals: 1, base: 10 });
    await chooseOperator(page, "+");
    await commitNumber(page, "5");
    checkResult(checks, "H4.n1base", await readState(page), {
      expectedState: "result",
      expectedExpression: "10 + 5",
      expectedResult: 15,
      expectedHistory: 1,
    });
    const history = await readHistory(page);
    eq(checks, "H4.n1base.history-base", history[0]?.base, "10");
  });

  return checks;
}

async function H5(browser) {
  const checks = [];
  let suiteResults = null;
  try {
    const { runSuite } = await import("file:///ws/cal_phone/tests/suite.mjs");
    suiteResults = await runSuite({ artifact });
  } catch (error) {
    ok(checks, "H5.suite.import", false, `suite failed to run: ${error && error.message ? error.message : error}`);
  }
  if (suiteResults) {
    eq(checks, "H5.suite.count", suiteResults.length, 18);
    const failed = suiteResults.filter((result) => !result.pass);
    ok(
      checks,
      "H5.suite.all-pass",
      failed.length === 0,
      failed.length === 0
        ? `18/18 scenarios pass; checks=${suiteResults.reduce((sum, result) => sum + result.checks.length, 0)}`
        : `failed=${failed.map((result) => result.id).join(",")}`,
    );
    const coldStart = suiteResults.find((result) => result.id === "cold-start");
    ok(
      checks,
      "H5.cold-start.keys-enabled",
      Boolean(coldStart && coldStart.checks.some((check) => check.id === "cold-start.keys-enabled")),
      coldStart ? `checks=${coldStart.checks.length}; has-keys-enabled=${coldStart.checks.some((check) => check.id === "cold-start.keys-enabled")}` : "cold-start missing",
    );
  }

  await useApp(browser, async (page) => {
    await openSettings(page);
    const values = await page.$$eval(`${S.autoConfirm} option`, (options) => options.map((option) => option.value));
    const expected = [0, 0.2, 0.4, ...Array.from({ length: 20 }, (_, index) => (index + 1) / 2)].map(String);
    eq(checks, "H5.auto-confirm.count", values.length, 23);
    eq(checks, "H5.auto-confirm.values", values, expected);
    eq(checks, "H5.auto-confirm.default", await page.$eval(S.autoConfirm, (el) => el.value), "0");
  });

  await useApp(browser, async (page) => {
    await setSettings(page, { autoConfirm: 1 });
    await chooseOperator(page, "+");
    await clickKey(page, "9");
    await page.waitForTimeout(1400);
    checkResult(checks, "H5.auto-confirm.one", await readState(page), {
      expectedState: "input",
      expectedExpression: "9 +",
      expectedResult: null,
      expectedHistory: 0,
    });
    await clickKey(page, "5");
    await page.waitForTimeout(1400);
    checkResult(checks, "H5.auto-confirm.two", await readState(page), {
      expectedState: "input",
      expectedExpression: "9 + 5 +",
      expectedResult: null,
      expectedHistory: 0,
    });
    await page.click(S.keyEquals);
    checkResult(checks, "H5.auto-confirm.equals", await readState(page), {
      expectedState: "result",
      expectedExpression: "9 + 5",
      expectedResult: 14,
      expectedHistory: 1,
    });
  });

  await useApp(browser, async (page) => {
    await setSettings(page, { base: 10 });
    await chooseOperator(page, "+");
    await commitNumber(page, "9.5");
    await page.click(S.keyEquals);
    checkResult(checks, "H5.base-manual", await readState(page), {
      expectedState: "result",
      expectedExpression: "10 + 9.5",
      expectedResult: 19.5,
      expectedHistory: 1,
    });
    const history = await readHistory(page);
    eq(checks, "H5.base-manual.history-base", history[0]?.base, "10");
  });

  await useApp(browser, async (page) => {
    await chooseOperator(page, "+");
    await clickKey(page, "8");
    eq(checks, "H5.draft.before-equals.input", await page.inputValue(S.input), "8");
    await page.click(S.keyEquals);
    checkResult(checks, "H5.draft.after-equals", await readState(page), {
      expectedState: "result",
      expectedExpression: "8",
      expectedResult: 8,
      expectedHistory: 1,
    });
  });

  await useApp(
    browser,
    async (page) => {
      await openSettings(page);
      const metrics = await page.evaluate(
        ({ panelSelector, inputSelector }) => {
          const doc = document.documentElement;
          const body = document.body;
          const panel = document.querySelector(panelSelector);
          const input = document.querySelector(inputSelector);
          const panelRect = panel.getBoundingClientRect();
          const inputRect = input.getBoundingClientRect();
          return {
            docOverflow: doc.scrollWidth - doc.clientWidth,
            bodyOverflow: body.scrollWidth - body.clientWidth,
            panel: { left: panelRect.left, right: panelRect.right, top: panelRect.top, bottom: panelRect.bottom },
            input: {
              left: inputRect.left,
              top: inputRect.top,
              width: inputRect.width,
              height: inputRect.height,
              fontSize: parseFloat(getComputedStyle(input).fontSize),
            },
            viewport: { innerWidth: window.innerWidth, innerHeight: window.innerHeight, clientWidth: doc.clientWidth, clientHeight: doc.clientHeight },
          };
        },
        { panelSelector: S.settingsPanel, inputSelector: S.autoEquals },
      );
      ok(checks, "H5.320.doc-overflow", metrics.docOverflow <= 1, `overflow=${metrics.docOverflow}`);
      ok(checks, "H5.320.body-overflow", metrics.bodyOverflow <= 1, `overflow=${metrics.bodyOverflow}`);
      ok(
        checks,
        "H5.320.panel-horizontal",
        metrics.panel.left >= -1e-9 && metrics.panel.right <= 320 + 1e-9,
        `left=${metrics.panel.left.toFixed(2)} right=${metrics.panel.right.toFixed(2)}`,
      );
      ok(
        checks,
        "H5.320.input-height",
        metrics.input.height >= 43.5 - 1e-9,
        `rect=${metrics.input.left.toFixed(2)},${metrics.input.top.toFixed(2)},${metrics.input.width.toFixed(2)},${metrics.input.height.toFixed(2)}; height=${metrics.input.height.toFixed(2)}`,
      );
      ok(checks, "H5.320.input-font", metrics.input.fontSize >= 15.5 - 1e-9, `font=${metrics.input.fontSize}`);
      eq(checks, "H5.320.viewport-width", metrics.viewport.innerWidth, 320);
      eq(checks, "H5.320.viewport-height", metrics.viewport.innerHeight, 568);
      await page.locator(S.settingsDone).scrollIntoViewIfNeeded();
      const done = await page.$eval(S.settingsDone, (el) => {
        const rect = el.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
      });
      ok(
        checks,
        "H5.320.done-vertical",
        done.top >= -1e-9 && done.bottom <= 568 + 1e-9,
        `top=${done.top.toFixed(2)} bottom=${done.bottom.toFixed(2)}`,
      );
    },
    { width: 320, height: 568 },
  );

  await useApp(browser, async (page) => {
    await setSettings(page, { autoEquals: 3 });
    await chooseOperator(page, "+");
    await page.click(S.keyOp);
    const stored = await readSettings(page);
    ok(checks, "H5.reset.keeps-setting", stored && stored.autoEquals === 3, `settings=${fmt(stored)}`);
    await openSettings(page);
    eq(checks, "H5.reset.reopen-value", await page.inputValue(S.autoEquals), "3");
  });

  return checks;
}

function countExternalRefs(html) {
  const urls = [];
  const tagPatterns = [
    /<script[^>]+src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    /<link[^>]+href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    /<img[^>]+src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
  ];
  for (const pattern of tagPatterns) {
    for (const match of html.matchAll(pattern)) urls.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  for (const match of html.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi)) urls.push(match[1]);
  for (const match of html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) urls.push(match[1]);
  return urls.filter((url) => /^(?:https?:)?\/\//i.test(url.trim())).length;
}

async function H6(browser) {
  const checks = [];
  let text = null;
  let readError = null;
  try {
    text = fs.readFileSync(artifact, "utf8");
  } catch (error) {
    readError = error && error.message ? error.message : String(error);
  }
  if (readError) {
    ok(checks, "H6.artifact-read", false, `read failed: ${readError}`);
    return checks;
  }
  ok(checks, "H6.html-close", text.includes("</html>"), `contains-close=${text.includes("</html>")}; bytes=${Buffer.byteLength(text)}`);
  ok(checks, "H6.min-bytes", Buffer.byteLength(text) >= 1024, `bytes=${Buffer.byteLength(text)}`);
  const external = countExternalRefs(text);
  eq(checks, "H6.external-refs", external, 0);
  eq(checks, "H6.pages-observed", observedPages.length > 0, true, `pages=${observedPages.length}`);
  const pageErrors = observedPages.flatMap((entry) => entry.pageErrors);
  const consoleErrors = observedPages.flatMap((entry) => entry.consoleErrors);
  eq(checks, "H6.page-errors", pageErrors.length, 0, pageErrors.slice(0, 3).join(" | "));
  eq(checks, "H6.console-errors", consoleErrors.length, 0, consoleErrors.slice(0, 3).join(" | "));
  if (!browser) {
    ok(checks, "H6.parse", false, "BROWSER UNAVAILABLE — parse check not executed");
    return checks;
  }
  let context = null;
  const parseErrors = [];
  try {
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(20000);
    page.on("pageerror", (error) => parseErrors.push(String(error)));
    await page.goto(artifactUrl, { waitUntil: "load" });
    const appRoot = await page.evaluate(() => Boolean(document.querySelector("main.app[data-state]")));
    ok(checks, "H6.parse", appRoot, `app-root=${appRoot}; pageerrors=${parseErrors.length}`);
  } catch (error) {
    ok(checks, "H6.parse", false, `load-error=${error && error.message ? error.message : error}; pageerrors=${parseErrors.length}`);
  } finally {
    if (context) await context.close().catch(() => {});
  }
  return checks;
}

async function H7(browser) {
  const checks = [];
  const serialization = (snapshot) => ({
    state: snapshot.state,
    expression: snapshot.expression,
    resultValue: snapshot.resultValue,
    resultText: snapshot.resultText,
    inputValue: snapshot.inputValue,
    history: snapshot.history.map((item) => ({
      operator: item.operator,
      operands: item.operands,
      base: item.base,
      expression: item.expression,
      result: item.resultValue,
    })),
    settings: snapshot.settings,
  });
  const runOnce = async () =>
    useApp(browser, async (page) => {
      await setSettings(page, { autoEquals: 3, base: 10 });
      await chooseOperator(page, "+");
      await commitNumber(page, "95");
      await commitNumber(page, "92");
      await commitNumber(page, "90");
      return readSnapshot(page);
    });
  const first = await runOnce();
  const second = await runOnce();
  const firstJson = JSON.stringify(serialization(first));
  const secondJson = JSON.stringify(serialization(second));
  const identical = firstJson === secondJson;
  ok(
    checks,
    "H7.snapshot-identical",
    identical,
    identical
      ? `equal=true; state=${first.state}; result=${first.resultValue}; history=${first.history.length}`
      : `A=${firstJson} B=${secondJson}`,
  );
  eq(checks, "H7.first.result", first.resultValue, "287");
  eq(checks, "H7.first.history", first.history.length, 1);
  eq(checks, "H7.first.settings-auto-equals", first.settings?.autoEquals, 3);
  eq(checks, "H7.first.settings-base-enabled", first.settings?.baseEnabled, true);
  eq(checks, "H7.second.settings-auto-equals", second.settings?.autoEquals, 3);
  eq(checks, "H7.second.history", second.history.length, 1);
  return checks;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  let artifactSha = "0".repeat(64);
  try {
    artifactSha = sha256File(artifact);
  } catch {
    artifactSha = "0".repeat(64);
  }
  const verifierSha = sha256File(SELF);

  let browser = null;
  let launchError = null;
  try {
    browser = await launchBrowser();
  } catch (error) {
    launchError = error && error.message ? error.message : String(error);
  }

  const results = {};
  const runners = [
    ["H1", () => H1(browser), 180000],
    ["H2", () => H2(browser), 180000],
    ["H3", () => H3(browser), 240000],
    ["H4", () => H4(browser), 180000],
    ["H5", () => H5(browser), 300000],
    ["H6", () => H6(browser), 60000],
    ["H7", () => H7(browser), 180000],
  ];

  try {
    for (const [id, run, timeout] of runners) {
      if (!browser && id !== "H6") {
        results[id] = {
          pass: false,
          evidence: `BROWSER UNAVAILABLE — measurement not executed: ${launchError}`,
        };
        continue;
      }
      try {
        const checks = await withTimeout(run(), timeout, id);
        const pass = checks.length > 0 && checks.every((check) => check.pass);
        results[id] = { pass, evidence: checks.length ? evidenceFor(checks) : "no checks executed" };
      } catch (error) {
        results[id] = {
          pass: false,
          evidence: `exception: ${error && error.message ? error.message : String(error)}`,
        };
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  const ids = ["H1", "H2", "H3", "H4", "H5", "H6", "H7"];
  const failedIds = ids.filter((id) => !results[id]?.pass);
  const lines = [
    `ROUND: ${round}`,
    `ARTIFACT_SHA256: ${artifactSha}`,
    `VERIFIER_SHA256: ${verifierSha}`,
    ...ids.map((id) => `${id} ${results[id]?.pass ? "PASS" : "FAIL"} — ${results[id]?.evidence || "not executed"}`),
    failedIds.length ? `HARD: FAIL (${failedIds.join(",")})` : "HARD: PASS",
  ];
  const output = `${lines.join("\n")}\n`;
  const hardPath = path.join(outDir, `hard-r${round}.txt`);
  fs.writeFileSync(hardPath, output, "utf8");
  process.stdout.write(output);
}

main().catch((error) => {
  const message = error && error.stack ? error.stack : String(error);
  process.stderr.write(`verifier crashed: ${message}\n`);
  process.exit(2);
});
