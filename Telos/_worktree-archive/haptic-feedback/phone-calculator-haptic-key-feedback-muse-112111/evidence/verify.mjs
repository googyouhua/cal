#!/usr/bin/env node
// Deterministic gate verifier: haptic key feedback (first/final shared logic).
// Measures H1..H6 against the artifact with Playwright + Node assertions.
// Interface: KEKKAI_ARTIFACT overrides target path; KEKKAI_OUT_DIR overrides
// output dir (defaults to <scriptDir>/runs). Round from argv[2].
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const SCRIPT = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT);
const ROUND = String(process.argv[2] || process.env.KEKKAI_ROUND || "1");
const ARTIFACT = process.env.KEKKAI_ARTIFACT || "/ws/cal_phone-worktrees/haptics/index.html";
const OUT_DIR = process.env.KEKKAI_OUT_DIR || path.join(SCRIPT_DIR, "runs");
const REVIEW_STATES = process.env.KEKKAI_EXPECTED_REVIEW_STATES || "none";

const requireTests = createRequire("/ws/cal_phone/tests/package.json");
const { chromium } = requireTests("playwright");

const VP = { width: 390, height: 844 };
const VIB_HOOK =
  "window.__v = []; Object.defineProperty(Navigator.prototype, 'vibrate', " +
  "{ configurable: true, value: function (p) { window.__v.push(p); return true; } });";

const ALL_PE = [];
const ALL_CE = [];
function track(page, tag) {
  page.on("pageerror", (e) => ALL_PE.push(`[${tag}] ${String((e && e.stack) || e)}`));
  page.on("console", (m) => {
    if (m.type() === "error") ALL_CE.push(`[${tag}] ${m.text()}`);
  });
}

async function launch() {
  try {
    return await chromium.launch({ headless: true });
  } catch (e) {
    return await chromium.launch({ headless: true, chromiumSandbox: false, args: ["--disable-gpu"] });
  }
}

async function openPage(ctx, tag) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(15000);
  track(page, tag);
  await page.goto(pathToFileURL(ARTIFACT).href, { waitUntil: "load" });
  return page;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function clearV(page) {
  await page.evaluate(() => {
    window.__v = [];
  });
}
async function readV(page) {
  return await page.evaluate(() => window.__v);
}
async function tapMeasure(page, selector) {
  await clearV(page);
  await page.click(selector);
  await sleep(80);
  return readV(page);
}
// Parameter normalization: number -> [n]; array must hold exactly one number.
function normCalls(raw) {
  const ds = [];
  for (const p of raw) {
    if (typeof p === "number") ds.push(p);
    else if (Array.isArray(p) && p.length === 1 && typeof p[0] === "number") ds.push(p[0]);
    else return { ok: false, durations: [] };
  }
  return { ok: true, durations: ds };
}
const durOk = (d) => d >= 5 && d <= 30;
const inputVal = (page) => page.$eval('[data-testid="calc-input"]', (el) => el.value);
const exprText = (page) => page.$eval('[data-testid="expression"]', (el) => (el.textContent || "").trim());
const resultDV = (page) => page.$eval('[data-testid="result"]', (el) => el.getAttribute("data-value"));
const appOp = (page) => page.$eval("main.app", (el) => el.getAttribute("data-operator"));

