#!/usr/bin/env node
// Kekkai gate verifier: result-pause first round. Measures H1..H6 against the artifact.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const ROUND = String(process.argv[2] || process.env.KEKKAI_ROUND || "1");
const ARTIFACT = process.env.KEKKAI_ARTIFACT || "/ws/cal_phone-worktrees/result-pause/index.html";
const OUT_DIR = process.env.KEKKAI_OUT_DIR || SCRIPT_DIR;
const TESTS_PKG = "/ws/cal_phone/tests/package.json";
const TESTS_MODULES = "/ws/cal_phone/tests/node_modules";
const SUITE_URL = "file:///ws/cal_phone-worktrees/result-pause/tests/suite.mjs";

process.env.NODE_PATH = [TESTS_MODULES, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
try { createRequire(import.meta.url)("node:module")._initPaths(); } catch {}

function loadPlaywright() {
  try { return createRequire(TESTS_PKG)("playwright"); }
  catch { return createRequire(import.meta.url)("playwright"); }
}

const GATE_IDS = { H1: "pause-blocks-digits", H2: "pause-defaults", H3: "pause-scope", H4: "auto-confirm", H5: "regression", H6: "self-contained" };
const results = { H1: null, H2: null, H3: null, H4: null, H5: null, H6: null };
const allPageErrors = [];
const allConsoleErrors = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256hex = (data) => crypto.createHash("sha256").update(data).digest("hex");

function vibrateHook() {
  window.__v = [];
  const mock = (pattern) => { window.__v.push(pattern); return true; };
  try { Object.defineProperty(window.navigator, "vibrate", { value: mock, configurable: true, writable: true }); }
  catch (err) { try { window.navigator.vibrate = mock; } catch (err2) {} }
}

async function launchBrowser() {
  const { chromium } = loadPlaywright();
  try { return await chromium.launch({ headless: true }); }
  catch {
    return await chromium.launch({ headless: true, chromiumSandbox: false, args: ["--disable-gpu"] });
  }
}

async function openTrackedPage(browser, hookFn = null) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  if (hookFn) await context.addInitScript(hookFn);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(15000);
  page.on("pageerror", (err) => allPageErrors.push(String((err && err.message) || err)));
  page.on("console", (msg) => { if (msg.type() === "error") allConsoleErrors.push(msg.text()); });
  await page.goto(pathToFileURL(ARTIFACT).href, { waitUntil: "load" });
  return { context, page, close: async () => { await context.close(); } };
}

async function openSettings(page) {
  await page.click('[data-testid="settings-toggle"]');
  await page.waitForSelector('[data-testid="settings-panel"][open]', { timeout: 10000 });
}
async function closeSettings(page) {
  await page.click('[data-testid="settings-done"]');
  await sleep(120);
}
const readPause = (page) => page.$eval('[data-testid="settings-result-pause"]', (el) => el.value);
const readResult = (page) => page.$eval('[data-testid="result"]', (el) => (el.textContent || "").trim());
const readExpr = (page) => page.$eval('[data-testid="expression"]', (el) => (el.textContent || "").trim());
const readInput = (page) => page.$eval('[data-testid="calc-input"]', (el) => el.value);
const readState = (page) => page.$eval("main.app", (el) => el.getAttribute("data-state"));

async function setPause(page, value) {
  await openSettings(page);
  await page.fill('[data-testid="settings-result-pause"]', value);
  await closeSettings(page);
  await openSettings(page);
  const back = await readPause(page);
  await closeSettings(page);
  return back;
}

async function manual12(page) {
  await page.click('[data-testid="op-picker"] [data-op="+"]');
  await page.click('[data-key="1"]');
  await page.click('[data-testid="enter"]');
  await page.click('[data-key="2"]');
  await page.click('[data-key="equals"]');
  return readResult(page);
}

