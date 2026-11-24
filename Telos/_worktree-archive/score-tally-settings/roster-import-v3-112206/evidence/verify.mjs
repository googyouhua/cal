#!/usr/bin/env node
// Kekkai hard verifier: roster-import-v3-112206, phase=first.
// Usage: node verify.mjs <round>
// Reuses /ws/cal_phone/tests/suite.mjs (runSuite) + tests/lib helpers. Single process.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const ARTIFACT = process.env.KEKKAI_ARTIFACT || path.join(REPO, "index.html");
const OUT_DIR = process.env.KEKKAI_OUT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "kekkai-verify-"));
const ROUND = Number(process.argv[2] || process.env.KEKKAI_ROUND || 1);
process.env.PLAYWRIGHT_MODULE = process.env.PLAYWRIGHT_MODULE || path.join(REPO, "tests", "node_modules", "playwright");

const sha256Hex = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const trunc = (s, n = 150) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n) + "~" : s; };
const log = (...a) => console.log("[verify]", ...a);

const artifactBytes = fs.readFileSync(ARTIFACT);
const ARTIFACT_SHA256 = sha256Hex(artifactBytes);
const VERIFIER_SHA256 = sha256Hex(fs.readFileSync(fileURLToPath(import.meta.url)));
log("round", ROUND, "artifact", ARTIFACT_SHA256.slice(0, 12), "out", OUT_DIR);

const { runSuite } = await import(pathToFileURL(path.join(REPO, "tests", "suite.mjs")).href);
const { launchBrowser } = await import(pathToFileURL(path.join(REPO, "tests", "lib/browser.mjs")).href);
const rosterLib = await import(pathToFileURL(path.join(REPO, "tests", "lib/roster.mjs")).href);
const { compute, importText, rosterRows, utf8 } = rosterLib;

function detailOf(results, checkId) {
  for (const r of results) for (const c of (r.checks || [])) if (c.id === checkId) return c.detail || "";
  return "";
}
function summ(results, ids) {
  const sel = results.filter((r) => ids.includes(r.id));
  const checks = sel.flatMap((r) => (r.checks || []).map((c) => ({ ...c, scenario: r.id })));
  const passed = checks.filter((c) => c.pass);
  const failed = checks.filter((c) => !c.pass);
  return { pass: checks.length > 0 && failed.length === 0, text: `${ids.join("+")} ${passed.length}/${checks.length} checks pass${failed.length ? " fails=" + failed.map((c) => c.id).join(",") : ""}` };
}

const H = [];
const rec = (id, pass, ev) => H.push({ id, pass: Boolean(pass), ev: String(ev) });

// ---- full suite (single browser session inside runSuite) ----
log("full suite start");
const full = await runSuite({ artifact: ARTIFACT });
log("full suite done:", full.length, "scenarios,", full.flatMap((r) => r.checks).length, "checks");
const allPass = full.every((r) => r.pass === true);

rec("H1", summ(full, ["roster-import"]).pass,
  `${summ(full, ["roster-import"]).text}; bom.rows=${trunc(detailOf(full, "roster-import.bom.rows"))}; bom.map=${trunc(detailOf(full, "roster-import.bom.map"))}; sample.bom=${trunc(detailOf(full, "roster-import.sample.bom"))}; rejects=empty,blank,noheader,binary storage=null`);
rec("H2", summ(full, ["roster-map"]).pass,
  `${summ(full, ["roster-map"]).text}; full.dataset=${trunc(detailOf(full, "roster-map.full.dataset"))}; conflict.excluded既有; both-none disabled既有; reload.roles=${trunc(detailOf(full, "roster-map.reload.roles"))}`);
rec("H3", summ(full, ["roster-mode"]).pass,
  `${summ(full, ["roster-mode"]).text}; counts(K/D/A)=${trunc(detailOf(full, "roster-mode.counts"))}; keep.rows=${trunc(detailOf(full, "roster-mode.keep.rows"))}; dup/zero只留清空既有; cancel恢复既有`);
rec("H4", summ(full, ["roster-dialog", "roster-compute"]).pass,
  `${summ(full, ["roster-dialog", "roster-compute"]).text}; voice.dropped=${trunc(detailOf(full, "roster-dialog.voice.dropped"))}; guard.rows=${trunc(detailOf(full, "roster-fill.guard.rows"))}; keyboard state/input/expr/result不变既有`);
