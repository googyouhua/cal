import { S, OPERATORS, KEYPAD_KEYS } from "./selectors.mjs";

export async function appState(page) {
  return page.$eval(S.app, (el) => el.dataset.state);
}

export async function expressionText(page) {
  return page.$eval(S.expression, (el) => (el.textContent || "").trim());
}

export async function resultValue(page) {
  return page.$eval(S.result, (el) => el.getAttribute("data-value"));
}

export async function resultError(page) {
  return page.$eval(S.result, (el) => el.getAttribute("data-error"));
}

export async function resultText(page) {
  return page.$eval(S.result, (el) => (el.textContent || "").trim());
}

export async function isVisible(page, selector) {
  return page.$eval(selector, (el) => {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    return el.getClientRects().length > 0;
  });
}

export async function count(page, selector) {
  return page.$$eval(selector, (els) => els.length);
}

export async function operatorButtons(page) {
  return page.$$eval(S.picker + " [data-op]", (els) => els.map((el) => el.getAttribute("data-op")));
}

export async function keypadDisabled(page) {
  return page.$$eval(S.keypad + " [data-key]", (els) =>
    els.filter((el) => el.disabled).map((el) => el.getAttribute("data-key")),
  );
}

export async function calcInputState(page) {
  return page.$eval(S.calcInput, (el) => ({
    value: el.value,
    disabled: el.disabled,
    readOnly: el.readOnly,
    focused: document.activeElement === el,
  }));
}

export async function clickKey(page, key) {
  await page.click(`${S.keypad} [data-key="${key}"]`);
}

export async function typeNumber(page, display) {
  for (const character of String(display)) await clickKey(page, character);
}

export async function enterNumber(page, display) {
  await typeNumber(page, display);
  await clickKey(page, "enter");
}

export async function selectOperator(page, operator) {
  await page.click(`${S.picker} [data-op="${operator}"]`);
}

export async function clickEquals(page) {
  await page.click(S.equals);
}

export async function compute(page, operator, values) {
  await selectOperator(page, operator);
  for (const value of values) await enterNumber(page, value);
  await clickEquals(page);
}

export async function historyCount(page) {
  return count(page, S.historyItem);
}

export async function historySnapshots(page) {
  return page.$$eval(S.historyItem, (items) =>
    items.map((item) => {
      const result = item.querySelector('[data-testid="history-result"]');
      const expression = item.querySelector('[data-testid="history-expression"]');
      return {
        operator: item.getAttribute("data-operator"),
        operands: JSON.parse(item.getAttribute("data-operands") || "[]"),
        result: result ? result.getAttribute("data-value") : null,
        expression: expression ? (expression.textContent || "").trim() : "",
      };
    }),
  );
}

export async function liveOperands(page) {
  return page.$$eval(S.operandInput, (els) => els.map((el) => el.value));
}

export async function editDraftInfo(page) {
  return page.$eval(S.editDraft, (el) => ({
    hidden: el.hidden,
    operator: el.getAttribute("data-operator"),
  }));
}

export async function setOperand(page, index, value) {
  await page.locator(S.operandInput).nth(index).fill(value);
}

export async function removeOperand(page, index) {
  await page.locator(S.operandRemove).nth(index).click();
}

export async function clickHistoryEdit(page, index) {
  await page.locator(S.historyEdit).nth(index).click();
}

export async function measureLayout(page) {
  return page.evaluate(
    ({ selectors, operators, keys }) => {
      const visible = (el) => {
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
        return el.getClientRects().length > 0;
      };
      const controls = [...new Set(document.querySelectorAll("input, button, [data-op]"))]
        .filter(visible)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return {
            testid: el.getAttribute("data-testid"),
            key: el.getAttribute("data-key"),
            op: el.getAttribute("data-op"),
            width: rect.width,
            height: rect.height,
            fontSize: parseFloat(style.fontSize),
          };
        });
      const calcInput = document.querySelector(selectors.calcInput);
      const operandInputs = [...document.querySelectorAll(selectors.operandInput)];
      return {
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
        controls,
        calcFont: calcInput ? parseFloat(getComputedStyle(calcInput).fontSize) : null,
        operandFonts: operandInputs.map((el) => parseFloat(getComputedStyle(el).fontSize)),
        operators,
        keys,
      };
    },
    { selectors: S, operators: OPERATORS, keys: KEYPAD_KEYS },
  );
}
