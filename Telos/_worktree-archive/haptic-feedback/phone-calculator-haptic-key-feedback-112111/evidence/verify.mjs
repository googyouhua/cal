#!/usr/bin/env node
// Kekkai deterministic verifier: haptic key-feedback gate (phase=first).
// Measures H1..H6 against the artifact and writes hard-r<N>.txt under KEKKAI_OUT_DIR.
// Usage: node verify.mjs <round>
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const SCRIPT = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT);
const ROUND = Number(process.argv[2] ?? process.env.KEKKAI_ROUND ?? 1);
const ARTIFACT = process.env.KEKKAI_ARTIFACT ?? path.resolve(SCRIPT_DIR, "../../../index.html");
let OUT_DIR = process.env.KEKKAI_OUT_DIR;
if (!OUT_DIR) {
  OUT_DIR = path.join(os.tmpdir(), `kekkai-verify-${Date.now()}-${process.pid}`);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

const sha256File = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
let ARTIFACT_SHA256 = "missing";
try { ARTIFACT_SHA256 = sha256File(ARTIFACT); } catch { /* recorded below */ }
const VERIFIER_SHA256 = sha256File(SCRIPT);
const ART_URL = (() => { try { return pathToFileURL(ARTIFACT).href; } catch { return null; } })();

const PAGE_ERRORS = [];
const CONSOLE_ERRORS = [];
function hook(page) {
  page.on("pageerror", (e) => PAGE_ERRORS.push(String((e && e.stack) || e)));
  page.on("console", (m) => { if (m.type() === "error") CONSOLE_ERRORS.push(m.text()); });
}

let chromium = null;
let pwLoadError = "";
try {
  chromium = createRequire("/ws/cal_phone/tests/package.json")("playwright").chromium;
} catch (e1) {
  try {
    chromium = createRequire(path.join(SCRIPT_DIR, "noop.cjs"))("playwright").chromium;
  } catch (e2) {
    pwLoadError = String((e1 && e1.message) || e1);
  }
}

async function launch() {
  try {
    return await chromium.launch({ headless: true });
  } catch {
    return await chromium.launch({ headless: true, chromiumSandbox: false, args: ["--disable-gpu"] });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = (k) => `[data-testid="keypad"] [data-key="${k}"]`;
const OP = (o) => `[data-testid="op-picker"] [data-op="${o}"]`;
const SEL_INPUT = 'input[data-testid="calc-input"]';
const SEL_EXPR = '[data-testid="expression"]';
const SEL_RESULT = '[data-testid="result"]';
const SEL_APP = "main.app";
const SEL_EQUALS = 'button[data-testid="key-equals"]';
const VIB_OK = () => {
  window.__v = [];
  Object.defineProperty(Navigator.prototype, "vibrate", {
    configurable: true,
    value: function (p) { window.__v.push(p); return true; },
  });
};
async function vib(page) { return page.evaluate(() => window.__v); }
async function clearVib(page) { await page.evaluate(() => { window.__v = []; }); }
function normParams(calls) {
  const ds = [];
  for (const c of calls) {
    let arr;
    if (typeof c === "number") arr = [c];
    else if (Array.isArray(c)) arr = c;
    else return { ok: false, detail: `param-not-number/array ${JSON.stringify(c)}` };
    if (arr.length !== 1 || typeof arr[0] !== "number" || !Number.isFinite(arr[0])) {
      return { ok: false, detail: `arity/type ${JSON.stringify(c)}` };
    }
    ds.push(arr[0]);
  }
  const bad = ds.filter((d) => !(d >= 5 && d <= 30));
  if (bad.length) return { ok: false, detail: `duration-oob ${JSON.stringify(ds)}`, durations: ds };
  return { ok: true, detail: `dur=${JSON.stringify(ds)}`, durations: ds };
}
function newCtx(browser) {
  return browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
}

async function runH1(browser) {
  const ev = [];
  let pass = true;
  const sub = (ok, msg) => { ev.push(`${ok ? "ok" : "FAIL"} ${msg}`); if (!ok) pass = false; };
  const ctx = await newCtx(browser);
  await ctx.addInitScript(VIB_OK);
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(30000);
  hook(page);
  try {
    let digitOk = 0;
    const digitBad = [];
    for (const d of ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
      await page.goto(ART_URL, { waitUntil: "load" });
      await page.click(KEY(d));
      await sleep(80);
      const val = await page.$eval(SEL_INPUT, (el) => el.value);
      const calls = await vib(page);
      const n = normParams(calls);
      if (val === d && calls.length === 1 && n.ok) digitOk++;
      else digitBad.push(`${d}:input=${JSON.stringify(val)} calls=${JSON.stringify(calls)} ${n.detail}`);
    }
    sub(digitOk === 10, `digits ok=${digitOk}/10 ${digitBad.join("; ")}`);
    await page.goto(ART_URL, { waitUntil: "load" });
    await page.click(KEY("1"));
    await sleep(80);
    await clearVib(page);
    await page.click(KEY("."));
    await sleep(80);
    {
      const val = await page.$eval(SEL_INPUT, (el) => el.value);
      const calls = await vib(page);
      const n = normParams(calls);
      sub(val === "1." && calls.length === 1 && n.ok, `dot input=${JSON.stringify(val)} calls=${JSON.stringify(calls)} ${n.detail}`);
    }
    await page.goto(ART_URL, { waitUntil: "load" });
    for (const k of ["1", "2", "3"]) { await page.click(KEY(k)); await sleep(40); }
    await clearVib(page);
    await page.click(KEY("backspace"));
    await sleep(80);
    {
      const val = await page.$eval(SEL_INPUT, (el) => el.value);
      const calls = await vib(page);
      const n = normParams(calls);
      sub(val === "12" && calls.length === 1 && n.ok, `backspace input=${JSON.stringify(val)} calls=${JSON.stringify(calls)} ${n.detail}`);
    }
    await page.goto(ART_URL, { waitUntil: "load" });
    await page.click(KEY("9"));
    await sleep(80);
    await clearVib(page);
    await page.click(KEY("enter"));
    await sleep(80);
    {
      const val = await page.$eval(SEL_INPUT, (el) => el.value);
      const expr = await page.$eval(SEL_EXPR, (el) => el.textContent);
      const calls = await vib(page);
      const n = normParams(calls);
      sub(expr.includes("9") && val === "" && calls.length === 1 && n.ok, `enter expr=${JSON.stringify(expr)} input=${JSON.stringify(val)} calls=${JSON.stringify(calls)} ${n.detail}`);
    }
    await page.goto(ART_URL, { waitUntil: "load" });
    await page.click(OP("+"));
    await sleep(60);
    await page.click(KEY("1"));
    await sleep(60);
    await page.click(KEY("enter"));
    await sleep(60);
    await page.click(KEY("2"));
    await sleep(60);
    await clearVib(page);
    await page.click(SEL_EQUALS);
    await sleep(80);
    {
      const rv = await page.$eval(SEL_RESULT, (el) => el.getAttribute("data-value"));
      const calls = await vib(page);
      const n = normParams(calls);
      sub(rv === "3" && calls.length === 1 && n.ok, `equals result=${JSON.stringify(rv)} calls=${JSON.stringify(calls)} ${n.detail}`);
    }
    const opBad = [];
    let opOk = 0;
    for (const o of ["+", "-", "*", "/"]) {
      await clearVib(page);
      await page.click(OP(o));
      await sleep(80);
      const attr = await page.$eval(SEL_APP, (el) => el.getAttribute("data-operator"));
      const calls = await vib(page);
      const n = normParams(calls);
      if (attr === o && calls.length === 1 && n.ok) opOk++;
      else opBad.push(`${o}:attr=${JSON.stringify(attr)} calls=${JSON.stringify(calls)}`);
    }
    sub(opOk === 4, `operators ok=${opOk}/4 ${opBad.join("; ")}`);
    await page.goto(ART_URL, { waitUntil: "load" });
    await clearVib(page);
    for (let i = 0; i < 5; i++) { await page.click(KEY("1")); await sleep(70); }
    await sleep(80);
    {
      const calls = await vib(page);
      const n = normParams(calls);
      const val = await page.$eval(SEL_INPUT, (el) => el.value);
      sub(calls.length === 5 && n.ok, `burst5 calls=${calls.length} input=${JSON.stringify(val)} ${n.detail}`);
    }
  } catch (e) {
    sub(false, `exception ${String((e && e.message) || e).slice(0, 300)}`);
  } finally {
    await ctx.close();
  }
  return { id: "H1", pass, ev: ev.join(" | ") };
}

async function runH2(browser) {
  const ev = [];
  let pass = true;
  const sub = (ok, msg) => { ev.push(`${ok ? "ok" : "FAIL"} ${msg}`); if (!ok) pass = false; };
  const ctx = await newCtx(browser);
  await ctx.addInitScript(VIB_OK);
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(30000);
  hook(page);
  try {
    await page.goto(ART_URL, { waitUntil: "load" });
    await page.click('[data-testid="settings-toggle"]');
    await sleep(150);
    const h = await page.$eval('[data-testid="settings-haptics"]', (el) => ({
      exists: true, tag: el.tagName, type: el.type, checked: el.checked,
    })).catch(() => ({ exists: false }));
    sub(h.exists && h.tag === "INPUT" && h.type === "checkbox" && h.checked === true, `panel haptics=${JSON.stringify(h)}`);
    await page.click('[data-testid="settings-done"]');
    await sleep(120);
    await clearVib(page);
    await page.click(KEY("1"));
    await sleep(80);
    {
      const calls = await vib(page);
      const val = await page.$eval(SEL_INPUT, (el) => el.value);
      const n = normParams(calls);
      sub(calls.length === 1 && n.ok, `haptics-on vib=${calls.length} ${n.detail}`);
    }
    await page.click('[data-testid="settings-toggle"]');
    await sleep(150);
    await page.uncheck('[data-testid="settings-haptics"]');
    await page.click('[data-testid="settings-done"]');
    await sleep(120);
    await page.goto(ART_URL, { waitUntil: "load" });
    await clearVib(page);
    await page.click(KEY("1"));
    await sleep(80);
    {
      const calls = await vib(page);
      const val = await page.$eval(SEL_INPUT, (el) => el.value);
      sub(calls.length === 0 && val === "1", `haptics-off vib=${calls.length} input=${JSON.stringify(val)}`);
    }
    await page.reload({ waitUntil: "load" });
    await page.click('[data-testid="settings-toggle"]');
    await sleep(150);
    const checkedAfter = await page.$eval('[data-testid="settings-haptics"]', (el) => el.checked);
    await page.click('[data-testid="settings-done"]');
    await sleep(120);
    sub(checkedAfter === false, `persist-off checked=${checkedAfter}`);
    await clearVib(page);
    await page.click(KEY("1"));
    await sleep(80);
    {
      const calls = await vib(page);
      sub(calls.length === 0, `persist-off-click vib=${calls.length}`);
    }
    await page.click('[data-testid="settings-toggle"]');
    await sleep(150);
    await page.check('[data-testid="settings-haptics"]');
    await page.click('[data-testid="settings-done"]');
    await sleep(120);
    await page.reload({ waitUntil: "load" });
    await page.click('[data-testid="settings-toggle"]');
    await sleep(150);
    const checkedOn = await page.$eval('[data-testid="settings-haptics"]', (el) => el.checked);
    await page.click('[data-testid="settings-done"]');
    await sleep(120);
    sub(checkedOn === true, `persist-on checked=${checkedOn}`);
    await clearVib(page);
    await page.click(KEY("1"));
    await sleep(80);
    {
      const calls = await vib(page);
      const n = normParams(calls);
      sub(calls.length === 1 && n.ok, `persist-on-click vib=${calls.length} ${n.detail}`);
    }
    await page.click('[data-testid="settings-toggle"]');
    await sleep(150);
    await page.selectOption('[data-testid="settings-auto-confirm"]', "1");
    await page.check('[data-testid="settings-base-toggle"]');
    await page.fill('[data-testid="settings-base-value"]', "10");
    await page.click('[data-testid="settings-done"]');
    await sleep(120);
    await page.reload({ waitUntil: "load" });
    await page.click('[data-testid="settings-toggle"]');
    await sleep(150);
    const ac = await page.$eval('[data-testid="settings-auto-confirm"]', (el) => el.value);
    const bt = await page.$eval('[data-testid="settings-base-toggle"]', (el) => el.checked);
    const bv = await page.$eval('[data-testid="settings-base-value"]', (el) => el.value);
    let lsOk = false;
    let lsDetail = "";
    try {
      const raw = await page.evaluate(() => window.localStorage.getItem("cal-phone.settings.v1"));
      const parsed = JSON.parse(raw);
      lsOk = parsed && typeof parsed === "object";
      lsDetail = `ls=${raw}`;
    } catch (e) {
      lsDetail = `ls-parse-err ${String((e && e.message) || e).slice(0, 120)}`;
    }
    await page.click('[data-testid="settings-done"]');
    await sleep(120);
    sub(ac === "1" && bt === true && bv === "10" && lsOk, `persist-extra auto-confirm=${JSON.stringify(ac)} base-toggle=${bt} base-value=${JSON.stringify(bv)} ${lsDetail}`);
  } catch (e) {
    sub(false, `exception ${String((e && e.message) || e).slice(0, 300)}`);
  } finally {
    await ctx.close();
  }
  return { id: "H2", pass, ev: ev.join(" | ") };
}

async function runH3(browser) {
  const ev = [];
  let pass = true;
  const sub = (ok, msg) => { ev.push(`${ok ? "ok" : "FAIL"} ${msg}`); if (!ok) pass = false; };
  try {
    const ctxA = await newCtx(browser);
    await ctxA.addInitScript(() => {
      try {
        Object.defineProperty(Navigator.prototype, "vibrate", { configurable: true, writable: true, value: undefined });
      } catch (e) { /* ignore */ }
    });
    const pageA = await ctxA.newPage();
    pageA.setDefaultTimeout(20000);
    pageA.setDefaultNavigationTimeout(30000);
    const peA = [];
    const ceA = [];
    pageA.on("pageerror", (e) => { peA.push(String(e)); PAGE_ERRORS.push(`H3A:${String(e)}`); });
    pageA.on("console", (m) => { if (m.type() === "error") { ceA.push(m.text()); CONSOLE_ERRORS.push(`H3A:${m.text()}`); } });
    await pageA.goto(ART_URL, { waitUntil: "load" });
    await pageA.click(KEY("1"));
    await sleep(80);
    const v1 = await pageA.$eval(SEL_INPUT, (el) => el.value);
    await pageA.click(KEY("2"));
    await sleep(80);
    const v2 = await pageA.$eval(SEL_INPUT, (el) => el.value);
    await pageA.click(KEY("enter"));
    await sleep(80);
    const exprA = await pageA.$eval(SEL_EXPR, (el) => el.textContent);
    await pageA.click('[data-testid="settings-toggle"]');
    await sleep(150);
    await pageA.click('[data-testid="settings-done"]');
    await sleep(120);
    sub(v1 === "1" && v2 === "12" && exprA.includes("12") && peA.length === 0 && ceA.length === 0,
      `A novibrate input1=${JSON.stringify(v1)} input2=${JSON.stringify(v2)} expr=${JSON.stringify(exprA)} pageerrors=${peA.length} consoleerr=${ceA.length}`);
    await ctxA.close();

    const ctxB = await newCtx(browser);
    await ctxB.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "vibrate", {
        configurable: true,
        writable: true,
        value: function () { throw new Error("vibration-blocked"); },
      });
    });
    const pageB = await ctxB.newPage();
    pageB.setDefaultTimeout(20000);
    pageB.setDefaultNavigationTimeout(30000);
    const peB = [];
    const ceB = [];
    pageB.on("pageerror", (e) => { peB.push(String(e)); PAGE_ERRORS.push(`H3B:${String(e)}`); });
    pageB.on("console", (m) => { if (m.type() === "error") { ceB.push(m.text()); CONSOLE_ERRORS.push(`H3B:${m.text()}`); } });
    await pageB.goto(ART_URL, { waitUntil: "load" });
    await pageB.click(KEY("1"));
    await sleep(80);
    const w1 = await pageB.$eval(SEL_INPUT, (el) => el.value);
    await pageB.click(KEY("2"));
    await sleep(80);
    const w2 = await pageB.$eval(SEL_INPUT, (el) => el.value);
    await pageB.click(KEY("enter"));
    await sleep(80);
    const exprB = await pageB.$eval(SEL_EXPR, (el) => el.textContent);
    await pageB.click('[data-testid="settings-toggle"]');
    await sleep(150);
    await pageB.click('[data-testid="settings-done"]');
    await sleep(120);
    await pageB.click(KEY("3"));
    await sleep(80);
    const w3 = await pageB.$eval(SEL_INPUT, (el) => el.value);
    sub(w1 === "1" && w2 === "12" && exprB.includes("12") && w3 === "3" && peB.length === 0 && ceB.length === 0,
      `B throwing input1=${JSON.stringify(w1)} input2=${JSON.stringify(w2)} expr=${JSON.stringify(exprB)} after3=${JSON.stringify(w3)} pageerrors=${peB.length} consoleerr=${ceB.length}`);
    await ctxB.close();
  } catch (e) {
    sub(false, `exception ${String((e && e.message) || e).slice(0, 300)}`);
  }
  return { id: "H3", pass, ev: ev.join(" | ") };
}