async function checkH1(browser) {
  const detail = [];
  let ok = true;
  const snapshot = async (page) => ({ i: await readInput(page), r: await readResult(page), s: await readState(page) });
  // pause = 0.5s
  {
    const t = await openTrackedPage(browser);
    try {
      const back = await setPause(t.page, "0.5");
      const res = await manual12(t.page);
      let line = `pause=0.5: setback=${back} result=${res}`;
      if (res !== "3") { ok = false; detail.push(line + " expected=3"); }
      else {
        await sleep(50);
        await t.page.click('[data-key="4"]');
        const a = await snapshot(t.page);
        await sleep(200);
        await t.page.keyboard.press("5");
        const b = await readInput(t.page);
        await sleep(100);
        await t.page.click('[data-key="."]');
        const c = await readInput(t.page);
        await sleep(250);
        await t.page.click('[data-key="4"]');
        const d = await readInput(t.page);
        const pass = a.i === "" && a.r === "3" && a.s === "result" && b === "" && c === "" && d === "4";
        if (!pass) ok = false;
        line += ` block50ms(input=${JSON.stringify(a.i)},result=${a.r},state=${a.s}) key5@250ms=${JSON.stringify(b)} dot@350ms=${JSON.stringify(c)} key4@600ms=${JSON.stringify(d)}`;
        detail.push(line);
      }
    } catch (e) { ok = false; detail.push(`pause=0.5: EXC ${String(e && e.message || e).slice(0, 200)}`); }
    finally { await t.close(); }
  }
  // pause = 1.0s (default)
  {
    const t = await openTrackedPage(browser);
    try {
      const back = await setPause(t.page, "1");
      const res = await manual12(t.page);
      let line = `pause=1.0: setback=${back} result=${res}`;
      if (res !== "3") { ok = false; detail.push(line + " expected=3"); }
      else {
        await sleep(50);
        await t.page.click('[data-key="4"]');
        const a = await readInput(t.page);
        await sleep(1150);
        await t.page.click('[data-key="4"]');
        const b = await readInput(t.page);
        const pass = a === "" && b === "4";
        if (!pass) ok = false;
        line += ` key4@50ms=${JSON.stringify(a)} key4@1200ms=${JSON.stringify(b)}`;
        detail.push(line);
      }
    } catch (e) { ok = false; detail.push(`pause=1.0: EXC ${String(e && e.message || e).slice(0, 200)}`); }
    finally { await t.close(); }
  }
  // pause = 2.0s
  {
    const t = await openTrackedPage(browser);
    try {
      const back = await setPause(t.page, "2");
      const res = await manual12(t.page);
      let line = `pause=2.0: setback=${back} result=${res}`;
      if (res !== "3") { ok = false; detail.push(line + " expected=3"); }
      else {
        await sleep(50);
        await t.page.click('[data-key="4"]');
        const a = await readInput(t.page);
        await sleep(950);
        await t.page.click('[data-key="4"]');
        const b = await readInput(t.page);
        await sleep(1300);
        await t.page.click('[data-key="4"]');
        const c = await readInput(t.page);
        const pass = a === "" && b === "" && c === "4";
        if (!pass) ok = false;
        line += ` key4@50ms=${JSON.stringify(a)} key4@1000ms=${JSON.stringify(b)} key4@2300ms=${JSON.stringify(c)}`;
        detail.push(line);
      }
    } catch (e) { ok = false; detail.push(`pause=2.0: EXC ${String(e && e.message || e).slice(0, 200)}`); }
    finally { await t.close(); }
  }
  // pause = 0 (off)
  {
    const t = await openTrackedPage(browser);
    try {
      const back = await setPause(t.page, "0");
      const res = await manual12(t.page);
      await t.page.click('[data-key="4"]');
      const a = await readInput(t.page);
      const pass = res === "3" && a === "4";
      if (!pass) ok = false;
      detail.push(`pause=0: setback=${back} result=${res} key4@0ms=${JSON.stringify(a)}`);
    } catch (e) { ok = false; detail.push(`pause=0: EXC ${String(e && e.message || e).slice(0, 200)}`); }
    finally { await t.close(); }
  }
  return { pass: ok, detail: detail.join(" | ") };
}

