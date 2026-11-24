#!/usr/bin/env node
// Kekkai gate verifier (phase=first) for voice-number-only announcements.
// Usage: node verify.mjs <round>
// Env: KEKKAI_ARTIFACT overrides the target HTML file.
//      KEKKAI_OUT_DIR overrides where hard-r<N>.txt is written.
// All paths resolve from this script's own directory or absolute env values,
// never from cwd. No hardcoded verdicts: every H verdict is computed from
// measured browser state below.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = "/ws/cal_phone";
const VOICE_RUN = path.join(REPO, "tests", "voice", "run.mjs");
const SUITE = path.join(REPO, "tests", "suite.mjs");
const DEFAULT_ARTIFACT = path.join(REPO, "index.html");
const SETTINGS_KEY = "cal-phone.settings.v1";
const FAKE_DURATION_MS = 400;

const ROUND = Number(process.argv[2] ?? process.env.KEKKAI_ROUND ?? 1);
const ARTIFACT = process.env.KEKKAI_ARTIFACT && fs.existsSync(String(process.env.KEKKAI_ARTIFACT))
  ? path.resolve(String(process.env.KEKKAI_ARTIFACT))
  : DEFAULT_ARTIFACT;
const OUT_DIR = process.env.KEKKAI_OUT_DIR ? path.resolve(String(process.env.KEKKAI_OUT_DIR)) : SCRIPT_DIR;
fs.mkdirSync(OUT_DIR, { recursive: true });

const require = createRequire(path.join(REPO, "tests", "package.json"));
const { chromium } = require("playwright");

