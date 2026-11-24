import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { launchBrowser, openApp } from "../../../tests/lib/browser.mjs";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_FILE);
const scriptPath = (value, fallback) => {
  const target = value || fallback;
  return path.isAbsolute(target) ? path.normalize(target) : path.resolve(SCRIPT_DIR, target);
};
const DEFAULT_ARTIFACT = path.resolve(SCRIPT_DIR, "../../../index.html");
const ARTIFACT = scriptPath(process.env.KEKKAI_ARTIFACT, DEFAULT_ARTIFACT);
const OUT_DIR = scriptPath(process.env.KEKKAI_OUT_DIR, path.join(SCRIPT_DIR, "out"));
const ROUND = String(process.argv.slice(2).find((value) => /^\d+$/.test(value)) || process.env.KEKKAI_ROUND || "1");
const H_IDS = ["H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H9", "H10", "H11", "H12", "H13"];

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
  historyExpression: '[data-testid="history-expression"]',
  historyResult: '[data-testid="history-result"]',
  historyEdit: 'button[data-testid="history-edit"]',
  editDraft: '[data-testid="edit-draft"]',
  editCancel: 'button[data-testid="edit-cancel"]',
  operandChip: '[data-testid="operand-chip"]',
  operandInput: 'input[data-testid="operand-input"]',
  operandRemove: 'button[data-testid="operand-remove"]',
});

