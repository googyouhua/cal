import { openApp } from "../lib/browser.mjs";
import { check, eq, clean } from "../lib/check.mjs";
import { compute, importText, rosterRows, utf8 } from "../lib/roster.mjs";

const FIXTURE_A = [
  "序号,学号,姓名,成绩,班级",
  "1,20230101,张三,85,高一3班",
  "2,20230102,李四,92,高一3班",
  "3,20230103,王五,78,高一3班",
  "4,20230104,赵六,61,高一3班",
].join("\r\n");

const FIXTURE_B = [
  "序号,学号,姓名,成绩,班级",
  "4,20230103,王五改,70,高一4班",
  "3,20230102,李四,90,高一4班",
  "5,20230105,钱七,55,高一4班",
].join("\r\n");

async function openPreviewText(page, name, text) {
  await page.click('[data-testid="roster-import"]');
  await page.waitForSelector('[data-testid="import-dialog"][open]');
  await page.setInputFiles('[data-testid="roster-file"]', { name, mimeType: "text/csv", buffer: utf8(text) });
  await page.waitForFunction(() => {
    const summary = document.querySelector('[data-testid="import-summary"]');
    return summary && !summary.hidden && summary.getAttribute("data-count") !== null;
  });
}

async function modeState(page) {
  return page.evaluate(() => ({
    mode: document.querySelector('[data-testid="import-dialog"]').dataset.mode,
    hasMode: !document.querySelector('[data-testid="import-mode"]').hidden,
    hasKeep: !!document.querySelector('[data-testid="import-mode-keep"]') && document.querySelector('[data-testid="import-mode-keep"]').closest("label").style.display !== "none",
    keepChecked: document.querySelector('[data-testid="import-mode-keep"]').checked,
    clearChecked: document.querySelector('[data-testid="import-mode-clear"]').checked,
    keepLabel: document.querySelector('[data-testid="import-mode-keep-label"]').textContent,
    clearLabel: document.querySelector('[data-testid="import-mode-clear-label"]').textContent,
    warning: document.querySelector('[data-testid="import-warning"]').hidden ? "" : document.querySelector('[data-testid="import-warning"]').textContent,
    confirm: document.querySelector('[data-testid="import-confirm"]').textContent,
    count: document.querySelector('[data-testid="import-summary"]').dataset.count,
    keep: document.querySelector('[data-testid="import-summary"]').dataset.keepCount,
    drop: document.querySelector('[data-testid="import-summary"]').dataset.dropCount,
    added: document.querySelector('[data-testid="import-summary"]').dataset.newCount,
  }));
}

async function storedEntries(page) {
  return page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("cal-phone.roster.v1"));
    return stored.rows.map((row) => [row.seq, row.id, row.name, row.entry ? row.entry.result : null, row.entry ? row.entry.expression : ""]);
  });
}

export const rosterMode = {
  id: "roster-mode",
  async run({ browser, artifact }) {
    const checks = [];

    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      await importText(page, "A.csv", FIXTURE_A);
      await compute(page, "+", ["12", "30", "8"]);
      await compute(page, "+", ["9", "1"]);

      await openPreviewText(page, "B.csv", FIXTURE_B);
      const preview = await modeState(page);
      eq(checks, "roster-mode.counts", [preview.count, preview.keep, preview.drop, preview.added], ["3", "1", "1", "2"]);
      eq(checks, "roster-mode.has-mode", preview.hasMode, true);
      eq(checks, "roster-mode.has-keep", preview.hasKeep, true);
      eq(checks, "roster-mode.default-keep", preview.keepChecked, true);
      eq(checks, "roster-mode.dialog-mode", preview.mode, "keep");
      eq(checks, "roster-mode.confirm", preview.confirm, "保留成绩并开始录入");
      check(checks, "roster-mode.keep-label", preview.keepLabel.includes("保留同学号成绩") && preview.keepLabel.includes("1"), preview.keepLabel);

      await page.click('[data-testid="import-confirm"]');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"]').length === 3);
      eq(checks, "roster-mode.keep.rows", (await rosterRows(page)).map((row) => [row.seq, row.id, row.name, row.score]), [
        ["1", "20230103", "王五改", "—"],
        ["2", "20230102", "李四", "10"],
        ["3", "20230105", "钱七", "—"],
      ]);
      eq(checks, "roster-mode.keep.stored", await storedEntries(page), [
        [1, "20230103", "王五改", null, ""],
        [2, "20230102", "李四", 10, "9 + 1"],
        [3, "20230105", "钱七", null, ""],
      ]);
    } finally {
      await app.close();
    }

    const app2 = await openApp(browser, artifact);
    try {
      const { page } = app2;
      await importText(page, "A.csv", FIXTURE_A);
      await compute(page, "+", ["12", "30", "8"]);
      await compute(page, "+", ["9", "1"]);
      await openPreviewText(page, "B.csv", FIXTURE_B);
      await page.click('[data-testid="import-mode-clear"]');
      const cleared = await modeState(page);
      eq(checks, "roster-mode.clear.checked", [cleared.keepChecked, cleared.clearChecked], [false, true]);
      eq(checks, "roster-mode.clear.confirm", cleared.confirm, "清空并开始录入");
      await page.click('[data-testid="import-confirm"]');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"]').length === 3);
      eq(checks, "roster-mode.clear.rows", (await rosterRows(page)).map((row) => row.score), ["—", "—", "—"]);
      eq(checks, "roster-mode.clear.next", await page.locator('[data-testid="roster-next"]').getAttribute("data-seq"), "1");
    } finally {
      await app2.close();
    }

    const app3 = await openApp(browser, artifact);
    try {
      const { page } = app3;
      await importText(page, "A.csv", FIXTURE_A);
      await compute(page, "+", ["1", "1"]);
      await openPreviewText(page, "other.csv", "学号,姓名\n99999,新人\n");
      const zero = await modeState(page);
      eq(checks, "roster-mode.zero.keep-hidden", zero.hasKeep, false);
      eq(checks, "roster-mode.zero.mode", zero.mode, "clear");
      eq(checks, "roster-mode.zero.confirm", zero.confirm, "清空并开始录入");
      check(checks, "roster-mode.zero.warning", zero.warning.includes("只能清空重录"), zero.warning);

      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector('[data-testid="import-dialog"]').open);
      eq(checks, "roster-mode.cancel.rows", (await rosterRows(page)).length, 4);
      eq(checks, "roster-mode.cancel.score", (await rosterRows(page))[0].score, "2");
      clean(checks, "roster-mode.clean", app3.pageErrors, app3.consoleErrors);
    } finally {
      await app3.close();
    }

    const app4 = await openApp(browser, artifact);
    try {
      const { page } = app4;
      await importText(page, "dup-old.csv", "学号,姓名\n20230101,甲\n20230101,乙\n");
      await compute(page, "+", ["5", "5"]);
      await openPreviewText(page, "B.csv", FIXTURE_B);
      const dup = await modeState(page);
      eq(checks, "roster-mode.dup.keep-hidden", dup.hasKeep, false);
      eq(checks, "roster-mode.dup.mode", dup.mode, "clear");
      check(checks, "roster-mode.dup.warning", dup.warning.includes("重复") && dup.warning.includes("20230101"), dup.warning);
      clean(checks, "roster-mode.dup.clean", app4.pageErrors, app4.consoleErrors);
    } finally {
      await app4.close();
    }

    return checks;
  },
};

export const scenarios = [rosterMode];
