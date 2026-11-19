import { isDeepStrictEqual } from "node:util";

const fmt = (value) => {
  if (typeof value === "string") return JSON.stringify(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export function check(checks, id, pass, detail = "") {
  const ok = Boolean(pass);
  checks.push({ id, pass: ok, detail: String(detail) });
  return ok;
}

export function eq(checks, id, actual, expected, detail = "") {
  const ok = isDeepStrictEqual(actual, expected);
  return check(
    checks,
    id,
    ok,
    ok
      ? fmt(actual)
      : `expected ${fmt(expected)}, got ${fmt(actual)}${detail ? ` — ${detail}` : ""}`,
  );
}

export function near(checks, id, actual, expected, tolerance = 1e-9) {
  const a = Number(actual);
  const ok = Number.isFinite(a) && Math.abs(a - expected) <= tolerance;
  return check(checks, id, ok, ok ? String(a) : `expected ${expected} ± ${tolerance}, got ${fmt(actual)}`);
}

export function clean(checks, id, pageErrors, consoleErrors) {
  return check(
    checks,
    id,
    pageErrors.length === 0 && consoleErrors.length === 0,
    `pageerrors=${pageErrors.length}, consoleErrors=${consoleErrors.length}` +
      (pageErrors.length ? ` — ${pageErrors.join(" | ")}` : "") +
      (consoleErrors.length ? ` — ${consoleErrors.join(" | ")}` : ""),
  );
}