const KEYPAD_KEYS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "backspace", "enter", "equals"];
const OPERATORS = ["+", "-", "*", "/"];
const OPENED_APPS = [];

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function fmt(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

class Recorder {
  constructor(id) {
    this.id = id;
    this.checks = [];
    this.observations = [];
  }

  check(name, pass, detail = "") {
    this.checks.push({ name, pass: Boolean(pass), detail: cleanText(detail) });
    return Boolean(pass);
  }

  eq(name, actual, expected, detail = "") {
    const pass = isDeepStrictEqual(actual, expected);
    return this.check(
      name,
      pass,
      pass ? "" : `expected=${fmt(expected)} actual=${fmt(actual)}${detail ? ` ${detail}` : ""}`,
    );
  }

  near(name, actual, expected, tolerance = 1e-9) {
    const value = Number(actual);
    const pass = Number.isFinite(value) && Math.abs(value - expected) <= tolerance;
    return this.check(name, pass, pass ? "" : `expected=${expected}±${tolerance} actual=${fmt(actual)}`);
  }

  observe(name, value) {
    this.observations.push(`${name}=${fmt(value)}`);
  }

  result() {
    const failed = this.checks.filter((item) => !item.pass);
    if (failed.length) {
      const details = failed.slice(0, 8).map((item) => `${item.name}: ${item.detail || "failed"}`).join(" | ");
      return {
        pass: false,
        detail: `checks=${this.checks.length - failed.length}/${this.checks.length}; ${details}${this.observations.length ? `; ${this.observations.join("; ")}` : ""}`,
      };
    }
    return {
      pass: true,
      detail: `checks=${this.checks.length}/${this.checks.length}${this.observations.length ? `; ${this.observations.join("; ")}` : ""}`,
    };
  }
}

async function open(browser, options = {}) {
  const app = await openApp(browser, ARTIFACT, options);
  app.page.setDefaultTimeout(20000);
  OPENED_APPS.push(app);
  return app;
}

async function close(app) {
  if (app) await app.close();
}

async function compute(page, operator, values) {
  await page.click(`${S.picker} [data-op="${operator}"]`);
  for (const value of values) {
    for (const character of String(value)) await page.click(`${S.keypad} [data-key="${character}"]`);
    await page.click(`${S.keypad} [data-key="enter"]`);
  }
  await page.click(S.equals);
}

async function clickHistoryEdit(page, index) {
  await page.locator(S.historyEdit).nth(index).click();
}

async function operandInput(page, index) {
  return page.locator(S.operandInput).nth(index);
}

async function operandValues(page) {
  return page.$$eval(S.operandInput, (inputs) => inputs.map((input) => input.value));
}

async function pendingFlags(page) {
  return page.$$eval(S.operandChip, (chips) => chips.map((chip) => chip.getAttribute("data-pending") === "true"));
}

async function pendingCount(page) {
  return page.locator('[data-pending="true"]').count();
}

async function viewSnapshot(page) {
  return page.evaluate((selectors) => {
    const app = document.querySelector(selectors.app);
    const expression = document.querySelector(selectors.expression);
    const result = document.querySelector(selectors.result);
    return {
      state: app ? app.getAttribute("data-state") : null,
      operator: app ? app.getAttribute("data-operator") : null,
      expression: expression ? expression.textContent || "" : "",
      resultText: result ? result.textContent || "" : "",
      resultValue: result ? result.getAttribute("data-value") : null,
      resultError: result ? result.getAttribute("data-error") : null,
    };
  }, S);
}

async function historySnapshots(page) {
  return page.$$eval(
    S.historyItem,
    (items, selectors) =>
      items.map((item) => {
        const expression = item.querySelector(selectors.historyExpression);
        const result = item.querySelector(selectors.historyResult);
        return {
          operator: item.getAttribute("data-operator"),
          operands: JSON.parse(item.getAttribute("data-operands") || "[]"),
          expression: expression ? expression.textContent || "" : "",
          result: result ? result.getAttribute("data-value") : null,
          resultText: result ? result.textContent || "" : "",
        };
      }),
    S,
  );
}

function historyCore(history) {
  return history.map(({ operator, operands, result, expression }) => ({ operator, operands, result, expression }));
}

async function historyCount(page) {
  return page.locator(S.historyItem).count();
}

async function draftInfo(page) {
  return page.$eval(S.editDraft, (draft) => ({
    hidden: draft.hidden,
    visible: draft.getClientRects().length > 0,
    operator: draft.getAttribute("data-operator"),
  }));
}

async function activeIs(page, selector, index = 0) {
  return page.evaluate(
    ({ selector, index }) => document.activeElement === document.querySelectorAll(selector)[index],
    { selector, index },
  );
}

async function assertCancelRestore(rec, prefix, page, beforeView, beforeHistory) {
  const after = await viewSnapshot(page);
  rec.eq(`${prefix}-state`, after.state, beforeView.state);
  rec.eq(`${prefix}-operator`, after.operator, beforeView.operator);
  rec.eq(`${prefix}-expression`, after.expression.trim(), beforeView.expression.trim());
  rec.eq(`${prefix}-result-text`, after.resultText, beforeView.resultText);
  rec.eq(`${prefix}-result-value`, after.resultValue, beforeView.resultValue);
  rec.eq(`${prefix}-result-error`, after.resultError, beforeView.resultError);
  rec.eq(`${prefix}-history`, await historySnapshots(page), beforeHistory);
  rec.eq(`${prefix}-operand-inputs`, await page.locator(S.operandInput).count(), 0);
  rec.eq(`${prefix}-edit-hidden`, (await draftInfo(page)).visible, false);
  rec.eq(`${prefix}-calc-empty`, await page.locator(S.calcInput).inputValue(), "");
  rec.eq(`${prefix}-focus-calc`, await activeIs(page, S.calcInput), true);
  rec.eq(`${prefix}-no-pending`, await pendingCount(page), 0);
}

function externalReferences(html) {
  const refs = [];
  const isExternal = (value) => /^(?:https?:)?\/\//i.test(String(value || "").trim());
  const add = (kind, value) => {
    if (isExternal(value)) refs.push({ kind, value: String(value).trim() });
  };
  const attrPattern = (tag, attr) =>
    new RegExp(`<${tag}\\b[^>]*\\b${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "gi");
  for (const [tag, attr, kind] of [
    ["script", "src", "script-src"],
    ["link", "href", "link-href"],
    ["img", "src", "img-src"],
  ]) {
    const pattern = attrPattern(tag, attr);
    for (const match of html.matchAll(pattern)) add(kind, match[1] ?? match[2] ?? match[3] ?? "");
  }
  const imports = /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^"')\s;]+))/gi;
  for (const match of html.matchAll(imports)) add("css-import", match[1] ?? match[2] ?? match[3] ?? "");
  const urls = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
  for (const match of html.matchAll(urls)) add("css-url", match[1] ?? match[2] ?? match[3] ?? "");
  return refs;
}

async function testH1(browser, rec) {
  let buffer;
  let html = "";
  try {
    buffer = fs.readFileSync(ARTIFACT);
    html = buffer.toString("utf8");
  } catch (error) {
    rec.check("artifact-readable", false, error.stack || String(error));
    return;
  }
  rec.check("closing-html", html.includes("</html>"));
  rec.check("size-at-least-1024", buffer.length >= 1024, `bytes=${buffer.length}`);
  const refs = externalReferences(html);
  rec.eq("external-resource-count", refs.length, 0, fmt(refs));
  const app = await open(browser);
  try {
    await app.page.waitForTimeout(100);
    rec.eq("pageerror-count", app.pageErrors.length, 0, app.pageErrors.join(" | "));
    rec.observe("bytes", buffer.length);
    rec.observe("externalRefs", refs);
  } finally {
    await close(app);
  }
}

async function testH2(browser, rec) {
  const app = await open(browser);
  try {
    const page = app.page;
    const ops = await page.$$eval(`${S.picker} [data-op]`, (buttons) => buttons.map((button) => button.getAttribute("data-op")));
    const keys = await page.$$eval(`${S.keypad} [data-key]`, (buttons) => buttons.map((button) => button.getAttribute("data-key")));
    rec.eq("operator-buttons", ops, OPERATORS);
    rec.eq("keypad-key-count", keys.length, KEYPAD_KEYS.length, fmt(keys));
    rec.check("keypad-keys-present", KEYPAD_KEYS.every((key) => keys.includes(key)), fmt(keys));

    await compute(page, "+", ["12", "30", "8"]);
    rec.eq("computed-state", (await viewSnapshot(page)).state, "result");
    rec.eq("cancel-hidden-outside-edit", await page.locator(S.editCancel).isVisible(), false);
    await clickHistoryEdit(page, 0);
    rec.eq("state-after-edit", (await viewSnapshot(page)).state, "edit");
    rec.eq("draft-visible", (await draftInfo(page)).visible, true);
    rec.eq("operand-input-count", await page.locator(S.operandInput).count(), 3);
    rec.eq("cancel-visible", await page.locator(S.editCancel).isVisible(), true);
    rec.eq("cancel-enabled", await page.locator(S.editCancel).isEnabled(), true);
    const cancelName = await page.locator(S.editCancel).evaluate((button) => ({
      text: (button.textContent || "").trim(),
      aria: button.getAttribute("aria-label"),
    }));
    rec.check("cancel-name-present", Boolean(cancelName.text || (cancelName.aria || "").trim()), fmt(cancelName));
    rec.observe("operators", ops);
    rec.observe("cancelName", cancelName.text || cancelName.aria);
  } finally {
    await close(app);
  }
}

async function testH3(browser, rec) {
  const app = await open(browser);
  try {
    const page = app.page;
    await compute(page, "+", ["12", "30", "8"]);
    await compute(page, "*", ["2", "3", "4"]);
    const beforeView = await viewSnapshot(page);
    const beforeHistory = await historySnapshots(page);
    rec.eq("history-before", beforeHistory.length, 2);
    await clickHistoryEdit(page, 1);
    const editView = await viewSnapshot(page);
    rec.eq("state-in-edit", editView.state, "edit");
    rec.eq("result-value-cleared", editView.resultValue, null);
    rec.eq("result-error-cleared", editView.resultError, null);
    await page.locator(S.editCancel).click();
    await assertCancelRestore(rec, "restore", page, beforeView, beforeHistory);
    rec.observe("beforeState", beforeView.state);
    rec.observe("restoredHistory", await historyCount(page));
  } finally {
    await close(app);
  }
}

async function testH4(browser, rec) {
  const app = await open(browser);
  try {
    const page = app.page;
    await compute(page, "+", ["12", "30", "8"]);
    await compute(page, "*", ["2", "3", "4"]);
    const beforeView = await viewSnapshot(page);
    const beforeHistory = await historySnapshots(page);
    await clickHistoryEdit(page, 1);
    await (await operandInput(page, 1)).fill("5");
    rec.eq("middle-filled", (await operandValues(page))[1], "5");
    await (await operandInput(page, 2)).click();
    const during = await operandValues(page);
    rec.eq("last-cleared-before-cancel", during[2], "");
    rec.eq("last-pending-before-cancel", (await pendingFlags(page))[2], true);
    await page.locator(S.editCancel).click();
    await assertCancelRestore(rec, "restore", page, beforeView, beforeHistory);
    rec.eq("pageerrors", app.pageErrors.length, 0, app.pageErrors.join(" | "));
    rec.observe("historyAfter", await historyCount(page));
  } finally {
    await close(app);
  }
}

async function testH5(browser, rec) {
  const app = await open(browser);
  try {
    const page = app.page;
    await compute(page, "+", ["12", "30"]);
    await page.locator(S.keyOp).click();
    const beforeView = await viewSnapshot(page);
    const beforeHistory = await historySnapshots(page);
    rec.eq("reset-state", beforeView.state, "select");
    rec.eq("reset-expression", beforeView.expression, "");
    rec.eq("reset-result", beforeView.resultText, "");
    rec.eq("reset-operator", beforeView.operator, null);
    rec.eq("history-after-reset", beforeHistory.length, 1);
    await clickHistoryEdit(page, 0);
    rec.eq("edit-from-select", (await viewSnapshot(page)).state, "edit");
    await page.locator(S.editCancel).click();
    await assertCancelRestore(rec, "restore", page, beforeView, beforeHistory);
    rec.eq("cancel-hidden-after", await page.locator(S.editCancel).isVisible(), false);
    rec.observe("historyAfter", await historyCount(page));
  } finally {
    await close(app);
  }
}

async function testH6(browser, rec) {
  const app = await open(browser);
  try {
    const page = app.page;
    await compute(page, "+", ["12", "30", "8"]);
    await clickHistoryEdit(page, 0);
    const expressionBefore = (await viewSnapshot(page)).expression;
    const valuesBefore = await operandValues(page);
    await (await operandInput(page, 1)).click();
    const values = await operandValues(page);
    const flags = await pendingFlags(page);
    rec.eq("clicked-value-empty", values[1], "");
    rec.eq("other-values", [values[0], values[2]], ["12", "8"]);
    rec.eq("clicked-chip-pending", flags, [false, true, false]);
    rec.eq("expression-unchanged", (await viewSnapshot(page)).expression, expressionBefore);
    rec.eq("draft-operator", (await draftInfo(page)).operator, "+");
    rec.eq("history-count", await historyCount(page), 1);
    rec.eq("focus-clicked-input", await activeIs(page, S.operandInput, 1), true);
    rec.observe("initialValues", valuesBefore);
  } finally {
    await close(app);
  }
}

async function testH7(browser, rec) {
  const app = await open(browser);
  try {
    const page = app.page;
    await compute(page, "+", ["12", "30", "8"]);
    await clickHistoryEdit(page, 0);
    const expressionBefore = (await viewSnapshot(page)).expression;
    await (await operandInput(page, 1)).click();
    await (await operandInput(page, 0)).click();
    rec.eq("middle-restored-on-first", await operandValues(page), ["", "30", "8"]);
    rec.eq("first-only-pending", await pendingFlags(page), [true, false, false]);
    rec.eq("expression-unchanged-first", (await viewSnapshot(page)).expression, expressionBefore);
    await (await operandInput(page, 2)).click();
    rec.eq("first-restored-on-last", await operandValues(page), ["12", "30", ""]);
    rec.eq("last-only-pending", await pendingFlags(page), [false, false, true]);
    await page.click(`${S.picker} [data-op="*"]`);
    rec.eq("values-after-operator", await operandValues(page), ["12", "30", "8"]);
    rec.eq("no-pending-after-operator", await pendingCount(page), 0);
    rec.eq("draft-operator-star", (await draftInfo(page)).operator, "*");
    rec.eq("history-count", await historyCount(page), 1);
    rec.observe("expression", expressionBefore);
  } finally {
    await close(app);
  }
}

async function testH8(browser, rec) {
  const app = await open(browser);
  try {
    const page = app.page;
    await compute(page, "+", ["12", "30", "8"]);
    await clickHistoryEdit(page, 0);
    await (await operandInput(page, 1)).click();
    await page.keyboard.type("7");
    rec.eq("typed-middle", (await operandValues(page))[1], "7");
    let expression = (await viewSnapshot(page)).expression;
    rec.check("expression-has-7", expression.includes("7"), expression);
    rec.check("expression-drops-30", !expression.includes("30"), expression);

    await (await operandInput(page, 2)).click();
    rec.eq("middle-retained", await operandValues(page), ["12", "7", ""]);
    await (await operandInput(page, 1)).click();
    rec.eq("last-restored", await operandValues(page), ["12", "", "8"]);
    await (await operandInput(page, 2)).click();
    rec.eq("middle-pending-clears-last", await operandValues(page), ["12", "7", ""]);
    rec.eq("last-pending-before-focus-transfer", await pendingFlags(page), [false, false, true]);

    await page.locator(S.calcInput).focus();
    rec.eq("middle-recent-value", await operandValues(page), ["12", "7", "8"]);
    expression = (await viewSnapshot(page)).expression;
    rec.check("expression-recent-7", expression.includes("7") && !expression.includes("30"), expression);

    await (await operandInput(page, 0)).click();
    await (await operandInput(page, 0)).fill("9");
    rec.eq("first-filled", await operandValues(page), ["9", "7", "8"]);
    expression = (await viewSnapshot(page)).expression;
    rec.check("expression-first-edit", expression.includes("9") && !expression.includes("12"), expression);
    rec.eq("history-count", await historyCount(page), 1);
    rec.observe("finalExpression", expression);
  } finally {
    await close(app);
  }
}

async function testH9(browser, rec) {
  const app = await open(browser);
  try {
    const page = app.page;
    await compute(page, "+", ["12", "30", "8"]);
    const sourceBefore = await historySnapshots(page);
    await clickHistoryEdit(page, 0);
    await (await operandInput(page, 1)).click();
    rec.eq("middle-pending", await pendingFlags(page), [false, true, false]);
    await page.locator(S.equals).click();
    const view = await viewSnapshot(page);
    const history = await historySnapshots(page);
    rec.eq("state-result", view.state, "result");
    rec.near("result-number", view.resultValue, 50);
    rec.eq("result-no-error", view.resultError, null);
    rec.eq("history-count", history.length, 2);
    rec.eq("new-operator", history[0].operator, "+");
    rec.eq("new-operands", history[0].operands, ["12", "30", "8"]);
    rec.near("new-result", history[0].result, 50);
    rec.eq("source-unchanged", history[1], sourceBefore[0]);
    rec.eq("operand-inputs-cleared", await page.locator(S.operandInput).count(), 0);
    rec.eq("no-pending", await pendingCount(page), 0);
    rec.eq("pageerrors", app.pageErrors.length, 0, app.pageErrors.join(" | "));
    rec.observe("result", view.resultValue);
    rec.observe("history", history.length);
    rec.observe("sourceUnchanged", isDeepStrictEqual(history[1], sourceBefore[0]));
  } finally {
    await close(app);
  }
}

async function testH10(browser, rec) {
  const app = await open(browser);
  try {
    const page = app.page;
    await compute(page, "+", ["12", "30", "8"]);
    const sourceBefore = await historySnapshots(page);
    await clickHistoryEdit(page, 0);
    await (await operandInput(page, 1)).click();
    await page.keyboard.type("5");
    await page.keyboard.press("Backspace");
    rec.eq("backspace-empty", (await operandValues(page))[1], "");
    await page.locator(S.equals).click();
    let view = await viewSnapshot(page);
    rec.eq("empty-noop-history", await historyCount(page), 1);
    rec.eq("empty-noop-result", view.resultValue, null);
    rec.eq("empty-noop-state", view.state, "edit");
    rec.eq("empty-noop-pageerrors", app.pageErrors.length, 0, app.pageErrors.join(" | "));

    await (await operandInput(page, 1)).fill("abc");
    await page.locator(S.equals).click();
    view = await viewSnapshot(page);
    rec.eq("invalid-noop-history", await historyCount(page), 1);
    rec.eq("invalid-noop-result", view.resultValue, null);
    rec.eq("invalid-noop-state", view.state, "edit");
    rec.eq("invalid-noop-pageerrors", app.pageErrors.length, 0, app.pageErrors.join(" | "));

    await (await operandInput(page, 1)).fill("7");
    await page.locator(S.equals).click();
    view = await viewSnapshot(page);
    const history = await historySnapshots(page);
    rec.near("valid-result", view.resultValue, 27);
    rec.eq("valid-history", history.length, 2);
    rec.eq("valid-top", {
      operator: history[0].operator,
      operands: history[0].operands,
      result: history[0].result,
    }, { operator: "+", operands: ["12", "7", "8"], result: "27" });
    rec.eq("source-unchanged", history[1], sourceBefore[0]);
    rec.observe("invalidNoopState", "edit");
    rec.observe("finalResult", view.resultValue);
    rec.observe("finalHistory", history.length);
  } finally {
    await close(app);
  }
}

async function testH11(browser, rec) {
  const app = await open(browser);
  try {
    const page = app.page;
    await compute(page, "*", ["2", "3", "4"]);
    await compute(page, "+", ["1.5", "2.25"]);
    const before = await historySnapshots(page);
    rec.eq("history-before", before.length, 2);
    await clickHistoryEdit(page, 1);
    await (await operandInput(page, 0)).click();
    await page.keyboard.type("10");
    rec.eq("first-typed", (await operandValues(page))[0], "10");
    await page.click(`${S.picker} [data-op="+"]`);
    rec.eq("values-after-op", await operandValues(page), ["10", "3", "4"]);
    rec.eq("draft-operator", (await draftInfo(page)).operator, "+");
    await (await operandInput(page, 2)).click();
    await page.keyboard.type("5");
    rec.eq("last-typed", await operandValues(page), ["10", "3", "5"]);
    await page.locator(S.operandRemove).nth(1).click();
    rec.eq("values-after-remove", await operandValues(page), ["10", "5"]);

    await page.locator(S.calcInput).click();
    await page.keyboard.type("2");
    rec.eq("calc-typed", await page.locator(S.calcInput).inputValue(), "2");
    await page.click(`${S.keypad} [data-key="enter"]`);
    rec.eq("values-after-append", await operandValues(page), ["10", "5", "2"]);
    await page.locator(S.equals).click();
    const view = await viewSnapshot(page);
    const after = await historySnapshots(page);
    rec.near("result", view.resultValue, 17);
    rec.eq("history-after", after.length, 3);
    rec.eq("new-top", {
      operator: after[0].operator,
      operands: after[0].operands,
      result: after[0].result,
    }, { operator: "+", operands: ["10", "5", "2"], result: "17" });
    rec.eq("old-records-unchanged", after.slice(1), before);

    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(50);
    rec.eq("reload-history", await historyCount(page), 0);
    rec.eq("reload-state", (await viewSnapshot(page)).state, "select");
    rec.eq("reload-clean", app.pageErrors.length, 0, app.pageErrors.join(" | "));
    rec.observe("result", view.resultValue);
    rec.observe("history", after.length);
    rec.observe("reloadHistory", await historyCount(page));
  } finally {
    await close(app);
  }
}

async function measureMobile(page) {
  return page.evaluate((selectors) => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      return element.getClientRects().length > 0;
    };
    const controls = [...new Set(document.querySelectorAll("input, button, [data-op]"))]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label:
            element.getAttribute("data-testid") ||
            (element.getAttribute("data-key") ? `key-${element.getAttribute("data-key")}` : "") ||
            (element.getAttribute("data-op") ? `op-${element.getAttribute("data-op")}` : "") ||
            element.tagName.toLowerCase(),
          width: rect.width,
          height: rect.height,
        };
      });
    const calcInput = document.querySelector(selectors.calcInput);
    const operandInputs = [...document.querySelectorAll(selectors.operandInput)];
    const cancel = document.querySelector(selectors.editCancel);
    const keypad = document.querySelector(selectors.keypad);
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      controls,
      calcFont: calcInput ? Number.parseFloat(getComputedStyle(calcInput).fontSize) : null,
      operandFonts: operandInputs.map((input) => Number.parseFloat(getComputedStyle(input).fontSize)),
      cancelVisible: cancel ? visible(cancel) : false,
      keypadVisible: keypad ? visible(keypad) : false,
      pending: document.querySelectorAll('[data-pending="true"]').length,
    };
  }, S);
}

async function testH12(browser, rec) {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
  ]) {
    const tag = `${viewport.width}x${viewport.height}`;
    const app = await open(browser, { viewport, isMobile: true, hasTouch: true });
    try {
      const page = app.page;
      const cdp = await app.context.newCDPSession(page);
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: true,
      });
      await page.waitForTimeout(50);
      await compute(page, "+", ["12", "30", "8"]);
      await compute(page, "*", ["2", "3", "4"]);
      await clickHistoryEdit(page, 1);
      await (await operandInput(page, 1)).click();
      const metrics = await measureMobile(page);
      const tooSmall = metrics.controls.filter((control) => control.width < 43.5 || control.height < 43.5);
      rec.eq(`${tag}-inner-width`, metrics.innerWidth, viewport.width);
      rec.check(`${tag}-document-overflow`, metrics.docOverflow <= 1, `overflow=${metrics.docOverflow}`);
      rec.check(`${tag}-body-overflow`, metrics.bodyOverflow <= 1, `overflow=${metrics.bodyOverflow}`);
      rec.check(
        `${tag}-control-size`,
        tooSmall.length === 0,
        tooSmall.length
          ? tooSmall.map((item) => `${item.label}:${item.width.toFixed(1)}x${item.height.toFixed(1)}`).join(",")
          : `${metrics.controls.length} controls >=43.5px`,
      );
      rec.check(`${tag}-calc-font`, metrics.calcFont >= 16, `font=${metrics.calcFont}`);
      rec.check(
        `${tag}-operand-fonts`,
        metrics.operandFonts.length === 3 && metrics.operandFonts.every((font) => font >= 16),
        `fonts=${metrics.operandFonts.join(",")}`,
      );
      rec.eq(`${tag}-cancel-visible`, metrics.cancelVisible, true);
      rec.eq(`${tag}-keypad-visible`, metrics.keypadVisible, true);
      rec.eq(`${tag}-one-pending`, metrics.pending, 1);
      rec.observe(`${tag}Controls`, metrics.controls.length);
      rec.observe(`${tag}MinSize`, metrics.controls.reduce((min, item) => Math.min(min, item.width, item.height), Infinity).toFixed(1));
    } finally {
      await close(app);
    }
  }
}

async function deterministicSequence(app) {
  const page = app.page;
  await compute(page, "+", ["12", "30", "8"]);
  await clickHistoryEdit(page, 0);
  await (await operandInput(page, 1)).click();
  await page.keyboard.type("7");
  await (await operandInput(page, 2)).click();
  await (await operandInput(page, 1)).click();
  await (await operandInput(page, 0)).click();
  await page.locator(S.editCancel).click();
  await compute(page, "*", ["2", "3", "4"]);
  await clickHistoryEdit(page, 1);
  await (await operandInput(page, 1)).click();
  await page.keyboard.type("5");
  await page.locator(S.equals).click();
  return historySnapshots(page);
}

async function testH13(browser, rec) {
  const records = [];
  for (let index = 0; index < 2; index += 1) {
    const app = await open(browser);
    try {
      records.push(await deterministicSequence(app));
    } finally {
      await close(app);
    }
  }
  rec.eq("first-record-count", records[0].length, 3);
  rec.eq("second-record-count", records[1].length, 3);
  const first = JSON.stringify(historyCore(records[0]));
  const second = JSON.stringify(historyCore(records[1]));
  rec.eq("history-json-equal", first, second);
  const pageErrors = OPENED_APPS.flatMap((app) => app.pageErrors);
  const consoleErrors = OPENED_APPS.flatMap((app) => app.consoleErrors);
  rec.eq("all-pageerrors", pageErrors.length, 0, pageErrors.join(" | "));
  rec.eq("all-console-errors", consoleErrors.length, 0, consoleErrors.join(" | "));
  rec.observe("records", records.map((record) => record.length));
  rec.observe("pages", OPENED_APPS.length);
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

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function header(artifactHash, verifierHash) {
  return `ROUND: ${ROUND}\nARTIFACT_SHA256: ${artifactHash}\nVERIFIER_SHA256: ${verifierHash}`;
}

function renderHard(results, artifactHash, verifierHash) {
  const lines = [header(artifactHash, verifierHash)];
  for (const id of H_IDS) {
    const result = results[id] || { pass: false, detail: "not executed" };
    lines.push(`${id} ${result.pass ? "PASS" : "FAIL"} — ${result.detail}`);
  }
  const failed = H_IDS.filter((id) => !(results[id] && results[id].pass));
  lines.push(failed.length ? `HARD: FAIL (${failed.join(",")})` : "HARD: PASS");
  return `${lines.join("\n")}\n`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const verifierHash = sha256(fs.readFileSync(SCRIPT_FILE));
  let artifactHash = sha256(fs.readFileSync(ARTIFACT));
  let browser;
  try {
    browser = await launchBrowser();
  } catch (error) {
    console.error(`ENVIRONMENT REFUSAL: Playwright browser unavailable: ${error.stack || error}`);
    process.exit(3);
  }

  const results = {};
  try {
    for (const id of H_IDS) {
      const rec = new Recorder(id);
      const started = Date.now();
      try {
        await withTimeout(TESTS[id](browser, rec), 120000, id);
      } catch (error) {
        rec.check("execution", false, error.stack || String(error));
      }
      rec.observe("ms", Date.now() - started);
      results[id] = rec.result();
      console.log(`${id} ${results[id].pass ? "PASS" : "FAIL"} — ${results[id].detail}`);
    }
  } finally {
    await browser.close();
  }

  const text = renderHard(results, artifactHash, verifierHash);
  const outFile = path.join(OUT_DIR, `hard-r${ROUND}.txt`);
  fs.writeFileSync(outFile, text);
  process.stdout.write(text);
}

main().catch(async (error) => {
  console.error(error.stack || String(error));
  process.exit(2);
});