async function H1(browser) {
  const notes = [];
  let pass = true;
  const ctx = await browser.newContext({ viewport: VP, isMobile: true, hasTouch: true });
  await ctx.addInitScript({ content: VIB_HOOK });
  const page = await openPage(ctx, "h1");
  const sub = (ok, note) => {
    if (!ok) pass = false;
    notes.push(note);
  };
  for (const d of ["0","1","2","3","4","5","6","7","8","9"]) {
    await page.reload({ waitUntil: "load" });
    const raw = await tapMeasure(page, `[data-key="${d}"]`);
    const n = normCalls(raw);
    const v = await inputVal(page);
    const ok = n.ok && n.durations.length === 1 && durOk(n.durations[0]) && v === d;
    sub(ok, `key${d}:value=${JSON.stringify(v)} calls=${JSON.stringify(n.durations)}`);
  }
  await page.reload({ waitUntil: "load" });
  await page.click('[data-key="1"]');
  await sleep(60);
  {
    const raw = await tapMeasure(page, '[data-key="."]');
    const n = normCalls(raw);
    const v = await inputVal(page);
    const ok = n.ok && n.durations.length === 1 && durOk(n.durations[0]) && v === "1.";
    sub(ok, `dot:value=${JSON.stringify(v)} calls=${JSON.stringify(n.durations)}`);
  }
  await page.reload({ waitUntil: "load" });
  for (const d of ["1","2","3"]) {
    await page.click(`[data-key="${d}"]`);
    await sleep(40);
  }
  {
    const raw = await tapMeasure(page, '[data-key="backspace"]');
    const n = normCalls(raw);
    const v = await inputVal(page);
    const ok = n.ok && n.durations.length === 1 && durOk(n.durations[0]) && v === "12";
    sub(ok, `backspace:value=${JSON.stringify(v)} calls=${JSON.stringify(n.durations)}`);
  }
  await page.reload({ waitUntil: "load" });
  await page.click('[data-key="9"]');
  await sleep(60);
  {
    const raw = await tapMeasure(page, '[data-key="enter"]');
    const n = normCalls(raw);
    const v = await inputVal(page);
    const e = await exprText(page);
    const ok = n.ok && n.durations.length === 1 && durOk(n.durations[0]) && v === "" && e.includes("9");
    sub(ok, `enter:input=${JSON.stringify(v)} expr=${JSON.stringify(e)} calls=${JSON.stringify(n.durations)}`);
  }
  await page.reload({ waitUntil: "load" });
  await page.click('[data-testid="op-picker"] [data-op="+"]');
  await sleep(40);
  await page.click('[data-key="1"]');
  await sleep(40);
  await page.click('[data-key="enter"]');
  await sleep(40);
  await page.click('[data-key="2"]');
  await sleep(40);
  {
    const raw = await tapMeasure(page, '[data-key="equals"]');
    const n = normCalls(raw);
    const dv = await resultDV(page);
    const ok = n.ok && n.durations.length === 1 && durOk(n.durations[0]) && dv === "3";
    sub(ok, `equals:result=${JSON.stringify(dv)} calls=${JSON.stringify(n.durations)}`);
  }
  for (const op of ["+", "-", "*", "/"]) {
    await page.reload({ waitUntil: "load" });
    const raw = await tapMeasure(page, `[data-testid="op-picker"] [data-op="${op}"]`);
    const n = normCalls(raw);
    const a = await appOp(page);
    const ok = n.ok && n.durations.length === 1 && durOk(n.durations[0]) && a === op;
    sub(ok, `op${op}:data-operator=${JSON.stringify(a)} calls=${JSON.stringify(n.durations)}`);
  }
  await page.reload({ waitUntil: "load" });
  await clearV(page);
  for (let i = 0; i < 5; i++) {
    await page.click('[data-key="1"]');
    await sleep(80);
  }
  {
    const raw = await readV(page);
    const n = normCalls(raw);
    const ok = n.ok && n.durations.length === 5;
    sub(ok, `burst5:count=${n.durations.length} calls=${JSON.stringify(n.durations)}`);
  }
  await ctx.close();
  return { pass, evidence: notes.join(" | ") };
}

