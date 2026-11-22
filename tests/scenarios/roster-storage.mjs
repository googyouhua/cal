import { openApp } from "../lib/browser.mjs";
import { S } from "../lib/selectors.mjs";
import { check, eq, clean } from "../lib/check.mjs";
import { appState, expressionText, resultValue } from "../lib/dom.mjs";
import { compute, importText, rosterRows, ROSTER_KEY, utf8 } from "../lib/roster.mjs";

const FIXTURE_A = [
  "序号,学号,姓名,成绩,班级",
  "1,20230101,张三,85,高一3班",
  "2,20230102,李四,92,高一3班",
  "3,20230103,王五,78,高一3班",
].join("\r\n");

async function storedRaw(page) {
  return page.evaluate((key) => localStorage.getItem(key), ROSTER_KEY);
}

export const rosterStorage = {
  id: "roster-storage",
  async run({ browser, artifact }) {
    const checks = [];

    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      await importText(page, "A.csv", FIXTURE_A);
      await compute(page, "+", ["12", "30", "8"]);
      await compute(page, "+", ["9", "1"]);

      const stored = JSON.parse(await storedRaw(page));
      eq(checks, "roster-storage.shape.version", stored.version, 1);
      eq(checks, "roster-storage.shape.fileName", stored.fileName, "A.csv");
      eq(checks, "roster-storage.shape.headers", stored.headers, ["序号", "学号", "姓名", "成绩", "班级"]);
      eq(checks, "roster-storage.shape.roles", stored.roles, ["seq", "id", "name", "score", "extra"]);
      eq(checks, "roster-storage.shape.length", stored.rows.length, 3);
      eq(checks, "roster-storage.shape.first-entry", stored.rows[0].entry, {
        seq: 1,
        operator: "+",
        operands: [{ value: 12, display: "12" }, { value: 30, display: "30" }, { value: 8, display: "8" }],
        base: null,
        expression: "12 + 30 + 8",
        result: 50,
      });
      eq(checks, "roster-storage.shape.second-entry", stored.rows[1].entry, {
        seq: 2,
        operator: "+",
        operands: [{ value: 9, display: "9" }, { value: 1, display: "1" }],
        base: null,
        expression: "9 + 1",
        result: 10,
      });
      eq(checks, "roster-storage.shape.extra", stored.rows[0].extra, ["高一3班"]);

      await page.reload({ waitUntil: "load" });
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"]').length === 3);
      eq(checks, "roster-storage.reload.scores", (await rosterRows(page)).map((row) => row.score), ["50", "10", "—"]);
      eq(checks, "roster-storage.reload.next", await page.locator('[data-testid="roster-next"]').getAttribute("data-seq"), "3");
      eq(checks, "roster-storage.reload.state", await appState(page), "select");
      eq(checks, "roster-storage.reload.input", await page.$eval(S.calcInput, (element) => element.value), "");
      eq(checks, "roster-storage.reload.expression", await expressionText(page), "");
      eq(checks, "roster-storage.reload.result", await resultValue(page), null);
      check(checks, "roster-storage.reload.label", (await page.locator("#state-label").textContent()).includes("名单已恢复"), await page.locator("#state-label").textContent());

      const accepted = [];
      page.on("dialog", async (dialog) => {
        accepted.push(dialog.message());
        await dialog.accept();
      });
      await page.click('[data-testid="roster-clear"]');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"]').length === 0);
      eq(checks, "roster-storage.clear.storage", await storedRaw(page), null);
      eq(checks, "roster-storage.clear.roster-gone", await page.locator('[data-testid="roster"]').isHidden(), true);
      eq(checks, "roster-storage.clear.history", await page.locator(S.historyItem).count(), 0);
      eq(checks, "roster-storage.clear.state", await appState(page), "select");
      check(checks, "roster-storage.clear.confirm", accepted.join("").includes("都会删除"), accepted.join("|"));
      await page.reload({ waitUntil: "load" });
      await page.waitForTimeout(400);
      eq(checks, "roster-storage.clear.reload-rows", await page.locator('[data-testid="roster-row"]').count(), 0);
      eq(checks, "roster-storage.clear.reload-storage", await storedRaw(page), null);
      clean(checks, "roster-storage.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }

    const broken = await openApp(browser, artifact, {});
    try {
      const { page, context } = broken;
      await context.addInitScript(() => {
        try { localStorage.setItem("cal-phone.roster.v1", "not-json{{{"); } catch {}
      });
      await page.reload({ waitUntil: "load" });
      await page.waitForTimeout(400);
      eq(checks, "roster-storage.bad-json.rows", await page.locator('[data-testid="roster-row"]').count(), 0);
      eq(checks, "roster-storage.bad-json.warning", await page.locator('[data-testid="roster-data-warning"]').textContent(), "本机名单数据无法读取，已忽略；原数据未覆盖。");
      eq(checks, "roster-storage.bad-json.untouched", await storedRaw(page), "not-json{{{");
      clean(checks, "roster-storage.bad-json.clean", broken.pageErrors, broken.consoleErrors);
    } finally {
      await broken.close();
    }

    for (const [id, value] of [
      ["version", JSON.stringify({ version: 99, fileName: "A.csv", headers: ["学号"], roles: ["id"], rows: [{ seq: 1, id: "1", name: "", extra: [], entry: null }] })],
      ["noroles", JSON.stringify({ version: 1, fileName: "A.csv", headers: ["学号"], rows: [{ seq: 1, id: "1", name: "", extra: [], entry: null }] })],
      ["badrole", JSON.stringify({ version: 1, fileName: "A.csv", headers: ["学号"], roles: ["foo"], rows: [{ seq: 1, id: "1", name: "", extra: [], entry: null }] })],
      ["badentry", JSON.stringify({ version: 1, fileName: "A.csv", headers: ["学号"], roles: ["id"], rows: [{ seq: 1, id: "1", name: "", extra: [], entry: { seq: 1, operator: "+", operands: [], base: null, expression: "", result: 1 } }] })],
    ]) {
      const bad = await openApp(browser, artifact, {});
      try {
        const { page, context } = bad;
        await context.addInitScript((stored) => {
          try { localStorage.setItem("cal-phone.roster.v1", stored); } catch {}
        }, value);
        await page.reload({ waitUntil: "load" });
        await page.waitForTimeout(400);
        eq(checks, `roster-storage.${id}.rows`, await page.locator('[data-testid="roster-row"]').count(), 0);
        eq(checks, `roster-storage.${id}.untouched`, await storedRaw(page), value);
        clean(checks, `roster-storage.${id}.clean`, bad.pageErrors, bad.consoleErrors);
      } finally {
        await bad.close();
      }
    }

    const denied = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      await denied.addInitScript(() => {
        Storage.prototype.getItem = () => { throw new Error("blocked"); };
        Storage.prototype.setItem = () => { throw new Error("blocked"); };
      });
      const page = await denied.newPage();
      const pageErrors = [];
      const consoleErrors = [];
      page.on("pageerror", (error) => pageErrors.push(String(error)));
      page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
      const { pathToFileURL } = await import("node:url");
      await page.goto(pathToFileURL(artifact).href, { waitUntil: "load" });
      await page.click('[data-testid="roster-import"]');
      await page.waitForSelector('[data-testid="import-dialog"][open]');
      await page.setInputFiles('[data-testid="roster-file"]', { name: "A.csv", mimeType: "text/csv", buffer: utf8(FIXTURE_A) });
      await page.waitForFunction(() => {
        const summary = document.querySelector('[data-testid="import-summary"]');
        return summary && !summary.hidden && summary.getAttribute("data-count") !== null;
      });
      await page.click('[data-testid="import-confirm"]');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"]').length === 3);
      await page.click('[data-testid="op-picker"] [data-op="+"]');
      await page.click('[data-testid="keypad"] [data-key="2"]');
      await page.click('[data-testid="keypad"] [data-key="enter"]');
      await page.click('[data-testid="key-equals"]');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"][data-filled="true"]').length === 1);
      eq(checks, "roster-storage.denied.score", await page.getAttribute('[data-testid="roster-row"][data-seq="1"] [data-testid="roster-score"]', "data-value"), "2");
      eq(checks, "roster-storage.denied.warning", await page.locator('[data-testid="storage-warning"]').textContent(), "本机存储不可用，刷新会丢失成绩。");
      eq(checks, "roster-storage.denied.clean", pageErrors.length === 0 && consoleErrors.length === 0, true, [...pageErrors, ...consoleErrors].join("|"));
      await denied.close();
    } catch (error) {
      await denied.close().catch(() => {});
      throw error;
    }

    return checks;
  },
};

export const scenarios = [rosterStorage];