async function runH4(browser) {
  const ev = [];
  let pass = true;
  const sub = (ok, msg) => { ev.push(`${ok ? "ok" : "FAIL"} ${msg}`); if (!ok) pass = false; };
  try {
    const ctx1 = await newCtx(browser);
    await ctx1.addInitScript(VIB_OK);
    const p1 = await ctx1.newPage();
    p1.setDefaultTimeout(20000);
    p1.setDefaultNavigationTimeout(30000);
    hook(p1);
    await p1.goto(ART_URL, { waitUntil: "load" });
    await p1.click('[data-testid="settings-toggle"]');
    await sleep(150);
    await p1.selectOption('[data-testid="settings-auto-confirm"]', "0.2");
    await p1.click('[data-testid="settings-done"]');
    await sleep(120);
    await clearVib(p1);
    await p1.click(KEY("9"));
    await sleep(600);
    {
      const calls = await vib(p1);
      const n = normParams(calls);
      const expr = await p1.$eval(SEL_EXPR, (el) => el.textContent);
      sub(calls.length === 1 && n.ok && expr.includes("9"), `auto-confirm vib=${calls.length} expr=${JSON.stringify(expr)} ${n.detail}`);
    }
    await ctx1.close();

    const ctx2 = await newCtx(browser);
    await ctx2.addInitScript(VIB_OK);
    const p2 = await ctx2.newPage();
    p2.setDefaultTimeout(20000);
    p2.setDefaultNavigationTimeout(30000);
    hook(p2);
    await p2.goto(ART_URL, { waitUntil: "load" });
    await p2.click('[data-testid="settings-toggle"]');
    await sleep(150);
    await p2.selectOption('[data-testid="settings-auto-confirm"]', "0");
    await p2.fill('[data-testid="settings-auto-equals"]', "2");
    await p2.click('[data-testid="settings-done"]');
    await sleep(120);
    await p2.click(OP("+"));
    await sleep(60);
    await clearVib(p2);
    await p2.click(KEY("9"));
    await sleep(60);
    await p2.click(KEY("enter"));
    await sleep(60);
    await p2.click(KEY("5"));
    await sleep(60);
    await p2.click(KEY("enter"));
    await sleep(400);
    {
      const calls = await vib(p2);
      const n = normParams(calls);
      const rv = await p2.$eval(SEL_RESULT, (el) => el.getAttribute("data-value"));
      const hist = await p2.$$eval('[data-testid="history-item"]', (els) => els.length);
      await sleep(300);
      const calls2 = await vib(p2);
      sub(calls.length === 4 && n.ok && rv === "14" && hist === 1 && calls2.length === 4,
        `auto-equals vib=${calls.length}->${calls2.length} result=${JSON.stringify(rv)} hist=${hist} ${n.detail}`);
    }
    await ctx2.close();

    const ctx3 = await newCtx(browser);
    await ctx3.addInitScript(VIB_OK);
    const p3 = await ctx3.newPage();
    p3.setDefaultTimeout(20000);
    p3.setDefaultNavigationTimeout(30000);
    hook(p3);
    await p3.goto(ART_URL, { waitUntil: "load" });
    await clearVib(p3);
    await sleep(200);
    const c0 = (await vib(p3)).length;
    await p3.click('[data-testid="settings-toggle"]');
    await sleep(150);
    await p3.click('[data-testid="settings-done"]');
    await sleep(120);
    await p3.evaluate(() => { document.querySelector('[data-testid="history"]').scrollIntoView(); });
    await sleep(120);
    const c1 = (await vib(p3)).length;
    sub(c0 === 0 && c1 === 0, `idle vib=${c0} after-panel+history vib=${c1}`);
    await ctx3.close();
  } catch (e) {
    sub(false, `exception ${String((e && e.message) || e).slice(0, 300)}`);
  }
  return { id: "H4", pass, ev: ev.join(" | ") };
}

