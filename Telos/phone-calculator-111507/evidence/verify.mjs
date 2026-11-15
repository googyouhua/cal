#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const DEFAULT_ARTIFACT = "/ws/cal_phone/index.html";
const STEP_TIMEOUT_MS = 15_000;
const NAV_TIMEOUT_MS = 20_000;
const BROWSER_TIMEOUT_MS = 30_000;

const SELECTORS = Object.freeze({
  picker: '[data-testid="op-picker"]',
  input: 'input[data-testid="calc-input"]',
  expression: '[data-testid="expression"]',
  result: '[data-testid="result"]',
  equals: 'button[data-testid="key-equals"]',
  keyOp: 'button[data-testid="key-op"]',
});

function resolveFromScript(value) {
  return path.isAbsolute(value) ? value : path.resolve(SCRIPT_DIR, value);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function oneLine(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function fmt(value) {
  if (typeof value === "string") {
    const text = value.length > 240 ? `${value.slice(0, 237)}...` : value;
    return JSON.stringify(text);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return String(value);
  }
  if (value === undefined) {
    return "undefined";
  }
  try {
    return JSON.stringify(value, (_key, item) =>
      typeof item === "number" && !Number.isFinite(item) ? String(item) : item,
    );
  } catch {
    return JSON.stringify(String(value));
  }
}

function makeSuite() {
  const entries = [];
  const failures = [];

  return {
    note(key, value) {
      entries.push(`${key}=${fmt(value)}`);
    },
    check(ok, key, value) {
      entries.push(`${key}=${fmt(value)}`);
      if (!ok) {
        failures.push(key);
      }
      return Boolean(ok);
    },
    finish() {
      const evidence = entries.join("; ");
      if (failures.length > 0) {
        throw new Error(`failed_checks=[${failures.join(",")}]; ${evidence}`);
      }
      return evidence;
    },
  };
}

const roundRaw = process.argv[2] ?? process.env.KEKKAI_ROUND ?? "1";
const round = String(roundRaw);
if (!/^\d+$/.test(round)) {
  console.error(`PRECONDITION: invalid round argument: ${JSON.stringify(roundRaw)}`);
  process.exit(3);
}

const artifactPath = resolveFromScript(process.env.KEKKAI_ARTIFACT || DEFAULT_ARTIFACT);
const outDir = process.env.KEKKAI_OUT_DIR
  ? resolveFromScript(process.env.KEKKAI_OUT_DIR)
  : path.join(SCRIPT_DIR, "attempts", `manual-r${round}-${Date.now()}`);
const hardPath = path.join(outDir, `hard-r${round}.txt`);

if (!fs.existsSync(artifactPath)) {
  console.error(`PRECONDITION: artifact does not exist: ${artifactPath}`);
  process.exit(3);
}

const artifactSnapshot = fs.readFileSync(artifactPath);
const artifactSha256 = sha256(artifactSnapshot);
const verifierSha256 = sha256(fs.readFileSync(SCRIPT_PATH));
const artifactUrl = pathToFileURL(artifactPath).href;

let chromium;
try {
  const require = createRequire(SCRIPT_PATH);
  ({ chromium } = require("playwright"));
} catch (error) {
  console.error(`PRECONDITION: Playwright is unavailable: ${error.message}`);
  process.exit(3);
}

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    timeout: BROWSER_TIMEOUT_MS,
  });
} catch (error) {
  console.error(`PRECONDITION: Playwright Chromium is unavailable: ${error.message}`);
  process.exit(3);
}

const observed = {
  pageErrors: [],
  consoleErrors: [],
};

async function openPage(label, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    ...options,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

  const local = {
    pageErrors: [],
    consoleErrors: [],
  };

  page.on("pageerror", (error) => {
    const item = { label, message: oneLine(error?.message || String(error)) };
    local.pageErrors.push(item);
    observed.pageErrors.push(item);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      const item = { label, message: oneLine(message.text()) };
      local.consoleErrors.push(item);
      observed.consoleErrors.push(item);
    }
  });

  await page.goto(artifactUrl, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
  return { context, page, local };
}

async function withPage(label, options, callback) {
  const { context, page, local } = await openPage(label, options);
  try {
    return await callback(page, local);
  } finally {
    await context.close();
  }
}

