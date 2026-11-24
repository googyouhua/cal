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

function resolveFromScript(candidate) {
  return path.isAbsolute(candidate) ? candidate : path.resolve(SCRIPT_DIR, candidate);
}

const ARTIFACT_PATH = resolveFromScript(process.env.KEKKAI_ARTIFACT ?? "../../../index.html");
const OUT_DIR = resolveFromScript(process.env.KEKKAI_OUT_DIR ?? ".");
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

function oneLine(value, limit = 1400) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function display(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function must(condition, label, actual) {
  if (!condition) {
    throw new AssertionFailure(`${label}; actual=${display(actual)}`);
  }
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
  const anchors = [];
  if (process.env.KEKKAI_PLAYWRIGHT_BASE) {
    anchors.push(path.join(process.env.KEKKAI_PLAYWRIGHT_BASE, "package.json"));
  }
  anchors.push(
    path.join(SCRIPT_DIR, "package.json"),
    path.join(SCRIPT_DIR, "..", "package.json"),
    path.join(SCRIPT_DIR, "..", "..", "package.json"),
    path.join("/tmp/kekkai-first-w9jqeC", "package.json")
  );

  let lastError = null;
  for (const anchor of anchors) {
    try {
      const localRequire = createRequire(anchor);
      return localRequire("playwright");
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`playwright is unavailable: ${lastError?.message ?? "module not found"}`);
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
const trackersByTest = new Map();

function registerTracker(testId, tracker) {
  const list = trackersByTest.get(testId) ?? [];
  list.push(tracker);
  trackersByTest.set(testId, list);
}

async function openPage(testId, contextOptions = {}, label = "page") {
  const context = await browser.newContext(contextOptions);
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(20000);

  const tracker = {
    testId,
    label,
    pageErrors: [],
    consoleErrors: []
  };
  registerTracker(testId, tracker);

  page.on("pageerror", (error) => {
    tracker.pageErrors.push(error?.stack ?? error?.message ?? String(error));
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      tracker.consoleErrors.push(message.text());
    }
  });

  try {
    await page.goto(ARTIFACT_URL, { waitUntil: "load" });
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }

  return { context, page, tracker };
}

function collectTrackerStats(testIds) {
  const trackers = [];
  for (const testId of testIds) {
    trackers.push(...(trackersByTest.get(testId) ?? []));
  }
  return {
    pages: trackers.length,
    pageErrors: trackers.reduce((total, tracker) => total + tracker.pageErrors.length, 0),
    consoleErrors: trackers.reduce((total, tracker) => total + tracker.consoleErrors.length, 0),
    trackers
  };
}

function assertNoPageErrors(tracker, label) {
  must(tracker.pageErrors.length === 0, label, tracker.pageErrors.map((error) => oneLine(error, 300)));
}

async function readState(page) {
  return page.locator(S.app).getAttribute("data-state");
}

async function expectState(page, expected, label) {
  const actual = await readState(page);
  mustEqual(actual, expected, label);
  return actual;
}

async function historyCount(page) {
  return page.locator(S.historyItem).count();
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
  const text = await expressionText(page);
  mustEqual(text, "", `${label}: expression empty`);
}

async function expectResultEmpty(page, label) {
  const info = await resultInfo(page);
  mustEqual(info.text, "", `${label}: result text empty`);
  mustEqual(info.value, null, `${label}: result has no data-value`);
}

async function expectCalcFocused(page, label) {
  const focused = await page.evaluate(() => {
    const input = document.querySelector('input[data-testid="calc-input"]');
    return document.activeElement === input;
  });
  must(focused, `${label}: calc-input is activeElement`, focused);
}

function opButton(page, operator) {
  return page.locator(`${S.picker} button[data-op="${operator}"]`);
}

async function assertOpsClickable(page, label) {
  for (const operator of OPERATORS) {
    const button = opButton(page, operator);
    mustEqual(await button.count(), 1, `${label}: unique data-op=${operator}`);
    must(await button.isVisible(), `${label}: data-op=${operator} visible`, false);
    must(await button.isEnabled(), `${label}: data-op=${operator} enabled`, false);
  }
}

async function clickOp(page, operator) {
  const button = opButton(page, operator);
  mustEqual(await button.count(), 1, `data-op=${operator}: unique button`);
  must(await button.isVisible(), `data-op=${operator}: visible before click`, false);
  must(await button.isEnabled(), `data-op=${operator}: enabled before click`, false);
  await button.click();
}

async function enterNumber(page, rawValue) {
  const input = page.locator(S.calcInput);
  must(!(await input.isDisabled()), "calc-input enabled for number entry", true);
  await input.fill(String(rawValue));
  mustEqual(await input.inputValue(), String(rawValue), `calc-input value after filling ${rawValue}`);
  await input.press("Enter");
  mustEqual(await input.inputValue(), "", `calc-input cleared after committing ${rawValue}`);
}

async function clickEquals(page) {
  const button = page.locator(S.equals);
  must(await button.isVisible(), "key-equals visible", false);
  must(await button.isEnabled(), "key-equals enabled", false);
  await button.click();
}

async function computeCase(page, operator, values) {
  await clickOp(page, operator);
  for (const value of values) {
    await enterNumber(page, value);
  }
  await clickEquals(page);
}

async function operandInputValues(page) {
  return page.locator(S.operandInput).evaluateAll((elements) => elements.map((element) => element.value));
}

function assertExpressionContent(text, operator, operands, label) {
  must(text.length > 0, `${label}: expression non-empty`, text);
  for (const operand of operands) {
    must(text.includes(String(operand)), `${label}: expression contains ${operand}`, text);
  }
  must(
    OPERATOR_GLYPHS[operator].some((glyph) => text.includes(glyph)),
    `${label}: expression contains accepted glyph for ${operator}`,
    text
  );
}

async function historySnapshots(page) {
  return page.locator(S.historyItem).evaluateAll((items) => {
    return items.map((item) => {
      const operandsRaw = item.getAttribute("data-operands");
      let operands = null;
      let operandsParseOk = false;
      try {
        operands = JSON.parse(operandsRaw);
        operandsParseOk = true;
      } catch {
        operandsParseOk = false;
      }
      const expression = item.querySelector('[data-testid="history-expression"]');
      const result = item.querySelector('[data-testid="history-result"]');
      return {
        operator: item.getAttribute("data-operator"),
        operands,
        operandsRaw,
        operandsParseOk,
        expressionText: expression ? (expression.textContent ?? "") : null,
        resultValue: result ? result.getAttribute("data-value") : null,
        resultText: result ? (result.textContent ?? "") : null
      };
    });
  });
}

function assertHistoryRecord(record, operator, operands, expectedResult, label) {
  must(record, `${label}: history record exists`, record);
  mustEqual(record.operator, operator, `${label}: data-operator`);
  must(record.operandsParseOk, `${label}: data-operands parses as JSON`, record.operandsRaw);
  mustDeep(record.operands, operands, `${label}: data-operands order and raw values`);
  mustNear(parseValue(record.resultValue, `${label}: history-result`), expectedResult, `${label}: result value`);
  assertExpressionContent(record.expressionText ?? "", operator, operands, `${label}: history-expression`);
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
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
        return false;
      }
      if (Number.parseFloat(style.opacity) === 0) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0;
    }

    function fontSize(element) {
      return Number.parseFloat(getComputedStyle(element).fontSize) || 0;
    }

    const controls = candidates.filter(visible).map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName.toLowerCase(),
        testId: element.getAttribute("data-testid"),
        operator: element.getAttribute("data-op"),
        width: rect.width,
        height: rect.height
      };
    });

    return {
      documentElement: {
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
        overflow: root.scrollWidth - root.clientWidth
      },
      body: {
        clientWidth: body.clientWidth,
        scrollWidth: body.scrollWidth,
        overflow: body.scrollWidth - body.clientWidth
      },
      controls,
      calcFont: calcInput ? fontSize(calcInput) : null,
      operandFonts: operandInputs.map(fontSize)
    };
  });
}

