import { openApp } from "../lib/browser.mjs";
import { S } from "../lib/selectors.mjs";
import { check, eq, clean } from "../lib/check.mjs";
import { appState } from "../lib/dom.mjs";
import { compute, importText, rosterRows, utf8 } from "../lib/roster.mjs";

const FIXTURE_A = [
  "序号,学号,姓名,成绩,班级",
  "1,20230101,张三,85,高一3班",
  "2,20230102,李四,92,高一3班",
  "3,20230103,王五,78,高一3班",
].join("\r\n");

async function openPreviewText(page, name, text, { bom = false } = {}) {
  await page.click('[data-testid="roster-import"]');
  await page.waitForSelector('[data-testid="import-dialog"][open]');
  await page.setInputFiles('[data-testid="roster-file"]', { name, mimeType: "text/csv", buffer: utf8(text, bom) });
  await page.waitForFunction(() => {
    const summary = document.querySelector('[data-testid="import-summary"]');
    return summary && !summary.hidden && summary.getAttribute("data-count") !== null;
  });
}

async function overflowState(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const dialog = document.querySelector('[data-testid="import-dialog"]');
    const dialogScroll = dialog && dialog.open
      ? { scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth }
      : null;
    return {
      doc: doc.scrollWidth - doc.clientWidth,
      body: body.scrollWidth - body.clientWidth,
      dialog: dialogScroll,
    };
  });
}

async function controlsState(page) {
  return page.$$eval("input,button,select,textarea", (elements) =>
    elements
      .filter((element) => {
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || element.disabled) return false;
        if (element.getClientRects().length === 0) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        return true;
      })
      .map((element) => ({
        kind: element.tagName.toLowerCase(),
        testid: element.getAttribute("data-testid") || element.getAttribute("data-key") || element.getAttribute("data-op") || element.tagName,
        rect: (() => { const rect = element.getBoundingClientRect(); return [Math.round(rect.width * 10) / 10, Math.round(rect.height * 10) / 10]; })(),
        font: parseFloat(getComputedStyle(element).fontSize),
      })),
  );
}

async function rosterFontSizes(page) {
  return page.evaluate(() => {
    const pick = (selector) => {
      const element = document.querySelector(selector);
      return element ? parseFloat(getComputedStyle(element).fontSize) : null;
    };
    return {
      row: pick('[data-testid="roster-row"] .roster-name'),
      score: pick('[data-testid="roster-score"]'),
      expression: pick('[data-testid="roster-expression"]'),
    };
  });
}

