#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_FILE);

function resolveFromScript(value, fallback) {
  const chosen = value || fallback;
  return path.isAbsolute(chosen) ? path.normalize(chosen) : path.resolve(SCRIPT_DIR, chosen);
}

const GATE_DIR = resolveFromScript(
  process.env.KEKKAI_GATE_DIR,
  path.resolve(SCRIPT_DIR, ".."),
);
const EVIDENCE_DIR = resolveFromScript(process.env.KEKKAI_EVIDENCE_DIR, SCRIPT_DIR);
const OUT_DIR = resolveFromScript(process.env.KEKKAI_OUT_DIR, EVIDENCE_DIR);
const ARTIFACT = resolveFromScript(process.env.KEKKAI_ARTIFACT, "/ws/cal_phone/index.html");
const ROUND = process.argv[2] || process.env.KEKKAI_ROUND || "1";
const ROUND_FILE_TOKEN = String(ROUND).replace(/[^A-Za-z0-9._-]/g, "_");
const ARTIFACT_URL = pathToFileURL(ARTIFACT).href;

const S = Object.freeze({
  picker: '[data-testid="op-picker"]',
  input: '[data-testid="calc-input"]',
  expression: '[data-testid="expression"]',
  result: '[data-testid="result"]',
  equals: '[data-testid="key-equals"]',
  reset: '[data-testid="key-op"]',
  history: '[data-testid="history"]',
  item: '[data-testid="history-item"]',
  historyExpression: '[data-testid="history-expression"]',
  historyResult: '[data-testid="history-result"]',
  historyEdit: '[data-testid="history-edit"]',
  editDraft: '[data-testid="edit-draft"]',
  chip: '[data-testid="operand-chip"]',
  remove: '[data-testid="operand-remove"]',
});

const OPERATORS = ["+", "-", "*", "/"];
const ACCEPTED_GLYPHS = Object.freeze({
  "+": ["+"],
  "-": ["-", "\u2212"],
  "*": ["*", "\u00d7"],
  "/": ["/", "\u00f7"],
});

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

const artifactBuffer = fs.readFileSync(ARTIFACT);
const artifactText = artifactBuffer.toString("utf8");
const artifactSha = sha256(artifactBuffer);
const verifierSha = sha256(fs.readFileSync(SCRIPT_FILE));

function oneLine(value, limit = 2600) {
  const text = String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function errorText(error) {
  return oneLine(error?.stack || error?.message || error);
}

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = [
    path.join(GATE_DIR, "node_modules", "playwright"),
    "/tmp/kekkai-pw/node_modules/playwright",
    "playwright",
  ];
  const failures = [];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      failures.push(`${candidate}: ${error.code || error.message}`);
    }
  }
  const error = new Error(`Playwright dependency unavailable; refusing to report an artifact FAIL. ${failures.join(" | ")}`);
  error.code = "DEPENDENCY_UNAVAILABLE";
  throw error;
}

