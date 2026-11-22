#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

process.env.PLAYWRIGHT_MODULE =
  process.env.PLAYWRIGHT_MODULE || "/ws/cal_phone/tests/node_modules/playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(process.env.KEKKAI_REPO || path.join(HERE, "../../.."));
const ARTIFACT = path.resolve(process.env.KEKKAI_ARTIFACT || path.join(REPO, "index.html"));
const OUT_DIR = path.resolve(process.env.KEKKAI_OUT_DIR || HERE);
const ROUND = Number(process.argv[2] || process.env.KEKKAI_ROUND || 1);
const PHASE = process.env.KEKKAI_PHASE || "first";
const SUITE = path.join(REPO, "tests/suite.mjs");
const FIXTURE_DIR = path.join(OUT_DIR, "fixtures");
const SHOT_DIR = path.join(OUT_DIR, "review-shots", `r${ROUND}`);
const HARD_FILE = path.join(OUT_DIR, `hard-r${ROUND}.txt`);
const RENDER_FILE = path.join(OUT_DIR, `render-r${ROUND}.txt`);
const MANIFEST_FILE = path.join(OUT_DIR, `manifest-r${ROUND}.json`);
const ROSTER_KEY = "cal-phone.roster.v1";
const EXPECTED_REVIEW_STATES = String(
  process.env.KEKKAI_EXPECTED_REVIEW_STATES || "S1,S2,S3,S4",
)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const { launchBrowser, openApp } = await import(
  pathToFileURL(path.join(REPO, "tests/lib/browser.mjs")).href
);
const DOM = await import(pathToFileURL(path.join(REPO, "tests/lib/dom.mjs")).href);
const { S } = await import(pathToFileURL(path.join(REPO, "tests/lib/selectors.mjs")).href);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(FIXTURE_DIR, { recursive: true });

const allPageErrors = [];
const allConsoleErrors = [];
const artifacts = [];

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

function fmt(value) {
  if (typeof value === "string") return JSON.stringify(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function cleanDetail(text) {
  return String(text).replace(/\s*\n\s*/g, " | ").replace(/\s{2,}/g, " ").trim();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, label) {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(`${label}: expected ${fmt(expected)}, got ${fmt(actual)}`);
  }
}

function assertNear(actual, expected, tolerance, label) {
  const number = Number(actual);
  if (!Number.isFinite(number) || Math.abs(number - expected) > tolerance) {
    throw new Error(`${label}: expected ${expected} ± ${tolerance}, got ${fmt(actual)}`);
  }
}

function dateStamp(date = new Date()) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function utf8(text, bom = false) {
  return Buffer.from(`${bom ? "\uFEFF" : ""}${text}`, "utf8");
}

function gbk(text) {
  return execFileSync(
    "python3",
    [
      "-c",
      "import sys;sys.stdout.buffer.write(sys.stdin.buffer.read().decode('utf-8').encode('gbk'))",
    ],
    { input: Buffer.from(text, "utf8") },
  );
}

function writeFixture(name, buffer) {
  const safe = name.replace(/[\\/]/g, "_");
  fs.writeFileSync(path.join(FIXTURE_DIR, safe), buffer);
}

const FIXTURE_A = [
  "序号,学号,姓名,成绩,班级",
  "1,20230101,张三,85,高一3班",
  "2,20230102,李四,92,高一3班",
  "3,20230103,王五,78,高一3班",
].join("\r\n") + "\r\n";

const FIVE_PERSON = [
  "学号,姓名",
  "20240001,张三",
  "20240002,王五",
  "20240003,李四",
  "20240004,赵六",
  "20240005,钱七",
].join("\n") + "\n";

const THREE_PERSON = [
  "学号,姓名",
  "20250001,张三",
  "20250002,王五",
  "20250003,李四",
].join("\n") + "\n";

const FIFTY_PERSON = ["学号,姓名", ...Array.from({ length: 50 }, (_, index) => {
  const number = index + 1;
  return `2023${String(number).padStart(4, "0")},学生${number}`;
})].join("\n") + "\n";

const FIXTURES = {
  A: {
    label: "A",
    name: "高一3班.csv",
    buffer: utf8(FIXTURE_A, true),
  },
  B: {
    label: "B",
    name: "semicolon.csv",
    buffer: utf8("学号;名字;班级\n20230104;赵六;高二1班\n20230105;钱七;高二1班\n"),
  },
  C: {
    label: "C",
    name: "gbk.tsv",
    buffer: gbk("考号\t姓名\t得分\n20230106\t孙八\t88\n20230107\t周九\t91\n"),
  },
  missingId: {
    label: "missing-id",
    name: "missing-id.csv",
    buffer: utf8("姓名,班级\n吴十,高三1班\n"),
  },
  missingName: {
    label: "missing-name",
    name: "missing-name.csv",
    buffer: utf8("学号,备注\n20230108,无姓名\n"),
  },
  extra: {
    label: "extra",
    name: "extra.csv",
    buffer: utf8("姓名,名字,学号,班级\n张三,小三,20230101,高一3班\n"),
  },
  quoted: {
    label: "quoted",
    name: "quoted.csv",
    buffer: utf8('姓名,学号,备注\n"张,三",20230101,"含,逗号"\n"李""四",20230102,"含\n换行"\n'),
  },
  five: { label: "five", name: "五人.csv", buffer: utf8(FIVE_PERSON) },
  three: { label: "three", name: "三人.csv", buffer: utf8(THREE_PERSON) },
  fifty: { label: "fifty", name: "五十人.csv", buffer: utf8(FIFTY_PERSON) },
  missingSeq: {
    label: "missing-seq",
    name: "missing-seq.csv",
    buffer: utf8("学号,姓名,班级\n20230109,周五,高三2班\n"),
  },
  missingScore: {
    label: "missing-score",
    name: "missing-score.csv",
    buffer: utf8("学号,姓名\n20230110,吴六\n"),
  },
  synonyms: {
    label: "synonyms",
    name: "synonyms.csv",
    buffer: utf8("姓名,名字,学号\n张三,小三,20230101\n"),
  },
};

for (const fixture of Object.values(FIXTURES)) writeFixture(fixture.name, fixture.buffer);
writeFixture(
  "empty.csv",
  Buffer.alloc(0),
);
writeFixture("blank-lines.csv", Buffer.from("\n\n", "utf8"));
writeFixture("data-first.csv", Buffer.from("张三,20230101\n", "utf8"));
writeFixture("class-score.csv", Buffer.from("班级,成绩\n高一3班,88\n", "utf8"));
writeFixture("binary.csv", Buffer.from([0xff, 0xfe, 0x00, 0x01, 0xff]));

function mergeErrors(pageErrors, consoleErrors) {
  allPageErrors.push(...pageErrors);
  allConsoleErrors.push(...consoleErrors);
}

async function withApp(browser, fn, options = {}) {
  const app = await openApp(browser, ARTIFACT, options);
  try {
    return await fn(app);
  } finally {
    mergeErrors(app.pageErrors, app.consoleErrors);
    await app.close();
  }
}

async function withCustom(browser, options, fn) {
  const {
    width = 390,
    height = 844,
    cdp = false,
    initScript = null,
    initArg = undefined,
  } = options || {};
  const context = await browser.newContext({
    viewport: { width, height },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: cdp ? 1 : 1,
    acceptDownloads: true,
  });
  if (initScript) await context.addInitScript(initScript, initArg);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(30000);
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  if (cdp) {
    const cdpSession = await context.newCDPSession(page);
    await cdpSession.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: true,
    });
  }

  await page.goto(pathToFileURL(ARTIFACT).href, { waitUntil: "load" });
  try {
    return await fn({ context, page, pageErrors, consoleErrors });
  } finally {
    mergeErrors(pageErrors, consoleErrors);
    await context.close();
  }
}

async function openImport(page) {
  await page.locator('[data-testid="roster-import"]').click();
  await page.waitForFunction(() => {
    const dialog = document.querySelector('[data-testid="import-dialog"]');
    return dialog && dialog.open === true;
  });
}

async function selectRosterFile(page, fixture) {
  await page.locator('input[data-testid="roster-file"]').setInputFiles({
    name: fixture.name,
    mimeType: "text/csv",
    buffer: fixture.buffer,
  });
}

async function waitImportPreview(page, count) {
  await page.waitForFunction(
    (expected) => {
      const summary = document.querySelector('[data-testid="import-summary"]');
      return summary && summary.getAttribute("data-count") === String(expected);
    },
    count,
  );
  return readImportPreview(page);
}

async function previewRoster(page, fixture, count) {
  await selectRosterFile(page, fixture);
  return waitImportPreview(page, count);
}

async function waitImportError(page) {
  await page.waitForFunction(() => {
    const dialog = document.querySelector('[data-testid="import-dialog"]');
    return dialog && dialog.getAttribute("data-error") === "true";
  });
  return readImportPreview(page);
}

async function confirmRosterImport(page, count) {
  await page.locator('[data-testid="import-confirm"]').click();
  await page.waitForFunction(
    (expected) => {
      const dialog = document.querySelector('[data-testid="import-dialog"]');
      return (
        dialog &&
        !dialog.open &&
        document.querySelectorAll('[data-testid="roster-row"]').length === expected
      );
    },
    count,
  );
}

async function importRoster(page, fixture, count) {
  await openImport(page);
  await previewRoster(page, fixture, count);
  await confirmRosterImport(page, count);
  return readRows(page);
}

async function readImportPreview(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[data-testid="import-dialog"]');
    const summary = document.querySelector('[data-testid="import-summary"]');
    const columns = document.querySelector('[data-testid="import-columns"]');
    const preview = document.querySelector('[data-testid="import-preview"]');
    const error = document.querySelector('[data-testid="import-error"]');
    return {
      open: Boolean(dialog && dialog.open),
      dataError: dialog ? dialog.getAttribute("data-error") : null,
      count: summary ? summary.getAttribute("data-count") : null,
      text: summary ? (summary.textContent || "").trim() : "",
      columns: columns ? (columns.textContent || "").trim() : "",
      previewText: preview ? (preview.textContent || "").trim() : "",
      errorText: error ? (error.textContent || "").trim() : "",
    };
  });
}

