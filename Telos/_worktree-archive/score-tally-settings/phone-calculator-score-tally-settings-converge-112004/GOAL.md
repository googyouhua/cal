---
# ── Kekkai Goal Gate v4 · frontmatter（唯一机读区；停止数字只在这里；矩阵/不变量内容只在正文表格）──
slug: phone-calculator-score-tally-settings-converge-112004
version: 4
model_profile: astra-flash-3.8-v1  # 新任务冻结模型组合；执行中不可修改
status: converged                  # draft | in-loop | converged（blocked 终态保持 in-loop）
repo: /ws/cal_phone
artifact: /ws/cal_phone/index.html
# artifact_kind: url | app | service   # 仅 artifact: null 时启用；此时 ARTIFACT_SHA256 := TREE_SHA256
parent_gate: /ws/cal_phone/Telos/phone-calculator-score-tally-settings-111912/GOAL.md   # 子闸填父 GOAL.md 绝对路径；只继承 round-0 决策，不继承证据或 verify.mjs
verifiers:
  hard: codex exec                 # 固定驱动器；pin 与访问标志在 bin/runner.mjs（docs/RUNNER.md）
  soft: agy -p (Gemini 3.8 Flash (High))   # 固定驱动器；无软闸的 gate 为 null（kekkai new --soft none）
stop:
  max_rounds: 10
hard_invariants: [H1, H2, H3, H4, H5, H6, H7, H8, H9]
review_states: [S1, S2, S3, S4]
volatile: []                       # TREE_SHA256 排除的仓库相对路径（构建产物、日志等）；空数组即可
---

# Kekkai Goal Gate · 续闸：统分设置（自动回车 + 基数）独立收敛

> **运行指令**：你是执行者（Codex / Claude Code / ZCode / Cursor 之一，由 handoff 指定；生成本 gate 的那次调用不得兼任）。
> 开跑前先 `kekkai doctor --gate <本目录> --host`；只有 `requires_display: true` 的真实桌面测量依赖解锁与屏幕权限，普通无头浏览器/逻辑测量不占屏。
> 读**本文件全文** + 同目录 [`./ledger.md`](./ledger.md)（决策台账），然后只用 §5 的命令块驱动验收，直到 §5 的停止条件；在已授权范围内自主推进，缺少外部输入时写明 blocked 与恢复条件。
> 生命周期编辑是唯一允许的 GOAL 改动：第 1 轮前 `status: draft → in-loop`；写 `converged` STOP 前 → `status: converged`；blocked 终态保持 `in-loop`。
> 除此之外 GOAL.md 只读：不改 frontmatter 数字、不改 prompt、不改变 §5 命令的操作、目标路径和关键参数（注释与空白不影响验收）。
> 教义在 Kekkai skill 的 `docs/CREED.md`、runner 契约在该 skill 的 `docs/RUNNER.md`——本文件不复述它们；`kekkai hard/soft` 的退出码与消息就是你的下一步。

## 1. 目标（一句话 + 背景 + 实施指导）
在当前 `/ws/cal_phone/index.html`（sha256 `8ad74b699fff10e04095b9be125ccb0a99f292e361d52286ec036ea1410871c4`，父闸 r8 的实现）上独立重建证据链并收敛：设置面板、自动回车倒计时、基数、退格撤回、持久化与窄屏布局均已由父闸 8 轮打磨完成；本闸只重新验收这些字节，实测失败时才修改产品。

**实施指导**：
本闸是父闸 `phone-calculator-score-tally-settings-111912` 的续闸。父闸 r8 已是 hard PASS + 去重后 P0=0 + 台账外新增 P1=0，但因 era 1 r1、era 2 r2 的历史 final 无法由 runner 补盖（`--final` 只认最新轮）而 blocked by=host；子闸继承父闸的 6 条 round-0 取舍（设置状态摘要、自动确认撤回提示、撤回对象、空算式标识、当前运算符回显、撤回提示视觉权重），用全新量具与证据链重新验收当前字节。沿用现有 IIFE 状态机（`select / input / result / error / edit`）、`commitInput()` 作为唯一确认入口、float64 从左到右折叠、基数快照与旧记录按自身基数重算、退格逐笔撤回、`cal-phone.settings.v1` 持久化与 try/catch 降级。不要为了“重新验收”而重构、换框架或改动已拍板交互；只有硬指标实测失败时才修产品。

> 外部前提：无账号、服务、真实设备或人工授权依赖；无头 Chromium（Playwright 1.64.0，已缓存在 `/ws/cal_phone/tests/node_modules`）即可完成全部验收。设置持久化依赖浏览器 localStorage；若 localStorage 被禁用，应用必须在本页内照常工作（H2 覆盖）。

