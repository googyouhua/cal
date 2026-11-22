#!/usr/bin/env node
// Gate verifier: voice confirm silent (收笔静音 / 单键一次 / 结果播报 / 开关与队列 / 回归).
// Usage: node verify.mjs <round>
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const SELF = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SELF);
const REPO = "/ws/cal_phone-worktrees/voice-double-announcement";
const ARTIFACT = process.env.KEKKAI_ARTIFACT || path.join(REPO, "index.html");
const ROUND = String(process.argv[2] || process.env.KEKKAI_ROUND || "1");
const OUT_DIR = process.env.KEKKAI_OUT_DIR || path.join(SCRIPT_DIR, "attempts", `first-r${ROUND}-local`);
const SETTINGS_KEY = "cal-phone.settings.v1";
const FAKE_DURATION_MS = 400;

const sha256File = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (v) => JSON.stringify(v);
const same = (a, b) => J(a) === J(b);

function loadChromium() {
  const req = createRequire(path.join(REPO, "tests", "voice", "run.mjs"));
  for (const name of ["playwright", "playwright-core"]) {
    try {
      const m = req(name);
      if (m && m.chromium) return m.chromium;
    } catch { /* try next */ }
  }
  throw new Error("playwright not resolvable from tests/node_modules");
}

function startServer() {
  const server = http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url || "/", "http://127.0.0.1").pathname);
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("bad request");
      return;
    }
    if (pathname.startsWith("/voice/")) {
      const rel = pathname.slice("/voice/".length);
      const isScript = rel === "sherpa-onnx-wasm-web.js" || rel === "sherpa-onnx-tts.js";
      const body = isScript
        ? Buffer.from("window.SherpaOnnx=async()=>({});\nwindow.createOfflineTts=()=>({handle:1});\n")
        : Buffer.alloc(2048, 0x5a);
      res.writeHead(200, {
        "Content-Type": isScript ? "text/javascript; charset=utf-8" : "application/octet-stream",
        "Content-Length": body.length,
        "Cache-Control": "no-store",
      });
      res.end(body);
      return;
    }
    if (pathname === "/" || pathname === "/index.html") {
      const stat = fs.statSync(ARTIFACT);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": stat.size, "Cache-Control": "no-store" });
      fs.createReadStream(ARTIFACT).pipe(res);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({
      url: `http://127.0.0.1:${server.address().port}/index.html`,
      close: async () => {
        if (typeof server.closeAllConnections === "function") server.closeAllConnections();
        await new Promise((r) => server.close(r));
      },
    }));
  });
}

async function openScenario(browser, url, storage, waitReady) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addInitScript(({ stored, duration }) => {
    if (stored !== null) {
      try { localStorage.setItem("cal-phone.settings.v1", stored); } catch { /* ignore */ }
    }
    window.__voiceFake = { durationMs: Number(duration) };
    window.SherpaOnnx = async () => ({ FS: { mkdirTree() {}, FS_createDataFile() {}, writeFile() {} } });
    window.createOfflineTts = () => ({
      handle: 1,
      sampleRate: 22050,
      generate() {
        const count = Math.round(22050 * window.__voiceFake.durationMs / 1000);
        const samples = new Float32Array(Math.max(1, count));
        for (let i = 0; i < samples.length; i += 1) samples[i] = Math.sin(i / 20) * 0.05;
        return { samples, sampleRate: 22050 };
      },
    });
    class FakeAudioContext {
      constructor() { this.state = "running"; this.destination = {}; }
      createBuffer(_c, len) { return { getChannelData: () => new Float32Array(len) }; }
      createBufferSource() {
        const src = { buffer: null, connect() {}, onended: null };
        src.start = () => { setTimeout(() => { if (typeof src.onended === "function") src.onended(); }, window.__voiceFake.durationMs); };
        return src;
      }
      resume() { return Promise.resolve(); }
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
  }, { stored: storage === undefined ? null : J(storage), duration: FAKE_DURATION_MS });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  await page.goto(url, { waitUntil: "load" });
  await page.waitForSelector("main.app");
  if (waitReady !== false) {
    await page.waitForFunction(
      () => (document.querySelector("main.app")?.dataset.voiceState || "") === "ready",
      null, { timeout: 20000, polling: 50 },
    );
  }
  return { context, page, close: async () => { await context.close(); } };
}

