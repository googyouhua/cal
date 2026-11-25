import { openApp } from "../lib/browser.mjs";
import { check, clean } from "../lib/check.mjs";
import { compute, importText } from "../lib/roster.mjs";

// Two-line roster contract: line 1 = 序号 + 学号 + 名字 (+ badges),
// line 2 = expression + score + 编辑. Names and ids are never truncated.
const FIXTURE = [
  "序号,学号,姓名,成绩,班级",
  "1,20230101,欧阳娜娜,85,高一3班",
  "2,2023-2024-0001,司马相如,92,高一3班",
  "3,20230103,慕容雪村,78,高一3班",
].join("\r\n");

const EXPECTED_ROWS = [
  { seq: "1", name: "欧阳娜娜", id: "20230101", filled: true },
  { seq: "2", name: "司马相如", id: "2023-2024-0001", filled: false },
  { seq: "3", name: "慕容雪村", id: "20230103", filled: false },
];

// One filled row whose identity cannot fit on a single line: 8-char name
// plus a 17-char id at 320px must wrap inside the card, never ellipsise.
const WRAP_FIXTURE = [
  "序号,学号,姓名,成绩,班级",
  "1,2023-2024-0001-A,欧阳娜娜慕容雪村,88,高一3班",
].join("\r\n");

// Measured child kinds in the editing state (row 1 is the filled/edited row,
// row 2 carries 下一位, empty rows hide the expression via display:none).
const EXPECTED_CARD_EDITING = {
  "1": ["seq", "name", "id", "expression", "score", "edit", "editBadge"],
  "2": ["seq", "name", "id", "score", "nextBadge"],
  "3": ["seq", "name", "id", "score"],
};

