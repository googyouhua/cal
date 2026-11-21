---
# ── Kekkai Goal Gate v4 · frontmatter（唯一机读区；停止数字只在这里；矩阵/不变量内容只在正文表格）──
slug: phone-calculator-voice-tests-112108
version: 4
model_profile: astra-flash-3.8-v1  # 新任务冻结模型组合；执行中不可修改
status: in-loop                    # draft | in-loop | converged（blocked 终态保持 in-loop）
repo: /ws/cal_phone
artifact: /ws/cal_phone/index.html
# artifact_kind: url | app | service   # 仅 artifact: null 时启用；此时 ARTIFACT_SHA256 := TREE_SHA256
parent_gate: /ws/cal_phone/Telos/phone-calculator-voice-announcements-112105/GOAL.md                  # 子闸填父 GOAL.md 绝对路径；只继承 round-0 决策，不继承证据或 verify.mjs
verifiers:
  hard: codex exec                 # 固定驱动器；pin 与访问标志在 bin/runner.mjs（docs/RUNNER.md）
  soft: null
stop:
  max_rounds: 6
hard_invariants: [H1, H2, H3, H4, H5, H6]
volatile: ["voice/"]               # TREE_SHA256 排除的仓库相对路径（构建产物、日志等）；空数组即可
---

# Kekkai Goal Gate · 补齐语音播报的仓库内自动化测试（tests/voice/）

> **运行指令**：你是执行者（Codex / Claude Code / ZCode / Cursor 之一，由 handoff 指定；生成本 gate 的那次调用不得兼任）。
> 开跑前先 `kekkai doctor --gate <本目录> --host`；只有 `requires_display: true` 的真实桌面测量依赖解锁与屏幕权限，普通无头浏览器/逻辑测量不占屏。
> 读**本文件全文** + 同目录 [`./ledger.md`](./ledger.md)（决策台账），然后只用 §5 的命令块驱动验收，直到 §5 的停止条件；在已授权范围内自主推进，缺少外部输入时写明 blocked 与恢复条件。
> 生命周期编辑是唯一允许的 GOAL 改动：第 1 轮前 `status: draft → in-loop`；写 `converged` STOP 前 → `status: converged`；blocked 终态保持 `in-loop`。
> 除此之外 GOAL.md 只读：不改 frontmatter 数字、不改 prompt、不改变 §5 命令的操作、目标路径和关键参数（注释与空白不影响验收）。
> 教义在 Kekkai skill 的 `docs/CREED.md`、runner 契约在该 skill 的 `docs/RUNNER.md`——本文件不复述它们；`kekkai hard/soft` 的退出码与消息就是你的下一步。

## 1. 目标（一句话 + 背景 + 实施指导）
父闸 `phone-calculator-voice-announcements-112105` 已把语音播报实现并收敛，但设计 §9.1 要求常驻仓库的 `tests/voice/` 没有落地——语音自动化只存在于父闸的 `evidence/verify.mjs` 里。本闸只补 **`tests/voice/`（普通 HTTP 静态服务器 + Playwright + 假引擎）** 与根 `README.md` 的运行说明，不改已经收敛的 `index.html`，让后续任何改动都能用一条命令重复验收语音行为。

**实施指导**：
新增 `/ws/cal_phone/tests/voice/run.mjs` 作为唯一入口，默认从仓库根运行，自己起一个本地 HTTP 静态服务器（不要依赖 `file://`、`/ws/voice`、公网或 96MB 真实模型），用 Playwright（复用 `/ws/cal_phone/tests/node_modules` 与现有 `tests/lib/browser.mjs` 的启动方式）驱动 `/ws/cal_phone/index.html`，按设计 §9.1 的 1–7 项建立检查：设置与持久化、`file://` 禁用且零 voice 请求、按键播报（含空确认/空退格/重复点/撤销/自动确认）、结果播报（中文读法/负数/除零/自动等号/直接等号）、开关独立、队列入队/丢弃/替换/关闭清理、320×568 与 390×844 布局，以及 `node tests/suite.mjs` 的 18 场景 206 检查回归。测试用的假引擎注入约定与父闸 §1 相同：页面脚本前设置 `window.SherpaOnnx`、`window.createOfflineTts` 与 `window.__voiceFake`，测试服务器对 `voice/**` 返回小占位文件；不得要求真实资源体积。单条检查失败不得中止其余检查，最后统一退出。`--json` 在 stdout 只打印一个 JSON 对象：`{"checks":[{"id":"…","pass":true,"detail":"…"}],"passed":<int>,"failed":<int>}`，诊断信息写 stderr；退出码 0 当且仅当 `failed===0`。检查 id 使用稳定前缀：`settings.`、`file.`、`keys.`、`result.`、`independence.`、`queue.`、`layout.`、`regression.`。`--artifact <path>` 覆盖被测 HTML；`--real` 仅在 `VOICE_REAL=1` 时允许，复用真实 `voice/` 资源并等待 `data-voice-state=ready` 后验证 `data-speech-played` 含 `九/五/结果 九十五`、`data-speech-last-ms > 100`；未设 `VOICE_REAL=1` 时 `--real` 必须以非零退出并明确提示 `VOICE_REAL`，绝不能静默跳过或伪装成功。根 `README.md` 增加测试命令与真实 smoke 说明。

