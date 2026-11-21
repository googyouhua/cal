#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const resolveFromScript = (value) => (path.isAbsolute(value) ? value : path.resolve(SCRIPT_DIR, value));
const ARTIFACT = process.env.KEKKAI_ARTIFACT
  ? resolveFromScript(process.env.KEKKAI_ARTIFACT)
  : "/ws/cal_phone/index.html";
const OUT_DIR = process.env.KEKKAI_OUT_DIR
  ? resolveFromScript(process.env.KEKKAI_OUT_DIR)
  : path.resolve(SCRIPT_DIR, "runs");
const ROUND = String(process.argv[2] ?? process.env.KEKKAI_ROUND ?? "1");
const GEOMETRY_TOLERANCE = 0.5;
const NUMERIC_TOLERANCE = 1e-9;
const SETTINGS_KEY = "cal-phone.settings.v1";
const TEST_PLAYWRIGHT = createRequire("/ws/cal_phone/tests/package.json");

const S = Object.freeze({
  settingsToggle: '[data-testid="settings-toggle"]',
  settingsDone: '[data-testid="settings-done"]',
  autoSelect: '[data-testid="settings-auto-confirm"]',
  baseToggle: '[data-testid="settings-base-toggle"]',
  baseValue: '[data-testid="settings-base-value"]',
  picker: '[data-testid="op-picker"]',
  input: '[data-testid="calc-input"]',
  expression: '[data-testid="expression"]',
  result: '[data-testid="result"]',
  keypad: '[data-testid="keypad"]',
  feedback: '[data-testid="auto-confirm-feedback"]',
  progress: '[data-testid="auto-confirm-progress"]',
  countdown: '[data-testid="auto-confirm-countdown"]',
  undo: '[data-testid="undo-hint"]',
  enter: '[data-testid="enter"]',
  equals: '[data-testid="key-equals"]',
  historyItem: '[data-testid="history-item"]',
  historyExpression: '[data-testid="history-expression"]',
  historyResult: '[data-testid="history-result"]',
  historyEdit: '[data-testid="history-edit"]',
  editDraft: '[data-testid="edit-draft"]',
  editBaseMarker: '[data-testid="edit-base-marker"]',
});

const pageErrorRecords = [];
const consoleErrorRecords = [];
const trackedPageLabels = [];
let suiteEvidence = { cleanChecks: 0, cleanFailures: [], results: [] };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
const num = (value) => (Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : String(value));
const short = (value, limit = 420) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
};
const errorText = (error) => (error && error.stack ? error.stack : String(error));
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

function loadPlaywright() {
  try {
    const mod = TEST_PLAYWRIGHT("playwright");
    if (mod.chromium) return mod;
    if (mod.default?.chromium) return mod.default;
  } catch (error) {
    throw new Error(`Unable to resolve Playwright from /ws/cal_phone/tests: ${error.message}`);
  }
  throw new Error("Playwright resolved but chromium is unavailable");
}

async function launchBrowser() {
  const { chromium } = loadPlaywright();
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    if (!/sandbox|SIGSYS|SIGTRAP|Operation not permitted/i.test(String(error))) throw error;
    return chromium.launch({
      headless: true,
      chromiumSandbox: false,
      args: ["--disable-gpu"],
    });
  }
}

async function openPage(browser, { label, width = 390, height = 844, reducedMotion } = {}) {
  const contextOptions = {
    viewport: { width, height },
    isMobile: true,
    hasTouch: true,
  };
  if (reducedMotion) contextOptions.reducedMotion = reducedMotion;
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(15000);
  const app = { context, page, pageErrors: [], consoleErrors: [] };
  page.on("pageerror", (error) => {
    const text = String(error);
    app.pageErrors.push(text);
    pageErrorRecords.push({ label, text });
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    app.consoleErrors.push(text);
    consoleErrorRecords.push({ label, text });
  });
  if (width === 320 && height === 568) {
    app.cdp = await context.newCDPSession(page);
    await app.cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 320,
      height: 568,
      deviceScaleFactor: 2,
      mobile: true,
    });
  }
  trackedPageLabels.push(label);
  try {
    await page.goto(pathToFileURL(ARTIFACT).href, { waitUntil: "load" });
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
  return app;
}

async function closePage(app) {
  await app.context.close().catch(() => {});
}

async function waitTarget(startedAt, targetMs) {
  await sleep(targetMs - (Date.now() - startedAt));
}

async function applySettings(page, { auto = 0, base } = {}) {
  await page.click(S.settingsToggle);
  await page.waitForFunction(
    () => {
      const panel = document.querySelector('[data-testid="settings-panel"]');
      return Boolean(panel && (panel.open || panel.hasAttribute("open")));
    },
    undefined,
    { timeout: 2000, polling: 10 },
  );
  await page.selectOption(S.autoSelect, String(auto));
  if (base !== undefined) {
    const checked = await page.isChecked(S.baseToggle);
    if (!checked) await page.check(S.baseToggle);
    await page.fill(S.baseValue, String(base));
  }
  await page.click(S.settingsDone);
  await page.waitForFunction(
    () => {
      const panel = document.querySelector('[data-testid="settings-panel"]');
      return Boolean(panel && !panel.open && !panel.hasAttribute("open"));
    },
    undefined,
    { timeout: 2000, polling: 10 },
  );
}

async function chooseOperator(page, operator) {
  await page.click(`${S.picker} [data-op="${operator}"]`);
}

async function clickKey(page, key) {
  await page.click(`${S.keypad} [data-key="${key}"]`);
}

async function typeDigits(page, value) {
  for (const character of String(value)) await clickKey(page, character);
}

async function snapshotLayout(page) {
  return page.evaluate(() => {
    const rectOf = (element) => {
      if (!element) return { top: NaN, left: NaN, width: NaN, height: NaN, right: NaN, bottom: NaN };
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
      };
    };
    const keypad = document.querySelector('[data-testid="keypad"]');
    const feedback = document.querySelector('[data-testid="auto-confirm-feedback"]');
    const progress = document.querySelector('[data-testid="auto-confirm-progress"]');
    const undo = document.querySelector('[data-testid="undo-hint"]');
    const input = document.querySelector('[data-testid="calc-input"]');
    const expression = document.querySelector('[data-testid="expression"]');
    const keys = {};
    for (const key of document.querySelectorAll('[data-key]')) {
      keys[key.getAttribute("data-key")] = rectOf(key);
    }
    return {
      state: document.querySelector('main.app[data-state]')?.getAttribute("data-state") ?? null,
      keypad: rectOf(keypad),
      keys,
      feedback: rectOf(feedback),
      feedbackHidden: Boolean(feedback?.hidden),
      feedbackActive: feedback?.getAttribute("data-active") ?? null,
      progress: rectOf(progress),
      progressActive: progress?.getAttribute("data-active") ?? null,
      countdown: (document.querySelector('[data-testid="auto-confirm-countdown"]')?.textContent ?? "").trim(),
      undo: rectOf(undo),
      undoHidden: Boolean(undo?.hidden),
      inputValue: input?.value ?? "",
      expression: expression?.textContent ?? "",
    };
  });
}

function compareLayouts(actual, reference) {
  let max = 0;
  let at = "none";
  let missing = "";
  const compareOne = (label, left, right) => {
    for (const edge of ["top", "left", "width", "height"]) {
      const a = left?.[edge];
      const b = right?.[edge];
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        missing = `${label}.${edge}`;
        max = Infinity;
        at = missing;
        continue;
      }
      const delta = Math.abs(a - b);
      if (delta > max) {
        max = delta;
        at = `${label}.${edge}`;
      }
    }
  };
  compareOne("keypad", actual?.keypad, reference?.keypad);
  const keyNames = new Set([...Object.keys(actual?.keys ?? {}), ...Object.keys(reference?.keys ?? {})]);
  for (const key of keyNames) compareOne(`key:${key}`, actual?.keys?.[key], reference?.keys?.[key]);
  return {
    ok: Number.isFinite(max) && max <= GEOMETRY_TOLERANCE + NUMERIC_TOLERANCE && !missing,
    max,
    at: missing || at,
  };
}

function bumpMax(bucket, comparison) {
  if (comparison.max > bucket.maxRectDelta) bucket.maxRectDelta = comparison.max;
  bucket.comparisons += 1;
}

async function installStabilityObserver(page) {
  await page.evaluate(() => {
    if (window.__stabilityObserver) window.__stabilityObserver.disconnect();
    window.__stabilitySamples = [];
    const feedback = document.querySelector('[data-testid="auto-confirm-feedback"]');
    const keypad = document.querySelector('[data-testid="keypad"]');
    const input = document.querySelector('[data-testid="calc-input"]');
    const expression = document.querySelector('[data-testid="expression"]');
    const rectOf = (element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, left: rect.left, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
    };
    const capture = () => {
      const keys = {};
      for (const key of document.querySelectorAll('[data-key]')) keys[key.getAttribute("data-key")] = rectOf(key);
      window.__stabilitySamples.push({
        at: performance.now(),
        keypad: rectOf(keypad),
        keys,
        feedback: rectOf(feedback),
        feedbackHidden: feedback.hidden,
        feedbackActive: feedback.getAttribute("data-active"),
        inputValue: input.value,
        expression: expression.textContent,
      });
    };
    let wasVisible = !feedback.hidden && feedback.getAttribute("data-active") === "true";
    const observer = new MutationObserver(() => {
      const visible = !feedback.hidden && feedback.getAttribute("data-active") === "true";
      if (visible && !wasVisible) capture();
      wasVisible = visible;
    });
    observer.observe(feedback, { attributes: true, attributeFilter: ["hidden", "data-active"] });
    window.__stabilityObserver = observer;
  });
}