let playwright;
try {
  playwright = loadPlaywright();
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

let browser;
try {
  browser = await playwright.chromium.launch({ headless: true, timeout: 30000 });
} catch (error) {
  console.error(`Playwright browser unavailable; refusing to report an artifact FAIL. ${errorText(error)}`);
  await playwright.chromium?.launch?.({ headless: true }).catch(() => {});
  process.exit(2);
}

const results = new Map();
const trackedPages = [];

async function openTrackedPage(tag, options = {}) {
  const {
    countForH12 = true,
    viewport = { width: 390, height: 844 },
    isMobile = true,
    hasTouch = true,
  } = options;
  const context = await browser.newContext({ viewport, isMobile, hasTouch });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  const track = { tag, countForH12, pageErrors: [], consoleErrors: [] };
  trackedPages.push(track);
  page.on("pageerror", (error) => track.pageErrors.push(errorText(error)));
  page.on("console", (message) => {
    if (message.type() === "error") {
      track.consoleErrors.push(oneLine(message.text()));
    }
  });
  await page.goto(ARTIFACT_URL, { waitUntil: "load" });
  return { context, page, track };
}

function record(id, passed, evidence) {
  results.set(id, { passed, evidence: oneLine(evidence) });
}

async function runCheck(id, check) {
  try {
    const evidence = await check();
    record(id, true, evidence || "all assertions passed");
  } catch (error) {
    record(id, false, errorText(error));
  }
}

function assertEmptyText(text, label) {
  assert.equal(String(text ?? "").trim(), "", `${label} is not empty: ${JSON.stringify(text)}`);
}

async function readText(page, selector) {
  return (await page.locator(selector).textContent()) ?? "";
}

async function historyCount(page) {
  return page.locator(S.item).count();
}

function assertNear(actual, expected, label) {
  const numeric = typeof actual === "number" ? actual : Number.parseFloat(actual);
  assert.ok(Number.isFinite(numeric), `${label} is not a finite numeric value: ${JSON.stringify(actual)}`);
  const delta = Math.abs(numeric - expected);
  assert.ok(delta <= 1e-9, `${label}: ${numeric} differs from ${expected} by ${delta}`);
  return `${numeric} (delta ${delta})`;
}

function expressionContains(text, operator, operands) {
  return ACCEPTED_GLYPHS[operator].some((glyph) => text.includes(glyph))
    && operands.every((operand) => text.includes(operand));
}

function pickerButtons(page) {
  return page.locator(`${S.picker} button[data-op]`);
}

async function selectOperator(page, operator) {
  assert.ok(OPERATORS.includes(operator), `invalid operator in test: ${operator}`);
  await page.locator(`${S.picker} [data-op="${operator}"]`).click();
}

async function enterOperand(page, rawValue) {
  const input = page.locator(S.input);
  await input.fill(String(rawValue));
  await input.press("Enter");
}

async function compute(page, operator, operands, equalsMode = "click") {
  await selectOperator(page, operator);
  for (const operand of operands) {
    await enterOperand(page, operand);
  }
  if (equalsMode === "key") {
    await page.keyboard.press("=");
  } else {
    await page.locator(S.equals).click();
  }
}

async function resetAndCompute(page, operator, operands, equalsMode = "click") {
  await page.locator(S.reset).click();
  await compute(page, operator, operands, equalsMode);
}

async function snapshotItem(itemLocator) {
  return itemLocator.evaluate((item) => {
    const expression = item.querySelector('[data-testid="history-expression"]');
    const result = item.querySelector('[data-testid="history-result"]');
    return {
      operator: item.getAttribute("data-operator"),
      operands: JSON.parse(item.getAttribute("data-operands")),
      expressionText: expression ? expression.textContent : null,
      resultValue: result ? result.getAttribute("data-value") : null,
      resultText: result ? result.textContent : null,
    };
  });
}

async function historySnapshots(page) {
  return page.locator(S.item).evaluateAll((items) => items.map((item) => {
    const expression = item.querySelector('[data-testid="history-expression"]');
    const result = item.querySelector('[data-testid="history-result"]');
    return {
      operator: item.getAttribute("data-operator"),
      operands: JSON.parse(item.getAttribute("data-operands")),
      expressionText: expression ? expression.textContent : null,
      resultValue: result ? result.getAttribute("data-value") : null,
      resultText: result ? result.textContent : null,
    };
  }));
}

async function chipValues(page) {
  return page.locator(S.chip).evaluateAll((chips) => chips.map((chip) => chip.getAttribute("data-value")));
}

function isExternalReference(value) {
  return /^(?:https?:)?\/\//i.test(String(value || "").trim());
}

function captureAttributeValues(text, tagName, attributeName) {
  const pattern = new RegExp(
    `<${tagName}\\b[^>]*?\\s${attributeName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`,
    "gi",
  );
  return [...text.matchAll(pattern)].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
}

function captureCssImportValues(text) {
  const pattern = /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^"'\s;)]+))/gi;
  return [...text.matchAll(pattern)].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
}

function captureCssUrlValues(text) {
  const pattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
  return [...text.matchAll(pattern)].map((match) => (match[1] ?? match[2] ?? match[3] ?? "").trim());
}

async function measureLayout(page) {
  return page.evaluate(() => {
    const controlSelector = "input, button, [data-op]";
    const isVisible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && style.visibility !== "collapse"
        && Number(style.opacity) !== 0
        && rect.width > 0
        && rect.height > 0;
    };
    const controls = [...document.querySelectorAll(controlSelector)]
      .filter(isVisible)
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        return {
          index,
          label: element.getAttribute("data-testid")
            || element.getAttribute("data-op")
            || element.id
            || element.tagName.toLowerCase(),
          width: rect.width,
          height: rect.height,
        };
      });
    const documentElement = document.documentElement;
    const body = document.body;
    const calcInput = document.querySelector('[data-testid="calc-input"]');
    return {
      documentElement: {
        scrollWidth: documentElement.scrollWidth,
        clientWidth: documentElement.clientWidth,
      },
      body: {
        scrollWidth: body.scrollWidth,
        clientWidth: body.clientWidth,
      },
      controls,
      calcFontSize: Number.parseFloat(getComputedStyle(calcInput).fontSize),
    };
  });
}

