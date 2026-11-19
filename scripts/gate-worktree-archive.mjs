#!/usr/bin/env node
// Archive a Kekkai gate directory from one checkout (usually a git worktree) into the main
// checkout's Telos/_worktree-archive, together with the exact artifact bytes the gate verified.
//
// Why: a gate is checkout-local. Its frontmatter binds absolute repo/artifact paths, and the
// Telos/<gate>/ directory is untracked, so `git worktree` / a fast-forward merge carries the
// business bytes but not the gate or its evidence. This script freezes that evidence before a
// worktree is removed and records the hash relationship to the main checkout.
//
// Usage:
//   node scripts/gate-worktree-archive.mjs --from /ws/cal_phone-worktrees/keypad
//   node scripts/gate-worktree-archive.mjs --from <worktree> --gate <gate-dir-name>
//   node scripts/gate-worktree-archive.mjs --from <worktree> --dry-run
//
// Options: --main <repo>, --dest <dir>, --gate <name>, --force, --dry-run
// Exit: 0 ok, 2 usage/IO error.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const START = "<!-- archives:start -->";
const END = "<!-- archives:end -->";

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const sha256File = (file) => sha256(fs.readFileSync(file));
const short = (hex) => (hex ? hex.slice(0, 12) : "—");
const relPosix = (from, to) => path.relative(from, to).split(path.sep).join("/");

function fail(message) {
  console.error(`gate-worktree-archive: ${message}`);
  process.exit(2);
}

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

function detectMain(from) {
  const first = git(from, ["worktree", "list", "--porcelain"]).split("\n")[0] || "";
  const match = first.match(/^worktree\s+(.+)$/);
  if (!match) fail("cannot detect the main worktree; pass --main <repo>");
  return path.resolve(match[1]);
}

function parseArgs(argv) {
  const args = { force: false, dryRun: false, includeExternal: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--from") args.from = argv[++i];
    else if (arg === "--main") args.main = argv[++i];
    else if (arg === "--dest") args.dest = argv[++i];
    else if (arg === "--gate") args.gate = argv[++i];
    else if (arg === "--force") args.force = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--include-external") args.includeExternal = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("usage: node scripts/gate-worktree-archive.mjs --from <worktree> [--gate <name>] [--main <repo>] [--dest <dir>] [--force] [--dry-run] [--include-external]");
      process.exit(0);
    } else fail(`unknown argument: ${arg}`);
  }
  if (!args.from) fail("--from <worktree> is required");
  return args;
}

function frontmatter(goalPath) {
  const text = fs.readFileSync(goalPath, "utf8");
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fields = {};
  if (block) {
    for (const line of block[1].split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
      if (!match) continue;
      fields[match[1]] = match[2].replace(/\s+#.*$/, "").trim();
    }
  }
  return fields;
}

function latestHardRun(gateDir) {
  const runs = path.join(gateDir, "evidence", "runs");
  if (!fs.existsSync(runs)) return null;
  const files = fs.readdirSync(runs)
    .filter((name) => /^hard-r\d+\.txt$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  if (files.length === 0) return null;
  const file = path.join(runs, files.at(-1));
  const text = fs.readFileSync(file, "utf8");
  const header = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^(ROUND|ARTIFACT_SHA256|TREE_SHA256|VERIFIER_SHA256):\s*(.+)$/);
    if (match) header[match[1]] = match[2].trim();
  }
  return { file, header };
}

function stopLine(gateDir) {
  const ledger = path.join(gateDir, "ledger.md");
  if (!fs.existsSync(ledger)) return null;
  return fs.readFileSync(ledger, "utf8").match(/^STOP:.*$/m)?.[0] ?? null;
}

