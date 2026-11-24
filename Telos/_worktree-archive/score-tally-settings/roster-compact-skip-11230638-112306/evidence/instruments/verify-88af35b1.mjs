#!/usr/bin/env node
// Kekkai hard-gate verifier: roster-compact-skip. Measures H1..H5 live via Playwright.
process.env.PLAYWRIGHT_MODULE = process.env.PLAYWRIGHT_MODULE || "/ws/cal_phone/tests/node_modules/playwright";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROUND = Number(process.argv[2] ?? process.env.KEKKAI_ROUND ?? 1);
const ARTIFACT = process.env.KEKKAI_ARTIFACT ?? "/ws/cal_phone/index.html";
const REPO = "/ws/cal_phone";
const OUT = process.env.KEKKAI_OUT_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "kekkai-verify-"));
const SHOT_DIR = path.join(OUT, "review-shots", `r${ROUND}`);
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(SHOT_DIR, { recursive: true });
const FIX_DIR = path.join(OUT, "fixtures");
fs.mkdirSync(FIX_DIR, { recursive: true });

const shaHex = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const artifactSha = shaHex(fs.readFileSync(ARTIFACT));
const verifierSha = shaHex(fs.readFileSync(fileURLToPath(import.meta.url)));

const { launchBrowser } = await import("/ws/cal_phone/tests/lib/browser.mjs");
const ROSTER = await import("/ws/cal_phone/tests/lib/roster.mjs");
const { importText: libImportText, compute: libCompute, rosterRows: libRosterRows, utf8 } = ROSTER;

const allPageErrors = [];
const allConsoleErrors = [];
const browser = await launchBrowser();
const results = [];
let shotMetrics = [];

function rec(id, pass, detail) {
  results.push({ id, pass: !!pass, detail: String(detail).slice(0, 1200) });
  return !!pass;
}

async function openFresh({ width = 390, height = 568 + 276, cdp = false } = {}) {
  const h = width === 320 ? 568 : height;
  const context = await browser.newContext({ viewport: { width, height: h }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  page.on("pageerror", (e) => { allPageErrors.push(`${width}: ${String(e).slice(0, 300)}`); });
  page.on("console", (m) => { if (m.type() === "error") allConsoleErrors.push(`${width}: ${m.text().slice(0, 300)}`); });
  if (cdp) {
    const sess = await context.newCDPSession(page);
    await sess.send("Emulation.setDeviceMetricsOverride", { width, height: h, deviceScaleFactor: 2, mobile: true });
  }
  await page.goto(pathToFileURL(ARTIFACT).href, { waitUntil: "load" });
  await page.waitForFunction(() => !!document.querySelector("main.app"));
  return { context, page, async close() { await context.close(); } };
}

async function importCsv(page, name, text) {
  await page.click('[data-testid="roster-import"]');
  await page.waitForSelector('[data-testid="import-dialog"][open]');
  await page.setInputFiles('[data-testid="roster-file"]', { name, mimeType: "text/csv", buffer: utf8(text) });
  await page.waitForFunction(() => {
    const s = document.querySelector('[data-testid="import-summary"]');
    return s && !s.hidden && s.getAttribute("data-count") !== null;
  });
  const count = Number(await page.locator('[data-testid="import-summary"]').getAttribute("data-count"));
  await page.click('[data-testid="import-confirm"]');
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="roster-row"]').length === n, count);
  return count;
}

async function waitStable(page) {
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('[data-testid="roster-row"]')];
    if (rows.length === 0) return true;
    const key = rows.map((r) => `${r.dataset.seq}:${r.dataset.filled}:${Math.round(r.getBoundingClientRect().height * 10)}`).join("|");
    const prev = window.__stabPrev;
    window.__stabPrev = key;
    if (prev === undefined) return false;
    return prev === key;
  });
  await page.waitForFunction(() => {
    const cur = document.querySelectorAll('[data-testid="roster-row"]').length;
    const p = window.__stabN;
    window.__stabN = cur;
    return p === cur;
  });
}

const FA = ["序号,学号,姓名,成绩,班级", "1,20230101,张三,85,高一3班", "2,20230102,李四,92,高一3班", "3,20230103,王五,78,高一3班"].join("\r\n");
const FA4 = ["序号,学号,姓名,成绩,班级", "1,20230101,张三,85,高一3班", "2,20230102,李四,92,高一3班", "3,20230103,王五,78,高一3班", "4,20230104,赵六,61,高一3班"].join("\r\n");
const FB = ["序号,学号,姓名,成绩,班级", "4,20230103,王五改,70,高一4班", "3,20230102,李四,90,高一4班", "5,20230105,钱七,55,高一4班"].join("\r\n");
const FIVE = ["序号,学号,姓名,成绩,班级", "1,20230101,张三,85,高一3班", "2,20230102,李四,92,高一3班", "3,20230103,王五,78,高一3班", "4,20230104,赵六,61,高一3班", "5,20230105,钱七,55,高一3班"].join("\r\n");
const FIFTY = ["学号,姓名", ...Array.from({ length: 50 }, (_, i) => `S${i + 1},学生${i + 1}`)].join("\n");
const DUPNEW = ["序号,学号,姓名,成绩,班级", "1,20230102,李四,90,高一4班", "2,20230102,李四重,91,高一4班", "3,20230105,钱七,55,高一4班"].join("\r\n");
const DUPOLD = ["序号,学号,姓名,成绩,班级", "1,20230102,李四,90,高一4班", "2,20230102,李四重,91,高一4班"].join("\r\n");
const CUSTOM = ["编号,学生,班级,总分", "20230101,张三改,高一3班,88", "20230102,李四,高一3班,90", "20230105,钱七,高一3班,55"].join("\r\n");

