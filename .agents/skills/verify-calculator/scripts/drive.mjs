#!/usr/bin/env node
/**
 * Drive the mobile calculator through real user paths and capture proof.
 *
 *   node scripts/drive.mjs --list
 *   node scripts/drive.mjs --feature addition-and-equals
 *   node scripts/drive.mjs --scenario edit-history --url http://127.0.0.1:4180
 *   node scripts/drive.mjs --scenario mobile-layout --headed
 *
 * Evidence lands in <skill>/evidence/runs/<UTC timestamp>-<scenario>/
 * Exit 0 = every assertion passed and no page error was logged. Exit 1 = proof failed.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadPlaywright } from "./lib/playwright.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(SKILL_DIR, "../../..");
const ARTIFACT = path.join(REPO_ROOT, "index.html");
const EVIDENCE_ROOT = path.join(SKILL_DIR, "evidence", "runs");

const DEFAULT_URL = process.env.VERIFY_URL || "http://127.0.0.1:4173";
const DEFAULT_VIEWPORT = { width: 320, height: 568 };

/* ------------------------------------------------------------------ */
/* User-path helpers — selectors come from the shipped app.            */
/* ------------------------------------------------------------------ */

const SEL = {
  app: ".app",
  stateLabel: "#state-label",
  input: '[data-testid="calc-input"]',
  expression: '[data-testid="expression"]',
  result: '[data-testid="result"]',
  equals: '[data-testid="key-equals"]',
  reset: '[data-testid="key-op"]',
  historyItem: '[data-testid="history-item"]',
  historyExpression: '[data-testid="history-expression"]',
  historyResult: '[data-testid="history-result"]',
  historyEdit: '[data-testid="history-edit"]',
  editDraft: '[data-testid="edit-draft"]',
  editOperator: '[data-testid="edit-operator"]',
  operandChip: '[data-testid="operand-chip"]',
  operandInput: '[data-testid="operand-input"]',
  operandRemove: '[data-testid="operand-remove"]',
};

const keySel = (key) => `[data-key="${key}"]`;
const opSel = (operator) => `[data-op="${operator}"]`;

async function tapKeys(page, sequence) {
  for (const character of sequence) {
    await page.locator(keySel(character)).click();
  }
}

async function pressEnter(page) {
  await page.locator(keySel("enter")).click();
}

async function pressBackspace(page) {
  await page.locator(keySel("backspace")).click();
}

async function pressEquals(page) {
  await page.locator(SEL.equals).click();
}

async function chooseOperator(page, operator) {
  await page.locator(opSel(operator)).click();
}

async function pressReset(page) {
  await page.locator(SEL.reset).click();
}

async function setSettings(page, { autoConfirm, autoEquals, baseEnabled, baseValue } = {}) {
  await page.locator('[data-testid="settings-toggle"]').click();
  if (autoConfirm !== undefined) {
    await page.locator('[data-testid="settings-auto-confirm"]').selectOption(String(autoConfirm));
  }
  if (autoEquals !== undefined) {
    await page.locator('[data-testid="settings-auto-equals"]').fill(String(autoEquals));
  }
  if (baseEnabled !== undefined) {
    await page.locator('[data-testid="settings-base-toggle"]').setChecked(baseEnabled);
  }
  if (baseValue !== undefined) {
    await page.locator('[data-testid="settings-base-value"]').fill(String(baseValue));
  }
  await page.locator('[data-testid="settings-done"]').click();
}

async function waitForExpression(page, expected, timeout = 6000) {
  await page.waitForFunction(
    (expectedText) =>
      (document.querySelector('[data-testid="expression"]')?.textContent || "").trim() === expectedText,
    expected,
    { timeout },
  );
}

async function progressActive(page) {
  return (await page.locator('[data-testid="auto-confirm-progress"]').getAttribute("data-active")) === "true";
}

async function commitNumber(page, digits) {
  await tapKeys(page, digits);
  await pressEnter(page);
}

async function readState(page) {
  const result = page.locator(SEL.result);
  const expression = page.locator(SEL.expression);
  return {
    state: await page.locator(SEL.app).getAttribute("data-state"),
    operator: await page.locator(SEL.app).getAttribute("data-operator"),
    expression: (await expression.innerText()).trim(),
    result: (await result.innerText()).trim(),
    resultValue: await result.getAttribute("data-value"),
    resultIsError: (await result.getAttribute("data-error")) === "true",
    input: await page.locator(SEL.input).inputValue(),
    // The label may be visibility-hidden while the countdown/undo overlay shows;
    // textContent still carries the state machine's message.
    label: ((await page.locator(SEL.stateLabel).textContent()) || "").trim(),
    historyCount: await page.locator(SEL.historyItem).count(),
  };
}

async function historySnapshot(page) {
  const count = await page.locator(SEL.historyItem).count();
  const items = [];
  for (let index = 0; index < count; index += 1) {
    const item = page.locator(SEL.historyItem).nth(index);
    items.push({
      expression: (await item.locator(SEL.historyExpression).innerText()).trim(),
      result: (await item.locator(SEL.historyResult).innerText()).trim(),
      operator: await item.getAttribute("data-operator"),
      base: await item.getAttribute("data-base"),
    });
  }
  return items;
}

async function horizontalOverflow(page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    innerWidth: window.innerWidth,
  }));
}

/* ------------------------------------------------------------------ */
/* Run bookkeeping                                                     */
/* ------------------------------------------------------------------ */

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function parseArgs(argv) {
  const options = {
    scenario: null,
    feature: null,
    url: DEFAULT_URL,
    viewport: DEFAULT_VIEWPORT,
    headed: false,
    out: null,
    list: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--scenario") options.scenario = argv[++index];
    else if (arg === "--feature") options.feature = argv[++index];
    else if (arg === "--url") options.url = argv[++index];
    else if (arg === "--headed") options.headed = true;
    else if (arg === "--out") options.out = argv[++index];
    else if (arg === "--list") options.list = true;
    else if (arg === "--viewport") {
      const match = /^(\d+)x(\d+)$/.exec(argv[++index] || "");
      if (!match) {
        console.error("FAIL usage --viewport expects WIDTHxHEIGHT, e.g. 320x568");
        process.exit(2);
      }
      options.viewport = { width: Number(match[1]), height: Number(match[2]) };
    } else if (arg === "-h" || arg === "--help") {
      console.log(
        "usage: drive.mjs --feature <id> | --scenario <id> [--url URL] [--viewport WxH] [--out DIR] [--headed] [--list]",
      );
      process.exit(0);
    } else {
      console.error(`FAIL usage unknown_arg=${arg}`);
      process.exit(2);
    }
  }
  return options;
}

/* ------------------------------------------------------------------ */
/* Scenarios — each drives the UI the way a user does.                 */
/* ------------------------------------------------------------------ */

const FEATURE_DEFAULT = {
  "addition-and-equals": "basic-addition",
  "number-entry": "number-entry",
  "backspace-undo": "backspace-undo",
  "chained-calculations": "sticky-chaining",
  "edit-history": "edit-history",
  "division-by-zero": "division-by-zero",
  "score-tally-settings": "settings-panel",
  "auto-equals": "auto-equals",
  "mobile-layout": "mobile-layout",
};

