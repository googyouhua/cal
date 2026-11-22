---
# ── Kekkai Goal Gate v4 · frontmatter（唯一机读区；停止数字只在这里；矩阵/不变量内容只在正文表格）──
slug: phone-calculator-result-pause-2-112200
version: 4
model_profile: muse-spark-1.3-v1  # 本机不提供 gpt-6-astra；按用户确认使用 opt-in muse profile，执行中不可修改
status: converged                      # draft | in-loop | converged（blocked 终态保持 in-loop）
repo: /ws/cal_phone-worktrees/result-pause
artifact: /ws/cal_phone-worktrees/result-pause/index.html
# artifact_kind: url | app | service   # 仅 artifact: null 时启用；此时 ARTIFACT_SHA256 := TREE_SHA256
parent_gate: null                  # 子闸填父 GOAL.md 绝对路径；只继承 round-0 决策，不继承证据或 verify.mjs
verifiers:
  hard: codex exec                 # 固定驱动器；pin 与访问标志在 bin/runner.mjs（docs/RUNNER.md）
  soft: null
stop:
  max_rounds: 10
hard_invariants: [H1, H2, H3, H4, H5, H6]
volatile: ["Telos/_worktree-archive"]  # worktree 证据归档；按 Telos/WORKTREES.md 排除
---

# Kekkai Goal Gate · 结果后暂停输入（可调秒数）与 0.1 秒自动确认

> **运行指令**：你是执行者（Codex / Claude Code / ZCode / Cursor 之一，由 handoff 指定；生成本 gate 的那次调用不得兼任）。
> 开跑前先 `kekkai doctor --gate <本目录> --host`；只有 `requires_display: true` 的真实桌面测量依赖解锁与屏幕权限，普通无头浏览器/逻辑测量不占屏。
> 读**本文件全文** + 同目录 [`./ledger.md`](./ledger.md)（决策台账），然后只用 §5 的命令块驱动验收，直到 §5 的停止条件；在已授权范围内自主推进，缺少外部输入时写明 blocked 与恢复条件。
> 生命周期编辑是唯一允许的 GOAL 改动：第 1 轮前 `status: draft → in-loop`；写 `converged` STOP 前 → `status: converged`；blocked 终态保持 `in-loop`。
> 除此之外 GOAL.md 只读：不改 frontmatter 数字、不改 prompt、不改变 §5 命令的操作、目标路径和关键参数（注释与空白不影响验收）。
> 教义在 Kekkai skill 的 `docs/CREED.md`、runner 契约在该 skill 的 `docs/RUNNER.md`——本文件不复述它们；`kekkai hard/soft` 的退出码与消息就是你的下一步。

## 1. 目标（一句话 + 背景 + 实施指导）
把 `/ws/cal_phone-worktrees/result-pause/index.html`（独立 worktree，分支 `result-pause`，基于 `master`）从「结果出现后数字键立即开始下一笔」改为「成功结果出现后先暂停数字输入一段可调时间，再自动恢复」：统分时按完 `=` 看到结果后，手指误触或连击数字不会立刻把结果顶掉，给用户一个明确的收手窗口。暂停时长在设置面板以秒为单位可调（默认 1.0 秒，范围 0–10 秒，0.1 秒步进，0 表示关闭）；暂停期间屏幕数字键与物理键盘的数字/小数点都不响应，其他键不在锁定范围。同时给既有自动确认停顿增加一个 0.1 秒档位（原有档位不变），让最短自动确认从 0.2 秒细化到 0.1 秒。

**背景（生成前实测）**：
`/ws/cal_phone-worktrees/result-pause` 基于 `master`（`fe06f8f`），工作区 clean。当前 `calculate()` 成功时设置 `enterState("result")`、写 `result[data-value]` 并清空输入；随后 `appendCharacter()` 看到 `state === "result"` 立即清空结果并开始下一笔，没有任何暂停。`AUTO_CONFIRM_STEPS` 为 `[0, 0.2, 0.4, 0.5, 1, 1.5, …, 10]`，没有 0.1 秒档位。既有 `tests/suite.mjs` 的 18 个场景在当前主分支产物上全部通过；既有震动实现仍在 `appendCharacter` 之前的按键路径调用 `navigator.vibrate(10)`。