> 外部前提（账号、服务、人工决定、设备权限）应在实施指导中明确；缺失时保留证据并 blocked，不把无法由代码修复的条件塞进硬不变量反复重跑。
> 真实引擎 smoke 依赖已安装的 `voice/`（当前 7 个文件已就位，约 96MB）与无头 Chromium；若执行器运行时 `voice/` 缺失，`--real` 的明确失败属于预期行为，不是本闸硬不变量。本闸硬闸只要求假引擎套件可重复通过、对回归敏感、真实模式有准入保护；目标手机听音仍是闸外人工步骤。

## 2. 不变约束（父级红线 · 任何修改不得破坏）
> 每条红线**必须标注归属**：`[H#]`（由该硬不变量机检）或 `[soft-only: 原因]`（只能主观把关，写明为何无法机检）。绝对不能改的代码块优先给 sha256 机检形式。不允许留下既非 `[H#]` 也非 `[soft-only]` 的悬空红线。
- `/ws/cal_phone/index.html` 必须与父闸收敛字节完全一致，不得为了测试改产品代码或加测试旁路 [H1]
- 现有 `tests/suite.mjs` 的 18 场景 / 206 检查必须继续全绿，不得删减或放宽 [H4]
- 假引擎套件不得依赖 `/ws/voice`、公网、真实 96MB 模型或人工点击；单条失败要计入汇总并以非零退出 [H2]
- 套件必须能发现真实回归：删掉语音设置控件或观测属性时，套件必须失败，不能恒 PASS [H3]
- `--real` 必须由 `VOICE_REAL=1` 显式准入；未准入时不得运行真实模型，也不得把跳过伪装成通过 [H5]
- 新增测试与说明必须能被下一位维护者发现并重复运行（根 README 写清命令） [H6]

> 允许改动的范围豁免写在下面的定界块里（runner 会把它**逐字**内联进 first / recast / final 验收器的 runtime contract，避免首轮判合规、末轮判违规的判定分裂）。没有豁免就写 `无`。

