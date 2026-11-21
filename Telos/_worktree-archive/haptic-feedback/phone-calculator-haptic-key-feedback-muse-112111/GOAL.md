---
# ── Kekkai Goal Gate v4 · frontmatter（唯一机读区；停止数字只在这里；矩阵/不变量内容只在正文表格）──
slug: phone-calculator-haptic-key-feedback-muse-112111
version: 4
model_profile: muse-spark-1.3-v1  # 本机未提供 gpt-6-astra，经用户确认改用 muse 判官；执行中不可修改
status: converged                    # draft | in-loop | converged（blocked 终态保持 in-loop）
repo: /ws/cal_phone-worktrees/haptics
artifact: /ws/cal_phone-worktrees/haptics/index.html
# artifact_kind: url | app | service   # 仅 artifact: null 时启用；此时 ARTIFACT_SHA256 := TREE_SHA256
parent_gate: null                  # 子闸填父 GOAL.md 绝对路径；只继承 round-0 决策，不继承证据或 verify.mjs
verifiers:
  hard: codex exec                 # 固定驱动器；pin 与访问标志在 bin/runner.mjs（docs/RUNNER.md）
  soft: null
stop:
  max_rounds: 10
hard_invariants: [H1, H2, H3, H4, H5, H6]
volatile: ["Telos/_worktree-archive"]  # worktree 证据归档目录；按 Telos/WORKTREES.md 约定排除
---

# Kekkai Goal Gate · 屏幕按键轻微震动反馈（可关闭、可降级）

> **运行指令**：你是执行者（Codex / Claude Code / ZCode / Cursor 之一，由 handoff 指定；生成本 gate 的那次调用不得兼任）。
> 开跑前先 `kekkai doctor --gate <本目录> --host`；只有 `requires_display: true` 的真实桌面测量依赖解锁与屏幕权限，普通无头浏览器/逻辑测量不占屏。
> 读**本文件全文** + 同目录 [`./ledger.md`](./ledger.md)（决策台账），然后只用 §5 的命令块驱动验收，直到 §5 的停止条件；在已授权范围内自主推进，缺少外部输入时写明 blocked 与恢复条件。
> 生命周期编辑是唯一允许的 GOAL 改动：第 1 轮前 `status: draft → in-loop`；写 `converged` STOP 前 → `status: converged`；blocked 终态保持 `in-loop`。
> 除此之外 GOAL.md 只读：不改 frontmatter 数字、不改 prompt、不改变 §5 命令的操作、目标路径和关键参数（注释与空白不影响验收）。
> 教义在 Kekkai skill 的 `docs/CREED.md`、runner 契约在该 skill 的 `docs/RUNNER.md`——本文件不复述它们；`kekkai hard/soft` 的退出码与消息就是你的下一步。

## 1. 目标（一句话 + 背景 + 实施指导）
把 `/ws/cal_phone-worktrees/haptics/index.html`（独立 worktree，分支 `haptic-feedback`）的屏幕按键从「只有视觉按下态」提升为「每次用户按下一个计算键都有一次轻微触觉确认」：统分时连续点击数字不必盯着屏幕也能确认键已被接收。震动必须是短促的单脉冲（5–30ms，接近常见的 10ms tap feedback）；只响应用户对屏幕数字键盘与运算符按键的按压，不得在自动确认、自动按等号、页面加载、历史渲染或设置同步时额外震动。设置面板提供「按键震动」开关（默认开启、持久化到既有 `cal-phone.settings.v1`），关闭后完全静默；不支持 Vibration API 或调用抛错的浏览器必须静默降级，计算与既有功能不受影响。

**背景（生成前实测）**：
当前 `/ws/cal_phone-worktrees/haptics/index.html` 没有任何 `navigator.vibrate` / 震动 / haptic 代码。用 Playwright 预置 `navigator.vibrate` mock 后依次点击 `1 2 3 . 退格 =`，`window.__v` 记录 0 次调用；Chromium 本身提供 `navigator.vibrate`，所以无头环境可以用 mock 精确测量调用次数与参数。真实手机上的触感强弱无法在无头环境判定，属于设备外部前提，不写成硬不变量。

