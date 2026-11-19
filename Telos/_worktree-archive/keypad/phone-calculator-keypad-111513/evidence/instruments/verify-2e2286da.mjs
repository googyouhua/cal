#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const rawRound = process.argv[2] ?? process.env.KEKKAI_ROUND ?? "1";
const round = String(rawRound).trim().replace(/^r/i, "");
if (!/^\d+$/.test(round)) {
  throw new Error(`Invalid round: ${rawRound}`);
}

function scriptRelative(value) {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(scriptDir, value);
}

const artifactPath = scriptRelative(
  process.env.KEKKAI_ARTIFACT ?? path.resolve(scriptDir, "../../../index.html"),
);
const outDir = scriptRelative(process.env.KEKKAI_OUT_DIR ?? path.join(scriptDir, "runs"));
const artifactUrl = pathToFileURL(artifactPath).href;
const outputPath = path.join(outDir, `hard-r${round}.txt`);

fs.mkdirSync(outDir, { recursive: true });

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const artifactSha256 = sha256File(artifactPath);
const verifierSha256 = sha256File(scriptPath);

const SEL = {
  app: "main.app",
  keypad: '[data-testid="keypad"]',
  opPicker: '[data-testid="op-picker"]',
  input: '[data-testid="calc-input"]',
  expression: '[data-testid="expression"]',
  result: '[data-testid="result"]',
  keyOp: '[data-testid="key-op"]',
  keyEquals: '[data-testid="key-equals"]',
  history: '[data-testid="history"]',
  historyItem: '[data-testid="history-item"]',
  historyExpression: '[data-testid="history-expression"]',
  historyResult: '[data-testid="history-result"]',
  historyEdit: '[data-testid="history-edit"]',
  editDraft: '[data-testid="edit-draft"]',
  operandInput: '[data-testid="operand-input"]',
  operandChip: '[data-testid="operand-chip"]',
  operandRemove: '[data-testid="operand-remove"]',
};

const ALL_KEYS = [
  ..."0123456789".split(""),
  ".",
  "backspace",
  "enter",
  "equals",
];
const DIGIT_KEYS = [..."0123456789".split("")];
const OPERATORS = ["+", "-", "*", "/"];

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function compactExpression(value) {
  return String(value ?? "").replace(/\s+/g, "");
}

function stringify(value, limit = 1800) {
  let rendered;
  try {
    rendered = JSON.stringify(value);
  } catch {
    rendered = String(value);
  }
  return rendered.length > limit ? `${rendered.slice(0, limit)}...` : rendered;
}

function check(condition, message, detail = "") {
  if (!condition) {
    throw new Error(detail ? `${message}; ${text(detail)}` : message);
  }
}

function deepEqual(actual, expected, message) {
  check(
    isDeepStrictEqual(actual, expected),
    message,
    `actual=${stringify(actual)} expected=${stringify(expected)}`,
  );
}

function approx(actual, expected, tolerance, message) {
  check(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    message,
    `actual=${actual} expected=${expected} tolerance=${tolerance}`,
  );
}

function numericAttribute(value, message) {
  const parsed = value === null || value === "" ? Number.NaN : Number(value);
  check(Number.isFinite(parsed), message, `attribute=${stringify(value)}`);
  return parsed;
}

function collectionExternalReferences(html) {
  const patterns = [
    /<script\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    /<link\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^\s;)]+))/gi,
    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,
  ];
  const found = [];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const value = text(match[1] ?? match[2] ?? match[3] ?? "");
      if (/^(?:https?:)?\/\//i.test(value)) {
        found.push(value);
      }
    }
  }
  return found;
}

function attachErrorCapture(page, errors) {
  page.on("pageerror", (error) => {
    errors.pageErrors.push(String(error?.stack ?? error));
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.consoleErrors.push(message.text());
    }
  });
}

async function createPage(options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 390, height: 844 },
    isMobile: options.isMobile === true,
    hasTouch: options.hasTouch === true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  const errors = { pageErrors: [], consoleErrors: [] };
  attachErrorCapture(page, errors);
  return { context, page, errors };
}

async function openFresh(options = {}) {
  const opened = await createPage(options);
  try {
    await opened.page.goto(artifactUrl, { waitUntil: "load" });
    await opened.page.locator(SEL.keypad).waitFor({ state: "visible" });
    return opened;
  } catch (error) {
    await opened.context.close();
    throw error;
  }
}

const interactionErrors = { pageErrors: [], consoleErrors: [] };

function collectInteractionErrors(errors) {
  interactionErrors.pageErrors.push(...errors.pageErrors);
  interactionErrors.consoleErrors.push(...errors.consoleErrors);
}

async function withFreshPage(options = {}, callback, collect = true) {
  const opened = await openFresh(options);
  try {
    return await callback(opened.page, opened.errors, opened.context);
  } finally {
    await opened.context.close();
    if (collect) {
      collectInteractionErrors(opened.errors);
    }
  }
}

async function reloadFresh(page) {
  await page.reload({ waitUntil: "load" });
  await page.locator(SEL.keypad).waitFor({ state: "visible" });
}

async function stateOf(page) {
  return page.locator(SEL.app).getAttribute("data-state");
}

async function operatorOf(page) {
  return page.locator(SEL.app).getAttribute("data-operator");
}

async function inputValue(page) {
  return page.locator(SEL.input).inputValue();
}

async function expressionText(page) {
  return (await page.locator(SEL.expression).textContent()) ?? "";
}

async function resultAttribute(page) {
  return page.locator(SEL.result).getAttribute("data-value");
}

async function historyCount(page) {
  return page.locator(SEL.historyItem).count();
}

async function historySnapshot(page) {
  return page.locator(SEL.historyItem).evaluateAll((items) =>
    items.map((item) => {
      const expression = item.querySelector('[data-testid="history-expression"]');
      const result = item.querySelector('[data-testid="history-result"]');
      return {
        operator: item.getAttribute("data-operator"),
        operands: JSON.parse(item.getAttribute("data-operands")),
        resultValue: result?.getAttribute("data-value") ?? null,
        resultText: result?.textContent ?? "",
        expressionText: expression?.textContent ?? "",
      };
    }),
  );
}