async function basicAddition({ openPage, run }) {
  const page = await openPage();

  let state = await readState(page);
  run.equal("initial.state", state.state, "select");
  run.equal("initial.keypad_enabled", await page.locator(keySel("1")).isEnabled(), true);
  run.equal("initial.operator_choices", await page.locator("[data-op]").count(), 4);
  run.equal("initial.expression", state.expression, "");
  run.equal("initial.result", state.result, "");
  run.equal("initial.history", state.historyCount, 0);
  await run.capture(page, "initial-select");

  await chooseOperator(page, "+");
  state = await readState(page);
  run.equal("operator.state", state.state, "input");
  run.equal("operator.keypad_enabled", await page.locator(keySel("1")).isEnabled(), true);
  run.equal("operator.label", state.label, "已选择 +，请输入数字");
  await run.capture(page, "operator-selected");

  await tapKeys(page, "12");
  state = await readState(page);
  run.equal("typed.input", state.input, "12");
  run.equal("typed.not_in_expression_before_enter", state.expression, "");
  await run.capture(page, "digits-before-enter");

  await pressEnter(page);
  state = await readState(page);
  run.equal("commit.expression", state.expression, "12 +");
  run.equal("commit.input_cleared", state.input, "");

  await commitNumber(page, "30");
  state = await readState(page);
  run.equal("second_operand.expression", state.expression, "12 + 30 +");

  await pressEquals(page);
  state = await readState(page);
  run.equal("result.state", state.state, "result");
  run.equal("result.value", state.result, "42");
  run.equal("result.data_value", state.resultValue, "42");
  run.equal("result.expression", state.expression, "12 + 30");
  run.equal("result.history_count", state.historyCount, 1);

  const history = await historySnapshot(page);
  run.equal("history.first.expression", history[0]?.expression, "12 + 30");
  run.equal("history.first.result", history[0]?.result, "42");
  run.equal("history.first.operator", history[0]?.operator, "+");
  await run.capture(page, "sum-result-and-history");

  await page.reload({ waitUntil: "load" });
  state = await readState(page);
  run.equal("reload.state", state.state, "select");
  run.equal("reload.history_cleared", state.historyCount, 0);
  run.equal("reload.result_cleared", state.result, "");
  await run.capture(page, "reload-clears-in-memory-history");
}

async function operatorCoverage({ openPage, run }) {
  const page = await openPage();
  const cases = [
    { operator: "+", numbers: ["12", "30", "8"], result: "50", expression: "12 + 30 + 8", name: "sum" },
    { operator: "-", numbers: ["10", "4", "3"], result: "3", expression: "10 - 4 - 3", name: "difference" },
    { operator: "*", numbers: ["2", "3", "4"], result: "24", expression: "2 * 3 * 4", name: "product" },
    { operator: "/", numbers: ["100", "5", "2"], result: "10", expression: "100 / 5 / 2", name: "quotient" },
    { operator: "+", numbers: ["1.5", "2.25"], result: "3.75", expression: "1.5 + 2.25", name: "decimal-sum" },
  ];

  for (const [index, testCase] of cases.entries()) {
    if (index > 0) {
      await pressReset(page);
      const resetState = await readState(page);
      run.equal(`case_${testCase.name}.reset_state`, resetState.state, "select");
    }
    await chooseOperator(page, testCase.operator);
    for (const number of testCase.numbers) {
      await commitNumber(page, number);
    }
    await pressEquals(page);
    const state = await readState(page);
    run.equal(`case_${testCase.name}.result`, state.result, testCase.result);
    run.equal(`case_${testCase.name}.expression`, state.expression, testCase.expression);
    run.equal(`case_${testCase.name}.history_count`, state.historyCount, index + 1);
    run.equal(`case_${testCase.name}.state`, state.state, "result");
    await run.capture(page, `case-${index + 1}-${testCase.name}`);
  }
}

async function numberEntry({ openPage, run }) {
  const page = await openPage();

  // No operator yet: digits are accepted and start a draft.
  await tapKeys(page, "12");
  let state = await readState(page);
  run.equal("entry.optional_operator_state", state.state, "input");
  run.equal("entry.optional_operator_input", state.input, "12");
  run.equal("entry.optional_operator_expression", state.expression, "");
  run.equal("entry.optional_operator_label", state.label, "请输入数字，或先选择运算类型");
  await run.capture(page, "typed-before-choosing-operator");

  await pressEnter(page);
  state = await readState(page);
  run.equal("entry.commit_without_operator_expression", state.expression, "12");
  run.equal("entry.commit_without_operator_label", state.label, "已确认 12，可继续输入或按 = 计算");
  await chooseOperator(page, "+");
  run.equal("entry.operator_after_commit_expression", (await readState(page)).expression, "12 +");
  await commitNumber(page, "3");
  await pressEquals(page);
  state = await readState(page);
  run.equal("entry.operator_after_commit_result", state.result, "15");
  run.equal("entry.operator_after_commit_history", state.historyCount, 1);
  await run.capture(page, "operator-chosen-after-entry");

  await pressReset(page);
  await chooseOperator(page, "+");
  await tapKeys(page, "7..5");
  state = await readState(page);
  run.equal("entry.duplicate_dot_ignored", state.input, "7.5");
  run.equal("entry.uncommitted_expression", state.expression, "");
  await run.capture(page, "duplicate-dot-ignored");

  await pressBackspace(page);
  run.equal("entry.backspace_once", (await readState(page)).input, "7.");
  await pressBackspace(page);
  run.equal("entry.backspace_twice", (await readState(page)).input, "7");
  await run.capture(page, "backspace-trims-entry");

  await pressEnter(page);
  state = await readState(page);
  run.equal("entry.commit_after_backspace", state.expression, "7 +");
  run.equal("entry.input_cleared", state.input, "");

  // An empty 回车 must not add an operand or touch the expression/history.
  await pressEnter(page);
  state = await readState(page);
  run.equal("entry.empty_enter_expression", state.expression, "7 +");
  run.equal("entry.empty_enter_history", state.historyCount, 1);
  await run.capture(page, "empty-enter-adds-nothing");

  await pressEquals(page);
  state = await readState(page);
  run.equal("entry.single_operand_result", state.result, "7");
  run.equal("entry.history_count", state.historyCount, 2);
  await run.capture(page, "single-operand-result");

  // The page also accepts a physical keyboard: digits, Enter, =, Backspace.
  await pressReset(page);
  await chooseOperator(page, "+");
  await page.keyboard.type("45");
  await page.keyboard.press("Enter");
  await page.keyboard.type("5");
  await page.keyboard.press("Enter");
  await page.keyboard.press("=");
  state = await readState(page);
  run.equal("keyboard.sum_result", state.result, "50");
  run.equal("keyboard.sum_expression", state.expression, "45 + 5");
  run.equal("keyboard.sum_history", state.historyCount, 3);
  await run.capture(page, "physical-keyboard-entry");

  await pressReset(page);
  await chooseOperator(page, "+");
  await page.keyboard.type("9");
  await page.keyboard.press("Backspace");
  run.equal("keyboard.backspace_input", (await readState(page)).input, "");
}

