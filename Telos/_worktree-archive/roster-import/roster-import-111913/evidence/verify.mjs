#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

process.env.PLAYWRIGHT_MODULE = process.env.PLAYWRIGHT_MODULE || "/ws/cal_phone/tests/node_modules/playwright";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_FILE);
const REPO = "/ws/cal_phone-worktrees/roster-import";
const DEFAULT_ARTIFACT = "/ws/cal_phone-worktrees/roster-import/index.html";
const TESTS = path.join(REPO, "tests");
const SUITE = path.join(TESTS, "suite.mjs");
const ROSTER_KEY = "cal-phone.roster.v1";
const ROUND = String(process.argv[2] || process.env.KEKKAI_ROUND || "1");
const HAS_OUT_ENV = Boolean(process.env.KEKKAI_OUT_DIR);

function fromScript(value) {
  return path.isAbsolute(value) ? value : path.resolve(SCRIPT_DIR, value);
}

const ARTIFACT = fromScript(process.env.KEKKAI_ARTIFACT || DEFAULT_ARTIFACT);
const OUT_DIR = HAS_OUT_ENV ? fromScript(process.env.KEKKAI_OUT_DIR) : path.join(SCRIPT_DIR, "runs");
const FIXTURE_DIR = HAS_OUT_ENV
  ? path.join(OUT_DIR, "fixtures")
  : fs.mkdtempSync(path.join(os.tmpdir(), "kekkai-roster-fixtures-"));
const SHOT_DIR = path.join(OUT_DIR, "review-shots", `r${ROUND}`);
const HARD_FILE = path.join(OUT_DIR, `hard-r${ROUND}.txt`);
const RENDER_FILE = path.join(OUT_DIR, `render-r${ROUND}.txt`);
const MANIFEST_FILE = path.join(OUT_DIR, `manifest-r${ROUND}.json`);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(FIXTURE_DIR, { recursive: true });

const { launchBrowser, openApp } = await import(path.join(TESTS, "lib/browser.mjs"));
const { S } = await import(path.join(TESTS, "lib/selectors.mjs"));
const {
  appState,
  expressionText,
  resultValue,
  resultError,
  isVisible,
  historySnapshots,
  liveOperands,
} = await import(path.join(TESTS, "lib/dom.mjs"));
const { parseCsv } = await import(path.join(TESTS, "lib/roster.mjs"));

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const sha256File = (file) => sha256(fs.readFileSync(file));
const oneLine = (value, limit = 1600) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
};
const formatError = (error) => oneLine(error && error.stack ? error.stack : error);

function deepEqual(actual, expected) {
  return isDeepStrictEqual(actual, expected);
}

function makeChecks() {
  const failures = [];
  return {
    check(id, pass, detail = "") {
      if (!pass) failures.push(`${id}: ${oneLine(detail, 500)}`);
      return Boolean(pass);
    },
    eq(id, actual, expected, detail = "") {
      const pass = deepEqual(actual, expected);
      return this.check(
        id,
        pass,
        pass ? "" : `expected=${oneLine(JSON.stringify(expected))} actual=${oneLine(JSON.stringify(actual))}${detail ? ` ${detail}` : ""}`,
      );
    },
    near(id, actual, expected, tolerance = 1e-9, detail = "") {
      const number = Number(actual);
      const pass = Number.isFinite(number) && Math.abs(number - expected) <= tolerance;
      return this.check(id, pass, pass ? "" : `expected=${expected}±${tolerance} actual=${oneLine(actual)}${detail ? ` ${detail}` : ""}`);
    },
    failures,
    failText() {
      return failures.length ? failures.join(" ; ") : "";
    },
  };
}

const pageAudit = [];
const results = [];

function resolveOutPath(value) {
  return fromScript(value);
}

async function openTracked(browser, { viewport, cdp = null, initScript = null, initArg = undefined } = {}) {
  let target = browser;
  if (cdp || initScript) {
    target = new Proxy(browser, {
      get(object, property) {
        if (property !== "newContext") return Reflect.get(object, property);
        return async (options) => {
          const context = await object.newContext(options);
          if (initScript) {
            if (initArg === undefined) await context.addInitScript(initScript);
            else await context.addInitScript(initScript, initArg);
          }
          if (cdp) {
            const originalNewPage = context.newPage.bind(context);
            context.newPage = async () => {
              const page = await originalNewPage();
              const session = await context.newCDPSession(page);
              await session.send("Emulation.setDeviceMetricsOverride", cdp);
              return page;
            };
          }
          return context;
        };
      },
    });
  }
  const options = viewport ? { viewport, isMobile: true, hasTouch: true } : {};
  const app = await openApp(target, ARTIFACT, options);
  app.page.setDefaultTimeout(60000);
  app.page.setDefaultNavigationTimeout(60000);
  pageAudit.push(app);
  return app;
}

async function closeApp(app) {
  try {
    await app.close();
  } catch {}
}

async function key(page, value) {
  await page.locator(`[data-testid="keypad"] [data-key="${value}"]`).click();
}

async function enterNumber(page, value) {
  for (const character of String(value)) await key(page, character);
  await key(page, "enter");
}

async function compute(page, operator, values) {
  await page.locator(`[data-testid="op-picker"] [data-op="${operator}"]`).click();
  for (const value of values) await enterNumber(page, value);
  await page.locator('[data-testid="key-equals"]').click();
}

async function waitResult(page, value, timeout = 60000) {
  await page.waitForFunction(
    (expected) => document.querySelector('[data-testid="result"]')?.getAttribute("data-value") === expected,
    value,
    { timeout },
  );
}

async function openImport(page) {
  await page.locator('[data-testid="roster-import"]').click();
  await page.waitForFunction(() => {
    const dialog = document.querySelector('[data-testid="import-dialog"]');
    return dialog && dialog.open;
  });
}

async function previewFile(page, filePath, expectedCount = null) {
  await page.locator('input[data-testid="roster-file"]').setInputFiles(filePath);
  await page.waitForFunction(
    (expected) => {
      const summary = document.querySelector('[data-testid="import-summary"]');
      if (!summary || summary.dataset.count === undefined) return false;
      return expected === null || Number(summary.dataset.count) === expected;
    },
    expectedCount,
  );
  return {
    count: Number(await page.locator('[data-testid="import-summary"]').getAttribute("data-count")),
    text: (await page.locator('[data-testid="import-summary"]').textContent()).trim(),
    preview: (await page.locator('[data-testid="import-preview"]').textContent()).trim(),
    columns: (await page.locator('[data-testid="import-columns"]').textContent()).trim(),
  };
}

async function confirmImport(page, count) {
  await page.locator('[data-testid="import-confirm"]').click();
  await page.waitForFunction(
    (expected) => {
      const dialog = document.querySelector('[data-testid="import-dialog"]');
      return document.querySelectorAll('[data-testid="roster-row"]').length === expected && dialog && !dialog.open;
    },
    count,
  );
}

async function importFile(page, filePath, expectedCount) {
  await openImport(page);
  const preview = await previewFile(page, filePath, expectedCount);
  await confirmImport(page, expectedCount);
  return preview;
}

async function rosterRows(page) {
  return page.$$eval('[data-testid="roster-row"]', (rows) =>
    rows.map((row) => {
      const score = row.querySelector('[data-testid="roster-score"]');
      const expression = row.querySelector('[data-testid="roster-expression"]');
      const edit = row.querySelector('[data-testid="roster-edit"]');
      return {
        seq: row.getAttribute("data-seq"),
        name: row.getAttribute("data-name"),
        id: row.getAttribute("data-id"),
        filled: row.getAttribute("data-filled"),
        score: score ? score.getAttribute("data-value") ?? score.textContent.trim() : null,
        scoreText: score ? score.textContent.trim() : null,
        expression: expression ? expression.textContent.trim() : "",
        editLabel: edit ? edit.getAttribute("aria-label") : null,
      };
    }),
  );
}

async function nextSeq(page) {
  const next = page.locator('[data-testid="roster-next"]').first();
  if ((await next.count()) === 0) return null;
  return next.getAttribute("data-seq");
}

async function nextText(page) {
  const next = page.locator('[data-testid="roster-next"]').first();
  if ((await next.count()) === 0) return null;
  return (await next.textContent()).trim();
}

async function filledCount(page) {
  return page.locator('[data-testid="roster-row"][data-filled="true"]').count();
}

async function waitFilled(page, count, timeout = 60000) {
  await page.waitForFunction(
    (expected) => document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length === expected,
    count,
    { timeout },
  );
}

async function calculatorSnapshot(page) {
  return page.evaluate(() => {
    const app = document.querySelector("main.app");
    const result = document.querySelector('[data-testid="result"]');
    return {
      state: app.dataset.state,
      operator: app.getAttribute("data-operator"),
      expression: document.querySelector('[data-testid="expression"]').textContent.trim(),
      result: result.getAttribute("data-value"),
      resultError: result.getAttribute("data-error"),
      input: document.querySelector('[data-testid="calc-input"]').value,
      editVisible: !document.querySelector('[data-testid="edit-draft"]').hidden,
    };
  });
}

async function rosterSnapshot(page) {
  return {
    rows: await rosterRows(page),
    next: await nextSeq(page),
    summary: (await page.locator('[data-testid="roster-summary"]').textContent()).trim(),
    storage: await page.evaluate((key) => localStorage.getItem(key), ROSTER_KEY),
  };
}

async function installDownloadProbe(page) {
  await page.evaluate(() => {
    if (window.__kekkaiDownloadProbe) return;
    window.__kekkaiDownloadProbe = true;
    window.__kekkaiBlobCaptures = [];
    window.__kekkaiAnchorCaptures = [];
    const originalCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const entry = { type: blob.type, bytes: null };
      window.__kekkaiBlobCaptures.push(entry);
      blob.arrayBuffer().then((buffer) => {
        entry.bytes = Array.from(new Uint8Array(buffer));
      });
      return originalCreate(blob);
    };
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function patchedClick(...args) {
      if (this.hasAttribute("download")) {
        window.__kekkaiAnchorCaptures.push({
          download: this.getAttribute("download"),
          href: this.getAttribute("href"),
        });
      }
      return originalClick.apply(this, args);
    };
  });
}