async function readRows(page) {
  return page.$$eval('[data-testid="roster-row"]', (rows) =>
    rows.map((row) => {
      const score = row.querySelector('[data-testid="roster-score"]');
      const expression = row.querySelector('[data-testid="roster-expression"]');
      const edit = row.querySelector('[data-testid="roster-edit"]');
      const seqText = row.querySelector(".roster-seq");
      return {
        seq: row.getAttribute("data-seq"),
        name: row.getAttribute("data-name"),
        id: row.getAttribute("data-id"),
        filled: row.getAttribute("data-filled"),
        score: score ? (score.getAttribute("data-value") ?? (score.textContent || "").trim()) : null,
        expression: expression ? (expression.textContent || "").trim() : "",
        seqText: seqText ? (seqText.textContent || "").trim() : null,
        editLabel: edit ? edit.getAttribute("aria-label") : null,
      };
    }),
  );
}

async function readCalc(page) {
  return page.evaluate(() => {
    const app = document.querySelector("main.app");
    const draft = document.querySelector('[data-testid="edit-draft"]');
    return {
      state: app ? app.getAttribute("data-state") : null,
      operator: app ? app.getAttribute("data-operator") : null,
      expression: (document.querySelector('[data-testid="expression"]')?.textContent || "").trim(),
      resultValue: document.querySelector('[data-testid="result"]')?.getAttribute("data-value") ?? null,
      resultError: document.querySelector('[data-testid="result"]')?.getAttribute("data-error") ?? null,
      resultText: (document.querySelector('[data-testid="result"]')?.textContent || "").trim(),
      input: document.querySelector('input[data-testid="calc-input"]')?.value ?? null,
      label: (document.querySelector("#state-label")?.textContent || "").trim(),
      editVisible: Boolean(draft && !draft.hidden && draft.getClientRects().length > 0),
      editOperator: draft ? draft.getAttribute("data-operator") : null,
    };
  });
}

function calcCore(calc) {
  const { label, ...core } = calc;
  return core;
}

async function readNext(page) {
  const next = page.locator('[data-testid="roster-next"]');
  if ((await next.count()) === 0) return { count: 0, seq: null, text: null };
  return {
    count: 1,
    seq: await next.first().getAttribute("data-seq"),
    text: ((await next.first().textContent()) || "").trim(),
  };
}

async function readSummary(page) {
  return ((await page.locator('[data-testid="roster-summary"]').textContent()) || "").trim();
}

async function readHistory(page) {
  const snapshots = await DOM.historySnapshots(page);
  const seqAttrs = await page.$$eval('[data-testid="history-item"]', (items) =>
    items.map((item) => item.getAttribute("data-seq")),
  );
  return { snapshots, seqAttrs };
}

async function readStorage(page) {
  return page.evaluate((key) => localStorage.getItem(key), ROSTER_KEY);
}

async function readStoredRoster(page) {
  const raw = await readStorage(page);
  return raw === null ? null : JSON.parse(raw);
}

async function compute(page, operator, values) {
  await page.locator(`[data-testid="op-picker"] [data-op="${operator}"]`).click();
  for (const value of values) {
    for (const character of String(value)) {
      await page.locator(`[data-testid="keypad"] [data-key="${character}"]`).click();
    }
    await page.locator('[data-testid="keypad"] [data-key="enter"]').click();
  }
  await page.locator('[data-testid="key-equals"]').click();
}

async function clickEquals(page) {
  await page.locator('[data-testid="key-equals"]').click();
}

async function waitFilled(page, count) {
  await page.waitForFunction(
    (expected) =>
      document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length === expected,
    count,
  );
}

async function waitRowCount(page, count) {
  await page.waitForFunction(
    (expected) => document.querySelectorAll('[data-testid="roster-row"]').length === expected,
    count,
  );
}

async function waitRowScore(page, seq, score) {
  await page.waitForFunction(
    ({ seq: rowSeq, score: rowScore }) =>
      document
        .querySelector(`[data-testid="roster-row"][data-seq="${rowSeq}"] [data-testid="roster-score"]`)
        ?.getAttribute("data-value") === String(rowScore),
    { seq, score },
  );
}

function parseCsv(text) {
  const input = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field === "") {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field !== "" || row.length > 0 || input.endsWith(",")) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function captureDownload(page, trigger) {
  await page.evaluate(() => {
    if (window.__kekkaiDownloadHooked) {
      window.__kekkaiBlobs = [];
      window.__kekkaiAnchors = [];
      return;
    }
    window.__kekkaiDownloadHooked = true;
    window.__kekkaiBlobs = [];
    window.__kekkaiAnchors = [];
    const originalCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      try {
        blob.arrayBuffer().then((arrayBuffer) => {
          window.__kekkaiBlobs.push({
            bytes: Array.from(new Uint8Array(arrayBuffer)),
            size: blob.size,
            type: blob.type,
          });
        });
      } catch {
        // The Playwright download event remains the primary path.
      }
      return originalCreate(blob);
    };
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function patchedAnchorClick() {
      window.__kekkaiAnchors.push({ download: this.download, href: this.href });
      return originalClick.call(this);
    };
  });

  const downloadPromise = page.waitForEvent("download", { timeout: 6000 }).catch(() => null);
  await trigger();
  const download = await downloadPromise;
  await page
    .waitForFunction(
      () => window.__kekkaiBlobs.length > 0 || window.__kekkaiAnchors.length > 0,
      undefined,
      { timeout: 6000 },
    )
    .catch(() => {});
  const captured = await page.evaluate(() => ({
    blobs: window.__kekkaiBlobs || [],
    anchors: window.__kekkaiAnchors || [],
  }));

  let buffer = null;
  let name = null;
  let via = "";
  if (download) {
    const downloadPath = await download.path();
    if (downloadPath) {
      buffer = fs.readFileSync(downloadPath);
      name = download.suggestedFilename();
      via = "download-event";
    }
  }
  if (!buffer && captured.blobs.length > 0) {
    buffer = Buffer.from(captured.blobs[captured.blobs.length - 1].bytes);
    via = "createObjectURL";
  }
  const anchor = captured.anchors[captured.anchors.length - 1];
  if (!name && anchor && anchor.download) name = anchor.download;
  if (!buffer) throw new Error("download produced neither a Playwright file nor a captured Blob");
  return {
    name,
    buffer,
    text: buffer.toString("utf8"),
    via,
    anchorDownload: anchor ? anchor.download : null,
  };
}

async function confirmRosterClear(page) {
  let dialogMessage = null;
  const dialogPromise = new Promise((resolve) => {
    page.once("dialog", async (dialog) => {
      dialogMessage = dialog.message();
      await dialog.accept();
      resolve(dialogMessage);
    });
  });
  await page.locator('[data-testid="roster-clear"]').click();
  const custom = page.locator('[data-testid="roster-clear-confirm"]');
  if ((await custom.count()) > 0 && (await custom.first().isVisible().catch(() => false))) {
    await custom.first().click();
  }
  await page.waitForFunction(() => document.querySelector('[data-testid="roster"]').hidden);
  return dialogMessage;
}

async function expectDialogClosedAndProjectedFocus(page, openSelector = null) {
  await page.waitForFunction(() => {
    const dialog = document.querySelector('[data-testid="import-dialog"]');
    return dialog && dialog.open === false;
  });
  if (openSelector) {
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.getAttribute("data-testid") === "roster-import",
      openSelector,
    );
  }
}

function pngSize(buffer) {
  assert(buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "PNG signature missing");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function pngPixelStats(browser, buffer) {
  const page = await browser.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  try {
    await page.setContent("<!doctype html><canvas id=b></canvas>");
    const result = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.querySelector("#b");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = new Set();
      let nonTransparent = 0;
      let sum = 0;
      let sumSquares = 0;
      let count = 0;
      for (let index = 0; index < data.length; index += 4) {
        const red = data[index];
        const green = data[index + 1];
        const blue = data[index + 2];
        const alpha = data[index + 3];
        if (alpha > 0) nonTransparent += 1;
        colors.add((red << 16) | (green << 8) | blue);
        const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        sum += luminance;
        sumSquares += luminance * luminance;
        count += 1;
      }
      const mean = sum / Math.max(1, count);
      const variance = sumSquares / Math.max(1, count) - mean * mean;
      return {
        width: canvas.width,
        height: canvas.height,
        uniqueColors: colors.size,
        nonTransparent,
        pixels: count,
        luminanceStdDev: Math.sqrt(Math.max(0, variance)),
      };
    }, buffer.toString("base64"));
    return result;
  } finally {
    mergeErrors(pageErrors, consoleErrors);
    await page.close();
  }
}

const RESULTS = new Map();

async function runH(id, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    RESULTS.set(id, { pass: true, detail: cleanDetail(detail), ms: Date.now() - started });
    console.log(`${id} PASS (${Date.now() - started}ms) — ${cleanDetail(detail)}`);
  } catch (error) {
    const message = error && error.stack ? error.stack : String(error);
    RESULTS.set(id, {
      pass: false,
      detail: cleanDetail(error && error.message ? error.message : String(error)),
      ms: Date.now() - started,
    });
    console.error(`${id} FAIL (${Date.now() - started}ms):\n${message}`);
  }
}