**实施指导**：
复用现有 IIFE、状态机（`select / input / result / error / edit`）、`calculate()`、`appendCharacter()`、`settings` 对象、`loadSettings()` / `saveSettings()`、`AUTO_CONFIRM_STEPS` 与设置面板的 `settings-input` 样式。建议在 `settings` 增加 `resultPause`（秒，默认 1.0），在成功结果写入后启动一次性计时器（例如 `resultPauseUntil = Date.now() + ms`），并在 `appendCharacter()` 最前面检查暂停窗口：窗口内直接返回 `false`，不修改输入、不切换状态、不写历史。因为屏幕数字键与物理键盘数字键都走 `appendCharacter()`，一个守卫即可覆盖两条输入路径；`backspace` / `enter` / `equals` / 运算符不走这个函数，保持可用（按用户确认的锁定范围，不对这些键额外设限）。只在成功结果后启动暂停；`showDivisionByZero()` 的错误路径不启动。手动 `=` 与自动等号都调用 `calculate()`，所以同一个启动点覆盖两者。设置面板新增一个 `[data-testid="settings-result-pause"]` 数字输入（单位秒，默认 `1`，0–10，0.1 步进）；非法/空值在 blur 时恢复上一个有效值。默认值 1.0 不得让「已自定义」指示器常亮。`AUTO_CONFIRM_STEPS` 在 0 与 0.2 之间插入 `0.1`，其余档位不变；`startAutoConfirm()` 的 `Math.round(seconds * 1000)` 已能支持 100ms。若保留 `.agents/skills/verify-calculator` 里写死的 23 档断言，同步更新为 24 档。保持既有震动、语音、历史、编辑、除零与单文件自包含行为。

> 外部前提：无账号、服务或真实设备依赖；无头 Playwright 即可测量暂停与自动确认时间。本机不提供 `gpt-6-astra`，按已建立的宿主约定使用 `muse-spark-1.3-v1` opt-in profile；这是宿主/模型可用性选择，不改产物行为。开发只在本 worktree 内进行，不改主 checkout `/ws/cal_phone`。

## 2. 不变约束（父级红线 · 任何修改不得破坏）
> 每条红线**必须标注归属**：`[H#]`（由该硬不变量机检）或 `[soft-only: 原因]`（只能主观把关，写明为何无法机检）。绝对不能改的代码块优先给 sha256 机检形式。不允许留下既非 `[H#]` 也非 `[soft-only]` 的悬空红线。
- 成功结果后启动暂停；在设置的暂停时长内，屏幕数字键与物理键盘的 `0–9`、`.` 都不改变输入、不切换状态、不写历史；暂停结束后自动恢复 [H1]
- 暂停时长设置 `[data-testid="settings-result-pause"]`：默认 1.0 秒，范围 0–10 秒，0.1 秒步进，0 表示关闭；持久化到 `cal-phone.settings.v1`，刷新后保持；非法/空值在 blur 时恢复上一个有效值 [H2]
- 手动等号与自动等号产生的成功结果都启动暂停；除零错误与未产生结果的计算不启动；运算符、退格、确认、等号不在暂停锁定范围 [H3]
- 自动确认下拉框在 0 与 0.2 之间新增 0.1 秒档位，原有档位保持升序、无重复；设为 0.1 时真实约 100ms 自动确认，设为 0 仍永不自动确认 [H4]
- 既有行为不回归：`tests/suite.mjs` 的 18 个场景全 PASS，正常按键仍每次一次 10ms 震动，历史/编辑/除零/布局/持久化/确定性不变 [H5]
- 产物仍是单文件自包含、`</html>` 闭合、字节数 ≥1024、无外部 script/link/img/font/@import，所有被检页面 pageerror=0、console error=0 [H6]
- 保留既有 `data-testid`、`data-key`、`data-op` 与 `cal-phone.settings.v1` 存储键；可新增 `settings-result-pause` 与 data-* 测试钩子 [H5]