async function captureDownload(page, action, timeout = 10000) {
  await installDownloadProbe(page);
  let eventError = null;
  try {
    const [download] = await Promise.all([page.waitForEvent("download", { timeout }), action()]);
    const downloadPath = await download.path();
    if (!downloadPath) throw new Error("download path unavailable");
    const bytes = fs.readFileSync(downloadPath);
    const name = download.suggestedFilename();
    if (!bytes.length) throw new Error("download bytes empty");
    return { name, bytes, via: "download-event" };
  } catch (error) {
    eventError = error;
  }
  await page.waitForFunction(
    () => (window.__kekkaiBlobCaptures || []).some((entry) => Array.isArray(entry.bytes)) && (window.__kekkaiAnchorCaptures || []).length > 0,
    undefined,
    { timeout: 10000 },
  );
  const capture = await page.evaluate(() => {
    const blobs = window.__kekkaiBlobCaptures || [];
    const anchors = window.__kekkaiAnchorCaptures || [];
    return {
      blob: blobs.filter((entry) => Array.isArray(entry.bytes)).at(-1),
      anchor: anchors.at(-1),
    };
  });
  if (!capture.blob || !capture.anchor || !capture.anchor.download) {
    throw new Error(`download unavailable: ${formatError(eventError)}`);
  }
  return {
    name: capture.anchor.download,
    bytes: Buffer.from(capture.blob.bytes),
    via: "blob-hook",
    anchorDownload: capture.anchor.download,
  };
}

function csvEncoding(bytes) {
  const bom = [...bytes.subarray(0, 3)];
  let allLfCrlf = true;
  let lf = 0;
  let cr = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0x0a) {
      lf += 1;
      if (index === 0 || bytes[index - 1] !== 0x0d) allLfCrlf = false;
    }
    if (bytes[index] === 0x0d) cr += 1;
  }
  return { bom, allLfCrlf, lf, cr };
}

function writeFixture(name, data) {
  const file = path.join(FIXTURE_DIR, name);
  fs.writeFileSync(file, data);
  return file;
}

function makeGbk(text) {
  return execFileSync(
    "python3",
    ["-c", "import sys;sys.stdout.buffer.write(sys.stdin.buffer.read().decode('utf-8').encode('gbk'))"],
    { input: Buffer.from(text, "utf8"), timeout: 120000, maxBuffer: 10 * 1024 * 1024 },
  );
}

const fixtureText = {
  a: ["序号,学号,姓名,成绩,班级", "1,20230101,张三,85,高一3班", "2,20230102,李四,92,高一3班", "3,20230103,王五,78,高一3班"].join("\r\n"),
  b: ["学号;名字;班级", "20230104;赵六;高二1班", "20230105;钱七;高二1班"].join("\n"),
  c: ["考号\t姓名\t得分", "20230106\t孙八\t88", "20230107\t周九\t91"].join("\n"),
  missingId: ["姓名,班级", "吴十,高三1班"].join("\n"),
  missingName: ["学号,备注", "20230108,无姓名"].join("\n"),
  extra: ["姓名,名字,学号,班级", "张三,小三,20230101,高一3班"].join("\n"),
  quoted: ['姓名,学号,备注', '"张,三",20230101,"含,逗号"', '"李""四",20230102,"含\n换行"'].join("\n"),
  missingSeq: ["学号,姓名,班级", "20230109,周五,高三2班"].join("\n"),
  missingScore: ["学号,姓名", "20230110,郑十"].join("\n"),
  synonymExport: ["姓名,名字,学号", "张三,小三,20230101"].join("\n"),
  five: ["学号,姓名", "20230111,甲一", "20230112,乙二", "20230113,李四", "20230114,丁四", "20230115,戊五"].join("\n"),
  mixedThree: ["学号,姓名", "20230101,张三", "20230102,王五", "20230103,李四"].join("\n"),
};

let F = {};

function createFixtures() {
  F = {
    a: writeFixture("高一3班.csv", Buffer.from(`\uFEFF${fixtureText.a}`, "utf8")),
    b: writeFixture("fixture-b.csv", Buffer.from(fixtureText.b, "utf8")),
    c: writeFixture("fixture-c.tsv", makeGbk(fixtureText.c)),
    missingId: writeFixture("fixture-missing-id.csv", Buffer.from(fixtureText.missingId, "utf8")),
    missingName: writeFixture("fixture-missing-name.csv", Buffer.from(fixtureText.missingName, "utf8")),
    extra: writeFixture("fixture-extra-synonym.csv", Buffer.from(fixtureText.extra, "utf8")),
    quoted: writeFixture("fixture-quoted.csv", Buffer.from(fixtureText.quoted, "utf8")),
    missingSeq: writeFixture("fixture-missing-seq.csv", Buffer.from(fixtureText.missingSeq, "utf8")),
    missingScore: writeFixture("fixture-missing-score.csv", Buffer.from(fixtureText.missingScore, "utf8")),
    synonymExport: writeFixture("fixture-synonym-export.csv", Buffer.from(fixtureText.synonymExport, "utf8")),
    five: writeFixture("fixture-five.csv", Buffer.from(fixtureText.five, "utf8")),
    mixedThree: writeFixture("fixture-mixed-three.csv", Buffer.from(fixtureText.mixedThree, "utf8")),
    zero: writeFixture("reject-zero.csv", Buffer.alloc(0)),
    blank: writeFixture("reject-blank.csv", Buffer.from("\n\n", "utf8")),
    dataFirst: writeFixture("reject-data-first.csv", Buffer.from("张三,20230101\n", "utf8")),
    noIdentity: writeFixture("reject-no-identity.csv", Buffer.from("班级,成绩\n高一3班,88\n", "utf8")),
    binary: writeFixture("reject-binary.csv", Buffer.from([0xff, 0xfe, 0x00, 0x01, 0xff])),
  };
  const fifty = ["学号,姓名"];
  for (let index = 1; index <= 50; index += 1) {
    fifty.push(`50${String(index).padStart(3, "0")},学生${index}`);
  }
  F.fifty = writeFixture("fixture-fifty.csv", Buffer.from(fifty.join("\n"), "utf8"));
}

async function h1(browser) {
  const c = makeChecks();
  const metrics = [];
  const cases = [
    ["A", F.a, 3],
    ["B", F.b, 2],
    ["C", F.c, 2],
    ["missing-id", F.missingId, 1],
    ["missing-name", F.missingName, 1],
    ["extra-synonym", F.extra, 1],
    ["quoted", F.quoted, 2],
  ];
  for (const [label, file, count] of cases) {
    const app = await openTracked(browser);
    try {
      const { page } = app;
      await openImport(page);
      const preview = await previewFile(page, file, count);
      c.eq(`${label}.preview-count`, preview.count, count);
      c.check(`${label}.preview-text`, preview.text.length > 0 && preview.preview.length > 0, `summary=${preview.text} preview=${preview.preview}`);
      await confirmImport(page, count);
      const rows = await rosterRows(page);
      c.eq(`${label}.row-count`, rows.length, count);
      c.eq(`${label}.seq`, rows.map((row) => row.seq), Array.from({ length: count }, (_, index) => String(index + 1)));
      c.eq(`${label}.filled`, rows.every((row) => row.filled === "false"), true);
      if (label === "A") {
        c.eq("A.names", rows.map((row) => row.name), ["张三", "李四", "王五"]);
        c.eq("A.ids", rows.map((row) => row.id), ["20230101", "20230102", "20230103"]);
      } else if (label === "B") {
        c.eq("B.names-ids", rows.map((row) => [row.name, row.id]), [["赵六", "20230104"], ["钱七", "20230105"]]);
      } else if (label === "C") {
        c.eq("C.names-ids", rows.map((row) => [row.name, row.id]), [["孙八", "20230106"], ["周九", "20230107"]]);
      } else if (label === "missing-id") {
        c.eq("missing-id.row", [rows[0].name, rows[0].id], ["吴十", ""]);
      } else if (label === "missing-name") {
        c.eq("missing-name.row", [rows[0].name, rows[0].id], ["", "20230108"]);
      } else if (label === "extra-synonym") {
        c.eq("extra-synonym.primary", [rows[0].name, rows[0].id], ["张三", "20230101"]);
        const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), ROSTER_KEY);
        c.eq("extra-synonym.headers", stored.headers, ["姓名", "名字", "学号", "班级"]);
        c.eq("extra-synonym.extra", stored.rows[0].extra, ["小三", "高一3班"]);
      } else if (label === "quoted") {
        c.eq("quoted.names", rows.map((row) => row.name), ["张,三", '李"四']);
        const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), ROSTER_KEY);
        c.eq("quoted.extra", stored.rows.map((row) => row.extra), [["含,逗号"], ["含\n换行"]]);
      }
      metrics.push(`${label}:${preview.count}/${rows.map((row) => row.name || row.id).join("|")}`);
    } finally {
      await closeApp(app);
    }
  }

  const rejects = [
    ["zero", F.zero],
    ["blank", F.blank],
    ["data-first", F.dataFirst],
    ["no-identity", F.noIdentity],
    ["binary", F.binary],
  ];
  let rejectApp = null;
  for (const [label, file] of rejects) {
    const app = await openTracked(browser);
    rejectApp = app;
    try {
      const { page } = app;
      await openImport(page);
      await page.locator('input[data-testid="roster-file"]').setInputFiles(file);
      await page.waitForFunction(() => {
        const dialog = document.querySelector('[data-testid="import-dialog"]');
        return dialog && dialog.dataset.error === "true";
      });
      const state = await page.evaluate(() => {
        const dialog = document.querySelector('[data-testid="import-dialog"]');
        const summary = document.querySelector('[data-testid="import-summary"]');
        return {
          open: dialog.open,
          error: dialog.getAttribute("data-error"),
          count: summary.getAttribute("data-count"),
          rows: document.querySelectorAll('[data-testid="roster-row"]').length,
          storage: localStorage.getItem("cal-phone.roster.v1"),
        };
      });
      c.eq(`reject-${label}.error`, state.error, "true");
      c.eq(`reject-${label}.open`, state.open, true);
      c.eq(`reject-${label}.count-absent`, state.count, null);
      c.eq(`reject-${label}.rows`, state.rows, 0);
      c.eq(`reject-${label}.storage`, state.storage, null);
      if (label === "binary") {
        await previewFile(page, F.a, 3);
        await confirmImport(page, 3);
        c.eq("reselect.rows", (await rosterRows(page)).length, 3);
      }
    } finally {
      await closeApp(app);
    }
  }

  const sampleApp = await openTracked(browser);
  try {
    const { page } = sampleApp;
    await openImport(page);
    const download = await captureDownload(page, () => page.locator('[data-testid="import-sample"]').click());
    fs.writeFileSync(path.join(FIXTURE_DIR, "sample-download.csv"), download.bytes);
    const encoding = csvEncoding(download.bytes);
    const sampleText = download.bytes.subarray(3).toString("utf8");
    const sampleLines = sampleText.split(/\r\n|\n/).filter((line) => line.length > 0);
    c.eq("sample.bom", encoding.bom, [0xef, 0xbb, 0xbf]);
    c.check("sample.lines", sampleLines.length >= 4, `lines=${sampleLines.length}`);
    metrics.push(`sample:${download.name}/${encoding.bom.map((byte) => byte.toString(16).padStart(2, "0")).join("")}/${sampleLines.length}lines/${download.via}`);
  } finally {
    await closeApp(sampleApp);
  }

  return {
    pass: c.failures.length === 0,
    detail: c.failures.length
      ? c.failText()
      : `${metrics.join(", ")}; rejects=5(data-error=true,count=null,rows=0,storage=null); reselect=3`,
  };
}

