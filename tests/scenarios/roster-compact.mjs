import { openApp } from "../lib/browser.mjs";
import { check, eq, clean } from "../lib/check.mjs";
import { compute, importText, utf8 } from "../lib/roster.mjs";

const FIXTURE_A = [
  "序号,学号,姓名,成绩,班级",
  "1,20230101,张三,85,高一3班",
  "2,20230102,李四,92,高一3班",
  "3,20230103,王五,78,高一3班",
].join("\r\n");

const FIXTURE_A4 = [
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

async function nextSeq(page) {
  return page.evaluate(() => document.querySelector('[data-testid="roster-next"]')?.dataset.seq ?? null);
}

async function rowHeights(page) {
  return page.$$eval('[data-testid="roster-row"]', (rows) =>
    rows.map((row) => ({
      seq: row.dataset.seq,
      filled: row.dataset.filled,
      h: Math.round(row.getBoundingClientRect().height * 10) / 10,
    })),
  );
}

async function skipState(page) {
  return page.evaluate(() => ({
    next: document.querySelector('[data-testid="roster-next"]')?.dataset.seq ?? null,
    filled: [...document.querySelectorAll('[data-testid="roster-row"]')].map((row) => row.dataset.filled),
    scores: [...document.querySelectorAll('[data-testid="roster-score"]')].map((element) => element.textContent),
    label: document.querySelector("#state-label").textContent,
    state: document.querySelector("main.app").dataset.state,
    input: document.querySelector('[data-testid="calc-input"]').value,
    result: document.querySelector('[data-testid="result"]').textContent,
    expression: document.querySelector('[data-testid="expression"]').textContent,
    history: document.querySelectorAll('[data-testid="history-item"]').length,
    stored: localStorage.getItem("cal-phone.roster.v1"),
  }));
}

export const rosterCompact = {
  id: "roster-compact",
  async run({ browser, artifact }) {
    const checks = [];

    // H1: compact row heights at 390 and 320.
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
      const label = viewport.width === 390 ? "wide" : "narrow";
      const app = await openApp(browser, artifact, { viewport, isMobile: true, hasTouch: true });
      try {
        const { page } = app;
        await importText(page, "A.csv", FIXTURE_A);
        await compute(page, "+", ["12", "30", "8"]);
        const rows = await rowHeights(page);
        const filled = rows.filter((row) => row.filled === "true");
        const empty = rows.filter((row) => row.filled !== "true");
        check(checks, `roster-compact.${label}.filled-height`, filled.length === 1 && filled.every((row) => row.h <= 46.0), JSON.stringify(rows));
        check(checks, `roster-compact.${label}.empty-height`, empty.length === 2 && empty.every((row) => row.h <= 38.0), JSON.stringify(rows));
        const overlap = await page.evaluate(() => {
          const list = [...document.querySelectorAll('[data-testid="roster-row"]')];
          const rectOf = (row, selector) => row.querySelector(selector)?.getBoundingClientRect();
          let bad = 0;
          for (const row of list) {
            const filledRow = row.dataset.filled === "true";
            const name = rectOf(row, ".roster-name");
            const score = rectOf(row, '[data-testid="roster-score"]');
            const edit = rectOf(row, '[data-testid="roster-edit"]');
            for (const element of [name, score]) {
              if (!element || element.width <= 0 || element.height <= 0) { bad += 1; continue; }
              const outer = row.getBoundingClientRect();
              if (element.left < outer.left - 0.5 || element.right > outer.right + 0.5) bad += 1;
            }
            if (filledRow && (!edit || edit.width <= 0 || edit.height <= 0)) { bad += 1; continue; }
            if (name && score && !(name.right <= score.left + 0.5 || score.right <= name.left + 0.5)) bad += 1;
            if (edit && score && !(score.right <= edit.left + 0.5 || edit.right <= score.left + 0.5)) bad += 1;
          }
          return bad;
        });
        check(checks, `roster-compact.${label}.no-overlap`, overlap === 0, String(overlap));
        const over = await page.evaluate(() => ({
          doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          body: document.body.scrollWidth - document.body.clientWidth,
        }));
        check(checks, `roster-compact.${label}.no-overflow`, over.doc <= 1 && over.body <= 1, JSON.stringify(over));
        clean(checks, `roster-compact.${label}.clean`, app.pageErrors, app.consoleErrors);
      } finally {
        await app.close();
      }
    }

    // H1: 50 empty rows fit in a short page.
    {
      const app = await openApp(browser, artifact);
      try {
        const { page } = app;
        const many = ["学号,姓名", ...Array.from({ length: 50 }, (_, index) => `S${index + 1},学生${index + 1}`)].join("\n");
        await importText(page, "fifty.csv", many);
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        check(checks, "roster-compact.fifty-height", height <= 2800, String(height));
        clean(checks, "roster-compact.fifty-clean", app.pageErrors, app.consoleErrors);
      } finally {
        await app.close();
      }
    }

    // H2: import-mode group is compact but still works.
    {
      const app = await openApp(browser, artifact);
      try {
        const { page } = app;
        await importText(page, "A.csv", FIXTURE_A4);
        await compute(page, "+", ["1", "2"]);
        await compute(page, "+", ["3", "4"]);
        await page.click('[data-testid="roster-import"]');
        await page.waitForSelector('[data-testid="import-dialog"][open]');
        await page.setInputFiles('[data-testid="roster-file"]', { name: "B.csv", mimeType: "text/csv", buffer: utf8(FIXTURE_B) });
        await page.waitForFunction(() => {
          const summary = document.querySelector('[data-testid="import-summary"]');
          return summary && !summary.hidden && summary.getAttribute("data-count") !== null;
        });
        const sizes = await page.evaluate(() => {
          const rectOf = (element) => {
            const box = element.getBoundingClientRect();
            return [Math.round(box.width * 10) / 10, Math.round(box.height * 10) / 10];
          };
          return {
            keepLabel: rectOf(document.querySelector('[data-testid="import-mode-keep"]').closest("label")),
            keepRadio: rectOf(document.querySelector('[data-testid="import-mode-keep"]')),
            fieldset: rectOf(document.querySelector('[data-testid="import-mode"]')),
          };
        });
        check(checks, "roster-compact.mode-label-height", sizes.keepLabel[1] <= 42.0, JSON.stringify(sizes));
        check(checks, "roster-compact.mode-radio-size", sizes.keepRadio[0] <= 31.0 && sizes.keepRadio[1] <= 31.0 && sizes.keepRadio[0] >= 28 && sizes.keepRadio[1] >= 28, JSON.stringify(sizes));
        check(checks, "roster-compact.mode-fieldset-height", sizes.fieldset[1] <= 120.0, JSON.stringify(sizes));
        const keepLabel = await page.locator('[data-testid="import-mode-keep-label"]').textContent();
        check(checks, "roster-compact.mode-copy", keepLabel.includes("保留") && keepLabel.includes("命中"), keepLabel);
        await page.evaluate(() => {
          const radio = document.querySelector('[data-testid="import-mode-clear"]');
          const label = radio.closest("label");
          const box = label.getBoundingClientRect();
          radio.checked = false;
          label.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: box.left + 60, clientY: box.top + 8 }));
        });
        await page.waitForFunction(() => document.querySelector('[data-testid="import-mode-clear"]').checked);
        const afterLabel = await page.evaluate(() => ({
          clear: document.querySelector('[data-testid="import-mode-clear"]').checked,
          confirm: document.querySelector('[data-testid="import-confirm"]').textContent,
        }));
        check(checks, "roster-compact.mode-click-label", afterLabel.clear === true && afterLabel.confirm.includes("清空"), JSON.stringify(afterLabel));
        clean(checks, "roster-compact.mode-clean", app.pageErrors, app.consoleErrors);
      } finally {
        await app.close();
      }
    }

    // H3: empty `=` skips the current next row.
    {
      const app = await openApp(browser, artifact);
      try {
        const { page } = app;
        await importText(page, "A.csv", FIXTURE_A);
        const before = await skipState(page);
        const storedBefore = before.stored;
        await page.click('[data-testid="key-equals"]');
        const s1 = await skipState(page);
        check(checks, "roster-compact.skip-one", s1.next === "2" && s1.label.includes("跳过") && s1.label.includes("2"), JSON.stringify({ next: s1.next, label: s1.label }));
        check(checks, "roster-compact.skip-pure", s1.stored === storedBefore && s1.filled.every((filled) => filled === "false") && s1.history === before.history && s1.result === before.result && s1.expression === before.expression, JSON.stringify({ next: s1.next, filled: s1.filled }));
        await page.click('[data-testid="key-equals"]');
        const s2 = await skipState(page);
        check(checks, "roster-compact.skip-two", s2.next === "3" && s2.label.includes("跳过"), JSON.stringify({ next: s2.next, label: s2.label }));
        await page.click('[data-testid="key-equals"]');
        const s3 = await skipState(page);
        check(checks, "roster-compact.skip-wrap", s3.next === "1" && s3.label.includes("跳过"), JSON.stringify({ next: s3.next, label: s3.label }));
        await page.keyboard.press("=");
        const s4 = await skipState(page);
        check(checks, "roster-compact.skip-physical", s4.next === "2", JSON.stringify({ next: s4.next, label: s4.label }));
        // Recording after a skip writes to seq 2, seq 1 stays empty.
        await compute(page, "+", ["10", "20"]);
        const afterWrite = await page.evaluate(() => ({
          seq1: document.querySelector('[data-testid="roster-row"][data-seq="1"]').dataset.filled,
          seq2: document.querySelector('[data-testid="roster-row"][data-seq="2"]').dataset.filled,
          next: document.querySelector('[data-testid="roster-next"]')?.dataset.seq ?? null,
        }));
        eq(checks, "roster-compact.skip-write-target", afterWrite, { seq1: "false", seq2: "true", next: "3" });
        clean(checks, "roster-compact.skip-clean", app.pageErrors, app.consoleErrors);
      } finally {
        await app.close();
      }
    }

    // H3: skip does not fire when it must not.
    {
      const app = await openApp(browser, artifact);
      try {
        const { page } = app;
        // Full roster: empty `=` keeps the full notice, writes nothing.
        await importText(page, "A.csv", FIXTURE_A);
        await compute(page, "+", ["1", "1"]);
        await compute(page, "+", ["2", "2"]);
        await compute(page, "+", ["3", "3"]);
        eq(checks, "roster-compact.full-next", await nextSeq(page), null);
        const storedFull = await page.evaluate(() => localStorage.getItem("cal-phone.roster.v1"));
        await page.click('[data-testid="key-equals"]');
        const fullAfter = await skipState(page);
        check(checks, "roster-compact.full-skip", fullAfter.label.includes("名单已录满") && fullAfter.stored === storedFull, fullAfter.label);
        // Non-empty input: normal compute path, no skip.
        await page.reload();
        await page.waitForSelector('[data-testid="roster-row"]');
        await page.click('[data-testid="op-picker"] [data-op="+"]');
        await page.click('[data-testid="keypad"] [data-key="5"]');
        await page.click('[data-testid="key-equals"]');
        const typed = await page.evaluate(() => ({
          seq1: document.querySelector('[data-testid="roster-row"][data-seq="1"]').dataset.filled,
          label: document.querySelector("#state-label").textContent,
        }));
        check(checks, "roster-compact.typed-no-skip", typed.seq1 === "true" && !typed.label.includes("跳过"), JSON.stringify(typed));
        // Edit mode: `=` saves the draft instead of skipping.
        await page.locator('[data-testid="roster-row"][data-seq="1"] [data-testid="roster-edit"]').click();
        await page.waitForSelector('[data-testid="edit-draft"]:not([hidden])');
        await page.click('[data-testid="key-equals"]');
        const editAfter = await page.evaluate(() => ({
          state: document.querySelector("main.app").dataset.state,
          label: document.querySelector("#state-label").textContent,
        }));
        check(checks, "roster-compact.edit-no-skip", !editAfter.label.includes("跳过"), JSON.stringify(editAfter));
        clean(checks, "roster-compact.negative-clean", app.pageErrors, app.consoleErrors);
      } finally {
        await app.close();
      }
    }

    return checks;
  },
};

export const scenarios = [rosterCompact];