async function serializedHistory(page) {
  const items = await historySnapshot(page);
  return items.map((item) => ({
    operator: item.operator,
    operands: item.operands,
    resultValue: Number(item.resultValue),
    expressionText: item.expressionText,
  }));
}

async function clickKey(page, key) {
  await page.locator(`${SEL.keypad} [data-key="${key}"]`).click();
}

async function clickOperator(page, operator) {
  await page.locator(`${SEL.opPicker} [data-op="${operator}"]`).click();
}

async function enterOperand(page, rawValue) {
  for (const character of rawValue) {
    await clickKey(page, character);
  }
}

async function calculateSequence(page, operator, operands) {
  await clickOperator(page, operator);
  for (const operand of operands) {
    await enterOperand(page, operand);
    await clickKey(page, "enter");
  }
  await clickKey(page, "equals");
}

async function assertOperatorBlank(page, label) {
  const operator = await operatorOf(page);
  check(operator === null || operator === "", `${label}: data-operator blank`, `operator=${stringify(operator)}`);
}

async function assertSelectState(page, label) {
  check((await stateOf(page)) === "select", `${label}: data-state is select`, `actual=${await stateOf(page)}`);
  await assertOperatorBlank(page, label);
}

async function assertKeysDisabled(page, keys, expectedDisabled, label) {
  for (const key of keys) {
    const locator = page.locator(`${SEL.keypad} [data-key="${key}"]`);
    check((await locator.count()) === 1, `${label}: key ${key} exists`, `count=${await locator.count()}`);
    const disabled = await locator.isDisabled();
    check(disabled === expectedDisabled, `${label}: key ${key} disabled=${expectedDisabled}`, `actual=${disabled}`);
  }
}

async function assertAllKeysDisabled(page, expectedDisabled, label) {
  await assertKeysDisabled(page, ALL_KEYS, expectedDisabled, label);
}

async function assertDigitKeysEnabled(page, label) {
  await assertKeysDisabled(page, DIGIT_KEYS, false, label);
}

async function assertOperatorsAvailable(page, label) {
  const buttons = page.locator(`${SEL.opPicker} [data-op]`);
  const count = await buttons.count();
  check(count === 4, `${label}: exactly four [data-op]`, `count=${count}`);
  const values = await buttons.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-op")));
  for (const operator of OPERATORS) {
    check(values.filter((value) => value === operator).length === 1, `${label}: one [data-op="${operator}"]`, `values=${stringify(values)}`);
    const locator = page.locator(`${SEL.opPicker} [data-op="${operator}"]`);
    check(!(await locator.isDisabled()), `${label}: [data-op="${operator}"] enabled`);
  }
}

async function assertInputReadOnlyNone(page, label) {
  const properties = await page.locator(SEL.input).evaluate((element) => ({
    readOnly: element.readOnly,
    inputMode: element.inputMode,
    readonlyAttribute: element.hasAttribute("readonly"),
    inputModeAttribute: element.getAttribute("inputmode"),
  }));
  check(properties.readOnly === true && properties.readonlyAttribute, `${label}: calc-input readOnly=true`, stringify(properties));
  check(properties.inputMode === "none" && properties.inputModeAttribute?.toLowerCase() === "none", `${label}: calc-input inputMode=none`, stringify(properties));
}

async function assertKeypadStructure(page) {
  check((await page.locator(SEL.keypad).count()) === 1, "keypad exists exactly once");
  check(await page.locator(SEL.keypad).isVisible(), "keypad is visible");
  check((await page.locator(`${SEL.keypad} ${SEL.opPicker}`).count()) === 1, "op-picker is inside keypad");
  await assertOperatorsAvailable(page, "keypad structure");
  for (const key of ALL_KEYS) {
    const count = await page.locator(`${SEL.keypad} [data-key="${key}"]`).count();
    check(count === 1, `key ${key} exists exactly once`, `count=${count}`);
  }
  check(
    (await page.locator(`${SEL.keypad} button[data-key="equals"][data-testid="key-equals"]`).count()) === 1,
    "equals key also carries key-equals testid",
  );
}

async function assertEntry(actual, expected, label) {
  check(actual !== undefined && actual !== null, `${label}: entry exists`);
  check(actual.operator === expected.operator, `${label}: operator`, `actual=${stringify(actual.operator)} expected=${stringify(expected.operator)}`);
  deepEqual(actual.operands, expected.operands, `${label}: operands`);
  approx(Number(actual.resultValue), expected.result, 1e-9, `${label}: result value`);
  check(
    compactExpression(actual.expressionText) === compactExpression(expected.expression ?? `${expected.operands.join(expected.operator)}`),
    `${label}: expression text`,
    `actual=${stringify(actual.expressionText)}`,
  );
}

async function assertNoPageErrors(errors, label) {
  check(errors.pageErrors.length === 0, `${label}: no pageerror`, errors.pageErrors.join(" | "));
}