async function H2(browser) {
  const notes = [];
  let pass = true;
  const sub = (ok, note) => {
    if (!ok) pass = false;
    notes.push(note);
  };
  const ctx = await browser.newContext({ viewport: VP, isMobile: true, hasTouch: true });
  await ctx.addInitScript({ content: VIB_HOOK });
  const page = await openPage(ctx, "h2");
  await page.click('[data-testid="settings-toggle"]');
  await sleep(150);
  const panelOpen = await page.$eval('[data-testid="settings-panel"]', (el) => el.open);
  const hook = await page.$eval('[data-testid="settings-haptics"]', (el) => ({
    tag: el.tagName, type: el.type, checked: el.checked,
  }));
  const hookCount = await page.$$eval('[data-testid="settings-haptics"]', (els) => els.length);
  sub(panelOpen === true && hookCount === 1 && hook.tag === "INPUT" && hook.type === "checkbox" && hook.checked === true,
    `panel-open=${panelOpen} haptics=${JSON.stringify(hook)} count=${hookCount}`);
  await page.click('[data-testid="settings-done"]');
  await sleep(120);
  {
    const raw = await tapMeasure(page, '[data-key="1"]');
    const n = normCalls(raw);
    sub(n.ok && n.durations.length === 1 && durOk(n.durations[0]), `haptics-on:click1 calls=${JSON.stringify(n.durations)}`);
  }
  await page.click('[data-testid="settings-toggle"]');
  await sleep(150);
  await page.click('[data-testid="settings-haptics"]');
  await sleep(80);
  const offChecked = await page.$eval('[data-testid="settings-haptics"]', (el) => el.checked);
  await page.click('[data-testid="settings-done"]');
  await sleep(120);
  sub(offChecked === false, `after-uncheck checked=${offChecked}`);
  await page.click('[data-testid="key-op"]');
  await sleep(80);
  {
    const raw = await tapMeasure(page, '[data-key="1"]');
    const n = normCalls(raw);
    const v = await inputVal(page);
    sub(n.ok && n.durations.length === 0 && v === "1", `haptics-off:click1 value=${JSON.stringify(v)} calls=${JSON.stringify(n.durations)}`);
  }
  await page.reload({ waitUntil: "load" });
  await page.click('[data-testid="settings-toggle"]');
  await sleep(150);
  const reChecked = await page.$eval('[data-testid="settings-haptics"]', (el) => el.checked);
  await page.click('[data-testid="settings-done"]');
  await sleep(120);
  {
    const raw = await tapMeasure(page, '[data-key="1"]');
    const n = normCalls(raw);
    sub(reChecked === false && n.ok && n.durations.length === 0, `reload-off checked=${reChecked} calls=${JSON.stringify(n.durations)}`);
  }
  await page.click('[data-testid="settings-toggle"]');
  await sleep(150);
  await page.click('[data-testid="settings-haptics"]');
  await sleep(80);
  const onChecked = await page.$eval('[data-testid="settings-haptics"]', (el) => el.checked);
  await page.click('[data-testid="settings-done"]');
  await sleep(120);
  sub(onChecked === true, `after-recheck checked=${onChecked}`);
  await page.reload({ waitUntil: "load" });
  await page.click('[data-testid="settings-toggle"]');
  await sleep(150);
  const persistChecked = await page.$eval('[data-testid="settings-haptics"]', (el) => el.checked);
  await page.click('[data-testid="settings-done"]');
  await sleep(120);
  {
    const raw = await tapMeasure(page, '[data-key="1"]');
    const n = normCalls(raw);
    sub(persistChecked === true && n.ok && n.durations.length === 1 && durOk(n.durations[0]),
      `reload-on checked=${persistChecked} calls=${JSON.stringify(n.durations)}`);
  }
  await page.click('[data-testid="settings-toggle"]');
  await sleep(150);
  await page.selectOption('[data-testid="settings-auto-confirm"]', "1");
  await sleep(80);
  await page.click('[data-testid="settings-base-toggle"]');
  await sleep(80);
  await page.fill('[data-testid="settings-base-value"]', "10");
  await sleep(80);
  await page.click('[data-testid="settings-done"]');
  await sleep(120);
  await page.reload({ waitUntil: "load" });
  await page.click('[data-testid="settings-toggle"]');
  await sleep(150);
  const ac = await page.$eval('[data-testid="settings-auto-confirm"]', (el) => el.value);
  const bt = await page.$eval('[data-testid="settings-base-toggle"]', (el) => el.checked);
  const bv = await page.$eval('[data-testid="settings-base-value"]', (el) => el.value);
  const ls = await page.evaluate(() => {
    try {
      return { ok: true, raw: window.localStorage.getItem("cal-phone.settings.v1") };
    } catch (e) {
      return { ok: false, raw: null };
    }
  });
  let lsParsed = false;
  try {
    JSON.parse(ls.raw);
    lsParsed = true;
  } catch (e) {
    lsParsed = false;
  }
  await page.click('[data-testid="settings-done"]');
  await sleep(120);
  sub(ac === "1" && bt === true && bv === "10" && lsParsed === true,
    `persist auto-confirm=${JSON.stringify(ac)} base-toggle=${bt} base-value=${JSON.stringify(bv)} ls-parse=${lsParsed} ls=${ls.raw}`);
  await ctx.close();
  return { pass, evidence: notes.join(" | ") };
}