function assertLayoutMetrics(metrics, label) {
  must(metrics.documentElement.overflow <= 1, `${label}: documentElement horizontal overflow`, metrics.documentElement);
  must(metrics.body.overflow <= 1, `${label}: body horizontal overflow`, metrics.body);
  must(metrics.controls.length > 0, `${label}: visible controls found`, metrics.controls.length);

  const minimumWidth = Math.min(...metrics.controls.map((control) => control.width));
  const minimumHeight = Math.min(...metrics.controls.map((control) => control.height));
  must(minimumWidth >= 43.5, `${label}: all visible control widths >= 44 (0.5px tolerance)`, minimumWidth);
  must(minimumHeight >= 43.5, `${label}: all visible control heights >= 44 (0.5px tolerance)`, minimumHeight);
  must(metrics.calcFont !== null && metrics.calcFont >= 16, `${label}: calc-input font-size >= 16`, metrics.calcFont);
  must(metrics.operandFonts.every((fontSize) => fontSize >= 16), `${label}: operand-input font-size >= 16`, metrics.operandFonts);

  return { minimumWidth, minimumHeight };
}

function layoutEvidence(configuration, phase, metrics) {
  const minimumWidth = Math.min(...metrics.controls.map((control) => control.width));
  const minimumHeight = Math.min(...metrics.controls.map((control) => control.height));
  const operandFonts = metrics.operandFonts.length > 0 ? metrics.operandFonts.join("/") : "none";
  return `${configuration}/${phase}:docOverflow=${metrics.documentElement.overflow},bodyOverflow=${metrics.body.overflow},controls=${metrics.controls.length},minW=${minimumWidth.toFixed(2)},minH=${minimumHeight.toFixed(2)},calcFont=${metrics.calcFont},operandFonts=${operandFonts}`;
}

