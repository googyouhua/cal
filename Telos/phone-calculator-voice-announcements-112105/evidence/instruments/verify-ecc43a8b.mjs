#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = "/ws/cal_phone";
const TESTS_DIR = path.join(REPO, "tests");
const ARTIFACT = path.resolve(process.env.KEKKAI_ARTIFACT || path.join(REPO, "index.html"));
const OUT_DIR = path.resolve(process.env.KEKKAI_OUT_DIR || HERE);
const ROUND = String(process.argv[2] || process.env.KEKKAI_ROUND || "1");
const REVIEW_STATES = String(process.env.KEKKAI_EXPECTED_REVIEW_STATES || "S1,S2,S3")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value && value.toLowerCase() !== "none");
const SETTINGS_KEY = "cal-phone.settings.v1";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const EXPECTED_ASSETS = [
  ["voice/sherpa-onnx-wasm-web.js", "e7ca68efeb8fa4f1bf7768827f468a31a25f1878209d24a3e08fe7bfcbba5cb5"],
  ["voice/sherpa-onnx-wasm-web.wasm", "c655dbdc9ed486004a040936e50aca6d0ada4bdbd3e188e7155f8fd8544cd21a"],
  ["voice/sherpa-onnx-tts.js", "b9cb4782010b22d64be31298a3e407170d2b8f5def471ea6011c42a921577e8f"],
  ["voice/sherpa-tts/matcha-zh-baker.onnx", "47e82b11454edeeb65adc4e44a24fd54c6715cd4d875cc2a20f75545ecc32d4d"],
  ["voice/sherpa-tts/hifigan_v2.onnx", "a41d404cce7924493540238da5b30a4bc14b6ddaf1a37f3c79fa4f59548c19f0"],
  ["voice/sherpa-tts/lexicon.txt", "38b886d46aefa50da6322a64d72fd595d5f4fae1051adb160d647541b1e0a4a2"],
  ["voice/sherpa-tts/tokens.txt", "56209b2bf609d5ac1d66ede6dae7bf5254bd3f8aa24c4a6823713d5b884d87ba"],
];

