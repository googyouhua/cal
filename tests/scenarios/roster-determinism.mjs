import fs from "node:fs";
import { openApp } from "../lib/browser.mjs";
import { eq, check, clean } from "../lib/check.mjs";
import { compute, importText, rosterRows, utf8 } from "../lib/roster.mjs";

const CSV = [
  "序号,学号,姓名,成绩,班级",
  "1,20230101,张三,85,高一3班",
  "2,20230102,李四,92,高一3班",
  "3,20230103,王五,78,高一3班",
].join("\r\n");

async function runOnce(browser, artifact, pageErrors, consoleErrors) {
  const app = await openApp(browser, artifact);
  pageErrors.push(...app.pageErrors);
  consoleErrors.push(...app.consoleErrors);
  try {
    const { page } = app;
    await importText(page, "A.csv", CSV, { bom: true });
    await compute(page, "+", ["12", "30", "8"]);
    await compute(page, "+", ["9", "1"]);
    await page.locator('[data-testid="roster-row"][data-seq="1"] [data-testid="roster-edit"]').click();
    await page.locator('[data-testid="operand-input"]').first().fill("7");
    await page.click('[data-testid="key-equals"]');
    await page.waitForFunction(
      () => document.querySelector('[data-testid="roster-row"][data-seq="1"] [data-testid="roster-score"]')?.getAttribute("data-value") === "45",
    );
    const rows = await rosterRows(page);
    const storage = await page.evaluate(() => localStorage.getItem("cal-phone.roster.v1"));
    const exported = await (async () => {
      const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-testid="roster-export"]')]);
      return fs.readFileSync(await dl.path()).toString("utf8");
    })();
    return { rows, storage, exported };
  } finally {
    await app.close();
  }
}

export const rosterDeterminism = {
  id: "roster-determinism",
  async run({ browser, artifact }) {
    const checks = [];
    const pageErrors = [];
    const consoleErrors = [];
    const first = await runOnce(browser, artifact, pageErrors, consoleErrors);
    const second = await runOnce(browser, artifact, pageErrors, consoleErrors);
    eq(checks, "roster-determinism.rows", second.rows, first.rows);
    eq(checks, "roster-determinism.storage", second.storage, first.storage);
    eq(checks, "roster-determinism.export", second.exported, first.exported);
    check(checks, "roster-determinism.edited", first.rows[0].score === "45" && first.rows[0].expression === "7 + 30 + 8", JSON.stringify(first.rows[0]));
    clean(checks, "roster-determinism.clean", pageErrors, consoleErrors);
    return checks;
  },
};

export const scenarios = [rosterDeterminism];