> 允许改动的范围豁免写在下面的定界块里（runner 会把它**逐字**内联进 first / recast / final 验收器的 runtime contract，避免首轮判合规、末轮判违规的判定分裂）。没有豁免就写 `无`。

<<<SCOPE-EXEMPTIONS
允许改动 `/ws/cal_phone-worktrees/result-pause/index.html`（业务产物唯一文件）与 `/ws/cal_phone-worktrees/result-pause/tests/**`（可更新 suite 以匹配新增的 0.1 秒档位）；可同步更新 `/ws/cal_phone-worktrees/result-pause/.agents/skills/verify-calculator/**` 中写死的 23 档断言为 24。可在 index.html 中新增 `settings-result-pause`、data-testid / data-* 钩子和设置项。必须保留既有 data-testid、data-key、data-op、`cal-phone.settings.v1` 存储键与既有测试语义。开发只留在该 worktree；不得修改主 checkout `/ws/cal_phone` 的任何业务文件，不得改动既有 `Telos/**` 证据或 `docs/**`，不得把 index.html 拆成多文件或引入外部资源。
SCOPE-EXEMPTIONS>>>

---

## 3. 硬目标（独立确定性验收 · 硬闸 · codex exec）

**输入矩阵（采样覆盖；含边界与「哪些算、哪些拒答」）：**
- 触发 ∈ {手动 `=` 成功结果, 自动等号=2 成功结果, 编辑模式 `=` 成功结果, 除零 `5/0=` 错误, 无运算符 `=` 无结果}
- 暂停时长 ∈ {0（关闭）, 0.1, 0.5, 1.0（默认）, 2.0, 10}
- 键 ∈ {屏幕 `0`–`9`, 屏幕 `.`, 物理键盘 `0`–`9`, 物理键盘 `.`, 退格, 确认, `=`, 运算符}
- 时序 ∈ {结果后 50ms, 暂停中点, 暂停结束 +200ms, 连续多次点击}
- 设置 ∈ {默认, 0.5 / 2 / 0, 刷新后, 非法/空值, 既有设置并存}
- 自动确认 ∈ {0, 0.1, 0.2, 0.5, 1}
- 视口 ∈ {390×844 主测量；320×568 由既有 suite 的 layout 场景回归}
- 预期：暂停窗口内数字输入完全无效，窗口外自动恢复；0.1 秒自动确认约 100ms；其余既有行为不变。

**稳定测试入口：** `main.app[data-operator]`、`input[data-testid="calc-input"]`、`[data-testid="keypad"]`、`[data-key="0"…"9", ".", "backspace", "enter", "equals"]`、`[data-testid="key-equals"]`、`[data-testid="enter"]`、`[data-testid="op-picker"] button[data-op]`、`[data-testid="expression"]`、`[data-testid="result"]`、`[data-testid="history-item"]`、`[data-testid="settings-toggle"]`、`[data-testid="settings-panel"]`、`[data-testid="settings-auto-confirm"]`、`[data-testid="settings-result-pause"]`、`[data-testid="settings-auto-equals"]`、`[data-testid="settings-base-toggle"]`、`[data-testid="settings-base-value"]`、`[data-testid="settings-haptics"]`、`[data-testid="settings-voice-keys"]`、`[data-testid="settings-voice-result"]`、`[data-testid="settings-done"]`。

**不变量：**