async function checkH2(browser) {
  const detail = [];
  let ok = true;
  const t = await openTrackedPage(browser);
  try {
    await openSettings(t.page);
    const def = await readPause(t.page);
    await closeSettings(t.page);
    const defOk = Number(def) === 1;
    if (!defOk) ok = false;
    detail.push(`default=${def}`);
    const back05 = await setPause(t.page, "0.5");
    await t.page.reload({ waitUntil: "load" });
    await openSettings(t.page);
    const r05 = await readPause(t.page);
    await closeSettings(t.page);
    if (Number(r05) !== 0.5) ok = false;
    detail.push(`persist0.5 setback=${back05} reload=${r05}`);
    const back0 = await setPause(t.page, "0");
    await t.page.reload({ waitUntil: "load" });
    await openSettings(t.page);
    const r0 = await readPause(t.page);
    await closeSettings(t.page);
    if (Number(r0) !== 0) ok = false;
    detail.push(`persist0 setback=${back0} reload=${r0}`);
    const back2 = await setPause(t.page, "2");
    await t.page.reload({ waitUntil: "load" });
    await openSettings(t.page);
    const r2 = await readPause(t.page);
    if (Number(r2) !== 2) ok = false;
    detail.push(`persist2 setback=${back2} reload=${r2}`);
    await t.page.fill('[data-testid="settings-result-pause"]', "abc");
    await t.page.$eval('[data-testid="settings-result-pause"]', (el) => el.blur());
    const afterAbc = await readPause(t.page);
    if (afterAbc !== "2") ok = false;
    detail.push(`invalid-abc blur-restore=${afterAbc}`);
    await t.page.fill('[data-testid="settings-result-pause"]', "");
    await t.page.$eval('[data-testid="settings-result-pause"]', (el) => el.blur());
    const afterEmpty = await readPause(t.page);
    if (afterEmpty !== "2") ok = false;
    detail.push(`invalid-empty blur-restore=${afterEmpty}`);
    await closeSettings(t.page);
    const raw = await t.page.evaluate(() => window.localStorage.getItem("cal-phone.settings.v1"));
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch {}
    const keysOk = parsed && typeof parsed === "object"
      && ("autoConfirm" in parsed) && ("baseEnabled" in parsed) && ("haptics" in parsed) && ("resultPause" in parsed);
    if (!keysOk) ok = false;
    detail.push(`storage=${raw ? raw.slice(0, 160) : "null"}`);
  } catch (e) { ok = false; detail.push(`EXC ${String(e && e.message || e).slice(0, 200)}`); }
  finally { await t.close(); }
  return { pass: ok, detail: detail.join(" | ") };
}