async function H3(browser) {
  const notes = [];
  let pass = true;
  const defs = [
    ["h3a", "Object.defineProperty(Navigator.prototype, 'vibrate', { configurable: true, value: undefined });"],
    ["h3b", "Object.defineProperty(Navigator.prototype, 'vibrate', { configurable: true, value: function () { throw new Error('vibration-blocked'); } });"],
  ];
  for (const [tag, src] of defs) {
    const pe0 = ALL_PE.length;
    const ce0 = ALL_CE.length;
    const ctx = await browser.newContext({ viewport: VP, isMobile: true, hasTouch: true });
    await ctx.addInitScript({ content: src });
    const page = await ctx.newPage();
    page.setDefaultTimeout(10000);
    page.setDefaultNavigationTimeout(15000);
    track(page, tag);
    await page.goto(pathToFileURL(ARTIFACT).href, { waitUntil: "load" });
    await page.click('[data-key="1"]');
    await sleep(60);
    const v1 = await inputVal(page);
    await page.click('[data-key="2"]');
    await sleep(60);
    const v2 = await inputVal(page);
    await page.click('[data-key="enter"]');
    await sleep(100);
    const vAfter = await inputVal(page);
    const e = await exprText(page);
    await page.click('[data-testid="settings-toggle"]');
    await sleep(150);
    const panelOpen = await page.$eval('[data-testid="settings-panel"]', (el) => el.open);
    let extra = "";
    if (tag === "h3b") {
      await page.click('[data-testid="settings-done"]');
      await sleep(120);
      await page.click('[data-key="3"]');
      await sleep(80);
      const v3 = await inputVal(page);
      extra = ` then3=${JSON.stringify(v3)}`;
      if (v3 !== "3") pass = false;
    } else {
      await page.click('[data-testid="settings-done"]');
      await sleep(120);
    }
    const dpe = ALL_PE.length - pe0;
    const dce = ALL_CE.length - ce0;
    const ok = v1 === "1" && v2 === "12" && vAfter === "" && e.includes("12") && panelOpen === true && dpe === 0 && dce === 0;
    if (!ok) pass = false;
    notes.push(`${tag}:inputs=${JSON.stringify(v1)}/${JSON.stringify(v2)} after=${JSON.stringify(vAfter)} expr=${JSON.stringify(e)} panel=${panelOpen} newPageErrors=${dpe} newConsoleErrors=${dce}${extra}`);
    await ctx.close();
  }
  return { pass, evidence: notes.join(" | ") };
}

async function H4(browser) {
  const notes = [];
  let pass = true;
  const sub = (ok, note) => {
    if (!ok) pass = false;
    notes.push(note);
  };
  {
    const ctx = await browser.newContext({ viewport: VP, isMobile: true, hasTouch: true });
    await ctx.addInitScript({ content: VIB_HOOK });
    const page = await openPage(ctx, "h4a");
    await page.click('[data-testid="settings-toggle"]');
    await sleep(150);
    await page.selectOption('[data-testid="settings-auto-confirm"]', "0.2");
    await sleep(80);
    await page.click('[data-testid="settings-done"]');
    await sleep(120);
    await clearV(page);
    await page.click('[data-key="9"]');
    await sleep(600);
    const raw = await readV(page);
    const n = normCalls(raw);
    const e = await exprText(page);
    sub(n.ok && n.durations.length === 1 && e.includes("9"),
      `auto-confirm:click9+600ms calls=${JSON.stringify(n.durations)} expr=${JSON.stringify(e)}`);
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: VP, isMobile: true, hasTouch: true });
    await ctx.addInitScript({ content: VIB_HOOK });
    const page = await openPage(ctx, "h4b");
    await page.click('[data-testid="settings-toggle"]');
    await sleep(150);
    await page.selectOption('[data-testid="settings-auto-confirm"]', "0");
    await sleep(60);
    await page.fill('[data-testid="settings-auto-equals"]', "2");
    await sleep(60);
    await page.click('[data-testid="settings-done"]');
    await sleep(120);
    await page.click('[data-testid="op-picker"] [data-op="+"]');
    await sleep(80);
    await clearV(page);
    for (const k of ["9", "enter", "5", "enter"]) {
      await page.click(`[data-key="${k}"]`);
      await sleep(60);
    }
    await sleep(400);
    const raw1 = await readV(page);
    const n1 = normCalls(raw1);
    const dv = await resultDV(page);
    const hc = await page.$$eval('[data-testid="history-item"]', (els) => els.length);
    await sleep(400);
    const raw2 = await readV(page);
    const n2 = normCalls(raw2);
    sub(n1.ok && n1.durations.length === 4 && dv === "14" && hc === 1 && n2.ok && n2.durations.length === 4,
      `auto-equals:calls=${JSON.stringify(n1.durations)} result=${JSON.stringify(dv)} history=${hc} later=${JSON.stringify(n2.durations)}`);
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: VP, isMobile: true, hasTouch: true });
    await ctx.addInitScript({ content: VIB_HOOK });
    const page = await openPage(ctx, "h4c");
    await clearV(page);
    await sleep(200);
    const idle = await readV(page);
    const ni = normCalls(idle);
    await page.click('[data-testid="settings-toggle"]');
    await sleep(150);
    await page.click('[data-testid="settings-done"]');
    await sleep(120);
    await page.click('[data-testid="history"]');
    await sleep(120);
    const raw = await readV(page);
    const n = normCalls(raw);
    sub(ni.ok && ni.durations.length === 0 && n.ok && n.durations.length === 0,
      `idle200ms=${JSON.stringify(ni.durations)} after-panel+history=${JSON.stringify(n.durations)}`);
    await ctx.close();
  }
  return { pass, evidence: notes.join(" | ") };
}

