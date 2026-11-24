#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const rawRound = process.argv[2] ?? process.env.KEKKAI_ROUND ?? "1";
const round = String(rawRound).trim().replace(/^r/i, "");
if (!/^\d+$/.test(round)) {
  throw new Error(`Invalid round: ${rawRound}`);
}

function fromScriptDir(value) {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(scriptDir, value);
}

const artifactPath = fromScriptDir(
  Object.prototype.hasOwnProperty.call(process.env, "KEKKAI_ARTIFACT")
    ? process.env.KEKKAI_ARTIFACT
    : path.resolve(scriptDir, "../../../index.html"),
);
const outDir = fromScriptDir(
  Object.prototype.hasOwnProperty.call(process.env, "KEKKAI_OUT_DIR")
    ? process.env.KEKKAI_OUT_DIR
    : path.join(scriptDir, "attempts", `manual-r${round}`),
);
const repoRoot = fromScriptDir(process.env.KEKKAI_REPO ?? path.resolve(scriptDir, "../../.."));
const artifactUrl = pathToFileURL(artifactPath).href;
const outputPath = path.join(outDir, `hard-r${round}.txt`);

fs.mkdirSync(outDir, { recursive: true });

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

if (!fs.existsSync(artifactPath)) {
  throw new Error(`Artifact does not exist: ${artifactPath}`);
}

const artifactBytes = fs.readFileSync(artifactPath);
const artifactText = artifactBytes.toString("utf8");
const artifactSha256 = crypto.createHash("sha256").update(artifactBytes).digest("hex");
const verifierSha256 = sha256(scriptPath);

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    "playwright",
    "playwright-core",
  ].filter(Boolean);
  const resolvers = [
    createRequire(path.join(repoRoot, "tests", "package.json")),
    createRequire(import.meta.url),
  ];
  const errors = [];
  for (const candidate of candidates) {
    for (const resolver of resolvers) {
      try {
        const loaded = resolver(candidate);
        if (loaded?.chromium) return loaded;
        if (loaded?.default?.chromium) return loaded.default;
      } catch (error) {
        errors.push(`${candidate}: ${error.message}`);
      }
    }
  }
  throw new Error(
    `REFUSED: Playwright is unavailable; cannot perform browser measurements.\n${errors.join("\n")}`,
  );
}

const { chromium } = loadPlaywright();

const S = Object.freeze({
  app: "main.app",
  keypad: '[data-testid="keypad"]',
  picker: '[data-testid="op-picker"]',
  input: '[data-testid="calc-input"]',
  expression: '[data-testid="expression"]',
  result: '[data-testid="result"]',
  equals: '[data-testid="key-equals"]',
  history: '[data-testid="history"]',
  historyItem: '[data-testid="history-item"]',
  historyResult: '[data-testid="history-result"]',
  historyEdit: '[data-testid="history-edit"]',
  operandInput: '[data-testid="operand-input"]',
});

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
const DEFAULT_OPTIONS = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 1,
};
const STEP_TIMEOUT_MS = 30000;
const allPageErrors = [];
const allConsoleErrors = [];
let openedPageCount = 0;

function renderValue(value, limit = 1800) {
  let rendered;
  try {
    rendered = JSON.stringify(value);
  } catch {
    rendered = String(value);
  }
  rendered = String(rendered ?? "");
  return rendered.length > limit ? `${rendered.slice(0, limit)}...` : rendered;
}

function assert(condition, message, actual) {
  if (!condition) {
    throw new Error(actual === undefined ? message : `${message}; actual=${renderValue(actual)}`);
  }
}

function assertEqual(actual, expected, message) {
  assert(
    isDeepStrictEqual(actual, expected),
    message,
    `expected=${renderValue(expected)} actual=${renderValue(actual)}`,
  );
}

function numericValue(raw, message) {
  const parsed = raw === null || String(raw).trim() === "" ? Number.NaN : Number.parseFloat(raw);
  assert(Number.isFinite(parsed), message, raw);
  return parsed;
}

function near(actual, expected, message, tolerance = 1e-9) {
  assert(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    message,
    `expected=${expected} actual=${actual} tolerance=${tolerance}`,
  );
}

function watchPage(page, errors) {
  openedPageCount += 1;
  const pageNumber = openedPageCount;
  page.on("pageerror", (error) => {
    const message = String(error?.stack ?? error);
    errors.pageErrors.push(message);
    allPageErrors.push(`page#${pageNumber}: ${message}`);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const rendered = message.text();
    errors.consoleErrors.push(rendered);
    allConsoleErrors.push(`page#${pageNumber}: ${rendered}`);
  });
}

