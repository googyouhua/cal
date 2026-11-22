---
# ── Kekkai Goal Gate v4 · frontmatter（唯一机读区；停止数字只在这里；矩阵/不变量内容只在正文表格）──
slug: phone-calculator-voice-double-announcement-112111
version: 4
model_profile: astra-flash-3.8-v1  # 新任务冻结模型组合；执行中不可修改
status: converged                   # draft | in-loop | converged（blocked 终态保持 in-loop）
repo: /ws/cal_phone-worktrees/voice-double-announcement
artifact: /ws/cal_phone-worktrees/voice-double-announcement/index.html
# artifact_kind: url | app | service   # 仅 artifact: null 时启用；此时 ARTIFACT_SHA256 := TREE_SHA256
parent_gate: /ws/cal_phone/Telos/phone-calculator-voice-number-only-112109/GOAL.md                  # 子闸填父 GOAL.md 绝对路径；只继承 round-0 决策，不继承证据或 verify.mjs
verifiers:
  hard: codex exec                 # 固定驱动器；pin 与访问标志在 bin/runner.mjs（docs/RUNNER.md）
  soft: null
stop:
  max_rounds: 6
hard_invariants: [H1, H2, H3, H4, H5]
volatile: ["voice/"]               # TREE_SHA256 排除的仓库相对路径（构建产物、日志等）；空数组即可
---

# Kekkai Goal Gate · 按键播报每次恰好一次：确认/自动确认收笔静音

> **运行指令**：你是执行者（Codex / Claude Code / ZCode / Cursor 之一，由 handoff 指定；生成本 gate 的那次调用不得兼任）。
> 开跑前先 `kekkai doctor --gate <本目录> --host`；只有 `requires_display: true` 的真实桌面测量依赖解锁与屏幕权限，普通无头浏览器/逻辑测量不占屏。
> 读**本文件全文** + 同目录 [`./ledger.md`](./ledger.md)（决策台账），然后只用 §5 的命令块驱动验收，直到 §5 的停止条件；在已授权范围内自主推进，缺少外部输入时写明 blocked 与恢复条件。
> 生命周期编辑是唯一允许的 GOAL 改动：第 1 轮前 `status: draft → in-loop`；写 `converged` STOP 前 → `status: converged`；blocked 终态保持 `in-loop`。
> 除此之外 GOAL.md 只读：不改 frontmatter 数字、不改 prompt、不改变 §5 命令的操作、目标路径和关键参数（注释与空白不影响验收）。
> 教义在 Kekkai skill 的 `docs/CREED.md`、runner 契约在该 skill 的 `docs/RUNNER.md`——本文件不复述它们；`kekkai hard/soft` 的退出码与消息就是你的下一步。

## 1. 目标（一句话 + 背景 + 实施指导）
把按键播报从“每次收笔又念一遍刚输入的数字”修成“每个真实按键只响一次、收笔完全静音”：现状下按 `5` 再按确认会播两遍「五」，自动确认（如 0.2s）输入 `6` 会播两遍「六」；修复后这两种操作都只播一遍，用户不会再以为按键被重复触发。

**实施指导**：
在 `/ws/cal_phone-worktrees/voice-double-announcement/index.html` 的语音模块上做最小改动：`commitInput()` 成功收笔时不再调用 `speakKey(numberToChineseReading(rawValue))`（手动确认、物理回车、自动确认、编辑草稿追加都走同一个收笔路径，全部静音），删除该播报分支或将其置为无操作即可；不要用“只念一次”的去重状态机，也不要吞掉同一数字的连续两次真实按键。结果播报（`calculate()` 成功与除零）、按键词表、队列/丢弃语义、`data-speech-*` 观测属性全部保持不变。同步更新 `/ws/cal_phone-worktrees/voice-double-announcement/tests/voice/run.mjs` 中依赖旧行为的期望（`keys.sequence` 不再含 `九十五`、`keys.count` 相应减少、`keys.physical-keyboard` 末尾不再有第二个 `八`、`keys.auto-confirm` 只剩 `六`），并保持 `node /ws/cal_phone-worktrees/voice-double-announcement/tests/suite.mjs --json` 的 18 场景 / 206 检查全绿。这是 worktree 分支上的独立修复，不改主工作区。