async function testH1(browser) {
  const importCases = [
    {
      fixture: FIXTURES.A,
      count: 3,
      expected: [
        { seq: "1", name: "张三", id: "20230101", filled: "false" },
        { seq: "2", name: "李四", id: "20230102", filled: "false" },
        { seq: "3", name: "王五", id: "20230103", filled: "false" },
      ],
    },
    {
      fixture: FIXTURES.B,
      count: 2,
      expected: [
        { seq: "1", name: "赵六", id: "20230104", filled: "false" },
        { seq: "2", name: "钱七", id: "20230105", filled: "false" },
      ],
    },
    {
      fixture: FIXTURES.C,
      count: 2,
      expected: [
        { seq: "1", name: "孙八", id: "20230106", filled: "false" },
        { seq: "2", name: "周九", id: "20230107", filled: "false" },
      ],
    },
    {
      fixture: FIXTURES.missingId,
      count: 1,
      expected: [{ seq: "1", name: "吴十", id: "", filled: "false" }],
    },
    {
      fixture: FIXTURES.missingName,
      count: 1,
      expected: [{ seq: "1", name: "", id: "20230108", filled: "false" }],
    },
    {
      fixture: FIXTURES.extra,
      count: 1,
      expected: [{ seq: "1", name: "张三", id: "20230101", filled: "false" }],
    },
    {
      fixture: FIXTURES.quoted,
      count: 2,
      expected: [
        { seq: "1", name: "张,三", id: "20230101", filled: "false" },
        { seq: "2", name: '李"四', id: "20230102", filled: "false" },
      ],
    },
  ];

  const evidence = [];
  for (const item of importCases) {
    await withApp(browser, async ({ page }) => {
      await openImport(page);
      const preview = await previewRoster(page, item.fixture, item.count);
      assertEqual(preview.count, String(item.count), `${item.fixture.label} preview count`);
      assert(preview.text.trim().length > 0, `${item.fixture.label} preview text empty`);
      await confirmRosterImport(page, item.count);
      const rows = await readRows(page);
      assertEqual(rows.length, item.count, `${item.fixture.label} row count`);
      assertEqual(
        rows.map(({ seq, name, id, filled }) => ({ seq, name, id, filled })),
        item.expected,
        `${item.fixture.label} rows`,
      );
      assertEqual(rows.map((row) => row.seq), item.expected.map((row) => row.seq), `${item.fixture.label} seq`);
      if (item.fixture === FIXTURES.extra) {
        const stored = await readStoredRoster(page);
        assertEqual(stored.headers, ["姓名", "名字", "学号", "班级"], "extra headers");
        assertEqual(stored.rows[0].extra, ["小三", "高一3班"], "extra retained values");
        assert(preview.columns.includes("名字"), "extra preview omitted 名字 column");
      }
      evidence.push(`${item.fixture.label}:${preview.count}`);
    });
  }

  const rejections = [
    ["empty", Buffer.alloc(0)],
    ["blank", Buffer.from("\n\n", "utf8")],
    ["data-first", Buffer.from("张三,20230101\n", "utf8")],
    ["class-score", Buffer.from("班级,成绩\n高一3班,88\n", "utf8")],
    ["binary", Buffer.from([0xff, 0xfe, 0x00, 0x01, 0xff])],
  ];

  for (let index = 0; index < rejections.length; index += 1) {
    const [label, buffer] = rejections[index];
    await withApp(browser, async ({ page }) => {
      await openImport(page);
      await selectRosterFile(page, { name: `${label}.csv`, buffer });
      const rejected = await waitImportError(page);
      assertEqual(rejected.dataError, "true", `${label} data-error`);
      assertEqual(rejected.open, true, `${label} dialog open`);
      assertEqual(rejected.count, null, `${label} summary data-count`);
      assertEqual(await page.locator('[data-testid="roster-row"]').count(), 0, `${label} row count`);
      assertEqual(await readStorage(page), null, `${label} storage`);
      if (index === 0) {
        await previewRoster(page, FIXTURES.A, 3);
        await confirmRosterImport(page, 3);
        assertEqual((await readRows(page)).length, 3, "reselect recovery row count");
      }
    });
  }

  let sample;
  await withApp(browser, async ({ page }) => {
    await openImport(page);
    sample = await captureDownload(page, () => page.locator('[data-testid="import-sample"]').click());
    assertEqual([...sample.buffer.subarray(0, 3)], [0xef, 0xbb, 0xbf], "sample BOM");
    const lines = sample.text.replace(/^\uFEFF/, "").split(/\r\n|\n/).filter(Boolean);
    assert(lines.length >= 4, `sample lines=${lines.length}`);
  });

  return `imports=${evidence.join(",")}; rejects=5(all data-error=true,count=null,rows=0,storage=null); reselect=3 rows; sample=${sample.name}:BOM+${sample.text.replace(/^\uFEFF/, "").split(/\r\n|\n/).filter(Boolean).length} lines; via=${sample.via}`;
}

async function testH2(browser) {
  await withApp(browser, async ({ page }) => {
    await compute(page, "+", ["12", "30", "8"]);
    let calc = await readCalc(page);
    assertEqual(calc.resultValue, "50", "first result");
    assertEqual(calc.state, "result", "first state");
    await compute(page, "*", ["2", "3", "4"]);
    calc = await readCalc(page);
    assertEqual(calc.resultValue, "24", "second result");
    assertEqual(calc.state, "result", "second state");
    assertEqual((await DOM.historyCount(page)), 2, "pre-import history");

    await openImport(page);
    await previewRoster(page, FIXTURES.A, 3);
    await confirmRosterImport(page, 3);
    const rows = await readRows(page);
    const next = await readNext(page);
    const after = await readCalc(page);
    const summary = await readSummary(page);
    assertEqual(rows.length, 3, "confirm row count");
    assertEqual(rows.map((row) => row.filled), ["false", "false", "false"], "confirm filled flags");
    assert(summary.includes("已录 0"), `summary missing 已录 0: ${summary}`);
    assertEqual(next.seq, "1", "confirm next seq");
    assertEqual(after.state, "select", "confirm state");
    assertEqual(after.operator, null, "confirm operator");
    assertEqual(after.expression, "", "confirm expression");
    assertEqual(after.resultValue, null, "confirm result");
    assertEqual(after.input, "", "confirm input");
    assertEqual(after.editVisible, false, "confirm edit draft visible");
    assertEqual(await DOM.historyCount(page), 0, "confirm history");
  });

  await withApp(browser, async ({ page }) => {
    await compute(page, "+", ["12", "30", "8"]);
    await compute(page, "*", ["2", "3", "4"]);
    const baselineCalc = await readCalc(page);
    const baselineHistory = await readHistory(page);
    assertEqual(baselineCalc.resultValue, "24", "cancel baseline result");
    assertEqual(baselineHistory.snapshots.length, 2, "cancel baseline history");

    await openImport(page);
    await previewRoster(page, FIXTURES.A, 3);
    await page.locator('[data-testid="import-cancel"]').click();
    await expectDialogClosedAndProjectedFocus(page, '[data-testid="roster-import"]');
    assertEqual(await readCalc(page), baselineCalc, "cancel calc state");
    assertEqual(await readHistory(page), baselineHistory, "cancel history state");
    assertEqual(await page.locator('[data-testid="roster"]').isVisible(), false, "cancel roster visible");

    await openImport(page);
    await previewRoster(page, FIXTURES.A, 3);
    await page.keyboard.press("Escape");
    await expectDialogClosedAndProjectedFocus(page, '[data-testid="roster-import"]');
    assertEqual(await readCalc(page), baselineCalc, "escape calc state");
    assertEqual(await readHistory(page), baselineHistory, "escape history state");
    assertEqual(await page.locator('[data-testid="roster"]').isVisible(), false, "escape roster visible");
  });

  return "confirm=3 rows/all-filled=false/summary-has-已录0/next=1/select/no-operator/empty-expression/result=null/input=/edit-hidden/history=0; cancel+Esc preserve calc+2-history and no roster";
}

async function testH3(browser) {
  await withApp(browser, async ({ page }) => {
    await importRoster(page, FIXTURES.A, 3);
    await compute(page, "/", ["5", "0"]);
    await page.waitForFunction(() => document.querySelector('[data-testid="result"]')?.getAttribute("data-error") === "true");
    let calc = await readCalc(page);
    let rows = await readRows(page);
    let next = await readNext(page);
    assertEqual(calc.state, "error", "divzero state");
    assertEqual(calc.resultError, "true", "divzero result error");
    assertEqual(rows.filter((row) => row.filled === "true").length, 0, "divzero filled");
    assertEqual(next.seq, "1", "divzero next");

    await clickEquals(page);
    calc = await readCalc(page);
    rows = await readRows(page);
    next = await readNext(page);
    assertEqual(rows.filter((row) => row.filled === "true").length, 0, "empty equals filled");
    assertEqual(next.seq, "1", "empty equals next");
    assertEqual(calc.state, "error", "empty equals state");

    const expected = [
      { scores: ["30", "—", "—"], expressions: ["10 + 20", "", ""], next: "2", filledCount: 1 },
      { scores: ["30", "7", "—"], expressions: ["10 + 20", "3 + 4", ""], next: "3", filledCount: 2 },
      { scores: ["30", "7", "11"], expressions: ["10 + 20", "3 + 4", "5 + 6"], next: null, filledCount: 3 },
    ];
    const steps = [
      ["10", "20"],
      ["3", "4"],
      ["5", "6"],
    ];
    for (let index = 0; index < steps.length; index += 1) {
      await compute(page, "+", steps[index]);
      await waitFilled(page, index + 1);
      rows = await readRows(page);
      next = await readNext(page);
      const summary = await readSummary(page);
      calc = await readCalc(page);
      assertEqual(rows.map((row) => row.score), expected[index].scores, `fill ${index + 1} scores`);
      assertEqual(rows.map((row) => row.expression), expected[index].expressions, `fill ${index + 1} expressions`);
      assertEqual(rows.map((row) => row.filled), ["true", "true", "true"].map((_, rowIndex) => (rowIndex < expected[index].filledCount ? "true" : "false")), `fill ${index + 1} flags`);
      assertEqual(next.seq, expected[index].next, `fill ${index + 1} next`);
      assert(summary.includes(`已录 ${expected[index].filledCount}`), `fill ${index + 1} summary=${summary}`);
      if (index === 2) assert(calc.label.includes("名单已录满"), `full state label=${calc.label}`);
    }

    await compute(page, "+", ["1", "1"]);
    await page.waitForFunction(() => document.querySelector('[data-testid="result"]')?.getAttribute("data-value") === "2");
    calc = await readCalc(page);
    rows = await readRows(page);
    next = await readNext(page);
    assertEqual(calc.resultValue, "2", "full overflow result");
    assertEqual(rows.length, 3, "full overflow row count");
    assertEqual(rows.map((row) => row.score), ["30", "7", "11"], "full overflow scores");
    assertEqual(next.count, 0, "full overflow next count");
    assert(calc.label.includes("名单已录满"), `full overflow label=${calc.label}`);
  });
  return "5/0 -> error, no fill, next=1; empty = no fill; fills 30(seq1,next2) -> 7(seq2,next3) -> 11(seq3,no next); extra 1+1=2 leaves 3 rows/scores 30,7,11 and label 名单已录满";
}