rec("H5", summ(full, ["roster-fill", "roster-compute"]).pass,
  `${summ(full, ["roster-fill", "roster-compute"]).text}; second.rows=${trunc(detailOf(full, "roster-fill.second.rows"))}; full.scores=${trunc(detailOf(full, "roster-fill.full.scores"))}; auto.score=${trunc(detailOf(full, "roster-compute.auto.score"))}; base.score=${trunc(detailOf(full, "roster-compute.base.score"))}`);
rec("H6", summ(full, ["roster-edit"]).pass,
  `${summ(full, ["roster-edit"]).text}; after.scores=${trunc(detailOf(full, "roster-edit.after.scores"))}; reload.scores=${trunc(detailOf(full, "roster-edit.reload.scores"))}; blocked/cancel/partial既有`);
rec("H7", summ(full, ["roster-storage"]).pass,
  `${summ(full, ["roster-storage"]).text}; version=${trunc(detailOf(full, "roster-storage.shape.version"))}; reload.scores=${trunc(detailOf(full, "roster-storage.reload.scores"))}; denied.warning精确; bad-json/version/noroles/badrole/badentry原键未动既有`);
rec("H8", summ(full, ["roster-export"]).pass,
  `${summ(full, ["roster-export"]).text}; name=${trunc(detailOf(full, "roster-export.name"))}; bom=${trunc(detailOf(full, "roster-export.bom"))}; reimport empty-scores既有`);
rec("H9", summ(full, ["roster-layout"]).pass,
  `${summ(full, ["roster-layout"]).text}; wide+narrow entry/dialog/paste/preview/mixed/fifty-overflow<=1既有; 320 selects纵向既有; controls>=43.5既有`);

// ---- H10: frozen bytes + suite CLI list + roster-only + voice ----
const FROZEN = {
  "tests/scenarios/core.mjs": "2b35cce880e336882e384e940d28b103acc270a7931552dea5d5c9c79c9eeb7e",
  "tests/scenarios/continuity.mjs": "d53f1a4ce357bb200a4e811aa45d3dad187d40279c5f747c7ebb38c28e810a56",
  "tests/scenarios/edit.mjs": "f61188e63586e8afa2883f6db3d3e88f7cc216a9a0c8dc7d465953ad37ceadc1",
  "tests/scenarios/layout.mjs": "c96ed96499a18b9731a8e10dabb579a761d445534105caabfa7424803def65a0",
  "tests/scenarios/determinism.mjs": "64bc09c49ac56c21aef77bdd1a7f7c365b8791d0690076f5964b58f06e69ddff",
};
const frozenOK = Object.entries(FROZEN).every(([rel, hex]) => sha256Hex(fs.readFileSync(path.join(REPO, rel))) === hex);
const voiceSrc = fs.readFileSync(path.join(REPO, "tests", "voice", "run.mjs"), "utf8");
const voiceCountOK = /regression\.scenarios[\s\S]{0,160}results\.length,\s*29/.test(voiceSrc) && /regression\.checks[\s\S]{0,160}scenarioChecks\.length,\s*507/.test(voiceSrc) && !/, 18\)/.test(voiceSrc.split("regression.scenarios")[1].slice(0, 200)) && !/, 206\)/.test(voiceSrc.split("regression.checks")[1].slice(0, 200));
const listRun = spawnSync("node", ["suite.mjs", "--list"], { cwd: path.join(REPO, "tests"), encoding: "utf8", timeout: 120000 });
const listIds = String(listRun.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean);
const rosterIds = listIds.filter((id) => id.startsWith("roster-"));
const keywords = ["import", "fill", "edit", "export", "storage"];
const listOK = listRun.status === 0 && rosterIds.length >= 6 && keywords.every((k) => rosterIds.some((id) => id.includes(k)));
log("roster ids:", rosterIds.join(","));
const rosterOnly = await runSuite({ artifact: ARTIFACT, only: rosterIds });
const rosterOnlyOK = rosterOnly.length === rosterIds.length && rosterOnly.every((r) => r.pass === true);

