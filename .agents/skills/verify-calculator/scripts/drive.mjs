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
    label: (await page.locator(SEL.stateLabel).innerText()).trim(),
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
  "chained-calculations": "sticky-chaining",
  "edit-history": "edit-history",
  "division-by-zero": "division-by-zero",
  "mobile-layout": "mobile-layout",
};

async function basicAddition({ openPage, run }) {
  const page = await openPage();

  let state = await readState(page);
  run.equal("initial.state", state.state, "select");
  run.equal("initial.keypad_disabled", await page.locator(keySel("1")).isDisabled(), true);
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
  run.equal("second_operand.expression", state.expression, "12 + 30");

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

async function inputEditing({ openPage, run }) {
  const page = await openPage();

  await chooseOperator(page, "+");
  await tapKeys(page, "7..5");
  let state = await readState(page);
  run.equal("editing.duplicate_dot_ignored", state.input, "7.5");
  run.equal("editing.uncommitted_expression", state.expression, "");
  await run.capture(page, "duplicate-dot-ignored");

  await pressBackspace(page);
  run.equal("editing.backspace_once", (await readState(page)).input, "7.");
  await pressBackspace(page);
  run.equal("editing.backspace_twice", (await readState(page)).input, "7");
  await run.capture(page, "backspace-trims-entry");

  await pressEnter(page);
  state = await readState(page);
  run.equal("editing.commit_after_backspace", state.expression, "7 +");
  run.equal("editing.input_cleared", state.input, "");

  // An empty 回车 must not add an operand or touch the expression/history.
  await pressEnter(page);
  state = await readState(page);
  run.equal("editing.empty_enter_expression", state.expression, "7 +");
  run.equal("editing.empty_enter_history", state.historyCount, 0);
  await run.capture(page, "empty-enter-adds-nothing");

  // Backspace on an empty display is a no-op.
  await pressBackspace(page);
  run.equal("editing.backspace_on_empty", (await readState(page)).input, "");
  await pressBackspace(page);
  run.equal("editing.backspace_on_empty_twice", (await readState(page)).state, "input");

  await pressEquals(page);
  state = await readState(page);
  run.equal("editing.single_operand_result", state.result, "7");
  run.equal("editing.history_count", state.historyCount, 1);
  await run.capture(page, "single-operand-result");
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
  run.equal("edit.expression", state.expression, "2 + 3");
  const originalChips = await page
    .locator(SEL.operandInput)
    .evaluateAll((inputs) => inputs.map((input) => input.value));
  run.equal("edit.chip_values", JSON.stringify(originalChips), JSON.stringify(["2", "3"]));
  await run.capture(page, "editing-history-record");

  await page.locator(SEL.operandInput).first().fill("10");
  state = await readState(page);
  run.equal("edit.operand_change_expression", state.expression, "10 + 3");
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
  run.equal("edit.switched_expression", state.expression, "10 * 3");
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
  run.equal("reset_recovery.keypad_disabled", await page.locator(keySel("1")).isDisabled(), true);
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

    await page.context().close();
  }
}

const SCENARIOS = {
  "basic-addition": { feature: "addition-and-equals", run: basicAddition },
  "operator-coverage": { feature: "addition-and-equals", run: operatorCoverage },
  "input-editing": { feature: "addition-and-equals", run: inputEditing },
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
