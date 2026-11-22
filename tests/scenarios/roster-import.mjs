import fs from "node:fs";
import { openApp } from "../lib/browser.mjs";
import { check, eq, clean } from "../lib/check.mjs";
import { gbk, importBuffer, importPaste, importText, rosterRows, utf8 } from "../lib/roster.mjs";

const FIXTURE_A = [
  "序号,学号,姓名,成绩,班级",
  "1,20230101,张三,85,高一3班",
  "2,20230102,李四,92,高一3班",
  "3,20230103,王五,78,高一3班",
].join("\r\n");

async function previewCase(browser, artifact, { name, buffer }) {
  const app = await openApp(browser, artifact);
  try {
    const { page } = app;
    await page.click('[data-testid="roster-import"]');
    await page.waitForSelector('[data-testid="import-dialog"][open]');
    await page.setInputFiles('[data-testid="roster-file"]', { name, mimeType: "text/csv", buffer });
    await page.waitForFunction(() => {
      const summary = document.querySelector('[data-testid="import-summary"]');
      return summary && !summary.hidden && summary.getAttribute("data-count") !== null;
    });
    const out = {
      count: await page.locator('[data-testid="import-summary"]').getAttribute("data-count"),
      summary: (await page.locator('[data-testid="import-summary"]').textContent()).trim(),
      preview: await page.locator('[data-testid="import-preview"] .import-preview-row').allTextContents(),
      map: await page.evaluate(() => {
        const map = document.querySelector('[data-testid="import-map"]');
        return [map.dataset.idIndex, map.dataset.nameIndex, map.dataset.scoreIndex, map.dataset.seqIndex];
      }),
    };
    await page.click('[data-testid="import-confirm"]');
    await page.waitForFunction(
      (expected) => document.querySelectorAll('[data-testid="roster-row"]').length === expected,
      Number(out.count),
    );
    out.rows = await rosterRows(page);
    out.clean = app.pageErrors.length === 0 && app.consoleErrors.length === 0;
    out.errors = [...app.pageErrors, ...app.consoleErrors];
    return out;
  } finally {
    await app.close();
  }
}

async function rejectionCase(browser, artifact, name, buffer) {
  const app = await openApp(browser, artifact);
  try {
    const { page } = app;
    await page.click('[data-testid="roster-import"]');
    await page.waitForSelector('[data-testid="import-dialog"][open]');
    await page.setInputFiles('[data-testid="roster-file"]', { name, mimeType: "text/csv", buffer });
    await page.waitForFunction(() => document.querySelector('[data-testid="import-dialog"]').getAttribute("data-error") === "true");
    return {
      open: await page.locator('[data-testid="import-dialog"]').evaluate((dialog) => dialog.open),
      error: (await page.locator('[data-testid="import-error"]').textContent()).trim(),
      summaryHidden: await page.locator('[data-testid="import-summary"]').isHidden(),
      rows: await page.locator('[data-testid="roster-row"]').count(),
      storage: await page.evaluate(() => localStorage.getItem("cal-phone.roster.v1")),
      clean: app.pageErrors.length === 0 && app.consoleErrors.length === 0,
    };
  } finally {
    await app.close();
  }
}