async function testH4(browser) {
  await withApp(browser, async ({ page }) => {
    await importRoster(page, FIXTURES.A, 3);
    await compute(page, "+", ["12", "30", "8"]);
    await compute(page, "+", ["9", "1"]);
    await compute(page, "+", ["5", "5"]);
    await waitFilled(page, 3);
    const before = await readRows(page);
    assertEqual(before.map((row) => row.score), ["50", "10", "10"], "H4 initial scores");
    const firstBefore = before[0];
    const thirdBefore = before[2];

    await page.locator('[data-testid="roster-row"][data-seq="2"] [data-testid="roster-edit"]').click();
    await page.waitForFunction(() => document.querySelector("main.app")?.getAttribute("data-state") === "edit");
    assertEqual(await DOM.isVisible(page, S.editDraft), true, "edit draft visible");
    assert((await readCalc(page)).label.includes("李四"), "edit label lacks 李四");
    assertEqual(await DOM.liveOperands(page), ["9", "1"], "edit operands");
    await page.locator('[data-testid="operand-input"]').first().fill("7");
    await page.locator('[data-testid="key-equals"]').click();
    await waitRowScore(page, 2, 8);
    const after = await readRows(page);
    assertEqual(after.length, 3, "edited row count");
    assertEqual(after.map((row) => row.score), ["50", "8", "10"], "edited scores");
    assertEqual([after[1].seq, after[1].name], ["2", "李四"], "edited identity");
    assert(after[1].expression.includes("7"), `edited expression=${after[1].expression}`);
    assertEqual(after[0], firstBefore, "edited first row drift");
    assertEqual(after[2], thirdBefore, "edited third row drift");
    assertEqual(await readNext(page).then((next) => next.count), 0, "edited next count");

    await page.reload({ waitUntil: "load" });
    await waitRowCount(page, 3);
    const reloaded = await readRows(page);
    assertEqual(reloaded[1].score, "8", "reload edited score");
    assertEqual((await readCalc(page)).state, "select", "reload state");

    await page.locator('[data-testid="roster-row"][data-seq="2"] [data-testid="roster-edit"]').click();
    await page.locator('[data-testid="operand-input"]').first().fill("11");
    await page.locator('[data-testid="edit-cancel"]').click();
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "编辑第 2 位 李四 的成绩");
    assertEqual((await readRows(page))[1].score, "8", "cancel changed score");
    assertEqual(await DOM.isVisible(page, S.editDraft), false, "cancel draft visible");
  });

  await withApp(browser, async ({ page }) => {
    await importRoster(page, FIXTURES.five, 5);
    await compute(page, "+", ["12", "30", "8"]);
    await compute(page, "+", ["9", "1"]);
    await waitFilled(page, 2);
    await page.locator('[data-testid="roster-row"][data-seq="1"] [data-testid="roster-edit"]').click();
    await page.locator('[data-testid="operand-input"]').first().fill("20");
    await page.locator('[data-testid="key-equals"]').click();
    await waitRowScore(page, 1, 58);
    const rows = await readRows(page);
    const next = await readNext(page);
    assertEqual(rows.length, 5, "partial row count");
    assertEqual(rows.filter((row) => row.filled === "true").length, 2, "partial filled count");
    assertEqual(next.seq, "3", "partial next seq");
  });

  await withApp(browser, async ({ page }) => {
    await importRoster(page, FIXTURES.fifty, 50);
    for (let index = 0; index < 50; index += 1) await compute(page, "+", ["10", "10"]);
    await waitFilled(page, 50);
    await page.evaluate(() => document.querySelectorAll('[data-testid="roster-row"]')[49].scrollIntoView());
    await page.locator('[data-testid="roster-row"]').nth(49).locator('[data-testid="roster-edit"]').click();
    await page.waitForFunction(() => {
      const draft = document.querySelector('[data-testid="edit-draft"]');
      if (!draft || draft.hidden) return false;
      const rect = draft.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight;
    });
    const draftRect = await page.locator('[data-testid="edit-draft"]').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, innerHeight: window.innerHeight };
    });
    await page.locator('[data-testid="edit-cancel"]').click();
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "编辑第 50 位 学生50 的成绩");
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    assertEqual(focused, "编辑第 50 位 学生50 的成绩", "last-row focus restore");
    return draftRect;
  });

  return "3-fill edit seq2 李四 10->8, first/third unchanged, reload=8, cancel keeps 8; 5-person 2 filled next=3; 50-row last edit draft fully in viewport and cancel focuses row-50 edit";
}

async function testH5(browser) {
  await withApp(browser, async ({ page }) => {
    await importRoster(page, FIXTURES.A, 3);
    const rows = await readRows(page);
    assertEqual(rows.map((row) => row.seq), ["1", "2", "3"], "roster data-seq");
    assertEqual(rows.map((row) => row.seqText), ["1", "2", "3"], "visible roster seq");
  });

  await withApp(browser, async ({ page }) => {
    await compute(page, "+", ["12", "30", "8"]);
    await compute(page, "+", ["3", "4"]);
    const before = await readHistory(page);
    assertEqual(before.snapshots.length, 2, "history count before edit");
    assertEqual(before.snapshots.map((item) => item.result), ["7", "50"], "history newest-first");
    assertEqual(before.seqAttrs, [null, null], "history data-seq attrs");
    await page.locator('[data-testid="history-edit"]').nth(1).click();
    await page.locator('[data-testid="operand-input"]').nth(1).fill("5");
    await page.locator('[data-testid="key-equals"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="history-item"]').length === 3);
    const after = await readHistory(page);
    assertEqual(after.snapshots.length, 3, "history count after edit");
    assertEqual(after.snapshots[0].result, "25", "edited history appended result");
    assertEqual(after.snapshots[0].expression, "12 + 5 + 8", "edited history expression");
    assertEqual(after.snapshots.slice(1), before.snapshots, "history originals drift");
  });

  return "roster data-seq/visible=1,2,3; no-roster history data-seq=null/null, results 7,50 newest-first; edit older 12+30+8 with operand 30->5 appends 25 -> 3 items and originals unchanged";
}

async function exportSnapshot(page) {
  return {
    rows: await readRows(page),
    storage: await readStorage(page),
    calc: calcCore(await readCalc(page)),
  };
}

async function testH6(browser) {
  let exportedA;
  await withApp(browser, async ({ page }) => {
    await importRoster(page, FIXTURES.A, 3);
    await compute(page, "+", ["12", "30", "8"]);
    await compute(page, "+", ["9", "1"]);
    await waitFilled(page, 2);
    const before = await exportSnapshot(page);
    exportedA = await captureDownload(page, () => page.locator('[data-testid="roster-export"]').click());
    const expectedName = `高一3班-成绩-${dateStamp()}.csv`;
    assertEqual(exportedA.name, expectedName, "export filename");
    assert(/^高一3班-成绩-\d{8}\.csv$/.test(exportedA.name || ""), `export filename pattern=${exportedA.name}`);
    assertEqual([...exportedA.buffer.subarray(0, 3)], [0xef, 0xbb, 0xbf], "export A BOM");
    assert(
      [...exportedA.buffer].every((byte, index, bytes) => byte !== 0x0a || bytes[index - 1] === 0x0d),
      "export A contains non-CRLF LF",
    );
    const parsed = parseCsv(exportedA.text);
    assertEqual(parsed[0], ["序号", "学号", "姓名", "成绩", "班级"], "export A header");
    assertEqual(parsed.slice(1), [
      ["1", "20230101", "张三", "50", "高一3班"],
      ["2", "20230102", "李四", "10", "高一3班"],
      ["3", "20230103", "王五", "", "高一3班"],
    ], "export A rows");
    assertEqual(await exportSnapshot(page), before, "export A side effects");
    const saved = path.join(FIXTURE_DIR, `export-a-${ROUND}.csv`);
    fs.writeFileSync(saved, exportedA.buffer);
  });

  await withApp(browser, async ({ page }) => {
    await importRoster(page, FIXTURES.missingSeq, 1);
    const missingSeq = await captureDownload(page, () => page.locator('[data-testid="roster-export"]').click());
    assertEqual([...missingSeq.buffer.subarray(0, 3)], [0xef, 0xbb, 0xbf], "missing-seq BOM");
    const parsed = parseCsv(missingSeq.text);
    assertEqual(parsed[0][0], "序号", "missing-seq first header");
    assertEqual(parsed[0][parsed[0].length - 1], "成绩", "missing-seq last header");
    assertEqual(parsed[1], ["1", "20230109", "周五", "高三2班", ""], "missing-seq row");
    assert(parsed[0].includes("班级"), "missing-seq preserved class column");
  });

  await withApp(browser, async ({ page }) => {
    await importRoster(page, FIXTURES.missingScore, 1);
    const missingScore = await captureDownload(page, () => page.locator('[data-testid="roster-export"]').click());
    const parsed = parseCsv(missingScore.text);
    assertEqual(parsed[0], ["序号", "学号", "姓名", "成绩"], "missing-score header");
    assertEqual(parsed[1], ["1", "20230110", "吴六", ""], "missing-score row");
  });

  await withApp(browser, async ({ page }) => {
    await importRoster(page, FIXTURES.synonyms, 1);
    const synonyms = await captureDownload(page, () => page.locator('[data-testid="roster-export"]').click());
    const parsed = parseCsv(synonyms.text);
    assertEqual(parsed[0], ["序号", "姓名", "名字", "学号", "成绩"], "synonyms header");
    assertEqual(parsed[1], ["1", "张三", "小三", "20230101", ""], "synonyms row");
  });

  await withApp(browser, async ({ page }) => {
    await importRoster(page, FIXTURES.quoted, 2);
    await compute(page, "+", ["4", "6"]);
    await waitFilled(page, 1);
    const quoted = await captureDownload(page, () => page.locator('[data-testid="roster-export"]').click());
    assertEqual([...quoted.buffer.subarray(0, 3)], [0xef, 0xbb, 0xbf], "quoted BOM");
    const parsed = parseCsv(quoted.text);
    assertEqual(parsed[0], ["序号", "姓名", "学号", "备注", "成绩"], "quoted header");
    assertEqual(parsed[1], ["1", "张,三", "20230101", "含,逗号", "10"], "quoted comma name");
    assertEqual(parsed[2], ["2", '李"四', "20230102", "含\n换行", ""], "quoted quote/newline fields");
  });

  await withApp(browser, async ({ page }) => {
    await openImport(page);
    await previewRoster(page, { name: exportedA.name, buffer: exportedA.buffer }, 3);
    await confirmRosterImport(page, 3);
    const rows = await readRows(page);
    assertEqual(rows.map((row) => [row.name, row.id]), [
      ["张三", "20230101"],
      ["李四", "20230102"],
      ["王五", "20230103"],
    ], "reimport identity");
    assertEqual(rows.map((row) => row.filled), ["false", "false", "false"], "reimport filled flags");
  });

  return `A=${exportedA.name},BOM,CRLF,header+3rows,no-side-effects; missing-seq=序号-first/成绩-last; missing-score=成绩-last; synonyms=姓名+名字 retained; quoted=RFC4180 comma/quote/newline; reimport=3 people all filled=false; via=${exportedA.via}`;
}