async function measureLayout(page, label) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(80);
  const metrics = await page.evaluate(() => {
    const rectOf = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        area: rect.width * rect.height,
      };
    };
    const selectorRect = (selector) => {
      const element = document.querySelector(selector);
      return element ? rectOf(element) : null;
    };
    const controls = Array.from(
      new Set(document.querySelectorAll("button, input, [data-key], [data-op]")),
    ).map((element) => {
      const style = getComputedStyle(element);
      const rect = rectOf(element);
      return {
        tag: element.tagName,
        testid: element.getAttribute("data-testid"),
        key: element.getAttribute("data-key"),
        op: element.getAttribute("data-op"),
        text: (element.textContent ?? "").trim().slice(0, 24),
        visible:
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) > 0 &&
          rect.width > 0 &&
          rect.height > 0,
        ...rect,
      };
    });
    const digitAreas = [];
    for (let index = 0; index < 10; index += 1) {
      const element = document.querySelector(`[data-testid="keypad"] [data-key="${index}"]`);
      if (element) {
        digitAreas.push(rectOf(element).area);
      }
    }
    const sortedAreas = [...digitAreas].sort((left, right) => left - right);
    const median = sortedAreas.length === 0
      ? Number.NaN
      : sortedAreas.length % 2 === 1
        ? sortedAreas[Math.floor(sortedAreas.length / 2)]
        : (sortedAreas[sortedAreas.length / 2 - 1] + sortedAreas[sortedAreas.length / 2]) / 2;
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      documentElement: {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      },
      body: {
        scrollWidth: document.body.scrollWidth,
        clientWidth: document.body.clientWidth,
      },
      expression: selectorRect('[data-testid="expression"]'),
      result: selectorRect('[data-testid="result"]'),
      keypad: selectorRect('[data-testid="keypad"]'),
      enter: selectorRect('[data-testid="keypad"] [data-key="enter"]'),
      equals: selectorRect('[data-testid="keypad"] [data-key="equals"]'),
      controls,
      digitAreas,
      digitMedianArea: median,
    };
  });

  check(metrics.scrollY === 0, `${label}: scrollY=0`, `scrollY=${metrics.scrollY}`);
  for (const name of ["expression", "result", "keypad"]) {
    const rect = metrics[name];
    check(rect !== null, `${label}: ${name} exists`);
    check(rect.left >= -0.5, `${label}: ${name}.left in viewport`, `left=${rect.left}`);
    check(rect.top >= -0.5, `${label}: ${name}.top in viewport`, `top=${rect.top}`);
    check(rect.right <= metrics.innerWidth + 0.5, `${label}: ${name}.right in viewport`, `right=${rect.right} innerWidth=${metrics.innerWidth}`);
    check(rect.bottom <= metrics.innerHeight + 0.5, `${label}: ${name}.bottom in viewport`, `bottom=${rect.bottom} innerHeight=${metrics.innerHeight}`);
  }
  check(metrics.result.bottom <= metrics.keypad.top + 1, `${label}: result.bottom <= keypad.top + 1`, `result.bottom=${metrics.result.bottom} keypad.top=${metrics.keypad.top}`);
  check(metrics.keypad.bottom <= metrics.innerHeight + 0.5, `${label}: keypad.bottom <= innerHeight`, `keypad.bottom=${metrics.keypad.bottom} innerHeight=${metrics.innerHeight}`);
  check(metrics.documentElement.scrollWidth <= metrics.documentElement.clientWidth + 0.5, `${label}: documentElement has no horizontal overflow`, stringify(metrics.documentElement));
  check(metrics.body.scrollWidth <= metrics.body.clientWidth + 0.5, `${label}: body has no horizontal overflow`, stringify(metrics.body));

  const visibleControls = metrics.controls.filter((control) => control.visible);
  check(visibleControls.length > 0, `${label}: visible controls found`);
  let minimumWidth = Infinity;
  let minimumHeight = Infinity;
  for (const control of visibleControls) {
    check(control.width >= 43.5, `${label}: visible control width >=44 (0.5px tolerance)`, `${control.tag} testid=${control.testid} key=${control.key} op=${control.op} width=${control.width}`);
    check(control.height >= 43.5, `${label}: visible control height >=44 (0.5px tolerance)`, `${control.tag} testid=${control.testid} key=${control.key} op=${control.op} height=${control.height}`);
    minimumWidth = Math.min(minimumWidth, control.width);
    minimumHeight = Math.min(minimumHeight, control.height);
  }
  check(Number.isFinite(metrics.digitMedianArea) && metrics.digitMedianArea > 0, `${label}: digit median area measured`, stringify(metrics.digitAreas));
  check(metrics.enter !== null && metrics.equals !== null, `${label}: enter and equals rects exist`);
  check(metrics.enter.area + 1e-9 >= metrics.digitMedianArea * 1.5, `${label}: enter area >= 1.5x digit median`, `enter=${metrics.enter.area} median=${metrics.digitMedianArea}`);
  check(metrics.equals.area + 1e-9 >= metrics.digitMedianArea * 1.5, `${label}: equals area >= 1.5x digit median`, `equals=${metrics.equals.area} median=${metrics.digitMedianArea}`);

  return {
    label,
    viewport: `${metrics.innerWidth}x${metrics.innerHeight}`,
    keypadBottom: Number(metrics.keypad.bottom.toFixed(2)),
    minControl: `${minimumWidth.toFixed(2)}x${minimumHeight.toFixed(2)}`,
    medianArea: Number(metrics.digitMedianArea.toFixed(2)),
    enterRatio: Number((metrics.enter.area / metrics.digitMedianArea).toFixed(3)),
    equalsRatio: Number((metrics.equals.area / metrics.digitMedianArea).toFixed(3)),
    docScroll: `${metrics.documentElement.scrollWidth}/${metrics.documentElement.clientWidth}`,
    bodyScroll: `${metrics.body.scrollWidth}/${metrics.body.clientWidth}`,
  };
}

async function testH1() {
  const html = fs.readFileSync(artifactPath, "utf8");
  const bytes = Buffer.byteLength(html, "utf8");
  check(html.includes("</html>"), "artifact contains </html>");
  check(bytes >= 1024, "artifact byte length >= 1024", `bytes=${bytes}`);
  const externalReferences = collectionExternalReferences(html);
  check(externalReferences.length === 0, "artifact has zero external http(s) or protocol-relative references", stringify(externalReferences));

  const opened = await createPage({ viewport: { width: 390, height: 844 } });
  try {
    await opened.page.goto(artifactUrl, { waitUntil: "load" });
    await opened.page.waitForTimeout(150);
    check(opened.errors.pageErrors.length === 0, "file URL load produced zero pageerror", opened.errors.pageErrors.join(" | "));
  } finally {
    await opened.context.close();
  }
  return `bytes=${bytes}, htmlClose=yes, externalRefs=0, pageErrors=0, fileUrl=${artifactUrl}`;
}

