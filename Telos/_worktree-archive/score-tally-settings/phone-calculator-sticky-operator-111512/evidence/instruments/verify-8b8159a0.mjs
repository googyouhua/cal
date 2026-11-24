#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const RAW_ROUND = process.argv[2] ?? process.env.KEKKAI_ROUND ?? "1";
const ROUND = String(RAW_ROUND).replace(/^r/i, "");

function fromScript(candidate) {
  return path.isAbsolute(candidate) ? candidate : path.resolve(SCRIPT_DIR, candidate);
}

const ARTIFACT_PATH = fromScript(process.env.KEKKAI_ARTIFACT ?? "../../../index.html");
const OUT_DIR = fromScript(process.env.KEKKAI_OUT_DIR ?? ".");
const HARD_PATH = path.join(OUT_DIR, `hard-r${ROUND}.txt`);
const ARTIFACT_URL = pathToFileURL(ARTIFACT_PATH).href;

const S = Object.freeze({
  app: "main.app[data-state]",
  picker: '[data-testid="op-picker"]',
  calcInput: 'input[data-testid="calc-input"]',
  expression: '[data-testid="expression"]',
  result: '[data-testid="result"]',
  equals: 'button[data-testid="key-equals"]',
  keyOp: 'button[data-testid="key-op"]',
  history: '[data-testid="history"]',
  historyItem: '[data-testid="history-item"]',
  historyExpression: '[data-testid="history-expression"]',
  historyResult: '[data-testid="history-result"]',
  historyEdit: 'button[data-testid="history-edit"]',
  editDraft: '[data-testid="edit-draft"]',
  operandChip: '[data-testid="operand-chip"]',
  operandInput: 'input[data-testid="operand-input"]',
  operandRemove: 'button[data-testid="operand-remove"]'
});

const OPERATORS = ["+", "-", "*", "/"];
const OPERATOR_GLYPHS = Object.freeze({
  "+": ["+"],
  "-": ["-", "−"],
  "*": ["*", "×"],
  "/": ["/", "÷"]
});