<<<SCOPE-EXEMPTIONS
允许改动：新增 /ws/cal_phone/tests/voice/**（测试入口、静态服务器、假引擎、检查）；修改 /ws/cal_phone/README.md 增加测试命令与真实 smoke 说明。不允许修改 /ws/cal_phone/index.html、/ws/cal_phone/tests/suite.mjs、/ws/cal_phone/tests/scenarios/**、/ws/cal_phone/tests/lib/**、/ws/cal_phone/scripts/**、/ws/cal_phone/deploy/** 或任何语音产品代码。
SCOPE-EXEMPTIONS>>>

---

## 3. 硬目标（独立确定性验收 · 硬闸 · codex exec）

**输入矩阵（采样覆盖；含边界与「哪些算、哪些拒答」）：**
- 被测产物 ∈ {`/ws/cal_phone/index.html` 原字节, 两个临时变异副本（删改 `settings-voice-keys` 与 `data-speech-log`）}
- 套件模式 ∈ {默认假引擎, `--json`, `--artifact <path>`, `--real` 未准入（必须拒答）, `--help`}
- 覆盖维度 ∈ {设置/持久化, `file://` 禁用, 按键播报, 结果播报, 开关独立, 队列/打断, 320/390 布局, 既有 18/206 回归}
- 运行环境 ∈ {普通 HTTP 本地服务器, 无真实模型依赖, Playwright 1.64.0}

**稳定测试入口：** `/ws/cal_phone/tests/voice/run.mjs`（`--json`、`--artifact`、`--real`、`--help`）；现有 `/ws/cal_phone/tests/suite.mjs --json`；被测稳定选择器与观测属性沿用父闸：`settings-voice-keys`、`settings-voice-result`、`voice-status`、`voice-retry`、`data-voice-state`、`data-speech-log`、`data-speech-played` 等。

**不变量：**

| # | 不变量 | 硬闸怎么验（须真跑，非读源码目测） | 阈值 |
|---|---|---|---|
| H1 | 产品字节未被测试改动 | `sha256sum /ws/cal_phone/index.html` 与父闸收敛基线逐字符比对 | == `26224e9c1c4bd44f228d4a408cd73a7de5048ac99988252c1471e1a10dddda55` |
| H2 | 常驻假引擎套件存在、可重复运行且覆盖七个设计维度 | `node /ws/cal_phone/tests/voice/run.mjs --json`（cwd 仓库根）：退出 0；stdout 解析为单个 JSON；`failed === 0`；`checks.length >= 24` 且每项 `pass === true`；id 前缀至少各出现一次：`settings.`、`file.`、`keys.`、`result.`、`independence.`、`queue.`、`layout.`、`regression.` | 退出 0、failed=0、≥24 检查、8 个前缀齐全 |
| H3 | 套件对真实回归敏感（非恒 PASS） | 复制 `index.html` 到临时文件，分别做两种替换后各跑 `node tests/voice/run.mjs --artifact <临时文件> --json`：① 把所有 `settings-voice-keys` 改成 `settings-voice-keys-mutant`；② 把所有 `data-speech-log` 改成 `data-speech-log-mutant`。两次都必须非零退出；若输出 JSON 可解析，则 `failed > 0` | 两个变异均被检出 |
| H4 | 既有回归套件仍全绿 | `node /ws/cal_phone/tests/suite.mjs --json`（cwd `/ws/cal_phone/tests`）解析 `results` | 18 场景、206 检查、0 失败 |
| H5 | 真实模式有显式准入且帮助可见 | `node tests/voice/run.mjs --help` 输出含 `--real` 与 `VOICE_REAL`；`node tests/voice/run.mjs --real`（不设 `VOICE_REAL`）非零退出且输出含 `VOICE_REAL` | 两项均成立 |
| H6 | 根 README 记录可重复运行的命令 | 读 `/ws/cal_phone/README.md`：同时含 `tests/voice/run.mjs`、`--real`、`VOICE_REAL=1` | 三个事实齐全 |

<<<HARD-VERIFY-PROMPT
你是确定性验收器。**不要评价 UI 美观、不要改产物源码。**本 prompt 会被单独抽取喂给你（读不到 frontmatter 与上表），所以下面所有文件都写**绝对路径**、基线写 **sha256 值**；runner 会在其后追加 `[RUNTIME CONTRACT]`（round / phase / gate_dir / evidence_dir / out_dir / artifact_sha256 / expected_review_states / SCOPE-EXEMPTIONS 原文），以它为准。
按本闸输入矩阵 / 不变量逐条**实际执行**验证：优先复用已有测试入口，逻辑用 Node 调用函数并断言返回值/异常；界面用 Playwright/jsdom 操控稳定选择器并读值。基线只用于本任务明确要求不可更改的范围，不能自行冻结整个源码或妨碍授权修复。采用项目已有工具与依赖；缺依赖或设备时明确拒答，不能伪装成代码 FAIL。禁止用主观语言/肉眼通读代替实测证据。
量具卫生（三条，写量具时逐条自查）：① 不得含写死的恒 FAIL/恒 PASS 常量判据；② 扫描类不变量的扫描面必须与 §3 声明逐字一致、不得自行扩张，且**不得包含 evidence/ 或 evidence/runs/**（自引用扫描面一旦被本循环必写的证据污染就永远翻不了绿）；③ 断言锚定稳定选择器/数据钩子而非用户可见文案原文（软闸可能正当地要求改文案）；子进程/步骤超时 ≥ 单次实测耗时的 2 倍。
量具接口（两条，runner 靠它做变异检查与尝试隔离，缺一即拒绝提升）：① 环境变量 `KEKKAI_ARTIFACT` 存在时用它覆盖目标文件路径；② `KEKKAI_OUT_DIR` 存在时，`hard-r<N>.txt` / `render-r<N>.txt` / `manifest-r<N>.json` / `review-shots/r<N>/` 全部写到该目录下，而不是 evidence/runs（所有路径以脚本自身所在目录解析、不依赖 cwd）。
目标文件（绝对路径）：/ws/cal_phone/index.html
本闸具体：
- H1：`sha256sum /ws/cal_phone/index.html`，期望 `26224e9c1c4bd44f228d4a408cd73a7de5048ac99988252c1471e1a10dddda55`；不等即 FAIL。
- H2：`spawnSync("node",["/ws/cal_phone/tests/voice/run.mjs","--json"],{cwd:"/ws/cal_phone",timeout:600000})`。断言文件存在、exit 0、stdout 能被 `JSON.parse` 且是单个对象（若 stdout 有前后噪声则 FAIL，这是接口契约）；`failed===0`、`Array.isArray(checks)`、`checks.length>=24`、每项 `pass===true`；把 `checks.map(c=>c.id)` 按小写前缀 `settings.`、`file.`、`keys.`、`result.`、`independence.`、`queue.`、`layout.`、`regression.` 各匹配至少一次，缺任一即 FAIL。输出 checks 总数与前缀命中表。
- H3：读 `/ws/cal_phone/index.html` 原文，写到 `fs.mkdtempSync` 下的两个文件：A 把 `settings-voice-keys` 全部替换为 `settings-voice-keys-mutant`；B 把 `data-speech-log` 全部替换为 `data-speech-log-mutant`。对每个副本运行 `spawnSync("node",["/ws/cal_phone/tests/voice/run.mjs","--artifact",tmp,"--json"],{cwd:"/ws/cal_phone",timeout:600000})`，断言 status !== 0；若 stdout 可解析为 JSON，额外断言 `failed>0`。两个变异都必须被检出；任一变异常通过即 FAIL。临时文件只放 verifier 的临时目录。
- H4：`spawnSync("node",["/ws/cal_phone/tests/suite.mjs","--json"],{cwd:"/ws/cal_phone/tests",timeout:600000})`，解析 `results`：长度 18、checks 总数 206、每项 `pass===true`。
- H5：`spawnSync("node",["/ws/cal_phone/tests/voice/run.mjs","--help"],{cwd:"/ws/cal_phone"})` 的输出（stdout+stderr）同时含 `--real` 与 `VOICE_REAL`；再以**不设** `VOICE_REAL` 的环境运行 `spawnSync("node",["…/run.mjs","--real"],{cwd:"/ws/cal_phone",timeout:120000})`，断言 status !== 0 且输出含 `VOICE_REAL`。注意不能继承当前 shell 里可能存在的 `VOICE_REAL`，显式构造 env 并删除该键。
- H6：读 `/ws/cal_phone/README.md`，断言同时含 `tests/voice/run.mjs`、`--real`、`VOICE_REAL=1` 三个子串。
phase=first 时把验证逻辑写成脚本 `/ws/cal_phone/Telos/phone-calculator-voice-tests-112108/evidence/verify.mjs`（接受轮号参数）并立即以 `node verify.mjs <round>` 运行；它按上面不变量逐条实测并写 `hard-r<N>.txt`：先写 `ROUND: <N>`、`ARTIFACT_SHA256: <64hex>`、`VERIFIER_SHA256: <64hex>`（脚本自身 sha256），再每条 `H<id> PASS|FAIL — 实测值/证据`，末行**严格** `HARD: PASS` 或 `HARD: FAIL (Hx,…)`。
若 runtime contract 的 `expected_review_states` 非 none：同一脚本还须把每个状态用 Playwright/无头 Chrome 渲染成**非空、非纯色、内容互不重复**的 PNG（≥ 240×160；真 320px 用 CDP `Emulation.setDeviceMetricsOverride`）落 `review-shots/r<N>/S<k>.png`——精确且仅这些文件；把带同样头的可见性/溢出/关键尺寸 `key=value` 实测写 `render-r<N>.txt`；写 `manifest-r<N>.json`：`round`、`artifact_sha256`、`verifier_sha256`、`metrics_sha256`、每张图的 `file/sha256/width/height`、`adhoc: []`。
phase=final 时**禁止读取、运行或修改 verify.mjs / ledger / 旧证据**，在你被启动的隔离 scratch cwd 中重新推导全套检查；临时测量只落当前 scratch 目录，最终回复给出裁决，由 CLI 保存（不要自行写 `-o` 路径）；首行同样是 `ROUND:`、`ARTIFACT_SHA256:`，末行同样严格。
HARD-VERIFY-PROMPT>>>

---

## 5. 运行与停止（命令按需选用，非逐行执行的脚本；停止数字只在 frontmatter）
    # gate=/ws/cal_phone/Telos/phone-calculator-voice-tests-112108 · rendered by kekkai new — do not edit
    kekkai doctor --gate "/ws/cal_phone/Telos/phone-calculator-voice-tests-112108" --host     # before round 1 and after any host change
    kekkai hard "/ws/cal_phone/Telos/phone-calculator-voice-tests-112108"                     # r1: independent author writes evidence/verify.mjs; later rounds replay it
    kekkai adhoc "/ws/cal_phone/Telos/phone-calculator-voice-tests-112108" -- <command…>      # same-round measurement admissible as 误报 basis
    kekkai recast "/ws/cal_phone/Telos/phone-calculator-voice-tests-112108" --reason "<why>"  # sick instrument: quarantine + fresh independent author (≤3 eras)
    kekkai hard "/ws/cal_phone/Telos/phone-calculator-voice-tests-112108" --final             # terminal independent stamp at the stop candidate
    kekkai lint "/ws/cal_phone/Telos/phone-calculator-voice-tests-112108" --post              # after round 1, on recovery, before STOP
    kekkai close "/ws/cal_phone/Telos/phone-calculator-voice-tests-112108" --by <budget|host|instrument|oscillation|human> --blocker "<one sentence>"

- **轮次 = runner 提升进 `evidence/runs/hard-r<N>.txt` 的 canonical 盖章**；其余一切都是尝试（`evidence/attempts/`），不写台账、不占预算、不动 K。轮号由 runner 分配，不要手填；不要手跑 `node verify.mjs` 再拷文件进 runs/（缺 runner 头会被拒绝）。
- **`kekkai hard` 退出码**：`0` 提升为轮；`2` 尝试已归档（先读 `kekkai status --json` 和消息：若该轮已提升但 final 缺失，补 `--final`；否则修因后继续，不盲重跑）；`3` 重复/尝试上限——只有三条合法路：(1) change the business tree, (2) `kekkai recast --reason`, (3) `kekkai close --by <tag>`；`4` 规则拒绝（读消息，别原样重试）。管道故障同一输入有重试上限；无法修复就 `close`，不换措辞/增预算绕过。
- **首个 hard PASS 轮 runner 自动跑审计 final**；final 与量具不一致 ⇒ final 的 FAIL 成立，只能修代码或 `kekkai recast`，永不再跑一次 final 试运气。
- **停止**：`converged` = 最新轮 hard PASS + 当前产物/业务树字节的同 era 独立 final PASS（hard-only 不需要软评或 K 确认轮），且未超 frontmatter `max_rounds`；任何轮数（含 0）都可以 `kekkai close --by <budget|host|instrument|oscillation|human>` 写 blocked 终态并附 `blocker:` 行——绝不把 gate 停在 in-loop 而无 STOP。
- 第 1 轮后、恢复时、写 STOP 前各跑一次 `kekkai lint <本目录> --post`；`POST-IN-PROGRESS` 是运行中的预期警告。

---

## 附录 · 生成器判断记录（可审计的 taste↔structure 边界）
> 让执行者能看懂哪些是「结构强制」、哪些是「生成器的 taste 取舍」。不要复述停止数字（它们只在 frontmatter）。
- 本闸是父闸的补丁闸：只新增 `tests/voice/**` 与 README 说明；artifact 仍绑定 `/ws/cal_phone/index.html` 并用父闸收敛 sha256 证明产品字节未动。
- 没有软闸：本任务只交付测试与文档，不改变用户可见界面。
- 硬闸不运行真实引擎 smoke（§9.2）：96MB 模型、无头音频与耗时属于环境前提；硬闸只要求 `--real` 有 `VOICE_REAL=1` 准入保护，真实 smoke 留给人工/CI 慢测。
- H3 用两个临时变异副本证明套件不是恒 PASS；变异只作用于临时文件，绝不改仓库产物。
- `volatile: ["voice/"]`：真实资源由安装脚本生成且被 `.gitignore` 忽略，不属于本闸交付差异。
- 假引擎与观测属性的契约沿用父闸 §1，不重新设计；执行器应优先从父闸 `evidence/instruments/*verify*.mjs` 迁移检查逻辑，而不是再从零摸索。