const requireFromTests = createRequire(path.join(TESTS_DIR, "package.json"));
let chromium;
try {
  ({ chromium } = requireFromTests("playwright"));
} catch (error) {
  console.error(`INFRA: Playwright unavailable at ${TESTS_DIR}: ${error && error.stack ? error.stack : error}`);
  process.exit(2);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function oneLine(value) {
  return String(value).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function validator() {
  const checks = [];
  const v = {
    ok(name, pass, actual, expected = true) {
      checks.push({ name, pass: Boolean(pass), actual, expected });
      return Boolean(pass);
    },
    eq(name, actual, expected) {
      return v.ok(name, JSON.stringify(actual) === JSON.stringify(expected), actual, expected);
    },
  };
  v.result = (metrics = {}) => {
    const failed = checks.filter((check) => !check.pass);
    return {
      pass: failed.length === 0,
      evidence: oneLine(JSON.stringify({
        ...metrics,
        checks: checks.length,
        failed: failed.map(({ name, actual, expected }) => ({ name, actual, expected })),
      })),
    };
  };
  return v;
}

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const VOICE_STUB = `window.SherpaOnnx = async () => ({FS:{mkdirTree(){}, FS_createDataFile(){}, writeFile(){}}});\nwindow.createOfflineTts = (module, config) => { if (window.__voiceFake.fail) throw new Error("fake init failure"); return {handle:1, generate({text}){ window.__voiceFake.generated.push(String(text)); const n=Math.round(22050*window.__voiceFake.durationMs/1000); const a=new Float32Array(n); for(let i=0;i<n;i++) a[i]=Math.sin(i/20)*0.05; return {samples:a, sampleRate:22050}; }};};\n`;

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

async function startStaticServer({ modelDelayMs = 120 } = {}) {
  const root = path.dirname(ARTIFACT);
  const artifactName = path.basename(ARTIFACT);
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
      const isStub = relative === "sherpa-onnx-wasm-web.js" || relative === "sherpa-onnx-tts.js";
      const body = isStub ? Buffer.from(VOICE_STUB) : Buffer.alloc(2048, 0x5a);
      const send = () => {
        response.writeHead(200, {
          "Content-Type": isStub ? "text/javascript; charset=utf-8" : contentTypeFor(relative),
          "Content-Length": body.length,
          "Cache-Control": "no-store",
        });
        response.end(body);
      };
      if (isStub || modelDelayMs <= 0) send();
      else setTimeout(send, modelDelayMs);
      return;
    }

    const target = pathname === "/" || pathname === `/${artifactName}` || pathname === ARTIFACT
      ? ARTIFACT
      : path.resolve(root, `.${pathname}`);
    if (target !== ARTIFACT && target !== root && !target.startsWith(root + path.sep)) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("forbidden");
      return;
    }

    let stat;
    try {
      stat = fs.statSync(target);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }
    if (!stat.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentTypeFor(target),
      "Content-Length": stat.size,
      "Cache-Control": "no-store",
    });
    fs.createReadStream(target).pipe(response);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  return {
    origin: `http://127.0.0.1:${port}`,
    artifactUrl: `http://127.0.0.1:${port}/${encodeURIComponent(artifactName)}`,
    async close() {
      if (typeof server.closeAllConnections === "function") server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function openHttp({
  server,
  viewport = { width: 390, height: 844 },
  isMobile = true,
  hasTouch = true,
  storage,
  fakeFail = false,
  durationMs = 400,
  fakeGlobals = true,
  beforeGoto,
} = {}) {
  const context = await browser.newContext({ viewport, isMobile, hasTouch });
  await context.addInitScript(({ storageValue, fail, duration, includeFake }) => {
    if (storageValue !== null) {
      try {
        localStorage.setItem("cal-phone.settings.v1", storageValue);
      } catch {
        /* Storage may be unavailable on non-HTTP documents. */
      }
    }
    if (!includeFake) return;
    window.__voiceFake = {
      fail: Boolean(fail),
      durationMs: Number(duration),
      generated: [],
    };
    window.SherpaOnnx = async () => ({ FS: { mkdirTree() {}, FS_createDataFile() {}, writeFile() {} } });
    window.createOfflineTts = (module, config) => {
      if (window.__voiceFake.fail) throw new Error("fake init failure");
      return {
        handle: 1,
        generate({ text }) {
          window.__voiceFake.generated.push(String(text));
          const count = Math.round(22050 * window.__voiceFake.durationMs / 1000);
          const samples = new Float32Array(count);
          for (let index = 0; index < count; index += 1) samples[index] = Math.sin(index / 20) * 0.05;
          return { samples, sampleRate: 22050 };
        },
      };
    };
  }, {
    storageValue: storage === undefined ? null : JSON.stringify(storage),
    fail: fakeFail,
    duration: durationMs,
    includeFake: fakeGlobals,
  });

  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(20000);
  const pageErrors = [];
  const requests = [];
  page.on("pageerror", (error) => pageErrors.push(String(error && error.message ? error.message : error)));
  page.on("request", (request) => requests.push(request.url()));

  try {
    if (beforeGoto) await beforeGoto({ context, page });
    await page.goto(server.artifactUrl, { waitUntil: "load" });
    await page.waitForSelector("main.app");
  } catch (error) {
    await context.close();
    throw error;
  }
  return { context, page, pageErrors, requests, close: () => context.close() };
}

async function openFile({ storage, fakeGlobals = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  if (storage !== undefined || fakeGlobals) {
    await context.addInitScript(({ storageValue, includeFake }) => {
      if (storageValue !== null) {
        try {
          localStorage.setItem("cal-phone.settings.v1", storageValue);
        } catch {
          /* Ignore unavailable storage. */
        }
      }
      if (includeFake) {
        window.__voiceFake = { fail: false, durationMs: 400, generated: [] };
        window.SherpaOnnx = async () => ({ FS: { mkdirTree() {}, FS_createDataFile() {}, writeFile() {} } });
        window.createOfflineTts = () => ({ handle: 1, generate: () => ({ samples: new Float32Array(8), sampleRate: 22050 }) });
      }
    }, { storageValue: storage === undefined ? null : JSON.stringify(storage), includeFake: fakeGlobals });
  }
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(20000);
  const pageErrors = [];
  const requests = [];
  page.on("pageerror", (error) => pageErrors.push(String(error && error.message ? error.message : error)));
  page.on("request", (request) => requests.push(request.url()));
  try {
    await page.goto(pathToFileURL(ARTIFACT).href, { waitUntil: "load" });
    await page.waitForSelector("main.app");
  } catch (error) {
    await context.close();
    throw error;
  }
  return { context, page, pageErrors, requests, close: () => context.close() };
}

async function voiceState(page) {
  return page.evaluate(() => document.querySelector("main.app")?.dataset.voiceState || "");
}

async function waitVoice(page, states, timeout = 15000) {
  const wanted = Array.isArray(states) ? states : [states];
  await page.waitForFunction(
    (allowed) => allowed.includes(document.querySelector("main.app")?.dataset.voiceState || ""),
    wanted,
    { timeout, polling: 50 },
  );
  return voiceState(page);
}

async function waitResult(page, text, timeout = 5000) {
  await page.waitForFunction(
    (expected) => (document.querySelector('[data-testid="result"]')?.textContent || "").trim() === expected,
    text,
    { timeout, polling: 25 },
  );
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
  await sleep(120);
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

async function isVisible(page, selector) {
  return page.locator(selector).isVisible();
}

function flattenMetrics(prefix, metrics) {
  const lines = [];
  for (const [key, value] of Object.entries(metrics)) {
    if (value === null || value === undefined) lines.push(`${prefix}.${key}=null`);
    else if (typeof value === "object") lines.push(`${prefix}.${key}=${JSON.stringify(value)}`);
    else lines.push(`${prefix}.${key}=${oneLine(value)}`);
  }
  return lines;
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
    const voiceGroup = query('[data-testid="settings-voice-group"]');
    const status = query('[data-testid="voice-status"]');
    const statusText = query('[data-testid="voice-status-text"]');
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
      voiceGroup: rect(voiceGroup),
    };
    const visibility = {
      planeOpen: Boolean(panel?.open),
      voiceGroup: visible(voiceGroup),
      keys: visible(keys),
      result: visible(result),
      status: visible(status),
      progress: visible(progress),
      hint: visible(hint),
      retry: visible(retry),
      summary: visible(summary),
      gear: visible(gear),
    };
    const inView = Object.fromEntries(Object.entries(controls).map(([key, value]) => [key, inViewport(value)]));
    return {
      innerWidth,
      innerHeight,
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      panelOpen: Boolean(panel?.open),
      panelScrollWidth: panel?.scrollWidth || 0,
      panelClientWidth: panel?.clientWidth || 0,
      panelScrollHeight: panel?.scrollHeight || 0,
      panelClientHeight: panel?.clientHeight || 0,
      panelScrollTop: panel?.scrollTop || 0,
      checked: { keys: Boolean(keys?.checked), result: Boolean(result?.checked) },
      visibility,
      inView,
      controls,
      statusText: (statusText?.textContent || "").trim(),
      summaryText: (summary?.textContent || "").trim(),
      progressValue: Number(document.querySelector("main.app")?.dataset.voiceProgress || 0),
      summaryGearOverlap: overlaps(controls.summary, controls.gear),
    };
  });
}

function validateLayout(v, prefix, metrics, expectedWidth) {
  v.eq(`${prefix}.innerWidth`, metrics.innerWidth, expectedWidth);
  v.ok(`${prefix}.document-no-horizontal-overflow`, metrics.docScrollWidth <= metrics.innerWidth, metrics.docScrollWidth, `<=${metrics.innerWidth}`);
  v.ok(`${prefix}.panel-no-horizontal-overflow`, metrics.panelScrollWidth <= metrics.panelClientWidth, metrics.panelScrollWidth, `<=${metrics.panelClientWidth}`);
  for (const name of ["keysRow", "resultRow"]) {
    v.ok(`${prefix}.${name}.height-gte-44`, metrics.controls[name].height >= 44, metrics.controls[name].height, ">=44");
    v.ok(`${prefix}.${name}.width-positive`, metrics.controls[name].width > 0, metrics.controls[name].width, ">0");
  }
  v.ok(`${prefix}.retry.width-gte-44`, metrics.controls.retry.width >= 44, metrics.controls.retry.width, ">=44");
  v.ok(`${prefix}.retry.height-gte-44`, metrics.controls.retry.height >= 44, metrics.controls.retry.height, ">=44");
  for (const name of ["status", "progress", "hint", "retry"]) {
    v.ok(`${prefix}.${name}.visible`, metrics.visibility[name], metrics.visibility[name], true);
    v.ok(`${prefix}.${name}.in-viewport`, metrics.inView[name], metrics.inView[name], true);
  }
  v.ok(`${prefix}.summary-visible`, metrics.visibility.summary, metrics.visibility.summary, true);
  v.ok(`${prefix}.gear-visible`, metrics.visibility.gear, metrics.visibility.gear, true);
  v.ok(`${prefix}.summary-gear-no-overlap`, !metrics.summaryGearOverlap, metrics.summaryGearOverlap, false);
}

async function imageStats(page, buffer) {
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let first = null;
    let nonUniform = false;
    const sampled = new Set();
    for (let index = 0; index < data.length; index += 4) {
      const key = `${data[index]},${data[index + 1]},${data[index + 2]},${data[index + 3]}`;
      if (first === null) first = key;
      else if (key !== first) nonUniform = true;
      if ((index / 4) % 37 === 0) sampled.add(key);
    }
    return {
      width: canvas.width,
      height: canvas.height,
      nonUniform,
      distinctSampledColors: sampled.size,
    };
  }, buffer.toString("base64"));
}