**实施指导**：
复用现有 IIFE 内的键盘点击委托（`keypad.addEventListener("click", …)` 的 `[data-key]` 分支）、运算符点击委托（`picker` 的 `[data-op]` 分支）、`settings` 对象与 `loadSettings()` / `saveSettings()`，以及设置面板现有的 checkbox 行样式。建议封装一个 `vibrateKeyFeedback()`：先检查开关与 `typeof navigator.vibrate === "function"`，再以 `try { navigator.vibrate(10); } catch (error) {}` 包住；在 `[data-key]` 与 `[data-op]` 的有效用户点击路径各调用一次，并放在 `button.disabled` 判断之后，避免不可用键震动。**不要**把震动接进 `appendCharacter` / `commitInput` / `calculate` 等会被自动确认、自动按等号复用的函数内部，否则自动动作会震。新增设置项默认开启，关闭只在用户切换后生效并持久化；继续保持单文件、无构建步骤、无外部资源。

> 外部前提：真实手机的震动马达与手感无法无头测量，本闸只验收「何时、调用什么参数」；iOS Safari 不提供 Vibration API，按 H3 静默降级。开发必须在本 worktree `/ws/cal_phone-worktrees/haptics` 内进行，不改主 checkout `/ws/cal_phone` 的业务文件。

## 2. 不变约束（父级红线 · 任何修改不得破坏）
> 每条红线**必须标注归属**：`[H#]`（由该硬不变量机检）或 `[soft-only: 原因]`（只能主观把关，写明为何无法机检）。绝对不能改的代码块优先给 sha256 机检形式。不允许留下既非 `[H#]` 也非 `[soft-only]` 的悬空红线。
- 每个屏幕计算键（`[data-key]` 的 0–9、`.`、backspace、enter、equals 与 `[data-op]` 的四个运算符）在一次用户点击中恰好产生一次震动调用，归一化为单脉冲且时长 5–30ms；不得漏震、叠震或按两次震一次 [H1]
- 设置面板必须有 `[data-testid="settings-haptics"]` 复选框，默认开启；关闭后按键不再震动，重新开启后恢复；选择在刷新后仍生效，存储键仍为 `cal-phone.settings.v1`，既有设置项不丢失 [H2]
- `navigator.vibrate` 不存在或调用抛错时，页面加载与全部按键操作不产生 pageerror / console error，输入、确认、等号与设置面板照常工作 [H3]
- 自动确认、自动按等号、页面加载、历史渲染、设置同步等非用户按键动作不得产生震动；震动次数只随用户点击增长 [H4]
- 既有计算、历史、编辑、退格、除零、设置、语音、布局与确定性行为不回归：`tests/suite.mjs` 的既有场景全部通过，既有 `data-testid` / `data-key` / `data-op` 不得删除或改名 [H5]
- 产物仍是单文件自包含（无外部 script/link/img/font/@import）、`</html>` 闭合、字节数 ≥1024，所有被检页面 pageerror=0、console error=0 [H6]

> 允许改动的范围豁免写在下面的定界块里（runner 会把它**逐字**内联进 first / recast / final 验收器的 runtime contract，避免首轮判合规、末轮判违规的判定分裂）。没有豁免就写 `无`。

<<<SCOPE-EXEMPTIONS
允许改动 `/ws/cal_phone-worktrees/haptics/index.html`（业务代码唯一产物）与 `/ws/cal_phone-worktrees/haptics/tests/**`（可新增本任务辅助测试）；可在 index.html 中新增 data-testid / data-* 钩子和设置项。必须保留既有 data-testid、data-key、data-op、`cal-phone.settings.v1` 存储键与既有测试语义。开发只留在该 worktree；不得修改主 checkout `/ws/cal_phone` 的任何业务文件，不得改动既有 `Telos/**` 证据或 `docs/**`，不得把 index.html 拆成多文件或引入外部资源。
SCOPE-EXEMPTIONS>>>

---

## 3. 硬目标（独立确定性验收 · 硬闸 · codex exec）