async function H5Coords(browser) {
  const notes = [];
  let pass = true;
  const run = async (tag) => {
    const ctx = await browser.newContext({ viewport: VP, isMobile: true, hasTouch: true });
    await ctx.addInitScript({ content: VIB_HOOK });
    const page = await openPage(ctx, tag);
    const seq = [];
    for (const k of ["1", "2", "3", "4", "5"]) {
      const box = await page.locator(`[data-key="${k}"]`).boundingBox();
      if (!box) throw new Error(`no bounding box for key ${k}`);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await sleep(40);
      seq.push(await inputVal(page));
    }
    await ctx.close();
    return seq;
  };
  const seqOn = await run("h5c-on");
  const okOn = JSON.stringify(seqOn) === JSON.stringify(["1", "12", "123", "1234", "12345"]);
  if (!okOn) pass = false;
  notes.push(`coords-haptics-on=${JSON.stringify(seqOn)}`);
  {
    const ctx = await browser.newContext({ viewport: VP, isMobile: true, hasTouch: true });
    await ctx.addInitScript({ content: VIB_HOOK });
    const page = await openPage(ctx, "h5c-off");
    await page.click('[data-testid="settings-toggle"]');
    await sleep(150);
    await page.click('[data-testid="settings-haptics"]');
    await sleep(80);
    await page.click('[data-testid="settings-done"]');
    await sleep(120);
    await page.reload({ waitUntil: "load" });
    const seq = [];
    for (const k of ["1", "2", "3", "4", "5"]) {
      const box = await page.locator(`[data-key="${k}"]`).boundingBox();
      if (!box) throw new Error(`no bounding box for key ${k}`);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await sleep(40);
      seq.push(await inputVal(page));
    }
    await ctx.close();
    const okOff = JSON.stringify(seq) === JSON.stringify(["1", "12", "123", "1234", "12345"]);
    if (!okOff) pass = false;
    notes.push(`coords-haptics-off=${JSON.stringify(seq)}`);
  }
  return { pass, evidence: notes.join(" | ") };
}

async function H5(browser) {
  const notes = [];
  let pass = true;
  const { runSuite } = await import("file:///ws/cal_phone/tests/suite.mjs");
  const results = await runSuite({ artifact: ARTIFACT });
  const expectedIds = ["self-contained","cold-start","compute","arithmetic","history-order","reset",
    "continuity","error-recovery","sticky-operator","edit-recompute","edit-multi","edit-invalid",
    "edit-divzero","edit-cancel-restore","edit-pending-replace","edit-pending-recent-value",
    "layout","determinism"].sort();
  const gotIds = results.map((r) => r.id).sort();
  const idsEqual = JSON.stringify(gotIds) === JSON.stringify(expectedIds);
  const allPass = results.every((r) => r.pass);
  const cold = results.find((r) => r.id === "cold-start");
  const hasKeysEnabled = Boolean(cold) && cold.checks.some((c) => c.id === "cold-start.keys-enabled" && c.pass);
  if (!idsEqual || !allPass || !hasKeysEnabled) pass = false;
  notes.push(`suite ids=${JSON.stringify(gotIds)} allPass=${allPass} keys-enabled=${hasKeysEnabled} ` +
    results.map((r) => `${r.id}:${r.pass ? "pass" : "fail"}`).join(","));
  const failed = [];
  for (const r of results) {
    for (const c of r.checks) {
      if (!c.pass) failed.push(`${c.id} ${c.detail}`.slice(0, 300));
    }
  }
  if (failed.length) notes.push(`failed-checks: ${failed.join(" | ").slice(0, 2000)}`);
  const coords = await H5Coords(browser);
  if (!coords.pass) pass = false;
  notes.push(coords.evidence);
  return { pass, evidence: notes.join(" | ") };
}