async function testH2() {
  const results = [];
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
    await withFreshPage(
      { viewport, isMobile: true, hasTouch: true },
      async (page) => {
        results.push(await measureLayout(page, `${viewport.width}x${viewport.height} select`));
        await calculateSequence(page, "+", ["12", "30", "8"]);
        await calculateSequence(page, "*", ["2", "3", "4"]);
        check((await historyCount(page)) === 2, `${viewport.width}x${viewport.height}: result state history=2`, `count=${await historyCount(page)}`);
        results.push(await measureLayout(page, `${viewport.width}x${viewport.height} result`));
      },
      false,
    );
  }
  return results.map((entry) => `${entry.label}: keypadBottom=${entry.keypadBottom}, minControl=${entry.minControl}, medianDigitArea=${entry.medianArea}, enterRatio=${entry.enterRatio}, equalsRatio=${entry.equalsRatio}, docScroll=${entry.docScroll}, bodyScroll=${entry.bodyScroll}`).join(" | ");
}

async function testH3() {
  return withFreshPage({}, async (page, errors) => {
    check((await stateOf(page)) === "select", "initial state is select", `actual=${await stateOf(page)}`);
    await assertKeypadStructure(page);
    await assertInputReadOnlyNone(page, "select state");
    const beforeTyping = await inputValue(page);
    await page.locator(SEL.input).focus();
    await page.keyboard.type("123");
    await page.waitForTimeout(50);
    check((await inputValue(page)) === beforeTyping, "keyboard typing cannot change calc-input value", `before=${stringify(beforeTyping)} after=${stringify(await inputValue(page))}`);
    await assertKeysDisabled(page, ALL_KEYS, true, "select state");
    await assertOperatorsAvailable(page, "select state");
    await clickOperator(page, "+");
    check((await stateOf(page)) === "input", "clicking + enters input state", `actual=${await stateOf(page)}`);
    check((await operatorOf(page)) === "+", "clicking + sets data-operator=+", `actual=${await operatorOf(page)}`);
    await assertKeysDisabled(page, ALL_KEYS, false, "input state");
    await assertInputReadOnlyNone(page, "input state");
    await assertNoPageErrors(errors, "H3");
    return `keypadVisible=yes, opCount=4, keys=14, equalsKeyEquals=yes, readOnly=true, inputMode=none, typedValue=${stringify(await inputValue(page))}, selectKeysDisabled=14/14, inputKeysEnabled=14/14, noPageErrors`;
  });
}

async function testH4() {
  return withFreshPage({}, async (page, errors) => {
    const issues = [];
    const recordCheck = (condition, message, detail = "") => {
      if (!condition) {
        issues.push(detail ? `${message}; ${text(detail)}` : message);
      }
    };
    const recordAssertion = async (assertion) => {
      try {
        await assertion();
      } catch (error) {
        issues.push(text(error?.message ?? error));
      }
    };
    await clickOperator(page, "+");
    for (const key of ["1", "2", ".", "5"]) {
      await clickKey(page, key);
    }
    recordCheck((await inputValue(page)) === "12.5", "digits append to calc-input", `value=${stringify(await inputValue(page))}`);
    await clickKey(page, ".");
    recordCheck((await inputValue(page)) === "12.5", "second decimal point ignored", `value=${stringify(await inputValue(page))}`);
    const backspaceValues = [];
    for (let index = 0; index < 4; index += 1) {
      await clickKey(page, "backspace");
      backspaceValues.push(await inputValue(page));
    }
    await recordAssertion(() => deepEqual(backspaceValues, ["12.", "12", "1", ""], "backspace sequence values"));
    await clickKey(page, "backspace");
    recordCheck((await inputValue(page)) === "", "backspace on empty value is no-op", `value=${stringify(await inputValue(page))}`);
    recordCheck(errors.pageErrors.length === 0, "empty backspace produced no pageerror", errors.pageErrors.join(" | "));
    await clickKey(page, "3");
    await clickKey(page, "0");
    await clickKey(page, "enter");
    recordCheck((await inputValue(page)) === "", "enter clears calc-input after commit", `value=${stringify(await inputValue(page))}`);
    const expressionAfterEnter = await expressionText(page);
    recordCheck(expressionAfterEnter.includes("30") && expressionAfterEnter.includes("+"), "expression reflects committed 30 with +", `expression=${stringify(expressionAfterEnter)}`);
    recordCheck((await historyCount(page)) === 0, "enter does not add history", `count=${await historyCount(page)}`);
    await clickKey(page, "4");
    await clickKey(page, "equals");
    const firstResult = await resultAttribute(page);
    const firstCount = await historyCount(page);
    recordCheck(Number(firstResult) === 34, "30 + 4 result is 34", `data-value=${stringify(firstResult)}`);
    recordCheck(firstCount === 1, "equals adds exactly one history entry", `count=${firstCount}`);
    const firstSnapshot = await historySnapshot(page);
    await recordAssertion(() => assertEntry(firstSnapshot[0], { operator: "+", operands: ["30", "4"], result: 34, expression: "30 + 4" }, "H4 first history entry"));

    recordCheck((await stateOf(page)) === "result", "second sequence starts from result state", `actual=${await stateOf(page)}`);
    recordCheck((await operatorOf(page)) === "+", "second sequence retains sticky +", `actual=${await operatorOf(page)}`);
    await enterOperand(page, "1.5");
    await clickKey(page, "enter");
    await enterOperand(page, "2.25");
    await clickKey(page, "equals");
    const secondResult = await resultAttribute(page);
    const secondCount = await historyCount(page);
    recordCheck(Number(secondResult) === 3.75, "1.5 + 2.25 result is 3.75", `data-value=${stringify(secondResult)}`);
    recordCheck(secondCount === 2, "second fresh calculation leaves history=2", `count=${secondCount}`);
    const secondSnapshot = await historySnapshot(page);
    await recordAssertion(() => assertEntry(secondSnapshot[0], { operator: "+", operands: ["1.5", "2.25"], result: 3.75, expression: "1.5 + 2.25" }, "H4 fresh history entry"));
    recordCheck(errors.pageErrors.length === 0, "H4 produced no pageerror", errors.pageErrors.join(" | "));
    const evidence = `value=12.5, duplicateDot=no-change, backspaces=${stringify(backspaceValues)}, emptyBackspaceNoop=yes, expressionAfterEnter=${stringify(expressionAfterEnter)}, firstResult=${stringify(firstResult)}/history${firstCount}, firstOperands=${stringify(firstSnapshot[0]?.operands ?? null)}, stickyPlusResult=${stringify(secondResult)}/history${secondCount}, stickyPlusOperands=${stringify(secondSnapshot[0]?.operands ?? null)}`;
    if (issues.length > 0) {
      throw new Error(`${issues.join(" || ")}; measured=${evidence}`);
    }
    return evidence;
  });
}

