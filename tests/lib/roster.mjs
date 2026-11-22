import fs from "node:fs";
import { execFileSync } from "node:child_process";

export const ROSTER_KEY = "cal-phone.roster.v1";

export function utf8(text, bom = false) {
  return Buffer.from(`${bom ? "﻿" : ""}${text}`, "utf8");
}

export function gbk(text) {
  return execFileSync(
    "python3",
    ["-c", "import sys;sys.stdout.buffer.write(sys.stdin.buffer.read().decode('utf-8').encode('gbk'))"],
    { input: Buffer.from(text, "utf8") },
  );
}

export async function enterNumber(page, value) {
  for (const character of String(value)) {
    await page.click(`[data-testid="keypad"] [data-key="${character}"]`);
  }
  await page.click('[data-testid="keypad"] [data-key="enter"]');
}

export async function compute(page, operator, values) {
  await page.click(`[data-testid="op-picker"] [data-op="${operator}"]`);
  for (const value of values) {
    await enterNumber(page, value);
  }
  await page.click('[data-testid="key-equals"]');
}

export async function openImport(page) {
  await page.click('[data-testid="roster-import"]');
  await page.waitForSelector('[data-testid="import-dialog"][open]');
}

export async function waitPreview(page) {
  await page.waitForFunction(() => {
    const summary = document.querySelector('[data-testid="import-summary"]');
    return summary && !summary.hidden && summary.getAttribute("data-count") !== null;
  });
}

export async function importBuffer(page, { name, buffer }) {
  await openImport(page);
  await page.setInputFiles('[data-testid="roster-file"]', { name, mimeType: "text/csv", buffer });
  await waitPreview(page);
  const count = Number(await page.locator('[data-testid="import-summary"]').getAttribute("data-count"));
  await page.click('[data-testid="import-confirm"]');
  await page.waitForFunction(
    (expected) => document.querySelectorAll('[data-testid="roster-row"]').length === expected,
    count,
  );
  return count;
}

export async function importText(page, name, text, { bom = false } = {}) {
  return importBuffer(page, { name, buffer: utf8(text, bom) });
}

export async function importPaste(page, text) {
  await openImport(page);
  await page.click('[data-testid="import-paste"]');
  await page.waitForSelector('[data-testid="import-paste-text"]:not([hidden])');
  await page.fill('[data-testid="import-paste-text"]', text);
  await page.click('[data-testid="import-paste-parse"]');
  await waitPreview(page);
  const count = Number(await page.locator('[data-testid="import-summary"]').getAttribute("data-count"));
  await page.click('[data-testid="import-confirm"]');
  await page.waitForFunction(
    (expected) => document.querySelectorAll('[data-testid="roster-row"]').length === expected,
    count,
  );
  return count;
}

export async function rosterRows(page) {
  return page.$$eval('[data-testid="roster-row"]', (rows) =>
    rows.map((row) => {
      const score = row.querySelector('[data-testid="roster-score"]');
      const expression = row.querySelector('[data-testid="roster-expression"]');
      const edit = row.querySelector('[data-testid="roster-edit"]');
      return {
        seq: row.getAttribute("data-seq"),
        filled: row.getAttribute("data-filled"),
        name: row.getAttribute("data-name"),
        id: row.getAttribute("data-id"),
        next: row.getAttribute("data-next"),
        score: score ? (score.getAttribute("data-value") ?? score.textContent.trim()) : null,
        expression: expression ? expression.textContent.trim() : "",
        editLabel: edit ? edit.getAttribute("aria-label") : null,
      };
    }),
  );
}

export async function readDownload(page, action) {
  const [download] = await Promise.all([page.waitForEvent("download"), action()]);
  const filePath = await download.path();
  return {
    name: download.suggestedFilename(),
    buffer: fs.readFileSync(filePath),
    text: fs.readFileSync(filePath).toString("utf8"),
  };
}

export function parseCsv(text) {
  const input = text.replace(/^﻿/, "");
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
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