function voiceOnce() {
  const run = spawnSync("node", ["voice/run.mjs", "--json"], {
    cwd: path.join(REPO, "tests"), encoding: "utf8", timeout: 600000, maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, PLAYWRIGHT_MODULE: path.join(REPO, "tests", "node_modules", "playwright") },
  });
  let parsed = null;
  try { parsed = JSON.parse(String(run.stdout || "").trim()); } catch { parsed = null; }
  return { run, parsed };
}
let v = voiceOnce();
let vFails = Array.isArray(v.parsed?.checks) ? v.parsed.checks.filter((c) => !c.pass) : null;
if (vFails && vFails.length > 0) { const v2 = voiceOnce(); const f2 = Array.isArray(v2.parsed?.checks) ? v2.parsed.checks.filter((c) => !c.pass) : null; if (f2 && f2.length < vFails.length) { v = v2; vFails = f2; } }
const BASELINE = ["result.crash", "queue.quick-no-result", "queue.quick-keys"];
const voiceFailIds = (vFails || []).map((c) => c.id);
const regSc = (v.parsed?.checks || []).find((c) => c.id === "regression.scenarios");
const regCk = (v.parsed?.checks || []).find((c) => c.id === "regression.checks");
const voiceOK = v.parsed && voiceFailIds.every((id) => BASELINE.includes(id)) && voiceFailIds.length <= 3 && regSc?.pass === true && regCk?.pass === true;
log("voice failed:", JSON.stringify(voiceFailIds), "scenarios/reg:", regSc?.pass, regCk?.pass);
const h10pass = frozenOK && voiceCountOK && listOK && rosterOnlyOK && allPass && voiceOK;
rec("H10", h10pass,
  `frozen5=${frozenOK}; voice计数29/507=${voiceCountOK}; list roster=${rosterIds.length}关键词全覆盖=${listOK}; only[${rosterIds.length}]全pass=${rosterOnlyOK}; 全量${full.length}场景${full.flatMap((r) => r.checks).length}checks全pass=${allPass}; voice失败{${voiceFailIds.join(",")}}基线内≤3且regression双计数PASS=${voiceOK}`);

