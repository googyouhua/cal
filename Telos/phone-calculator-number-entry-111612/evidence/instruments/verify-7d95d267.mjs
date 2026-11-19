#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const roundArg = process.argv[2] ?? process.env.KEKKAI_ROUND ?? "1";
const round = String(roundArg).trim().replace(/^r/i, "");
if (!/^\d+$/.test(round)) throw new Error(`invalid round: ${roundArg}`);

function fromScriptDir(value) {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(scriptDir, value);
}

const repoDir = fromScriptDir(process.env.KEKKAI_REPO ?? path.resolve(scriptDir, "../../.."));
const artifactPath = fromScriptDir(
  process.env.KEKKAI_ARTIFACT ?? path.resolve(repoDir, "index.html"),
);
const outDir = fromScriptDir(process.env.KEKKAI_OUT_DIR ?? scriptDir);
const outputPath = path.join(outDir, `hard-r${round}.txt`);
const artifactUrl = pathToFileURL(artifactPath).href;

if (!fs.existsSync(artifactPath)) {
  throw new Error(`artifact not found: ${artifactPath}`);
}
if (/(?:^|[\\/])evidence[\\/]runs(?:[\\/]|$)/.test(path.resolve(outDir))) {
  throw new Error(`refusing to write verifier output into evidence/runs: ${outDir}`);
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function loadPlaywright() {
  const moduleName = process.env.PLAYWRIGHT_MODULE || "playwright";
  const bases = [
    path.join(repoDir, "tests", "package.json"),
    path.join(scriptDir, "package.json"),
    path.join(repoDir, "package.json"),
  ];
  const errors = [];
  for (const base of [...new Set(bases)]) {
    try {
      const mod = createRequire(base)(moduleName);
      if (mod?.chromium) return mod;
      if (mod?.default?.chromium) return mod.default;
    } catch (error) {
      errors.push(`${base}: ${error.message}`);
    }
  }
  throw new Error(`playwright is not resolvable; ${errors.join(" | ")}`);
}

const artifactSha256 = sha256File(artifactPath);
const verifierSha256 = sha256File(scriptPath);
const { chromium } = loadPlaywright();
let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (error) {
  console.error(`ENV REFUSAL: cannot launch Playwright Chromium — ${error?.message ?? error}`);
  process.exit(2);
}
const SEL = {
  app: "main.app",
  picker: '[data-testid="op-picker"]',
  input: 'input[data-testid="calc-input"]',
  expression: '[data-testid="expression"]',
  result: '[data-testid="result"]',
  equals: 'button[data-testid="key-equals"]',
  keypad: '[data-testid="keypad"]',
  historyItem: '[data-testid="history-item"]',
  historyResult: '[data-testid="history-result"]',
  historyEdit: 'button[data-testid="history-edit"]',
  operandInput: 'input[data-testid="operand-input"]',
};

const globalErrors = { pageErrors: [], consoleErrors: [] };
let openedPageCount = 0;

function show(value, limit = 1200) {
  let rendered;
  try {
    rendered = JSON.stringify(value);
  } catch {
    rendered = String(value);
  }
  return rendered.length > limit ? `${rendered.slice(0, limit)}...` : rendered;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

class CheckFailure extends Error {}

function assert(condition, message) {
  if (!condition) throw new CheckFailure(message);
}

function assertDeep(actual, expected, message) {
  assert(
    isDeepStrictEqual(actual, expected),
    `${message}; actual=${show(actual)} expected=${show(expected)}`,
  );
}

function assertNear(actual, expected, tolerance, message) {
  assert(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${message}; actual=${show(actual)} expected=${expected} tolerance=${tolerance}`,
  );
}

function numericAttribute(raw, label) {
  const value = raw === null || raw === "" ? Number.NaN : Number.parseFloat(raw);
  assert(Number.isFinite(value), `${label}; raw=${show(raw)}`);
  return value;
}

function attachErrorCapture(page, hid) {
  const local = { pageErrors: [], consoleErrors: [] };
  page.on("pageerror", (error) => {
    const message = String(error?.stack ?? error);
    local.pageErrors.push(message);
    globalErrors.pageErrors.push({ hid, message });
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const rendered = message.text();
    local.consoleErrors.push(rendered);
    globalErrors.consoleErrors.push({ hid, message: rendered });
  });
  return local;
}

async function openFresh(hid, options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 390, height: 844 },
    isMobile: options.isMobile === true,
    hasTouch: options.hasTouch === true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  const errors = attachErrorCapture(page, hid);
  openedPageCount += 1;
  try {
    await page.goto(artifactUrl, { waitUntil: "load" });
  } catch (error) {
    await context.close();
    throw error;
  }
  return { context, page, errors };
}

async function withFresh(hid, options, callback) {
  const opened = await openFresh(hid, options);
  try {
    return await callback(opened);
  } finally {
    await opened.context.close();
  }
}

async function clickKey(page, key) {
  await page.locator(`button[data-key="${key}"]`).click();
}

async function typeDigits(page, value) {
  for (const character of String(value)) await clickKey(page, character);
}

async function enterNumber(page, value) {
  await typeDigits(page, value);
  await clickKey(page, "enter");
}

async function clickOperator(page, operator) {
  await page.locator(`[data-op="${operator}"]`).click();
}

async function clickEquals(page) {
  await page.locator(SEL.equals).click();
}

async function compute(page, operator, values) {
  await clickOperator(page, operator);
  for (const value of values) await enterNumber(page, value);
  await clickEquals(page);
}

async function resultValue(page) {
  return page.locator(SEL.result).getAttribute("data-value");
}

async function resultError(page) {
  return page.locator(SEL.result).getAttribute("data-error");
}

async function historyCount(page) {
  return page.locator(SEL.historyItem).count();
}

async function historySnapshots(page) {
  return page.locator(SEL.historyItem).evaluateAll((items) =>
    items.map((item) => {
      const result = item.querySelector('[data-testid="history-result"]');
      const expression = item.querySelector('[data-testid="history-expression"]');
      return {
        operator: item.getAttribute("data-operator"),
        operands: JSON.parse(item.getAttribute("data-operands") || "[]"),
        result: result ? result.getAttribute("data-value") : null,
        expression: expression ? (expression.textContent || "").trim() : "",
      };
    }),
  );
}

async function digitKeyStates(page) {
  const states = {};
  for (const digit of "0123456789") {
    const locator = page.locator(`button[data-key="${digit}"]`);
    const count = await locator.count();
    states[digit] = count === 0 ? "missing" : (await locator.isEnabled()) ? "enabled" : "disabled";
  }
  return states;
}

function countExternalReferences(html) {
  const patterns = [
    /<script\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    /<link\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^\s;)]+))/gi,
    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,
  ];
  const refs = [];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const value = cleanText(match[1] ?? match[2] ?? match[3] ?? "");
      if (/^(?:https?:)?\/\//i.test(value)) refs.push(value);
    }
  }
  return refs;
}

async function measureLayout(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
        return false;
      }
      return element.getClientRects().length > 0;
    };
    const controlLabel = (element, index) => {
      const tag = element.tagName.toLowerCase();
      const testid = element.getAttribute("data-testid");
      const key = element.getAttribute("data-key");
      const op = element.getAttribute("data-op");
      return testid ? `testid=${testid}` : key ? `key=${key}` : op ? `op=${op}` : `${tag}[${index}]`;
    };
    const controls = [...document.querySelectorAll("input,button")]
      .filter(visible)
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          label: controlLabel(element, index),
          width: rect.width,
          height: rect.height,
          fontSize: Number.parseFloat(style.fontSize),
        };
      });
    const keypad = document.querySelector('[data-testid="keypad"]');
    const digitButtons = [...document.querySelectorAll("button[data-key]")].filter((element) =>
      /^[0-9]$/.test(element.getAttribute("data-key") || ""),
    );
    return {
      viewport: { width: innerWidth, height: innerHeight },
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      controls,
      keypadVisible: Boolean(keypad && visible(keypad)),
      digitsVisible: digitButtons.filter(visible).length,
      digitsTotal: digitButtons.length,
    };
  });
}

function assessLayout(state, metrics) {
  const problems = [];
  if (metrics.docOverflow > 1) problems.push(`docOverflow=${metrics.docOverflow}`);
  if (metrics.bodyOverflow > 1) problems.push(`bodyOverflow=${metrics.bodyOverflow}`);
  if (metrics.controls.length === 0) problems.push("no visible controls");
  const small = metrics.controls.filter(
    (control) => control.width < 43.5 || control.height < 43.5,
  );
  const smallFonts = metrics.controls.filter((control) => control.fontSize < 16);
  if (small.length) {
    problems.push(
      `smallControls=${small
        .map((control) => `${control.label}:${control.width.toFixed(1)}x${control.height.toFixed(1)}`)
        .join(",")}`,
    );
  }
  if (smallFonts.length) {
    problems.push(
      `smallFonts=${smallFonts
        .map((control) => `${control.label}:${control.fontSize.toFixed(1)}`)
        .join(",")}`,
    );
  }
  if (!metrics.keypadVisible) problems.push("keypad not visible");
  if (metrics.digitsTotal !== 10 || metrics.digitsVisible !== 10) {
    problems.push(`visibleDigits=${metrics.digitsVisible}/${metrics.digitsTotal}`);
  }
  const minWidth = metrics.controls.length
    ? Math.min(...metrics.controls.map((control) => control.width))
    : null;
  const minHeight = metrics.controls.length
    ? Math.min(...metrics.controls.map((control) => control.height))
    : null;
  const minFont = metrics.controls.length
    ? Math.min(...metrics.controls.map((control) => control.fontSize))
    : null;
  const evidence = `${state}:docOverflow=${metrics.docOverflow},bodyOverflow=${metrics.bodyOverflow},controls=${metrics.controls.length},minW=${minWidth?.toFixed(1)},minH=${minHeight?.toFixed(1)},minFont=${minFont?.toFixed(1)},keypad=${metrics.keypadVisible},digits=${metrics.digitsVisible}/${metrics.digitsTotal}`;
  return { problems, evidence };
}

const results = [];

async function runH(id, callback) {
  try {
    const evidence = await callback();
    results.push({ id, pass: true, evidence: cleanText(evidence) });
  } catch (error) {
    const message = error instanceof CheckFailure ? error.message : String(error?.stack ?? error);
    results.push({ id, pass: false, evidence: cleanText(message) });
  }
}

await runH(1, async () => {
  const bytes = fs.readFileSync(artifactPath);
  const html = bytes.toString("utf8");
  const refs = countExternalReferences(html);
  let pageErrors = 0;
  await withFresh("H1", {}, async ({ errors }) => {
    pageErrors = errors.pageErrors.length;
  });
  const problems = [];
  if (!/<\/html>/i.test(html)) problems.push("missing </html>");
  if (bytes.length < 1024) problems.push(`length=${bytes.length}`);
  if (refs.length !== 0) problems.push(`externalRefs=${show(refs)}`);
  if (pageErrors !== 0) problems.push(`pageErrors=${pageErrors}`);
  assert(problems.length === 0, problems.join("; "));
  return `htmlClose=true length=${bytes.length} externalRefs=0 pageErrors=0 fileLoad=ok`;
});

await runH(2, async () => {
  return withFresh("H2", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, async ({ page, errors }) => {
    const digitStates = await digitKeyStates(page);
    const allEnabled = Object.values(digitStates).every((state) => state === "enabled");
    if (!allEnabled) {
      throw new CheckFailure(`digit keys not all enabled: ${show(digitStates)}; pageErrors=${errors.pageErrors.length}`);
    }
    await clickKey(page, "1");
    await clickKey(page, "2");
    const input = await page.locator(SEL.input).inputValue();
    await clickKey(page, "enter");
    const expression = cleanText(await page.locator(SEL.expression).textContent());
    const problems = [];
    if (input !== "12") problems.push(`input=${show(input)}`);
    if (!expression.includes("12")) problems.push(`expression=${show(expression)}`);
    if (errors.pageErrors.length !== 0) problems.push(`pageErrors=${errors.pageErrors.length}`);
    assert(problems.length === 0, problems.join("; "));
    return `viewport=390x844 mobile=true touch=true digitKeys=enabled input="12" expression=${show(expression)} pageErrors=0`;
  });
});

await runH(3, async () => {
  return withFresh("H3", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, async ({ page }) => {
    await clickOperator(page, "+");
    await enterNumber(page, "12");
    await enterNumber(page, "30");
    await clickEquals(page);
    const result = numericAttribute(await resultValue(page), "result data-value");
    const history = await historySnapshots(page);
    const top = history[0] ?? null;
    const problems = [];
    if (Math.abs(result - 42) > 1e-9) problems.push(`result=${result}`);
    if (!top || top.operator !== "+") problems.push(`operator=${show(top?.operator)}`);
    if (!top || !isDeepStrictEqual(top.operands, ["12", "30"])) {
      problems.push(`operands=${show(top?.operands)}`);
    }
    const historyResult = top ? numericAttribute(top.result, "history-result data-value") : Number.NaN;
    if (!Number.isFinite(historyResult) || Math.abs(historyResult - 42) > 1e-9) {
      problems.push(`historyResult=${show(top?.result)}`);
    }
    assert(problems.length === 0, problems.join("; "));
    return `result=42 operator="+" operands=["12","30"] historyResult=42`;
  });
});

await runH(4, async () => {
  return withFresh("H4", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, async ({ page }) => {
    await clickKey(page, "1");
    await clickKey(page, "2");
    await clickOperator(page, "+");
    const afterPlus = await page.locator(SEL.input).inputValue();
    await clickKey(page, "enter");
    await enterNumber(page, "30");
    await clickEquals(page);
    const result = numericAttribute(await resultValue(page), "result data-value");
    const top = (await historySnapshots(page))[0] ?? null;
    const problems = [];
    if (afterPlus !== "12") problems.push(`afterPlusInput=${show(afterPlus)}`);
    if (Math.abs(result - 42) > 1e-9) problems.push(`result=${result}`);
    if (!top || !isDeepStrictEqual(top.operands, ["12", "30"])) {
      problems.push(`operands=${show(top?.operands)}`);
    }
    assert(problems.length === 0, problems.join("; "));
    return `afterPlusInput="12" result=42 operands=["12","30"]`;
  });
});

await runH(5, async () => {
  return withFresh("H5", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, async ({ page }) => {
    await page.locator(SEL.input).click();
    await page.keyboard.type("12");
    const typedInput = await page.locator(SEL.input).inputValue();
    await page.keyboard.press("Enter");
    await clickOperator(page, "+");
    await page.keyboard.type("30");
    await page.keyboard.press("Enter");
    await page.keyboard.press("=");
    const result = numericAttribute(await resultValue(page), "result data-value");
    const top = (await historySnapshots(page))[0] ?? null;
    const problems = [];
    if (typedInput !== "12") problems.push(`typedInput=${show(typedInput)}`);
    if (Math.abs(result - 42) > 1e-9) problems.push(`result=${result}`);
    if (!top || top.operator !== "+") problems.push(`operator=${show(top?.operator)}`);
    if (!top || !isDeepStrictEqual(top.operands, ["12", "30"])) {
      problems.push(`operands=${show(top?.operands)}`);
    }
    assert(problems.length === 0, problems.join("; "));
    return `typedInput="12" result=42 operator="+" operands=["12","30"]`;
  });
});

await runH(6, async () => {
  return withFresh("H6", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, async ({ page }) => {
    await compute(page, "+", ["12", "30", "8"]);
    const before = await historySnapshots(page);
    await enterNumber(page, "5");
    await enterNumber(page, "6");
    await clickEquals(page);
    const after = await historySnapshots(page);
    const result = numericAttribute(await resultValue(page), "result data-value");
    const operator = await page.locator(SEL.app).getAttribute("data-operator");
    const priorUnchanged = isDeepStrictEqual(after.slice(1), before);
    const problems = [];
    if (Math.abs(result - 11) > 1e-9) problems.push(`result=${result}`);
    if (operator !== "+") problems.push(`operator=${show(operator)}`);
    if (after.length !== 3) problems.push(`history=${after.length}`);
    if (!priorUnchanged) problems.push("prior history snapshot changed");
    assert(
      problems.length === 0,
      `${problems.join("; ")}; measured result=${result},operator=${show(operator)},history=${after.length},priorRecords=${before.length},priorUnchanged=${priorUnchanged},priorHistory=${show(before.map(({ operator: priorOperator, operands, result: priorResult }) => ({ operator: priorOperator, operands, result: priorResult })))}`,
    );
    return `result=11 operator="+" history=3 priorRecords=${before.length} priorUnchanged=true`;
  });
});

await runH(7, async () => {
  return withFresh("H7", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, async ({ page }) => {
    await compute(page, "+", ["12", "30", "8"]);
    await compute(page, "*", ["2", "3", "4"]);
    const before = await historySnapshots(page);
    const editButtons = page.locator(SEL.historyEdit);
    assert((await editButtons.count()) >= 2, `history-edit count=${await editButtons.count()}`);
    await editButtons.nth(1).click();
    const operandInputs = page.locator(SEL.operandInput);
    const inputCount = await operandInputs.count();
    assert(inputCount >= 2, `operand-input count=${inputCount}`);
    await operandInputs.nth(1).fill("5");
    await clickEquals(page);
    const after = await historySnapshots(page);
    const top = after[0] ?? null;
    const topResult = top ? numericAttribute(top.result, "new top history result") : Number.NaN;
    const oldUnchanged = isDeepStrictEqual(after.slice(1), before);
    await page.reload({ waitUntil: "load" });
    const reloadHistory = await historyCount(page);
    const problems = [];
    if (!top || top.operator !== "+") problems.push(`operator=${show(top?.operator)}`);
    if (!top || !isDeepStrictEqual(top.operands, ["12", "5", "8"])) {
      problems.push(`operands=${show(top?.operands)}`);
    }
    if (Math.abs(topResult - 25) > 1e-9) problems.push(`result=${show(top?.result)}`);
    if (!oldUnchanged) problems.push("original history changed");
    if (reloadHistory !== 0) problems.push(`reloadHistory=${reloadHistory}`);
    assert(problems.length === 0, problems.join("; "));
    return `editedOperator="+" editedOperands=["12","5","8"] editedResult=25 originalsUnchanged=true reloadHistory=0`;
  });
});

await runH(8, async () => {
  return withFresh("H8", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, async ({ page }) => {
    await clickOperator(page, "/");
    await enterNumber(page, "5");
    await enterNumber(page, "0");
    const beforeErrorHistory = await historyCount(page);
    await clickEquals(page);
    const errorFlag = await resultError(page);
    const afterErrorHistory = await historyCount(page);
    const afterErrorDigits = await digitKeyStates(page);
    const digitsEnabled = Object.values(afterErrorDigits).every((state) => state === "enabled");
    await clickOperator(page, "+");
    await enterNumber(page, "1");
    await enterNumber(page, "2");
    await clickEquals(page);
    const recoveryResult = numericAttribute(await resultValue(page), "recovery result data-value");
    const recoveryError = await resultError(page);
    const recoveryHistory = await historyCount(page);
    const problems = [];
    if (errorFlag !== "true") problems.push(`data-error=${show(errorFlag)}`);
    if (afterErrorHistory !== beforeErrorHistory) {
      problems.push(`historyAfterError=${afterErrorHistory},before=${beforeErrorHistory}`);
    }
    if (!digitsEnabled) problems.push(`digitStates=${show(afterErrorDigits)}`);
    if (Math.abs(recoveryResult - 3) > 1e-9) problems.push(`recoveryResult=${recoveryResult}`);
    if (recoveryError !== null) problems.push(`recoveryDataError=${show(recoveryError)}`);
    if (recoveryHistory !== beforeErrorHistory + 1) {
      problems.push(`recoveryHistory=${recoveryHistory},expected=${beforeErrorHistory + 1}`);
    }
    assert(problems.length === 0, problems.join("; "));
    return `divisionByZeroError=true historyUnchanged=${beforeErrorHistory} digitsEnabled=10/10 recoveryResult=3 recoveryDataError=null history+1=${recoveryHistory}`;
  });
});

await runH(9, async () => {
  let direct;
  await withFresh("H9", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, async ({ page, errors }) => {
    await clickEquals(page);
    direct = {
      history: await historyCount(page),
      result: await resultValue(page),
      pageErrors: errors.pageErrors.length,
    };
  });
  let digitsThenEquals;
  await withFresh("H9", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, async ({ page, errors }) => {
    await clickKey(page, "1");
    await clickKey(page, "2");
    await clickEquals(page);
    digitsThenEquals = {
      history: await historyCount(page),
      result: await resultValue(page),
      pageErrors: errors.pageErrors.length,
    };
  });
  const problems = [];
  for (const [label, measured] of [["direct", direct], ["12", digitsThenEquals]]) {
    if (measured.history !== 0) problems.push(`${label}.history=${measured.history}`);
    if (measured.result !== null) problems.push(`${label}.result=${show(measured.result)}`);
    if (measured.pageErrors !== 0) problems.push(`${label}.pageErrors=${measured.pageErrors}`);
  }
  assert(problems.length === 0, problems.join("; "));
  return `direct:history=0,result=null,pageErrors=0; after12:history=0,result=null,pageErrors=0`;
});

await runH(10, async () => {
  const sections = [];
  const problems = [];
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
  ]) {
    const tag = `${viewport.width}x${viewport.height}`;
    await withFresh("H10", { viewport, isMobile: true, hasTouch: true }, async ({ page }) => {
      const cold = await measureLayout(page);
      const coldAssessment = assessLayout(`${tag}.cold`, cold);
      sections.push(coldAssessment.evidence);
      problems.push(...coldAssessment.problems.map((problem) => `${tag}.cold.${problem}`));

      await clickKey(page, "1");
      await clickKey(page, "2");
      const inputState = await page.locator(SEL.app).getAttribute("data-state");
      const unsubmittedValue = await page.locator(SEL.input).inputValue();
      const input = await measureLayout(page);
      const inputAssessment = assessLayout(`${tag}.input`, input);
      sections.push(`${inputAssessment.evidence},state=${show(inputState)},input=${show(unsubmittedValue)}`);
      problems.push(...inputAssessment.problems.map((problem) => `${tag}.input.${problem}`));
      if (inputState !== "input") problems.push(`${tag}.input.state=${show(inputState)}`);
      if (unsubmittedValue !== "12") problems.push(`${tag}.input.value=${show(unsubmittedValue)}`);

      await clickOperator(page, "+");
      await clickKey(page, "enter");
      await enterNumber(page, "30");
      await enterNumber(page, "8");
      await clickEquals(page);
      await compute(page, "*", ["2", "3", "4"]);
      const resultState = await page.locator(SEL.app).getAttribute("data-state");
      const resultCount = await historyCount(page);
      const resultMetrics = await measureLayout(page);
      const resultAssessment = assessLayout(`${tag}.result`, resultMetrics);
      sections.push(`${resultAssessment.evidence},state=${show(resultState)},history=${resultCount}`);
      problems.push(...resultAssessment.problems.map((problem) => `${tag}.result.${problem}`));
      if (resultState !== "result") problems.push(`${tag}.result.state=${show(resultState)}`);
      if (resultCount !== 2) problems.push(`${tag}.result.history=${resultCount}`);

      const editButtons = page.locator(SEL.historyEdit);
      assert((await editButtons.count()) >= 2, `${tag}.history-edit count=${await editButtons.count()}`);
      await editButtons.nth(1).click();
      const editState = await page.locator(SEL.app).getAttribute("data-state");
      const operandCount = await page.locator(SEL.operandInput).count();
      const editMetrics = await measureLayout(page);
      const editAssessment = assessLayout(`${tag}.edit`, editMetrics);
      sections.push(`${editAssessment.evidence},state=${show(editState)},operands=${operandCount}`);
      problems.push(...editAssessment.problems.map((problem) => `${tag}.edit.${problem}`));
      if (editState !== "edit") problems.push(`${tag}.edit.state=${show(editState)}`);
      if (operandCount !== 3) problems.push(`${tag}.edit.operandInputs=${operandCount}`);
    });
  }
  assert(problems.length === 0, `${problems.join(" | ")}; measured=${sections.join("; ")}`);
  return sections.join("; ");
});

await runH(12, async () => {
  const runs = [];
  for (let index = 0; index < 2; index += 1) {
    await withFresh("H12", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, async ({ page }) => {
      await compute(page, "+", ["12", "30", "8"]);
      await enterNumber(page, "5");
      await enterNumber(page, "6");
      await clickEquals(page);
      await clickOperator(page, "*");
      await enterNumber(page, "5");
      await enterNumber(page, "6");
      await clickEquals(page);
      const snapshots = await historySnapshots(page);
      const records = snapshots.map(({ operator, operands, result }) => ({
        operator,
        operands,
        result: result === null ? null : Number.parseFloat(result),
      }));
      runs.push(JSON.stringify(records));
    });
  }
  const problems = [];
  const firstCount = JSON.parse(runs[0]).length;
  const secondCount = JSON.parse(runs[1]).length;
  if (firstCount !== 3) problems.push(`first.records=${firstCount}`);
  if (secondCount !== 3) problems.push(`second.records=${secondCount}`);
  if (runs[0] !== runs[1]) problems.push("serialized histories differ");
  assert(problems.length === 0, `${problems.join("; ")}; first=${runs[0]} second=${runs[1]}`);
  return `contexts=2 records=3/3 serializedEqual=true history=${runs[0]}`;
});

await runH(11, async () => {
  const pageErrors = globalErrors.pageErrors;
  const consoleErrors = globalErrors.consoleErrors;
  assert(
    pageErrors.length === 0 && consoleErrors.length === 0,
    `pages=${openedPageCount} pageErrors=${show(pageErrors)} consoleErrors=${show(consoleErrors)}`,
  );
  return `pages=${openedPageCount} pageErrors=0 consoleErrors=0`;
});

results.sort((left, right) => left.id - right.id);
const failed = results.filter((result) => !result.pass).map((result) => `H${result.id}`);
const lines = [
  `ROUND: ${round}`,
  `ARTIFACT_SHA256: ${artifactSha256}`,
  `VERIFIER_SHA256: ${verifierSha256}`,
  ...results.map((result) => `H${result.id} ${result.pass ? "PASS" : "FAIL"} — ${result.evidence}`),
  failed.length === 0 ? "HARD: PASS" : `HARD: FAIL (${failed.join(",")})`,
];
const output = `${lines.join("\n")}\n`;
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outputPath, output, "utf8");
process.stdout.write(output);
await browser.close();
