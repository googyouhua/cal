import { openApp } from "../lib/browser.mjs";
import { check, eq, clean } from "../lib/check.mjs";
import { compute, importText, rosterRows, utf8 } from "../lib/roster.mjs";

const CUSTOM = [
  "No.,编号,学生,总分,班级",
  "1,A01,张三,,高一3班",
  "2,A02,李四,,高一3班",
  "3,A03,王五,,高一3班",
].join("\r\n");

async function mapState(page) {
  return page.evaluate(() => {
    const map = document.querySelector('[data-testid="import-map"]');
    const values = {};
    for (const role of ["id", "name", "score", "seq"]) {
      values[role] = document.querySelector(`[data-testid="import-${role}-column"]`).value;
    }
    return {
      dataset: [map.dataset.idIndex, map.dataset.nameIndex, map.dataset.scoreIndex, map.dataset.seqIndex],
      values,
      options: [...document.querySelector('[data-testid="import-id-column"]').options].map((option) => [option.value, option.textContent]),
      note: document.querySelector('[data-testid="import-map-note"]').hidden
        ? ""
        : document.querySelector('[data-testid="import-map-note"]').textContent,
      columns: [...document.querySelectorAll('[data-testid="import-columns"] .import-chip')].map((chip) => chip.textContent),
      preview: [...document.querySelectorAll('[data-testid="import-preview"] .import-preview-row')].map((row) => row.textContent),
      count: document.querySelector('[data-testid="import-summary"]').dataset.count,
      confirmDisabled: document.querySelector('[data-testid="import-confirm"]').disabled,
    };
  });
}

async function openPreview(page, name, text) {
  await page.click('[data-testid="roster-import"]');
  await page.waitForSelector('[data-testid="import-dialog"][open]');
  await page.setInputFiles('[data-testid="roster-file"]', { name, mimeType: "text/csv", buffer: utf8(text) });
  await page.waitForFunction(() => {
    const summary = document.querySelector('[data-testid="import-summary"]');
    return summary && !summary.hidden && summary.getAttribute("data-count") !== null;
  });
}

export const rosterMap = {
  id: "roster-map",
  async run({ browser, artifact }) {
    const checks = [];
    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      await openPreview(page, "custom.csv", CUSTOM);
      const initial = await mapState(page);
      eq(checks, "roster-map.default.values", initial.values, { id: "", name: "", score: "", seq: "" });
      eq(checks, "roster-map.default.dataset", initial.dataset, ["", "", "", ""]);
      check(checks, "roster-map.default.none-option", initial.options.some(([value, label]) => value === "" && label === "无"), JSON.stringify(initial.options));
      check(checks, "roster-map.default.numbered", initial.options.some(([value, label]) => value === "1" && label.includes("第 2 列")), JSON.stringify(initial.options));
      check(checks, "roster-map.default.note", initial.note.includes("请指定姓名或学号列"), initial.note);
      eq(checks, "roster-map.default.disabled", initial.confirmDisabled, true);

      await page.selectOption('[data-testid="import-id-column"]', "1");
      const afterId = await mapState(page);
      eq(checks, "roster-map.id.values", afterId.values, { id: "1", name: "", score: "", seq: "" });
      eq(checks, "roster-map.id.count", afterId.count, "3");
      eq(checks, "roster-map.id.disabled", afterId.confirmDisabled, false);
      check(checks, "roster-map.id.preview", afterId.preview[0].includes("A01") && afterId.preview[0].includes("1"), afterId.preview.join("|"));

      await page.selectOption('[data-testid="import-name-column"]', "2");
      await page.selectOption('[data-testid="import-score-column"]', "3");
      await page.selectOption('[data-testid="import-seq-column"]', "0");
      const full = await mapState(page);
      eq(checks, "roster-map.full.values", full.values, { id: "1", name: "2", score: "3", seq: "0" });
      eq(checks, "roster-map.full.dataset", full.dataset, ["1", "2", "3", "0"]);
      check(checks, "roster-map.full.columns", full.columns.join("|").includes("学号") && full.columns.join("|").includes("成绩"), full.columns.join("|"));
      eq(checks, "roster-map.full.disabled", full.confirmDisabled, false);

      // 同一列不能两用：已被学号占用的列在姓名下拉里直接排除（规格：下拉里排除已被其他角色选中的列）
      const nameOptionValues = await page.$$eval('[data-testid="import-name-column"] option', (options) =>
        options.map((option) => option.value),
      );
      check(checks, "roster-map.conflict.excluded", !nameOptionValues.includes("1"), JSON.stringify(nameOptionValues));
      eq(checks, "roster-map.conflict.kept-values", (await mapState(page)).values, { id: "1", name: "2", score: "3", seq: "0" });
      // 学号改回"无"后该列释放，可再选
      await page.selectOption('[data-testid="import-id-column"]', "");
      eq(checks, "roster-map.conflict.released-values", (await mapState(page)).values, { id: "", name: "2", score: "3", seq: "0" });

      await page.selectOption('[data-testid="import-name-column"]', "");
      const bothNone = await mapState(page);
      eq(checks, "roster-map.both-none.values", bothNone.values, { id: "", name: "", score: "3", seq: "0" });
      eq(checks, "roster-map.both-none.disabled", bothNone.confirmDisabled, true);
      check(checks, "roster-map.both-none.note", bothNone.note.includes("请指定姓名或学号列"), bothNone.note);

      await page.selectOption('[data-testid="import-id-column"]', "1");
      await page.selectOption('[data-testid="import-name-column"]', "2");
      eq(checks, "roster-map.restored.values", (await mapState(page)).values, { id: "1", name: "2", score: "3", seq: "0" });
      await page.click('[data-testid="import-confirm"]');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="roster-row"]').length === 3);
      eq(checks, "roster-map.confirm.rows", (await rosterRows(page)).map((row) => [row.seq, row.name, row.id]), [
        ["1", "张三", "A01"],
        ["2", "李四", "A02"],
        ["3", "王五", "A03"],
      ]);
      const stored = JSON.parse(await page.evaluate(() => localStorage.getItem("cal-phone.roster.v1")));
      eq(checks, "roster-map.confirm.roles", stored.roles, ["seq", "id", "name", "score", "extra"]);
      eq(checks, "roster-map.confirm.headers", stored.headers, ["No.", "编号", "学生", "总分", "班级"]);

      await compute(page, "+", ["12", "30", "8"]);
      await page.reload({ waitUntil: "load" });
      await page.waitForSelector('[data-testid="roster-row"]');
      const reloaded = JSON.parse(await page.evaluate(() => localStorage.getItem("cal-phone.roster.v1")));
      eq(checks, "roster-map.reload.roles", reloaded.roles, ["seq", "id", "name", "score", "extra"]);

      await page.click('[data-testid="roster-export"]');
      clean(checks, "roster-map.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
    return checks;
  },
};

export const scenarios = [rosterMap];