async function runH5(browser) {
  const ev = [];
  let pass = true;
  const sub = (ok, msg) => { ev.push(`${ok ? "ok" : "FAIL"} ${msg}`); if (!ok) pass = false; };
  try {
    const { runSuite } = await import("file:///ws/cal_phone/tests/suite.mjs");
    const results = await runSuite({ artifact: ARTIFACT });
    const got = new Set(results.map((r) => r.id));
    const want = new Set(["self-contained", "cold-start", "compute", "arithmetic", "history-order", "reset",
      "continuity", "error-recovery", "sticky-operator", "edit-recompute", "edit-multi", "edit-invalid",
      "edit-divzero", "edit-cancel-restore", "edit-pending-replace", "edit-pending-recent-value",
      "layout", "determinism"]);
    const same = got.size === want.size && [...want].every((id) => got.has(id));
    const allPass = results.every((r) => r.pass);
    const cold = results.find((r) => r.id === "cold-start");
    const hasKeysEnabled = Boolean(cold && cold.checks.some((c) => c.id === "cold-start.keys-enabled" && c.pass));
    const bad = results.flatMap((r) => r.checks.filter((c) => !c.pass).map((c) => `${r.id}/${c.id}:${String(c.detail).slice(0, 160)}`));
    sub(same && allPass && hasKeysEnabled,
      `suite ids=${results.length} same=${same} allPass=${allPass} keys-enabled=${hasKeysEnabled}${bad.length ? ` fail:[${bad.join("; ")}]` : ""}`);
  } catch (e) {
    sub(false, `suite exception ${String((e && e.stack) || e).slice(0, 400)}`);
  }
  try {
    const ctx = await newCtx(browser);
    await ctx.addInitScript(VIB_OK);
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(30000);
    hook(page);
    async function coordClick(key) {
      const box = await page.locator(KEY(key)).boundingBox();
      if (!box) throw new Error(`no-box ${key}`);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    const wantSeq = ["1", "12", "123", "1234", "12345"];
    await page.goto(ART_URL, { waitUntil: "load" });
    const seq1 = [];
    for (const k of ["1", "2", "3", "4", "5"]) {
      await coordClick(k);
      await sleep(40);
      seq1.push(await page.$eval(SEL_INPUT, (el) => el.value));
    }
    const ok1 = JSON.stringify(seq1) === JSON.stringify(wantSeq);
    sub(ok1, `coord-on seq=${JSON.stringify(seq1)}`);
    await page.click('[data-testid="settings-toggle"]');
    await sleep(150);
    await page.uncheck('[data-testid="settings-haptics"]');
    await page.click('[data-testid="settings-done"]');
    await sleep(120);
    await page.goto(ART_URL, { waitUntil: "load" });
    const seq2 = [];
    for (const k of ["1", "2", "3", "4", "5"]) {
      await coordClick(k);
      await sleep(40);
      seq2.push(await page.$eval(SEL_INPUT, (el) => el.value));
    }
    const ok2 = JSON.stringify(seq2) === JSON.stringify(wantSeq);
    sub(ok2, `coord-off seq=${JSON.stringify(seq2)}`);
    await ctx.close();
  } catch (e) {
    sub(false, `coord exception ${String((e && e.message) || e).slice(0, 300)}`);
  }
  return { id: "H5", pass, ev: ev.join(" | ") };
}

function runH6() {
  const ev = [];
  let pass = true;
  const sub = (ok, msg) => { ev.push(`${ok ? "ok" : "FAIL"} ${msg}`); if (!ok) pass = false; };
  try {
    const html = fs.readFileSync(ARTIFACT, "utf8");
    const bytes = Buffer.byteLength(html);
    const hasClose = /<\/html\s*>/i.test(html);
    sub(hasClose, `html-close=${hasClose}`);
    sub(bytes >= 1024, `bytes=${bytes}`);
    const pats = ["<script src", "<link href", "<img src", "@import", "url(http"];
    let ext = 0;
    const per = [];
    for (const p of pats) {
      const n = html.split(p).length - 1;
      per.push(`${p}=${n}`);
      ext += n;
    }
    sub(ext === 0, `external=${ext} (${per.join(",")})`);
    sub(PAGE_ERRORS.length === 0 && CONSOLE_ERRORS.length === 0,
      `pageerrors=${PAGE_ERRORS.length} consoleErrors=${CONSOLE_ERRORS.length}${PAGE_ERRORS.length ? ` [${PAGE_ERRORS.join(" | ").slice(0, 300)}]` : ""}${CONSOLE_ERRORS.length ? ` [${CONSOLE_ERRORS.join(" | ").slice(0, 300)}]` : ""}`);
  } catch (e) {
    sub(false, `exception ${String((e && e.message) || e).slice(0, 300)}`);
  }
  return { id: "H6", pass, ev: ev.join(" | ") };
}

async function main() {
  const results = [];
  if (!chromium) {
    for (const id of ["H1", "H2", "H3", "H4", "H5"]) {
      results.push({ id, pass: false, ev: `FAIL playwright-unavailable ${pwLoadError.slice(0, 200)}` });
    }
    results.push(runH6());
  } else {
    const browser = await launch();
    try {
      results.push(await runH1(browser));
      results.push(await runH2(browser));
      results.push(await runH3(browser));
      results.push(await runH4(browser));
      results.push(await runH5(browser));
      results.push(runH6());
    } finally {
      await browser.close();
    }
  }
  const failed = results.filter((r) => !r.pass).map((r) => r.id);
  const lines = [];
  lines.push(`ROUND: ${ROUND}`);
  lines.push(`ARTIFACT_SHA256: ${ARTIFACT_SHA256}`);
  lines.push(`VERIFIER_SHA256: ${VERIFIER_SHA256}`);
  for (const r of results) {
    lines.push(`${r.id} ${r.pass ? "PASS" : "FAIL"} — ${r.ev}`);
  }
  lines.push(failed.length === 0 ? "HARD: PASS" : `HARD: FAIL (${failed.join(",")})`);
  const out = lines.join("\n") + "\n";
  const outFile = path.join(OUT_DIR, `hard-r${ROUND}.txt`);
  fs.writeFileSync(outFile, out);
  process.stdout.write(out);
}

main().catch((e) => {
  try {
    const out = [
      `ROUND: ${ROUND}`,
      `ARTIFACT_SHA256: ${ARTIFACT_SHA256}`,
      `VERIFIER_SHA256: ${VERIFIER_SHA256}`,
      `H0 FAIL — verifier-crash ${String((e && e.stack) || e).slice(0, 400)}`,
      "HARD: FAIL (H0)",
    ].join("\n") + "\n";
    fs.writeFileSync(path.join(OUT_DIR, `hard-r${ROUND}.txt`), out);
    process.stdout.write(out);
  } catch { /* ignore */ }
  process.exitCode = 1;
});
