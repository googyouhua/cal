import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

/**
 * Resolve a Playwright install without assuming one particular node_modules layout.
 *
 * Candidate order:
 *   1. $PLAYWRIGHT_MODULE
 *   2. <skill>/tools/node_modules/playwright   (created by scripts/setup.sh)
 *   3. <repo>/node_modules/playwright
 *   4. node's normal resolution (NODE_PATH)
 *   5. <repo>/Telos/<gate>/node_modules/playwright (gates that vendor it)
 *
 * Returns { chromium, version, resolvedFrom }.
 */
export async function loadPlaywright(repoRoot, skillDir) {
  const candidates = [];
  if (process.env.PLAYWRIGHT_MODULE) {
    candidates.push(process.env.PLAYWRIGHT_MODULE);
  }
  candidates.push(path.join(skillDir, "tools", "node_modules", "playwright"));
  candidates.push(path.join(repoRoot, "node_modules", "playwright"));

  const telosDir = path.join(repoRoot, "Telos");
  if (fs.existsSync(telosDir)) {
    for (const entry of fs.readdirSync(telosDir)) {
      candidates.push(path.join(telosDir, entry, "node_modules", "playwright"));
    }
  }

  for (const candidate of candidates) {
    const pkg = path.join(candidate, "package.json");
    if (!fs.existsSync(pkg)) continue;
    try {
      const req = createRequire(path.join(candidate, "noop.js"));
      const playwright = req(candidate);
      const version = JSON.parse(fs.readFileSync(pkg, "utf8")).version;
      return { chromium: playwright.chromium, version, resolvedFrom: candidate };
    } catch {
      // try the next candidate
    }
  }

  try {
    const req = createRequire(path.join(repoRoot, "noop.js"));
    const playwright = req("playwright");
    const pkg = req.resolve("playwright/package.json");
    return {
      chromium: playwright.chromium,
      version: JSON.parse(fs.readFileSync(pkg, "utf8")).version,
      resolvedFrom: pkg,
    };
  } catch {
    // fall through to the precondition error
  }

  throw new Error(
    [
      "PRECONDITION: Playwright is not installed.",
      `Tried: ${candidates.join(", ")}`,
      "Fix: bash .agents/skills/verify-calculator/scripts/setup.sh",
      "(installs playwright into the skill's tools/ directory and downloads Chromium)",
    ].join("\n"),
  );
}