export const rosterImport = {
  id: "roster-import",
  async run({ browser, artifact }) {
    const checks = [];

    const bomComma = await previewCase(browser, artifact, { name: "bom.csv", buffer: utf8(FIXTURE_A, true) });
    eq(checks, "roster-import.bom.count", bomComma.count, "3");
    check(checks, "roster-import.bom.summary", bomComma.summary.includes("识别到 3 人"), bomComma.summary);
    eq(checks, "roster-import.bom.map", bomComma.map, ["1", "2", "3", "0"]);
    eq(checks, "roster-import.bom.rows", bomComma.rows.map((row) => [row.seq, row.name, row.id, row.filled]), [
      ["1", "张三", "20230101", "false"],
      ["2", "李四", "20230102", "false"],
      ["3", "王五", "20230103", "false"],
    ]);
    eq(checks, "roster-import.bom.clean", bomComma.clean, true, bomComma.errors.join("|"));

    const semicolon = await previewCase(browser, artifact, {
      name: "semi.csv",
      buffer: utf8("学号;名字;班级\n20230104;赵六;高二1班\n20230105;钱七;高二1班\n"),
    });
    eq(checks, "roster-import.semicolon.count", semicolon.count, "2");
    eq(checks, "roster-import.semicolon.map", semicolon.map, ["0", "1", "", ""]);
    eq(checks, "roster-import.semicolon.rows", semicolon.rows.map((row) => [row.seq, row.name, row.id]), [
      ["1", "赵六", "20230104"],
      ["2", "钱七", "20230105"],
    ]);

    const tabbed = await previewCase(browser, artifact, {
      name: "gbk.tsv",
      buffer: gbk("考号\t姓名\t得分\n20230106\t孙八\t88\n20230107\t周九\t91\n"),
    });
    eq(checks, "roster-import.gbk.count", tabbed.count, "2");
    eq(checks, "roster-import.gbk.rows", tabbed.rows.map((row) => [row.seq, row.name, row.id]), [
      ["1", "孙八", "20230106"],
      ["2", "周九", "20230107"],
    ]);

    const crlf = await previewCase(browser, artifact, {
      name: "crlf.csv",
      buffer: utf8("姓名,学号\r\n吴十,20230109\r\n郑一,20230110\r\n"),
    });
    eq(checks, "roster-import.crlf.count", crlf.count, "2");
    eq(checks, "roster-import.crlf.rows", crlf.rows.map((row) => [row.name, row.id]), [["吴十", "20230109"], ["郑一", "20230110"]]);

    const loneCR = await previewCase(browser, artifact, {
      name: "lonecr.csv",
      buffer: utf8("姓名,学号\r吴十,20230109\r郑一,20230110\r"),
    });
    eq(checks, "roster-import.lonecr.rows", loneCR.rows.map((row) => [row.name, row.id]), [["吴十", "20230109"], ["郑一", "20230110"]]);

    const quoted = await previewCase(browser, artifact, {
      name: "quoted.csv",
      buffer: utf8('姓名,学号,备注\n"张,三",20230111,"含,逗号"\n"李""四",20230112,"含\n换行"\n'),
    });
    eq(checks, "roster-import.quoted.count", quoted.count, "2");
    eq(checks, "roster-import.quoted.names", quoted.rows.map((row) => [row.name, row.id]), [["张,三", "20230111"], ['李"四', "20230112"]]);

    const synonyms = await previewCase(browser, artifact, {
      name: "synonyms.csv",
      buffer: utf8("班级,名字,姓名,学号\n高一3班,小三,张三,20230101\n"),
    });
    eq(checks, "roster-import.synonyms.map", synonyms.map, ["3", "1", "", ""]);
    eq(checks, "roster-import.synonyms.rows", synonyms.rows.map((row) => [row.name, row.id]), [["小三", "20230101"]]);

    const missingId = await previewCase(browser, artifact, {
      name: "missing-id.csv",
      buffer: utf8("姓名,班级\n吴十,高三1班\n"),
    });
    eq(checks, "roster-import.missing-id.rows", missingId.rows.map((row) => [row.name, row.id]), [["吴十", ""]]);

    const missingName = await previewCase(browser, artifact, {
      name: "missing-name.csv",
      buffer: utf8("学号,备注\n20230108,无姓名\n"),
    });
    eq(checks, "roster-import.missing-name.rows", missingName.rows.map((row) => [row.name, row.id]), [["", "20230108"]]);

    const ragged = await previewCase(browser, artifact, {
      name: "ragged.csv",
      buffer: utf8("学号,姓名,班级\n20230120,甲\n\n20230121,乙,高一,多余\n,,\n20230122,丙,高二\n"),
    });
    eq(checks, "roster-import.ragged.count", ragged.count, "3");
    eq(checks, "roster-import.ragged.rows", ragged.rows.map((row) => [row.seq, row.name, row.id]), [
      ["1", "甲", "20230120"],
      ["2", "乙", "20230121"],
      ["3", "丙", "20230122"],
    ]);

    const skipped = await previewCase(browser, artifact, {
      name: "skipped.csv",
      buffer: utf8("学号,姓名\n20230130,甲\n,\n20230131,乙\n"),
    });
    eq(checks, "roster-import.skipped.seq", skipped.rows.map((row) => row.seq), ["1", "2"]);

    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      await importPaste(page, FIXTURE_A);
      const pasted = await rosterRows(page);
      eq(checks, "roster-import.paste.rows", pasted.map((row) => [row.seq, row.name, row.id]), [
        ["1", "张三", "20230101"],
        ["2", "李四", "20230102"],
        ["3", "王五", "20230103"],
      ]);
      eq(checks, "roster-import.paste.filename", await page.textContent("#history-note"), "粘贴名单");
      clean(checks, "roster-import.paste.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }

    for (const [id, name, buffer] of [
      ["empty", "empty.csv", Buffer.alloc(0)],
      ["blank", "blank.csv", utf8("\n\n")],
      ["noheader", "noheader.csv", utf8(",,\n,,\n")],
      ["binary", "binary.csv", Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe])],
    ]) {
      const rejected = await rejectionCase(browser, artifact, name, buffer);
      eq(checks, `roster-import.reject-${id}.open`, rejected.open, true);
      check(checks, `roster-import.reject-${id}.error`, rejected.error !== "", rejected.error);
      eq(checks, `roster-import.reject-${id}.rows`, rejected.rows, 0);
      eq(checks, `roster-import.reject-${id}.storage`, rejected.storage, null);
      eq(checks, `roster-import.reject-${id}.clean`, rejected.clean, true);
    }

    const sampleApp = await openApp(browser, artifact);
    try {
      const { page } = sampleApp;
      await page.click('[data-testid="roster-import"]');
      await page.waitForSelector('[data-testid="import-dialog"][open]');
      const [download] = await Promise.all([page.waitForEvent("download"), page.click('[data-testid="import-sample"]')]);
      const filePath = await download.path();
      const sampleBuffer = fs.readFileSync(filePath);
      eq(checks, "roster-import.sample.bom", [...sampleBuffer.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
      const sampleLines = sampleBuffer.toString("utf8").replace(/^﻿/, "").split("\r\n").filter((line) => line !== "");
      check(checks, "roster-import.sample.lines", sampleLines.length >= 4, sampleLines.join("|"));
      clean(checks, "roster-import.sample.clean", sampleApp.pageErrors, sampleApp.consoleErrors);
    } finally {
      await sampleApp.close();
    }

    return checks;
  },
};

export const scenarios = [rosterImport];