async function readState(page) {
  return page.evaluate(() => {
    const el = document.querySelector("main.app") || document.body;
    let log = [];
    let played = [];
    try { log = JSON.parse(el.dataset.speechLog || "[]"); } catch { log = []; }
    try { played = JSON.parse(el.dataset.speechPlayed || "[]"); } catch { played = []; }
    return {
      logTexts: log.map((e) => e.text),
      logKinds: log.map((e) => e.kind),
      playedTexts: played.map((e) => e.text),
      playedKinds: played.map((e) => e.kind),
      count: el.dataset.speechCount || "",
      lastText: el.dataset.speechLast || "",
      lastKind: el.dataset.speechKind || "",
    };
  });
}

async function waitPlayed(page, minimum, timeout = 8000) {
  const started = Date.now();
  let n = 0;
  while (Date.now() - started < timeout) {
    n = await page.evaluate(() => {
      const el = document.querySelector("main.app") || document.body;
      try { return JSON.parse(el.dataset.speechPlayed || "[]").length; } catch { return 0; }
    });
    if (n >= minimum) break;
    await sleep(100);
  }
  return n;
}

async function waitText(page, selector, expected, timeout = 8000) {
  await page.waitForFunction(([sel, exp]) => {
    const el = document.querySelector(sel);
    return !!el && (el.textContent || "").trim() === exp;
  }, [selector, expected], { timeout, polling: 50 });
}

async function clickToken(page, token) {
  if (token === "=") await page.click('[data-testid="key-equals"]');
  else if (["+", "-", "*", "/"].includes(token)) await page.click(`[data-op="${token}"]`);
  else if (token === "enter") await page.click('[data-testid="enter"]');
  else await page.click(`[data-key="${token}"]`);
}

async function clickSeq(page, tokens) {
  for (const t of tokens) await clickToken(page, t);
}

const KEYS_ONLY = { autoConfirm: 0, autoEquals: 0, baseEnabled: false, baseText: "0", voiceKeys: true, voiceResult: false };
const RESULT_ONLY = { autoConfirm: 0, autoEquals: 0, baseEnabled: false, baseText: "0", voiceKeys: false, voiceResult: true };
const BOTH_ON = { autoConfirm: 0, autoEquals: 0, baseEnabled: false, baseText: "0", voiceKeys: true, voiceResult: true };
const BOTH_OFF = { autoConfirm: 0, autoEquals: 0, baseEnabled: false, baseText: "0", voiceKeys: false, voiceResult: false };
const AUTO_KEYS = { autoConfirm: 0.2, autoEquals: 0, baseEnabled: false, baseText: "0", voiceKeys: true, voiceResult: false };

// retry wrapper: fresh page per attempt, up to 3 attempts, record raw observations
async function retry(browser, url, label, storage, waitReady, fn) {
  const raws = [];
  let last = null;
  for (let i = 1; i <= 3; i += 1) {
    const s = await openScenario(browser, url, storage, waitReady);
    try {
      last = await fn(s.page);
      raws.push(`try${i}=${last.raw}`);
      if (last.pass) break;
    } catch (e) {
      last = { pass: false, raw: `try${i} threw:${String(e && e.message ? e.message : e).slice(0, 200)}` };
      raws.push(last.raw);
    } finally {
      await s.close();
    }
    if (!last.pass) await sleep(500);
  }
  return { pass: !!last.pass, evidence: `${label} [${raws.join(" | ")}]` };
}