**输入矩阵（采样覆盖；含边界与「哪些算、哪些拒答」）：**
- 按键 ∈ {`[data-key]` 的 `0`–`9`、`.`、`backspace`、`enter`、`equals`；`[data-op]` 的 `+`、`-`、`*`、`/`}
- 设置态 ∈ {全新 localStorage（默认开启）, 震动关闭, 关闭后刷新, 重新开启后刷新, 既有设置（自动确认=1、基数=10、语音字段）并存}
- 宿主能力 ∈ {Vibration API 正常, `navigator.vibrate` 不存在, `navigator.vibrate` 抛错}
- 动作来源 ∈ {用户点击屏幕键, 自动确认, 自动按等号, 页面加载, 打开/关闭设置面板, 历史与编辑渲染}
- 输入序列 ∈ {单键, `1→5` 连续快速点击, `9` 后等待自动确认, `9`/`5` 两笔触发自动等号, `1.` 小数点, `123` 后退格}
- 视口 ∈ {390×844 主测量；320×568 由既有 suite 的 layout 场景回归}
- 预期：每次用户按键恰好一次 5–30ms 单脉冲；自动动作 0 次；开关关闭 0 次；宿主不支持或抛错时 0 异常且功能照常。

**稳定测试入口：** `main.app[data-operator]`、`input[data-testid="calc-input"]`、`[data-testid="keypad"]`、`[data-key="0"…"9", ".", "backspace", "enter", "equals"]`、`[data-testid="key-equals"]`、`[data-testid="enter"]`、`[data-testid="op-picker"] button[data-op]`、`[data-testid="expression"]`、`[data-testid="result"]`、`[data-testid="history-item"]`、`[data-testid="settings-toggle"]`、`[data-testid="settings-panel"]`、`[data-testid="settings-haptics"]`、`[data-testid="settings-auto-confirm"]`、`[data-testid="settings-auto-equals"]`、`[data-testid="settings-base-toggle"]`、`[data-testid="settings-base-value"]`、`[data-testid="settings-voice-keys"]`、`[data-testid="settings-voice-result"]`、`[data-testid="settings-done"]`。

**不变量：**

| # | 不变量 | 硬闸怎么验（须真跑，非读源码目测） | 阈值 |
|---|---|---|---|
| H1 | 每个屏幕计算键一次短震 | Playwright 预置 `navigator.vibrate` mock 记录参数；每次目标点击前清空记录；分别点击每个 `[data-key]` 与 `[data-op]`，并读输入框/运算符/结果确认动作已生效；再以 ≥60ms 间隔连点 `1` 五次 | 每个用户点击恰好 1 次调用；归一化为单脉冲且时长 5–30ms；连点 5 次恰为 5 次调用 |
| H2 | 设置开关、默认开启与持久化 | 新 context 打开设置读 `settings-haptics`；关闭/开启后点击按键计数；刷新后复查复选框与行为；同时写入既有设置项再刷新 | 默认 `checked=true`；关闭后 0 次、开启后每次点击 1 次；刷新后 `checked` 与行为一致；`cal-phone.settings.v1` 可解析且自动确认=1、基数=10 等既有项保持 |
| H3 | 不支持/抛错时静默降级 | 两个 context 分别把 `navigator.vibrate` 设为 `undefined` 与抛错函数；加载后完成 `1→2`、确认、打开设置 | pageerror=0、console error=0；输入依次 `1`、`12`，确认后表达式含 `12`；抛错 context 中后续点击不被中断 |
| H4 | 自动动作不震动 | 自动确认=0.2 时点 `9` 一次并等确认；自动等号=2 时点 `9`、确认、`5`、确认并等计算；新 context 加载后静置，开关设置面板与历史 | 点击阶段调用数=N；自动确认/自动等号/加载/设置/历史之后调用数不再增加（差值 0） |
| H5 | 既有行为回归 | 以主 checkout 的 `/ws/cal_phone/tests/suite.mjs` 对 worktree 产物运行 `runSuite({ artifact })`；另直接测快速输入与关闭震动后的计算 | 18 个既有场景全部 PASS（含 `cold-start.keys-enabled`）；`1→5` 录入依次 `1,12,123,1234,12345`；关闭震动后结果不变 |
| H6 | 自包含与零错误 | Node 读产物断言闭合/字节/外链；汇总全部测量页面的 pageerror 与 console error | `</html>` 存在、≥1024 字节、外部引用 0；pageerror=0、console error=0 |

