import { openApp } from "../lib/browser.mjs";
import { S } from "../lib/selectors.mjs";
import { check, eq, clean } from "../lib/check.mjs";
import { clickKey, compute, clickEquals, historySnapshots } from "../lib/dom.mjs";
import { seedSettings, storedSettings } from "../lib/settings.mjs";
import { audioProbe, installAudioProbe } from "../lib/audio.mjs";

// Voice toggles live in the settings panel; every other hook lives in S.
const VOICE_KEYS = '[data-testid="settings-voice-keys"]';
const VOICE_RESULT = '[data-testid="settings-voice-result"]';

async function snapshot(page) {
  return page.evaluate(
    ({ input, expression, result, root }) => {
      const field = document.querySelector(input);
      const expressionView = document.querySelector(expression);
      const resultView = document.querySelector(result);
      const appRoot = document.querySelector(root);
      return {
        input: field.value,
        expression: (expressionView.textContent || "").trim(),
        resultText: (resultView.textContent || "").trim(),
        resultValue: resultView.getAttribute("data-value"),
        state: appRoot.dataset.state,
        operator: appRoot.getAttribute("data-operator"),
      };
    },
    { input: S.calcInput, expression: S.expression, result: S.result, root: S.app },
  );
}

// Two zero-delay macrotasks flush promise- and timer-scheduled audio work
// without adding wall-clock sleep to the tone measurement.
async function flush(page) {
  await page.evaluate(() => new Promise((resolve) => setTimeout(() => setTimeout(resolve, 0), 0)));
}

async function toneCount(page) {
  return page.evaluate(() => (window.__audioProbe ? window.__audioProbe.oscillatorStarts.length : -1));
}

async function toneDelta(page, action) {
  const before = await toneCount(page);
  await action();
  await flush(page);
  const after = await toneCount(page);
  return { before, after, delta: after - before };
}

// Presses the blocked digit every `intervalMs` while the product's own pause
// holds the input empty, and reports how long the release took. No fixed sleep
// decides the outcome: the loop stops the moment the field accepts the digit.
async function pollPauseRelease(page, { key = "9", capMs = 6000, intervalMs = 20 } = {}) {
  return page.evaluate(
    async ({ keySelector, capMs, intervalMs }) => {
      const field = document.querySelector('input[data-testid="calc-input"]');
      const button = document.querySelector(keySelector);
      if (!field || !button) {
        return { accepted: false, elapsed: 0, presses: 0, value: "", error: "keypad key or input missing" };
      }
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const started = Date.now();
      let presses = 0;
      while (field.value === "" && Date.now() - started < capMs) {
        button.click();
        presses += 1;
        if (field.value !== "") break;
        await wait(intervalMs);
      }
      return { accepted: field.value !== "", elapsed: Date.now() - started, presses, value: field.value, error: "" };
    },
    { keySelector: `${S.keypad} [data-key="${key}"]`, capMs, intervalMs },
  );
}