function parseSuite(stdout) {
  const text = String(stdout || "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error(`suite JSON parse failed: ${text.slice(0, 500)}`);
  }
}

async function waitForDeploymentServer(url, child, timeout = 15000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeout) {
    if (child.exitCode !== null) throw new Error(`deploy server exited ${child.exitCode}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      return response;
    } catch (error) {
      lastError = error;
      await sleep(100);
    }
  }
  throw new Error(`deploy server did not answer: ${lastError ? lastError.message : "timeout"}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, sleep(3000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
  await Promise.race([exited, sleep(2000)]);
}

const artifactSha = fs.existsSync(ARTIFACT) ? sha256File(ARTIFACT) : sha256(Buffer.alloc(0));
const verifierSha = sha256File(fileURLToPath(import.meta.url));
fs.mkdirSync(OUT_DIR, { recursive: true });

let browser;
let standardServer;
let throttledServer;
let slowServer;
try {
  browser = await chromium.launch({ headless: true });
  standardServer = await startStaticServer({ modelDelayMs: 120 });
  throttledServer = await startStaticServer({ modelDelayMs: 250 });
  slowServer = await startStaticServer({ modelDelayMs: 550 });
} catch (error) {
  console.error(`INFRA: browser/server startup failed: ${error && error.stack ? error.stack : error}`);
  process.exit(2);
}

const results = {};
const H_IDS = ["H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H9", "H10"];

async function runH(id, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    results[id] = { ...result, ms: Date.now() - started };
  } catch (error) {
    results[id] = {
      pass: false,
      evidence: oneLine(JSON.stringify({ exception: String(error && error.stack ? error.stack : error) })),
      ms: Date.now() - started,
    };
  }
}

await runH("H1", async () => {
  const v = validator();
  const app = await openHttp({ server: standardServer });
  try {
    const { page } = app;
    await openSettings(page);
    const initial = await page.evaluate(() => ({
      keys: document.querySelector('[data-testid="settings-voice-keys"]').checked,
      result: document.querySelector('[data-testid="settings-voice-result"]').checked,
    }));
    await page.check('[data-testid="settings-voice-keys"]');
    await page.check('[data-testid="settings-voice-result"]');
    const storedEnabled = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), SETTINGS_KEY);
    await waitVoice(page, "ready", 15000);
    await page.reload({ waitUntil: "load" });
    await waitVoice(page, "ready", 15000);
    const afterReload = await page.evaluate(() => ({
      summaryVisible: !document.querySelector('[data-testid="settings-summary"]').hidden,
      summaryText: (document.querySelector('[data-testid="settings-summary"]').textContent || "").trim(),
      indicatorVisible: !document.querySelector('[data-testid="settings-indicator"]').hidden,
    }));
    await openSettings(page);
    const checksAfterReload = await page.evaluate(() => ({
      keys: document.querySelector('[data-testid="settings-voice-keys"]').checked,
      result: document.querySelector('[data-testid="settings-voice-result"]').checked,
    }));
    await page.uncheck('[data-testid="settings-voice-keys"]');
    await page.uncheck('[data-testid="settings-voice-result"]');
    const summaryHiddenAfterOff = await page.evaluate(() => document.querySelector('[data-testid="settings-summary"]').hidden);
    const storedOff = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), SETTINGS_KEY);
    await closeSettings(page);
    await clickSequence(page, ["1", "+", "2", "="]);
    const resultThree = await waitResult(page, "3");
    await page.click('[data-testid="key-op"]');
    await openSettings(page);
    const flagsAfterReset = await page.evaluate(() => ({
      keys: document.querySelector('[data-testid="settings-voice-keys"]').checked,
      result: document.querySelector('[data-testid="settings-voice-result"]').checked,
    }));
    const storedAfterReset = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), SETTINGS_KEY);
    v.eq("initial.keys", initial.keys, false);
    v.eq("initial.result", initial.result, false);
    v.eq("stored.voiceKeys", storedEnabled?.voiceKeys, true);
    v.eq("stored.voiceResult", storedEnabled?.voiceResult, true);
    v.eq("reload.keys", checksAfterReload.keys, true);
    v.eq("reload.result", checksAfterReload.result, true);
    v.eq("reload.summaryVisible", afterReload.summaryVisible, true);
    v.eq("reload.summaryText", afterReload.summaryText, "已自定义");
    v.eq("reload.indicatorVisible", afterReload.indicatorVisible, true);
    v.eq("defaults.summaryHidden", summaryHiddenAfterOff, true);
    v.eq("compute.result", resultThree, "3");
    v.eq("reset.keys", flagsAfterReset.keys, false);
    v.eq("reset.result", flagsAfterReset.result, false);
    v.eq("reset.storage", storedAfterReset, storedOff);
    return v.result({ initial, storedEnabled, checksAfterReload, afterReload, summaryHiddenAfterOff, resultThree, flagsAfterReset });
  } finally {
    await app.close();
  }
});