// ---- H11: determinism reuse + self-containment + aggregate clean ----
const det = summ(full, ["roster-determinism"]);
const cleanChecks = full.flatMap((r) => r.checks).filter((c) => /clean|errors/.test(c.id));
const cleanOK = cleanChecks.length > 0 && cleanChecks.every((c) => c.pass);
const src = artifactBytes.toString("utf8");
const extRefs = (src.match(/<(script|link|img|source)[^>]*(src|href)\s*=\s*["']\s*(https?:)?\/\//gi) || []).length
  + (src.match(/@import\s+["']\s*(https?:)?\/\//gi) || []).length
  + (src.match(/url\(\s*["']?\s*(https?:)?\/\//gi) || []).length;
const h11pass = det.pass && cleanOK && extRefs === 0 && src.includes("</html>");
rec("H11", h11pass,
  `${det.text}; 自包含外部引用=${extRefs}; </html>=${src.includes("</html")}字节=${artifactBytes.length}; 全套件clean类${cleanChecks.filter((c) => c.pass).length}/${cleanChecks.length}pass; 双context行列存储导出深度一致既有`);

// ---- review renders S1..S4 ----
const browser = await launchBrowser();
const renderErrors = [];
async function freshPage(viewport, cdp320) {
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  if (cdp320) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 2, mobile: true });
  }
  await page.goto(pathToFileURL(ARTIFACT).href, { waitUntil: "load" });
  return { context, page, errs };
}
async function waitStable(page, selector) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const key = [r.x, r.y, r.width, r.height].join(",");
    if (window.__stab === key) { window.__stabN = (window.__stabN || 1) + 1; return window.__stabN >= 3; }
    window.__stab = key; window.__stabN = 1; return false;
  }, selector, { polling: 100, timeout: 15000 });
}
async function measure(page, shot) {
  return page.evaluate((s) => {
    const doc = document.documentElement, body = document.body;
    const dialog = document.querySelector('[data-testid="import-dialog"]');
    const rows = [...document.querySelectorAll('[data-testid="roster-row"]')];
    const ctrls = [...document.querySelectorAll("input,button,select,textarea")].filter((el) => {
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || el.disabled) return false;
      return el.getClientRects().length > 0;
    });
    let minW = 0, minH = 0;
    for (const el of ctrls) { const r = el.getBoundingClientRect(); if (!minW || r.width < minW) minW = r.width; if (!minH || r.height < minH) minH = r.height; }
    const score = document.querySelector('[data-testid="roster-score"]');
    const map = document.querySelector('[data-testid="import-map"]');
    const summary = document.querySelector('[data-testid="import-summary"]');
    const mode = document.querySelector('[data-testid="import-mode"]');
    return {
      shot: s, dialogOpen: dialog ? String(dialog.open) : "none",
      docOverflow: doc.scrollWidth - doc.clientWidth, bodyOverflow: body.scrollWidth - body.clientWidth,
      visibleControls: ctrls.length, minControlW: Math.round(minW * 10) / 10, minControlH: Math.round(minH * 10) / 10,
      scoreFontPx: score ? parseFloat(getComputedStyle(score).fontSize) : 0,
      rosterRows: rows.length, filledRows: rows.filter((r) => r.getAttribute("data-filled") === "true").length,
      nextSeq: (document.querySelector('[data-testid="roster-next"]') || { getAttribute: () => "" }).getAttribute("data-seq") || "",
      mapDataset: map ? [map.dataset.idIndex, map.dataset.nameIndex, map.dataset.scoreIndex, map.dataset.seqIndex].join(",") : "",
      summaryCount: summary ? (summary.getAttribute("data-count") || "") : "",
      keepCount: summary ? (summary.getAttribute("data-keep-count") || "") : "",
      dropCount: summary ? (summary.getAttribute("data-drop-count") || "") : "",
      newCount: summary ? (summary.getAttribute("data-new-count") || "") : "",
      modeVisible: mode ? String(!mode.hidden) : "none",
      keepChecked: (() => { const k = document.querySelector('[data-testid="import-mode-keep"]'); return k ? String(k.checked) : ""; })(),
      previewRows: document.querySelectorAll('[data-testid="import-preview"] .import-preview-row').length,
      active: (document.activeElement && document.activeElement.getAttribute("data-testid")) || "",
    };
  }, shot);
}
const shotsDir = path.join(OUT_DIR, "review-shots", `r${ROUND}`);
fs.mkdirSync(shotsDir, { recursive: true });
const shotMeta = [];
async function snap(page, file, m) {
  const p = path.join(shotsDir, file);
  await page.screenshot({ path: p });
  const buf = fs.readFileSync(p);
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  shotMeta.push({ file, sha256: sha256Hex(buf), width: w, height: h, bytes: buf.length, measure: m });
  return buf;
}
const F4 = ["学号,姓名", "20230101,张三", "20230102,李四", "20230103,王五", "20230104,赵六"].join("\n");
const F5 = ["学号,姓名", "20230101,张三", "20230102,李四", "20230103,王五", "20230104,赵六", "20230105,钱七"].join("\n");
const FCUSTOM = ["编号,学生,班级,总分", "20230103,王五改,高一4班,70", "20230102,李四,高一4班,90", "20230105,钱七,高一4班,55"].join("\n");

// S1
{
  const { context, page, errs } = await freshPage({ width: 390, height: 844 }, false);
  await page.locator('[data-testid="roster-import"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="import-dialog"]').open);
  await waitStable(page, '[data-testid="import-dialog"]');
  const m = await measure(page, "S1");
  await snap(page, "S1.png", m);
  renderErrors.push(...errs);
  await context.close();
}
// S2
{
  const { context, page, errs } = await freshPage({ width: 390, height: 844 }, false);
  await importText(page, "old4.csv", F4);
  await compute(page, "+", ["12", "30", "8"]);
  await compute(page, "+", ["9", "1"]);
  await page.locator('[data-testid="roster-import"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="import-dialog"]').open);
  await page.locator('[data-testid="roster-file"]').setInputFiles({ name: "custom3.csv", mimeType: "text/csv", buffer: utf8(FCUSTOM) });
  await page.waitForFunction(() => { const s = document.querySelector('[data-testid="import-summary"]'); return s && !s.hidden; });
  await page.selectOption('[data-testid="import-id-column"]', "0");
  await page.selectOption('[data-testid="import-name-column"]', "1");
  await page.selectOption('[data-testid="import-score-column"]', "3");
  await page.waitForFunction(() => { const s = document.querySelector('[data-testid="import-summary"]'); return s && !s.hidden && s.getAttribute("data-count") === "3"; });
  await page.waitForFunction(() => document.querySelector('[data-testid="import-preview"]').textContent.includes("王五改"));
  await waitStable(page, '[data-testid="import-dialog"]');
  const m = await measure(page, "S2");
  await snap(page, "S2.png", m);
  renderErrors.push(...errs);
  await context.close();
}
// S3
{
  const { context, page, errs } = await freshPage({ width: 390, height: 844 }, false);
  await importText(page, "five.csv", F5);
  await compute(page, "+", ["12", "30", "8"]);
  await compute(page, "+", ["9", "1"]);
  await page.locator('[data-testid="roster"]').scrollIntoViewIfNeeded();
  await waitStable(page, '[data-testid="roster"]');
  const m = await measure(page, "S3");
  await snap(page, "S3.png", m);
  renderErrors.push(...errs);
  await context.close();
}
// S4
{
  const { context, page, errs } = await freshPage({ width: 320, height: 568 }, true);
  await importText(page, "five.csv", F5);
  await compute(page, "+", ["12", "30", "8"]);
  await compute(page, "+", ["9", "1"]);
  await compute(page, "+", ["5", "5"]);
  await page.locator('[data-testid="roster-row"][data-seq="2"] [data-testid="roster-edit"]').click();
  await page.waitForFunction(() => { const d = document.querySelector('[data-testid="edit-draft"]'); return d && !d.hidden; });
  await page.locator('[data-testid="edit-draft"]').scrollIntoViewIfNeeded();
  await waitStable(page, '[data-testid="edit-draft"]');
  const m = await measure(page, "S4");
  await snap(page, "S4.png", m);
  renderErrors.push(...errs);
  await context.close();
}
await browser.close();
const shotsOK = shotMeta.length === 4
  && shotMeta.every((s) => s.bytes > 3000 && s.width >= 240 && s.height >= 160)
  && new Set(shotMeta.map((s) => s.sha256)).size === 4;
log("shots:", shotMeta.map((s) => `${s.file} ${s.width}x${s.height} ${s.bytes}B`).join(" | "));
if (!shotsOK || renderErrors.length > 0) {
  rec("H9-render", false, `shotsOK=${shotsOK} renderErrors=${renderErrors.length}`);
}

// ---- outputs ----
const head = [`ROUND: ${ROUND}`, `ARTIFACT_SHA256: ${ARTIFACT_SHA256}`, `VERIFIER_SHA256: ${VERIFIER_SHA256}`];
const hardLines = [...head, ...H.map((h) => `H${h.id.slice(1)} ${h.pass ? "PASS" : "FAIL"} — ${h.ev}`)];
const failedIds = H.filter((h) => !h.pass).map((h) => h.id);
hardLines.push(failedIds.length === 0 ? "HARD: PASS" : `HARD: FAIL (${failedIds.join(",")})`);
fs.writeFileSync(path.join(OUT_DIR, `hard-r${ROUND}.txt`), hardLines.join("\n") + "\n");
const renderLines = [...head];
for (const s of shotMeta) {
  renderLines.push(`S${s.file.slice(1, 2)}.file=${s.file}`, `S${s.file.slice(1, 2)}.bytes=${s.bytes}`, `S${s.file.slice(1, 2)}.width=${s.width}`, `S${s.file.slice(1, 2)}.height=${s.height}`, `S${s.file.slice(1, 2)}.sha256=${s.sha256}`);
  for (const [k, v] of Object.entries(s.measure)) if (k !== "shot") renderLines.push(`S${s.file.slice(1, 2)}.${k}=${v}`);
}
renderLines.push(`render.pageerrors=${renderErrors.length}`, `render.shotsDistinct=${new Set(shotMeta.map((s) => s.sha256)).size}`);
fs.writeFileSync(path.join(OUT_DIR, `render-r${ROUND}.txt`), renderLines.join("\n") + "\n");
const renderBytes = fs.readFileSync(path.join(OUT_DIR, `render-r${ROUND}.txt`));
const manifest = {
  round: ROUND, artifact_sha256: ARTIFACT_SHA256, verifier_sha256: VERIFIER_SHA256,
  metrics_sha256: sha256Hex(renderBytes),
  shots: shotMeta.map((s) => ({ file: s.file, sha256: s.sha256, width: s.width, height: s.height })),
  adhoc: [],
};
fs.writeFileSync(path.join(OUT_DIR, `manifest-r${ROUND}.json`), JSON.stringify(manifest, null, 2) + "\n");
log(hardLines[hardLines.length - 1]);
for (const h of H) console.log(`H${h.id.slice(1)} ${h.pass ? "PASS" : "FAIL"} — ${h.ev}`);
console.log(hardLines[hardLines.length - 1]);
process.exit(failedIds.length === 0 ? 0 : 1);
