---
# ── Kekkai Goal Gate v4 · frontmatter（唯一机读区；停止数字只在这里；矩阵/不变量内容只在正文表格）──
slug: phone-calculator-voice-announcements-112105
version: 4
model_profile: astra-flash-3.8-v1  # 新任务冻结模型组合；执行中不可修改
status: converged                  # draft | in-loop | converged（blocked 终态保持 in-loop）
repo: /ws/cal_phone
artifact: /ws/cal_phone/index.html
# artifact_kind: url | app | service   # 仅 artifact: null 时启用；此时 ARTIFACT_SHA256 := TREE_SHA256
parent_gate: null                  # 子闸填父 GOAL.md 绝对路径；只继承 round-0 决策，不继承证据或 verify.mjs
verifiers:
  hard: codex exec                 # 固定驱动器；pin 与访问标志在 bin/runner.mjs（docs/RUNNER.md）
  soft: agy -p (Gemini 3.8 Flash (High))   # 固定驱动器；无软闸的 gate 为 null（kekkai new --soft none）
stop:
  max_rounds: 10
hard_invariants: [H1, H2, H3, H4, H5, H6, H7, H8, H9, H10]
review_states: [S1, S2, S3]
volatile: ["voice/"]               # TREE_SHA256 排除的仓库相对路径（构建产物、日志等）；空数组即可
---

# Kekkai Goal Gate · 语音播报：按键播报 + 结果播报（sherpa-onnx 离线 TTS）

> **运行指令**：你是执行者（Codex / Claude Code / ZCode / Cursor 之一，由 handoff 指定；生成本 gate 的那次调用不得兼任）。
> 开跑前先 `kekkai doctor --gate <本目录> --host`；只有 `requires_display: true` 的真实桌面测量依赖解锁与屏幕权限，普通无头浏览器/逻辑测量不占屏。
> 读**本文件全文** + 同目录 [`./ledger.md`](./ledger.md)（决策台账），然后只用 §5 的命令块驱动验收，直到 §5 的停止条件；在已授权范围内自主推进，缺少外部输入时写明 blocked 与恢复条件。
> 生命周期编辑是唯一允许的 GOAL 改动：第 1 轮前 `status: draft → in-loop`；写 `converged` STOP 前 → `status: converged`；blocked 终态保持 `in-loop`。
> 除此之外 GOAL.md 只读：不改 frontmatter 数字、不改 prompt、不改变 §5 命令的操作、目标路径和关键参数（注释与空白不影响验收）。
> 教义在 Kekkai skill 的 `docs/CREED.md`、runner 契约在该 skill 的 `docs/RUNNER.md`——本文件不复述它们；`kekkai hard/soft` 的退出码与消息就是你的下一步。

## 1. 目标（一句话 + 背景 + 实施指导）
按 `/ws/cal_phone/docs/superpowers/specs/2026-11-21-voice-announcements-design.md` 实现「语音播报」：在齿轮设置面板里新增**按键播报**与**结果播报**两个默认关闭的开关，用户按键时听到键名、按 `=` 后听到结果（除零读「不能除以零」）；引擎使用本地静态资源 sherpa-onnx 1.13.5 WASM + Matcha-TTS（中文女声，仅限非商用，约 96MB，首次按需下载），加载/准备/失败状态在主界面与设置面板都可见、可重试，语音失败绝不影响计算。

**背景（生成前实测）**：
`/ws/voice/public` 已有已验证的 TTS 运行时与模型（7 个文件，95,749,505 字节）。Matcha 模型把阿拉伯数字当 OOV，`结果 37.7` 只会念出「结果」，因此结果必须先经 `numberToChineseReading` 转成中文（`结果 三十七点七`）。按键词单句合成 142–249ms，17 个按键词一次性预合成约 3.0s；结果句按需合成约 0.3–0.5s，期间同步阻塞主线程。TTS 不需要 COOP/COEP。现有 `tests/suite.mjs` 为 18 场景 / 206 检查，全部用 `file://` 打开，语音必须在 `file://` 下禁用且不发起 `voice/` 请求，保证回归基线不触发网络。

**实施指导**：
在 `/ws/cal_phone/index.html` 既有 IIFE 内新增一段语音模块，保持单文件、无构建步骤。从 `/ws/voice/src/sherpa-tts.js` 的 `loadSherpaTts` 改写 `loadVoiceEngine()`（脚本已注入则跳过、`locateFile` 指向 `voice/sherpa-onnx-wasm-web.wasm`、模型流式下载并写 MEMFS、`createOfflineTts` 使用 Matcha 配置、校验 `tts.handle`）；从 `/ws/voice/src/numbers.js` 原样移植 `numberToChineseReading` 并保留来源注释。维护 `voiceState = idle|loading|preparing|ready|error`、进度、引擎 Promise、按文本缓存（≤20 条）与串行播放队列。18 个按键词/提示词预合成时逐句 `yield`（`setTimeout 0` 或 `requestIdleCallback`，见设计 §10），更新「正在准备按键语音 x/N」；单句失败只记日志并回退按需合成。所有播报都必须由真实按键/点击触发，禁止测试专用旁路；`data-speech-*` 只是观测属性。动作函数改为返回「是否真的发生」：`appendCharacter`、`deleteLastCharacter` 返回 boolean，`commitInput({announceCommit})` 区分手动/自动确认（`true`）与 `calculate()` 内部提交（`false`），`chooseOperator` 在点击处播报，`calculate()` 在成功/除零时播报结果。设置写入沿用 `cal-phone.settings.v1` 的 try/catch，保存 `voiceKeys`、`voiceResult`；重置「运算类型」不清空语音设置。