async function testH7(browser) {
  await withApp(browser, async ({ page }) => {
    await importRoster(page, FIXTURES.A, 3);
    await compute(page, "+", ["12", "30", "8"]);
    await compute(page, "+", ["3", "4"]);
    await waitFilled(page, 2);
    const stored = await readStoredRoster(page);
    assertEqual(stored.version, 1, "stored version");
    assertEqual(stored.fileName, "高一3班.csv", "stored fileName");
    assertEqual(stored.headers, ["序号", "学号", "姓名", "成绩", "班级"], "stored headers");
    assertEqual(stored.rows.length, 3, "stored row count");
    assertEqual(stored.rows[0].entry.seq, 1, "stored first seq");
    assertEqual(stored.rows[0].entry.result, 50, "stored first result");
    assertEqual(stored.rows[0].entry.operands.map((operand) => operand.display), ["12", "30", "8"], "stored first operands");
    assertEqual(stored.rows[1].entry.seq, 2, "stored second seq");
    assertEqual(stored.rows[1].entry.operator, "+", "stored second operator");
    assertEqual(stored.rows[1].entry.operands.map((operand) => operand.display), ["3", "4"], "stored second operand display");
    assertEqual(stored.rows[1].entry.operands.map((operand) => operand.value), [3, 4], "stored second operand value");
    assertEqual(stored.rows[1].entry.expression, "3 + 4", "stored second expression");
    assertEqual(stored.rows[1].entry.result, 7, "stored second result");
    assertEqual(stored.rows[2].entry, null, "stored empty remainder");

    await page.reload({ waitUntil: "load" });
    await waitRowCount(page, 3);
    const rows = await readRows(page);
    const next = await readNext(page);
    const calc = await readCalc(page);
    assertEqual(rows.map((row) => [row.filled, row.score]), [
      ["true", "50"],
      ["true", "7"],
      ["false", "—"],
    ], "reload roster state");
    assertEqual(next.seq, "3", "reload next");
    assertEqual(calc.state, "select", "reload state");
    assertEqual(calc.input, "", "reload input");
    assertEqual(calc.expression, "", "reload expression");
    assertEqual(calc.resultValue, null, "reload result");

    const dialogMessage = await confirmRosterClear(page);
    assertEqual(await readStorage(page), null, "clear storage key");
    assertEqual(await page.locator('[data-testid="roster"]').isVisible(), false, "clear roster visible");
    assertEqual(await DOM.historyCount(page), 0, "clear history count");
    assertEqual((await readCalc(page)).state, "select", "clear state");
    await page.reload({ waitUntil: "load" });
    assertEqual(await page.locator('[data-testid="roster"]').isVisible(), false, "clear reload roster");
    assertEqual(await DOM.historyCount(page), 0, "clear reload history");
    assertEqual((await readCalc(page)).state, "select", "clear reload state");
    assert(dialogMessage === null || dialogMessage.length > 0, "clear confirmation message");
  });

  await withCustom(
    browser,
    {
      initScript: () => {
        Storage.prototype.getItem = () => {
          throw new Error("blocked");
        };
        Storage.prototype.setItem = () => {
          throw new Error("blocked");
        };
      },
    },
    async ({ page, pageErrors }) => {
      await importRoster(page, FIXTURES.A, 3);
      await compute(page, "+", ["12", "30", "8"]);
      await waitFilled(page, 1);
      assertEqual((await readRows(page))[0].score, "50", "storage-unavailable score");
      const warning = page.locator("#storage-warning");
      assertEqual(await warning.isVisible(), true, "storage-unavailable warning visible");
      assert((await warning.textContent()).includes("本机存储不可用，刷新会丢失成绩。"), "storage-unavailable warning text");
      assertEqual(pageErrors.length, 0, "storage-unavailable pageerrors");
    },
  );

  for (const raw of ["{bad", '{"version":99}']) {
    await withCustom(
      browser,
      {
        initScript: ({ key, value }) => localStorage.setItem(key, value),
        initArg: { key: ROSTER_KEY, value: raw },
      },
      async ({ page, pageErrors }) => {
        assertEqual(await page.locator('[data-testid="roster"]').isVisible(), false, `bad-data roster ${raw}`);
        assertEqual(await page.locator('[data-testid="roster-row"]').count(), 0, `bad-data rows ${raw}`);
        assertEqual(await readStorage(page), raw, `bad-data preserved ${raw}`);
        assertEqual(pageErrors.length, 0, `bad-data pageerrors ${raw}`);
      },
    );
  }

  return "stored v1 rows=3 row0 seq1 12+30+8=50, row1 seq2 3+4=7, row2 empty (sequential-fill-consistent reading of literal row0=null; H3 requires seq1 first); reload 50/7/empty next3 select; clear removes key/roster/history and survives reload; Storage throw -> score50 + warning + 0 pageerrors; {bad}/version99 ignored/preserved + 0 pageerrors";
}

async function measureLayoutState(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      if (element.disabled) return false;
      if (element.getClientRects().length === 0) return false;
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const rectOf = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height };
    };
    const controls = [...document.querySelectorAll("input, button")]
      .filter(visible)
      .map((element) => ({
        tag: element.tagName,
        testid: element.getAttribute("data-testid"),
        key: element.getAttribute("data-key"),
        op: element.getAttribute("data-op"),
        fontSize: parseFloat(getComputedStyle(element).fontSize),
        rect: rectOf(element),
      }));
    const roster = document.querySelector('[data-testid="roster"]');
    const rows = [...document.querySelectorAll('[data-testid="roster-row"]')];
    const rowMetrics = rows.map((row) => ({
      tag: row.tagName,
      role: row.getAttribute("role"),
      seq: row.getAttribute("data-seq"),
      filled: row.getAttribute("data-filled"),
      name: row.getAttribute("data-name"),
      rowFont: parseFloat(getComputedStyle(row).fontSize),
      scoreFont: row.querySelector('[data-testid="roster-score"]')
        ? parseFloat(getComputedStyle(row.querySelector('[data-testid="roster-score"]')).fontSize)
        : null,
      expressionFont: row.querySelector('[data-testid="roster-expression"]')
        ? parseFloat(getComputedStyle(row.querySelector('[data-testid="roster-expression"]')).fontSize)
        : null,
      editLabel: row.querySelector('[data-testid="roster-edit"]')?.getAttribute("aria-label") ?? null,
    }));
    const next = document.querySelector('[data-testid="roster-next"]');
    const firstRow = rows[0] || null;
    const tools = document.querySelector("#history-tools");
    const rosterImport = document.querySelector('[data-testid="roster-import"]');
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      state: document.querySelector("main.app")?.getAttribute("data-state") ?? null,
      controls,
      roster: roster
        ? {
            tag: roster.tagName,
            role: roster.getAttribute("role"),
            visible: roster.getClientRects().length > 0,
          }
        : null,
      rows: rowMetrics,
      next: next ? { text: (next.textContent || "").trim(), seq: next.getAttribute("data-seq") } : null,
      toolsRect: rectOf(tools),
      rosterImportRect: rectOf(rosterImport),
      firstRowRect: rectOf(firstRow),
      editDraftRect: rectOf(document.querySelector('[data-testid="edit-draft"]')),
    };
  });
}

async function inspectDialog(page, { esc = true } = {}) {
  const dialog = page.locator('[data-testid="import-dialog"]');
  if (!(await dialog.evaluate((element) => element.open))) await openImport(page);
  await page.waitForFunction(() => {
    const element = document.querySelector('[data-testid="import-dialog"]');
    return element && element.open && document.activeElement && element.contains(document.activeElement);
  });
  const before = await page.evaluate(() => {
    const element = document.querySelector('[data-testid="import-dialog"]');
    const active = document.activeElement;
    const rect = active.getBoundingClientRect();
    const style = getComputedStyle(active);
    return {
      tagName: element.tagName,
      open: element.open,
      modal: element.matches(":modal"),
      activeTag: active.tagName,
      activeTestid: active.getAttribute("data-testid"),
      activeInside: element.contains(active),
      activeVisible:
        active.getClientRects().length > 0 && style.display !== "none" && style.visibility !== "hidden",
      dialogRect: (() => {
        const box = element.getBoundingClientRect();
        return { width: box.width, height: box.height, top: box.top, bottom: box.bottom };
      })(),
      activeRect: { width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom },
    };
  });
  assertEqual(before.tagName, "DIALOG", "dialog tagName");
  assertEqual(before.open, true, "dialog open");
  assertEqual(before.modal, true, "dialog :modal");
  assertEqual(before.activeTag, "BUTTON", "dialog active tag");
  assertEqual(before.activeInside, true, "dialog active inside");
  assertEqual(before.activeVisible, true, "dialog active visible");
  if (esc) {
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector('[data-testid="import-dialog"]')?.open === false);
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("data-testid") === "roster-import",
    );
  }
  const after = await page.evaluate(() => ({
    open: document.querySelector('[data-testid="import-dialog"]')?.open ?? null,
    activeTestid: document.activeElement?.getAttribute("data-testid") ?? null,
  }));
  return { before, after };
}