async function measureRows(page) {
  return page.evaluate(() => {
    const range = document.createRange();
    const rectOf = (element) => {
      const box = element.getBoundingClientRect();
      return {
        top: Math.round(box.top * 10) / 10,
        bottom: Math.round(box.bottom * 10) / 10,
        left: Math.round(box.left * 10) / 10,
        right: Math.round(box.right * 10) / 10,
        width: Math.round(box.width * 10) / 10,
        height: Math.round(box.height * 10) / 10,
      };
    };
    // Unrounded text width against the element's content box. `ok` is the
    // single verdict; a zero-width/content element is a hard failure, never
    // a negative box.
    const clipOf = (element) => {
      if (!element) return null;
      const style = getComputedStyle(element);
      range.selectNodeContents(element);
      const text = range.getBoundingClientRect();
      const contentWidth =
        element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return {
        text: text.width,
        box: contentWidth,
        zero: contentWidth <= 0,
        ok: contentWidth > 0 && text.width <= contentWidth + 0.5,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
      };
    };
    const scrollOf = (element) =>
      element
        ? {
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            scrollHeight: element.scrollHeight,
            clientHeight: element.clientHeight,
          }
        : null;
    // Count distinct line bands occupied by the identity's child text.
    // Separate flex items that wrapped sit on different tops.
    const lineBands = (element) => {
      if (!element) return 0;
      const tops = [];
      for (const child of element.children) {
        const childRange = document.createRange();
        childRange.selectNodeContents(child);
        for (const rect of childRange.getClientRects()) {
          if (rect.width > 0 && rect.height > 0) tops.push(rect.top);
        }
      }
      tops.sort((a, b) => a - b);
      let bands = 0;
      let previous = Number.NEGATIVE_INFINITY;
      for (const top of tops) {
        if (top - previous > 4) {
          bands += 1;
          previous = top;
        }
      }
      return bands;
    };
    return [...document.querySelectorAll('[data-testid="roster-row"]')].map((row) => {
      const top = row.querySelector(".roster-top");
      const bottom = row.querySelector(".roster-bottom");
      const pick = (selector) => row.querySelector(selector);
      const identity = row.querySelector(".roster-identity");
      return {
        seq: row.dataset.seq,
        filled: row.dataset.filled,
        row: rectOf(row),
        rowScroll: scrollOf(row),
        borderTop: getComputedStyle(row).borderTopWidth,
        top: top ? rectOf(top) : null,
        topDisplay: top ? getComputedStyle(top).display : null,
        bottom: bottom ? rectOf(bottom) : null,
        bottomDisplay: bottom ? getComputedStyle(bottom).display : null,
        topKids: top ? [...top.children].map((element) => element.className) : [],
        bottomKids: bottom ? [...bottom.children].map((element) => element.className) : [],
        bottomKidsTestIds: bottom
          ? [...bottom.children].map((element) => element.getAttribute("data-testid") || "")
          : [],
        identityKids: identity ? [...identity.children].map((element) => element.className) : [],
        identityWrap: identity ? getComputedStyle(identity).flexWrap : null,
        identityScroll: scrollOf(identity),
        identityLines: lineBands(identity),
        expressionInBottom: bottom ? bottom.contains(pick('[data-testid="roster-expression"]')) : false,
        scoreInBottom: bottom ? bottom.contains(pick('[data-testid="roster-score"]')) : false,
        editInBottom: bottom ? bottom.contains(pick('[data-testid="roster-edit"]')) : false,
        seqBox: pick(".roster-seq") ? rectOf(pick(".roster-seq")) : null,
        seqText: pick(".roster-seq") ? pick(".roster-seq").textContent : null,
        name: pick(".roster-name") ? rectOf(pick(".roster-name")) : null,
        nameText: pick(".roster-name") ? pick(".roster-name").textContent : null,
        idBox: pick(".roster-id") ? rectOf(pick(".roster-id")) : null,
        idText: pick(".roster-id") ? pick(".roster-id").textContent : null,
        nameClip: clipOf(pick(".roster-name")),
        idClip: clipOf(pick(".roster-id")),
        score: pick('[data-testid="roster-score"]') ? rectOf(pick('[data-testid="roster-score"]')) : null,
        scoreText: pick('[data-testid="roster-score"]') ? pick('[data-testid="roster-score"]').textContent : null,
        scoreValue: pick('[data-testid="roster-score"]')
          ? pick('[data-testid="roster-score"]').getAttribute("data-value")
          : null,
        expression: pick('[data-testid="roster-expression"]')
          ? rectOf(pick('[data-testid="roster-expression"]'))
          : null,
        expressionText: pick('[data-testid="roster-expression"]')
          ? pick('[data-testid="roster-expression"]').textContent
          : null,
        edit: pick('[data-testid="roster-edit"]') ? rectOf(pick('[data-testid="roster-edit"]')) : null,
        editLabel: pick('[data-testid="roster-edit"]')
          ? pick('[data-testid="roster-edit"]').getAttribute("aria-label")
          : null,
        nextBadge: pick(".roster-next-badge") ? rectOf(pick(".roster-next-badge")) : null,
        nextBadgeText: pick(".roster-next-badge") ? pick(".roster-next-badge").textContent : null,
        editBadge: pick(".roster-edit-badge") ? rectOf(pick(".roster-edit-badge")) : null,
        editBadgeText: pick(".roster-edit-badge") ? pick(".roster-edit-badge").textContent : null,
      };
    });
  });
}

async function overflowState(page) {
  return page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
}

