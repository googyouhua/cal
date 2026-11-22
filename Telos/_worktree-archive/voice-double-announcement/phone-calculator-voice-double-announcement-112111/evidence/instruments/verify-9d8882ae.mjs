#!/usr/bin/env node
// Kekkai hard verifier: commit-confirm silence gate (round-parameterized).
// Measures ONLY via Playwright + local HTTP + fake engine contract, and the two
// repo test entries. Writes hard-r<N>.txt under KEKKAI_OUT_DIR (never evidence/runs).
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const rawRound = process.argv[2] ?? process.env.KEKKAI_ROUND ?? "1";
const round = String(rawRound).trim().replace(/^r/i, "");
if (!/^\d+$/.test(round)) throw new Error(`invalid round: ${rawRound}`);
const here = (v) => (path.isAbsolute(v) ? path.normalize(v) : path.resolve(scriptDir, v));
const DEFAULT_ARTIFACT = "/ws/cal_phone-worktrees/voice-double-announcement/index.html";
const artifactPath = here(process.env.KEKKAI_ARTIFACT || DEFAULT_ARTIFACT);
const outDir = here(process.env.KEKKAI_OUT_DIR || path.join(scriptDir, "runs"));
const repoRoot = path.dirname(artifactPath);
const requireFromSuite = createRequire(path.join(repoRoot, "tests", "voice", "run.mjs"));
const { chromium } = requireFromSuite("playwright");
if (!fs.existsSync(artifactPath)) throw new Error(`artifact missing: ${artifactPath}`);
fs.mkdirSync(outDir, { recursive: true });

const sha256File = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const artifactSha256 = sha256File(artifactPath);
const verifierSha256 = sha256File(scriptPath);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (v, n = 900) => { let s; try { s = JSON.stringify(v); } catch { s = String(v); } return s.length > n ? s.slice(0, n) + "..." : s; };
const same = (a, b) => isDeepStrictEqual(a, b);

function startServer() {
  const server = http.createServer((req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url || "/", "http://127.0.0.1").pathname); }
    catch { res.writeHead(400, { "Content-Type": "text/plain" }); res.end("bad"); return; }
    if (p.startsWith("/voice/")) {
      const body = Buffer.alloc(2048, 0x5a);
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": body.length, "Cache-Control": "no-store" });
      res.end(body); return;
    }
    if (p === "/" || p === "/index.html") {
      let st; try { st = fs.statSync(artifactPath); } catch { res.writeHead(404); res.end("nf"); return; }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": st.size, "Cache-Control": "no-store" });
      fs.createReadStream(artifactPath).pipe(res); return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" }); res.end("nf");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({
      url: `http://127.0.0.1:${server.address().port}/index.html`,
      close: async () => { if (typeof server.closeAllConnections === "function") server.closeAllConnections(); await new Promise((r) => server.close(r)); },
    }));
  });
}

async function openScenario(browser, url, storage, opts = {}) {
  const waitReady = opts.waitReady !== false;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addInitScript(({ stored }) => {
    if (stored !== null) { try { localStorage.setItem("cal-phone.settings.v1", stored); } catch {} }
    window.__voiceFake = { fail: false, durationMs: 400, generated: [] };
    window.SherpaOnnx = async () => ({ FS: { mkdirTree() {}, FS_createDataFile() {}, writeFile() {} } });
    window.createOfflineTts = () => ({
      handle: 1, sampleRate: 22050,
      generate({ text }) {
        window.__voiceFake.generated.push(String(text));
        const n = Math.round(22050 * 0.4);
        const a = new Float32Array(Math.max(1, n));
        for (let i = 0; i < a.length; i += 1) a[i] = Math.sin(i / 20) * 0.05;
        return { samples: a, sampleRate: 22050 };
      },
    });
    class FAC {
      constructor() { this.state = "running"; this.destination = {}; }
      createBuffer(_c, l) { return { getChannelData: () => new Float32Array(l) }; }
      createBufferSource() {
        const so = { buffer: null, connect() {}, onended: null };
        so.start = () => { setTimeout(() => { if (typeof so.onended === "function") so.onended(); }, 400); };
        return so;
      }
      resume() { return Promise.resolve(); }
    }
    window.AudioContext = FAC; window.webkitAudioContext = FAC;
  }, { stored: storage === undefined ? null : JSON.stringify(storage) });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  await page.goto(url, { waitUntil: "load" });
  await page.waitForSelector("main.app");
  if (waitReady) {
    await page.waitForFunction(() => document.querySelector("main.app")?.dataset.voiceState === "ready", null, { timeout: 20000, polling: 50 });
  } else {
    await sleep(600);
  }
  return { context, page, close: async () => context.close() };
}