function evaluateLayout(metrics, viewport, state) {
  const prefix = `${viewport.width}x${viewport.height}/${state}`;
  const failures = [];
  for (const [label, dimensions] of [["documentElement", metrics.documentElement], ["body", metrics.body]]) {
    if (dimensions.scrollWidth > dimensions.clientWidth + 1) {
      failures.push(`${label} overflow ${dimensions.scrollWidth}>${dimensions.clientWidth}+1`);
    }
  }
  for (const control of metrics.controls) {
    if (control.width + 0.5 < 44 || control.height + 0.5 < 44) {
      failures.push(`${control.label}@${control.index} ${control.width.toFixed(2)}x${control.height.toFixed(2)}<44`);
    }
  }
  if (!(metrics.calcFontSize >= 16)) {
    failures.push(`calc-input font-size ${metrics.calcFontSize}<16`);
  }
  assert.equal(failures.length, 0, `${prefix}: ${failures.join("; ")}`);
  return {
    prefix,
    documentElement: `${metrics.documentElement.scrollWidth}/${metrics.documentElement.clientWidth}`,
    body: `${metrics.body.scrollWidth}/${metrics.body.clientWidth}`,
    minWidth: metrics.controls.length ? Math.min(...metrics.controls.map((control) => control.width)) : null,
    minHeight: metrics.controls.length ? Math.min(...metrics.controls.map((control) => control.height)) : null,
    controlCount: metrics.controls.length,
    calcFontSize: metrics.calcFontSize,
  };
}

await runCheck("H1", async () => {
  assert.ok(artifactBuffer.length >= 1024, `artifact byte length ${artifactBuffer.length} < 1024`);
  assert.ok(artifactText.includes("</html>"), "missing literal </html>");
  const references = {
    "script[src]": captureAttributeValues(artifactText, "script", "src").filter(isExternalReference),
    "link[href]": captureAttributeValues(artifactText, "link", "href").filter(isExternalReference),
    "img[src]": captureAttributeValues(artifactText, "img", "src").filter(isExternalReference),
    "@import": captureCssImportValues(artifactText).filter(isExternalReference),
    "url(...)": captureCssUrlValues(artifactText).filter(isExternalReference),
  };
  const total = Object.values(references).reduce((sum, entries) => sum + entries.length, 0);
  assert.equal(total, 0, `external references: ${JSON.stringify(references)}`);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(errorText(error)));
  await page.goto(ARTIFACT_URL, { waitUntil: "load" });
  await page.waitForTimeout(50);
  await context.close();
  assert.equal(pageErrors.length, 0, `file load pageerrors: ${pageErrors.join(" | ")}`);
  return `bytes=${artifactBuffer.length}, closing-html=present, external-refs=${JSON.stringify(Object.fromEntries(Object.entries(references).map(([key, value]) => [key, value.length])))}, file-load-pageerrors=0`;
});

await runCheck("H2", async () => {
  const evidence = [];
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(20000);
    try {
      await page.goto(ARTIFACT_URL, { waitUntil: "load" });
      await compute(page, "+", ["12", "30", "8"], "click");
      await resetAndCompute(page, "*", ["2", "3", "4"], "click");
      const resultMetrics = await measureLayout(page);
      evidence.push(evaluateLayout(resultMetrics, viewport, "result"));

      const olderEdit = page.locator(S.item).nth(1).locator(S.historyEdit);
      await olderEdit.click();
      assert.equal(await page.locator(S.editDraft).isVisible(), true, "edit-draft not visible after older edit click");
      assert.equal(await historyCount(page), 2, "history count changed when entering edit state");
      const editMetrics = await measureLayout(page);
      evidence.push(evaluateLayout(editMetrics, viewport, "edit"));
    } finally {
      await context.close();
    }
  }
  return evidence.map((entry) => `${entry.prefix}: scroll/client doc=${entry.documentElement} body=${entry.body}, min=${entry.minWidth.toFixed(2)}x${entry.minHeight.toFixed(2)}, controls=${entry.controlCount}, font=${entry.calcFontSize}`).join("; ");
});