async function h2(browser) {
  const c = makeChecks();
  const app = await openTracked(browser);
  try {
    const { page } = app;
    await compute(page, "+", ["12", "30", "8"]);
    await waitResult(page, "50");
    await compute(page, "*", ["2", "3", "4"]);
    await waitResult(page, "24");
    const before = await calculatorSnapshot(page);
    c.eq("before.result", before.result, "24");
    c.eq("before.state", before.state, "result");
    c.check("before.operator", Boolean(before.operator), `operator=${before.operator}`);
    const preview = await importFile(page, F.a, 3);
    const rows = await rosterRows(page);
    const summary = (await page.locator('[data-testid="roster-summary"]').textContent()).trim();
    const after = await calculatorSnapshot(page);
    c.eq("confirm.preview", preview.count, 3);
    c.eq("confirm.rows", rows.length, 3);
    c.eq("confirm.filled", rows.map((row) => row.filled), ["false", "false", "false"]);
    c.check("confirm.summary", summary.includes("已录 0"), summary);
    c.eq("confirm.next", await nextSeq(page), "1");
    c.eq("confirm.state", after.state, "select");
    c.eq("confirm.operator", after.operator, null);
    c.eq("confirm.expression", after.expression, "");
    c.eq("confirm.result", after.result, null);
    c.eq("confirm.input", after.input, "");
    c.eq("confirm.edit-hidden", after.editVisible, false);
    c.eq("confirm.history", await page.locator(S.historyItem).count(), 0);
  } finally {
    await closeApp(app);
  }

  const cancelApp = await openTracked(browser);
  try {
    const { page } = cancelApp;
    await compute(page, "+", ["12", "30", "8"]);
    await waitResult(page, "50");
    await compute(page, "*", ["2", "3", "4"]);
    await waitResult(page, "24");
    const before = await calculatorSnapshot(page);
    const historyBefore = await page.locator(S.historyItem).count();
    await openImport(page);
    await previewFile(page, F.a, 3);
    await page.locator('[data-testid="import-cancel"]').click();
    await page.waitForFunction(() => !document.querySelector('[data-testid="import-dialog"]').open);
    const afterCancel = await calculatorSnapshot(page);
    c.eq("cancel.calc", afterCancel, before);
    c.eq("cancel.history", await page.locator(S.historyItem).count(), historyBefore);
    c.eq("cancel.no-roster", await page.locator('[data-testid="roster"]').isVisible(), false);

    await openImport(page);
    await previewFile(page, F.a, 3);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector('[data-testid="import-dialog"]').open);
    const afterEscape = await calculatorSnapshot(page);
    c.eq("escape.calc", afterEscape, before);
    c.eq("escape.history", await page.locator(S.historyItem).count(), historyBefore);
    c.eq("escape.no-roster", await page.locator('[data-testid="roster"]').isVisible(), false);
  } finally {
    await closeApp(cancelApp);
  }
  return {
    pass: c.failures.length === 0,
    detail: c.failures.length
      ? c.failText()
      : `confirm=3/all-false/summary-已录0/next=1/select/no-operator/empty-expression/result=null/input-empty/edit-hidden/history=0; cancel+Esc preserve result24/operator/expression/input/2-history, no-roster`,
  };
}

async function h3(browser) {
  const c = makeChecks();
  const app = await openTracked(browser);
  try {
    const { page } = app;
    await importFile(page, F.a, 3);
    await compute(page, "/", ["5", "0"]);
    await page.waitForFunction(() => document.querySelector('[data-testid="result"]')?.getAttribute("data-error") === "true");
    c.eq("divzero.error", await resultError(page), "true");
    c.eq("divzero.filled", await filledCount(page), 0);
    c.eq("divzero.next", await nextSeq(page), "1");
    await page.locator(S.equals).click();
    c.eq("empty.filled", await filledCount(page), 0);
    c.eq("empty.next", await nextSeq(page), "1");

    const sequence = [
      [["10", "20"], "30", "2"],
      [["3", "4"], "7", "3"],
      [["5", "6"], "11", null],
    ];
    const fills = [];
    for (let index = 0; index < sequence.length; index += 1) {
      const [values, score, next] = sequence[index];
      await compute(page, "+", values);
      await waitFilled(page, index + 1);
      const rows = await rosterRows(page);
      const summary = (await page.locator('[data-testid="roster-summary"]').textContent()).trim();
      const label = (await page.locator("#state-label").textContent()).trim();
      c.eq(`fill${index + 1}.scores`, rows.map((row) => row.score), index === 0 ? ["30", "—", "—"] : index === 1 ? ["30", "7", "—"] : ["30", "7", "11"]);
      c.eq(`fill${index + 1}.names`, rows.map((row) => row.name), ["张三", "李四", "王五"]);
      c.eq(`fill${index + 1}.next`, await nextSeq(page), next);
      c.check(`fill${index + 1}.summary`, summary.includes(`已录 ${index + 1}`), summary);
      c.check(`fill${index + 1}.label`, label.length > 0, label);
      fills.push(`${score}@${index + 1}->next:${next ?? "none"}`);
    }
    const fullRows = await rosterRows(page);
    const fullSummary = (await page.locator('[data-testid="roster-summary"]').textContent()).trim();
    const fullLabel = (await page.locator("#state-label").textContent()).trim();
    c.check("full.summary", fullSummary.includes("名单已录满"), fullSummary);
    c.check("full.label", fullLabel.includes("名单已录满"), fullLabel);
    await compute(page, "+", ["1", "1"]);
    await waitResult(page, "2");
    c.eq("extra.result", await resultValue(page), "2");
    c.eq("extra.rows", (await rosterRows(page)).map((row) => row.score), fullRows.map((row) => row.score));
    c.eq("extra.row-count", (await rosterRows(page)).length, 3);
    return {
      pass: c.failures.length === 0,
      detail: c.failures.length
        ? c.failText()
        : `5/0->error(filled0,next1); empty=->filled0,next1; fills=${fills.join(", ")}; full=3rows/30,7,11/no-next/summary+label-名单已录满; extra1+1=2 leaves rows/scores unchanged`,
    };
  } finally {
    await closeApp(app);
  }
}

function rowCore(row) {
  return [row.seq, row.name, row.id, row.filled, row.score, row.expression];
}