function attributeReferences(html, tag, attribute) {
  const expression = new RegExp(
    `<${tag}\\b[^>]*\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "gi"
  );
  const references = [];
  let match = null;
  while ((match = expression.exec(html)) !== null) {
    references.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return references;
}

function importReferences(html) {
  const expression = /@import\s+(?:url\s*\(\s*)?(?:"([^"]*)"|'([^']*)'|([^\s;)]+))/gi;
  const references = [];
  let match = null;
  while ((match = expression.exec(html)) !== null) {
    references.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return references;
}

function urlReferences(html) {
  const expression = /\burl\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi;
  const references = [];
  let match = null;
  while ((match = expression.exec(html)) !== null) {
    references.push((match[1] ?? match[2] ?? match[3] ?? "").trim());
  }
  return references;
}

function isExternalReference(reference) {
  return /^(?:https?:)?\/\//i.test(reference.trim());
}

const artifactBuffer = fs.readFileSync(ARTIFACT_PATH);
const artifactSha = sha256(artifactBuffer);
const verifierSha = sha256(fs.readFileSync(SCRIPT_PATH));
const html = artifactBuffer.toString("utf8");

async function testH1() {
  must(html.includes("</html>"), "H1 closing </html> exists", html.slice(-80));
  must(artifactBuffer.length >= 1024, "H1 artifact at least 1024 bytes", artifactBuffer.length);

  const scriptSrc = attributeReferences(html, "script", "src");
  const linkHref = attributeReferences(html, "link", "href");
  const imageSrc = attributeReferences(html, "img", "src");
  const imports = importReferences(html);
  const urls = urlReferences(html);
  const externalGroups = {
    scriptSrc: scriptSrc.filter(isExternalReference),
    linkHref: linkHref.filter(isExternalReference),
    imageSrc: imageSrc.filter(isExternalReference),
    import: imports.filter(isExternalReference),
    url: urls.filter(isExternalReference)
  };
  const externalCount = Object.values(externalGroups).reduce((total, group) => total + group.length, 0);
  mustEqual(externalCount, 0, "H1 external resource references");

  return openPage("H1").then(async ({ context, page, tracker }) => {
    try {
      await page.waitForLoadState("load");
      mustEqual(tracker.pageErrors.length, 0, "H1 pageerror count");
    } finally {
      await context.close();
    }
    return `htmlClose=true,bytes=${artifactBuffer.length},externalRefs=${externalCount} (script=${externalGroups.scriptSrc.length},link=${externalGroups.linkHref.length},img=${externalGroups.imageSrc.length},import=${externalGroups.import.length},url=${externalGroups.url.length}),pageerrors=0`;
  });
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
      const { page } = handle;
      await computeCase(page, "+", ["12", "30", "8"]);
      await expectState(page, "result", `H2 ${configuration.label}: first result state`);
      await computeCase(page, "*", ["2", "3", "4"]);
      await expectState(page, "result", `H2 ${configuration.label}: second result state`);
      mustEqual(await historyCount(page), 2, `H2 ${configuration.label}: two history records`);

      const resultMetrics = await measureLayout(page);
      assertLayoutMetrics(resultMetrics, `H2 ${configuration.label}: result`);
      evidence.push(layoutEvidence(configuration.label, "result", resultMetrics));

      const olderRecord = page.locator(S.historyItem).nth(1);
      mustEqual(await olderRecord.count(), 1, `H2 ${configuration.label}: older history record exists`);
      await olderRecord.locator(S.historyEdit).click();
      await expectState(page, "edit", `H2 ${configuration.label}: edit state`);

      const editMetrics = await measureLayout(page);
      assertLayoutMetrics(editMetrics, `H2 ${configuration.label}: edit`);
      evidence.push(layoutEvidence(configuration.label, "edit", editMetrics));
    } finally {
      await handle.context.close();
    }
  }

  return evidence.join(" | ");
}

async function testH3() {
  const handle = await openPage("H3");
  try {
    const { page } = handle;
    await computeCase(page, "+", ["12", "30", "8"]);
    await expectState(page, "result", "H3 first calculation state");
    must(await page.locator(S.picker).isVisible(), "H3 op-picker visible in result state", false);
    await assertOpsClickable(page, "H3 result state");
    mustEqual(await historyCount(page), 1, "H3 first history count");
    const beforeSwitch = await historySnapshots(page);
    mustEqual(beforeSwitch.length, 1, "H3 one snapshot before operator switch");

    await clickOp(page, "*");
    await expectState(page, "input", "H3 result-to-input transition");
    const calcInput = page.locator(S.calcInput);
    must(!(await calcInput.isDisabled()), "H3 calc-input enabled after operator switch", true);
    await expectCalcFocused(page, "H3 after operator switch");
    await expectExpressionEmpty(page, "H3 after operator switch");
    await expectResultEmpty(page, "H3 after operator switch");
    mustEqual(await historyCount(page), 1, "H3 history count after operator switch");
    const afterSwitch = await historySnapshots(page);
    mustDeep(afterSwitch, beforeSwitch, "H3 existing history unchanged by operator switch");

    for (const value of ["2", "3", "4"]) {
      await enterNumber(page, value);
    }
    await clickEquals(page);
    await expectState(page, "result", "H3 second result state");
    mustNear(parseValue((await resultInfo(page)).value, "H3 result"), 24, "H3 second result");
    mustEqual(await historyCount(page), 2, "H3 second history count");
    const finalHistory = await historySnapshots(page);
    mustEqual(finalHistory[0].operator, "*", "H3 item 0 operator");
    return `firstResult=50,switchState=input,focused=true,historyAfterSwitch=1,secondResult=24,history=2,item0=${finalHistory[0].operator}`;
  } finally {
    await handle.context.close();
  }
}

async function testH4() {
  const handle = await openPage("H4");
  try {
    const { page, tracker } = handle;
    await computeCase(page, "/", ["5", "0"]);
    await expectState(page, "error", "H4 division-by-zero state");
    const errorResult = await resultInfo(page);
    mustEqual(errorResult.error, "true", "H4 result data-error");
    mustEqual(await historyCount(page), 0, "H4 history after division by zero");
    must(await page.locator(S.picker).isVisible(), "H4 op-picker visible in error state", false);

    await clickOp(page, "+");
    await expectState(page, "input", "H4 error-to-input transition");
    const calcInput = page.locator(S.calcInput);
    must(!(await calcInput.isDisabled()), "H4 calc-input enabled after error recovery", true);
    await expectCalcFocused(page, "H4 after error recovery");
    await expectExpressionEmpty(page, "H4 after error recovery");
    await expectResultEmpty(page, "H4 after error recovery");

    await enterNumber(page, "1");
    await enterNumber(page, "2");
    await clickEquals(page);
    mustNear(parseValue((await resultInfo(page)).value, "H4 recovery result"), 3, "H4 recovery result");
    mustEqual(await historyCount(page), 1, "H4 history after recovery");
    assertNoPageErrors(tracker, "H4 pageerror count");
    return "errorState=true,dataError=true,historyAtError=0,pickerAtError=true,recoveredState=input,focused=true,result=3,history=1,pageerrors=0";
  } finally {
    await handle.context.close();
  }
}

async function testH5() {
  const evidence = [];
  const initialHandle = await openPage("H5", {}, "initial");
  try {
    const { page } = initialHandle;
    must(await page.locator(S.picker).isVisible(), "H5 initial op-picker visible", false);
    const operators = await page.locator(`${S.picker} button[data-op]`).evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("data-op"))
    );
    mustEqual(operators.length, 4, "H5 op-picker button count");
    mustDeep([...operators].sort(), [...OPERATORS].sort(), "H5 op-picker value set");
    const calcInput = page.locator(S.calcInput);
    mustEqual(await calcInput.isDisabled(), true, "H5 initial calc-input disabled");
    await expectExpressionEmpty(page, "H5 initial");
    await expectResultEmpty(page, "H5 initial");

    await clickOp(page, "+");
    await expectState(page, "input", "H5 operator selection state");
    mustEqual(await calcInput.isDisabled(), false, "H5 calc-input enabled after operator selection");
    await expectCalcFocused(page, "H5 after operator selection");

    await enterNumber(page, "12");
    await enterNumber(page, "30");
    mustEqual(await calcInput.inputValue(), "", "H5 calc-input empty after committed operands");
    const beforeEight = await expressionText(page);
    for (const value of ["12", "30", "+"]) {
      must(beforeEight.includes(value), `H5 expression contains ${value}`, beforeEight);
    }

    await calcInput.fill("8");
    const uncommittedExpression = await expressionText(page);
    must(!uncommittedExpression.includes("8"), "H5 uncommitted 8 absent from expression", uncommittedExpression);
    await page.keyboard.press("=");
    const keyboardExpression = await expressionText(page);
    must(keyboardExpression.includes("8"), "H5 keyboard = commits 8 into expression", keyboardExpression);
    mustNear(parseValue((await resultInfo(page)).value, "H5 keyboard result"), 50, "H5 keyboard = result");
    evidence.push("initialOps=4,disabled=true,focus=true,keyboardResult=50");
  } finally {
    await initialHandle.context.close();
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
      const { page } = handle;
      await computeCase(page, testCase.operator, testCase.values);
      await expectState(page, "result", `H5 ${testCase.operator} case state`);
      const resultValue = parseValue((await resultInfo(page)).value, `H5 ${testCase.operator} case result`);
      mustNear(resultValue, testCase.expected, `H5 ${testCase.operator} case result`);
      assertExpressionContent(await expressionText(page), testCase.operator, testCase.values, `H5 ${testCase.operator} case`);
      evidence.push(`${testCase.operator}${testCase.values.join("/")}=${resultValue}`);
    } finally {
      await handle.context.close();
    }
  }

  return evidence.join(" | ");
}

async function testH6() {
  const handle = await openPage("H6");
  try {
    const { page } = handle;
    const cases = [
      { operator: "+", values: ["12", "30", "8"], expected: 50 },
      { operator: "-", values: ["10", "4", "3"], expected: 3 },
      { operator: "*", values: ["2", "3", "4"], expected: 24 },
      { operator: "+", values: ["1.5", "2.25"], expected: 3.75 }
    ];

    for (let index = 0; index < cases.length; index += 1) {
      const testCase = cases[index];
      await clickOp(page, testCase.operator);
      for (const value of testCase.values) {
        await enterNumber(page, value);
      }
      const beforeCount = await historyCount(page);
      await clickEquals(page);
      const afterCount = await historyCount(page);
      mustEqual(afterCount, beforeCount + 1, `H6 history increment for ${testCase.operator} ${testCase.values.join("/")}`);
      mustEqual(afterCount, index + 1, `H6 exact history total after record ${index + 1}`);

      const snapshots = await historySnapshots(page);
      assertHistoryRecord(snapshots[0], testCase.operator, testCase.values, testCase.expected, `H6 latest record ${index + 1}`);
      must(await page.locator(S.historyItem).nth(0).locator(S.historyEdit).isVisible(), `H6 latest record ${index + 1}: history-edit visible`, false);
    }

    const finalSnapshots = await historySnapshots(page);
    mustEqual(finalSnapshots.length, 4, "H6 final history length");
    const expectedOrder = [...cases].reverse();
    for (let index = 0; index < expectedOrder.length; index += 1) {
      const testCase = expectedOrder[index];
      assertHistoryRecord(finalSnapshots[index], testCase.operator, testCase.values, testCase.expected, `H6 final DOM index ${index}`);
      must(await page.locator(S.historyItem).nth(index).locator(S.historyEdit).isVisible(), `H6 final DOM index ${index}: history-edit visible`, false);
    }

    await clickOp(page, "+");
    const countBeforeEmpty = await historyCount(page);
    await page.locator(S.calcInput).press("Enter");
    mustEqual(await historyCount(page), countBeforeEmpty, "H6 empty Enter does not add history");

    await page.locator(S.keyOp).click();
    await expectState(page, "select", "H6 key-op state before division test");
    await clickOp(page, "/");
    await enterNumber(page, "5");
    await enterNumber(page, "0");
    const countBeforeDivision = await historyCount(page);
    await clickEquals(page);
    await expectState(page, "error", "H6 division-by-zero state");
    mustEqual(await historyCount(page), countBeforeDivision, "H6 division by zero does not add history");

    return `records=4,increments=1,top=${finalSnapshots.map((record) => `${record.operator}${JSON.stringify(record.operands)}`).join(" > ")},emptyEnterHistory=${countBeforeEmpty},divisionHistory=${countBeforeDivision}`;
  } finally {
    await handle.context.close();
  }
}

async function testH7() {
  const firstHandle = await openPage("H7", {}, "main");
  try {
    const { page, tracker } = firstHandle;
    await computeCase(page, "+", ["12", "30", "8"]);
    await computeCase(page, "*", ["2", "3", "4"]);
    await expectState(page, "result", "H7 pre-reset state");
    const beforeReset = await historySnapshots(page);
    mustEqual(beforeReset.length, 2, "H7 two history records before reset");

    await page.locator(S.keyOp).click();
    await expectState(page, "select", "H7 key-op resets to select");
    must(await page.locator(S.picker).isVisible(), "H7 op-picker visible after key-op", false);
    mustEqual(await page.locator(S.calcInput).isDisabled(), true, "H7 calc-input disabled after key-op");
    await expectExpressionEmpty(page, "H7 after key-op");
    await expectResultEmpty(page, "H7 after key-op");
    mustEqual(await historyCount(page), 2, "H7 history count after key-op");
    const afterReset = await historySnapshots(page);
    mustDeep(afterReset, beforeReset, "H7 history unchanged by key-op");

    await page.reload({ waitUntil: "load" });
    mustEqual(await historyCount(page), 0, "H7 history count after reload");
    await expectState(page, "select", "H7 state after reload");
    assertNoPageErrors(tracker, "H7 pageerror count through reload");
  } finally {
    await firstHandle.context.close();
  }

  const freshHandle = await openPage("H7", {}, "fresh-context");
  try {
    mustEqual(await historyCount(freshHandle.page), 0, "H7 fresh browser context history count");
    await expectState(freshHandle.page, "select", "H7 fresh browser context state");
    assertNoPageErrors(freshHandle.tracker, "H7 fresh context pageerror count");
  } finally {
    await freshHandle.context.close();
  }

  return "resetState=select,disabled=true,historyAfterReset=2,historyAfterReload=0,freshContextHistory=0,pageerrors=0";
}

async function testH8() {
  const handle = await openPage("H8");
  try {
    const { page } = handle;
    await computeCase(page, "+", ["12", "30", "8"]);
    await computeCase(page, "*", ["2", "3", "4"]);
    await expectState(page, "result", "H8 pre-edit state");
    const original = await historySnapshots(page);
    mustEqual(original.length, 2, "H8 original history length");

    const sourceRecord = page.locator(S.historyItem).nth(1);
    mustEqual(await sourceRecord.getAttribute("data-operator"), "+", "H8 older source operator");
    await sourceRecord.locator(S.historyEdit).click();
    await expectState(page, "edit", "H8 edit state");
    const editDraft = page.locator(S.editDraft);
    must(await editDraft.isVisible(), "H8 edit-draft visible", false);
    mustEqual(await editDraft.getAttribute("data-operator"), "+", "H8 edit-draft operator");

    const operandInputs = page.locator(S.operandInput);
    mustEqual(await operandInputs.count(), 3, "H8 operand-input count");
    mustDeep(await operandInputValues(page), ["12", "30", "8"], "H8 initial operand-input values");
    const inputFlags = await operandInputs.evaluateAll((elements) =>
      elements.map((element) => ({ disabled: element.disabled, readOnly: element.readOnly }))
    );
    must(inputFlags.every((flags) => flags.disabled === false && flags.readOnly === false), "H8 operand inputs enabled and editable", inputFlags);

    await operandInputs.nth(1).fill("5");
    const editedExpression = await expressionText(page);
    must(editedExpression.includes("5"), "H8 expression contains new middle value", editedExpression);
    must(!editedExpression.includes("30"), "H8 expression excludes replaced value", editedExpression);

    await clickEquals(page);
    await expectState(page, "result", "H8 post-edit state");
    must(await page.locator(S.editDraft).isVisible() === false, "H8 edit-draft hidden after calculation", true);
    mustNear(parseValue((await resultInfo(page)).value, "H8 edited result"), 25, "H8 edited result");
    mustEqual(await historyCount(page), 3, "H8 history count after edited calculation");
    const after = await historySnapshots(page);
    assertHistoryRecord(after[0], "+", ["12", "5", "8"], 25, "H8 new top record");
    mustDeep(after.slice(1), original, "H8 original records unchanged and in order");

    return `editState=true,draftOperator=+,operands=12/30/8,editedResult=25,history=3,oldRecordsUnchanged=true`;
  } finally {
    await handle.context.close();
  }
}

async function testH9() {
  const handle = await openPage("H9");
  try {
    const { page } = handle;
    await computeCase(page, "*", ["2", "3", "4"]);
    await computeCase(page, "+", ["1.5", "2.25"]);
    await expectState(page, "result", "H9 pre-edit state");
    const original = await historySnapshots(page);
    mustEqual(original.length, 2, "H9 original history length");

    const sourceRecord = page.locator(S.historyItem).nth(1);
    mustEqual(await sourceRecord.getAttribute("data-operator"), "*", "H9 older source operator");
    await sourceRecord.locator(S.historyEdit).click();
    await expectState(page, "edit", "H9 edit state");

    await clickOp(page, "+");
    await expectState(page, "edit", "H9 remains edit after operator change");
    mustEqual(await page.locator(S.editDraft).getAttribute("data-operator"), "+", "H9 changed draft operator");
    mustDeep(await operandInputValues(page), ["2", "3", "4"], "H9 operands unchanged by operator change");

    const operandInputs = page.locator(S.operandInput);
    await operandInputs.nth(0).fill("10");
    await operandInputs.nth(2).fill("5");
    const changedExpression = await expressionText(page);
    must(changedExpression.includes("10"), "H9 expression contains 10", changedExpression);
    must(changedExpression.includes("5"), "H9 expression contains 5", changedExpression);

    await page.locator(S.operandChip).nth(1).locator(S.operandRemove).click();
    mustDeep(await operandInputValues(page), ["10", "5"], "H9 values after middle chip removal");

    await enterNumber(page, "2");
    mustDeep(await operandInputValues(page), ["10", "5", "2"], "H9 values after appending 2");
    await clickEquals(page);
    await expectState(page, "result", "H9 post-edit state");
    mustNear(parseValue((await resultInfo(page)).value, "H9 edited result"), 17, "H9 edited result");
    mustEqual(await historyCount(page), 3, "H9 history count after edited calculation");

    const after = await historySnapshots(page);
    assertHistoryRecord(after[0], "+", ["10", "5", "2"], 17, "H9 new top record");
    mustDeep(after.slice(1), original, "H9 original records unchanged and in order");

    return `operatorChanged=+,valuesAfterChange=2/3/4,valuesAfterRemove=10/5,valuesAfterAppend=10/5/2,result=17,history=3,oldRecordsUnchanged=true`;
  } finally {
    await handle.context.close();
  }
}

async function testH10() {
  const handle = await openPage("H10");
  try {
    const { page, tracker } = handle;
    await computeCase(page, "+", ["12", "30", "8"]);
    const original = await historySnapshots(page);
    mustEqual(original.length, 1, "H10 original history length");

    await page.locator(S.historyItem).nth(0).locator(S.historyEdit).click();
    await expectState(page, "edit", "H10 edit state");
    const middleInput = page.locator(S.operandInput).nth(1);

    await middleInput.fill("");
    await clickEquals(page);
    mustEqual(await historyCount(page), 1, "H10 history unchanged after empty operand");
    mustEqual((await resultInfo(page)).value, null, "H10 empty operand leaves no result data-value");
    assertNoPageErrors(tracker, "H10 pageerror count after empty operand");

    await middleInput.fill("abc");
    await clickEquals(page);
    mustEqual(await historyCount(page), 1, "H10 history unchanged after non-finite operand");
    mustEqual((await resultInfo(page)).value, null, "H10 non-finite operand leaves no result data-value");
    assertNoPageErrors(tracker, "H10 pageerror count after non-finite operand");

    await middleInput.fill("5");
    await clickEquals(page);
    await expectState(page, "result", "H10 valid edited calculation state");
    mustNear(parseValue((await resultInfo(page)).value, "H10 edited result"), 25, "H10 edited result");
    mustEqual(await historyCount(page), 2, "H10 history after valid edited calculation");
    const after = await historySnapshots(page);
    assertHistoryRecord(after[0], "+", ["12", "5", "8"], 25, "H10 new top record");
    mustDeep(after.slice(1), original, "H10 source record unchanged");
    assertNoPageErrors(tracker, "H10 pageerror count final");

    return "emptyNoOp=true,nonFiniteNoOp=true,result=25,history=2,operands=12/5/8,pageerrors=0";
  } finally {
    await handle.context.close();
  }
}

async function testH11() {
  const handle = await openPage("H11");
  try {
    const { page, tracker } = handle;
    await computeCase(page, "/", ["100", "5", "2"]);
    const original = await historySnapshots(page);
    mustEqual(original.length, 1, "H11 original history length");

    await page.locator(S.historyItem).nth(0).locator(S.historyEdit).click();
    await expectState(page, "edit", "H11 edit state");
    await page.locator(S.operandInput).nth(1).fill("0");
    await clickEquals(page);
    await expectState(page, "error", "H11 edited division-by-zero state");
    const errorResult = await resultInfo(page);
    mustEqual(errorResult.error, "true", "H11 result data-error");
    mustEqual(await historyCount(page), 1, "H11 history unchanged after edited division by zero");
    mustDeep(await historySnapshots(page), original, "H11 original record unchanged after division by zero");
    assertNoPageErrors(tracker, "H11 pageerror count after division by zero");
    must(await page.locator(S.picker).isVisible(), "H11 op-picker visible in error state", false);

    await clickOp(page, "+");
    await expectState(page, "input", "H11 recovery input state");
    mustEqual(await page.locator(S.calcInput).isDisabled(), false, "H11 calc-input enabled after recovery");
    await expectCalcFocused(page, "H11 after recovery");
    await expectExpressionEmpty(page, "H11 after recovery");
    await expectResultEmpty(page, "H11 after recovery");

    await enterNumber(page, "1");
    await enterNumber(page, "2");
    await clickEquals(page);
    mustNear(parseValue((await resultInfo(page)).value, "H11 recovery result"), 3, "H11 recovery result");
    mustEqual(await historyCount(page), 2, "H11 history after recovery");
    mustDeep((await historySnapshots(page)).slice(1), original, "H11 original record unchanged after recovery");
    assertNoPageErrors(tracker, "H11 pageerror count final");

    return "editDivZeroError=true,historyAtError=1,sourceUnchanged=true,pickerAtError=true,recoveryResult=3,history=2,pageerrors=0";
  } finally {
    await handle.context.close();
  }
}

async function runDeterminismSequence(runLabel) {
  const handle = await openPage("H12", {}, runLabel);
  try {
    const { page } = handle;
    await computeCase(page, "+", ["12", "30", "8"]);
    await computeCase(page, "*", ["2", "3", "4"]);
    await expectState(page, "result", `H12 ${runLabel}: two-calculation state`);
    mustEqual(await historyCount(page), 2, `H12 ${runLabel}: two calculations before edit`);

    const sourceRecord = page.locator(S.historyItem).nth(1);
    mustEqual(await sourceRecord.getAttribute("data-operator"), "+", `H12 ${runLabel}: older source is +`);
    await sourceRecord.locator(S.historyEdit).click();
    await expectState(page, "edit", `H12 ${runLabel}: edit state`);
    await page.locator(S.operandInput).nth(1).fill("5");
    await clickEquals(page);
    await expectState(page, "result", `H12 ${runLabel}: post-edit state`);
    mustEqual(await historyCount(page), 3, `H12 ${runLabel}: three records after recompute`);

    const snapshots = await historySnapshots(page);
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
  const priorStats = collectTrackerStats(["H3", "H4", "H5", "H6", "H7", "H8", "H9", "H10", "H11"]);
  mustEqual(priorStats.pageErrors, 0, "H12 pageerror count across H3-H11", priorStats.trackers.flatMap((tracker) => tracker.pageErrors));
  mustEqual(priorStats.consoleErrors, 0, "H12 console error count across H3-H11", priorStats.trackers.flatMap((tracker) => tracker.consoleErrors));

  const firstHistory = await runDeterminismSequence("run1");
  const secondHistory = await runDeterminismSequence("run2");
  const determinismStats = collectTrackerStats(["H12"]);
  mustEqual(determinismStats.pageErrors, 0, "H12 pageerror count across determinism runs", determinismStats.trackers.flatMap((tracker) => tracker.pageErrors));
  mustEqual(determinismStats.consoleErrors, 0, "H12 console error count across determinism runs", determinismStats.trackers.flatMap((tracker) => tracker.consoleErrors));
  mustEqual(firstHistory.length, 3, "H12 first run history length");
  mustEqual(secondHistory.length, 3, "H12 second run history length");
  mustDeep(firstHistory, secondHistory, "H12 serialized history deep equality");

  return `H3-H11pages=${priorStats.pages},pageerrors=${priorStats.pageErrors},consoleErrors=${priorStats.consoleErrors},runs=2,records=${firstHistory.length},historyEqual=true,runPageerrors=${determinismStats.pageErrors},runConsoleErrors=${determinismStats.consoleErrors}`;
}

async function main() {
  must(/^\d+$/.test(ROUND), "round argument must be numeric", RAW_ROUND);
  must(fs.existsSync(ARTIFACT_PATH), "artifact exists", ARTIFACT_PATH);

  browser = await withTimeout(playwright.chromium.launch({ headless: true }), 60000, "chromium launch");

  const tests = [
    ["H1", testH1],
    ["H2", testH2],
    ["H3", testH3],
    ["H4", testH4],
    ["H5", testH5],
    ["H6", testH6],
    ["H7", testH7],
    ["H8", testH8],
    ["H9", testH9],
    ["H10", testH10],
    ["H11", testH11],
    ["H12", testH12]
  ];
  const results = [];

  for (const [testId, testFunction] of tests) {
    const started = Date.now();
    try {
      const evidence = await withTimeout(testFunction(), 180000, testId);
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
  if (browser) {
    await browser.close().catch(() => {});
  }
  console.error(`VERIFIER PRECONDITION/CRASH: ${error?.stack ?? error}`);
  process.exitCode = 2;
});