async function assertLayoutState(page, label) {
  const metrics = await measureLayoutState(page);
  assert(metrics.innerWidth >= 240 && metrics.innerHeight >= 160, `${label} viewport=${metrics.innerWidth}x${metrics.innerHeight}`);
  assert(metrics.docOverflow <= 1, `${label} docOverflow=${metrics.docOverflow}`);
  assert(metrics.bodyOverflow <= 1, `${label} bodyOverflow=${metrics.bodyOverflow}`);
  const tooSmall = metrics.controls.filter(
    (control) => control.rect.width < 43.5 || control.rect.height < 43.5,
  );
  assert(
    tooSmall.length === 0,
    `${label} controls <43.5: ${tooSmall.map((control) => `${control.testid || control.key || control.op}:${control.rect.width.toFixed(2)}x${control.rect.height.toFixed(2)}`).join(",")}`,
  );
  const inputFonts = metrics.controls.filter((control) => control.tag === "INPUT").map((control) => control.fontSize);
  assert(inputFonts.every((font) => font >= 15.5), `${label} input fonts=${inputFonts.join(",")}`);
  if (metrics.rows.length > 0) {
    const rowFonts = metrics.rows.flatMap((row) => [row.rowFont, row.scoreFont, row.expressionFont]).filter(Number.isFinite);
    assert(rowFonts.every((font) => font >= 12.5), `${label} roster fonts=${rowFonts.join(",")}`);
    assert(
      metrics.roster &&
        (metrics.roster.role === "list" || /^(TABLE|UL)$/i.test(metrics.roster.tag)),
      `${label} roster semantics=${fmt(metrics.roster)}`,
    );
    for (const row of metrics.rows) {
      assert(
        /^(ARTICLE|LI|TR)$/i.test(row.tag) || row.role === "listitem",
        `${label} row${row.seq} semantics tag=${row.tag} role=${row.role}`,
      );
    }
    if (metrics.rows[2] && metrics.rows[2].editLabel) {
      assert(metrics.rows[2].editLabel.includes("编辑第 3 位"), `${label} row3 aria-label=${metrics.rows[2].editLabel}`);
      assert(metrics.rows[2].editLabel.includes(metrics.rows[2].name), `${label} row3 name missing aria-label=${metrics.rows[2].editLabel}`);
    }
    if (metrics.next) assert(metrics.next.text.includes("下一位"), `${label} next text=${metrics.next.text}`);
    assert(
      metrics.rosterImportRect && metrics.firstRowRect && metrics.rosterImportRect.bottom <= metrics.firstRowRect.top + 0.5,
      `${label} roster-import bottom=${metrics.rosterImportRect?.bottom} first row top=${metrics.firstRowRect?.top}`,
    );
  }
  return metrics;
}

async function testH8(browser) {
  const details = [];
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    const tag = `${viewport.width}x${viewport.height}`;
    const cdp = viewport.width === 320;
    const make = (fn) => withCustom(browser, { ...viewport, cdp }, fn);

    const stage = await make(async ({ page }) => {
      await openImport(page);
      const metrics = await assertLayoutState(page, `${tag}/start`);
      const dialog = await inspectDialog(page);
      return { metrics, dialog };
    });
    assertEqual(stage.metrics.innerWidth, viewport.width, `${tag} scripted width`);

    const preview = await make(async ({ page }) => {
      await openImport(page);
      const previewInfo = await previewRoster(page, FIXTURES.A, 3);
      const metrics = await assertLayoutState(page, `${tag}/preview`);
      const dialog = await inspectDialog(page);
      return { metrics, dialog, previewInfo };
    });
    assertEqual(preview.previewInfo.count, "3", `${tag} preview count`);

    const mixed = await make(async ({ page }) => {
      await importRoster(page, FIXTURES.three, 3);
      await compute(page, "+", ["10", "20"]);
      await compute(page, "+", ["3", "4"]);
      await compute(page, "+", ["5", "6"]);
      await waitFilled(page, 3);
      await page.evaluate((key) => {
        const stored = JSON.parse(localStorage.getItem(key));
        stored.rows[1].entry = null;
        localStorage.setItem(key, JSON.stringify(stored));
      }, ROSTER_KEY);
      await page.reload({ waitUntil: "load" });
      await waitRowCount(page, 3);
      const metrics = await assertLayoutState(page, `${tag}/mixed`);
      const dialog = await inspectDialog(page);
      return { metrics, dialog };
    });
    assertEqual(mixed.metrics.rows.length, 3, `${tag} mixed rows`);
    assertEqual(mixed.metrics.rows.filter((row) => row.filled === "true").length, 2, `${tag} mixed filled`);
    assertEqual(mixed.metrics.rows[2].name, "李四", `${tag} mixed row3 name`);
    assert(mixed.metrics.rows[2].editLabel.includes("李四"), `${tag} mixed row3 edit label`);
    assertEqual(mixed.metrics.next?.seq, "2", `${tag} mixed next seq`);
    assert(mixed.metrics.next && mixed.metrics.next.text.includes("下一位"), `${tag} mixed next`);

    const fifty = await make(async ({ page }) => {
      await importRoster(page, FIXTURES.fifty, 50);
      const metrics = await assertLayoutState(page, `${tag}/fifty`);
      const dialog = await inspectDialog(page);
      return { metrics, dialog };
    });
    assertEqual(fifty.metrics.rows.length, 50, `${tag} fifty rows`);

    const editing = await make(async ({ page }) => {
      await importRoster(page, FIXTURES.five, 5);
      await compute(page, "+", ["12", "30", "8"]);
      await compute(page, "+", ["9", "1"]);
      await waitFilled(page, 2);
      await page.locator('[data-testid="roster-row"][data-seq="2"] [data-testid="roster-edit"]').click();
      await page.waitForFunction(() => {
        const draft = document.querySelector('[data-testid="edit-draft"]');
        return draft && !draft.hidden;
      });
      const metrics = await assertLayoutState(page, `${tag}/edit`);
      const dialog = await inspectDialog(page);
      const afterDialogState = await readCalc(page);
      return { metrics, dialog, afterDialogState };
    });
    assertEqual(editing.metrics.state, "edit", `${tag} edit state`);
    assertEqual(editing.afterDialogState.state, "edit", `${tag} dialog close changed edit state`);

    for (const state of [stage, preview, mixed, fifty, editing]) {
      assertEqual(state.dialog.before.tagName, "DIALOG", `${tag} dialog tag`);
      assertEqual(state.dialog.after.open, false, `${tag} dialog closed`);
      assertEqual(state.dialog.after.activeTestid, "roster-import", `${tag} focus return`);
    }
    const minControl = Math.min(
      ...[stage, preview, mixed, fifty, editing].flatMap((state) =>
        state.metrics.controls.flatMap((control) => [control.rect.width, control.rect.height]),
      ),
    );
    const minInput = Math.min(
      ...[stage, preview, mixed, fifty, editing].flatMap((state) =>
        state.metrics.controls.filter((control) => control.tag === "INPUT").map((control) => control.fontSize),
      ),
    );
    const minRowFont = Math.min(
      ...[mixed, fifty, editing].flatMap((state) =>
        state.metrics.rows.flatMap((row) => [row.rowFont, row.scoreFont, row.expressionFont]).filter(Number.isFinite),
      ),
    );
    details.push(`${tag}:states=5,minControl=${minControl},minInputFont=${minInput},minRosterFont=${minRowFont},mixed=3rows/2filled,row3=${mixed.metrics.rows[2].editLabel},next=${mixed.metrics.next.text},dialog=DIALOG:modal,focusBack=roster-import`);
  }
  return details.join("; ");
}