async function readUi(page) {
  return page.evaluate((selectors) => {
    const picker = document.querySelector(selectors.picker);
    const input = document.querySelector(selectors.input);
    const expression = document.querySelector(selectors.expression);
    const result = document.querySelector(selectors.result);
    const missing = [
      [selectors.picker, picker],
      [selectors.input, input],
      [selectors.expression, expression],
      [selectors.result, result],
    ]
      .filter(([, element]) => !element)
      .map(([selector]) => selector);
    if (missing.length > 0) {
      throw new Error(`missing required elements: ${missing.join(", ")}`);
    }

    const elementVisible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    const active = document.activeElement;
    return {
      pickerVisible: elementVisible(picker),
      inputDisabled: input.disabled,
      inputValue: input.value,
      expressionText: expression.textContent,
      expressionTrim: expression.textContent.trim(),
      resultText: result.textContent,
      resultTrim: result.textContent.trim(),
      resultValue: result.getAttribute("data-value"),
      resultError: result.getAttribute("data-error"),
      resultHasValue: result.hasAttribute("data-value"),
      resultHasError: result.hasAttribute("data-error"),
      activeIsInput: active === input,
      focusedTag: active?.tagName ?? null,
      focusedTestId: active?.getAttribute?.("data-testid") ?? null,
    };
  }, SELECTORS);
}

async function chooseOperator(page, operator) {
  await page.locator(`[data-op="${operator}"]`).click();
}

async function typeAndCommit(page, value) {
  await page.keyboard.type(String(value));
  await page.keyboard.press("Enter");
}

async function calculateOnPage(page, operator, values, finishWith = "click") {
  await chooseOperator(page, operator);
  for (const value of values) {
    await typeAndCommit(page, value);
  }
  if (finishWith === "keyboard-equals") {
    await page.keyboard.press("=");
  } else {
    await page.locator(SELECTORS.equals).click();
  }
  return readUi(page);
}

function scanResourceReferences(html) {
  const references = [];
  const add = (kind, rawUrl) => {
    references.push({ kind, url: String(rawUrl ?? "").trim() });
  };

  const tagSpecs = [
    {
      kind: "script-src",
      regex: /<script\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi,
    },
    {
      kind: "link-href",
      regex: /<link\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi,
    },
    {
      kind: "img-src",
      regex: /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi,
    },
  ];

  for (const spec of tagSpecs) {
    for (const match of html.matchAll(spec.regex)) {
      add(spec.kind, match[1] ?? match[2] ?? match[3]);
    }
  }

  const importRegex = /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^)\s;]+))\s*\)?/gi;
  for (const match of html.matchAll(importRegex)) {
    add("css-import", match[1] ?? match[2] ?? match[3]);
  }

  const urlRegex = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
  for (const match of html.matchAll(urlRegex)) {
    add("css-url", match[1] ?? match[2] ?? match[3]);
  }

  const external = references.filter((entry) => /^(?:https?:)?\/\//i.test(entry.url));
  return { scanned: references.length, external };
}

function checkNear(suite, actual, expected, key) {
  const finite = Number.isFinite(actual);
  const delta = finite ? Math.abs(actual - expected) : null;
  suite.check(
    finite && delta <= 1e-9,
    key,
    { raw: actual, expected, delta },
  );
}

async function measureLayout(page) {
  return page.evaluate((selectors) => {
    const input = document.querySelector(selectors.input);
    if (!input) {
      throw new Error(`missing input: ${selectors.input}`);
    }

    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    const controls = [...document.querySelectorAll("input, button, [data-op]")]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          testId: element.getAttribute("data-testid"),
          op: element.getAttribute("data-op"),
          width: rect.width,
          height: rect.height,
        };
      });

    const html = document.documentElement;
    const body = document.body;
    return {
      documentScrollWidth: html.scrollWidth,
      documentClientWidth: html.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      bodyClientWidth: body.clientWidth,
      inputFontSize: Number.parseFloat(getComputedStyle(input).fontSize),
      controls,
    };
  }, SELECTORS);
}

function controlLabel(control) {
  if (control.testId) {
    return `${control.tag}[data-testid=${control.testId}]`;
  }
  if (control.op) {
    return `${control.tag}[data-op=${control.op}]`;
  }
  return control.tag;
}

function rounded(value) {
  return Math.round(value * 100) / 100;
}

function summarizeLayout(layout) {
  return {
    document: [
      layout.documentScrollWidth,
      layout.documentClientWidth,
    ],
    body: [layout.bodyScrollWidth, layout.bodyClientWidth],
    inputFontSize: layout.inputFontSize,
    controls: layout.controls.map(
      (control) => `${controlLabel(control)}=${rounded(control.width)}x${rounded(control.height)}`,
    ),
  };
}