await runCheck("H3", async () => {
  const { context, page } = await openTrackedPage("H3");
  try {
    const buttons = await pickerButtons(page).evaluateAll((elements) => elements.map((element) => element.getAttribute("data-op")));
    assert.equal(buttons.length, 4, `op-picker button count ${buttons.length}`);
    assert.deepEqual([...buttons].sort(), [...OPERATORS].sort(), `op set ${JSON.stringify(buttons)}`);
    assert.equal(await page.locator("[data-op]").count(), 4, "page-level [data-op] count is not 4");
    assert.equal(await page.locator(S.picker).isVisible(), true, "op-picker is not visible initially");
    assert.equal(await page.locator(S.input).isDisabled(), true, "calc-input not disabled initially");
    assertEmptyText(await readText(page, S.expression), "initial expression");
    assertEmptyText(await readText(page, S.result), "initial result");
    assert.equal(await page.locator(S.history).isVisible(), true, "history is not visible initially");
    assert.equal(await historyCount(page), 0, "initial history count is not zero");

    await page.keyboard.type("12");
    await page.keyboard.press("Enter");
    assertEmptyText(await readText(page, S.expression), "expression after disabled-input typing");

    await page.locator(`${S.picker} [data-op="+"]`).click();
    assert.equal(await page.locator(S.input).isDisabled(), false, "calc-input remains disabled after selecting +");
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('[data-testid="calc-input"]')), true, "calc-input did not receive focus");
    assertEmptyText(await readText(page, S.expression), "expression after selecting +");
    assertEmptyText(await readText(page, S.result), "result after selecting +");
    assert.equal(await historyCount(page), 0, "history count changed after selecting +");
    return `ops=${JSON.stringify(buttons)}, initial disabled=true, blank expression/result, history-visible=true/count=0, disabled typing ignored, + enables+focuses input, history=0`;
  } finally {
    await context.close();
  }
});

await runCheck("H4", async () => {
  const first = await openTrackedPage("H4-keyboard");
  try {
    const { page } = first;
    await selectOperator(page, "+");
    await enterOperand(page, "12");
    await enterOperand(page, "30");
    assert.equal(await page.locator(S.input).inputValue(), "", "input was not cleared after operand commits");
    const beforeEquals = await readText(page, S.expression);
    assert.ok(beforeEquals.includes("12") && beforeEquals.includes("30") && beforeEquals.includes("+"), `expression lacks committed operands: ${beforeEquals}`);
    await page.locator(S.input).type("8");
    const uncommitted = await readText(page, S.expression);
    assert.equal(uncommitted.includes("8"), false, `uncommitted 8 leaked into expression: ${uncommitted}`);
    await page.keyboard.press("=");
    const afterEquals = await readText(page, S.expression);
    assert.ok(afterEquals.includes("8"), `keyboard = did not commit trailing operand: ${afterEquals}`);
    const resultValue = await page.locator(S.result).getAttribute("data-value");
    const delta = assertNear(resultValue, 50, "keyboard = result");
    assert.equal(await historyCount(page), 1, "keyboard = did not create exactly one history item");
    assert.equal(await page.locator(S.input).isDisabled(), true, "input not disabled after keyboard = result");
    await first.context.close();

    const second = await openTrackedPage("H4-click-equals");
    try {
      await compute(second.page, "*", ["2", "3", "4"], "click");
      const clickResult = await second.page.locator(S.result).getAttribute("data-value");
      const clickDelta = assertNear(clickResult, 24, "key-equals result");
      assert.equal(await historyCount(second.page), 1, "key-equals did not create exactly one history item");
      return `keyboard: expression-before=${JSON.stringify(beforeEquals)}, uncommitted-has-8=false, expression-after=${JSON.stringify(afterEquals)}, result=${delta}, history=1; click: */2/3/4 result=${clickDelta}, history=1`;
    } finally {
      await second.context.close();
    }
  } finally {
    if (first.context) {
      await first.context.close().catch(() => {});
    }
  }
});

