#!/usr/bin/env node
/**
 * Read-only health check: "is this calculator instance worth driving?"
 *
 *   node scripts/doctor.mjs                       # http://127.0.0.1:4173
 *   node scripts/doctor.mjs --url http://127.0.0.1:4180
 *   node scripts/doctor.mjs --no-browser          # HTTP + process checks only
 *   node scripts/doctor.mjs --resolve-only        # only check Playwright resolution
 *
 * Exit 0 = all checks passed. Exit 1 = at least one failed. Exit 2 = bad usage.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadPlaywright } from "./lib/playwright.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(SKILL_DIR, "../../..");
const ARTIFACT = path.join(REPO_ROOT, "index.html");

const REQUIRED_TESTIDS = [
  "key-op",
  "calc-input",
  "expression",
  "result",
  "keypad",
  "op-picker",
  "key-equals",
  "edit-draft",
  "edit-cancel",
  "operand-chips",
  "history",
  "history-list",
  "history-empty",
  "settings-toggle",
  "settings-panel",
  "settings-auto-confirm",
  "settings-auto-equals",
  "auto-equals-hint",
  "settings-base-toggle",
  "settings-base-value",
  "settings-done",
  "settings-indicator",
  "auto-confirm-progress",
  "base-marker",
];

function parseArgs(argv) {
  const options = { url: process.env.VERIFY_URL || "http://127.0.0.1:4173", browser: true, resolveOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--url") options.url = argv[++i];
    else if (arg === "--no-browser") options.browser = false;
    else if (arg === "--resolve-only") options.resolveOnly = true;
    else if (arg === "-h" || arg === "--help") {
      console.log("usage: doctor.mjs [--url URL] [--no-browser] [--resolve-only]");
      process.exit(0);
    } else {
      console.error(`FAIL usage unknown_arg=${arg}`);
      process.exit(2);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const url = new URL(options.url);
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` ${detail}` : ""}`);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function main() {
  if (options.resolveOnly) {
    const { version } = await loadPlaywright(REPO_ROOT, SKILL_DIR);
    console.log(`playwright=${version}`);
    return process.exit(0);
  }

  if (!fs.existsSync(ARTIFACT)) {
    record("artifact_present", false, `path=${ARTIFACT}`);
    return;
  }
  const artifactBytes = fs.readFileSync(ARTIFACT);
  const artifactHash = sha256(artifactBytes);
  record("artifact_present", true, `path=${ARTIFACT} sha256=${artifactHash}`);

  // Process ownership: only meaningful for a local instance.
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
    const runDir =
      process.env.VERIFY_RUN_DIR || `/tmp/verify-calculator/port-${url.port || "80"}`;
    const pidFile = path.join(runDir, "server.pid");
    if (!fs.existsSync(pidFile)) {
      record("server_started_by_us", false, `pid_file_missing=${pidFile} hint=bash scripts/launch.sh`);
    } else {
      const pid = fs.readFileSync(pidFile, "utf8").trim();
      let alive = false;
      let cmd = "";
      try {
        process.kill(Number(pid), 0);
        alive = true;
        cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim();
      } catch {
        alive = false;
      }
      record(
        "server_started_by_us",
        alive && cmd.includes("http.server"),
        `pid=${pid} alive=${alive} cmd=${JSON.stringify(cmd)}`,
      );
    }
  } else {
    record("server_started_by_us", true, `remote url=${options.url} (process check skipped)`);
  }

  // HTTP + integrity.
  let response;
  let body;
  try {
    response = await fetch(`${url.origin}/`, { signal: AbortSignal.timeout(5000) });
    body = Buffer.from(await response.arrayBuffer());
    record("http_ok", response.status === 200, `status=${response.status} url=${url.origin}/`);
  } catch (error) {
    record("http_ok", false, `url=${url.origin}/ error=${error.message}`);
    return;
  }

  const servedHash = sha256(body);
  record(
    "served_matches_artifact",
    servedHash === artifactHash,
    `served_sha256=${servedHash} artifact_sha256=${artifactHash}`,
  );

  const html = body.toString("utf8");
  record("title_is_calculator", /<title>\s*手机计算器\s*<\/title>/.test(html), "title=手机计算器");

  const missing = REQUIRED_TESTIDS.filter((id) => !html.includes(`data-testid="${id}"`));
  record("required_hooks_present", missing.length === 0, `missing=[${missing.join(",")}]`);

  const opCount = (html.match(/data-op="/g) || []).length;
  record("operator_hooks_present", opCount === 4, `data-op_count=${opCount} expected=4`);

  const externalRef =
    /(?:src|href)\s*=\s*["'](?:https?:)?\/\//i.test(html) || /@import\s+url\(\s*["']?https?:/i.test(html);
  record("self_contained", !externalRef, "no external script/style/img/font references");

  record(
    "viewport_meta_present",
    /<meta[^>]+name=["']viewport["'][^>]*width=device-width/i.test(html),
    "viewport width=device-width",
  );

  if (!options.browser) {
    record("browser_boot", true, "skipped (--no-browser)");
    return;
  }

  const { chromium, version } = await loadPlaywright(REPO_ROOT, SKILL_DIR);
  console.log(`INFO playwright_version=${version}`);
  const browser = await chromium.launch({ headless: true, timeout: 30000 });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console.error: ${message.text()}`);
    });
    await page.goto(`${url.origin}/`, { waitUntil: "load", timeout: 20000 });

    const state = await page.locator(".app").getAttribute("data-state");
    const opButtons = await page.locator("[data-op]").count();
    const keyCount = await page.locator("[data-key]").count();
    const disabledKeys = await page.locator("[data-key]:disabled").count();
    const settingsToggle = page.locator('[data-testid="settings-toggle"]');
    await settingsToggle.click();
    const panel = page.locator('[data-testid="settings-panel"]');
    const panelOpen = await panel.evaluate((element) => element.open);
    const autoConfirmOptions = await page.locator('[data-testid="settings-auto-confirm"] option').count();
    await page.locator('[data-testid="settings-done"]').click();
    await page.waitForFunction(() => !document.querySelector('[data-testid="settings-panel"]').open);
    const panelClosed = !(await panel.evaluate((element) => element.open));

    const bootOk =
      state === "select" &&
      opButtons === 4 &&
      keyCount === 14 &&
      disabledKeys === 0 &&
      panelOpen &&
      panelClosed &&
      autoConfirmOptions === 23 &&
      errors.length === 0;
    record(
      "browser_boot",
      bootOk,
      `state=${state} op_buttons=${opButtons} keys=${keyCount} disabled_keys=${disabledKeys} ` +
        `settings_panel_opens=${panelOpen} settings_panel_closes=${panelClosed} ` +
        `auto_confirm_options=${autoConfirmOptions} console_errors=${errors.length}`,
    );
    if (errors.length > 0) {
      for (const error of errors.slice(0, 5)) console.log(`  console: ${error}`);
    }
  } finally {
    await browser.close();
  }
}

await main();

const failed = results.filter((item) => !item.ok);
if (failed.length > 0) {
  console.log(`doctor=failed checks=[${failed.map((item) => item.name).join(",")}]`);
  process.exit(1);
}
console.log("doctor=ok");