function checkLayout(suite, label, layout) {
  suite.check(
    layout.documentScrollWidth <= layout.documentClientWidth,
    `${label}.documentNoHorizontalOverflow`,
    [layout.documentScrollWidth, layout.documentClientWidth],
  );
  suite.check(
    layout.bodyScrollWidth <= layout.bodyClientWidth,
    `${label}.bodyNoHorizontalOverflow`,
    [layout.bodyScrollWidth, layout.bodyClientWidth],
  );
  suite.check(
    layout.controls.length > 0,
    `${label}.visibleControlCount`,
    layout.controls.length,
  );

  for (const control of layout.controls) {
    const name = controlLabel(control);
    suite.check(
      control.width + 0.5 >= 44,
      `${label}.${name}.widthAtLeast44`,
      rounded(control.width),
    );
    suite.check(
      control.height + 0.5 >= 44,
      `${label}.${name}.heightAtLeast44`,
      rounded(control.height),
    );
  }

  suite.check(
    layout.inputFontSize >= 16,
    `${label}.calcInputFontSizeAtLeast16`,
    layout.inputFontSize,
  );
}

async function testH1() {
  const suite = makeSuite();
  const bytes = fs.readFileSync(artifactPath);
  const html = bytes.toString("utf8");
  const scan = scanResourceReferences(html);

  suite.check(html.includes("</html>"), "closingHtmlPresent", html.includes("</html>"));
  suite.check(Buffer.byteLength(bytes) >= 1024, "artifactBytesAtLeast1024", Buffer.byteLength(bytes));
  suite.note("resourceScan", {
    scope: "artifact-only",
    scanned: scan.scanned,
    external: scan.external.length,
  });
  suite.check(
    scan.external.length === 0,
    "externalHttpOrProtocolRelativeReferences",
    scan.external,
  );

  await withPage("H1-file-load", {}, async (page, local) => {
    suite.check(page.url() === artifactUrl, "loadedDirectlyFromFileUrl", page.url());
    suite.check(local.pageErrors.length === 0, "fileLoad.pageerrorCount", local.pageErrors);
  });

  return suite.finish();
}

async function testH2() {
  const suite = makeSuite();
  const viewports = [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
  ];

  for (const viewport of viewports) {
    const label = `${viewport.width}x${viewport.height}`;
    await withPage(
      `H2-${label}`,
      { viewport, isMobile: true, hasTouch: true },
      async (page) => {
        suite.note(`${label}.context`, {
          isMobile: true,
          hasTouch: true,
          viewport: page.viewportSize(),
          maxTouchPoints: await page.evaluate(() => navigator.maxTouchPoints),
        });
        const selectLayout = await measureLayout(page);
        suite.note(`${label}.select`, summarizeLayout(selectLayout));
        checkLayout(suite, `${label}.select`, selectLayout);

        await chooseOperator(page, "+");
        const inputLayout = await measureLayout(page);
        suite.note(`${label}.input`, summarizeLayout(inputLayout));
        checkLayout(suite, `${label}.input`, inputLayout);
      },
    );
  }

  return suite.finish();
}

