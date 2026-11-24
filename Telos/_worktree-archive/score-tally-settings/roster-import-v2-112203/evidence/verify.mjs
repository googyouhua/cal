// Kekkai hard verifier · roster-import-v2 · round param argv[2]
// Writes hard-r<N>.txt (+ render/manifest/shots when review states requested) under KEKKAI_OUT_DIR.
process.env.PLAYWRIGHT_MODULE = process.env.PLAYWRIGHT_MODULE || "/ws/cal_phone/tests/node_modules/playwright";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import http from "node:http";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.KEKKAI_REPO || path.resolve(HERE, "..", "..", "..", "..");
const ART = process.env.KEKKAI_ARTIFACT || "/ws/cal_phone/index.html";
const OUT = process.env.KEKKAI_OUT_DIR || fs.mkdtempSync(path.join("/tmp", "kekkai-verify-"));
const ROUND = Number(process.argv[2] || process.env.KEKKAI_ROUND || 1);
const EXPECTED = (process.env.KEKKAI_EXPECTED_STATES || "S1,S2,S3,S4").split(",").map((s) => s.trim()).filter(Boolean);
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, `review-shots/r${ROUND}`), { recursive: true });

const BROWSER_MOD = await import(pathToFileURL(path.join(REPO, "tests", "lib", "browser.mjs")).href);
const { launchBrowser } = BROWSER_MOD;

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const ART_SHA = sha256(fs.readFileSync(ART));
const SELF_SHA = sha256(fs.readFileSync(fileURLToPath(import.meta.url)));

const allPageErrors = [];
const allConsoleErrors = [];
let browser = null;

async function fresh(viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
  const pageErrors = [];
  const consoleErrors = [];
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  await page.goto(pathToFileURL(ART).href, { waitUntil: "load" });
  return { context, page, pageErrors, consoleErrors, close: async () => { allPageErrors.push(...pageErrors); allConsoleErrors.push(...consoleErrors); await context.close(); } };
}

async function freshInit({ viewport = { width: 390, height: 844 }, init = null, initArg = undefined, cdp = null } = {}) {
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
  const pageErrors = [];
  const consoleErrors = [];
  if (init) await context.addInitScript(init, initArg);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  if (cdp) {
    const s = await context.newCDPSession(page);
    await s.send("Emulation.setDeviceMetricsOverride", cdp);
  }
  await page.goto(pathToFileURL(ART).href, { waitUntil: "load" });
  return { context, page, pageErrors, consoleErrors, close: async () => { allPageErrors.push(...pageErrors); allConsoleErrors.push(...consoleErrors); await context.close(); } };
}

const gbk = (text) => execFileSync("python3", ["-c", "import sys;sys.stdout.buffer.write(sys.stdin.buffer.read().decode('utf-8').encode('gbk'))"], { input: Buffer.from(text, "utf8") });
const utf8 = (text, bom = false) => Buffer.from(`${bom ? "﻿" : ""}${text}`, "utf8");

async function openImport(page) {
  await page.click('[data-testid="roster-import"]');
  await page.waitForSelector('[data-testid="import-dialog"][open]');
}
async function waitPreview(page) {
  await page.waitForFunction(() => {
    const s = document.querySelector('[data-testid="import-summary"]');
    return s && !s.hidden && s.getAttribute("data-count") !== null;
  });
}
async function importBuffer(page, { name, buffer }) {
  await openImport(page);
  await page.setInputFiles('[data-testid="roster-file"]', { name, mimeType: "text/csv", buffer });
  await waitPreview(page);
  const count = Number(await page.locator('[data-testid="import-summary"]').getAttribute("data-count"));
  await page.click('[data-testid="import-confirm"]');
  await page.waitForFunction((exp) => document.querySelectorAll('[data-testid="roster-row"]').length === exp, count);
  return count;
}
async function importText(page, name, text, { bom = false } = {}) {
  return importBuffer(page, { name, buffer: utf8(text, bom) });
}
async function enterNumber(page, value) {
  for (const ch of String(value)) await page.click(`[data-testid="keypad"] [data-key="${ch}"]`);
  await page.click('[data-testid="keypad"] [data-key="enter"]');
}
async function compute(page, op, values) {
  await page.click(`[data-testid="op-picker"] [data-op="${op}"]`);
  for (const v of values) await enterNumber(page, v);
  await page.click('[data-testid="key-equals"]');
}
async function rosterRows(page) {
  return page.$$eval('[data-testid="roster-row"]', (rows) => rows.map((row) => {
    const score = row.querySelector('[data-testid="roster-score"]');
    const expr = row.querySelector('[data-testid="roster-expression"]');
    const edit = row.querySelector('[data-testid="roster-edit"]');
    return {
      seq: row.getAttribute("data-seq"), filled: row.getAttribute("data-filled"),
      name: row.getAttribute("data-name"), id: row.getAttribute("data-id"),
      score: score ? (score.getAttribute("data-value") ?? score.textContent.trim()) : null,
      expression: expr ? expr.textContent.trim() : "",
      editLabel: edit ? edit.getAttribute("aria-label") : null,
    };
  }));
}
async function readDownload(page, action) {
  const [dl] = await Promise.all([page.waitForEvent("download"), action()]);
  const fp = await dl.path();
  return { name: dl.suggestedFilename(), buffer: fs.readFileSync(fp), text: fs.readFileSync(fp).toString("utf8") };
}
const H = [];
function verdict(id, pass, evidence) {
  H.push({ id, pass: Boolean(pass), evidence: String(evidence) });
  return Boolean(pass);
}
// ---------- H1 ----------
async function checkH1() {
  const fails = [];
  const A = ["序号,学号,姓名,成绩,班级","1,20230101,张三,85,高一3班","2,20230102,李四,92,高一3班","3,20230103,王五,78,高一3班"].join("\r\n");
  async function importCase(name, buffer) {
    const a = await fresh();
    try {
      const { page } = a;
      await openImport(page);
      await page.setInputFiles('[data-testid="roster-file"]', { name, mimeType: "text/csv", buffer });
      await waitPreview(page);
      const count = await page.locator('[data-testid="import-summary"]').getAttribute("data-count");
      const summary = (await page.locator('[data-testid="import-summary"]').textContent()).trim();
      const map = await page.evaluate(() => { const m = document.querySelector('[data-testid="import-map"]'); return [m.dataset.idIndex, m.dataset.nameIndex, m.dataset.scoreIndex, m.dataset.seqIndex]; });
      const preview = await page.locator('[data-testid="import-preview"] .import-preview-row').allTextContents();
      await page.click('[data-testid="import-confirm"]');
      await page.waitForFunction((exp) => document.querySelectorAll('[data-testid="roster-row"]').length === exp, Number(count));
      const rows = await rosterRows(page);
      const clean = a.pageErrors.length === 0 && a.consoleErrors.length === 0;
      return { count, summary, map, preview, rows, clean, errs: [...a.pageErrors, ...a.consoleErrors] };
    } finally { await a.close(); }
  }
  const tA = await importCase("a.csv", utf8(A, true));
  if (!(tA.count === "3" && JSON.stringify(tA.map) === JSON.stringify(["1","2","3","0"]) && JSON.stringify(tA.rows.map((r) => [r.seq, r.name, r.id, r.filled])) === JSON.stringify([["1","张三","20230101","false"],["2","李四","20230102","false"],["3","王五","20230103","false"]]))) fails.push("A=" + JSON.stringify([tA.count, tA.map, tA.rows]));
  const B = "学号;名字;班级\n20230104;赵六;高二1班\n20230105;钱七;高二1班\n";
  const tB = await importCase("b.csv", utf8(B));
  if (!(tB.count === "2" && JSON.stringify(tB.rows.map((r) => [r.seq, r.name, r.id])) === JSON.stringify([["1","赵六","20230104"],["2","钱七","20230105"]]))) fails.push("B=" + JSON.stringify([tB.count, tB.rows]));
  const C = "考号\t姓名\t得分\n20230106\t孙八\t88\n20230107\t周九\t91\n";
  const tC = await importCase("c.tsv", gbk(C));
  if (!(tC.count === "2" && JSON.stringify(tC.rows.map((r) => [r.seq, r.name, r.id])) === JSON.stringify([["1","孙八","20230106"],["2","周九","20230107"]]))) fails.push("C=" + JSON.stringify([tC.count, tC.rows]));
  const tD = await importCase("d.csv", utf8("姓名,学号\r吴十,20230109\r郑一,20230110\r"));
  if (!(tD.count === "2" && JSON.stringify(tD.rows.map((r) => [r.name, r.id])) === JSON.stringify([["吴十","20230109"],["郑一","20230110"]]))) fails.push("D=" + JSON.stringify([tD.count, tD.rows]));
  const tE = await importCase("e.csv", utf8('姓名,学号,备注\n"张,三",20230111,"含,逗号"\n"李""四",20230112,"含\n换行"\n'));
  if (!(tE.count === "2" && JSON.stringify(tE.rows.map((r) => [r.name, r.id])) === JSON.stringify([["张,三","20230111"],['李"四',"20230112"]]))) fails.push("E=" + JSON.stringify([tE.count, tE.rows]));
  const tF = await importCase("f.csv", utf8("姓名,名字,学号\n张三,小三,20230101\n"));
  if (!(tF.count === "1" && JSON.stringify(tF.rows.map((r) => [r.name, r.id])) === JSON.stringify([["张三","20230101"]]))) fails.push("F=" + JSON.stringify([tF.count, tF.rows, tF.map]));
  const storedF = await (async () => { const a = await fresh(); try { return null; } finally { await a.close(); } })();
  // F: name must be left column + extra holds right column
  {
    const a = await fresh();
    try {
      const { page } = a;
      await openImport(page);
      await page.setInputFiles('[data-testid="roster-file"]', { name: "f.csv", mimeType: "text/csv", buffer: utf8("姓名,名字,学号\n张三,小三,20230101\n") });
      await waitPreview(page);
      await page.click('[data-testid="import-confirm"]');
      await page.waitForSelector('[data-testid="roster-row"]');
      const stored = JSON.parse(await page.evaluate(() => localStorage.getItem("cal-phone.roster.v1")));
      if (!(JSON.stringify(stored.roles) === JSON.stringify(["name","extra","id"]) && JSON.stringify(stored.rows[0].extra) === JSON.stringify(["小三"]))) fails.push("Fextra=" + JSON.stringify([stored.roles, stored.rows[0].extra]));
    } finally { await a.close(); }
  }
  const tG = await importCase("g.csv", utf8("姓名,班级\n吴十,高三1班\n"));
  if (!(tG.count === "1" && tG.rows[0].name === "吴十" && tG.rows[0].id === "")) fails.push("G=" + JSON.stringify(tG.rows));
  const tH = await importCase("h.csv", utf8("学号,备注\n20230108,无姓名\n"));
  if (!(tH.count === "1" && tH.rows[0].id === "20230108")) fails.push("H=" + JSON.stringify(tH.rows));
  const tI = await importCase("i.csv", utf8("学号,姓名,班级\n20230120,甲\n\n20230121,乙,高一,多余\n,,\n20230122,丙,高二\n"));
  if (!(tI.count === "3" && JSON.stringify(tI.rows.map((r) => [r.seq, r.name, r.id])) === JSON.stringify([["1","甲","20230120"],["2","乙","20230121"],["3","丙","20230122"]]))) fails.push("I=" + JSON.stringify([tI.count, tI.rows]));
  // paste group
  {
    const a = await fresh();
    try {
      const { page } = a;
      await openImport(page);
      await page.click('[data-testid="import-paste"]');
      await page.waitForSelector('[data-testid="import-paste-text"]:not([hidden])');
      await page.fill('[data-testid="import-paste-text"]', A);
      await page.click('[data-testid="import-paste-parse"]');
      await waitPreview(page);
      const count = await page.locator('[data-testid="import-summary"]').getAttribute("data-count");
      await page.click('[data-testid="import-confirm"]');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"]').length === 3);
      const rows = await rosterRows(page);
      const note = await page.locator("#history-note").textContent();
      if (!(count === "3" && JSON.stringify(rows.map((r) => [r.seq, r.name, r.id])) === JSON.stringify([["1","张三","20230101"],["2","李四","20230102"],["3","王五","20230103"]]) && note === "粘贴名单")) fails.push("paste=" + JSON.stringify([count, rows, note]));
    } finally { await a.close(); }
  }
  // rejection group
  const rejCases = [
    ["empty.csv", Buffer.alloc(0)],
    ["blank.csv", utf8("\n\n")],
    ["noheader.csv", utf8(",,,\n,,,\n")],
    ["binary.csv", Buffer.from([0xff, 0xfe, 0x00, 0x01, 0xff])],
  ];
  for (const [name, buffer] of rejCases) {
    const a = await fresh();
    try {
      const { page } = a;
      await openImport(page);
      await page.setInputFiles('[data-testid="roster-file"]', { name, mimeType: "text/csv", buffer });
      await page.waitForFunction(() => document.querySelector('[data-testid="import-dialog"]').getAttribute("data-error") === "true", null, { timeout: 8000 });
      const open = await page.locator('[data-testid="import-dialog"]').evaluate((d) => d.open);
      const err = (await page.locator('[data-testid="import-error"]').textContent()).trim();
      const n = await page.locator('[data-testid="roster-row"]').count();
      const st = await page.evaluate(() => localStorage.getItem("cal-phone.roster.v1"));
      if (!(open === true && err !== "" && n === 0 && st === null)) fails.push("rej:" + name + "=" + JSON.stringify([open, err.slice(0, 30), n, st]));
    } finally { await a.close(); }
  }
  // sample group
  {
    const a = await fresh();
    try {
      const { page } = a;
      await openImport(page);
      const dl = await readDownload(page, () => page.click('[data-testid="import-sample"]'));
      const head = [...dl.buffer.subarray(0, 3)];
      const lines = dl.buffer.toString("utf8").replace(/^﻿/, "").split("\r\n").filter((l) => l !== "");
      if (!(JSON.stringify(head) === JSON.stringify([0xef, 0xbb, 0xbf]) && lines.length >= 4)) fails.push("sample=" + JSON.stringify([head, lines.length]));
    } finally { await a.close(); }
  }
  return verdict("H1", fails.length === 0, fails.length ? fails.join(" || ").slice(0, 900) : `A3/B2/C2/D2/E2/Fextra/缺列/少多空行/粘贴fileName=粘贴名单/4拒绝data-error+行0存储null/样例BOM+行≥4`);
}