class AssertionFailure extends Error {}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function display(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function oneLine(value, limit = 1800) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function must(condition, label, actual) {
  if (!condition) throw new AssertionFailure(`${label}; actual=${display(actual)}`);
}

function mustEqual(actual, expected, label) {
  must(Object.is(actual, expected), label, { actual, expected });
}

function mustDeep(actual, expected, label) {
  must(isDeepStrictEqual(actual, expected), label, { actual, expected });
}

function mustNear(actual, expected, label, tolerance = 1e-9) {
  must(Number.isFinite(actual), `${label}: finite numeric value`, actual);
  must(Math.abs(actual - expected) <= tolerance, label, { actual, expected, tolerance });
}

function parseValue(rawValue, label) {
  must(typeof rawValue === "string" && rawValue.length > 0, `${label}: data-value present`, rawValue);
  const parsed = Number.parseFloat(rawValue);
  must(Number.isFinite(parsed), `${label}: parseFloat(data-value) finite`, rawValue);
  return parsed;
}

function loadPlaywright() {
  const anchors = [
    process.env.KEKKAI_PLAYWRIGHT_BASE && path.join(process.env.KEKKAI_PLAYWRIGHT_BASE, "package.json"),
    path.join(SCRIPT_DIR, "package.json"),
    path.join(SCRIPT_DIR, "..", "package.json"),
    path.join(SCRIPT_DIR, "..", "..", "package.json"),
    "/ws/cal_phone/Telos/phone-calculator-history-111508/node_modules/playwright/package.json",
    "/tmp/kekkai-first-kcOfJi/node_modules/playwright/package.json"
  ].filter(Boolean);
  let lastError = null;
  for (const anchor of anchors) {
    try {
      return createRequire(anchor)("playwright");
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`playwright unavailable: ${lastError?.message ?? "module not found"}`);
}

function withTimeout(promise, milliseconds, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: timeout after ${milliseconds}ms`)), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const playwright = loadPlaywright();
let browser = null;
const trackers = [];

async function openPage(testId, contextOptions = {}, label = "page") {
  const context = await browser.newContext(contextOptions);
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(20000);
  const tracker = { testId, label, pageErrors: [], consoleErrors: [] };
  trackers.push(tracker);
  page.on("pageerror", (error) => tracker.pageErrors.push(error?.stack ?? error?.message ?? String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") tracker.consoleErrors.push(message.text());
  });
  try {
    await page.goto(ARTIFACT_URL, { waitUntil: "load" });
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
  return { context, page, tracker };
}

function trackerStats(testIds) {
  const selected = trackers.filter((tracker) => testIds.includes(tracker.testId));
  return {
    pages: selected.length,
    pageErrors: selected.flatMap((tracker) => tracker.pageErrors),
    consoleErrors: selected.flatMap((tracker) => tracker.consoleErrors)
  };
}

function assertNoPageErrors(tracker, label) {
  mustEqual(tracker.pageErrors.length, 0, label);
}

async function stateOf(page) {
  return page.locator(S.app).getAttribute("data-state");
}

async function expectState(page, expected, label) {
  const actual = await stateOf(page);
  mustEqual(actual, expected, label);
  return actual;
}

async function appOperator(page) {
  return page.locator(S.app).getAttribute("data-operator");
}

async function expectOperator(page, expected, label) {
  mustEqual(await appOperator(page), expected, label);
}

async function expectNoOperator(page, label) {
  const actual = await appOperator(page);
  must(actual === null || actual === "", label, actual);
}

async function count(page, selector) {
  return page.locator(selector).count();
}

async function expressionText(page) {
  return (await page.locator(S.expression).textContent()) ?? "";
}

async function resultInfo(page) {
  return page.locator(S.result).evaluate((element) => ({
    text: element.textContent ?? "",
    value: element.getAttribute("data-value"),
    error: element.getAttribute("data-error")
  }));
}

async function expectExpressionEmpty(page, label) {
  mustEqual((await expressionText(page)).trim(), "", `${label}: expression empty`);
}

async function expectResultEmpty(page, label) {
  const info = await resultInfo(page);
  mustEqual(info.text.trim(), "", `${label}: result text empty`);
  mustEqual(info.value, null, `${label}: result has no data-value`);
}

async function expectCalcEnabledFocused(page, label) {
  const input = page.locator(S.calcInput);
  mustEqual(await input.isDisabled(), false, `${label}: calc-input enabled`);
  const focused = await input.evaluate((element) => document.activeElement === element);
  must(focused, `${label}: calc-input focused`, focused);
}

async function expectPickerVisible(page, label) {
  must(await page.locator(S.picker).isVisible(), `${label}: op-picker visible`, false);
}

function opButton(page, operator) {
  return page.locator(`${S.picker} button[data-op="${operator}"]`);
}

async function clickOp(page, operator) {
  const button = opButton(page, operator);
  mustEqual(await button.count(), 1, `data-op=${operator}: unique picker button`);
  must(await button.isVisible(), `data-op=${operator}: visible`, false);
  must(await button.isEnabled(), `data-op=${operator}: enabled`, false);
  await button.click();
}

async function enterNumber(page, rawValue) {
  const input = page.locator(S.calcInput);
  mustEqual(await input.isDisabled(), false, `calc-input enabled before ${rawValue}`);
  await input.fill(String(rawValue));
  mustEqual(await input.inputValue(), String(rawValue), `calc-input value before Enter ${rawValue}`);
  await input.press("Enter");
  mustEqual(await input.inputValue(), "", `calc-input cleared after Enter ${rawValue}`);
}

async function clickEquals(page) {
  const button = page.locator(S.equals);
  must(await button.isVisible(), "key-equals visible", false);
  must(await button.isEnabled(), "key-equals enabled", false);
  await button.click();
}

async function computeCase(page, operator, values) {
  await clickOp(page, operator);
  for (const value of values) await enterNumber(page, value);
  await clickEquals(page);
}

async function operandInputValues(page) {
  return page.locator(S.operandInput).evaluateAll((elements) => elements.map((element) => element.value));
}

function assertExpressionContent(text, operator, values, label) {
  must(text.length > 0, `${label}: expression non-empty`, text);
  for (const value of values) must(text.includes(String(value)), `${label}: expression contains ${value}`, text);
  must(OPERATOR_GLYPHS[operator].some((glyph) => text.includes(glyph)), `${label}: expression operator glyph`, text);
}

async function historySnapshots(page) {
  return page.locator(S.historyItem).evaluateAll((items) => items.map((item) => {
    const expression = item.querySelector('[data-testid="history-expression"]');
    const result = item.querySelector('[data-testid="history-result"]');
    const operandsRaw = item.getAttribute("data-operands");
    let operands = null;
    let operandsParseOk = false;
    try {
      operands = JSON.parse(operandsRaw);
      operandsParseOk = true;
    } catch {
      operandsParseOk = false;
    }
    return {
      operator: item.getAttribute("data-operator"),
      operands,
      operandsRaw,
      operandsParseOk,
      expressionText: expression ? (expression.textContent ?? "") : null,
      resultValue: result ? result.getAttribute("data-value") : null,
      resultText: result ? (result.textContent ?? "") : null
    };
  }));
}

function assertHistoryRecord(record, operator, values, expectedResult, label) {
  must(record, `${label}: record exists`, record);
  mustEqual(record.operator, operator, `${label}: data-operator`);
  mustEqual(record.operandsParseOk, true, `${label}: data-operands parses as JSON`);
  mustDeep(record.operands, values, `${label}: data-operands exact original strings`);
  mustNear(parseValue(record.resultValue, `${label}: history-result data-value`), expectedResult, `${label}: history result`);
  assertExpressionContent(record.expressionText ?? "", operator, values, `${label}: history-expression`);
}

async function assertHistoryEditVisible(page, index, label) {
  const item = page.locator(S.historyItem).nth(index);
  mustEqual(await item.count(), 1, `${label}: history item ${index} exists`);
  must(await item.locator(S.historyEdit).isVisible(), `${label}: history-edit visible at ${index}`, false);
}

async function historyField(record, label) {
  must(record, `${label}: record exists`, record);
  return `${record.operator}${JSON.stringify(record.operands)}=${record.resultValue}`;
}

function attributeReferences(html, tag, attribute) {
  const expression = new RegExp(
    `<${tag}\\b[^>]*\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "gi"
  );
  const references = [];
  let match = null;
  while ((match = expression.exec(html)) !== null) references.push(match[1] ?? match[2] ?? match[3] ?? "");
  return references;
}

function importReferences(html) {
  const expression = /@import\s+(?:url\s*\(\s*)?(?:"([^"]*)"|'([^']*)'|([^\s;)]+))/gi;
  const references = [];
  let match = null;
  while ((match = expression.exec(html)) !== null) references.push(match[1] ?? match[2] ?? match[3] ?? "");
  return references;
}

function urlReferences(html) {
  const expression = /\burl\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi;
  const references = [];
  let match = null;
  while ((match = expression.exec(html)) !== null) references.push((match[1] ?? match[2] ?? match[3] ?? "").trim());
  return references;
}

function isExternalReference(reference) {
  return /^(?:https?:)?\/\//i.test(reference.trim());
}

async function measureLayout(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const calcInput = document.querySelector('input[data-testid="calc-input"]');
    const operandInputs = Array.from(document.querySelectorAll('input[data-testid="operand-input"]'));
    const candidates = Array.from(document.querySelectorAll("input, button, [data-op]"));

    function visible(element) {
      const style = getComputedStyle(element);
      if (["none", "hidden", "collapse"].includes(style.display) || ["hidden", "collapse"].includes(style.visibility)) return false;
      if (Number.parseFloat(style.opacity) === 0) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0;
    }

    function fontSize(element) {
      return Number.parseFloat(getComputedStyle(element).fontSize) || 0;
    }

    return {
      viewport: { width: innerWidth, height: innerHeight, maxTouchPoints: navigator.maxTouchPoints },
      documentElement: { clientWidth: root.clientWidth, scrollWidth: root.scrollWidth, overflow: root.scrollWidth - root.clientWidth },
      body: { clientWidth: body.clientWidth, scrollWidth: body.scrollWidth, overflow: body.scrollWidth - body.clientWidth },
      controls: candidates.filter(visible).map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          testId: element.getAttribute("data-testid"),
          operator: element.getAttribute("data-op"),
          width: rect.width,
          height: rect.height
        };
      }),
      calcFont: calcInput ? fontSize(calcInput) : null,
      operandFonts: operandInputs.map(fontSize)
    };
  });
}

