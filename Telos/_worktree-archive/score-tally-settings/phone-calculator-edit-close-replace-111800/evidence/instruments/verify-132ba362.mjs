#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const ROUND = String(process.argv[2] ?? process.env.KEKKAI_ROUND ?? "1").replace(/^r/i, "");
const resolveFromHere = (candidate) => (
  path.isAbsolute(candidate) ? path.normalize(candidate) : path.resolve(HERE, candidate)
);
const ARTIFACT = resolveFromHere(process.env.KEKKAI_ARTIFACT ?? "../../../index.html");
const OUT_DIR = resolveFromHere(process.env.KEKKAI_OUT_DIR ?? ".");
const STEP_TIMEOUT_MS = 120_000;

const S = Object.freeze({
  app: "main.app[data-state]",
  picker: '[data-testid="op-picker"]',
  calcInput: 'input[data-testid="calc-input"]',
  expression: '[data-testid="expression"]',
  result: '[data-testid="result"]',
  equals: 'button[data-testid="key-equals"]',
  keyOp: 'button[data-testid="key-op"]',
  keypad: '[data-testid="keypad"]',
  historyItem: '[data-testid="history-item"]',
  historyEdit: 'button[data-testid="history-edit"]',
  historyExpression: '[data-testid="history-expression"]',
  historyResult: '[data-testid="history-result"]',
  editDraft: '[data-testid="edit-draft"]',
  editCancel: 'button[data-testid="edit-cancel"]',
  operandChip: '[data-testid="operand-chip"]',
  operandInput: 'input[data-testid="operand-input"]',
  operandRemove: 'button[data-testid="operand-remove"]',
});

const sha256File = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const compact = (value, limit = 1800) => String(value).replace(/\s+/g, " ").trim().slice(0, limit);
const display = (value) => {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return "undefined";
  try {
    const text = JSON.stringify(value);
    return text === undefined ? String(value) : text;
  } catch {
    return String(value);
  }
};

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

class Assertions {
  constructor() {
    this.failures = [];
    this.notes = [];
  }

  ok(name, condition, actual) {
    if (!condition) {
      this.failures.push(`${name}: expected true, got ${display(actual)}`);
    }
    return Boolean(condition);
  }

  eq(name, actual, expected) {
    const pass = isDeepStrictEqual(actual, expected);
    if (!pass) {
      this.failures.push(`${name}: expected ${display(expected)}, got ${display(actual)}`);
    }
    return pass;
  }

  near(name, actual, expected, tolerance = 1e-9) {
    const numeric = Number(actual);
    const pass = Number.isFinite(numeric) && Math.abs(numeric - expected) <= tolerance;
    if (!pass) {
      this.failures.push(`${name}: expected ${expected} ± ${tolerance}, got ${display(actual)}`);
    }
    return pass;
  }

  note(name, value) {
    this.notes.push(`${name}=${display(value)}`);
  }
}