async function testH3() {
  const suite = makeSuite();

  await withPage("H3", {}, async (page) => {
    const opInfo = await page.evaluate((selectors) => {
      const picker = document.querySelector(selectors.picker);
      if (!picker) {
        throw new Error(`missing picker: ${selectors.picker}`);
      }
      const pickerButtons = [...picker.querySelectorAll("button")];
      const pickerOps = [...picker.querySelectorAll("[data-op]")];
      const allOps = [...document.querySelectorAll("[data-op]")];
      return {
        pickerButtonCount: pickerButtons.length,
        pickerOpCount: pickerOps.length,
        allOpCount: allOps.length,
        values: allOps.map((element) => element.getAttribute("data-op")),
      };
    }, SELECTORS);

    const values = opInfo.values;
    const valueSet = new Set(values);
    const expectedValues = ["+", "-", "*", "/"];
    suite.check(opInfo.pickerButtonCount === 4, "picker.buttonCount", opInfo.pickerButtonCount);
    suite.check(opInfo.pickerOpCount === 4, "picker.dataOpCount", opInfo.pickerOpCount);
    suite.check(opInfo.allOpCount === 4, "global.dataOpCount", opInfo.allOpCount);
    suite.check(
      values.length === 4 &&
        valueSet.size === 4 &&
        expectedValues.every((value) => valueSet.has(value)),
      "dataOpValuesExactlyRequiredSet",
      values.slice().sort(),
    );

    const select = await readUi(page);
    suite.check(select.pickerVisible, "select.pickerVisible", select.pickerVisible);
    suite.check(select.inputDisabled === true, "select.inputDisabled", select.inputDisabled);
    suite.check(select.inputValue === "", "select.inputValue", select.inputValue);
    suite.check(select.expressionTrim === "", "select.expressionEmpty", select.expressionTrim);
    suite.check(select.resultTrim === "", "select.resultEmpty", select.resultTrim);

    await page.keyboard.type("12");
    await page.keyboard.press("Enter");
    const afterBlockedTyping = await readUi(page);
    suite.check(
      afterBlockedTyping.expressionTrim === "",
      "select.typing12Enter.expressionStillEmpty",
      afterBlockedTyping.expressionTrim,
    );

    await chooseOperator(page, "+");
    const inputState = await readUi(page);
    suite.check(inputState.inputDisabled === false, "input.inputDisabled", inputState.inputDisabled);
    suite.check(inputState.activeIsInput, "input.activeElementIsCalcInput", {
      activeIsInput: inputState.activeIsInput,
      focusedTag: inputState.focusedTag,
      focusedTestId: inputState.focusedTestId,
    });
    suite.check(inputState.expressionTrim === "", "input.expressionEmpty", inputState.expressionTrim);
    suite.check(inputState.resultTrim === "", "input.resultEmpty", inputState.resultTrim);
  });

  return suite.finish();
}

async function testH4() {
  const suite = makeSuite();

  await withPage("H4-keyboard-equals", {}, async (page) => {
    await chooseOperator(page, "+");
    await typeAndCommit(page, 12);
    await typeAndCommit(page, 30);
    const committed = await readUi(page);
    suite.check(committed.inputValue === "", "afterTwoCommits.inputValueEmpty", committed.inputValue);
    suite.check(committed.expressionText.includes("12"), "afterTwoCommits.expressionHas12", committed.expressionText);
    suite.check(committed.expressionText.includes("30"), "afterTwoCommits.expressionHas30", committed.expressionText);
    suite.check(committed.expressionText.includes("+"), "afterTwoCommits.expressionHasPlus", committed.expressionText);

    await page.keyboard.type("8");
    const pending = await readUi(page);
    suite.check(pending.inputValue === "8", "beforeEquals.inputValue", pending.inputValue);
    suite.check(
      !pending.expressionText.includes("8"),
      "beforeEquals.expressionExcludesUncommitted8",
      pending.expressionText,
    );

    await page.keyboard.press("=");
    const calculated = await readUi(page);
    const numericResult = calculated.resultValue === null
      ? Number.NaN
      : Number.parseFloat(calculated.resultValue);
    suite.check(calculated.expressionText.includes("8"), "keyboardEquals.expressionHas8", calculated.expressionText);
    checkNear(suite, numericResult, 50, "keyboardEquals.resultNear50");
    suite.note("keyboardEquals.rawResult", calculated.resultValue);
  });

  await withPage("H4-click-equals", {}, async (page) => {
    const calculated = await calculateOnPage(page, "*", [2, 3, 4], "click");
    const numericResult = calculated.resultValue === null
      ? Number.NaN
      : Number.parseFloat(calculated.resultValue);
    checkNear(suite, numericResult, 24, "clickEquals.productNear24");
    suite.note("clickEquals.expression", calculated.expressionText);
  });

  return suite.finish();
}