function assertLayout(metrics, label) {
  must(metrics.documentElement.overflow <= 1, `${label}: documentElement horizontal overflow`, metrics.documentElement);
  must(metrics.body.overflow <= 1, `${label}: body horizontal overflow`, metrics.body);
  must(metrics.controls.length > 0, `${label}: visible controls found`, metrics.controls.length);
  const minWidth = Math.min(...metrics.controls.map((control) => control.width));
  const minHeight = Math.min(...metrics.controls.map((control) => control.height));
  must(minWidth >= 43.5, `${label}: every visible control width >= 44 (0.5px tolerance)`, minWidth);
  must(minHeight >= 43.5, `${label}: every visible control height >= 44 (0.5px tolerance)`, minHeight);
  must(metrics.calcFont !== null && metrics.calcFont >= 16, `${label}: calc-input font-size >= 16`, metrics.calcFont);
  must(metrics.operandFonts.every((fontSize) => fontSize >= 16), `${label}: operand-input font-size >= 16`, metrics.operandFonts);
  return { minWidth, minHeight };
}

function layoutEvidence(configuration, phase, metrics, sizes) {
  return `${configuration}/${phase}:viewport=${metrics.viewport.width}x${metrics.viewport.height},touch=${metrics.viewport.maxTouchPoints},docOverflow=${metrics.documentElement.overflow},bodyOverflow=${metrics.body.overflow},visibleControls=${metrics.controls.length},minW=${sizes.minWidth.toFixed(2)},minH=${sizes.minHeight.toFixed(2)},calcFont=${metrics.calcFont},operandFonts=${metrics.operandFonts.length ? metrics.operandFonts.join("/") : "none"}`;
}

const artifactBuffer = fs.readFileSync(ARTIFACT_PATH);
const artifactSha = sha256(artifactBuffer);
const verifierSha = sha256(fs.readFileSync(SCRIPT_PATH));
const html = artifactBuffer.toString("utf8");

async function testH1() {
  must(html.includes("</html>"), "H1 closing </html> exists", html.slice(-100));
  must(artifactBuffer.length >= 1024, "H1 artifact byte length >= 1024", artifactBuffer.length);
  const groups = {
    scriptSrc: attributeReferences(html, "script", "src").filter(isExternalReference),
    linkHref: attributeReferences(html, "link", "href").filter(isExternalReference),
    imageSrc: attributeReferences(html, "img", "src").filter(isExternalReference),
    import: importReferences(html).filter(isExternalReference),
    url: urlReferences(html).filter(isExternalReference)
  };
  const externalCount = Object.values(groups).reduce((total, group) => total + group.length, 0);
  mustEqual(externalCount, 0, "H1 external (http/https/protocol-relative) resource references");

  const handle = await openPage("H1");
  try {
    await handle.page.waitForLoadState("load");
    assertNoPageErrors(handle.tracker, "H1 pageerror count");
  } finally {
    await handle.context.close();
  }
  return `htmlClose=true,bytes=${artifactBuffer.length},externalRefs=${externalCount}(script=${groups.scriptSrc.length},link=${groups.linkHref.length},img=${groups.imageSrc.length},import=${groups.import.length},url=${groups.url.length}),pageerrors=0`;
}

