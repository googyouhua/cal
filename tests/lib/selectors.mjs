// Stable data hooks for /ws/cal_phone/index.html.
// Kekkai gates are allowed to add hooks; they must not rename or remove these.
export const S = Object.freeze({
  app: "main.app[data-state]",
  picker: '[data-testid="op-picker"]',
  calcInput: 'input[data-testid="calc-input"]',
  expression: '[data-testid="expression"]',
  result: '[data-testid="result"]',
  equals: 'button[data-testid="key-equals"]',
  keyOp: 'button[data-testid="key-op"]',
  keypad: '[data-testid="keypad"]',
  history: '[data-testid="history"]',
  historyList: '[data-testid="history-list"]',
  historyItem: '[data-testid="history-item"]',
  historyExpression: '[data-testid="history-expression"]',
  historyResult: '[data-testid="history-result"]',
  historyEdit: 'button[data-testid="history-edit"]',
  editDraft: '[data-testid="edit-draft"]',
  editOperator: '[data-testid="edit-operator"]',
  editCancel: 'button[data-testid="edit-cancel"]',
  operandChips: '[data-testid="operand-chips"]',
  operandChip: '[data-testid="operand-chip"]',
  operandInput: 'input[data-testid="operand-input"]',
  operandRemove: 'button[data-testid="operand-remove"]',
});

export const OPERATORS = Object.freeze(["+", "-", "*", "/"]);
export const KEYPAD_KEYS = Object.freeze([
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", ".",
  "backspace", "enter", "equals",
]);