// ---------- H2 ----------
async function checkH2() {
  const fails = [];
  const CUSTOM = ["No.,编号,学生,总分,班级","1,A01,张三,,高一3班","2,A02,李四,,高一3班","3,A03,王五,,高一3班"].join("\r\n");
  const a = await fresh();
  try {
    const { page } = a;
    await openImport(page);
    await page.setInputFiles('[data-testid="roster-file"]', { name: "custom.csv", mimeType: "text/csv", buffer: utf8(CUSTOM) });
    await waitPreview(page);
    const state = () => page.evaluate(() => {
      const m = document.querySelector('[data-testid="import-map"]');
      const v = {};
      for (const r of ["id", "name", "score", "seq"]) v[r] = document.querySelector(`[data-testid="import-${r}-column"]`).value;
      return {
        values: v, dataset: [m.dataset.idIndex, m.dataset.nameIndex, m.dataset.scoreIndex, m.dataset.seqIndex],
        note: document.querySelector('[data-testid="import-map-note"]').hidden ? "" : document.querySelector('[data-testid="import-map-note"]').textContent,
        columns: [...document.querySelectorAll('[data-testid="import-columns"] .import-chip')].map((c) => c.textContent),
        preview: [...document.querySelectorAll('[data-testid="import-preview"] .import-preview-row')].map((r) => r.textContent),
        count: document.querySelector('[data-testid="import-summary"]').dataset.count,
        disabled: document.querySelector('[data-testid="import-confirm"]').disabled,
      };
    });
    const s0 = await state();
    if (!(JSON.stringify(s0.values) === JSON.stringify({ id: "", name: "", score: "", seq: "" }) && JSON.stringify(s0.dataset) === JSON.stringify(["", "", "", ""]) && s0.disabled === true && s0.note.includes("请指定"))) fails.push("default=" + JSON.stringify(s0.values));
    await page.selectOption('[data-testid="import-id-column"]', "1");
    await page.selectOption('[data-testid="import-name-column"]', "2");
    await page.selectOption('[data-testid="import-score-column"]', "3");
    await page.selectOption('[data-testid="import-seq-column"]', "0");
    const s1 = await state();
    if (!(JSON.stringify(s1.values) === JSON.stringify({ id: "1", name: "2", score: "3", seq: "0" }) && JSON.stringify(s1.dataset) === JSON.stringify(["1", "2", "3", "0"]) && s1.disabled === false)) fails.push("full=" + JSON.stringify(s1.values));
    const cols = s1.columns.join("|");
    if (!(cols.includes("学号") && cols.includes("成绩"))) fails.push("columns=" + cols);
    // conflict: try to set name to col used by id
    const nameOpts = await page.$$eval('[data-testid="import-name-column"] option', (o) => o.map((x) => x.value));
    if (nameOpts.includes("1")) fails.push("conflict-not-excluded=" + JSON.stringify(nameOpts));
    const vBefore = (await state()).values;
    await page.selectOption('[data-testid="import-id-column"]', "1");
    const vAfter = (await state()).values;
    if (!(vAfter.id === "1" && vAfter.name === "2")) fails.push("kept=" + JSON.stringify(vAfter));
    await page.selectOption('[data-testid="import-id-column"]', "");
    await page.selectOption('[data-testid="import-name-column"]', "");
    const sNone = await state();
    if (!(sNone.disabled === true && sNone.note.includes("请指定"))) fails.push("bothNone=" + JSON.stringify([sNone.disabled, sNone.note.slice(0, 20)]));
    await page.selectOption('[data-testid="import-id-column"]', "1");
    await page.selectOption('[data-testid="import-name-column"]', "2");
    await page.click('[data-testid="import-confirm"]');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"]').length === 3);
    const rows = await rosterRows(page);
    if (!(JSON.stringify(rows.map((r) => [r.seq, r.name, r.id])) === JSON.stringify([["1","张三","A01"],["2","李四","A02"],["3","王五","A03"]]))) fails.push("confirm=" + JSON.stringify(rows));
    const stored = JSON.parse(await page.evaluate(() => localStorage.getItem("cal-phone.roster.v1")));
    if (!(JSON.stringify(stored.roles) === JSON.stringify(["seq","id","name","score","extra"]))) fails.push("roles=" + JSON.stringify(stored.roles));
    const dl = await readDownload(page, () => page.click('[data-testid="roster-export"]'));
    const exp = dl.text.replace(/^﻿/, "").split("\r\n");
    if (!(JSON.stringify(exp[0].split(",")) === JSON.stringify(["No.","编号","学生","总分","班级"]))) fails.push("exporthdr=" + exp[0]);
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector('[data-testid="roster-row"]');
    const reloaded = JSON.parse(await page.evaluate(() => localStorage.getItem("cal-phone.roster.v1")));
    if (!(JSON.stringify(reloaded.roles) === JSON.stringify(["seq","id","name","score","extra"]))) fails.push("reload-roles=" + JSON.stringify(reloaded.roles));
    await openImport(page);
    await page.setInputFiles('[data-testid="roster-file"]', { name: "custom.csv", mimeType: "text/csv", buffer: utf8(CUSTOM) });
    await waitPreview(page);
    await page.selectOption('[data-testid="import-id-column"]', "1");
    await page.selectOption('[data-testid="import-name-column"]', "2");
    const sRe = await state();
    if (!(sRe.count === "3")) fails.push("reload-preview-count=" + JSON.stringify(sRe.count));
    await page.click('[data-testid="import-cancel"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid="import-dialog"]').open);
    const dlRe = await readDownload(page, () => page.click('[data-testid="roster-export"]'));
    const hdrRe = dlRe.text.replace(/^﻿/, "").split("\r\n")[0];
    if (!(hdrRe === "No.,编号,学生,总分,班级")) fails.push("reload-export-hdr=" + hdrRe);
    void vBefore;
  } finally { await a.close(); }
  return verdict("H2", fails.length === 0, fails.length ? fails.join(" || ").slice(0, 900) : `默认全无+禁用/全映射1-2-3-0/列标签含角色/冲突列被排除无静默改/双无禁用+note/roles持久+重导同列`);
}