async function testH2() {
  const configurations = [
    { label: "320x568", viewport: { width: 320, height: 568 } },
    { label: "390x844", viewport: { width: 390, height: 844 } }
  ];
  const evidence = [];

  for (const configuration of configurations) {
    const handle = await openPage(
      "H2",
      { viewport: configuration.viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
      configuration.label
    );
    try {
      const { page, tracker } = handle;
      await computeCase(page, "+", ["12", "30", "8"]);
      await expectState(page, "result", `H2 ${configuration.label}: first result state`);
      await computeCase(page, "*", ["2", "3", "4"]);
      await expectState(page, "result", `H2 ${configuration.label}: second result state`);
      mustEqual(await count(page, S.historyItem), 2, `H2 ${configuration.label}: two records`);

      const resultMetrics = await measureLayout(page);
      const resultSizes = assertLayout(resultMetrics, `H2 ${configuration.label}: result`);
      evidence.push(layoutEvidence(configuration.label, "result", resultMetrics, resultSizes));

      const source = page.locator(S.historyItem).nth(1);
      mustEqual(await source.getAttribute("data-operator"), "+", `H2 ${configuration.label}: older source is +`);
      await source.locator(S.historyEdit).click();
      await expectState(page, "edit", `H2 ${configuration.label}: edit state`);
      mustEqual(await count(page, S.operandInput), 3, `H2 ${configuration.label}: edit has three operand inputs`);

      const editMetrics = await measureLayout(page);
      const editSizes = assertLayout(editMetrics, `H2 ${configuration.label}: edit`);
      evidence.push(layoutEvidence(configuration.label, "edit", editMetrics, editSizes));
      assertNoPageErrors(tracker, `H2 ${configuration.label}: pageerror count`);
    } finally {
      await handle.context.close();
    }
  }
  return evidence.join(" | ");
}

async function testH3() {
  const handle = await openPage("H3");
  try {
    const { page, tracker } = handle;
    await computeCase(page, "+", ["12", "30", "8"]);
    await expectState(page, "result", "H3 first equals state");
    await expectOperator(page, "+", "H3 sticky operator after equals");
    await expectPickerVisible(page, "H3 after equals");
    await expectCalcEnabledFocused(page, "H3 after equals");
    must(await page.locator(S.equals).isEnabled(), "H3 key-equals enabled after equals", false);
    mustEqual(await count(page, S.historyItem), 1, "H3 initial history count");
    const first = await historySnapshots(page);

    await page.keyboard.press("=");
    mustEqual(await count(page, S.historyItem), 1, "H3 empty result-state = is no-op");
    assertNoPageErrors(tracker, "H3 pageerror count after empty =");

    await enterNumber(page, "5");
    await expectState(page, "input", "H3 first new number starts fresh input state");
    const freshExpression = await expressionText(page);
    must(freshExpression.includes("5"), "H3 fresh expression contains 5", freshExpression);
    must(!freshExpression.includes("50"), "H3 fresh expression excludes old 50", freshExpression);
    await expectResultEmpty(page, "H3 first new number");
    mustEqual(await count(page, S.historyItem), 1, "H3 history unchanged by first new number");

    await enterNumber(page, "6");
    await clickEquals(page);
    await expectState(page, "result", "H3 second result state");
    mustNear(parseValue((await resultInfo(page)).value, "H3 5+6 result"), 11, "H3 5+6 result");
    mustEqual(await count(page, S.historyItem), 2, "H3 history count after 5+6");
    const second = await historySnapshots(page);
    assertHistoryRecord(second[0], "+", ["5", "6"], 11, "H3 top +5/6 record");
    mustDeep(second.slice(1), first, "H3 original +12/30/8 record unchanged");

    await enterNumber(page, "2");
    await enterNumber(page, "3");
    await clickEquals(page);
    await expectState(page, "result", "H3 third result state");
    await expectOperator(page, "+", "H3 operator remains + with no picker clicks");
    mustNear(parseValue((await resultInfo(page)).value, "H3 2+3 result"), 5, "H3 2+3 result");
    mustEqual(await count(page, S.historyItem), 3, "H3 history count after 2+3");
    const third = await historySnapshots(page);
    assertHistoryRecord(third[0], "+", ["2", "3"], 5, "H3 top +2/3 record");
    mustDeep(third.slice(1), second, "H3 earlier two records unchanged");
    assertNoPageErrors(tracker, "H3 pageerror count");
    return `first=${await historyField(first[0], "H3 first")},secondTop=${await historyField(second[0], "H3 second")},thirdTop=${await historyField(third[0], "H3 third")},history=3,operatorSticky=true`;
  } finally {
    await handle.context.close();
  }
}

async function testH4() {
  const handle = await openPage("H4");
  try {
    const { page, tracker } = handle;
    await computeCase(page, "+", ["12", "30", "8"]);
    await expectState(page, "result", "H4 first result state");
    const first = await historySnapshots(page);

    await clickOp(page, "*");
    await expectOperator(page, "*", "H4 result-state operator changed to *");
    await expectPickerVisible(page, "H4 after operator change");
    await expectCalcEnabledFocused(page, "H4 after operator change");
    mustEqual(await count(page, S.historyItem), 1, "H4 operator change preserves history count");
    mustDeep(await historySnapshots(page), first, "H4 operator change preserves history fields");

    await enterNumber(page, "5");
    await enterNumber(page, "6");
    await clickEquals(page);
    await expectState(page, "result", "H4 second result state");
    mustNear(parseValue((await resultInfo(page)).value, "H4 5*6 result"), 30, "H4 5*6 result");
    mustEqual(await count(page, S.historyItem), 2, "H4 history count after 5*6");
    const second = await historySnapshots(page);
    assertHistoryRecord(second[0], "*", ["5", "6"], 30, "H4 top *5/6 record");
    mustDeep(second.slice(1), first, "H4 original + record unchanged");

    await enterNumber(page, "2");
    await enterNumber(page, "3");
    await clickOp(page, "+");
    await expectOperator(page, "+", "H4 input-state operator changed to +");
    const changedExpression = await expressionText(page);
    for (const token of ["2", "3", "+"]) must(changedExpression.includes(token), `H4 changed expression contains ${token}`, changedExpression);
    must(!changedExpression.includes("*"), "H4 changed expression excludes old *", changedExpression);
    await expectCalcEnabledFocused(page, "H4 after input-state operator change");
    mustEqual(await count(page, S.historyItem), 2, "H4 input-state operator change preserves history count");

    await clickEquals(page);
    await expectState(page, "result", "H4 third result state");
    mustNear(parseValue((await resultInfo(page)).value, "H4 2+3 result"), 5, "H4 2+3 result");
    mustEqual(await count(page, S.historyItem), 3, "H4 history count after 2+3");
    const third = await historySnapshots(page);
    assertHistoryRecord(third[0], "+", ["2", "3"], 5, "H4 top +2/3 record");
    mustDeep(third.slice(1), second, "H4 first two records unchanged");
    assertNoPageErrors(tracker, "H4 pageerror count");
    return `resultChange=*:${await historyField(second[0], "H4 second")},inputChange=+:${await historyField(third[0], "H4 third")},history=3,oldRecordsUnchanged=true`;
  } finally {
    await handle.context.close();
  }
}

async function testH5() {
  const evidence = [];
  const initial = await openPage("H5", {}, "initial");
  try {
    const { page, tracker } = initial;
    await expectPickerVisible(page, "H5 initial");
    const pickerOps = page.locator(`${S.picker} button[data-op]`);
    mustEqual(await pickerOps.count(), 4, "H5 picker has exactly four data-op buttons");
    mustEqual(await count(page, "[data-op]"), 4, "H5 page has exactly four data-op elements");
    const values = (await pickerOps.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-op")))).slice().sort();
    mustDeep(values, [...OPERATORS].sort(), "H5 data-op set");
    mustEqual(await page.locator(S.calcInput).isDisabled(), true, "H5 initial calc-input disabled");
    await expectExpressionEmpty(page, "H5 initial");
    await expectResultEmpty(page, "H5 initial");

    await clickOp(page, "+");
    await expectState(page, "input", "H5 operator selection state");
    await expectOperator(page, "+", "H5 selected operator");
    await expectCalcEnabledFocused(page, "H5 after + selection");
    await expectPickerVisible(page, "H5 after + selection");

    await enterNumber(page, "12");
    await enterNumber(page, "30");
    mustEqual(await page.locator(S.calcInput).inputValue(), "", "H5 committed operands clear calc-input");
    const committedExpression = await expressionText(page);
    for (const token of ["12", "30", "+"]) must(committedExpression.includes(token), `H5 committed expression contains ${token}`, committedExpression);

    await page.locator(S.calcInput).fill("8");
    const beforeKeyboardEquals = await expressionText(page);
    must(!beforeKeyboardEquals.includes("8"), "H5 uncommitted 8 absent from expression", beforeKeyboardEquals);
    await page.keyboard.press("=");
    const afterKeyboardEquals = await expressionText(page);
    must(afterKeyboardEquals.includes("8"), "H5 keyboard = commits 8", afterKeyboardEquals);
    mustNear(parseValue((await resultInfo(page)).value, "H5 keyboard result"), 50, "H5 keyboard result");
    assertNoPageErrors(tracker, "H5 initial scenario pageerror count");
    evidence.push("initialOps=4,disabled=true,focus=true,staged8Hidden=true,keyboardResult=50");
  } finally {
    await initial.context.close();
  }

  const cases = [
    { operator: "+", values: ["12", "30", "8"], expected: 50 },
    { operator: "-", values: ["10", "4", "3"], expected: 3 },
    { operator: "*", values: ["2", "3", "4"], expected: 24 },
    { operator: "/", values: ["100", "5", "2"], expected: 10 },
    { operator: "+", values: ["1.5", "2.25"], expected: 3.75 }
  ];
  for (const testCase of cases) {
    const handle = await openPage("H5", {}, `${testCase.operator}:${testCase.values.join("/")}`);
    try {
      const { page, tracker } = handle;
      await computeCase(page, testCase.operator, testCase.values);
      await expectState(page, "result", `H5 case ${testCase.operator} result state`);
      const actual = parseValue((await resultInfo(page)).value, `H5 case ${testCase.operator}`);
      mustNear(actual, testCase.expected, `H5 case ${testCase.operator} result`);
      assertExpressionContent(await expressionText(page), testCase.operator, testCase.values, `H5 case ${testCase.operator}`);
      assertNoPageErrors(tracker, `H5 case ${testCase.operator} pageerror count`);
      evidence.push(`${testCase.operator}${testCase.values.join("/")}=${actual}`);
    } finally {
      await handle.context.close();
    }
  }
  return evidence.join(" | ");
}

async function testH6() {
  const handle = await openPage("H6");
  try {
    const { page, tracker } = handle;
    const cases = [
      { operator: "+", values: ["12", "30", "8"], expected: 50 },
      { operator: "-", values: ["10", "4", "3"], expected: 3 },
      { operator: "*", values: ["2", "3", "4"], expected: 24 },
      { operator: "+", values: ["1.5", "2.25"], expected: 3.75 }
    ];

    for (let index = 0; index < cases.length; index += 1) {
      const testCase = cases[index];
      await clickOp(page, testCase.operator);
      for (const value of testCase.values) await enterNumber(page, value);
      const before = await count(page, S.historyItem);
      await clickEquals(page);
      const after = await count(page, S.historyItem);
      mustEqual(after, before + 1, `H6 history increments once for case ${index + 1}`);
      mustEqual(after, index + 1, `H6 exact history count after case ${index + 1}`);
      const snapshot = await historySnapshots(page);
      assertHistoryRecord(snapshot[0], testCase.operator, testCase.values, testCase.expected, `H6 newest case ${index + 1}`);
      await assertHistoryEditVisible(page, 0, `H6 newest case ${index + 1}`);
    }

    const expectedOrder = [...cases].reverse();
    const final = await historySnapshots(page);
    mustEqual(final.length, 4, "H6 final history length");
    for (let index = 0; index < expectedOrder.length; index += 1) {
      const testCase = expectedOrder[index];
      assertHistoryRecord(final[index], testCase.operator, testCase.values, testCase.expected, `H6 final DOM index ${index}`);
      await assertHistoryEditVisible(page, index, `H6 final DOM index ${index}`);
    }

    await clickOp(page, "+");
    const beforeEmptyEnter = await count(page, S.historyItem);
    await page.locator(S.calcInput).press("Enter");
    mustEqual(await count(page, S.historyItem), beforeEmptyEnter, "H6 empty Enter does not add history");

    await page.locator(S.keyOp).click();
    await expectState(page, "select", "H6 before division test");
    await clickOp(page, "/");
    await enterNumber(page, "5");
    await enterNumber(page, "0");
    const beforeDivision = await count(page, S.historyItem);
    await clickEquals(page);
    await expectState(page, "error", "H6 division-by-zero state");
    mustEqual(await count(page, S.historyItem), beforeDivision, "H6 division by zero does not add history");
    assertNoPageErrors(tracker, "H6 pageerror count");
    return `history=4,order=${final.map((record) => `${record.operator}${JSON.stringify(record.operands)}=${record.resultValue}`).join(" > ")},emptyEnterHistory=${beforeEmptyEnter},divisionHistory=${beforeDivision}`;
  } finally {
    await handle.context.close();
  }
}

async function testH7() {
  const mainHandle = await openPage("H7", {}, "main");
  try {
    const { page, tracker } = mainHandle;
    await computeCase(page, "+", ["12", "30", "8"]);
    await computeCase(page, "*", ["2", "3", "4"]);
    await expectState(page, "result", "H7 pre-reset state");
    const before = await historySnapshots(page);
    mustEqual(before.length, 2, "H7 two records before reset");

    await page.locator(S.keyOp).click();
    await expectState(page, "select", "H7 key-op selects");
    await expectNoOperator(page, "H7 key-op clears data-operator");
    await expectPickerVisible(page, "H7 key-op picker");
    mustEqual(await page.locator(S.calcInput).isDisabled(), true, "H7 key-op disables calc-input");
    await expectExpressionEmpty(page, "H7 key-op");
    await expectResultEmpty(page, "H7 key-op");
    mustEqual(await count(page, S.historyItem), 2, "H7 key-op preserves history count");
    mustDeep(await historySnapshots(page), before, "H7 key-op preserves every history field");

    await page.reload({ waitUntil: "load" });
    mustEqual(await count(page, S.historyItem), 0, "H7 history count after reload");
    await expectState(page, "select", "H7 state after reload");
    await expectNoOperator(page, "H7 operator after reload");
    assertNoPageErrors(tracker, "H7 pageerror count through reload");
  } finally {
    await mainHandle.context.close();
  }

  const fresh = await openPage("H7", {}, "fresh-context");
  try {
    mustEqual(await count(fresh.page, S.historyItem), 0, "H7 fresh browser context history count");
    await expectState(fresh.page, "select", "H7 fresh browser context state");
    assertNoPageErrors(fresh.tracker, "H7 fresh context pageerror count");
  } finally {
    await fresh.context.close();
  }
  return "resetState=select,disabled=true,operatorCleared=true,historyAfterReset=2,historyAfterReload=0,freshContextHistory=0,pageerrors=0";
}

async function testH8() {
  const handle = await openPage("H8");
  try {
    const { page, tracker } = handle;
    await computeCase(page, "+", ["12", "30", "8"]);
    await computeCase(page, "*", ["2", "3", "4"]);
    await expectState(page, "result", "H8 pre-edit state");
    const original = await historySnapshots(page);
    mustEqual(original.length, 2, "H8 original history length");

    const source = page.locator(S.historyItem).nth(1);
    mustEqual(await source.getAttribute("data-operator"), "+", "H8 older source operator");
    await source.locator(S.historyEdit).click();
    await expectState(page, "edit", "H8 edit state");
    const draft = page.locator(S.editDraft);
    must(await draft.isVisible(), "H8 edit-draft visible", false);
    mustEqual(await draft.getAttribute("data-operator"), "+", "H8 edit-draft operator");
    const inputs = page.locator(S.operandInput);
    mustEqual(await inputs.count(), 3, "H8 operand-input count");
    mustDeep(await operandInputValues(page), ["12", "30", "8"], "H8 initial operand values");
    const flags = await inputs.evaluateAll((elements) => elements.map((element) => ({ disabled: element.disabled, readOnly: element.readOnly })));
    must(flags.every((item) => item.disabled === false && item.readOnly === false), "H8 operand inputs enabled and editable", flags);

    await inputs.nth(1).fill("5");
    const editedExpression = await expressionText(page);
    must(editedExpression.includes("5"), "H8 expression contains edited 5", editedExpression);
    must(!editedExpression.includes("30"), "H8 expression excludes replaced 30", editedExpression);

    await clickEquals(page);
    await expectState(page, "result", "H8 post-edit state");
    mustEqual(await draft.isVisible(), false, "H8 edit-draft hidden after calculation");
    mustNear(parseValue((await resultInfo(page)).value, "H8 edited result"), 25, "H8 edited result");
    mustEqual(await count(page, S.historyItem), 3, "H8 history count after edit calc");
    const after = await historySnapshots(page);
    assertHistoryRecord(after[0], "+", ["12", "5", "8"], 25, "H8 new top edited record");
    mustDeep(after.slice(1), original, "H8 original records unchanged and in order");
    assertNoPageErrors(tracker, "H8 pageerror count");
    return `editState=true,draftOperator=+,operands=12/30/8,editedResult=25,history=3,oldRecordsUnchanged=true`;
  } finally {
    await handle.context.close();
  }
}

async function testH9() {
  const handle = await openPage("H9");
  try {
    const { page, tracker } = handle;
    await computeCase(page, "*", ["2", "3", "4"]);
    await computeCase(page, "+", ["1.5", "2.25"]);
    await expectState(page, "result", "H9 pre-edit state");
    const original = await historySnapshots(page);
    mustEqual(original.length, 2, "H9 original history length");

    const source = page.locator(S.historyItem).nth(1);
    mustEqual(await source.getAttribute("data-operator"), "*", "H9 older source operator");
    await source.locator(S.historyEdit).click();
    await expectState(page, "edit", "H9 edit state");
    await clickOp(page, "+");
    mustEqual(await page.locator(S.editDraft).getAttribute("data-operator"), "+", "H9 edit-draft changed to +");
    mustDeep(await operandInputValues(page), ["2", "3", "4"], "H9 operator change preserves operand values");

    const inputs = page.locator(S.operandInput);
    await inputs.nth(0).fill("10");
    await inputs.nth(2).fill("5");
    const editedExpression = await expressionText(page);
    must(editedExpression.includes("10"), "H9 expression contains 10", editedExpression);
    must(editedExpression.includes("5"), "H9 expression contains 5", editedExpression);

    await page.locator(S.operandChip).nth(1).locator(S.operandRemove).click();
    mustDeep(await operandInputValues(page), ["10", "5"], "H9 middle chip removal preserves remaining values/order");
    mustEqual(await count(page, S.operandChip), 2, "H9 two chips after removal");

    await enterNumber(page, "2");
    mustDeep(await operandInputValues(page), ["10", "5", "2"], "H9 Enter appends operand value");
    mustEqual(await count(page, S.operandInput), 3, "H9 appended operand has an input");

    await clickEquals(page);
    await expectState(page, "result", "H9 post-edit state");
    mustNear(parseValue((await resultInfo(page)).value, "H9 edited result"), 17, "H9 edited result");
    mustEqual(await count(page, S.historyItem), 3, "H9 history count after edit calc");
    const after = await historySnapshots(page);
    assertHistoryRecord(after[0], "+", ["10", "5", "2"], 17, "H9 new top record");
    mustDeep(after.slice(1), original, "H9 original records and relative order unchanged");
    assertNoPageErrors(tracker, "H9 pageerror count");
    return `draftOperator=+,valuesAfterChange=2/3/4,afterRemove=10/5,afterAppend=10/5/2,result=17,history=3,oldRecordsUnchanged=true`;
  } finally {
    await handle.context.close();
  }
}

async function testH10() {
  const handle = await openPage("H10");
  try {
    const { page, tracker } = handle;
    await computeCase(page, "+", ["12", "30", "8"]);
    await expectState(page, "result", "H10 pre-edit state");
    const original = await historySnapshots(page);
    mustEqual(original.length, 1, "H10 original history length");
    await page.locator(S.historyItem).nth(0).locator(S.historyEdit).click();
    await expectState(page, "edit", "H10 edit state");
    const inputs = page.locator(S.operandInput);
    mustEqual(await inputs.count(), 3, "H10 operand-input count");

    await inputs.nth(1).fill("");
    await clickEquals(page);
    mustEqual(await count(page, S.historyItem), 1, "H10 empty operand is history no-op");
    mustEqual((await resultInfo(page)).value, null, "H10 empty operand leaves no result data-value");
    assertNoPageErrors(tracker, "H10 pageerror count after empty operand");

    await inputs.nth(1).fill("abc");
    await clickEquals(page);
    mustEqual(await count(page, S.historyItem), 1, "H10 non-finite operand is history no-op");
    mustEqual((await resultInfo(page)).value, null, "H10 non-finite operand leaves no result data-value");
    assertNoPageErrors(tracker, "H10 pageerror count after non-finite operand");

    await inputs.nth(1).fill("5");
    await clickEquals(page);
    await expectState(page, "result", "H10 valid edit state");
    mustNear(parseValue((await resultInfo(page)).value, "H10 valid edited result"), 25, "H10 valid edited result");
    mustEqual(await count(page, S.historyItem), 2, "H10 history count after valid edit");
    const after = await historySnapshots(page);
    assertHistoryRecord(after[0], "+", ["12", "5", "8"], 25, "H10 new valid edited record");
    mustDeep(after.slice(1), original, "H10 source record unchanged after no-ops and valid edit");
    assertNoPageErrors(tracker, "H10 final pageerror count");
    return `emptyNoop=true,abcNoop=true,validResult=25,history=2,newOperands=12/5/8,pageerrors=0`;
  } finally {
    await handle.context.close();
  }
}

async function testH11() {
  const handle = await openPage("H11");
  try {
    const { page, tracker } = handle;
    await computeCase(page, "/", ["100", "5", "2"]);
    await expectState(page, "result", "H11 pre-edit state");
    const original = await historySnapshots(page);
    mustEqual(original.length, 1, "H11 original history length");
    await page.locator(S.historyItem).nth(0).locator(S.historyEdit).click();
    await expectState(page, "edit", "H11 edit state");
    await page.locator(S.operandInput).nth(1).fill("0");
    await clickEquals(page);

    await expectState(page, "error", "H11 edited division-by-zero state");
    const errorInfo = await resultInfo(page);
    mustEqual(errorInfo.error, "true", "H11 result data-error true");
    mustEqual(await count(page, S.historyItem), 1, "H11 division by zero preserves history count");
    mustDeep(await historySnapshots(page), original, "H11 division by zero preserves source record");
    assertNoPageErrors(tracker, "H11 pageerror count at error");
    await expectPickerVisible(page, "H11 error state");
    await expectCalcEnabledFocused(page, "H11 error state");

    await clickOp(page, "+");
    await expectOperator(page, "+", "H11 recovery operator");
    await expectCalcEnabledFocused(page, "H11 after recovery operator");
    mustEqual((await resultInfo(page)).error, null, "H11 recovery clears result data-error");

    await enterNumber(page, "1");
    await enterNumber(page, "2");
    await clickEquals(page);
    await expectState(page, "result", "H11 recovery result state");
    mustNear(parseValue((await resultInfo(page)).value, "H11 recovery result"), 3, "H11 recovery result");
    mustEqual(await count(page, S.historyItem), 2, "H11 history count after recovery");
    const after = await historySnapshots(page);
    assertHistoryRecord(after[0], "+", ["1", "2"], 3, "H11 recovery top record");
    mustDeep(after.slice(1), original, "H11 original source record unchanged after recovery");
    assertNoPageErrors(tracker, "H11 final pageerror count");
    return `editDivZeroError=true,historyAtError=1,sourceUnchanged=true,pickerAtError=true,recoveryResult=3,history=2,pageerrors=0`;
  } finally {
    await handle.context.close();
  }
}

async function deterministicSequence(label) {
  const handle = await openPage("H12", {}, label);
  try {
    const { page, tracker } = handle;
    await clickOp(page, "+");
    for (const value of ["12", "30", "8"]) await enterNumber(page, value);
    await clickEquals(page);
    await expectState(page, "result", `H12 ${label}: first result`);
    mustNear(parseValue((await resultInfo(page)).value, `H12 ${label}: first`), 50, `H12 ${label}: first result`);

    await enterNumber(page, "5");
    await enterNumber(page, "6");
    await clickEquals(page);
    await expectOperator(page, "+", `H12 ${label}: sticky +`);
    mustNear(parseValue((await resultInfo(page)).value, `H12 ${label}: second`), 11, `H12 ${label}: sticky result`);
    mustEqual(await count(page, S.historyItem), 2, `H12 ${label}: history after sticky result`);

    await clickOp(page, "*");
    await expectOperator(page, "*", `H12 ${label}: operator changed`);
    mustEqual(await count(page, S.historyItem), 2, `H12 ${label}: operator change preserves history`);
    await enterNumber(page, "5");
    await enterNumber(page, "6");
    await clickEquals(page);
    mustNear(parseValue((await resultInfo(page)).value, `H12 ${label}: third`), 30, `H12 ${label}: third result`);
    mustEqual(await count(page, S.historyItem), 3, `H12 ${label}: final history`);

    const snapshots = await historySnapshots(page);
    for (const [index, record] of snapshots.entries()) {
      mustEqual(record.operandsParseOk, true, `H12 ${label}: record ${index} operands parse`);
      must(typeof record.resultValue === "string", `H12 ${label}: record ${index} resultValue string`, record.resultValue);
    }
    assertHistoryRecord(snapshots[0], "*", ["5", "6"], 30, `H12 ${label}: top`);
    assertHistoryRecord(snapshots[1], "+", ["5", "6"], 11, `H12 ${label}: middle`);
    assertHistoryRecord(snapshots[2], "+", ["12", "30", "8"], 50, `H12 ${label}: bottom`);
    assertNoPageErrors(tracker, `H12 ${label}: pageerror count`);
    return snapshots.map((record) => ({
      operator: record.operator,
      operands: record.operands,
      resultValue: record.resultValue,
      expressionText: record.expressionText
    }));
  } finally {
    await handle.context.close();
  }
}

async function testH12() {
  const prior = trackerStats(["H3", "H4", "H5", "H6", "H7", "H8", "H9", "H10", "H11"]);
  mustEqual(prior.pageErrors.length, 0, "H12 pageerror count across H3-H11");
  mustEqual(prior.consoleErrors.length, 0, "H12 console error count across H3-H11");

  const first = await deterministicSequence("run1");
  const second = await deterministicSequence("run2");
  const current = trackerStats(["H12"]);
  mustEqual(current.pageErrors.length, 0, "H12 pageerror count across fresh runs");
  mustEqual(current.consoleErrors.length, 0, "H12 console error count across fresh runs");
  mustEqual(first.length, 3, "H12 first fresh run history length");
  mustEqual(second.length, 3, "H12 second fresh run history length");
  mustDeep(first, second, "H12 serialized history deep equality");
  return `H3-H11pages=${prior.pages},pageerrors=${prior.pageErrors.length},consoleErrors=${prior.consoleErrors.length},freshRuns=${current.pages},records=${first.length},historyEqual=true,freshPageerrors=${current.pageErrors.length},freshConsoleErrors=${current.consoleErrors.length}`;
}

async function main() {
  must(/^\d+$/.test(ROUND), "round argument must be numeric", RAW_ROUND);
  must(fs.existsSync(ARTIFACT_PATH), "artifact exists", ARTIFACT_PATH);
  browser = await withTimeout(playwright.chromium.launch({ headless: true, args: ["--no-sandbox"] }), 60000, "chromium launch");

  const tests = [
    ["H1", testH1], ["H2", testH2], ["H3", testH3], ["H4", testH4],
    ["H5", testH5], ["H6", testH6], ["H7", testH7], ["H8", testH8],
    ["H9", testH9], ["H10", testH10], ["H11", testH11], ["H12", testH12]
  ];
  const results = [];
  for (const [testId, testFunction] of tests) {
    const started = Date.now();
    try {
      const evidence = await withTimeout(testFunction(), 240000, testId);
      results.push({ testId, pass: true, evidence: oneLine(evidence) });
      console.log(`VERIFY ${testId} PASS ${Date.now() - started}ms`);
    } catch (error) {
      const evidence = oneLine(error instanceof AssertionFailure ? error.message : `${error?.name ?? "Error"}: ${error?.message ?? error}`);
      results.push({ testId, pass: false, evidence });
      console.log(`VERIFY ${testId} FAIL ${Date.now() - started}ms :: ${evidence}`);
    }
  }

  await browser.close().catch(() => {});
  const failures = results.filter((result) => !result.pass).map((result) => result.testId);
  const lines = [
    `ROUND: ${ROUND}`,
    `ARTIFACT_SHA256: ${artifactSha}`,
    `VERIFIER_SHA256: ${verifierSha}`,
    ...results.map((result) => `${result.testId} ${result.pass ? "PASS" : "FAIL"} — ${result.evidence}`),
    failures.length === 0 ? "HARD: PASS" : `HARD: FAIL (${failures.join(",")})`
  ];
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(HARD_PATH, `${lines.join("\n")}\n`, "utf8");
  console.log(`WROTE ${HARD_PATH}`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

main().catch(async (error) => {
  if (browser) await browser.close().catch(() => {});
  console.error(`VERIFIER PRECONDITION/CRASH: ${error?.stack ?? error}`);
  process.exitCode = 2;
});