function treeSha256(repo, extraExcludes = []) {
  const root = path.resolve(repo);
  const gateParent = path.join(root, "Telos");
  const gateDirs = fs.existsSync(gateParent)
    ? fs.readdirSync(gateParent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(gateParent, entry.name, "GOAL.md")))
      .map((entry) => path.join(gateParent, entry.name))
    : [];
  const excluded = [...gateDirs.map((dir) => relPosix(root, dir)), ...extraExcludes].filter(Boolean);
  const listed = execFileSync(
    "git",
    ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { encoding: "utf8", maxBuffer: 1 << 28 }
  ).split("\0").filter(Boolean);
  const sequence = [];
  for (const file of [...new Set(listed)].sort()) {
    if (excluded.some((dir) => file === dir || file.startsWith(`${dir}/`))) continue;
    const full = path.join(root, file);
    let stat;
    try {
      stat = fs.lstatSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const mode = stat.mode & 0o111 ? "x" : "-";
    sequence.push(`${file}\0${mode}\0${sha256(fs.readFileSync(full))}\n`);
  }
  return sha256(sequence.join(""));
}

function discoverGates(from, only) {
  if (only) {
    const gate = path.join(from, "Telos", only);
    if (!fs.existsSync(path.join(gate, "GOAL.md"))) fail(`gate not found: ${gate}`);
    return [gate];
  }
  const telos = path.join(from, "Telos");
  if (!fs.existsSync(telos)) fail(`no Telos/ under ${from}`);
  const gates = fs.readdirSync(telos, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(telos, entry.name, "GOAL.md")))
    .map((entry) => path.join(telos, entry.name));
  if (gates.length === 0) fail(`no gates under ${telos}`);
  return gates;
}

function copyGateDirectory(source, destination) {
  fs.cpSync(source, destination, {
    recursive: true,
    filter: (src) => !relPosix(source, src).split("/").includes("node_modules")
  });
}

function findManifests(directory) {
  if (!fs.existsSync(directory)) return [];
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...findManifests(full));
    else if (entry.name === "archive.json") found.push(full);
  }
  return found;
}