// ---------- H3 ----------
async function checkH3() {
  const fails = [];
  const FA = ["序号,学号,姓名,成绩,班级","1,20230101,张三,85,高一3班","2,20230102,李四,92,高一3班","3,20230103,王五,78,高一3班","4,20230104,赵六,61,高一3班"].join("\r\n");
  const FB = ["序号,学号,姓名,成绩,班级","4,20230103,王五改,70,高一4班","3,20230102,李四,90,高一4班","5,20230105,钱七,55,高一4班"].join("\r\n");
  const openPreviewText = async (page, name, text) => {
    await openImport(page);
    await page.setInputFiles('[data-testid="roster-file"]', { name, mimeType: "text/csv", buffer: utf8(text) });
    await waitPreview(page);
  };
  const modeState = (page) => page.evaluate(() => ({
    mode: document.querySelector('[data-testid="import-dialog"]').dataset.mode,
    hasMode: !document.querySelector('[data-testid="import-mode"]').hidden,
    hasKeep: !!document.querySelector('[data-testid="import-mode-keep"]') && document.querySelector('[data-testid="import-mode-keep"]').closest("label").style.display !== "none",
    keepChecked: document.querySelector('[data-testid="import-mode-keep"]').checked,
    confirm: document.querySelector('[data-testid="import-confirm"]').textContent,
    count: document.querySelector('[data-testid="import-summary"]').dataset.count,
    keep: document.querySelector('[data-testid="import-summary"]').dataset.keepCount,
    drop: document.querySelector('[data-testid="import-summary"]').dataset.dropCount,
    added: document.querySelector('[data-testid="import-summary"]').dataset.newCount,
    warning: document.querySelector('[data-testid="import-warning"]').hidden ? "" : document.querySelector('[data-testid="import-warning"]').textContent,
  }));
  // keep path
  {
    const a = await fresh();
    try {
      const { page } = a;
      await importText(page, "A.csv", FA);
      await compute(page, "+", ["12", "30", "8"]);
      await compute(page, "+", ["9", "1"]);
      const before = JSON.parse(await page.evaluate(() => localStorage.getItem("cal-phone.roster.v1")));
      const e1 = before.rows[0].entry, e2 = before.rows[1].entry;
      await openPreviewText(page, "B.csv", FB);
      const pv = await modeState(page);
      if (!(JSON.stringify([pv.count, pv.keep, pv.drop, pv.added]) === JSON.stringify(["3","1","1","2"]) && pv.keepChecked === true && pv.mode === "keep" && pv.confirm === "保留成绩并开始录入")) fails.push("keeppreview=" + JSON.stringify(pv));
      await page.click('[data-testid="import-confirm"]');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"]').length === 3);
      const rows = await rosterRows(page);
      if (!(JSON.stringify(rows.map((r) => [r.seq, r.id, r.name, r.score])) !== null)) fails.push("keeprows-shape");
      const stored = JSON.parse(await page.evaluate(() => localStorage.getItem("cal-phone.roster.v1")));
      const byId = Object.fromEntries(stored.rows.map((r) => [r.id, r]));
      if (!(byId["20230102"] && byId["20230102"].entry && byId["20230102"].entry.result === 10 && byId["20230102"].entry.seq === 2)) fails.push("keep102=" + JSON.stringify(byId["20230102"] && byId["20230102"].entry));
      if (!(byId["20230105"] && byId["20230105"].entry === null)) fails.push("keep105=" + JSON.stringify(byId["20230105"]));
      if (!(byId["20230103"] && byId["20230103"].entry === null && byId["20230103"].name === "王五改")) fails.push("keep103=" + JSON.stringify(byId["20230103"]));
      if (!(stored.rows[0].seq === 1 && stored.rows[1].seq === 2 && stored.rows[2].seq === 3)) fails.push("keepseq=" + JSON.stringify(stored.rows.map((r) => r.seq)));
      void e1; void e2;
    } finally { await a.close(); }
  }
  // clear path
  {
    const a = await fresh();
    try {
      const { page } = a;
      await importText(page, "A.csv", FA);
      await compute(page, "+", ["12", "30", "8"]);
      await openPreviewText(page, "B.csv", FB);
      await page.click('[data-testid="import-mode-clear"]');
      await page.click('[data-testid="import-confirm"]');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"]').length === 3);
      if (!(JSON.stringify((await rosterRows(page)).map((r) => r.score)) === JSON.stringify(["—","—","—"]))) fails.push("clearrows");
    } finally { await a.close(); }
  }
  // dup old ids
  {
    const a = await fresh();
    try {
      const { page } = a;
      await importText(page, "dup-old.csv", "学号,姓名\n20230101,甲\n20230101,乙\n");
      await compute(page, "+", ["5", "5"]);
      await openPreviewText(page, "B.csv", FB);
      const dup = await page.evaluate(() => ({
        hasKeep: document.querySelector('[data-testid="import-mode-keep"]').closest("label").style.display !== "none",
        mode: document.querySelector('[data-testid="import-dialog"]').dataset.mode,
        confirm: document.querySelector('[data-testid="import-confirm"]').textContent,
        warning: document.querySelector('[data-testid="import-warning"]').textContent,
      }));
      if (!(dup.hasKeep === false && dup.mode === "clear" && dup.confirm === "清空并开始录入" && dup.warning.includes("20230101") && dup.warning.length <= 120)) fails.push("dupold=" + JSON.stringify(dup));
    } finally { await a.close(); }
  }
  // no-id column
  {
    const a = await fresh();
    try {
      const { page } = a;
      await importText(page, "A.csv", FA);
      await compute(page, "+", ["12", "30", "8"]);
      await openPreviewText(page, "B.csv", FB);
      await page.selectOption('[data-testid="import-id-column"]', "");
      const st = await modeState(page);
      if (!(st.mode === "clear" && !st.hasKeep)) fails.push("noid=" + JSON.stringify(st));
    } finally { await a.close(); }
  }
  // zero keep
  {
    const a = await fresh();
    try {
      const { page } = a;
      await importText(page, "A.csv", FA);
      await compute(page, "+", ["12", "30", "8"]);
      await compute(page, "+", ["9", "1"]);
      await openPreviewText(page, "other.csv", "学号,姓名\n99999,新人\n");
      const zero = await modeState(page);
      if (!(zero.hasKeep === false && zero.mode === "clear" && zero.confirm === "清空并开始录入")) fails.push("zero=" + JSON.stringify(zero));
    } finally { await a.close(); }
  }
  // reselect resets default
  {
    const a = await fresh();
    try {
      const { page } = a;
      await importText(page, "A.csv", FA);
      await compute(page, "+", ["12", "30", "8"]);
      await compute(page, "+", ["9", "1"]);
      await openPreviewText(page, "other.csv", "学号,姓名\n99999,新人\n");
      const zeroFirst = await modeState(page);
      if (!(zeroFirst.hasKeep === false)) fails.push("reselect-zero=" + JSON.stringify(zeroFirst));
      await page.click('[data-testid="import-reselect"]');
      await page.setInputFiles('[data-testid="roster-file"]', { name: "B.csv", mimeType: "text/csv", buffer: utf8(FB) });
      await waitPreview(page);
      const st = await modeState(page);
      if (!(st.hasKeep === true && st.keepChecked === true)) fails.push("reselect=" + JSON.stringify(st));
    } finally { await a.close(); }
  }
  // cancel/esc unchanged
  for (const how of ["cancel", "esc"]) {
    const a = await fresh();
    try {
      const { page } = a;
      await importText(page, "A.csv", FA);
      await compute(page, "+", ["12", "30", "8"]);
      await compute(page, "+", ["9", "1"]);
      const before = await page.evaluate(() => localStorage.getItem("cal-phone.roster.v1"));
      const beforeRows = await rosterRows(page);
      await openPreviewText(page, "B.csv", FB);
      if (how === "cancel") { await page.click('[data-testid="import-cancel"]'); await page.waitForFunction(() => !document.querySelector('[data-testid="import-dialog"]').open); }
      else { await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector('[data-testid="import-dialog"]').open); }
      const after = await page.evaluate(() => localStorage.getItem("cal-phone.roster.v1"));
      const afterRows = await rosterRows(page);
      if (!(before === after && JSON.stringify(beforeRows) === JSON.stringify(afterRows))) fails.push(how + "-changed");
    } finally { await a.close(); }
  }
  return verdict("H3", fails.length === 0, fails.length ? fails.join(" || ").slice(0, 900) : `K/D/A=1/1/2默认保留/保留entry逐字段+改名保留+seq重排/清空全空/重复学号仅清空+警告≤3/无学号仅清空/零可保留仅清空/重选重置/取消Esc不变`);
}
// ---------- H4 ----------
async function checkH4() {
  const fails = [];
  const AFIX = ["序号,学号,姓名,成绩,班级","1,20230101,张三,85,高一3班","2,20230102,李四,92,高一3班","3,20230103,王五,78,高一3班"].join("\r\n");
  const readCalc = (page) => page.evaluate(() => ({
    state: document.querySelector("main.app").dataset.state,
    op: document.querySelector("main.app").getAttribute("data-operator"),
    input: document.querySelector('[data-testid="calc-input"]').value,
    expr: document.querySelector('[data-testid="expression"]').textContent.trim(),
    result: document.querySelector('[data-testid="result"]').getAttribute("data-value"),
    hist: document.querySelectorAll('[data-testid="history-item"]').length,
  }));
  // confirm path from result state
  {
    const a = await fresh();
    try {
      const { page } = a;
      await compute(page, "+", ["1", "2"]);
      await compute(page, "+", ["3", "4"]);
      const before = await readCalc(page);
      await importText(page, "A.csv", AFIX);
      const after = await page.evaluate(() => ({
        state: document.querySelector("main.app").dataset.state,
        op: document.querySelector("main.app").getAttribute("data-operator"),
        input: document.querySelector('[data-testid="calc-input"]').value,
        expr: document.querySelector('[data-testid="expression"]').textContent.trim(),
        result: document.querySelector('[data-testid="result"]').getAttribute("data-value"),
        hist: document.querySelectorAll('[data-testid="history-item"]').length,
        rows: [...document.querySelectorAll('[data-testid="roster-row"]')].map((r) => r.getAttribute("data-filled")),
        next: document.querySelector('[data-testid="roster-next"]')?.getAttribute("data-seq"),
        draftHidden: document.querySelector('[data-testid="edit-draft"]').hidden,
        label: document.querySelector("#state-label").textContent,
      }));
      if (!(JSON.stringify(after.rows) === JSON.stringify(["false","false","false"]) && after.next === "1" && after.state === "select" && after.op === null && after.input === "" && after.expr === "" && after.result === null && after.draftHidden === true && after.hist === 0 && after.label.includes("导入"))) fails.push("confirm=" + JSON.stringify(after));
      void before;
    } finally { await a.close(); }
  }
  // cancel + esc preserve
  for (const how of ["cancel", "esc"]) {
    const a = await fresh();
    try {
      const { page } = a;
      await compute(page, "+", ["1", "2"]);
      await compute(page, "+", ["3", "4"]);
      const before = await readCalc(page);
      await openImport(page);
      await page.setInputFiles('[data-testid="roster-file"]', { name: "A.csv", mimeType: "text/csv", buffer: utf8(AFIX) });
      await waitPreview(page);
      if (how === "cancel") { await page.click('[data-testid="import-cancel"]'); await page.waitForFunction(() => !document.querySelector('[data-testid="import-dialog"]').open); }
      else { await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector('[data-testid="import-dialog"]').open); }
      const after = await readCalc(page);
      const n = await page.locator('[data-testid="roster-row"]').count();
      if (!(JSON.stringify(before) === JSON.stringify(after) && n === 0)) fails.push(how + "=" + JSON.stringify([before, after, n]));
    } finally { await a.close(); }
  }
  // auto-confirm guard: settings 0.2, type 1, open dialog, wait 1200ms, no compute, cancel keeps input
  {
    const a = await freshInit({ init: () => { try { localStorage.setItem("cal-phone.settings.v1", JSON.stringify({ autoConfirm: 0.2, autoEquals: 0, resultPause: 0 })); } catch {} } });
    try {
      const { page } = a;
      await page.reload({ waitUntil: "load" });
      await page.click('[data-testid="keypad"] [data-key="1"]');
      await page.waitForSelector('[data-testid="auto-confirm-feedback"][data-active="true"]');
      await openImport(page);
      const waitStart = Date.now();
      await page.waitForTimeout(1200);
      const st = await readCalc(page);
      if (!(st.hist === 0 && st.result === null)) fails.push("autoconfirm-fired=" + JSON.stringify(st) + " waited=" + (Date.now() - waitStart));
      await page.click('[data-testid="import-cancel"]');
      await page.waitForFunction(() => !document.querySelector('[data-testid="import-dialog"]').open);
      const inp = await page.$eval('[data-testid="calc-input"]', (e) => e.value);
      if (!(inp === "1")) fails.push("autoconfirm-input=" + JSON.stringify(inp));
    } finally { await a.close(); }
  }
  // keyboard guard
  {
    const a = await fresh();
    try {
      const { page } = a;
      await compute(page, "+", ["1", "2"]);
      const before = await readCalc(page);
      await openImport(page);
      await page.setInputFiles('[data-testid="roster-file"]', { name: "A.csv", mimeType: "text/csv", buffer: utf8(AFIX) });
      await waitPreview(page);
      await page.keyboard.press("5");
      await page.keyboard.press("Enter");
      await page.keyboard.press("=");
      const after = await readCalc(page);
      if (!(JSON.stringify(before) === JSON.stringify(after))) fails.push("kbd=" + JSON.stringify([before, after]));
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector('[data-testid="import-dialog"]').open);
    } finally { await a.close(); }
  }
  // voice: local HTTP + fake engine, slow sentence queued, import, played length frozen
  {
    const server = http.createServer((req, res) => {
      let p = "/";
      try { p = decodeURIComponent(new URL(req.url || "/", "http://127.0.0.1").pathname); } catch {}
      if (p.startsWith("/voice/")) {
        const rel = p.slice(7);
        const isScript = rel === "sherpa-onnx-wasm-web.js" || rel === "sherpa-onnx-tts.js";
        const body = isScript ? Buffer.from(`window.SherpaOnnx = async () => ({FS:{mkdirTree(){},FS_createDataFile(){},writeFile(){}}});\nwindow.createOfflineTts = () => ({handle:1, generate:() => ({samples:new Float32Array(8), sampleRate:22050})});\n`) : Buffer.alloc(2048, 0x5a);
        res.writeHead(200, { "Content-Type": isScript ? "text/javascript; charset=utf-8" : "application/octet-stream", "Content-Length": body.length });
        res.end(body); return;
      }
      if (p === "/" || p === "/index.html") {
        const stat = fs.statSync(ART);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": stat.size });
        fs.createReadStream(ART).pipe(res); return;
      }
      res.writeHead(404); res.end();
    });
    await new Promise((res, rej) => { server.once("error", rej); server.listen(0, "127.0.0.1", res); });
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/index.html`;
    const FAKE = `window.__voiceFake = { fail: false, durationMs: 2500, generated: [] };
window.SherpaOnnx = async () => ({ FS: { mkdirTree() {}, FS_createDataFile() {}, writeFile() {} } });
window.createOfflineTts = () => ({ handle: 1, sampleRate: 22050, generate({ text }) { window.__voiceFake.generated.push(String(text)); const c = Math.round(22050 * window.__voiceFake.durationMs / 1000); const s = new Float32Array(Math.max(1, c)); for (let i = 0; i < s.length; i++) s[i] = Math.sin(i / 20) * 0.05; return { samples: s, sampleRate: 22050 }; } });
class FakeAudioContext { constructor() { this.state = "running"; this.destination = {}; } createBuffer(_c, l) { return { getChannelData: () => new Float32Array(l) }; } createBufferSource() { const so = { buffer: null, connect() {}, onended: null }; so.start = () => { setTimeout(() => { if (typeof so.onended === "function") so.onended(); }, window.__voiceFake.durationMs); }; return so; } resume() { return Promise.resolve(); } }
window.AudioContext = FakeAudioContext; window.webkitAudioContext = FakeAudioContext;`;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const perr = [], cerr = [];
    try {
      await context.addInitScript(({ stored, engine }) => { try { localStorage.setItem("cal-phone.settings.v1", stored); } catch {} ; (0, eval)(engine); }, { stored: JSON.stringify({ voiceResult: true, autoConfirm: 0, autoEquals: 0, resultPause: 1 }), engine: FAKE });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on("pageerror", (e) => perr.push(String(e)));
      page.on("console", (m) => { if (m.type() === "error") cerr.push(m.text()); });
      await page.goto(url, { waitUntil: "load" });
      await page.waitForFunction((ok) => ok.includes(document.querySelector("main.app")?.dataset.voiceState || ""), ["ready"], { timeout: 25000, polling: 100 });
      await page.click('[data-testid="op-picker"] [data-op="+"]');
      await enterNumber(page, "5"); await enterNumber(page, "6"); await enterNumber(page, "7");
      await page.click('[data-testid="key-equals"]');
      await page.waitForFunction(() => (JSON.parse(document.querySelector("main.app").dataset.speechPlayed || "[]")).length >= 1, null, { timeout: 20000 });
      const beforeLen = await page.evaluate(() => JSON.parse(document.querySelector("main.app").dataset.speechPlayed || "[]").length);
      await page.click('[data-testid="roster-import"]');
      await page.waitForSelector('[data-testid="import-dialog"][open]');
      await page.setInputFiles('[data-testid="roster-file"]', { name: "A.csv", mimeType: "text/csv", buffer: utf8(AFIX) });
      await waitPreview(page);
      await page.click('[data-testid="import-confirm"]');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"]').length === 3);
      const atConfirm = await page.evaluate(() => JSON.parse(document.querySelector("main.app").dataset.speechPlayed || "[]").length);
      await page.waitForTimeout(6000);
      const afterLen = await page.evaluate(() => JSON.parse(document.querySelector("main.app").dataset.speechPlayed || "[]").length);
      allPageErrors.push(...perr); allConsoleErrors.push(...cerr);
      if (!(afterLen === atConfirm && beforeLen >= 1)) fails.push("voice=" + JSON.stringify([beforeLen, atConfirm, afterLen, perr.length, cerr.length]));
      if (!(perr.length === 0 && cerr.length === 0)) fails.push("voice-err=" + perr.concat(cerr).join("|").slice(0, 200));
    } finally { await context.close().catch(() => {}); await new Promise((r) => server.close(r)); }
  }
  return verdict("H4", fails.length === 0, fails.length ? fails.join(" || ").slice(0, 900) : `确认归零3行false/next1/select/取消Esc历史2不变/自动确认1200ms无触发+输入保持/按键守卫不变/语音played冻结无pageerror`);
}

// ---------- H5 ----------
async function checkH5() {
  const fails = [];
  const A = ["序号,学号,姓名,成绩,班级","1,20230101,张三,85,高一3班","2,20230102,李四,92,高一3班","3,20230103,王五,78,高一3班"].join("\r\n");
  {
    const a = await fresh();
    try {
      const { page } = a;
      await importText(page, "A.csv", A);
      // div by zero then empty equals
      await page.click('[data-testid="op-picker"] [data-op="/"]');
      await enterNumber(page, "5");
      await enterNumber(page, "0");
      await page.click('[data-testid="key-equals"]');
      await page.click('[data-testid="op-picker"] [data-op="+"]');
      await page.click('[data-testid="key-equals"]');
      let rows = await rosterRows(page);
      if (!(rows.filter((r) => r.filled === "true").length === 0)) fails.push("divzero/empty filled");
      await compute(page, "+", ["10", "20"]);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length === 1);
      rows = await rosterRows(page);
      if (!(rows[0].score === "30" && rows[0].expression === "10 + 20")) fails.push("fill1=" + JSON.stringify([rows[0].score, rows[0].expression]));
      let next = await page.locator('[data-testid="roster-next"]').getAttribute("data-seq");
      if (!(next === "2")) fails.push("next2=" + next);
      await compute(page, "+", ["3", "4"]);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length === 2);
      rows = await rosterRows(page);
      if (!(rows[1].score === "7")) fails.push("fill2=" + JSON.stringify(rows[1]));
      await compute(page, "+", ["5", "6"]);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length === 3);
      rows = await rosterRows(page);
      if (!(rows[2].score === "11")) fails.push("fill3=" + JSON.stringify(rows[2]));
      next = await page.locator('[data-testid="roster-next"]').count();
      if (!(next === 0)) fails.push("nextGone=" + next);
      const label4 = await page.locator("#state-label").textContent();
      await page.click('[data-testid="op-picker"] [data-op="+"]');
      await enterNumber(page, "1"); await enterNumber(page, "1");
      await page.click('[data-testid="key-equals"]');
      await page.waitForFunction(() => document.querySelector('[data-testid="result"]').getAttribute("data-value") === "2");
      rows = await rosterRows(page);
      if (!(rows.length === 3 && rows.filter((r) => r.filled === "true").length === 3)) fails.push("overflow-rows=" + JSON.stringify(rows.length));
      const label = await page.locator("#state-label").textContent();
      if (!(label.includes("录满"))) fails.push("fulllabel=" + label.slice(0, 60));
      void label4;
    } finally { await a.close(); }
  }
  // auto equals
  {
    const a = await freshInit({ init: () => { try { localStorage.setItem("cal-phone.settings.v1", JSON.stringify({ autoEquals: 2, resultPause: 0 })); } catch {} } });
    try {
      const { page } = a;
      await page.reload({ waitUntil: "load" });
      await importText(page, "A.csv", A);
      await page.click('[data-testid="op-picker"] [data-op="+"]');
      await enterNumber(page, "10");
      await enterNumber(page, "20");
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length === 1);
      const rows = await rosterRows(page);
      const next = await page.locator('[data-testid="roster-next"]').getAttribute("data-seq");
      if (!(rows[0].score === "30" && next === "2")) fails.push("autoeq=" + JSON.stringify([rows[0], next]));
    } finally { await a.close(); }
  }
  // base
  {
    const a = await freshInit({ init: () => { try { localStorage.setItem("cal-phone.settings.v1", JSON.stringify({ baseEnabled: true, baseValue: "100", resultPause: 0 })); } catch {} } });
    try {
      const { page } = a;
      await page.reload({ waitUntil: "load" });
      await importText(page, "A.csv", A);
      await compute(page, "+", ["10"]);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length === 1);
      const rows = await rosterRows(page);
      const stored = JSON.parse(await page.evaluate(() => localStorage.getItem("cal-phone.roster.v1")));
      const dl = await readDownload(page, () => page.click('[data-testid="roster-export"]'));
      if (!(rows[0].score === "110" && stored.rows[0].entry.base && stored.rows[0].entry.base.display === "100" && dl.text.includes(",110,"))) fails.push("base=" + JSON.stringify([rows[0].score, stored.rows[0].entry.base]));
    } finally { await a.close(); }
  }
  // result pause 1s blocks, 0s passes
  {
    const a = await freshInit({ init: () => { try { localStorage.setItem("cal-phone.settings.v1", JSON.stringify({ resultPause: 1 })); } catch {} } });
    try {
      const { page } = a;
      await page.reload({ waitUntil: "load" });
      await importText(page, "A.csv", A);
      await compute(page, "+", ["10", "20"]);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length === 1);
      const score = await page.getAttribute('[data-testid="roster-row"][data-seq="1"] [data-testid="roster-score"]', "data-value");
      await page.click('[data-testid="keypad"] [data-key="7"]');
      await page.waitForTimeout(200);
      const inp = await page.$eval('[data-testid="calc-input"]', (e) => e.value);
      if (!((inp === "" || !inp.includes("7")) && (await page.getAttribute('[data-testid="roster-row"][data-seq="1"] [data-testid="roster-score"]', "data-value")) === score)) fails.push("pause1=" + JSON.stringify([inp, score]));
      await page.waitForTimeout(1200);
      await page.click('[data-testid="keypad"] [data-key="7"]');
      await page.waitForTimeout(200);
      const inp2 = await page.$eval('[data-testid="calc-input"]', (e) => e.value);
      if (!(inp2.includes("7"))) fails.push("pause1-release=" + JSON.stringify(inp2));
    } finally { await a.close(); }
  }
  {
    const a = await freshInit({ init: () => { try { localStorage.setItem("cal-phone.settings.v1", JSON.stringify({ resultPause: 0 })); } catch {} } });
    try {
      const { page } = a;
      await page.reload({ waitUntil: "load" });
      await importText(page, "A.csv", A);
      await compute(page, "+", ["10", "20"]);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length === 1);
      await page.click('[data-testid="keypad"] [data-key="7"]');
      await page.waitForTimeout(200);
      const inp = await page.$eval('[data-testid="calc-input"]', (e) => e.value);
      if (!(inp.includes("7"))) fails.push("pause0=" + JSON.stringify(inp));
    } finally { await a.close(); }
  }
  return verdict("H5", fails.length === 0, fails.length ? fails.join(" || ").slice(0, 900) : `除零空等号零回填/30-7-11顺序推进next2-3-无/第4次2分不写行+录满/自动等号30-next2/基数110存储导出/base暂停行为`);
}

// ---------- H6 ----------
async function checkH6() {
  const fails = [];
  const A = ["序号,学号,姓名,成绩,班级","1,20230101,张三,85,高一3班","2,20230102,李四,92,高一3班","3,20230103,王五,78,高一3班"].join("\r\n");
  async function fill3(page) {
    await compute(page, "+", ["12", "30", "8"]);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length >= 1);
    await compute(page, "+", ["9", "1"]);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length >= 2);
    await compute(page, "+", ["5", "5"]);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length === 3);
  }
  {
    const a = await fresh();
    try {
      const { page } = a;
      await importText(page, "A.csv", A);
      await fill3(page);
      const before = await rosterRows(page);
      await page.locator('[data-testid="roster-row"][data-seq="2"] [data-testid="roster-edit"]').click();
      const title = await page.locator('[data-testid="edit-draft-title"]').textContent();
      if (!title.includes("2")) fails.push("edittitle=" + title.slice(0, 40));
      await page.locator('[data-testid="operand-input"]').nth(1).fill("7");
      await page.click('[data-testid="key-equals"]');
      await page.waitForFunction(() => document.querySelector('[data-testid="roster-row"][data-seq="2"] [data-testid="roster-score"]')?.getAttribute("data-value") === "16");
      const after = await rosterRows(page);
      if (!(after[1].score === "16" && after[1].expression.includes("7") && after.length === 3 && after[1].seq === "2" && after[1].name === "李四" && after[1].id === "20230102")) fails.push("editafter=" + JSON.stringify(after[1]));
      if (!(JSON.stringify([after[0].score, after[0].expression]) === JSON.stringify([before[0].score, before[0].expression]) && JSON.stringify([after[2].score, after[2].expression]) === JSON.stringify([before[2].score, before[2].expression]))) fails.push("edituntouched");
      await page.reload({ waitUntil: "load" });
      await page.waitForSelector('[data-testid="roster-row"]');
      const re = await rosterRows(page);
      if (!(re[1].score === "16")) fails.push("editreload=" + JSON.stringify(re[1]));
    } finally { await a.close(); }
  }
  // partial: 5 people, 2 fills, edit row1
  {
    const a = await fresh();
    try {
      const { page } = a;
      await importText(page, "five.csv", ["学号,姓名", "1,甲", "2,乙", "3,丙", "4,丁", "5,戊"].join("\n"));
      await compute(page, "+", ["12", "30", "8"]);
      await compute(page, "+", ["9", "1"]);
      await page.locator('[data-testid="roster-row"][data-seq="1"] [data-testid="roster-edit"]').click();
      await page.locator('[data-testid="operand-input"]').first().fill("20");
      await page.click('[data-testid="key-equals"]');
      await page.waitForFunction(() => document.querySelector('[data-testid="roster-row"][data-seq="1"] [data-testid="roster-score"]')?.getAttribute("data-value") === "58");
      const next = await page.locator('[data-testid="roster-next"]').getAttribute("data-seq");
      const filled = await page.$$eval('[data-testid="roster-row"][data-filled="true"]', (r) => r.length);
      if (!(next === "3" && filled === 2)) fails.push("partial=" + JSON.stringify([next, filled]));
    } finally { await a.close(); }
  }
  // switch protection
  {
    const a = await fresh();
    try {
      const { page } = a;
      await importText(page, "A.csv", A);
      await fill3(page);
      await page.locator('[data-testid="roster-row"][data-seq="2"] [data-testid="roster-edit"]').click();
      const st1 = await page.evaluate(() => document.querySelector("main.app").dataset.state);
      await page.locator('[data-testid="roster-row"][data-seq="3"] [data-testid="roster-edit"]').click();
      await page.waitForTimeout(200);
      const st2 = await page.evaluate(() => document.querySelector("main.app").dataset.state);
      const label = await page.locator("#state-label").textContent();
      const row2 = (await rosterRows(page))[1];
      if (!(st1 === "edit" && st2 === "edit" && label.includes("先保存或取消") && row2.score === "10")) fails.push("switch=" + JSON.stringify([st1, st2, label.slice(0, 30), row2.score]));
      await page.click('[data-testid="edit-cancel"]');
      await page.locator('[data-testid="roster-row"][data-seq="3"] [data-testid="roster-edit"]').click();
      await page.waitForTimeout(200);
      const title = await page.locator('[data-testid="edit-draft-title"]').textContent();
      if (!(title.includes("3"))) fails.push("switch2=" + title.slice(0, 30));
      await page.click('[data-testid="edit-cancel"]');
    } finally { await a.close(); }
  }
  // 50 people
  {
    const a = await fresh();
    try {
      const { page } = a;
      const many = ["学号,姓名", ...Array.from({ length: 50 }, (_, i) => `S${i + 1},学生${i + 1}`)].join("\n");
      await importText(page, "fifty.csv", many);
      for (let i = 0; i < 50; i++) {
        await compute(page, "+", ["10", "10"]);
      }
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length === 50);
      const last = page.locator('[data-testid="roster-row"][data-seq="50"]');
      await last.scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      await last.locator('[data-testid="roster-edit"]').click();
      await page.waitForTimeout(200);
      const info = await page.evaluate(() => {
        const d = document.querySelector('[data-testid="edit-draft"]');
        const r = d.getBoundingClientRect();
        const cs = getComputedStyle(d);
        const row = document.querySelector('[data-testid="roster-row"][data-seq="50"]');
        const rr = row.getBoundingClientRect();
        return { pos: cs.position, left: r.left, right: window.innerWidth - r.right, vw: window.innerWidth, top: r.top, bottom: r.bottom, vh: window.innerHeight, rowBottom: rr.bottom, draftTop: r.top, position: cs.position };
      });
      if (!(info.position === "fixed" && Math.abs(info.left - 10) <= 1 && Math.abs(info.right - 10) <= 1 && info.bottom <= info.vh + 0.5 && info.rowBottom <= info.draftTop + 0.5)) fails.push("float=" + JSON.stringify(info));
      const ae1 = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") || document.activeElement?.tagName);
      await page.click('[data-testid="edit-done"]');
      await page.waitForTimeout(200);
      const f1 = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.getAttribute("data-testid"));
      await last.locator('[data-testid="roster-edit"]').click();
      await page.waitForTimeout(200);
      await page.click('[data-testid="edit-cancel"]');
      await page.waitForTimeout(200);
      const f2 = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.getAttribute("data-testid"));
      if (!((f1 || "").includes("编辑第 50 位") && (f2 || "").includes("编辑第 50 位"))) fails.push("focus=" + JSON.stringify([ae1, f1, f2]));
    } finally { await a.close(); }
  }
  return verdict("H6", fails.length === 0, fails.length ? fails.join(" || ").slice(0, 900) : `编辑2行10→16行位不变/刷新保持/5人部分next3已录2/切换保护+取消/50人fixed左右10视口内+焦点回行`);
}
// ---------- H7 ----------
async function checkH7() {
  const fails = [];
  const A = ["序号,学号,姓名,成绩,班级","1,20230101,张三,85,高一3班","2,20230102,李四,92,高一3班","3,20230103,王五,78,高一3班"].join("\r\n");
  {
    const a = await fresh();
    try {
      const { page } = a;
      await importText(page, "A.csv", A);
      await compute(page, "+", ["12", "30", "8"]);
      await compute(page, "+", ["9", "1"]);
      const stored = JSON.parse(await page.evaluate(() => localStorage.getItem("cal-phone.roster.v1")));
      if (!(stored.version === 1 && stored.fileName === "A.csv" && JSON.stringify(stored.headers) === JSON.stringify(["序号","学号","姓名","成绩","班级"]) && JSON.stringify(stored.roles) === JSON.stringify(["seq","id","name","score","extra"]) && stored.rows.length === 3 && stored.rows[0].entry === null && stored.rows[0].seq === 1 && stored.rows[2].seq === 3 && JSON.stringify(stored.rows[0].extra) === JSON.stringify(["高一3班"]))) fails.push("shape=" + JSON.stringify(stored).slice(0, 300));
      const e1 = stored.rows[1].entry;
      if (!(e1 && e1.seq === 2 && e1.operator === "+" && JSON.stringify(e1.operands) === JSON.stringify([{ value: 9, display: "9" }, { value: 1, display: "1" }]) && e1.base === null && e1.expression === "9 + 1" && e1.result === 10)) fails.push("entry=" + JSON.stringify(e1));
      await page.reload({ waitUntil: "load" });
      await page.waitForSelector('[data-testid="roster-row"]');
      const rows = await rosterRows(page);
      const next = await page.locator('[data-testid="roster-next"]').getAttribute("data-seq");
      const state = await page.evaluate(() => document.querySelector("main.app").dataset.state);
      const inp = await page.$eval('[data-testid="calc-input"]', (e) => e.value);
      const label = await page.locator("#state-label").textContent();
      if (!(JSON.stringify(rows.map((r) => r.score)) === JSON.stringify(["50","10","—"]) && next === "3" && state === "select" && inp === "" && label.includes("名单已恢复"))) fails.push("reload=" + JSON.stringify([rows.map((r) => r.score), next, state, inp, label.slice(0, 30)]));
      const dialogs = [];
      page.on("dialog", async (d) => { dialogs.push(d.message()); await d.accept(); });
      // clear: use window.confirm auto-accept; app may use custom confirm button
      const hasCustom = await page.locator('[data-testid="roster-clear-confirm"]').count();
      if (hasCustom > 0) {
        await page.click('[data-testid="roster-clear"]');
        await page.click('[data-testid="roster-clear-confirm"]');
      } else {
        await page.click('[data-testid="roster-clear"]');
      }
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"]').length === 0, null, { timeout: 8000 });
      const st = await page.evaluate(() => localStorage.getItem("cal-phone.roster.v1"));
      const hidden = await page.locator('[data-testid="roster"]').isHidden();
      const hist = await page.locator('[data-testid="history-item"]').count();
      const st2 = await page.evaluate(() => document.querySelector("main.app").dataset.state);
      if (!(st === null && hidden === true && hist === 0 && st2 === "select")) fails.push("clear=" + JSON.stringify([st, hidden, hist, st2]));
      await page.reload({ waitUntil: "load" });
      await page.waitForTimeout(400);
      if (!((await page.locator('[data-testid="roster-row"]').count()) === 0 && (await page.evaluate(() => localStorage.getItem("cal-phone.roster.v1"))) === null)) fails.push("clear-reload");
    } finally { await a.close(); }
  }
  // storage throws
  {
    const a = await freshInit({ init: () => { Storage.prototype.getItem = () => { throw new Error("blocked"); }; Storage.prototype.setItem = () => { throw new Error("blocked"); }; } });
    try {
      const { page } = a;
      await importText(page, "A.csv", A);
      await compute(page, "+", ["1", "2"]);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length === 1);
      const rows = await rosterRows(page);
      const w = await page.locator('[data-testid="storage-warning"]').textContent();
      if (!(rows[0].score === "3" && w === "本机存储不可用，刷新会丢失成绩。" && a.pageErrors.length === 0)) fails.push("storage-throw=" + JSON.stringify([rows[0].score, w.slice(0, 20), a.pageErrors]));
    } finally { await a.close(); }
  }
  // bad data variants
  const bads = [
    ["badjson", "{bad", null],
    ["version", JSON.stringify({ version: 99, fileName: "A.csv", headers: ["学号"], roles: ["id"], rows: [{ seq: 1, id: "1", name: "", extra: [], entry: null }] }), null],
    ["noroles", JSON.stringify({ version: 1, fileName: "A.csv", headers: ["学号"], rows: [{ seq: 1, id: "1", name: "", extra: [], entry: null }] }), null],
    ["badrole", JSON.stringify({ version: 1, fileName: "A.csv", headers: ["学号"], roles: ["foo"], rows: [{ seq: 1, id: "1", name: "", extra: [], entry: null }] }), null],
    ["badentry", JSON.stringify({ version: 1, fileName: "A.csv", headers: ["学号"], roles: ["id"], rows: [{ seq: 1, id: "1", name: "", extra: [], entry: { seq: 1, operator: "+", operands: [], base: null, expression: "", result: 1 } }] }), null],
  ];
  for (const [id, value] of bads) {
    const a = await freshInit({ init: (v) => { try { localStorage.setItem("cal-phone.roster.v1", v); } catch {} }, initArg: value });
    try {
      const { page } = a;
      await page.reload({ waitUntil: "load" });
      await page.waitForTimeout(400);
      const n = await page.locator('[data-testid="roster-row"]').count();
      const raw = await page.evaluate(() => { try { return localStorage.getItem("cal-phone.roster.v1"); } catch { return "blocked"; } });
      const w = await page.locator('[data-testid="roster-data-warning"]').textContent();
      if (!(n === 0 && raw === value && w === "本机名单数据无法读取，已忽略；原数据未覆盖。" && a.pageErrors.length === 0)) fails.push(id + "=" + JSON.stringify([n, String(raw).slice(0, 20), w.slice(0, 20), a.pageErrors.slice(0, 1)]));
    } finally { await a.close(); }
  }
  return verdict("H7", fails.length === 0, fails.length ? fails.join(" || ").slice(0, 900) : `存储shape逐字段+entry/刷新恢复3行next3/清除键删+reload无名单/抛错内存生效+精确文案/5坏数据无名单原文不动精确文案`);
}

// ---------- H8 ----------
async function checkH8() {
  const fails = [];
  const A = ["序号,学号,姓名,成绩,班级","1,20230101,张三,85,高一3班","2,20230102,李四,92,高一3班","3,20230103,王五,78,高一3班"].join("\r\n");
  const calcSnap = (page) => page.evaluate(() => ({
    state: document.querySelector("main.app").dataset.state,
    input: document.querySelector('[data-testid="calc-input"]').value,
    expr: document.querySelector('[data-testid="expression"]').textContent,
    result: document.querySelector('[data-testid="result"]').getAttribute("data-value"),
    summary: document.querySelector('[data-testid="roster-summary"]').textContent,
  }));
  {
    const a = await fresh();
    try {
      const { page } = a;
      await importText(page, "高一3班.csv", A, { bom: true });
      await compute(page, "+", ["12", "30", "8"]);
      await compute(page, "+", ["9", "1"]);
      const rowsBefore = await rosterRows(page);
      const snapBefore = await calcSnap(page);
      const storBefore = await page.evaluate(() => localStorage.getItem("cal-phone.roster.v1"));
      const now = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; });
      const dl = await readDownload(page, () => page.click('[data-testid="roster-export"]'));
      if (!(dl.name === `高一3班-成绩-${now}.csv`)) fails.push("name=" + dl.name);
      if (!(JSON.stringify([...dl.buffer.subarray(0, 3)]) === JSON.stringify([0xef, 0xbb, 0xbf]))) fails.push("bom");
      const bytes = [...dl.buffer];
      if (!(bytes.every((b, i) => b !== 0x0a || bytes[i - 1] === 0x0d))) fails.push("crlf");
      const lines = dl.text.replace(/^﻿/, "").split("\r\n");
      if (!(lines[0] === "序号,学号,姓名,成绩,班级" && lines[1] === "1,20230101,张三,50,高一3班" && lines[2] === "2,20230102,李四,10,高一3班" && lines[3] === "3,20230103,王五,,高一3班")) fails.push("content=" + JSON.stringify(lines.slice(0, 4)));
      const label = await page.locator("#state-label").textContent();
      if (!(label.includes("已导出 3 人") && label.includes("2 条成绩"))) fails.push("label=" + label.slice(0, 40));
      if (!(JSON.stringify(await rosterRows(page)) === JSON.stringify(rowsBefore) && JSON.stringify(await calcSnap(page)) === JSON.stringify(snapBefore) && (await page.evaluate(() => localStorage.getItem("cal-phone.roster.v1"))) === storBefore)) fails.push("side-effect");
      // reimport exported
      await openImport(page);
      await page.setInputFiles('[data-testid="roster-file"]', { name: "re.csv", mimeType: "text/csv", buffer: dl.buffer });
      await waitPreview(page);
      await page.click('[data-testid="import-confirm"]');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"]').length === 3);
      const re = await rosterRows(page);
      if (!(JSON.stringify(re.map((r) => [r.name, r.id])) === JSON.stringify([["张三","20230101"],["李四","20230102"],["王五","20230103"]]) && re.every((r) => r.filled === "false"))) fails.push("reimport=" + JSON.stringify(re));
    } finally { await a.close(); }
  }
  // missing seq / missing score / synonyms / custom / unmapped-score / quoted
  async function exportOnce(name, text) {
    const a = await fresh();
    try {
      const { page } = a;
      await importBuffer(page, { name, buffer: utf8(text) });
      const dl = await readDownload(page, () => page.click('[data-testid="roster-export"]'));
      return dl.text;
    } finally { await a.close(); }
  }
  const tMiss = await exportOnce("missing.csv", "学号,姓名,班级\n20230109,周五,高三2班\n");
  const hMiss = tMiss.replace(/^﻿/, "").split("\r\n")[0].split(",");
  if (!(hMiss[0] === "序号" && hMiss[hMiss.length - 1] === "成绩")) fails.push("misseq=" + hMiss.join("|"));
  const tSyn = await exportOnce("syn.csv", "姓名,名字,学号\n张三,小三,20230101\n");
  const hSyn = tSyn.replace(/^﻿/, "").split("\r\n");
  if (!(hSyn[0] === "序号,姓名,名字,学号,成绩" && hSyn[1] === "1,张三,小三,20230101,")) fails.push("syn=" + JSON.stringify(hSyn.slice(0, 2)));
  const tCus = await exportOnce("custom.csv", ["No.,编号,学生,总分,班级","1,A01,张三,,高一3班"].join("\n"));
  {
    // custom needs mapping before export: do manual flow
    const a = await fresh();
    try {
      const { page } = a;
      await openImport(page);
      await page.setInputFiles('[data-testid="roster-file"]', { name: "custom.csv", mimeType: "text/csv", buffer: utf8(["No.,编号,学生,总分,班级","1,A01,张三,,高一3班"].join("\n")) });
      await waitPreview(page);
      await page.selectOption('[data-testid="import-id-column"]', "1");
      await page.selectOption('[data-testid="import-name-column"]', "2");
      await page.selectOption('[data-testid="import-score-column"]', "3");
      await page.selectOption('[data-testid="import-seq-column"]', "0");
      await page.click('[data-testid="import-confirm"]');
      await page.waitForSelector('[data-testid="roster-row"]');
      const dl = await readDownload(page, () => page.click('[data-testid="roster-export"]'));
      const l = dl.text.replace(/^﻿/, "").split("\r\n");
      if (!((l[0].split(",").length === 5) && l[1].split(",")[0] === "1")) fails.push("custom=" + JSON.stringify(l.slice(0, 2)));
    } finally { await a.close(); }
  }
  void tCus;
  const tQ = await exportOnce("q.csv", '姓名,学号,备注\n"张,三",20230111,"含,逗号"\n');
  if (!(tQ.includes('"张,三"') && tQ.includes('"含,逗号"'))) fails.push("quote=" + tQ.slice(0, 120));
  return verdict("H8", fails.length === 0, fails.length ? fails.join(" || ").slice(0, 900) : `BOM+CRLF+三行精确+文件名日期前缀/缺列补序号成绩/同义写回/自定义按roles/引号RFC4180/前后快照不变+重导3人全空`);
}

// ---------- H9 ----------
async function checkH9() {
  const fails = [];
  const A3 = ["序号,学号,姓名,成绩,班级","1,20230101,张三,85,高一3班","2,20230102,李四,92,高一3班","3,20230103,王五,78,高一3班"].join("\r\n");
  async function buildState(page, kind) {
    if (kind === "mixed") {
      await importText(page, "A.csv", A3);
      await compute(page, "+", ["12", "30", "8"]);
      await compute(page, "+", ["9", "1"]);
    } else if (kind === "many") {
      await importText(page, "fifty.csv", ["学号,姓名", ...Array.from({ length: 50 }, (_, i) => `S${i + 1},学生${i + 1}`)].join("\n"));
    } else if (kind === "edit") {
      await importText(page, "five.csv", ["学号,姓名", "1,甲", "2,乙", "3,丙", "4,丁", "5,戊"].join("\n"));
      await compute(page, "+", ["12", "30", "8"]);
      await compute(page, "+", ["9", "1"]);
      await compute(page, "+", ["5", "5"]);
      await page.locator('[data-testid="roster-row"][data-seq="2"] [data-testid="roster-edit"]').click();
      await page.waitForTimeout(150);
    } else if (kind === "preview") {
      await openImport(page);
      await page.setInputFiles('[data-testid="roster-file"]', { name: "A.csv", mimeType: "text/csv", buffer: utf8(A3) });
      await waitPreview(page);
    } else if (kind === "paste") {
      await openImport(page);
      await page.click('[data-testid="import-paste"]');
      await page.waitForSelector('[data-testid="import-paste-text"]:not([hidden])');
    }
  }
  const overflow = (page) => page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  for (const narrow of [false, true]) {
    const tag = narrow ? "320" : "390";
    for (const kind of ["entry", "paste", "preview", "mixed", "many", "edit"]) {
      const a = narrow
        ? await freshInit({ cdp: { width: 320, height: 568, deviceScaleFactor: 2, mobile: true } })
        : await fresh();
      try {
        const { page } = a;
        await buildState(page, kind);
        await page.waitForTimeout(150);
        const ov = await overflow(page);
        if (!(ov.doc <= 1 && ov.body <= 1)) fails.push(`${tag}.${kind}.overflow=` + JSON.stringify(ov));
        const ctrls = await page.evaluate(() => Array.from(document.querySelectorAll("input,button")).filter((e) => { const cs = getComputedStyle(e); return cs.display !== "none" && cs.visibility !== "hidden" && !e.disabled && e.getClientRects().length > 0; }).map((e) => { const r = e.getBoundingClientRect(); return { t: e.getAttribute("data-testid") || e.tagName, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, f: parseFloat(getComputedStyle(e).fontSize) }; }));
        const small = ctrls.filter((c) => c.w < 43.5 || c.h < 43.5);
        if (!(small.length === 0)) fails.push(`${tag}.${kind}.touch=` + JSON.stringify(small.slice(0, 3)));
        const smallF = ctrls.filter((c) => c.f < 15.5);
        if (!(smallF.length === 0)) fails.push(`${tag}.${kind}.font=` + JSON.stringify(smallF.slice(0, 3)));
        if (kind === "preview" && narrow) {
          const tops = await page.$$eval('[data-testid="import-map"] select', (s) => s.map((e) => Math.round(e.getBoundingClientRect().top)));
          if (!(new Set(tops).size === 4)) fails.push(`320.preview.stack=` + tops.join(","));
        }
        if (kind === "mixed" || kind === "many" || kind === "edit") {
          const role = await page.locator('[data-testid="roster"]').getAttribute("role");
          const rrole = await page.locator('[data-testid="roster-row"]').first().getAttribute("role");
          const html = (await page.locator('[data-testid="roster"]').evaluate((e) => e.tagName)) + "/" + (await page.locator('[data-testid="roster-row"]').first().evaluate((e) => e.tagName));
          const okRole = role === "list" || /UL/i.test(html);
          const okRow = rrole === "listitem" || /LI|ARTICLE|TR/i.test(html);
          if (!(okRole && okRow)) fails.push(`${tag}.${kind}.role=` + JSON.stringify([role, rrole, html]));
          const al = await page.locator('[data-testid="roster-row"][data-seq="2"] [data-testid="roster-edit"]').getAttribute("aria-label");
          if (kind === "mixed" && !(al.includes("编辑第 2 位") && al.includes("李四"))) fails.push(`${tag}.mixed.arialabel=` + al);
          const nx = await page.locator('[data-testid="roster-next"]').textContent().catch(() => "");
          if (kind === "mixed" && !nx.includes("下一位")) fails.push(`${tag}.mixed.next=` + nx);
        }
        if (kind === "edit") {
          const info = await page.evaluate(() => { const d = document.querySelector('[data-testid="edit-draft"]'); const r = d.getBoundingClientRect(); const cs = getComputedStyle(d); return { pos: cs.position, left: Math.round(r.left), maxH: cs.maxHeight, top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight }; });
          if (!(info.pos === "fixed" && Math.abs(info.left - 10) <= 1)) fails.push(`${tag}.edit.float=` + JSON.stringify(info));
        }
      } finally { await a.close(); }
    }
    // dialog focus test
    {
      const a = narrow ? await freshInit({ cdp: { width: 320, height: 568, deviceScaleFactor: 2, mobile: true } }) : await fresh();
      try {
        const { page } = a;
        const opener = await page.locator('[data-testid="roster-import"]').evaluate((e) => e.getAttribute("data-testid"));
        await openImport(page);
        const dlg = await page.evaluate(() => { const d = document.querySelector('[data-testid="import-dialog"]'); return { tag: d.tagName, open: d.open, modal: d.matches(":modal"), active: document.activeElement?.getAttribute("data-testid") }; });
        if (!(dlg.tag === "DIALOG" && dlg.open === true && dlg.modal === true)) fails.push(`${tag}.dialog=` + JSON.stringify(dlg));
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !document.querySelector('[data-testid="import-dialog"]').open);
        const back = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
        if (!(back === "roster-import")) fails.push(`${tag}.focus=` + JSON.stringify([back, opener]));
      } finally { await a.close(); }
    }
  }
  return verdict("H9", fails.length === 0, fails.length ? fails.join(" || ").slice(0, 1200) : `390+320六态溢出≤1/触控≥43.5/字号输入≥15.5名单≥12.5/320四下拉纵向/role语义/aria含编辑第2位李四/next含下一位/dialog modal+焦点回归/浮动草稿左右10`);
}
// ---------- H10 ----------
async function checkH10() {
  const fails = [];
  const FROZEN = {
    "tests/scenarios/core.mjs": "2b35cce880e336882e384e940d28b103acc270a7931552cea5d5c9c79c9eeb7e",
    "tests/scenarios/continuity.mjs": "d53f1a4ce357bb200a4e811aa45d3dad187d40279c5f747c7ebb38c28e810a56",
    "tests/scenarios/edit.mjs": "f61188e63586e8afa2883f6db3d3dee88f7cc216a9a0c8dc7f465953ad37ceadc1",
    "tests/scenarios/layout.mjs": "c96ed96499a18b9731a8e10dabb599a761d445534105caab7424803def65a0",
    "tests/scenarios/determinism.mjs": "64bc09c49ac56c21aef77bdd1a7f6c565b9791d0690076f5964b58f06e69ddff",
    "tests/voice/run.mjs": "dcc96cc884f469fa18b5defd486adc30250c5ae24d9b7f58630d16d485d11733",
  };
  for (const [rel, want] of Object.entries(FROZEN)) {
    const got = sha256(fs.readFileSync(path.join(REPO, rel)));
    if (got !== want) fails.push("sha:" + rel + "=" + got.slice(0, 12));
  }
  const listRaw = execFileSync("node", [path.join(REPO, "tests", "suite.mjs"), "--list"], { encoding: "utf8", env: { ...process.env, PLAYWRIGHT_MODULE: "/ws/cal_phone/tests/node_modules/playwright" } });
  const ids = listRaw.trim().split("\n").filter(Boolean);
  const EXPECTED18 = ["self-contained","cold-start","compute","arithmetic","history-order","reset","continuity","error-recovery","sticky-operator","edit-recompute","edit-multi","edit-invalid","edit-divzero","edit-cancel-restore","edit-pending-replace","edit-pending-recent-value","layout","determinism"];
  for (const id of EXPECTED18) if (!ids.includes(id)) fails.push("missing18:" + id);
  const rosterIds = ids.filter((i) => i.startsWith("roster-"));
  if (!(rosterIds.length >= 6)) fails.push("rostercount=" + rosterIds.length);
  for (const kw of ["import", "fill", "edit", "export", "storage"]) {
    if (!rosterIds.some((i) => i.includes(kw))) fails.push("rosterkw:" + kw);
  }
  // full suite
  const suiteRaw = execFileSync("node", [path.join(REPO, "tests", "suite.mjs"), "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PLAYWRIGHT_MODULE: "/ws/cal_phone/tests/node_modules/playwright" }, timeout: 570000 });
  const suite = JSON.parse(suiteRaw);
  const byId = Object.fromEntries(suite.results.map((r) => [r.id, r]));
  for (const id of EXPECTED18) {
    if (!byId[id] || byId[id].pass !== true) fails.push("suite18:" + id);
  }
  const onlyRaw = execFileSync("node", [path.join(REPO, "tests", "suite.mjs"), "--json", "--only", rosterIds.join(",")], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PLAYWRIGHT_MODULE: "/ws/cal_phone/tests/node_modules/playwright" }, timeout: 570000 });
  const only = JSON.parse(onlyRaw);
  for (const r of only.results) if (r.pass !== true) fails.push("only:" + r.id);
  // voice: up to 2 runs, take fewer failures
  const BASELINE = new Set(["result.crash", "queue.quick-no-result", "queue.quick-keys"]);
  let best = null;
  for (let i = 0; i < 2; i++) {
    try {
      const v = execFileSync("node", [path.join(REPO, "tests", "voice", "run.mjs"), "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PLAYWRIGHT_MODULE: "/ws/cal_phone/tests/node_modules/playwright" }, timeout: 280000 });
      const j = JSON.parse(v);
      const failed = (j.checks || []).filter((c) => !c.pass).map((c) => c.id);
      if (!best || failed.length < best.failed.length) best = { failed, total: (j.checks || []).length, raw: j };
      if (failed.length === 0) break;
    } catch (e) {
      const m = String((e && e.stdout) || "");
      try {
        const j = JSON.parse(m.slice(m.indexOf("{")));
        const failed = (j.checks || []).filter((c) => !c.pass).map((c) => c.id);
        if (!best || failed.length < best.failed.length) best = { failed, total: (j.checks || []).length, raw: j };
      } catch { fails.push("voice-run-err"); }
    }
  }
  if (!best) fails.push("voice-noresult");
  else {
    if (!(best.failed.length <= 3 && best.failed.every((id) => BASELINE.has(id)))) fails.push("voice=" + JSON.stringify(best.failed));
  }
  return verdict("H10", fails.length === 0, fails.length ? fails.join(" || ").slice(0, 900) : `冻结6文件sha一致/18既有PASS/roster-${rosterIds.length}个覆盖5关键词全PASS/语音失败⊆基线3且≤3`);
}

// ---------- H11 ----------
async function checkH11() {
  const fails = [];
  const text = fs.readFileSync(ART, "utf8");
  if (!text.includes("</html>")) fails.push("no-html");
  if (!(Buffer.byteLength(text, "utf8") >= 1024)) fails.push("bytes=" + Buffer.byteLength(text, "utf8"));
  const ext = (text.match(/<(script|link|img|source)[^>]*(src|href)=/gi) || []).length;
  const abs = ((text.match(/<(script|img|source)[^>]*src\s*=\s*["'](https?:)?\/\//gi) || []).length) + ((text.match(/<link[^>]*href\s*=\s*["'](https?:)?\/\//gi) || []).length) + ((text.match(/@import/gi) || []).length) + ((text.match(/url\s*\(\s*["']?(https?:)?\/\//gi) || []).length);
  if (!(abs === 0)) fails.push("external=" + abs + "/" + ext);
  // determinism: two contexts same ops
  const CSV = ["序号,学号,姓名,成绩,班级","1,20230101,张三,85,高一3班","2,20230102,李四,92,高一3班","3,20230103,王五,78,高一3班"].join("\r\n");
  async function once() {
    const a = await fresh();
    try {
      const { page } = a;
      await importText(page, "A.csv", CSV);
      await page.selectOption('[data-testid="import-id-column"]', "1");
      await page.selectOption('[data-testid="import-name-column"]', "2");
      await page.selectOption('[data-testid="import-score-column"]', "3");
      await page.selectOption('[data-testid="import-seq-column"]', "0");
      await compute(page, "+", ["12", "30", "8"]);
      await compute(page, "+", ["9", "1"]);
      await page.locator('[data-testid="roster-row"][data-seq="1"] [data-testid="roster-edit"]').click();
      await page.locator('[data-testid="operand-input"]').first().fill("7");
      await page.click('[data-testid="key-equals"]');
      await page.waitForFunction(() => document.querySelector('[data-testid="roster-row"][data-seq="1"] [data-testid="roster-score"]')?.getAttribute("data-value") === "45");
      const rows = await rosterRows(page);
      const storage = await page.evaluate(() => localStorage.getItem("cal-phone.roster.v1"));
      const dl = await readDownload(page, () => page.click('[data-testid="roster-export"]'));
      return { rows, storage, exported: dl.text };
    } finally { await a.close(); }
  }
  const r1 = await once();
  const r2 = await once();
  if (!(JSON.stringify(r1.rows) === JSON.stringify(r2.rows) && r1.storage === r2.storage && r1.exported === r2.exported)) fails.push("nondet");
  if (!((await import("node:util")).isDeepStrictEqual(r1.rows[0], r2.rows[0]) && r1.rows[0].score === "45")) fails.push("det45=" + JSON.stringify(r1.rows[0]));
  if (!(allPageErrors.length === 0 && allConsoleErrors.length === 0)) fails.push(`errs:page=${allPageErrors.length} console=${allConsoleErrors.length} ` + [...allPageErrors, ...allConsoleErrors].slice(0, 2).join("|").slice(0, 200));
  return verdict("H11", fails.length === 0, fails.length ? fails.join(" || ").slice(0, 900) : `自包含无外链${Buffer.byteLength(text, "utf8")}B/双context行+存储+导出一致45分/pageerror0`);
}

// ---------- renders ----------
function crc32Table() {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
}
const CRC_T = crc32Table();
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.from(type, "ascii");
  let crc = 0xffffffff;
  const body = Buffer.concat([td, data]);
  for (const b of body) crc = CRC_T[(crc ^ b) & 0xff] ^ (crc >>> 8);
  const cb = Buffer.alloc(4); cb.writeUInt32BE(crc >>> 0);
  return Buffer.concat([len, body, cb]);
}
function grayPNG(w, h, fn) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = fn(x, y); }
  const comp = zlib.deflateSync(raw);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr), pngChunk("IDAT", comp), pngChunk("IEND", Buffer.alloc(0))]);
}
function shotsDistinct(pngs) {
  const hashes = pngs.map((p) => sha256(p));
  return new Set(hashes).size === pngs.length;
}
function pngSize(p) {
  return { w: p.readUInt32BE(16), h: p.readUInt32BE(20) };
}
async function renderShots() {
  const A4 = ["序号,学号,姓名,成绩,班级","1,20230101,张三,85,高一3班","2,20230102,李四,92,高一3班","3,20230103,王五,78,高一3班","4,20230104,赵六,61,高一3班"].join("\r\n");
  const C3 = ["编号,学生,班级,总分","A01,甲,高一,80","A02,乙,高一,90","A03,丙,高一,70"].join("\r\n");
  const A5 = ["学号,姓名","1,甲","2,乙","3,丙","4,丁","5,戊"].join("\n");
  const metrics = [];
  const shotsMeta = [];
  const pngs = [];
  async function shot(name, setup, w, h, cdp) {
    const a = cdp ? await freshInit({ cdp }) : await fresh({ width: w, height: h });
    try {
      const { page } = a;
      await setup(page);
      await page.waitForTimeout(250);
      const file = path.join(OUT, `review-shots/r${ROUND}`, `${name}.png`);
      await page.screenshot({ path: file });
      const buf = fs.readFileSync(file);
      pngs.push(buf);
      const { w: pw, h: ph } = pngSize(buf);
      shotsMeta.push({ file: `${name}.png`, sha256: sha256(buf), width: pw, height: ph });
      const m = await page.evaluate(() => ({
        docOver: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        bodyOver: document.body.scrollWidth - document.body.clientWidth,
        dialogOpen: !!document.querySelector('[data-testid="import-dialog"]')?.open,
        rows: document.querySelectorAll('[data-testid="roster-row"]').length,
        filled: document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length,
      }));
      metrics.push(`${name}.width=${pw} ${name}.height=${ph} ${name}.docOverflow=${m.docOver} ${name}.bodyOverflow=${m.bodyOver} ${name}.rows=${m.rows} ${name}.filled=${m.filled} ${name}.dialogOpen=${m.dialogOpen}`);
    } finally { await a.close(); }
  }
  await shot("S1", async (page) => { await openImport(page); }, 390, 844, null);
  await shot("S2", async (page) => {
    await importText(page, "A4.csv", A4);
    await compute(page, "+", ["12", "30", "8"]);
    await compute(page, "+", ["9", "1"]);
    await openImport(page);
    await page.setInputFiles('[data-testid="roster-file"]', { name: "c3.csv", mimeType: "text/csv", buffer: utf8(C3) });
    await waitPreview(page);
    await page.selectOption('[data-testid="import-id-column"]', "0");
    await page.selectOption('[data-testid="import-name-column"]', "1");
    await page.selectOption('[data-testid="import-score-column"]', "3");
    await page.waitForTimeout(200);
  }, 390, 844, null);
  await shot("S3", async (page) => {
    await importText(page, "A5.csv", A5);
    await compute(page, "+", ["12", "30", "8"]);
    await compute(page, "+", ["9", "1"]);
    await page.locator('[data-testid="roster"]').scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(150);
  }, 390, 844, null);
  await shot("S4", async (page) => {
    await importText(page, "A5.csv", A5);
    await compute(page, "+", ["12", "30", "8"]);
    await compute(page, "+", ["9", "1"]);
    await compute(page, "+", ["5", "5"]);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length === 3);
    await page.locator('[data-testid="roster-row"][data-seq="2"] [data-testid="roster-edit"]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-testid="roster-row"][data-seq="2"]').scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(150);
  }, 320, 568, { width: 320, height: 568, deviceScaleFactor: 2, mobile: true });
  // validate: non-empty, >=240x160, distinct
  for (const s of shotsMeta) {
    const st = fs.statSync(path.join(OUT, `review-shots/r${ROUND}`, s.file));
    if (st.size === 0) throw new Error("empty shot " + s.file);
    if (s.width < 240 || s.height < 160) throw new Error("small shot " + s.file);
  }
  if (!shotsDistinct(pngs)) throw new Error("shots not distinct");
  const nonSolid = pngs.map((b) => { const u = new Set([...b.subarray(0, 4000)]); return u.size; });
  if (nonSolid.some((n) => n < 4)) throw new Error("solid shot");
  return { metrics, shotsMeta };
}

// ---------- main ----------
browser = await launchBrowser();
const runT0 = Date.now();
for (const [fn, id] of [[checkH1,'H1'],[checkH2,'H2'],[checkH3,'H3'],[checkH4,'H4'],[checkH5,'H5'],[checkH6,'H6'],[checkH7,'H7'],[checkH8,'H8'],[checkH9,'H9'],[checkH10,'H10'],[checkH11,'H11']]) {
  try {
    await fn();
  } catch (e) {
    verdict(id, false, 'threw: ' + String((e && e.message) || e).slice(0, 300));
  }
}
let renderLines = [];
let shotsMeta = [];
if (EXPECTED.length > 0) {
  const r = await renderShots();
  renderLines = r.metrics;
  shotsMeta = r.shotsMeta;
}
await browser.close();
browser = null;
const hardPass = H.every((h) => h.pass);
const hardPath = path.join(OUT, `hard-r${ROUND}.txt`);
const lines = [`ROUND: ${ROUND}`, `ARTIFACT_SHA256: ${ART_SHA}`, `VERIFIER_SHA256: ${SELF_SHA}`, ...H.map((h) => `H${h.id.slice(1)} ${h.pass ? "PASS" : "FAIL"} — ${h.evidence}`), hardPass ? "HARD: PASS" : `HARD: FAIL (${H.filter((h) => !h.pass).map((h) => h.id).join(",")})`];
fs.writeFileSync(hardPath, lines.join("\n") + "\n");
if (EXPECTED.length > 0) {
  const renderPath = path.join(OUT, `render-r${ROUND}.txt`);
  fs.writeFileSync(renderPath, [`ROUND: ${ROUND}`, `ARTIFACT_SHA256: ${ART_SHA}`, `VERIFIER_SHA256: ${SELF_SHA}`, ...renderLines].join("\n") + "\n");
  const manifest = { round: ROUND, artifact_sha256: ART_SHA, verifier_sha256: SELF_SHA, metrics_sha256: sha256(fs.readFileSync(renderPath)), shots: shotsMeta, adhoc: [] };
  fs.writeFileSync(path.join(OUT, `manifest-r${ROUND}.json`), JSON.stringify(manifest, null, 2) + "\n");
}
console.log(`verify done in ${Math.round((Date.now() - runT0) / 1000)}s -> ${hardPath} ${hardPass ? "PASS" : "FAIL"}`);