async function h4(browser) {
  const c = makeChecks();
  const app = await openTracked(browser);
  try {
    const { page } = app;
    await importFile(page, F.a, 3);
    await compute(page, "+", ["12", "30", "8"]);
    await compute(page, "+", ["9", "1"]);
    await compute(page, "+", ["5", "5"]);
    await waitFilled(page, 3);
    const before = await rosterRows(page);
    c.eq("before.scores", before.map((row) => row.score), ["50", "10", "10"]);
    const stableFirst = rowCore(before[0]);
    const stableThird = rowCore(before[2]);
    await page.locator('[data-testid="roster-row"][data-seq="2"] [data-testid="roster-edit"]').click();
    await page.waitForFunction(() => {
      const draft = document.querySelector('[data-testid="edit-draft"]');
      return !draft.hidden && document.querySelector("main.app").dataset.state === "edit";
    });
    c.eq("edit.draft-visible", await isVisible(page, S.editDraft), true);
    const editLabel = (await page.locator("#state-label").textContent()).trim();
    c.check("edit.label", editLabel.includes("李四"), editLabel);
    await page.locator(S.operandInput).first().fill("7");
    await page.locator(S.equals).click();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="roster-row"][data-seq="2"] [data-testid="roster-score"]')?.getAttribute("data-value") === "8",
    );
    const after = await rosterRows(page);
    c.eq("after.count", after.length, 3);
    c.eq("after.second", [after[1].seq, after[1].name, after[1].score], ["2", "李四", "8"]);
    c.check("after.expression", after[1].expression.includes("7"), after[1].expression);
    c.eq("after.first-stable", rowCore(after[0]), stableFirst);
    c.eq("after.third-stable", rowCore(after[2]), stableThird);
    c.eq("after.no-next", await page.locator('[data-testid="roster-next"]').count(), 0);

    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"]').length === 3);
    const reloaded = await rosterRows(page);
    c.eq("reload.second", [reloaded[1].seq, reloaded[1].name, reloaded[1].score], ["2", "李四", "8"]);

    await page.locator('[data-testid="roster-row"][data-seq="2"] [data-testid="roster-edit"]').click();
    await page.waitForFunction(() => document.querySelector("main.app").dataset.state === "edit");
    await page.locator(S.operandInput).first().fill("11");
    await page.locator(S.editCancel).click();
    await page.waitForFunction(() => {
      const row = document.querySelector('[data-testid="roster-row"][data-seq="2"]');
      return row && document.activeElement === row.querySelector('[data-testid="roster-edit"]');
    });
    c.eq("cancel.score", (await rosterRows(page))[1].score, "8");
    c.eq("cancel.draft-hidden", await isVisible(page, S.editDraft), false);
    c.eq("cancel.focus-row2", await page.evaluate(() => document.activeElement?.closest('[data-testid="roster-row"]')?.getAttribute("data-seq")), "2");
  } finally {
    await closeApp(app);
  }

  const partial = await openTracked(browser);
  try {
    const { page } = partial;
    await importFile(page, F.five, 5);
    await compute(page, "+", ["12", "30", "8"]);
    await compute(page, "+", ["9", "1"]);
    await waitFilled(page, 2);
    await page.locator('[data-testid="roster-row"][data-seq="1"] [data-testid="roster-edit"]').click();
    await page.waitForFunction(() => document.querySelector("main.app").dataset.state === "edit");
    await page.locator(S.operandInput).first().fill("20");
    await page.locator(S.equals).click();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="roster-row"][data-seq="1"] [data-testid="roster-score"]')?.getAttribute("data-value") === "58",
    );
    c.eq("partial.rows", await page.locator('[data-testid="roster-row"]').count(), 5);
    c.eq("partial.filled", await filledCount(page), 2);
    c.eq("partial.next", await nextSeq(page), "3");
  } finally {
    await closeApp(partial);
  }

  const many = await openTracked(browser);
  let manySummary = "";
  try {
    const { page } = many;
    await importFile(page, F.fifty, 50);
    for (let index = 0; index < 50; index += 1) await compute(page, "+", ["10", "10"]);
    await waitFilled(page, 50, 90000);
    manySummary = `filled=${await filledCount(page)}`;
    await page.evaluate(() => document.querySelectorAll('[data-testid="roster-row"]')[49].scrollIntoView());
    await page.locator('[data-testid="roster-row"][data-seq="50"] [data-testid="roster-edit"]').click();
    await page.waitForFunction(() => !document.querySelector('[data-testid="edit-draft"]').hidden);
    const rect = await page.locator(S.editDraft).evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, viewport: window.innerHeight };
    });
    c.check("many.draft-in-viewport", rect.top >= -0.5 && rect.bottom <= rect.viewport + 0.5, JSON.stringify(rect));
    await page.locator(S.editCancel).click();
    await page.waitForFunction(() => {
      const row = document.querySelector('[data-testid="roster-row"][data-seq="50"]');
      return row && document.activeElement === row.querySelector('[data-testid="roster-edit"]');
    });
    c.eq("many.cancel-focus", await page.evaluate(() => {
      const active = document.activeElement;
      return {
        testid: active?.getAttribute("data-testid"),
        seq: active?.closest('[data-testid="roster-row"]')?.getAttribute("data-seq"),
      };
    }), { testid: "roster-edit", seq: "50" });
    c.eq("many.cancel-score", (await rosterRows(page))[49].score, "20");
  } finally {
    await closeApp(many);
  }

  return {
    pass: c.failures.length === 0,
    detail: c.failures.length
      ? c.failText()
      : `3-fill edit seq2 10->8, expression contains 7, first/third unchanged, reload=8, cancel keeps 8/focus row2; 5-person filled=2/next=3; ${manySummary}/draft-in-viewport/cancel-focus-row50`,
  };
}

async function h5(browser) {
  const c = makeChecks();
  const app = await openTracked(browser);
  try {
    const { page } = app;
    await importFile(page, F.a, 3);
    const rows = await rosterRows(page);
    const visibleSeq = await page.$$eval('[data-testid="roster-row"] .roster-seq', (nodes) => nodes.map((node) => node.textContent.trim()));
    c.eq("roster.seq", rows.map((row) => row.seq), ["1", "2", "3"]);
    c.eq("roster.visible-seq", visibleSeq, ["1", "2", "3"]);
  } finally {
    await closeApp(app);
  }

  const legacy = await openTracked(browser);
  try {
    const { page } = legacy;
    await compute(page, "+", ["12", "30", "8"]);
    await waitResult(page, "50");
    await compute(page, "+", ["3", "4"]);
    await waitResult(page, "7");
    const before = await historySnapshots(page);
    c.eq("history.seq-absent", await page.$$eval(S.historyItem, (items) => items.map((item) => item.hasAttribute("data-seq"))), [false, false]);
    c.eq("history.latest-first", before.map((item) => item.result), ["7", "50"]);
    await page.locator(S.historyItem).nth(1).locator(S.historyEdit).click();
    await page.waitForFunction(() => document.querySelector("main.app").dataset.state === "edit");
    await page.locator(S.operandInput).nth(1).fill("5");
    await page.locator(S.equals).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="history-item"]').length === 3);
    const after = await historySnapshots(page);
    c.eq("history.after.count", after.length, 3);
    c.eq("history.original-preserved", after.slice(1), before);
    c.eq("history.appended-first", after[0].result, "25");
  } finally {
    await closeApp(legacy);
  }
  return {
    pass: c.failures.length === 0,
    detail: c.failures.length
      ? c.failText()
      : `roster data-seq/visible=1,2,3; no-roster history data-seq absent, results 7,50 newest-first; edit older 30->5 => 3 items, originals unchanged`,
  };
}

async function h6(browser) {
  const c = makeChecks();
  const app = await openTracked(browser);
  let exportedABytes = null;
  let exportedAName = "";
  try {
    const { page } = app;
    await importFile(page, F.a, 3);
    await compute(page, "+", ["12", "30", "8"]);
    await compute(page, "+", ["9", "1"]);
    await waitFilled(page, 2);
    const beforeRoster = await rosterSnapshot(page);
    const beforeCalc = await calculatorSnapshot(page);
    const download = await captureDownload(page, () => page.locator('[data-testid="roster-export"]').click());
    exportedABytes = download.bytes;
    exportedAName = download.name;
    const afterRoster = await rosterSnapshot(page);
    const afterCalc = await calculatorSnapshot(page);
    const now = new Date();
    const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const encoding = csvEncoding(download.bytes);
    const parsed = parseCsv(download.bytes.toString("utf8"));
    c.eq("a.name", download.name, `高一3班-成绩-${date}.csv`);
    c.eq("a.bom", encoding.bom, [0xef, 0xbb, 0xbf]);
    c.check("a.crlf", encoding.allLfCrlf && encoding.lf === encoding.cr, `lf=${encoding.lf} cr=${encoding.cr}`);
    c.eq("a.header", parsed[0], ["序号", "学号", "姓名", "成绩", "班级"]);
    c.eq("a.rows", parsed.slice(1), [
      ["1", "20230101", "张三", "50", "高一3班"],
      ["2", "20230102", "李四", "10", "高一3班"],
      ["3", "20230103", "王五", "", "高一3班"],
    ]);
    c.eq("a.no-side-effects.roster", afterRoster, beforeRoster);
    c.eq("a.no-side-effects.calc", afterCalc, beforeCalc);
    fs.writeFileSync(path.join(FIXTURE_DIR, "fixture-a-export.csv"), download.bytes);

    await importFile(page, F.missingSeq, 1);
    const missingSeqBeforeRoster = await rosterSnapshot(page);
    const missingSeqBeforeCalc = await calculatorSnapshot(page);
    const missingSeq = await captureDownload(page, () => page.locator('[data-testid="roster-export"]').click());
    const missingSeqRows = parseCsv(missingSeq.bytes.toString("utf8"));
    c.eq("missing-seq.header", missingSeqRows[0], ["序号", "学号", "姓名", "班级", "成绩"]);
    c.eq("missing-seq.row", missingSeqRows[1], ["1", "20230109", "周五", "高三2班", ""]);
    c.eq("missing-seq.no-side-effects", [await rosterSnapshot(page), await calculatorSnapshot(page)], [missingSeqBeforeRoster, missingSeqBeforeCalc]);

    await importFile(page, F.missingScore, 1);
    const missingScore = await captureDownload(page, () => page.locator('[data-testid="roster-export"]').click());
    const missingScoreRows = parseCsv(missingScore.bytes.toString("utf8"));
    c.eq("missing-score.header", missingScoreRows[0], ["序号", "学号", "姓名", "成绩"]);
    c.eq("missing-score.row", missingScoreRows[1], ["1", "20230110", "郑十", ""]);

    await importFile(page, F.synonymExport, 1);
    const synonym = await captureDownload(page, () => page.locator('[data-testid="roster-export"]').click());
    const synonymRows = parseCsv(synonym.bytes.toString("utf8"));
    c.eq("synonym.header", synonymRows[0], ["序号", "姓名", "名字", "学号", "成绩"]);
    c.eq("synonym.row", synonymRows[1], ["1", "张三", "小三", "20230101", ""]);

    await importFile(page, F.quoted, 2);
    await compute(page, "+", ["4", "6"]);
    await waitFilled(page, 1);
    const quoted = await captureDownload(page, () => page.locator('[data-testid="roster-export"]').click());
    const quotedRows = parseCsv(quoted.bytes.toString("utf8"));
    c.eq("quoted.header", quotedRows[0], ["序号", "姓名", "学号", "备注", "成绩"]);
    c.eq("quoted.first", quotedRows[1], ["1", "张,三", "20230101", "含,逗号", "10"]);
    c.eq("quoted.second", quotedRows[2], ["2", '李"四', "20230102", "含\n换行", ""]);

    const reimport = await openTracked(browser);
    try {
      const page2 = reimport.page;
      const preview = await importFile(page2, path.join(FIXTURE_DIR, "fixture-a-export.csv"), 3);
      const rows = await rosterRows(page2);
      c.eq("reimport.count", preview.count, 3);
      c.eq("reimport.people", rows.map((row) => [row.name, row.id]), [
        ["张三", "20230101"],
        ["李四", "20230102"],
        ["王五", "20230103"],
      ]);
      c.eq("reimport.filled", rows.map((row) => row.filled), ["false", "false", "false"]);
    } finally {
      await closeApp(reimport);
    }
    return {
      pass: c.failures.length === 0,
      detail: c.failures.length
        ? c.failText()
        : `A=${exportedAName}/${download.via}/BOM/CRLF/header+3rows/no-side-effects; missing-seq=序号-first/成绩-last; missing-score=成绩-last; synonyms=姓名+名字 retained; quoted=RFC4180 comma/quote/newline; reimport=3 people all filled=false`,
    };
  } finally {
    await closeApp(app);
  }
}