**测试注入契约（硬闸依赖，必须在产物中成立）**：页面脚本执行前若 `window.SherpaOnnx` 与 `window.createOfflineTts` 已是函数，则不得再覆盖或依赖其内部实现；`SherpaOnnx()` 返回一个带 `FS.mkdirTree`、`FS_createDataFile`、`FS.writeFile` 的 module，`createOfflineTts(module, config)` 返回 `{handle: 1, generate({text, sid, speed})}`，`generate` 返回 22,050Hz、时长由 `window.__voiceFake.durationMs`（默认 400）控制的非空 `Float32Array`；`window.__voiceFake.fail` 为 true 时 `createOfflineTts` 必须抛出可捕获错误（用于失败/重试验收）。模型文件下载只以实际响应体与 `Content-Length` 为准，不得要求恰好 96MB，以便测试服务器提供小文件。

新增 `scripts/voice-assets.sha256`（7 个固定哈希，随 git 提交）、`scripts/install-voice-assets.sh`（默认从 `/ws/voice/public` 复制到 `voice/` 并 `sha256sum -c`，缺源时打印 HF 链接与手动步骤）、`scripts/voice-server.mjs`（普通 HTTP，默认 4174，正确 `.wasm`/`.onnx` MIME）与 `tests/voice/`（静态服务器 + Playwright，普通 HTTP，假引擎）。`deploy/server.cjs` 给 `voice/` 加 `public, max-age=31536000, immutable`；`README.md` 与 `deploy/README.md` 补资源表、首次安装、非商用许可与离线含义。`voice/` 加入 `.gitignore`，不提交 96MB 二进制。

> 外部前提（账号、服务、人工决定、设备权限）应在实施指导中明确；缺失时保留证据并 blocked，不把无法由代码修复的条件塞进硬不变量反复重跑。
> 本闸只覆盖设计 §9.1 的自动化验收与 §4 的静态资源/脚本/部署交付。设计 §9.2 真实引擎 smoke 与 §9.3 真机人工试听需要目标手机、96MB 真实模型与人的耳朵，不属于本闸的硬不变量；实现完成后由人按 §9.3 在 `https://192.168.1.25:8444/` 执行，失败再另开修复闸。

## 2. 不变约束（父级红线 · 任何修改不得破坏）
> 每条红线**必须标注归属**：`[H#]`（由该硬不变量机检）或 `[soft-only: 原因]`（只能主观把关，写明为何无法机检）。绝对不能改的代码块优先给 sha256 机检形式。不允许留下既非 `[H#]` 也非 `[soft-only]` 的悬空红线。
- 计算、历史、编辑草稿、自动确认、自动按等号、基数的语义与现有行为不得改变；18 场景 / 206 检查必须全绿 [H10]
- 两开关关闭时不得发出任何语音；语音引擎失败或加载中不得影响按数字、计算、历史、编辑与除零恢复 [H5, H10]
- 只在动作真实发生时播报：空确认、空退格（无字符且无可撤回）、被忽略的重复小数点、`=` 本身不产生按键播报 [H3]
- 串行队列：同一时间只播一条；新按键丢弃尚未开口的旧结果但不得丢按键；关闭开关清理该类型排队任务；结果不得把未念完的按键顶掉 [H6]
- `file://` 打开时两个开关禁用并提示改用 `http(s)` 网页地址；页面不得请求 `voice/`，回归基线保持零语音网络请求 [H2]
- 加载/准备/失败状态必须可见：状态行、进度、失败原因与「重试」；刷新后开关保留且后台自动加载；主界面胶囊在加载时显示「语音准备中」、失败时「语音不可用」 [H1, H7]
- 任一语音开关开启即计入「已自定义」（齿轮琥珀点 + 摘要胶囊）；重置「运算类型」不得清空语音设置 [H1]
- 320×568 与 390×844 下设置面板与语音控件无横向溢出，语音设置行与重试按钮可点击区域 ≥44px，状态胶囊不遮挡齿轮 [H9]
- `index.html` 仍是单文件自包含、`</html>` 闭合，不引用 `http(s):` 或协议相对的外部 script/link/img/font/@import；96MB 资源只从本地 `voice/` 加载 [H8, H10]
- `voice/` 不提交进 git；`scripts/voice-assets.sha256` 的 7 个哈希必须与固定基线一致；部署对 `voice/` 发送 immutable 长缓存与正确 MIME [H8]
- 语音设置组的视觉层级、提示文案易读性与状态反馈的清晰度沿用现有设计变量，不引入原生丑控件 [soft-only: 主观质感无法机检]

> 允许改动的范围豁免写在下面的定界块里（runner 会把它**逐字**内联进 first / recast / final 验收器的 runtime contract，避免首轮判合规、末轮判违规的判定分裂）。没有豁免就写 `无`。