async function openPage(options = {}) {
  const context = await browser.newContext({ ...DEFAULT_OPTIONS, ...options });
  const page = await context.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(STEP_TIMEOUT_MS);
  const errors = { pageErrors: [], consoleErrors: [] };
  watchPage(page, errors);
  try {
    await page.goto(artifactUrl, { waitUntil: "load" });
  } catch (error) {
    await context.close();
    throw error;
  }
  return { context, page, errors };
}

async function withFreshPage(options, callback) {
  const opened = await openPage(options);
  try {
    return await callback(opened.page, opened.errors, opened.context);
  } finally {
    await opened.context.close();
  }
}

async function settle(page, milliseconds = 60) {
  await page.waitForTimeout(milliseconds);
}

async function clickKey(page, key) {
  const locator = page.locator(`button[data-key="${key}"]`);
  await locator.click();
}

async function clickOperator(page, operator) {
  await page.locator(`[data-op="${operator}"]`).click();
}

async function clickEquals(page) {
  await page.locator(S.equals).click();
}

async function enterOperand(page, value) {
  for (const character of String(value)) {
    await clickKey(page, character);
  }
  await clickKey(page, "enter");
}

async function screenCompute(page, operator, operands) {
  await clickOperator(page, operator);
  for (const operand of operands) {
    await enterOperand(page, operand);
  }
  await clickEquals(page);
}

async function screenContinue(page, operands) {
  for (const operand of operands) {
    await enterOperand(page, operand);
  }
  await clickEquals(page);
}

async function expressionText(page) {
  return ((await page.locator(S.expression).textContent()) ?? "").trim();
}

async function resultAttribute(page, name = "data-value") {
  return page.locator(S.result).getAttribute(name);
}

async function inputValue(page) {
  return page.locator(S.input).inputValue();
}

async function historyCount(page) {
  return page.locator(S.historyItem).count();
}

async function historySnapshots(page) {
  return page.locator(S.historyItem).evaluateAll((items) =>
    items.map((item) => {
      const result = item.querySelector('[data-testid="history-result"]');
      const expression = item.querySelector('[data-testid="history-expression"]');
      const rawOperands = item.getAttribute("data-operands");
      return {
        operator: item.getAttribute("data-operator"),
        operands: JSON.parse(rawOperands),
        result: result?.getAttribute("data-value") ?? null,
        resultText: (result?.textContent ?? "").trim(),
        expression: (expression?.textContent ?? "").trim(),
      };
    }),
  );
}

async function topHistory(page) {
  const items = await historySnapshots(page);
  assert(items.length > 0, "history has a top record", items.length);
  return items[0];
}

async function compactHistory(page) {
  const items = await page.locator(S.historyItem).evaluateAll((records) =>
    records.map((item) => {
      const result = item.querySelector('[data-testid="history-result"]');
      const rawResult = result?.getAttribute("data-value") ?? null;
      return {
        operator: item.getAttribute("data-operator"),
        operands: JSON.parse(item.getAttribute("data-operands")),
        result: rawResult === null ? null : Number.parseFloat(rawResult),
      };
    }),
  );
  return { items, serialized: JSON.stringify(items) };
}