async function testH5() {
  const suite = makeSuite();
  const cases = [
    { operator: "+", values: [12, 30, 8], expected: 50, glyph: /\+/ },
    { operator: "-", values: [10, 4, 3], expected: 3, glyph: /[-−]/ },
    { operator: "*", values: [2, 3, 4], expected: 24, glyph: /(?:\*|×)/ },
    { operator: "/", values: [100, 5, 2], expected: 10, glyph: /(?:\/|÷)/ },
    { operator: "+", values: [1.5, 2.25], expected: 3.75, glyph: /\+/ },
  ];

  for (const [index, testCase] of cases.entries()) {
    const label = `case${index + 1}${testCase.operator}`;
    const measured = await withPage(`H5-${label}`, {}, async (page) => {
      return calculateOnPage(page, testCase.operator, testCase.values, "click");
    });

    const numericResult = measured.resultValue === null
      ? Number.NaN
      : Number.parseFloat(measured.resultValue);
    checkNear(suite, numericResult, testCase.expected, `${label}.resultNearExpected`);
    suite.note(`${label}.rawResult`, measured.resultValue);
    suite.note(`${label}.expression`, measured.expressionText);

    for (const operand of testCase.values) {
      suite.check(
        measured.expressionText.includes(String(operand)),
        `${label}.expressionHasOperand${operand}`,
        measured.expressionText,
      );
    }
    suite.check(
      testCase.glyph.test(measured.expressionText),
      `${label}.expressionHasAcceptedOperatorGlyph`,
      measured.expressionText,
    );
    suite.check(
      measured.resultError === null,
      `${label}.resultHasNoError`,
      { hasError: measured.resultHasError, dataError: measured.resultError },
    );
  }

  return suite.finish();
}

async function testH6() {
  const suite = makeSuite();

  await withPage("H6-first-reset", {}, async (page) => {
    const firstCalculation = await calculateOnPage(page, "+", [12, 30, 8], "click");
    const firstNumber = firstCalculation.resultValue === null
      ? Number.NaN
      : Number.parseFloat(firstCalculation.resultValue);
    checkNear(suite, firstNumber, 50, "initialPlus.resultNear50");

    await page.locator(SELECTORS.keyOp).click();
    const reset = await readUi(page);
    suite.check(reset.pickerVisible, "afterKeyOp.pickerVisible", reset.pickerVisible);
    suite.check(reset.inputDisabled === true, "afterKeyOp.inputDisabled", reset.inputDisabled);
    suite.check(reset.expressionTrim === "", "afterKeyOp.expressionEmpty", reset.expressionTrim);
    suite.check(reset.resultTrim === "", "afterKeyOp.resultEmpty", reset.resultTrim);
    suite.check(!reset.resultHasValue, "afterKeyOp.resultHasNoDataValue", !reset.resultHasValue);
    suite.check(!reset.resultHasError, "afterKeyOp.resultHasNoDataError", !reset.resultHasError);

    const secondCalculation = await calculateOnPage(page, "*", [2, 3, 4], "click");
    const secondNumber = secondCalculation.resultValue === null
      ? Number.NaN
      : Number.parseFloat(secondCalculation.resultValue);
    checkNear(suite, secondNumber, 24, "afterKeyOp.timesResultNear24");
  });

  await withPage("H6-second-reset", {}, async (page) => {
    await chooseOperator(page, "-");
    await typeAndCommit(page, 10);
    await typeAndCommit(page, 4);
    const pending = await readUi(page);
    suite.check(pending.expressionText.includes("10"), "minusPending.expressionHas10", pending.expressionText);
    suite.check(pending.expressionText.includes("4"), "minusPending.expressionHas4", pending.expressionText);

    await page.locator(SELECTORS.keyOp).click();
    const reset = await readUi(page);
    suite.check(reset.pickerVisible, "minusReset.pickerVisible", reset.pickerVisible);
    suite.check(reset.inputDisabled === true, "minusReset.inputDisabled", reset.inputDisabled);

    const result = await calculateOnPage(page, "+", [1, 2], "click");
    const numericResult = result.resultValue === null
      ? Number.NaN
      : Number.parseFloat(result.resultValue);
    checkNear(suite, numericResult, 3, "minusReset.plusResultNear3");
  });

  return suite.finish();
}