await runH("H2", async () => {
  const v = validator();
  const app = await openFile();
  try {
    const { page } = app;
    const disabled = await page.evaluate(() => ({
      keys: document.querySelector('[data-testid="settings-voice-keys"]').disabled,
      result: document.querySelector('[data-testid="settings-voice-result"]').disabled,
    }));
    const hint = await page.$eval('[data-testid="voice-hint"]', (element) => (element.textContent || "").trim());
    const voiceRequests = app.requests.filter((url) => url.includes("/voice/"));
    await clickSequence(page, ["1", "+", "2", "="]);
    const resultThree = await waitResult(page, "3");
    v.eq("keys.disabled", disabled.keys, true);
    v.eq("result.disabled", disabled.result, true);
    v.ok("hint.http-or-web-address", /http/i.test(hint) || hint.includes("网页地址"), hint, "/http/i or 网页地址");
    v.eq("voice.request.count", voiceRequests.length, 0);
    v.eq("compute.result", resultThree, "3");
    return v.result({ disabled, hint, voiceRequests, resultThree, pageErrors: app.pageErrors });
  } finally {
    await app.close();
  }
});

await runH("H3", async () => {
  const v = validator();
  const app = await openHttp({ server: standardServer, storage: { voiceKeys: true, voiceResult: false } });
  let keyboardApp;
  let autoApp;
  try {
    const { page } = app;
    await waitVoice(page, "ready", 15000);
    await clickSequence(page, ["9", "5", ".", ".", "backspace", "enter", "enter", "backspace", "backspace", "+", "-", "*", "/", "="]);
    const speech = await readSpeech(page);
    const expected = ["九", "五", "点", "退格", "确认", "退格", "加", "减", "乘", "除"];
    v.eq("log.texts", speech.texts, expected);
    v.eq("log.count", speech.count, "10");
    v.eq("log.last", speech.last, "除");
    v.eq("log.extra", speech.texts.length, expected.length);

    keyboardApp = await openHttp({ server: standardServer, storage: { voiceKeys: true, voiceResult: false } });
    await waitVoice(keyboardApp.page, "ready", 15000);
    for (const key of ["7", "Backspace", "8", "Enter"]) await keyboardApp.page.keyboard.press(key);
    await sleep(150);
    const keyboardSpeech = await readSpeech(keyboardApp.page);
    v.eq("keyboard.texts", keyboardSpeech.texts, ["七", "退格", "八", "确认"]);

    autoApp = await openHttp({ server: standardServer, storage: { autoConfirm: 0.2, voiceKeys: true, voiceResult: false } });
    await waitVoice(autoApp.page, "ready", 15000);
    await autoApp.page.click('[data-key="6"]');
    await sleep(500);
    const autoSpeech = await readSpeech(autoApp.page);
    v.eq("autoConfirm.texts", autoSpeech.texts, ["六", "确认"]);
    return v.result({ main: speech, keyboard: keyboardSpeech, autoConfirm: autoSpeech });
  } finally {
    await app.close();
    if (keyboardApp) await keyboardApp.close();
    if (autoApp) await autoApp.close();
  }
});

await runH("H4", async () => {
  const v = validator();
  const app = await openHttp({ server: standardServer, storage: { voiceKeys: false, voiceResult: true } });
  let fresh;
  try {
    const { page } = app;
    await waitVoice(page, "ready", 15000);
    await clickSequence(page, ["9", ".", "5", "+", "9", ".", "2", "="]);
    const resultOne = await waitResult(page, "18.7");
    const speechOne = await readSpeech(page);
    await clickSequence(page, ["2", "-", "5", "="]);
    const speechTwo = await readSpeech(page);
    const resultTwo = await page.$eval('[data-testid="result"]', (element) => (element.textContent || "").trim());
    await clickSequence(page, ["1", "/", "0", "="]);
    const resultZero = await waitResult(page, "不能除以零");
    const speechZero = await readSpeech(page);
    await openSettings(page);
    await page.fill('[data-testid="settings-auto-equals"]', "2");
    await closeSettings(page);
    await clickSequence(page, ["3", "+", "4", "enter"]);
    const resultAuto = await waitResult(page, "7");
    const speechAuto = await readSpeech(page);

    fresh = await openHttp({ server: standardServer, storage: { voiceKeys: false, voiceResult: true } });
    await waitVoice(fresh.page, "ready", 15000);
    await clickSequence(fresh.page, ["7", "+", "8", "="]);
    const freshResult = await waitResult(fresh.page, "15");
    const freshSpeech = await readSpeech(fresh.page);
    v.eq("decimal.result", resultOne, "18.7");
    v.eq("decimal.last", speechOne.last, "结果 十八点七");
    v.eq("negative.last", speechTwo.last, "结果 负三");
    v.eq("negative.result", resultTwo, "-3");
    v.eq("divide-zero.result", resultZero, "不能除以零");
    v.eq("divide-zero.last", speechZero.last, "不能除以零");
    v.eq("auto-equals.result", resultAuto, "7");
    v.eq("auto-equals.last", speechAuto.last, "结果 七");
    v.eq("fresh.result", freshResult, "15");
    v.ok("fresh.no-confirm", !freshSpeech.texts.includes("确认"), freshSpeech.texts, "no 确认");
    v.eq("fresh.last-entry", freshSpeech.log.at(-1)?.text, "结果 十五");
    return v.result({ resultOne, speechOne: speechOne.last, resultTwo, speechTwo: speechTwo.last, resultZero, speechZero: speechZero.last, resultAuto, speechAuto: speechAuto.last, freshResult, freshSpeech });
  } finally {
    await app.close();
    if (fresh) await fresh.close();
  }
});