function externalReferences(html) {
  const references = [];
  const tagPattern = /<(script|link|img)\b[^>]*>/gi;
  for (const match of html.matchAll(tagPattern)) {
    const tag = match[0];
    const tagName = match[1].toLowerCase();
    const attribute = tagName === "link" ? "href" : "src";
    const attributePattern = new RegExp(
      `\\s${attribute}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))`,
      "i",
    );
    const attributeMatch = tag.match(attributePattern);
    if (attributeMatch) {
      references.push(attributeMatch[1] ?? attributeMatch[2] ?? attributeMatch[3] ?? "");
    }
  }
  for (const match of html.matchAll(/@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^)'";\s]+))/gi)) {
    references.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  for (const match of html.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
    references.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return references
    .map((value) => value.trim())
    .filter((value) => /^(?:https?:)?\/\//i.test(value));
}

async function checkEnabledDigits(page) {
  const states = [];
  for (const digit of DIGITS) {
    const locator = page.locator(`button[data-key="${digit}"]`);
    assert((await locator.count()) === 1, `digit ${digit} exists exactly once`, await locator.count());
    const enabled = await locator.isEnabled();
    states.push(`${digit}:${enabled}`);
    assert(enabled, `digit ${digit} is enabled`, enabled);
  }
  return states.join(",");
}

async function measureLayout(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
      return element.getClientRects().length > 0;
    };
    const controls = Array.from(document.querySelectorAll("input,button"))
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          name:
            element.getAttribute("data-testid") ??
            (element.getAttribute("data-key") ? `key-${element.getAttribute("data-key")}` : null) ??
            (element.getAttribute("data-op") ? `op-${element.getAttribute("data-op")}` : null) ??
            element.tagName.toLowerCase(),
          width: rect.width,
          height: rect.height,
          fontSize: Number.parseFloat(style.fontSize),
        };
      });
    const keypad = document.querySelector('[data-testid="keypad"]');
    const digitKeys = Array.from(document.querySelectorAll('button[data-key]')).filter((element) =>
      /^[0-9]$/.test(element.getAttribute("data-key") ?? ""),
    );
    return {
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      controls,
      keypadVisible: Boolean(keypad && visible(keypad)),
      visibleDigitKeys: digitKeys.filter(visible).length,
    };
  });
}

function assertLayout(viewLabel, stateLabel, metrics) {
  assert(metrics.docOverflow <= 1, `${viewLabel}/${stateLabel}: document overflow <= 1`, metrics.docOverflow);
  assert(metrics.bodyOverflow <= 1, `${viewLabel}/${stateLabel}: body overflow <= 1`, metrics.bodyOverflow);
  assert(metrics.controls.length > 0, `${viewLabel}/${stateLabel}: visible controls exist`, metrics.controls.length);
  const tooSmall = metrics.controls.filter((control) => control.width < 43.5 || control.height < 43.5);
  assert(
    tooSmall.length === 0,
    `${viewLabel}/${stateLabel}: every visible input/button is at least 43.5x43.5`,
    tooSmall.map((control) => `${control.name}:${control.width.toFixed(2)}x${control.height.toFixed(2)}`),
  );
  const tooSmallFont = metrics.controls.filter((control) => control.fontSize < 16);
  assert(
    tooSmallFont.length === 0,
    `${viewLabel}/${stateLabel}: every visible input/button font is at least 16px`,
    tooSmallFont.map((control) => `${control.name}:${control.fontSize}`),
  );
  assert(metrics.keypadVisible, `${viewLabel}/${stateLabel}: numeric keypad is visible`, metrics.keypadVisible);
  assert(
    metrics.visibleDigitKeys === 10,
    `${viewLabel}/${stateLabel}: all ten digit keys are visible`,
    metrics.visibleDigitKeys,
  );

  const minWidth = Math.min(...metrics.controls.map((control) => control.width));
  const minHeight = Math.min(...metrics.controls.map((control) => control.height));
  const minFont = Math.min(...metrics.controls.map((control) => control.fontSize));
  return `${stateLabel}(doc=${metrics.docOverflow},body=${metrics.bodyOverflow},controls=${metrics.controls.length},min=${minWidth.toFixed(2)}x${minHeight.toFixed(2)},font=${minFont},keypad=${metrics.keypadVisible},digits=${metrics.visibleDigitKeys})`;
}

async function testH1() {
  const external = externalReferences(artifactText);
  assert(/<\/html\s*>/i.test(artifactText), "</html> exists");
  assert(artifactText.length >= 1024, "artifact text length >= 1024", artifactText.length);
  assert(external.length === 0, "external references in declared scan surfaces = 0", external);
  return withFreshPage({}, async (page, errors) => {
    await settle(page, 100);
    assert(errors.pageErrors.length === 0, "file:// load has zero pageerror", errors.pageErrors);
    return `bytes=${artifactBytes.length},chars=${artifactText.length},closingHtml=yes,externalRefs=${external.length},fileLoads=1,pageErrors=${errors.pageErrors.length}`;
  });
}