await runCheck("H5", async () => {
  const cases = [
    { operator: "+", operands: ["12", "30", "8"], expected: 50 },
    { operator: "-", operands: ["10", "4", "3"], expected: 3 },
    { operator: "*", operands: ["2", "3", "4"], expected: 24 },
    { operator: "/", operands: ["100", "5", "2"], expected: 10 },
    { operator: "+", operands: ["1.5", "2.25"], expected: 3.75 },
  ];
  const evidence = [];
  for (let index = 0; index < cases.length; index += 1) {
    const testCase = cases[index];
    const session = await openTrackedPage(`H5-case-${index + 1}`);
    try {
      await compute(session.page, testCase.operator, testCase.operands, "click");
      const value = await session.page.locator(S.result).getAttribute("data-value");
      const delta = assertNear(value, testCase.expected, `case ${index + 1} result`);
      const expression = await readText(session.page, S.expression);
      assert.ok(expressionContains(expression, testCase.operator, testCase.operands), `case ${index + 1} expression ${JSON.stringify(expression)} lacks operands/glyph`);
      evidence.push(`${testCase.operator}${JSON.stringify(testCase.operands)}=${delta}`);
    } finally {
      await session.context.close();
    }
  }
  return evidence.join("; ");
});

await runCheck("H6", async () => {
  const { context, page } = await openTrackedPage("H6");
  try {
    await compute(page, "+", ["12", "30", "8"], "click");
    assert.equal(await historyCount(page), 1, "first calculation history count is not 1");
    const original = await snapshotItem(page.locator(S.item).nth(0));
    assert.deepEqual(original.operands, ["12", "30", "8"], "first item operands");
    assertNear(original.resultValue, 50, "first item result");

    await page.locator(S.reset).click();
    assert.equal(await page.locator(S.picker).isVisible(), true, "op-picker not visible after key-op");
    assert.equal(await page.locator(S.input).isDisabled(), true, "input not disabled after key-op");
    assertEmptyText(await readText(page, S.expression), "expression after key-op");
    assertEmptyText(await readText(page, S.result), "result text after key-op");
    assert.equal(await page.locator(S.result).getAttribute("data-value"), null, "result retained data-value after key-op");
    assert.equal(await page.locator(S.result).getAttribute("data-error"), null, "result retained data-error after key-op");
    assert.equal(await historyCount(page), 1, "key-op changed history count");
    assert.deepEqual(await snapshotItem(page.locator(S.item).nth(0)), original, "key-op changed retained history item");

    await compute(page, "*", ["2", "3", "4"], "click");
    assert.equal(await historyCount(page), 2, "second calculation history count is not 2");
    const newest = await snapshotItem(page.locator(S.item).nth(0));
    assert.equal(newest.operator, "*", "newest history item operator is not *");
    assert.deepEqual(newest.operands, ["2", "3", "4"], "newest item operands");
    assertNear(newest.resultValue, 24, "newest item result");
    return `first=${JSON.stringify(original)}; key-op preserved history and cleared result/value/error; newest=${newest.operator}${JSON.stringify(newest.operands)}=${newest.resultValue}, history=2`;
  } finally {
    await context.close();
  }
});

await runCheck("H7", async () => {
  const { context, page, track } = await openTrackedPage("H7");
  try {
    await selectOperator(page, "+");
    await page.locator(S.input).press("Enter");
    assertEmptyText(await readText(page, S.expression), "expression after empty Enter");
    assertEmptyText(await readText(page, S.result), "result after empty Enter");
    assert.equal(await page.locator(S.result).getAttribute("data-error"), null, "empty Enter set data-error");
    assert.equal(await historyCount(page), 0, "empty Enter changed history count");

    await page.locator(S.reset).click();
    await selectOperator(page, "/");
    await enterOperand(page, "5");
    await enterOperand(page, "0");
    await page.locator(S.equals).click();
    assert.equal(await page.locator(S.result).getAttribute("data-error"), "true", "division by zero did not set data-error=true");
    const divisionErrorText = await readText(page, S.result);
    assert.ok(divisionErrorText.trim().length > 0, "division-by-zero result text is empty");
    assert.equal(await historyCount(page), 0, "division by zero added history");
    await page.waitForTimeout(50);
    assert.equal(track.pageErrors.length, 0, `division by zero pageerrors: ${track.pageErrors.join(" | ")}`);

    await page.locator(S.reset).click();
    await compute(page, "+", ["1", "2"], "key");
    const value = await page.locator(S.result).getAttribute("data-value");
    const delta = assertNear(value, 3, "post-error + 1/2 result");
    assert.equal(await historyCount(page), 1, "post-error calculation history count is not 1");
    return `empty-Enter left blank/no-error/history=0; /5/0 data-error=true text=${JSON.stringify(divisionErrorText)}, history=0/pageerrors=0; post-error +1/2=${delta}, history=1`;
  } finally {
    await context.close();
  }
});

