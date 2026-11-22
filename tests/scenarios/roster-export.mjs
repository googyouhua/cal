import fs from "node:fs";
import { openApp } from "../lib/browser.mjs";
import { S } from "../lib/selectors.mjs";
import { check, eq, clean } from "../lib/check.mjs";
import { appState, expressionText, resultValue } from "../lib/dom.mjs";
import { compute, importBuffer, importText, parseCsv, rosterRows, utf8 } from "../lib/roster.mjs";

const FIXTURE_A = [
  "序号,学号,姓名,成绩,班级",
  "1,20230101,张三,85,高一3班",
  "2,20230102,李四,92,高一3班",
  "3,20230103,王五,78,高一3班",
].join("\r\n");

async function openApp2Import(page, { name, buffer }) {
  await page.click('[data-testid="roster-import"]');
  await page.waitForSelector('[data-testid="import-dialog"][open]');
  await page.setInputFiles('[data-testid="roster-file"]', { name, mimeType: "text/csv", buffer });
  await page.waitForFunction(() => {
    const summary = document.querySelector('[data-testid="import-summary"]');
    return summary && !summary.hidden && summary.getAttribute("data-count") !== null;
  });
  const modeVisible = await page.locator('[data-testid="import-mode"]').isVisible().catch(() => false);
  if (modeVisible) {
    await page.click('[data-testid="import-mode-clear"]');
  }
  const count = Number(await page.locator('[data-testid="import-summary"]').getAttribute("data-count"));
  await page.click('[data-testid="import-confirm"]');
  await page.waitForFunction(
    (expected) => document.querySelectorAll('[data-testid="roster-row"]').length === expected,
    count,
  );
}

async function calculatorSnapshot(page) {
  return {
    state: await appState(page),
    operator: await page.$eval(S.app, (element) => element.getAttribute("data-operator")),
    expression: await expressionText(page),
    result: await resultValue(page),
    input: await page.$eval(S.calcInput, (element) => element.value),
    storage: await page.evaluate(() => localStorage.getItem("cal-phone.roster.v1")),
  };
}

export const rosterExport = {
  id: "roster-export",
  async run({ browser, artifact }) {
    const checks = [];
    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      await importText(page, "高一3班.csv", FIXTURE_A, { bom: true });
      await compute(page, "+", ["12", "30", "8"]);
      await compute(page, "+", ["9", "1"]);
      const rowsBefore = await rosterRows(page);
      const calcBefore = await calculatorSnapshot(page);
      const now = await page.evaluate(() => {
        const date = new Date();
        return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
      });
      const download = await (async () => {
        const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-testid="roster-export"]')]);
        const filePath = await dl.path();
        return { name: dl.suggestedFilename(), buffer: fs.readFileSync(filePath), text: fs.readFileSync(filePath).toString("utf8") };
      })();
      eq(checks, "roster-export.name", download.name, `高一3班-成绩-${now}.csv`);
      eq(checks, "roster-export.bom", [...download.buffer.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
      check(
        checks,
        "roster-export.crlf",
        [...download.buffer].every((byte, index, bytes) => byte !== 0x0a || bytes[index - 1] === 0x0d),
        "every LF is preceded by CR",
      );
      check(
        checks,
        "roster-export.label",
        (await page.locator("#state-label").textContent()).includes("已导出 3 人（2 条成绩）"),
        await page.locator("#state-label").textContent(),
      );
      const exported = parseCsv(download.text);
      eq(checks, "roster-export.header", exported[0], ["序号", "学号", "姓名", "成绩", "班级"]);
      eq(checks, "roster-export.rows", exported.slice(1), [
        ["1", "20230101", "张三", "50", "高一3班"],
        ["2", "20230102", "李四", "10", "高一3班"],
        ["3", "20230103", "王五", "", "高一3班"],
      ]);
      eq(checks, "roster-export.no-side-effects.rows", await rosterRows(page), rowsBefore);
      eq(checks, "roster-export.no-side-effects.calc", await calculatorSnapshot(page), { ...calcBefore, storage: calcBefore.storage });

      await openApp2Import(page, { name: "exported.csv", buffer: download.buffer });
      const reimported = await rosterRows(page);
      eq(checks, "roster-export.reimport.people", reimported.map((row) => [row.name, row.id]), [
        ["张三", "20230101"],
        ["李四", "20230102"],
        ["王五", "20230103"],
      ]);
      eq(checks, "roster-export.reimport.empty-scores", reimported.every((row) => row.filled === "false" && row.score === "—"), true);

      await importText(page, "missing.csv", "学号,姓名,班级\n20230109,周五,高三2班\n");
      const missing = await (async () => {
        const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-testid="roster-export"]')]);
        const filePath = await dl.path();
        return { text: fs.readFileSync(filePath).toString("utf8") };
      })();
      const missingRows = parseCsv(missing.text);
      eq(checks, "roster-export.missing.header-first", missingRows[0][0], "序号");
      eq(checks, "roster-export.missing.header-last", missingRows[0][missingRows[0].length - 1], "成绩");
      eq(checks, "roster-export.missing.row", missingRows[1], ["1", "20230109", "周五", "高三2班", ""]);

      await importText(page, "synonyms.csv", "姓名,名字,学号\n张三,小三,20230101\n");
      await compute(page, "+", ["20", "5"]);
      const synonyms = await (async () => {
        const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-testid="roster-export"]')]);
        const filePath = await dl.path();
        return { text: fs.readFileSync(filePath).toString("utf8") };
      })();
      const synonymRows = parseCsv(synonyms.text);
      eq(checks, "roster-export.synonyms.header", synonymRows[0], ["序号", "姓名", "名字", "学号", "成绩"]);
      eq(checks, "roster-export.synonyms.row", synonymRows[1], ["1", "张三", "小三", "20230101", "25"]);

      // 20230101 matches the synonyms roster, so keep carries 25 into row 1; 4+6=10 lands on row 2.
      await importText(page, "quoted.csv", '姓名,学号,备注\n"张,三",20230101,"含,逗号"\n"李""四",20230102,"含\n换行"\n');
      await compute(page, "+", ["4", "6"]);
      const quoted = await (async () => {
        const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-testid="roster-export"]')]);
        const filePath = await dl.path();
        return { text: fs.readFileSync(filePath).toString("utf8") };
      })();
      const quotedRows = parseCsv(quoted.text);
      eq(checks, "roster-export.quoted.header", quotedRows[0], ["序号", "姓名", "学号", "备注", "成绩"]);
      eq(checks, "roster-export.quoted.first", quotedRows[1], ["1", "张,三", "20230101", "含,逗号", "25"]);
      eq(checks, "roster-export.quoted.second", quotedRows[2], ["2", '李"四', "20230102", "含\n换行", "10"]);
      clean(checks, "roster-export.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
    return checks;
  },
};

export const scenarios = [rosterExport];