async function testH7() {
  const suite = makeSuite();

  await withPage("H7-empty-enter", {}, async (page) => {
    await chooseOperator(page, "+");
    await page.keyboard.press("Enter");
    const emptySubmit = await readUi(page);
    suite.check(emptySubmit.expressionTrim === "", "emptyEnter.expressionEmpty", emptySubmit.expressionTrim);
    suite.check(emptySubmit.resultTrim === "", "emptyEnter.resultEmpty", emptySubmit.resultTrim);
    suite.check(
      !emptySubmit.resultHasError,
      "emptyEnter.resultHasNoError",
      { hasError: emptySubmit.resultHasError, dataError: emptySubmit.resultError },
    );
  });

  await withPage("H7-divide-zero", {}, async (page, local) => {
    await chooseOperator(page, "/");
    await typeAndCommit(page, 5);
    await typeAndCommit(page, 0);
    await page.locator(SELECTORS.equals).click();
    const errorState = await readUi(page);
    suite.check(
      page.isClosed() === false,
      "divideZero.pageStillOpen",
      { closed: page.isClosed(), stillOpen: !page.isClosed() },
    );
    suite.check(errorState.resultError === "true", "divideZero.resultDataError", errorState.resultError);
    suite.check(errorState.resultTrim !== "", "divideZero.resultTextNonEmpty", errorState.resultText);
    suite.check(local.pageErrors.length === 0, "divideZero.pageerrorCount", local.pageErrors);

    await page.locator(SELECTORS.keyOp).click();
    const reset = await readUi(page);
    suite.check(reset.pickerVisible, "divideZero.afterKeyOpPickerVisible", reset.pickerVisible);
    suite.check(reset.inputDisabled === true, "divideZero.afterKeyOpInputDisabled", reset.inputDisabled);

    const recovered = await calculateOnPage(page, "+", [1, 2], "keyboard-equals");
    const numericResult = recovered.resultValue === null
      ? Number.NaN
      : Number.parseFloat(recovered.resultValue);
    checkNear(suite, numericResult, 3, "divideZero.recoveredResultNear3");
    suite.check(local.pageErrors.length === 0, "divideZero.afterRecoveryPageerrorCount", local.pageErrors);
  });

  return suite.finish();
}

async function testH8() {
  const suite = makeSuite();
  const repeats = [];

  for (const index of [1, 2]) {
    const measured = await withPage(`H8-repeat-${index}`, {}, async (page) => {
      return calculateOnPage(page, "+", [12, 30, 8], "click");
    });
    repeats.push({
      dataValue: measured.resultValue,
      expression: measured.expressionText,
    });
  }

  suite.note("repeatResults", repeats);
  suite.check(
    repeats[0].dataValue === repeats[1].dataValue,
    "repeat.dataValueIdentical",
    [repeats[0].dataValue, repeats[1].dataValue],
  );
  suite.check(
    repeats[0].expression === repeats[1].expression,
    "repeat.expressionIdentical",
    [repeats[0].expression, repeats[1].expression],
  );

  const firstNumber = repeats[0].dataValue === null
    ? Number.NaN
    : Number.parseFloat(repeats[0].dataValue);
  const secondNumber = repeats[1].dataValue === null
    ? Number.NaN
    : Number.parseFloat(repeats[1].dataValue);
  checkNear(suite, firstNumber, 50, "repeat.firstResultNear50");
  checkNear(suite, secondNumber, 50, "repeat.secondResultNear50");
  suite.check(
    observed.pageErrors.length === 0,
    "allInteractions.pageerrorCount",
    observed.pageErrors,
  );
  suite.check(
    observed.consoleErrors.length === 0,
    "allInteractions.consoleErrorCount",
    observed.consoleErrors,
  );

  return suite.finish();
}

async function runH(id, callback) {
  const startedAt = Date.now();
  try {
    const evidence = await callback();
    return {
      id,
      passed: true,
      evidence: `${evidence}; elapsed_ms=${Date.now() - startedAt}`,
    };
  } catch (error) {
    return {
      id,
      passed: false,
      evidence: `error=${fmt(oneLine(error?.message || String(error)))}; elapsed_ms=${Date.now() - startedAt}`,
    };
  }
}

const tests = [
  ["H1", testH1],
  ["H2", testH2],
  ["H3", testH3],
  ["H4", testH4],
  ["H5", testH5],
  ["H6", testH6],
  ["H7", testH7],
  ["H8", testH8],
];

const results = [];
try {
  for (const [id, test] of tests) {
    results.push(await runH(id, test));
  }
} finally {
  await browser.close();
}

const failedIds = results.filter((result) => !result.passed).map((result) => result.id);
const lines = [
  `ROUND: ${round}`,
  `ARTIFACT_SHA256: ${artifactSha256}`,
  `VERIFIER_SHA256: ${verifierSha256}`,
  ...results.map(
    (result) => `${result.id} ${result.passed ? "PASS" : "FAIL"} — ${result.evidence}`,
  ),
  failedIds.length > 0 ? `HARD: FAIL (${failedIds.join(",")})` : "HARD: PASS",
];
const output = `${lines.join("\n")}\n`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(hardPath, output, "utf8");
process.stdout.write(output);