async function waitForStabilitySamples(page, count, timeout = 600) {
  await page.waitForFunction(
    (wanted) => (window.__stabilitySamples?.length ?? 0) >= wanted,
    count,
    { timeout, polling: 10 },
  );
  return page.evaluate(() => window.__stabilitySamples.map((sample) => ({ ...sample })));
}

async function installAutoCommitProbe(page) {
  await page.evaluate(() => {
    if (window.__autoCommitProbe?.timer) clearInterval(window.__autoCommitProbe.timer);
    const input = document.querySelector('[data-testid="calc-input"]');
    const probe = { events: [], last: input.value, timer: null };
    probe.timer = setInterval(() => {
      const current = input.value;
      if (probe.last !== "" && current === "") probe.events.push({ at: performance.now(), previous: probe.last });
      probe.last = current;
    }, 10);
    window.__autoCommitProbe = probe;
  });
}

async function readAutoCommitEvents(page) {
  return page.evaluate(() => window.__autoCommitProbe?.events?.map((event) => ({ ...event })) ?? []);
}

async function waitFeedbackVisible(page, timeout = 500) {
  await page.waitForFunction(
    () => {
      const feedback = document.querySelector('[data-testid="auto-confirm-feedback"]');
      return Boolean(feedback && !feedback.hidden && feedback.getAttribute("data-active") === "true");
    },
    undefined,
    { timeout, polling: 10 },
  );
}

function feedbackUsable(snapshot) {
  return !snapshot.feedbackHidden && Number.isFinite(snapshot.feedback?.height) && snapshot.feedback.height >= 16;
}

function addFailure(bucket, label, detail) {
  if (bucket.failures.length < 40) bucket.failures.push(`${label}: ${short(detail, 300)}`);
}

const H1_REF_CACHE = new Map();

async function buildH1References(browser, width, height) {
  const cacheKey = `${width}x${height}`;
  if (H1_REF_CACHE.has(cacheKey)) return H1_REF_CACHE.get(cacheKey);
  const refs = {};

  let app = await openPage(browser, { label: `H1-ref-standard-${cacheKey}`, width, height });
  try {
    await chooseOperator(app.page, "+");
    await app.page.evaluate(() => window.scrollTo(0, 0));
    refs.plus = await snapshotLayout(app.page);
    await typeDigits(app.page, "9");
    refs.input9 = await snapshotLayout(app.page);
    await clickKey(app.page, "enter");
    refs.committed9 = await snapshotLayout(app.page);
    await typeDigits(app.page, "8");
    refs.committed9Input8 = await snapshotLayout(app.page);
  } finally {
    await closePage(app);
  }

  app = await openPage(browser, { label: `H1-ref-noop-${cacheKey}`, width, height });
  try {
    await app.page.evaluate(() => window.scrollTo(0, 0));
    refs.emptyStart = await snapshotLayout(app.page);
    await typeDigits(app.page, "9");
    refs.noOpInput9 = await snapshotLayout(app.page);
  } finally {
    await closePage(app);
  }

  app = await openPage(browser, { label: `H1-ref-base-${cacheKey}`, width, height });
  try {
    await applySettings(app.page, { auto: 0, base: "10" });
    await chooseOperator(app.page, "+");
    await app.page.evaluate(() => window.scrollTo(0, 0));
    refs.basePlus = await snapshotLayout(app.page);
    await typeDigits(app.page, "9");
    refs.baseInput9 = await snapshotLayout(app.page);
  } finally {
    await closePage(app);
  }

  if (width === 320 && height === 568) {
    app = await openPage(browser, { label: `H1-ref-long-${cacheKey}`, width, height });
    try {
      await chooseOperator(app.page, "+");
      await app.page.evaluate(() => window.scrollTo(0, 0));
      await typeDigits(app.page, "123456789.5");
      refs.longInput = await snapshotLayout(app.page);
    } finally {
      await closePage(app);
    }
  }

  H1_REF_CACHE.set(cacheKey, refs);
  return refs;
}

function compareH1(bucket, actual, reference, label) {
  const comparison = compareLayouts(actual, reference);
  bumpMax(bucket, comparison);
  if (!comparison.ok) {
    addFailure(bucket, `${label} geometry`, `max=${num(comparison.max)}px at ${comparison.at}`);
  }
  return comparison;
}

async function h1Trial(browser, width, height, autoConfirm, refs, bucket) {
  const label = `H1-${width}x${height}-t${autoConfirm}`;
  const app = await openPage(browser, { label, width, height });
  try {
    const page = app.page;
    await applySettings(page, { auto: autoConfirm });
    await chooseOperator(page, "+");
    await page.evaluate(() => window.scrollTo(0, 0));
    const baseline = await snapshotLayout(page);
    compareH1(bucket, baseline, refs.plus, `${label} baseline`);

    let firstSample = null;
    if (autoConfirm < 0.5) {
      await installStabilityObserver(page);
      await clickKey(page, "9");
      try {
        const samples = await waitForStabilitySamples(page, 1, 500);
        firstSample = samples[0];
      } catch (error) {
        addFailure(bucket, `${label} observer`, `no feedback-visible mutation sample`);
      }
    } else {
      const startedAt = Date.now();
      await clickKey(page, "9");
      try {
        await waitFeedbackVisible(page, 500);
      } catch (error) {
        addFailure(bucket, `${label} poll`, `feedback not visible within 500ms`);
      }
      await waitTarget(startedAt, 150);
      firstSample = await snapshotLayout(page);
      if (!feedbackUsable(firstSample)) {
        addFailure(bucket, `${label} 150ms`, `hidden=${firstSample.feedbackHidden} height=${num(firstSample.feedback.height)}`);
      }
      if (firstSample.inputValue === "9") {
        compareH1(bucket, firstSample, refs.input9, `${label} 150ms`);
      } else {
        addFailure(bucket, `${label} 150ms value`, `input=${JSON.stringify(firstSample.inputValue)} expected "9"`);
      }

      await waitTarget(startedAt, 600);
      const at600 = await snapshotLayout(page);
      if (at600.inputValue === "9") {
        if (!feedbackUsable(at600)) {
          addFailure(bucket, `${label} 600ms`, `hidden=${at600.feedbackHidden} height=${num(at600.feedback.height)}`);
        }
        compareH1(bucket, at600, refs.input9, `${label} 600ms input`);
      } else if (at600.inputValue === "") {
        if (autoConfirm !== 0.5 || !at600.feedbackHidden) {
          addFailure(bucket, `${label} 600ms state`, `unexpected empty input before completion t=${autoConfirm}`);
        }
        compareH1(bucket, at600, refs.committed9, `${label} 600ms committed`);
      } else {
        addFailure(bucket, `${label} 600ms value`, `input=${JSON.stringify(at600.inputValue)}`);
      }
    }

    if (firstSample) {
      bucket.countdownSamples += 1;
      if (!feedbackUsable(firstSample)) {
        addFailure(bucket, `${label} first countdown`, `hidden=${firstSample.feedbackHidden} height=${num(firstSample.feedback?.height)}`);
      }
      if (firstSample.feedbackActive !== "true") {
        addFailure(bucket, `${label} active`, `data-active=${JSON.stringify(firstSample.feedbackActive)}`);
      }
      compareH1(bucket, firstSample, refs.input9, `${label} first countdown`);
      compareH1(bucket, baseline, firstSample, `${label} hidden-to-visible`);
    }

    const completionTimeout = Math.max(2500, Math.round(autoConfirm * 1000) + 3000);
    try {
      await page.waitForFunction(
        () => {
          const input = document.querySelector('[data-testid="calc-input"]');
          const feedback = document.querySelector('[data-testid="auto-confirm-feedback"]');
          return input?.value === "" && Boolean(feedback?.hidden);
        },
        undefined,
        { timeout: completionTimeout, polling: 10 },
      );
    } catch (error) {
      addFailure(bucket, `${label} completion`, `auto-confirm did not settle within ${completionTimeout}ms`);
    }
    const committed = await snapshotLayout(page);
    if (committed.undoHidden || !(committed.undo?.height > 0)) {
      addFailure(bucket, `${label} undo`, `hidden=${committed.undoHidden} height=${num(committed.undo?.height)}`);
    }
    compareH1(bucket, committed, refs.committed9, `${label} committed`);
    if (firstSample) compareH1(bucket, firstSample, committed, `${label} visible-to-hidden`);

    let secondSample = null;
    if (autoConfirm < 0.5) {
      await installStabilityObserver(page);
      await clickKey(page, "8");
      try {
        const samples = await waitForStabilitySamples(page, 1, 500);
        secondSample = samples[0];
      } catch (error) {
        addFailure(bucket, `${label} second observer`, `no feedback-visible mutation sample`);
      }
    } else {
      const startedAt = Date.now();
      await clickKey(page, "8");
      try {
        await waitFeedbackVisible(page, 500);
      } catch (error) {
        addFailure(bucket, `${label} second poll`, `feedback not visible within 500ms`);
      }
      await waitTarget(startedAt, 150);
      secondSample = await snapshotLayout(page);
    }
    if (secondSample) {
      bucket.countdownSamples += 1;
      if (!feedbackUsable(secondSample)) {
        addFailure(bucket, `${label} second countdown`, `hidden=${secondSample.feedbackHidden} height=${num(secondSample.feedback?.height)}`);
      }
      if (secondSample.feedbackActive !== "true") {
        addFailure(bucket, `${label} second active`, `data-active=${JSON.stringify(secondSample.feedbackActive)}`);
      }
      compareH1(bucket, secondSample, refs.committed9Input8, `${label} second countdown`);
    }

    bucket.coverage.add(`${width}x${height}@${autoConfirm}`);
  } finally {
    await closePage(app);
  }
}

