#!/usr/bin/env node
// Evidence runner for the roster two-line rows change.
// Renders the app at 320x568 and 390x844 with 4-character names plus a
// 50-row roster at both widths, then writes:
//   assets/320.png, assets/390.png, metrics.json, dom.html, checks.log
//   green.log (roster-two-line + roster-compact suite run)
//   suite.log (full shared suite run)
// into <repo>/_bmad-output/initiative-roster-score-list/evidence/roster-two-line-rows
// (overridable with --out <dir>). red.log stays as archived by the red phase.
// Exits non-zero when any evidence check, the green run, or the suite fails.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchBrowser, openApp } from "../lib/browser.mjs";
import { check, clean } from "../lib/check.mjs";
import { compute, importText } from "../lib/roster.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const DEFAULT_OUT = path.join(REPO, "_bmad-output/initiative-roster-score-list/evidence/roster-two-line-rows");

const FIXTURE = [
  "序号,学号,姓名,成绩,班级",
  "1,20230101,欧阳娜娜,85,高一3班",
  "2,2023-2024-0001,司马相如,92,高一3班",
  "3,20230103,慕容雪村,78,高一3班",
].join("\r\n");

function parseArgs(argv) {
  const options = { out: DEFAULT_OUT, artifact: path.join(REPO, "index.html"), skipSuite: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") options.out = path.resolve(argv[++index]);
    else if (arg === "--artifact") options.artifact = path.resolve(argv[++index]);
    else if (arg === "--skip-suite") options.skipSuite = true;
    else {
      console.error(`unknown option: ${arg}`);
      process.exit(2);
    }
  }
  return options;
}

function runSuite(args, artifact) {
  const run = spawnSync("node", ["tests/suite.mjs", "--artifact", artifact, ...args], {
    cwd: REPO,
    encoding: "utf8",
    timeout: 900000,
    maxBuffer: 20 * 1024 * 1024,
  });
  const output = `${run.stdout || ""}${run.stderr || ""}`.trim();
  const status = typeof run.status === "number" ? run.status : 2;
  return { output, status };
}

