import fs from "node:fs";
import { openApp } from "../lib/browser.mjs";
import { S } from "../lib/selectors.mjs";
import { check, eq, clean } from "../lib/check.mjs";
import { appState, expressionText, resultValue, resultError, isVisible } from "../lib/dom.mjs";

function countExternalRefs(html) {
  const urls = [];
  const attribute = /<(?:script|link|img)\b[^>]*\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  for (const match of html.matchAll(attribute)) {
    urls.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  for (const match of html.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi)) {
    urls.push(match[1]);
  }
  for (const match of html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    urls.push(match[1]);
  }
  return urls.filter((url) => /^(?:https?:)?\/\//i.test(url.trim())).length;
}

export const selfContained = {
  id: "self-contained",
  async run({ browser, artifact }) {
    const checks = [];
    const html = fs.readFileSync(artifact, "utf8");
    check(checks, "self-contained.html-close", /<\/html>\s*$/i.test(html), `bytes=${Buffer.byteLength(html)}`);
    check(checks, "self-contained.min-bytes", Buffer.byteLength(html) >= 1024, `bytes=${Buffer.byteLength(html)}`);
    eq(checks, "self-contained.external-refs", countExternalRefs(html), 0);

    const app = await openApp(browser, artifact);
    try {
      eq(checks, "self-contained.load.pageerrors", app.pageErrors.length, 0, app.pageErrors.join(" | "));
    } finally {
      await app.close();
    }
    return checks;
  },
};

export function coldStart({ keyMode = "disabled" } = {}) {
  return {
    id: `cold-start`,
    async run({ browser, artifact }) {
      const checks = [];
      const app = await openApp(browser, artifact);
      try {
        const { page } = app;
        eq(checks, "cold-start.state", await appState(page), "select");
        eq(checks, "cold-start.picker-visible", await isVisible(page, S.picker), true);
        eq(
          checks,
          "cold-start.operators",
          await page.$$eval(`${S.picker} [data-op]`, (els) => els.map((el) => el.getAttribute("data-op")).sort()),
          ["*", "+", "-", "/"].sort(),
        );
        eq(checks, "cold-start.expression", await expressionText(page), "");
        eq(checks, "cold-start.result-value", await resultValue(page), null);
        eq(checks, "cold-start.history", await page.$$eval(S.historyItem, (els) => els.length), 0);
        const calcInput = await page.$eval(S.calcInput, (el) => ({ disabled: el.disabled, readOnly: el.readOnly }));
        check(
          checks,
          "cold-start.calc-input-guarded",
          calcInput.disabled || calcInput.readOnly,
          JSON.stringify(calcInput),
        );

        const disabled = await page.$$eval(`${S.keypad} [data-key]`, (els) =>
          els.filter((el) => el.disabled).map((el) => el.getAttribute("data-key")),
        );
        if (keyMode === "disabled") {
          eq(checks, "cold-start.keys-disabled", disabled.length, 14, disabled.join(","));
        } else if (keyMode === "enabled") {
          eq(checks, "cold-start.keys-enabled", disabled.length, 0, disabled.join(","));
        } else {
          check(checks, "cold-start.keys", true, `disabled=${disabled.length} (mode=any)`);
        }
        clean(checks, "cold-start.clean", app.pageErrors, app.consoleErrors);
      } finally {
        await app.close();
      }
      return checks;
    },
  };
}

export const compute = {
  id: "compute",
  async run({ browser, artifact }) {
    const checks = [];
    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      await page.click(`${S.picker} [data-op="+"]`);
      eq(checks, "compute.state-after-op", await appState(page), "input");
      await page.click(`${S.keypad} [data-key="1"]`);
      await page.click(`${S.keypad} [data-key="2"]`);
      await page.click(`${S.keypad} [data-key="enter"]`);
      await page.click(`${S.keypad} [data-key="3"]`);
      await page.click(`${S.keypad} [data-key="0"]`);
      await page.click(`${S.keypad} [data-key="enter"]`);
      const beforeEquals = await expressionText(page);
      check(checks, "compute.expression-before-equals", beforeEquals.includes("12") && beforeEquals.includes("30"), beforeEquals);

      await page.click(`${S.keypad} [data-key="8"]`);
      check(checks, "compute.uncommitted-not-in-expression", !(await expressionText(page)).includes("8"));
      await page.click(S.equals);

      eq(checks, "compute.state", await appState(page), "result");
      eq(checks, "compute.result", await resultValue(page), "50");
      eq(checks, "compute.expression", await expressionText(page), "12 + 30 + 8");
      eq(checks, "compute.history", await page.$$eval(S.historyItem, (els) => els.length), 1);
      eq(
        checks,
        "compute.history-top",
        await page.$eval(S.historyItem, (el) => ({
          operator: el.getAttribute("data-operator"),
          operands: JSON.parse(el.getAttribute("data-operands") || "[]"),
          result: el.querySelector('[data-testid="history-result"]').getAttribute("data-value"),
        })),
        { operator: "+", operands: ["12", "30", "8"], result: "50" },
      );
      clean(checks, "compute.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
    return checks;
  },
};

const ARITHMETIC_CASES = [
  { operator: "+", values: ["12", "30", "8"], expected: 50 },
  { operator: "-", values: ["10", "4", "3"], expected: 3 },
  { operator: "*", values: ["2", "3", "4"], expected: 24 },
  { operator: "/", values: ["100", "5", "2"], expected: 10 },
  { operator: "+", values: ["1.5", "2.25"], expected: 3.75 },
];

export const arithmetic = {
  id: "arithmetic",
  async run({ browser, artifact }) {
    const checks = [];
    for (const testCase of ARITHMETIC_CASES) {
      const app = await openApp(browser, artifact);
      try {
        const { page } = app;
        await page.click(`${S.picker} [data-op="${testCase.operator}"]`);
        for (const value of testCase.values) {
          for (const character of value) await page.click(`${S.keypad} [data-key="${character}"]`);
          await page.click(`${S.keypad} [data-key="enter"]`);
        }
        await page.click(S.equals);
        eq(checks, `arithmetic.${testCase.operator}.${testCase.values.join("_")}.result`, await resultValue(page), String(testCase.expected));
        clean(checks, `arithmetic.${testCase.operator}.${testCase.values.join("_")}.clean`, app.pageErrors, app.consoleErrors);
      } finally {
        await app.close();
      }
    }
    return checks;
  },
};

export const historyOrder = {
  id: "history-order",
  async run({ browser, artifact }) {
    const checks = [];
    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      const sequence = [
        { operator: "+", values: ["12", "30", "8"], expected: "50" },
        { operator: "-", values: ["10", "4", "3"], expected: "3" },
        { operator: "*", values: ["2", "3", "4"], expected: "24" },
        { operator: "+", values: ["1.5", "2.25"], expected: "3.75" },
      ];
      let expectedCount = 0;
      for (const step of sequence) {
        await page.click(`${S.picker} [data-op="${step.operator}"]`);
        for (const value of step.values) {
          for (const character of value) await page.click(`${S.keypad} [data-key="${character}"]`);
          await page.click(`${S.keypad} [data-key="enter"]`);
        }
        await page.click(S.equals);
        expectedCount += 1;
        eq(checks, `history-order.count-after-${expectedCount}`, await page.$$eval(S.historyItem, (els) => els.length), expectedCount);
      }

      eq(
        checks,
        "history-order.top-four",
        await page.$$eval(S.historyItem, (items) =>
          items.map((item) => ({
            operator: item.getAttribute("data-operator"),
            operands: JSON.parse(item.getAttribute("data-operands") || "[]"),
            result: item.querySelector('[data-testid="history-result"]').getAttribute("data-value"),
          })),
        ),
        [
          { operator: "+", operands: ["1.5", "2.25"], result: "3.75" },
          { operator: "*", operands: ["2", "3", "4"], result: "24" },
          { operator: "-", operands: ["10", "4", "3"], result: "3" },
          { operator: "+", operands: ["12", "30", "8"], result: "50" },
        ],
      );

      const editButtons = await page.$$eval(S.historyEdit, (els) => els.filter((el) => el.getClientRects().length > 0).length);
      eq(checks, "history-order.edit-entry-per-item", editButtons, 4);

      const emptyThenEquals = await page.$$eval(S.historyItem, (els) => els.length);
      await page.click(`${S.keypad} [data-key="enter"]`);
      eq(checks, "history-order.empty-enter-no-record", await page.$$eval(S.historyItem, (els) => els.length), emptyThenEquals);

      await page.click(`${S.picker} [data-op="/"]`);
      for (const character of "5") await page.click(`${S.keypad} [data-key="${character}"]`);
      await page.click(`${S.keypad} [data-key="enter"]`);
      await page.click(`${S.keypad} [data-key="0"]`);
      await page.click(`${S.keypad} [data-key="enter"]`);
      await page.click(S.equals);
      eq(checks, "history-order.divzero-no-record", await page.$$eval(S.historyItem, (els) => els.length), emptyThenEquals);
      clean(checks, "history-order.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
    return checks;
  },
};

export const reset = {
  id: "reset",
  async run({ browser, artifact }) {
    const checks = [];
    const app = await openApp(browser, artifact);
    try {
      const { page } = app;
      for (const [operator, values] of [["+", ["1", "2"]], ["*", ["3", "4"]]]) {
        await page.click(`${S.picker} [data-op="${operator}"]`);
        for (const value of values) {
          for (const character of value) await page.click(`${S.keypad} [data-key="${character}"]`);
          await page.click(`${S.keypad} [data-key="enter"]`);
        }
        await page.click(S.equals);
      }
      const before = await page.$$eval(S.historyItem, (items) =>
        items.map((item) => [item.getAttribute("data-operator"), item.getAttribute("data-operands"), item.querySelector('[data-testid="history-result"]').getAttribute("data-value")]),
      );
      await page.click(S.keyOp);
      eq(checks, "reset.state", await appState(page), "select");
      eq(checks, "reset.expression", await expressionText(page), "");
      eq(checks, "reset.result", await resultValue(page), null);
      eq(
        checks,
        "reset.history-preserved",
        await page.$$eval(S.historyItem, (items) =>
          items.map((item) => [item.getAttribute("data-operator"), item.getAttribute("data-operands"), item.querySelector('[data-testid="history-result"]').getAttribute("data-value")]),
        ),
        before,
      );
      await page.reload({ waitUntil: "load" });
      eq(checks, "reset.reload.state", await appState(page), "select");
      eq(checks, "reset.reload.history", await page.$$eval(S.historyItem, (els) => els.length), 0);
      eq(checks, "reset.reload.error-attr", await resultError(page), null);
      clean(checks, "reset.clean", app.pageErrors, app.consoleErrors);
    } finally {
      await app.close();
    }
    return checks;
  },
};

export const scenarios = [selfContained, coldStart(), compute, arithmetic, historyOrder, reset];