await runH("H5", async () => {
  const v = validator();
  const resultOnly = await openHttp({ server: standardServer, storage: { voiceKeys: false, voiceResult: true } });
  const keysOnly = await openHttp({ server: standardServer, storage: { voiceKeys: true, voiceResult: false } });
  const bothOff = await openHttp({ server: standardServer });
  try {
    await waitVoice(resultOnly.page, "ready", 15000);
    await clickSequence(resultOnly.page, ["1", "+", "2", "="]);
    await waitResult(resultOnly.page, "3");
    const resultSpeech = await readSpeech(resultOnly.page);
    const resultKinds = [...new Set(resultSpeech.kinds)];

    await waitVoice(keysOnly.page, "ready", 15000);
    await clickSequence(keysOnly.page, ["1", "+", "2", "="]);
    const keysResult = await waitResult(keysOnly.page, "3");
    const keysSpeech = await readSpeech(keysOnly.page);

    await clickSequence(bothOff.page, ["1", "+", "2", "="]);
    await waitResult(bothOff.page, "3");
    const offSpeech = await readSpeech(bothOff.page);

    v.ok("result-only.kinds-subset", resultKinds.every((kind) => kind === "result"), resultKinds, ["result"]);
    v.eq("result-only.last", resultSpeech.last, "结果 三");
    v.ok("keys-only.kinds", keysSpeech.kinds.length > 0 && keysSpeech.kinds.every((kind) => kind === "key"), keysSpeech.kinds, ["key"]);
    v.eq("keys-only.texts", keysSpeech.texts, ["一", "加", "二"]);
    v.eq("keys-only.result", keysResult, "3");
    v.ok("both-off.count", offSpeech.count === "0" || offSpeech.count === "", offSpeech.count, "0 or empty");
    return v.result({ resultKinds, resultLast: resultSpeech.last, keysKinds: keysSpeech.kinds, keysTexts: keysSpeech.texts, keysResult, offCount: offSpeech.count });
  } finally {
    await resultOnly.close();
    await keysOnly.close();
    await bothOff.close();
  }
});

await runH("H6", async () => {
  const v = validator();
  const keysPage = await openHttp({ server: standardServer, storage: { voiceKeys: true, voiceResult: false }, durationMs: 400 });
  const bothPage = await openHttp({ server: standardServer, storage: { voiceKeys: true, voiceResult: true }, durationMs: 400 });
  const cancelPage = await openHttp({ server: standardServer, storage: { voiceKeys: true, voiceResult: false }, durationMs: 400 });
  try {
    await waitVoice(keysPage.page, "ready", 15000);
    await clickSequence(keysPage.page, ["1", "2", "3"]);
    let keysPlayed = [];
    const playStart = Date.now();
    while (Date.now() - playStart < 5000) {
      keysPlayed = await readPlayed(keysPage.page);
      if (keysPlayed.length >= 3) break;
      await sleep(75);
    }
    const keysSpeech = await readSpeech(keysPage.page);
    v.eq("serial.log-texts", keysSpeech.texts, ["一", "二", "三"]);
    v.eq("serial.played-texts", keysPlayed.map((entry) => entry.text), ["一", "二", "三"]);

    await waitVoice(bothPage.page, "ready", 15000);
    const firstClick = Date.now();
    await clickSequence(bothPage.page, ["1", "+", "1", "=", "9"]);
    const lastClick = Date.now();
    await sleep(4000);
    const bothPlayed = await readPlayed(bothPage.page);
    const bothKeyTexts = bothPlayed.filter((entry) => entry.kind === "key").map((entry) => entry.text);
    v.ok("quick-click-span-lt-1500ms", lastClick - firstClick < 1500, lastClick - firstClick, "<1500");
    v.eq("quick.no-result-played", bothPlayed.some((entry) => entry.kind === "result"), false);
    v.eq("quick.key-texts", bothKeyTexts, ["一", "加", "一", "九"]);

    await waitVoice(cancelPage.page, "ready", 15000);
    await clickSequence(cancelPage.page, ["1", "2", "3", "4", "5"]);
    await openSettings(cancelPage.page);
    await cancelPage.page.uncheck('[data-testid="settings-voice-keys"]');
    await sleep(3000);
    const cancelledPlayed = await readPlayed(cancelPage.page);
    const cancelledTexts = cancelledPlayed.map((entry) => entry.text);
    v.ok("cancel.no-late-three-four-five", !["三", "四", "五"].some((text) => cancelledTexts.includes(text)), cancelledTexts, "no 三/四/五");
    v.ok("cancel.length-lte-2", cancelledPlayed.length <= 2, cancelledPlayed.length, "<=2");
    return v.result({ serialPlayed: keysPlayed, quickPlayed: bothPlayed, quickSpanMs: lastClick - firstClick, cancelledPlayed });
  } finally {
    await keysPage.close();
    await bothPage.close();
    await cancelPage.close();
  }
});