async function h7(browser) {
  const c = makeChecks();
  const app = await openTracked(browser);
  try {
    const { page } = app;
    await importFile(page, F.a, 3);
    await compute(page, "+", ["12", "30", "8"]);
    await waitResult(page, "50");
    await compute(page, "+", ["3", "4"]);
    await waitResult(page, "7");
    await waitFilled(page, 2);
    const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), ROSTER_KEY);
    c.eq("stored.version", stored.version, 1);
    c.eq("stored.file", stored.fileName, "高一3班.csv");
    c.eq("stored.headers", stored.headers, ["序号", "学号", "姓名", "成绩", "班级"]);
    c.eq("stored.rows", stored.rows.length, 3);
    c.eq("stored.row1.entry", stored.rows[0].entry, {
      seq: 1,
      operator: "+",
      operands: [
        { value: 12, display: "12" },
        { value: 30, display: "30" },
        { value: 8, display: "8" },
      ],
      base: null,
      expression: "12 + 30 + 8",
      result: 50,
    });
    c.eq("stored.row2.summary", {
      seq: stored.rows[1].entry?.seq,
      operator: stored.rows[1].entry?.operator,
      operands: stored.rows[1].entry?.operands?.map((operand) => operand.display),
      result: stored.rows[1].entry?.result,
    }, { seq: 2, operator: "+", operands: ["3", "4"], result: 7 });
    c.eq("stored.row3.empty", stored.rows[2].entry, null);
    const pageRows = await rosterRows(page);
    c.eq("stored.matches-page", stored.rows.slice(0, 2).map((row) => [row.entry.seq, row.entry.expression, row.entry.result]), pageRows.slice(0, 2).map((row) => [Number(row.seq), row.expression, Number(row.score)]));
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"]').length === 3);
    const reloadRows = await rosterRows(page);
    c.eq("reload.filled", reloadRows.map((row) => row.filled), ["true", "true", "false"]);
    c.eq("reload.scores", reloadRows.map((row) => row.score), ["50", "7", "—"]);
    c.eq("reload.next", await nextSeq(page), "3");
    c.eq("reload.state", await appState(page), "select");
    c.eq("reload.input", await page.locator(S.calcInput).inputValue(), "");
    c.eq("reload.expression", await expressionText(page), "");
    c.eq("reload.result", await resultValue(page), null);

    let dialogText = "";
    page.once("dialog", async (dialog) => {
      dialogText = dialog.message();
      await dialog.accept();
    });
    await page.locator('[data-testid="roster-clear"]').click();
    const confirmButton = page.locator('[data-testid="roster-clear-confirm"]');
    if (await confirmButton.count()) await confirmButton.click();
    await page.waitForFunction(() => {
      const roster = document.querySelector('[data-testid="roster"]');
      return roster && roster.hidden;
    });
    c.check("clear.dialog", dialogText.includes("2 条成绩"), dialogText || "no-native-dialog");
    c.eq("clear.storage", await page.evaluate((key) => localStorage.getItem(key), ROSTER_KEY), null);
    c.eq("clear.roster-visible", await page.locator('[data-testid="roster"]').isVisible(), false);
    c.eq("clear.history", await page.locator(S.historyItem).count(), 0);
    c.eq("clear.state", await appState(page), "select");
    await page.reload({ waitUntil: "load" });
    c.eq("clear.reload.storage", await page.evaluate((key) => localStorage.getItem(key), ROSTER_KEY), null);
    c.eq("clear.reload.roster", await page.locator('[data-testid="roster"]').isVisible(), false);
    c.eq("clear.reload.history", await page.locator(S.historyItem).count(), 0);
  } finally {
    await closeApp(app);
  }

  const unavailable = await openTracked(browser, {
    initScript: () => {
      Storage.prototype.getItem = () => {
        throw new Error("blocked");
      };
      Storage.prototype.setItem = () => {
        throw new Error("blocked");
      };
    },
  });
  try {
    const { page } = unavailable;
    await importFile(page, F.a, 3);
    await compute(page, "+", ["12", "30", "8"]);
    await waitFilled(page, 1);
    c.eq("unavailable.score", (await rosterRows(page))[0].score, "50");
    const warning = page.locator("#storage-warning");
    c.eq("unavailable.warning-visible", await warning.isVisible(), true);
    c.check("unavailable.warning-text", (await warning.textContent()).includes("本机存储不可用，刷新会丢失成绩。"), await warning.textContent());
    c.eq("unavailable.pageerrors", unavailable.pageErrors.length, 0, unavailable.pageErrors.join(" | "));
  } finally {
    await closeApp(unavailable);
  }

  for (const [label, raw] of [["bad-json", "{bad"], ["unknown-version", '{"version":99}']]) {
    const malformed = await openTracked(browser, {
      initScript: (value) => localStorage.setItem("cal-phone.roster.v1", value),
      initArg: raw,
    });
    try {
      const { page } = malformed;
      c.eq(`${label}.no-roster`, await page.locator('[data-testid="roster"]').isVisible(), false);
      c.eq(`${label}.preserved`, await page.evaluate((key) => localStorage.getItem(key), ROSTER_KEY), raw);
      c.eq(`${label}.pageerrors`, malformed.pageErrors.length, 0, malformed.pageErrors.join(" | "));
    } finally {
      await closeApp(malformed);
    }
  }

  return {
    pass: c.failures.length === 0,
    detail: c.failures.length
      ? c.failText()
      : `stored v1 rows=3 seq1 12+30+8=50, seq2 3+4=7, seq3 empty (sequential-fill-consistent reading of literal row0=null; H3 requires seq1 first); reload 50/7/empty next3 select/input+expression+result empty; clear removes key/roster/history and survives reload; Storage throw -> score50 + warning + 0 pageerrors; {bad}/version99 ignored/preserved + 0 pageerrors`,
  };
}

async function waitLayoutStable(page) {
  await page.waitForFunction(() => document.fonts.status === "loaded");
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0;
        const next = () => {
          frames += 1;
          if (frames >= 2) resolve();
          else requestAnimationFrame(next);
        };
        requestAnimationFrame(next);
      }),
  );
}

async function collectLayout(page) {
  await waitLayoutStable(page);
  return page.evaluate(() => {
    const box = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        top: Number(rect.top.toFixed(4)),
        right: Number(rect.right.toFixed(4)),
        bottom: Number(rect.bottom.toFixed(4)),
        left: Number(rect.left.toFixed(4)),
        width: Number(rect.width.toFixed(4)),
        height: Number(rect.height.toFixed(4)),
      };
    };
    const visible = (element) => !element.disabled && element.getClientRects().length > 0;
    const controls = [...document.querySelectorAll("input,button")]
      .filter(visible)
      .map((element) => ({
        tag: element.tagName,
        testid: element.getAttribute("data-testid"),
        key: element.getAttribute("data-key"),
        op: element.getAttribute("data-op"),
        box: box(element),
        fontSize: parseFloat(getComputedStyle(element).fontSize),
      }));
    const inputs = controls.filter((control) => control.tag === "INPUT");
    const rows = [...document.querySelectorAll('[data-testid="roster-row"]')];
    const roster = document.querySelector('[data-testid="roster"]');
    const firstRow = rows[0] || null;
    const thirdEdit = rows[2]?.querySelector('[data-testid="roster-edit"]') || null;
    const importButton = document.querySelector('[data-testid="roster-import"]');
    const inputFonts = inputs.map((control) => control.fontSize);
    const rowFonts = rows.map((row) => parseFloat(getComputedStyle(row).fontSize));
    const scoreFonts = [...document.querySelectorAll('[data-testid="roster-score"]')].map((element) =>
      parseFloat(getComputedStyle(element).fontSize),
    );
    const expressionFonts = [...document.querySelectorAll('[data-testid="roster-expression"]')].map((element) =>
      parseFloat(getComputedStyle(element).fontSize),
    );
    const next = document.querySelector('[data-testid="roster-next"]');
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      controls,
      minControlWidth: controls.length ? Math.min(...controls.map((control) => control.box.width)) : null,
      minControlHeight: controls.length ? Math.min(...controls.map((control) => control.box.height)) : null,
      minInputFont: inputFonts.length ? Math.min(...inputFonts) : null,
      minRowFont: rowFonts.length ? Math.min(...rowFonts) : null,
      minScoreFont: scoreFonts.length ? Math.min(...scoreFonts) : null,
      minExpressionFont: expressionFonts.length ? Math.min(...expressionFonts) : null,
      rows: rows.length,
      filled: rows.filter((row) => row.getAttribute("data-filled") === "true").length,
      rosterTag: roster?.tagName || null,
      rosterRole: roster?.getAttribute("role") || null,
      rosterMatches: roster ? roster.matches('[role="list"],table,ul') : false,
      rowTags: rows.map((row) => row.tagName),
      rowRoles: rows.map((row) => row.getAttribute("role")),
      rowsMatch: rows.every((row) => row.matches("article,li,tr,[role=listitem]")),
      thirdEditLabel: thirdEdit?.getAttribute("aria-label") || null,
      nextText: next?.textContent.trim() || null,
      nextSeq: next?.getAttribute("data-seq") || null,
      importRect: box(importButton),
      firstRowRect: box(firstRow),
      state: document.querySelector("main.app")?.dataset.state || null,
      activeTestid: document.activeElement?.getAttribute("data-testid") || null,
    };
  });
}