await runCheck("H8", async () => {
  const { context, page } = await openTrackedPage("H8");
  const cases = [
    { operator: "+", operands: ["12", "30", "8"], expected: 50 },
    { operator: "-", operands: ["10", "4", "3"], expected: 3 },
    { operator: "*", operands: ["2", "3", "4"], expected: 24 },
    { operator: "+", operands: ["1.5", "2.25"], expected: 3.75 },
  ];
  try {
    const stepEvidence = [];
    for (let index = 0; index < cases.length; index += 1) {
      const testCase = cases[index];
      if (index === 0) {
        await compute(page, testCase.operator, testCase.operands, "click");
      } else {
        await resetAndCompute(page, testCase.operator, testCase.operands, "click");
      }
      assert.equal(await historyCount(page), index + 1, `history count after calculation ${index + 1}`);
      const newest = await snapshotItem(page.locator(S.item).nth(0));
      assert.equal(newest.operator, testCase.operator, `newest operator after calculation ${index + 1}`);
      assert.deepEqual(newest.operands, testCase.operands, `newest operands after calculation ${index + 1}`);
      assertNear(newest.resultValue, testCase.expected, `newest result after calculation ${index + 1}`);
      assert.ok((newest.expressionText || "").trim().length > 0, `newest expression empty after calculation ${index + 1}`);
      assert.ok(expressionContains(newest.expressionText, testCase.operator, testCase.operands), `newest expression lacks operands/glyph after calculation ${index + 1}: ${newest.expressionText}`);
      assert.equal(await page.locator(S.item).nth(0).locator(S.historyEdit).isVisible(), true, `newest history-edit not visible after calculation ${index + 1}`);
      stepEvidence.push(`#${index + 1}:${newest.operator}${JSON.stringify(newest.operands)}=${newest.resultValue}`);
    }
    const finalSnapshots = await historySnapshots(page);
    assert.equal(finalSnapshots.length, 4, "final history length is not 4");
    const expectedOrder = [...cases].reverse();
    for (let index = 0; index < expectedOrder.length; index += 1) {
      const expected = expectedOrder[index];
      const actual = finalSnapshots[index];
      assert.equal(actual.operator, expected.operator, `final index ${index} operator`);
      assert.deepEqual(actual.operands, expected.operands, `final index ${index} operands`);
      assertNear(actual.resultValue, expected.expected, `final index ${index} result`);
      assert.ok(expressionContains(actual.expressionText, expected.operator, expected.operands), `final index ${index} expression content`);
      assert.equal(await page.locator(S.item).nth(index).locator(S.historyEdit).isVisible(), true, `final index ${index} history-edit not visible`);
    }
    return `${stepEvidence.join("; ")}; final-order=${finalSnapshots.map((item) => `${item.operator}${JSON.stringify(item.operands)}=${item.resultValue}`).join(" | ")}`;
  } finally {
    await context.close();
  }
});

let h9Session = null;
await runCheck("H9", async () => {
  h9Session = await openTrackedPage("H9-H10");
  const { context, page } = h9Session;
  try {
    await compute(page, "*", ["2", "3", "4"], "click");
    await resetAndCompute(page, "+", ["1.5", "2.25"], "click");
    assert.equal(await historyCount(page), 2, "pre-edit history count is not 2");
    const before = await historySnapshots(page);
    h9Session.before = before;

    await page.locator(S.item).nth(1).locator(S.historyEdit).click();
    assert.equal(await page.locator(S.editDraft).isVisible(), true, "edit-draft not visible");
    assert.equal(await page.locator(S.editDraft).getAttribute("data-operator"), "*", "edit-draft operator is not *");
    assert.deepEqual(await chipValues(page), ["2", "3", "4"], "edit chips are not [2,3,4]");
    assert.equal(await page.locator(S.input).isDisabled(), false, "calc-input disabled in edit state");
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('[data-testid="calc-input"]')), true, "calc-input not focused in edit state");
    assert.equal(await page.locator(S.picker).isVisible(), true, "op-picker not visible in edit state");
    assert.equal(await historyCount(page), 2, "history count changed entering edit");
    assert.deepEqual(await historySnapshots(page), before, "history snapshots changed entering edit");

    await page.locator(`${S.picker} [data-op="+"]`).click();
    assert.equal(await page.locator(S.editDraft).getAttribute("data-operator"), "+", "edit-draft operator did not change to +");
    assert.deepEqual(await chipValues(page), ["2", "3", "4"], "changing operator changed chips");
    assert.deepEqual(await historySnapshots(page), before, "changing operator changed history snapshots");
    return `history-before=${before.map((item) => `${item.operator}${JSON.stringify(item.operands)}=${item.resultValue}`).join(" | ")}; edit draft *=chips[2,3,4], input enabled/focused, picker visible; changed to + with chips and history unchanged`;
  } catch (error) {
    throw error;
  }
});

