#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);

function fromScriptDir(value) {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(scriptDir, value);
}

const rawRound = process.argv[2] ?? process.env.KEKKAI_ROUND ?? "1";
const round = String(rawRound).trim().replace(/^r/i, "");
if (!/^\d+$/.test(round)) {
  throw new Error(`Invalid round: ${rawRound}`);
}

const artifactPath = fromScriptDir(process.env.KEKKAI_ARTIFACT ?? "../../../index.html");
const outDir = fromScriptDir(process.env.KEKKAI_OUT_DIR ?? "local-runs");
const artifactUrl = pathToFileURL(artifactPath).href;
const hardPath = path.join(outDir, `hard-r${round}.txt`);

const SEL = Object.freeze({
  app: "main.app",
  input: 'input[data-testid="calc-input"]',
  expression: '[data-testid="expression"]',
  result: '[data-testid="result"]',
  keypad: '[data-testid="keypad"]',
  opPicker: '[data-testid="op-picker"]',
  equals: 'button[data-testid="key-equals"]',
  historyItem: '[data-testid="history-item"]',
  historyResult: '[data-testid="history-result"]',
  historyEdit: 'button[data-testid="history-edit"]',
  operandInput: 'input[data-testid="operand-input"]',
});

const DIGITS = [..."0123456789"];
const H_IDS = Array.from({ length: 12 }, (_, index) => `H${index + 1}`);

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function oneLine(value, limit = 6000) {
  const rendered = String(value ?? "").replace(/\s+/g, " ").trim();
  return rendered.length > limit ? `${rendered.slice(0, limit)}...` : rendered;
}

function json(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function requireCondition(condition, detail) {
  if (!condition) throw new Error(detail);
}

function requireEqual(actual, expected, label) {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(`${label}: expected=${json(expected)} actual=${json(actual)}`);
  }
}

function requireNear(actual, expected, label, tolerance = 1e-9) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected=${expected}±${tolerance} actual=${json(actual)}`);
  }
}

function parseNumber(value, label) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label}: not numeric: ${json(value)}`);
  }
  return parsed;
}

function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, "playwright", "playwright-core"].filter(Boolean);
  const requires = [
    createRequire(path.resolve(scriptDir, "../../../tests/package.json")),
    createRequire(import.meta.url),
  ];
  const errors = [];
  for (const req of requires) {
    for (const name of candidates) {
      try {
        const loaded = req(name);
        const playwright = loaded?.chromium ? loaded : loaded?.default;
        if (playwright?.chromium) return playwright;
      } catch (error) {
        errors.push(`${name}: ${error?.message ?? error}`);
      }
    }
  }
  throw new Error(`Playwright unavailable; install tests dependencies first. ${errors.join(" | ")}`);
}

function collectExternalRefs(html) {
  const patterns = [
    /<script\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    /<link\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^\s;)]+))/gi,
    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,
  ];
  const refs = [];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const value = String(match[1] ?? match[2] ?? match[3] ?? "").trim();
      if (/^(?:https?:)?\/\//i.test(value)) refs.push(value);
    }
  }
  return refs;
}

const globalPageErrors = [];
const globalConsoleErrors = [];
let pagesOpened = 0;
let browser;

function trackPage(page, localErrors) {
  pagesOpened += 1;
  page.on("pageerror", (error) => {
    const message = oneLine(error?.stack ?? error?.message ?? error);
    localErrors.pageErrors.push(message);
    globalPageErrors.push(message);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const rendered = oneLine(message.text());
    localErrors.consoleErrors.push(rendered);
    globalConsoleErrors.push(rendered);
  });
}

async function openRaw(options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 390, height: 844 },
    isMobile: options.isMobile === true,
    hasTouch: options.hasTouch === true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  const errors = { pageErrors: [], consoleErrors: [] };
  trackPage(page, errors);
  try {
    await page.goto(artifactUrl, { waitUntil: "load" });
  } catch (error) {
    await context.close();
    throw error;
  }
  return {
    context,
    page,
    errors,
    async close() {
      await context.close();
    },
  };
}

async function openFresh(options = {}) {
  const opened = await openRaw(options);
  try {
    const keypad = opened.page.locator(SEL.keypad);
    if ((await keypad.count()) === 0) throw new Error("keypad selector was not found");
    await keypad.waitFor({ state: "visible" });
    return opened;
  } catch (error) {
    await opened.close();
    throw error;
  }
}