async function readState(page) {
  return page.evaluate(() => {
    const app = document.querySelector("main.app");
    let log = []; try { log = JSON.parse(app?.dataset.speechLog || "[]"); } catch { log = []; }
    let played = []; try { played = JSON.parse(app?.dataset.speechPlayed || "[]"); } catch { played = []; }
    return {
      log, played,
      count: app?.dataset.speechCount ?? "",
      result: (document.querySelector('[data-testid="result"]')?.textContent || "").trim(),
      expression: (document.querySelector('[data-testid="expression"]')?.textContent || "").trim(),
    };
  });
}
const texts = (entries) => entries.map((e) => e.text);
const kinds = (entries) => entries.map((e) => e.kind);

async function waitPlayed(page, n, timeout = 8000) {
  const t0 = Date.now();
  let played = [];
  while (Date.now() - t0 < timeout) {
    const s = await readState(page);
    played = s.played;
    if (played.length >= n) return played;
    await sleep(75);
  }
  return played;
}
async function waitResult(page, text, timeout = 5000) {
  const t0 = Date.now();
  let cur = "";
  while (Date.now() - t0 < timeout) {
    cur = await page.$eval('[data-testid="result"]', (el) => (el.textContent || "").trim());
    if (cur === text) return cur;
    await sleep(50);
  }
  throw new Error(`result timeout: want=${JSON.stringify(text)} got=${JSON.stringify(cur)}`);
}
async function clickKey(page, k) { await page.click(`[data-key="${k}"]`); }
async function clickOp(page, o) { await page.click(`[data-op="${o}"]`); }
const keysOnly = (extra = {}) => ({ autoConfirm: 0, autoEquals: 0, baseEnabled: false, baseText: "0", voiceKeys: true, voiceResult: false, ...extra });
const resultOnly = (extra = {}) => ({ autoConfirm: 0, autoEquals: 0, baseEnabled: false, baseText: "0", voiceKeys: false, voiceResult: true, ...extra });
const bothOn = (extra = {}) => ({ autoConfirm: 0, autoEquals: 0, baseEnabled: false, baseText: "0", voiceKeys: true, voiceResult: true, ...extra });
const bothOff = (extra = {}) => ({ autoConfirm: 0, autoEquals: 0, baseEnabled: false, baseText: "0", voiceKeys: false, voiceResult: false, ...extra });

async function attempt(label, fn) {
  const obs = [];
  for (let i = 1; i <= 3; i += 1) {
    try {
      const r = await fn();
      obs.push(`try${i}:{pass=${r.pass} ${r.ev}}`);
      if (r.pass) return { pass: true, ev: obs.join(" || ") };
    } catch (e) { obs.push(`try${i}:ERROR:${String(e && e.message ? e.message : e).slice(0, 300)}`); }
  }
  return { pass: false, ev: obs.join(" || ") };
}
const keyEntries = (ts) => ts.map((t) => ({ kind: "key", text: t }));