<<<SCOPE-EXEMPTIONS
允许改动：/ws/cal_phone/index.html（语音模块、语音设置组标记与样式、动作函数返回值/播报调用、语音观测属性）；新增 /ws/cal_phone/voice/（gitignored 运行资源）；新增 /ws/cal_phone/scripts/voice-assets.sha256、scripts/install-voice-assets.sh、scripts/voice-server.mjs；新增 /ws/cal_phone/tests/voice/**；修改 /ws/cal_phone/deploy/server.cjs、deploy/README.md、README.md、.gitignore。既有 tests/** 只在新增语音观测属性确实破坏选择器时做等价调整，不得删减或放宽既有 206 条检查。不允许改计算/历史/编辑/自动确认/基数的语义，不允许把 96MB 资源提交进 git。
SCOPE-EXEMPTIONS>>>

---

## 3. 硬目标（独立确定性验收 · 硬闸 · codex exec）

**输入矩阵（采样覆盖；含边界与「哪些算、哪些拒答」）：**
- 打开方式 ∈ {`file:///ws/cal_phone/index.html`（拒答语音、禁用开关、零 voice 请求）, 普通 HTTP（静态服务器，可加载 voice/）}
- 引擎状态 ∈ {idle 默认, loading, preparing, ready, error, error→retry→ready}
- 开关组合 ∈ {keys 关 / result 关, 仅 keys, 仅 result, 两者都开}
- 动作序列 ∈ {数字 0–9、`.`、重复 `.`、退格删字符、退格撤回一笔、退格空、确认成功、确认空、`+ - * /` 切换、`=` 直接提交未确认数字、自动确认 0.2s、自动按等号满 2 笔、物理键盘 7/8/Backspace/Enter}
- 结果边界 ∈ {9.5+9.2=18.7、2−5=−3、1÷0 错误、0.1+0.2 照读 0.30000000000000004、自动等号结果}
- 队列 ∈ {快速 1,2,3 全播且顺序正确, 结果排在按键后且新按键丢弃未开口结果, 播报中关闭开关清掉排队任务}
- 视口 ∈ {390×844, 320×568（CDP 设备度量，非 window-size）}
- 静态交付 ∈ {7 个资源哈希、install 脚本复制校验、deploy 服务器 voice/ 响应头与 MIME、README/deploy 文档关键事实}

**稳定测试入口：** 现有 `[data-testid]`（`settings-panel`、`settings-toggle`、`settings-summary`、`settings-indicator`、`settings-voice-keys`、`settings-voice-result`、`voice-hint`、`voice-status`、`voice-status-text`、`voice-progress`、`voice-retry`、`settings-done`、`key-*`、`enter`、`calc-input`、`result`、`history-list`、`reset` 等）与现有 `[data-key]`；新增 `.app` 观测属性 `data-voice-state`、`data-voice-progress`、`data-speech-last`、`data-speech-kind`、`data-speech-count`、`data-speech-log`、`data-speech-played`、`data-speech-last-ms`。假引擎注入契约见 §1；测试服务器对 `voice/**` 返回小体积占位文件即可（实现不得强制要求真实 96MB）。既有回归入口：`node /ws/cal_phone/tests/suite.mjs --json`。

**不变量：**

| # | 不变量 | 硬闸怎么验（须真跑，非读源码目测） | 阈值 |
|---|---|---|---|
| H1 | 语音设置可发现、默认关、持久化并计入「已自定义」 | HTTP 打开，点齿轮：两个 checkbox 存在且未勾选；勾选后 `localStorage["cal-phone.settings.v1"]` 解析出 `voiceKeys === true` 与 `voiceResult === true`；等待 `data-voice-state=ready`（15s 内）后刷新，仍勾选且最终 ready；就绪后 `settings-summary` 可见且文本为「已自定义」，齿轮指示点可见；关闭两个开关后（其余设置为默认）摘要与指示点隐藏；完成一次运算后点「运算类型」重置，语音开关与 localStorage 不变 | 上述全部成立 |
| H2 | `file://` 拒答语音且不产生网络 | `file:///ws/cal_phone/index.html` 打开：两个语音 checkbox `disabled`；`voice-hint` 文本含 `http`（不区分大小写）或「网页地址」；收集全部请求，匹配 `/voice/` 的请求数 = 0；依次点 1、+、2、= 后结果为 3 | disabled 且 0 个 voice 请求且 3 |
| H3 | 按键播报只在动作真实发生时出声，屏幕/物理键盘一致 | 假引擎就绪、仅开按键：依次点 9、5、`.`、`.`、退格、确认、确认、退格、退格、`+`、`-`、`*`、`/`、`=`；解析 `data-speech-log` 的 text 序列，`data-speech-count`、`data-speech-last` 同步；新页面用物理键盘 7、Backspace、8、Enter；再预置 `autoConfirm:0.2` 点 6 等 400ms 触发自动确认 | 序列精确为 九,五,点,退格,确认,退格,加,减,乘,除（10 条；重复点/空确认/空退格/`=` 无记录）；再为 七,退格,八,确认（14 条）；自动确认再增 六,确认（16 条），count 一致 |
| H4 | 结果播报按中文读法、负号与除零正确，自动等号同样播报 | 假引擎就绪、仅开结果：① 9.5 + 9.2 =；② 2 − 5 =；③ 1 ÷ 0 =；④ 设置 autoEquals=2 后 3 + 4（输入后自动计算）；⑤ 7 + 8 = 不按确认直接等号。每步读 `data-speech-log` 末条与 `data-speech-kind` | 依次为 `结果 十八点七`、`结果 负三`、`不能除以零`、`结果 七`；⑤ 仅一条结果 `结果 十五` 且无 `确认`；`kind` 均为 `result` |
| H5 | 两个开关相互独立 | 仅开结果：1 + 2 = 后 `data-speech-log` 无 `kind:"key"`，只有 `结果 三`；仅开按键：1 + 2 = 后只有 一,加,二，无 `result`，结果区仍显示 3；两者都关：任意按键与 `=` 后 `data-speech-count` 不增 | 三种组合均成立 |
| H6 | 串行队列、结果替换/丢弃与关闭开关清理 | 假引擎每句 400ms。① 仅开按键快速点 1,2,3，等播放稳定：log 与 played 的 text 顺序均为 一,二,三；② 两开关都开，1 + 1 = 后立即点 9（结果仍在按键之后未开口）：played 中无任何 `kind:"result"`，按键照播；③ 仅开按键，点 1 后快速点 2,3,4,5 并在首句结束前打开设置取消按键，等 3s：played 中只出现 一（最多再含 二），不得出现 三/四/五 | 顺序、丢弃与清理均成立；同一时刻不出现两条同时开始的结果 |
| H7 | 加载状态、进度、失败原因与重试；刷新后台加载 | 假引擎 + 节流静态服务器。① 首次勾选按键：`data-voice-state` 先进入 `loading`/`preparing`，`voice-status` 可见、`voice-status-text` 非空、`data-voice-progress` 为 0–100 的数字，摘要含「语音准备中」，最终 `ready` 且状态含「语音已就绪」、摘要「已自定义」；② 令 `__voiceFake.fail=true` 后开启，进入 `error`，状态文本含「语音加载失败」，`voice-retry` 可见，开关保持勾选，计算 1+2=3 正常；③ 置 fail=false 点重试，15s 内 `ready`；④ 预置 `voiceKeys:true` 刷新，无用户手势 15s 内自动 `ready` | 四步全部成立 |
| H8 | 静态资源、安装脚本、部署缓存与文档交付完整 | ① 解析 `/ws/cal_phone/scripts/voice-assets.sha256`：恰好 7 个 64hex，哈希多重集等于 GOAL 内固定基线；② `bash /ws/cal_phone/scripts/install-voice-assets.sh`（cwd 仓库根，默认 VOICE_SRC=/ws/voice/public）退出 0，`/ws/cal_phone/voice/` 下 7 个文件 sha256 与基线一致；③ 启动 `node deploy/server.cjs`（临时 ROOT 或仓库根，随机 PORT），GET `/voice/sherpa-onnx-wasm-web.wasm`：200、`Content-Type: application/wasm`、`Cache-Control` 同时含 `max-age=31536000` 与 `immutable`；④ README.md 与 deploy/README.md 含 `install-voice-assets.sh`、`非商用`、`voice/` 三个事实 | 7/7 哈希一致；安装退出 0；响应头齐全；文档事实齐全 |
| H9 | 320/390 设置面板与语音状态无溢出、控件可点、胶囊不遮齿轮 | CDP `Emulation.setDeviceMetricsOverride` 到 320×568 与 390×844；假引擎失败态下打开设置：`document.documentElement.scrollWidth <= innerWidth` 且设置面板无横向滚动；`settings-voice-keys`、`settings-voice-result` 所在行高 ≥44；`voice-retry` 宽高均 ≥44；`voice-status`、`voice-progress`、`voice-hint`、`voice-retry` 均可见且矩形在视口内；摘要胶囊可见、文本「语音不可用」、矩形与齿轮 `settings-toggle` 不相交 | 两个视口全部成立 |
| H10 | 既有计算/历史/编辑/除零零回归，加载期间不冻结，产物自包含且失败不影响计算 | ① `node /ws/cal_phone/tests/suite.mjs --json`：18 场景、206 检查、0 失败；② 预置 `voiceKeys:true` + 慢速假资源（加载 >1.5s）打开页面，在 `loading` 状态点 2 + 2 =，结果区 1000ms 内出现 4，页面无 uncaught `pageerror`；③ 假引擎失败态下完成 1+2=3、历史新增一条、1÷0 显示「不能除以零」，随后输入 2+3=5 恢复；④ 读取 `index.html`：`</html>` 存在、字节数 ≥1024、无 `src` 或 `href` 指向 `http(s):` 或 `//` 的外部 script/link/img/font | 206/206 全绿；结果 ≤1000ms；历史/编辑/除零恢复成立；pageerror=0；自包含成立 |

<<<HARD-VERIFY-PROMPT
你是确定性验收器。**不要评价 UI 美观、不要改产物源码。**本 prompt 会被单独抽取喂给你（读不到 frontmatter 与上表），所以下面所有文件都写**绝对路径**、基线写 **sha256 值**；runner 会在其后追加 `[RUNTIME CONTRACT]`（round / phase / gate_dir / evidence_dir / out_dir / artifact_sha256 / expected_review_states / SCOPE-EXEMPTIONS 原文），以它为准。
按本闸输入矩阵 / 不变量逐条**实际执行**验证：优先复用已有测试入口，逻辑用 Node 调用函数并断言返回值/异常；界面用 Playwright/jsdom 操控稳定选择器并读值。基线只用于本任务明确要求不可更改的范围，不能自行冻结整个源码或妨碍授权修复。采用项目已有工具与依赖；缺依赖或设备时明确拒答，不能伪装成代码 FAIL。禁止用主观语言/肉眼通读代替实测证据。
量具卫生（三条，写量具时逐条自查）：① 不得含写死的恒 FAIL/恒 PASS 常量判据；② 扫描类不变量的扫描面必须与 §3 声明逐字一致、不得自行扩张，且**不得包含 evidence/ 或 evidence/runs/**（自引用扫描面一旦被本循环必写的证据污染就永远翻不了绿）；③ 断言锚定稳定选择器/数据钩子而非用户可见文案原文（软闸可能正当地要求改文案；本闸的播报文本与状态关键字是功能输出，必须精确断言）；子进程/步骤超时 ≥ 单次实测耗时的 2 倍。
量具接口（两条，runner 靠它做变异检查与尝试隔离，缺一即拒绝提升）：① 环境变量 `KEKKAI_ARTIFACT` 存在时用它覆盖目标文件路径；② `KEKKAI_OUT_DIR` 存在时，`hard-r<N>.txt` / `render-r<N>.txt` / `manifest-r<N>.json` / `review-shots/r<N>/` 全部写到该目录下，而不是 evidence/runs（所有路径以脚本自身所在目录解析、不依赖 cwd）。
目标文件（绝对路径）：/ws/cal_phone/index.html
本闸具体：
- 测试环境：Node 22、Playwright 1.64.0 位于 `/ws/cal_phone/tests/node_modules`（用 `createRequire` 或 `NODE_PATH` 加载）；Chromium 已缓存。语音相关页面必须用**普通 HTTP**（自己在 evidence/ 或临时目录起 Node 静态服务器，不要用 `file://`），`file://` 只用于 H2。静态服务器对 `/voice/**` 返回小占位文件并带 `Content-Length`；对模型下载可加 100–300ms 节流以观察 loading 态；H10 的慢速加载让总时长 >1.5s。
- 假引擎注入（addInitScript，页面脚本前执行）：`window.__voiceFake = {fail:false, durationMs:400}`；`window.SherpaOnnx = async () => ({FS:{mkdirTree(){}, FS_createDataFile(){}, writeFile(){}}})`；`window.createOfflineTts = (module, config) => { if (window.__voiceFake.fail) throw new Error("fake init failure"); return {handle:1, generate({text}){ window.__voiceFake.generated.push(String(text)); const n=Math.round(22050*window.__voiceFake.durationMs/1000); const a=new Float32Array(n); for(let i=0;i<n;i++) a[i]=Math.sin(i/20)*0.05; return {samples:a, sampleRate:22050}; }};`。若页面仍注入 `/voice/sherpa-onnx-wasm-web.js` 与 `/voice/sherpa-onnx-tts.js`，服务器返回同样的两行 stub 定义这两个全局，保证两种加载路径都可用。
- H1：HTTP 打开 /ws/cal_phone/index.html，点 `[data-testid="settings-toggle"]`；检查 `[data-testid="settings-voice-keys"]`、`[data-testid="settings-voice-result"]` 初始未勾选；勾选后 `page.evaluate` 读 `localStorage["cal-phone.settings.v1"]` 解析 `voiceKeys===true && voiceResult===true`；等待 `data-voice-state` 为 "ready"（≤15s）后 `page.reload()`，再等 ready，确认仍勾选，`[data-testid="settings-summary"]` 可见且 textContent trim === "已自定义"，`[data-testid="settings-indicator"]` 可见；都关闭且 autoConfirm=0/autoEquals=0/baseEnabled=false 时摘要 hidden；做 1+2=3 后点 `[data-testid="key-op"]` 重置，语音开关与 localStorage 不变。
- H2：`page.goto("file:///ws/cal_phone/index.html")`；两 checkbox disabled；`[data-testid="voice-hint"]` 文本匹配 `/http/i` 或含「网页地址」；监听 request，URL 含 `/voice/` 的数量为 0；点 1,+,2,= 后 `[data-testid="result"]` textContent === "3"。
- H3：假引擎 ready、`voiceKeys:true, voiceResult:false`；按序点 `[data-key="9"]`,`5`,`.`,`.`,`backspace`,`enter`,`enter`,`backspace`,`backspace`, `[data-op="+"]`,`-`,`*`,`/`, `[data-key="equals"]`；解析 `[class app 或 body]` 的 `data-speech-log`（JSON 数组，取每项 `text`）与 `data-speech-count`/`data-speech-last`，期望 text 序列 `["九","五","点","退格","确认","退格","加","减","乘","除"]`、count=10、last="除"、无额外记录。再新页面仅开按键用物理键盘 `7`、`Backspace`、`8`、`Enter`，期望在已有序列基础上再得 七,退格,八,确认。再预置 `autoConfirm:0.2, voiceKeys:true` 点 6，等 400ms 后应新增 六,确认。
- H4：假引擎 ready、`voiceKeys:false, voiceResult:true`；① 点 9,.,5,+,9,.,2,= → result 文本 "18.7"，`data-speech-last` === "结果 十八点七"；② 点 2,-,5,= → "结果 负三"；③ 点 1,/,0,= → result 文本 "不能除以零"，`data-speech-last` === "不能除以零"；④ 设置面板把 autoEquals 填 "2" 并完成，点 3,+,4,enter → result "7" 且 `data-speech-last` === "结果 七"；⑤ 新页面点 7,+,8,= → result "15"，log 中无 text "确认"，最后一条是 "结果 十五"。
- H5：仅开结果：1,+,2,= 后 log 的 kind 集合 ⊆ {"result"} 且 last === "结果 三"；仅开按键：同样操作 log 的 kind 全为 "key"、text 序列 ["一","加","二"]，result 文本 "3"；两者都关：任意 1,+,2,= 后 `data-speech-count` === "0" 或空。
- H6：假引擎 durationMs=400、ready。① 仅开按键，连续点 1,2,3（不放慢），轮询至 `data-speech-played` 长度 ≥3 或 5s 超时，断言 log 与 played 的 text 均为 一,二,三；② 两开关都开，连续点 1,+,1,=,9（第六次点击距第一次 <1.5s），等 4s，断言 played 中没有任何 kind==="result"，且 played 含 click 对应的按键；③ 仅开按键，点 1 后立即点 2,3,4,5，随即开设置取消按键，等 3s，断言 played 中不含 三/四/五，且长度 ≤2。
- H7：① 节流服务器 + 成功假引擎，首次勾选按键；每 100ms 采样 `data-voice-state`，记录到过 loading 或 preparing；期间 `[data-testid="voice-status"]` 非 hidden、`voice-status-text` trim 非空、`data-voice-progress` 可 Number 且 0–100、summary 含「语音准备中」；最终 15s 内 ready，状态文本含「语音已就绪」，summary textContent trim === "已自定义"。② 刷新前/注入时设 `window.__voiceFake.fail=true`，开启后 10s 内 error，状态文本含「语音加载失败」，`voice-retry` 可见，checkbox 仍 checked，点 1,+,2,= 得 3。③ evaluate 置 fail=false，点 voice-retry，15s 内 ready。④ 新页面预置 `voiceKeys:true`（localStorage），不点击，15s 内 `data-voice-state` === "ready"。
- H8：① 读 `/ws/cal_phone/scripts/voice-assets.sha256`，正则收集 64hex，期望多重集恰好为：
  e7ca68efeb8fa4f1bf7768827f468a31a25f1878209d24a3e08fe7bfcbba5cb5（sherpa-onnx-wasm-web.js）
  c655dbdc9ed486004a040936e50aca6d0ada4bdbd3e188e7155f8fd8544cd21a（sherpa-onnx-wasm-web.wasm）
  b9cb4782010b22d64be31298a3e407170d2b8f5def471ea6011c42a921577e8f（sherpa-onnx-tts.js）
  47e82b11454edeeb65adc4e44a24fd54c6715cd4d875cc2a20f75545ecc32d4d（sherpa-tts/matcha-zh-baker.onnx）
  a41d404cce7924493540238da5b30a4bc14b6ddaf1a37f3c79fa4f59548c19f0（sherpa-tts/hifigan_v2.onnx）
  38b886d46aefa50da6322a64d72fd595d5f4fae1051adb160d647541b1e0a4a2（sherpa-tts/lexicon.txt）
  56209b2bf609d5ac1d66ede6dae7bf5254bd3f8aa24c4a6823713d5b884d87ba（sherpa-tts/tokens.txt）
  不是 7 个或任一不在集合中即 FAIL。② `spawnSync("bash",["scripts/install-voice-assets.sh"],{cwd:"/ws/cal_phone"})`，exit 0；然后对 `/ws/cal_phone/voice/` 下 7 个文件逐个 sha256，与上表对应。③ 用随机 PORT spawn `node deploy/server.cjs`，ROOT=/ws/cal_phone，等待监听后 GET `/voice/sherpa-onnx-wasm-web.wasm`，断言 status 200、content-type 含 application/wasm、cache-control 含 max-age=31536000 且 immutable；结束后 kill。④ 读 `/ws/cal_phone/README.md` 与 `/ws/cal_phone/deploy/README.md`，两者都含 `install-voice-assets.sh`、`非商用`、`voice/`。
- H9：Playwright `newContext({viewport:{width:390,height:844}})` 后 `page.goto` HTTP；对 320 必须 `context.newCDPSession(page)` 调 `Emulation.setDeviceMetricsOverride({width:320,height:568,deviceScaleFactor:3,mobile:true})`，不能只改 window-size。预置 `voiceKeys:true` 且 `__voiceFake.fail=true` 触发 error 后打开设置；在两个视口分别执行 `page.evaluate` 读取 `innerWidth`、`document.documentElement.scrollWidth`、设置面板 `scrollWidth/clientWidth`、各控件 `getBoundingClientRect()`、`settings-summary` 与 `settings-toggle` 的矩形相交判断；断言 `scrollWidth <= innerWidth`、行高 ≥44、retry 宽高 ≥44、状态/进度/提示/重试 visible 且矩形在视口内、summary 与 gear 矩形不相交。
- H10：① `spawnSync("node",["/ws/cal_phone/tests/suite.mjs","--json"],{cwd:"/ws/cal_phone/tests"})` 解析 JSON：`results.length===18`、checks 总数 206、`every(pass)`。② 慢速服务器（模型响应总时长 >1.5s）+ 预置 voiceKeys，`goto` 后等 `data-voice-state` 为 loading/preparing，点 2,+,2,=，用 `Date.now()` 量到 result 文本 "4" 的耗时 <1000ms；收集 `pageerror` 数为 0。③ fail 态：1,+,2,= → 3，history-list 子元素数 ≥1；1,/,0,= → result "不能除以零"；随后 2,+,3,= → 5。④ `fs.readFileSync` 读 index.html：含 `</html>`、字节 ≥1024；正则匹配 `<(script|link|img)[^>]+(src|href)\s*=\s*["'](https?:)?//` 应为 0 个。
phase=first 时把验证逻辑写成脚本 `/ws/cal_phone/Telos/phone-calculator-voice-announcements-112105/evidence/verify.mjs`（接受轮号参数）并立即以 `node verify.mjs <round>` 运行；它按上面不变量逐条实测并写 `hard-r<N>.txt`：先写 `ROUND: <N>`、`ARTIFACT_SHA256: <64hex>`、`VERIFIER_SHA256: <64hex>`（脚本自身 sha256），再每条 `H<id> PASS|FAIL — 实测值/证据`，末行**严格** `HARD: PASS` 或 `HARD: FAIL (Hx,…)`。
若 runtime contract 的 `expected_review_states` 非 none：同一脚本还须把每个状态用 Playwright/无头 Chrome 渲染成**非空、非纯色、内容互不重复**的 PNG（≥ 240×160；真 320px 用 CDP `Emulation.setDeviceMetricsOverride`）落 `review-shots/r<N>/S<k>.png`——精确且仅这些文件；把带同样头的可见性/溢出/关键尺寸 `key=value` 实测写 `render-r<N>.txt`；写 `manifest-r<N>.json`：`round`、`artifact_sha256`、`verifier_sha256`、`metrics_sha256`、每张图的 `file/sha256/width/height`、`adhoc: []`。
phase=final 时**禁止读取、运行或修改 verify.mjs / ledger / 旧证据**，在你被启动的隔离 scratch cwd 中重新推导全套检查；临时测量只落当前 scratch 目录，最终回复给出裁决，由 CLI 保存（不要自行写 `-o` 路径）；首行同样是 `ROUND:`、`ARTIFACT_SHA256:`，末行同样严格。
HARD-VERIFY-PROMPT>>>

---

## 4. 软目标（独立像素评审 · 软闸 · agy -p Gemini 3.8 Flash (High)）
**维度：** 易懂、信息层级、状态反馈清晰度、响应式

**代表性状态：** 逐个走查（**枚举写在下方 SOFT-REVIEW-PROMPT 内**，随 prompt 一并抽取，保证自足）。产物不支持 URL 查询参数预置，状态由操作与假引擎驱动；截图由 §3 的量具渲染，评审只看副本像素 + 内联指标，永不看源码。

<<<SOFT-REVIEW-PROMPT
你是资深「用户界面 UI 评审官」。只评审、不改文件、不贴整页代码。运行时会追加真实 round/hash 与隔离目录内的该轮 PNG 清单；用可用的图像查看工具逐张看**真实像素**、以首次使用者视角通读。**你自身不起浏览器、不渲染；禁止搜索/读取业务源码、`ledger.md`、目标仓库规则或任何旧轮评审。**若本轮附图/指标不完整，输出 `EVIDENCE_INCOMPLETE` 并停止，绝不拿旧图或源码顶替。
**只看用户可见呈现是否清楚/好懂/好用；不判计算或规则正误（那是硬闸职责）。**
**运行时会把本轮机检指标原文内联进 prompt**（关键选择器的可见性/溢出/关键尺寸实测）：你的判断**不得与之矛盾**——若指标显示某元素 visible / 可滚动 / 无溢出，就不得断言它不可见/不可滚动/破版（截图 + 指标都对不上的判断＝幻觉，会被台账记为「评审误报」驳回）。
再依次走查以下代表性状态各一遍（每态对应本轮一张附图 `S<k>.png`）：
S1 | 默认设置：390×844 普通 HTTP 打开 /ws/cal_phone/index.html，点击右上齿轮 `[data-testid="settings-toggle"]`，面板滚到「语音播报」组；两个开关默认关，看新组的位置、标题、两个开关与提示文案是否一眼可懂
S2 | 就绪态：390×844，预置 voiceKeys+voiceResult 开启并用假引擎达到 `data-voice-state=ready`，面板打开显示「语音已就绪」，主界面摘要胶囊显示「已自定义」；看状态反馈与主界面胶囊是否清楚、不与齿轮抢空间
S3 | 失败态窄屏：CDP 320×568，假引擎首次初始化失败进入 `data-voice-state=error`，面板打开显示失败原因与「重试」；看 320px 下语音组是否无横向溢出、开关和重试按钮是否仍好点、错误说明是否可读
评审重点：首次使用者能不能在设置里一眼找到「按键播报 / 结果播报」并知道默认关、首次开要下载约 96MB？加载中、失败、就绪三种状态是否都能让人立刻明白「为什么现在没声」？320px 下语音组会不会挤成两行乱码或把「重试」挤出屏幕？状态胶囊会不会遮住齿轮或主界面数字？
先原样回显三行绑定头：`ROUND: <N>`、`ARTIFACT_SHA256: <64hex>`、`MANIFEST_SHA256: <64hex>`。
## P0 严重：每条严格一行 `P0-R<N>-<两位序号> | 区域 | 问题 | 为什么影响理解 | 建议修法`
## P1 重要：每条严格一行 `P1-R<N>-<两位序号> | 区域 | 问题 | 为什么 | 建议修法`
## P2 轻微（可选，不凑数）：同格式 `P2-R<N>-<两位序号> | …`
序号在每个级别内从 01 连续递增；末行计数必须与上面结构化 finding 行数完全一致。
末行：`P0=x P1=y P2=z`。
SOFT-REVIEW-PROMPT>>>

**P0 定义（硬性必修）：** 语音设置组在 320px 下横向溢出或控件被裁切/无法点击；加载、失败或就绪状态在设置面板与主界面都不可见，用户无法知道为什么没声；状态胶囊遮挡齿轮、主界面数字或键盘等关键操作区域。计算错误、播报内容正误、崩溃与规则文案属于硬闸，不交给软闸。

---

## 5. 运行与停止（命令按需选用，非逐行执行的脚本；停止数字只在 frontmatter）
    # gate=/ws/cal_phone/Telos/phone-calculator-voice-announcements-112105 · rendered by kekkai new — do not edit
    kekkai doctor --gate "/ws/cal_phone/Telos/phone-calculator-voice-announcements-112105" --host     # before round 1 and after any host change
    kekkai hard "/ws/cal_phone/Telos/phone-calculator-voice-announcements-112105"                     # r1: independent author writes evidence/verify.mjs; later rounds replay it
    kekkai soft "/ws/cal_phone/Telos/phone-calculator-voice-announcements-112105"                     # only after a hard PASS: fresh AGY review over copied pixels
    kekkai adhoc "/ws/cal_phone/Telos/phone-calculator-voice-announcements-112105" -- <command…>      # same-round measurement admissible as 误报 basis
    kekkai recast "/ws/cal_phone/Telos/phone-calculator-voice-announcements-112105" --reason "<why>"  # sick instrument: quarantine + fresh independent author (≤3 eras)
    kekkai hard "/ws/cal_phone/Telos/phone-calculator-voice-announcements-112105" --final             # terminal independent stamp at the stop candidate
    kekkai lint "/ws/cal_phone/Telos/phone-calculator-voice-announcements-112105" --post              # after round 1, on recovery, before STOP
    kekkai close "/ws/cal_phone/Telos/phone-calculator-voice-announcements-112105" --by <budget|host|instrument|oscillation|human> --blocker "<one sentence>"

- **轮次 = runner 提升进 `evidence/runs/hard-r<N>.txt` 的 canonical 盖章**；其余一切都是尝试（`evidence/attempts/`），不写台账、不占预算、不动 K。轮号由 runner 分配，不要手填；不要手跑 `node verify.mjs` 再拷文件进 runs/（缺 runner 头会被拒绝）。
- **`kekkai hard` 退出码**：`0` 提升为轮；`2` 尝试已归档（先读 `kekkai status --json` 和消息：若该轮已提升但 final 缺失，补 `--final`；否则修因后继续，不盲重跑）；`3` 重复/尝试上限——只有三条合法路：(1) change the business tree, (2) `kekkai recast --reason`, (3) `kekkai close --by <tag>`；`4` 规则拒绝（读消息，别原样重试）。管道故障同一输入有重试上限；无法修复就 `close`，不换措辞/增预算绕过。
- **软闸只在该轮 hard PASS 后有资格发言**；硬闸通过后修复主观 P1 要当轮记录取舍，后续同主张不翻案；不为纯偏好/P2制造新工作。每条 P0/P1 在 ledger「软闸 finding 处置」恰好一行（有效｜台账命中｜误报），派生数由处置行计算；命中按主张不按措辞，当轮拍板次轮生效；合法 verdict 前发现真实缺口时软闸列写 `—: <原因>`。
- **首个 hard PASS 轮 runner 自动跑审计 final**；final 与量具不一致 ⇒ final 的 FAIL 成立，只能修代码或 `kekkai recast`，永不再跑一次 final 试运气。
- **停止**：`converged` = 最新轮 hard PASS + 去重后 P0=0 + 连续 K 轮（K 为 CREED 常量）无台账外新增 P1 + 同 era 的独立 final PASS，且未超 frontmatter `max_rounds`；任何轮数（含 0）都可以 `kekkai close --by <budget|host|instrument|oscillation|human>` 写 blocked 终态并附 `blocker:` 行——绝不把 gate 停在 in-loop 而无 STOP。
- 第 1 轮后、恢复时、写 STOP 前各跑一次 `kekkai lint <本目录> --post`；`POST-IN-PROGRESS` 是运行中的预期警告。

---

## 附录 · 生成器判断记录（可审计的 taste↔structure 边界）
> 让执行者能看懂哪些是「结构强制」、哪些是「生成器的 taste 取舍」。不要复述停止数字（它们只在 frontmatter）。
- 输入矩阵以设计 §9.1 为准，另补 §4.4 的静态交付；设计 §9.2/§9.3 的真实引擎与真机试听不进入硬闸：需要 96MB 真实模型、目标手机与人的耳朵，属于人工前提，完成后按 §9.3 手工验收。
- 自动化用假引擎 + 小占位模型文件，因此 H7 只断言「进度是 0–100 的实测数字并最终就绪」，不锁死设计示例里的 `42%` 或 `8/17`（预合成数量 19 与状态分母是实现自由；软闸也不判这个）。
- 设置面板是新增用户可见组，故保留双闸；软闸只看三个代表性像素态，结果播报内容与队列行为全部在硬闸，避免软闸重复判「正误」。
- §2 的「视觉质感沿用现有设计变量」判为 soft-only：主观质感无法机检；其余红线都有 H 归属。
- `volatile: ["voice/"]`：`voice/` 是安装脚本生成的 96MB 运行资源且被 `.gitignore` 忽略，不属于源码差异；不得把它当作交付改动冻结。
- 部署验收用随机端口启动 `deploy/server.cjs` 并只读响应头，不向真实设备推送；首次 rsync 到手机服务器与 8444 真机试听仍是人工步骤。
- 测试注入契约写进 §1 是结构强制：否则独立验收器无法在无 96MB 资源、无网络的隔离环境里驱动 ready/error/retry 与队列时序。实现可自行选择内部模块结构，但必须保留该全局注入点与 `data-speech-*` 观测属性。