await runH("H7", async () => {
  const v = validator();
  const first = await openHttp({ server: throttledServer, fakeFail: false });
  let failPage;
  let presetPage;
  try {
    await openSettings(first.page);
    await first.page.check('[data-testid="settings-voice-keys"]');
    const samples = [];
    const started = Date.now();
    let ready = false;
    while (Date.now() - started < 15000) {
      const sample = await first.page.evaluate(() => {
        const app = document.querySelector("main.app");
        const status = document.querySelector('[data-testid="voice-status"]');
        const statusText = document.querySelector('[data-testid="voice-status-text"]');
        const summary = document.querySelector('[data-testid="settings-summary"]');
        return {
          state: app?.dataset.voiceState || "",
          progress: app?.dataset.voiceProgress || "",
          statusHidden: Boolean(status?.hidden),
          statusText: (statusText?.textContent || "").trim(),
          summaryText: (summary?.textContent || "").trim(),
          summaryHidden: Boolean(summary?.hidden),
        };
      });
      samples.push({ atMs: Date.now() - started, ...sample });
      if (sample.state === "ready") {
        ready = true;
        break;
      }
      await sleep(100);
    }
    const transitional = samples.filter((sample) => sample.state === "loading" || sample.state === "preparing");
    const readySample = samples.find((sample) => sample.state === "ready");
    v.ok("ready-within-15s", ready, Date.now() - started, "<=15000");
    v.ok("saw-loading-or-preparing", transitional.length > 0, transitional.length, ">0");
    for (const sample of transitional) {
      const numericProgress = Number(sample.progress);
      v.ok(`transition.${sample.atMs}.status-visible`, !sample.statusHidden, sample.statusHidden, false);
      v.ok(`transition.${sample.atMs}.text-nonempty`, sample.statusText.length > 0, sample.statusText, "nonempty");
      v.ok(`transition.${sample.atMs}.progress-valid`, Number.isFinite(numericProgress) && numericProgress >= 0 && numericProgress <= 100, sample.progress, "0..100");
      v.ok(`transition.${sample.atMs}.summary-preparing`, sample.summaryText.includes("语音准备中"), sample.summaryText, "contains 语音准备中");
    }
    v.ok("ready.status-text", Boolean(readySample?.statusText.includes("语音已就绪")), readySample?.statusText, "contains 语音已就绪");
    v.eq("ready.summary", readySample?.summaryText, "已自定义");

    failPage = await openHttp({ server: standardServer, fakeFail: true, storage: { voiceKeys: false, voiceResult: false } });
    await openSettings(failPage.page);
    await failPage.page.check('[data-testid="settings-voice-keys"]');
    await waitVoice(failPage.page, "error", 10000);
    const failure = await failPage.page.evaluate(() => ({
      text: (document.querySelector('[data-testid="voice-status-text"]').textContent || "").trim(),
      retryVisible: !document.querySelector('[data-testid="voice-retry"]').hidden,
      checked: document.querySelector('[data-testid="settings-voice-keys"]').checked,
    }));
    await closeSettings(failPage.page);
    await clickSequence(failPage.page, ["1", "+", "2", "="]);
    const failureCompute = await waitResult(failPage.page, "3");
    await openSettings(failPage.page);
    await failPage.page.evaluate(() => { window.__voiceFake.fail = false; });
    await failPage.page.click('[data-testid="voice-retry"]');
    await waitVoice(failPage.page, "ready", 15000);
    const retryState = await voiceState(failPage.page);
    v.ok("error.text", failure.text.includes("语音加载失败"), failure.text, "contains 语音加载失败");
    v.ok("error.retry-visible", failure.retryVisible, failure.retryVisible, true);
    v.ok("error.checkbox-checked", failure.checked, failure.checked, true);
    v.eq("error.compute", failureCompute, "3");
    v.eq("retry.state", retryState, "ready");

    presetPage = await openHttp({ server: standardServer, storage: { voiceKeys: true, voiceResult: false } });
    const presetReady = await waitVoice(presetPage.page, "ready", 15000);
    const presetClicks = await presetPage.page.evaluate(() => document.querySelector('[data-testid="settings-toggle"]').getAttribute("aria-expanded"));
    v.eq("preset.ready", presetReady, "ready");
    v.eq("preset.no-settings-click", presetClicks, "false");
    return v.result({ sampleCount: samples.length, states: [...new Set(samples.map((sample) => sample.state))], transitionalCount: transitional.length, readyText: readySample?.statusText, failure, failureCompute, retryState, presetReady });
  } finally {
    await first.close();
    if (failPage) await failPage.close();
    if (presetPage) await presetPage.close();
  }
});