async function collectDialog(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[data-testid="import-dialog"]');
    const active = document.activeElement;
    return {
      tag: dialog?.tagName || null,
      open: Boolean(dialog?.open),
      modal: Boolean(dialog?.matches(":modal")),
      activeTag: active?.tagName || null,
      activeTestid: active?.getAttribute("data-testid") || null,
      activeInside: Boolean(dialog && active && dialog.contains(active)),
      activeVisibleButton: Boolean(active?.tagName === "BUTTON" && active.getClientRects().length > 0),
    };
  });
}

async function probeDialog(page, alreadyOpen) {
  if (!alreadyOpen) await openImport(page);
  await waitLayoutStable(page);
  const before = await collectDialog(page);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => {
    const dialog = document.querySelector('[data-testid="import-dialog"]');
    return dialog && !dialog.open && document.activeElement?.getAttribute("data-testid") === "roster-import";
  });
  const after = await page.evaluate(() => ({
    open: document.querySelector('[data-testid="import-dialog"]').open,
    activeTestid: document.activeElement?.getAttribute("data-testid") || null,
  }));
  return { before, after };
}

async function h8(browser) {
  const c = makeChecks();
  const summaries = [];
  const viewports = [
    {
      label: "390x844",
      options: { viewport: { width: 390, height: 844 } },
      cdp: null,
    },
    {
      label: "320x568",
      options: { viewport: { width: 320, height: 568 } },
      cdp: { width: 320, height: 568, deviceScaleFactor: 2, mobile: true },
    },
  ];

  const stateDefs = [
    {
      name: "import-start",
      setup: async (page) => {
        await openImport(page);
      },
      dialogOpen: true,
    },
    {
      name: "preview",
      setup: async (page) => {
        await openImport(page);
        await previewFile(page, F.a, 3);
      },
      dialogOpen: true,
    },
    {
      name: "mixed-three",
      setup: async (page) => {
        await importFile(page, F.mixedThree, 3);
        await compute(page, "+", ["10", "20"]);
        await compute(page, "+", ["3", "4"]);
        await waitFilled(page, 2);
      },
      dialogOpen: false,
    },
    {
      name: "fifty-rows",
      setup: async (page) => {
        await importFile(page, F.fifty, 50);
      },
      dialogOpen: false,
    },
    {
      name: "edit",
      setup: async (page) => {
        await importFile(page, F.five, 5);
        await compute(page, "+", ["12", "30", "8"]);
        await compute(page, "+", ["9", "1"]);
        await compute(page, "+", ["5", "5"]);
        await waitFilled(page, 3);
        await page.locator('[data-testid="roster-row"][data-seq="2"] [data-testid="roster-edit"]').click();
        await page.waitForFunction(() => document.querySelector("main.app").dataset.state === "edit" && !document.querySelector('[data-testid="edit-draft"]').hidden);
      },
      dialogOpen: false,
    },
  ];

  for (const viewport of viewports) {
    const perState = [];
    for (const definition of stateDefs) {
      const app = await openTracked(browser, {
        ...viewport.options,
        cdp: viewport.cdp,
      });
      try {
        const { page } = app;
        await definition.setup(page);
        const layout = await collectLayout(page);
        const prefix = `${viewport.label}.${definition.name}`;
        c.eq(`${prefix}.historical-width`, layout.viewport.width, viewport.options.viewport.width);
        c.check(`${prefix}.doc-overflow`, layout.docOverflow <= 1.5, `overflow=${layout.docOverflow}`);
        c.check(`${prefix}.body-overflow`, layout.bodyOverflow <= 1.5, `overflow=${layout.bodyOverflow}`);
        c.check(`${prefix}.controls-size`, layout.minControlWidth === null || (layout.minControlWidth >= 43.5 && layout.minControlHeight >= 43.5), `min=${layout.minControlWidth}x${layout.minControlHeight}`);
        c.check(`${prefix}.input-font`, layout.minInputFont === null || layout.minInputFont >= 15.5, `min=${layout.minInputFont}`);
        if (layout.rows > 0) {
          c.check(`${prefix}.roster-fonts`, layout.minRowFont >= 12.5 && layout.minScoreFont >= 12.5 && layout.minExpressionFont >= 12.5, `row=${layout.minRowFont} score=${layout.minScoreFont} expr=${layout.minExpressionFont}`);
          c.check(`${prefix}.roster-semantics`, layout.rosterMatches && layout.rowsMatch, `tag=${layout.rosterTag} role=${layout.rosterRole} rows=${layout.rowTags.join(",")}/${layout.rowRoles.join(",")}`);
          c.check(`${prefix}.next-text`, Boolean(layout.nextText && layout.nextText.includes("下一位")), layout.nextText || "missing");
          c.check(`${prefix}.vertical-order`, Boolean(layout.importRect && layout.firstRowRect && layout.importRect.bottom <= layout.firstRowRect.top + 0.5), `import.bottom=${layout.importRect?.bottom} row.top=${layout.firstRowRect?.top}`);
        }
        if (definition.name === "mixed-three") {
          c.eq(`${prefix}.rows`, layout.rows, 3);
          c.eq(`${prefix}.filled`, layout.filled, 2);
        }
        if (definition.name === "edit") {
          c.eq(`${prefix}.rows`, layout.rows, 5);
          c.eq(`${prefix}.filled`, layout.filled, 3);
          c.check(`${prefix}.third-edit-label`, Boolean(layout.thirdEditLabel?.includes("编辑第 3 位") && layout.thirdEditLabel?.includes("李四")), layout.thirdEditLabel);
        }
        if (definition.name === "fifty-rows") c.eq(`${prefix}.rows`, layout.rows, 50);
        if (definition.name === "edit") c.eq(`${prefix}.state`, layout.state, "edit");
        const dialog = await probeDialog(page, definition.dialogOpen);
        c.eq(`${prefix}.dialog-tag`, dialog.before.tag, "DIALOG");
        c.eq(`${prefix}.dialog-open`, dialog.before.open, true);
        c.eq(`${prefix}.dialog-modal`, dialog.before.modal, true);
        c.eq(`${prefix}.dialog-focus`, [dialog.before.activeInside, dialog.before.activeVisibleButton], [true, true], JSON.stringify(dialog.before));
        c.eq(`${prefix}.dialog-after`, dialog.after, { open: false, activeTestid: "roster-import" });
        perState.push({
          name: definition.name,
          overflow: Math.max(layout.docOverflow, layout.bodyOverflow),
          controls: layout.controls.length,
          minControl: [layout.minControlWidth, layout.minControlHeight],
          minFont: [layout.minInputFont, layout.minRowFont, layout.minScoreFont, layout.minExpressionFont],
          rows: layout.rows,
          filled: layout.filled,
          thirdEditLabel: layout.thirdEditLabel,
          next: layout.nextText,
          dialog: `${dialog.before.tag}:${dialog.before.open}:${dialog.before.modal}`,
          focus: dialog.after.activeTestid,
        });
      } finally {
        await closeApp(app);
      }
    }
    const minControls = perState.map((state) => Math.min(...state.minControl));
    const minInput = perState.filter((state) => state.minFont[0] !== null).map((state) => state.minFont[0]);
    const rosterFonts = perState.filter((state) => state.minFont[1] !== null).flatMap((state) => state.minFont.slice(1));
    summaries.push(`${viewport.label}:states=${perState.length},overflow=${Math.max(...perState.map((state) => state.overflow))},minControl=${Math.min(...minControls)},minInputFont=${Math.min(...minInput)},minRosterFont=${Math.min(...rosterFonts)},edit-row3=${perState.find((state) => state.name === "edit")?.thirdEditLabel},dialog=DIALOG:modal,focusBack=roster-import`);
  }

  return {
    pass: c.failures.length === 0,
    detail: c.failures.length ? c.failText() : summaries.join("; "),
  };
}

function runSuite(args, timeout = 1800000) {
  const result = spawnSync(process.execPath, [SUITE, ...args], {
    cwd: REPO,
    env: { ...process.env, PLAYWRIGHT_MODULE: process.env.PLAYWRIGHT_MODULE },
    encoding: "utf8",
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

function parseSuiteJson(result) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`suite JSON parse failed status=${result.status} stdout=${oneLine(result.stdout)} stderr=${oneLine(result.stderr)} ${formatError(error)}`);
  }
}

