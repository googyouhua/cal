---
# ── Kekkai Goal Gate v4 · frontmatter（唯一机读区；停止数字只在这里；矩阵/不变量内容只在正文表格）──
slug: phone-calculator-voice-number-only-112109
version: 4
model_profile: astra-flash-3.8-v1  # 新任务冻结模型组合；执行中不可修改
status: converged                  # draft | in-loop | converged（blocked 终态保持 in-loop）
repo: /ws/cal_phone
artifact: /ws/cal_phone/index.html
# artifact_kind: url | app | service   # 仅 artifact: null 时启用；此时 ARTIFACT_SHA256 := TREE_SHA256
parent_gate: /ws/cal_phone/Telos/phone-calculator-voice-announcements-112105/GOAL.md                  # 子闸填父 GOAL.md 绝对路径；只继承 round-0 决策，不继承证据或 verify.mjs
verifiers:
  hard: codex exec                 # 固定驱动器；pin 与访问标志在 bin/runner.mjs（docs/RUNNER.md）
  soft: null
stop:
  max_rounds: 6
hard_invariants: [H1, H2, H3, H4, H5]
volatile: ["voice/"]               # TREE_SHA256 排除的仓库相对路径（构建产物、日志等）；空数组即可
---

# Kekkai Goal Gate · 语音播报改为「只说数字」：结果去掉前缀、确认念出数字

> **运行指令**：你是执行者（Codex / Claude Code / ZCode / Cursor 之一，由 handoff 指定；生成本 gate 的那次调用不得兼任）。
> 开跑前先 `kekkai doctor --gate <本目录> --host`；只有 `requires_display: true` 的真实桌面测量依赖解锁与屏幕权限，普通无头浏览器/逻辑测量不占屏。
> 读**本文件全文** + 同目录 [`./ledger.md`](./ledger.md)（决策台账），然后只用 §5 的命令块驱动验收，直到 §5 的停止条件；在已授权范围内自主推进，缺少外部输入时写明 blocked 与恢复条件。
> 生命周期编辑是唯一允许的 GOAL 改动：第 1 轮前 `status: draft → in-loop`；写 `converged` STOP 前 → `status: converged`；blocked 终态保持 `in-loop`。
> 除此之外 GOAL.md 只读：不改 frontmatter 数字、不改 prompt、不改变 §5 命令的操作、目标路径和关键参数（注释与空白不影响验收）。
> 教义在 Kekkai skill 的 `docs/CREED.md`、runner 契约在该 skill 的 `docs/RUNNER.md`——本文件不复述它们；`kekkai hard/soft` 的退出码与消息就是你的下一步。

## 1. 目标（一句话 + 背景 + 实施指导）
把语音播报从「结果 十八点七」「确认」改成「十八点七」「九十五」：**结果播报不再说“结果”前缀，只念数字本身；按“确认”（含自动确认）不再说“确认”，改为念出刚收下的那笔数字**。除此之外按键词、除零提示、开关独立性、队列与所有界面文案保持不变——用户要的是耳朵里只听到数字，屏幕上的“确认”“结果”照旧。

**实施指导**：
在 `/ws/cal_phone/index.html` 现有语音模块上做最小改动。结果播报处（`calculate()` 成功分支）把 `speakResult(\`结果 ${reading}\`)` 改为 `speakResult(reading)`；`reading` 为空时仍不播。确认播报处（`commitInput()` 成功分支，含手动确认、物理回车、自动确认、编辑草稿追加）把 `speakKey("确认")` 改为播报刚提交数字的 `numberToChineseReading(rawValue)`（用规范化后的值；转换失败则不播，避免念错）。自动确认仍等同于确认，因此播 `确认` 的位置全部换成该笔数字。除零仍播「不能除以零」，不加任何前缀。不要改 `numberToChineseReading` 的算法、不要改 0–9/点/退格/加减乘除的按键词、不要动 `data-speech-*` 的字段结构、不要改界面标签与计算/历史/编辑/设置语义。更新 `/ws/cal_phone/tests/voice/run.mjs` 的期望文本（含 `--real` 分支里的 `结果 九十五`），并保持既有 `tests/suite.mjs` 18 场景 / 206 检查全绿。

> 外部前提（账号、服务、人工决定、设备权限）应在实施指导中明确；缺失时保留证据并 blocked，不把无法由代码修复的条件塞进硬不变量反复重跑。
> 本闸只覆盖假引擎的文本与队列行为、仓库内测试更新和既有回归；真实引擎出声与目标手机听音仍是闸外人工步骤。当前本机 Codex 判官通道可能受供应商地区限制影响；若 `kekkai hard` 因 403 无法启动独立验收，按 §5 记录 blocked by=host，不要把服务端错误伪装成代码 FAIL。