// ---------- H1 ----------
let h1ok = true;
{
  try {
    const per = [];
    for (const vp of [{ w: 390, cdp: false }, { w: 320, cdp: true }]) {
      const app = await openFresh({ width: vp.w, cdp: vp.cdp });
      try {
        const { page } = app;
        await importCsv(page, "A.csv", FA);
        await libCompute(page, "+", ["12", "30", "8"]);
        await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length === 1);
        await waitStable(page);
        const info = await page.evaluate(() => {
          const rows = [...document.querySelectorAll('[data-testid="roster-row"]')].map((row) => {
            const rb = row.getBoundingClientRect();
            const box = (sel) => {
              const el = row.querySelector(sel);
              if (!el) return null;
              const b = el.getBoundingClientRect();
              return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom };
            };
            const nm = row.querySelector(".roster-name");
            const sc = row.querySelector('[data-testid="roster-score"]');
            return {
              seq: row.dataset.seq, filled: row.dataset.filled, h: rb.height,
              top: rb.top, bottom: rb.bottom, left: rb.left, right: rb.right,
              name: box(".roster-name"), score: box('[data-testid="roster-score"]'), edit: box('[data-testid="roster-edit"]'),
              fRow: parseFloat(getComputedStyle(row).fontSize),
              fName: nm ? parseFloat(getComputedStyle(nm).fontSize) : NaN,
              fScore: sc ? parseFloat(getComputedStyle(sc).fontSize) : NaN,
            };
          });
          const over = {
            doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            body: document.body.scrollWidth - document.body.clientWidth,
          };
          return { rows, over };
        });
        const filled = info.rows.filter((r) => r.filled === "true");
        const empty = info.rows.filter((r) => r.filled !== "true");
        let bad = 0;
        const why = [];
        for (const r of info.rows) {
          if (r.filled === "true" && !(r.h <= 46.0)) { bad++; why.push(`seq${r.seq}h${r.h.toFixed(1)}`); }
          if (r.filled !== "true" && !(r.h <= 38.0)) { bad++; why.push(`seq${r.seq}h${r.h.toFixed(1)}`); }
          for (const [k, b] of [["name", r.name], ["score", r.score]]) {
            if (!b || !(b.w > 0 && b.h > 0)) { bad++; why.push(`seq${r.seq}${k}area`); continue; }
            if (!(b.x >= r.left - 0.5 && b.x + b.w <= r.right + 0.5)) { bad++; why.push(`seq${r.seq}${k}inrow`); }
          }
          if (r.filled === "true" && (!r.edit || !(r.edit.w > 0 && r.edit.h > 0))) { bad++; why.push(`seq${r.seq}edit`); }
          const segs = [r.name, r.score, r.edit].filter(Boolean);
          for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
            const a = segs[i], b = segs[j];
            const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
            const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
            if (overlapX > 0.5 && overlapY > 0.5) { bad++; why.push(`seq${r.seq}overlap${i}${j}`); }
          }
          for (const f of [r.fRow, r.fName, r.fScore]) if (!(f >= 12.5)) { bad++; why.push(`seq${r.seq}font${f}`); }
        }
        if (!(info.over.doc <= 1 && info.over.body <= 1)) { bad++; why.push(`over${JSON.stringify(info.over)}`); }
        per.push({ w: vp.w, heights: info.rows.map((r) => `${r.seq}:${r.filled}:${Math.round(r.h * 10) / 10}`).join(","), bad, why: why.slice(0, 6).join(";"), over: info.over });
        if (bad !== 0 || filled.length !== 1 || empty.length !== 2) h1ok = false;
      } finally { await app.close(); }
    }
    // 50 empty rows
    {
      const app = await openFresh({ width: 390 });
      try {
        await importCsv(app.page, "fifty.csv", FIFTY);
        await waitStable(app.page);
        const sh = await app.page.evaluate(() => document.documentElement.scrollHeight);
        per.push({ fiftyScroll: sh });
        if (!(sh <= 2800)) h1ok = false;
      } finally { await app.close(); }
    }
    // 5 persons record 2, re-read heights
    {
      const app = await openFresh({ width: 390 });
      try {
        await importCsv(app.page, "five.csv", FIVE);
        await libCompute(app.page, "+", ["12", "30", "8"]);
        await libCompute(app.page, "+", ["9", "1"]);
        await app.page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length === 2);
        await waitStable(app.page);
        const hs = await app.page.$$eval('[data-testid="roster-row"]', (rows) => rows.map((r) => `${r.dataset.seq}:${r.dataset.filled}:${Math.round(r.getBoundingClientRect().height * 10) / 10}`).join(","));
        per.push({ five2: hs });
        const vals = await app.page.$$eval('[data-testid="roster-row"]', (rows) => rows.map((r) => ({ f: r.dataset.filled, h: r.getBoundingClientRect().height })));
        if (!(vals.filter((v) => v.f === "true").every((v) => v.h <= 46.0) && vals.filter((v) => v.f !== "true").every((v) => v.h <= 38.0))) h1ok = false;
      } finally { await app.close(); }
    }
    rec("H1", h1ok, JSON.stringify(per).slice(0, 1100));
  } catch (e) { rec("H1", false, `throw ${String(e && e.message || e).slice(0, 400)}`); h1ok = false; }
}