async function backspaceUndo({ openPage, run }) {
  const page = await openPage();

  await chooseOperator(page, "+");
  await commitNumber(page, "9.5");
  await commitNumber(page, "9.2");
  let state = await readState(page);
  run.equal("undo.start_expression", state.expression, "9.5 + 9.2 +");

  await pressBackspace(page);
  state = await readState(page);
  run.equal("undo.first_expression", state.expression, "9.5 +");
  run.equal("undo.first_label", state.label, "已撤回 9.2");
  await run.capture(page, "undo-last-operand");

  await pressBackspace(page);
  state = await readState(page);
  run.equal("undo.second_expression", state.expression, "");
  run.equal("undo.second_label", state.label, "已撤回 9.5");

  await pressBackspace(page);
  run.equal("undo.exhausted_expression", (await readState(page)).expression, "");
  await run.capture(page, "undo-exhausted");

  await commitNumber(page, "7");
  await pressEquals(page);
  state = await readState(page);
  run.equal("undo.result_state", state.state, "result");
  run.equal("undo.result_value", state.result, "7");
  await pressBackspace(page);
  state = await readState(page);
  run.equal("undo.result_not_removed", state.result, "7");
  run.equal("undo.result_state_kept", state.state, "result");
  await run.capture(page, "result-is-not-undoable");

  await pressReset(page);
  await chooseOperator(page, "+");
  await commitNumber(page, "2");
  await commitNumber(page, "3");
  await pressEquals(page);
  await page.locator(SEL.historyEdit).first().click();
  await pressBackspace(page);
  state = await readState(page);
  run.equal("undo.edit_chip_count", await page.locator(SEL.operandChip).count(), 1);
  run.equal("undo.edit_expression", state.expression, "2 +");
  run.equal("undo.edit_label", state.label, "已撤回 3");
  await run.capture(page, "undo-in-edit-draft");
}

async function settingsPanel({ openPage, run }) {
  const page = await openPage();
  const toggle = page.locator('[data-testid="settings-toggle"]');
  const panel = page.locator('[data-testid="settings-panel"]');
  const panelOpen = () => panel.evaluate((element) => element.open);
  const indicator = page.locator('[data-testid="settings-indicator"]');

  run.equal("settings.toggle_visible", await toggle.isVisible(), true);
  const box = await toggle.boundingBox();
  run.check("settings.toggle_min_44", box.width >= 44 && box.height >= 44, JSON.stringify(box));
  run.equal("settings.panel_closed_initially", await panelOpen(), false);
  run.equal("settings.indicator_hidden_initially", await indicator.isHidden(), true);
  await run.capture(page, "settings-toggle-closed");

  await toggle.click();
  run.equal("settings.panel_open", await panelOpen(), true);
  run.equal("settings.aria_expanded", await toggle.getAttribute("aria-expanded"), "true");
  run.equal("settings.auto_confirm_options", await page.locator('[data-testid="settings-auto-confirm"] option').count(), 23);
  run.equal(
    "settings.auto_confirm_default",
    await page.locator('[data-testid="settings-auto-confirm"]').inputValue(),
    "0",
  );
  run.equal("settings.auto_equals_default", await page.locator('[data-testid="settings-auto-equals"]').inputValue(), "0");
  const autoEqualsName = await page.locator('[data-testid="settings-auto-equals"]').getAttribute("aria-label");
  run.check(
    "settings.auto_equals_label",
    /自动/.test(autoEqualsName || "") && /等号/.test(autoEqualsName || ""),
    autoEqualsName,
  );
  const autoEqualsHint = (await page.locator('[data-testid="auto-equals-hint"]').innerText()).trim();
  run.check("settings.auto_equals_hint", /等号|=/.test(autoEqualsHint), autoEqualsHint);
  run.equal("settings.base_default_unchecked", await page.locator('[data-testid="settings-base-toggle"]').isChecked(), false);
  run.equal("settings.base_input_disabled", await page.locator('[data-testid="settings-base-value"]').isDisabled(), true);
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("data-testid") === "settings-auto-confirm",
  );
  run.equal("settings.focus_in_panel", true, true);
  await run.capture(page, "settings-panel-open");

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector('[data-testid="settings-panel"]').open);
  run.equal("settings.escape_closes", await panelOpen(), false);
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("data-testid") === "settings-toggle",
  );
  run.equal("settings.focus_returns_to_toggle", true, true);

  await toggle.click();
  await page.locator('[data-testid="settings-auto-confirm"]').selectOption("1.5");
  await page.locator('[data-testid="settings-base-toggle"]').check();
  run.equal("settings.base_input_enabled", await page.locator('[data-testid="settings-base-value"]').isEnabled(), true);
  await page.locator('[data-testid="settings-base-value"]').fill("10");
  run.equal("settings.indicator_visible_when_changed", await indicator.isVisible(), true);
  await page.locator('[data-testid="settings-done"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="settings-panel"]').open);
  run.equal("settings.done_closes", await panelOpen(), false);
  await run.capture(page, "settings-configured");

  await page.reload({ waitUntil: "load" });
  run.equal("settings.persist_indicator", await indicator.isVisible(), true);
  await toggle.click();
  run.equal(
    "settings.persist_auto_confirm",
    await page.locator('[data-testid="settings-auto-confirm"]').inputValue(),
    "1.5",
  );
  run.equal("settings.persist_base_enabled", await page.locator('[data-testid="settings-base-toggle"]').isChecked(), true);
  run.equal("settings.persist_base_value", await page.locator('[data-testid="settings-base-value"]').inputValue(), "10");
  await run.capture(page, "settings-persist-after-reload");

  await page.keyboard.press("Escape");
  await chooseOperator(page, "+");
  await commitNumber(page, "1");
  await pressEquals(page);
  await pressReset(page);
  run.equal("settings.reset_state", (await readState(page)).state, "select");
  run.equal("settings.reset_keeps_settings", await indicator.isVisible(), true);
}