function scanExternalReferences(html) {
  const references = [];
  const add = (value) => {
    const normalized = String(value ?? "").trim();
    if (/^(https?:)?\/\//i.test(normalized)) references.push(normalized);
  };

  for (const [tag, attribute] of [["script", "src"], ["link", "href"], ["img", "src"]]) {
    const tagPattern = new RegExp(`<${tag}\\b[^>]*>`, "gi");
    for (const tagMatch of html.matchAll(tagPattern)) {
      const attributePattern = new RegExp(
        `\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
        "i",
      );
      const match = attributePattern.exec(tagMatch[0]);
      if (match) add(match[1] ?? match[2] ?? match[3]);
    }
  }

  const importPattern = /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^)\s;]+))/gi;
  for (const match of html.matchAll(importPattern)) add(match[1] ?? match[2] ?? match[3]);

  const urlPattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
  for (const match of html.matchAll(urlPattern)) add(match[1] ?? match[2] ?? match[3]);

  return references;
}

const requireFromTests = createRequire(path.join(HERE, "../../../tests/lib/verifier-resolver.cjs"));
let chromium;
try {
  const playwright = requireFromTests("playwright");
  chromium = playwright.chromium ?? playwright.default?.chromium;
  if (!chromium) throw new Error("playwright module did not expose chromium");
} catch (error) {
  console.error(`VERIFIER REFUSED — Playwright unavailable: ${error.message}`);
  process.exit(2);
}

if (!fs.existsSync(ARTIFACT)) {
  console.error(`VERIFIER REFUSED — artifact does not exist: ${ARTIFACT}`);
  process.exit(2);
}

let browser;
try {
  browser = await chromium.launch({ headless: true, timeout: 30_000 });
} catch (error) {
  console.error(`VERIFIER REFUSED — Chromium unavailable: ${error.message}`);
  process.exit(2);
}

const monitors = [];

async function openPage(options = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    ...options,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(3_000);
  page.setDefaultNavigationTimeout(30_000);
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  monitors.push({ pageErrors, consoleErrors });
  await page.goto(pathToFileURL(ARTIFACT).href, { waitUntil: "load" });
  return {
    context,
    page,
    pageErrors,
    consoleErrors,
    async close() {
      await context.close();
    },
  };
}

async function appState(page) {
  return page.$eval(S.app, (el) => el.dataset.state ?? null);
}

async function appOperator(page) {
  return page.$eval(S.app, (el) => el.getAttribute("data-operator"));
}

async function expressionRaw(page) {
  return page.$eval(S.expression, (el) => el.textContent || "");
}

async function expressionText(page) {
  return (await expressionRaw(page)).trim();
}

async function resultInfo(page) {
  return page.$eval(S.result, (el) => ({
    text: el.textContent || "",
    textTrimmed: (el.textContent || "").trim(),
    value: el.getAttribute("data-value"),
    error: el.getAttribute("data-error"),
  }));
}

async function inputValues(page) {
  return page.$$eval(S.operandInput, (els) => els.map((el) => el.value));
}

async function pendingCount(page) {
  return page.$$eval('[data-pending="true"]', (els) => els.length);
}

async function chipPending(page) {
  return page.$$eval(S.operandChip, (els) => els.map((el) => el.getAttribute("data-pending")));
}

async function historySnapshots(page) {
  return page.$$eval(S.historyItem, (items) => items.map((item) => {
    const result = item.querySelector('[data-testid="history-result"]');
    const expression = item.querySelector('[data-testid="history-expression"]');
    return {
      operator: item.getAttribute("data-operator"),
      operands: JSON.parse(item.getAttribute("data-operands") || "[]"),
      result: result ? result.getAttribute("data-value") : null,
      resultText: result ? (result.textContent || "").trim() : "",
      expression: expression ? (expression.textContent || "").trim() : "",
    };
  }));
}

async function viewSnapshot(page) {
  const view = await page.evaluate(({ app, expression, result }) => {
    const root = document.querySelector(app);
    const expressionView = document.querySelector(expression);
    const resultView = document.querySelector(result);
    return {
      state: root.dataset.state ?? null,
      operator: root.getAttribute("data-operator"),
      expressionRaw: expressionView.textContent || "",
      expression: (expressionView.textContent || "").trim(),
      resultTextRaw: resultView.textContent || "",
      resultText: (resultView.textContent || "").trim(),
      resultValue: resultView.getAttribute("data-value"),
      resultError: resultView.getAttribute("data-error"),
    };
  }, { app: S.app, expression: S.expression, result: S.result });
  view.history = await historySnapshots(page);
  return view;
}

async function isFocused(page, selector) {
  return page.$eval(selector, (el) => document.activeElement === el);
}

async function clickKey(page, key) {
  await page.click(`${S.keypad} [data-key="${key}"]`);
}

async function enterNumber(page, value) {
  for (const character of String(value)) await clickKey(page, character);
  await clickKey(page, "enter");
}

async function compute(page, operator, values) {
  await page.click(`${S.picker} [data-op="${operator}"]`);
  for (const value of values) await enterNumber(page, value);
  await page.click(S.equals);
}

async function clickOperand(page, index) {
  await page.locator(S.operandInput).nth(index).click();
}

async function fillOperand(page, index, value) {
  await page.locator(S.operandInput).nth(index).fill(value);
}

async function enterEdit(page, historyIndex) {
  await page.locator(S.historyEdit).nth(historyIndex).click();
}

async function assertClosedToSnapshot(A, page, snapshot, prefix = "restore") {
  A.eq(`${prefix}.state`, await appState(page), snapshot.state);
  A.eq(`${prefix}.operator`, await appOperator(page), snapshot.operator);
  A.eq(`${prefix}.expression`, (await expressionRaw(page)).trim(), snapshot.expression);
  A.eq(`${prefix}.resultText`, await page.$eval(S.result, (el) => el.textContent || ""), snapshot.resultTextRaw);
  A.eq(`${prefix}.resultValue`, (await resultInfo(page)).value, snapshot.resultValue);
  A.eq(`${prefix}.resultError`, (await resultInfo(page)).error, snapshot.resultError);
  A.eq(`${prefix}.history`, await historySnapshots(page), snapshot.history);
  A.eq(`${prefix}.operandInputs`, await page.locator(S.operandInput).count(), 0);
  A.eq(`${prefix}.pending`, await pendingCount(page), 0);
  A.eq(`${prefix}.draftVisible`, await page.locator(S.editDraft).isVisible(), false);
  A.eq(`${prefix}.cancelVisible`, await page.locator(S.editCancel).isVisible(), false);
  A.eq(`${prefix}.calcInput`, await page.locator(S.calcInput).inputValue(), "");
  A.eq(`${prefix}.focus`, await isFocused(page, S.calcInput), true);
}

async function assertEditEntered(A, page, expectedOperator, expectedValues) {
  A.eq("enter.state", await appState(page), "edit");
  A.eq("enter.draftVisible", await page.locator(S.editDraft).isVisible(), true);
  A.eq("enter.operator", await page.locator(S.editDraft).getAttribute("data-operator"), expectedOperator);
  A.eq("enter.values", await inputValues(page), expectedValues);
}

async function measureMobileState(page) {
  return page.evaluate(({ editCancel, keypad }) => {
    const isVisible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
      return element.getClientRects().length > 0;
    };
    const controls = [...new Set(document.querySelectorAll("input,button,[data-op]"))]
      .filter(isVisible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          testid: element.getAttribute("data-testid"),
          key: element.getAttribute("data-key"),
          op: element.getAttribute("data-op"),
          width: rect.width,
          height: rect.height,
          fontSize: parseFloat(getComputedStyle(element).fontSize),
        };
      });
    return {
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      controls,
      calcFont: parseFloat(getComputedStyle(document.querySelector('[data-testid="calc-input"]')).fontSize),
      operandFonts: [...document.querySelectorAll('[data-testid="operand-input"]')]
        .map((element) => parseFloat(getComputedStyle(element).fontSize)),
      cancelVisible: isVisible(document.querySelector(editCancel)),
      keypadVisible: isVisible(document.querySelector(keypad)),
    };
  }, { editCancel: S.editCancel, keypad: S.keypad });
}

async function testH1(A) {
  const html = fs.readFileSync(ARTIFACT, "utf8");
  const bytes = Buffer.byteLength(html);
  const externalReferences = scanExternalReferences(html);
  A.ok("htmlClose", html.includes("</html>"), html.includes("</html>"));
  A.ok("minBytes", bytes >= 1024, bytes);
  A.eq("externalReferences", externalReferences, []);

  const app = await openPage();
  try {
    A.eq("pageerrors", app.pageErrors, []);
    A.eq("urlScheme", new URL(app.page.url()).protocol, "file:");
    A.note("htmlClose", true);
    A.note("bytes", bytes);
    A.note("externalRefs", externalReferences.length);
    A.note("pageerrors", app.pageErrors.length);
  } finally {
    await app.close();
  }
}

async function testH2(A) {
  const app = await openPage();
  try {
    const { page } = app;
    await compute(page, "+", ["12", "30", "8"]);
    A.eq("result", (await resultInfo(page)).value, "50");
    const cancelVisibleBefore = await page.locator(S.editCancel).isVisible();
    A.eq("cancelVisibleBefore", cancelVisibleBefore, false);

    await enterEdit(page, 0);
    const cancel = page.locator(S.editCancel);
    const label = await cancel.evaluate((el) => ({
      text: (el.textContent || "").trim(),
      aria: el.getAttribute("aria-label"),
      insideDraft: Boolean(el.closest('[data-testid="edit-draft"]')),
    }));
    A.eq("state", await appState(page), "edit");
    A.eq("draftVisible", await page.locator(S.editDraft).isVisible(), true);
    A.eq("operandInputs", await page.locator(S.operandInput).count(), 3);
    A.eq("cancelVisible", await cancel.isVisible(), true);
    A.eq("cancelEnabled", await cancel.isEnabled(), true);
    A.eq("cancelInsideDraft", label.insideDraft, true);
    A.ok("cancelLabel", Boolean(label.text || (label.aria || "").trim()), label);
    A.note("result", "50");
    A.note("cancelVisibleBefore", cancelVisibleBefore);
    A.note("state", "edit");
    A.note("inputs", 3);
    A.note("cancelVisibleEnabled", true);
  } finally {
    await app.close();
  }
}

async function testH3(A) {
  const app = await openPage();
  try {
    const { page } = app;
    await compute(page, "+", ["12", "30", "8"]);
    await compute(page, "*", ["2", "3", "4"]);
    const snapshot = await viewSnapshot(page);
    A.eq("historyBefore", snapshot.history.length, 2);
    await enterEdit(page, 1);
    A.eq("editState", await appState(page), "edit");
    const editedResult = await resultInfo(page);
    A.eq("editResultValue", editedResult.value, null);
    A.eq("editResultError", editedResult.error, null);

    await page.click(S.editCancel);
    await assertClosedToSnapshot(A, page, snapshot);
    A.note("state", snapshot.state);
    A.note("operator", snapshot.operator);
    A.note("expression", snapshot.expression);
    A.note("result", snapshot.resultValue);
    A.note("history", snapshot.history.length);
    A.note("focus", "calc-input");
  } finally {
    await app.close();
  }
}

async function testH4(A) {
  const app = await openPage();
  try {
    const { page } = app;
    await compute(page, "+", ["12", "30", "8"]);
    await compute(page, "*", ["2", "3", "4"]);
    const snapshot = await viewSnapshot(page);
    await enterEdit(page, 1);
    await fillOperand(page, 1, "5");
    A.eq("editedMiddle", (await inputValues(page))[1], "5");
    await clickOperand(page, 2);
    A.eq("lastPendingValue", (await inputValues(page))[2], "");
    A.eq("pendingChips", await chipPending(page), [null, null, "true"]);
    await page.click(S.editCancel);

    await assertClosedToSnapshot(A, page, snapshot);
    A.eq("historyCount", (await historySnapshots(page)).length, 2);
    A.eq("pageerrors", app.pageErrors, []);
    A.note("editedThenPendingDiscarded", true);
    A.note("state", snapshot.state);
    A.note("history", 2);
    A.note("operandInputs", 0);
    A.note("pending", 0);
    A.note("pageerrors", 0);
  } finally {
    await app.close();
  }
}

async function testH5(A) {
  const app = await openPage();
  try {
    const { page } = app;
    await compute(page, "+", ["12", "30"]);
    A.eq("computed", (await resultInfo(page)).value, "42");
    await page.click(S.keyOp);
    const selectView = await viewSnapshot(page);
    A.eq("select.state", selectView.state, "select");
    A.eq("select.expression", selectView.expression, "");
    A.eq("select.resultText", selectView.resultText, "");
    A.eq("select.resultValue", selectView.resultValue, null);
    A.eq("select.operator", selectView.operator, null);
    A.eq("select.history", selectView.history.length, 1);

    await enterEdit(page, 0);
    await page.click(S.editCancel);
    await assertClosedToSnapshot(A, page, selectView, "selectRestore");
    A.note("state", "select");
    A.note("expression", "");
    A.note("result", null);
    A.note("operator", null);
    A.note("history", 1);
    A.note("cancelVisible", false);
  } finally {
    await app.close();
  }
}

async function testH6(A) {
  const app = await openPage();
  try {
    const { page } = app;
    await compute(page, "+", ["12", "30", "8"]);
    await enterEdit(page, 0);
    const expressionBefore = await expressionRaw(page);
    const valuesBefore = await inputValues(page);
    await clickOperand(page, 1);
    const valuesAfter = await inputValues(page);
    const pending = await chipPending(page);
    A.eq("middleValue", valuesAfter[1], "");
    A.eq("otherValues", [valuesAfter[0], valuesAfter[2]], ["12", "8"]);
    A.eq("pendingChips", pending, [null, "true", null]);
    A.eq("expression", await expressionRaw(page), expressionBefore);
    A.eq("draftOperator", await page.locator(S.editDraft).getAttribute("data-operator"), "+");
    A.eq("history", await page.locator(S.historyItem).count(), 1);
    A.eq("focus", await isFocused(page, S.operandInput), false);
    A.eq("middleFocus", await page.evaluate(
      (selector) => document.activeElement === document.querySelectorAll(selector)[1],
      S.operandInput,
    ), true);
    A.note("values", valuesBefore);
    A.note("clickedValue", valuesAfter[1]);
    A.note("pendingChip", 1);
    A.note("expression", expressionBefore);
    A.note("focusedInput", 1);
  } finally {
    await app.close();
  }
}

async function testH7(A) {
  const app = await openPage();
  try {
    const { page } = app;
    await compute(page, "+", ["12", "30", "8"]);
    await enterEdit(page, 0);
    const expressionBefore = await expressionRaw(page);

    await clickOperand(page, 0);
    A.eq("firstStep.values", await inputValues(page), ["", "30", "8"]);
    A.eq("firstStep.pending", await chipPending(page), ["true", null, null]);
    A.eq("firstStep.expression", await expressionRaw(page), expressionBefore);

    await clickOperand(page, 2);
    A.eq("secondStep.values", await inputValues(page), ["12", "30", ""]);
    A.eq("secondStep.pending", await chipPending(page), [null, null, "true"]);
    A.eq("secondStep.expression", await expressionRaw(page), expressionBefore);

    await page.click(`${S.picker} [data-op="*"]`);
    A.eq("operatorStep.values", await inputValues(page), ["12", "30", "8"]);
    A.eq("operatorStep.pending", await pendingCount(page), 0);
    A.eq("operatorStep.operator", await page.locator(S.editDraft).getAttribute("data-operator"), "*");
    A.eq("operatorStep.history", await page.locator(S.historyItem).count(), 1);
    A.note("restoredMiddle", 30);
    A.note("restoredValues", ["12", "30", "8"]);
    A.note("pending", 0);
    A.note("operator", "*");
    A.note("history", 1);
  } finally {
    await app.close();
  }
}

async function testH8(A) {
  const app = await openPage();
  try {
    const { page } = app;
    await compute(page, "+", ["12", "30", "8"]);
    await enterEdit(page, 0);

    await clickOperand(page, 1);
    await page.keyboard.type("7");
    A.eq("typedValue", (await inputValues(page))[1], "7");
    A.eq("typedChipValue", await page.locator(S.operandChip).nth(1).getAttribute("data-value"), "7");
    let expression = await expressionText(page);
    A.ok("typedExpressionHas7", expression.includes("7"), expression);
    A.ok("typedExpressionDrops30", !expression.includes("30"), expression);

    await clickOperand(page, 2);
    A.eq("afterLastClick.values", await inputValues(page), ["12", "7", ""]);

    await clickOperand(page, 1);
    A.eq("afterMiddleClick.values", await inputValues(page), ["12", "", "8"]);

    await clickOperand(page, 2);
    const immediateValues = await inputValues(page);
    const immediatePending = await chipPending(page);
    A.eq("afterLastClickAgain.middleRecovered", immediateValues[1], "7");
    A.eq("afterLastClickAgain.lastCleared", immediateValues[2], "");
    expression = await expressionText(page);
    A.ok("afterLastClickAgain.expressionHas7", expression.includes("7"), expression);
    A.eq("afterLastClickAgain.lastPendingChip", immediatePending[2], "true");

    await clickOperand(page, 0);
    const settledValues = await inputValues(page);
    A.eq("afterSettlingLast.values", [settledValues[1], settledValues[2]], ["7", "8"]);
    A.eq("afterSettlingLast.firstCleared", settledValues[0], "");
    A.eq("afterSettlingLast.pendingChips", await chipPending(page), ["true", null, null]);
    await fillOperand(page, 0, "9");
    A.eq("firstValue", (await inputValues(page))[0], "9");
    expression = await expressionText(page);
    A.ok("firstExpressionHas9", expression.includes("9"), expression);
    A.ok("firstExpressionDrops12", !expression.includes("12"), expression);
    A.eq("history", await page.locator(S.historyItem).count(), 1);
    A.note("immediateAfterLastClick", immediateValues);
    A.note("pendingAfterLastClick", immediatePending);
    A.note("settledLastValue", settledValues[2]);
    A.note("expressionAfterEdit", expression);
    A.note("history", 1);
  } finally {
    await app.close();
  }
}

async function testH9(A) {
  const app = await openPage();
  try {
    const { page } = app;
    await compute(page, "+", ["12", "30", "8"]);
    const before = await historySnapshots(page);
    await enterEdit(page, 0);
    await clickOperand(page, 1);
    A.eq("pendingValue", (await inputValues(page))[1], "");
    A.eq("pendingChips", await pendingCount(page), 1);
    await page.click(S.equals);

    const result = await resultInfo(page);
    const after = await historySnapshots(page);
    A.eq("state", await appState(page), "result");
    A.near("resultValue", result.value, 50);
    A.eq("history", after.length, 2);
    A.eq("newRecord", {
      operator: after[0]?.operator,
      operands: after[0]?.operands,
      result: after[0]?.result,
      expression: after[0]?.expression,
    }, { operator: "+", operands: ["12", "30", "8"], result: "50", expression: "12 + 30 + 8" });
    A.eq("historyResultValue", await page.locator(S.historyResult).first().getAttribute("data-value"), "50");
    A.eq("sourceRecord", after[1], before[0]);
    A.eq("operandInputs", await page.locator(S.operandInput).count(), 0);
    A.eq("pending", await pendingCount(page), 0);
    A.eq("pageerrors", app.pageErrors, []);
    A.note("state", "result");
    A.note("result", result.value);
    A.note("history", after.length);
    A.note("newRecord", after[0]);
    A.note("sourceUnchanged", true);
    A.note("pageerrors", 0);
  } finally {
    await app.close();
  }
}

async function testH10(A) {
  const app = await openPage();
  try {
    const { page } = app;
    await compute(page, "+", ["12", "30", "8"]);
    const before = await historySnapshots(page);
    await enterEdit(page, 0);

    await clickOperand(page, 1);
    await page.keyboard.type("5");
    await page.keyboard.press("Backspace");
    A.eq("emptyValue", (await inputValues(page))[1], "");
    A.eq("emptyChipValue", await page.locator(S.operandChip).nth(1).getAttribute("data-value"), "");
    A.ok("emptyExpressionDrops30", !(await expressionText(page)).includes("30"), await expressionText(page));
    await page.click(S.equals);
    let result = await resultInfo(page);
    A.eq("empty.history", await page.locator(S.historyItem).count(), 1);
    A.eq("empty.resultValue", result.value, null);
    A.eq("empty.state", await appState(page), "edit");
    A.eq("empty.pending", await pendingCount(page), 0);

    await fillOperand(page, 1, "abc");
    A.eq("abcValue", (await inputValues(page))[1], "abc");
    await page.click(S.equals);
    result = await resultInfo(page);
    A.eq("abc.history", await page.locator(S.historyItem).count(), 1);
    A.eq("abc.resultValue", result.value, null);
    A.eq("abc.state", await appState(page), "edit");
    A.eq("abc.pending", await pendingCount(page), 0);

    await fillOperand(page, 1, "7");
    await page.click(S.equals);
    const after = await historySnapshots(page);
    result = await resultInfo(page);
    A.eq("fixed.result", result.value, "27");
    A.eq("fixed.history", after.length, 2);
    A.eq("fixed.newRecord", {
      operator: after[0]?.operator,
      operands: after[0]?.operands,
      result: after[0]?.result,
      expression: after[0]?.expression,
    }, { operator: "+", operands: ["12", "7", "8"], result: "27", expression: "12 + 7 + 8" });
    A.eq("fixed.sourceUnchanged", after[1], before[0]);
    A.eq("pageerrors", app.pageErrors, []);

    const divisionApp = await openPage();
    try {
      const divisionPage = divisionApp.page;
      await compute(divisionPage, "/", ["100", "5", "2"]);
      A.eq("division.setupResult", (await resultInfo(divisionPage)).value, "10");
      const divisionBefore = await historySnapshots(divisionPage);
      await enterEdit(divisionPage, 0);
      await clickOperand(divisionPage, 1);
      await divisionPage.keyboard.type("0");
      await divisionPage.click(S.equals);
      const divisionResult = await resultInfo(divisionPage);
      A.eq("division.state", await appState(divisionPage), "error");
      A.eq("division.error", divisionResult.error, "true");
      A.eq("division.resultValue", divisionResult.value, null);
      A.eq("division.history", await historySnapshots(divisionPage), divisionBefore);
      A.eq("division.operandInputs", await divisionPage.locator(S.operandInput).count(), 0);
      A.eq("division.pending", await pendingCount(divisionPage), 0);
      A.eq("division.pageerrors", divisionApp.pageErrors, []);
    } finally {
      await divisionApp.close();
    }
    A.note("emptyNoOp", true);
    A.note("nonfiniteNoOp", true);
    A.note("fixedResult", result.value);
    A.note("fixedHistory", after.length);
    A.note("divisionByZero", "error-no-history");
    A.note("pageerrors", 0);
  } finally {
    await app.close();
  }
}

async function testH11(A) {
  const app = await openPage();
  try {
    const { page } = app;
    await compute(page, "*", ["2", "3", "4"]);
    await compute(page, "+", ["1.5", "2.25"]);
    const before = await historySnapshots(page);
    A.eq("historyBefore", before.length, 2);

    await enterEdit(page, 1);
    await clickOperand(page, 0);
    await page.keyboard.type("10");
    await page.click(`${S.picker} [data-op="+"]`);
    A.eq("operator.values", await inputValues(page), ["10", "3", "4"]);
    A.eq("operator.operator", await page.locator(S.editDraft).getAttribute("data-operator"), "+");

    await clickOperand(page, 2);
    await page.keyboard.type("5");
    await page.locator(S.operandRemove).nth(1).click();
    A.eq("removed.values", await inputValues(page), ["10", "5"]);

    await page.locator(S.calcInput).click();
    await page.keyboard.type("2");
    A.eq("typedInCalcInput", await page.locator(S.calcInput).inputValue(), "2");
    await clickKey(page, "enter");
    A.eq("appended.values", await inputValues(page), ["10", "5", "2"]);

    await page.click(S.equals);
    const result = await resultInfo(page);
    const after = await historySnapshots(page);
    A.eq("result", result.value, "17");
    A.eq("history", after.length, 3);
    A.eq("newRecord", {
      operator: after[0]?.operator,
      operands: after[0]?.operands,
      result: after[0]?.result,
      expression: after[0]?.expression,
    }, { operator: "+", operands: ["10", "5", "2"], result: "17", expression: "10 + 5 + 2" });
    A.eq("oldRecordsUnchanged", after.slice(1), before);

    await page.reload({ waitUntil: "load" });
    A.eq("reload.history", await page.locator(S.historyItem).count(), 0);
    A.eq("reload.state", await appState(page), "select");
    A.eq("reload.operator", await appOperator(page), null);
    A.eq("reload.expression", await expressionText(page), "");
    A.eq("reload.resultValue", (await resultInfo(page)).value, null);
    A.note("editedResult", result.value);
    A.note("history", after.length);
    A.note("newRecord", after[0]);
    A.note("oldRecordsUnchanged", true);
    A.note("reload", { history: 0, state: "select" });
  } finally {
    await app.close();
  }
}

async function testH12(A) {
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
    const tag = `${viewport.width}x${viewport.height}`;
    const app = await openPage({ viewport, isMobile: true, hasTouch: true });
    try {
      const { page } = app;
      await compute(page, "+", ["12", "30", "8"]);
      await compute(page, "*", ["2", "3", "4"]);
      await enterEdit(page, 1);
      await clickOperand(page, 1);
      A.eq(`${tag}.pendingValue`, (await inputValues(page))[1], "");
      A.eq(`${tag}.pendingChips`, await pendingCount(page), 1);

      const metrics = await measureMobileState(page);
      A.ok(`${tag}.docOverflow`, metrics.docOverflow <= 1, metrics.docOverflow);
      A.ok(`${tag}.bodyOverflow`, metrics.bodyOverflow <= 1, metrics.bodyOverflow);
      const tooSmall = metrics.controls.filter((control) => control.width < 43.5 || control.height < 43.5);
      A.eq(`${tag}.tooSmallControls`, tooSmall, []);
      A.ok(`${tag}.calcFont`, metrics.calcFont >= 16, metrics.calcFont);
      A.ok(`${tag}.operandFontCount`, metrics.operandFonts.length === 3, metrics.operandFonts);
      A.ok(`${tag}.operandFonts`, metrics.operandFonts.every((font) => font >= 16), metrics.operandFonts);
      A.eq(`${tag}.cancelVisible`, metrics.cancelVisible, true);
      A.eq(`${tag}.keypadVisible`, metrics.keypadVisible, true);
      A.note(`${tag}.overflows`, [metrics.docOverflow, metrics.bodyOverflow]);
      A.note(`${tag}.controls`, metrics.controls.length);
      A.note(`${tag}.minSize`, metrics.controls.length
        ? [Math.min(...metrics.controls.map((control) => control.width)), Math.min(...metrics.controls.map((control) => control.height))]
        : []);
      A.note(`${tag}.fonts`, [metrics.calcFont, ...metrics.operandFonts]);
      A.note(`${tag}.cancelKeypadVisible`, [metrics.cancelVisible, metrics.keypadVisible]);
    } finally {
      await app.close();
    }
  }
}

async function deterministicSequence(page) {
  await compute(page, "+", ["12", "30", "8"]);
  await enterEdit(page, 0);
  await clickOperand(page, 1);
  await page.keyboard.type("7");
  await clickOperand(page, 2);
  await clickOperand(page, 1);
  await clickOperand(page, 0);
  await page.click(S.editCancel);
  await compute(page, "*", ["2", "3", "4"]);
  await enterEdit(page, 1);
  await clickOperand(page, 1);
  await page.keyboard.type("5");
  await page.click(S.equals);
  const snapshots = await historySnapshots(page);
  return snapshots.map(({ operator, operands, result, expression }) => ({
    operator,
    operands,
    result,
    expression,
  }));
}

async function testH13(A) {
  const runs = [];
  for (let index = 0; index < 2; index += 1) {
    const app = await openPage();
    try {
      runs.push(await deterministicSequence(app.page));
    } finally {
      await app.close();
    }
  }

  A.eq("first.records", runs[0].length, 3);
  A.eq("second.records", runs[1].length, 3);
  A.eq("historyJson", JSON.stringify(runs[0]), JSON.stringify(runs[1]));
  const pageErrors = monitors.reduce((total, monitor) => total + monitor.pageErrors.length, 0);
  const consoleErrors = monitors.reduce((total, monitor) => total + monitor.consoleErrors.length, 0);
  A.eq("pageerrors", pageErrors, 0);
  A.eq("consoleErrors", consoleErrors, 0);
  A.note("records", runs.map((run) => run.length));
  A.note("historyEqual", JSON.stringify(runs[0]) === JSON.stringify(runs[1]));
  A.note("pageerrors", pageErrors);
  A.note("consoleErrors", consoleErrors);
}

const TESTS = {
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
  H11: testH11,
  H12: testH12,
  H13: testH13,
};

const results = {};
for (const [id, test] of Object.entries(TESTS)) {
  const A = new Assertions();
  try {
    await withTimeout(test(A), STEP_TIMEOUT_MS, id);
    const pass = A.failures.length === 0;
    const observed = A.notes.join("; ");
    results[id] = {
      pass,
      detail: compact(pass
        ? observed || "all assertions passed"
        : `assertions: ${A.failures.join("; ")} | observed: ${observed || "(none)"}`),
    };
  } catch (error) {
    results[id] = {
      pass: false,
      detail: compact(`instrument error: ${error && error.stack ? error.stack : String(error)}`),
    };
  }
}

await browser.close();

const failed = Object.entries(results).filter(([, result]) => !result.pass).map(([id]) => id);
const artifactSha256 = sha256File(ARTIFACT);
const verifierSha256 = sha256File(SELF);
const lines = [
  `ROUND: ${ROUND}`,
  `ARTIFACT_SHA256: ${artifactSha256}`,
  `VERIFIER_SHA256: ${verifierSha256}`,
  "",
  ...Object.entries(results).map(([id, result]) => `${id} ${result.pass ? "PASS" : "FAIL"} — ${result.detail}`),
  `HARD: ${failed.length === 0 ? "PASS" : `FAIL (${failed.join(",")})`}`,
];
const text = `${lines.join("\n")}\n`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, `hard-r${ROUND}.txt`), text);
process.stdout.write(text);
process.exitCode = failed.length === 0 ? 0 : 1;