async function h9() {
  const c = makeChecks();
  const frozen = [
    [path.join(TESTS, "scenarios/core.mjs"), "e15f0e95a86269e88c67c5af4b4af12650bb0cd3a4902f29e7ccfc9876e290ab"],
    [path.join(TESTS, "scenarios/continuity.mjs"), "51521723e6df99dbfabd06ff855f42cfcba14a3652cb720119256802869f58ee"],
    [path.join(TESTS, "scenarios/edit.mjs"), "f61188e63586e8afa2883f6db3d3e88f7cc216a9a0c8dc7d465953ad37ceadc1"],
    [path.join(TESTS, "scenarios/layout.mjs"), "c96ed96499a18b9731a8e10dabb579a761d445534105caabfa7424803def65a0"],
    [path.join(TESTS, "scenarios/determinism.mjs"), "64bc09c49ac56c21aef77bdd1a7f7c365b8791d0690076f5964b58f06e69ddff"],
  ];
  const hashes = execFileSync("sha256sum", frozen.map(([file]) => file), { encoding: "utf8", timeout: 120000 })
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(/\s+/)[0]);
  c.eq("frozen.sha256", hashes, frozen.map(([, expected]) => expected));

  const baselineIds = [
    "self-contained",
    "cold-start",
    "compute",
    "arithmetic",
    "history-order",
    "reset",
    "continuity",
    "error-recovery",
    "sticky-operator",
    "edit-recompute",
    "edit-multi",
    "edit-invalid",
    "edit-divzero",
    "edit-cancel-restore",
    "edit-pending-replace",
    "edit-pending-recent-value",
    "layout",
    "determinism",
  ];
  const fullRun = runSuite(["--json", "--artifact", ARTIFACT]);
  const full = parseSuiteJson(fullRun);
  const resultMap = new Map(full.results.map((item) => [item.id, item]));
  const missing = baselineIds.filter((id) => !resultMap.has(id));
  c.eq("baseline.present", missing, []);
  const baseline = baselineIds.map((id) => resultMap.get(id) || { id, pass: false, checks: [{ id: `${id}.missing`, pass: false }] });
  const cold = baseline.find((item) => item.id === "cold-start");
  const coldFailures = cold.checks.filter((check) => !check.pass).map((check) => check.id);
  c.eq("cold-start.failures", coldFailures, ["cold-start.keys-disabled"]);
  c.eq("baseline.other-pass", baseline.filter((item) => item.id !== "cold-start").map((item) => [item.id, item.pass]), baselineIds.filter((id) => id !== "cold-start").map((id) => [id, true]));
  c.eq("baseline.pass-count", baseline.filter((item) => item.pass).length, 17);

  const listRun = runSuite(["--list"], 120000);
  const listed = listRun.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const rosterIds = listed.filter((id) => id.startsWith("roster-"));
  c.check("roster.count", rosterIds.length >= 5, rosterIds.join(","));
  const categories = ["import", "fill", "edit", "export", "storage"];
  c.eq("roster.categories", categories.map((word) => rosterIds.some((id) => id.includes(word))), categories.map(() => true));

  const onlyRun = runSuite(["--json", "--artifact", ARTIFACT, "--only", rosterIds.join(",")]);
  const only = parseSuiteJson(onlyRun);
  c.eq("roster.only-ids", only.results.map((item) => item.id), rosterIds);
  c.eq("roster.only-pass", only.results.map((item) => [item.id, item.pass]), rosterIds.map((id) => [id, true]));
  return {
    pass: c.failures.length === 0,
    detail: c.failures.length
      ? c.failText()
      : `five frozen sha256 match; baseline 17 pass, cold-start failed set={${coldFailures.join(",")}}; roster ids=${rosterIds.join(",")}; roster-only all pass`,
  };
}

function externalReferences(text) {
  const patterns = [
    /<script\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi,
    /<link\b[^>]*\bhref\s*=\s*["']?([^"'\s>]+)/gi,
    /<img\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi,
    /@import\s+(?:url\()?\s*["']?([^"')\s;]+)/gi,
    /url\(\s*["']?([^"')]+)["']?\s*\)/gi,
  ];
  const references = [];
  for (const pattern of patterns) {
    let match = pattern.exec(text);
    while (match) {
      references.push(match[1]);
      match = pattern.exec(text);
    }
    pattern.lastIndex = 0;
  }
  return references.filter((value) => /^(https?:)?\/\//i.test(value));
}

async function determinismRun(browser) {
  const app = await openTracked(browser);
  try {
    const { page } = app;
    await importFile(page, F.a, 3);
    await compute(page, "+", ["12", "30", "8"]);
    await compute(page, "+", ["9", "1"]);
    await waitFilled(page, 2);
    await page.locator('[data-testid="roster-row"][data-seq="1"] [data-testid="roster-edit"]').click();
    await page.waitForFunction(() => document.querySelector("main.app").dataset.state === "edit");
    await page.locator(S.operandInput).first().fill("20");
    await page.locator(S.equals).click();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="roster-row"][data-seq="1"] [data-testid="roster-score"]')?.getAttribute("data-value") === "58",
    );
    const rows = (await rosterRows(page)).map((row) => ({
      "data-seq": row.seq,
      "data-name": row.name,
      "data-id": row.id,
      "data-filled": row.filled,
      score: row.score,
      expression: row.expression,
    }));
    const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), ROSTER_KEY);
    const entries = stored.rows.map((row) => row.entry && {
      seq: row.entry.seq,
      operator: row.entry.operator,
      operands: row.entry.operands,
      expression: row.entry.expression,
      result: row.entry.result,
    });
    const download = await captureDownload(page, () => page.locator('[data-testid="roster-export"]').click());
    return {
      rows,
      entries,
      csvText: download.bytes.toString("utf8"),
      csvHex: download.bytes.toString("hex"),
    };
  } finally {
    await closeApp(app);
  }
}

async function h10(browser) {
  const c = makeChecks();
  const bytes = fs.readFileSync(ARTIFACT);
  const text = bytes.toString("utf8");
  const references = externalReferences(text);
  c.check("artifact.closed", text.includes("</html>"), "missing closing </html>");
  c.check("artifact.size", bytes.length >= 1024, `bytes=${bytes.length}`);
  c.eq("artifact.external-refs", references, []);

  const first = await determinismRun(browser);
  const second = await determinismRun(browser);
  c.eq("determinism.rows", second.rows, first.rows);
  c.eq("determinism.entries", second.entries, first.entries);
  c.eq("determinism.csv", second.csvText, first.csvText);
  c.eq("determinism.csv-bytes", second.csvHex, first.csvHex);

  const pageErrors = pageAudit.flatMap((app) => app.pageErrors || []);
  const consoleErrors = pageAudit.flatMap((app) => app.consoleErrors || []);
  c.eq("pages.pageerrors", pageErrors.length, 0, pageErrors.join(" | "));
  c.eq("pages.console-errors", consoleErrors.length, 0, consoleErrors.join(" | "));
  return {
    pass: c.failures.length === 0,
    detail: c.failures.length
      ? c.failText()
      : `bytes=${bytes.length},closed=true,externalRefs=0,pages=${pageAudit.length},pageErrors=0,consoleErrors=0,two-context rows/entries/CSV deep-equal,rows=${first.rows.map((row) => row.score).join("/")}`,
  };
}

