#!/usr/bin/env node
// Resident fake-engine acceptance suite for the calculator's voice announcements.
//
//   node tests/voice/run.mjs [--json] [--artifact <path>] [--real] [--help]
//
// The suite starts its own local HTTP server, so it never depends on file://,
// public network access, /ws/voice, or the 96MB model files. Fake mode injects
// the engine contract from the parent gate before the app's inline script runs.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadPlaywright } from "../lib/browser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const DEFAULT_ARTIFACT = path.join(REPO, "index.html");
const SETTINGS_KEY = "cal-phone.settings.v1";
const FAKE_DURATION_MS = 400;

const VOICE_SCRIPT_STUB = `window.SherpaOnnx = async () => ({FS:{mkdirTree(){}, FS_createDataFile(){}, writeFile(){}}});\nwindow.createOfflineTts = () => ({handle:1, generate:() => ({samples:new Float32Array(8), sampleRate:22050})});\n`;

function parseArgs(argv) {
  const options = { artifact: DEFAULT_ARTIFACT, json: false, real: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--artifact") {
      const value = argv[++index];
      if (!value) throw new Error("--artifact requires a path");
      options.artifact = path.resolve(value);
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--real") {
      options.real = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return options;
}

function usage() {
  return [
    "usage: node tests/voice/run.mjs [--json] [--artifact <path>] [--real] [--help]",
    "",
    "  --json              print only one JSON object on stdout",
    "  --artifact <path>   test another HTML file (default: index.html)",
    "  --real              real-engine smoke; requires VOICE_REAL=1 and installed voice/ assets",
    "  --help              show this help",
    "",
    "Fake mode is self-contained: local HTTP server + fake engine + placeholder voice/** files.",
    "Real mode waits for data-voice-state=ready; it never runs unless VOICE_REAL=1 is set.",
  ].join("\n");
}

function record(checks, id, pass, detail = "") {
  checks.push({ id, pass: Boolean(pass), detail: String(detail) });
  return Boolean(pass);
}

function format(value) {
  if (typeof value === "string") return JSON.stringify(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function eq(checks, id, actual, expected, detail = "") {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  return record(
    checks,
    id,
    pass,
    pass ? format(actual) : `expected ${format(expected)}, got ${format(actual)}${detail ? ` — ${detail}` : ""}`,
  );
}

function clean(checks, id, pageErrors, consoleErrors) {
  return record(
    checks,
    id,
    pageErrors.length === 0 && consoleErrors.length === 0,
    `pageerrors=${pageErrors.length}, consoleErrors=${consoleErrors.length}` +
      (pageErrors.length ? ` — ${pageErrors.join(" | ")}` : "") +
      (consoleErrors.length ? ` — ${consoleErrors.join(" | ")}` : ""),
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function contentTypeFor(file) {
  switch (path.extname(file).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".mjs": return "text/javascript; charset=utf-8";
    case ".wasm": return "application/wasm";
    case ".txt": return "text/plain; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".png": return "image/png";
    case ".css": return "text/css; charset=utf-8";
    default: return "application/octet-stream";
  }
}

async function startStaticServer({ artifact, real = false }) {
  const server = http.createServer((request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
    } catch {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("bad request");
      return;
    }

    if (pathname.startsWith("/voice/")) {
      const relative = pathname.slice("/voice/".length);
      if (!real) {
        const isScript = relative === "sherpa-onnx-wasm-web.js" || relative === "sherpa-onnx-tts.js";
        const body = isScript ? Buffer.from(VOICE_SCRIPT_STUB) : Buffer.alloc(2048, 0x5a);
        response.writeHead(200, {
          "Content-Type": isScript ? "text/javascript; charset=utf-8" : contentTypeFor(relative),
          "Content-Length": body.length,
          "Cache-Control": "no-store",
        });
        response.end(body);
        return;
      }

      const voiceFile = path.resolve(REPO, "voice", relative);
      const voiceRoot = path.resolve(REPO, "voice");
      if (voiceFile !== voiceRoot && !voiceFile.startsWith(voiceRoot + path.sep)) {
        response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("forbidden");
        return;
      }
      let voiceStat;
      try {
        voiceStat = fs.statSync(voiceFile);
      } catch {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("not found");
        return;
      }
      if (!voiceStat.isFile()) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("not found");
        return;
      }
      response.writeHead(200, {
        "Content-Type": contentTypeFor(voiceFile),
        "Content-Length": voiceStat.size,
        "Cache-Control": "no-store",
      });
      fs.createReadStream(voiceFile).pipe(response);
      return;
    }

    if (pathname === "/" || pathname === "/index.html") {
      let stat;
      try {
        stat = fs.statSync(artifact);
      } catch {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("artifact not found");
        return;
      }
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": stat.size,
        "Cache-Control": "no-store",
      });
      fs.createReadStream(artifact).pipe(response);
      return;
    }

    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("not found");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  return {
    origin: `http://127.0.0.1:${port}`,
    url: `http://127.0.0.1:${port}/index.html`,
    async close() {
      if (typeof server.closeAllConnections === "function") server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function openPage(browser, target, {
  storage,
  fake = true,
  fakeFail = false,
  durationMs = FAKE_DURATION_MS,
  viewport = { width: 390, height: 844 },
  beforeGoto,
} = {}) {
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
  await context.addInitScript(({ stored, includeFake, fail, duration }) => {
    if (stored !== null) {
      try {
        localStorage.setItem("cal-phone.settings.v1", stored);
      } catch {
        /* file:// or a locked-down context may not expose storage. */
      }
    }
    if (!includeFake) return;

    window.__voiceFake = { fail: Boolean(fail), durationMs: Number(duration), generated: [] };
    window.SherpaOnnx = async () => ({ FS: { mkdirTree() {}, FS_createDataFile() {}, writeFile() {} } });
    window.createOfflineTts = () => {
      if (window.__voiceFake.fail) throw new Error("fake init failure");
      return {
        handle: 1,
        sampleRate: 22050,
        generate({ text }) {
          window.__voiceFake.generated.push(String(text));
          const count = Math.round(22050 * window.__voiceFake.durationMs / 1000);
          const samples = new Float32Array(Math.max(1, count));
          for (let index = 0; index < samples.length; index += 1) samples[index] = Math.sin(index / 20) * 0.05;
          return { samples, sampleRate: 22050 };
        },
      };
    };
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
  }, {
    // 结果后暂停输入 (resultPause, default 2 s) is a scoring feature with its own
    // coverage in tests/suite.mjs > settings-pause. These scenarios speak about
    // speech, and several of them type a digit right after "=" to prove a result
    // is dropped when the teacher keeps going; the pause would swallow that
    // digit and make the assertion vacuous. Disable it wherever a caller seeds
    // settings, and leave the default alone for the unseeded contexts that assert
    // the pristine settings state.
    stored: storage === undefined ? null : JSON.stringify({ resultPause: 0, ...storage }),
    includeFake: fake,
    fail: fakeFail,
    duration: durationMs,
  });

  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  const pageErrors = [];
  const consoleErrors = [];
  const requests = [];
  page.on("pageerror", (error) => pageErrors.push(String(error && error.message ? error.message : error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("request", (request) => requests.push(request.url()));

  try {
    if (beforeGoto) await beforeGoto({ context, page });
    await page.goto(target, { waitUntil: "load" });
    await page.waitForSelector("main.app");
  } catch (error) {
    await context.close();
    throw error;
  }

  return {
    context,
    page,
    pageErrors,
    consoleErrors,
    requests,
    async close() {
      await context.close();
    },
  };
}

async function openHttp(browser, server, options = {}) {
  return openPage(browser, server.url, options);
}

async function openFile(browser, artifact, options = {}) {
  return openPage(browser, pathToFileURL(artifact).href, { ...options, fake: false });
}

async function waitVoice(page, states, timeout = 20000) {
  const wanted = Array.isArray(states) ? states : [states];
  await page.waitForFunction(
    (allowed) => allowed.includes(document.querySelector("main.app")?.dataset.voiceState || ""),
    wanted,
    { timeout, polling: 50 },
  );
}

async function waitResult(page, text, timeout = 5000) {
  await page.waitForFunction(
    (expected) => (document.querySelector('[data-testid="result"]')?.textContent || "").trim() === expected,
    text,
    { timeout, polling: 25 },
  );
  return page.$eval('[data-testid="result"]', (element) => (element.textContent || "").trim());
}

async function resultText(page) {
  return page.$eval('[data-testid="result"]', (element) => (element.textContent || "").trim());
}

async function openSettings(page) {
  await page.click('[data-testid="settings-toggle"]');
  await page.waitForSelector('[data-testid="settings-panel"]', { state: "visible" });
}

async function closeSettings(page) {
  await page.click('[data-testid="settings-done"]');
  await page.waitForSelector('[data-testid="settings-panel"]', { state: "hidden" });
}

async function scrollVoiceGroup(page) {
  await page.$eval('[data-testid="settings-voice-group"]', (element) => element.scrollIntoView({ block: "center" }));
  await sleep(100);
}

async function clickToken(page, token) {
  if (token === "=" || token === "equals") {
    await page.click('[data-testid="key-equals"]');
  } else if (["+", "-", "*", "/"].includes(token)) {
    await page.click(`[data-op="${token}"]`);
  } else {
    await page.click(`[data-key="${token}"]`);
  }
}

async function clickSequence(page, tokens) {
  for (const token of tokens) await clickToken(page, token);
}

async function readSpeech(page) {
  return page.evaluate(() => {
    const element = document.querySelector("main.app") || document.body;
    let log = [];
    try {
      log = JSON.parse(element.dataset.speechLog || "[]");
    } catch {
      log = [];
    }
    return {
      log,
      texts: log.map((entry) => entry.text),
      kinds: log.map((entry) => entry.kind),
      count: element.dataset.speechCount || "",
      last: element.dataset.speechLast || "",
      kind: element.dataset.speechKind || "",
      lastMs: Number(element.dataset.speechLastMs || 0),
    };
  });
}

async function readPlayed(page) {
  return page.evaluate(() => {
    const element = document.querySelector("main.app") || document.body;
    try {
      return JSON.parse(element.dataset.speechPlayed || "[]");
    } catch {
      return [];
    }
  });
}

async function waitPlayed(page, minimum, timeout = 5000) {
  const started = Date.now();
  let played = [];
  while (Date.now() - started < timeout) {
    played = await readPlayed(page);
    if (played.length >= minimum) return played;
    await sleep(75);
  }
  return played;
}

async function testSettings(browser, server) {
  const checks = [];
  const app = await openHttp(browser, server);
  try {
    const { page } = app;
    await openSettings(page);
    const initial = await page.evaluate((key) => ({
      keys: document.querySelector('[data-testid="settings-voice-keys"]')?.checked ?? null,
      result: document.querySelector('[data-testid="settings-voice-result"]')?.checked ?? null,
      stored: localStorage.getItem(key),
      summaryHidden: document.querySelector('[data-testid="settings-summary"]')?.hidden ?? null,
    }), SETTINGS_KEY);
    eq(checks, "settings.defaults-off", [initial.keys, initial.result, initial.summaryHidden], [false, false, true]);

    await page.check('[data-testid="settings-voice-keys"]');
    await page.check('[data-testid="settings-voice-result"]');
    await waitVoice(page, "ready");
    const storedOn = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), SETTINGS_KEY);
    eq(checks, "settings.storage-on", [storedOn?.voiceKeys, storedOn?.voiceResult], [true, true]);

    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("main.app");
    await waitVoice(page, "ready");
    const reloaded = await page.evaluate(() => ({
      keys: document.querySelector('[data-testid="settings-voice-keys"]')?.checked ?? null,
      result: document.querySelector('[data-testid="settings-voice-result"]')?.checked ?? null,
      summaryVisible: !document.querySelector('[data-testid="settings-summary"]')?.hidden,
      indicatorVisible: !document.querySelector('[data-testid="settings-indicator"]')?.hidden,
    }));
    eq(checks, "settings.reload-on", [reloaded.keys, reloaded.result], [true, true]);
    eq(checks, "settings.reload-summary", [reloaded.summaryVisible, reloaded.indicatorVisible], [true, true]);

    await openSettings(page);
    await scrollVoiceGroup(page);
    await page.uncheck('[data-testid="settings-voice-keys"]');
    await page.uncheck('[data-testid="settings-voice-result"]');
    const storedOff = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), SETTINGS_KEY);
    const summaryHidden = await page.evaluate(() => document.querySelector('[data-testid="settings-summary"]')?.hidden ?? null);
    eq(checks, "settings.storage-off", [storedOff?.voiceKeys, storedOff?.voiceResult], [false, false]);
    eq(checks, "settings.off-summary", summaryHidden, true);

    await closeSettings(page);
    await clickSequence(page, ["1", "+", "2", "="]);
    eq(checks, "settings.compute-still-works", await waitResult(page, "3"), "3");
    clean(checks, "settings.clean", app.pageErrors, app.consoleErrors);
  } finally {
    await app.close();
  }
  return checks;
}

async function testFileMode(browser, artifact) {
  const checks = [];
  const app = await openFile(browser, artifact);
  try {
    const { page } = app;
    await openSettings(page);
    const state = await page.evaluate(() => ({
      keysDisabled: document.querySelector('[data-testid="settings-voice-keys"]')?.disabled ?? null,
      resultDisabled: document.querySelector('[data-testid="settings-voice-result"]')?.disabled ?? null,
      hint: (document.querySelector('[data-testid="voice-hint"]')?.textContent || "").trim(),
      voiceState: document.querySelector("main.app")?.dataset.voiceState || "",
    }));
    eq(checks, "file.toggles-disabled", [state.keysDisabled, state.resultDisabled], [true, true]);
    record(checks, "file.hint-web-address", /http/i.test(state.hint) || state.hint.includes("网页地址"), state.hint);
    eq(checks, "file.voice-idle", state.voiceState, "idle");
    const voiceRequests = app.requests.filter((url) => url.includes("/voice/"));
    eq(checks, "file.zero-voice-requests", voiceRequests.length, 0, voiceRequests.join(", "));

    await closeSettings(page);
    await clickSequence(page, ["1", "+", "2", "="]);
    eq(checks, "file.compute-still-works", await waitResult(page, "3"), "3");
    clean(checks, "file.clean", app.pageErrors, app.consoleErrors);
  } finally {
    await app.close();
  }
  return checks;
}

async function testKeys(browser, server) {
  const checks = [];
  const app = await openHttp(browser, server, { storage: { voiceKeys: true, voiceResult: false } });
  let keyboardApp;
  let autoApp;
  try {
    const { page } = app;
    await waitVoice(page, "ready");
    await clickSequence(page, ["9", "5", ".", ".", "backspace", "enter", "enter", "backspace", "backspace", "+", "-", "*", "/", "="]);
    await sleep(150);
    const speech = await readSpeech(page);
    eq(checks, "keys.sequence", speech.texts, ["九", "五", "点", "退格", "退格", "加", "减", "乘", "除"]);
    eq(checks, "keys.count", speech.count, "9");
    eq(checks, "keys.last", [speech.last, speech.kind], ["除", "key"]);
    eq(checks, "keys.repeat-dot-suppressed", speech.texts.filter((text) => text === "点").length, 1);
    eq(checks, "keys.empty-confirm-suppressed", speech.texts.filter((text) => text === "确认").length, 0);
    eq(checks, "keys.empty-backspace-stops", speech.texts.filter((text) => text === "退格").length, 2);
    clean(checks, "keys.clean", app.pageErrors, app.consoleErrors);

    keyboardApp = await openHttp(browser, server, { storage: { voiceKeys: true, voiceResult: false } });
    await waitVoice(keyboardApp.page, "ready");
    for (const key of ["7", "Backspace", "8", "Enter"]) await keyboardApp.page.keyboard.press(key);
    await sleep(150);
    const keyboardSpeech = await readSpeech(keyboardApp.page);
    eq(checks, "keys.physical-keyboard", keyboardSpeech.texts, ["七", "退格", "八"]);
    clean(checks, "keys.keyboard-clean", keyboardApp.pageErrors, keyboardApp.consoleErrors);

    autoApp = await openHttp(browser, server, { storage: { autoConfirm: 0.2, voiceKeys: true, voiceResult: false } });
    await waitVoice(autoApp.page, "ready");
    await autoApp.page.click('[data-key="6"]');
    await sleep(550);
    const autoSpeech = await readSpeech(autoApp.page);
    eq(checks, "keys.auto-confirm", autoSpeech.texts, ["六"]);
    clean(checks, "keys.auto-clean", autoApp.pageErrors, autoApp.consoleErrors);
  } finally {
    await app.close();
    if (keyboardApp) await keyboardApp.close();
    if (autoApp) await autoApp.close();
  }
  return checks;
}

async function testResults(browser, server) {
  const checks = [];
  const app = await openHttp(browser, server, { storage: { voiceKeys: false, voiceResult: true } });
  let fresh;
  try {
    const { page } = app;
    await waitVoice(page, "ready");
    await clickSequence(page, ["9", ".", "5", "+", "9", ".", "2", "="]);
    const decimalResult = await waitResult(page, "18.7");
    const decimalSpeech = await readSpeech(page);
    eq(checks, "result.decimal", [decimalResult, decimalSpeech.last, decimalSpeech.kind], ["18.7", "十八点七", "result"]);

    await clickSequence(page, ["2", "-", "5", "="]);
    const negativeResult = await waitResult(page, "-3");
    const negativeSpeech = await readSpeech(page);
    eq(checks, "result.negative", [negativeResult, negativeSpeech.last], ["-3", "负三"]);

    await clickSequence(page, ["1", "/", "0", "="]);
    const zeroResult = await waitResult(page, "不能除以零");
    const zeroSpeech = await readSpeech(page);
    eq(checks, "result.divide-zero", [zeroResult, zeroSpeech.last], ["不能除以零", "不能除以零"]);

    await openSettings(page);
    await scrollVoiceGroup(page);
    await page.fill('[data-testid="settings-auto-equals"]', "2");
    await closeSettings(page);
    await clickSequence(page, ["3", "+", "4", "enter"]);
    const autoResult = await waitResult(page, "7");
    const autoSpeech = await readSpeech(page);
    eq(checks, "result.auto-equals", [autoResult, autoSpeech.last], ["7", "七"]);
    clean(checks, "result.clean", app.pageErrors, app.consoleErrors);

    fresh = await openHttp(browser, server, { storage: { voiceKeys: false, voiceResult: true } });
    await waitVoice(fresh.page, "ready");
    await clickSequence(fresh.page, ["7", "+", "8", "="]);
    const freshResult = await waitResult(fresh.page, "15");
    const freshSpeech = await readSpeech(fresh.page);
    eq(checks, "result.direct-equals", freshResult, "15");
    eq(checks, "result.direct-no-confirm", freshSpeech.texts.includes("确认"), false, freshSpeech.texts.join(","));
    eq(checks, "result.direct-last-entry", freshSpeech.log.at(-1)?.text, "十五");
    eq(checks, "result.kinds-only-result", [...new Set(freshSpeech.kinds)], ["result"]);
    clean(checks, "result.fresh-clean", fresh.pageErrors, fresh.consoleErrors);
  } finally {
    await app.close();
    if (fresh) await fresh.close();
  }
  return checks;
}

async function testIndependence(browser, server) {
  const checks = [];
  const resultOnly = await openHttp(browser, server, { storage: { voiceKeys: false, voiceResult: true } });
  const keysOnly = await openHttp(browser, server, { storage: { voiceKeys: true, voiceResult: false } });
  const bothOff = await openHttp(browser, server);
  try {
    await waitVoice(resultOnly.page, "ready");
    await clickSequence(resultOnly.page, ["1", "+", "2", "="]);
    const resultValue = await waitResult(resultOnly.page, "3");
    const resultSpeech = await readSpeech(resultOnly.page);
    eq(checks, "independence.result-only-kinds", [...new Set(resultSpeech.kinds)], ["result"]);
    eq(checks, "independence.result-only-last", resultSpeech.last, "三");
    eq(checks, "independence.result-only-compute", resultValue, "3");

    await waitVoice(keysOnly.page, "ready");
    await clickSequence(keysOnly.page, ["1", "+", "2", "="]);
    const keysValue = await waitResult(keysOnly.page, "3");
    const keysSpeech = await readSpeech(keysOnly.page);
    eq(checks, "independence.keys-only-texts", keysSpeech.texts, ["一", "加", "二"]);
    eq(checks, "independence.keys-only-kinds", [...new Set(keysSpeech.kinds)], ["key"]);
    eq(checks, "independence.keys-only-compute", keysValue, "3");

    await clickSequence(bothOff.page, ["1", "+", "2", "="]);
    await waitResult(bothOff.page, "3");
    const offSpeech = await readSpeech(bothOff.page);
    record(checks, "independence.both-off-silent", offSpeech.count === "0" || offSpeech.count === "", offSpeech.count);
    clean(checks, "independence.result-clean", resultOnly.pageErrors, resultOnly.consoleErrors);
    clean(checks, "independence.keys-clean", keysOnly.pageErrors, keysOnly.consoleErrors);
  } finally {
    await resultOnly.close();
    await keysOnly.close();
    await bothOff.close();
  }
  return checks;
}

async function testQueue(browser, server) {
  const checks = [];
  const serial = await openHttp(browser, server, { storage: { voiceKeys: true, voiceResult: false } });
  const quick = await openHttp(browser, server, { storage: { voiceKeys: true, voiceResult: true } });
  const cancel = await openHttp(browser, server, { storage: { voiceKeys: true, voiceResult: false } });
  try {
    await waitVoice(serial.page, "ready");
    await clickSequence(serial.page, ["1", "2", "3"]);
    const serialPlayed = await waitPlayed(serial.page, 3);
    const serialSpeech = await readSpeech(serial.page);
    eq(checks, "queue.serial-log", serialSpeech.texts, ["一", "二", "三"]);
    eq(checks, "queue.serial-played", serialPlayed.map((entry) => entry.text), ["一", "二", "三"]);
    clean(checks, "queue.serial-clean", serial.pageErrors, serial.consoleErrors);

    await waitVoice(quick.page, "ready");
    const firstClick = Date.now();
    await clickSequence(quick.page, ["1", "+", "1", "=", "9"]);
    const span = Date.now() - firstClick;
    const quickPlayed = await waitPlayed(quick.page, 4, 3000);
    await sleep(Math.max(0, FAKE_DURATION_MS * 2));
    const quickFinal = await readPlayed(quick.page);
    record(checks, "queue.quick-clicks-fast", span < 1500, `${span}ms`);
    eq(checks, "queue.quick-no-result", quickFinal.some((entry) => entry.kind === "result"), false);
    eq(
      checks,
      "queue.quick-keys",
      quickFinal.filter((entry) => entry.kind === "key").map((entry) => entry.text),
      ["一", "加", "一", "九"],
      `first poll=${quickPlayed.length}`,
    );
    clean(checks, "queue.quick-clean", quick.pageErrors, quick.consoleErrors);

    await waitVoice(cancel.page, "ready");
    await clickSequence(cancel.page, ["1", "2", "3", "4", "5"]);
    await openSettings(cancel.page);
    await scrollVoiceGroup(cancel.page);
    await cancel.page.uncheck('[data-testid="settings-voice-keys"]');
    await sleep(FAKE_DURATION_MS * 4);
    const cancelled = await readPlayed(cancel.page);
    const cancelledTexts = cancelled.map((entry) => entry.text);
    eq(checks, "queue.disable-cancels-late", ["三", "四", "五"].some((text) => cancelledTexts.includes(text)), false, cancelledTexts.join(","));
    record(checks, "queue.disable-cancels-cap", cancelled.length <= 2, String(cancelled.length));
    clean(checks, "queue.cancel-clean", cancel.pageErrors, cancel.consoleErrors);
  } finally {
    await serial.close();
    await quick.close();
    await cancel.close();
  }
  return checks;
}

async function measureVoiceLayout(page) {
  return page.evaluate(() => {
    const query = (selector) => document.querySelector(selector);
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      return !element.hidden
        && style.display !== "none"
        && style.visibility !== "hidden"
        && style.opacity !== "0"
        && element.getClientRects().length > 0;
    };
    const rect = (element) => {
      if (!element) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
      const value = element.getBoundingClientRect();
      return {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      };
    };
    const inViewport = (value) => value.width > 0
      && value.height > 0
      && value.left >= -0.5
      && value.top >= -0.5
      && value.right <= innerWidth + 0.5
      && value.bottom <= innerHeight + 0.5;
    const overlaps = (a, b) => a.width > 0
      && a.height > 0
      && b.width > 0
      && b.height > 0
      && a.left < b.right
      && a.right > b.left
      && a.top < b.bottom
      && a.bottom > b.top;

    const panel = query('[data-testid="settings-panel"]');
    const keys = query('[data-testid="settings-voice-keys"]');
    const result = query('[data-testid="settings-voice-result"]');
    const status = query('[data-testid="voice-status"]');
    const progress = query('[data-testid="voice-progress"]');
    const hint = query('[data-testid="voice-hint"]');
    const retry = query('[data-testid="voice-retry"]');
    const summary = query('[data-testid="settings-summary"]');
    const gear = query('[data-testid="settings-toggle"]');
    const controls = {
      keysRow: rect(keys?.parentElement),
      resultRow: rect(result?.parentElement),
      keys: rect(keys),
      result: rect(result),
      status: rect(status),
      progress: rect(progress),
      hint: rect(hint),
      retry: rect(retry),
      summary: rect(summary),
      gear: rect(gear),
    };
    const visibility = {
      panelOpen: Boolean(panel?.open),
      keys: visible(keys),
      result: visible(result),
      status: visible(status),
      progress: visible(progress),
      hint: visible(hint),
      retry: visible(retry),
      summary: visible(summary),
      gear: visible(gear),
    };
    return {
      innerWidth,
      innerHeight,
      docScrollWidth: document.documentElement.scrollWidth,
      panelScrollWidth: panel?.scrollWidth || 0,
      panelClientWidth: panel?.clientWidth || 0,
      visibility,
      controls,
      inView: Object.fromEntries(Object.entries(controls).map(([key, value]) => [key, inViewport(value)])),
      summaryGearOverlap: overlaps(controls.summary, controls.gear),
    };
  });
}

async function testLayout(browser, server) {
  const checks = [];
  async function measure(width) {
    let cdp = null;
    let app;
    try {
      app = await openHttp(browser, server, {
        storage: { voiceKeys: true, voiceResult: false },
        fakeFail: true,
        beforeGoto: width === 320
          ? async ({ context, page }) => {
            cdp = await context.newCDPSession(page);
            await cdp.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 3, mobile: true });
          }
          : undefined,
      });
      if (width === 320) await app.page.waitForFunction(() => window.innerWidth === 320, null, { timeout: 5000 });
      await waitVoice(app.page, "error");
      await openSettings(app.page);
      await scrollVoiceGroup(app.page);
      await sleep(150);
      return { metrics: await measureVoiceLayout(app.page), app };
    } catch (error) {
      if (app) await app.close();
      throw error;
    } finally {
      if (cdp) await cdp.detach().catch(() => {});
    }
  }

  for (const width of [320, 390]) {
    const { metrics, app } = await measure(width);
    try {
      const prefix = `layout.${width}`;
      eq(checks, `${prefix}.width`, metrics.innerWidth, width);
      record(checks, `${prefix}.document-no-overflow`, metrics.docScrollWidth <= metrics.innerWidth, `${metrics.docScrollWidth}<=${metrics.innerWidth}`);
      record(checks, `${prefix}.panel-no-overflow`, metrics.panelScrollWidth <= metrics.panelClientWidth, `${metrics.panelScrollWidth}<=${metrics.panelClientWidth}`);
      record(
        checks,
        `${prefix}.voice-visible`,
        ["keys", "result", "status", "progress", "hint", "retry"].every((name) => metrics.visibility[name]),
        JSON.stringify(metrics.visibility),
      );
      record(
        checks,
        `${prefix}.voice-in-viewport`,
        ["status", "progress", "hint", "retry"].every((name) => metrics.inView[name]),
        JSON.stringify(metrics.inView),
      );
      record(
        checks,
        `${prefix}.voice-control-size`,
        metrics.controls.retry.width >= 44 && metrics.controls.retry.height >= 44
          && metrics.controls.keysRow.height >= 44 && metrics.controls.resultRow.height >= 44,
        JSON.stringify({ retry: metrics.controls.retry, keysRow: metrics.controls.keysRow, resultRow: metrics.controls.resultRow }),
      );
      record(
        checks,
        `${prefix}.summary-gear`,
        metrics.visibility.summary && metrics.visibility.gear && !metrics.summaryGearOverlap,
        JSON.stringify({ summary: metrics.visibility.summary, gear: metrics.visibility.gear, overlap: metrics.summaryGearOverlap }),
      );
      clean(checks, `${prefix}.clean`, app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
  }
  return checks;
}

function testRegression() {
  const checks = [];
  const started = Date.now();
  const run = spawnSync("node", ["suite.mjs", "--json"], {
    cwd: path.join(REPO, "tests"),
    encoding: "utf8",
    timeout: 600000,
    maxBuffer: 20 * 1024 * 1024,
  });
  let parsed = null;
  try {
    parsed = JSON.parse(String(run.stdout || "").trim());
  } catch (error) {
    record(checks, "regression.json", false, `${error.message}; stderr=${String(run.stderr || "").slice(0, 500)}`);
  }
  const results = Array.isArray(parsed?.results) ? parsed.results : [];
  const scenarioChecks = results.flatMap((result) => (Array.isArray(result.checks) ? result.checks : []));
  eq(checks, "regression.suite-exit", run.status, 0, String(run.stderr || "").slice(0, 500));
  eq(checks, "regression.scenarios", results.length, 45);
  eq(checks, "regression.checks", scenarioChecks.length, 766);
  eq(
    checks,
    "regression.every-scenario-pass",
    results.length > 0 && results.every((result) => result.pass === true),
    true,
    results.filter((result) => !result.pass).map((result) => result.id).join(","),
  );
  record(checks, "regression.runtime", Date.now() - started < 600000, `${Date.now() - started}ms`);
  return checks;
}

async function runFakeSuite(browser, artifact) {
  const server = await startStaticServer({ artifact, real: false });
  const checks = [];
  const steps = [
    ["settings", () => testSettings(browser, server)],
    ["file", () => testFileMode(browser, artifact)],
    ["keys", () => testKeys(browser, server)],
    ["result", () => testResults(browser, server)],
    ["independence", () => testIndependence(browser, server)],
    ["queue", () => testQueue(browser, server)],
    ["layout", () => testLayout(browser, server)],
    ["regression", () => testRegression()],
  ];
  try {
    for (const [prefix, step] of steps) {
      const started = Date.now();
      try {
        const found = await step();
        checks.push(...found);
        console.error(`[voice] ${prefix}: ${found.filter((item) => item.pass).length}/${found.length} passed (${Date.now() - started}ms)`);
      } catch (error) {
        checks.push({ id: `${prefix}.crash`, pass: false, detail: String(error && error.stack ? error.stack : error).replace(/\s+/g, " ").slice(0, 1000) });
        console.error(`[voice] ${prefix}: crashed — ${error && error.message ? error.message : error}`);
      }
    }
  } finally {
    await server.close();
  }
  return checks;
}

async function runRealSuite(browser, artifact) {
  const checks = [];
  const server = await startStaticServer({ artifact, real: true });
  let app;
  try {
    app = await openHttp(browser, server, { storage: { voiceKeys: true, voiceResult: true }, fake: false });
    await waitVoice(app.page, "ready", 240000);
    record(checks, "real.ready", true, "data-voice-state=ready");
    await clickSequence(app.page, ["9", "5", "+", "="]);
    await app.page.waitForFunction(
      () => (document.querySelector("main.app")?.dataset.speechPlayed || "").includes("九十五"),
      null,
      { timeout: 120000, polling: 100 },
    );
    const speech = await readSpeech(app.page);
    const played = await readPlayed(app.page);
    const texts = played.map((entry) => entry.text);
    record(checks, "real.played-nine", texts.includes("九"), texts.join(","));
    record(checks, "real.played-five", texts.includes("五"), texts.join(","));
    record(checks, "real.played-result", texts.includes("九十五"), texts.join(","));
    record(checks, "real.last-ms", speech.lastMs > 100, String(speech.lastMs));
    clean(checks, "real.clean", app.pageErrors, app.consoleErrors);
  } finally {
    if (app) await app.close();
    await server.close();
  }
  return checks;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exit(2);
  }

  if (options.help) {
    console.log(usage());
    process.exit(0);
  }
  if (options.real && process.env.VOICE_REAL !== "1") {
    console.error("error: --real requires VOICE_REAL=1 (explicit real-model smoke opt-in)");
    console.error("rerun with: VOICE_REAL=1 node tests/voice/run.mjs --real");
    process.exit(2);
  }
  if (!fs.existsSync(options.artifact)) {
    console.error(`error: artifact not found: ${options.artifact}`);
    process.exit(2);
  }

  const { chromium } = loadPlaywright();
  let browser;
  let checks = [];
  try {
    browser = await chromium.launch({ headless: true });
    checks = options.real
      ? await runRealSuite(browser, options.artifact)
      : await runFakeSuite(browser, options.artifact);
  } catch (error) {
    checks.push({ id: "regression.infrastructure", pass: false, detail: String(error && error.stack ? error.stack : error) });
  } finally {
    if (browser) await browser.close();
  }

  const failed = checks.filter((item) => !item.pass);
  for (const item of failed) console.error(`FAIL ${item.id} — ${item.detail}`);
  if (options.json) {
    process.stdout.write(JSON.stringify({ checks, passed: checks.length - failed.length, failed: failed.length }));
  } else {
    console.log(`voice artifact: ${options.artifact}`);
    console.log(`voice checks: ${checks.length} passed=${checks.length - failed.length} failed=${failed.length}`);
    console.log(failed.length === 0 ? "VOICE: PASS" : "VOICE: FAIL");
  }
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(2);
});
