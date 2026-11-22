import http from "node:http";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { openApp } from "../lib/browser.mjs";
import { S } from "../lib/selectors.mjs";
import { check, eq, clean } from "../lib/check.mjs";
import { appState, expressionText, resultValue } from "../lib/dom.mjs";
import { compute, importText, rosterRows, utf8 } from "../lib/roster.mjs";

const FIXTURE_A = [
  "序号,学号,姓名,成绩,班级",
  "1,20230101,张三,85,高一3班",
  "2,20230102,李四,92,高一3班",
  "3,20230103,王五,78,高一3班",
].join("\r\n");

const FAKE_DURATION_MS = 2500;
const VOICE_SCRIPT_STUB = `window.SherpaOnnx = async () => ({FS:{mkdirTree(){}, FS_createDataFile(){}, writeFile(){}}});\nwindow.createOfflineTts = () => ({handle:1, generate:() => ({samples:new Float32Array(8), sampleRate:22050})});\n`;

function startServer(artifact) {
  const server = http.createServer((request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }
    if (pathname.startsWith("/voice/")) {
      const relative = pathname.slice("/voice/".length);
      const isScript = relative === "sherpa-onnx-wasm-web.js" || relative === "sherpa-onnx-tts.js";
      const body = isScript ? Buffer.from(VOICE_SCRIPT_STUB) : Buffer.alloc(2048, 0x5a);
      response.writeHead(200, { "Content-Type": isScript ? "text/javascript; charset=utf-8" : "application/octet-stream", "Content-Length": body.length });
      response.end(body);
      return;
    }
    if (pathname === "/" || pathname === "/index.html") {
      const stat = fs.statSync(artifact);
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": stat.size });
      fs.createReadStream(artifact).pipe(response);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}/index.html`,
        async close() {
          if (typeof server.closeAllConnections === "function") server.closeAllConnections();
          await new Promise((done) => server.close(done));
        },
      });
    });
  });
}

function fakeEngineScript() {
  return `window.__voiceFake = { fail: false, durationMs: ${FAKE_DURATION_MS}, generated: [] };
window.SherpaOnnx = async () => ({ FS: { mkdirTree() {}, FS_createDataFile() {}, writeFile() {} } });
window.createOfflineTts = () => ({
  handle: 1,
  sampleRate: 22050,
  generate({ text }) {
    window.__voiceFake.generated.push(String(text));
    const count = Math.round(22050 * window.__voiceFake.durationMs / 1000);
    const samples = new Float32Array(Math.max(1, count));
    for (let index = 0; index < samples.length; index += 1) samples[index] = Math.sin(index / 20) * 0.05;
    return { samples, sampleRate: 22050 };
  },
});
class FakeAudioContext {
  constructor() { this.state = "running"; this.destination = {}; }
  createBuffer(_channels, length) { return { getChannelData: () => new Float32Array(length) }; }
  createBufferSource() {
    const source = { buffer: null, connect() {}, onended: null };
    source.start = () => { setTimeout(() => { if (typeof source.onended === "function") source.onended(); }, window.__voiceFake.durationMs); };
    return source;
  }
  resume() { return Promise.resolve(); }
}
window.AudioContext = FakeAudioContext;
window.webkitAudioContext = FakeAudioContext;`;
}

async function readPlayed(page) {
  return page.evaluate(() => {
    try {
      return JSON.parse(document.querySelector("main.app").dataset.speechPlayed || "[]");
    } catch {
      return [];
    }
  });
}

export const rosterDialog = {
  id: "roster-dialog",
  async run({ browser, artifact }) {
    const checks = [];
    const settings = { voiceResult: true, autoConfirm: 0, autoEquals: 0, resultPause: 1 };
    const server = await startServer(artifact);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pageErrors = [];
    const consoleErrors = [];
    try {
      await context.addInitScript(({ stored, engine }) => {
        try { localStorage.setItem("cal-phone.settings.v1", stored); } catch {}
        // eslint-disable-next-line no-eval
        (0, eval)(engine);
      }, { stored: JSON.stringify(settings), engine: fakeEngineScript() });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on("pageerror", (error) => pageErrors.push(String(error)));
      page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
      await page.goto(server.url, { waitUntil: "load" });
      await page.waitForFunction(
        (allowed) => allowed.includes(document.querySelector("main.app")?.dataset.voiceState || ""),
        ["ready"],
        { timeout: 25000, polling: 100 },
      );

      await compute(page, "+", ["1", "1"]);
      await compute(page, "+", ["2", "2"]);
      await compute(page, "+", ["3", "3"]);
      await page.waitForFunction(() => (JSON.parse(document.querySelector("main.app").dataset.speechPlayed || "[]")).length >= 1);
      const beforeImport = await readPlayed(page);
      check(checks, "roster-dialog.voice.queued", beforeImport.length >= 1, JSON.stringify(beforeImport.length));

      await page.click('[data-testid="roster-import"]');
      await page.waitForSelector('[data-testid="import-dialog"][open]');
      await page.setInputFiles('[data-testid="roster-file"]', { name: "A.csv", mimeType: "text/csv", buffer: utf8(FIXTURE_A) });
      await page.waitForFunction(() => {
        const summary = document.querySelector('[data-testid="import-summary"]');
        return summary && !summary.hidden && summary.getAttribute("data-count") !== null;
      });
      const dialogMode = await page.locator('[data-testid="import-dialog"]').getAttribute("data-mode");
      eq(checks, "roster-dialog.voice.no-mode", dialogMode, null);
      await page.click('[data-testid="import-confirm"]');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"]').length === 3);
      const atConfirm = await readPlayed(page);
      await page.waitForTimeout(FAKE_DURATION_MS * 2 + 1000);
      const afterWait = await readPlayed(page);
      eq(checks, "roster-dialog.voice.dropped", afterWait.length, atConfirm.length, `before=${beforeImport.length} at=${atConfirm.length} after=${afterWait.length}`);
      eq(checks, "roster-dialog.voice.errors", pageErrors.length === 0 && consoleErrors.length === 0, true, [...pageErrors, ...consoleErrors].join("|"));
      await context.close();
    } catch (error) {
      await context.close().catch(() => {});
      throw error;
    } finally {
      await server.close();
    }
    return checks;
  },
};

export const rosterCompute = {
  id: "roster-compute",
  async run({ browser, artifact }) {
    const checks = [];

    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      await importText(page, "A.csv", FIXTURE_A);
      await page.evaluate(() => {
        try { localStorage.setItem("cal-phone.settings.v1", JSON.stringify({ resultPause: 1 })); } catch {}
      });
      await page.reload({ waitUntil: "load" });
      await page.waitForSelector('[data-testid="roster-row"]');
      await page.click('[data-testid="op-picker"] [data-op="+"]');
      await page.click('[data-testid="keypad"] [data-key="4"]');
      await page.click('[data-testid="keypad"] [data-key="enter"]');
      await page.click('[data-testid="key-equals"]');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length === 1);
      const pausedScore = await page.getAttribute('[data-testid="roster-row"][data-seq="1"] [data-testid="roster-score"]', "data-value");
      await page.click('[data-testid="keypad"] [data-key="7"]');
      await page.waitForTimeout(300);
      eq(checks, "roster-compute.pause.blocked", await page.getAttribute('[data-testid="roster-row"][data-seq="1"] [data-testid="roster-score"]', "data-value"), pausedScore);
      check(checks, "roster-compute.pause.label", (await page.locator("#state-label").textContent()).includes("已记录"), await page.locator("#state-label").textContent());
      await page.waitForTimeout(1200);
      await page.click('[data-testid="keypad"] [data-key="7"]');
      await page.waitForTimeout(300);
      check(checks, "roster-compute.pause.released", (await page.$eval(S.calcInput, (element) => element.value)).includes("7"), await page.$eval(S.calcInput, (element) => element.value));
      clean(checks, "roster-compute.pause.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }

    const quick = await openApp(browser, artifact);
    try {
      const { page } = quick;
      await page.evaluate(() => {
        try { localStorage.setItem("cal-phone.settings.v1", JSON.stringify({ resultPause: 0 })); } catch {}
      });
      await page.reload({ waitUntil: "load" });
      await importText(page, "A.csv", FIXTURE_A);
      check(checks, "roster-compute.pause0.present", (await rosterRows(page)).length === 3, "roster imported");
      clean(checks, "roster-compute.pause0.clean", quick.pageErrors, quick.consoleErrors);
    } finally {
      await quick.close();
    }

    const auto = await openApp(browser, artifact);
    try {
      const { page } = auto;
      await page.evaluate(() => {
        try {
          localStorage.removeItem("cal-phone.roster.v1");
          localStorage.setItem("cal-phone.settings.v1", JSON.stringify({ autoEquals: 2, resultPause: 0 }));
        } catch {}
      });
      await page.reload({ waitUntil: "load" });
      await importText(page, "A.csv", FIXTURE_A);
      await page.click('[data-testid="op-picker"] [data-op="+"]');
      await page.click('[data-testid="keypad"] [data-key="1"]');
      await page.click('[data-testid="keypad"] [data-key="0"]');
      await page.click('[data-testid="keypad"] [data-key="enter"]');
      await page.click('[data-testid="keypad"] [data-key="2"]');
      await page.click('[data-testid="keypad"] [data-key="0"]');
      await page.click('[data-testid="keypad"] [data-key="enter"]');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length === 1);
      eq(checks, "roster-compute.auto.score", await page.getAttribute('[data-testid="roster-row"][data-seq="1"] [data-testid="roster-score"]', "data-value"), "30");
      eq(checks, "roster-compute.auto.next", await page.locator('[data-testid="roster-next"]').getAttribute("data-seq"), "2");
      clean(checks, "roster-compute.auto.clean", auto.pageErrors, auto.consoleErrors);
    } finally {
      await auto.close();
    }

    const base = await openApp(browser, artifact);
    try {
      const { page } = base;
      await page.evaluate(() => {
        try {
          localStorage.removeItem("cal-phone.roster.v1");
          localStorage.setItem("cal-phone.settings.v1", JSON.stringify({ baseEnabled: true, baseValue: "100", resultPause: 0 }));
        } catch {}
      });
      await page.reload({ waitUntil: "load" });
      await importText(page, "A.csv", FIXTURE_A);
      await compute(page, "+", ["10"]);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length === 1);
      eq(checks, "roster-compute.base.score", await page.getAttribute('[data-testid="roster-row"][data-seq="1"] [data-testid="roster-score"]', "data-value"), "110");
      const stored = JSON.parse(await page.evaluate(() => localStorage.getItem("cal-phone.roster.v1")));
      eq(checks, "roster-compute.base.stored", stored.rows[0].entry.base, { value: 100, display: "100" });
      const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-testid="roster-export"]')]);
      const text = fs.readFileSync(await dl.path()).toString("utf8");
      check(checks, "roster-compute.base.export", text.includes(",110,"), text.split("\r\n")[1]);
      clean(checks, "roster-compute.base.clean", base.pageErrors, base.consoleErrors);
    } finally {
      await base.close();
    }

    return checks;
  },
};

export const scenarios = [rosterDialog, rosterCompute];