// 结果后暂停输入 keeps the keypad parked for N seconds after every result, and
// while it is parked a digit, "." or Backspace must answer with one short
// double-tone warning so the teacher knows the press was seen and discarded.
// The warning is a plain WebAudio beep: it must not wait for the offline voice
// engine, and it must stay silent for keys that are never blocked.
export const resultPauseWarning = {
  id: "result-pause-warning",
  async run({ browser, artifact }) {
    const checks = [];

    // ---- AC-1 / AC-2: a fresh profile pauses results for 2 s ----
    const defaults = await openApp(browser, artifact);
    try {
      const { page } = defaults;
      await installAudioProbe(defaults);

      eq(checks, "result-pause-warning.default.field", await page.$eval(S.resultPause, (el) => el.value), "2");

      await compute(page, "+", ["5", "6"]);
      let view = await snapshot(page);
      eq(checks, "result-pause-warning.default.result", view.resultText, "11");
      eq(checks, "result-pause-warning.default.state", view.state, "result");

      const poll = await pollPauseRelease(page, { key: "9" });
      check(
        checks,
        "result-pause-warning.default.blocked-until-2s",
        poll.accepted && poll.elapsed >= 1500 && poll.elapsed <= 4000,
        `accepted=${poll.accepted}, elapsed=${poll.elapsed}ms, presses=${poll.presses}` +
          (poll.error ? `, error=${poll.error}` : ""),
      );
      check(
        checks,
        "result-pause-warning.default.polls",
        poll.presses >= 2,
        `presses=${poll.presses} (>=2 proves the early presses were blocked)`,
      );

      eq(checks, "result-pause-warning.default.released", await page.$eval(S.calcInput, (el) => el.value), "9");
      view = await snapshot(page);
      eq(checks, "result-pause-warning.default.released-state", view.state, "input");
      eq(checks, "result-pause-warning.default.released-expression", view.expression, "");

      clean(checks, "result-pause-warning.default.clean", defaults.pageErrors, defaults.consoleErrors);
    } finally {
      await defaults.close();
    }

    // ---- AC-3 / AC-4: one double tone per blocked key, silence elsewhere ----
    const warning = await openApp(browser, artifact);
    try {
      const { page } = warning;
      await installAudioProbe(warning);

      await compute(page, "+", ["5", "6"]);
      let view = await snapshot(page);
      eq(checks, "result-pause-warning.warning.result", view.resultText, "11");

      const historyBefore = await historySnapshots(page);
      eq(checks, "result-pause-warning.warning.history-before", historyBefore.length, 1);

      // The three blocked keys are pressed back-to-back inside one page call so
      // every press lands in the same pause window; each press still gets its
      // own before/after oscillator count.
      const pressed = await page.evaluate(
        async ({ keys, keypad }) => {
          const field = document.querySelector('input[data-testid="calc-input"]');
          const starts = () => window.__audioProbe.oscillatorStarts.length;
          const flushQueues = () => new Promise((resolve) => setTimeout(() => setTimeout(resolve, 0), 0));
          const results = [];
          for (const key of keys) {
            const button = document.querySelector(`${keypad} [data-key="${key}"]`);
            const before = starts();
            button.click();
            await flushQueues();
            results.push({ key, delta: starts() - before, value: field.value });
          }
          return results;
        },
        { keys: ["9", ".", "backspace"], keypad: S.keypad },
      );
      const deltas = Object.fromEntries(pressed.map((entry) => [entry.key, entry.delta]));

      eq(checks, "result-pause-warning.warning.digit-tones", deltas["9"], 2);
      eq(checks, "result-pause-warning.warning.dot-tones", deltas["."], 2);
      eq(checks, "result-pause-warning.warning.backspace-tones", deltas.backspace, 2);
      const lastTones = await page.evaluate(() =>
        window.__audioProbe.oscillatorStarts.slice(-2).map((entry) => entry.frequency),
      );
      check(
        checks,
        "result-pause-warning.warning.distinct-tones",
        lastTones.length === 2 && lastTones[0] !== lastTones[1],
        `frequencies=${lastTones.join(",")}`,
      );
      const lastStarts = await page.evaluate(() => window.__audioProbe.oscillatorStarts.slice(-2).map((e) => e.when));
      const spacing = Math.abs(lastStarts[1] - lastStarts[0]);
      check(
        checks,
        "result-pause-warning.warning.tone-spacing",
        Math.abs(spacing - 0.09) <= 0.005,
        `spacing=${spacing}s (expected 0.09s, both notes must be sequenced)`,
      );
      const probeAfterPresses = await audioProbe(page);
      eq(checks, "result-pause-warning.warning.contexts-reused", probeAfterPresses.contexts, 1);

      view = await snapshot(page);
      eq(checks, "result-pause-warning.warning.blocked-input", view.input, "");
      eq(checks, "result-pause-warning.warning.blocked-result", view.resultValue, "11");
      eq(checks, "result-pause-warning.warning.blocked-expression", view.expression, "5 + 6");
      eq(checks, "result-pause-warning.warning.blocked-state", view.state, "result");
      eq(checks, "result-pause-warning.warning.history-unchanged", await historySnapshots(page), historyBefore);

      const operator = await toneDelta(page, () => page.click(`${S.picker} [data-op="+"]`));
      eq(checks, "result-pause-warning.guard.operator-tones", operator.delta, 0);
      view = await snapshot(page);
      eq(checks, "result-pause-warning.guard.operator-applied", view.operator, "+");
      eq(checks, "result-pause-warning.guard.operator-state", view.state, "input");

      // A fresh result re-arms the pause so "=" and Enter are measured while it
      // is active; neither key is blocked, so neither may warn.
      await compute(page, "+", ["5", "6"]);
      eq(
        checks,
        "result-pause-warning.guard.recompute-result",
        await page.$eval(S.result, (el) => el.getAttribute("data-value")),
        "11",
      );

      const equals = await toneDelta(page, () => clickEquals(page));
      eq(checks, "result-pause-warning.guard.equals-tones", equals.delta, 0);
      const enter = await toneDelta(page, () => clickKey(page, "enter"));
      eq(checks, "result-pause-warning.guard.enter-tones", enter.delta, 0);

      // The physical keyboard reaches the product through keydown, not the keypad,
      // so the same warning and the same blocking are proven there too.
      await compute(page, "+", ["5", "6"]);
      const keyboard = [];
      for (const key of ["7", ".", "Backspace"]) {
        const press = await toneDelta(page, () => page.keyboard.press(key));
        keyboard.push({ key, delta: press.delta });
      }
      eq(checks, "result-pause-warning.keyboard.tones", keyboard.map((entry) => entry.delta), [2, 2, 2]);
      eq(checks, "result-pause-warning.keyboard.input", await page.$eval(S.calcInput, (el) => el.value), "");

      // A held key repeats at the OS rate. Only a real repeated keydown carries
      // event.repeat, so this drives CDP instead of the keypad button.
      await compute(page, "+", ["5", "6"]);
      const cdp = await page.context().newCDPSession(page);
      const key8 = { type: "keyDown", key: "8", code: "Digit8", windowsVirtualKeyCode: 56, nativeVirtualKeyCode: 56 };
      const beforeRepeat = await page.evaluate(() => window.__audioProbe.oscillatorStarts.length);
      await cdp.send("Input.dispatchKeyEvent", { ...key8, autoRepeat: true, text: "8" });
      await flush(page);
      eq(
        checks,
        "result-pause-warning.repeat.ignored",
        (await page.evaluate(() => window.__audioProbe.oscillatorStarts.length)) - beforeRepeat,
        0,
      );
      await cdp.send("Input.dispatchKeyEvent", { ...key8, autoRepeat: false, text: "8" });
      await flush(page);
      eq(
        checks,
        "result-pause-warning.repeat.first-press-warns",
        (await page.evaluate(() => window.__audioProbe.oscillatorStarts.length)) - beforeRepeat,
        2,
      );
      eq(checks, "result-pause-warning.repeat.input", await page.$eval(S.calcInput, (el) => el.value), "");

      clean(checks, "result-pause-warning.warning.clean", warning.pageErrors, warning.consoleErrors);
    } finally {
      await warning.close();
    }

    // ---- AC-3b: a suspended context resumes before the notes are scheduled ----
    const suspended = await openApp(browser, artifact);
    try {
      const { page } = suspended;
      await installAudioProbe(suspended, { startSuspended: true });

      await compute(page, "+", ["5", "6"]);
      const blocked = await toneDelta(page, () => clickKey(page, "9"));
      eq(checks, "result-pause-warning.suspended.tones", blocked.delta, 2);

      const probeSuspended = await audioProbe(page);
      eq(
        checks,
        "result-pause-warning.suspended.resume-first",
        probeSuspended.events.slice(0, 4).map((entry) => entry.type),
        ["resume", "resumed", "start", "start"],
      );

      clean(checks, "result-pause-warning.suspended.clean", suspended.pageErrors, suspended.consoleErrors);
    } finally {
      await suspended.close();
    }

    // ---- AC-5: the warning does not depend on the voice engine ----
    const voiceOff = await openApp(browser, artifact);
    try {
      const { page } = voiceOff;
      const requests = [];
      page.on("request", (request) => requests.push(request.url()));
      await installAudioProbe(voiceOff);

      eq(checks, "result-pause-warning.voice-off.keys-off", await page.$eval(VOICE_KEYS, (el) => el.checked), false);
      eq(checks, "result-pause-warning.voice-off.result-off", await page.$eval(VOICE_RESULT, (el) => el.checked), false);

      await compute(page, "+", ["5", "6"]);
      const blocked = await toneDelta(page, () => clickKey(page, "9"));
      eq(checks, "result-pause-warning.voice-off.tone-with-voice-off", blocked.delta, 2);
      eq(checks, "result-pause-warning.voice-off.still-blocked", await page.$eval(S.calcInput, (el) => el.value), "");

      const voiceRequests = requests.filter((url) => url.includes("/voice/"));
      check(
        checks,
        "result-pause-warning.voice-off.no-voice-requests",
        voiceRequests.length === 0,
        `requests=${requests.length}, voice=${voiceRequests.length}${voiceRequests.length ? ` — ${voiceRequests.join(" | ")}` : ""}`,
      );

      clean(checks, "result-pause-warning.voice-off.clean", voiceOff.pageErrors, voiceOff.consoleErrors);
    } finally {
      await voiceOff.close();
    }

    // ---- AC-6: pause off means the digit is accepted and nothing warns ----
    const zero = await openApp(browser, artifact);
    try {
      const { page } = zero;
      await installAudioProbe(zero);
      await seedSettings(zero, { resultPause: 0 }, "warning-zero");

      await compute(page, "+", ["5", "6"]);
      const press = await toneDelta(page, () => clickKey(page, "9"));
      eq(checks, "result-pause-warning.zero.tones", press.delta, 0);
      eq(checks, "result-pause-warning.zero.input", await page.$eval(S.calcInput, (el) => el.value), "9");
      eq(checks, "result-pause-warning.zero.state", await page.$eval(S.app, (el) => el.dataset.state), "input");
      const silentBackspace = await toneDelta(page, () => clickKey(page, "backspace"));
      eq(checks, "result-pause-warning.zero.backspace-tones", silentBackspace.delta, 0);
      eq(checks, "result-pause-warning.zero.backspace-input", await page.$eval(S.calcInput, (el) => el.value), "");

      clean(checks, "result-pause-warning.zero.clean", zero.pageErrors, zero.consoleErrors);
    } finally {
      await zero.close();
    }

    // ---- AC-7: an already saved pause keeps its value (no migration) ----
    const legacy = await openApp(browser, artifact);
    try {
      const { page } = legacy;
      await installAudioProbe(legacy);
      await seedSettings(legacy, { resultPause: 1 }, "warning-legacy");

      eq(checks, "result-pause-warning.legacy.field", await page.$eval(S.resultPause, (el) => el.value), "1");
      eq(checks, "result-pause-warning.legacy.stored", (await storedSettings(page)).resultPause, 1);

      await compute(page, "+", ["5", "6"]);
      const poll = await pollPauseRelease(page, { key: "9" });
      check(
        checks,
        "result-pause-warning.legacy.released-before-2s",
        poll.accepted && poll.elapsed >= 700 && poll.elapsed <= 1700,
        `accepted=${poll.accepted}, elapsed=${poll.elapsed}ms, presses=${poll.presses}` +
          (poll.error ? `, error=${poll.error}` : ""),
      );
      check(checks, "result-pause-warning.legacy.polls", poll.presses >= 2, `presses=${poll.presses}`);
      eq(checks, "result-pause-warning.legacy.released", await page.$eval(S.calcInput, (el) => el.value), "9");

      clean(checks, "result-pause-warning.legacy.clean", legacy.pageErrors, legacy.consoleErrors);
    } finally {
      await legacy.close();
    }

    return checks;
  },
};

export const scenarios = [resultPauseWarning];
