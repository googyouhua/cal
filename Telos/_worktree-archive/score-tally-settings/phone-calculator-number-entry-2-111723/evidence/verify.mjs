import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { launchBrowser, openApp as baseOpenApp } from "../../../tests/lib/browser.mjs";
import { S } from "../../../tests/lib/selectors.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(HERE, "../../..");

function fromHere(value, fallback) {
  if (!value) return fallback;
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(HERE, value);
}

const ARTIFACT = fromHere(process.env.KEKKAI_ARTIFACT, path.join(REPO_ROOT, "index.html"));
const OUT_DIR = fromHere(process.env.KEKKAI_OUT_DIR, HERE);
const rawRound = process.argv[2] ?? process.env.KEKKAI_ROUND;

if (!/^[1-9][0-9]*$/.test(String(rawRound ?? ""))) {
  console.error("PRECONDITION: round argument must be a positive integer");
  process.exit(2);
}

const round = Number(rawRound);
const MIN_CONTROL = 43.5;
const MIN_FONT = 16;
const EPSILON = 1e-9;
const pageAudits = [];
let browser;

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function fmt(value, max = 700) {
  let text;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  text = String(text).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

class Probe {
  constructor(id) {
    this.id = id;
    this.checks = [];
  }

  check(label, pass, detail) {
    this.checks.push({ label, pass: Boolean(pass), detail: fmt(detail) });
  }

  eq(label, actual, expected) {
    const pass = isDeepStrictEqual(actual, expected);
    this.check(
      label,
      pass,
      pass
        ? `${label}=${fmt(actual)}`
        : `${label} expected=${fmt(expected)} actual=${fmt(actual)}`,
    );
  }

  near(label, actual, expected, tolerance = EPSILON) {
    const number = Number(actual);
    const pass = Number.isFinite(number) && Math.abs(number - expected) <= tolerance;
    this.check(
      label,
      pass,
      pass
        ? `${label}=${number}`
        : `${label} expected=${expected}±${tolerance} actual=${fmt(actual)}`,
    );
  }

  result() {
    const failed = this.checks.filter((check) => !check.pass);
    return {
      id: this.id,
      pass: failed.length === 0,
      detail: this.checks.map((check) => check.detail).join("; "),
    };
  }
}

async function open(options = {}) {
  const app = await baseOpenApp(browser, ARTIFACT, {
    viewport: options.viewport ?? { width: 390, height: 844 },
    isMobile: options.isMobile ?? true,
    hasTouch: options.hasTouch ?? true,
  });
  app.page.setDefaultTimeout(30000);
  app.page.setDefaultNavigationTimeout(30000);
  pageAudits.push(app);
  return app;
}

function errorSummary(errors) {
  return errors.length === 0 ? "none" : errors.join(" | ");
}

function externalReferences(html) {
  const urls = [];
  for (const [tagName, attribute] of [
    ["script", "src"],
    ["link", "href"],
    ["img", "src"],
  ]) {
    const tagPattern = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
    const attributePattern = new RegExp(
      `\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\u0060]+))`,
      "i",
    );
    for (const tag of html.match(tagPattern) ?? []) {
      const match = tag.match(attributePattern);
      if (match) urls.push(match[1] ?? match[2] ?? match[3] ?? "");
    }
  }
  for (const match of html.matchAll(/@import\s+(?:url\(\s*)?(?:["']([^"']*)["']|([^"')\s;]+))/gi)) {
    urls.push(match[1] ?? match[2] ?? "");
  }
  for (const match of html.matchAll(/url\(\s*(?:["']([^"']*)["']|([^"')]+))\s*\)/gi)) {
    urls.push(match[1] ?? match[2] ?? "");
  }
  return urls.map((url) => url.trim()).filter((url) => /^(?:https?:)?\/\//i.test(url));
}

async function clickKey(page, key) {
  await page.locator(`button[data-key="${key}"]`).click();
}

async function clickOperator(page, operator) {
  await page.locator(`button[data-op="${operator}"]`).click();
}

async function clickEquals(page) {
  await page.locator(S.equals).click();
}

async function enterDigits(page, value) {
  for (const character of String(value)) await clickKey(page, character);
}

async function enterValue(page, value) {
  await enterDigits(page, value);
  await clickKey(page, "enter");
}

async function screenCompute(page, operator, values) {
  await clickOperator(page, operator);
  for (const value of values) await enterValue(page, value);
  await clickEquals(page);
}

async function historySnapshots(page) {
  return page.$$eval(S.historyItem, (items) =>
    items.map((item) => {
      const historyResult = item.querySelector('[data-testid="history-result"]');
      const historyExpression = item.querySelector('[data-testid="history-expression"]');
      return {
        operator: item.getAttribute("data-operator"),
        operands: JSON.parse(item.getAttribute("data-operands") || "[]"),
        result: historyResult?.getAttribute("data-value") ?? null,
        expression: (historyExpression?.textContent || "").trim(),
      };
    }),
  );
}

async function resultValue(page) {
  return page.locator(S.result).getAttribute("data-value");
}

async function resultError(page) {
  return page.locator(S.result).getAttribute("data-error");
}

async function inputValue(page) {
  return page.locator(S.calcInput).inputValue();
}

async function historyCount(page) {
  return page.locator(S.historyItem).count();
}

async function digitStates(page) {
  const states = [];
  for (let digit = 0; digit <= 9; digit += 1) {
    const locator = page.locator(`button[data-key="${digit}"]`);
    const count = await locator.count();
    states.push({ digit, count, enabled: count === 1 ? await locator.isEnabled() : false });
  }
  return states;
}

async function measureLayout(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      const rect = element.getBoundingClientRect();
      return element.getClientRects().length > 0 && rect.width > 0 && rect.height > 0;
    };
    const controls = Array.from(document.querySelectorAll("input,button"))
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          testid: element.getAttribute("data-testid"),
          key: element.getAttribute("data-key"),
          op: element.getAttribute("data-op"),
          width: rect.width,
          height: rect.height,
          fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
        };
      });
    const keypad = document.querySelector('[data-testid="keypad"]');
    const digitsVisible = Array.from({ length: 10 }, (_, digit) =>
      visible(document.querySelector(`button[data-key="${digit}"]`)),
    ).filter(Boolean).length;
    return {
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      controls,
      keypadVisible: keypad ? visible(keypad) : false,
      digitsVisible,
    };
  });
}

function checkLayout(probe, tag, metrics) {
  const minWidth = metrics.controls.length ? Math.min(...metrics.controls.map((control) => control.width)) : NaN;
  const minHeight = metrics.controls.length ? Math.min(...metrics.controls.map((control) => control.height)) : NaN;
  const minFont = metrics.controls.length ? Math.min(...metrics.controls.map((control) => control.fontSize)) : NaN;
  const tooSmall = metrics.controls.filter(
    (control) => control.width < MIN_CONTROL || control.height < MIN_CONTROL,
  );
  const smallFont = metrics.controls.filter((control) => !Number.isFinite(control.fontSize) || control.fontSize < MIN_FONT);
  probe.check(`${tag}.docOverflow`, metrics.docOverflow <= 1, `${tag}.docOverflow=${metrics.docOverflow}`);
  probe.check(`${tag}.bodyOverflow`, metrics.bodyOverflow <= 1, `${tag}.bodyOverflow=${metrics.bodyOverflow}`);
  probe.check(
    `${tag}.controls`,
    metrics.controls.length > 0 && tooSmall.length === 0,
    tooSmall.length === 0
      ? `${tag}.controls=${metrics.controls.length},min=${minWidth.toFixed(2)}x${minHeight.toFixed(2)}`
      : `${tag}.tooSmall=${fmt(tooSmall.map((control) => `${control.testid || control.key || control.op}:${control.width.toFixed(2)}x${control.height.toFixed(2)}`))}`,
  );
  probe.check(
    `${tag}.fonts`,
    minFont >= MIN_FONT && smallFont.length === 0,
    smallFont.length === 0 ? `${tag}.minFont=${minFont}` : `${tag}.smallFonts=${fmt(smallFont)}`,
  );
  probe.check(
    `${tag}.keypad`,
    metrics.keypadVisible && metrics.digitsVisible === 10,
    `${tag}.keypadVisible=${metrics.keypadVisible},digitsVisible=${metrics.digitsVisible}`,
  );
}

async function testH1() {
  const probe = new Probe("H1");
  const bytes = fs.readFileSync(ARTIFACT);
  const html = bytes.toString("utf8");
  const references = externalReferences(html);
  probe.check("hasClosingHtml", /<\/html>/i.test(html), `hasClosingHtml=${/<\/html>/i.test(html)}`);
  probe.check("bytesAtLeast1024", bytes.length >= 1024, `bytes=${bytes.length},textLength=${html.length}`);
  probe.eq("externalReferences", references, []);
  const app = await open();
  try {
    await app.page.waitForLoadState("load");
    probe.check("fileLoad", app.page.url().startsWith("file://"), `url=${app.page.url()}`);
    probe.eq("pageerrors", app.pageErrors.length, 0);
    probe.check("pageerrorMessages", app.pageErrors.length === 0, `messages=${errorSummary(app.pageErrors)}`);
  } finally {
    await app.close();
  }
  return probe.result();
}

async function testH2() {
  const probe = new Probe("H2");
  const app = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = app.page;
    const states = await digitStates(page);
    probe.check(
      "digitsEnabled",
      states.every((state) => state.count === 1 && state.enabled),
      `digits=${fmt(states.map((state) => `${state.digit}:${state.enabled}`))}`,
    );
    await clickKey(page, "1");
    await clickKey(page, "2");
    probe.eq("inputValue", await inputValue(page), "12");
    await clickKey(page, "enter");
    const expression = (await page.locator(S.expression).innerText()).trim();
    probe.check("expressionContains12", expression.includes("12"), `expression=${fmt(expression)}`);
    probe.eq("pageerrors", app.pageErrors.length, 0);
    probe.check("pageerrorMessages", app.pageErrors.length === 0, `messages=${errorSummary(app.pageErrors)}`);
  } finally {
    await app.close();
  }
  return probe.result();
}

async function testH3() {
  const probe = new Probe("H3");
  const app = await open();
  try {
    const page = app.page;
    await clickOperator(page, "+");
    await enterValue(page, "12");
    await enterValue(page, "30");
    await clickEquals(page);
    probe.near("result", Number.parseFloat(await resultValue(page)), 42);
    const records = await historySnapshots(page);
    const top = records[0] ?? {};
    probe.eq("topOperator", top.operator ?? null, "+");
    probe.eq("topOperands", top.operands ?? null, ["12", "30"]);
    probe.near("topResult", Number.parseFloat(top.result), 42);
  } finally {
    await app.close();
  }
  return probe.result();
}

async function testH4() {
  const probe = new Probe("H4");
  const app = await open();
  try {
    const page = app.page;
    await clickKey(page, "1");
    await clickKey(page, "2");
    await clickOperator(page, "+");
    probe.eq("preservedInput", await inputValue(page), "12");
    await clickKey(page, "enter");
    await enterValue(page, "30");
    await clickEquals(page);
    probe.near("result", Number.parseFloat(await resultValue(page)), 42);
    const top = (await historySnapshots(page))[0] ?? {};
    probe.eq("topOperator", top.operator ?? null, "+");
    probe.eq("topOperands", top.operands ?? null, ["12", "30"]);
  } finally {
    await app.close();
  }
  return probe.result();
}

async function testH5() {
  const probe = new Probe("H5");
  const app = await open();
  try {
    const page = app.page;
    await page.locator(S.calcInput).click();
    await page.keyboard.type("12");
    probe.eq("typedInput", await inputValue(page), "12");
    await page.keyboard.press("Enter");
    await clickOperator(page, "+");
    await page.keyboard.type("30");
    await page.keyboard.press("Enter");
    await page.keyboard.press("=");
    probe.near("result", Number.parseFloat(await resultValue(page)), 42);
    const top = (await historySnapshots(page))[0] ?? {};
    probe.eq("topOperator", top.operator ?? null, "+");
    probe.eq("topOperands", top.operands ?? null, ["12", "30"]);
  } finally {
    await app.close();
  }
  return probe.result();
}

async function testH6() {
  const probe = new Probe("H6");
  const app = await open();
  try {
    const page = app.page;
    await screenCompute(page, "+", ["12", "30", "8"]);
    const before = await historySnapshots(page);
    probe.eq("firstHistory", before.length, 1);
    probe.eq("firstOperator", before[0]?.operator ?? null, "+");
    probe.eq("firstOperands", before[0]?.operands ?? null, ["12", "30", "8"]);
    probe.near("firstResult", Number.parseFloat(before[0]?.result), 50);
    await enterValue(page, "5");
    await enterValue(page, "6");
    await clickEquals(page);
    probe.near("continuedResult", Number.parseFloat(await resultValue(page)), 11);
    probe.eq("appOperator", await page.locator("main.app").getAttribute("data-operator"), "+");
    probe.eq("historyCount", await historyCount(page), 2);
    const after = await historySnapshots(page);
    probe.eq("oldRecordUnchanged", after[1] ?? null, before[0] ?? null);
  } finally {
    await app.close();
  }
  return probe.result();
}

async function testH7() {
  const probe = new Probe("H7");
  const app = await open();
  try {
    const page = app.page;
    await screenCompute(page, "+", ["12", "30", "8"]);
    await screenCompute(page, "*", ["2", "3", "4"]);
    const before = await historySnapshots(page);
    probe.eq("initialHistory", before.length, 2);
    probe.near("initialResult", Number.parseFloat(await resultValue(page)), 24);
    const earlierEdit = page.locator(`${S.historyItem}[data-operator="+"] ${S.historyEdit}`);
    probe.eq("earlierRecordCount", await earlierEdit.count(), 1);
    await earlierEdit.click();
    const operands = page.locator(S.operandInput);
    probe.eq("operandInputs", await operands.count(), 3);
    await operands.nth(1).fill("5");
    await clickEquals(page);
    probe.near("editedResult", Number.parseFloat(await resultValue(page)), 25);
    const after = await historySnapshots(page);
    probe.eq("historyCount", after.length, 3);
    probe.eq("newTopOperator", after[0]?.operator ?? null, "+");
    probe.eq("newTopOperands", after[0]?.operands ?? null, ["12", "5", "8"]);
    probe.near("newTopResult", Number.parseFloat(after[0]?.result), 25);
    probe.eq("originalSnapshotsUnchanged", after.slice(1), before);
    await page.reload({ waitUntil: "load" });
    probe.eq("historyAfterReload", await historyCount(page), 0);
  } finally {
    await app.close();
  }
  return probe.result();
}

async function testH8() {
  const probe = new Probe("H8");
  const app = await open();
  try {
    const page = app.page;
    const initialHistory = await historyCount(page);
    await clickOperator(page, "/");
    await enterValue(page, "5");
    await enterValue(page, "0");
    await clickEquals(page);
    probe.eq("divisionError", await resultError(page), "true");
    probe.eq("historyAfterError", await historyCount(page), initialHistory);
    const errorDigits = await digitStates(page);
    probe.check(
      "digitsEnabledAfterError",
      errorDigits.every((state) => state.count === 1 && state.enabled),
      `digits=${fmt(errorDigits.map((state) => `${state.digit}:${state.enabled}`))}`,
    );
    await clickOperator(page, "+");
    await enterValue(page, "1");
    await enterValue(page, "2");
    await clickEquals(page);
    probe.near("recoveredResult", Number.parseFloat(await resultValue(page)), 3);
    probe.eq("recoveredErrorAttribute", await resultError(page), null);
    probe.eq("recoveredHistory", await historyCount(page), initialHistory + 1);
  } finally {
    await app.close();
  }
  return probe.result();
}

async function testH9() {
  const probe = new Probe("H9");
  const cold = await open();
  try {
    const page = cold.page;
    await clickEquals(page);
    probe.eq("coldHistory", await historyCount(page), 0);
    probe.eq("coldResultValue", await resultValue(page), null);
    probe.eq("coldPageerrors", cold.pageErrors.length, 0);
    probe.check("coldPageerrorMessages", cold.pageErrors.length === 0, `messages=${errorSummary(cold.pageErrors)}`);
  } finally {
    await cold.close();
  }
  const entered = await open();
  try {
    const page = entered.page;
    await clickKey(page, "1");
    await clickKey(page, "2");
    await clickEquals(page);
    probe.eq("uncommittedHistory", await historyCount(page), 0);
    probe.eq("uncommittedResultValue", await resultValue(page), null);
    probe.eq("uncommittedPageerrors", entered.pageErrors.length, 0);
    probe.check(
      "uncommittedPageerrorMessages",
      entered.pageErrors.length === 0,
      `messages=${errorSummary(entered.pageErrors)}`,
    );
  } finally {
    await entered.close();
  }
  return probe.result();
}

async function testH10() {
  const probe = new Probe("H10");
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
  ]) {
    const viewportTag = `${viewport.width}x${viewport.height}`;
    const app = await open({ viewport, isMobile: true, hasTouch: true });
    try {
      const page = app.page;
      checkLayout(probe, `${viewportTag}.cold`, await measureLayout(page));
      await enterDigits(page, "12");
      probe.eq(`${viewportTag}.uncommittedInput`, await inputValue(page), "12");
      checkLayout(probe, `${viewportTag}.uncommitted`, await measureLayout(page));
      await clickOperator(page, "+");
      await clickKey(page, "enter");
      await enterValue(page, "30");
      await enterValue(page, "8");
      await clickEquals(page);
      await screenCompute(page, "*", ["2", "3", "4"]);
      probe.eq(`${viewportTag}.resultHistory`, await historyCount(page), 2);
      probe.near(`${viewportTag}.resultValue`, Number.parseFloat(await resultValue(page)), 24);
      checkLayout(probe, `${viewportTag}.result`, await measureLayout(page));
      await page.locator(`${S.historyItem}[data-operator="+"] ${S.historyEdit}`).click();
      probe.eq(`${viewportTag}.operandInputs`, await page.locator(S.operandInput).count(), 3);
      checkLayout(probe, `${viewportTag}.edit`, await measureLayout(page));
    } finally {
      await app.close();
    }
  }
  return probe.result();
}

async function determinismSequence() {
  const app = await open();
  try {
    const page = app.page;
    await screenCompute(page, "+", ["12", "30", "8"]);
    const first = Number.parseFloat(await resultValue(page));
    await enterValue(page, "5");
    await enterValue(page, "6");
    await clickEquals(page);
    const second = Number.parseFloat(await resultValue(page));
    await screenCompute(page, "*", ["5", "6"]);
    const third = Number.parseFloat(await resultValue(page));
    const records = (await historySnapshots(page)).map(({ operator, operands, result }) => ({
      operator,
      operands,
      result,
    }));
    return { first, second, third, records };
  } finally {
    await app.close();
  }
}

async function testH12() {
  const probe = new Probe("H12");
  const first = await determinismSequence();
  const second = await determinismSequence();
  probe.near("firstResult", first.first, 50);
  probe.near("secondResult", first.second, 11);
  probe.near("thirdResult", first.third, 30);
  probe.eq("firstRecords", first.records.length, 3);
  probe.eq("secondRecords", second.records.length, 3);
  const firstJson = JSON.stringify(first.records);
  const secondJson = JSON.stringify(second.records);
  probe.check(
    "recordsEqual",
    firstJson === secondJson && isDeepStrictEqual(first.records, second.records),
    `equal=${firstJson === secondJson},first=${fmt(firstJson)}`,
  );
  probe.eq("recordSequence", first.records, [
    { operator: "*", operands: ["5", "6"], result: "30" },
    { operator: "+", operands: ["5", "6"], result: "11" },
    { operator: "+", operands: ["12", "30", "8"], result: "50" },
  ]);
  return probe.result();
}

async function testH11() {
  const probe = new Probe("H11");
  const pageErrors = pageAudits.flatMap((app) =>
    app.pageErrors.map((error) => `${app.page.url()} :: ${error}`),
  );
  const consoleErrors = pageAudits.flatMap((app) =>
    app.consoleErrors.map((error) => `${app.page.url()} :: ${error}`),
  );
  probe.check("pagesObserved", pageAudits.length > 0, `pages=${pageAudits.length}`);
  probe.eq("pageerrors", pageErrors.length, 0);
  probe.check("pageerrorMessages", pageErrors.length === 0, `messages=${errorSummary(pageErrors)}`);
  probe.eq("consoleErrors", consoleErrors.length, 0);
  probe.check("consoleErrorMessages", consoleErrors.length === 0, `messages=${errorSummary(consoleErrors)}`);
  return probe.result();
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
};

const TEST_IDS = ["H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H9", "H10", "H11", "H12"];
const EXECUTION_ORDER = ["H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H9", "H10", "H12", "H11"];

async function main() {
  if (!fs.existsSync(ARTIFACT)) {
    console.error(`PRECONDITION: artifact not found: ${ARTIFACT}`);
    process.exit(2);
  }
  try {
    browser = await launchBrowser();
  } catch (error) {
    console.error(`PRECONDITION: browser unavailable: ${error.message}`);
    process.exit(2);
  }

  const results = {};
  try {
    for (const id of EXECUTION_ORDER) {
      try {
        results[id] = await TESTS[id]();
      } catch (error) {
        results[id] = {
          id,
          pass: false,
          detail: `exception=${fmt(error?.stack || error?.message || error)}`,
        };
      }
    }
  } finally {
    await browser.close();
  }

  const artifactSha256 = sha256File(ARTIFACT);
  const verifierSha256 = sha256File(SCRIPT_PATH);
  const failed = TEST_IDS.filter((id) => !results[id]?.pass);
  const lines = [
    `ROUND: ${round}`,
    `ARTIFACT_SHA256: ${artifactSha256}`,
    `VERIFIER_SHA256: ${verifierSha256}`,
    ...TEST_IDS.map((id) => {
      const result = results[id] ?? { pass: false, detail: "missing test result" };
      return `${id} ${result.pass ? "PASS" : "FAIL"} — ${result.detail}`;
    }),
    failed.length === 0 ? "HARD: PASS" : `HARD: FAIL (${failed.join(",")})`,
  ];
  const report = `${lines.join("\n")}\n`;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `hard-r${round}.txt`), report, "utf8");
  process.stdout.write(report);
}

await main();
