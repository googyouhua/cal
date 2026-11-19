import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

// Resolve playwright from tests/node_modules first, then from NODE_PATH/global.
// Kekkai instruments may also pin a different module with PLAYWRIGHT_MODULE.
export function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, "playwright", "playwright-core"].filter(Boolean);
  const errors = [];
  for (const name of candidates) {
    try {
      const mod = require(name);
      if (mod.chromium) return mod;
      if (mod.default && mod.default.chromium) return mod.default;
    } catch (error) {
      errors.push(`${name}: ${error.message}`);
    }
  }
  throw new Error(
    "playwright is not resolvable. Install it once with `cd tests && npm install` " +
      "or set NODE_PATH=$(npm root -g).\n" + errors.join("\n"),
  );
}

export async function launchBrowser() {
  const { chromium } = loadPlaywright();
  return chromium.launch({ headless: true });
}

export async function openApp(
  browser,
  artifact,
  { viewport = { width: 390, height: 844 }, isMobile = true, hasTouch = true } = {},
) {
  const context = await browser.newContext({ viewport, isMobile, hasTouch });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(15000);
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(pathToFileURL(artifact).href, { waitUntil: "load" });
  return {
    context,
    page,
    pageErrors,
    consoleErrors,
    async close() {
      await context.close();
    },
  };
}