<<<HARD-VERIFY-PROMPT
你是确定性验收器。**不要评价 UI 美观、不要改产物源码。**本 prompt 会被单独抽取喂给你（读不到 frontmatter 与上表），所以下面所有文件都写**绝对路径**、基线写 **sha256 值**；runner 会在其后追加 `[RUNTIME CONTRACT]`（round / phase / gate_dir / evidence_dir / out_dir / artifact_sha256 / expected_review_states / SCOPE-EXEMPTIONS 原文），以它为准。
按本闸输入矩阵 / 不变量逐条**实际执行**验证：优先复用已有测试入口，逻辑用 Node 调用函数并断言返回值/异常；界面用 Playwright/jsdom 操控稳定选择器并读值。基线只用于本任务明确要求不可更改的范围，不能自行冻结整个源码或妨碍授权修复。采用项目已有工具与依赖；缺依赖或设备时明确拒答，不能伪装成代码 FAIL。禁止用主观语言/肉眼通读代替实测证据。
量具卫生（三条，写量具时逐条自查）：① 不得含写死的恒 FAIL/恒 PASS 常量判据；② 扫描类不变量的扫描面必须与 §3 声明逐字一致、不得自行扩张，且**不得包含 evidence/ 或 evidence/runs/**（自引用扫描面一旦被本循环必写的证据污染就永远翻不了绿）；③ 断言锚定稳定选择器/数据钩子而非用户可见文案原文（软闸可能正当地要求改文案）；子进程/步骤超时 ≥ 单次实测耗时的 2 倍。
量具接口（两条，runner 靠它做变异检查与尝试隔离，缺一即拒绝提升）：① 环境变量 `KEKKAI_ARTIFACT` 存在时用它覆盖目标文件路径；② `KEKKAI_OUT_DIR` 存在时，`hard-r<N>.txt` / `render-r<N>.txt` / `manifest-r<N>.json` / `review-shots/r<N>/` 全部写到该目录下，而不是 evidence/runs（所有路径以脚本自身所在目录解析、不依赖 cwd）。
目标文件（绝对路径）：/ws/cal_phone-worktrees/haptics/index.html
本闸具体（计数精确相等；时长容差 1ms；浏览器一律 Playwright，不直接启动 Chrome/Chromium 二进制）：
- 测试环境：从 `/ws/cal_phone/tests/node_modules` 解析 `playwright`（`createRequire('/ws/cal_phone/tests/package.json')`，或 `NODE_PATH=/ws/cal_phone/tests/node_modules`）；`chromium.launch({ headless: true })`；390×844、`isMobile: true`、`hasTouch: true`。本机 seccomp 会以 SIGSYS 终止直接启动的浏览器二进制；不要用 `rm -rf` / `rm -f` 清理临时目录，每次改用新的唯一临时目录。若默认启动被沙箱拒绝，用 `chromiumSandbox: false` 与 `args: ['--disable-gpu']` 重试一次后继续。
- 震动量具：导航前 `page.addInitScript` 用 `Object.defineProperty(Navigator.prototype, 'vibrate', { configurable: true, value: function (p) { window.__v.push(p); return true; } })` 覆盖；每次目标点击前 `page.evaluate(() => { window.__v = []; })`，点击后等 80ms 再读 `window.__v`。参数归一化：number → `[n]`；array 必须恰好 1 个 number 元素；有效时长 5–30ms。
- **H1（逐键短震）**：新 context。对 `[data-key]` 的 `0`…`9` 各自：清空记录 → 点击 → `calc-input.value` 等于该数字且 `window.__v` 长度 1、时长 5–30ms。`.`：先点 `1` 再清空记录点 `.`，值 `1.` 且 1 次。`backspace`：先点 `1 2 3`，清空后点退格，值 `12` 且 1 次。`enter`：点 `9`、清空后点确认，`expression` 含 `9`、输入框空、1 次。`equals`：点 `[data-op="+"]`、点 `1`、确认、点 `2`，清空后点 `=`，`result[data-value]` 为 `3` 且 1 次。运算符：对 `+`、`-`、`*`、`/` 逐个清空记录后点击，`main.app[data-operator]` 等于该值且各 1 次。连续：清空后以 ≥60ms 间隔点 `1` 五次，调用数恰为 5。
- **H2（开关与持久化）**：新 context（空 localStorage）点 `[data-testid="settings-toggle"]`，读 `settings-haptics` 存在、是 checkbox、`checked === true`；点 `settings-done` 后点 `1` 得 1 次。再开面板取消勾选并关闭，清空记录点 `1`：调用 0 且输入为 `1`；`page.reload()` 后开面板 `checked === false`，点 `1` 调用 0。重新勾选并刷新后 `checked === true`，点 `1` 调用 1。另设 `settings-auto-confirm=1`、勾选 `settings-base-toggle`、`settings-base-value=10`，刷新后这三项仍为 `1` / `true` / `10`，且 `localStorage["cal-phone.settings.v1"]` 可 JSON 解析。
- **H3（降级）**：context A 在 init script 中把 `navigator.vibrate` 定义为 `undefined`；context B 定义为 `function () { throw new Error("vibration-blocked"); }`。两者加载产物后点 `1`、`2`，点确认，再打开设置面板：不得出现 pageerror / console error；`calc-input` 依次为 `1`、`12`，确认后 `expression` 含 `12`；B 中抛错不得阻止后续点击（再点 `3` 后输入仍可继续，不得卡死）。
- **H4（自动动作不震动）**：新 context，设 `settings-auto-confirm=0.2`，清空记录点 `9`（1 次）并等 600ms：调用数仍为 1，`expression` 含 `9`。另一 context 设 `settings-auto-confirm=0`、`settings-auto-equals=2`，选 `+`，清空记录后点 `9`、确认、`5`、确认，等 400ms：调用数恰为 4，`result[data-value]` 为 `14`，历史 1 条，且调用数不再增长。新 context 加载后清空记录静置 200ms：调用 0；打开/关闭设置面板、打开历史后调用仍为 0。
- **H5（回归）**：`const { runSuite } = await import('file:///ws/cal_phone/tests/suite.mjs')`（主 checkout 带 `tests/node_modules`；worktree 没有），以 `runSuite({ artifact })` 运行，`artifact` 为 worktree 产物；断言结果 id 集合等于 {self-contained, cold-start, compute, arithmetic, history-order, reset, continuity, error-recovery, sticky-operator, edit-recompute, edit-multi, edit-invalid, edit-divzero, edit-cancel-restore, edit-pending-replace, edit-pending-recent-value, layout, determinism} 且全部 pass，`cold-start` 的 checks 含 `cold-start.keys-enabled`。另直接以固定坐标短间隔点击 `1→5`，输入依次为 `1,12,123,1234,12345`；关闭震动后该序列结果不变。
- **H6（自包含与零错误）**：Node 读目标文件，断言 `</html>` 存在、`Buffer.byteLength` ≥1024、外部引用（`<script src`、`<link href`、`<img src`、`@import`、`url(http`）为 0；汇总 H1–H5 创建的全部页面的 `pageerror` 与 console error 为 0。产物被截断或无法解析时 H6 必须 FAIL，脚本不得整体崩溃。
phase=first 时把验证逻辑写成脚本 `/ws/cal_phone-worktrees/haptics/Telos/phone-calculator-haptic-key-feedback-muse-112111/evidence/verify.mjs`（接受轮号参数）并立即以 `node verify.mjs <round>` 运行；它按上面不变量逐条实测并写 `hard-r<N>.txt`：先写 `ROUND: <N>`、`ARTIFACT_SHA256: <64hex>`、`VERIFIER_SHA256: <64hex>`（脚本自身 sha256），再每条 `H<id> PASS|FAIL — 实测值/证据`，末行**严格** `HARD: PASS` 或 `HARD: FAIL (Hx,…)`。
若 runtime contract 的 `expected_review_states` 非 none：同一脚本还须把每个状态用 Playwright/无头 Chrome 渲染成**非空、非纯色、内容互不重复**的 PNG（≥ 240×160；真 320px 用 CDP `Emulation.setDeviceMetricsOverride`）落 `review-shots/r<N>/S<k>.png`——精确且仅这些文件；把带同样头的可见性/溢出/关键尺寸 `key=value` 实测写 `render-r<N>.txt`；写 `manifest-r<N>.json`：`round`、`artifact_sha256`、`verifier_sha256`、`metrics_sha256`、每张图的 `file/sha256/width/height`、`adhoc: []`。
phase=final 时**禁止读取、运行或修改 verify.mjs / ledger / 旧证据**，在你被启动的隔离 scratch cwd 中重新推导全套检查；临时测量只落当前 scratch 目录，最终回复给出裁决，由 CLI 保存（不要自行写 `-o` 路径）；首行同样是 `ROUND:`、`ARTIFACT_SHA256:`，末行同样严格。
HARD-VERIFY-PROMPT>>>

---

## 5. 运行与停止（命令按需选用，非逐行执行的脚本；停止数字只在 frontmatter）
    # gate=/ws/cal_phone-worktrees/haptics/Telos/phone-calculator-haptic-key-feedback-muse-112111 · rendered by kekkai new — do not edit
    kekkai doctor --gate "/ws/cal_phone-worktrees/haptics/Telos/phone-calculator-haptic-key-feedback-muse-112111" --host     # before round 1 and after any host change
    kekkai hard "/ws/cal_phone-worktrees/haptics/Telos/phone-calculator-haptic-key-feedback-muse-112111"                     # r1: independent author writes evidence/verify.mjs; later rounds replay it
    kekkai adhoc "/ws/cal_phone-worktrees/haptics/Telos/phone-calculator-haptic-key-feedback-muse-112111" -- <command…>      # same-round measurement admissible as 误报 basis
    kekkai recast "/ws/cal_phone-worktrees/haptics/Telos/phone-calculator-haptic-key-feedback-muse-112111" --reason "<why>"  # sick instrument: quarantine + fresh independent author (≤3 eras)
    kekkai hard "/ws/cal_phone-worktrees/haptics/Telos/phone-calculator-haptic-key-feedback-muse-112111" --final             # terminal independent stamp at the stop candidate
    kekkai lint "/ws/cal_phone-worktrees/haptics/Telos/phone-calculator-haptic-key-feedback-muse-112111" --post              # after round 1, on recovery, before STOP
    kekkai close "/ws/cal_phone-worktrees/haptics/Telos/phone-calculator-haptic-key-feedback-muse-112111" --by <budget|host|instrument|oscillation|human> --blocker "<one sentence>"

- **轮次 = runner 提升进 `evidence/runs/hard-r<N>.txt` 的 canonical 盖章**；其余一切都是尝试（`evidence/attempts/`），不写台账、不占预算、不动 K。轮号由 runner 分配，不要手填；不要手跑 `node verify.mjs` 再拷文件进 runs/（缺 runner 头会被拒绝）。
- **`kekkai hard` 退出码**：`0` 提升为轮；`2` 尝试已归档（先读 `kekkai status --json` 和消息：若该轮已提升但 final 缺失，补 `--final`；否则修因后继续，不盲重跑）；`3` 重复/尝试上限——只有三条合法路：(1) change the business tree, (2) `kekkai recast --reason`, (3) `kekkai close --by <tag>`；`4` 规则拒绝（读消息，别原样重试）。管道故障同一输入有重试上限；无法修复就 `close`，不换措辞/增预算绕过。
- **首个 hard PASS 轮 runner 自动跑审计 final**；final 与量具不一致 ⇒ final 的 FAIL 成立，只能修代码或 `kekkai recast`，永不再跑一次 final 试运气。
- **停止**：`converged` = 最新轮 hard PASS + 当前产物/业务树字节的同 era 独立 final PASS（hard-only 不需要软评或 K 确认轮），且未超 frontmatter `max_rounds`；任何轮数（含 0）都可以 `kekkai close --by <budget|host|instrument|oscillation|human>` 写 blocked 终态并附 `blocker:` 行——绝不把 gate 停在 in-loop 而无 STOP。
- 第 1 轮后、恢复时、写 STOP 前各跑一次 `kekkai lint <本目录> --post`；`POST-IN-PROGRESS` 是运行中的预期警告。

---

## 附录 · 生成器判断记录（可审计的 taste↔structure 边界）
> 让执行者能看懂哪些是「结构强制」、哪些是「生成器的 taste 取舍」。不要复述停止数字（它们只在 frontmatter）。
- **为什么重新签发**：原 `astra-flash-3.8-v1` gate 在本机 blocked by=host（CC Switch 未提供 gpt-6-astra，codex 回退模型的工具参数错误导致执行者中途退出）。用户确认改用 `muse-spark-1.3-v1` 判官；本 gate 是同一任务契约的重新签发，旧 gate 及其全部证据保留、不迁移，业务产物仍在 `/ws/cal_phone-worktrees/haptics/index.html`。
- **为什么是 worktree**：用户明确要求用独立 worktree 开发。按 `Telos/WORKTREES.md`，gate 是 checkout-local 的，所以本闸的 `repo` / `artifact` 和全部证据都在 `/ws/cal_phone-worktrees/haptics`；合并只带业务字节，gate 与证据留在该 checkout，删 worktree 前用归档脚本冻结。该 worktree 从 `score-tally-settings` 的 HEAD 建分支 `haptic-feedback`，并把主 checkout 当前工作副本 `index.html` 复制进来（主树有未提交的语音改动，HEAD 不含这些字节）；因此本闸只验收 worktree 中的这份产物，不声称主树已验证。
- **为什么硬闸无软评**：目标是可计数的调用契约（何时调用、调用几次、参数多长）与现有行为回归，没有需要主观打分的呈现维度；触感强弱无法由像素评审判断，按 Skill 指引用 `--soft none`。真实手机手感是设备外部前提，不写成永远失败的 H。
- **为什么用 mock 而不是真实震动**：无头浏览器没有马达，`navigator.vibrate` 的调用次数与参数是唯一可复现的代理指标；Chromium 提供该 API，`Object.defineProperty` 覆盖已验证能拦截调用。把真机手感留给人工验收，而不是伪造成机检。
- **为什么时长取 5–30ms 单脉冲**：用户要「轻微震动」；常见 tap feedback 约 10ms。区间允许实现微调，同时排除长震、多脉冲和 `[10, 50, 10]` 之类的节奏震动。
- **为什么 H4 单列自动动作**：自动确认与自动等号会复用 `commitInput` / `calculate`；若把震动接在业务函数内部，用户会在没有按键时被震。H4 用差值 0 把「只随用户点击增长」变成可测断言。
- **为什么 H3 包含抛错 mock**：Vibration API 在部分嵌入/权限环境可能拒绝调用。静默降级要求实现用 `try/catch` 或前置能力检查，抛错 context 的 pageerror=0 是最直接的判别。
- **为什么不冻结源码 sha256**：改动横跨 CSS、HTML 与脚本，冻结整块会妨碍授权修复；回归由 `tests/suite.mjs` 的既有场景与直接行为场景覆盖。H6 只保留自包含/闭合/无外链/零错误这些结构红线。
- **320×568 不单列几何测量**：震动行为与视口无关；320 布局回归由既有 suite 的 `layout` 场景覆盖（H5），避免重复造几何量具。
- **`volatile` 为什么含 `Telos/_worktree-archive`**：该目录是 worktree 证据归档、不是业务代码，按 `Telos/WORKTREES.md` 第 6 条排除；其余业务文件与旧 gate 目录不排除（同父目录的 gate 目录由 runner 自动排除）。