function renderArchiveTable(destRoot) {
  const manifests = findManifests(destRoot)
    .map((file) => {
      try {
        return { file, data: JSON.parse(fs.readFileSync(file, "utf8")) };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.data.archived_at).localeCompare(String(a.data.archived_at)));
  if (manifests.length === 0) return "| 时间 | 分支 | gate | STOP | artifact | TREE | 归档目录 |\n|---|---|---|---|---|---|---|";
  const rows = manifests.map(({ file, data }) => {
    const dir = relPosix(destRoot, path.dirname(file));
    return `| ${data.archived_at} | ${data.source_branch ?? "—"} | ${data.gate_slug ?? "—"} | ${data.stop ?? "—"} | \`${short(data.declared?.artifact_sha256 ?? data.artifact?.sha256)}\` | \`${short(data.declared?.tree_sha256)}\` | \`${dir}\` |`;
  });
  return [
    "| 时间 | 分支 | gate | STOP | artifact | TREE | 归档目录 |",
    "|---|---|---|---|---|---|---|",
    ...rows
  ].join("\n");
}

const TEMPLATE = `# Worktree × Kekkai 交接约定

Kekkai gate 是 **checkout-local** 的，不是 branch-local 的：GOAL 的 \`repo\` / \`artifact\` 是绝对路径，
\`Telos/<gate>/\` 默认未跟踪，evidence 也不在 git 里。合并只带业务字节，不带 gate 和证据。

## 规则

1. **一个 gate 属于一个 checkout。** 在哪里跑，就在哪里收尾；不要把运行中的 gate 搬到另一个 worktree。
2. **合并前归档。** 在删除 worktree 之前运行归档脚本，冻结 \`Telos/<gate>/\` 和受验 artifact 的字节。
3. **合并后不要复用旧证据。** 旧证据只覆盖归档时的字节；主树继续改业务码，就新开 gate。
   如果 \`archive.json\` 显示 \`artifact.matches_main=true\`，可以把它当作**历史依据**引用，但不能当作之后改动的验收。
4. **归档不是活动 gate。** 不要改归档 GOAL 的 \`repo\`/\`artifact\`，也不要把归档拷进另一个 checkout 声称那边已验证。
5. **别让证据随 worktree 消失。** 未跟踪目录不会被 merge 或 worktree 删除保护；先归档再删。
6. **归档目录与 TREE_SHA256。** \`Telos/_worktree-archive\` 是证据目录，不是业务代码；新 gate 生成时把它写进
   frontmatter 的 \`volatile\`（例如 \`volatile: ["Telos/_worktree-archive"]\`），或在 gate 收敛后再归档。

## 用法

\`\`\`sh
# 归档一个 worktree 里的全部 gate
node scripts/gate-worktree-archive.mjs --from /ws/cal_phone-worktrees/keypad

# 只归档一个 gate，或先看计划
node scripts/gate-worktree-archive.mjs --from /ws/cal_phone-worktrees/keypad --gate phone-calculator-keypad-111513
node scripts/gate-worktree-archive.mjs --from /ws/cal_phone-worktrees/keypad --dry-run
\`\`\`

脚本会写到主 checkout 的 \`Telos/_worktree-archive/<branch>/<gate>/\`：

- gate 目录的完整副本（不含 \`node_modules\`）；
- \`verified-artifact/\`：该 gate 最近一次 hard 轮次声明的 artifact 字节（只有当前文件哈希仍等于声明哈希时才复制；文件已漂移则标记 \`stale\` 且不复制）；
- \`archive.json\`：source worktree、branch、HEAD、STOP、声明哈希、主树哈希与 artifact 是否一致；
- \`PROVENANCE.md\`：人读的归档说明。

默认只归档 \`repo\` 指向该 worktree 的 gate；从别处复制进来的遗留 gate 会跳过（\`--include-external\` 可强制）。
重复运行同一份未变化的归档会显示 \`UNCHANGED\`，不会重复复制。

查看 worktree 里的活动 gate（不复制、不搬家）：

\`\`\`sh
kekkai status /ws/cal_phone-worktrees/keypad/Telos/phone-calculator-keypad-111513 --json
\`\`\`

## 归档清单

${START}
${END}
`;

function updateWorktreesDoc(mainRepo, destRoot) {
  const doc = path.join(mainRepo, "Telos", "WORKTREES.md");
  let text = fs.existsSync(doc) ? fs.readFileSync(doc, "utf8") : TEMPLATE;
  const table = renderArchiveTable(destRoot);
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start >= 0 && end > start) {
    text = `${text.slice(0, start + START.length)}\n${table}\n${text.slice(end)}`;
  } else {
    text = `${text.trimEnd()}\n\n${START}\n${table}\n${END}\n`;
  }
  fs.writeFileSync(doc, text);
}

