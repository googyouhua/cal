#!/usr/bin/env node
// Shared acceptance scenarios for /ws/cal_phone/index.html.
//
// CLI:
//   node tests/suite.mjs [--artifact <path>] [--only id,id] [--json] [--list]
//
// Library (for a Kekkai gate verifier):
//   import { runSuite } from "../../../tests/suite.mjs";
//   const results = await runSuite({ artifact: process.env.KEKKAI_ARTIFACT ?? "../../../index.html" });
//
// A gate's verify.mjs still owns the Kekkai stamp (ROUND/ARTIFACT_SHA256/VERIFIER_SHA256,
// H lines, HARD: line) and the KEKKAI_OUT_DIR path. This suite only measures behavior.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./lib/browser.mjs";
import { scenarios as coreScenarios } from "./scenarios/core.mjs";
import { scenarios as continuityScenarios } from "./scenarios/continuity.mjs";
import { scenarios as editScenarios } from "./scenarios/edit.mjs";
import { scenarios as layoutScenarios } from "./scenarios/layout.mjs";
import { scenarios as determinismScenarios } from "./scenarios/determinism.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ARTIFACT = path.resolve(HERE, "../index.html");
const SCENARIOS = [
  ...coreScenarios,
  ...continuityScenarios,
  ...editScenarios,
  ...layoutScenarios,
  ...determinismScenarios,
];

export async function runSuite({ artifact = DEFAULT_ARTIFACT, only = [], listOnly = false } = {}) {
  const selected = only.length ? SCENARIOS.filter((scenario) => only.includes(scenario.id)) : SCENARIOS;
  if (listOnly) return selected.map((scenario) => ({ id: scenario.id }));

  const browser = await launchBrowser();
  const results = [];
  try {
    for (const scenario of selected) {
      const started = Date.now();
      try {
        const checks = await scenario.run({ browser, artifact });
        results.push({
          id: scenario.id,
          pass: checks.every((item) => item.pass),
          checks,
          ms: Date.now() - started,
        });
      } catch (error) {
        results.push({
          id: scenario.id,
          pass: false,
          checks: [{ id: `${scenario.id}.crash`, pass: false, detail: error && error.stack ? error.stack : String(error) }],
          ms: Date.now() - started,
        });
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}

function parseArgs(argv) {
  const options = { artifact: DEFAULT_ARTIFACT, only: [], json: false, list: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--artifact") options.artifact = path.resolve(argv[++index]);
    else if (arg === "--only") options.only = String(argv[++index] || "").split(",").filter(Boolean);
    else if (arg === "--json") options.json = true;
    else if (arg === "--list") options.list = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("usage: node tests/suite.mjs [--artifact <path>] [--only id,id] [--json] [--list]");
      process.exit(0);
    } else {
      console.error(`unknown option: ${arg}`);
      process.exit(2);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.list) {
    for (const scenario of SCENARIOS) console.log(scenario.id);
    return;
  }

  const results = await runSuite(options);
  if (options.json) {
    process.stdout.write(JSON.stringify({ artifact: options.artifact, results }, null, 2) + "\n");
  } else {
    console.log(`artifact: ${options.artifact}`);
    for (const result of results) {
      console.log(`${result.pass ? "PASS" : "FAIL"} ${result.id} (${result.checks.length} checks, ${result.ms}ms)`);
      if (!result.pass) {
        for (const item of result.checks.filter((entry) => !entry.pass)) {
          console.log(`  FAIL ${item.id} — ${item.detail}`);
        }
      }
    }
    const checks = results.flatMap((result) => result.checks);
    const failed = checks.filter((item) => !item.pass);
    console.log(
      `\nSUITE: ${failed.length === 0 ? "PASS" : "FAIL"} scenarios=${results.length} checks=${checks.length} failed=${failed.length}`,
    );
  }
  process.exit(results.every((result) => result.pass) ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(2);
  });
}