async function autoConfirm({ openPage, run }) {
  const page = await openPage();

  await setSettings(page, { autoConfirm: 2 });
  await chooseOperator(page, "+");
  await tapKeys(page, "95");
  await waitForExpression(page, "95 +");
  let state = await readState(page);
  run.equal("auto_confirm.input_cleared", state.input, "");
  run.check("auto_confirm.label", state.label.includes("已确认 95"), state.label);
  const undoHint = page.locator('[data-testid="undo-hint"]');
  run.equal("auto_confirm.undo_hint_visible", await undoHint.isVisible(), true);
  run.check("auto_confirm.undo_hint_text", (await undoHint.innerText()).includes("95"), await undoHint.innerText());
  run.equal("auto_confirm.progress_inactive_after_commit", await progressActive(page), false);
  await run.capture(page, "auto-confirmed-number");

  // Every keystroke restarts the timer.
  await pressReset(page);
  await chooseOperator(page, "+");
  await tapKeys(page, "9");
  await page.waitForTimeout(900);
  run.equal("auto_confirm.timer_active", await progressActive(page), true);
  run.equal("auto_confirm.not_committed_yet", (await readState(page)).input, "9");
  await tapKeys(page, "5");
  await page.waitForTimeout(700);
  state = await readState(page);
  run.equal("auto_confirm.restarted_expression", state.expression, "");
  run.equal("auto_confirm.restarted_input", state.input, "95");
  await waitForExpression(page, "95 +");
  await run.capture(page, "timer-restarts-on-keystroke");

  // A trailing decimal point must not be auto-confirmed.
  await pressReset(page);
  await chooseOperator(page, "+");
  await tapKeys(page, "9.");
  await page.waitForTimeout(2500);
  state = await readState(page);
  run.equal("auto_confirm.trailing_dot_input", state.input, "9.");
  run.equal("auto_confirm.trailing_dot_expression", state.expression, "");
  await tapKeys(page, "5");
  await waitForExpression(page, "9.5 +");
  await run.capture(page, "trailing-dot-not-confirmed");

  // t = 0 disables auto-confirm.
  await setSettings(page, { autoConfirm: 0 });
  await pressReset(page);
  await chooseOperator(page, "+");
  await tapKeys(page, "9");
  await page.waitForTimeout(1500);
  state = await readState(page);
  run.equal("auto_confirm.disabled_input", state.input, "9");
  run.equal("auto_confirm.disabled_expression", state.expression, "");
  await run.capture(page, "auto-confirm-off");

  // The settings dialog pauses the timer; closing restarts the full wait.
  await setSettings(page, { autoConfirm: 2 });
  await pressReset(page);
  await chooseOperator(page, "+");
  await tapKeys(page, "9");
  await page.locator('[data-testid="settings-toggle"]').click();
  await page.waitForTimeout(2500);
  state = await readState(page);
  run.equal("auto_confirm.paused_input", state.input, "9");
  run.equal("auto_confirm.paused_expression", state.expression, "");
  await page.locator('[data-testid="settings-done"]').click();
  await waitForExpression(page, "9 +");
  await run.capture(page, "settings-panel-pauses-timer");
}

async function baseScore({ openPage, run }) {
  const page = await openPage();
  const baseMarker = page.locator('[data-testid="base-marker"]');

  await setSettings(page, { baseEnabled: true, baseValue: "10" });
  await chooseOperator(page, "+");
  let state = await readState(page);
  run.equal("base.expression_before_operands", state.expression, "10");
  run.equal("base.marker_visible", await baseMarker.isVisible(), true);
  run.equal("base.marker_text", (await baseMarker.innerText()).trim(), "基数 10");
  run.equal("base.operator_label", state.label, "已选择 +，基数 10，请输入数字");
  await run.capture(page, "base-marker-and-expression");

  await commitNumber(page, "9.5");
  await commitNumber(page, "9.2");
  await commitNumber(page, "9");
  await pressEquals(page);
  state = await readState(page);
  run.equal("base.sum_result", state.result, "37.7");
  run.equal("base.sum_expression", state.expression, "10 + 9.5 + 9.2 + 9");
  run.check("base.result_label", state.label.includes("基数 10"), state.label);
  let history = await historySnapshot(page);
  run.equal("base.history_data_base", history[0]?.base, "10");
  run.equal("base.history_expression", history[0]?.expression, "10 + 9.5 + 9.2 + 9");
  await run.capture(page, "base-in-sum-and-history");

  await setSettings(page, { baseEnabled: false });
  await pressReset(page);
  await chooseOperator(page, "+");
  run.equal("base.off_expression_empty", (await readState(page)).expression, "");
  await commitNumber(page, "9.5");
  await commitNumber(page, "9.2");
  await commitNumber(page, "9");
  await pressEquals(page);
  state = await readState(page);
  run.equal("base.off_sum_result", state.result, "27.7");
  run.equal("base.off_sum_expression", state.expression, "9.5 + 9.2 + 9");
  history = await historySnapshot(page);
  run.equal("base.off_history_data_base", history[0]?.base, null);
  await run.capture(page, "base-disabled");

  await setSettings(page, { baseEnabled: true, baseValue: "100" });
  await pressReset(page);
  await chooseOperator(page, "/");
  await commitNumber(page, "4");
  await pressEquals(page);
  state = await readState(page);
  run.equal("base.division_result", state.result, "25");
  run.equal("base.division_expression", state.expression, "100 / 4");
  await run.capture(page, "base-in-division");

  await setSettings(page, { baseValue: "0" });
  await pressReset(page);
  await chooseOperator(page, "*");
  await commitNumber(page, "5");
  await pressEquals(page);
  state = await readState(page);
  run.equal("base.zero_result", state.result, "0");
  run.equal("base.zero_expression", state.expression, "0 * 5");
  history = await historySnapshot(page);
  run.equal("base.zero_history_data_base", history[0]?.base, "0");
  await run.capture(page, "base-zero");

  // History keeps the base snapshot it was computed with.
  await setSettings(page, { baseValue: "10" });
  await pressReset(page);
  await chooseOperator(page, "+");
  await commitNumber(page, "9.5");
  await commitNumber(page, "9.2");
  await commitNumber(page, "9");
  await pressEquals(page);
  await setSettings(page, { baseValue: "100" });
  await page.locator(SEL.historyEdit).first().click();
  state = await readState(page);
  run.equal(
    "base.edit_old_expression",
    state.expression,
    "10 + 9.5 + 9.2 + 9 +",
  );
  run.equal(
    "base.edit_marker_text",
    (await page.locator('[data-testid="edit-base-marker"]').innerText()).trim(),
    "基数 10",
  );
  await pressEquals(page);
  state = await readState(page);
  run.equal("base.edit_old_result", state.result, "37.7");
  history = await historySnapshot(page);
  run.equal("base.edit_old_history_base", history[0]?.base, "10");
  await run.capture(page, "history-keeps-base-snapshot");

  // A new calculation uses the current base.
  await pressReset(page);
  await chooseOperator(page, "+");
  await commitNumber(page, "1");
  await pressEquals(page);
  state = await readState(page);
  run.equal("base.current_result", state.result, "101");
  run.equal("base.current_expression", state.expression, "100 + 1");

  // Changing the base mid-entry redraws the unfinished expression.
  await pressReset(page);
  await chooseOperator(page, "+");
  await tapKeys(page, "5");
  await setSettings(page, { baseValue: "200" });
  state = await readState(page);
  run.equal("base.live_expression", state.expression, "200");
  run.equal("base.live_input_kept", state.input, "5");
  await pressEnter(page);
  await pressEquals(page);
  state = await readState(page);
  run.equal("base.live_result", state.result, "205");
  run.equal("base.live_final_expression", state.expression, "200 + 5");
  await run.capture(page, "base-changed-mid-entry");
}