async function checkH3(browser) {
  const detail = [];
  let ok = true;
  // manual = path pauses
  {
    const t = await openTrackedPage(browser);
    try {
      const res = await manual12(t.page);
      await sleep(50);
      await t.page.click('[data-key="1"]');
      const a = await readInput(t.page);
      const pass = res === "3" && a === "";
      if (!pass) ok = false;
      detail.push(`manual result=${res} key1@50ms=${JSON.stringify(a)}`);
    } catch (e) { ok = false; detail.push(`manual EXC ${String(e && e.message || e).slice(0, 200)}`); }
    finally { await t.close(); }
  }
  // auto-equals path pauses
  {
    const t = await openTrackedPage(browser);
    try {
      await openSettings(t.page);
      await t.page.selectOption('[data-testid="settings-auto-confirm"]', "0");
      await t.page.fill('[data-testid="settings-auto-equals"]', "2");
      await closeSettings(t.page);
      await t.page.click('[data-testid="op-picker"] [data-op="+"]');
      await t.page.click('[data-key="9"]');
      await t.page.click('[data-testid="enter"]');
      await t.page.click('[data-key="5"]');
      await t.page.click('[data-testid="enter"]');
      await t.page.waitForFunction(() => (document.querySelector('[data-testid="result"]') || {}).textContent.trim() === "14", null, { timeout: 10000 });
      await t.page.click('[data-key="4"]');
      const a = await readInput(t.page);
      await sleep(1300);
      await t.page.click('[data-key="4"]');
      const b = await readInput(t.page);
      const pass = a === "" && b === "4";
      if (!pass) ok = false;
      detail.push(`auto result=14 key4@0ms=${JSON.stringify(a)} key4@1300ms=${JSON.stringify(b)}`);
    } catch (e) { ok = false; detail.push(`auto EXC ${String(e && e.message || e).slice(0, 200)}`); }
    finally { await t.close(); }
  }
  // div-by-zero: no pause
  {
    const t = await openTrackedPage(browser);
    try {
      await t.page.click('[data-testid="op-picker"] [data-op="/"]');
      await t.page.click('[data-key="5"]');
      await t.page.click('[data-testid="enter"]');
      await t.page.click('[data-key="0"]');
      await t.page.click('[data-testid="enter"]');
      await t.page.click('[data-key="equals"]');
      const err = await t.page.$eval('[data-testid="result"]', (el) => el.getAttribute("data-error"));
      await t.page.click('[data-key="1"]');
      const a = await readInput(t.page);
      const pass = err === "true" && a === "1";
      if (!pass) ok = false;
      detail.push(`div0 error=${err} key1@0ms=${JSON.stringify(a)}`);
    } catch (e) { ok = false; detail.push(`div0 EXC ${String(e && e.message || e).slice(0, 200)}`); }
    finally { await t.close(); }
  }
  // bare = with no operator/operands: no pause
  {
    const t = await openTrackedPage(browser);
    try {
      await t.page.click('[data-key="equals"]');
      await t.page.click('[data-key="1"]');
      const a = await readInput(t.page);
      const passA = a === "1";
      if (!passA) ok = false;
      detail.push(`bare-eq(no-op/operand) key1=${JSON.stringify(a)}`);
    } catch (e) { ok = false; detail.push(`bare-eq EXC ${String(e && e.message || e).slice(0, 200)}`); }
    finally { await t.close(); }
  }
  {
    const t = await openTrackedPage(browser);
    try {
      await t.page.click('[data-testid="op-picker"] [data-op="+"]');
      await t.page.click('[data-key="equals"]');
      const st = await readState(t.page);
      await t.page.click('[data-key="1"]');
      const b = await readInput(t.page);
      const pass = b === "1";
      if (!pass) ok = false;
      detail.push(`bare-eq(op-no-operands) stateAfterEq=${st} key1=${JSON.stringify(b)}`);
    } catch (e) { ok = false; detail.push(`bare-eq EXC ${String(e && e.message || e).slice(0, 200)}`); }
    finally { await t.close(); }
  }
  // backspace / enter / equals during pause: no pageerror
  {
    const t = await openTrackedPage(browser);
    const before = allPageErrors.length;
    try {
      const res = await manual12(t.page);
      await t.page.click('[data-key="backspace"]');
      await t.page.click('[data-testid="enter"]');
      await t.page.click('[data-key="equals"]');
      await sleep(200);
      const delta = allPageErrors.length - before;
      const pass = res === "3" && delta === 0;
      if (!pass) ok = false;
      detail.push(`pause-keys result=${res} newPageErrors=${delta}`);
    } catch (e) { ok = false; detail.push(`pause-keys EXC ${String(e && e.message || e).slice(0, 200)}`); }
    finally { await t.close(); }
  }
  return { pass: ok, detail: detail.join(" | ") };
}