async function clickKey(page, key) {
  await page.locator(`button[data-key="${key}"]`).click();
}

async function clickOperator(page, operator) {
  await page.locator(`button[data-op="${operator}"]`).click();
}

async function clickEquals(page) {
  await page.locator(SEL.equals).click();
}

async function typeDigits(page, digits) {
  for (const digit of String(digits)) await clickKey(page, digit);
}

async function commitDigits(page, digits) {
  await typeDigits(page, digits);
  await clickKey(page, "enter");
}

async function computeScreen(page, operator, operands) {
  await clickOperator(page, operator);
  for (const operand of operands) await commitDigits(page, operand);
  await clickEquals(page);
}

async function inputValue(page) {
  return page.locator(SEL.input).inputValue();
}

async function expressionText(page) {
  return (await page.locator(SEL.expression).textContent()) ?? "";
}

async function resultAttribute(page, name = "data-value") {
  return page.locator(SEL.result).getAttribute(name);
}

async function appAttribute(page, name) {
  return page.locator(SEL.app).getAttribute(name);
}

async function historyCount(page) {
  return page.locator(SEL.historyItem).count();
}

async function historySnapshots(page) {
  return page.locator(SEL.historyItem).evaluateAll((items) =>
    items.map((item) => {
      const rawOperands = item.getAttribute("data-operands");
      const operands = JSON.parse(rawOperands);
      const result = item.querySelector('[data-testid="history-result"]');
      if (!Array.isArray(operands)) throw new Error(`history operands are not an array: ${rawOperands}`);
      return {
        operator: item.getAttribute("data-operator"),
        operands,
        result: result?.getAttribute("data-value") ?? null,
      };
    }),
  );
}

async function digitEnabledStates(page) {
  const states = [];
  for (const digit of DIGITS) {
    states.push({ digit, enabled: await page.locator(`button[data-key="${digit}"]`).isEnabled() });
  }
  return states;
}

async function measureLayout(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        element.getClientRects().length > 0
      );
    };
    const controls = [...document.querySelectorAll("input,button")].filter(visible).map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        testid: element.getAttribute("data-testid"),
        key: element.getAttribute("data-key"),
        op: element.getAttribute("data-op"),
        width: rect.width,
        height: rect.height,
        fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
      };
    });
    const keypad = document.querySelector('[data-testid="keypad"]');
    const digits = [...document.querySelectorAll('button[data-key]')].filter((element) =>
      /^[0-9]$/.test(element.getAttribute("data-key") || ""),
    );
    return {
      state: document.querySelector("main.app")?.getAttribute("data-state") ?? null,
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      controls,
      keypadVisible: Boolean(keypad && visible(keypad)),
      digitsVisible: digits.filter(visible).length,
    };
  });
}

function evaluateLayoutMetrics(metrics, label) {
  const tooSmall = metrics.controls.filter(
    (control) => control.width < 43.5 - 1e-9 || control.height < 43.5 - 1e-9,
  );
  const tooSmallFont = metrics.controls.filter((control) => control.fontSize < 16 - 1e-9);
  const minWidth = metrics.controls.length ? Math.min(...metrics.controls.map((item) => item.width)) : NaN;
  const minHeight = metrics.controls.length ? Math.min(...metrics.controls.map((item) => item.height)) : NaN;
  const minFont = metrics.controls.length ? Math.min(...metrics.controls.map((item) => item.fontSize)) : NaN;
  const issues = [];
  if (metrics.docOverflow > 1) issues.push(`documentOverflow=${metrics.docOverflow}`);
  if (metrics.bodyOverflow > 1) issues.push(`bodyOverflow=${metrics.bodyOverflow}`);
  if (!metrics.keypadVisible) issues.push("keypad=hidden");
  if (metrics.digitsVisible !== 10) issues.push(`digitsVisible=${metrics.digitsVisible}/10`);
  if (tooSmall.length) {
    issues.push(
      `smallControls=${tooSmall
        .map((item) => `${item.testid || item.key || item.op}:${item.width.toFixed(1)}x${item.height.toFixed(1)}`)
        .join(",")}`,
    );
  }
  if (tooSmallFont.length) {
    issues.push(
      `smallFonts=${tooSmallFont
        .map((item) => `${item.testid || item.key || item.op}:${item.fontSize.toFixed(1)}`)
        .join(",")}`,
    );
  }
  return {
    issues,
    detail:
      `${label}:docOverflow=${metrics.docOverflow},bodyOverflow=${metrics.bodyOverflow},` +
      `controls=${metrics.controls.length},minW=${minWidth.toFixed(1)},minH=${minHeight.toFixed(1)},` +
      `minFont=${minFont.toFixed(1)},keypad=${metrics.keypadVisible},digits=${metrics.digitsVisible}/10,state=${json(metrics.state)}`,
  };
}

