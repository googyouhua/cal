import { openApp } from "../lib/browser.mjs";
import { S } from "../lib/selectors.mjs";
import { check, eq, clean } from "../lib/check.mjs";
import { appState, setOperand, liveOperands } from "../lib/dom.mjs";
import { compute, importText, rosterRows, utf8 } from "../lib/roster.mjs";

const FIXTURE_A = [
  "序号,学号,姓名,成绩,班级",
  "1,20230101,张三,85,高一3班",
  "2,20230102,李四,92,高一3班",
  "3,20230103,王五,78,高一3班",
].join("\r\n");

function rowSnapshot(row) {
  return [row.seq, row.name, row.id, row.filled, row.score, row.expression];
}

async function fillFixtureA(page) {
  await compute(page, "+", ["12", "30", "8"]);
  await compute(page, "+", ["9", "1"]);
  await compute(page, "+", ["5", "5"]);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length === 3);
}

export const rosterEdit = {
  id: "roster-edit",
  async run({ browser, artifact }) {
    const checks = [];

    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      await importText(page, "A.csv", FIXTURE_A, { bom: true });
      await fillFixtureA(page);
      const before = await rosterRows(page);
      eq(checks, "roster-edit.before.scores", before.map((row) => row.score), ["50", "10", "10"]);

      await page.locator('[data-testid="roster-row"][data-seq="2"] [data-testid="roster-edit"]').click();
      eq(checks, "roster-edit.state", await appState(page), "edit");
      check(checks, "roster-edit.title", (await page.locator('[data-testid="edit-draft-title"]').textContent()).includes("正在编辑 2 李四"), await page.locator('[data-testid="edit-draft-title"]').textContent());
      check(checks, "roster-edit.label", (await page.locator("#state-label").textContent()).includes("李四"), await page.locator("#state-label").textContent());
      eq(checks, "roster-edit.operands", await liveOperands(page), ["9", "1"]);
      eq(checks, "roster-edit.done-text", await page.locator('[data-testid="edit-done"]').textContent(), "保存并完成");
      eq(checks, "roster-edit.cancel-text", await page.locator(S.editCancel).textContent(), "取消");
      await setOperand(page, 0, "7");
      await page.click(S.equals);
      await page.waitForFunction(() => document.querySelector('[data-testid="roster-row"][data-seq="2"] [data-testid="roster-score"]')?.getAttribute("data-value") === "8");
      const after = await rosterRows(page);
      eq(checks, "roster-edit.after.scores", after.map((row) => row.score), ["50", "8", "10"]);
      eq(checks, "roster-edit.after.second-expression", after[1].expression, "7 + 1");
      eq(checks, "roster-edit.after.row-count", after.length, 3);
      eq(checks, "roster-edit.after.seq-unchanged", after.map((row) => row.seq), ["1", "2", "3"]);
      eq(checks, "roster-edit.after.first-unchanged", rowSnapshot(after[0]), rowSnapshot(before[0]));
      eq(checks, "roster-edit.after.third-unchanged", rowSnapshot(after[2]), rowSnapshot(before[2]));
      eq(checks, "roster-edit.after.next", await page.locator('[data-testid="roster-next"]').count(), 0);
      await page.waitForFunction(() => (document.activeElement?.getAttribute("aria-label") || "").includes("编辑第 2 位"));
      eq(checks, "roster-edit.after.focus", await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "编辑第 2 位 李四 的成绩");
      check(checks, "roster-edit.after.label-updated", (await page.locator("#state-label").textContent()).includes("已更新 2"), await page.locator("#state-label").textContent());

      await page.reload({ waitUntil: "load" });
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"]').length === 3);
      eq(checks, "roster-edit.reload.scores", (await rosterRows(page)).map((row) => row.score), ["50", "8", "10"]);
      eq(checks, "roster-edit.reload.next", await page.locator('[data-testid="roster-next"]').count(), 0);
      eq(checks, "roster-edit.reload.state", await appState(page), "select");

      await page.locator('[data-testid="roster-row"][data-seq="2"] [data-testid="roster-edit"]').click();
      await setOperand(page, 0, "11");
      await page.click(S.editCancel);
      await page.waitForFunction(() => (document.activeElement?.getAttribute("aria-label") || "").includes("编辑第 2 位"));
      eq(checks, "roster-edit.cancel.score", (await rosterRows(page))[1].score, "8");
      eq(checks, "roster-edit.cancel.focus", await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "编辑第 2 位 李四 的成绩");
      eq(checks, "roster-edit.cancel.draft-hidden", await page.$eval(S.editDraft, (element) => element.hidden), true);
      clean(checks, "roster-edit.main.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }

    const partial = await openApp(browser, artifact);
    try {
      const { page } = partial;
      await importText(page, "five.csv", ["学号,姓名", "1,甲", "2,乙", "3,丙", "4,丁", "5,戊"].join("\n"));
      await compute(page, "+", ["12", "30", "8"]);
      await compute(page, "+", ["9", "1"]);
      await page.locator('[data-testid="roster-row"][data-seq="1"] [data-testid="roster-edit"]').click();
      await setOperand(page, 0, "20");
      await page.click(S.equals);
      await page.waitForFunction(() => document.querySelector('[data-testid="roster-row"][data-seq="1"] [data-testid="roster-score"]')?.getAttribute("data-value") === "58");
      eq(checks, "roster-edit.partial.next", await page.locator('[data-testid="roster-next"]').getAttribute("data-seq"), "3");
      eq(checks, "roster-edit.partial.filled", (await rosterRows(page)).filter((row) => row.filled === "true").length, 2);
      clean(checks, "roster-edit.partial.clean", partial.pageErrors, partial.consoleErrors);
    } finally {
      await partial.close();
    }

    const blocked = await openApp(browser, artifact);
    try {
      const { page } = blocked;
      await importText(page, "A.csv", FIXTURE_A);
      await fillFixtureA(page);
      await page.locator('[data-testid="roster-row"][data-seq="2"] [data-testid="roster-edit"]').click();
      await page.locator('[data-testid="roster-row"][data-seq="3"] [data-testid="roster-edit"]').click();
      eq(checks, "roster-edit.blocked.state", await appState(page), "edit");
      check(checks, "roster-edit.blocked.label", (await page.locator("#state-label").textContent()).includes("先保存或取消"), await page.locator("#state-label").textContent());
      eq(checks, "roster-edit.blocked.title", await page.locator('[data-testid="edit-draft-title"]').textContent(), "正在编辑 2 李四 20230102");
      eq(checks, "roster-edit.blocked.score", (await rosterRows(page))[1].score, "10");
      await page.click(S.editCancel);
      await page.locator('[data-testid="roster-row"][data-seq="3"] [data-testid="roster-edit"]').click();
      eq(checks, "roster-edit.blocked.after-cancel", await page.locator('[data-testid="edit-draft-title"]').textContent(), "正在编辑 3 王五 20230103");
      await page.click(S.editCancel);
      clean(checks, "roster-edit.blocked.clean", blocked.pageErrors, blocked.consoleErrors);
    } finally {
      await blocked.close();
    }

    const noRoster = await openApp(browser, artifact);
    try {
      const { page } = noRoster;
      await compute(page, "+", ["4", "6"]);
      await page.locator(`${S.historyItem} ${S.historyEdit}`).first().click();
      eq(checks, "roster-edit.no-roster.done-absent", await page.locator('[data-testid="edit-done"]').count(), 0);
      eq(checks, "roster-edit.no-roster.cancel-text", await page.locator(S.editCancel).textContent(), "关闭");
      clean(checks, "roster-edit.no-roster.clean", noRoster.pageErrors, noRoster.consoleErrors);
    } finally {
      await noRoster.close();
    }

    return checks;
  },
};

export const scenarios = [rosterEdit];