async function testH5() {
  return withFreshPage({}, async (page, errors) => {
    await calculateSequence(page, "+", ["12", "30"]);
    approx(Number(await resultAttribute(page)), 42, 1e-9, "12 + 30 result is 42");
    let snapshot = await historySnapshot(page);
    check(snapshot.length === 1, "first result has history=1", `count=${snapshot.length}`);
    await assertEntry(snapshot[0], { operator: "+", operands: ["12", "30"], result: 42, expression: "12 + 30" }, "H5 base entry");
    check((await stateOf(page)) === "result", "post-equals state is result", `actual=${await stateOf(page)}`);
    await assertDigitKeysEnabled(page, "result state");
    check((await inputValue(page)) === "", "result state calc-input empty", `value=${stringify(await inputValue(page))}`);

    await enterOperand(page, "5");
    await clickKey(page, "enter");
    await enterOperand(page, "6");
    await clickKey(page, "enter");
    await clickKey(page, "equals");
    approx(Number(await resultAttribute(page)), 11, 1e-9, "sticky + 5/6 result is 11");
    const afterSecond = await historySnapshot(page);
    check(afterSecond.length === 2, "sticky + calculation leaves history=2", `count=${afterSecond.length}`);
    await assertEntry(afterSecond[0], { operator: "+", operands: ["5", "6"], result: 11, expression: "5 + 6" }, "H5 sticky + entry");
    deepEqual(afterSecond[1], snapshot[0], "H5 original entry unchanged after sticky +");

    await clickOperator(page, "*");
    await enterOperand(page, "5");
    await clickKey(page, "enter");
    await enterOperand(page, "6");
    await clickKey(page, "enter");
    await clickKey(page, "equals");
    approx(Number(await resultAttribute(page)), 30, 1e-9, "sticky * 5/6 result is 30");
    const afterThird = await historySnapshot(page);
    check(afterThird.length === 3, "operator switch leaves history=3", `count=${afterThird.length}`);
    await assertEntry(afterThird[0], { operator: "*", operands: ["5", "6"], result: 30, expression: "5 * 6" }, "H5 sticky * entry");
    deepEqual(afterThird.slice(1), afterSecond, "H5 prior two entries unchanged after operator switch");
    await assertNoPageErrors(errors, "H5");
    return `first=42/1, stickyPlus=11/2, stickyStar=30/3, top=${stringify(afterThird.map((entry) => [entry.operator, entry.operands, entry.resultValue]))}`;
  });
}

async function testH6() {
  return withFreshPage({}, async (page, errors) => {
    check(await page.locator(SEL.keypad).isVisible(), "initial keypad visible");
    await assertAllKeysDisabled(page, true, "H6 initial");
    await assertOperatorsAvailable(page, "H6 initial");
    await assertInputReadOnlyNone(page, "H6 initial");
    await assertOperatorBlank(page, "H6 initial");

    await clickOperator(page, "+");
    check((await operatorOf(page)) === "+", "+ sets operator", `actual=${await operatorOf(page)}`);
    await assertDigitKeysEnabled(page, "H6 after +");
    await clickOperator(page, "*");
    check((await operatorOf(page)) === "*", "* switches operator", `actual=${await operatorOf(page)}`);
    await clickOperator(page, "+");
    check((await operatorOf(page)) === "+", "+ switches operator back", `actual=${await operatorOf(page)}`);
    check(compactExpression(await expressionText(page)) === "", "operator switch before operands leaves expression empty", `expression=${stringify(await expressionText(page))}`);
    check((await historyCount(page)) === 0, "operator switching keeps history=0", `count=${await historyCount(page)}`);

    await enterOperand(page, "5");
    await clickKey(page, "enter");
    await enterOperand(page, "6");
    await clickKey(page, "enter");
    await clickOperator(page, "*");
    const switchedExpression = await expressionText(page);
    check((await operatorOf(page)) === "*", "input-state operator switch updates data-operator", `actual=${await operatorOf(page)}`);
    check(["5", "6", "*"].every((part) => switchedExpression.includes(part)), "expression retains operands and new *", `expression=${stringify(switchedExpression)}`);
    check(!switchedExpression.includes("+"), "expression drops old +", `expression=${stringify(switchedExpression)}`);
    await assertDigitKeysEnabled(page, "H6 input-state switch");
    await clickKey(page, "equals");
    approx(Number(await resultAttribute(page)), 30, 1e-9, "switched * calculation result is 30");
    check((await historyCount(page)) === 1, "switched calculation has history=1", `count=${await historyCount(page)}`);
    const snapshot = await historySnapshot(page);
    await assertEntry(snapshot[0], { operator: "*", operands: ["5", "6"], result: 30, expression: "5 * 6" }, "H6 switched entry");

    await page.locator(SEL.keyOp).click();
    await assertSelectState(page, "H6 reset");
    await assertAllKeysDisabled(page, true, "H6 reset");
    deepEqual(await historySnapshot(page), snapshot, "H6 key-op preserves history");
    await assertNoPageErrors(errors, "H6");
    return `initialDisabled=14/14, opsAvailable=4/4, switches=+->*->+, switchedExpression=${stringify(switchedExpression)}, entry=*:${stringify(snapshot[0].operands)}=30, keyOpState=select, historyPreserved=yes`;
  });
}