export const rosterLayout = {
  id: "roster-layout",
  async run({ browser, artifact }) {
    const checks = [];

    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
      const label = viewport.width === 390 ? "wide" : "narrow";
      const app = await openApp(browser, artifact, { viewport, isMobile: true, hasTouch: true });
      try {
        const { page } = app;
        const over0 = await overflowState(page);
        check(checks, `roster-layout.${label}.entry-overflow`, over0.doc <= 1 && over0.body <= 1, JSON.stringify(over0));

        await page.click('[data-testid="roster-import"]');
        await page.waitForSelector('[data-testid="import-dialog"][open]');
        const overDialog = await overflowState(page);
        check(checks, `roster-layout.${label}.dialog-overflow`, overDialog.doc <= 1 && overDialog.dialog.scrollWidth - overDialog.dialog.clientWidth <= 1, JSON.stringify(overDialog));
        eq(checks, `roster-layout.${label}.dialog-tag`, await page.locator('[data-testid="import-dialog"]').evaluate((element) => element.tagName), "DIALOG");
        check(checks, `roster-layout.${label}.dialog-modal`, await page.locator('[data-testid="import-dialog"]').evaluate((element) => element.matches(":modal")), "not modal");
        const activeStart = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-testid"));
        check(checks, `roster-layout.${label}.dialog-focus`, activeStart === "import-select" || activeStart === "import-paste", String(activeStart));

        await page.click('[data-testid="import-paste"]');
        await page.waitForSelector('[data-testid="import-paste-text"]:not([hidden])');
        const overPaste = await overflowState(page);
        check(checks, `roster-layout.${label}.paste-overflow`, overPaste.doc <= 1 && overPaste.dialog.scrollWidth - overPaste.dialog.clientWidth <= 1, JSON.stringify(overPaste));
        await page.click('[data-testid="import-paste-back"]');

        await page.setInputFiles('[data-testid="roster-file"]', { name: "A.csv", mimeType: "text/csv", buffer: utf8(FIXTURE_A, true) });
        await page.waitForFunction(() => {
          const summary = document.querySelector('[data-testid="import-summary"]');
          return summary && !summary.hidden && summary.getAttribute("data-count") !== null;
        });
        const overPreview = await overflowState(page);
        check(checks, `roster-layout.${label}.preview-overflow`, overPreview.doc <= 1 && overPreview.dialog.scrollWidth - overPreview.dialog.clientWidth <= 1, JSON.stringify(overPreview));
        if (viewport.width === 320) {
          const tops = await page.$$eval('[data-testid="import-map"] select', (selects) => selects.map((element) => Math.round(element.getBoundingClientRect().top)));
          const distinct = new Set(tops).size;
          check(checks, `roster-layout.${label}.selects-vertical`, distinct === 4, tops.join(","));
        }
        const previewControls = await controlsState(page);
        const small = previewControls.filter((control) => control.rect[0] < 28.0 || control.rect[1] < 28.0);
        check(checks, `roster-layout.${label}.preview-controls`, small.length === 0, JSON.stringify(small.slice(0, 5)));
        const smallFonts = previewControls.filter((control) => control.kind !== "button" && control.font < 15.5);
        check(checks, `roster-layout.${label}.preview-fonts`, smallFonts.length === 0, JSON.stringify(smallFonts.slice(0, 5)));
        await page.click('[data-testid="import-cancel"]');
        await page.waitForFunction(() => !document.querySelector('[data-testid="import-dialog"]').open);
        const afterEsc = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-testid"));
        eq(checks, `roster-layout.${label}.focus-return`, afterEsc, "roster-import");

        await importText(page, "A.csv", FIXTURE_A);
        await compute(page, "+", ["12", "30", "8"]);
        await compute(page, "+", ["9", "1"]);
        const overMixed = await overflowState(page);
        check(checks, `roster-layout.${label}.mixed-overflow`, overMixed.doc <= 1 && overMixed.body <= 1, JSON.stringify(overMixed));
        const fonts = await rosterFontSizes(page);
        check(checks, `roster-layout.${label}.row-font`, fonts.row >= 12.5, JSON.stringify(fonts));
        check(checks, `roster-layout.${label}.score-font`, fonts.score >= 12.5, JSON.stringify(fonts));
        eq(checks, `roster-layout.${label}.list-role`, await page.locator('[data-testid="roster"]').getAttribute("role"), "list");
        eq(checks, `roster-layout.${label}.row-role`, await page.locator('[data-testid="roster-row"]').first().getAttribute("role"), "listitem");
        check(checks, `roster-layout.${label}.edit-label`, (await page.locator('[data-testid="roster-row"][data-seq="2"] [data-testid="roster-edit"]').getAttribute("aria-label")).includes("编辑第 2 位") && (await page.locator('[data-testid="roster-row"][data-seq="2"] [data-testid="roster-edit"]').getAttribute("aria-label")).includes("李四"), await page.locator('[data-testid="roster-row"][data-seq="2"] [data-testid="roster-edit"]').getAttribute("aria-label"));
        check(checks, `roster-layout.${label}.next-text`, (await page.locator('[data-testid="roster-next"]').textContent()).includes("下一位"), await page.locator('[data-testid="roster-next"]').textContent());
        const mixedControls = await controlsState(page);
        const mixedSmall = mixedControls.filter((control) => control.rect[0] < 28.0 || control.rect[1] < 28.0);
        check(checks, `roster-layout.${label}.mixed-controls`, mixedSmall.length === 0, JSON.stringify(mixedSmall.slice(0, 5)));

        const many = ["学号,姓名", ...Array.from({ length: 50 }, (_, index) => `S${index + 1},学生${index + 1}`)].join("\n");
        await importText(page, "fifty.csv", many);
        const overMany = await overflowState(page);
        check(checks, `roster-layout.${label}.fifty-overflow`, overMany.doc <= 1 && overMany.body <= 1, JSON.stringify(overMany));
        clean(checks, `roster-layout.${label}.clean`, app.pageErrors, app.consoleErrors);
      } finally {
        await app.close();
      }
    }

    return checks;
  },
};

export const scenarios = [rosterLayout];