async function autoEquals({ openPage, run }) {
  const page = await openPage();

  // Set N = 3: the third committed number folds the expression without "=".
  await setSettings(page, { autoEquals: 3 });
  await chooseOperator(page, "+");
  await commitNumber(page, "95");
  let state = await readState(page);
  run.equal("auto_equals.before_n.state", state.state, "input");
  run.equal("auto_equals.before_n.expression", state.expression, "95 +");
  run.equal("auto_equals.before_n.result", state.result, "");
  await commitNumber(page, "92");
  state = await readState(page);
  run.equal("auto_equals.second.state", state.state, "input");
  run.equal("auto_equals.second.expression", state.expression, "95 + 92 +");
  run.equal("auto_equals.second.result", state.result, "");
  await commitNumber(page, "90");
  state = await readState(page);
  run.equal("auto_equals.third.state", state.state, "result");
  run.equal("auto_equals.third.expression", state.expression, "95 + 92 + 90");
  run.equal("auto_equals.third.result", state.result, "277");
  run.equal("auto_equals.third.result_value", state.resultValue, "277");
  run.equal("auto_equals.third.input", state.input, "");
  run.equal("auto_equals.third.history", state.historyCount, 1);
  let history = await historySnapshot(page);
  run.equal("auto_equals.third.history_expression", history[0]?.expression, "95 + 92 + 90");
  run.equal("auto_equals.third.history_result", history[0]?.result, "277");
  await run.capture(page, "auto-equals-after-third-number");

  // N = 1 folds a single committed number into itself.
  await setSettings(page, { autoEquals: 1 });
  await pressReset(page);
  await chooseOperator(page, "+");
  await commitNumber(page, "8");
  state = await readState(page);
  run.equal("auto_equals.n1.state", state.state, "result");
  run.equal("auto_equals.n1.result", state.result, "8");
  run.equal("auto_equals.n1.history", state.historyCount, 2);
  await run.capture(page, "auto-equals-single-number");

  // The base is the starting operand and is not counted toward N.
  await setSettings(page, { autoEquals: 3, baseEnabled: true, baseValue: "10" });
  await pressReset(page);
  await chooseOperator(page, "+");
  await commitNumber(page, "95");
  await commitNumber(page, "92");
  state = await readState(page);
  run.equal("auto_equals.base.before_n.state", state.state, "input");
  run.equal("auto_equals.base.before_n.expression", state.expression, "10 + 95 + 92 +");
  run.equal("auto_equals.base.before_n.result", state.result, "");
  await commitNumber(page, "90");
  state = await readState(page);
  run.equal("auto_equals.base.result", state.result, "287");
  run.equal("auto_equals.base.expression", state.expression, "10 + 95 + 92 + 90");
  history = await historySnapshot(page);
  run.equal("auto_equals.base.history_base", history[0]?.base, "10");
  await run.capture(page, "auto-equals-with-base");
  await setSettings(page, { baseEnabled: false });

  // Without an operator nothing folds; choosing one does not trigger either.
  await setSettings(page, { autoEquals: 2 });
  await pressReset(page);
  await commitNumber(page, "1");
  await commitNumber(page, "2");
  state = await readState(page);
  run.equal("auto_equals.no_operator.state", state.state, "input");
  run.equal("auto_equals.no_operator.result", state.result, "");
  await chooseOperator(page, "+");
  state = await readState(page);
  run.equal("auto_equals.no_operator.after_choice_state", state.state, "input");
  run.equal("auto_equals.no_operator.after_choice_result", state.result, "");
  await commitNumber(page, "3");
  state = await readState(page);
  run.equal("auto_equals.no_operator.third.result", state.result, "6");
  run.equal("auto_equals.no_operator.third.expression", state.expression, "1 + 2 + 3");
  await run.capture(page, "auto-equals-needs-operator");

  // The edit draft never auto-folds.
  await setSettings(page, { autoEquals: 2 });
  await pressReset(page);
  await chooseOperator(page, "+");
  await commitNumber(page, "5");
  await commitNumber(page, "5");
  state = await readState(page);
  run.equal("auto_equals.edit_setup.result", state.result, "10");
  const beforeEdit = state.historyCount;
  await setSettings(page, { autoEquals: 1 });
  await page.locator(SEL.historyEdit).first().click();
  run.equal("auto_equals.edit.state", (await readState(page)).state, "edit");
  await tapKeys(page, "3");
  await pressEnter(page);
  state = await readState(page);
  run.equal("auto_equals.edit.still_edit", state.state, "edit");
  run.equal("auto_equals.edit.history_unchanged", state.historyCount, beforeEdit);
  await page.locator('[data-testid="edit-cancel"]').click();
  run.equal("auto_equals.edit.cancel_state", (await readState(page)).state, "result");
  await run.capture(page, "auto-equals-does-not-fire-in-edit");

  // Auto-confirm commits count too: N = 2 with a 2 s pause.
  await setSettings(page, { autoEquals: 2, autoConfirm: 2 });
  await pressReset(page);
  await chooseOperator(page, "+");
  await tapKeys(page, "95");
  await waitForExpression(page, "95 +");
  state = await readState(page);
  run.equal("auto_equals.auto_confirm.first.state", state.state, "input");
  run.equal("auto_equals.auto_confirm.first.result", state.result, "");
  await tapKeys(page, "92");
  await waitForExpression(page, "95 + 92");
  state = await readState(page);
  run.equal("auto_equals.auto_confirm.second.state", state.state, "result");
  run.equal("auto_equals.auto_confirm.second.result", state.result, "187");
  await run.capture(page, "auto-equals-with-auto-confirm");
  await setSettings(page, { autoConfirm: 0 });

  // Division by zero at the threshold keeps the manual "=" semantics.
  await setSettings(page, { autoEquals: 2 });
  await pressReset(page);
  await chooseOperator(page, "/");
  await commitNumber(page, "5");
  run.equal("auto_equals.divzero.before_zero.state", (await readState(page)).state, "input");
  await commitNumber(page, "0");
  state = await readState(page);
  run.equal("auto_equals.divzero.state", state.state, "error");
  run.equal("auto_equals.divzero.result", state.result, "不能除以零");
  run.equal("auto_equals.divzero.result_error", state.resultIsError, true);
  await run.capture(page, "auto-equals-division-by-zero");

  // A threshold change alone does not fold an already-satisfied count.
  await setSettings(page, { autoEquals: 0 });
  await pressReset(page);
  await chooseOperator(page, "+");
  await commitNumber(page, "1");
  await commitNumber(page, "2");
  await setSettings(page, { autoEquals: 2 });
  state = await readState(page);
  run.equal("auto_equals.threshold_change.state", state.state, "input");
  run.equal("auto_equals.threshold_change.result", state.result, "");
  await commitNumber(page, "3");
  run.equal("auto_equals.threshold_change.next_result", (await readState(page)).result, "6");

  // N = 0 is off: the user still presses "=" manually.
  await setSettings(page, { autoEquals: 0 });
  await pressReset(page);
  await chooseOperator(page, "+");
  await commitNumber(page, "95");
  await commitNumber(page, "92");
  await commitNumber(page, "90");
  state = await readState(page);
  run.equal("auto_equals.off.state", state.state, "input");
  run.equal("auto_equals.off.result", state.result, "");
  await pressEquals(page);
  run.equal("auto_equals.off.manual_result", (await readState(page)).result, "277");
  await run.capture(page, "auto-equals-off");

  // The count survives a reload.
  await setSettings(page, { autoEquals: 3 });
  await page.reload({ waitUntil: "load" });
  run.equal(
    "auto_equals.persist_indicator",
    await page.locator('[data-testid="settings-indicator"]').isVisible(),
    true,
  );
  await page.locator('[data-testid="settings-toggle"]').click();
  run.equal(
    "auto_equals.persist_value",
    await page.locator('[data-testid="settings-auto-equals"]').inputValue(),
    "3",
  );
  await page.keyboard.press("Escape");
}