async function testH1() {
  const bytes = fs.readFileSync(artifactPath);
  const html = bytes.toString("utf8");
  const refs = collectExternalRefs(html);
  const closed = /<\/html\s*>/i.test(html);
  const app = await openRaw({ viewport: { width: 390, height: 844 }, isMobile: false, hasTouch: false });
  let pageErrors;
  let loadedUrl;
  try {
    pageErrors = [...app.errors.pageErrors];
    loadedUrl = app.page.url();
  } finally {
    await app.close();
  }
  requireCondition(closed, "H1: </html> is missing");
  requireCondition(bytes.length >= 1024, `H1: byte length ${bytes.length} < 1024`);
  requireCondition(html.length >= 1024, `H1: text length ${html.length} < 1024`);
  requireCondition(refs.length === 0, `H1: external refs=${json(refs)}`);
  requireCondition(loadedUrl.startsWith("file:"), `H1: not loaded through file://: ${loadedUrl}`);
  requireCondition(pageErrors.length === 0, `H1: pageerror=${json(pageErrors)}`);
  return `htmlClose=true bytes=${bytes.length} textLength=${html.length} externalRefs=0 fileLoad=ok pageErrors=0`;
}

async function testH2() {
  const app = await openFresh({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const { page } = app;
    const states = await digitEnabledStates(page);
    const disabled = states.filter((item) => !item.enabled).map((item) => item.digit);
    requireCondition(disabled.length === 0, `H2: disabled digit keys=${json(disabled)}`);
    await page.locator('button[data-key="1"]').click();
    await page.locator('button[data-key="2"]').click();
    const value = await inputValue(page);
    requireEqual(value, "12", "H2: calc-input value");
    await page.locator('button[data-key="enter"]').click();
    const expression = await expressionText(page);
    requireCondition(expression.includes("12"), `H2: expression=${json(expression)}`);
    const pageErrors = [...app.errors.pageErrors];
    requireCondition(pageErrors.length === 0, `H2: pageerror=${json(pageErrors)}`);
    return `viewport=390x844 mobile=true touch=true digitKeys=10/10 input=${json(value)} expression=${json(expression)} pageErrors=0`;
  } finally {
    await app.close();
  }
}

async function testH3() {
  const app = await openFresh();
  try {
    const { page } = app;
    await clickOperator(page, "+");
    await commitDigits(page, "12");
    await commitDigits(page, "30");
    await clickEquals(page);
    const rawResult = await resultAttribute(page);
    const result = parseNumber(rawResult, "H3 result data-value");
    requireNear(result, 42, "H3 result");
    const top = (await historySnapshots(page))[0];
    requireCondition(Boolean(top), "H3: history top record is missing");
    requireEqual(top.operator, "+", "H3: top data-operator");
    requireEqual(top.operands, ["12", "30"], "H3: top data-operands");
    const historyResult = parseNumber(top.result, "H3 history-result data-value");
    requireNear(historyResult, 42, "H3 history-result");
    return `result=${json(rawResult)} operator=${json(top.operator)} operands=${json(top.operands)} historyResult=${json(top.result)}`;
  } finally {
    await app.close();
  }
}

async function testH4() {
  const app = await openFresh();
  try {
    const { page } = app;
    await page.locator('button[data-key="1"]').click();
    await page.locator('button[data-key="2"]').click();
    await clickOperator(page, "+");
    const preserved = await inputValue(page);
    requireEqual(preserved, "12", "H4: input after operator selection");
    await clickKey(page, "enter");
    await commitDigits(page, "30");
    await clickEquals(page);
    const rawResult = await resultAttribute(page);
    requireNear(parseNumber(rawResult, "H4 result data-value"), 42, "H4 result");
    const top = (await historySnapshots(page))[0];
    requireCondition(Boolean(top), "H4: history top record is missing");
    requireEqual(top.operands, ["12", "30"], "H4: top operands");
    return `afterPlusInput=${json(preserved)} result=${json(rawResult)} operands=${json(top.operands)}`;
  } finally {
    await app.close();
  }
}

async function testH5() {
  const app = await openFresh({ isMobile: false, hasTouch: false });
  try {
    const { page } = app;
    await page.locator(SEL.input).click();
    const focused = await page.locator(SEL.input).evaluate((element) => document.activeElement === element);
    requireCondition(focused, "H5: calc-input was not focused by click");
    await page.keyboard.type("12");
    const typed = await inputValue(page);
    requireEqual(typed, "12", "H5: typed input");
    await page.keyboard.press("Enter");
    await clickOperator(page, "+");
    await page.keyboard.type("30");
    await page.keyboard.press("Enter");
    await page.keyboard.press("=");
    const rawResult = await resultAttribute(page);
    requireNear(parseNumber(rawResult, "H5 result data-value"), 42, "H5 result");
    const operator = await appAttribute(page, "data-operator");
    requireEqual(operator, "+", "H5: app operator");
    const top = (await historySnapshots(page))[0];
    requireCondition(Boolean(top), "H5: history top record is missing");
    requireEqual(top.operands, ["12", "30"], "H5: top operands");
    return `typedInput=${json(typed)} result=${json(rawResult)} operator=${json(operator)} operands=${json(top.operands)}`;
  } finally {
    await app.close();
  }
}

async function testH6() {
  const app = await openFresh();
  try {
    const { page } = app;
    await computeScreen(page, "+", ["12", "30", "8"]);
    const firstRaw = await resultAttribute(page);
    const firstResultOk = Number.isFinite(Number.parseFloat(firstRaw)) &&
      Math.abs(Number.parseFloat(firstRaw) - 50) <= 1e-9;
    const prior = await historySnapshots(page);

    await commitDigits(page, "5");
    await commitDigits(page, "6");
    await clickEquals(page);

    const rawResult = await resultAttribute(page);
    const result = Number.parseFloat(rawResult);
    const resultOk = Number.isFinite(result) && Math.abs(result - 11) <= 1e-9;
    const operator = await appAttribute(page, "data-operator");
    const operatorOk = operator === "+";
    const after = await historySnapshots(page);
    const countOk = after.length === 3;
    const priorUnchanged = isDeepStrictEqual(after.slice(1), prior);
    const pass = firstResultOk && resultOk && operatorOk && countOk && priorUnchanged;
    const evidence =
      `firstResult=${json(firstRaw)},result=${json(rawResult)},operator=${json(operator)},` +
      `history=${after.length},expectedHistory=3,priorRecords=${prior.length},priorUnchanged=${priorUnchanged}`;
    requireCondition(
      pass,
      `H6 measured ${evidence}`,
    );
    return evidence;
  } finally {
    await app.close();
  }
}

async function testH7() {
  const app = await openFresh();
  try {
    const { page } = app;
    await computeScreen(page, "+", ["12", "30", "8"]);
    await computeScreen(page, "*", ["2", "3", "4"]);
    const before = await historySnapshots(page);
    requireCondition(before.length === 2, `H7: setup history=${before.length}, expected 2`);

    const plusEdit = page
      .locator(`${SEL.historyItem}[data-operator="+"]`)
      .first()
      .locator(SEL.historyEdit);
    await plusEdit.click();
    const inputs = page.locator(SEL.operandInput);
    requireCondition((await inputs.count()) === 3, "H7: edit state does not have three operand inputs");
    await inputs.nth(1).fill("5");
    await clickEquals(page);

    const after = await historySnapshots(page);
    const top = after[0];
    requireCondition(Boolean(top), "H7: new history top is missing");
    requireEqual(top.operator, "+", "H7: new top operator");
    requireEqual(top.operands, ["12", "5", "8"], "H7: new top operands");
    requireNear(parseNumber(top.result, "H7: new top result"), 25, "H7: new top result");
    requireEqual(after.slice(1), before, "H7: prior two records");

    await page.reload({ waitUntil: "load" });
    const reloadHistory = await historyCount(page);
    requireCondition(reloadHistory === 0, `H7: history after reload=${reloadHistory}, expected 0`);
    return `editedOperator=${json(top.operator)} editedOperands=${json(top.operands)} editedResult=${json(top.result)} originalsUnchanged=true reloadHistory=0`;
  } finally {
    await app.close();
  }
}

async function testH8() {
  const app = await openFresh();
  try {
    const { page } = app;
    await clickOperator(page, "/");
    await commitDigits(page, "5");
    await commitDigits(page, "0");
    await clickEquals(page);
    const errorFlag = await resultAttribute(page, "data-error");
    const valueAtError = await resultAttribute(page);
    const historyAtError = await historyCount(page);
    requireEqual(errorFlag, "true", "H8: result data-error");
    requireCondition(valueAtError === null, `H8: result data-value at error=${json(valueAtError)}`);
    requireCondition(historyAtError === 0, `H8: history after division by zero=${historyAtError}, expected 0`);

    const states = await digitEnabledStates(page);
    const disabled = states.filter((item) => !item.enabled).map((item) => item.digit);
    requireCondition(disabled.length === 0, `H8: disabled digit keys after error=${json(disabled)}`);

    await clickOperator(page, "+");
    await commitDigits(page, "1");
    await commitDigits(page, "2");
    await clickEquals(page);
    const rawResult = await resultAttribute(page);
    requireNear(parseNumber(rawResult, "H8 recovery result"), 3, "H8 recovery result");
    const errorAfterRecovery = await resultAttribute(page, "data-error");
    requireCondition(errorAfterRecovery === null, `H8: data-error after recovery=${json(errorAfterRecovery)}`);
    const historyAfterRecovery = await historyCount(page);
    requireCondition(
      historyAfterRecovery === historyAtError + 1,
      `H8: history after recovery=${historyAfterRecovery}, expected ${historyAtError + 1}`,
    );
    return `divisionByZeroError=true historyUnchanged=${historyAtError} digitsEnabled=10/10 recoveryResult=${json(rawResult)} recoveryDataError=null history+1=${historyAfterRecovery}`;
  } finally {
    await app.close();
  }
}

async function runH9Case(kind) {
  const app = await openFresh();
  try {
    const { page } = app;
    if (kind === "after12") {
      await page.locator('button[data-key="1"]').click();
      await page.locator('button[data-key="2"]').click();
    }
    await clickEquals(page);
    const history = await historyCount(page);
    const value = await resultAttribute(page);
    const pageErrors = [...app.errors.pageErrors];
    requireCondition(history === 0, `H9 ${kind}: history=${history}, expected 0`);
    requireCondition(value === null, `H9 ${kind}: result data-value=${json(value)}, expected null`);
    requireCondition(pageErrors.length === 0, `H9 ${kind}: pageerror=${json(pageErrors)}`);
    return { history, value, pageErrors: pageErrors.length };
  } finally {
    await app.close();
  }
}

async function testH9() {
  const direct = await runH9Case("direct");
  const after12 = await runH9Case("after12");
  return (
    `direct:history=${direct.history},result=null,pageErrors=${direct.pageErrors};` +
    `after12:history=${after12.history},result=null,pageErrors=${after12.pageErrors}`
  );
}

async function prepareResultState(page) {
  await clickKey(page, "1");
  await clickKey(page, "2");
  const uncommitted = await inputValue(page);
  requireEqual(uncommitted, "12", "H10: uncommitted input");
  const inputMetrics = await measureLayout(page);

  await clickOperator(page, "+");
  await clickKey(page, "enter");
  await commitDigits(page, "30");
  await commitDigits(page, "8");
  await clickEquals(page);
  await computeScreen(page, "*", ["2", "3", "4"]);
  const history = await historyCount(page);
  const state = await appAttribute(page, "data-state");
  requireCondition(history === 2, `H10: result state history=${history}, expected 2`);
  requireEqual(state, "result", "H10: result state");
  return { uncommitted, inputMetrics };
}

async function testH10() {
  const viewports = [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
  ];
  const details = [];
  const issues = [];
  for (const viewport of viewports) {
    const tag = `${viewport.width}x${viewport.height}`;
    const app = await openFresh({ viewport, isMobile: true, hasTouch: true });
    try {
      const { page } = app;
      const cold = evaluateLayoutMetrics(await measureLayout(page), `${tag}.cold`);
      details.push(cold.detail);
      issues.push(...cold.issues);

      const prepared = await prepareResultState(page);
      const duringInput = evaluateLayoutMetrics(prepared.inputMetrics, `${tag}.input`);
      details.push(`${duringInput.detail},input=${json(prepared.uncommitted)}`);
      issues.push(...duringInput.issues);

      const resultMetrics = evaluateLayoutMetrics(await measureLayout(page), `${tag}.result`);
      details.push(`${resultMetrics.detail},history=2`);
      issues.push(...resultMetrics.issues);

      await page
        .locator(`${SEL.historyItem}[data-operator="+"]`)
        .first()
        .locator(SEL.historyEdit)
        .click();
      const operandCount = await page.locator(SEL.operandInput).count();
      requireCondition(operandCount === 3, `H10 ${tag}: edit operand-input count=${operandCount}, expected 3`);
      const editMetrics = evaluateLayoutMetrics(await measureLayout(page), `${tag}.edit`);
      details.push(`${editMetrics.detail},operands=${operandCount}`);
      issues.push(...editMetrics.issues);
    } finally {
      await app.close();
    }
  }
  requireCondition(issues.length === 0, `H10: ${issues.join(" | ")}; measured=${details.join("; ")}`);
  return details.join("; ");
}

function serializedHistory(snapshots) {
  return snapshots.map((record) => ({
    operator: record.operator,
    operands: record.operands,
    result: parseNumber(record.result, "H12 history result"),
  }));
}

async function runH12Sequence() {
  const app = await openFresh({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const { page } = app;
    await computeScreen(page, "+", ["12", "30", "8"]);
    await commitDigits(page, "5");
    await commitDigits(page, "6");
    await clickEquals(page);
    await clickOperator(page, "*");
    await commitDigits(page, "5");
    await commitDigits(page, "6");
    await clickEquals(page);
    const records = serializedHistory(await historySnapshots(page));
    requireCondition(records.length === 3, `H12: records=${records.length}, expected 3`);
    return records;
  } finally {
    await app.close();
  }
}

async function testH12() {
  const first = await runH12Sequence();
  const second = await runH12Sequence();
  const firstJson = JSON.stringify(first);
  const secondJson = JSON.stringify(second);
  requireEqual(firstJson, secondJson, "H12: serialized history");
  return `contexts=2 records=${first.length}/${second.length} serializedEqual=true history=${firstJson}`;
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function main() {
  const playwright = loadPlaywright();
  const artifactSha256 = sha256File(artifactPath);
  const verifierSha256 = sha256File(scriptPath);
  fs.mkdirSync(outDir, { recursive: true });

  try {
    browser = await playwright.chromium.launch({ headless: true, args: ["--no-sandbox"] });
  } catch (error) {
    console.error(`ENVIRONMENT: unable to launch headless Chromium: ${error?.stack ?? error}`);
    process.exit(2);
  }

  const tests = {
    H1: testH1,
    H2: testH2,
    H3: testH3,
    H4: testH4,
    H5: testH5,
    H6: testH6,
    H7: testH7,
    H8: testH8,
    H9: testH9,
    H10: testH10,
    H12: testH12,
  };
  const results = {};

  try {
    for (const id of ["H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H9", "H10", "H12"]) {
      try {
        const evidence = await withTimeout(tests[id](), 120000, id);
        results[id] = { pass: true, evidence: oneLine(evidence) };
      } catch (error) {
        results[id] = { pass: false, evidence: oneLine(error?.message ?? error) };
      }
    }
    const h11Pass = globalPageErrors.length === 0 && globalConsoleErrors.length === 0;
    results.H11 = {
      pass: h11Pass,
      evidence: oneLine(
        `pages=${pagesOpened} pageErrors=${globalPageErrors.length} consoleErrors=${globalConsoleErrors.length}` +
          (globalPageErrors.length ? ` pageErrorDetails=${json(globalPageErrors)}` : "") +
          (globalConsoleErrors.length ? ` consoleErrorDetails=${json(globalConsoleErrors)}` : ""),
      ),
    };
  } finally {
    try {
      await browser.close();
    } catch {
    }
  }

  const failed = H_IDS.filter((id) => !results[id]?.pass);
  const lines = [
    `ROUND: ${round}`,
    `ARTIFACT_SHA256: ${artifactSha256}`,
    `VERIFIER_SHA256: ${verifierSha256}`,
    ...H_IDS.map((id) => `${id} ${results[id]?.pass ? "PASS" : "FAIL"} — ${results[id]?.evidence ?? "not executed"}`),
    `HARD: ${failed.length === 0 ? "PASS" : `FAIL (${failed.join(",")})`}`,
  ];
  const text = `${lines.join("\n")}\n`;
  fs.writeFileSync(hardPath, text);
  process.stdout.write(text);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

await main();