const lines = [];
let browser; let server;
const H = {};
async function main() {
  server = await startServer();
  browser = await chromium.launch({ headless: true });

  // ---------- H1 收笔静音 ----------
  const h1 = [];
  h1.push(await attempt("H1-1", async () => {
    const s = await openScenario(browser, server.url, keysOnly());
    try {
      await clickKey(s.page, "5"); await s.page.click('[data-testid="enter"]');
      await sleep(2500); const a = await readState(s.page);
      await sleep(1000); const b = await readState(s.page);
      const exp = keyEntries(["五"]);
      const pass = same(a.log, exp) && same(a.played, exp) && a.count === "1" && b.count === "1";
      return { pass, ev: `log=${ev(texts(a.log))} played=${ev(texts(a.played))} countA=${a.count} countB=${b.count}` };
    } finally { await s.close(); }
  }));
  h1.push(await attempt("H1-2", async () => {
    const s = await openScenario(browser, server.url, keysOnly());
    try {
      await clickKey(s.page, "9"); await clickKey(s.page, "5"); await s.page.click('[data-testid="enter"]');
      await sleep(2500); const a = await readState(s.page);
      await sleep(1000); const b = await readState(s.page);
      const exp = keyEntries(["九", "五"]);
      const pass = same(a.log, exp) && same(a.played, exp) && a.count === "2" && b.count === "2";
      return { pass, ev: `log=${ev(texts(a.log))} played=${ev(texts(a.played))} countA=${a.count} countB=${b.count}` };
    } finally { await s.close(); }
  }));
  h1.push(await attempt("H1-3", async () => {
    const s = await openScenario(browser, server.url, keysOnly({ autoConfirm: 0.2 }));
    try {
      await clickKey(s.page, "6");
      await sleep(2500); const a = await readState(s.page);
      await sleep(1000); const b = await readState(s.page);
      const exp = keyEntries(["六"]);
      const pass = same(a.log, exp) && same(a.played, exp) && a.count === "1" && b.count === "1";
      return { pass, ev: `log=${ev(texts(a.log))} played=${ev(texts(a.played))} countA=${a.count} countB=${b.count}` };
    } finally { await s.close(); }
  }));
  h1.push(await attempt("H1-4", async () => {
    const s = await openScenario(browser, server.url, keysOnly());
    try {
      await s.page.keyboard.press("7"); await s.page.keyboard.press("Enter");
      await sleep(2500); const a = await readState(s.page);
      await sleep(1000); const b = await readState(s.page);
      const exp = keyEntries(["七"]);
      const pass = same(a.log, exp) && same(a.played, exp) && a.count === "1" && b.count === "1";
      return { pass, ev: `log=${ev(texts(a.log))} played=${ev(texts(a.played))} countA=${a.count} countB=${b.count}` };
    } finally { await s.close(); }
  }));
  h1.push(await attempt("H1-5", async () => {
    const s = await openScenario(browser, server.url, bothOn());
    try {
      await clickKey(s.page, "9"); await clickKey(s.page, "5"); await s.page.click('[data-testid="enter"]');
      await sleep(2500); const a = await readState(s.page);
      await sleep(1000); const b = await readState(s.page);
      const pass = same(texts(a.log), ["九", "五"]) && kinds(a.log).every((k) => k === "key")
        && same(a.played, a.log) && a.count === "2" && b.count === "2";
      return { pass, ev: `log=${ev(a.log)} played=${ev(texts(a.played))} countA=${a.count} countB=${b.count}` };
    } finally { await s.close(); }
  }));
  H.H1 = h1.every((r) => r.pass);
  lines.push(`H1 ${H.H1 ? "PASS" : "FAIL"} — ${h1.map((r, i) => `s${i + 1}:${r.pass ? "ok" : "BAD"}[${r.ev}]`).join(" ")}`);

  // ---------- H2 单键恰好一次 ----------
  const h2 = [];
  h2.push(await attempt("H2-1", async () => {
    const s = await openScenario(browser, server.url, keysOnly());
    try {
      for (const d of "0123456789") await clickKey(s.page, d);
      await waitPlayed(s.page, 10); await sleep(600);
      const a = await readState(s.page);
      const exp = keyEntries(["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"]);
      const pass = same(a.log, exp) && same(a.played, exp) && a.count === "10";
      return { pass, ev: `log=${ev(texts(a.log))} count=${a.count}` };
    } finally { await s.close(); }
  }));
  h2.push(await attempt("H2-2", async () => {
    const s = await openScenario(browser, server.url, keysOnly());
    try {
      await clickKey(s.page, "5"); await clickKey(s.page, "."); await clickKey(s.page, "."); await clickKey(s.page, "7");
      await waitPlayed(s.page, 3); await sleep(600);
      const a = await readState(s.page);
      const exp = keyEntries(["五", "点", "七"]);
      const pass = same(a.log, exp) && same(a.played, exp);
      return { pass, ev: `log=${ev(texts(a.log))} played=${ev(texts(a.played))}` };
    } finally { await s.close(); }
  }));
  h2.push(await attempt("H2-3", async () => {
    const s = await openScenario(browser, server.url, keysOnly());
    try {
      await clickKey(s.page, "5"); await clickKey(s.page, "backspace"); await clickKey(s.page, "backspace");
      await waitPlayed(s.page, 2); await sleep(600);
      const a = await readState(s.page);
      const exp = keyEntries(["五", "退格"]);
      const pass = same(a.log, exp) && same(a.played, exp);
      return { pass, ev: `log=${ev(texts(a.log))} played=${ev(texts(a.played))}` };
    } finally { await s.close(); }
  }));
  h2.push(await attempt("H2-4", async () => {
    const s = await openScenario(browser, server.url, keysOnly());
    try {
      await clickKey(s.page, "5"); await clickKey(s.page, "5");
      await waitPlayed(s.page, 2); await sleep(600);
      const a = await readState(s.page);
      const exp = keyEntries(["五", "五"]);
      const pass = same(a.log, exp) && same(a.played, exp);
      return { pass, ev: `log=${ev(texts(a.log))} played=${ev(texts(a.played))}` };
    } finally { await s.close(); }
  }));
  h2.push(await attempt("H2-5", async () => {
    const s = await openScenario(browser, server.url, keysOnly());
    try {
      for (const o of ["+", "-", "*", "/"]) await clickOp(s.page, o);
      await waitPlayed(s.page, 4); await sleep(600);
      const a = await readState(s.page);
      const exp = keyEntries(["加", "减", "乘", "除"]);
      const pass = same(a.log, exp) && same(a.played, exp);
      return { pass, ev: `log=${ev(texts(a.log))} played=${ev(texts(a.played))}` };
    } finally { await s.close(); }
  }));
  h2.push(await attempt("H2-6", async () => {
    const s = await openScenario(browser, server.url, keysOnly());
    try {
      await clickKey(s.page, "1"); await clickOp(s.page, "+"); await clickKey(s.page, "2");
      await waitPlayed(s.page, 3);
      const before = await readState(s.page);
      await s.page.click('[data-testid="key-equals"]');
      await sleep(900);
      const a = await readState(s.page);
      const pass = same(texts(a.log), ["一", "加", "二"]) && same(a.log, before.log)
        && kinds(a.log).every((k) => k === "key") && same(a.played, a.log);
      return { pass, ev: `before=${ev(texts(before.log))} after=${ev(texts(a.log))} count=${a.count}` };
    } finally { await s.close(); }
  }));
  h2.push(await attempt("H2-7", async () => {
    const s = await openScenario(browser, server.url, keysOnly());
    try {
      await clickKey(s.page, "5"); await s.page.click('[data-testid="enter"]');
      await clickKey(s.page, "backspace"); await clickKey(s.page, "backspace");
      await waitPlayed(s.page, 2); await sleep(600);
      const a = await readState(s.page);
      const exp = keyEntries(["五", "退格"]);
      const pass = same(a.log, exp) && same(a.played, exp);
      return { pass, ev: `log=${ev(texts(a.log))} played=${ev(texts(a.played))}` };
    } finally { await s.close(); }
  }));
  H.H2 = h2.every((r) => r.pass);
  lines.push(`H2 ${H.H2 ? "PASS" : "FAIL"} — ${h2.map((r, i) => `s${i + 1}:${r.pass ? "ok" : "BAD"}[${r.ev}]`).join(" ")}`);

  // ---------- H3 结果播报 ----------
  const h3 = [];
  h3.push(await attempt("H3-1", async () => {
    const s = await openScenario(browser, server.url, resultOnly());
    try {
      await clickKey(s.page, "1"); await clickOp(s.page, "+"); await clickKey(s.page, "2"); await s.page.click('[data-testid="key-equals"]');
      const rv = await waitResult(s.page, "3"); await waitPlayed(s.page, 1); await sleep(600);
      const a = await readState(s.page);
      const last = a.log.at(-1);
      const pass = rv === "3" && !kinds(a.log).includes("key") && last?.text === "三" && last?.kind === "result" && same(a.played, a.log);
      return { pass, ev: `result=${rv} log=${ev(a.log)} played=${ev(texts(a.played))}` };
    } finally { await s.close(); }
  }));
  h3.push(await attempt("H3-2", async () => {
    const s = await openScenario(browser, server.url, resultOnly());
    try {
      for (const t of ["9", ".", "5", "+", "9", ".", "2", "="]) {
        if (t === "=") await s.page.click('[data-testid="key-equals"]');
        else if ("+-*/".includes(t)) await clickOp(s.page, t); else await clickKey(s.page, t);
      }
      const rv = await waitResult(s.page, "18.7"); await waitPlayed(s.page, 1); await sleep(600);
      const a = await readState(s.page);
      const last = a.log.at(-1);
      const pass = rv === "18.7" && last?.text === "十八点七" && last?.kind === "result" && !kinds(a.log).includes("key");
      return { pass, ev: `result=${rv} last=${ev(last)} log=${ev(a.log)}` };
    } finally { await s.close(); }
  }));
  h3.push(await attempt("H3-3", async () => {
    const s = await openScenario(browser, server.url, resultOnly());
    try {
      await clickKey(s.page, "2"); await clickOp(s.page, "-"); await clickKey(s.page, "5"); await s.page.click('[data-testid="key-equals"]');
      const rv = await waitResult(s.page, "-3"); await waitPlayed(s.page, 1); await sleep(600);
      const a = await readState(s.page);
      const last = a.log.at(-1);
      const pass = rv === "-3" && last?.text === "负三" && last?.kind === "result";
      return { pass, ev: `result=${rv} last=${ev(last)} log=${ev(a.log)}` };
    } finally { await s.close(); }
  }));
  h3.push(await attempt("H3-4", async () => {
    const s = await openScenario(browser, server.url, resultOnly());
    try {
      await clickKey(s.page, "1"); await clickOp(s.page, "/"); await clickKey(s.page, "0"); await s.page.click('[data-testid="key-equals"]');
      const rv = await waitResult(s.page, "不能除以零"); await waitPlayed(s.page, 1); await sleep(600);
      const a = await readState(s.page);
      const last = a.log.at(-1);
      const pass = rv === "不能除以零" && last?.text === "不能除以零" && last?.kind === "result";
      return { pass, ev: `result=${rv} last=${ev(last)} log=${ev(a.log)}` };
    } finally { await s.close(); }
  }));
  h3.push(await attempt("H3-5", async () => {
    const s = await openScenario(browser, server.url, bothOn());
    try {
      await clickKey(s.page, "1"); await clickOp(s.page, "+"); await clickKey(s.page, "2"); await s.page.click('[data-testid="key-equals"]');
      const rv = await waitResult(s.page, "3"); await waitPlayed(s.page, 4); await sleep(600);
      const a = await readState(s.page);
      const keyTexts = a.log.filter((e) => e.kind === "key").map((e) => e.text);
      const last = a.log.at(-1);
      const pass = rv === "3" && same(keyTexts, ["一", "加", "二"]) && last?.kind === "result" && last?.text === "三" && same(a.played, a.log);
      return { pass, ev: `result=${rv} keys=${ev(keyTexts)} last=${ev(last)} log=${ev(a.log)}` };
    } finally { await s.close(); }
  }));
  const h3texts = h3.every((r) => r.pass);
  const noJieGuo = h3.every((r) => !String(r.ev || "").includes("结果"));
  H.H3 = h3texts && noJieGuo;
  lines.push(`H3 ${H.H3 ? "PASS" : "FAIL"} — ${h3.map((r, i) => `s${i + 1}:${r.pass ? "ok" : "BAD"}[${r.ev}]`).join(" ")}`);

  // ---------- H4 开关与队列 ----------
  const h4 = [];
  h4.push(await attempt("H4-1", async () => {
    const s = await openScenario(browser, server.url, bothOff(), { waitReady: false });
    try {
      await clickKey(s.page, "1"); await clickOp(s.page, "+"); await clickKey(s.page, "2"); await s.page.click('[data-testid="key-equals"]');
      const rv = await waitResult(s.page, "3"); await sleep(800);
      const a = await readState(s.page);
      const vs = await s.page.evaluate(() => document.querySelector("main.app")?.dataset.voiceState || "");
      const pass = rv === "3" && (a.count === "0" || a.count === "") && a.log.length === 0 && a.played.length === 0;
      return { pass, ev: `result=${rv} voiceState=${vs} count=${JSON.stringify(a.count)} logLen=${a.log.length} playedLen=${a.played.length}` };
    } finally { await s.close(); }
  }));
  h4.push(await attempt("H4-2", async () => {
    const s = await openScenario(browser, server.url, resultOnly());
    try {
      await clickKey(s.page, "1"); await clickOp(s.page, "+"); await clickKey(s.page, "2"); await s.page.click('[data-testid="key-equals"]');
      const rv = await waitResult(s.page, "3"); await waitPlayed(s.page, 1); await sleep(600);
      const a = await readState(s.page);
      const pass = rv === "3" && same([...new Set(kinds(a.log))], ["result"]);
      return { pass, ev: `result=${rv} kinds=${ev([...new Set(kinds(a.log))])} log=${ev(a.log)}` };
    } finally { await s.close(); }
  }));
  h4.push(await attempt("H4-3", async () => {
    const s = await openScenario(browser, server.url, keysOnly());
    try {
      const t0 = Date.now();
      await clickKey(s.page, "1"); await clickKey(s.page, "2"); await clickKey(s.page, "3");
      const span = Date.now() - t0;
      const played = await waitPlayed(s.page, 3); await sleep(600);
      const a = await readState(s.page);
      const pass = span < 1500 && same(texts(played), ["一", "二", "三"]) && same(texts(a.played), ["一", "二", "三"]);
      return { pass, ev: `span=${span}ms played=${ev(texts(a.played))}` };
    } finally { await s.close(); }
  }));
  h4.push(await attempt("H4-4", async () => {
    const s = await openScenario(browser, server.url, bothOn());
    try {
      await clickKey(s.page, "1"); await clickOp(s.page, "+"); await clickKey(s.page, "1");
      await s.page.click('[data-testid="key-equals"]'); await clickKey(s.page, "9");
      await sleep(4000);
      const a = await readState(s.page);
      const keyTexts = a.played.filter((e) => e.kind === "key").map((e) => e.text);
      const pass = !a.played.some((e) => e.kind === "result") && same(keyTexts, ["一", "加", "一", "九"]);
      return { pass, ev: `played=${ev(a.played)} log=${ev(a.log)}` };
    } finally { await s.close(); }
  }));
  H.H4 = h4.every((r) => r.pass);
  lines.push(`H4 ${H.H4 ? "PASS" : "FAIL"} — ${h4.map((r, i) => `s${i + 1}:${r.pass ? "ok" : "BAD"}[${r.ev}]`).join(" ")}`);

  // ---------- H5 回归 ----------
  const h5 = [];
  let v1 = { pass: false, ev: "" };
  try {
    const run = spawnSync("node", [path.join(repoRoot, "tests", "voice", "run.mjs"), "--json"], { cwd: repoRoot, encoding: "utf8", timeout: 600000, maxBuffer: 20 * 1024 * 1024 });
    let parsed = null; let perr = "";
    try { parsed = JSON.parse(String(run.stdout || "").trim()); } catch (e) { perr = `parse:${String(e.message).slice(0, 120)}`; }
    const passed = Number(parsed?.passed); const failed = Number(parsed?.failed);
    const total = Array.isArray(parsed?.checks) ? parsed.checks.length : -1;
    const pass = run.status === 0 && failed === 0 && passed >= 70;
    v1 = { pass, ev: `exit=${run.status} passed=${parsed?.passed} failed=${parsed?.failed} total=${total} ${perr} stderr=${String(run.stderr || "").slice(-200)}` };
  } catch (e) { v1 = { pass: false, ev: `spawn-ERROR:${String(e && e.message ? e.message : e).slice(0, 300)}` }; }
  h5.push(v1);
  let v2 = { pass: false, ev: "" };
  try {
    const run = spawnSync("node", [path.join(repoRoot, "tests", "suite.mjs"), "--json"], { cwd: repoRoot, encoding: "utf8", timeout: 600000, maxBuffer: 20 * 1024 * 1024 });
    let parsed = null; let perr = "";
    try { parsed = JSON.parse(String(run.stdout || "").trim()); } catch (e) { perr = `parse:${String(e.message).slice(0, 120)}`; }
    const results = Array.isArray(parsed?.results) ? parsed.results : [];
    const allChecks = results.flatMap((r) => (Array.isArray(r.checks) ? r.checks : []));
    const bad = allChecks.filter((c) => !c.pass);
    const scenarios = results.length; const checks = allChecks.length;
    const pass = run.status === 0 && scenarios === 18 && checks === 206 && bad.length === 0;
    v2 = { pass, ev: `exit=${run.status} scenarios=${scenarios} checks=${checks} failed=${bad.length} badIds=${ev(bad.map((c) => c.id).slice(0, 8))} ${perr}` };
  } catch (e) { v2 = { pass: false, ev: `spawn-ERROR:${String(e && e.message ? e.message : e).slice(0, 300)}` }; }
  h5.push(v2);
  h5.push(await attempt("H5-3", async () => {
    const s = await openScenario(browser, server.url, keysOnly());
    try {
      await clickKey(s.page, "1"); await clickOp(s.page, "+"); await clickKey(s.page, "2"); await s.page.click('[data-testid="key-equals"]');
      const rv = await waitResult(s.page, "3");
      return { pass: rv === "3", ev: `result=${rv}` };
    } finally { await s.close(); }
  }));
  h5.push(await attempt("H5-4", async () => {
    const s = await openScenario(browser, server.url, keysOnly());
    try {
      const t = await s.page.$eval('[data-testid="enter"]', (el) => (el.textContent || "").trim());
      const a = await readState(s.page);
      let arr = null; try { arr = JSON.parse((await s.page.evaluate(() => document.querySelector("main.app")?.dataset.speechLog || "[]"))); } catch { arr = null; }
      const shape = Array.isArray(arr) && arr.every((e) => typeof e.kind === "string" && typeof e.text === "string");
      return { pass: t === "确认" && shape, ev: `enter=${JSON.stringify(t)} logShape=${shape}` };
    } finally { await s.close(); }
  }));
  h5.push(await attempt("H5-5", async () => {
    const s = await openScenario(browser, server.url, keysOnly({ autoConfirm: 0.2 }));
    try {
      await clickKey(s.page, "6"); await sleep(1000);
      const a = await readState(s.page);
      return { pass: a.expression.includes("6"), ev: `expression=${JSON.stringify(a.expression)}` };
    } finally { await s.close(); }
  }));
  H.H5 = h5.every((r) => r.pass);
  lines.push(`H5 ${H.H5 ? "PASS" : "FAIL"} — ${h5.map((r, i) => `s${i + 1}:${r.pass ? "ok" : "BAD"}[${r.ev}]`).join(" ")}`);

  const failed = Object.entries(H).filter(([, v]) => !v).map(([k]) => k);
  const head = [`ROUND: ${round}`, `ARTIFACT_SHA256: ${artifactSha256}`, `VERIFIER_SHA256: ${verifierSha256}`];
  const tail = failed.length === 0 ? "HARD: PASS" : `HARD: FAIL (${failed.join(",")})`;
  const out = [...head, ...lines, tail].join("\n") + "\n";
  fs.writeFileSync(path.join(outDir, `hard-r${round}.txt`), out);
  for (const l of [...head, ...lines, tail]) console.log(l);
  await browser.close();
  await server.close();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  try { if (browser) await browser.close(); } catch {}
  try { if (server) await server.close(); } catch {}
  const failed = Object.keys(H).filter((k) => H[k] !== true);
  const out = [`ROUND: ${round}`, `ARTIFACT_SHA256: ${artifactSha256}`, `VERIFIER_SHA256: ${verifierSha256}`,
    ...lines, `HARD: FAIL (${["H-crash", ...failed].join(",")})`,
    `CRASH: ${String(e && e.stack ? e.stack : e).slice(0, 500)}`].join("\n") + "\n";
  try { fs.writeFileSync(path.join(outDir, `hard-r${round}.txt`), out); } catch {}
  console.log(out);
  process.exit(1);
});