await runH("H8", async () => {
  const v = validator();
  const checksumFile = path.join(REPO, "scripts/voice-assets.sha256");
  const checksumText = fs.readFileSync(checksumFile, "utf8");
  const listedHashes = (checksumText.match(/[0-9a-fA-F]{64}/g) || []).map((value) => value.toLowerCase()).sort();
  const expectedHashes = EXPECTED_ASSETS.map(([, hash]) => hash).sort();
  v.eq("checksum.count", listedHashes.length, 7);
  v.eq("checksum.multiset", listedHashes, expectedHashes);

  const installStarted = Date.now();
  const install = spawnSync("bash", ["scripts/install-voice-assets.sh"], {
    cwd: REPO,
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 10 * 1024 * 1024,
  });
  const installMs = Date.now() - installStarted;
  const installedHashes = {};
  for (const [relative, expected] of EXPECTED_ASSETS) {
    const file = path.join(REPO, relative);
    const actual = fs.existsSync(file) ? sha256File(file) : null;
    installedHashes[relative] = { actual, expected, exists: fs.existsSync(file) };
    v.eq(`${relative}.sha256`, actual, expected);
  }
  v.eq("install.exit", install.status, 0);

  const port = await getFreePort();
  const child = spawn("node", ["deploy/server.cjs"], {
    cwd: REPO,
    env: { ...process.env, ROOT: REPO, PORT: String(port), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let childOut = "";
  let childErr = "";
  child.stdout.on("data", (chunk) => { childOut += chunk.toString(); });
  child.stderr.on("data", (chunk) => { childErr += chunk.toString(); });
  let responseHeaders = {};
  let deployStatus = null;
  try {
    const response = await waitForDeploymentServer(`http://127.0.0.1:${port}/voice/sherpa-onnx-wasm-web.wasm`, child, 15000);
    deployStatus = response.status;
    responseHeaders = Object.fromEntries(response.headers.entries());
    if (response.body) await response.body.cancel();
  } finally {
    await stopChild(child);
  }
  const cacheControl = responseHeaders["cache-control"] || "";
  const contentType = responseHeaders["content-type"] || "";
  v.eq("deploy.status", deployStatus, 200);
  v.ok("deploy.content-type", contentType.includes("application/wasm"), contentType, "contains application/wasm");
  v.ok("deploy.cache-max-age", cacheControl.includes("max-age=31536000"), cacheControl, "contains max-age=31536000");
  v.ok("deploy.cache-immutable", cacheControl.includes("immutable"), cacheControl, "contains immutable");

  const readme = fs.readFileSync(path.join(REPO, "README.md"), "utf8");
  const deployReadme = fs.readFileSync(path.join(REPO, "deploy/README.md"), "utf8");
  for (const [name, text] of [["README", readme], ["deploy.README", deployReadme]]) {
    for (const needle of ["install-voice-assets.sh", "非商用", "voice/"]) {
      v.ok(`${name}.contains.${needle}`, text.includes(needle), text.includes(needle), true);
    }
  }
  return v.result({ listedHashes, installedHashes, install: { exit: install.status, ms: installMs, stdout: install.stdout?.slice(-500), stderr: install.stderr?.slice(-500) }, deployStatus, contentType, cacheControl, childOut, childErr });
});

await runH("H9", async () => {
  const v = validator();
  try {
    async function measurementsAt(width) {
      let cdp = null;
      const app = await openHttp({
        server: standardServer,
        viewport: { width: 390, height: 844 },
        storage: { voiceKeys: true, voiceResult: false },
        fakeFail: true,
        beforeGoto: width === 320 ? async ({ context, page }) => {
          cdp = await context.newCDPSession(page);
          await cdp.send("Emulation.setDeviceMetricsOverride", {
            width: 320,
            height: 568,
            deviceScaleFactor: 3,
            mobile: true,
          });
        } : undefined,
      });
      try {
        if (width === 320) await app.page.waitForFunction(() => window.innerWidth === 320, null, { timeout: 5000 });
        await waitVoice(app.page, "error", 10000);
        await openSettings(app.page);
        await sleep(150);
        return await measureVoiceLayout(app.page);
      } finally {
        if (cdp) await cdp.detach().catch(() => {});
        await app.close();
      }
    }
    const metrics390 = await measurementsAt(390);
    const metrics320 = await measurementsAt(320);
    validateLayout(v, "390", metrics390, 390);
    validateLayout(v, "320", metrics320, 320);
    return v.result({ metrics390, metrics320 });
  } catch (error) {
    throw error;
  }
});

await runH("H10", async () => {
  const v = validator();
  const suiteStarted = Date.now();
  const suite = spawnSync("node", [
    path.join(TESTS_DIR, "suite.mjs"),
    "--json",
    "--artifact",
    ARTIFACT,
  ], {
    cwd: TESTS_DIR,
    encoding: "utf8",
    timeout: 240000,
    maxBuffer: 50 * 1024 * 1024,
  });
  const suiteMs = Date.now() - suiteStarted;
  const suiteJson = parseSuite(suite.stdout);
  const suiteResults = Array.isArray(suiteJson.results) ? suiteJson.results : [];
  const suiteChecks = suiteResults.flatMap((result) => Array.isArray(result.checks) ? result.checks : []);
  v.eq("suite.results", suiteResults.length, 18);
  v.eq("suite.checks", suiteChecks.length, 206);
  v.ok("suite.every-pass", suiteResults.length > 0 && suiteResults.every((result) => result.pass === true), suiteResults.filter((result) => !result.pass).map((result) => result.id), []);

  const slow = await openHttp({ server: slowServer, storage: { voiceKeys: true, voiceResult: false }, fakeFail: false });
  let slowState = "";
  let slowElapsed = null;
  let slowResult = null;
  let failureApp;
  try {
    slowState = await waitVoice(slow.page, ["loading", "preparing"], 5000);
    const started = Date.now();
    await clickSequence(slow.page, ["2", "+", "2", "="]);
    slowResult = await waitResult(slow.page, "4", 5000);
    slowElapsed = Date.now() - started;

    failureApp = await openHttp({ server: standardServer, storage: { voiceKeys: true, voiceResult: false }, fakeFail: true });
    await waitVoice(failureApp.page, "error", 10000);
    await clickSequence(failureApp.page, ["1", "+", "2", "="]);
    const resultThree = await waitResult(failureApp.page, "3");
    const historyAfterThree = await failureApp.page.$$eval('[data-testid="history-list"] > *', (items) => items.length);
    await clickSequence(failureApp.page, ["1", "/", "0", "="]);
    const resultDivide = await waitResult(failureApp.page, "不能除以零");
    await clickSequence(failureApp.page, ["2", "+", "3", "="]);
    const resultFive = await waitResult(failureApp.page, "5");
    const historyAfterFive = await failureApp.page.$$eval('[data-testid="history-list"] > *', (items) => items.length);

    const source = fs.readFileSync(ARTIFACT);
    const sourceText = source.toString("utf8");
    const remoteReferences = sourceText.match(/<(script|link|img)[^>]+(src|href)\s*=\s*["'](https?:)?\/\//gi) || [];
    v.ok("slow.entered-loading", slowState === "loading" || slowState === "preparing", slowState, "loading|preparing");
    v.ok("slow.result-fast", slowElapsed < 1000, slowElapsed, "<1000");
    v.eq("slow.result", slowResult, "4");
    v.eq("slow.pageerrors", slow.pageErrors.length, 0);
    v.eq("failure.result-three", resultThree, "3");
    v.ok("failure.history-gte-1", historyAfterThree >= 1, historyAfterThree, ">=1");
    v.eq("failure.result-divide-zero", resultDivide, "不能除以零");
    v.eq("failure.result-five", resultFive, "5");
    v.ok("failure.history-gte-2", historyAfterFive >= 2, historyAfterFive, ">=2");
    v.ok("source.closed-html", sourceText.includes("</html>"), sourceText.includes("</html>"), true);
    v.ok("source.bytes-gte-1024", source.length >= 1024, source.length, ">=1024");
    v.eq("source.remote-references", remoteReferences.length, 0);
    return v.result({
      suite: { exit: suite.status, results: suiteResults.length, checks: suiteChecks.length, pass: suiteResults.every((result) => result.pass === true), ms: suiteMs },
      slow: { state: slowState, elapsedMs: slowElapsed, result: slowResult, pageErrors: slow.pageErrors },
      failure: { resultThree, historyAfterThree, resultDivide, resultFive, historyAfterFive },
      source: { bytes: source.length, closedHtml: sourceText.includes("</html>"), remoteReferences },
    });
  } finally {
    await slow.close();
    if (failureApp) await failureApp.close();
  }
});

const failedH = H_IDS.filter((id) => !results[id]?.pass);
const hardLines = [
  `ROUND: ${ROUND}`,
  `ARTIFACT_SHA256: ${artifactSha}`,
  `VERIFIER_SHA256: ${verifierSha}`,
  ...H_IDS.map((id) => `${id} ${results[id]?.pass ? "PASS" : "FAIL"} — ${results[id]?.evidence || "missing result"}`),
  failedH.length === 0 ? "HARD: PASS" : `HARD: FAIL (${failedH.join(",")})`,
];
const hardText = `${hardLines.join("\n")}\n`;
fs.writeFileSync(path.join(OUT_DIR, `hard-r${ROUND}.txt`), hardText);

let renderError = null;
if (REVIEW_STATES.length > 0) {
  try {
    const shotsDir = path.join(OUT_DIR, "review-shots", `r${ROUND}`);
    fs.rmSync(shotsDir, { recursive: true, force: true });
    fs.mkdirSync(shotsDir, { recursive: true });
    const rendered = [];

    async function captureState(state, { storage, fakeFail, narrow = false }) {
      let cdp = null;
      const app = await openHttp({
        server: standardServer,
        viewport: { width: 390, height: 844 },
        storage,
        fakeFail,
        beforeGoto: narrow ? async ({ context, page }) => {
          cdp = await context.newCDPSession(page);
          await cdp.send("Emulation.setDeviceMetricsOverride", {
            width: 320,
            height: 568,
            deviceScaleFactor: 3,
            mobile: true,
          });
        } : undefined,
      });
      try {
        if (fakeFail) await waitVoice(app.page, "error", 10000);
        else if (storage?.voiceKeys || storage?.voiceResult) await waitVoice(app.page, "ready", 15000);
        if (narrow) await app.page.waitForFunction(() => window.innerWidth === 320, null, { timeout: 5000 });
        await openSettings(app.page);
        await scrollVoiceGroup(app.page);
        const metrics = await measureVoiceLayout(app.page);
        const buffer = await app.page.screenshot({
          type: "png",
          animations: "disabled",
          ...(narrow ? { clip: { x: 0, y: 0, width: 320, height: 568 } } : {}),
        });
        const stats = await imageStats(app.page, buffer);
        const file = `${state}.png`;
        fs.writeFileSync(path.join(shotsDir, file), buffer);
        rendered.push({
          state,
          file,
          buffer,
          sha256: sha256(buffer),
          width: stats.width,
          height: stats.height,
          stats,
          metrics,
        });
      } finally {
        if (cdp) await cdp.detach().catch(() => {});
        await app.close();
      }
    }

    if (REVIEW_STATES.includes("S1")) await captureState("S1", { storage: undefined, fakeFail: false, narrow: false });
    if (REVIEW_STATES.includes("S2")) await captureState("S2", { storage: { voiceKeys: true, voiceResult: true }, fakeFail: false, narrow: false });
    if (REVIEW_STATES.includes("S3")) await captureState("S3", { storage: { voiceKeys: true, voiceResult: false }, fakeFail: true, narrow: true });

    const renderLines = [
      `ROUND: ${ROUND}`,
      `ARTIFACT_SHA256: ${artifactSha}`,
      `VERIFIER_SHA256: ${verifierSha}`,
    ];
    for (const shot of rendered) {
      renderLines.push(...flattenMetrics(shot.state, {
        file: shot.file,
        sha256: shot.sha256,
        width: shot.width,
        height: shot.height,
        bytes: shot.buffer.length,
        pngSignature: shot.buffer.subarray(0, 8).equals(PNG_SIGNATURE),
        nonUniform: shot.stats.nonUniform,
        distinctSampledColors: shot.stats.distinctSampledColors,
        innerWidth: shot.metrics.innerWidth,
        innerHeight: shot.metrics.innerHeight,
        docScrollWidth: shot.metrics.docScrollWidth,
        docClientWidth: shot.metrics.docClientWidth,
        panelOpen: shot.metrics.panelOpen,
        panelScrollWidth: shot.metrics.panelScrollWidth,
        panelClientWidth: shot.metrics.panelClientWidth,
        voiceGroupVisible: shot.metrics.visibility.voiceGroup,
        statusVisible: shot.metrics.visibility.status,
        progressVisible: shot.metrics.visibility.progress,
        hintVisible: shot.metrics.visibility.hint,
        retryVisible: shot.metrics.visibility.retry,
        summaryVisible: shot.metrics.visibility.summary,
        summaryGearOverlap: shot.metrics.summaryGearOverlap,
        keysChecked: shot.metrics.checked.keys,
        resultChecked: shot.metrics.checked.result,
        keysRowRect: shot.metrics.controls.keysRow,
        resultRowRect: shot.metrics.controls.resultRow,
        retryRect: shot.metrics.controls.retry,
        statusText: shot.metrics.statusText,
        summaryText: shot.metrics.summaryText,
      }));
    }
    const renderText = `${renderLines.join("\n")}\n`;
    fs.writeFileSync(path.join(OUT_DIR, `render-r${ROUND}.txt`), renderText);

    const expectedFiles = REVIEW_STATES.map((state) => `${state}.png`).sort();
    const actualFiles = fs.readdirSync(shotsDir).sort();
    if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
      throw new Error(`review files mismatch: ${JSON.stringify(actualFiles)} != ${JSON.stringify(expectedFiles)}`);
    }
    for (const shot of rendered) {
      if (!shot.buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`${shot.file} is not PNG`);
      if (shot.buffer.length === 0) throw new Error(`${shot.file} is empty`);
      if (shot.width < 240 || shot.height < 160) throw new Error(`${shot.file} too small: ${shot.width}x${shot.height}`);
      if (shot.width !== shot.metrics.innerWidth || shot.height !== shot.metrics.innerHeight) {
        throw new Error(`${shot.file} viewport mismatch: image=${shot.width}x${shot.height} page=${shot.metrics.innerWidth}x${shot.metrics.innerHeight}`);
      }
      if (!shot.stats.nonUniform) throw new Error(`${shot.file} is a pure-color image`);
    }
    if (new Set(rendered.map((shot) => shot.sha256)).size !== rendered.length) {
      throw new Error("review screenshots are not content-distinct");
    }

    const manifest = {
      round: Number(ROUND),
      artifact_sha256: artifactSha,
      verifier_sha256: verifierSha,
      metrics_sha256: sha256(Buffer.from(renderText)),
      shots: rendered.map((shot) => ({
        file: shot.file,
        sha256: shot.sha256,
        width: shot.width,
        height: shot.height,
      })),
      adhoc: [],
    };
    fs.writeFileSync(path.join(OUT_DIR, `manifest-r${ROUND}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) {
    renderError = error;
    console.error(`RENDER: FAIL — ${error && error.stack ? error.stack : error}`);
  }
}

process.stdout.write(hardText);
if (renderError) process.exitCode = 2;
else process.exitCode = failedH.length === 0 ? 0 : 1;

await browser.close();
await standardServer.close();
await throttledServer.close();
await slowServer.close();