await runCheck("H10", async () => {
  assert.ok(h9Session?.context && h9Session?.page, "H9 did not leave an editable session");
  const { context, page, track, before } = h9Session;
  try {
    const middleChip = page.locator(S.chip).nth(1);
    assert.equal(await middleChip.getAttribute("data-value"), "3", "middle chip value is not 3");
    await middleChip.locator(S.remove).click();
    assert.deepEqual(await chipValues(page), ["2", "4"], "chip removal did not yield [2,4]");

    await page.locator(S.input).fill("10");
    await page.locator(S.input).press("Enter");
    assert.deepEqual(await chipValues(page), ["2", "4", "10"], "appending 10 did not yield [2,4,10]");

    await page.keyboard.press("=");
    const value = await page.locator(S.result).getAttribute("data-value");
    const delta = assertNear(value, 16, "edited draft result");
    assert.equal(await historyCount(page), 3, "edited calculation history count is not 3");
    const newest = await snapshotItem(page.locator(S.item).nth(0));
    assert.equal(newest.operator, "+", "new history operator is not +");
    assert.deepEqual(newest.operands, ["2", "4", "10"], "new history operands are not [2,4,10]");
    assertNear(newest.resultValue, 16, "new history result");
    assert.equal(await page.locator(S.editDraft).isVisible(), false, "edit-draft still visible after successful edit");
    const afterSuccessfulEdit = await historySnapshots(page);
    assert.deepEqual(afterSuccessfulEdit.slice(1), before, "original records changed or reordered after successful edit");

    await page.locator(S.item).nth(0).locator(S.historyEdit).click();
    assert.deepEqual(await chipValues(page), ["2", "4", "10"], "new item edit chips differ");
    while ((await page.locator(S.chip).count()) > 0) {
      await page.locator(S.chip).first().locator(S.remove).click();
    }
    assert.deepEqual(await chipValues(page), [], "not all chips were removed");
    const errorsBeforeEquals = track.pageErrors.length;
    await page.keyboard.press("=");
    await page.waitForTimeout(50);
    assert.equal(await historyCount(page), 3, "empty edited draft added history");
    assert.equal(track.pageErrors.length, errorsBeforeEquals, `empty edited draft pageerrors: ${track.pageErrors.slice(errorsBeforeEquals).join(" | ")}`);
    return `removed-3=>[2,4], appended-10=>[2,4,10], =${delta}, history=3, newest=${newest.operator}${JSON.stringify(newest.operands)}=${newest.resultValue}, edit ended, originals unchanged; delete-all + = kept history=3 and pageerrors=0`;
  } finally {
    await context.close();
  }
});

await runCheck("H11", async () => {
  const first = await openTrackedPage("H11-reload");
  try {
    await compute(first.page, "+", ["12", "30", "8"], "click");
    await resetAndCompute(first.page, "*", ["2", "3", "4"], "click");
    assert.equal(await historyCount(first.page), 2, "pre-reload history count is not 2");
    const errorsBeforeReload = first.track.pageErrors.length;
    await first.page.reload({ waitUntil: "load" });
    assert.equal(await historyCount(first.page), 0, "history survived reload");
    assert.equal(await first.page.locator(S.picker).isVisible(), true, "op-picker not visible after reload");
    assert.equal(await first.page.locator(S.input).isDisabled(), true, "input enabled after reload");
    assertEmptyText(await readText(first.page, S.expression), "expression after reload");
    assertEmptyText(await readText(first.page, S.result), "result after reload");
    await first.page.waitForTimeout(50);
    assert.equal(first.track.pageErrors.length, errorsBeforeReload, `reload pageerrors: ${first.track.pageErrors.slice(errorsBeforeReload).join(" | ")}`);
    await first.context.close();

    const fresh = await openTrackedPage("H11-fresh-context");
    try {
      assert.equal(await historyCount(fresh.page), 0, "fresh context history count is not zero");
      assert.equal(await fresh.page.locator(S.picker).isVisible(), true, "fresh context op-picker not visible");
      return `two calculations history=2; reload history=0, select state restored, pageerrors=0; new context history=0`;
    } finally {
      await fresh.context.close();
    }
  } finally {
    await first.context.close().catch(() => {});
  }
});