async function h1NoOperator(browser, width, height, refs, bucket) {
  const label = `H1-no-operator-${width}x${height}`;
  const app = await openPage(browser, { label, width, height });
  try {
    const page = app.page;
    await applySettings(page, { auto: 2 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const baseline = await snapshotLayout(page);
    compareH1(bucket, baseline, refs.emptyStart, `${label} baseline`);
    const startedAt = Date.now();
    await clickKey(page, "9");
    await waitFeedbackVisible(page, 500);
    await waitTarget(startedAt, 150);
    const sample = await snapshotLayout(page);
    bucket.countdownSamples += 1;
    if (!feedbackUsable(sample) || sample.feedbackActive !== "true") {
      addFailure(bucket, label, `hidden=${sample.feedbackHidden} height=${num(sample.feedback.height)} active=${sample.feedbackActive}`);
    }
    compareH1(bucket, sample, refs.noOpInput9, label);
    compareH1(bucket, baseline, sample, `${label} hidden-to-visible`);
    bucket.coverage.add(`${width}x${height}@no-operator`);
  } finally {
    await closePage(app);
  }
}

async function h1BaseTen(browser, width, height, refs, bucket) {
  const label = `H1-base10-${width}x${height}`;
  const app = await openPage(browser, { label, width, height });
  try {
    const page = app.page;
    await applySettings(page, { auto: 2, base: "10" });
    await chooseOperator(page, "+");
    await page.evaluate(() => window.scrollTo(0, 0));
    const baseline = await snapshotLayout(page);
    compareH1(bucket, baseline, refs.basePlus, `${label} baseline`);
    const startedAt = Date.now();
    await clickKey(page, "9");
    await waitFeedbackVisible(page, 500);
    await waitTarget(startedAt, 150);
    const sample = await snapshotLayout(page);
    bucket.countdownSamples += 1;
    if (!feedbackUsable(sample) || sample.feedbackActive !== "true") {
      addFailure(bucket, label, `hidden=${sample.feedbackHidden} height=${num(sample.feedback.height)} active=${sample.feedbackActive}`);
    }
    compareH1(bucket, sample, refs.baseInput9, label);
    compareH1(bucket, baseline, sample, `${label} hidden-to-visible`);
    bucket.coverage.add(`${width}x${height}@base10`);
  } finally {
    await closePage(app);
  }
}

async function h1LongInput(browser, refs, bucket) {
  const label = "H1-long-320x568";
  const app = await openPage(browser, { label, width: 320, height: 568 });
  try {
    const page = app.page;
    await applySettings(page, { auto: 2 });
    await chooseOperator(page, "+");
    await page.evaluate(() => window.scrollTo(0, 0));
    await typeDigits(page, "123456789.5");
    await waitFeedbackVisible(page, 500);
    const sample = await snapshotLayout(page);
    bucket.countdownSamples += 1;
    if (sample.inputValue !== "123456789.5") {
      addFailure(bucket, `${label} value`, `input=${JSON.stringify(sample.inputValue)}`);
    }
    if (!feedbackUsable(sample) || sample.feedbackActive !== "true") {
      addFailure(bucket, label, `hidden=${sample.feedbackHidden} height=${num(sample.feedback.height)} active=${sample.feedbackActive}`);
    }
    compareH1(bucket, sample, refs.longInput, label);
    bucket.coverage.add("320x568@long");
  } finally {
    await closePage(app);
  }
}

async function runH1(browser) {
  const bucket = {
    failures: [],
    comparisons: 0,
    maxRectDelta: 0,
    countdownSamples: 0,
    coverage: new Set(),
  };
  for (const [width, height] of [
    [390, 844],
    [320, 568],
  ]) {
    try {
      const refs = await buildH1References(browser, width, height);
      for (const autoConfirm of [0.2, 0.4, 0.5, 1, 2, 10]) {
        await h1Trial(browser, width, height, autoConfirm, refs, bucket);
      }
      await h1NoOperator(browser, width, height, refs, bucket);
      await h1BaseTen(browser, width, height, refs, bucket);
      if (width === 320) await h1LongInput(browser, refs, bucket);
    } catch (error) {
      addFailure(bucket, `H1 ${width}x${height}`, errorText(error));
    }
  }
  const expectedCoverage = [
    ...["390x844", "320x568"].flatMap((viewport) => [0.2, 0.4, 0.5, 1, 2, 10].map((t) => `${viewport}@${t}`)),
    "390x844@no-operator",
    "390x844@base10",
    "320x568@no-operator",
    "320x568@base10",
    "320x568@long",
  ];
  const missingCoverage = expectedCoverage.filter((item) => !bucket.coverage.has(item));
  if (missingCoverage.length) addFailure(bucket, "H1 coverage", `missing=${missingCoverage.join(",")}`);
  return {
    pass: bucket.failures.length === 0,
    detail:
      `trials=${bucket.coverage.size} comparisons=${bucket.comparisons} countdownSamples=${bucket.countdownSamples} ` +
      `maxRectDelta=${num(bucket.maxRectDelta)}px coverage=${expectedCoverage.length - missingCoverage.length}/${expectedCoverage.length}` +
      (bucket.failures.length ? `; ${bucket.failures.join(" | ")}` : ""),
  };
}

async function currentCore(page) {
  return page.evaluate(() => {
    const input = document.querySelector('[data-testid="calc-input"]');
    const expression = document.querySelector('[data-testid="expression"]');
    const feedback = document.querySelector('[data-testid="auto-confirm-feedback"]');
    const progress = document.querySelector('[data-testid="auto-confirm-progress"]');
    const countdown = document.querySelector('[data-testid="auto-confirm-countdown"]');
    const rect = progress?.getBoundingClientRect();
    return {
      inputValue: input?.value ?? null,
      expression: expression?.textContent ?? null,
      feedbackHidden: Boolean(feedback?.hidden),
      feedbackHeight: feedback?.getBoundingClientRect().height ?? null,
      feedbackActive: feedback?.getAttribute("data-active") ?? null,
      progressActive: progress?.getAttribute("data-active") ?? null,
      progressHeight: rect?.height ?? null,
      countdown: countdown?.textContent ?? null,
      historyCount: document.querySelectorAll('[data-testid="history-item"]').length,
    };
  });
}

function operandTokens(text, operator = "+") {
  return String(text ?? "")
    .split(new RegExp(`\\s*${operator === "*" ? "\\*" : operator === "/" ? "\\/" : operator === "-" ? "-" : "\\+"}\\s*`))
    .map((part) => part.trim())
    .filter(Boolean);
}

async function runH2Step(bucket, label, work) {
  try {
    await work();
    bucket.steps += 1;
  } catch (error) {
    addFailure(bucket, label, errorText(error));
  }
}

async function runH2(browser) {
  const bucket = { failures: [], steps: 0, feedbackHeights: [], progressHeights: [], commitCounts: [] };
  const check = (label, condition, detail) => {
    if (!condition) addFailure(bucket, label, detail);
  };

  await runH2Step(bucket, "t=2 countdown", async () => {
    const app = await openPage(browser, { label: "H2-t2", width: 390, height: 844 });
    try {
      const { page } = app;
      await applySettings(page, { auto: 2 });
      await chooseOperator(page, "+");
      await installAutoCommitProbe(page);
      const startedAt = Date.now();
      await clickKey(page, "9");
      try {
        await waitFeedbackVisible(page, 500);
      } catch (error) {
        check("H2 t=2 visibility", false, "feedback not visible within 500ms");
      }
      await waitTarget(startedAt, 150);
      const first = await currentCore(page);
      bucket.feedbackHeights.push(first.feedbackHeight);
      bucket.progressHeights.push(first.progressHeight);
      check("H2 t=2 visible", !first.feedbackHidden, `hidden=${first.feedbackHidden}`);
      check("H2 t=2 feedback height", first.feedbackHeight >= 16, `height=${num(first.feedbackHeight)}`);
      check("H2 t=2 active", first.feedbackActive === "true", `data-active=${JSON.stringify(first.feedbackActive)}`);
      check("H2 t=2 progress active", first.progressActive === "true", `data-active=${JSON.stringify(first.progressActive)}`);
      check("H2 t=2 progress height", first.progressHeight >= 1 && first.progressHeight <= 4, `height=${num(first.progressHeight)}`);
      check("H2 t=2 countdown-9", String(first.countdown).includes("9"), `text=${JSON.stringify(first.countdown)}`);
      await waitTarget(startedAt, 900);
      const second = await currentCore(page);
      check("H2 t=2 countdown changed", second.countdown !== first.countdown, `${JSON.stringify(first.countdown)} -> ${JSON.stringify(second.countdown)}`);
      check("H2 t=2 countdown-9b", String(second.countdown).includes("9"), `text=${JSON.stringify(second.countdown)}`);
      await waitTarget(startedAt, 2300);
      const committed = await currentCore(page);
      check("H2 t=2 expression", String(committed.expression).includes("9"), `expression=${JSON.stringify(committed.expression)}`);
      check("H2 t=2 input-empty", committed.inputValue === "", `input=${JSON.stringify(committed.inputValue)}`);
      const events = await readAutoCommitEvents(page);
      bucket.commitCounts.push(events.length);
      check("H2 t=2 commit count", events.length === 1, `commits=${events.length}`);
    } finally {
      await closePage(app);
    }
  });

  await runH2Step(bucket, "t=0", async () => {
    const app = await openPage(browser, { label: "H2-t0", width: 390, height: 844 });
    try {
      const { page } = app;
      await applySettings(page, { auto: 0 });
      await installAutoCommitProbe(page);
      await installStabilityObserver(page);
      await clickKey(page, "9");
      await sleep(1200);
      const core = await currentCore(page);
      const samples = await page.evaluate(() => window.__stabilitySamples?.length ?? 0);
      check("H2 t=0 input", core.inputValue === "9", `input=${JSON.stringify(core.inputValue)}`);
      check("H2 t=0 expression", core.expression === "", `expression=${JSON.stringify(core.expression)}`);
      check("H2 t=0 hidden", core.feedbackHidden, `hidden=${core.feedbackHidden}`);
      check("H2 t=0 no-visible-transition", samples === 0, `visibleSamples=${samples}`);
      const events = await readAutoCommitEvents(page);
      bucket.commitCounts.push(events.length);
      check("H2 t=0 commit count", events.length === 0, `commits=${events.length}`);
    } finally {
      await closePage(app);
    }
  });

  await runH2Step(bucket, "t=0.2", async () => {
    const app = await openPage(browser, { label: "H2-t0.2", width: 390, height: 844 });
    try {
      const { page } = app;
      await applySettings(page, { auto: 0.2 });
      await chooseOperator(page, "+");
      await installAutoCommitProbe(page);
      await installStabilityObserver(page);
      const startedAt = Date.now();
      await clickKey(page, "9");
      const samples = await waitForStabilitySamples(page, 1, 500);
      const visible = samples[0];
      bucket.feedbackHeights.push(visible.feedback.height);
      check("H2 t=0.2 visible", visible.feedbackActive === "true", `data-active=${JSON.stringify(visible.feedbackActive)}`);
      check("H2 t=0.2 feedback height", visible.feedback.height >= 16, `height=${num(visible.feedback.height)}`);
      const remaining = Math.max(1, 350 - (Date.now() - startedAt));
      try {
        await page.waitForFunction(
          () => (document.querySelector('[data-testid="expression"]')?.textContent ?? "").includes("9"),
          undefined,
          { timeout: remaining, polling: 10 },
        );
      } catch (error) {
        check("H2 t=0.2 expression", false, `not committed within 350ms (elapsed=${Date.now() - startedAt}ms)`);
      }
      const events = await readAutoCommitEvents(page);
      bucket.commitCounts.push(events.length);
      check("H2 t=0.2 commit count", events.length === 1, `commits=${events.length}`);
    } finally {
      await closePage(app);
    }
  });

  await runH2Step(bucket, "t=0.4", async () => {
    const app = await openPage(browser, { label: "H2-t0.4", width: 390, height: 844 });
    try {
      const { page } = app;
      await applySettings(page, { auto: 0.4 });
      await chooseOperator(page, "+");
      await installAutoCommitProbe(page);
      await installStabilityObserver(page);
      const startedAt = Date.now();
      await clickKey(page, "9");
      const samples = await waitForStabilitySamples(page, 1, 600);
      const visible = samples[0];
      bucket.feedbackHeights.push(visible.feedback.height);
      check("H2 t=0.4 visible", visible.feedbackActive === "true", `data-active=${JSON.stringify(visible.feedbackActive)}`);
      check("H2 t=0.4 feedback height", visible.feedback.height >= 16, `height=${num(visible.feedback.height)}`);
      const remaining = Math.max(1, 600 - (Date.now() - startedAt));
      try {
        await page.waitForFunction(
          () => (document.querySelector('[data-testid="expression"]')?.textContent ?? "").includes("9"),
          undefined,
          { timeout: remaining, polling: 10 },
        );
      } catch (error) {
        check("H2 t=0.4 expression", false, `not committed within 600ms (elapsed=${Date.now() - startedAt}ms)`);
      }
      const events = await readAutoCommitEvents(page);
      bucket.commitCounts.push(events.length);
      check("H2 t=0.4 commit count", events.length === 1, `commits=${events.length}`);
    } finally {
      await closePage(app);
    }
  });

  await runH2Step(bucket, "t=0.5", async () => {
    const app = await openPage(browser, { label: "H2-t0.5", width: 390, height: 844 });
    try {
      const { page } = app;
      await applySettings(page, { auto: 0.5 });
      await chooseOperator(page, "+");
      await installAutoCommitProbe(page);
      const startedAt = Date.now();
      await clickKey(page, "9");
      await waitTarget(startedAt, 900);
      const core = await currentCore(page);
      check("H2 t=0.5 expression", String(core.expression).includes("9"), `expression=${JSON.stringify(core.expression)}`);
      check("H2 t=0.5 input empty", core.inputValue === "", `input=${JSON.stringify(core.inputValue)}`);
      const events = await readAutoCommitEvents(page);
      bucket.commitCounts.push(events.length);
      check("H2 t=0.5 commit count", events.length === 1, `commits=${events.length}`);
    } finally {
      await closePage(app);
    }
  });

  await runH2Step(bucket, "t=1 reset", async () => {
    const app = await openPage(browser, { label: "H2-t1-reset", width: 390, height: 844 });
    try {
      const { page } = app;
      await applySettings(page, { auto: 1 });
      await chooseOperator(page, "+");
      await installAutoCommitProbe(page);
      await clickKey(page, "9");
      await sleep(600);
      await clickKey(page, "5");
      await sleep(800);
      const mid = await currentCore(page);
      const midEvents = await readAutoCommitEvents(page);
      check("H2 t=1 reset input", mid.inputValue === "95", `input=${JSON.stringify(mid.inputValue)}`);
      check("H2 t=1 reset expression empty", mid.expression === "", `expression=${JSON.stringify(mid.expression)}`);
      check("H2 t=1 reset no early commit", midEvents.length === 0, `commits=${midEvents.length}`);
      await sleep(600);
      const done = await currentCore(page);
      const events = await readAutoCommitEvents(page);
      bucket.commitCounts.push(events.length);
      const tokens = operandTokens(done.expression, "+");
      check("H2 t=1 reset committed", String(done.expression).includes("95"), `expression=${JSON.stringify(done.expression)}`);
      check("H2 t=1 reset one operand", tokens.length === 1 && tokens[0] === "95", `tokens=${JSON.stringify(tokens)}`);
      check("H2 t=1 reset input empty", done.inputValue === "", `input=${JSON.stringify(done.inputValue)}`);
      check("H2 t=1 reset commit count", events.length === 1, `commits=${events.length}`);
      check("H2 t=1 reset history", done.historyCount === 0, `history=${done.historyCount}`);
    } finally {
      await closePage(app);
    }
  });

  await runH2Step(bucket, "t=0.5 trailing-dot", async () => {
    const app = await openPage(browser, { label: "H2-trailing-dot", width: 390, height: 844 });
    try {
      const { page } = app;
      await applySettings(page, { auto: 0.5 });
      await chooseOperator(page, "+");
      await installAutoCommitProbe(page);
      await clickKey(page, "9");
      await clickKey(page, ".");
      await sleep(800);
      const held = await currentCore(page);
      check("H2 trailing-dot held", held.inputValue === "9.", `input=${JSON.stringify(held.inputValue)}`);
      await clickKey(page, "5");
      await sleep(900);
      const done = await currentCore(page);
      const events = await readAutoCommitEvents(page);
      bucket.commitCounts.push(events.length);
      check("H2 trailing-dot committed", String(done.expression).includes("9.5"), `expression=${JSON.stringify(done.expression)}`);
      check("H2 trailing-dot input empty", done.inputValue === "", `input=${JSON.stringify(done.inputValue)}`);
      check("H2 trailing-dot commit count", events.length === 1, `commits=${events.length}`);
    } finally {
      await closePage(app);
    }
  });

  await runH2Step(bucket, "t=1 settings pause", async () => {
    const app = await openPage(browser, { label: "H2-settings-pause", width: 390, height: 844 });
    try {
      const { page } = app;
      await applySettings(page, { auto: 1 });
      await clickKey(page, "9");
      await page.click(S.settingsToggle);
      await page.waitForFunction(
        () => {
          const panel = document.querySelector('[data-testid="settings-panel"]');
          return Boolean(panel && (panel.open || panel.hasAttribute("open")));
        },
        undefined,
        { timeout: 2000, polling: 10 },
      );
      await sleep(1400);
      const paused = await currentCore(page);
      check("H2 settings-pause input", paused.inputValue === "9", `input=${JSON.stringify(paused.inputValue)}`);
      check("H2 settings-pause expression", paused.expression === "", `expression=${JSON.stringify(paused.expression)}`);
      await page.click(S.settingsDone);
      await sleep(1400);
      const resumed = await currentCore(page);
      check("H2 settings-resume expression", String(resumed.expression).includes("9"), `expression=${JSON.stringify(resumed.expression)}`);
      check("H2 settings-resume input empty", resumed.inputValue === "", `input=${JSON.stringify(resumed.inputValue)}`);
    } finally {
      await closePage(app);
    }
  });

  await runH2Step(bucket, "t=1 manual enter", async () => {
    const app = await openPage(browser, { label: "H2-manual-enter", width: 390, height: 844 });
    try {
      const { page } = app;
      await applySettings(page, { auto: 1 });
      await clickKey(page, "9");
      await page.click(S.enter);
      await sleep(1400);
      const done = await currentCore(page);
      const tokens = operandTokens(done.expression, "+");
      check("H2 manual-enter single operand", tokens.length === 1 && tokens[0] === "9", `expression=${JSON.stringify(done.expression)} tokens=${JSON.stringify(tokens)}`);
      check("H2 manual-enter input empty", done.inputValue === "", `input=${JSON.stringify(done.inputValue)}`);
      check("H2 manual-enter history", done.historyCount === 0, `history=${done.historyCount}`);
    } finally {
      await closePage(app);
    }
  });

  await runH2Step(bucket, "reduced motion", async () => {
    const app = await openPage(browser, { label: "H2-reduced-motion", width: 390, height: 844, reducedMotion: "reduce" });
    try {
      const { page } = app;
      await applySettings(page, { auto: 0.5 });
      await chooseOperator(page, "+");
      await installAutoCommitProbe(page);
      const startedAt = Date.now();
      await clickKey(page, "9");
      await waitTarget(startedAt, 900);
      const core = await currentCore(page);
      const events = await readAutoCommitEvents(page);
      bucket.commitCounts.push(events.length);
      check("H2 reduced-motion confirms", String(core.expression).includes("9"), `expression=${JSON.stringify(core.expression)}`);
      check("H2 reduced-motion commit count", events.length === 1, `commits=${events.length}`);
    } finally {
      await closePage(app);
    }
  });

  const minFeedbackHeight = bucket.feedbackHeights.length ? Math.min(...bucket.feedbackHeights) : NaN;
  const minProgressHeight = bucket.progressHeights.length ? Math.min(...bucket.progressHeights) : NaN;
  const maxProgressHeight = bucket.progressHeights.length ? Math.max(...bucket.progressHeights) : NaN;
  return {
    pass: bucket.failures.length === 0,
    detail:
      `groups=${bucket.steps}/10 minFeedbackHeight=${num(minFeedbackHeight)} progressHeight=${num(minProgressHeight)}-${num(maxProgressHeight)} ` +
      `commitCounts=${JSON.stringify(bucket.commitCounts)}` +
      (bucket.failures.length ? `; ${bucket.failures.join(" | ")}` : ""),
  };
}

async function keyCenters(page, keys) {
  return page.evaluate((wanted) => {
    const result = {};
    for (const key of wanted) {
      const element = document.querySelector(`[data-key="${key}"]`);
      const rect = element.getBoundingClientRect();
      result[key] = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    return result;
  }, keys);
}

async function keypadRect(page) {
  return page.evaluate(() => {
    const rect = document.querySelector('[data-testid="keypad"]').getBoundingClientRect();
    return { top: rect.top, left: rect.left, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
  });
}

async function runH3Context(browser, width, height) {
  const failures = [];
  const app = await openPage(browser, { label: `H3-${width}x${height}`, width, height });
  try {
    const page = app.page;
    await applySettings(page, { auto: 2 });
    await chooseOperator(page, "+");
    await page.evaluate(() => window.scrollTo(0, 0));
    const referenceKeypad = await keypadRect(page);
    const centers = await keyCenters(page, ["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    let maxKeypadDelta = 0;
    const observed = [];
    const clickSequence = async (keys, expected) => {
      for (let index = 0; index < keys.length; index += 1) {
        const startedAt = Date.now();
        const point = centers[keys[index]];
        await page.mouse.click(point.x, point.y, { delay: 0 });
        const value = await page.inputValue(S.input);
        const current = await keypadRect(page);
        const deltas = ["top", "left", "width", "height"].map((edge) => Math.abs(current[edge] - referenceKeypad[edge]));
        const delta = Math.max(...deltas);
        maxKeypadDelta = Math.max(maxKeypadDelta, delta);
        observed.push(value);
        if (value !== expected[index]) failures.push(`${keys.join("")} step ${index + 1}: got ${JSON.stringify(value)} expected ${JSON.stringify(expected[index])}`);
        if (delta > GEOMETRY_TOLERANCE + NUMERIC_TOLERANCE) failures.push(`keypad moved ${num(delta)}px after ${keys[index]}`);
        await waitTarget(startedAt, 80);
      }
    };
    await clickSequence(["1", "2", "3", "4", "5"], ["1", "12", "123", "1234", "12345"]);
    await sleep(2200);
    const between = await page.evaluate(() => ({
      input: document.querySelector('[data-testid="calc-input"]').value,
      expression: document.querySelector('[data-testid="expression"]').textContent,
      history: document.querySelectorAll('[data-testid="history-item"]').length,
    }));
    if (between.input !== "") failures.push(`after first auto-confirm input=${JSON.stringify(between.input)}`);
    if (!String(between.expression).includes("12345")) failures.push(`after first auto-confirm expression=${JSON.stringify(between.expression)}`);
    if (between.history !== 0) failures.push(`after first auto-confirm history=${between.history}`);
    await clickSequence(["6", "7", "8", "9"], ["6", "67", "678", "6789"]);
    await sleep(2200);
    const final = await page.evaluate(() => ({
      input: document.querySelector('[data-testid="calc-input"]').value,
      expression: document.querySelector('[data-testid="expression"]').textContent,
      history: document.querySelectorAll('[data-testid="history-item"]').length,
    }));
    if (final.input !== "") failures.push(`final input=${JSON.stringify(final.input)}`);
    if (!String(final.expression).includes("12345") || !String(final.expression).includes("6789")) {
      failures.push(`final expression=${JSON.stringify(final.expression)}`);
    }
    if (final.history !== 0) failures.push(`final history=${final.history}`);
    return { failures, observed, final, maxKeypadDelta };
  } finally {
    await closePage(app);
  }
}

async function runH3(browser) {
  const failures = [];
  const details = [];
  for (const [width, height] of [
    [390, 844],
    [320, 568],
  ]) {
    try {
      const result = await runH3Context(browser, width, height);
      failures.push(...result.failures.map((item) => `${width}x${height}: ${item}`));
      details.push(`${width}x${height}: obs=${JSON.stringify(result.observed)} maxKeypadDelta=${num(result.maxKeypadDelta)} final=${JSON.stringify(result.final.expression)}`);
    } catch (error) {
      failures.push(`${width}x${height}: ${errorText(error)}`);
    }
  }
  return { pass: failures.length === 0, detail: `${details.join("; ")}${failures.length ? `; ${failures.join(" | ")}` : ""}` };
}

async function measureH4(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && element.getClientRects().length > 0;
    };
    const rectOf = (element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, left: rect.left, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
    };
    const intersections = (left, right) => {
      const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
      const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
      return width * height;
    };
    const controls = [...document.querySelectorAll("input, button, select")]
      .filter(visible)
      .map((element) => {
        let rectTarget = element;
        if (element.matches('input[type="checkbox"]')) {
          const label = element.closest("label");
          if (label) rectTarget = label;
        }
        return {
          tag: element.tagName.toLowerCase(),
          type: element.getAttribute("type"),
          testid: element.getAttribute("data-testid"),
          key: element.getAttribute("data-key"),
          rect: rectOf(rectTarget),
          fontSize: parseFloat(getComputedStyle(element).fontSize),
        };
      });
    const keypad = document.querySelector('[data-testid="keypad"]');
    const feedback = document.querySelector('[data-testid="auto-confirm-feedback"]');
    const undo = document.querySelector('[data-testid="undo-hint"]');
    const calcInput = document.querySelector('[data-testid="calc-input"]');
    const display = document.querySelector(".display");
    const feedbackRect = rectOf(feedback);
    const feedbackVisible = visible(feedback);
    const protectedElements = [
      { label: "calc-input", rect: rectOf(calcInput) },
      { label: "display", rect: rectOf(display) },
      { label: "keypad", rect: rectOf(keypad) },
      ...controls.map((control) => ({ label: `${control.tag}[${control.testid ?? control.key ?? ""}]`, rect: control.rect })),
    ];
    let maxIntersection = 0;
    let maxIntersectionWith = "none";
    if (feedbackVisible) {
      for (const protectedElement of protectedElements) {
        const area = intersections(feedbackRect, protectedElement.rect);
        if (area > maxIntersection) {
          maxIntersection = area;
          maxIntersectionWith = protectedElement.label;
        }
      }
    }
    const keys = {};
    for (const key of document.querySelectorAll('[data-key]')) {
      if (visible(key)) keys[key.getAttribute("data-key")] = rectOf(key);
    }
    return {
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      keypad: rectOf(keypad),
      keys,
      controls,
      feedback: feedbackRect,
      feedbackVisible,
      feedbackHeight: feedbackRect.height,
      maxIntersection,
      maxIntersectionWith,
      feedbackInViewport:
        feedbackRect.top >= -0.5 &&
        feedbackRect.left >= -0.5 &&
        feedbackRect.right <= window.innerWidth + 0.5 &&
        feedbackRect.bottom <= window.innerHeight + 0.5,
      undoVisible: visible(undo),
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
}

function h4ProtectedChecks(bucket, label, measurement, { enforceControls = true, enforceBottom = false } = {}) {
  if (measurement.docOverflow > 1 || measurement.bodyOverflow > 1) {
    addFailure(bucket, `${label} overflow`, `doc=${num(measurement.docOverflow)} body=${num(measurement.bodyOverflow)}`);
  }
  if (measurement.feedbackVisible) {
    if (measurement.maxIntersection > 1) {
      addFailure(bucket, `${label} obstruction`, `area=${num(measurement.maxIntersection)} with=${measurement.maxIntersectionWith}`);
    }
    if (!measurement.feedbackInViewport) {
      addFailure(bucket, `${label} feedback viewport`, JSON.stringify(measurement.feedback));
    }
  }
  if (enforceControls) {
    const tooSmall = measurement.controls.filter((control) => control.rect.width < 43.5 || control.rect.height < 43.5);
    if (tooSmall.length) {
      addFailure(bucket, `${label} control-size`, tooSmall.map((control) => `${control.testid ?? control.key ?? control.tag}:${num(control.rect.width)}x${num(control.rect.height)}`).join(","));
    }
    const smallText = measurement.controls.filter(
      (control) => (control.tag === "input" || control.tag === "select") && control.fontSize < 15.5,
    );
    if (smallText.length) {
      addFailure(bucket, `${label} font-size`, smallText.map((control) => `${control.testid ?? control.tag}:${num(control.fontSize)}`).join(","));
    }
    if (enforceBottom) {
      if (measurement.keypad.bottom > 580) addFailure(bucket, `${label} keypad-bottom`, `bottom=${num(measurement.keypad.bottom)}`);
      const outside = Object.entries(measurement.keys).filter(([, rect]) => rect.left < -NUMERIC_TOLERANCE || rect.right > 320 + NUMERIC_TOLERANCE);
      if (outside.length) addFailure(bucket, `${label} key-horizontal`, outside.map(([key, rect]) => `${key}:${num(rect.left)}-${num(rect.right)}`).join(","));
    }
  }
}

async function h4State(browser, width, height, state) {
  const app = await openPage(browser, { label: `H4-${width}x${height}-${state}`, width, height });
  try {
    const page = app.page;
    let baseIdle = null;
    if (state === "idle") {
      await applySettings(page, { auto: 1 });
      await chooseOperator(page, "+");
      await page.evaluate(() => window.scrollTo(0, 0));
    } else if (state === "countdown") {
      await applySettings(page, { auto: 1 });
      await chooseOperator(page, "+");
      await page.evaluate(() => window.scrollTo(0, 0));
      await clickKey(page, "9");
      await waitFeedbackVisible(page, 500);
    } else if (state === "committed") {
      await applySettings(page, { auto: 1 });
      await chooseOperator(page, "+");
      await page.evaluate(() => window.scrollTo(0, 0));
      const startedAt = Date.now();
      await clickKey(page, "9");
      await waitTarget(startedAt, 1400);
      await page.waitForFunction(
        () => document.querySelector('[data-testid="calc-input"]')?.value === "",
        undefined,
        { timeout: 1200, polling: 10 },
      );
    } else if (state === "base10") {
      await applySettings(page, { auto: 10, base: "10" });
      await chooseOperator(page, "+");
      await page.evaluate(() => window.scrollTo(0, 0));
      baseIdle = await measureH4(page);
      await clickKey(page, "9");
      await waitFeedbackVisible(page, 500);
    } else {
      throw new Error(`unknown H4 state ${state}`);
    }
    return { measurement: await measureH4(page), baseIdle };
  } finally {
    await closePage(app);
  }
}

function compareKeypadOnly(actual, reference) {
  return Math.max(...["top", "left", "width", "height"].map((edge) => Math.abs(actual[edge] - reference[edge])));
}

async function runH4(browser) {
  const bucket = { failures: [], states: 0, minControlWidth: Infinity, minControlHeight: Infinity, minFont: Infinity, maxOverflow: -Infinity, maxIntersection: -Infinity, maxKeypadMove: 0 };
  const byViewport = new Map();
  for (const [width, height] of [
    [320, 568],
    [390, 844],
  ]) {
    const measurements = {};
    for (const state of ["idle", "countdown", "committed", "base10"]) {
      try {
        const result = await h4State(browser, width, height, state);
        const measurement = result.measurement;
        measurements[state] = measurement;
        bucket.states += 1;
        for (const control of measurement.controls) {
          bucket.minControlWidth = Math.min(bucket.minControlWidth, control.rect.width);
          bucket.minControlHeight = Math.min(bucket.minControlHeight, control.rect.height);
          if (control.tag === "input" || control.tag === "select") bucket.minFont = Math.min(bucket.minFont, control.fontSize);
        }
        bucket.maxOverflow = Math.max(bucket.maxOverflow, measurement.docOverflow, measurement.bodyOverflow);
        if (measurement.feedbackVisible) bucket.maxIntersection = Math.max(bucket.maxIntersection, measurement.maxIntersection);
        if (state === "committed" && !measurement.undoVisible) addFailure(bucket, `H4 ${width} committed`, "undo hint is not visible");
        if (state === "base10") {
          h4ProtectedChecks(bucket, `H4 ${width}x${height} base10`, measurement, { enforceControls: false, enforceBottom: false });
          const move = compareKeypadOnly(measurement.keypad, result.baseIdle.keypad);
          bucket.maxKeypadMove = Math.max(bucket.maxKeypadMove, move);
          if (move > GEOMETRY_TOLERANCE + NUMERIC_TOLERANCE) addFailure(bucket, `H4 ${width} base10 movement`, `${num(move)}px`);
        } else {
          h4ProtectedChecks(bucket, `H4 ${width}x${height} ${state}`, measurement, {
            enforceControls: true,
            enforceBottom: width === 320,
          });
          if (width === 390) {
            const kp = measurement.keypad;
            if (kp.top < -0.5 || kp.left < -0.5 || kp.right > 390.5 || kp.bottom > 844.5) {
              addFailure(bucket, `H4 390 keypad viewport`, JSON.stringify(kp));
            }
          }
        }
      } catch (error) {
        addFailure(bucket, `H4 ${width}x${height} ${state}`, errorText(error));
      }
    }
    if (measurements.idle && measurements.countdown && measurements.committed) {
      for (const state of ["countdown", "committed"]) {
        const move = compareKeypadOnly(measurements[state].keypad, measurements.idle.keypad);
        bucket.maxKeypadMove = Math.max(bucket.maxKeypadMove, move);
        if (move > GEOMETRY_TOLERANCE + NUMERIC_TOLERANCE) addFailure(bucket, `H4 ${width} ${state} keypad movement`, `${num(move)}px`);
      }
    }
    byViewport.set(width, measurements);
  }
  return {
    pass: bucket.failures.length === 0,
    detail:
      `states=${bucket.states}/8 maxOverflow=${num(bucket.maxOverflow)}px minControl=${num(bucket.minControlWidth)}x${num(bucket.minControlHeight)} ` +
      `minInputSelectFont=${num(bucket.minFont)}px maxIntersection=${num(bucket.maxIntersection)}px2 maxKeypadMove=${num(bucket.maxKeypadMove)}px` +
      (bucket.failures.length ? `; ${bucket.failures.join(" | ")}` : ""),
  };
}

function expectedAutoOptions() {
  return ["0", "0.2", "0.4", ...Array.from({ length: 20 }, (_, index) => String((index + 1) / 2))];
}

async function directH5Steps(browser) {
  const failures = [];
  const notes = [];
  const step = async (label, work) => {
    try {
      const note = await work();
      notes.push(`${label}:${note}`);
    } catch (error) {
      failures.push(`${label}:${errorText(error)}`);
    }
  };

  await step("manual-enter", async () => {
    const app = await openPage(browser, { label: "H5-manual-enter", width: 390, height: 844 });
    try {
      const { page } = app;
      await applySettings(page, { auto: 1 });
      await clickKey(page, "9");
      await page.click(S.enter);
      await sleep(1400);
      const value = await page.evaluate(() => ({
        expression: document.querySelector('[data-testid="expression"]').textContent,
        input: document.querySelector('[data-testid="calc-input"]').value,
      }));
      const tokens = operandTokens(value.expression, "+");
      if (tokens.length !== 1 || tokens[0] !== "9") failures.push(`manual-enter expression=${JSON.stringify(value.expression)}`);
      if (value.input !== "") failures.push(`manual-enter input=${JSON.stringify(value.input)}`);
      return `expression=${JSON.stringify(value.expression)}`;
    } finally {
      await closePage(app);
    }
  });

  await step("sum", async () => {
    const app = await openPage(browser, { label: "H5-sum", width: 390, height: 844 });
    try {
      const { page } = app;
      await applySettings(page, { auto: 1 });
      await chooseOperator(page, "+");
      await typeDigits(page, "9");
      await page.click(S.enter);
      await typeDigits(page, "9.2");
      await page.click(S.equals);
      await sleep(1500);
      const value = await page.evaluate(() => ({
        result: document.querySelector('[data-testid="result"]').getAttribute("data-value"),
        history: document.querySelectorAll('[data-testid="history-item"]').length,
        input: document.querySelector('[data-testid="calc-input"]').value,
      }));
      if (value.result !== "18.2") failures.push(`sum result=${JSON.stringify(value.result)}`);
      if (value.history !== 1) failures.push(`sum history=${value.history}`);
      if (value.input !== "") failures.push(`sum input=${JSON.stringify(value.input)}`);
      return `result=${value.result} history=${value.history}`;
    } finally {
      await closePage(app);
    }
  });

  await step("backspace", async () => {
    const app = await openPage(browser, { label: "H5-backspace", width: 390, height: 844 });
    try {
      const { page } = app;
      await applySettings(page, { auto: 1 });
      await clickKey(page, "9");
      await sleep(1400);
      const before = await currentCore(page);
      await clickKey(page, "backspace");
      const after = await page.evaluate(() => ({
        expression: document.querySelector('[data-testid="expression"]').textContent,
        history: document.querySelectorAll('[data-testid="history-item"]').length,
      }));
      const beforeTokens = operandTokens(before.expression, "+").length;
      const afterTokens = operandTokens(after.expression, "+").length;
      if (!(beforeTokens === 1 && afterTokens === 0)) failures.push(`backspace tokens ${beforeTokens}->${afterTokens}`);
      if (after.history !== 0) failures.push(`backspace history=${after.history}`);
      return `tokens=${beforeTokens}->${afterTokens}`;
    } finally {
      await closePage(app);
    }
  });

  await step("options-persistence", async () => {
    const app = await openPage(browser, { label: "H5-options-persistence", width: 390, height: 844 });
    try {
      const { page } = app;
      const expected = expectedAutoOptions();
      const initial = await page.evaluate(() => {
        const select = document.querySelector('[data-testid="settings-auto-confirm"]');
        return {
          values: [...select.options].map((option) => option.value),
          texts: [...select.options].map((option) => option.textContent),
          value: select.value,
        };
      });
      if (!isDeepStrictEqual(initial.values, expected)) failures.push(`option values=${JSON.stringify(initial.values)}`);
      if (initial.value !== "0") failures.push(`default option=${JSON.stringify(initial.value)}`);
      const pointTwoText = initial.texts[initial.values.indexOf("0.2")] ?? "";
      const pointFourText = initial.texts[initial.values.indexOf("0.4")] ?? "";
      if (!pointTwoText.includes("0.2")) failures.push(`0.2 option text=${JSON.stringify(pointTwoText)}`);
      if (!pointFourText.includes("0.4")) failures.push(`0.4 option text=${JSON.stringify(pointFourText)}`);
      await page.click(S.settingsToggle);
      await page.selectOption(S.autoSelect, "0.2");
      const stored = await page.evaluate(() => localStorage.getItem("cal-phone.settings.v1"));
      if (!stored) failures.push("localStorage settings empty after selecting 0.2");
      const parsed = stored ? JSON.parse(stored) : {};
      if (Number(parsed.autoConfirm) !== 0.2) failures.push(`stored autoConfirm=${JSON.stringify(parsed.autoConfirm)}`);
      await page.click(S.settingsDone);
      await page.reload({ waitUntil: "load" });
      const afterReload = await page.$eval(S.autoSelect, (element) => element.value);
      if (afterReload !== "0.2") failures.push(`reload 0.2 value=${JSON.stringify(afterReload)}`);
      const startedAt = Date.now();
      await clickKey(page, "9");
      try {
        await page.waitForFunction(
          () => (document.querySelector('[data-testid="expression"]')?.textContent ?? "").includes("9"),
          undefined,
          { timeout: 350, polling: 10 },
        );
      } catch (error) {
        failures.push(`0.2 post-reload confirm exceeded 350ms (elapsed=${Date.now() - startedAt}ms)`);
      }
      await page.click(S.settingsToggle);
      await page.selectOption(S.autoSelect, "1");
      await page.click(S.settingsDone);
      await page.reload({ waitUntil: "load" });
      const oneAfterReload = await page.$eval(S.autoSelect, (element) => element.value);
      if (oneAfterReload !== "1") failures.push(`reload 1 value=${JSON.stringify(oneAfterReload)}`);
      return `options=${initial.values.length} default=${initial.value} persisted=0.2,1`;
    } finally {
      await closePage(app);
    }
  });

  await step("base-9.5", async () => {
    const app = await openPage(browser, { label: "H5-base-9.5", width: 390, height: 844 });
    try {
      const { page } = app;
      await applySettings(page, { auto: 0, base: "10" });
      await chooseOperator(page, "+");
      await typeDigits(page, "9.5");
      await page.click(S.enter);
      await page.click(S.equals);
      const result = await page.$eval(S.result, (element) => element.getAttribute("data-value"));
      if (result !== "19.5") failures.push(`base 9.5 result=${JSON.stringify(result)}`);
      return `result=${result}`;
    } finally {
      await closePage(app);
    }
  });

  await step("base-history-edit", async () => {
    const app = await openPage(browser, { label: "H5-base-history-edit", width: 390, height: 844 });
    try {
      const { page } = app;
      await applySettings(page, { auto: 0, base: "10" });
      await chooseOperator(page, "+");
      await typeDigits(page, "2");
      await page.click(S.enter);
      await typeDigits(page, "3");
      await page.click(S.enter);
      await page.click(S.equals);
      await page.click(S.settingsToggle);
      await page.fill(S.baseValue, "20");
      await page.click(S.settingsDone);
      await chooseOperator(page, "+");
      await typeDigits(page, "2");
      await page.click(S.enter);
      await typeDigits(page, "3");
      await page.click(S.enter);
      await page.click(S.equals);
      const records = await page.$$eval(S.historyItem, (items) =>
        items.map((item) => ({
          base: item.getAttribute("data-base"),
          result: item.querySelector('[data-testid="history-result"]')?.getAttribute("data-value") ?? null,
        })),
      );
      const sorted = [...records].sort((left, right) => Number(left.base) - Number(right.base));
      const bases = sorted.map((record) => record.base);
      const results = sorted.map((record) => record.result);
      if (!isDeepStrictEqual(bases, ["10", "20"])) failures.push(`base history bases=${JSON.stringify(records)}`);
      if (!isDeepStrictEqual(results, ["15", "25"])) failures.push(`base history results=${JSON.stringify(records)}`);
      await page.locator(S.historyEdit).nth(1).click();
      await page.waitForFunction(
        () => !document.querySelector('[data-testid="edit-draft"]')?.hidden,
        undefined,
        { timeout: 2000, polling: 10 },
      );
      const marker = await page.$eval(S.editBaseMarker, (element) => ({ hidden: element.hidden, text: element.textContent }));
      if (marker.hidden || !marker.text.includes("10")) failures.push(`old edit base marker=${JSON.stringify(marker)}`);
      return `records=${JSON.stringify(records)} marker=${JSON.stringify(marker.text)}`;
    } finally {
      await closePage(app);
    }
  });

  await step("divide-zero", async () => {
    const app = await openPage(browser, { label: "H5-divide-zero", width: 390, height: 844 });
    try {
      const { page } = app;
      await chooseOperator(page, "/");
      await typeDigits(page, "5");
      await page.click(S.enter);
      await typeDigits(page, "0");
      await page.click(S.enter);
      await page.click(S.equals);
      const error = await page.$eval(S.result, (element) => element.getAttribute("data-error"));
      if (error !== "true") failures.push(`divide-zero data-error=${JSON.stringify(error)}`);
      return `data-error=${JSON.stringify(error)}`;
    } finally {
      await closePage(app);
    }
  });

  return { failures, notes };
}

async function runH5(browser) {
  const failures = [];
  let suiteSummary = "suite=not-run";
  let checkCount = 0;
  try {
    const { runSuite } = await import("file:///ws/cal_phone/tests/suite.mjs");
    const results = await runSuite({ artifact: ARTIFACT });
    suiteEvidence.results = results;
    checkCount = results.flatMap((result) => result.checks).length;
    const cleanChecks = results
      .flatMap((result) => result.checks)
      .filter((check) => check.id.includes("clean") || check.id.includes("pageerrors"));
    suiteEvidence.cleanChecks = cleanChecks.length;
    suiteEvidence.cleanFailures = cleanChecks.filter((check) => !check.pass).map((check) => check.id);
    const coldStart = results.find((result) => result.id === "cold-start");
    const keysEnabled = coldStart?.checks?.find((check) => check.id === "cold-start.keys-enabled");
    if (results.length !== 18) failures.push(`suite results=${results.length}`);
    if (!results.every((result) => result.pass)) failures.push(`suite failed=${results.filter((result) => !result.pass).map((result) => result.id).join(",")}`);
    if (!keysEnabled?.pass) failures.push("suite cold-start.keys-enabled missing or failed");
    suiteSummary = `suite=${results.filter((result) => result.pass).length}/${results.length} checks=${checkCount}`;
  } catch (error) {
    suiteEvidence.cleanFailures = ["suite-crash"];
    failures.push(`suite crash=${errorText(error)}`);
  }

  try {
    const direct = await directH5Steps(browser);
    failures.push(...direct.failures);
    suiteSummary += ` direct=${direct.notes.length}/7`;
    if (direct.notes.length !== 7) failures.push(`direct steps completed=${direct.notes.length}/7`);
  } catch (error) {
    failures.push(`direct crash=${errorText(error)}`);
  }
  return {
    pass: failures.length === 0,
    detail: `${suiteSummary}${failures.length ? `; ${failures.join(" | ")}` : ""}`,
  };
}

function countExternalRefs(html) {
  const urls = [];
  const attribute = /<(?:script|link|img)\b[^>]*\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  for (const match of html.matchAll(attribute)) urls.push(match[1] ?? match[2] ?? match[3] ?? "");
  for (const match of html.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi)) urls.push(match[1]);
  for (const match of html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) urls.push(match[1]);
  return urls.filter((url) => /^(?:https?:)?\/\//i.test(String(url).trim())).length;
}

async function runH6() {
  const failures = [];
  let bytes = 0;
  let externalRefs = null;
  let closeTag = false;
  try {
    const html = fs.readFileSync(ARTIFACT);
    const text = html.toString("utf8");
    bytes = Buffer.byteLength(html);
    closeTag = text.includes("</html>");
    externalRefs = countExternalRefs(text);
    if (!closeTag) failures.push("missing </html>");
    if (bytes < 1024) failures.push(`bytes=${bytes}`);
    if (externalRefs !== 0) failures.push(`externalRefs=${externalRefs}`);
  } catch (error) {
    externalRefs = "unreadable";
    failures.push(`artifact read/parse failed=${errorText(error)}`);
  }
  if (pageErrorRecords.length !== 0) failures.push(`pageerrors=${pageErrorRecords.length}:${pageErrorRecords.slice(0, 3).map((item) => `${item.label}=${item.text}`).join("|")}`);
  if (consoleErrorRecords.length !== 0) failures.push(`consoleErrors=${consoleErrorRecords.length}:${consoleErrorRecords.slice(0, 3).map((item) => `${item.label}=${item.text}`).join("|")}`);
  if (suiteEvidence.cleanFailures.length !== 0) failures.push(`suiteCleanFailures=${suiteEvidence.cleanFailures.join(",")}`);
  return {
    pass: failures.length === 0,
    detail:
      `bytes=${bytes} closeTag=${closeTag} externalRefs=${externalRefs} trackedPages=${trackedPageLabels.length} pageerrors=${pageErrorRecords.length} ` +
      `consoleErrors=${consoleErrorRecords.length} suiteCleanChecks=${suiteEvidence.cleanChecks}` +
      (failures.length ? `; ${failures.join(" | ")}` : ""),
  };
}

async function h7PreLayout(page) {
  return page.evaluate(() => {
    const rectOf = (element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, left: rect.left, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
    };
    const keys = {};
    const centers = {};
    for (const key of document.querySelectorAll('[data-key]')) {
      const name = key.getAttribute("data-key");
      const rect = rectOf(key);
      keys[name] = rect;
      centers[name] = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    return { keypad: rectOf(document.querySelector('[data-testid="keypad"]')), keys, centers };
  });
}

async function h7Snapshot(page) {
  return page.evaluate(() => {
    const input = document.querySelector('[data-testid="calc-input"]');
    const expression = document.querySelector('[data-testid="expression"]');
    const history = [...document.querySelectorAll('[data-testid="history-item"]')].map((item) => ({
      expression: item.querySelector('[data-testid="history-expression"]')?.textContent ?? null,
      result: item.querySelector('[data-testid="history-result"]')?.getAttribute("data-value") ?? null,
      "data-base": item.getAttribute("data-base"),
    }));
    return {
      inputValue: input?.value ?? null,
      expression: expression?.textContent ?? null,
      history,
      settings: localStorage.getItem("cal-phone.settings.v1"),
    };
  });
}

async function runH7Context(browser, label) {
  const app = await openPage(browser, { label, width: 390, height: 844 });
  try {
    const page = app.page;
    await applySettings(page, { auto: 1 });
    await chooseOperator(page, "+");
    await page.evaluate(() => window.scrollTo(0, 0));
    const pre = await h7PreLayout(page);
    for (const key of ["1", "2", "3", "4", "5"]) {
      const point = pre.centers[key];
      await page.mouse.click(point.x, point.y, { delay: 0 });
      await sleep(80);
    }
    const immediate = await h7Snapshot(page);
    await page.waitForFunction(
      () => {
        const input = document.querySelector('[data-testid="calc-input"]');
        const feedback = document.querySelector('[data-testid="auto-confirm-feedback"]');
        return input?.value === "" && Boolean(feedback?.hidden);
      },
      undefined,
      { timeout: 2500, polling: 10 },
    );
    const settled = await h7Snapshot(page);
    return { pre, immediate, settled };
  } finally {
    await closePage(app);
  }
}

async function runH7(browser) {
  const failures = [];
  try {
    const first = await runH7Context(browser, "H7-first");
    const second = await runH7Context(browser, "H7-second");
    const geometry = compareLayouts(first.pre, second.pre);
    const immediateEqual = isDeepStrictEqual(first.immediate, second.immediate);
    const settledEqual = isDeepStrictEqual(first.settled, second.settled);
    if (!geometry.ok) failures.push(`pre geometry max=${num(geometry.max)} at ${geometry.at}`);
    if (!immediateEqual) failures.push(`immediate mismatch first=${short(JSON.stringify(first.immediate), 400)} second=${short(JSON.stringify(second.immediate), 400)}`);
    if (!settledEqual) failures.push(`settled mismatch first=${short(JSON.stringify(first.settled), 400)} second=${short(JSON.stringify(second.settled), 400)}`);
    return {
      pass: failures.length === 0,
      detail:
        `contexts=2 maxRectDelta=${num(geometry.max)}px immediateEqual=${immediateEqual} settledEqual=${settledEqual} ` +
        `settledInput=${JSON.stringify(first.settled.inputValue)} settledExpression=${JSON.stringify(first.settled.expression)}` +
        (failures.length ? `; ${failures.join(" | ")}` : ""),
    };
  } catch (error) {
    return { pass: false, detail: `crash=${errorText(error)}` };
  }
}

const TESTS = {
  H1: runH1,
  H2: runH2,
  H3: runH3,
  H4: runH4,
  H5: runH5,
  H6: runH6,
  H7: runH7,
};

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const results = {};
  let browser = null;
  try {
    browser = await launchBrowser();
  } catch (error) {
    for (const id of ["H1", "H2", "H3", "H4", "H5", "H7"]) {
      results[id] = { pass: false, detail: `host/browser unavailable: ${short(errorText(error), 500)}` };
    }
  }
  if (browser) {
    try {
      for (const id of ["H1", "H2", "H3", "H4", "H5", "H6", "H7"]) {
        try {
          results[id] = await TESTS[id](browser);
        } catch (error) {
          results[id] = { pass: false, detail: `crash=${errorText(error)}` };
        }
      }
    } finally {
      await browser.close().catch(() => {});
    }
  } else {
    try {
      results.H6 = await runH6();
    } catch (error) {
      results.H6 = { pass: false, detail: `crash=${errorText(error)}` };
    }
  }

  let artifactHash = "0".repeat(64);
  try {
    artifactHash = sha256(fs.readFileSync(ARTIFACT));
  } catch (error) {
    artifactHash = "0".repeat(64);
  }
  const verifierHash = sha256(fs.readFileSync(SCRIPT_PATH));
  const ids = ["H1", "H2", "H3", "H4", "H5", "H6", "H7"];
  const failedIds = ids.filter((id) => !results[id]?.pass);
  const lines = [
    `ROUND: ${ROUND}`,
    `ARTIFACT_SHA256: ${artifactHash}`,
    `VERIFIER_SHA256: ${verifierHash}`,
    ...ids.map((id) => `${id} ${results[id]?.pass ? "PASS" : "FAIL"} — ${short(results[id]?.detail ?? "missing result", 12000)}`),
    failedIds.length ? `HARD: FAIL (${failedIds.join(",")})` : "HARD: PASS",
  ];
  const hardPath = path.join(OUT_DIR, `hard-r${ROUND}.txt`);
  fs.writeFileSync(hardPath, `${lines.join("\n")}\n`);
  process.stdout.write(`${lines.join("\n")}\n`);
  process.stdout.write(`WROTE: ${hardPath}\n`);
}

main().catch((error) => {
  const message = errorText(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