async function testH7() {
  return withFreshPage({}, async (page, errors) => {
    const expected = [
      { operator: "+", operands: ["12", "30", "8"], result: 50 },
      { operator: "-", operands: ["10", "4", "3"], result: 3 },
      { operator: "*", operands: ["2", "3", "4"], result: 24 },
      { operator: "+", operands: ["1.5", "2.25"], result: 3.75 },
    ];
    const counts = [];
    for (const item of expected) {
      const before = await historyCount(page);
      await calculateSequence(page, item.operator, item.operands);
      const after = await historySnapshot(page);
      check(after.length === before + 1, `H7 ${item.operator} increments history by one`, `before=${before} after=${after.length}`);
      check((await operatorOf(page)) === item.operator, `H7 ${item.operator} data-operator retained`, `actual=${await operatorOf(page)}`);
      await assertEntry(after[0], { ...item, expression: item.operands.join(` ${item.operator} `) }, `H7 latest ${item.operator}`);
      counts.push(after.length);
    }
    const finalSnapshot = await historySnapshot(page);
    check(finalSnapshot.length === 4, "H7 final history has four entries", `count=${finalSnapshot.length}`);
    deepEqual(
      finalSnapshot.map((entry) => ({ operator: entry.operator, operands: entry.operands, result: Number(entry.resultValue), expression: compactExpression(entry.expressionText) })),
      [
        { operator: "+", operands: ["1.5", "2.25"], result: 3.75, expression: "1.5+2.25" },
        { operator: "*", operands: ["2", "3", "4"], result: 24, expression: "2*3*4" },
        { operator: "-", operands: ["10", "4", "3"], result: 3, expression: "10-4-3" },
        { operator: "+", operands: ["12", "30", "8"], result: 50, expression: "12+30+8" },
      ],
      "H7 final top-down history",
    );

    await clickKey(page, "enter");
    deepEqual(await historySnapshot(page), finalSnapshot, "H7 empty enter does not add history");
    await clickOperator(page, "/");
    await enterOperand(page, "5");
    await clickKey(page, "enter");
    await enterOperand(page, "0");
    await clickKey(page, "enter");
    await clickKey(page, "equals");
    deepEqual(await historySnapshot(page), finalSnapshot, "H7 division by zero does not add history");
    check((await stateOf(page)) === "error", "H7 division by zero enters error", `actual=${await stateOf(page)}`);

    await reloadFresh(page);
    check((await historyCount(page)) === 0, "H7 reload history=0", `count=${await historyCount(page)}`);
    await assertSelectState(page, "H7 reload");

    const fresh = await openFresh({ viewport: { width: 390, height: 844 } });
    try {
      check((await historyCount(fresh.page)) === 0, "H7 new context history=0", `count=${await historyCount(fresh.page)}`);
      await assertSelectState(fresh.page, "H7 new context");
      await assertNoPageErrors(fresh.errors, "H7 new context");
      collectInteractionErrors(fresh.errors);
    } finally {
      await fresh.context.close();
    }
    await assertNoPageErrors(errors, "H7");
    return `counts=${stringify(counts)}, top4=${stringify(finalSnapshot.map((entry) => [entry.operator, entry.operands, entry.resultValue]))}, emptyEnterNoop=yes, divZeroHistoryNoop=yes, reloadHistory=0, newContextHistory=0`;
  });
}

async function testH8() {
  return withFreshPage({}, async (page, errors) => {
    await calculateSequence(page, "+", ["12", "30", "8"]);
    await calculateSequence(page, "*", ["2", "3", "4"]);
    const original = await historySnapshot(page);
    check(original.length === 2, "H8 setup history=2", `count=${original.length}`);
    await page.locator(SEL.historyItem).nth(1).locator(SEL.historyEdit).click();
    check((await stateOf(page)) === "edit", "H8 history-edit enters edit state", `actual=${await stateOf(page)}`);
    check(await page.locator(SEL.editDraft).isVisible(), "H8 edit-draft visible");
    check((await page.locator(SEL.editDraft).getAttribute("data-operator")) === "+", "H8 edit-draft data-operator=+", `actual=${await page.locator(SEL.editDraft).getAttribute("data-operator")}`);
    let inputs = page.locator(`${SEL.editDraft} ${SEL.operandInput}`);
    check((await inputs.count()) === 3, "H8 edit has exactly three operand inputs", `count=${await inputs.count()}`);
    let inputStates = await inputs.evaluateAll((elements) => elements.map((element) => ({ value: element.value, disabled: element.disabled, readOnly: element.readOnly })));
    deepEqual(inputStates.map((state) => state.value), ["12", "30", "8"], "H8 operand input initial values");
    check(inputStates.every((state) => !state.disabled && !state.readOnly), "H8 operand inputs enabled and editable", stringify(inputStates));
    await assertInputReadOnlyNone(page, "H8 edit state");
    check(await page.locator(SEL.opPicker).isVisible(), "H8 op-picker visible in edit state");

    await inputs.nth(1).fill("5");
    const editedExpression = await expressionText(page);
    check(editedExpression.includes("5"), "H8 expression includes edited 5", `expression=${stringify(editedExpression)}`);
    check(!editedExpression.includes("30"), "H8 expression excludes replaced 30", `expression=${stringify(editedExpression)}`);
    await clickKey(page, "equals");
    approx(numericAttribute(await resultAttribute(page), "H8 result data-value exists"), 25, 1e-9, "H8 edited result is 25");
    check((await historyCount(page)) === 3, "H8 edited calculation history=3", `count=${await historyCount(page)}`);
    const after = await historySnapshot(page);
    await assertEntry(after[0], { operator: "+", operands: ["12", "5", "8"], result: 25, expression: "12 + 5 + 8" }, "H8 new entry");
    check((await stateOf(page)) === "result", "H8 edit state ends in result", `actual=${await stateOf(page)}`);
    deepEqual(after.slice(1), original, "H8 existing two entries unchanged after shift");
    await assertNoPageErrors(errors, "H8");
    return `editInputs=${stringify(inputStates.map((state) => state.value))}, expression=${stringify(editedExpression)}, new=${stringify(after[0].operator)}:${stringify(after[0].operands)}=${after[0].resultValue}, history=${after.length}, originalsShiftedUnchanged=yes`;
  });
}