async function testH2() {
  return withFreshPage(
    { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    async (page, errors) => {
      const enabled = await checkEnabledDigits(page);
      await page.locator('button[data-key="1"]').click();
      await page.locator('button[data-key="2"]').click();
      const value = await inputValue(page);
      assertEqual(value, "12", "screen keys 1,2 produce input value 12");
      await page.locator('button[data-key="enter"]').click();
      const expression = await expressionText(page);
      assert(expression.includes("12"), "expression contains 12 after enter", expression);
      await settle(page);
      assert(errors.pageErrors.length === 0, "H2 pageerror = 0", errors.pageErrors);
      return `enabledDigits=${enabled},input=${renderValue(value)},expression=${renderValue(expression)},pageErrors=${errors.pageErrors.length}`;
    },
  );
}

async function testH3() {
  return withFreshPage({}, async (page) => {
    await clickOperator(page, "+");
    await enterOperand(page, "12");
    await enterOperand(page, "30");
    await clickEquals(page);
    const rawResult = await resultAttribute(page);
    const result = numericValue(rawResult, "result data-value is numeric");
    near(result, 42, "result equals 42");
    const top = await topHistory(page);
    assertEqual(top.operator, "+", "top history operator is +");
    assertEqual(top.operands, ["12", "30"], "top history operands are 12,30");
    const historyResult = numericValue(top.result, "top history result is numeric");
    near(historyResult, 42, "top history result equals 42");
    return `result=${rawResult},operator=${renderValue(top.operator)},operands=${renderValue(top.operands)},historyResult=${renderValue(top.result)}`;
  });
}

async function testH4() {
  return withFreshPage({}, async (page) => {
    await clickKey(page, "1");
    await clickKey(page, "2");
    await clickOperator(page, "+");
    const preserved = await inputValue(page);
    assertEqual(preserved, "12", "selecting + preserves uncommitted input 12");
    await clickKey(page, "enter");
    await enterOperand(page, "30");
    await clickEquals(page);
    const rawResult = await resultAttribute(page);
    near(numericValue(rawResult, "result data-value is numeric"), 42, "result equals 42");
    const top = await topHistory(page);
    assertEqual(top.operands, ["12", "30"], "top history operands are 12,30");
    return `preservedInput=${renderValue(preserved)},result=${rawResult},operands=${renderValue(top.operands)}`;
  });
}

async function testH5() {
  return withFreshPage({}, async (page) => {
    await page.locator(S.input).click();
    await page.keyboard.type("12");
    const typed = await inputValue(page);
    assertEqual(typed, "12", "keyboard.type 12 enters 12");
    await page.keyboard.press("Enter");
    await clickOperator(page, "+");
    await page.keyboard.type("30");
    await page.keyboard.press("Enter");
    await page.keyboard.press("=");
    const rawResult = await resultAttribute(page);
    near(numericValue(rawResult, "result data-value is numeric"), 42, "keyboard result equals 42");
    const top = await topHistory(page);
    assertEqual(top.operator, "+", "keyboard top history operator is +");
    assertEqual(top.operands, ["12", "30"], "keyboard top history operands are 12,30");
    return `typedInput=${renderValue(typed)},result=${rawResult},operator=${renderValue(top.operator)},operands=${renderValue(top.operands)}`;
  });
}

async function testH6() {
  return withFreshPage({}, async (page) => {
    await screenCompute(page, "+", ["12", "30", "8"]);
    const first = await historySnapshots(page);
    assertEqual(first.length, 1, "first calculation has one history record");
    assertEqual((await topHistory(page)).operands, ["12", "30", "8"], "first top operands are 12,30,8");

    await screenContinue(page, ["5", "6"]);
    const rawResult = await resultAttribute(page);
    near(numericValue(rawResult, "result data-value is numeric"), 11, "continued result equals 11");
    const operator = await page.locator(S.app).getAttribute("data-operator");
    assertEqual(operator, "+", "main.app data-operator stays +");
    const all = await historySnapshots(page);
    assertEqual(all.length, 2, "continued calculation yields two history records");
    assertEqual(all[1], first[0], "prior + history snapshot is unchanged field-by-field");
    assertEqual(all[0].operator, "+", "new top history operator is +");
    assertEqual(all[0].operands, ["5", "6"], "new top history operands are 5,6");
    near(numericValue(all[0].result, "new history result is numeric"), 11, "new history result equals 11");
    return `result=${rawResult},appOperator=${renderValue(operator)},history=${all.length},prior=${renderValue(first[0])},unchanged=yes`;
  });
}

async function testH7() {
  return withFreshPage({}, async (page) => {
    await screenCompute(page, "+", ["12", "30", "8"]);
    await screenCompute(page, "*", ["2", "3", "4"]);
    const original = await historySnapshots(page);
    assertEqual(original.length, 2, "setup history has two records");
    assertEqual(original[0].operator, "*", "newest setup record is *");
    assertEqual(original[1].operator, "+", "earlier setup record is +");

    const plusEdit = page.locator(`${S.historyItem}[data-operator="+"] ${S.historyEdit}`);
    assertEqual(await plusEdit.count(), 1, "exactly one earlier + edit control");
    await plusEdit.click();
    const inputs = page.locator(S.operandInput);
    assertEqual(await inputs.count(), 3, "edit state exposes three operand inputs");
    await inputs.nth(1).fill("5");
    await clickEquals(page);

    const updated = await historySnapshots(page);
    assertEqual(updated.length, 3, "edited calculation adds one history record");
    assertEqual(updated[0].operator, "+", "new top history operator is +");
    assertEqual(updated[0].operands, ["12", "5", "8"], "new top history operands are 12,5,8");
    near(numericValue(updated[0].result, "edited history result is numeric"), 25, "edited history result equals 25");
    assertEqual(updated.slice(1), original, "the original two history snapshots remain unchanged");

    await page.reload({ waitUntil: "load" });
    await settle(page);
    const reloadCount = await historyCount(page);
    assertEqual(reloadCount, 0, "reload clears history");
    return `newTop=${renderValue(updated[0])},originalsUnchanged=yes,reloadHistory=${reloadCount}`;
  });
}

async function testH8() {
  return withFreshPage({}, async (page) => {
    await clickOperator(page, "/");
    await enterOperand(page, "5");
    await enterOperand(page, "0");
    await clickEquals(page);
    const errorFlag = await resultAttribute(page, "data-error");
    const errorHistory = await historyCount(page);
    const enabled = await checkEnabledDigits(page);
    assertEqual(errorFlag, "true", "division by zero sets result data-error=true");
    assertEqual(errorHistory, 0, "division by zero does not change history count");

    await clickOperator(page, "+");
    await enterOperand(page, "1");
    await enterOperand(page, "2");
    await clickEquals(page);
    const rawResult = await resultAttribute(page);
    const recoveredError = await resultAttribute(page, "data-error");
    const recoveredHistory = await historyCount(page);
    near(numericValue(rawResult, "recovered result is numeric"), 3, "recovered result equals 3");
    assertEqual(recoveredError, null, "recovered result has no data-error");
    assertEqual(recoveredHistory, errorHistory + 1, "recovery adds exactly one history record");
    return `error=${renderValue(errorFlag)},errorHistory=${errorHistory},enabledDigits=${enabled},recoveredResult=${rawResult},recoveredError=${renderValue(recoveredError)},recoveredHistory=${recoveredHistory}`;
  });
}

async function testH9() {
  const cases = [];
  await withFreshPage({}, async (page, errors) => {
    await clickEquals(page);
    await settle(page);
    const count = await historyCount(page);
    const result = await resultAttribute(page);
    assertEqual(count, 0, "cold equals does not add history");
    assertEqual(result, null, "cold equals leaves result data-value null");
    assertEqual(errors.pageErrors.length, 0, "cold equals pageerror = 0");
    cases.push(`cold:history=${count},result=${renderValue(result)},pageErrors=${errors.pageErrors.length}`);
  });
  await withFreshPage({}, async (page, errors) => {
    await clickKey(page, "1");
    await clickKey(page, "2");
    await clickEquals(page);
    await settle(page);
    const count = await historyCount(page);
    const result = await resultAttribute(page);
    assertEqual(count, 0, "uncommitted 12 then equals does not add history");
    assertEqual(result, null, "uncommitted 12 then equals leaves result data-value null");
    assertEqual(errors.pageErrors.length, 0, "uncommitted 12 then equals pageerror = 0");
    cases.push(`input12:history=${count},result=${renderValue(result)},pageErrors=${errors.pageErrors.length}`);
  });
  return cases.join("; ");
}

async function testH10() {
  const summaries = [];
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
  ]) {
    const viewLabel = `${viewport.width}x${viewport.height}`;
    await withFreshPage(
      { viewport, isMobile: true, hasTouch: true },
      async (page) => {
        const states = [];
        states.push(assertLayout(viewLabel, "cold", await measureLayout(page)));

        await clickKey(page, "1");
        await clickKey(page, "2");
        await settle(page);
        assertEqual(await inputValue(page), "12", `${viewLabel}: uncommitted input is 12`);
        states.push(assertLayout(viewLabel, "input12", await measureLayout(page)));

        await clickOperator(page, "+");
        await clickKey(page, "enter");
        await enterOperand(page, "30");
        await enterOperand(page, "8");
        await clickEquals(page);
        await screenCompute(page, "*", ["2", "3", "4"]);
        assertEqual(await historyCount(page), 2, `${viewLabel}: result state has two history records`);
        states.push(assertLayout(viewLabel, "result2", await measureLayout(page)));

        const plusEdit = page.locator(`${S.historyItem}[data-operator="+"] ${S.historyEdit}`);
        assertEqual(await plusEdit.count(), 1, `${viewLabel}: one earlier + edit control`);
        await plusEdit.click();
        assertEqual(await page.locator(S.operandInput).count(), 3, `${viewLabel}: edit state has three operand inputs`);
        await settle(page);
        states.push(assertLayout(viewLabel, "edit3", await measureLayout(page)));
        summaries.push(`${viewLabel}{${states.join(",")}}`);
      },
    );
  }
  return summaries.join("; ");
}