await runCheck("H12", async () => {
  const relevant = trackedPages.filter((entry) => entry.countForH12);
  const pageErrors = relevant.flatMap((entry) => entry.pageErrors.map((message) => `${entry.tag}: ${message}`));
  const consoleErrors = relevant.flatMap((entry) => entry.consoleErrors.map((message) => `${entry.tag}: ${message}`));
  assert.equal(pageErrors.length, 0, `pageerrors across H3-H11: ${pageErrors.join(" | ")}`);
  assert.equal(consoleErrors.length, 0, `console errors across H3-H11: ${consoleErrors.join(" | ")}`);

  const sequence = [
    { operator: "+", operands: ["12", "30", "8"] },
    { operator: "-", operands: ["10", "4", "3"] },
    { operator: "*", operands: ["2", "3", "4"] },
    { operator: "+", operands: ["1.5", "2.25"] },
  ];
  async function serializeFreshHistory(tag) {
    const session = await openTrackedPage(tag, { countForH12: false });
    try {
      for (let index = 0; index < sequence.length; index += 1) {
        const testCase = sequence[index];
        if (index === 0) {
          await compute(session.page, testCase.operator, testCase.operands, "click");
        } else {
          await resetAndCompute(session.page, testCase.operator, testCase.operands, "click");
        }
      }
      await session.page.waitForTimeout(50);
      const entries = await session.page.locator(S.item).evaluateAll((items) => items.map((item) => {
        const expression = item.querySelector('[data-testid="history-expression"]');
        const result = item.querySelector('[data-testid="history-result"]');
        return {
          operator: item.getAttribute("data-operator"),
          operands: JSON.parse(item.getAttribute("data-operands")),
          resultValue: result ? result.getAttribute("data-value") : null,
          expressionText: expression ? expression.textContent : null,
        };
      }));
      return { entries, track: session.track };
    } finally {
      await session.context.close();
    }
  }

  const first = await serializeFreshHistory("H12-fresh-1");
  const second = await serializeFreshHistory("H12-fresh-2");
  assert.equal(first.entries.length, 4, `first fresh sequence history count ${first.entries.length}`);
  assert.equal(second.entries.length, 4, `second fresh sequence history count ${second.entries.length}`);
  assert.deepEqual(first.entries, second.entries, "fresh-load history serializations differ");
  assert.equal(first.track.pageErrors.length + first.track.consoleErrors.length, 0, "first H12 load errors");
  assert.equal(second.track.pageErrors.length + second.track.consoleErrors.length, 0, "second H12 load errors");
  return `H3-H11 tracked pages=${relevant.length}, pageerrors=${pageErrors.length}, console-errors=${consoleErrors.length}; two fresh 4-calc histories deep-equal, entries=${JSON.stringify(first.entries)}`;
});

await browser.close();

const orderedIds = Array.from({ length: 12 }, (_, index) => `H${index + 1}`);
const failedIds = orderedIds.filter((id) => !results.get(id)?.passed);
const hardPass = failedIds.length === 0;
const lines = [
  `ROUND: ${ROUND}`,
  `ARTIFACT_SHA256: ${artifactSha}`,
  `VERIFIER_SHA256: ${verifierSha}`,
  ...orderedIds.map((id) => {
    const result = results.get(id) || { passed: false, evidence: "check did not run" };
    return `${id} ${result.passed ? "PASS" : "FAIL"} \u2014 ${oneLine(result.evidence, 6000)}`;
  }),
  hardPass ? "HARD: PASS" : `HARD: FAIL (${failedIds.join(",")})`,
];
const report = `${lines.join("\n")}\n`;

fs.mkdirSync(OUT_DIR, { recursive: true });
const hardPath = path.join(OUT_DIR, `hard-r${ROUND_FILE_TOKEN}.txt`);
fs.writeFileSync(hardPath, report, "utf8");
process.stdout.write(report);
process.exitCode = hardPass ? 0 : 1;