async function testH9() {
  return withFreshPage({}, async (page, errors) => {
    await calculateSequence(page, "*", ["2", "3", "4"]);
    await calculateSequence(page, "+", ["1.5", "2.25"]);
    const original = await historySnapshot(page);
    check(original.length === 2, "H9 setup history=2", `count=${original.length}`);
    await page.locator(SEL.historyItem).nth(1).locator(SEL.historyEdit).click();
    await clickOperator(page, "+");
    check((await page.locator(SEL.editDraft).getAttribute("data-operator")) === "+", "H9 edit-draft operator changed to +", `actual=${await page.locator(SEL.editDraft).getAttribute("data-operator")}`);
    let inputs = page.locator(`${SEL.editDraft} ${SEL.operandInput}`);
    const operatorSwitchValues = await inputs.evaluateAll((elements) => elements.map((element) => element.value));
    deepEqual(operatorSwitchValues, ["2", "3", "4"], "H9 operator switch preserves operand input values");

    await inputs.nth(0).fill("10");
    await inputs.nth(2).fill("5");
    const editedExpression = await expressionText(page);
    check(editedExpression.includes("10") && editedExpression.includes("5"), "H9 expression includes 10 and 5", `expression=${stringify(editedExpression)}`);
    const chips = page.locator(`${SEL.editDraft} ${SEL.operandChip}`);
    check((await chips.count()) === 3, "H9 three operand chips before remove", `count=${await chips.count()}`);
    await chips.nth(1).locator(SEL.operandRemove).click();
    inputs = page.locator(`${SEL.editDraft} ${SEL.operandInput}`);
    const afterRemoveValues = await inputs.evaluateAll((elements) => elements.map((element) => element.value));
    deepEqual(afterRemoveValues, ["10", "5"], "H9 middle chip removal preserves remaining values/order");

    await clickKey(page, "2");
    await clickKey(page, "enter");
    inputs = page.locator(`${SEL.editDraft} ${SEL.operandInput}`);
    const afterEnterValues = await inputs.evaluateAll((elements) => elements.map((element) => element.value));
    deepEqual(afterEnterValues, ["10", "5", "2"], "H9 keypad enter appends operand");
    await clickKey(page, "equals");
    approx(numericAttribute(await resultAttribute(page), "H9 result data-value exists"), 17, 1e-9, "H9 edited result is 17");
    check((await historyCount(page)) === 3, "H9 edited calculation history=3", `count=${await historyCount(page)}`);
    const after = await historySnapshot(page);
    await assertEntry(after[0], { operator: "+", operands: ["10", "5", "2"], result: 17, expression: "10 + 5 + 2" }, "H9 new entry");
    deepEqual(after.slice(1), original, "H9 original entries unchanged and in relative order");
    await assertNoPageErrors(errors, "H9");
    return `operatorSwitchInputs=${stringify(operatorSwitchValues)}, editedExpression=${stringify(editedExpression)}, afterRemove=${stringify(afterRemoveValues)}, afterEnter=${stringify(afterEnterValues)}, new=+${stringify(after[0].operands)}=17, history=${after.length}, originalsUnchanged=yes`;
  });
}

async function testH10() {
  return withFreshPage({}, async (page, errors) => {
    await calculateSequence(page, "+", ["12", "30", "8"]);
    const original = await historySnapshot(page);
    check(original.length === 1, "H10 setup history=1", `count=${original.length}`);
    await page.locator(SEL.historyEdit).first().click();
    let inputs = page.locator(`${SEL.editDraft} ${SEL.operandInput}`);
    check((await inputs.count()) === 3, "H10 edit has three inputs", `count=${await inputs.count()}`);

    await inputs.nth(1).fill("");
    await clickKey(page, "equals");
    check((await historyCount(page)) === 1, "H10 empty operand no-op preserves history=1", `count=${await historyCount(page)}`);
    check((await resultAttribute(page)) === null, "H10 empty operand leaves no result data-value", `data-value=${stringify(await resultAttribute(page))}`);
    await assertNoPageErrors(errors, "H10 empty operand");

    inputs = page.locator(`${SEL.editDraft} ${SEL.operandInput}`);
    await inputs.nth(1).fill("abc");
    await clickKey(page, "equals");
    check((await historyCount(page)) === 1, "H10 abc operand no-op preserves history=1", `count=${await historyCount(page)}`);
    check((await resultAttribute(page)) === null, "H10 abc operand leaves no result data-value", `data-value=${stringify(await resultAttribute(page))}`);
    await assertNoPageErrors(errors, "H10 abc operand");

    inputs = page.locator(`${SEL.editDraft} ${SEL.operandInput}`);
    await inputs.nth(1).fill("5");
    await clickKey(page, "equals");
    approx(numericAttribute(await resultAttribute(page), "H10 final result data-value exists"), 25, 1e-9, "H10 final edited result is 25");
    check((await historyCount(page)) === 2, "H10 final valid edit history=2", `count=${await historyCount(page)}`);
    const after = await historySnapshot(page);
    await assertEntry(after[0], { operator: "+", operands: ["12", "5", "8"], result: 25, expression: "12 + 5 + 8" }, "H10 final entry");
    deepEqual(after.slice(1), original, "H10 original source unchanged after successful edit");
    await assertNoPageErrors(errors, "H10");
    return `emptyNoop=yes, abcNoop=yes, final=25/2 operands=${stringify(after[0].operands)}, pageErrors=0`;
  });
}