function H6() {
  try {
    const html = fs.readFileSync(ARTIFACT, "utf8");
    const bytes = Buffer.byteLength(html);
    const hasClose = html.includes("</html>");
    const low = html.toLowerCase();
    const pats = ["<script src", "<link href", "<img src", "@import", "url(http"];
    let ext = 0;
    const parts = [];
    for (const p of pats) {
      let i = 0;
      let c = 0;
      while ((i = low.indexOf(p, i)) !== -1) {
        c++;
        i += p.length;
      }
      ext += c;
      parts.push(`${p}=${c}`);
    }
    const errTotal = ALL_PE.length + ALL_CE.length;
    const ok = hasClose && bytes >= 1024 && ext === 0 && errTotal === 0;
    let evidence = `bytes=${bytes} close=${hasClose} external=${ext}(${parts.join(",")}) pageerrors=${ALL_PE.length} consoleErrors=${ALL_CE.length}`;
    if (ALL_PE.length) evidence += ` pe=${ALL_PE.join(" || ").slice(0, 1500)}`;
    if (ALL_CE.length) evidence += ` ce=${ALL_CE.join(" || ").slice(0, 1500)}`;
    return { pass: ok, evidence };
  } catch (e) {
    return { pass: false, evidence: `read-fail:${String((e && e.message) || e).slice(0, 300)}` };
  }
}

async function main() {
  const shaFile = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  const artifactSha = shaFile(ARTIFACT);
  const verifierSha = shaFile(SCRIPT);
  const out = [];
  const fails = [];
  const push = (id, r) => {
    out.push(`H${id} ${r.pass ? "PASS" : "FAIL"} — ${r.evidence}`);
    if (!r.pass) fails.push(`H${id}`);
  };

  let browser = await launch();
  try {
    push("1", await H1(browser));
  } catch (e) {
    push("1", { pass: false, evidence: `crash:${String((e && e.stack) || e).slice(0, 500)}` });
  }
  try {
    push("2", await H2(browser));
  } catch (e) {
    push("2", { pass: false, evidence: `crash:${String((e && e.stack) || e).slice(0, 500)}` });
  }
  try {
    push("3", await H3(browser));
  } catch (e) {
    push("3", { pass: false, evidence: `crash:${String((e && e.stack) || e).slice(0, 500)}` });
  }
  try {
    push("4", await H4(browser));
  } catch (e) {
    push("4", { pass: false, evidence: `crash:${String((e && e.stack) || e).slice(0, 500)}` });
  }
  await browser.close();

  try {
    browser = await launch();
    try {
      push("5", await H5(browser));
    } catch (e) {
      push("5", { pass: false, evidence: `crash:${String((e && e.stack) || e).slice(0, 800)}` });
    }
    await browser.close();
  } catch (e) {
    push("5", { pass: false, evidence: `relaunch-fail:${String((e && e.message) || e).slice(0, 300)}` });
  }

  push("6", H6());

  const lines = [
    `ROUND: ${ROUND}`,
    `ARTIFACT_SHA256: ${artifactSha}`,
    `VERIFIER_SHA256: ${verifierSha}`,
    ...out,
    fails.length === 0 ? "HARD: PASS" : `HARD: FAIL (${fails.join(",")})`,
  ];
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `hard-r${ROUND}.txt`), lines.join("\n") + "\n");
  if (REVIEW_STATES !== "none" && REVIEW_STATES !== "") {
    throw new Error("review states requested but contract provides no state list");
  }
  process.stdout.write(lines.join("\n") + "\n");
  process.exitCode = fails.length === 0 ? 0 : 1;
}

main().catch((e) => {
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const stamp = [`ROUND: ${ROUND}`, `ARTIFACT_SHA256: error`, `VERIFIER_SHA256: error`,
      `H1 FAIL — harness-crash:${String((e && e.stack) || e).slice(0, 300)}`, "HARD: FAIL (H1)"].join("\n") + "\n";
    fs.writeFileSync(path.join(OUT_DIR, `hard-r${ROUND}.txt`), stamp);
  } catch (e2) {
    /* ignore */
  }
  process.stderr.write(String((e && e.stack) || e) + "\n");
  process.exitCode = 1;
});