async function checkH4(browser) {
  const detail = [];
  let ok = true;
  const t = await openTrackedPage(browser);
  try {
    await openSettings(t.page);
    const vals = await t.page.$$eval('[data-testid="settings-auto-confirm"] option', (els) => els.map((e) => e.value));
    const nums = vals.map(Number);
    const expected = [0, 0.1, 0.2, 0.4, ...Array.from({ length: 20 }, (_, i) => (i + 1) / 2)];
    const expectedVals = expected.map(String);
    const has01 = vals.includes("0.1");
    const countOk = vals.length === 24;
    const sorted = nums.every((n, i) => i === 0 || nums[i - 1] < n);
    const noDup = new Set(vals).size === vals.length;
    const origOk = expectedVals.every((v) => vals.includes(v));
    if (!(has01 && countOk && sorted && noDup && origOk)) ok = false;
    detail.push(`options n=${vals.length} has0.1=${has01} sorted=${sorted} nodup=${noDup} orig24=${origOk} [${vals.join(",")}]`);
    await t.page.selectOption('[data-testid="settings-auto-confirm"]', "0.1");
    await closeSettings(t.page);
    await t.page.click('[data-testid="op-picker"] [data-op="+"]');
    await t.page.click('[data-key="9"]');
    await sleep(250);
    const e1 = await readExpr(t.page);
    const i1 = await readInput(t.page);
    if (!(e1.includes("9") && i1 === "")) ok = false;
    detail.push(`ac0.1 expr=${JSON.stringify(e1)} input=${JSON.stringify(i1)}`);
    await t.page.reload({ waitUntil: "load" });
    await openSettings(t.page);
    await t.page.selectOption('[data-testid="settings-auto-confirm"]', "0");
    await closeSettings(t.page);
    await t.page.click('[data-testid="op-picker"] [data-op="+"]');
    await t.page.click('[data-key="9"]');
    await sleep(1200);
    const e0 = await readExpr(t.page);
    const i0 = await readInput(t.page);
    if (!(i0 === "9" && e0 === "")) ok = false;
    detail.push(`ac0 expr=${JSON.stringify(e0)} input=${JSON.stringify(i0)}`);
    await t.page.reload({ waitUntil: "load" });
    await openSettings(t.page);
    await t.page.selectOption('[data-testid="settings-auto-confirm"]', "0.2");
    await closeSettings(t.page);
    await t.page.click('[data-testid="op-picker"] [data-op="+"]');
    await t.page.click('[data-key="9"]');
    await sleep(600);
    const e2 = await readExpr(t.page);
    if (!e2.includes("9")) ok = false;
    detail.push(`ac0.2 expr=${JSON.stringify(e2)}`);
  } catch (e) { ok = false; detail.push(`EXC ${String(e && e.message || e).slice(0, 200)}`); }
  finally { await t.close(); }
  return { pass: ok, detail: detail.join(" | ") };
}