| # | 不变量 | 硬闸怎么验（须真跑，非读源码目测） | 阈值 |
|---|---|---|---|
| H1 | 成功结果后数字输入暂停并自动恢复 | Playwright 新 context，暂停设 0.5/1/2；点 `1`、确认、`2`、`=` 得 `3`；结果后 50ms 与暂停中点分别点击 `[data-key="4"]`、按物理键盘 `5`、点击 `.`，读输入/结果/`main.app[data-state]`；暂停结束 +200ms 后再点 `4`；另测暂停=0 | 暂停内输入为空、结果仍 `3`、状态仍 result；暂停+200ms 后输入为 `4`；暂停=0 时结果后立即输入为 `4`；计时误差 ≤150ms |
| H2 | 暂停设置默认/范围/持久化 | 打开设置读 `settings-result-pause`；设 0.5、0、2 并刷新；输入 `abc` 或空值后 blur；读 `localStorage["cal-phone.settings.v1"]` 与既有设置项 | 默认数值为 1.0；0.5/0/2 刷新后保持；非法/空值恢复上一个有效值；存储可 JSON 解析且 autoConfirm/base/haptics 等既有项保持 |
| H3 | 触发范围与锁定边界 | 手动 `=`、自动等号=2、`5/0=`、无运算符 `=`；每种后立即点数字，并在暂停中试点退格/确认/等号，读输入/结果/状态 | 手动与自动结果暂停；除零/无结果不暂停（数字立即开始新输入）；暂停中退格/确认/等号不额外设限，且不得造成 pageerror |
| H4 | 0.1 秒自动确认档位 | 读 `settings-auto-confirm` 全部 option values；设 0.1 输入 `9`，250ms 后读表达式/输入；设 0 等 1.2s；设 0.2 等 0.6s | 含 `0.1` 选项、总数 24、升序无重复；0.1 在 250ms 内确认 `9`；0 不确认；0.2 仍在约 200ms 确认 |
| H5 | 既有行为与震动回归 | 以 worktree 的 `/ws/cal_phone-worktrees/result-pause/tests/suite.mjs` 对 worktree 产物运行 `runSuite({ artifact })`（先设 `NODE_PATH=/ws/cal_phone/tests/node_modules` 并 `Module._initPaths()`）；另用 Playwright 预置 `navigator.vibrate` mock，正常点 `1` 读调用；直接测历史、编辑、除零、设置持久化 | 18 个既有场景 ID 全部 PASS（含 `cold-start.keys-enabled`）；正常点 `1` 恰好一次 `vibrate(10)`；既有行为逐项一致 |
| H6 | 自包含与零错误 | Node 读产物断言闭合/字节/外链；汇总全部测量页面的 pageerror 与 console error | `</html>` 存在、≥1024 字节、外部引用 0；pageerror=0、console error=0 |