## 2. 不变约束（父级红线 · 任何修改不得破坏）
> 每条红线**必须标注归属**：`[H#]`（由该硬不变量机检）或 `[soft-only: 原因]`（只能主观把关，写明为何无法机检）。绝对不能改的代码块优先给 sha256 机检形式。不允许留下既非 `[H#]` 也非 `[soft-only]` 的悬空红线。
- 任何结果播报都不再包含「结果」二字；成功结果只念中文数字本身（含负数、小数、自动等号、直接等号） [H1]
- 除零仍只播「不能除以零」，不加前缀；`-0` 仍念「零」 [H1]
- 任何按键播报都不再说「确认」；确认（手动、物理回车、自动确认、编辑草稿追加）改念刚收下的那笔数字 [H2]
- 空确认、空退格、被忽略的重复小数点、`=` 本身仍不产生按键播报；数字 0–9、点、退格、加减乘除的按键词保持不变 [H3]
- 两个开关的独立性、串行队列、旧结果丢弃、关闭开关清理排队等父闸语义不变 [H4]
- 界面文案、按钮标签、设置面板、计算/历史/编辑/自动确认/基数语义不变；`[data-testid="enter"]` 仍显示「确认」，屏幕结果仍显示 `18.7` [H5]
- 仓库内 `tests/voice/run.mjs` 必须同步更新并通过；既有 `tests/suite.mjs` 18 场景 / 206 检查必须全绿 [H5]

> 允许改动的范围豁免写在下面的定界块里（runner 会把它**逐字**内联进 first / recast / final 验收器的 runtime contract，避免首轮判合规、末轮判违规的判定分裂）。没有豁免就写 `无`。

