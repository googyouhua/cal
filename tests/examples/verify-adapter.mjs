#!/usr/bin/env node
// Runnable example of a Kekkai gate instrument that delegates regression coverage to
// the shared suite. Adapt the H_MAP and add gate-specific checks when copying this into
// <gate>/evidence/verify.mjs.
//
//   KEKKAI_ARTIFACT=/ws/cal_phone/index.html \
//   KEKKAI_OUT_DIR=/tmp/verify-out \
//   node tests/examples/verify-adapter.mjs 1
//
// The gate's real verify.mjs must still be written by the independent hard-gate author.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { runSuite } from "../suite.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const ROUND = String(process.argv[2] ?? process.env.KEKKAI_ROUND ?? "1").replace(/^r/i, "");
const ARTIFACT = path.resolve(process.env.KEKKAI_ARTIFACT ?? path.join(HERE, "../../index.html"));
const OUT_DIR = path.resolve(process.env.KEKKAI_OUT_DIR ?? ".");

// Example roll-up only. Replace with the actual H table of the gate.
const H_MAP = {
  H1: ["self-contained"],
  H2: ["layout"],
  H3: ["compute", "arithmetic", "history-order"],
  H4: ["continuity", "error-recovery", "sticky-operator"],
  H5: ["edit-recompute", "edit-multi", "edit-invalid", "edit-divzero"],
  H6: ["determinism"],
};

const only = [...new Set(Object.values(H_MAP).flat())];
const results = await runSuite({ artifact: ARTIFACT, only });
const byId = new Map(results.map((result) => [result.id, result]));
const brief = (text) => String(text).replace(/\s+/g, " ").trim().slice(0, 240);

const lines = [];
const failedHs = [];
for (const [h, ids] of Object.entries(H_MAP)) {
  const missing = ids.filter((id) => !byId.has(id));
  const failed = ids.map((id) => byId.get(id)).filter((result) => result && !result.pass);
  const pass = missing.length === 0 && failed.length === 0;
  if (!pass) failedHs.push(h);
  const detail = pass
    ? `${ids.join(", ")} passed`
    : [
        missing.length ? `missing scenarios: ${missing.join(", ")}` : "",
        ...failed.map((result) => {
          const first = result.checks.find((item) => !item.pass);
          return `${result.id}/${first.id}: ${brief(first.detail)}`;
        }),
      ]
        .filter(Boolean)
        .join("; ");
  lines.push(`${h} ${pass ? "PASS" : "FAIL"} — ${detail}`);
}

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const text =
  [
    `ROUND: ${ROUND}`,
    `ARTIFACT_SHA256: ${sha256(ARTIFACT)}`,
    `VERIFIER_SHA256: ${sha256(SELF)}`,
    "",
    ...lines,
    `HARD: ${failedHs.length === 0 ? "PASS" : `FAIL (${failedHs.join(",")})`}`,
  ].join("\n") + "\n";

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, `hard-r${ROUND}.txt`), text);
process.stdout.write(text);
process.exit(failedHs.length === 0 ? 0 : 1);