async function checkH5(browser) {
  const detail = [];
  let ok = true;
  try {
    process.env.NODE_PATH = [TESTS_MODULES, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
    try { createRequire(import.meta.url)("node:module")._initPaths(); } catch {}
    const { runSuite } = await import(SUITE_URL);
    const suiteResults = await runSuite({ artifact: ARTIFACT });
    const expectedIds = ["self-contained", "cold-start", "compute", "arithmetic", "history-order", "reset", "continuity", "error-recovery", "sticky-operator", "edit-recompute", "edit-multi", "edit-invalid", "edit-divzero", "edit-cancel-restore", "edit-pending-replace", "edit-pending-recent-value", "layout", "determinism"];
    const byId = new Map(suiteResults.map((r) => [r.id, r]));
    const missing = expectedIds.filter((id) => !byId.has(id));
    const failed = expectedIds.filter((id) => byId.has(id) && !byId.get(id).pass);
    const extra = suiteResults.filter((r) => !r.pass).map((r) => r.id);
    const cold = byId.get("cold-start");
    const coldKeys = cold ? cold.checks.some((c) => c.id === "cold-start.keys-enabled" && c.pass) : false;
    if (missing.length || failed.length || !coldKeys) ok = false;
    const failedChecks = [];
    for (const r of suiteResults) for (const c of (r.checks || [])) if (!c.pass) failedChecks.push(c.id);
    detail.push(`suite scenarios=${suiteResults.length}/18 missing=[${missing.join(",")}] failed=[${failed.join(",")}] cold-keys-enabled=${coldKeys} failedChecks=[${failedChecks.slice(0, 8).join(",")}]`);
  } catch (e) { ok = false; detail.push(`suite EXC ${String(e && e.message || e).slice(0, 300)}`); }
  // haptics: idle key press vibrates exactly [10]
  {
    const t = await openTrackedPage(browser, vibrateHook);
    try {
      await t.page.click('[data-key="1"]');
      await sleep(150);
      const vib = await t.page.evaluate(() => window.__v);
      const pass = Array.isArray(vib) && vib.length === 1 && vib[0] === 10;
      if (!pass) ok = false;
      detail.push(`haptics __v=${JSON.stringify(vib)}`);
    } catch (e) { ok = false; detail.push(`haptics EXC ${String(e && e.message || e).slice(0, 200)}`); }
    finally { await t.close(); }
  }
  // direct: history, edit, divzero, settings persistence
  {
    const t = await openTrackedPage(browser);
    try {
      const res = await manual12(t.page);
      const hist = await t.page.$$eval('[data-testid="history-item"]', (els) => els.length);
      await t.page.click('[data-testid="history-edit"]');
      await sleep(200);
      const draftVisible = await t.page.$eval('[data-testid="edit-draft"]', (el) => !el.hidden && el.getClientRects().length > 0);
      await t.page.click('[data-testid="edit-cancel"]');
      await sleep(150);
      const draftHidden = await t.page.$eval('[data-testid="edit-draft"]', (el) => Boolean(el.hidden));
      if (!(res === "3" && hist === 1 && draftVisible && draftHidden)) ok = false;
      detail.push(`history result=${res} items=${hist} editOpen=${draftVisible} editCancel=${draftHidden}`);
      await t.page.click('[data-testid="op-picker"] [data-op="/"]');
      await t.page.click('[data-key="5"]');
      await t.page.click('[data-testid="enter"]');
      await t.page.click('[data-key="0"]');
      await t.page.click('[data-testid="enter"]');
      await t.page.click('[data-key="equals"]');
      const err = await t.page.$eval('[data-testid="result"]', (el) => el.getAttribute("data-error"));
      if (err !== "true") ok = false;
      detail.push(`divzero error=${err}`);
      const back = await setPause(t.page, "0.5");
      await t.page.reload({ waitUntil: "load" });
      await openSettings(t.page);
      const rp = await readPause(t.page);
      await closeSettings(t.page);
      if (Number(rp) !== 0.5) ok = false;
      detail.push(`settings-persist setback=${back} reload=${rp}`);
    } catch (e) { ok = false; detail.push(`direct EXC ${String(e && e.message || e).slice(0, 200)}`); }
    finally { await t.close(); }
  }
  return { pass: ok, detail: detail.join(" | ") };
}

async function checkH6() {
  try {
    const buf = fs.readFileSync(ARTIFACT);
    const html = buf.toString("utf8");
    const hasClose = /<\/html\s*>/i.test(html);
    const bytes = Buffer.byteLength(html);
    const sizeOk = bytes >= 1024;
    const lower = html.toLowerCase();
    let refs = 0;
    for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=/gi)) refs += 1;
    for (const m of html.matchAll(/<link\b[^>]*\bhref\s*=/gi)) refs += 1;
    for (const m of html.matchAll(/<img\b[^>]*\bsrc\s*=/gi)) refs += 1;
    for (const m of lower.matchAll(/@import/gi)) refs += 1;
    for (const m of lower.matchAll(/url\(http/gi)) refs += 1;
    const errTotal = allPageErrors.length + allConsoleErrors.length;
    const pass = hasClose && sizeOk && refs === 0 && errTotal === 0;
    const detail = `close=${hasClose} bytes=${bytes} extrefs=${refs} pageerrors=${allPageErrors.length} consoleerrors=${allConsoleErrors.length}`
      + (allPageErrors.length ? ` first=${allPageErrors[0].slice(0, 160)}` : "")
      + (allConsoleErrors.length ? ` firstConsole=${allConsoleErrors[0].slice(0, 160)}` : "");
    return { pass, detail };
  } catch (e) {
    return { pass: false, detail: `EXC ${String(e && e.message || e).slice(0, 200)}` };
  }
}

