import { openApp } from "../lib/browser.mjs";
import { S } from "../lib/selectors.mjs";
import { check, eq, clean } from "../lib/check.mjs";
import { appState, expressionText, resultValue } from "../lib/dom.mjs";
import { compute, importText, rosterRows } from "../lib/roster.mjs";

const FIXTURE_A = [
  "序号,学号,姓名,成绩,班级",
  "1,20230101,张三,85,高一3班",
  "2,20230102,李四,92,高一3班",
  "3,20230103,王五,78,高一3班",
].join("\r\n");

async function snapshot(page) {
  return {
    rows: await rosterRows(page),
    next: await page.locator('[data-testid="roster-next"]').count()
      ? await page.locator('[data-testid="roster-next"]').getAttribute("data-seq")
      : null,
    state: await appState(page),
    input: await page.$eval(S.calcInput, (element) => element.value),
    expression: await expressionText(page),
    result: await resultValue(page),
    label: await page.locator("#state-label").textContent(),
    historyItems: await page.locator(S.historyItem).count(),
    operator: await page.$eval(S.app, (element) => element.getAttribute("data-operator")),
    draftVisible: await page.$eval(S.editDraft, (element) => element.getClientRects().length > 0 && getComputedStyle(element).display !== "none"),
  };
}

export const rosterFill = {
  id: "roster-fill",
  async run({ browser, artifact }) {
    const checks = [];

    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      await compute(page, "+", ["12", "30", "8"]);
      await compute(page, "+", ["9", "1"]);
      const before = {
        history: await page.locator(S.historyItem).count(),
        expression: await expressionText(page),
        result: await resultValue(page),
        input: await page.$eval(S.calcInput, (element) => element.value),
        operator: await page.$eval(S.app, (element) => element.getAttribute("data-operator")),
      };

      await page.click('[data-testid="roster-import"]');
      await page.waitForSelector('[data-testid="import-dialog"][open]');
      await page.setInputFiles('[data-testid="roster-file"]', { name: "A.csv", mimeType: "text/csv", buffer: Buffer.from(FIXTURE_A, "utf8") });
      await page.waitForFunction(() => {
        const summary = document.querySelector('[data-testid="import-summary"]');
        return summary && !summary.hidden && summary.getAttribute("data-count") !== null;
      });
      await page.click('[data-testid="import-cancel"]');
      await page.waitForFunction(() => !document.querySelector('[data-testid="import-dialog"]').open);
      eq(checks, "roster-fill.cancel.history", await page.locator(S.historyItem).count(), before.history);
      eq(checks, "roster-fill.cancel.expression", await expressionText(page), before.expression);
      eq(checks, "roster-fill.cancel.result", await resultValue(page), before.result);
      eq(checks, "roster-fill.cancel.input", await page.$eval(S.calcInput, (element) => element.value), before.input);
      eq(checks, "roster-fill.cancel.operator", await page.$eval(S.app, (element) => element.getAttribute("data-operator")), before.operator);
      eq(checks, "roster-fill.cancel.roster", await page.locator('[data-testid="roster-row"]').count(), 0);

      await page.click('[data-testid="roster-import"]');
      await page.waitForSelector('[data-testid="import-dialog"][open]');
      await page.setInputFiles('[data-testid="roster-file"]', { name: "A.csv", mimeType: "text/csv", buffer: Buffer.from(FIXTURE_A, "utf8") });
      await page.waitForFunction(() => {
        const summary = document.querySelector('[data-testid="import-summary"]');
        return summary && !summary.hidden && summary.getAttribute("data-count") !== null;
      });
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector('[data-testid="import-dialog"]').open);
      eq(checks, "roster-fill.escape.history", await page.locator(S.historyItem).count(), before.history);

      await page.click('[data-testid="roster-import"]');
      await page.waitForSelector('[data-testid="import-dialog"][open]');
      await page.setInputFiles('[data-testid="roster-file"]', { name: "A.csv", mimeType: "text/csv", buffer: Buffer.from(FIXTURE_A, "utf8") });
      await page.waitForFunction(() => {
        const summary = document.querySelector('[data-testid="import-summary"]');
        return summary && !summary.hidden && summary.getAttribute("data-count") !== null;
      });
      await page.click('[data-testid="import-confirm"]');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"]').length === 3);
      const imported = await snapshot(page);
      eq(checks, "roster-fill.import.filled", imported.rows.map((row) => row.filled), ["false", "false", "false"]);
      eq(checks, "roster-fill.import.next", imported.next, "1");
      eq(checks, "roster-fill.import.state", imported.state, "select");
      eq(checks, "roster-fill.import.operator", imported.operator, null);
      eq(checks, "roster-fill.import.expression", imported.expression, "");
      eq(checks, "roster-fill.import.result", imported.result, null);
      eq(checks, "roster-fill.import.input", imported.input, "");
      eq(checks, "roster-fill.import.draft", imported.draftVisible, false);
      eq(checks, "roster-fill.import.history", imported.historyItems, 0);
      check(checks, "roster-fill.import.summary", imported.label.includes("已录 0") || (await page.locator('[data-testid="roster-summary"]').textContent()).includes("已录 0"), imported.label);
      check(checks, "roster-fill.import.focus", (await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-testid"))) === "roster-import", await page.evaluate(() => document.activeElement && document.activeElement.outerHTML.slice(0, 120)));

      await compute(page, "/", ["5", "0"]);
      eq(checks, "roster-fill.divzero.error", await page.$eval(S.result, (element) => element.getAttribute("data-error")), "true");
      eq(checks, "roster-fill.divzero.filled", (await rosterRows(page)).filter((row) => row.filled === "true").length, 0);
      eq(checks, "roster-fill.divzero.next", await page.locator('[data-testid="roster-next"]').getAttribute("data-seq"), "1");
      await page.click(S.equals);
      eq(checks, "roster-fill.empty.filled", (await rosterRows(page)).filter((row) => row.filled === "true").length, 0);
      eq(checks, "roster-fill.empty.next", await page.locator('[data-testid="roster-next"]').getAttribute("data-seq"), "2");
      check(checks, "roster-fill.empty.skip-label", (await page.locator("#state-label").textContent()).includes("跳过"), await page.locator("#state-label").textContent());

      await compute(page, "+", ["10", "20"]);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length === 1);
      eq(checks, "roster-fill.first.rows", (await rosterRows(page)).map((row) => [row.filled, row.score]), [
        ["false", "—"],
        ["true", "30"],
        ["false", "—"],
      ]);
      eq(checks, "roster-fill.first.next", await page.locator('[data-testid="roster-next"]').getAttribute("data-seq"), "3");

      await compute(page, "+", ["3", "4"]);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length === 2);
      eq(checks, "roster-fill.second.rows", (await rosterRows(page)).map((row) => [row.filled, row.score, row.expression]), [
        ["false", "—", ""],
        ["true", "30", "10 + 20"],
        ["true", "7", "3 + 4"],
      ]);
      check(checks, "roster-fill.second.label", (await page.locator("#state-label").textContent()).includes("已记录 3 王五"), await page.locator("#state-label").textContent());

      await compute(page, "+", ["5", "6"]);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length === 3);
      eq(checks, "roster-fill.third.next-count", await page.locator('[data-testid="roster-next"]').count(), 0);
      check(checks, "roster-fill.third.summary", (await page.locator('[data-testid="roster-summary"]').textContent()).includes("名单已录满"), await page.locator('[data-testid="roster-summary"]').textContent());

      await compute(page, "+", ["1", "1"]);
      eq(checks, "roster-fill.full.result", await resultValue(page), "2");
      eq(checks, "roster-fill.full.scores", (await rosterRows(page)).map((row) => row.score), ["11", "30", "7"]);
      eq(checks, "roster-fill.full.count", await page.locator('[data-testid="roster-row"]').count(), 3);
      check(checks, "roster-fill.full.label", (await page.locator("#state-label").textContent()).includes("名单已录满"), await page.locator("#state-label").textContent());
      clean(checks, "roster-fill.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }

    const guard = await openApp(browser, artifact);
    try {
      const { page } = guard;
      await page.evaluate(() => {
        try { localStorage.setItem("cal-phone.settings.v1", JSON.stringify({ autoConfirm: 0.2 })); } catch {}
      });
      await page.reload({ waitUntil: "load" });
      await page.click('[data-testid="keypad"] [data-key="1"]');
      await page.waitForSelector('[data-testid="auto-confirm-feedback"][data-active="true"]');
      await page.click('[data-testid="roster-import"]');
      await page.waitForSelector('[data-testid="import-dialog"][open]');
      await page.waitForTimeout(1200);
      eq(checks, "roster-fill.guard.rows", await page.locator('[data-testid="roster-row"]').count(), 0);
      eq(checks, "roster-fill.guard.history", await page.locator(S.historyItem).count(), 0);
      await page.click('[data-testid="import-cancel"]');
      await page.waitForFunction(() => !document.querySelector('[data-testid="import-dialog"]').open);
      eq(checks, "roster-fill.guard.input", await page.$eval(S.calcInput, (element) => element.value), "1");
      await page.waitForSelector('[data-testid="auto-confirm-feedback"][data-active="true"]');
      check(checks, "roster-fill.guard.retimed", true, "countdown restarted");
      clean(checks, "roster-fill.guard.clean", guard.pageErrors, guard.consoleErrors);
    } finally {
      await guard.close();
    }

    const keys = await openApp(browser, artifact);
    try {
      const { page } = keys;
      await importText(page, "A.csv", FIXTURE_A);
      const beforeKeys = await snapshot(page);
      await page.click('[data-testid="roster-import"]');
      await page.waitForSelector('[data-testid="import-dialog"][open]');
      await page.keyboard.press("5");
      await page.keyboard.press("Enter");
      await page.keyboard.press("=");
      await page.waitForTimeout(300);
      const afterKeys = await snapshot(page);
      eq(checks, "roster-fill.keyboard.state", afterKeys.state, beforeKeys.state);
      eq(checks, "roster-fill.keyboard.input", afterKeys.input, beforeKeys.input);
      eq(checks, "roster-fill.keyboard.expression", afterKeys.expression, beforeKeys.expression);
      eq(checks, "roster-fill.keyboard.result", afterKeys.result, beforeKeys.result);
      await page.click('[data-testid="import-cancel"]');
      clean(checks, "roster-fill.keyboard.clean", keys.pageErrors, keys.consoleErrors);
    } finally {
      await keys.close();
    }

    return checks;
  },
};

export const scenarios = [rosterFill];