> 外部前提（账号、服务、人工决定、设备权限）应在实施指导中明确；缺失时保留证据并 blocked，不把无法由代码修复的条件塞进硬不变量反复重跑。

## 2. 不变约束（父级红线 · 任何修改不得破坏）
> 每条红线**必须标注归属**：`[H#]`（由该硬不变量机检）或 `[soft-only: 原因]`（只能主观把关，写明为何无法机检）。绝对不能改的代码块优先给 sha256 机检形式。不允许留下既非 `[H#]` 也非 `[soft-only]` 的悬空红线。
- 收笔（虚拟「确认」、物理回车、自动确认、编辑草稿追加）不得产生任何播报，尤其不得重复念刚输入的数字 [H1]
- 每个成功按键动作（0–9、小数点、退格、`+ - * /`）恰好产生一次对应播报；同一数字连续按两次仍播两次（不得去重） [H2]
- 重复小数点、空确认、空退格、单独按 `=`（按键播报开启、结果播报关闭）不产生按键播报 [H2]
- 结果播报文本保持“只念数字、无「结果」前缀”：`十八点七`、`负三`、`十五`；除零仍播「不能除以零」 [H3]
- 两个开关独立、同一时刻只播一条、串行队列、旧结果被新按键丢弃、关闭开关清理排队等父闸语义不变 [H4]
- 计算/历史/编辑/自动确认/基数语义、界面文案与按钮标签、`data-speech-*` 字段结构、`numberToChineseReading` 算法、按键词表不变 [H5]
- 仓库内 `tests/voice/run.mjs` 的期望已同步并通过；既有 `tests/suite.mjs` 18 场景 / 206 检查全绿 [H5]

> 允许改动的范围豁免写在下面的定界块里（runner 会把它**逐字**内联进 first / recast / final 验收器的 runtime contract，避免首轮判合规、末轮判违规的判定分裂）。没有豁免就写 `无`。