async function runH1(browser, url) {
  const subs = [];
  subs.push(await retry(browser, url, "H1-1", KEYS_ONLY, true, async (page) => {
    await clickToken(page, "5");
    await clickToken(page, "enter");
    await sleep(2500);
    const a = await readState(page);
    await sleep(1000);
    const b = await readState(page);
    const pass = same(a.logTexts, ["五"]) && same(a.playedTexts, ["五"]) && a.count === "1" && b.count === "1";
    return { pass, raw: J({ log: a.logTexts, played: a.playedTexts, count: a.count, count2: b.count }) };
  }));
  subs.push(await retry(browser, url, "H1-2", KEYS_ONLY, true, async (page) => {
    await clickSeq(page, ["9", "5", "enter"]);
    await sleep(2500);
    const a = await readState(page);
    await sleep(1000);
    const b = await readState(page);
    const pass = same(a.logTexts, ["九", "五"]) && same(a.playedTexts, ["九", "五"]) && a.count === "2" && b.count === "2";
    return { pass, raw: J({ log: a.logTexts, played: a.playedTexts, count: a.count, count2: b.count }) };
  }));
  subs.push(await retry(browser, url, "H1-3", AUTO_KEYS, true, async (page) => {
    await clickToken(page, "6");
    await sleep(2500);
    const a = await readState(page);
    await sleep(1000);
    const b = await readState(page);
    const pass = same(a.logTexts, ["六"]) && same(a.playedTexts, ["六"]) && a.count === "1" && b.count === "1";
    return { pass, raw: J({ log: a.logTexts, played: a.playedTexts, count: a.count, count2: b.count }) };
  }));
  subs.push(await retry(browser, url, "H1-4", KEYS_ONLY, true, async (page) => {
    await page.keyboard.press("7");
    await page.keyboard.press("Enter");
    await waitPlayed(page, 1, 8000);
    await sleep(1000);
    const a = await readState(page);
    await sleep(1000);
    const b = await readState(page);
    const pass = same(a.logTexts, ["七"]) && same(a.playedTexts, ["七"]);
    void b;
    return { pass, raw: J({ log: a.logTexts, played: a.playedTexts, count: a.count, count2: b.count }) };
  }));
  subs.push(await retry(browser, url, "H1-5", BOTH_ON, true, async (page) => {
    await clickSeq(page, ["9", "5", "enter"]);
    await waitPlayed(page, 2, 8000);
    await sleep(1000);
    const a = await readState(page);
    await sleep(1000);
    const b = await readState(page);
    const keyTexts = a.logTexts.filter((_, i) => a.logKinds[i] === "key");
    const hasResult = a.logKinds.includes("result") || a.playedKinds.includes("result");
    const pass = same(keyTexts, ["九", "五"]) && !hasResult && b.count === a.count;
    return { pass, raw: J({ keyTexts, logKinds: a.logKinds, playedKinds: a.playedKinds, count: a.count, count2: b.count }) };
  }));
  const pass = subs.every((s) => s.pass);
  return { pass, evidence: subs.map((s) => s.evidence).join(" ; ") };
}