## 2. 不变约束（父级红线 · 任何修改不得破坏）
> 每条红线**必须标注归属**：`[H#]`（由该硬不变量机检）或 `[soft-only: 原因]`（只能主观把关，写明为何无法机检）。绝对不能改的代码块优先给 sha256 机检形式。不允许留下既非 `[H#]` 也非 `[soft-only]` 的悬空红线。
- 产物仍是单文件、自包含、`</html>` 闭合、字节数 ≥ 1024，且不引用 `http(s):` 或协议相对外部 script/link/img/font/@import [H8]
- 既有状态机与手动回车、等号、重置、历史、编辑、除零、粘性运算符语义不回归；`tests/suite.mjs` 全部场景 PASS [H6]
- 求值仍是 float64 从左到右折叠，不引入表达式解析器或任意精度；除零只检查除数 [H4]
- t 必须提供 0、0.5、1 … 10 秒完整 21 档，默认 0；设置键为 `cal-phone.settings.v1`，历史仍只存当前页面 [H2]
- 齿轮始终可见、可点、可点区域 ≥44×44；面板是 `<dialog>` modal，Esc/遮罩/完成均可关闭，焦点进入并回到齿轮 [H1]
- 自动确认只在输入框非空、不以 `.` 结尾、面板关闭、t>0 时触发；只确认不自动求值；手动回车、等号、重置、进入/取消编辑、打开设置都清除计时 [H3]
- 基数只在运算符已选后进入算式；0/负数/小数合法；历史保存当时基数快照；旧记录编辑用自身基数；基数永远不是除数 [H4]
- 退格撤回只影响操作数、不影响基数；`result/error` 态不撤回；操作数输入框内的退格由该输入框自己处理 [H5]
- 320×568 与 390×844 下（含面板打开、进度条/倒计时、基数标记、撤回提示、编辑草稿）无横向溢出；可见控件 ≥44×44、控件字号 ≥16px [H7]
- 所有验收场景不得产生 pageerror 或 console error [H8]
- 两个全新 context 执行相同设置与录入序列，历史逐字段一致 [H9]
- 父闸 round-0 的 6 条取舍必须保持为已实现状态，不在本闸重新翻案或改回裸点/无提示/无回显 [soft-only: 取舍已成文，属呈现层继承判断]
- 视觉质感沿用现有暗色 `--panel/--accent` 设计变量，不引入原生丑控件或破坏信息层级 [soft-only: 主观质感与层级无法机检]

> 允许改动的范围豁免写在下面的定界块里（runner 会把它**逐字**内联进 first / recast / final 验收器的 runtime contract，避免首轮判合规、末轮判违规的判定分裂）。没有豁免就写 `无`。