async function testH11() {
  assertEqual(allPageErrors.length, 0, "all pages produced zero pageerror");
  assertEqual(allConsoleErrors.length, 0, "all pages produced zero console error");
  return `pages=${openedPageCount},pageErrors=${allPageErrors.length},consoleErrors=${allConsoleErrors.length}`;
}

async function runH12Sequence(label) {
  return withFreshPage({}, async (page) => {
    await screenCompute(page, "+", ["12", "30", "8"]);
    const firstResult = await resultAttribute(page);
    near(numericValue(firstResult, `${label}: first result is numeric`), 50, `${label}: first result equals 50`);
    await screenContinue(page, ["5", "6"]);
    const secondResult = await resultAttribute(page);
    near(numericValue(secondResult, `${label}: second result is numeric`), 11, `${label}: second result equals 11`);
    await clickOperator(page, "*");
    await enterOperand(page, "5");
    await enterOperand(page, "6");
    await clickEquals(page);
    const thirdResult = await resultAttribute(page);
    near(numericValue(thirdResult, `${label}: third result is numeric`), 30, `${label}: third result equals 30`);
    return compactHistory(page);
  });
}

async function testH12() {
  const first = await runH12Sequence("run1");
  const second = await runH12Sequence("run2");
  assertEqual(first.items.length, 3, "run1 history records = 3");
  assertEqual(second.items.length, 3, "run2 history records = 3");
  assertEqual(first.serialized, second.serialized, "JSON.stringify history snapshots are deeply equal");
  return `records=${first.items.length},historiesDeepEqual=yes,serialized=${renderValue(first.serialized)}`;
}