async function runH2(browser, url) {
  const subs = [];
  subs.push(await retry(browser, url, "H2-1", KEYS_ONLY, true, async (page) => {
    await clickSeq(page, ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    await waitPlayed(page, 10, 8000);
    const a = await readState(page);
    const exp = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
    const pass = same(a.logTexts, exp) && a.logKinds.every((k) => k === "key") && !a.logKinds.includes("result");
    return { pass, raw: J({ log: a.logTexts, kinds: a.logKinds, count: a.count }) };
  }));
  subs.push(await retry(browser, url, "H2-2", KEYS_ONLY, true, async (page) => {
    await clickSeq(page, ["5", ".", ".", "7"]);
    await waitPlayed(page, 3, 8000);
    const a = await readState(page);
    const pass = same(a.logTexts, ["五", "点", "七"]) && a.logKinds.every((k) => k === "key");
    return { pass, raw: J({ log: a.logTexts, kinds: a.logKinds }) };
  }));
  subs.push(await retry(browser, url, "H2-3", KEYS_ONLY, true, async (page) => {
    await clickSeq(page, ["5", "backspace", "backspace"]);
    await waitPlayed(page, 2, 8000);
    const a = await readState(page);
    const pass = same(a.logTexts, ["五", "退格"]) && a.logKinds.every((k) => k === "key");
    return { pass, raw: J({ log: a.logTexts, kinds: a.logKinds }) };
  }));
  subs.push(await retry(browser, url, "H2-4", KEYS_ONLY, true, async (page) => {
    await clickSeq(page, ["5", "5"]);
    await waitPlayed(page, 2, 8000);
    const a = await readState(page);
    const pass = same(a.logTexts, ["五", "五"]) && a.logKinds.every((k) => k === "key");
    return { pass, raw: J({ log: a.logTexts, kinds: a.logKinds }) };
  }));
  subs.push(await retry(browser, url, "H2-5", KEYS_ONLY, true, async (page) => {
    await clickSeq(page, ["+", "-", "*", "/"]);
    await waitPlayed(page, 4, 8000);
    const a = await readState(page);
    const pass = same(a.logTexts, ["加", "减", "乘", "除"]) && a.logKinds.every((k) => k === "key");
    return { pass, raw: J({ log: a.logTexts, kinds: a.logKinds }) };
  }));
  subs.push(await retry(browser, url, "H2-6", KEYS_ONLY, true, async (page) => {
    await clickSeq(page, ["1", "+", "2"]);
    await waitPlayed(page, 3, 8000);
    const before = await readState(page);
    await clickToken(page, "=");
    await waitText(page, '[data-testid="result"]', "3", 8000);
    await sleep(800);
    const after = await readState(page);
    const pass = same(before.logTexts, ["一", "加", "二"]) && same(after.logTexts, ["一", "加", "二"]) && after.count === "3";
    return { pass, raw: J({ before: before.logTexts, after: after.logTexts, count: after.count }) };
  }));
  subs.push(await retry(browser, url, "H2-7", KEYS_ONLY, true, async (page) => {
    await clickSeq(page, ["5", "enter", "backspace", "backspace"]);
    await waitPlayed(page, 2, 8000);
    const a = await readState(page);
    const pass = same(a.logTexts, ["五", "退格"]) && a.logKinds.every((k) => k === "key") && !a.logKinds.includes("result");
    return { pass, raw: J({ log: a.logTexts, kinds: a.logKinds }) };
  }));
  const pass = subs.every((s) => s.pass);
  return { pass, evidence: subs.map((s) => s.evidence).join(" ; ") };
}

async function runH3(browser, url) {
  const subs = [];
  subs.push(await retry(browser, url, "H3-1", RESULT_ONLY, true, async (page) => {
    await clickSeq(page, ["1", "+", "2", "="]);
    await waitText(page, '[data-testid="result"]', "3", 8000);
    await waitPlayed(page, 1, 8000);
    const a = await readState(page);
    const res = await page.$eval('[data-testid="result"]', (e) => (e.textContent || "").trim());
    const last = a.logTexts[a.logTexts.length - 1];
    const pass = !a.logKinds.includes("key") && last === "三" && a.lastText === "三" && a.lastKind === "result" && res === "3";
    return { pass, raw: J({ log: a.logTexts, kinds: a.logKinds, result: res }) };
  }));
  subs.push(await retry(browser, url, "H3-2", RESULT_ONLY, true, async (page) => {
    await clickSeq(page, ["9", ".", "5", "+", "9", ".", "2", "="]);
    await waitText(page, '[data-testid="result"]', "18.7", 8000);
    await waitPlayed(page, 1, 8000);
    const a = await readState(page);
    const res = await page.$eval('[data-testid="result"]', (e) => (e.textContent || "").trim());
    const last = a.logTexts[a.logTexts.length - 1];
    const pass = res === "18.7" && last === "十八点七" && a.lastKind === "result";
    return { pass, raw: J({ log: a.logTexts, kinds: a.logKinds, result: res }) };
  }));
  subs.push(await retry(browser, url, "H3-3", RESULT_ONLY, true, async (page) => {
    await clickSeq(page, ["2", "-", "5", "="]);
    await waitText(page, '[data-testid="result"]', "-3", 8000);
    await waitPlayed(page, 1, 8000);
    const a = await readState(page);
    const res = await page.$eval('[data-testid="result"]', (e) => (e.textContent || "").trim());
    const last = a.logTexts[a.logTexts.length - 1];
    const pass = res === "-3" && last === "负三" && a.lastKind === "result";
    return { pass, raw: J({ log: a.logTexts, kinds: a.logKinds, result: res }) };
  }));
  subs.push(await retry(browser, url, "H3-4", RESULT_ONLY, true, async (page) => {
    await clickSeq(page, ["1", "/", "0", "="]);
    await waitText(page, '[data-testid="result"]', "不能除以零", 8000);
    await waitPlayed(page, 1, 8000);
    const a = await readState(page);
    const res = await page.$eval('[data-testid="result"]', (e) => (e.textContent || "").trim());
    const last = a.logTexts[a.logTexts.length - 1];
    const pass = res === "不能除以零" && last === "不能除以零" && a.lastKind === "result";
    return { pass, raw: J({ log: a.logTexts, kinds: a.logKinds, result: res }) };
  }));
  subs.push(await retry(browser, url, "H3-5", BOTH_ON, true, async (page) => {
    await clickSeq(page, ["1", "+", "2", "="]);
    await waitText(page, '[data-testid="result"]', "3", 8000);
    await waitPlayed(page, 4, 8000);
    const a = await readState(page);
    const keyTexts = a.logTexts.filter((_, i) => a.logKinds[i] === "key");
    const last = a.logTexts[a.logTexts.length - 1];
    const lastKind = a.logKinds[a.logKinds.length - 1];
    const pass = same(keyTexts, ["一", "加", "二"]) && last === "三" && lastKind === "result";
    return { pass, raw: J({ log: a.logTexts, kinds: a.logKinds }) };
  }));
  // no "结果" substring in any announcement
  const s = await openScenario(browser, url, RESULT_ONLY, true);
  let noWord = false;
  let wordRaw = "";
  try {
    await clickSeq(s.page, ["1", "+", "2", "="]);
    await waitPlayed(s.page, 1, 8000);
    const a = await readState(s.page);
    noWord = !a.logTexts.some((t) => String(t).includes("结果"));
    wordRaw = J({ log: a.logTexts });
  } finally {
    await s.close();
  }
  subs.push({ pass: noWord, evidence: `H3-6-noRESULT-word [log=${wordRaw}]` });
  const pass = subs.every((x) => x.pass);
  return { pass, evidence: subs.map((x) => x.evidence).join(" ; ") };
}

async function runH4(browser, url) {
  const subs = [];
  subs.push(await retry(browser, url, "H4-1", BOTH_OFF, false, async (page) => {
    await clickSeq(page, ["1", "+", "2", "="]);
    await waitText(page, '[data-testid="result"]', "3", 8000);
    await sleep(500);
    const a = await readState(page);
    const pass = a.count === "0" || a.count === "";
    return { pass, raw: J({ count: a.count, log: a.logTexts }) };
  }));
  subs.push(await retry(browser, url, "H4-2", RESULT_ONLY, true, async (page) => {
    await clickSeq(page, ["1", "+", "2", "="]);
    await waitText(page, '[data-testid="result"]', "3", 8000);
    await waitPlayed(page, 1, 8000);
    const a = await readState(page);
    const pass = same([...new Set(a.logKinds)], ["result"]);
    return { pass, raw: J({ kinds: [...new Set(a.logKinds)], log: a.logTexts }) };
  }));
  subs.push(await retry(browser, url, "H4-3", KEYS_ONLY, true, async (page) => {
    const t0 = Date.now();
    await clickSeq(page, ["1", "2", "3"]);
    const span = Date.now() - t0;
    await waitPlayed(page, 3, 8000);
    const a = await readState(page);
    const played = await page.evaluate(() => {
      const el = document.querySelector("main.app") || document.body;
      try { return JSON.parse(el.dataset.speechPlayed || "[]").map((e) => e.text); } catch { return []; }
    });
    const pass = span < 1500 && same(played, ["一", "二", "三"]) && same(a.logTexts, ["一", "二", "三"]);
    return { pass, raw: J({ spanMs: span, played, log: a.logTexts }) };
  }));
  subs.push(await retry(browser, url, "H4-4", BOTH_ON, true, async (page) => {
    await clickSeq(page, ["1", "+", "1", "=", "9"]);
    await sleep(4000);
    const full = await page.evaluate(() => {
      const el = document.querySelector("main.app") || document.body;
      try { return JSON.parse(el.dataset.speechPlayed || "[]"); } catch { return []; }
    });
    const keyTexts = full.filter((e) => e.kind === "key").map((e) => e.text);
    const hasResult = full.some((e) => e.kind === "result");
    const pass = !hasResult && same(keyTexts, ["一", "加", "一", "九"]);
    return { pass, raw: J({ keyTexts, hasResult, playedKinds: full.map((e) => e.kind) }) };
  }));
  const pass = subs.every((x) => x.pass);
  return { pass, evidence: subs.map((x) => x.evidence).join(" ; ") };
}

async function runH5(browser, url) {
  const parts = [];
  // H5-1: voice suite
  const t1 = Date.now();
  const run1 = spawnSync("node", ["tests/voice/run.mjs", "--json"], {
    cwd: REPO, encoding: "utf8", timeout: 600000, maxBuffer: 20 * 1024 * 1024,
  });
  let p1 = null;
  try { p1 = JSON.parse(String(run1.stdout || "").trim()); } catch (e) { p1 = null; }
  const h51pass = run1.status === 0 && p1 && p1.failed === 0 && p1.passed >= 70;
  parts.push({ pass: !!h51pass, evidence: `H5-1-voice [exit=${run1.status} passed=${p1?.passed} failed=${p1?.failed} ms=${Date.now() - t1}${p1 ? "" : " parseERR:" + String(run1.stderr || "").slice(0, 200)}]` });
  // H5-2: core suite
  const t2 = Date.now();
  const run2 = spawnSync("node", ["suite.mjs", "--json"], {
    cwd: path.join(REPO, "tests"), encoding: "utf8", timeout: 600000, maxBuffer: 20 * 1024 * 1024,
  });
  let p2 = null;
  try { p2 = JSON.parse(String(run2.stdout || "").trim()); } catch (e) { p2 = null; }
  const results = Array.isArray(p2?.results) ? p2.results : [];
  const allChecks = results.flatMap((r) => (Array.isArray(r.checks) ? r.checks : []));
  const failedChecks = allChecks.filter((c) => !c.pass);
  const h52pass = run2.status === 0 && results.length === 18 && allChecks.length === 206 && failedChecks.length === 0 && results.every((r) => r.pass);
  parts.push({ pass: !!h52pass, evidence: `H5-2-suite [exit=${run2.status} scenarios=${results.length} checks=${allChecks.length} failed=${failedChecks.length} ms=${Date.now() - t2} rawKeys=${p2 ? Object.keys(p2).join(",") : "parseERR:" + String(run2.stderr || "").slice(0, 200)}]` });
  // H5-3: keys-only compute still works
  parts.push(await retry(browser, url, "H5-3", KEYS_ONLY, true, async (page) => {
    await clickSeq(page, ["1", "+", "2", "="]);
    await waitText(page, '[data-testid="result"]', "3", 8000);
    const res = await page.$eval('[data-testid="result"]', (e) => (e.textContent || "").trim());
    return { pass: res === "3", raw: J({ result: res }) };
  }));
  // H5-4: enter label unchanged
  parts.push(await retry(browser, url, "H5-4", KEYS_ONLY, true, async (page) => {
    const t = await page.$eval('[data-testid="enter"]', (e) => (e.textContent || "").trim());
    return { pass: t === "确认", raw: J({ enterText: t }) };
  }));
  // H5-5: auto-confirm still commits (expression shows 6) but silent
  parts.push(await retry(browser, url, "H5-5", AUTO_KEYS, true, async (page) => {
    await clickToken(page, "6");
    await sleep(1000);
    const expr = await page.$eval('[data-testid="expression"]', (e) => (e.textContent || ""));
    return { pass: expr.includes("6"), raw: J({ expression: expr }) };
  }));
  const pass = parts.every((x) => x.pass);
  return { pass, evidence: parts.map((x) => x.evidence).join(" ; ") };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const artifactSha = sha256File(ARTIFACT);
  const verifierSha = sha256File(SELF);
  let H1 = { pass: false, evidence: "not-run" };
  let H2 = { pass: false, evidence: "not-run" };
  let H3 = { pass: false, evidence: "not-run" };
  let H4 = { pass: false, evidence: "not-run" };
  let H5 = { pass: false, evidence: "not-run" };
  const chromium = loadChromium();
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  try {
    H1 = await runH1(browser, server.url);
    H2 = await runH2(browser, server.url);
    H3 = await runH3(browser, server.url);
    H4 = await runH4(browser, server.url);
    H5 = await runH5(browser, server.url);
  } catch (e) {
    const msg = `harness-crash:${String(e && e.stack ? e.stack : e).slice(0, 300)}`;
    for (const h of [H1, H2, H3, H4, H5]) if (h.evidence === "not-run") h.evidence = msg;
  } finally {
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
  const fails = [];
  if (!H1.pass) fails.push("H1");
  if (!H2.pass) fails.push("H2");
  if (!H3.pass) fails.push("H3");
  if (!H4.pass) fails.push("H4");
  if (!H5.pass) fails.push("H5");
  const lines = [
    `ROUND: ${ROUND}`,
    `ARTIFACT_SHA256: ${artifactSha}`,
    `VERIFIER_SHA256: ${verifierSha}`,
    `H1 ${H1.pass ? "PASS" : "FAIL"} — ${H1.evidence}`,
    `H2 ${H2.pass ? "PASS" : "FAIL"} — ${H2.evidence}`,
    `H3 ${H3.pass ? "PASS" : "FAIL"} — ${H3.evidence}`,
    `H4 ${H4.pass ? "PASS" : "FAIL"} — ${H4.evidence}`,
    `H5 ${H5.pass ? "PASS" : "FAIL"} — ${H5.evidence}`,
    fails.length === 0 ? "HARD: PASS" : `HARD: FAIL (${fails.join(",")})`,
  ];
  const outFile = path.join(OUT_DIR, `hard-r${ROUND}.txt`);
  fs.writeFileSync(outFile, lines.join("\n") + "\n", "utf8");
  for (const l of lines) console.log(l);
  console.log(`wrote ${outFile}`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(2);
});