<<<HARD-VERIFY-PROMPT
你是确定性验收器。**不要评价 UI 美观、不要改产物源码。**本 prompt 会被单独抽取喂给你（读不到 frontmatter 与上表），所以下面所有文件都写**绝对路径**、基线写 **sha256 值**；runner 会在其后追加 `[RUNTIME CONTRACT]`（round / phase / gate_dir / evidence_dir / out_dir / artifact_sha256 / expected_review_states / SCOPE-EXEMPTIONS 原文），以它为准。
按本闸输入矩阵 / 不变量逐条**实际执行**验证：优先复用已有测试入口，逻辑用 Node 调用函数并断言返回值/异常；界面用 Playwright/jsdom 操控稳定选择器并读值。基线只用于本任务明确要求不可更改的范围，不能自行冻结整个源码或妨碍授权修复。采用项目已有工具与依赖；缺依赖或设备时明确拒答，不能伪装成代码 FAIL。禁止用主观语言/肉眼通读代替实测证据。
量具卫生（三条，写量具时逐条自查）：① 不得含写死的恒 FAIL/恒 PASS 常量判据；② 扫描类不变量的扫描面必须与 §3 声明逐字一致、不得自行扩张，且**不得包含 evidence/ 或 evidence/runs/**（自引用扫描面一旦被本循环必写的证据污染就永远翻不了绿）；③ 断言锚定稳定选择器/数据钩子而非用户可见文案原文（软闸可能正当地要求改文案）；子进程/步骤超时 ≥ 单次实测耗时的 2 倍。
量具接口（两条，runner 靠它做变异检查与尝试隔离，缺一即拒绝提升）：① 环境变量 `KEKKAI_ARTIFACT` 存在时用它覆盖目标文件路径；② `KEKKAI_OUT_DIR` 存在时，`hard-r<N>.txt` / `render-r<N>.txt` / `manifest-r<N>.json` / `review-shots/r<N>/` 全部写到该目录下，而不是 evidence/runs（所有路径以脚本自身所在目录解析、不依赖 cwd）。
目标文件（绝对路径）：/ws/cal_phone-worktrees/result-pause/index.html
本闸具体（时间容差 150ms；计数精确相等；浏览器一律 Playwright，不直接启动 Chrome/Chromium 二进制）：
- 测试环境：从 `/ws/cal_phone/tests/node_modules` 解析 `playwright`（`createRequire('/ws/cal_phone/tests/package.json')`，或 `NODE_PATH=/ws/cal_phone/tests/node_modules`）；`chromium.launch({ headless: true })`；390×844、`isMobile: true`、`hasTouch: true`。本机 seccomp 会以 SIGSYS 终止直接启动的浏览器二进制；不要用 `rm -rf` / `rm -f` 清理临时目录，每次改用新的唯一临时目录。若默认启动被沙箱拒绝，用 `chromiumSandbox: false` 与 `args: ['--disable-gpu']` 重试一次后继续。
- 设置辅助：点 `[data-testid="settings-toggle"]` 打开 `<dialog>`；`[data-testid="settings-result-pause"]` 用 `fill("0.5")` 等写入；`[data-testid="settings-auto-confirm"]` 用 `selectOption("0.1")`；点 `[data-testid="settings-done"]` 关闭。每次改设置后重新打开确认值。
- **H1（暂停屏蔽数字并恢复）**：新 context。设暂停 0.5s：点 `[data-key="1"]`、点 `[data-testid="enter"]`、点 `[data-key="2"]`、点 `[data-key="equals"]`，读 `result` 为 `3`。结果后等 50ms：点 `[data-key="4"]`，读 `calc-input.value` 为空、`result` 仍 `3`、`main.app[data-state]` 为 `result`；等 200ms（约 250ms）按物理键盘 `5`，输入仍空；等 100ms（约 350ms）点击 `.`，输入仍空；等 250ms（约 600ms，超过 500ms）点 `[data-key="4"]`，输入为 `4`。设暂停 1.0（默认）重复：50ms 点 `4` 为空，1200ms 点 `4` 为 `4`；设暂停 2.0：50ms 与 1000ms 点 `4` 均为空，2300ms 点 `4` 为 `4`。设暂停 0：结果后立即点 `4`，输入为 `4`。物理键盘数字与屏幕数字都要覆盖；小数点也要覆盖。
- **H2（设置默认/范围/持久化）**：新 context 打开设置，读 `settings-result-pause` 的 `value`，`Number(value)` 必须为 1；关闭。设 `0.5`，关闭，`page.reload()`，重开设置读回 `0.5`；设 `0`，刷新后读回 `0`；设 `2`，刷新后读回 `2`。输入 `abc` 后触发 blur，值恢复为上一个有效值；输入空值后 blur 同样恢复。读 `localStorage["cal-phone.settings.v1"]` 可 JSON 解析，且 `autoConfirm`、`baseEnabled`、`haptics` 等既有字段仍在。
- **H3（触发范围）**：手动 `=` 路径同 H1 必须暂停。自动等号：设 `autoConfirm=0`、`autoEquals=2`，选 `+`，点 `9`、确认、`5`、确认，等自动结果 `14` 后立即点 `4`，输入为空；暂停结束后点 `4` 输入为 `4`。除零：`5`、`/`、`0`、`=`，`result[data-error="true"]`，立即点 `1`，输入为 `1`（不暂停）。无运算符/无操作数按 `=` 后立即点 `1`，输入为 `1`。暂停中试点 `[data-key="backspace"]`、`[data-testid="enter"]`、`[data-key="equals"]`，不得出现 pageerror；不要求这些键被锁定。
- **H4（0.1 秒自动确认）**：读 `settings-auto-confirm` 的 `option` 值数组；必须包含 `"0.1"`，总数 24，严格升序且无重复，原有 0/0.2/0.4/0.5/1…10 仍在。设 `0.1`，点 `9`，等 250ms：`expression` 含 `9`、输入为空。设 `0`，点 `9`，等 1200ms：输入仍 `9`、表达式空。设 `0.2`，点 `9`，等 600ms：表达式含 `9`。
- **H5（回归）**：在 verify.mjs 里先设置 `process.env.NODE_PATH = "/ws/cal_phone/tests/node_modules"` 并调用 `require("node:module")._initPaths()`，再 `const { runSuite } = await import("file:///ws/cal_phone-worktrees/result-pause/tests/suite.mjs")`，`runSuite({ artifact })`；断言 18 个既有场景 ID {self-contained, cold-start, compute, arithmetic, history-order, reset, continuity, error-recovery, sticky-operator, edit-recompute, edit-multi, edit-invalid, edit-divzero, edit-cancel-restore, edit-pending-replace, edit-pending-recent-value, layout, determinism} 全部存在且 pass，`cold-start` 的 checks 含 `cold-start.keys-enabled`。另用 `page.addInitScript` 预置 `window.__v` 与 `navigator.vibrate` mock，在正常 idle 状态点 `[data-key="1"]`，`window.__v` 必须恰好一个 `10`（震动默认开启）。直接测历史、编辑、除零、设置持久化。
- **H6（自包含与零错误）**：Node 读目标文件，断言 `</html>` 存在、`Buffer.byteLength` ≥1024、外部引用（`<script src`、`<link href`、`<img src`、`@import`、`url(http`）为 0；汇总 H1–H5 创建的全部页面的 `pageerror` 与 console error 为 0。产物被截断或无法解析时 H6 必须 FAIL，脚本不得整体崩溃。
量具覆盖（本闸强制）：`verify.mjs` 的非注释代码中必须出现字面 `H1`、`H2`、`H3`、`H4`、`H5`、`H6`（例如测试表键名或 ID 常量）；仅注释或动态 `H${id}` 不算。

**最终回复格式（强制）**：最后一条回复只输出 verdict 本身，不要解释段落、总结、项目符号或缩进列表。每条不变量必须以行首 `H<id> PASS|FAIL — <实测值>` 开头（行首是 `H`，不能写成 `- H1 PASS`、`* H1` 或空格缩进）；最后一行严格 `HARD: PASS` 或 `HARD: FAIL (Hx,…)`。先把 `verify.mjs` 写好，并在前台以 `node verify.mjs <round>` 跑完；然后把 verifier 写出的 `hard-r<N>.txt` 里的 `ROUND:`、`ARTIFACT_SHA256:`、`VERIFIER_SHA256:`、每条 H 行和最后的 HARD 行原样作为最终回复输出。不要后台运行、不要轮询、不要在最终回复里写“正在运行”或“verification complete”。
phase=first 时把验证逻辑写成脚本 `/ws/cal_phone-worktrees/result-pause/Telos/phone-calculator-result-pause-2-112200/evidence/verify.mjs`（接受轮号参数）并立即以 `node verify.mjs <round>` 运行；它按上面不变量逐条实测并写 `hard-r<N>.txt`：先写 `ROUND: <N>`、`ARTIFACT_SHA256: <64hex>`、`VERIFIER_SHA256: <64hex>`（脚本自身 sha256），再每条 `H<id> PASS|FAIL — 实测值/证据`，末行**严格** `HARD: PASS` 或 `HARD: FAIL (Hx,…)`。
若 runtime contract 的 `expected_review_states` 非 none：同一脚本还须把每个状态用 Playwright/无头 Chrome 渲染成**非空、非纯色、内容互不重复**的 PNG（≥ 240×160；真 320px 用 CDP `Emulation.setDeviceMetricsOverride`）落 `review-shots/r<N>/S<k>.png`——精确且仅这些文件；把带同样头的可见性/溢出/关键尺寸 `key=value` 实测写 `render-r<N>.txt`；写 `manifest-r<N>.json`：`round`、`artifact_sha256`、`verifier_sha256`、`metrics_sha256`、每张图的 `file/sha256/width/height`、`adhoc: []`。
phase=final 时**禁止读取、运行或修改 verify.mjs / ledger / 旧证据**，在你被启动的隔离 scratch cwd 中重新推导全套检查；临时测量只落当前 scratch 目录，最终回复给出裁决，由 CLI 保存（不要自行写 `-o` 路径）；首行同样是 `ROUND:`、`ARTIFACT_SHA256:`，末行同样严格。
HARD-VERIFY-PROMPT>>>

---

## 5. 运行与停止（命令按需选用，非逐行执行的脚本；停止数字只在 frontmatter）
    # gate=/ws/cal_phone-worktrees/result-pause/Telos/phone-calculator-result-pause-2-112200 · rendered by kekkai new — do not edit
    kekkai doctor --gate "/ws/cal_phone-worktrees/result-pause/Telos/phone-calculator-result-pause-2-112200" --host     # before round 1 and after any host change
    kekkai hard "/ws/cal_phone-worktrees/result-pause/Telos/phone-calculator-result-pause-2-112200"                     # r1: independent author writes evidence/verify.mjs; later rounds replay it
    kekkai adhoc "/ws/cal_phone-worktrees/result-pause/Telos/phone-calculator-result-pause-2-112200" -- <command…>      # same-round measurement admissible as 误报 basis
    kekkai recast "/ws/cal_phone-worktrees/result-pause/Telos/phone-calculator-result-pause-2-112200" --reason "<why>"  # sick instrument: quarantine + fresh independent author (≤3 eras)
    kekkai hard "/ws/cal_phone-worktrees/result-pause/Telos/phone-calculator-result-pause-2-112200" --final             # terminal independent stamp at the stop candidate
    kekkai lint "/ws/cal_phone-worktrees/result-pause/Telos/phone-calculator-result-pause-2-112200" --post              # after round 1, on recovery, before STOP
    kekkai close "/ws/cal_phone-worktrees/result-pause/Telos/phone-calculator-result-pause-2-112200" --by <budget|host|instrument|oscillation|human> --blocker "<one sentence>"

- **轮次 = runner 提升进 `evidence/runs/hard-r<N>.txt` 的 canonical 盖章**；其余一切都是尝试（`evidence/attempts/`），不写台账、不占预算、不动 K。轮号由 runner 分配，不要手填；不要手跑 `node verify.mjs` 再拷文件进 runs/（缺 runner 头会被拒绝）。
- **`kekkai hard` 退出码**：`0` 提升为轮；`2` 尝试已归档（先读 `kekkai status --json` 和消息：若该轮已提升但 final 缺失，补 `--final`；否则修因后继续，不盲重跑）；`3` 重复/尝试上限——只有三条合法路：(1) change the business tree, (2) `kekkai recast --reason`, (3) `kekkai close --by <tag>`；`4` 规则拒绝（读消息，别原样重试）。管道故障同一输入有重试上限；无法修复就 `close`，不换措辞/增预算绕过。
- **首个 hard PASS 轮 runner 自动跑审计 final**；final 与量具不一致 ⇒ final 的 FAIL 成立，只能修代码或 `kekkai recast`，永不再跑一次 final 试运气。
- **停止**：`converged` = 最新轮 hard PASS + 当前产物/业务树字节的同 era 独立 final PASS（hard-only 不需要软评或 K 确认轮），且未超 frontmatter `max_rounds`；任何轮数（含 0）都可以 `kekkai close --by <budget|host|instrument|oscillation|human>` 写 blocked 终态并附 `blocker:` 行——绝不把 gate 停在 in-loop 而无 STOP。
- 第 1 轮后、恢复时、写 STOP 前各跑一次 `kekkai lint <本目录> --post`；`POST-IN-PROGRESS` 是运行中的预期警告。

---

## 附录 · 生成器判断记录（可审计的 taste↔structure 边界）
> 让执行者能看懂哪些是「结构强制」、哪些是「生成器的 taste 取舍」。不要复述停止数字（它们只在 frontmatter）。
- **为什么重新签发**：上一版 gate（`phone-calculator-result-pause-112113`）在 rounds=0 blocked by=instrument：muse 作者的最终回复用 `- H1 PASS` 项目符号和解释段落，runner 的 verdict 解析要求行首 `H<id>`，因此 H-id 集合为空；同一 attempt 里 verifier 写出的 `hard-r1.txt` 实际是 H1–H6 PASS 且 artifact `b7447a32`。本 gate 是同一任务契约的重新签发，新增“最终回复格式（强制）”，旧 gate 与全部证据保留、不迁移。
- **为什么硬闸无软评**：目标是可计时的输入行为与既有回归，没有需要主观打分的呈现维度；暂停是否「好看」不在本闸范围，按 Skill 指引用 `--soft none`。
- **为什么基于 master 新建 worktree**：用户明确要求基于主分支、用独立 worktree 实现。按 `Telos/WORKTREES.md`，gate 是 checkout-local 的；本闸的 `repo` / `artifact` 和全部证据都在 `/ws/cal_phone-worktrees/result-pause`，不触碰主 checkout `/ws/cal_phone`。基线 `master` 为 `fe06f8f`，工作区 clean。
- **为什么使用 muse profile**：本机 CC Switch 路由器不提供 gate 默认 profile 的 `gpt-6-astra`，只提供 `muse-spark-1.3-contributor` 与 `deepseek-v4.1-flash`。经用户确认，使用新增的 opt-in profile `muse-spark-1.3-v1`（`muse-spark-1.3-contributor` @ `max`）；不在执行中修改在途 gate 的 profile。
- **为什么把守卫放在 `appendCharacter()`**：屏幕数字键和物理键盘数字键都走这个函数，一个入口即可覆盖两条输入路径；`backspace` / `enter` / `equals` / 运算符不走这里，保持可用，符合用户确认的锁定范围。暂停只阻止输入副作用，不要求阻止震动反馈；正常按键仍按既有 H1 产生一次 10ms 震动（H5 回归）。
- **为什么除零不暂停、自动等号暂停**：用户确认「所有产生结果的计算都暂停」；除零进入 error 状态、没有结果，所以不暂停；手动 `=` 与自动等号都经过 `calculate()`，同一启动点覆盖两者。
- **为什么默认 1.0s、范围 0–10、步进 0.1**：用户确认的产品口径。0 表示关闭；0.1 是最小可调步长。默认值 1.0 不得让「已自定义」指示器常亮，这是既有设置面板语义。
- **为什么自动确认只新增 0.1 档**：用户确认「新增 0.1 秒档位」，原有 23 档保持不变；0.1 放在 0 与 0.2 之间，保持升序。`.agents/skills/verify-calculator` 里写死的 23 档断言允许同步改为 24 档，但它是开发工具，不作为独立硬不变量。
- **为什么 H5 用 worktree 自己的 suite**：worktree 没有 `tests/node_modules`，但可把 `NODE_PATH` 指向主 checkout 的依赖并调用 `Module._initPaths()`；执行者可更新 worktree 的 suite 以适配默认暂停（例如在需要立即输入的场景把暂停设为 0 或等待）。这样既保留 18 个既有场景的回归，又不把主 checkout 的旧断言当成本闸的判据。
- **320×568 不单列计时**：暂停与自动确认的行为与视口无关；窄屏布局回归由 suite 的 `layout` 场景覆盖（H5）。
- **`volatile` 为什么含 `Telos/_worktree-archive`**：该目录是 worktree 证据归档、不是业务代码，按 `Telos/WORKTREES.md` 排除；同父目录的 gate 目录由 runner 自动排除。