function runSuite(args, label) {
  const result = spawnSync(process.execPath, [SUITE, ...args], {
    cwd: REPO,
    env: { ...process.env, PLAYWRIGHT_MODULE: process.env.PLAYWRIGHT_MODULE },
    encoding: "utf8",
    timeout: 900000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    label,
    status: result.status,
    signal: result.signal,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error ? String(result.error) : null,
  };
}

async function testH9() {
  const frozen = [
    ["core.mjs", "e15f0e95a86269e88c67c5af4b4af12650bb0cd3a4902f29e7ccfc9876e290ab"],
    ["continuity.mjs", "51521723e6df99dbfabd06ff855f42cfcba14a3652cb720119256802869f58ee"],
    ["edit.mjs", "f61188e63586e8afa2883f6db3d3e88f7cc216a9a0c8dc7d465953ad37ceadc1"],
    ["layout.mjs", "c96ed96499a18b9731a8e10dabb579a761d445534105caabfa7424803def65a0"],
    ["determinism.mjs", "64bc09c49ac56c21aef77bdd1a7f7c365b8791d0690076f5964b58f06e69ddff"],
  ];
  for (const [file, expected] of frozen) {
    const actual = sha256File(path.join(REPO, "tests/scenarios", file));
    assertEqual(actual, expected, `frozen ${file}`);
  }

  const baselineIds = [
    "self-contained", "cold-start", "compute", "arithmetic", "history-order", "reset",
    "continuity", "error-recovery", "sticky-operator", "edit-recompute", "edit-multi",
    "edit-invalid", "edit-divzero", "edit-cancel-restore", "edit-pending-replace",
    "edit-pending-recent-value", "layout", "determinism",
  ];
  const full = runSuite(["--artifact", ARTIFACT, "--json"], "full");
  assert(full.stdout.trim().length > 0, `full suite produced no JSON (status=${full.status}, stderr=${full.stderr})`);
  let parsed;
  try {
    parsed = JSON.parse(full.stdout);
  } catch (error) {
    throw new Error(`full suite JSON parse failed: ${error.message}; stdout=${full.stdout.slice(0, 1000)}`);
  }
  const byId = new Map(parsed.results.map((result) => [result.id, result]));
  const missing = baselineIds.filter((id) => !byId.has(id));
  assertEqual(missing, [], "missing baseline results");
  const failedBaseline = baselineIds.filter((id) => id !== "cold-start" && !byId.get(id).pass);
  assertEqual(failedBaseline, [], "failed baseline scenarios");
  const cold = byId.get("cold-start");
  assertEqual(cold.pass, false, "cold-start pass");
  assertEqual(
    cold.checks.filter((check) => !check.pass).map((check) => check.id),
    ["cold-start.keys-disabled"],
    "cold-start failing checks",
  );

  const listed = runSuite(["--list"], "list");
  assertEqual(listed.status, 0, `suite --list status=${listed.status}`);
  const rosterIds = listed.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("roster-"));
  assert(rosterIds.length >= 5, `roster ids=${rosterIds.join(",")}`);
  for (const keyword of ["import", "fill", "edit", "export", "storage"]) {
    assert(rosterIds.some((id) => id.includes(keyword)), `roster ids miss ${keyword}`);
  }

  const only = runSuite(["--artifact", ARTIFACT, "--only", rosterIds.join(","), "--json"], "only-roster");
  assert(only.stdout.trim().length > 0, `roster suite produced no JSON (status=${only.status}, stderr=${only.stderr})`);
  const onlyParsed = JSON.parse(only.stdout);
  assertEqual(onlyParsed.results.map((result) => result.id).sort(), [...rosterIds].sort(), "roster only ids");
  assertEqual(onlyParsed.results.filter((result) => !result.pass).map((result) => result.id), [], "roster only failures");

  return `five frozen sha256 match; baseline 17 pass, cold-start fail set={cold-start.keys-disabled}; roster ids=${rosterIds.join(",")}; roster-only all pass`;
}