async function stickyChaining({ openPage, run }) {
  const page = await openPage();

  await chooseOperator(page, "+");
  await commitNumber(page, "6");
  await commitNumber(page, "7");
  await pressEquals(page);
  let state = await readState(page);
  run.equal("first_run.result", state.result, "13");
  run.equal("first_run.expression", state.expression, "6 + 7");
  run.equal("first_run.history_count", state.historyCount, 1);
  await run.capture(page, "first-result");

  // After a result, typing a number and pressing = continues with the same operator.
  await tapKeys(page, "5");
  await pressEquals(page);
  state = await readState(page);
  run.equal("continued.result", state.result, "5");
  run.equal("continued.expression", state.expression, "5");
  run.equal("continued.operator_retained", state.operator, "+");
  run.equal("continued.history_count", state.historyCount, 2);
  await run.capture(page, "continue-with-same-operator");

  await commitNumber(page, "2");
  await commitNumber(page, "3");
  await pressEquals(page);
  state = await readState(page);
  run.equal("chained.result", state.result, "5");
  run.equal("chained.expression", state.expression, "2 + 3");
  run.equal("chained.history_count", state.historyCount, 3);
  await run.capture(page, "two-operand-chain");

  // Switching operator mid-entry keeps the uncommitted digits.
  await pressReset(page);
  run.equal("reset.state", (await readState(page)).state, "select");
  await chooseOperator(page, "-");
  await tapKeys(page, "9");
  await chooseOperator(page, "*");
  state = await readState(page);
  run.equal("switch.state", state.state, "input");
  run.equal("switch.uncommitted_digits_kept", state.input, "9");
  run.equal("switch.label", state.label, "已更换为 *，已输入的数字会保留");
  await run.capture(page, "operator-switch-keeps-typed-digits");

  await pressEnter(page);
  run.equal("switch.committed_expression", (await readState(page)).expression, "9 *");
  await pressEquals(page);
  state = await readState(page);
  run.equal("switch.result", state.result, "9");
  run.equal("switch.operator", state.operator, "*");
}

async function editHistory({ openPage, run }) {
  const page = await openPage();

  await chooseOperator(page, "+");
  await commitNumber(page, "2");
  await commitNumber(page, "3");
  await pressEquals(page);
  let state = await readState(page);
  run.equal("original.result", state.result, "5");
  run.equal("original.history_count", state.historyCount, 1);
  await run.capture(page, "original-result");

  await page.locator(SEL.historyEdit).first().click();
  state = await readState(page);
  run.equal("edit.state", state.state, "edit");
  run.equal("edit.draft_visible", await page.locator(SEL.editDraft).isVisible(), true);
  run.equal("edit.operand_chips", await page.locator(SEL.operandChip).count(), 2);
  run.equal("edit.operator_glyph", (await page.locator(SEL.editOperator).innerText()).trim(), "+");
  run.equal("edit.expression", state.expression, "2 + 3 +");
  const originalChips = await page
    .locator(SEL.operandInput)
    .evaluateAll((inputs) => inputs.map((input) => input.value));
  run.equal("edit.chip_values", JSON.stringify(originalChips), JSON.stringify(["2", "3"]));
  await run.capture(page, "editing-history-record");

  await page.locator(SEL.operandInput).first().fill("10");
  state = await readState(page);
  run.equal("edit.operand_change_expression", state.expression, "10 + 3 +");
  await run.capture(page, "operand-changed");

  await pressEquals(page);
  state = await readState(page);
  run.equal("recompute.result", state.result, "13");
  run.equal("recompute.expression", state.expression, "10 + 3");
  run.equal("recompute.history_count", state.historyCount, 2);
  const history = await historySnapshot(page);
  run.equal("recompute.history_first.expression", history[0]?.expression, "10 + 3");
  run.equal("recompute.history_first.result", history[0]?.result, "13");
  await run.capture(page, "recomputed-record");

  // Switch the operator while editing, then recompute.
  await page.locator(SEL.historyEdit).first().click();
  await chooseOperator(page, "*");
  state = await readState(page);
  run.equal("edit.switched_operator_glyph", (await page.locator(SEL.editOperator).innerText()).trim(), "*");
  run.equal("edit.switched_expression", state.expression, "10 * 3 *");
  await run.capture(page, "operator-changed-while-editing");

  await pressEquals(page);
  state = await readState(page);
  run.equal("edit.switch_result", state.result, "30");
  run.equal("edit.switch_history_count", state.historyCount, 3);

  // Remove one operand: a single-operand expression evaluates to itself.
  await page.locator(SEL.historyEdit).first().click();
  await page.locator(SEL.operandRemove).nth(1).click();
  state = await readState(page);
  run.equal("edit.removed_chip_count", await page.locator(SEL.operandChip).count(), 1);
  run.equal("edit.removed_expression", state.expression, "10 *");
  await pressEquals(page);
  state = await readState(page);
  run.equal("edit.single_operand_result", state.result, "10");
  run.equal("edit.single_operand_history_count", state.historyCount, 4);
  await run.capture(page, "operand-removed-and-recomputed");

  // Focusing an operand clears it for immediate replacement; leaving restores it.
  await page.locator(SEL.historyEdit).first().click();
  const operand = page.locator(SEL.operandInput).first();
  await operand.click();
  run.equal("edit.pending_cleared_on_focus", await operand.inputValue(), "");
  run.equal(
    "edit.pending_marker",
    await page.locator('[data-pending="true"]').count(),
    1,
  );
  await page.locator("#edit-hint").click();
  run.equal("edit.pending_restored_on_blur", await operand.inputValue(), "10");
  run.equal("edit.pending_marker_cleared", await page.locator('[data-pending="true"]').count(), 0);
  await run.capture(page, "edit-pending-operand");

  // Cancel restores the pre-edit view and leaves the history untouched.
  await operand.fill("99");
  await page.locator('[data-testid="edit-cancel"]').click();
  state = await readState(page);
  run.equal("edit.cancel_state", state.state, "result");
  run.equal("edit.cancel_expression", state.expression, "10");
  run.equal("edit.cancel_result", state.result, "10");
  run.equal("edit.cancel_history_count", state.historyCount, 4);
  run.equal("edit.cancel_chip_count", await page.locator(SEL.operandChip).count(), 0);
  await run.capture(page, "edit-cancelled-restores");
}