<<<SCOPE-EXEMPTIONS
允许改动：/ws/cal_phone-worktrees/voice-double-announcement/index.html 的收笔播报实现（commitInput 的播报分支）；/ws/cal_phone-worktrees/voice-double-announcement/tests/voice/run.mjs 的期望文本与假引擎断言。不允许修改：numberToChineseReading 算法、KEY_SPEECH 按键词、结果播报文本、队列/丢弃结构、`data-speech-*` 字段结构、界面标签、计算/历史/编辑/自动确认/基数语义、tests/suite.mjs、tests/scenarios/**、tests/lib/**、scripts/**、deploy/**。
SCOPE-EXEMPTIONS>>>

---

## 3. 硬目标（独立确定性验收 · 硬闸 · codex exec）

**输入矩阵（采样覆盖；含边界与「哪些算、哪些拒答」）：**
- 开关组合 ∈ {仅按键, 仅结果, 两者都开, 都关}
- 收笔方式 ∈ {虚拟确认按钮, 物理回车, 自动确认 0.2s, 空确认}
- 按键 ∈ {0–9 全量, 小数点, 重复小数点, 退格删字符, 退格撤回一笔, 空退格, `+`, `-`, `*`, `/`, `=`}
- 结果样本 ∈ {1+2=3, 9.5+9.2=18.7, 2−5=−3, 1÷0 除零, 自动等号 3+4}
- 队列 ∈ {快速 1,2,3 串行, 结果排在按键后且新按键丢弃未开口结果}
- 回归 ∈ {仓库内 tests/voice 假引擎套件, 既有 tests/suite.mjs 18/206}
- 静默（预期不产生播报）：重复小数点、空确认、空退格、仅开按键时的单独 `=`；未知按键不处理、不播报。

**稳定测试入口：** 被测文件 `/ws/cal_phone-worktrees/voice-double-announcement/index.html`；假引擎契约（`window.SherpaOnnx`、`window.createOfflineTts`、`window.__voiceFake`、每句 400ms）与页面观察属性 `main.app` 的 `data-voice-state`、`data-speech-log`、`data-speech-played`、`data-speech-count`、`data-speech-last`、`data-speech-kind`；稳定选择器 `[data-key="0..9"]`、`[data-key="."]`、`[data-key="backspace"]`、`[data-testid="enter"]`、`[data-testid="key-equals"]`、`[data-op="+|-|*|/"]`、`settings-voice-keys`、`settings-voice-result`、`settings-auto-confirm`、`settings-auto-equals`、`[data-testid="result"]`；仓库入口 `/ws/cal_phone-worktrees/voice-double-announcement/tests/voice/run.mjs` 与 `/ws/cal_phone-worktrees/voice-double-announcement/tests/suite.mjs`。

**不变量：**

| # | 不变量 | 硬闸怎么验（须真跑，非读源码目测） | 阈值 |
|---|---|---|---|
| H1 | 收笔静音：确认与自动确认不再重复念数字 | 假引擎就绪、设置 `{voiceKeys:true, voiceResult:false}`：① 点 5、点确认，等 2.5s；② 依次点 9,5、点确认，等 2.5s；③ 预置 `autoConfirm:0.2` 后点 6，等 2.5s；④ 物理键盘按 `7`、`Enter`，等 2.5s；⑤ 两开关都开时 9,5,确认。每步读 `data-speech-log`、`data-speech-played`、`data-speech-count` | ① log/played 均为 `["五"]`、count=`1`；② 均为 `["九","五"]`、count=`2`；③ 均为 `["六"]`、count=`1`；④ 均为 `["七"]`、count=`1`；⑤ 按键 text 为 `["九","五"]` 且无 `result`；所有场景收笔后 count 不再增长，played 条数 = log 条数 |
| H2 | 每个真实按键恰好一次；静默边界不播；连续同键不去重 | 仅开按键：① 依次点 0,1,2,3,4,5,6,7,8,9；② 点 5,.,.,7；③ 点 5,退格,退格；④ 点 5,5；⑤ 点 `+,-,*,/`；⑥ 点 1,+,2,=；⑦ 点 5、确认、退格、退格（撤回一笔后空退格）。每次等播放稳定后读 log/played/count | ① text 为 `零,一,二,三,四,五,六,七,八,九` 共 10 条；② `五,点,七`；③ `五,退格`；④ `五,五`（不去重）；⑤ `加,减,乘,除`；⑥ 无新增（`=` 不播）；⑦ `五,退格`（确认静默、撤回播一次、第二次空退格静默）；所有场景 kind 均为 `key` 且无 `result` |
| H3 | 结果播报与除零文案不变 | 仅开结果：① 1,+,2,=；② 9,.,5,+,9,.,2,=；③ 2,−,5,=；④ 1,÷,0,=；两开关都开：⑤ 1,+,2,=。读 log/played 的 text/kind 与结果区 | ① 无 key 记录，最后一条 `三`、kind=`result`；② 结果区 `18.7`、最后一条 `十八点七`；③ 结果区 `-3`、最后一条 `负三`；④ 结果区与最后一条均为 `不能除以零`；⑤ key 文本 `一,加,二` 后跟 result `三`；全部 text 不含「结果」二字 |
| H4 | 开关独立、串行队列与结果丢弃不变 | ① 都关：1,+,2,= 后 count 为 0 或空；② 仅结果：1,+,2= 无 key 记录；③ 仅按键快速点 1,2,3（首尾 <1.5s），轮询 played 至 3 条或 5s；④ 两开关都开快速点 1,+,1,=,9，等 4s | ① count `0`/空；② kind 集合仅 `result`；③ played 顺序恰为 `一,二,三`；④ played 中无任何 `kind:"result"`，按键为 `一,加,一,九` |
| H5 | 屏幕与计算语义不变；仓库测试已同步且全绿 | ① `node /ws/cal_phone-worktrees/voice-double-announcement/tests/voice/run.mjs --json`：exit 0 且 `failed===0`；② `node /ws/cal_phone-worktrees/voice-double-announcement/tests/suite.mjs --json`：exit 0、18 场景、206 检查、0 失败；③ 1,+,2,= 结果区为 `3`；④ `[data-testid="enter"]` 文本仍为「确认」，`data-speech-log` 仍为 `{kind,text}` JSON 数组；⑤ 自动确认 0.2s 点 6 后表达式区包含 `6`（收笔确实发生） | ① passed 数 ≥ 70 且 failed=0；② 三数精确匹配；③④⑤ 全部成立 |

<<<HARD-VERIFY-PROMPT
你是确定性验收器。**不要评价 UI 美观、不要改产物源码。**本 prompt 会被单独抽取喂给你（读不到 frontmatter 与上表），所以下面所有文件都写**绝对路径**、基线写 **sha256 值**；runner 会在其后追加 `[RUNTIME CONTRACT]`（round / phase / gate_dir / evidence_dir / out_dir / artifact_sha256 / expected_review_states / SCOPE-EXEMPTIONS 原文），以它为准。
按本闸输入矩阵 / 不变量逐条**实际执行**验证：优先复用已有测试入口，逻辑用 Node 调用函数并断言返回值/异常；界面用 Playwright/jsdom 操控稳定选择器并读值。基线只用于本任务明确要求不可更改的范围，不能自行冻结整个源码或妨碍授权修复。采用项目已有工具与依赖；缺依赖或设备时明确拒答，不能伪装成代码 FAIL。禁止用主观语言/肉眼通读代替实测证据。
量具卫生（三条，写量具时逐条自查）：① 不得含写死的恒 FAIL/恒 PASS 常量判据；② 扫描类不变量的扫描面必须与 §3 声明逐字一致、不得自行扩张，且**不得包含 evidence/ 或 evidence/runs/**（自引用扫描面一旦被本循环必写的证据污染就永远翻不了绿）；③ 断言锚定稳定选择器/数据钩子而非用户可见文案原文（软闸可能正当地要求改文案）；子进程/步骤超时 ≥ 单次实测耗时的 2 倍。
量具接口（两条，runner 靠它做变异检查与尝试隔离，缺一即拒绝提升）：① 环境变量 `KEKKAI_ARTIFACT` 存在时用它覆盖目标文件路径；② `KEKKAI_OUT_DIR` 存在时，`hard-r<N>.txt` / `render-r<N>.txt` / `manifest-r<N>.json` / `review-shots/r<N>/` 全部写到该目录下，而不是 evidence/runs（所有路径以脚本自身所在目录解析、不依赖 cwd）。
目标文件（绝对路径）：/ws/cal_phone-worktrees/voice-double-announcement/index.html
本闸具体：全部 Playwright 场景必须把 `process.env.KEKKAI_ARTIFACT || "/ws/cal_phone-worktrees/voice-double-announcement/index.html"` 作为被测 HTML，经本地 HTTP 提供（`/voice/**` 返回小占位文件；注入假引擎，绝不依赖 96MB 真实模型）。Playwright 从 `/ws/cal_phone-worktrees/voice-double-announcement/tests/node_modules` 解析（可用 `createRequire("/ws/cal_phone-worktrees/voice-double-announcement/tests/voice/run.mjs")` 后 `require("playwright")`，或设置 `NODE_PATH`）。假引擎注入契约与 `/ws/cal_phone-worktrees/voice-double-announcement/tests/voice/run.mjs` 一致：`localStorage["cal-phone.settings.v1"] = JSON.stringify({autoConfirm, autoEquals, baseEnabled:false, baseText:"0", voiceKeys, voiceResult})`；`window.SherpaOnnx`、`window.createOfflineTts` 返回 `{handle:1, sampleRate:22050, generate(){…}}`；假 `AudioContext`/`webkitAudioContext` 每句 400ms；页面就绪以 `main.app` 的 `data-voice-state="ready"` 为准；每步操作后等待 `data-speech-played` 达到期望条数（最多 8s）再读，读取 `JSON.parse(app.dataset.speechLog || "[]")`、`JSON.parse(app.dataset.speechPlayed || "[]")` 与 `app.dataset.speechCount`。
逐条：
- H1 收笔静音：① 仅按键，点 `[data-key="5"]` 后点 `[data-testid="enter"]`，等 2.5s：log 与 played 的 text 均必须恰为 `["五"]`，count=`"1"`；② 仅按键，点 9、5、确认：均恰为 `["九","五"]`，count=`"2"`；③ 设置 `autoConfirm:0.2, voiceKeys:true`，点 `[data-key="6"]`，等 2.5s：均恰为 `["六"]`，count=`"1"`；④ 仅按键，物理键盘 `page.keyboard.press("7")`、`press("Enter")`：均恰为 `["七"]`；⑤ 两开关都开，9,5,确认：log 中 kind==="key" 的 text 为 `["九","五"]`，且无 kind==="result" 记录。收笔后额外等 1s 再读一次 count，确认不再增长。每条都输出实测 JSON。
- H2 单键恰好一次（仅按键）：① 依次点 0–9：text 恰为 `["零","一","二","三","四","五","六","七","八","九"]`；② 点 5,.,.,7：`["五","点","七"]`；③ 点 5,退格,退格：`["五","退格"]`；④ 点 5,5：`["五","五"]`；⑤ 点 `[data-op="+"]`,`-`,`*`,`/`：`["加","减","乘","除"]`；⑥ 点 1,+,2,=`[data-testid="key-equals"]`：`=` 不新增任何记录；⑦ 点 5,确认,退格,退格：`["五","退格"]`。全部记录 kind 必须为 `"key"`，不得出现 `"result"`。
- H3 结果播报（仅结果，除 ⑤ 外）：① 1,+,2,=：无 kind==="key" 记录，最后一条 text=`"三"` 且 kind=`"result"`；② 9,.,5,+,9,.,2,=：结果区 `[data-testid="result"]` 文本 `"18.7"`，最后一条 `"十八点七"`；③ 2,−,5,=：结果区 `"-3"`，最后一条 `"负三"`；④ 1,÷,0,=：结果区与最后一条均为 `"不能除以零"`；⑤ 两开关都开 1,+,2,=：key 文本依次 `["一","加","二"]`，最后一条是 result `"三"`；所有播报 text 均不得包含「结果」二字。
- H4 开关与队列：① 都关：1,+,2,= 后 count 为 `"0"` 或空；② 仅结果：1,+,2= 的 kind 集合仅 `["result"]`；③ 仅按键，快速点 1,2,3（总时长 <1.5s），轮询 played 至 3 条：text 恰为 `["一","二","三"]`；④ 两开关都开，快速点 1,+,1,=,9，等 4s：played 无任何 kind==="result"，key 文本为 `["一","加","一","九"]`。
- H5 回归：① 运行 `node /ws/cal_phone-worktrees/voice-double-announcement/tests/voice/run.mjs --json`（cwd 该仓库根），解析 stdout 单个 JSON：要求退出码 0、`failed===0`、`passed>=70`；② 运行 `node /ws/cal_phone-worktrees/voice-double-announcement/tests/suite.mjs --json`：退出码 0、`scenarios===18`、`checks===206`、失败 0（若字段名不同，按该入口实际 JSON 字段读取并输出原值）；③ 仅按键 1,+,2,= 后结果区文本必须为 `"3"`；④ 确认按钮 `[data-testid="enter"]` 文本仍为「确认」；⑤ 自动确认 `autoConfirm:0.2` 点 6 后等 1s，表达式区文本包含 `"6"`（证明收笔仍发生，只是静音）。
若某一 H 的子场景因页面加载或队列未稳定而读不到期望条数，必须重试同一场景至多 2 次并记录原始观测；不得把超时或空数组直接判 PASS。每条 H 输出实测值与判定；全部 PASS 才写 `HARD: PASS`。
phase=first 时把验证逻辑写成脚本 `/ws/cal_phone-worktrees/voice-double-announcement/Telos/phone-calculator-voice-double-announcement-112111/evidence/verify.mjs`（接受轮号参数）并立即以 `node verify.mjs <round>` 运行；它按上面不变量逐条实测并写 `hard-r<N>.txt`：先写 `ROUND: <N>`、`ARTIFACT_SHA256: <64hex>`、`VERIFIER_SHA256: <64hex>`（脚本自身 sha256），再每条 `H<id> PASS|FAIL — 实测值/证据`，末行**严格** `HARD: PASS` 或 `HARD: FAIL (Hx,…)`。
若 runtime contract 的 `expected_review_states` 非 none：同一脚本还须把每个状态用 Playwright/无头 Chrome 渲染成**非空、非纯色、内容互不重复**的 PNG（≥ 240×160；真 320px 用 CDP `Emulation.setDeviceMetricsOverride`）落 `review-shots/r<N>/S<k>.png`——精确且仅这些文件；把带同样头的可见性/溢出/关键尺寸 `key=value` 实测写 `render-r<N>.txt`；写 `manifest-r<N>.json`：`round`、`artifact_sha256`、`verifier_sha256`、`metrics_sha256`、每张图的 `file/sha256/width/height`、`adhoc: []`。
phase=final 时**禁止读取、运行或修改 verify.mjs / ledger / 旧证据**，在你被启动的隔离 scratch cwd 中重新推导全套检查；临时测量只落当前 scratch 目录，最终回复给出裁决，由 CLI 保存（不要自行写 `-o` 路径）；首行同样是 `ROUND:`、`ARTIFACT_SHA256:`，末行同样严格。
HARD-VERIFY-PROMPT>>>

---

## 5. 运行与停止（命令按需选用，非逐行执行的脚本；停止数字只在 frontmatter）
    # gate=/ws/cal_phone-worktrees/voice-double-announcement/Telos/phone-calculator-voice-double-announcement-112111 · rendered by kekkai new — do not edit
    kekkai doctor --gate "/ws/cal_phone-worktrees/voice-double-announcement/Telos/phone-calculator-voice-double-announcement-112111" --host     # before round 1 and after any host change
    kekkai hard "/ws/cal_phone-worktrees/voice-double-announcement/Telos/phone-calculator-voice-double-announcement-112111"                     # r1: independent author writes evidence/verify.mjs; later rounds replay it
    kekkai adhoc "/ws/cal_phone-worktrees/voice-double-announcement/Telos/phone-calculator-voice-double-announcement-112111" -- <command…>      # same-round measurement admissible as 误报 basis
    kekkai recast "/ws/cal_phone-worktrees/voice-double-announcement/Telos/phone-calculator-voice-double-announcement-112111" --reason "<why>"  # sick instrument: quarantine + fresh independent author (≤3 eras)
    kekkai hard "/ws/cal_phone-worktrees/voice-double-announcement/Telos/phone-calculator-voice-double-announcement-112111" --final             # terminal independent stamp at the stop candidate
    kekkai lint "/ws/cal_phone-worktrees/voice-double-announcement/Telos/phone-calculator-voice-double-announcement-112111" --post              # after round 1, on recovery, before STOP
    kekkai close "/ws/cal_phone-worktrees/voice-double-announcement/Telos/phone-calculator-voice-double-announcement-112111" --by <budget|host|instrument|oscillation|human> --blocker "<one sentence>"

- **轮次 = runner 提升进 `evidence/runs/hard-r<N>.txt` 的 canonical 盖章**；其余一切都是尝试（`evidence/attempts/`），不写台账、不占预算、不动 K。轮号由 runner 分配，不要手填；不要手跑 `node verify.mjs` 再拷文件进 runs/（缺 runner 头会被拒绝）。
- **`kekkai hard` 退出码**：`0` 提升为轮；`2` 尝试已归档（先读 `kekkai status --json` 和消息：若该轮已提升但 final 缺失，补 `--final`；否则修因后继续，不盲重跑）；`3` 重复/尝试上限——只有三条合法路：(1) change the business tree, (2) `kekkai recast --reason`, (3) `kekkai close --by <tag>`；`4` 规则拒绝（读消息，别原样重试）。管道故障同一输入有重试上限；无法修复就 `close`，不换措辞/增预算绕过。
- **首个 hard PASS 轮 runner 自动跑审计 final**；final 与量具不一致 ⇒ final 的 FAIL 成立，只能修代码或 `kekkai recast`，永不再跑一次 final 试运气。
- **停止**：`converged` = 最新轮 hard PASS + 当前产物/业务树字节的同 era 独立 final PASS（hard-only 不需要软评或 K 确认轮），且未超 frontmatter `max_rounds`；任何轮数（含 0）都可以 `kekkai close --by <budget|host|instrument|oscillation|human>` 写 blocked 终态并附 `blocker:` 行——绝不把 gate 停在 in-loop 而无 STOP。
- 第 1 轮后、恢复时、写 STOP 前各跑一次 `kekkai lint <本目录> --post`；`POST-IN-PROGRESS` 是运行中的预期警告。

---

## 附录 · 生成器判断记录（可审计的 taste↔structure 边界）
> 让执行者能看懂哪些是「结构强制」、哪些是「生成器的 taste 取舍」。不要复述停止数字（它们只在 frontmatter）。
- 这是语音文案/播报时机的最小修补：只改收笔播报路径与对应测试期望，不涉及主观呈现目标，因此用 `--soft none`，没有 §4 与截图评审。
- 已在 worktree 用假引擎实测复现基线：`5,确认 → ["五","五"]`、`9,5,确认 → ["九","五","九十五"]`、`autoConfirm:0.2 + 6 → ["六","六"]`；本闸的 H1 就是把这个重复压回一次。用户已在开跑前拍板：收笔（含自动确认）完全静音，不再念数字也不再念「确认」；该决定写在本附录与 §1/§2（hard-only 台账不预填决策行），取代 `phone-calculator-voice-number-only-112109` 的“确认念数字”。
- 硬闸复用仓库内 `tests/voice/run.mjs` 的假引擎契约（Playwright + 本地 HTTP + 400ms 假音频），不依赖 `/ws/voice`、公网或 96MB 真实模型；H5 另跑 `tests/suite.mjs` 的 18/206 既有回归。真实引擎出声与目标手机听音仍是闸外人工步骤，不写成永远失败的 H。
- `volatile: ["voice/"]`：真实模型资源由安装脚本生成且被 `.gitignore` 忽略，属仓库外大文件，不参与 TREE_SHA256。
- 本 gate 的 repo/artifact 指向 `/ws/cal_phone-worktrees/voice-double-announcement`（git worktree 分支 `voice-double-announcement`）；主工作区 `/ws/cal_phone` 未提交的语音 WIP 已原样复制进 worktree 作为修复起点，执行时不要回写主工作区。
- 没有冻结 sha256 基线：本任务要改的正是 `commitInput` 播报分支；计算/历史/编辑等语义由行为断言（结果区文本、测试套件）保护，冻结整段脚本会妨碍授权修复。