async function testH10(browser) {
  const buffer = fs.readFileSync(ARTIFACT);
  const text = buffer.toString("utf8");
  assert(text.includes("</html>"), "artifact missing </html>");
  assert(buffer.length >= 1024, `artifact bytes=${buffer.length}`);
  const references = [];
  const collectAttributes = (tagName, attributeName) => {
    const expression = new RegExp(
      `<${tagName}\\b[^>]*\\b${attributeName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
      "gi",
    );
    for (const match of text.matchAll(expression)) references.push(match[1] ?? match[2] ?? match[3] ?? "");
  };
  collectAttributes("script", "src");
  collectAttributes("link", "href");
  collectAttributes("img", "src");
  for (const match of text.matchAll(/@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^"')\s;]+))/gi)) {
    references.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  for (const match of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')]+))\s*\)/gi)) {
    references.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  const external = references.filter((reference) => /^(https?:)?\/\//i.test(reference.trim()));
  assertEqual(external, [], "external references");

  async function sequence() {
    return withApp(browser, async ({ page }) => {
      await importRoster(page, FIXTURES.A, 3);
      await compute(page, "+", ["12", "30", "8"]);
      await compute(page, "+", ["9", "1"]);
      await waitFilled(page, 2);
      await page.locator('[data-testid="roster-row"][data-seq="1"] [data-testid="roster-edit"]').click();
      await page.locator('[data-testid="operand-input"]').first().fill("20");
      await page.locator('[data-testid="key-equals"]').click();
      await waitRowScore(page, 1, 58);
      const rows = await readRows(page);
      const download = await captureDownload(page, () => page.locator('[data-testid="roster-export"]').click());
      return {
        rows: rows.map((row) => ({
          "data-seq": row.seq,
          "data-name": row.name,
          "data-id": row.id,
          "data-filled": row.filled,
          score: row.score,
          expression: row.expression,
        })),
        csv: download.text,
        csvBytes: download.buffer,
      };
    });
  }

  const first = await sequence();
  const second = await sequence();
  assertEqual(first.rows, second.rows, "deterministic roster rows");
  assertEqual(first.csv, second.csv, "deterministic export text");
  assert(first.csvBytes.equals(second.csvBytes), "deterministic export bytes differ");
  assertEqual(first.rows.length, 3, "deterministic row count");
  assertEqual(first.rows.map((row) => row.score), ["58", "10", "—"], "deterministic scores");
  assertEqual(allPageErrors, [], "pageErrors aggregated");
  assertEqual(allConsoleErrors, [], "consoleErrors aggregated");
  return `bytes=${buffer.length},closed=true,externalRefs=0,pageErrors=${allPageErrors.length},consoleErrors=${allConsoleErrors.length},two-context rows-deep-equal,CSV-deep-equal,rows=${JSON.stringify(first.rows.map((row) => row.score))}`;
}

function readRenderMetrics(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      if (!element || element.disabled || element.getClientRects().length === 0) return false;
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const controls = [...document.querySelectorAll("input,button")].filter(visible);
    const rect = (element) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { top: box.top, right: box.right, bottom: box.bottom, left: box.left, width: box.width, height: box.height };
    };
    const sizes = controls.map(rect);
    const inputs = controls.filter((element) => element.tagName === "INPUT");
    const rows = [...document.querySelectorAll('[data-testid="roster-row"]')];
    const rowFonts = rows.flatMap((row) => [
      parseFloat(getComputedStyle(row).fontSize),
      row.querySelector('[data-testid="roster-score"]') ? parseFloat(getComputedStyle(row.querySelector('[data-testid="roster-score"]')).fontSize) : null,
      row.querySelector('[data-testid="roster-expression"]') ? parseFloat(getComputedStyle(row.querySelector('[data-testid="roster-expression"]')).fontSize) : null,
    ]).filter(Number.isFinite);
    const dialog = document.querySelector('[data-testid="import-dialog"]');
    const draft = document.querySelector('[data-testid="edit-draft"]');
    const next = document.querySelector('[data-testid="roster-next"]');
    const rosterImport = document.querySelector('[data-testid="roster-import"]');
    const firstRow = rows[0] || null;
    const secondRow = document.querySelector('[data-testid="roster-row"][data-seq="2"]');
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      visibleControls: controls.length,
      minControlWidth: sizes.length ? Math.min(...sizes.map((size) => size.width)) : null,
      minControlHeight: sizes.length ? Math.min(...sizes.map((size) => size.height)) : null,
      minInputFont: inputs.length ? Math.min(...inputs.map((element) => parseFloat(getComputedStyle(element).fontSize))) : null,
      minRosterFont: rowFonts.length ? Math.min(...rowFonts) : null,
      rows: rows.length,
      filled: rows.filter((row) => row.getAttribute("data-filled") === "true").length,
      nextSeq: next ? next.getAttribute("data-seq") : null,
      nextText: next ? (next.textContent || "").trim() : null,
      dialogOpen: dialog ? dialog.open : false,
      dialog: dialog ? { tag: dialog.tagName, open: dialog.open, modal: dialog.matches(":modal") } : null,
      dialogRect: rect(dialog),
      rosterRect: rect(document.querySelector('[data-testid="roster"]')),
      rosterImportRect: rect(rosterImport),
      firstRowRect: rect(firstRow),
      secondRowRect: rect(secondRow),
      editDraftRect: rect(draft && !draft.hidden ? draft : null),
      editVisible: Boolean(draft && !draft.hidden && draft.getClientRects().length > 0),
      activeTestid: document.activeElement?.getAttribute("data-testid") ?? null,
    };
  });
}

async function captureReviewStates(browser) {
  if (EXPECTED_REVIEW_STATES.length === 0 || EXPECTED_REVIEW_STATES.includes("none")) {
    return { images: [], renderLines: [], metricsText: "", metricsSha: null };
  }
  fs.mkdirSync(path.dirname(SHOT_DIR), { recursive: true });
  if (fs.existsSync(SHOT_DIR)) {
    for (const entry of fs.readdirSync(SHOT_DIR)) fs.rmSync(path.join(SHOT_DIR, entry), { recursive: true, force: true });
  }
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  const specs = [
    {
      id: "S1",
      width: 390,
      height: 844,
      cdp: false,
      async setup(page) {
        await openImport(page);
        await page.waitForFunction(() => document.querySelector('[data-testid="import-dialog"]')?.open === true);
      },
      verify(metrics) {
        assertEqual(metrics.dialogOpen, true, "S1 dialog open");
        assertEqual(metrics.dialog?.tag, "DIALOG", "S1 dialog tag");
        assertEqual(metrics.dialog?.modal, true, "S1 dialog modal");
      },
    },
    {
      id: "S2",
      width: 390,
      height: 844,
      cdp: false,
      async setup(page) {
        await compute(page, "+", ["12", "30", "8"]);
        await compute(page, "+", ["9", "1"]);
        await openImport(page);
        await previewRoster(page, FIXTURES.A, 3);
      },
      verify(metrics, page) {
        return page
          .locator('[data-testid="import-summary"]')
          .getAttribute("data-count")
          .then((count) => assertEqual(count, "3", "S2 preview count"));
      },
    },
    {
      id: "S3",
      width: 390,
      height: 844,
      cdp: false,
      async setup(page) {
        await importRoster(page, FIXTURES.five, 5);
        await compute(page, "+", ["12", "30", "8"]);
        await compute(page, "+", ["9", "1"]);
        await waitFilled(page, 2);
        await page.waitForFunction(() => document.querySelector('[data-testid="roster-next"]')?.getAttribute("data-seq") === "3");
        await page.evaluate(() => document.querySelector('[data-testid="roster"]').scrollIntoView({ block: "start" }));
      },
      verify(metrics) {
        assertEqual(metrics.rows, 5, "S3 rows");
        assertEqual(metrics.filled, 2, "S3 filled");
        assertEqual(metrics.nextSeq, "3", "S3 next");
        assert(metrics.dialogOpen === false, "S3 dialog unexpectedly open");
      },
    },
    {
      id: "S4",
      width: 320,
      height: 568,
      cdp: true,
      async setup(page) {
        await importRoster(page, FIXTURES.five, 5);
        await compute(page, "+", ["12", "30", "8"]);
        await compute(page, "+", ["9", "1"]);
        await compute(page, "+", ["5", "5"]);
        await waitFilled(page, 3);
        await page.locator('[data-testid="roster-row"][data-seq="2"] [data-testid="roster-edit"]').click();
        await page.waitForFunction(() => {
          const draft = document.querySelector('[data-testid="edit-draft"]');
          const row = document.querySelector('[data-testid="roster-row"][data-seq="2"]');
          if (!draft || draft.hidden || !row) return false;
          const draftRect = draft.getBoundingClientRect();
          const rowRect = row.getBoundingClientRect();
          return (
            draftRect.top >= 0 &&
            draftRect.bottom <= window.innerHeight &&
            rowRect.top >= 0 &&
            rowRect.bottom <= window.innerHeight
          );
        });
      },
      verify(metrics) {
        assertEqual(metrics.innerWidth, 320, "S4 CDP width");
        assertEqual(metrics.rows, 5, "S4 rows");
        assertEqual(metrics.filled, 3, "S4 filled");
        assertEqual(metrics.editVisible, true, "S4 edit visible");
        assert(metrics.editDraftRect && metrics.editDraftRect.top >= 0 && metrics.editDraftRect.bottom <= metrics.innerHeight, "S4 edit draft outside viewport");
      },
    },
  ];

  const images = [];
  const renderLines = [];
  for (const spec of specs) {
    if (!EXPECTED_REVIEW_STATES.includes(spec.id)) continue;
    await withCustom(browser, { width: spec.width, height: spec.height, cdp: spec.cdp }, async ({ page }) => {
      await spec.setup(page);
      await page.waitForTimeout(150);
      const metrics = await readRenderMetrics(page);
      await spec.verify(metrics, page);
      const buffer = await page.screenshot({ type: "png", animations: "disabled", caret: "hide" });
      const size = pngSize(buffer);
      assert(size.width >= 240 && size.height >= 160, `${spec.id} screenshot ${size.width}x${size.height}`);
      if (spec.cdp) {
        assert(
          (size.width === 320 && size.height === 568) || (size.width === 640 && size.height === 1136),
          `${spec.id} CDP screenshot must be 320x568 or 640x1136, got ${size.width}x${size.height}`,
        );
      }
      assert(buffer.length > 0, `${spec.id} screenshot empty`);
      const stats = await pngPixelStats(browser, buffer);
      assert(stats.uniqueColors > 1, `${spec.id} screenshot is pure color (${stats.uniqueColors})`);
      assert(stats.nonTransparent > 0, `${spec.id} screenshot transparent`);
      const previous = images.find((image) => image.sha256 === sha256(buffer));
      assert(!previous, `${spec.id} screenshot duplicates ${previous?.file}`);
      const file = `review-shots/r${ROUND}/${spec.id}.png`;
      const absolute = path.join(OUT_DIR, file);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, buffer);
      images.push({
        file,
        sha256: sha256(buffer),
        width: size.width,
        height: size.height,
        stats,
        metrics,
        id: spec.id,
        cdp: spec.cdp,
      });
      const linePrefix = spec.id;
      renderLines.push(`${linePrefix}.cdp=${spec.cdp}`);
      renderLines.push(`${linePrefix}.viewport=${metrics.innerWidth}x${metrics.innerHeight}`);
      renderLines.push(`${linePrefix}.docOverflow=${metrics.docOverflow}`);
      renderLines.push(`${linePrefix}.bodyOverflow=${metrics.bodyOverflow}`);
      renderLines.push(`${linePrefix}.visibleControls=${metrics.visibleControls}`);
      renderLines.push(`${linePrefix}.minControl=${metrics.minControlWidth}x${metrics.minControlHeight}`);
      renderLines.push(`${linePrefix}.minInputFont=${metrics.minInputFont}`);
      renderLines.push(`${linePrefix}.minRosterFont=${metrics.minRosterFont}`);
      renderLines.push(`${linePrefix}.rows=${metrics.rows}`);
      renderLines.push(`${linePrefix}.filled=${metrics.filled}`);
      renderLines.push(`${linePrefix}.nextSeq=${metrics.nextSeq}`);
      renderLines.push(`${linePrefix}.dialogOpen=${metrics.dialogOpen}`);
      renderLines.push(`${linePrefix}.dialog=${metrics.dialog ? `${metrics.dialog.tag}:${metrics.dialog.modal}` : "none"}`);
      renderLines.push(`${linePrefix}.dialogRect=${metrics.dialogRect ? `${metrics.dialogRect.width}x${metrics.dialogRect.height}` : "none"}`);
      renderLines.push(`${linePrefix}.editVisible=${metrics.editVisible}`);
      renderLines.push(`${linePrefix}.firstRowRect=${metrics.firstRowRect ? `${metrics.firstRowRect.top},${metrics.firstRowRect.bottom},${metrics.firstRowRect.width}x${metrics.firstRowRect.height}` : "none"}`);
      renderLines.push(`${linePrefix}.secondRowRect=${metrics.secondRowRect ? `${metrics.secondRowRect.top},${metrics.secondRowRect.bottom},${metrics.secondRowRect.width}x${metrics.secondRowRect.height}` : "none"}`);
      renderLines.push(`${linePrefix}.editDraftRect=${metrics.editDraftRect ? `${metrics.editDraftRect.top},${metrics.editDraftRect.bottom},${metrics.editDraftRect.width}x${metrics.editDraftRect.height}` : "none"}`);
      renderLines.push(`${linePrefix}.activeTestid=${metrics.activeTestid}`);
      renderLines.push(`${linePrefix}.png=${size.width}x${size.height}`);
      renderLines.push(`${linePrefix}.bytes=${buffer.length}`);
      renderLines.push(`${linePrefix}.uniqueColors=${stats.uniqueColors}`);
      renderLines.push(`${linePrefix}.luminanceStdDev=${stats.luminanceStdDev}`);
      renderLines.push(`${linePrefix}.sha256=${sha256(buffer)}`);
    });
  }
  const expectedFiles = EXPECTED_REVIEW_STATES.map((id) => `${id}.png`).sort();
  const actualFiles = fs.readdirSync(SHOT_DIR).sort();
  assertEqual(actualFiles, expectedFiles, "review shot file set");
  const hashes = images.map((image) => image.sha256);
  assertEqual(new Set(hashes).size, hashes.length, "review shot hashes unique");
  return { images, renderLines, metricsSha: null };
}

function makeHardText(results, renderFailure = null) {
  const lines = [
    `ROUND: ${ROUND}`,
    `ARTIFACT_SHA256: ${sha256(fs.readFileSync(ARTIFACT))}`,
    `VERIFIER_SHA256: ${sha256File(fileURLToPath(import.meta.url))}`,
  ];
  const failed = [];
  for (let index = 1; index <= 10; index += 1) {
    const id = `H${index}`;
    const result = results.get(id);
    let pass = Boolean(result && result.pass);
    let detail = result ? result.detail : "not measured";
    if (id === "H8" && renderFailure) {
      pass = false;
      detail = `${detail}; render=${renderFailure}`;
    }
    if (!pass) failed.push(id);
    lines.push(`${id} ${pass ? "PASS" : "FAIL"} — ${cleanDetail(detail)}`);
  }
  lines.push(failed.length === 0 ? "HARD: PASS" : `HARD: FAIL (${failed.join(",")})`);
  return { text: `${lines.join("\n")}\n`, failed };
}

async function main() {
  if (PHASE !== "first") {
    throw new Error(`verify.mjs is the phase=first instrument; phase=${PHASE}`);
  }
  if (!fs.existsSync(ARTIFACT)) throw new Error(`artifact not found: ${ARTIFACT}`);

  const browser = await launchBrowser();
  let renderResult = null;
  let renderFailure = null;
  try {
    await runH("H1", () => testH1(browser));
    await runH("H2", () => testH2(browser));
    await runH("H3", () => testH3(browser));
    await runH("H4", () => testH4(browser));
    await runH("H5", () => testH5(browser));
    await runH("H6", () => testH6(browser));
    await runH("H7", () => testH7(browser));
    await runH("H8", () => testH8(browser));
    try {
      renderResult = await captureReviewStates(browser);
    } catch (error) {
      renderFailure = cleanDetail(error.message || String(error));
      console.error(`RENDER FAIL: ${error.stack || error}`);
    }
    await runH("H10", () => testH10(browser));
  } finally {
    await browser.close();
  }

  await runH("H9", () => testH9());

  if (renderResult && renderResult.renderLines.length > 0) {
    const header = [
      `ROUND: ${ROUND}`,
      `ARTIFACT_SHA256: ${sha256(fs.readFileSync(ARTIFACT))}`,
      `VERIFIER_SHA256: ${sha256File(fileURLToPath(import.meta.url))}`,
    ];
    const renderText = `${[...header, ...renderResult.renderLines].join("\n")}\n`;
    fs.writeFileSync(RENDER_FILE, renderText);
    const manifest = {
      round: ROUND,
      artifact_sha256: sha256(fs.readFileSync(ARTIFACT)),
      verifier_sha256: sha256File(fileURLToPath(import.meta.url)),
      metrics_sha256: sha256(Buffer.from(renderText, "utf8")),
      shots: renderResult.images.map((image) => ({
        file: image.file,
        sha256: image.sha256,
        width: image.width,
        height: image.height,
      })),
      adhoc: [],
    };
    fs.writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  const hard = makeHardText(RESULTS, renderFailure);
  fs.writeFileSync(HARD_FILE, hard.text);
  process.stdout.write(`\nWROTE ${HARD_FILE}\n`);
  if (renderResult) {
    process.stdout.write(`WROTE ${RENDER_FILE}\nWROTE ${MANIFEST_FILE}\n`);
  }
  process.stdout.write(hard.text);
  process.exitCode = hard.failed.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  const hard = makeHardText(RESULTS, cleanDetail(error.message || String(error)));
  fs.writeFileSync(HARD_FILE, hard.text);
  process.stdout.write(hard.text);
  process.exitCode = 1;
});