<<<SCOPE-EXEMPTIONS
允许改动：/ws/cal_phone/index.html 的语音播报文本与确认播报实现；/ws/cal_phone/tests/voice/run.mjs 的期望文本与真实分支断言。不允许修改计算、历史、编辑、自动确认、基数、设置面板、按键标签、`numberToChineseReading` 算法、`data-speech-*` 字段结构或既有 tests/suite.mjs、tests/scenarios/**、tests/lib/**、scripts/**、deploy/**。
SCOPE-EXEMPTIONS>>>

---

## 3. 硬目标（独立确定性验收 · 硬闸 · codex exec）

**输入矩阵（采样覆盖；含边界与「哪些算、哪些拒答」）：**
- 开关组合 ∈ {仅结果, 仅按键, 两者都开, 都关}
- 结果样本 ∈ {9.5+9.2=18.7, 2−5=−3, 1÷0 错误, 3+4 自动等号, 7+8= 直接等号, 95+0=95}
- 确认样本 ∈ {两位整数 95, 小数 0.5, 单个数字 9, 自动确认 0.2s 的 6, 物理回车 7, 空确认}
- 其他按键 ∈ {9,5,点,重复点,退格删字符,退格撤回一笔,空退格,+,-,*,/}
- 队列 ∈ {快速 1,2,3, 结果排在按键后且新按键丢弃未开口结果, 结果替换}
- 回归 ∈ {仓库内 tests/voice 套件, 既有 18/206 套件}

**稳定测试入口：** 假引擎契约沿用父闸（`window.SherpaOnnx`、`window.createOfflineTts`、`window.__voiceFake`，每句 400ms）；观测属性 `data-speech-log`、`data-speech-played`、`data-speech-last`、`data-speech-kind`、`data-speech-count`、`data-voice-state`；现有 `[data-key]`、`[data-op]`、`[data-testid="enter"]`、`[data-testid="result"]`、`settings-voice-keys`、`settings-voice-result`；仓库入口 `/ws/cal_phone/tests/voice/run.mjs` 与 `/ws/cal_phone/tests/suite.mjs`。

**不变量：**

| # | 不变量 | 硬闸怎么验（须真跑，非读源码目测） | 阈值 |
|---|---|---|---|
| H1 | 结果播报只说数字，无「结果」前缀；除零文案不变 | 假引擎就绪、仅开结果：① 9.5+9.2=；② 2−5=；③ 1÷0=；④ 设置 autoEquals=2 后 3+4（输入后自动计算）；⑤ 7+8= 不按确认直接等号；⑥ 95+0=。逐步读 `data-speech-log` 的 text/kind 与 `data-speech-last` | 依次为 `十八点七`、`负三`、`不能除以零`、`七`、`十五`、`九十五`；任何一条都不含「结果」；⑤ 无 `确认`；kind 均为 `result` |
| H2 | 确认改念刚收下的数字，不再说「确认」 | 假引擎就绪、仅开按键：① 9,5,确认；② 0,.,5,确认；③ 预置 autoConfirm=0.2 后输入 6 等 500ms；④ 物理键盘 7,Enter；⑤ 空输入按确认。解析 `data-speech-log` 与 `data-speech-count` | ① 九,五,九十五；② 零,点,五,零点五；③ 六,六；④ 七,七；⑤ 不新增；全部无 `确认` |
| H3 | 其他按键词与静默规则不变 | 仅开按键依次 9,5,.,.,退格,确认,确认,退格,退格,+,-,*,/=；检查 text 序列、count、last | 序列精确为 九,五,点,退格,九十五,退格,加,减,乘,除（10 条）；重复点/空确认/空退格/`=` 无记录；`[data-testid="enter"]` 文案仍为「确认」 |
| H4 | 开关独立、队列与打断语义不变 | ① 仅结果 1+2=：无 key 记录，last `三`；② 仅按键 1+2=：仅 一,加,二，无 result，屏幕结果 `3`；③ 两开关都开，1+1= 后立即点 9：played 无任何 result，按键照播；④ 都关：任意操作后 count 不增 | 四种组合均成立 |
| H5 | 仓库测试已同步且既有回归全绿，界面标签未改 | ① `node /ws/cal_phone/tests/voice/run.mjs --json`：exit 0、failed=0、checks ≥24；② `node /ws/cal_phone/tests/suite.mjs --json`：18 场景、206 检查、0 失败；③ 读 `/ws/cal_phone/tests/voice/run.mjs` 源：不得再出现 `结果 九十五` 期望，必须含 `九十五`；④ 9.5+9.2= 后结果区文本仍为 `18.7` | ① ② ③ ④ 全部成立 |

<<<HARD-VERIFY-PROMPT
你是确定性验收器。**不要评价 UI 美观、不要改产物源码。**本 prompt 会被单独抽取喂给你（读不到 frontmatter 与上表），所以下面所有文件都写**绝对路径**、基线写 **sha256 值**；runner 会在其后追加 `[RUNTIME CONTRACT]`（round / phase / gate_dir / evidence_dir / out_dir / artifact_sha256 / expected_review_states / SCOPE-EXEMPTIONS 原文），以它为准。
按本闸输入矩阵 / 不变量逐条**实际执行**验证：优先复用已有测试入口，逻辑用 Node 调用函数并断言返回值/异常；界面用 Playwright/jsdom 操控稳定选择器并读值。基线只用于本任务明确要求不可更改的范围，不能自行冻结整个源码或妨碍授权修复。采用项目已有工具与依赖；缺依赖或设备时明确拒答，不能伪装成代码 FAIL。禁止用主观语言/肉眼通读代替实测证据。
量具卫生（三条，写量具时逐条自查）：① 不得含写死的恒 FAIL/恒 PASS 常量判据；② 扫描类不变量的扫描面必须与 §3 声明逐字一致、不得自行扩张，且**不得包含 evidence/ 或 evidence/runs/**（自引用扫描面一旦被本循环必写的证据污染就永远翻不了绿）；③ 断言锚定稳定选择器/数据钩子而非用户可见文案原文（本闸的播报文本是功能输出，必须精确断言）；子进程/步骤超时 ≥ 单次实测耗时的 2 倍。
量具接口（两条，runner 靠它做变异检查与尝试隔离，缺一即拒绝提升）：① 环境变量 `KEKKAI_ARTIFACT` 存在时用它覆盖目标文件路径；② `KEKKAI_OUT_DIR` 存在时，`hard-r<N>.txt` / `render-r<N>.txt` / `manifest-r<N>.json` / `review-shots/r<N>/` 全部写到该目录下，而不是 evidence/runs（所有路径以脚本自身所在目录解析、不依赖 cwd）。
目标文件（绝对路径）：/ws/cal_phone/index.html
本闸具体：
- 测试环境：Node 22、Playwright 1.64.0 位于 `/ws/cal_phone/tests/node_modules`（createRequire 绝对路径加载）；Chromium 已缓存。自己起普通 HTTP 静态服务器（不要用 `file://`），对 `/voice/**` 返回小占位文件；假引擎注入（addInitScript）：`window.__voiceFake={fail:false,durationMs:400}`；`window.SherpaOnnx=async()=>({FS:{mkdirTree(){},FS_createDataFile(){},writeFile(){}}})`；`window.createOfflineTts=()=>({handle:1,generate:()=>{const n=Math.round(22050*window.__voiceFake.durationMs/1000);const a=new Float32Array(n);for(let i=0;i<n;i++)a[i]=Math.sin(i/20)*0.05;return {samples:a,sampleRate:22050};}})`；若页面仍注入 `/voice/sherpa-onnx-wasm-web.js` 与 `/voice/sherpa-onnx-tts.js`，服务器返回定义同样全局的 stub。
- H1：仅开结果（`voiceKeys:false, voiceResult:true`），等 `data-voice-state=ready`。① 点 9,.,5,+,9,.,2,=，读 `[data-testid="result"]` 文本与 `data-speech-log`，期望结果 `18.7`、最后 speech text `十八点七`、kind `result`、整条日志不含 `结果`；② 点 2,-,5,=，最后 `负三`；③ 点 1,/,0,=，结果文本 `不能除以零`，最后 `不能除以零`；④ 设置 autoEquals=2 后点 3,+,4,确认，最后 `七`；⑤ 新页面点 7,+,8,=，最后 `十五` 且日志无 `确认`；⑥ 新页面点 9,5,+,0,=，最后 `九十五`。每条都断言 `data-speech-last` 与日志末条一致。
- H2：仅开按键（`voiceKeys:true, voiceResult:false`），ready。① 点 9,5,确认（`[data-key="enter"]`）：`data-speech-log` 的 text 序列为 `["九","五","九十五"]`，`data-speech-last` 为 `九十五`；② 新页面点 0,.,5,确认：`["零","点","五","零点五"]`；③ 新页面预置 `autoConfirm:0.2`，点 6 等 500ms：`["六","六"]`；④ 新页面物理键盘 `7`、`Enter`：`["七","七"]`；⑤ 新页面空输入点确认：count 不增。所有日志不得含 `确认`。
- H3：仅开按键，依次点 9,5,.,.,`backspace`,`enter`,`enter`,`backspace`,`backspace`,`[data-op="+"]`,`-`,`*`,`/`,`equals`；期望 text 序列 `["九","五","点","退格","九十五","退格","加","减","乘","除"]`、count=10、last=`除`；断言 `[data-testid="enter"]` 的 textContent trim === `确认`。
- H4：① 仅结果 1,+,2,=：log 中无 kind==="key"，last `三`；② 仅按键 1,+,2,=：texts `["一","加","二"]`，无 kind==="result"，结果区 `3`；③ 两开关都开：快速点 1,+,1,=,9，等 4s，`data-speech-played` 中无任何 kind==="result" 且含按键；④ 都关：1,+,2,= 后 `data-speech-count` 为 0 或空。
- H5：① `spawnSync("node",["/ws/cal_phone/tests/voice/run.mjs","--json"],{cwd:"/ws/cal_phone",timeout:600000})`：exit 0，stdout 解析为 JSON，`failed===0`、`checks.length>=24`、每项 pass；② `spawnSync("node",["/ws/cal_phone/tests/suite.mjs","--json"],{cwd:"/ws/cal_phone/tests",timeout:600000})`：18 场景、206 检查、全 pass；③ 读 `/ws/cal_phone/tests/voice/run.mjs`，断言不含子串 `结果 九十五` 且含 `九十五`；④ 在 H1 的 9.5+9.2= 页面读 `[data-testid="result"]` 文本 === `18.7`。
phase=first 时把验证逻辑写成脚本 `/ws/cal_phone/Telos/phone-calculator-voice-number-only-112109/evidence/verify.mjs`（接受轮号参数）并立即以 `node verify.mjs <round>` 运行；它按上面不变量逐条实测并写 `hard-r<N>.txt`：先写 `ROUND: <N>`、`ARTIFACT_SHA256: <64hex>`、`VERIFIER_SHA256: <64hex>`（脚本自身 sha256），再每条 `H<id> PASS|FAIL — 实测值/证据`，末行**严格** `HARD: PASS` 或 `HARD: FAIL (Hx,…)`。
若 runtime contract 的 `expected_review_states` 非 none：同一脚本还须把每个状态用 Playwright/无头 Chrome 渲染成**非空、非纯色、内容互不重复**的 PNG（≥ 240×160；真 320px 用 CDP `Emulation.setDeviceMetricsOverride`）落 `review-shots/r<N>/S<k>.png`——精确且仅这些文件；把带同样头的可见性/溢出/关键尺寸 `key=value` 实测写 `render-r<N>.txt`；写 `manifest-r<N>.json`：`round`、`artifact_sha256`、`verifier_sha256`、`metrics_sha256`、每张图的 `file/sha256/width/height`、`adhoc: []`。
phase=final 时**禁止读取、运行或修改 verify.mjs / ledger / 旧证据**，在你被启动的隔离 scratch cwd 中重新推导全套检查；临时测量只落当前 scratch 目录，最终回复给出裁决，由 CLI 保存（不要自行写 `-o` 路径）；首行同样是 `ROUND:`、`ARTIFACT_SHA256:`，末行同样严格。
HARD-VERIFY-PROMPT>>>

---

## 5. 运行与停止（命令按需选用，非逐行执行的脚本；停止数字只在 frontmatter）
    # gate=/ws/cal_phone/Telos/phone-calculator-voice-number-only-112109 · rendered by kekkai new — do not edit
    kekkai doctor --gate "/ws/cal_phone/Telos/phone-calculator-voice-number-only-112109" --host     # before round 1 and after any host change
    kekkai hard "/ws/cal_phone/Telos/phone-calculator-voice-number-only-112109"                     # r1: independent author writes evidence/verify.mjs; later rounds replay it
    kekkai adhoc "/ws/cal_phone/Telos/phone-calculator-voice-number-only-112109" -- <command…>      # same-round measurement admissible as 误报 basis
    kekkai recast "/ws/cal_phone/Telos/phone-calculator-voice-number-only-112109" --reason "<why>"  # sick instrument: quarantine + fresh independent author (≤3 eras)
    kekkai hard "/ws/cal_phone/Telos/phone-calculator-voice-number-only-112109" --final             # terminal independent stamp at the stop candidate
    kekkai lint "/ws/cal_phone/Telos/phone-calculator-voice-number-only-112109" --post              # after round 1, on recovery, before STOP
    kekkai close "/ws/cal_phone/Telos/phone-calculator-voice-number-only-112109" --by <budget|host|instrument|oscillation|human> --blocker "<one sentence>"

- **轮次 = runner 提升进 `evidence/runs/hard-r<N>.txt` 的 canonical 盖章**；其余一切都是尝试（`evidence/attempts/`），不写台账、不占预算、不动 K。轮号由 runner 分配，不要手填；不要手跑 `node verify.mjs` 再拷文件进 runs/（缺 runner 头会被拒绝）。
- **`kekkai hard` 退出码**：`0` 提升为轮；`2` 尝试已归档（先读 `kekkai status --json` 和消息：若该轮已提升但 final 缺失，补 `--final`；否则修因后继续，不盲重跑）；`3` 重复/尝试上限——只有三条合法路：(1) change the business tree, (2) `kekkai recast --reason`, (3) `kekkai close --by <tag>`；`4` 规则拒绝（读消息，别原样重试）。管道故障同一输入有重试上限；无法修复就 `close`，不换措辞/增预算绕过。
- **首个 hard PASS 轮 runner 自动跑审计 final**；final 与量具不一致 ⇒ final 的 FAIL 成立，只能修代码或 `kekkai recast`，永不再跑一次 final 试运气。
- **停止**：`converged` = 最新轮 hard PASS + 当前产物/业务树字节的同 era 独立 final PASS（hard-only 不需要软评或 K 确认轮），且未超 frontmatter `max_rounds`；任何轮数（含 0）都可以 `kekkai close --by <budget|host|instrument|oscillation|human>` 写 blocked 终态并附 `blocker:` 行——绝不把 gate 停在 in-loop 而无 STOP。
- 第 1 轮后、恢复时、写 STOP 前各跑一次 `kekkai lint <本目录> --post`；`POST-IN-PROGRESS` 是运行中的预期警告。

---

## 附录 · 生成器判断记录（可审计的 taste↔structure 边界）
- 这是父闸的语音文案补丁：只改播报文本，不改任何界面标签、计算或队列语义；因此用 hard-only，不加软闸。
- 确认播报改为数字后，多位数需要按需合成；硬闸用假引擎只验收文本与队列，真实合成延迟由父闸的加载/缓存机制承接，不新增性能阈值。
- 结果与确认的文本是功能输出，必须精确断言；软闸不存在，所以不会与文案评审冲突。
- `volatile: ["voice/"]`：真实资源由安装脚本生成且被 `.gitignore` 忽略，不属于本闸交付差异。
- 当前本机 Codex 判官通道存在供应商 403（地区限制）风险；若执行时仍不可用，按 §5 `kekkai close --by host` 记录 blocker，不在闸内改 profile 或换判官。