async function measure(page) {
  const rows = await page.evaluate(() => {
    const range = document.createRange();
    const rectOf = (element) => {
      const box = element.getBoundingClientRect();
      return {
        top: Math.round(box.top * 10) / 10,
        bottom: Math.round(box.bottom * 10) / 10,
        left: Math.round(box.left * 10) / 10,
        right: Math.round(box.right * 10) / 10,
        width: Math.round(box.width * 10) / 10,
        height: Math.round(box.height * 10) / 10,
      };
    };
    const clipOf = (element) => {
      if (!element) return null;
      const style = getComputedStyle(element);
      range.selectNodeContents(element);
      const text = range.getBoundingClientRect();
      const contentWidth =
        element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return {
        text: Math.round(text.width * 10) / 10,
        box: Math.round(contentWidth * 10) / 10,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
      };
    };
    return [...document.querySelectorAll('[data-testid="roster-row"]')].map((row) => {
      const top = row.querySelector(".roster-top");
      const bottom = row.querySelector(".roster-bottom");
      const pick = (selector) => row.querySelector(selector);
      const identity = row.querySelector(".roster-identity");
      return {
        seq: row.dataset.seq,
        filled: row.dataset.filled,
        row: rectOf(row),
        top: top ? rectOf(top) : null,
        topDisplay: top ? getComputedStyle(top).display : null,
        bottom: bottom ? rectOf(bottom) : null,
        bottomDisplay: bottom ? getComputedStyle(bottom).display : null,
        topKids: top ? [...top.children].map((element) => element.className) : [],
        identityKids: identity ? [...identity.children].map((element) => element.className) : [],
        identityWrap: identity ? getComputedStyle(identity).flexWrap : null,
        name: pick(".roster-name") ? rectOf(pick(".roster-name")) : null,
        nameText: pick(".roster-name") ? pick(".roster-name").textContent : null,
        idBox: pick(".roster-id") ? rectOf(pick(".roster-id")) : null,
        idText: pick(".roster-id") ? pick(".roster-id").textContent : null,
        nameClip: clipOf(pick(".roster-name")),
        idClip: clipOf(pick(".roster-id")),
        score: pick('[data-testid="roster-score"]') ? rectOf(pick('[data-testid="roster-score"]')) : null,
        scoreText: pick('[data-testid="roster-score"]') ? pick('[data-testid="roster-score"]').textContent : null,
        expression: pick('[data-testid="roster-expression"]')
          ? rectOf(pick('[data-testid="roster-expression"]'))
          : null,
        edit: pick('[data-testid="roster-edit"]') ? rectOf(pick('[data-testid="roster-edit"]')) : null,
        nextBadge: pick(".roster-next-badge") ? rectOf(pick(".roster-next-badge")) : null,
      };
    });
  });
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  return { rows, overflow };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  fs.mkdirSync(path.join(options.out, "assets"), { recursive: true });

  const browser = await launchBrowser();
  const checks = [];
  const metrics = {
    artifact: options.artifact,
    fixture: "4-char names + long id",
    fiftyFixture: "50 rows: S1..S50 / 学生1..学生50",
    viewports: {},
  };
  let domHtml = "";
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
      const label = viewport.width === 390 ? "wide" : "narrow";
      const app = await openApp(browser, options.artifact, { viewport, isMobile: true, hasTouch: true });
      try {
        const { page } = app;
        await importText(page, "two-line.csv", FIXTURE);
        await compute(page, "+", ["12", "30"]);
        await page.screenshot({ path: path.join(options.out, `assets/${viewport.width}.png`), fullPage: true });

        const { rows, overflow } = await measure(page);
        metrics.viewports[viewport.width] = {
          viewport,
          overflow,
          rowHeights: rows.map((row) => ({ seq: row.seq, filled: row.filled, h: row.row.height })),
          rows,
        };
        if (viewport.width === 320) {
          domHtml = await page.evaluate(() => document.querySelector('[data-testid="roster"]').outerHTML);
        }

        const stacked = rows.map((row) => ({
          seq: row.seq,
          ok:
            row.top !== null &&
            row.bottom !== null &&
            row.top.height > 0 &&
            row.bottom.height > 0 &&
            row.bottom.top >= row.top.bottom - 0.5,
        }));
        check(checks, `evidence.${label}.stacked`, rows.length === 3 && stacked.every((row) => row.ok), JSON.stringify(stacked));
        check(
          checks,
          `evidence.${label}.no-ellipsis`,
          rows.every(
            (row) =>
              row.nameClip &&
              row.nameClip.textOverflow !== "ellipsis" &&
              row.nameClip.whiteSpace !== "nowrap" &&
              (row.idClip === null || (row.idClip.textOverflow !== "ellipsis" && row.idClip.whiteSpace !== "nowrap")),
          ),
          JSON.stringify(rows.map((row) => ({ seq: row.seq, nameClip: row.nameClip, idClip: row.idClip }))),
        );
        check(
          checks,
          `evidence.${label}.no-clip`,
          rows.every(
            (row) =>
              row.nameClip &&
              row.nameClip.text <= row.nameClip.box + 1.0 &&
              (row.idClip === null || row.idClip.text <= row.idClip.box + 1.0),
          ),
          JSON.stringify(rows.map((row) => ({ seq: row.seq, nameText: row.nameText, nameClip: row.nameClip, idText: row.idText, idClip: row.idClip }))),
        );
        check(
          checks,
          `evidence.${label}.line2-below`,
          rows.every((row) => row.score && row.name && row.score.top >= row.name.bottom - 1.0),
          JSON.stringify(rows.map((row) => ({ seq: row.seq, nameBottom: row.name && row.name.bottom, scoreTop: row.score && row.score.top }))),
        );
        const filled = rows.filter((row) => row.filled === "true");
        const empty = rows.filter((row) => row.filled !== "true");
        check(
          checks,
          `evidence.${label}.heights`,
          filled.length === 1 &&
            filled.every((row) => row.row.height >= 50.0 && row.row.height <= 140.0) &&
            empty.length === 2 &&
            empty.every((row) => row.row.height >= 42.0 && row.row.height <= 120.0),
          JSON.stringify(rows.map((row) => ({ seq: row.seq, filled: row.filled, h: row.row.height }))),
        );
        check(checks, `evidence.${label}.no-overflow`, overflow.doc <= 1 && overflow.body <= 1, JSON.stringify(overflow));
        clean(checks, `evidence.${label}.clean`, app.pageErrors, app.consoleErrors);
      } finally {
        await app.close();
      }

      // 50-row roster at the same width: row heights, page height and
      // horizontal overflow all go into metrics.json.
      const manyApp = await openApp(browser, options.artifact, { viewport, isMobile: true, hasTouch: true });
      try {
        const { page } = manyApp;
        const many = ["学号,姓名", ...Array.from({ length: 50 }, (_, index) => `S${index + 1},学生${index + 1}`)].join("\n");
        await importText(page, "fifty.csv", many);
        const fifty = await page.evaluate(() => {
          const rows = [...document.querySelectorAll('[data-testid="roster-row"]')];
          const rowHeights = rows.map((row) => Math.round(row.getBoundingClientRect().height * 10) / 10);
          const total = rowHeights.reduce((sum, height) => sum + height, 0);
          return {
            count: rows.length,
            scrollHeight: document.documentElement.scrollHeight,
            rowHeights,
            avgHeight: rowHeights.length ? Math.round((total / rowHeights.length) * 10) / 10 : 0,
            overflow: {
              doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              body: document.body.scrollWidth - document.body.clientWidth,
            },
          };
        });
        metrics.viewports[viewport.width].fifty = fifty;
        check(
          checks,
          `evidence.${label}.fifty-overflow`,
          fifty.count === 50 && fifty.overflow.doc <= 1 && fifty.overflow.body <= 1,
          JSON.stringify({ count: fifty.count, overflow: fifty.overflow }),
        );
        check(
          checks,
          `evidence.${label}.fifty-budget`,
          fifty.scrollHeight > 0 && fifty.scrollHeight <= 4200,
          `scrollHeight=${fifty.scrollHeight} budget=4200`,
        );
        clean(checks, `evidence.${label}.fifty-clean`, manyApp.pageErrors, manyApp.consoleErrors);
      } finally {
        await manyApp.close();
      }
    }
  } finally {
    await browser.close();
  }

  fs.writeFileSync(path.join(options.out, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  fs.writeFileSync(path.join(options.out, "dom.html"), `${domHtml}\n`);
  const lines = checks.map((item) => `${item.pass ? "PASS" : "FAIL"} ${item.id} — ${item.detail}`);
  const failed = checks.filter((item) => !item.pass).length;
  lines.push(`\nEVIDENCE: ${failed === 0 ? "PASS" : "FAIL"} checks=${checks.length} failed=${failed}`);
  fs.writeFileSync(path.join(options.out, "checks.log"), `${lines.join("\n")}\n`);
  for (const line of lines) console.log(line);

  let green = { output: "skipped (--skip-suite)", status: 0 };
  let suite = { output: "skipped (--skip-suite)", status: 0 };
  if (!options.skipSuite) {
    green = runSuite(["--only", "roster-two-line,roster-compact"], options.artifact);
    fs.writeFileSync(path.join(options.out, "green.log"), `${green.output}\n`);
    suite = runSuite([], options.artifact);
    fs.writeFileSync(path.join(options.out, "suite.log"), `${suite.output}\n`);
    console.log("");
    console.log(green.output.split("\n").filter((line) => line.startsWith("SUITE: ")).join(""));
    console.log(suite.output.split("\n").filter((line) => line.startsWith("SUITE: ")).join(""));
    console.log(`ARTIFACTS: ${options.out}`);
  }
  if (!fs.existsSync(path.join(options.out, "red.log"))) {
    console.error(`warning: red.log is missing from ${options.out}; archive the red-phase run there`);
  }

  const ok = failed === 0 && green.status === 0 && suite.status === 0;
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(2);
});