async function main() {
  const artifactBytes = fs.readFileSync(ARTIFACT);
  const artifactSha = sha256hex(artifactBytes);
  const verifierSha = sha256hex(fs.readFileSync(SCRIPT_PATH));
  const browser = await launchBrowser();
  try {
    results.H1 = await checkH1(browser);
    results.H2 = await checkH2(browser);
    results.H3 = await checkH3(browser);
    results.H4 = await checkH4(browser);
    results.H5 = await checkH5(browser);
  } finally {
    await browser.close();
  }
  results.H6 = await checkH6();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `hard-r${ROUND}.txt`);
  const lines = [];
  lines.push(`ROUND: ${ROUND}`);
  lines.push(`ARTIFACT_SHA256: ${artifactSha}`);
  lines.push(`VERIFIER_SHA256: ${verifierSha}`);
  lines.push(`H1 ${results.H1.pass ? "PASS" : "FAIL"} — ${results.H1.detail}`);
  lines.push(`H2 ${results.H2.pass ? "PASS" : "FAIL"} — ${results.H2.detail}`);
  lines.push(`H3 ${results.H3.pass ? "PASS" : "FAIL"} — ${results.H3.detail}`);
  lines.push(`H4 ${results.H4.pass ? "PASS" : "FAIL"} — ${results.H4.detail}`);
  lines.push(`H5 ${results.H5.pass ? "PASS" : "FAIL"} — ${results.H5.detail}`);
  lines.push(`H6 ${results.H6.pass ? "PASS" : "FAIL"} — ${results.H6.detail}`);
  const failedIds = Object.keys(GATE_IDS).filter((id) => !(results[id] && results[id].pass));
  lines.push(failedIds.length === 0 ? "HARD: PASS" : `HARD: FAIL (${failedIds.join(",")})`);
  fs.writeFileSync(outFile, lines.join("\n") + "\n", "utf8");
  for (const line of lines) console.log(line);
  process.exit(failedIds.length === 0 ? 0 : 1);
}

main().catch((err) => {
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const artifactSha = fs.existsSync(ARTIFACT) ? sha256hex(fs.readFileSync(ARTIFACT)) : "missing";
    const verifierSha = fs.existsSync(SCRIPT_PATH) ? sha256hex(fs.readFileSync(SCRIPT_PATH)) : "missing";
    const lines = [`ROUND: ${ROUND}`, `ARTIFACT_SHA256: ${artifactSha}`, `VERIFIER_SHA256: ${verifierSha}`];
    for (const id of Object.keys(GATE_IDS)) {
      const r = results[id];
      lines.push(`${id} ${r && r.pass ? "PASS" : "FAIL"} — ${(r && r.detail) || "not-reached"} — crash=${String((err && err.message) || err).slice(0, 160)}`);
    }
    const failedIds = Object.keys(GATE_IDS).filter((id) => !(results[id] && results[id].pass));
    lines.push(`HARD: FAIL (${failedIds.join(",")})`);
    fs.writeFileSync(path.join(OUT_DIR, `hard-r${ROUND}.txt`), lines.join("\n") + "\n", "utf8");
    for (const line of lines) console.log(line);
  } catch {}
  process.exit(1);
});