async function divisionByZero({ openPage, run }) {
  const page = await openPage();

  await chooseOperator(page, "/");
  await commitNumber(page, "5");
  await commitNumber(page, "0");
  await pressEquals(page);
  let state = await readState(page);
  run.equal("error.state", state.state, "error");
  run.equal("error.message", state.result, "不能除以零");
  run.equal("error.data_error", state.resultIsError, true);
  run.equal("error.history_unchanged", state.historyCount, 0);
  run.check("error.label_mentions_zero", state.label.includes("不能除以零"), state.label);
  await run.capture(page, "division-by-zero-error");

  // Recovery path 1: type a number and press = directly from the error state.
  await tapKeys(page, "8");
  await pressEquals(page);
  state = await readState(page);
  run.equal("typing_recovery.state", state.state, "result");
  run.equal("typing_recovery.result", state.result, "8");
  run.equal("typing_recovery.operator_retained", state.operator, "/");
  run.equal("typing_recovery.history_count", state.historyCount, 1);
  await run.capture(page, "recovered-by-typing");

  // A zero dividend is not an error.
  await pressReset(page);
  await chooseOperator(page, "/");
  await commitNumber(page, "0");
  await commitNumber(page, "5");
  await pressEquals(page);
  state = await readState(page);
  run.equal("zero_dividend.state", state.state, "result");
  run.equal("zero_dividend.result", state.result, "0");
  run.equal("zero_dividend.history_count", state.historyCount, 2);
  await run.capture(page, "zero-dividend-is-not-an-error");

  // Recovery path 2: the operator/reset button returns to operator selection.
  await pressReset(page);
  await chooseOperator(page, "/");
  await commitNumber(page, "9");
  await commitNumber(page, "0");
  await pressEquals(page);
  run.equal("second_error.state", (await readState(page)).state, "error");
  await pressReset(page);
  state = await readState(page);
  run.equal("reset_recovery.state", state.state, "select");
  run.equal("reset_recovery.expression", state.expression, "");
  run.equal("reset_recovery.result", state.result, "");
  run.equal("reset_recovery.keypad_enabled", await page.locator(keySel("1")).isEnabled(), true);
  await run.capture(page, "recovered-by-operator-reset");
}

async function mobileLayout({ openPage, run }) {
  const viewports = [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
  ];

  for (const viewport of viewports) {
    const tag = `${viewport.width}x${viewport.height}`;
    const page = await openPage(viewport);

    const assertNoOverflow = async (stage) => {
      const metrics = await horizontalOverflow(page);
      run.check(
        `layout_${tag}.${stage}.no_horizontal_overflow`,
        metrics.scrollWidth <= metrics.clientWidth,
        `scrollWidth=${metrics.scrollWidth} clientWidth=${metrics.clientWidth}`,
      );
    };

    await assertNoOverflow("select");

    const boxes = await page.locator("button:visible").evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          label: button.getAttribute("aria-label") || button.textContent.trim(),
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
        };
      }),
    );
    const undersized = boxes.filter((box) => box.width < 44 || box.height < 44);
    run.check(
      `layout_${tag}.touch_targets_min_44`,
      undersized.length === 0,
      `undersized=${JSON.stringify(undersized)}`,
    );

    const inputFont = await page
      .locator(SEL.input)
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    run.check(`layout_${tag}.input_font_min_16`, inputFont >= 16, `fontSize=${inputFont}`);

    await run.capture(page, `select-${tag}`);

    await chooseOperator(page, "+");
    await tapKeys(page, "123456789");
    await assertNoOverflow("long-input");
    await run.capture(page, `long-input-${tag}`);

    await pressEnter(page);
    await assertNoOverflow("long-expression");
    await run.capture(page, `long-expression-${tag}`);

    // Long repeating decimal result must not push the page sideways.
    await pressReset(page);
    await chooseOperator(page, "/");
    await commitNumber(page, "1");
    await commitNumber(page, "3");
    await pressEquals(page);
    const resultState = await readState(page);
    run.equal(`layout_${tag}.long_result_value`, resultState.result, "0.3333333333333333");
    await assertNoOverflow("long-result");
    await run.capture(page, `long-result-${tag}`);

    // Operand editor must also stay usable at this width.
    await pressReset(page);
    await chooseOperator(page, "+");
    await commitNumber(page, "2");
    await commitNumber(page, "3");
    await pressEquals(page);
    await page.locator(SEL.historyEdit).first().click();
    const operandFont = await page
      .locator(SEL.operandInput)
      .first()
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    run.check(`layout_${tag}.operand_font_min_16`, operandFont >= 16, `fontSize=${operandFont}`);
    const chipBoxes = await page.locator(`${SEL.operandRemove}:visible`).evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { width: Math.round(rect.width), height: Math.round(rect.height) };
      }),
    );
    run.check(
      `layout_${tag}.operand_targets_min_44`,
      chipBoxes.every((box) => box.width >= 44 && box.height >= 44),
      `boxes=${JSON.stringify(chipBoxes)}`,
    );
    await assertNoOverflow("edit-draft");
    await run.capture(page, `edit-draft-${tag}`);

    await page.locator('[data-testid="edit-cancel"]').click();

    // Settings dialog must fit and stay touchable at this width.
    await page.locator('[data-testid="settings-toggle"]').click();
    await assertNoOverflow("settings-open");
    const panelBox = await page.locator('[data-testid="settings-panel"]').boundingBox();
    run.check(
      `layout_${tag}.settings_panel_fits`,
      panelBox.x >= 0 && panelBox.x + panelBox.width <= viewport.width + 0.5,
      JSON.stringify(panelBox),
    );
    const panelControls = await page
      .locator(
        '[data-testid="settings-panel"] input:visible, [data-testid="settings-panel"] select:visible, [data-testid="settings-panel"] button:visible',
      )
      .evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            id: element.getAttribute("data-testid"),
            width: Math.round(rect.width * 100) / 100,
            height: Math.round(rect.height * 100) / 100,
          };
        }),
      );
    run.check(
      `layout_${tag}.settings_targets_min_44`,
      panelControls.every((control) => control.width >= 44 && control.height >= 44),
      `controls=${JSON.stringify(panelControls)}`,
    );
    const panelFonts = await page
      .locator('[data-testid="settings-panel"] select, [data-testid="settings-panel"] input[type="text"]')
      .evaluateAll((elements) => elements.map((element) => parseFloat(getComputedStyle(element).fontSize)));
    run.check(
      `layout_${tag}.settings_font_min_16`,
      panelFonts.every((font) => font >= 16),
      `fonts=${panelFonts.join(",")}`,
    );
    await run.capture(page, `settings-panel-${tag}`);

    // Base marker and auto-confirm progress must not widen the page either.
    await page.locator('[data-testid="settings-auto-confirm"]').selectOption("2");
    await page.locator('[data-testid="settings-base-toggle"]').check();
    await page.locator('[data-testid="settings-base-value"]').fill("10");
    await page.locator('[data-testid="settings-done"]').click();
    await pressReset(page);
    await chooseOperator(page, "+");
    run.equal(
      `layout_${tag}.base_marker_visible`,
      await page.locator('[data-testid="base-marker"]').isVisible(),
      true,
    );
    await assertNoOverflow("base-marker");
    await tapKeys(page, "9");
    await page.waitForTimeout(200);
    run.equal(`layout_${tag}.progress_active`, await progressActive(page), true);
    const progressBox = await page.locator('[data-testid="auto-confirm-progress"]').boundingBox();
    run.check(`layout_${tag}.progress_is_thin`, progressBox.height <= 4, JSON.stringify(progressBox));
    await assertNoOverflow("progress");
    await run.capture(page, `base-and-progress-${tag}`);
    await pressReset(page);

    await page.context().close();
  }
}