<<<SCOPE-EXEMPTIONS
允许改动 /ws/cal_phone/index.html 与 /ws/cal_phone/tests/**：可新增 scenarios 文件、更新 suite.mjs / lib/ / README，并保留 HEAD 上已更新的 cold-start.keys-enabled 断言；可新增本文件 §3 规定的 data-testid / data-* 测试钩子。不得改动既有 Telos/** 证据、docs/** 规格或其它业务文件。
SCOPE-EXEMPTIONS>>>

---

## 3. 硬目标（独立确定性验收 · 硬闸 · codex exec）

**输入矩阵（采样覆盖；含边界与「哪些算、哪些拒答」）：**
设置维度 ∈ {默认（t=0、基数关）、t=0.5、t=1、t=10、基数关、基数 10、基数 0、基数 -2.5、非法空基数、localStorage 抛错、reduced-motion}；交互维度 ∈ {齿轮开合/Esc/遮罩/完成、焦点回归、自动确认、计时重置、`9.` 结尾、面板暂停、手动回车、等号、重置、基数实时重绘、改基数、旧历史编辑、除零、退格撤回、编辑草稿撤回}；视口 ∈ {320×568（CDP 真机度量）, 390×844}；持久化 ∈ {全新 context、reload}；确定性 ∈ {两个全新 context 同序列}。未选运算符时基数不得拼入算式；`result/error` 态不得退格撤回；非法基数不得改变已生效值。

**稳定测试入口：** 既有 `main.app[data-state]`、`main.app[data-operator]`、`input[data-testid="calc-input"]`、`#state-label`、`[data-testid="expression"]`、`[data-testid="result"]`、`[data-testid="keypad"]`、`[data-testid="op-picker"] button[data-op]`、`[data-key="0"…"9", ".", "backspace", "enter", "equals"]`、`[data-testid="key-equals"]`、`[data-testid="key-op"]`、`[data-testid="history-item"]`、`[data-testid="history-result"]`、`[data-testid="history-edit"]`、`[data-testid="edit-draft"]`、`[data-testid="operand-input"]`、`[data-testid="operand-remove"]`；本闸沿用：`button[data-testid="settings-toggle"]`、`[data-testid="settings-indicator"]`、`dialog[data-testid="settings-panel"]`、`select[data-testid="settings-auto-confirm"]`、`input[data-testid="settings-base-toggle"]`、`input[data-testid="settings-base-value"]`、`button[data-testid="settings-done"]`、`[data-testid="auto-confirm-progress"]`（`data-active="true"` 表示计时中）、`[data-testid="base-marker"]`、`[data-testid="edit-base-marker"]`，以及 `[data-testid="history-item"]` 上的 `data-base` 属性（基数关闭时属性缺省；启用时写当时基数字符串，含 `"0"`）。

**不变量：**

| # | 不变量 | 硬闸怎么验（须真跑，非读源码目测） | 阈值 |
|---|---|---|---|
| H1 | 设置入口与面板开合 | Playwright 390×844 打开产物：读齿轮 `settings-toggle` 的 rect、`aria-haspopup`、`aria-expanded`；点击齿轮后读 `dialog[settings-panel]` 的 tagName/open/`:modal`、activeElement 是否在 dialog 内、`aria-expanded`；分别按 Esc、点“完成”、点击视口角落遮罩关闭，每次读 dialog.open、activeElement 是否回到齿轮；设 t=1 后关闭读 `settings-indicator` 可见性，再设回 t=0 且关基数读指示点消失 | 齿轮可见且 rect 宽高 ≥44；`aria-haspopup="dialog"`；打开后 open=true 且 `:modal`=true 且焦点在面板内、`aria-expanded="true"`；三种关闭后 open=false、焦点=齿轮；t=1 时指示点可见、复位后不可见；pageerror=0 |
| H2 | 设置默认值与持久化 | 全新 context 读 select 的 option values、selected、基数 checkbox、基数输入 disabled/value、localStorage 键；设 t=1、基数开 10 后关闭，读 `localStorage.getItem("cal-phone.settings.v1")` 非空；reload 后重读控件值并计算 `+9.5`；点“运算类型”读设置是否保留；计算一题后 reload 读历史；另开 context 用 `addInitScript` 让 `Storage.prototype.getItem/setItem` 抛错，打开页面后设 t=1 并输入 9.5 等自动确认 | option values 恰为 `["0","0.5",…,"10"]` 共 21 项且默认选 `"0"`；默认基数关且输入 disabled、值 `"0"`；键存在；reload 后 t=`"1"`、基数开、值 `"10"`，`+9.5` 结果 19.5；重置不清设置；reload 后历史 0；存储抛错时页面无 pageerror 且 t=1 自动确认仍生效 |
| H3 | 自动回车计时语义与反馈 | 按 t 档位与输入序列实测：t=0 输入 9.5 等 1.2s；t=0.5 输入 9.5 等 0.9s；t=1 输 9、等 0.6s、输 5、等 1.4s；t=0.5 输 `9.` 等 0.9s 后输 5；t=1 输 9.5 后打开面板等 1.4s 再关闭等 1.4s；t=1 输 9.5 后立刻手动回车等 1.4s；t=1 选 `+` 输 9.5 回车、输 9.2 后立刻 `=` 等 1.5s；t=1 输 9 后点“运算类型”等 1.4s；t=1 输 9 后 0.6s 换运算符再等 1.4s；读进度条 `auto-confirm-progress` 的可见性/`data-active`/高度；reducedMotion=reduce 的 context 重跑 t=0.5 场景 | t=0：1.2s 后 input 仍 `9.5` 且无操作数；t=0.5：input 清空、算式含 `9.5`、state=`input`、历史 0、result 无 `data-value`、状态行含 `9.5`；重置场景最终操作数=`95`（非 9 与 5 两笔）；`9.` 保持不确认、补 5 后确认 `9.5`；面板期间不确认、关闭后完整计时确认；手动回车只确认一次；`=` 后 result=18.7、历史=1、input 空；重置后 state=`select`、算式空；换运算符后重新计时并确认 9；计时中进度条可见、`data-active="true"`、高度 1–4px，确认后不再为 true；reduced-motion 下仍自动确认 |
| H4 | 基数作为第一笔数与快照 | 基数关：`+9.5/9.2/9.0`；基数 10 开：同序列；基数 100 `/4`；基数 0 `*5`；基数 -2.5 `+1`；冷启动未选运算符时输入 9.5 回车读算式，再选 `+`；基数 10 下选 `+` 回车 9.5 后把基数改为 20 读算式；清空基数输入并失焦后计算；基数 10 选 `/` 输 5、0、`=`；基数 10 算 `+2/3` 后改基数 20 再算 `+2/3`，读旧/新历史 `data-base` 与结果；点旧记录编辑，读 `edit-base-marker`、把第二个操作数改 5、按 `=`；读 `base-marker` 与历史算式文本 | 基数关结果 27.7；基数 10 结果 37.7，历史 `data-base="10"`、operands=["9.5","9.2","9.0"]、算式含 `10`；100/4=25；0*5=0 且 `data-base="0"`；-2.5+1=-1.5；未选运算符时算式不含 `10`，选 `+` 后含 `10` 且状态行含 `10`；改 20 后未完成算式含 `20` 不含 `10`；空基数失焦后仍按 10 计算且输入显示有限数；除零仍 error、历史不变；旧条目 `data-base="10"` 结果不变，新计算 `data-base="20"`；旧记录编辑 marker 含 `10`，改操作数后按 10 重算（10+5+3=18）且新条目 `data-base="10"`；`base-marker` 在启用且选运算符后可见 |
| H5 | 退格逐笔撤回与边界 | 基数关 `+` 回车 9.5、9.2 后连续点击 `[data-key="backspace"]`；再测 input 非空时退格；基数 10 下撤回后继续计算；`1+2=3` 结果态退格；`5/0` 错误态退格；基数 10 下编辑两操作数记录，读 chip 数，用 `page.keyboard.press("Backspace")` 撤最后一笔，再聚焦操作数输入框按 Backspace；冷启动空退格 | 每按一次表达式少最后一笔、状态行含被撤数字、历史 0、state=`input`；input 非空时仅删一个字符且表达式不变；两笔撤完算式仍含 `10`、不含操作数，随后 `+1/1=12`；结果态 result 仍 `3`、history 不变；错误态仍 `data-error="true"`；编辑草稿 chip 数 2→1，操作数输入框内 Backspace 不改 chip 数；冷启动退格无变化 |
| H6 | 既有共享套件全量回归 | 调用 `/ws/cal_phone/tests/suite.mjs` 的 `runSuite({ artifact })`（artifact 取 `KEKKAI_ARTIFACT` 或 `/ws/cal_phone/index.html`），收集全部 scenario 结果与 cold-start 的 check ids | 18 个 scenario 全部 pass（含 self-contained、layout、determinism）；cold-start 含 `cold-start.keys-enabled` 且不含 `cold-start.keys-disabled`；失败数 0 |
| H7 | 320/390 布局、触控与面板几何 | 320×568 用 CDP `Emulation.setDeviceMetricsOverride`、390×844 用 Playwright viewport；六态（冷启动、面板打开、t=10+基数 10+进度条计时中、基数标记、编辑草稿含基数标记、结果含两条历史）逐态读 documentElement/body 溢出、可见 `input/button/select`（checkbox 可用其 `<label>` 包围盒）rect 与字号；面板打开时读面板 rect 与齿轮 rect | 每态横向溢出 ≤1px；可见控件宽高 ≥43.5px；输入/选择控件字号 ≥15.5px；面板宽 ≤ min(320, viewportWidth−16)+1、左右均在视口内、面板 top ≥ 齿轮 bottom−2、面板右缘与齿轮右缘差 ≤16px |
| H8 | 自包含与零页面错误 | Node 读产物文本：`</html>`、字节数、外链计数；汇总 H1–H7 所有 page 的 pageerror 与 console error 事件 | `</html>` 存在、字节数 ≥1024、外链数 0；pageerror 总数 0、console error 总数 0 |
| H9 | 两个全新 context 确定性 | 两个全新 context 各自通过 UI 设 t=0、基数 10，执行 `+9.5/9.2/9.0`，序列化历史 `{operator, operands, data-base, result, expression}` 后深度比对 | 两次历史数组深度一致且 records=1 |

<<<HARD-VERIFY-PROMPT
你是确定性验收器。**不要评价 UI 美观、不要改产物源码。**本 prompt 会被单独抽取喂给你（读不到 frontmatter 与上表），所以下面所有文件都写**绝对路径**、基线写 **sha256 值**；runner 会在其后追加 `[RUNTIME CONTRACT]`（round / phase / gate_dir / evidence_dir / out_dir / artifact_sha256 / expected_review_states / SCOPE-EXEMPTIONS 原文），以它为准。
按本闸输入矩阵 / 不变量逐条**实际执行**验证：优先复用已有测试入口，逻辑用 Node 调用函数并断言返回值/异常；界面用 Playwright/jsdom 操控稳定选择器并读值。基线只用于本任务明确要求不可更改的范围，不能自行冻结整个源码或妨碍授权修复。采用项目已有工具与依赖；缺依赖或设备时明确拒答，不能伪装成代码 FAIL。禁止用主观语言/肉眼通读代替实测证据。
量具卫生（三条，写量具时逐条自查）：① 不得含写死的恒 FAIL/恒 PASS 常量判据；② 扫描类不变量的扫描面必须与 §3 声明逐字一致、不得自行扩张，且**不得包含 evidence/ 或 evidence/runs/**（自引用扫描面一旦被本循环必写的证据污染就永远翻不了绿）；③ 断言锚定稳定选择器/数据钩子而非用户可见文案原文（软闸可能正当地要求改文案）；子进程/步骤超时 ≥ 单次实测耗时的 2 倍。
量具接口（两条，runner 靠它做变异检查与尝试隔离，缺一即拒绝提升）：① 环境变量 `KEKKAI_ARTIFACT` 存在时用它覆盖目标文件路径；② `KEKKAI_OUT_DIR` 存在时，`hard-r<N>.txt` / `render-r<N>.txt` / `manifest-r<N>.json` / `review-shots/r<N>/` 全部写到该目录下，而不是 evidence/runs（所有路径以脚本自身所在目录解析、不依赖 cwd）。
量具覆盖（本闸强制）：`verify.mjs` 的非注释代码中必须出现字面 `H1`、`H2`、…、`H9`（例如测试表键名或 ID 常量）；仅 `testH1`、动态 `H${id}` 或注释中的 ID 不算——`kekkai lint --post` 会静态检查。
宿主约束（本机硬限制，first/replay/final 通用）：**不要直接启动 Chrome/Chromium 二进制**（本机 seccomp 会以 `Operation not permitted` / SIGSYS 终止，并会耗尽整轮时间）；所有浏览器测量一律通过 Playwright：从 `/ws/cal_phone/tests/node_modules` 解析 `playwright`，用 `chromium.launch({ headless: true })`，或直接调用 `/ws/cal_phone/tests/suite.mjs` 的 `runSuite`。**不要用 `rm -rf` / `rm -f` 清理临时目录**（codex 宿主会拒绝）；每次改用新的唯一临时目录即可，残留目录可保留。若某个宿主命令被拒绝，立即改用 Playwright/共享套件，不得展开浏览器二进制或系统调用调试。`phase=final` 同样适用：在 scratch cwd 直接用 Node + Playwright/共享套件重新推导 H1–H9，不得启动浏览器二进制。
final 阶段的唯一可行浏览器路径：复用 `/ws/cal_phone/tests/lib/browser.mjs` 的 `launchBrowser()`/`openApp()` 与 `/ws/cal_phone/tests/suite.mjs` 的 `runSuite()`；模块路径必须是 `/ws/cal_phone/tests/node_modules/playwright`（1.64.0），缓存浏览器是 `/root/.cache/ms-playwright/chromium-1248`。不要导入全局 playwright（它会寻找未缓存的 chromium-1255），不要搜索、下载或安装其它浏览器版本。若默认 Playwright 启动仍被 workspace-write 宿主的 Chromium 自带沙箱拒绝（`sandbox_host_linux.cc ... Operation not permitted` / SIGTRAP），用 Playwright 的 `chromiumSandbox: false` 与 `args: ['--disable-gpu']` 重试一次，然后立即继续 H1–H9 断言；不得展开系统调用或浏览器二进制调试。
目标文件（绝对路径）：/ws/cal_phone/index.html
本闸具体：复用 `/ws/cal_phone/tests/suite.mjs` 的 `runSuite` 做 H6；复用 `/ws/cal_phone/tests/lib/browser.mjs` 的 `launchBrowser`/`openApp` 与 `/ws/cal_phone/tests/lib/selectors.mjs` 的既有选择器做 H1–H5、H7–H9。Playwright 从 `/ws/cal_phone/tests/node_modules` 解析（可用 `createRequire('/ws/cal_phone/tests/package.json')` 或 `NODE_PATH=/ws/cal_phone/tests/node_modules`）。所有页面都收集 `pageerror` 与 `console` error。等待一律用“配置 t 的 1.4 倍以上”的固定 sleep（t=0.5 等 0.9s、t=1 等 1.4s），不要依赖动画帧。点击屏幕键必须用 `locator.click()`，不得直接写 `input.value`；物理键盘用 `page.keyboard.press()`。数值容差 1e-9，布局容差 0.5px。
逐条验法：
- H1：390×844 打开产物；读 `button[data-testid="settings-toggle"]` 可见性与 rect（宽高 ≥44、right>viewport/2、top<100）、`aria-haspopup`、`aria-expanded`。`locator.click()` 齿轮后读 `dialog[data-testid="settings-panel"]` 的 tagName/open/`matches(':modal')`、activeElement 是否在面板内、`aria-expanded`。分别：`page.keyboard.press("Escape")`；再开→点 `[data-testid="settings-done"]`；再开→`page.mouse.click(2, viewport.height-2)`。每次读 dialog.open 且 activeElement 是否为齿轮。通过 `select[data-testid="settings-auto-confirm"]` 选 `"1"` 关闭后读 `[data-testid="settings-indicator"]` 可见性；再设回 `"0"` 并取消基数后读指示点不可见。
- H2：全新 context 读 select 的 option values 恰为 `0,0.5,1,…,10` 共 21 项且 selected `"0"`；`input[data-testid="settings-base-toggle"]` unchecked、`input[data-testid="settings-base-value"]` disabled 且值 `"0"`；localStorage 键不存在或为空。设 t=1、勾选基数、填 `10`，关闭后 `localStorage.getItem("cal-phone.settings.v1")` 非空；`page.reload()` 后重读三控件并 `+9.5` 得 19.5；点 `[data-testid="key-op"]` 读设置仍保留；算一题后 reload 读历史 0。另开 context 在导航前 `addInitScript` 覆盖 `Storage.prototype.getItem/setItem` 抛错，打开页面后设 t=1、输入 9.5 等 1.4s 读自动确认生效且无 pageerror。
- H3：按表逐场景操作并读 `input[data-testid="calc-input"]` 的 value、`[data-testid="expression"]` 文本、`main.app[data-state]`、`[data-testid="history-item"]` 数、`[data-testid="result"]` 的 `data-value`、`#state-label` 文本。t 用 select 设置。进度条：t=1 输入 9 读 `[data-testid="auto-confirm-progress"]` 可见、`data-active="true"`、rect.height 1–4；等 1.4s 后读其不再 active。reduced motion：`browser.newContext({reducedMotion:'reduce'})` 重跑 t=0.5。
- H4：用设置面板开基数并填值；用屏幕键输入运算符与数字。基数关/10/100/0/-2.5 分别按表算。未选运算符时输 9.5 回车读算式；再点 `+` 读算式与 `#state-label`。实时重绘：基数 10、`+`、回车 9.5、把基数填 20，读算式。非法基数：清空 `settings-base-value` 后点“完成”再算，读结果与输入值是否有限。除零：基数 10、`/`、5、回车、0、回车、`=` 读 `result[data-error]`。快照：算 `+2/3`（基数 10）后改 20 再算 `+2/3`，读两条 `history-item` 的 `data-base` 与 `history-result[data-value]`；点 `history-edit` 打开旧记录，读 `[data-testid="edit-base-marker"]`，把第二个 `operand-input` `fill("5")` 后点 `=`，读新顶条 `data-base` 与结果。读 `[data-testid="base-marker"]` 可见性与文本。
- H5：屏幕键 `[data-key="backspace"]` 逐次点击；读表达式、`#state-label`、历史数、state。input 非空场景先输入 `95` 再退格。编辑态先 `history-edit` 打开两操作数记录，读 `[data-testid="operand-chip"]` 数，确保主输入框聚焦后 `page.keyboard.press("Backspace")`，再读 chip 数；随后点击第一个 `operand-input` 并按 Backspace，读 chip 数与输入值。
- H6：`const { runSuite } = await import('file:///ws/cal_phone/tests/suite.mjs')`，以 `runSuite({ artifact })` 运行；断言 results.length=18 且全部 pass；cold-start 的 checks 含 id `cold-start.keys-enabled` 且无 `cold-start.keys-disabled`。
- H7：320×568 先 `const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setDeviceMetricsOverride',{width:320,height:568,deviceScaleFactor:2,mobile:true});` 再导航；390×844 用 viewport。六态按表构造；每态读 `documentElement.scrollWidth-clientWidth`、`body.scrollWidth-clientWidth`；遍历可见 `input,button,select`（checkbox 取最近 `<label>` 或自身）、读 rect 与 `getComputedStyle().fontSize`；面板与齿轮均打开时读两 rect。
- H8：Node 读 `/ws/cal_phone/index.html`（或 `KEKKAI_ARTIFACT`）文本，断言 `</html>`、字节数、正则统计 `<script src>`/`<link href>`/`<img src>`/`@import`/`url(...)` 中 `^(https?:)?//` 数 0；汇总全部页面 pageerror/console error 为 0。
- H9：两个全新 context 各自通过 UI 设 t=0、基数 10，屏幕键跑 `+9.5/9.2/9.0`；把每条历史 `{operator, operands, data-base, result, expression}` 序列化后深度比对，records=1。
phase=first 时把验证逻辑写成脚本 `/ws/cal_phone/Telos/phone-calculator-score-tally-settings-converge-112004/evidence/verify.mjs`（接受轮号参数）并立即以 `node verify.mjs <round>` 运行；它按上面不变量逐条实测并写 `hard-r<N>.txt`：先写 `ROUND: <N>`、`ARTIFACT_SHA256: <64hex>`、`VERIFIER_SHA256: <64hex>`（脚本自身 sha256），再每条 `H<id> PASS|FAIL — 实测值/证据`，末行**严格** `HARD: PASS` 或 `HARD: FAIL (Hx,…)`。
若 runtime contract 的 `expected_review_states` 非 none：同一脚本还须把每个状态用 Playwright/无头 Chrome 渲染成**非空、非纯色、内容互不重复**的 PNG（≥ 240×160；真 320px 用 CDP `Emulation.setDeviceMetricsOverride`）落 `review-shots/r<N>/S<k>.png`——精确且仅这些文件；把带同样头的可见性/溢出/关键尺寸 `key=value` 实测写 `render-r<N>.txt`；写 `manifest-r<N>.json`：`round`、`artifact_sha256`、`verifier_sha256`、`metrics_sha256`、每张图的 `file/sha256/width/height`、`adhoc: []`。四态截图：S1 默认冷启动 390×844；S2 打开设置面板（t=1、基数 10 启用）390×844；S3 设 t=10、启用基数 10、选 `+`、回车 9.5、再输入 9.2（进度条与倒计时计时中）390×844；S4 320×568（CDP）打开设置面板且基数 10 已启用。每态截图前等待布局稳定，S3 必须在输入 9.2 后 1s 内截图以保证 `data-active` 仍为 true。
phase=final 时**禁止读取、运行或修改 verify.mjs / ledger / 旧证据**，在你被启动的隔离 scratch cwd 中重新推导全套检查；临时测量只落当前 scratch 目录，最终回复给出裁决，由 CLI 保存（不要自行写 `-o` 路径）；首行同样是 `ROUND:`、`ARTIFACT_SHA256:`，末行同样严格。
HARD-VERIFY-PROMPT>>>

---

## 4. 软目标（独立像素评审 · 软闸 · agy -p Gemini 3.8 Flash (High)）
**维度：** 易懂性、信息层级、交互反馈、响应式、视觉质感

**代表性状态：** 逐个走查（**枚举写在下方 SOFT-REVIEW-PROMPT 内**，随 prompt 一并抽取，保证自足）。产物没有 URL 查询参数路由，因此每态给「到达该态的操作步骤」；截图由 §3 的量具渲染，评审只看副本像素 + 内联指标，永不看源码。

<<<SOFT-REVIEW-PROMPT
你是资深「用户界面 UI 评审官」。只评审、不改文件、不贴整页代码。运行时会追加真实 round/hash 与隔离目录内的该轮 PNG 清单；用可用的图像查看工具逐张看**真实像素**、以首次使用者视角通读。**你自身不起浏览器、不渲染；禁止搜索/读取业务源码、`ledger.md`、目标仓库规则或任何旧轮评审。**若本轮附图/指标不完整，输出 `EVIDENCE_INCOMPLETE` 并停止，绝不拿旧图或源码顶替。
**只看用户可见呈现是否清楚/好懂/好用；不判计算或规则正误（那是硬闸职责）。**
**运行时会把本轮机检指标原文内联进 prompt**（关键选择器的可见性/溢出/关键尺寸实测）：你的判断**不得与之矛盾**——若指标显示某元素 visible / 可滚动 / 无溢出，就不得断言它不可见/不可滚动/破版（截图 + 指标都对不上的判断＝幻觉，会被台账记为「评审误报」驳回）。
再依次走查以下代表性状态各一遍（每态对应本轮一张附图 `S<k>.png`）：
S1 | 默认态（390×844，设置未启用）：直接打开 /ws/cal_phone/index.html；看齿轮与“运算类型”入口是否一眼可辨、统分主流程（输入框、算式/结果、键盘、历史）是否仍有清楚层级。
S2 | 设置面板打开（390×844，t=1、基数 10 已启用）：点击齿轮；看面板是否明显从齿轮下方弹出、遮罩是否让背景退后、t 选择/基数开关/基数输入/完成按钮是否清楚，以及齿轮旁的“已自定义”摘要与状态小点是否可理解。
S3 | 自动回车与基数生效（390×844，t=10、基数 10）：设 t=10 并启用基数 10，选 +，回车确认 9.5，再输入 9.2（进度条与倒计时计时中）后截图；看倒计时/2px 进度条/撤回提示是否清楚、基数在算式中是否自然、用户能否判断数字何时会被收走。
S4 | 窄屏 320×568 设置面板打开（基数 10 启用）：用 CDP 设备度量覆盖到 320 宽后打开设置面板；看面板与“已自定义”摘要是否仍在视口内、控件是否易点、键盘与设置是否互相遮挡、是否出现横向溢出或控件挤压。
评审重点：首次使用者能否在不读说明的情况下找到设置并理解状态摘要/小点含义？倒计时和基数标记会不会被误认为输入内容或错误？撤回提示是否在需要时可见而不喧宾夺主？面板与齿轮的归属关系是否明显？320px 下所有控件是否仍可读、可点、不溢出？
先原样回显三行绑定头：`ROUND: <N>`、`ARTIFACT_SHA256: <64hex>`、`MANIFEST_SHA256: <64hex>`。
## P0 严重：每条严格一行 `P0-R<N>-<两位序号> | 区域 | 问题 | 为什么影响理解 | 建议修法`
## P1 重要：每条严格一行 `P1-R<N>-<两位序号> | 区域 | 问题 | 为什么 | 建议修法`
## P2 轻微（可选，不凑数）：同格式 `P2-R<N>-<两位序号> | …`
序号在每个级别内从 01 连续递增；末行计数必须与上面结构化 finding 行数完全一致。
末行：`P0=x P1=y P2=z`。
SOFT-REVIEW-PROMPT>>>

**P0 定义（硬性必修）：** 设置面板在 320px 下超出视口或与齿轮脱离到无法判断归属；设置控件不可读或不可点；倒计时/进度条/基数标记/撤回提示遮挡输入内容或键盘；自动确认与撤回反馈完全不可见，用户不知道数字何时被收走。计算错误、崩溃、除零判定、测试断言失败属于硬闸，不得在这里重复判为 P0。

---

## 5. 运行与停止（命令按需选用，非逐行执行的脚本；停止数字只在 frontmatter）
    # gate=/ws/cal_phone/Telos/phone-calculator-score-tally-settings-converge-112004 · rendered by kekkai new — do not edit
    kekkai doctor --gate "/ws/cal_phone/Telos/phone-calculator-score-tally-settings-converge-112004" --host     # before round 1 and after any host change
    kekkai hard "/ws/cal_phone/Telos/phone-calculator-score-tally-settings-converge-112004"                     # r1: independent author writes evidence/verify.mjs; later rounds replay it
    kekkai soft "/ws/cal_phone/Telos/phone-calculator-score-tally-settings-converge-112004"                     # only after a hard PASS: fresh AGY review over copied pixels
    kekkai adhoc "/ws/cal_phone/Telos/phone-calculator-score-tally-settings-converge-112004" -- <command…>      # same-round measurement admissible as 误报 basis
    kekkai recast "/ws/cal_phone/Telos/phone-calculator-score-tally-settings-converge-112004" --reason "<why>"  # sick instrument: quarantine + fresh independent author (≤3 eras)
    kekkai hard "/ws/cal_phone/Telos/phone-calculator-score-tally-settings-converge-112004" --final             # terminal independent stamp at the stop candidate
    kekkai lint "/ws/cal_phone/Telos/phone-calculator-score-tally-settings-converge-112004" --post              # after round 1, on recovery, before STOP
    kekkai close "/ws/cal_phone/Telos/phone-calculator-score-tally-settings-converge-112004" --by <budget|host|instrument|oscillation|human> --blocker "<one sentence>"

- **轮次 = runner 提升进 `evidence/runs/hard-r<N>.txt` 的 canonical 盖章**；其余一切都是尝试（`evidence/attempts/`），不写台账、不占预算、不动 K。轮号由 runner 分配，不要手填；不要手跑 `node verify.mjs` 再拷文件进 runs/（缺 runner 头会被拒绝）。
- **`kekkai hard` 退出码**：`0` 提升为轮；`2` 尝试已归档（先读 `kekkai status --json` 和消息：若该轮已提升但 final 缺失，补 `--final`；否则修因后继续，不盲重跑）；`3` 重复/尝试上限——只有三条合法路：(1) change the business tree, (2) `kekkai recast --reason`, (3) `kekkai close --by <tag>`；`4` 规则拒绝（读消息，别原样重试）。管道故障同一输入有重试上限；无法修复就 `close`，不换措辞/增预算绕过。
- **软闸只在该轮 hard PASS 后有资格发言**；硬闸通过后修复主观 P1 要当轮记录取舍，后续同主张不翻案；不为纯偏好/P2制造新工作。每条 P0/P1 在 ledger「软闸 finding 处置」恰好一行（有效｜台账命中｜误报），派生数由处置行计算；命中按主张不按措辞，当轮拍板次轮生效；合法 verdict 前发现真实缺口时软闸列写 `—: <原因>`。
- **首个 hard PASS 轮 runner 自动跑审计 final**；final 与量具不一致 ⇒ final 的 FAIL 成立，只能修代码或 `kekkai recast`，永不再跑一次 final 试运气。
- **停止**：`converged` = 最新轮 hard PASS + 去重后 P0=0 + 连续 K 轮（K 为 CREED 常量）无台账外新增 P1 + 同 era 的独立 final PASS，且未超 frontmatter `max_rounds`；任何轮数（含 0）都可以 `kekkai close --by <budget|host|instrument|oscillation|human>` 写 blocked 终态并附 `blocker:` 行——绝不把 gate 停在 in-loop 而无 STOP。
- 第 1 轮后、恢复时、写 STOP 前各跑一次 `kekkai lint <本目录> --post`；`POST-IN-PROGRESS` 是运行中的预期警告。

---

## 附录 · 生成器判断记录（可审计的 taste↔structure 边界）
> 让执行者能看懂哪些是「结构强制」、哪些是「生成器的 taste 取舍」。不要复述停止数字（它们只在 frontmatter）。
- 子闸原因：父闸 `phone-calculator-score-tally-settings-111912` 的 r8 是 hard PASS、去重后 P0=0、台账外新增 P1=0，但 era 1 r1 与 era 2 r2 的“era 首个 PASS 独立 final”在宿主 seccomp 下三次超时/拒绝，runner 的 `--final` 只认最新轮，无法补历史 final；父闸因此 blocked by=host。子闸用 `--parent` 继承 6 条 round-0 取舍，重建全新量具与证据链，不改产品目标或阈值。
- 父闸的 6 条取舍（设置状态摘要、撤回提示、撤回对象、空算式标识、运算符回显、撤回提示视觉权重）已作为 round-0 行继承；子闸软评命中这些主张时按台账命中处置，不重新翻案。
- 硬闸没有 sha256 引擎基线：改动横跨整份单文件应用，冻结源码会妨碍授权修复；回归由共享套件（H6）覆盖，结构红线只保留自包含/闭合/无外链（H8）。
- 生成前实测共享套件：18 个 scenario 全 PASS（父闸已把 `cold-start.keys-disabled` 更新为 `keys-enabled`）。
- 320px 态必须用 CDP `Emulation.setDeviceMetricsOverride`（无头 Chrome 的 `--window-size` 有约 500px 下限），否则窄屏评审是假的。
- 宿主约束写进 HARD prompt：不得直接启动 Chrome/Chromium 二进制（seccomp 会拒绝），一律 Playwright/共享套件；不得用 `rm -rf`/`rm -f`，改用新的唯一临时目录。这解决父闸 final 三次超时的根因。
- 自动确认等待用固定 sleep 且按配置 t 的 1.4 倍以上取值，避免依赖动画帧；进度条只断言 `data-active` 与 2px 高度，不对动画曲线设阈值。
- `volatile` 为空：artifact 是单个文件，gate 证据未被 git 跟踪、不进入 TREE_SHA256，仓库也没有构建产物。