const VOICE_SCRIPT_STUB = "window.SherpaOnnx=async()=>({FS:{mkdirTree(){},FS_createDataFile(){},writeFile(){}}});\nwindow.createOfflineTts=()=>({handle:1,sampleRate:22050,generate:()=>({samples:new Float32Array(8),sampleRate:22050})});\n";

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startServer(artifactPath) {
  const placeholder = Buffer.alloc(2048, 0x5a);
  const server = http.createServer((req, res) => {
    let pathname = "/";
    try {
      pathname = decodeURIComponent(new URL(req.url || "/", "http://127.0.0.1").pathname);
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("bad request");
      return;
    }
    if (pathname === "/" || pathname === "/index.html") {
      const stat = fs.statSync(artifactPath);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": stat.size, "Cache-Control": "no-store" });
      fs.createReadStream(artifactPath).pipe(res);
      return;
    }
    if (pathname.startsWith("/voice/")) {
      const rel = pathname.slice("/voice/".length);
      if (rel === "sherpa-onnx-wasm-web.js" || rel === "sherpa-onnx-tts.js") {
        const body = Buffer.from(VOICE_SCRIPT_STUB, "utf8");
        res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Content-Length": body.length, "Cache-Control": "no-store" });
        res.end(body);
        return;
      }
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": placeholder.length, "Cache-Control": "no-store" });
      res.end(placeholder);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}/index.html`,
    async close() {
      if (typeof server.closeAllConnections === "function") server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function openPage(browser, url, { storage } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addInitScript(({ stored, duration }) => {
    if (stored !== null) {
      try {
        localStorage.setItem("cal-phone.settings.v1", stored);
      } catch {
        /* ignore locked storage */
      }
    }
    window.__voiceFake = { fail: false, durationMs: Number(duration), generated: [] };
    window.SherpaOnnx = async () => ({ FS: { mkdirTree() {}, FS_createDataFile() {}, writeFile() {} } });
    window.createOfflineTts = () => ({
      handle: 1,
      sampleRate: 22050,
      generate(...args) {
        const text = args[0] && args[0].text !== undefined ? String(args[0].text) : "";
        if (text) window.__voiceFake.generated.push(text);
        const n = Math.round((22050 * window.__voiceFake.durationMs) / 1000);
        const a = new Float32Array(Math.max(1, n));
        for (let i = 0; i < a.length; i += 1) a[i] = Math.sin(i / 20) * 0.05;
        return { samples: a, sampleRate: 22050 };
      },
    });
    class FakeAudioContext {
      constructor() {
        this.state = "running";
        this.destination = {};
      }
      createBuffer(_channels, length) {
        return { getChannelData: () => new Float32Array(length) };
      }
      createBufferSource() {
        const source = { buffer: null, connect() {}, onended: null };
        source.start = () => {
          setTimeout(() => {
            if (typeof source.onended === "function") source.onended();
          }, window.__voiceFake.durationMs);
        };
        return source;
      }
      resume() {
        return Promise.resolve();
      }
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
  }, { stored: storage === undefined ? null : JSON.stringify(storage), duration: FAKE_DURATION_MS });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error && error.message ? error.message : error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(url, { waitUntil: "load" });
  await page.waitForSelector("main.app");
  return {
    context,
    page,
    pageErrors,
    consoleErrors,
    async close() {
      await context.close();
    },
  };
}

async function waitVoice(page, states, timeout = 20000) {
  const wanted = Array.isArray(states) ? states : [states];
  await page.waitForFunction(
    (allowed) => allowed.includes(document.querySelector("main.app")?.dataset.voiceState || ""),
    wanted,
    { timeout, polling: 50 },
  );
}

async function waitResult(page, text, timeout = 8000) {
  await page.waitForFunction(
    (expected) => (document.querySelector('[data-testid="result"]')?.textContent || "").trim() === expected,
    text,
    { timeout, polling: 25 },
  );
  return page.$eval('[data-testid="result"]', (el) => (el.textContent || "").trim());
}

async function resultText(page) {
  return page.$eval('[data-testid="result"]', (el) => (el.textContent || "").trim());
}

async function clickToken(page, token) {
  if (token === "=" || token === "equals") {
    await page.click('[data-testid="key-equals"]');
  } else if (["+", "-", "*", "/"].includes(token)) {
    await page.click(`[data-op="${token}"]`);
  } else if (token === "enter") {
    await page.click('[data-key="enter"]');
  } else {
    await page.click(`[data-key="${token}"]`);
  }
}

async function clickSequence(page, tokens) {
  for (const token of tokens) await clickToken(page, token);
}

async function readSpeech(page) {
  return page.evaluate(() => {
    const el = document.querySelector("main.app") || document.body;
    let log = [];
    try {
      log = JSON.parse(el.dataset.speechLog || "[]");
    } catch {
      log = [];
    }
    return {
      log,
      texts: log.map((entry) => entry.text),
      kinds: log.map((entry) => entry.kind),
      count: el.dataset.speechCount || "",
      last: el.dataset.speechLast || "",
      kind: el.dataset.speechKind || "",
    };
  });
}

async function readPlayed(page) {
  return page.evaluate(() => {
    const el = document.querySelector("main.app") || document.body;
    try {
      return JSON.parse(el.dataset.speechPlayed || "[]");
    } catch {
      return [];
    }
  });
}

async function openSettings(page) {
  await page.click('[data-testid="settings-toggle"]');
  await page.waitForSelector('[data-testid="settings-panel"]', { state: "visible" });
}

async function closeSettings(page) {
  await page.click('[data-testid="settings-done"]');
  await page.waitForSelector('[data-testid="settings-panel"]', { state: "hidden" });
}

function sub(name, cond, detail) {
  return { name, pass: Boolean(cond), detail: String(detail) };
}

// H1: result-only announcements.
async function checkH1(browser, url) {
  const subs = [];
  const app = await openPage(browser, url, { storage: { voiceKeys: false, voiceResult: true } });
  try {
    const { page } = app;
    await waitVoice(page, "ready");
    // 1) 9.5 + 9.2
    await clickSequence(page, ["9", ".", "5", "+", "9", ".", "2", "="]);
    const r1 = await waitResult(page, "18.7");
    await sleep(400);
    const s1 = await readSpeech(page);
    subs.push(sub("dec", r1 === "18.7" && s1.last === "十八点七" && s1.kind === "result"
      && !s1.texts.some((t) => t.includes("结果")) && s1.log.at(-1)?.text === s1.last,
      `result=${JSON.stringify(r1)} last=${JSON.stringify(s1.last)} kind=${JSON.stringify(s1.kind)} log=${JSON.stringify(s1.texts)}`));
    // 2) 2 - 5
    await clickSequence(page, ["2", "-", "5", "="]);
    const r2 = await waitResult(page, "-3");
    await sleep(400);
    const s2 = await readSpeech(page);
    subs.push(sub("neg", r2 === "-3" && s2.last === "负三" && s2.kind === "result"
      && !s2.texts.some((t) => t.includes("结果")) && s2.log.at(-1)?.text === s2.last,
      `result=${JSON.stringify(r2)} last=${JSON.stringify(s2.last)} kind=${JSON.stringify(s2.kind)} log=${JSON.stringify(s2.texts)}`));
    // 3) 1 / 0
    await clickSequence(page, ["1", "/", "0", "="]);
    const r3 = await waitResult(page, "不能除以零");
    await sleep(400);
    const s3 = await readSpeech(page);
    subs.push(sub("zero", r3 === "不能除以零" && s3.last === "不能除以零"
      && !s3.texts.some((t) => t.includes("结果")) && s3.log.at(-1)?.text === s3.last,
      `result=${JSON.stringify(r3)} last=${JSON.stringify(s3.last)} kind=${JSON.stringify(s3.kind)} log=${JSON.stringify(s3.texts)}`));
    // 4) autoEquals=2 then 3+4 confirm
    await openSettings(page);
    await page.fill('[data-testid="settings-auto-equals"]', "2");
    await closeSettings(page);
    await clickSequence(page, ["3", "+", "4", "enter"]);
    const r4 = await waitResult(page, "7");
    await sleep(400);
    const s4 = await readSpeech(page);
    subs.push(sub("autoeq", r4 === "7" && s4.last === "七"
      && !s4.texts.some((t) => t.includes("结果")) && s4.log.at(-1)?.text === s4.last,
      `result=${JSON.stringify(r4)} last=${JSON.stringify(s4.last)} kind=${JSON.stringify(s4.kind)} log=${JSON.stringify(s4.texts)}`));
    // 5) fresh page 7+8
    const fresh1 = await openPage(browser, url, { storage: { voiceKeys: false, voiceResult: true } });
    try {
      await waitVoice(fresh1.page, "ready");
      await clickSequence(fresh1.page, ["7", "+", "8", "="]);
      const r5 = await waitResult(fresh1.page, "15");
      await sleep(400);
      const s5 = await readSpeech(fresh1.page);
      subs.push(sub("direct", r5 === "15" && s5.last === "十五" && !s5.texts.includes("确认")
        && s5.log.at(-1)?.text === s5.last,
        `result=${JSON.stringify(r5)} last=${JSON.stringify(s5.last)} log=${JSON.stringify(s5.texts)}`));
    } finally {
      await fresh1.close();
    }
    // 6) fresh page 95+0
    const fresh2 = await openPage(browser, url, { storage: { voiceKeys: false, voiceResult: true } });
    try {
      await waitVoice(fresh2.page, "ready");
      await clickSequence(fresh2.page, ["9", "5", "+", "0", "="]);
      const r6 = await waitResult(fresh2.page, "95");
      await sleep(400);
      const s6 = await readSpeech(fresh2.page);
      subs.push(sub("ninefive", r6 === "95" && s6.last === "九十五"
        && !s6.texts.some((t) => t.includes("结果")) && s6.log.at(-1)?.text === s6.last,
        `result=${JSON.stringify(r6)} last=${JSON.stringify(s6.last)} kind=${JSON.stringify(s6.kind)} log=${JSON.stringify(s6.texts)}`));
    } finally {
      await fresh2.close();
    }
    const pass = subs.every((s) => s.pass);
    return { pass, app, subs, first18: (typeof r1 === "string" ? r1 : null), detail: subs.map((s) => `${s.name}=${s.pass ? "ok" : "BAD"}(${s.detail})`).join(" | ") };
  } catch (error) {
    try {
      await app.close();
    } catch { /* already closed */ }
    return { pass: false, app: null, subs, detail: `crash: ${String(error && error.message ? error.message : error)}` };
  }
}

// H2: keys-only announcements.
async function checkH2(browser, url) {
  const subs = [];
  const seen = [];
  try {
    const p1 = await openPage(browser, url, { storage: { voiceKeys: true, voiceResult: false } });
    try {
      await waitVoice(p1.page, "ready");
      await clickSequence(p1.page, ["9", "5", "enter"]);
      await sleep(400);
      const s = await readSpeech(p1.page);
      seen.push(...s.texts);
      subs.push(sub("ninefive", JSON.stringify(s.texts) === JSON.stringify(["九", "五", "九十五"]) && s.last === "九十五",
        `texts=${JSON.stringify(s.texts)} last=${JSON.stringify(s.last)}`));
    } finally {
      await p1.close();
    }
    const p2 = await openPage(browser, url, { storage: { voiceKeys: true, voiceResult: false } });
    try {
      await waitVoice(p2.page, "ready");
      await clickSequence(p2.page, ["0", ".", "5", "enter"]);
      await sleep(400);
      const s = await readSpeech(p2.page);
      seen.push(...s.texts);
      subs.push(sub("decimal", JSON.stringify(s.texts) === JSON.stringify(["零", "点", "五", "零点五"]) && s.last === "零点五",
        `texts=${JSON.stringify(s.texts)} last=${JSON.stringify(s.last)}`));
    } finally {
      await p2.close();
    }
    const p3 = await openPage(browser, url, { storage: { autoConfirm: 0.2, voiceKeys: true, voiceResult: false } });
    try {
      await waitVoice(p3.page, "ready");
      await p3.page.click('[data-key="6"]');
      await sleep(500);
      let s = await readSpeech(p3.page);
      const started = Date.now();
      while (JSON.stringify(s.texts) !== JSON.stringify(["六", "六"]) && Date.now() - started < 5000) {
        await sleep(250);
        s = await readSpeech(p3.page);
      }
      seen.push(...s.texts);
      subs.push(sub("autoconfirm", JSON.stringify(s.texts) === JSON.stringify(["六", "六"]),
        `texts=${JSON.stringify(s.texts)}`));
    } finally {
      await p3.close();
    }
    const p4 = await openPage(browser, url, { storage: { voiceKeys: true, voiceResult: false } });
    try {
      await waitVoice(p4.page, "ready");
      await p4.page.keyboard.press("7");
      await p4.page.keyboard.press("Enter");
      await sleep(500);
      let s = await readSpeech(p4.page);
      const started = Date.now();
      while (JSON.stringify(s.texts) !== JSON.stringify(["七", "七"]) && Date.now() - started < 5000) {
        await sleep(250);
        s = await readSpeech(p4.page);
      }
      seen.push(...s.texts);
      subs.push(sub("kbd", JSON.stringify(s.texts) === JSON.stringify(["七", "七"]),
        `texts=${JSON.stringify(s.texts)}`));
    } finally {
      await p4.close();
    }
    const p5 = await openPage(browser, url, { storage: { voiceKeys: true, voiceResult: false } });
    try {
      await waitVoice(p5.page, "ready");
      const before = await readSpeech(p5.page);
      await p5.page.click('[data-key="enter"]');
      await sleep(400);
      const after = await readSpeech(p5.page);
      seen.push(...after.texts);
      subs.push(sub("empty", after.count === before.count,
        `countBefore=${JSON.stringify(before.count)} countAfter=${JSON.stringify(after.count)} texts=${JSON.stringify(after.texts)}`));
    } finally {
      await p5.close();
    }
    subs.push(sub("no-confirm-word", !seen.some((t) => t.includes("确认")), `all=${JSON.stringify(seen)}`));
    const pass = subs.every((s) => s.pass);
    return { pass, detail: subs.map((s) => `${s.name}=${s.pass ? "ok" : "BAD"}(${s.detail})`).join(" | ") };
  } catch (error) {
    return { pass: false, detail: `crash: ${String(error && error.message ? error.message : error)}` };
  }
}

// H3: keys-only long sequence + enter label.
async function checkH3(browser, url) {
  try {
    const app = await openPage(browser, url, { storage: { voiceKeys: true, voiceResult: false } });
    try {
      await waitVoice(app.page, "ready");
      await clickSequence(app.page, ["9", "5", ".", ".", "backspace", "enter", "enter", "backspace", "backspace", "+", "-", "*", "/", "equals"]);
      await sleep(400);
      const s = await readSpeech(app.page);
      const label = await app.page.$eval('[data-testid="enter"]', (el) => (el.textContent || "").trim());
      const want = ["九", "五", "点", "退格", "九十五", "退格", "加", "减", "乘", "除"];
      const pass = JSON.stringify(s.texts) === JSON.stringify(want) && s.count === "10" && s.last === "除" && label === "确认";
      return {
        pass,
        detail: `texts=${JSON.stringify(s.texts)} count=${JSON.stringify(s.count)} last=${JSON.stringify(s.last)} kind=${JSON.stringify(s.kind)} enterLabel=${JSON.stringify(label)}`,
      };
    } finally {
      await app.close();
    }
  } catch (error) {
    return { pass: false, detail: `crash: ${String(error && error.message ? error.message : error)}` };
  }
}

// H4: switch independence.
async function checkH4(browser, url) {
  const subs = [];
  try {
    const r1 = await openPage(browser, url, { storage: { voiceKeys: false, voiceResult: true } });
    try {
      await waitVoice(r1.page, "ready");
      await clickSequence(r1.page, ["1", "+", "2", "="]);
      const v = await waitResult(r1.page, "3");
      await sleep(400);
      const s = await readSpeech(r1.page);
      subs.push(sub("result-only", v === "3" && !s.kinds.includes("key") && s.last === "三",
        `result=${JSON.stringify(v)} kinds=${JSON.stringify(s.kinds)} last=${JSON.stringify(s.last)} log=${JSON.stringify(s.texts)}`));
    } finally {
      await r1.close();
    }
    const k1 = await openPage(browser, url, { storage: { voiceKeys: true, voiceResult: false } });
    try {
      await waitVoice(k1.page, "ready");
      await clickSequence(k1.page, ["1", "+", "2", "="]);
      const v = await waitResult(k1.page, "3");
      await sleep(400);
      const s = await readSpeech(k1.page);
      subs.push(sub("keys-only", v === "3" && JSON.stringify(s.texts) === JSON.stringify(["一", "加", "二"]) && !s.kinds.includes("result"),
        `result=${JSON.stringify(v)} texts=${JSON.stringify(s.texts)} kinds=${JSON.stringify(s.kinds)}`));
    } finally {
      await k1.close();
    }
    const both = await openPage(browser, url, { storage: { voiceKeys: true, voiceResult: true } });
    try {
      await waitVoice(both.page, "ready");
      await clickSequence(both.page, ["1", "+", "1", "=", "9"]);
      await sleep(4000);
      const played = await readPlayed(both.page);
      const hasKey = played.some((e) => e && e.kind === "key");
      const hasResult = played.some((e) => e && e.kind === "result");
      subs.push(sub("both-quick", played.length > 0 && hasKey && !hasResult,
        `played=${JSON.stringify(played.map((e) => `${e.kind}:${e.text}`))}`));
    } finally {
      await both.close();
    }
    const off = await openPage(browser, url, {});
    try {
      await clickSequence(off.page, ["1", "+", "2", "="]);
      const v = await waitResult(off.page, "3");
      await sleep(400);
      const s = await readSpeech(off.page);
      subs.push(sub("both-off", v === "3" && (s.count === "0" || s.count === ""),
        `result=${JSON.stringify(v)} count=${JSON.stringify(s.count)} log=${JSON.stringify(s.texts)}`));
    } finally {
      await off.close();
    }
    const pass = subs.every((s) => s.pass);
    return { pass, detail: subs.map((s) => `${s.name}=${s.pass ? "ok" : "BAD"}(${s.detail})`).join(" | ") };
  } catch (error) {
    return { pass: false, detail: `crash: ${String(error && error.message ? error.message : error)}` };
  }
}

// H5: existing suites + source-text checks + artifact re-read.
async function checkH5(h1First18) {
  const subs = [];
  try {
    const voiceRun = spawnSync(process.execPath, [VOICE_RUN, "--json"], {
      cwd: REPO,
      encoding: "utf8",
      timeout: 600000,
      maxBuffer: 32 * 1024 * 1024,
    });
    let voiceParsed = null;
    let voiceJsonOk = false;
    try {
      voiceParsed = JSON.parse(String(voiceRun.stdout || "").trim());
      voiceJsonOk = true;
    } catch (error) {
      voiceJsonOk = false;
    }
    const voiceChecks = Array.isArray(voiceParsed?.checks) ? voiceParsed.checks : [];
    subs.push(sub("voice-suite",
      voiceRun.status === 0 && voiceJsonOk && voiceParsed.failed === 0 && voiceChecks.length >= 24 && voiceChecks.every((c) => c.pass === true),
      `exit=${voiceRun.status} failed=${voiceParsed?.failed} checks=${voiceChecks.length} bad=${JSON.stringify(voiceChecks.filter((c) => !c.pass).map((c) => c.id))} stderr=${String(voiceRun.stderr || "").slice(-300)}`));

    const coreRun = spawnSync(process.execPath, [SUITE, "--json"], {
      cwd: path.join(REPO, "tests"),
      encoding: "utf8",
      timeout: 600000,
      maxBuffer: 32 * 1024 * 1024,
    });
    let coreParsed = null;
    let coreJsonOk = false;
    try {
      coreParsed = JSON.parse(String(coreRun.stdout || "").trim());
      coreJsonOk = true;
    } catch (error) {
      coreJsonOk = false;
    }
    const results = Array.isArray(coreParsed?.results) ? coreParsed.results : [];
    const allChecks = results.flatMap((r) => (Array.isArray(r.checks) ? r.checks : []));
    subs.push(sub("core-suite",
      coreRun.status === 0 && coreJsonOk && results.length === 18 && allChecks.length === 206
      && results.every((r) => r.pass === true) && allChecks.every((c) => c.pass === true),
      `exit=${coreRun.status} scenarios=${results.length} checks=${allChecks.length} badScenarios=${JSON.stringify(results.filter((r) => !r.pass).map((r) => r.id))} badChecks=${JSON.stringify(allChecks.filter((c) => !c.pass).map((c) => c.id).slice(0, 10))}`));

    const runSource = fs.readFileSync(VOICE_RUN, "utf8");
    const hasTarget = runSource.includes("九十五");
    const badNeedle = "结果" + " " + "九十五";
    subs.push(sub("source-text", hasTarget && !runSource.includes(badNeedle),
      `hasNineFive=${hasTarget} hasBadNeedle=${runSource.includes(badNeedle)}`));

    const reread = h1First18;
    subs.push(sub("reread-18.7", reread === "18.7", `h1-first-result=${JSON.stringify(reread)}`));

    const pass = subs.every((s) => s.pass);
    return { pass, detail: subs.map((s) => `${s.name}=${s.pass ? "ok" : "BAD"}(${s.detail})`).join(" | ") };
  } catch (error) {
    return { pass: false, detail: `crash: ${String(error && error.message ? error.message : error)}` };
  }
}

async function main() {
  const lines = [];
  const fails = [];
  let browser = null;
  let server = null;
  try {
    browser = await chromium.launch({ headless: true });
    server = await startServer(ARTIFACT);

    const h1 = await checkH1(browser, server.url);
    lines.push({ id: "H1", pass: h1.pass, detail: h1.detail });

    const h2 = await checkH2(browser, server.url);
    lines.push({ id: "H2", pass: h2.pass, detail: h2.detail });

    const h3 = await checkH3(browser, server.url);
    lines.push({ id: "H3", pass: h3.pass, detail: h3.detail });

    const h4 = await checkH4(browser, server.url);
    lines.push({ id: "H4", pass: h4.pass, detail: h4.detail });

    const h5 = await checkH5(h1.first18 ?? null);
    lines.push({ id: "H5", pass: h5.pass, detail: h5.detail });

    if (h1.app) {
      try {
        await h1.app.close();
      } catch { /* ignore */ }
    }
  } catch (error) {
    lines.push({ id: "H1", pass: false, detail: `infra-crash: ${String(error && error.stack ? error.stack : error).slice(0, 500)}` });
  } finally {
    if (server) {
      try {
        await server.close();
      } catch { /* ignore */ }
    }
    if (browser) {
      try {
        await browser.close();
      } catch { /* ignore */ }
    }
  }
  for (const line of lines) {
    if (!line.pass) fails.push(line.id);
  }
  const artifactSha = sha256File(ARTIFACT);
  const verifierSha = sha256File(fileURLToPath(import.meta.url));
  const out = [];
  out.push(`ROUND: ${ROUND}`);
  out.push(`ARTIFACT_SHA256: ${artifactSha}`);
  out.push(`VERIFIER_SHA256: ${verifierSha}`);
  for (const line of lines) {
    out.push(`${line.id} ${line.pass ? "PASS" : "FAIL"} — ${line.detail}`);
  }
  out.push(fails.length === 0 ? "HARD: PASS" : `HARD: FAIL (${fails.join(",")})`);
  const text = out.join("\n") + "\n";
  fs.writeFileSync(path.join(OUT_DIR, `hard-r${ROUND}.txt`), text, "utf8");
  process.stdout.write(text);
}

main().catch((error) => {
  process.stderr.write(`verify.mjs crashed: ${String(error && error.stack ? error.stack : error)}\n`);
  process.exit(2);
});