async function testH11() {
  return withFreshPage({}, async (page, errors) => {
    await calculateSequence(page, "/", ["100", "5", "2"]);
    approx(Number(await resultAttribute(page)), 10, 1e-9, "100 / 5 / 2 result is 10");
    const original = await historySnapshot(page);
    check(original.length === 1, "H11 setup history=1", `count=${original.length}`);
    await page.locator(SEL.historyEdit).first().click();
    const inputs = page.locator(`${SEL.editDraft} ${SEL.operandInput}`);
    check((await inputs.count()) === 3, "H11 edit has three inputs", `count=${await inputs.count()}`);
    await inputs.nth(1).fill("0");
    await clickKey(page, "equals");
    check((await stateOf(page)) === "error", "H11 edited division by zero enters error", `actual=${await stateOf(page)}`);
    check((await page.locator(SEL.result).getAttribute("data-error")) === "true", "H11 result data-error=true", `actual=${await page.locator(SEL.result).getAttribute("data-error")}`);
    check((await historyCount(page)) === 1, "H11 division by zero preserves history=1", `count=${await historyCount(page)}`);
    deepEqual(await historySnapshot(page), original, "H11 source history unchanged on error");
    await assertNoPageErrors(errors, "H11 edited division by zero");
    check(await page.locator(SEL.keypad).isVisible(), "H11 keypad visible in error state");
    await assertDigitKeysEnabled(page, "H11 error state");
    await assertInputReadOnlyNone(page, "H11 error state");

    await clickOperator(page, "+");
    check((await operatorOf(page)) === "+", "H11 operator switch from error sets +", `actual=${await operatorOf(page)}`);
    await assertDigitKeysEnabled(page, "H11 after error operator switch");
    await enterOperand(page, "1");
    await clickKey(page, "enter");
    await enterOperand(page, "2");
    await clickKey(page, "enter");
    await clickKey(page, "equals");
    approx(numericAttribute(await resultAttribute(page), "H11 recovery result data-value exists"), 3, 1e-9, "H11 recovery 1+2 result is 3");
    check((await historyCount(page)) === 2, "H11 recovery leaves history=2", `count=${await historyCount(page)}`);
    const after = await historySnapshot(page);
    await assertEntry(after[0], { operator: "+", operands: ["1", "2"], result: 3, expression: "1 + 2" }, "H11 recovery entry");
    deepEqual(after.slice(1), original, "H11 original entry unchanged after recovery");
    await assertNoPageErrors(errors, "H11");
    return `errorState=yes, dataError=true, history=1, sourceUnchanged=yes, keypadVisible=yes, digitsEnabled=10/10, readOnly=true, recovery=+${stringify(after[0].operands)}=3 history=2`;
  });
}

async function runH12KeyboardSequence(page) {
  await clickOperator(page, "+");
  for (const operand of ["12", "30", "8"]) {
    await enterOperand(page, operand);
    await clickKey(page, "enter");
  }
  await clickKey(page, "equals");
  for (const operand of ["5", "6"]) {
    await enterOperand(page, operand);
    await clickKey(page, "enter");
  }
  await clickKey(page, "equals");
  await clickOperator(page, "*");
  for (const operand of ["5", "6"]) {
    await enterOperand(page, operand);
    await clickKey(page, "enter");
  }
  await clickKey(page, "equals");
}

async function testH12() {
  check(interactionErrors.pageErrors.length === 0, "H3-H11 interactions produced zero pageerror", interactionErrors.pageErrors.join(" | "));
  check(interactionErrors.consoleErrors.length === 0, "H3-H11 interactions produced zero console error", interactionErrors.consoleErrors.join(" | "));

  const runs = [];
  const runErrors = [];
  for (let index = 0; index < 2; index += 1) {
    const opened = await openFresh({ viewport: { width: 390, height: 844 } });
    try {
      await runH12KeyboardSequence(opened.page);
      const serialized = await serializedHistory(opened.page);
      deepEqual(serialized.length === 3, true, `H12 run ${index + 1}: history has three entries`);
      await assertNoPageErrors(opened.errors, `H12 run ${index + 1}`);
      check(opened.errors.consoleErrors.length === 0, `H12 run ${index + 1}: no console error`, opened.errors.consoleErrors.join(" | "));
      runs.push(serialized);
      runErrors.push({ pageErrors: opened.errors.pageErrors.length, consoleErrors: opened.errors.consoleErrors.length });
    } finally {
      await opened.context.close();
    }
  }
  deepEqual(runs[0], runs[1], "H12 two fresh keyboard sequences serialize identically");
  return `H3-H11 pageErrors=0, consoleErrors=0, runPageErrors=${stringify(runErrors.map((item) => item.pageErrors))}, runConsoleErrors=${stringify(runErrors.map((item) => item.consoleErrors))}, historiesDeepEqual=yes, entries=${runs[0].length}`;
}

const cases = [
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
  ["H12", testH12],
];

let browser;
const results = [];
let fatalEnvironmentError = null;

try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  for (const [id, test] of cases) {
    try {
      const evidence = await test();
      results.push({ id, pass: true, evidence: text(evidence) });
    } catch (error) {
      results.push({ id, pass: false, evidence: text(error?.stack ?? error?.message ?? error) });
    }
  }
} catch (error) {
  fatalEnvironmentError = error;
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

if (fatalEnvironmentError) {
  lines.push(`ENV: BLOCKED — ${text(fatalEnvironmentError?.message ?? fatalEnvironmentError)}`);
  lines.push("HARD: FAIL (ENV)");
} else {
  for (const result of results) {
    lines.push(`H${result.id.replace(/^H/, "")} ${result.pass ? "PASS" : "FAIL"} — ${result.evidence || "no evidence"}`);
  }
  const failed = results.filter((result) => !result.pass).map((result) => result.id);
  lines.push(failed.length === 0 ? "HARD: PASS" : `HARD: FAIL (${failed.join(",")})`);
}

const output = `${lines.join("\n")}\n`;
fs.writeFileSync(outputPath, output, "utf8");
process.stdout.write(output);