// ---------- H2 ----------
let h2ok = true;
{
  try {
    const ev = [];
    const app = await openFresh({ width: 390 });
    try {
      const { page } = app;
      await importCsv(page, "A4.csv", FA4);
      await libCompute(page, "+", ["1", "2"]);
      await libCompute(page, "+", ["3", "4"]);
      await page.click('[data-testid="roster-import"]');
      await page.waitForSelector('[data-testid="import-dialog"][open]');
      await page.setInputFiles('[data-testid="roster-file"]', { name: "B.csv", mimeType: "text/csv", buffer: utf8(FB) });
      await page.waitForFunction(() => {
        const s = document.querySelector('[data-testid="import-summary"]');
        return s && !s.hidden && s.getAttribute("data-count") !== null;
      });
      await page.waitForFunction(() => !document.querySelector('[data-testid="import-mode"]').hidden);
      const sizes = await page.evaluate(() => {
        const r = (el) => { const b = el.getBoundingClientRect(); return [Math.round(b.width * 10) / 10, Math.round(b.height * 10) / 10]; };
        return {
          keepLabel: r(document.querySelector('[data-testid="import-mode-keep"]').closest("label")),
          keepRadio: r(document.querySelector('[data-testid="import-mode-keep"]')),
          fieldset: r(document.querySelector('[data-testid="import-mode"]')),
          keepText: document.querySelector('[data-testid="import-mode-keep-label"]').textContent,
          mode: document.querySelector('[data-testid="import-dialog"]').dataset.mode,
          keepChecked: document.querySelector('[data-testid="import-mode-keep"]').checked,
        };
      });
      ev.push({ sizes });
      if (!(sizes.keepLabel[1] <= 42.0 && sizes.keepRadio[0] <= 31.0 && sizes.keepRadio[1] <= 31.0 && sizes.keepRadio[0] >= 28 && sizes.keepRadio[1] >= 28 && sizes.fieldset[1] <= 120.0)) h2ok = false;
      if (!(sizes.keepText.includes("保留") && sizes.keepText.includes("命中") && sizes.keepChecked === true)) h2ok = false;
      // click keep label text area (right side of label)
      await page.evaluate(() => {
        const radio = document.querySelector('[data-testid="import-mode-clear"]');
        radio.checked = true;
        radio.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.waitForFunction(() => document.querySelector('[data-testid="import-mode-clear"]').checked === true);
      await page.locator('[data-testid="import-mode-keep-label"]').click();
      await page.waitForFunction(() => document.querySelector('[data-testid="import-mode-keep"]').checked === true);
      const afterKeep = await page.evaluate(() => ({
        keep: document.querySelector('[data-testid="import-mode-keep"]').checked,
        confirm: document.querySelector('[data-testid="import-confirm"]').textContent,
      }));
      ev.push({ afterKeep });
      if (!(afterKeep.keep === true && afterKeep.confirm.includes("保留"))) h2ok = false;
      // click clear radio center
      await page.locator('[data-testid="import-mode-clear"]').click();
      await page.waitForFunction(() => document.querySelector('[data-testid="import-mode-clear"]').checked === true);
      const afterClear = await page.evaluate(() => ({
        clear: document.querySelector('[data-testid="import-mode-clear"]').checked,
        confirm: document.querySelector('[data-testid="import-confirm"]').textContent,
      }));
      ev.push({ afterClear });
      if (!(afterClear.clear === true && afterClear.confirm.includes("清空"))) h2ok = false;
      await page.click('[data-testid="import-cancel"]');
    } finally { await app.close(); }
    // 320 repeat
    {
      const app2 = await openFresh({ width: 320, cdp: true });
      try {
        const { page } = app2;
        await importCsv(page, "A4.csv", FA4);
        await libCompute(page, "+", ["1", "2"]);
        await libCompute(page, "+", ["3", "4"]);
        await page.click('[data-testid="roster-import"]');
        await page.waitForSelector('[data-testid="import-dialog"][open]');
        await page.setInputFiles('[data-testid="roster-file"]', { name: "B.csv", mimeType: "text/csv", buffer: utf8(FB) });
        await page.waitForFunction(() => {
          const s = document.querySelector('[data-testid="import-summary"]');
          return s && !s.hidden && s.getAttribute("data-count") !== null && !document.querySelector('[data-testid="import-mode"]').hidden;
        });
        const st = await page.evaluate(() => ({
          keep: document.querySelector('[data-testid="import-mode-keep"]').checked,
          mode: document.querySelector('[data-testid="import-dialog"]').dataset.mode,
          confirm: document.querySelector('[data-testid="import-confirm"]').textContent,
        }));
        ev.push({ narrow320: st });
        if (!(st.keep === true && st.mode === "keep")) h2ok = false;
        await page.locator('[data-testid="import-mode-clear"]').click();
        await page.waitForFunction(() => document.querySelector('[data-testid="import-mode-clear"]').checked === true);
        await page.click('[data-testid="import-cancel"]');
      } finally { await app2.close(); }
    }
    // dup new-side
    {
      const app3 = await openFresh({ width: 390 });
      try {
        const { page } = app3;
        await importCsv(page, "A4.csv", FA4);
        await libCompute(page, "+", ["1", "2"]);
        await page.click('[data-testid="roster-import"]');
        await page.waitForSelector('[data-testid="import-dialog"][open]');
        await page.setInputFiles('[data-testid="roster-file"]', { name: "dup.csv", mimeType: "text/csv", buffer: utf8(DUPNEW) });
        await page.waitForFunction(() => {
          const s = document.querySelector('[data-testid="import-summary"]');
          return s && !s.hidden && s.getAttribute("data-count") !== null;
        });
        await page.waitForFunction(() => document.querySelector('[data-testid="import-warning"]') && !document.querySelector('[data-testid="import-warning"]').hidden);
        const st = await page.evaluate(() => ({
          hasKeep: document.querySelector('[data-testid="import-mode-keep"]').closest("label").style.display !== "none",
          mode: document.querySelector('[data-testid="import-dialog"]').dataset.mode,
          clear: document.querySelector('[data-testid="import-mode-clear"]').checked,
          warn: document.querySelector('[data-testid="import-warning"]').textContent,
        }));
        ev.push({ dupNew: st });
        if (!(st.hasKeep === false && st.mode === "clear" && st.clear === true && st.warn.includes("重复"))) h2ok = false;
        await page.click('[data-testid="import-cancel"]');
      } finally { await app3.close(); }
    }
    // dup old-side
    {
      const app4 = await openFresh({ width: 390 });
      try {
        const { page } = app4;
        await importCsv(page, "dup.csv", DUPOLD);
        await libCompute(page, "+", ["1", "2"]);
        await page.click('[data-testid="roster-import"]');
        await page.waitForSelector('[data-testid="import-dialog"][open]');
        await page.setInputFiles('[data-testid="roster-file"]', { name: "A.csv", mimeType: "text/csv", buffer: utf8(FA) });
        await page.waitForFunction(() => {
          const s = document.querySelector('[data-testid="import-summary"]');
          return s && !s.hidden && s.getAttribute("data-count") !== null;
        });
        await page.waitForFunction(() => document.querySelector('[data-testid="import-warning"]') && !document.querySelector('[data-testid="import-warning"]').hidden);
        const st = await page.evaluate(() => ({
          hasKeep: document.querySelector('[data-testid="import-mode-keep"]').closest("label").style.display !== "none",
          mode: document.querySelector('[data-testid="import-dialog"]').dataset.mode,
          clear: document.querySelector('[data-testid="import-mode-clear"]').checked,
          warn: document.querySelector('[data-testid="import-warning"]').textContent,
        }));
        ev.push({ dupOld: st });
        if (!(st.hasKeep === false && st.mode === "clear" && st.clear === true)) h2ok = false;
        await page.click('[data-testid="import-cancel"]');
      } finally { await app4.close(); }
    }
    rec("H2", h2ok, JSON.stringify(ev).slice(0, 1100));
  } catch (e) { rec("H2", false, `throw ${String(e && e.message || e).slice(0, 400)}`); h2ok = false; }
}

// ---------- H3 ----------
let h3ok = true;
{
  try {
    const ev = [];
    const snap = (page) => page.evaluate(() => ({
      next: document.querySelector('[data-testid="roster-next"]')?.dataset.seq ?? null,
      filled: [...document.querySelectorAll('[data-testid="roster-row"]')].map((r) => r.dataset.filled),
      scores: [...document.querySelectorAll('[data-testid="roster-score"]')].map((el) => el.textContent),
      label: document.querySelector("#state-label").textContent,
      state: document.querySelector("main.app").dataset.state,
      input: document.querySelector('[data-testid="calc-input"]').value,
      result: document.querySelector('[data-testid="result"]').textContent,
      expr: document.querySelector('[data-testid="expression"]').textContent,
      hist: document.querySelectorAll('[data-testid="history-item"]').length,
      stored: localStorage.getItem("cal-phone.roster.v1"),
    }));
    // main skip chain
    {
      const app = await openFresh({ width: 390 });
      try {
        const { page } = app;
        await importCsv(page, "A.csv", FA);
        const before = await snap(page);
        await page.click('[data-testid="key-equals"]');
        const s1 = await snap(page);
        ev.push({ s1: { next: s1.next, label: s1.label } });
        if (!(s1.next === "2" && s1.label.includes("跳过") && s1.label.includes("2"))) h3ok = false;
        if (!(s1.stored === before.stored && s1.filled.every((f) => f === "false") && s1.hist === before.hist && s1.result === before.result && s1.expr === before.expr)) h3ok = false;
        await page.click('[data-testid="key-equals"]');
        const s2 = await snap(page);
        ev.push({ s2: { next: s2.next, label: s2.label } });
        if (!(s2.next === "3" && s2.label.includes("跳过"))) h3ok = false;
        await page.click('[data-testid="key-equals"]');
        const s3 = await snap(page);
        ev.push({ s3: { next: s3.next, label: s3.label } });
        if (!(s3.next === "1" && s3.label.includes("跳过"))) h3ok = false;
        await page.keyboard.press("=");
        const s4 = await snap(page);
        ev.push({ s4: { next: s4.next, label: s4.label } });
        if (!(s4.next === "2")) h3ok = false;
        await libCompute(page, "+", ["10", "20"]);
        const w = await page.evaluate(() => ({
          seq1: document.querySelector('[data-testid="roster-row"][data-seq="1"]').dataset.filled,
          seq2: document.querySelector('[data-testid="roster-row"][data-seq="2"]').dataset.filled,
          next: document.querySelector('[data-testid="roster-next"]')?.dataset.seq ?? null,
        }));
        ev.push({ writeAfterSkip: w });
        if (!(w.seq1 === "false" && w.seq2 === "true" && w.next === "3")) h3ok = false;
      } finally { await app.close(); }
    }
    // negative chain
    {
      const app = await openFresh({ width: 390 });
      try {
        const { page } = app;
        await importCsv(page, "A.csv", FA);
        await libCompute(page, "+", ["1", "1"]);
        await page.click('[data-testid="roster-import"]');
        await page.waitForSelector('[data-testid="import-dialog"][open]');
        await page.click('[data-testid="import-cancel"]');
        // record remaining to full
        await libCompute(page, "+", ["2", "2"]);
        await libCompute(page, "+", ["3", "3"]);
        const nx = await page.evaluate(() => document.querySelector('[data-testid="roster-next"]')?.dataset.seq ?? null);
        const storedFull = await page.evaluate(() => localStorage.getItem("cal-phone.roster.v1"));
        await page.click('[data-testid="key-equals"]');
        const fullAfter = await snap(page);
        ev.push({ fullNext: nx, fullLabel: fullAfter.label });
        if (!(nx === null && fullAfter.label.includes("名单已录满") && fullAfter.stored === storedFull)) h3ok = false;
        // reload then single-operand type 5
        await page.reload({ waitUntil: "load" });
        await page.waitForSelector('[data-testid="roster-row"]');
        await page.click('[data-testid="op-picker"] [data-op="+"]');
        await page.click('[data-testid="keypad"] [data-key="5"]');
        await page.click('[data-testid="key-equals"]');
        const typed = await page.evaluate(() => ({
          seq1: document.querySelector('[data-testid="roster-row"][data-seq="1"]').dataset.filled,
          label: document.querySelector("#state-label").textContent,
        }));
        ev.push({ typed });
        if (!(!typed.label.includes("跳过"))) h3ok = false;
        // edit mode: = saves draft
        await page.locator('[data-testid="roster-row"][data-seq="1"] [data-testid="roster-edit"]').click();
        await page.waitForSelector('[data-testid="edit-draft"]:not([hidden])');
        await page.click('[data-testid="key-equals"]');
        const editAfter = await page.evaluate(() => ({
          state: document.querySelector("main.app").dataset.state,
          label: document.querySelector("#state-label").textContent,
        }));
        ev.push({ editAfter });
        if (!(!editAfter.label.includes("跳过"))) h3ok = false;
      } finally { await app.close(); }
    }
    // record-then-skip next=2
    {
      const app = await openFresh({ width: 390 });
      try {
        const { page } = app;
        await importCsv(page, "A.csv", FA);
        await libCompute(page, "+", ["1", "2"]);
        const afterRec = await snap(page);
        ev.push({ recSkipRec: { next: afterRec.next } });
        if (!(afterRec.next === "2")) h3ok = false;
        await page.click('[data-testid="key-equals"]');
        const s = await snap(page);
        ev.push({ recSkip: { next: s.next, label: s.label } });
        if (!(s.next === "3" && s.label.includes("跳过"))) h3ok = false;
      } finally { await app.close(); }
    }
    // +,10,Enter,= normal fill in fresh ctx
    {
      const app = await openFresh({ width: 390 });
      try {
        const { page } = app;
        await importCsv(page, "A.csv", FA);
        await page.click('[data-testid="op-picker"] [data-op="+"]');
        await page.click('[data-testid="keypad"] [data-key="1"]');
        await page.click('[data-testid="keypad"] [data-key="0"]');
        await page.click('[data-testid="keypad"] [data-key="enter"]');
        await page.click('[data-testid="key-equals"]');
        const s = await snap(page);
        const rows10 = await libRosterRows(page);
        ev.push({ plus10: { filled: s.filled, label: s.label, score0: rows10[0]?.score } });
        if (!(s.filled.filter((f) => f === "true").length === 1 && !s.label.includes("跳过") && rows10[0]?.score === "10")) h3ok = false;
      } finally { await app.close(); }
    }
    // no roster empty =
    {
      const app = await openFresh({ width: 390 });
      try {
        const { page } = app;
        const b = await snap(page);
        await page.click('[data-testid="key-equals"]');
        const a = await snap(page);
        ev.push({ noroster: { rows: a.filled.length, next: a.next, storedNull: a.stored === null, sameLabel: a.label === b.label, sameResult: a.result === b.result, sameExpr: a.expr === b.expr, sameHist: a.hist === b.hist } });
        if (!(a.filled.length === 0 && a.next === null && a.stored === null && a.label === b.label && a.result === b.result && a.expr === b.expr && a.hist === b.hist)) h3ok = false;
      } finally { await app.close(); }
    }
    // import, skip, reload -> next 1
    {
      const app = await openFresh({ width: 390 });
      try {
        const { page } = app;
        await importCsv(page, "A.csv", FA);
        await page.click('[data-testid="key-equals"]');
        const s1 = await snap(page);
        await page.reload({ waitUntil: "load" });
        await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"]').length === 3);
        const s2 = await snap(page);
        ev.push({ reloadSkip: { before: s1.next, after: s2.next } });
        if (!(s1.next === "2" && s2.next === "1")) h3ok = false;
      } finally { await app.close(); }
    }
    rec("H3", h3ok, JSON.stringify(ev).slice(0, 1100));
  } catch (e) { rec("H3", false, `throw ${String(e && e.message || e).slice(0, 400)}`); h3ok = false; }
}

// ---------- H4 ----------
let h4ok = true;
{
  try {
    const ev = [];
    const frozen = {
      "tests/scenarios/core.mjs": "2b35cce880e336882e384e940d28b103acc270a7931552dea5d5c9c79c9eeb7e",
      "tests/scenarios/continuity.mjs": "d53f1a4ce357bb200a4e811aa45d3dad187d40279c5f747c7ebb38c28e810a56",
      "tests/scenarios/edit.mjs": "f61188e63586e8afa2883f6db3d3e88f7cc216a9a0c8dc7d465953ad37ceadc1",
      "tests/scenarios/layout.mjs": "c96ed96499a18b9731a8e10dabb579a761d445534105caabfa7424803def65a0",
      "tests/scenarios/determinism.mjs": "64bc09c49ac56c21aef77bdd1a7f7c365b8791d0690076f5964b58f06e69ddff",
    };
    for (const [rel, want] of Object.entries(frozen)) {
      const got = shaHex(fs.readFileSync(path.join(REPO, rel)));
      ev.push({ [rel]: got.slice(0, 12) });
      if (got !== want) h4ok = false;
    }
    // full runSuite
    const { runSuite } = await import("/ws/cal_phone/tests/suite.mjs");
    const t0 = Date.now();
    const suiteResults = await runSuite({ artifact: ARTIFACT });
    const suiteMs = Date.now() - t0;
    const allPass = suiteResults.every((r) => r.pass === true);
    const hasCompact = suiteResults.some((r) => r.id === "roster-compact");
    ev.push({ suite: `${suiteResults.length}scenarios allPass=${allPass} hasCompact=${hasCompact} ms=${suiteMs}` });
    if (!(allPass && hasCompact)) h4ok = false;
    // roster-layout diff scope
    const layoutDiff = spawnSync("git", ["-C", REPO, "diff", "--", "tests/scenarios/roster-layout.mjs"], { encoding: "utf8", timeout: 60000 });
    const layoutChanged = String(layoutDiff.stdout || "").split("\n").filter((l) => (l.startsWith("+") && !l.startsWith("+++")) || (l.startsWith("-") && !l.startsWith("---")));
    const layoutOkLines = layoutChanged.every((l) => /43\.5|28\.0|rect\[0\]|rect\[1\]/.test(l));
    const layoutSrc = fs.readFileSync(path.join(REPO, "tests/scenarios/roster-layout.mjs"), "utf8");
    const layoutNamesKept = ["preview-controls", "mixed-controls", "preview-fonts", "selects-vertical", "focus-return", "mixed-overflow", "fifty-overflow"].every((n) => layoutSrc.includes(n));
    ev.push({ layoutChanged: layoutChanged.length, layoutOkLines, layoutNamesKept });
    if (!(layoutOkLines && layoutNamesKept && layoutChanged.length <= 4)) h4ok = false;
    // voice/run.mjs diff scope
    const voiceDiff = spawnSync("git", ["-C", REPO, "diff", "--", "tests/voice/run.mjs"], { encoding: "utf8", timeout: 60000 });
    const voiceChanged = String(voiceDiff.stdout || "").split("\n").filter((l) => (l.startsWith("+") && !l.startsWith("+++")) || (l.startsWith("-") && !l.startsWith("---")));
    const voiceOkLines = voiceChanged.every((l) => /regression\.scenarios|regression\.checks|results\.length|scenarioChecks\.length|29|30|507|538/.test(l));
    const voiceSrc = fs.readFileSync(path.join(REPO, "tests/voice/run.mjs"), "utf8");
    const voiceKept = ["regression.suite-exit", "regression.every-scenario-pass", "regression.runtime"].every((n) => voiceSrc.includes(n));
    ev.push({ voiceChanged: voiceChanged.length, voiceOkLines, voiceKept });
    if (!(voiceOkLines && voiceKept && voiceChanged.length <= 6)) h4ok = false;
    // voice suite <=2 runs
    const allowed = new Set(["result.crash", "queue.quick-no-result", "queue.quick-keys"]);
    let voiceInfo = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const run = spawnSync("node", ["voice/run.mjs", "--json", "--artifact", ARTIFACT], { cwd: path.join(REPO, "tests"), encoding: "utf8", timeout: 600000, maxBuffer: 20 * 1024 * 1024 });
      let parsed = null;
      try { parsed = JSON.parse(String(run.stdout || "").trim()); } catch { parsed = null; }
      const checks = Array.isArray(parsed?.checks) ? parsed.checks : [];
      const failed = checks.filter((c) => !c.pass);
      const regS = checks.find((c) => c.id === "regression.scenarios");
      const regC = checks.find((c) => c.id === "regression.checks");
      voiceInfo = { attempt: attempt + 1, total: checks.length, failed: failed.map((c) => c.id), regS: regS?.pass ?? null, regC: regC?.pass ?? null, status: run.status };
      const okSubset = failed.length <= 3 && failed.every((c) => allowed.has(c.id));
      if (okSubset && regS?.pass === true && regC?.pass === true) break;
      if (attempt === 1) {
        if (!(okSubset && regS?.pass === true && regC?.pass === true)) h4ok = false;
      }
    }
    ev.push({ voice: voiceInfo });
    if (!(voiceInfo && voiceInfo.regS === true && voiceInfo.regC === true && voiceInfo.failed.length <= 3 && voiceInfo.failed.every((id) => allowed.has(id)))) h4ok = false;
    rec("H4", h4ok, JSON.stringify(ev).slice(0, 1100));
  } catch (e) { rec("H4", false, `throw ${String(e && e.message || e).slice(0, 400)}`); h4ok = false; }
}

// ---------- H5 ----------
let h5ok = true;
{
  try {
    const ev = [];
    const text = fs.readFileSync(ARTIFACT, "utf8");
    const hasHtml = text.includes("</html>");
    const bytes = Buffer.byteLength(text, "utf8");
    const refs = [];
    for (const m of text.matchAll(/<(script|link|img|source)[^>]*?(?:src|href)\s*=\s*["']([^"']+)["']/gi)) refs.push(m[2]);
    for (const m of text.matchAll(/@import\s+(?:url\()?["']?([^"'\)\s;]+)/gi)) refs.push(m[1]);
    for (const m of text.matchAll(/url\(\s*["']?([^"'\)]+)["']?\s*\)/gi)) refs.push(m[1]);
    const ext = refs.filter((u) => /^(https?:)?\/\//i.test(u.trim()));
    ev.push({ html: hasHtml, bytes, refs: refs.length, ext: ext.length });
    if (!(hasHtml && bytes >= 1024 && ext.length === 0)) h5ok = false;
    // determinism: two fresh contexts same sequence
    async function seqOnce() {
      const app = await openFresh({ width: 390 });
      try {
        await importCsv(app.page, "A.csv", FA);
        await libCompute(app.page, "+", ["12", "30", "8"]);
        await libCompute(app.page, "+", ["9", "1"]);
        const rows = await libRosterRows(app.page);
        const next = await app.page.evaluate(() => document.querySelector('[data-testid="roster-next"]')?.dataset.seq ?? null);
        const stored = await app.page.evaluate(() => localStorage.getItem("cal-phone.roster.v1"));
        return { rows, next, stored };
      } finally { await app.close(); }
    }
    const r1 = await seqOnce();
    const r2 = await seqOnce();
    const same = JSON.stringify(r1) === JSON.stringify(r2);
    ev.push({ determinism: same, next: r1.next });
    if (!same) h5ok = false;
    // skip storage verbatim
    {
      const app = await openFresh({ width: 390 });
      try {
        await importCsv(app.page, "A.csv", FA);
        const b = await app.page.evaluate(() => localStorage.getItem("cal-phone.roster.v1"));
        await app.page.click('[data-testid="key-equals"]');
        const a = await app.page.evaluate(() => localStorage.getItem("cal-phone.roster.v1"));
        ev.push({ skipStoredSame: b === a });
        if (!(b === a)) h5ok = false;
      } finally { await app.close(); }
    }
    ev.push({ pageerrors: allPageErrors.length, consoleErrors: allConsoleErrors.length });
    if (!(allPageErrors.length === 0 && allConsoleErrors.length === 0)) h5ok = false;
    rec("H5", h5ok, JSON.stringify(ev).slice(0, 1100));
  } catch (e) { rec("H5", false, `throw ${String(e && e.message || e).slice(0, 400)}`); h5ok = false; }
}

// ---------- review shots S1..S4 ----------
async function shotState(key, width, cdp, setup) {
  const app = await openFresh({ width, cdp });
  try {
    const { page } = app;
    const extra = await setup(page);
    await waitStable(page);
    try { await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur()); } catch {}
    const file = path.join(SHOT_DIR, `${key}.png`);
    await page.screenshot({ path: file });
    const buf = fs.readFileSync(file);
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    const vis = await page.evaluate(() => ({
      summary: !!document.querySelector('[data-testid="roster-summary"]') && getComputedStyle(document.querySelector('[data-testid="roster-summary"]')).display !== "none",
      rows: document.querySelectorAll('[data-testid="roster-row"]').length,
      filled: document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length,
      next: document.querySelector('[data-testid="roster-next"]')?.dataset.seq ?? "none",
      label: document.querySelector("#state-label")?.textContent?.slice(0, 60) ?? "",
      overDoc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      overBody: document.body.scrollWidth - document.body.clientWidth,
      scrollH: document.documentElement.scrollHeight,
      autoconfirm: document.querySelector('[data-testid="settings-auto-confirm"]')?.value ?? "?",
      dialog: document.querySelector('[data-testid="import-dialog"]')?.open ?? false,
      mode: document.querySelector('[data-testid="import-dialog"]')?.dataset.mode ?? "",
    }));
    shotMetrics.push({ key, width: w, height: h, sha256: shaHex(buf), bytes: buf.length, ...vis, ...extra });
    return { file, buf, w, h };
  } finally { await app.close(); }
}

{
  // S1: 390 import 5 record 2, scroll roster into view
  await shotState("S1", 390, false, async (page) => {
    await importCsv(page, "five.csv", FIVE);
    await libCompute(page, "+", ["12", "30", "8"]);
    await libCompute(page, "+", ["9", "1"]);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length === 2);
    await page.evaluate(() => document.querySelector('[data-testid="roster"]').scrollIntoView({ block: "center" }));
    return { state: "s1-5p-2rec" };
  });
  // S2: 390 import 4 record 2, open import with custom fixture mapped
  await shotState("S2", 390, false, async (page) => {
    await importCsv(page, "A4.csv", FA4);
    await libCompute(page, "+", ["12", "30", "8"]);
    await libCompute(page, "+", ["9", "1"]);
    await page.click('[data-testid="roster-import"]');
    await page.waitForSelector('[data-testid="import-dialog"][open]');
    await page.setInputFiles('[data-testid="roster-file"]', { name: "custom.csv", mimeType: "text/csv", buffer: utf8(CUSTOM) });
    await page.waitForFunction(() => {
      const s = document.querySelector('[data-testid="import-summary"]');
      return s && !s.hidden && s.getAttribute("data-count") !== null;
    });
    await page.selectOption('[data-testid="import-id-column"]', "0");
    await page.selectOption('[data-testid="import-name-column"]', "1");
    await page.selectOption('[data-testid="import-score-column"]', "3");
    await page.waitForFunction(() => !document.querySelector('[data-testid="import-mode"]').hidden);
    const kda = await page.evaluate(() => ({
      keep: document.querySelector('[data-testid="import-summary"]').dataset.keepCount,
      drop: document.querySelector('[data-testid="import-summary"]').dataset.dropCount,
      added: document.querySelector('[data-testid="import-summary"]').dataset.newCount,
      selects: document.querySelectorAll('[data-testid="import-map"] select').length,
      cols: document.querySelectorAll('[data-testid="import-columns"] .import-chip').length,
      preview: document.querySelectorAll('[data-testid="import-preview"] .import-preview-row').length,
    }));
    await page.evaluate(() => document.querySelector('[data-testid="import-dialog"]').scrollIntoView?.());
    return { state: "s2-custom-map", ...kda };
  });
  // S3: 320 CDP import 5 record 1 skip 2nd
  await shotState("S3", 320, true, async (page) => {
    await importCsv(page, "five.csv", FIVE);
    await libCompute(page, "+", ["5", "5"]);
    await page.click('[data-testid="key-equals"]');
    await page.waitForFunction(() => (document.querySelector("#state-label")?.textContent ?? "").includes("跳过"));
    await page.evaluate(() => document.querySelector('[data-testid="roster"]').scrollIntoView({ block: "center" }));
    return { state: "s3-skip2" };
  });
  // S4: 390 import 50 record 3, scroll roster
  await shotState("S4", 390, false, async (page) => {
    await importCsv(page, "fifty.csv", FIFTY);
    await libCompute(page, "+", ["1", "1"]);
    await libCompute(page, "+", ["2", "2"]);
    await libCompute(page, "+", ["3", "3"]);
    await page.evaluate(() => document.querySelector('[data-testid="roster-list"]').scrollIntoView({ block: "start" }));
    return { state: "s4-50p-3rec" };
  });
}

// shots hygiene: non-empty, non-solid, distinct, >=240x160
{
  const files = ["S1", "S2", "S3", "S4"].map((k) => path.join(SHOT_DIR, `${k}.png`));
  const bufs = files.map((f) => fs.readFileSync(f));
  const hashes = bufs.map(shaHex);
  const distinct = new Set(hashes).size === 4;
  const sizesOk = shotMetrics.every((m) => m.width >= 240 && m.height >= 160 && m.bytes > 8000);
  const varied = bufs.every((b) => new Set(b.slice(0, 4000)).size > 60);
  if (!(distinct && sizesOk && varied)) {
    const i = results.findIndex((r) => r.id === "H5");
    if (i >= 0) { results[i] = { id: "H5", pass: false, detail: `${results[i].detail} shots(distinct=${distinct},sizes=${sizesOk},varied=${varied})` }; h5ok = false; }
  }
}

// ---------- write outputs ----------
const lines = [];
lines.push(`ROUND: ${ROUND}`);
lines.push(`ARTIFACT_SHA256: ${artifactSha}`);
lines.push(`VERIFIER_SHA256: ${verifierSha}`);
const order = ["H1", "H2", "H3", "H4", "H5"];
for (const id of order) {
  const r = results.find((x) => x.id === id);
  lines.push(`${id} ${r && r.pass ? "PASS" : "FAIL"} — ${r ? r.detail : "missing"}`);
}
const failed = order.filter((id) => { const r = results.find((x) => x.id === id); return !(r && r.pass); });
lines.push(failed.length === 0 ? "HARD: PASS" : `HARD: FAIL (${failed.join(",")})`);
fs.writeFileSync(path.join(OUT, `hard-r${ROUND}.txt`), lines.join("\n") + "\n");

const renderLines = [];
renderLines.push(`ROUND: ${ROUND}`);
renderLines.push(`ARTIFACT_SHA256: ${artifactSha}`);
renderLines.push(`VERIFIER_SHA256: ${verifierSha}`);
for (const m of shotMetrics) {
  for (const [k, v] of Object.entries(m)) renderLines.push(`${m.key}.${k}=${typeof v === "string" ? v.replace(/\n/g, " ").slice(0, 160) : v}`);
}
const renderBody = renderLines.join("\n") + "\n";
fs.writeFileSync(path.join(OUT, `render-r${ROUND}.txt`), renderBody);
const metricsSha = shaHex(fs.readFileSync(path.join(OUT, `render-r${ROUND}.txt`)));

function pngSize(buf) { return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }; }
const manifest = {
  round: ROUND,
  artifact_sha256: artifactSha,
  verifier_sha256: verifierSha,
  metrics_sha256: metricsSha,
  shots: ["S1", "S2", "S3", "S4"].map((k) => {
    const buf = fs.readFileSync(path.join(SHOT_DIR, `${k}.png`));
    const { width, height } = pngSize(buf);
    return { file: `${k}.png`, sha256: shaHex(buf), width, height };
  }),
  adhoc: [],
};
fs.writeFileSync(path.join(OUT, `manifest-r${ROUND}.json`), JSON.stringify(manifest, null, 2) + "\n");

await browser.close();
console.log(lines.join("\n"));