export const rosterTwoLine = {
  id: "roster-two-line",
  async run({ browser, artifact }) {
    const checks = [];

    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
      const label = viewport.width === 390 ? "wide" : "narrow";
      const app = await openApp(browser, artifact, { viewport, isMobile: true, hasTouch: true });
      try {
        const { page } = app;
        await importText(page, "two-line.csv", FIXTURE);
        await compute(page, "+", ["12", "30"]);

        const rows = await measureRows(page);

        // Rendered identity strings are proven against the fixture, not
        // inferred; the filled row's score text must equal its data-value.
        const identityText = rows.map((row, index) => {
          const expected = EXPECTED_ROWS[index];
          const ok =
            expected !== undefined &&
            row.seq === expected.seq &&
            row.seqText === expected.seq &&
            row.nameText === expected.name &&
            row.idText === expected.id &&
            (row.filled === "true") === expected.filled;
          return {
            index,
            ok,
            seq: row.seq,
            seqText: row.seqText,
            name: row.nameText,
            id: row.idText,
            filled: row.filled,
            scoreText: row.scoreText,
            scoreValue: row.scoreValue,
          };
        });
        const filledText = rows.find((row) => row.filled === "true");
        check(
          checks,
          `roster-two-line.${label}.identity-text`,
          rows.length === EXPECTED_ROWS.length &&
            identityText.every((row) => row.ok) &&
            filledText !== undefined &&
            filledText.scoreText === "42" &&
            filledText.scoreValue === "42",
          JSON.stringify(identityText),
        );

        // No ancestor may clamp the identity or the row: scroll extents must
        // equal the client box.
        const clamps = rows.map((row) => ({
          seq: row.seq,
          row: row.rowScroll,
          identity: row.identityScroll,
          ok:
            row.rowScroll.scrollWidth <= row.rowScroll.clientWidth + 0.5 &&
            row.rowScroll.scrollHeight <= row.rowScroll.clientHeight + 0.5 &&
            row.identityScroll !== null &&
            row.identityScroll.scrollWidth <= row.identityScroll.clientWidth + 0.5 &&
            row.identityScroll.scrollHeight <= row.identityScroll.clientHeight + 0.5,
        }));
        check(checks, `roster-two-line.${label}.no-clamp`, rows.length === 3 && clamps.every((row) => row.ok), JSON.stringify(clamps));

        // Line 1 / line 2 are real stacked flex boxes: both have height,
        // line 2 starts below line 1 and both compute to `display: flex`.
        const stacked = rows.map((row) => ({
          seq: row.seq,
          ok:
            row.top !== null &&
            row.bottom !== null &&
            row.top.height > 0 &&
            row.bottom.height > 0 &&
            row.bottom.top >= row.top.bottom - 0.5 &&
            row.topDisplay === "flex" &&
            row.bottomDisplay === "flex",
          top: row.top,
          bottom: row.bottom,
          topDisplay: row.topDisplay,
          bottomDisplay: row.bottomDisplay,
        }));
        check(checks, `roster-two-line.${label}.stacked`, rows.length === 3 && stacked.every((row) => row.ok), JSON.stringify(stacked));

        // Line 1 order: 序号, 学号, 名字 — 学号 before 名字. Line 1 is only
        // allowed to hold seq, identity and the two badges; the calculation
        // children must never migrate up into .roster-top.
        const ALLOWED_TOP_KIDS = ["roster-seq", "roster-identity", "roster-next-badge", "roster-edit-badge"];
        const order = rows.map((row) => ({
          seq: row.seq,
          topKids: row.topKids,
          identityKids: row.identityKids,
        }));
        check(
          checks,
          `roster-two-line.${label}.line1-order`,
          rows.length === 3 &&
            order.every(
              (row) =>
                row.topKids[0] === "roster-seq" &&
                row.topKids[1] === "roster-identity" &&
                row.topKids.every((kid) => ALLOWED_TOP_KIDS.includes(kid)) &&
                row.identityKids.indexOf("roster-id") !== -1 &&
                row.identityKids.indexOf("roster-id") < row.identityKids.indexOf("roster-name"),
            ),
          JSON.stringify(order),
        );

        // 名字 and 学号 are never ellipsised: no truncation style, and the
        // full text (DOM Range) fits inside the element content box.
        const ellipsis = rows.map((row) => ({
          seq: row.seq,
          name: row.nameClip,
          id: row.idClip,
          wrap: row.identityWrap,
        }));
        check(
          checks,
          `roster-two-line.${label}.no-ellipsis`,
          rows.length === 3 &&
            ellipsis.every(
              (row) =>
                row.name &&
                row.name.textOverflow !== "ellipsis" &&
                row.name.whiteSpace !== "nowrap" &&
                (row.id === null || (row.id.textOverflow !== "ellipsis" && row.id.whiteSpace !== "nowrap")) &&
                row.wrap !== "nowrap",
            ),
          JSON.stringify(ellipsis),
        );
        const clipped = rows.map((row) => ({
          seq: row.seq,
          nameText: row.nameText,
          nameClip: row.nameClip,
          idText: row.idText,
          idClip: row.idClip,
        }));
        check(
          checks,
          `roster-two-line.${label}.no-clip`,
          rows.length === 3 &&
            clipped.every(
              (row) =>
                row.nameClip &&
                row.nameClip.ok === true &&
                (row.idClip === null || row.idClip.ok === true),
            ),
          JSON.stringify(clipped),
        );

        // Line 2 sits below line 1: expression/score start under the name.
        const below = rows.map((row) => ({
          seq: row.seq,
          ok: row.score && row.name ? row.score.top >= row.name.bottom - 1.0 : false,
          nameBottom: row.name ? row.name.bottom : null,
          scoreTop: row.score ? row.score.top : null,
          expressionTop: row.expression ? row.expression.top : null,
        }));
        check(checks, `roster-two-line.${label}.line2-below`, rows.length === 3 && below.every((row) => row.ok), JSON.stringify(below));

        // Filled row: line 2 holds exactly expression + score + 编辑, line 1
        // unchanged. Parentage is asserted so the calculation can never drift
        // into line 1, and the aria-label is checked literally.
        const filled = rows.filter((row) => row.filled === "true");
        check(
          checks,
          `roster-two-line.${label}.filled-line2`,
          filled.length === 1 &&
            filled.every(
              (row) =>
                row.expressionText.trim().length > 0 &&
                row.scoreValue !== null &&
                row.edit !== null &&
                row.editLabel === "编辑第 1 位 欧阳娜娜 的成绩" &&
                row.expressionInBottom === true &&
                row.scoreInBottom === true &&
                row.editInBottom === true &&
                JSON.stringify(row.bottomKids) === JSON.stringify(["roster-expression", "roster-score", "roster-edit"]) &&
                JSON.stringify(row.bottomKidsTestIds) === JSON.stringify(["roster-expression", "roster-score", "roster-edit"]),
            ),
          JSON.stringify(
            filled.map((row) => ({
              seq: row.seq,
              expressionText: row.expressionText,
              scoreValue: row.scoreValue,
              editLabel: row.editLabel,
              inBottom: { expression: row.expressionInBottom, score: row.scoreInBottom, edit: row.editInBottom },
              bottomKids: row.bottomKids,
              bottomKidsTestIds: row.bottomKidsTestIds,
            })),
          ),
        );

        // Empty rows: line 1 identity, line 2 exactly expression + `—`, no 编辑.
        const empty = rows.filter((row) => row.filled !== "true");
        check(
          checks,
          `roster-two-line.${label}.empty-line2`,
          empty.length === 2 &&
            empty.every(
              (row) =>
                row.scoreText.trim() === "—" &&
                row.expressionText.trim() === "" &&
                row.edit === null &&
                row.name !== null &&
                JSON.stringify(row.bottomKids) === JSON.stringify(["roster-expression", "roster-score empty"]) &&
                JSON.stringify(row.bottomKidsTestIds) === JSON.stringify(["roster-expression", "roster-score"]),
            ),
          JSON.stringify(
            empty.map((row) => ({
              seq: row.seq,
              scoreText: row.scoreText,
              expressionText: row.expressionText,
              hasEdit: row.edit !== null,
              bottomKids: row.bottomKids,
              bottomKidsTestIds: row.bottomKidsTestIds,
            })),
          ),
        );

        // 下一位 badge sits on line 1, inside the row card.
        const next = rows.find((row) => row.nextBadge !== null);
        check(
          checks,
          `roster-two-line.${label}.next-on-line1`,
          next !== undefined &&
            next.top !== null &&
            next.top.height > 0 &&
            next.nextBadge.top >= next.top.top - 0.5 &&
            next.nextBadge.bottom <= next.top.bottom + 0.5 &&
            next.nextBadge.left >= next.row.left - 0.5 &&
            next.nextBadge.right <= next.row.right + 0.5,
          JSON.stringify(next),
        );

        // Two-line rows are taller than the old single-line caps:
        // filled 50–140px, empty 42–120px (edit button drives line 2).
        const heights = rows.map((row) => ({ seq: row.seq, filled: row.filled, h: row.row.height }));
        check(
          checks,
          `roster-two-line.${label}.filled-height`,
          filled.length === 1 && filled.every((row) => row.row.height >= 50.0 && row.row.height <= 140.0),
          JSON.stringify(heights),
        );
        check(
          checks,
          `roster-two-line.${label}.empty-height`,
          empty.length === 2 && empty.every((row) => row.row.height >= 42.0 && row.row.height <= 120.0),
          JSON.stringify(heights),
        );

        // No horizontal page overflow at either width.
        const over = await overflowState(page);
        check(checks, `roster-two-line.${label}.no-overflow`, over.doc <= 1 && over.body <= 1, JSON.stringify(over));

        // 编辑中 badge sits on line 1 and never pushes the name or 学号 off-card.
        await page.locator('[data-testid="roster-row"][data-seq="1"] [data-testid="roster-edit"]').click();
        await page.waitForSelector(".roster-edit-badge");
        const afterEdit = await measureRows(page);
        const editing = afterEdit.find((row) => row.seq === "1");
        check(
          checks,
          `roster-two-line.${label}.editing-on-line1`,
          editing !== undefined &&
            editing.editBadge !== null &&
            editing.editBadgeText.includes("编辑中") &&
            editing.top !== null &&
            editing.top.height > 0 &&
            editing.editBadge.top >= editing.top.top - 0.5 &&
            editing.editBadge.bottom <= editing.top.bottom + 0.5 &&
            editing.nameClip.ok === true &&
            editing.idClip.ok === true &&
            editing.idBox.left >= editing.row.left - 0.5 &&
            editing.idBox.right <= editing.row.right + 0.5 &&
            editing.idBox.top >= editing.row.top - 0.5 &&
            editing.idBox.bottom <= editing.row.bottom + 0.5 &&
            editing.editBadge.right <= editing.row.right + 0.5,
          JSON.stringify(editing),
        );

        // Row stays one card: single border, every measured child inside the
        // row's horizontal AND vertical bounds, exact measured-child list so a
        // vanished child cannot silently drop out of the filter. Measured in
        // the editing state so the 编辑中 badge is live too.
        const card = afterEdit.map((row) => {
          const children = [
            ["seq", row.seqBox],
            ["name", row.name],
            ["id", row.idBox],
            ["expression", row.expression],
            ["score", row.score],
            ["edit", row.edit],
            ["nextBadge", row.nextBadge],
            ["editBadge", row.editBadge],
          ].filter(([, box]) => box !== null && box.width > 0 && box.height > 0);
          const kinds = children.map(([kind]) => kind);
          const expectedKinds = EXPECTED_CARD_EDITING[row.seq] ?? [];
          const outside = children
            .filter(
              ([, box]) =>
                box.left < row.row.left - 0.5 ||
                box.right > row.row.right + 0.5 ||
                box.top < row.row.top - 0.5 ||
                box.bottom > row.row.bottom + 0.5,
            )
            .map(([kind]) => kind);
          return {
            seq: row.seq,
            borderTop: row.borderTop,
            checked: kinds.length,
            expected: expectedKinds.length,
            kinds,
            outside,
          };
        });
        check(
          checks,
          `roster-two-line.${label}.one-card`,
          afterEdit.length === 3 &&
            card.every(
              (row) =>
                row.borderTop === "1px" &&
                row.checked === row.expected &&
                JSON.stringify(row.kinds) === JSON.stringify(EXPECTED_CARD_EDITING[row.seq]) &&
                row.outside.length === 0,
            ),
          JSON.stringify(card),
        );

        clean(checks, `roster-two-line.${label}.clean`, app.pageErrors, app.consoleErrors);
      } finally {
        await app.close();
      }
    }

    // Wrap path at 320px: an 8-char name plus a 17-char id cannot share one
    // line, so the identity must wrap inside the card with nothing clipped.
    {
      const app = await openApp(browser, artifact, {
        viewport: { width: 320, height: 568 },
        isMobile: true,
        hasTouch: true,
      });
      try {
        const { page } = app;
        await importText(page, "wrap.csv", WRAP_FIXTURE);
        await compute(page, "+", ["40", "2"]);
        const rows = await measureRows(page);
        const row = rows[0];
        check(
          checks,
          "roster-two-line.wrap.wraps",
          rows.length === 1 &&
            row !== undefined &&
            row.filled === "true" &&
            row.identityLines >= 2 &&
            row.name !== null &&
            row.idBox !== null &&
            row.name.left >= row.row.left - 0.5 &&
            row.name.right <= row.row.right + 0.5 &&
            row.name.top >= row.row.top - 0.5 &&
            row.name.bottom <= row.row.bottom + 0.5 &&
            row.idBox.left >= row.row.left - 0.5 &&
            row.idBox.right <= row.row.right + 0.5 &&
            row.idBox.top >= row.row.top - 0.5 &&
            row.idBox.bottom <= row.row.bottom + 0.5,
          JSON.stringify({
            count: rows.length,
            identityLines: row && row.identityLines,
            name: row && row.name,
            id: row && row.idBox,
            row: row && row.row,
            identity: row && row.identityScroll,
          }),
        );
        check(
          checks,
          "roster-two-line.wrap.text",
          row !== undefined &&
            row.nameText === "欧阳娜娜慕容雪村" &&
            row.idText === "2023-2024-0001-A" &&
            row.nameClip.ok === true &&
            row.idClip.ok === true,
          JSON.stringify({
            nameText: row && row.nameText,
            idText: row && row.idText,
            nameClip: row && row.nameClip,
            idClip: row && row.idClip,
          }),
        );
        const over = await overflowState(page);
        check(checks, "roster-two-line.wrap.overflow", over.doc <= 1 && over.body <= 1, JSON.stringify(over));
        clean(checks, "roster-two-line.wrap.clean", app.pageErrors, app.consoleErrors);
      } finally {
        await app.close();
      }
    }

    // 50-row roster at both widths: no horizontal overflow, page height inside
    // the two-line budget (single-line layout needed <= 2800; 50 two-line rows
    // measure ~3400px, so <= 4200 keeps ~20% headroom), average row height
    // above the old 38px single-line empty cap, and a per-row floor so one
    // collapsed row fails.
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
      const label = viewport.width === 390 ? "wide" : "narrow";
      const app = await openApp(browser, artifact, { viewport, isMobile: true, hasTouch: true });
      try {
        const { page } = app;
        const many = ["学号,姓名", ...Array.from({ length: 50 }, (_, index) => `S${index + 1},学生${index + 1}`)].join("\n");
        await importText(page, "fifty.csv", many);
        const stats = await page.evaluate(() => {
          const list = [...document.querySelectorAll('[data-testid="roster-row"]')];
          const heights = list.map((row) => Math.round(row.getBoundingClientRect().height * 10) / 10);
          const total = heights.reduce((sum, height) => sum + height, 0);
          return {
            count: list.length,
            scrollHeight: document.documentElement.scrollHeight,
            heights,
            avg: list.length ? total / list.length : 0,
          };
        });
        check(checks, `roster-two-line.fifty.${label}.rows`, stats.count === 50, `count=${stats.count}`);
        check(checks, `roster-two-line.fifty.${label}.budget`, stats.scrollHeight <= 4200, `scrollHeight=${stats.scrollHeight} budget=4200`);
        check(
          checks,
          `roster-two-line.fifty.${label}.two-line`,
          stats.avg >= 42.0,
          `avgRowHeight=${Math.round(stats.avg * 10) / 10} floor=42`,
        );
        check(
          checks,
          `roster-two-line.fifty.${label}.min-row`,
          stats.heights.every((height) => height >= 42.0),
          `minRowHeight=${Math.min(...stats.heights)} floor=42`,
        );
        const over = await overflowState(page);
        check(checks, `roster-two-line.fifty.${label}.overflow`, over.doc <= 1 && over.body <= 1, JSON.stringify(over));
        clean(checks, `roster-two-line.fifty.${label}.clean`, app.pageErrors, app.consoleErrors);
      } finally {
        await app.close();
      }
    }

    return checks;
  },
};

export const scenarios = [rosterTwoLine];