const SCENARIOS = {
  "basic-addition": { feature: "addition-and-equals", run: basicAddition },
  "operator-coverage": { feature: "addition-and-equals", run: operatorCoverage },
  "number-entry": { feature: "number-entry", run: numberEntry },
  "backspace-undo": { feature: "backspace-undo", run: backspaceUndo },
  "settings-panel": { feature: "score-tally-settings", run: settingsPanel },
  "auto-confirm": { feature: "score-tally-settings", run: autoConfirm },
  "base-score": { feature: "score-tally-settings", run: baseScore },
  "auto-equals": { feature: "auto-equals", run: autoEquals },
  "sticky-chaining": { feature: "chained-calculations", run: stickyChaining },
  "edit-history": { feature: "edit-history", run: editHistory },
  "division-by-zero": { feature: "division-by-zero", run: divisionByZero },
  "mobile-layout": { feature: "mobile-layout", run: mobileLayout },
};

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

const options = parseArgs(process.argv.slice(2));

if (options.list) {
  for (const [id, scenario] of Object.entries(SCENARIOS)) {
    console.log(`${id}\t${scenario.feature}`);
  }
  console.log("\nfeature defaults:");
  for (const [feature, scenario] of Object.entries(FEATURE_DEFAULT)) {
    console.log(`${feature}\t-> ${scenario}`);
  }
  process.exit(0);
}

let scenarioId = options.scenario;
if (!scenarioId && options.feature) {
  scenarioId = FEATURE_DEFAULT[options.feature] || (SCENARIOS[options.feature] ? options.feature : null);
}
if (!scenarioId) {
  console.error("FAIL usage: pass --feature <id> or --scenario <id> (see --list)");
  process.exit(2);
}
const scenario = SCENARIOS[scenarioId];
if (!scenario) {
  console.error(`FAIL usage: unknown scenario ${scenarioId} (see --list)`);
  process.exit(2);
}

if (!fs.existsSync(ARTIFACT)) {
  console.error(`FAIL artifact_missing path=${ARTIFACT}`);
  process.exit(2);
}
const artifactSha256 = sha256(fs.readFileSync(ARTIFACT));
const startedAt = new Date();
const outDir = options.out
  ? path.resolve(options.out)
  : path.join(EVIDENCE_ROOT, `${timestampSlug(startedAt)}-${scenarioId}`);
fs.mkdirSync(path.join(outDir, "steps"), { recursive: true });

const run = {
  scenario: scenarioId,
  feature: scenario.feature,
  url: options.url,
  artifact: ARTIFACT,
  artifactSha256,
  viewport: `${options.viewport.width}x${options.viewport.height}`,
  assertions: [],
  console: [],
  consoleErrors: [],
  steps: [],
  check(name, ok, actual) {
    this.assertions.push({ name, ok: Boolean(ok), actual });
    if (!ok) console.error(`  FAIL ${name} actual=${JSON.stringify(actual)}`);
  },
  equal(name, actual, expected) {
    const ok = Object.is(actual, expected);
    this.assertions.push({ name, ok, actual, expected });
    if (!ok) {
      console.error(`  FAIL ${name} actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
    }
  },
  async capture(page, name) {
    const id = String(this.steps.length + 1).padStart(2, "0");
    const base = `${id}-${name}`;
    const screenshot = path.join(outDir, "steps", `${base}.png`);
    const aria = path.join(outDir, "steps", `${base}.aria.txt`);
    await page.screenshot({ path: screenshot, fullPage: true });
    fs.writeFileSync(aria, await page.locator("main").ariaSnapshot());
    this.steps.push({
      id,
      name,
      screenshot: path.relative(outDir, screenshot),
      aria: path.relative(outDir, aria),
      url: page.url(),
    });
  },
};

const { chromium, version: playwrightVersion, resolvedFrom } = await loadPlaywright(REPO_ROOT, SKILL_DIR);
console.log(`scenario=${scenarioId} feature=${scenario.feature} url=${options.url}`);
console.log(`artifact_sha256=${artifactSha256}`);
console.log(`playwright=${playwrightVersion} from=${resolvedFrom}`);

const browser = await chromium.launch({ headless: !options.headed, timeout: 30000 });
let fatal = null;

try {
  const harness = {
    async openPage(viewport = options.viewport) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
      const page = await context.newPage();
      page.on("console", (message) => {
        const line = `[${message.type()}] ${message.text()}`;
        run.console.push(line);
        if (message.type() === "error") run.consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => {
        run.consoleErrors.push(`pageerror: ${error.message}`);
        run.console.push(`[pageerror] ${error.message}`);
      });
      await page.goto(options.url, { waitUntil: "load", timeout: 20000 });
      return page;
    },
    run,
  };
  await scenario.run(harness);
} catch (error) {
  fatal = error;
  console.error(`  FAIL scenario_threw ${error.stack || error.message}`);
} finally {
  await browser.close();
}

run.check("console_errors_empty", run.consoleErrors.length === 0, run.consoleErrors.join(" | "));

const failed = run.assertions.filter((assertion) => !assertion.ok);
const finishedAt = new Date();
const record = {
  ok: failed.length === 0 && !fatal,
  scenario: run.scenario,
  feature: run.feature,
  url: run.url,
  artifact: run.artifact,
  artifactSha256: run.artifactSha256,
  viewport: run.viewport,
  playwrightVersion,
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  fatal: fatal ? String(fatal.stack || fatal.message) : null,
  failedAssertions: failed.map((assertion) => assertion.name),
  assertions: run.assertions,
  console: run.console,
  consoleErrors: run.consoleErrors,
  steps: run.steps,
};
fs.writeFileSync(path.join(outDir, "run.json"), `${JSON.stringify(record, null, 2)}\n`);

const passed = run.assertions.length - failed.length;
console.log(`assertions=${passed}/${run.assertions.length} passed`);
console.log(`steps=${run.steps.length} evidence=${outDir}`);
console.log(`ok=${record.ok}`);
process.exit(record.ok ? 0 : 1);