const results = new Map();
const cases = [
  ["1", testH1],
  ["2", testH2],
  ["3", testH3],
  ["4", testH4],
  ["5", testH5],
  ["6", testH6],
  ["7", testH7],
  ["8", testH8],
  ["9", testH9],
  ["10", testH10],
  ["12", testH12],
  ["11", testH11],
];

let browser;
try {
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    throw new Error(`REFUSED: headless Chromium is unavailable; cannot perform browser measurements.\n${error.message}`);
  }

  for (const [id, testCase] of cases) {
    try {
      const evidence = await testCase();
      results.set(id, { pass: true, evidence: String(evidence) });
    } catch (error) {
      results.set(id, {
        pass: false,
        evidence: String(error?.stack ?? error?.message ?? error).replace(/\s+/g, " ").trim(),
      });
    }
  }
} finally {
  if (browser) {
    try {
      await browser.close();
    } catch {
    }
  }
}

const lines = [
  `ROUND: ${round}`,
  `ARTIFACT_SHA256: ${artifactSha256}`,
  `VERIFIER_SHA256: ${verifierSha256}`,
];

const failed = [];
for (let id = 1; id <= 12; id += 1) {
  const result = results.get(String(id)) ?? { pass: false, evidence: "missing result" };
  if (!result.pass) failed.push(`H${id}`);
  lines.push(`H${id} ${result.pass ? "PASS" : "FAIL"} — ${result.evidence || "no evidence"}`);
}
lines.push(failed.length === 0 ? "HARD: PASS" : `HARD: FAIL (${failed.join(",")})`);

const output = `${lines.join("\n")}\n`;
fs.writeFileSync(outputPath, output, "utf8");
process.stdout.write(output);
process.exitCode = failed.length === 0 ? 0 : 1;