function archiveGate(gateDir, options) {
  const { from, mainRepo, destRoot, force, dryRun, includeExternal } = options;
  const fm = frontmatter(path.join(gateDir, "GOAL.md"));
  const slug = fm.slug || path.basename(gateDir);
  const gateRepo = fm.repo ? path.resolve(fm.repo) : null;
  if (gateRepo !== from && !includeExternal) {
    console.log(`SKIP ${slug}: gate repo is ${gateRepo ?? "—"}, not this worktree (use --include-external to archive anyway)`);
    return null;
  }
  const branch = (() => {
    try {
      return git(from, ["rev-parse", "--abbrev-ref", "HEAD"]);
    } catch {
      return "unknown";
    }
  })();
  const head = (() => {
    try {
      return git(from, ["rev-parse", "HEAD"]);
    } catch {
      return null;
    }
  })();
  const run = latestHardRun(gateDir);
  const declared = run ? {
    round: run.header.ROUND ? Number(run.header.ROUND) : null,
    artifact_sha256: run.header.ARTIFACT_SHA256 ?? null,
    tree_sha256: run.header.TREE_SHA256 ?? null,
    verifier_sha256: run.header.VERIFIER_SHA256 ?? null,
    run_file: relPosix(gateDir, run.file)
  } : null;

  const rawArtifact = fm.artifact && fm.artifact !== "null" ? fm.artifact : null;
  const artifactPath = rawArtifact
    ? (path.isAbsolute(rawArtifact) ? rawArtifact : path.resolve(fm.repo || from, rawArtifact))
    : null;
  const artifactSha = artifactPath && fs.existsSync(artifactPath) && fs.statSync(artifactPath).isFile()
    ? sha256File(artifactPath)
    : null;
  const declaredArtifactSha = declared?.artifact_sha256 ?? null;
  const artifactMatchesDeclared = Boolean(artifactSha && declaredArtifactSha && artifactSha === declaredArtifactSha);
  const artifactStale = Boolean(declaredArtifactSha && artifactSha && artifactSha !== declaredArtifactSha);
  const mainArtifactPath = artifactPath && path.relative(from, artifactPath) && !path.relative(from, artifactPath).startsWith("..")
    ? path.join(mainRepo, path.relative(from, artifactPath))
    : null;
  const mainArtifactSha = mainArtifactPath && fs.existsSync(mainArtifactPath) && fs.statSync(mainArtifactPath).isFile()
    ? sha256File(mainArtifactPath)
    : null;
  const artifactMatchesMain = Boolean(artifactSha && mainArtifactSha && artifactSha === mainArtifactSha);

  const destination = path.join(destRoot, branch === "HEAD" || branch === "unknown" ? "detached" : branch, path.basename(gateDir));
  const mainTreeSha = treeSha256(mainRepo, [relPosix(mainRepo, destRoot)]);
  const sourceTreeSha = treeSha256(from);

  if (dryRun) {
    console.log(`DRY ${slug}: ${gateDir} -> ${destination}`);
    console.log(`  status=${fm.status ?? "—"} stop=${stopLine(gateDir) ?? "—"}`);
    console.log(`  declared artifact=${short(declared?.artifact_sha256)} tree=${short(declared?.tree_sha256)} verifier=${short(declared?.verifier_sha256)}`);
    console.log(`  artifact file=${short(artifactSha)} main=${short(mainArtifactSha)} matchesMain=${artifactMatchesMain} matchesDeclared=${artifactMatchesDeclared}${artifactStale ? " STALE" : ""}`);
    console.log(`  tree source=${short(sourceTreeSha)} main=${short(mainTreeSha)}`);
    return { slug, destination, dryRun: true };
  }

  if (fs.existsSync(destination)) {
    const existing = (() => {
      try {
        return JSON.parse(fs.readFileSync(path.join(destination, "archive.json"), "utf8"));
      } catch {
        return null;
      }
    })();
    const unchanged = existing && existing.source_worktree === from
      && existing.declared?.tree_sha256 === (declared?.tree_sha256 ?? null)
      && existing.artifact?.sha256 === artifactSha;
    if (!force && unchanged) {
      updateWorktreesDoc(mainRepo, destRoot);
      console.log(`UNCHANGED ${slug}: already archived (declared tree ${short(declared?.tree_sha256)}, artifact ${short(artifactSha)})`);
      return { slug, destination, skipped: true };
    }
    if (!force) fail(`archive already exists with different hashes: ${destination} (use --force to replace)`);
    fs.rmSync(destination, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  copyGateDirectory(gateDir, destination);

  let artifactCopy = null;
  if (artifactMatchesDeclared) {
    const copyDir = path.join(destination, "verified-artifact");
    fs.mkdirSync(copyDir, { recursive: true });
    const copy = path.join(copyDir, path.basename(artifactPath));
    fs.copyFileSync(artifactPath, copy);
    if (sha256File(copy) !== artifactSha) fail(`artifact copy hash mismatch: ${copy}`);
    artifactCopy = relPosix(destination, copy);
  }

  const manifest = {
    archived_at: new Date().toISOString(),
    source_worktree: from,
    source_branch: branch,
    source_head: head,
    gate_slug: slug,
    gate_status: fm.status ?? null,
    gate_repo: fm.repo ?? null,
    gate_artifact: fm.artifact ?? null,
    stop: stopLine(gateDir),
    declared,
    artifact: {
      path: artifactPath,
      sha256: artifactSha,
      declared_sha256: declaredArtifactSha,
      matches_declared: artifactMatchesDeclared,
      stale: artifactStale,
      copy: artifactCopy,
      main_path: mainArtifactPath,
      main_sha256: mainArtifactSha,
      matches_main: artifactMatchesMain
    },
    tree: {
      source_sha256_at_archive: sourceTreeSha,
      main_sha256_at_archive: mainTreeSha,
      note: "TREE_SHA256 is content-based and includes every non-gate file; adding tooling/docs later changes it. The declared value comes from the gate run and is the authoritative one for that run."
    },
    note: "Archived evidence belongs to the source worktree/checkout. It is not an active gate and does not attest later edits in the main worktree."
  };
  fs.writeFileSync(path.join(destination, "archive.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const provenance = `# Gate archive · ${slug}

- source worktree: \`${from}\`
- branch / HEAD: \`${branch}\` / \`${head ?? "—"}\`
- gate status: \`${fm.status ?? "—"}\`
- STOP: \`${manifest.stop ?? "—"}\`
- declared run: round ${declared?.round ?? "—"} (\`${declared?.run_file ?? "—"}\`)
- declared ARTIFACT_SHA256: \`${declared?.artifact_sha256 ?? "—"}\`
- declared TREE_SHA256: \`${declared?.tree_sha256 ?? "—"}\`
- declared VERIFIER_SHA256: \`${declared?.verifier_sha256 ?? "—"}\`
- artifact snapshot: \`${artifactCopy ?? "—"}\` (file sha256 \`${artifactSha ?? "—"}\`, declared \`${declaredArtifactSha ?? "—"}\`, matches declared: **${artifactMatchesDeclared ? "yes" : "no"}**${artifactStale ? ", STALE — the file changed after the gate run, so no artifact snapshot was taken" : ""})
- main worktree artifact: \`${mainArtifactPath ?? "—"}\` (sha256 \`${mainArtifactSha ?? "—"}\`, matches: **${artifactMatchesMain ? "yes" : "no"}**)
- tree at archive time (excluding this archive dir): source \`${sourceTreeSha}\`, main \`${mainTreeSha}\`

## What this is

A frozen copy of the gate directory${artifactCopy ? " and the exact artifact bytes its latest hard run declared" : ""}. The copied GOAL.md still
points at the source worktree; that is intentional. Keep it as a record, not as an active gate.

## What this is not

It does not extend verification to later edits in the main worktree. If the artifact changes after
\`${manifest.archived_at}\`, open a new gate in the checkout where you are changing it.
`;
  fs.writeFileSync(path.join(destination, "PROVENANCE.md"), provenance);

  updateWorktreesDoc(mainRepo, destRoot);
  console.log(`ARCHIVED ${slug} -> ${destination}`);
  console.log(`  artifacts: declared=${short(declared?.artifact_sha256)} file=${short(artifactSha)} main=${short(mainArtifactSha)} matchesMain=${artifactMatchesMain} matchesDeclared=${artifactMatchesDeclared}${artifactStale ? " STALE(no snapshot)" : ""}`);
  console.log(`  tree: declared=${short(declared?.tree_sha256)} source=${short(sourceTreeSha)} main=${short(mainTreeSha)}`);
  console.log(`  stop: ${manifest.stop ?? "—"}`);
  return { slug, destination, manifest };
}

const args = parseArgs(process.argv.slice(2));
const from = path.resolve(args.from);
if (!fs.existsSync(from)) fail(`worktree not found: ${from}`);
const mainRepo = path.resolve(args.main ?? detectMain(from));
if (!fs.existsSync(path.join(mainRepo, "Telos"))) fail(`main repo has no Telos/: ${mainRepo}`);
const destRoot = path.resolve(args.dest ?? path.join(mainRepo, "Telos", "_worktree-archive"));
const gates = discoverGates(from, args.gate);

console.log(`source: ${from}`);
console.log(`main:   ${mainRepo}`);
console.log(`dest:   ${destRoot}`);
const results = gates
  .map((gate) => archiveGate(gate, { from, mainRepo, destRoot, force: args.force, dryRun: args.dryRun, includeExternal: args.includeExternal }))
  .filter(Boolean);
console.log(`done: ${results.length} gate(s)`);
