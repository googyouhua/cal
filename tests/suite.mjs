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
import { scenarios as rosterImportScenarios } from "./scenarios/roster-import.mjs";
import { scenarios as rosterMapScenarios } from "./scenarios/roster-map.mjs";
import { scenarios as rosterModeScenarios } from "./scenarios/roster-mode.mjs";
import { scenarios as rosterFillScenarios } from "./scenarios/roster-fill.mjs";
import { scenarios as rosterEditScenarios } from "./scenarios/roster-edit.mjs";
import { scenarios as rosterExportScenarios } from "./scenarios/roster-export.mjs";
import { scenarios as rosterStorageScenarios } from "./scenarios/roster-storage.mjs";
import { scenarios as rosterDialogScenarios } from "./scenarios/roster-dialog.mjs";
import { scenarios as rosterDeterminismScenarios } from "./scenarios/roster-determinism.mjs";
import { scenarios as rosterLayoutScenarios } from "./scenarios/roster-layout.mjs";
import { scenarios as rosterCompactScenarios } from "./scenarios/roster-compact.mjs";
import { scenarios as rosterTwoLineScenarios } from "./scenarios/roster-two-line.mjs";
import { scenarios as settingsPauseScenarios } from "./scenarios/settings-pause.mjs";
import { scenarios as resultPauseWarningScenarios } from "./scenarios/result-pause-warning.mjs";
import { scenarios as settingsStorageCorruptScenarios } from "./scenarios/settings-storage-corrupt.mjs";
import { scenarios as settingsStorageRoundTripScenarios } from "./scenarios/settings-storage-round-trip.mjs";
import { scenarios as settingsStorageDeniedScenarios } from "./scenarios/settings-storage-denied.mjs";
import { scenarios as settingsHapticsScenarios } from "./scenarios/settings-haptics.mjs";
import { scenarios as numberNegativeScenarios } from "./scenarios/number-negative.mjs";
import { scenarios as numberFloatDisplayScenarios } from "./scenarios/number-float-display.mjs";
import { scenarios as numberLiteralPreservedScenarios } from "./scenarios/number-literal-preserved.mjs";
import { scenarios as numberDecimalSumScenarios } from "./scenarios/number-decimal-sum.mjs";
import { scenarios as keyboardDialogScenarios } from "./scenarios/keyboard-dialog.mjs";
import { scenarios as keyboardResultStateScenarios } from "./scenarios/keyboard-result-state.mjs";
import { scenarios as keyboardEditDraftScenarios } from "./scenarios/keyboard-edit-draft.mjs";
import { scenarios as keyboardOperandInputScenarios } from "./scenarios/keyboard-operand-input.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ARTIFACT = path.resolve(HERE, "../index.html");
const SCENARIOS = [
  ...coreScenarios,
  ...continuityScenarios,
  ...editScenarios,
  ...layoutScenarios,
  ...determinismScenarios,
  ...rosterImportScenarios,
  ...rosterMapScenarios,
  ...rosterModeScenarios,
  ...rosterFillScenarios,
  ...rosterEditScenarios,
  ...rosterExportScenarios,
  ...rosterStorageScenarios,
  ...rosterDialogScenarios,
  ...rosterDeterminismScenarios,
  ...rosterLayoutScenarios,
  ...rosterCompactScenarios,
  ...rosterTwoLineScenarios,
  ...settingsPauseScenarios,
  ...resultPauseWarningScenarios,
  ...settingsStorageCorruptScenarios,
  ...settingsStorageRoundTripScenarios,
  ...settingsStorageDeniedScenarios,
  ...settingsHapticsScenarios,
  ...numberNegativeScenarios,
  ...numberFloatDisplayScenarios,
  ...numberLiteralPreservedScenarios,
  ...numberDecimalSumScenarios,
  ...keyboardDialogScenarios,
  ...keyboardResultStateScenarios,
  ...keyboardEditDraftScenarios,
  ...keyboardOperandInputScenarios,
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