function decodePng(buffer) {
  const signature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== signature) throw new Error("invalid PNG signature");
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  if (bitDepth !== 8 || interlace !== 0 || ![2, 6].includes(colorType)) {
    throw new Error(`unsupported PNG bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(height * stride);
  const paeth = (left, above, upperLeft) => {
    const estimate = left + above - upperLeft;
    const dl = Math.abs(estimate - left);
    const da = Math.abs(estimate - above);
    const du = Math.abs(estimate - upperLeft);
    return dl <= da && dl <= du ? left : da <= du ? above : upperLeft;
  };
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const source = y * (stride + 1) + 1;
    const target = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? pixels[target + x - channels] : 0;
      const above = y > 0 ? pixels[target - stride + x] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[target - stride + x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) predictor = paeth(left, above, upperLeft);
      else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
      pixels[target + x] = (raw[source + x] + predictor) & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

function pngStats(buffer) {
  const image = decodePng(buffer);
  const colors = new Set();
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let offset = 0; offset < image.pixels.length; offset += image.channels) {
    const red = image.pixels[offset];
    const green = image.pixels[offset + 1];
    const blue = image.pixels[offset + 2];
    colors.add((red << 16) | (green << 8) | blue);
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    sum += luminance;
    sumSquares += luminance * luminance;
    count += 1;
  }
  const mean = sum / count;
  const variance = Math.max(0, sumSquares / count - mean * mean);
  return {
    width: image.width,
    height: image.height,
    uniqueColors: colors.size,
    luminanceStdDev: Math.sqrt(variance),
  };
}

async function screenshotMetrics(page, key, cdp) {
  return page.evaluate(
    ({ stateKey, usedCdp }) => {
      const rect = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return {
          top: Number(box.top.toFixed(3)),
          bottom: Number(box.bottom.toFixed(3)),
          width: Number(box.width.toFixed(3)),
          height: Number(box.height.toFixed(3)),
        };
      };
      const inViewport = (box) => Boolean(box && box.top >= -0.5 && box.bottom <= window.innerHeight + 0.5);
      const roster = document.querySelector('[data-testid="roster"]');
      const dialog = document.querySelector('[data-testid="import-dialog"]');
      const edit = document.querySelector('[data-testid="edit-draft"]');
      const next = document.querySelector('[data-testid="roster-next"]');
      const rows = document.querySelectorAll('[data-testid="roster-row"]');
      const firstRow = rect('[data-testid="roster-row"]');
      const secondRow = rect('[data-testid="roster-row"][data-seq="2"]');
      const draft = rect('[data-testid="edit-draft"]');
      return {
        key: stateKey,
        cdp: usedCdp,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
        rows: rows.length,
        filled: document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length,
        nextSeq: next?.getAttribute("data-seq") || null,
        nextText: next?.textContent.trim() || null,
        dialogOpen: Boolean(dialog?.open),
        dialog: dialog ? `${dialog.tagName}:${Boolean(dialog.matches(":modal"))}` : null,
        rosterVisible: Boolean(roster && !roster.hidden && roster.getClientRects().length > 0),
        editVisible: Boolean(edit && !edit.hidden && edit.getClientRects().length > 0),
        firstRow,
        secondRow,
        editDraft: draft,
        inViewport: { firstRow: inViewport(firstRow), secondRow: inViewport(secondRow), editDraft: inViewport(draft) },
        activeTestid: document.activeElement?.getAttribute("data-testid") || null,
        state: document.querySelector("main.app")?.dataset.state || null,
      };
    },
    { stateKey: key, usedCdp: Boolean(cdp) },
  );
}

async function runReviewStates(browser) {
  const c = makeChecks();
  fs.rmSync(SHOT_DIR, { recursive: true, force: true });
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const states = [
    {
      id: "S1",
      viewport: { width: 390, height: 844 },
      cdp: null,
      setup: async (page) => {
        await openImport(page);
      },
    },
    {
      id: "S2",
      viewport: { width: 390, height: 844 },
      cdp: null,
      setup: async (page) => {
        await compute(page, "+", ["12", "30", "8"]);
        await waitResult(page, "50");
        await compute(page, "+", ["9", "1"]);
        await waitResult(page, "10");
        await openImport(page);
        await previewFile(page, F.a, 3);
      },
    },
    {
      id: "S3",
      viewport: { width: 390, height: 844 },
      cdp: null,
      setup: async (page) => {
        await importFile(page, F.five, 5);
        await compute(page, "+", ["12", "30", "8"]);
        await compute(page, "+", ["9", "1"]);
        await waitFilled(page, 2);
        await page.waitForFunction(() => document.querySelector('[data-testid="roster-next"]')?.getAttribute("data-seq") === "3");
      },
    },
    {
      id: "S4",
      viewport: { width: 320, height: 568 },
      cdp: { width: 320, height: 568, deviceScaleFactor: 2, mobile: true },
      setup: async (page) => {
        await importFile(page, F.five, 5);
        await compute(page, "+", ["12", "30", "8"]);
        await compute(page, "+", ["9", "1"]);
        await compute(page, "+", ["5", "5"]);
        await waitFilled(page, 3);
        await page.locator('[data-testid="roster-row"][data-seq="2"] [data-testid="roster-edit"]').click();
        await page.waitForFunction(() => document.querySelector("main.app").dataset.state === "edit" && !document.querySelector('[data-testid="edit-draft"]').hidden);
        await page.locator('[data-testid="roster-row"][data-seq="2"]').evaluate((element) => element.scrollIntoView({ block: "start" }));
        await waitLayoutStable(page);
      },
    },
  ];
  const renderLines = [`ROUND: ${ROUND}`, `ARTIFACT_SHA256: ${sha256File(ARTIFACT)}`, `VERIFIER_SHA256: ${sha256File(SCRIPT_FILE)}`];
  const shots = [];
  const hashes = new Set();
  for (const state of states) {
    const app = await openTracked(browser, { viewport: state.viewport, cdp: state.cdp });
    try {
      const { page } = app;
      await state.setup(page);
      await waitLayoutStable(page);
      const file = path.join(SHOT_DIR, `${state.id}.png`);
      const buffer = await page.screenshot({ path: file, type: "png", animations: "disabled" });
      const stats = pngStats(buffer);
      const metrics = await screenshotMetrics(page, state.id, state.cdp);
      const hash = sha256(buffer);
      hashes.add(hash);
      c.check(`${state.id}.png-size`, buffer.length >= 1024, `bytes=${buffer.length}`);
      c.check(`${state.id}.png-dimensions`, stats.width >= 240 && stats.height >= 160, `${stats.width}x${stats.height}`);
      c.check(`${state.id}.png-content`, stats.uniqueColors >= 16 && stats.luminanceStdDev > 0.5, `colors=${stats.uniqueColors} stddev=${stats.luminanceStdDev}`);
      c.check(`${state.id}.overflow`, metrics.docOverflow <= 1.5 && metrics.bodyOverflow <= 1.5, `doc=${metrics.docOverflow} body=${metrics.bodyOverflow}`);
      shots.push({ file: `${state.id}.png`, sha256: hash, width: stats.width, height: stats.height });
      if (state.id === "S1") {
        c.eq("S1.dialog", [metrics.dialogOpen, metrics.dialog], [true, "DIALOG:true"]);
      }
      if (state.id === "S2") {
        c.eq("S2.preview", [metrics.dialogOpen, metrics.rows], [true, 0]);
      }
      if (state.id === "S3") {
        c.eq("S3.people", [metrics.rows, metrics.filled, metrics.nextSeq], [5, 2, "3"]);
      }
      if (state.id === "S4") {
        c.eq("S4.viewport", metrics.viewport, "320x568");
        c.eq("S4.edit", [metrics.rows, metrics.filled, metrics.nextSeq, metrics.editVisible], [5, 3, "4", true]);
        c.check("S4.in-viewport", metrics.inViewport.secondRow && metrics.inViewport.editDraft, JSON.stringify(metrics.inViewport));
      }
      renderLines.push(
        `${state.id}.cdp=${metrics.cdp}`,
        `${state.id}.viewport=${metrics.viewport}`,
        `${state.id}.docOverflow=${metrics.docOverflow}`,
        `${state.id}.bodyOverflow=${metrics.bodyOverflow}`,
        `${state.id}.rows=${metrics.rows}`,
        `${state.id}.filled=${metrics.filled}`,
        `${state.id}.nextSeq=${metrics.nextSeq ?? "null"}`,
        `${state.id}.nextText=${oneLine(metrics.nextText, 80) || "null"}`,
        `${state.id}.dialogOpen=${metrics.dialogOpen}`,
        `${state.id}.dialog=${metrics.dialog || "none"}`,
        `${state.id}.rosterVisible=${metrics.rosterVisible}`,
        `${state.id}.editVisible=${metrics.editVisible}`,
        `${state.id}.firstRowRect=${metrics.firstRow ? `${metrics.firstRow.top},${metrics.firstRow.bottom},${metrics.firstRow.width}x${metrics.firstRow.height}` : "none"}`,
        `${state.id}.secondRowRect=${metrics.secondRow ? `${metrics.secondRow.top},${metrics.secondRow.bottom},${metrics.secondRow.width}x${metrics.secondRow.height}` : "none"}`,
        `${state.id}.editDraftRect=${metrics.editDraft ? `${metrics.editDraft.top},${metrics.editDraft.bottom},${metrics.editDraft.width}x${metrics.editDraft.height}` : "none"}`,
        `${state.id}.activeTestid=${metrics.activeTestid ?? "null"}`,
        `${state.id}.state=${metrics.state ?? "null"}`,
        `${state.id}.png=${stats.width}x${stats.height}`,
        `${state.id}.bytes=${buffer.length}`,
        `${state.id}.uniqueColors=${stats.uniqueColors}`,
        `${state.id}.luminanceStdDev=${stats.luminanceStdDev}`,
        `${state.id}.sha256=${hash}`,
      );
    } finally {
      await closeApp(app);
    }
  }
  c.eq("review.unique", hashes.size, 4);
  const files = fs.readdirSync(SHOT_DIR).sort();
  c.eq("review.exact-files", files, ["S1.png", "S2.png", "S3.png", "S4.png"]);
  const renderText = `${renderLines.join("\n")}\n`;
  fs.writeFileSync(RENDER_FILE, renderText);
  fs.writeFileSync(
    MANIFEST_FILE,
    `${JSON.stringify(
      {
        round: Number(ROUND),
        artifact_sha256: sha256File(ARTIFACT),
        verifier_sha256: sha256File(SCRIPT_FILE),
        metrics_sha256: sha256(renderText),
        shots,
        adhoc: [],
      },
      null,
      2,
    )}\n`,
  );
  return { pass: c.failures.length === 0, detail: c.failures.length ? c.failText() : `S1-S4 exact PNGs; unique=${hashes.size}; manifest+render written` };
}

async function main() {
  createFixtures();
  const artifactHash = sha256File(ARTIFACT);
  const verifierHash = sha256File(SCRIPT_FILE);
  const expectedArtifact = process.env.KEKKAI_ARTIFACT_SHA256;
  if (expectedArtifact && expectedArtifact !== artifactHash) {
    throw new Error(`artifact sha256 mismatch: contract=${expectedArtifact} actual=${artifactHash}`);
  }
  const browser = await launchBrowser();
  try {
    const definitions = [
      ["H1", () => h1(browser)],
      ["H2", () => h2(browser)],
      ["H3", () => h3(browser)],
      ["H4", () => h4(browser)],
      ["H5", () => h5(browser)],
      ["H6", () => h6(browser)],
      ["H7", () => h7(browser)],
      ["H8", () => h8(browser)],
      ["H9", () => h9()],
    ];
    for (const [id, run] of definitions) {
      try {
        const result = await run();
        results.push({ id, ...result });
      } catch (error) {
        results.push({ id, pass: false, detail: formatError(error) });
      }
    }
    let render;
    try {
      render = await runReviewStates(browser);
    } catch (error) {
      render = { pass: false, detail: formatError(error) };
    }
    if (!render.pass) {
      const h8Result = results.find((result) => result.id === "H8");
      h8Result.pass = false;
      h8Result.detail = `${h8Result.detail}; review-evidence=${render.detail}`;
    }
    try {
      results.push({ id: "H10", ...(await h10(browser)) });
    } catch (error) {
      results.push({ id: "H10", pass: false, detail: formatError(error) });
    }
  } finally {
    await browser.close();
  }
  const ordered = results.sort((left, right) => Number(left.id.slice(1)) - Number(right.id.slice(1)));
  const failed = ordered.filter((result) => !result.pass).map((result) => result.id);
  const lines = [
    `ROUND: ${ROUND}`,
    `ARTIFACT_SHA256: ${artifactHash}`,
    `VERIFIER_SHA256: ${verifierHash}`,
    ...ordered.map((result) => `${result.id} ${result.pass ? "PASS" : "FAIL"} — ${oneLine(result.detail)}`),
    failed.length ? `HARD: FAIL (${failed.join(",")})` : "HARD: PASS",
  ];
  fs.writeFileSync(HARD_FILE, `${lines.join("\n")}\n`);
  process.stdout.write(`${lines.join("\n")}\n`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((error) => {
  const detail = formatError(error);
  const lines = [
    `ROUND: ${ROUND}`,
    `ARTIFACT_SHA256: ${fs.existsSync(ARTIFACT) ? sha256File(ARTIFACT) : "0".repeat(64)}`,
    `VERIFIER_SHA256: ${fs.existsSync(SCRIPT_FILE) ? sha256File(SCRIPT_FILE) : "0".repeat(64)}`,
    `H1 FAIL — verifier aborted before measurement: ${detail}`,
    ...Array.from({ length: 9 }, (_, index) => `H${index + 2} FAIL — verifier aborted before measurement: ${detail}`),
    "HARD: FAIL (H1,H2,H3,H4,H5,H6,H7,H8,H9,H10)",
  ];
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(HARD_FILE, `${lines.join("\n")}\n`);
  process.stderr.write(`${lines.join("\n")}\n`);
  process.exitCode = 1;
});
