---
# ── Kekkai Goal Gate v4 · frontmatter（唯一机读区；停止数字只在这里；矩阵/不变量内容只在正文表格）──
slug: phone-calculator-stable-keypad-countdown-112012
version: 4
model_profile: astra-flash-3.8-v1  # 新任务冻结模型组合；执行中不可修改
status: converged                  # draft | in-loop | converged（blocked 终态保持 in-loop）
repo: /ws/cal_phone
artifact: /ws/cal_phone/index.html
# artifact_kind: url | app | service   # 仅 artifact: null 时启用；此时 ARTIFACT_SHA256 := TREE_SHA256
parent_gate: null                  # 子闸填父 GOAL.md 绝对路径；只继承 round-0 决策，不继承证据或 verify.mjs
verifiers:
  hard: codex exec                 # 固定驱动器；pin 与访问标志在 bin/runner.mjs（docs/RUNNER.md）
  soft: null
stop:
  max_rounds: 10
hard_invariants: [H1, H2, H3, H4, H5, H6, H7]
volatile: []                       # TREE_SHA256 排除的仓库相对路径（构建产物、日志等）；空数组即可
---

# Kekkai Goal Gate · 自动确认短档位（0.2/0.4 秒）与键盘位置稳定

> **运行指令**：你是执行者（Codex / Claude Code / ZCode / Cursor 之一，由 handoff 指定；生成本 gate 的那次调用不得兼任）。
> 开跑前先 `kekkai doctor --gate <本目录> --host`；只有 `requires_display: true` 的真实桌面测量依赖解锁与屏幕权限，普通无头浏览器/逻辑测量不占屏。
> 读**本文件全文** + 同目录 [`./ledger.md`](./ledger.md)（决策台账），然后只用 §5 的命令块驱动验收，直到 §5 的停止条件；在已授权范围内自主推进，缺少外部输入时写明 blocked 与恢复条件。
> 生命周期编辑是唯一允许的 GOAL 改动：第 1 轮前 `status: draft → in-loop`；写 `converged` STOP 前 → `status: converged`；blocked 终态保持 `in-loop`。
> 除此之外 GOAL.md 只读：不改 frontmatter 数字、不改 prompt、不改变 §5 命令的操作、目标路径和关键参数（注释与空白不影响验收）。
> 教义在 Kekkai skill 的 `docs/CREED.md`、runner 契约在该 skill 的 `docs/RUNNER.md`——本文件不复述它们；`kekkai hard/soft` 的退出码与消息就是你的下一步。

## 1. 目标（一句话 + 背景 + 实施指导）
把 `/ws/cal_phone/index.html` 的自动确认计时反馈从「会推挤页面的流内元素」改为「不改变布局的位置稳定反馈」：倒计时出现、每秒更新、消失，以及自动确认后撤销提示出现时，屏幕键盘与所有按键的视口坐标都保持不变；用户在连续快速输入时可以一直点击同一组坐标，不会因为键盘滑动而丢字或误触。倒计时本身仍然可见、可读，并继续按设置自动确认。同时把自动确认档位从 `0、0.5、1 … 10` 扩展为 `0、0.2、0.4、0.5、1 … 10`（23 档）：0.5 秒仍嫌长的用户可以选 0.2 或 0.4 秒，新档位必须真实按 200ms/400ms 自动确认，且同样不得移动键盘。

**背景（生成前实测）**：
`[data-testid="auto-confirm-feedback"]` 目前在 `.panel` 的正常文档流中，显示时占 2px 进度条 + 4px 间距 + 约 16px 倒计时文字 + 3px 上边距。t>0 时它一出现就把 `.display` 与 `[data-testid="keypad"]` 下推：390×844 下键盘 top 从 242 变为 267.2（+25.2px），320×568 下从 256.1 变为 281.3（+25.2px）。自动确认提交后撤销提示 `[data-testid="undo-hint"]` 进入流内，键盘再落到 277.6（390）/291.4（320），不会回到输入前的位置。按输入前坐标快速连点 1→5，实测只录入 `1`，其余点击因键盘移位而落空——这就是用户报告的「快速连续输入被打断」。长数字还可能让倒计时或撤销提示换行，进一步改变高度。

**实施指导**：
沿用现有 IIFE、状态机（`select / input / result / error / edit`）、`startAutoConfirm()` / `stopAutoConfirm()` / `syncAutoConfirmCountdown()` / `commitInput()`、23 档 `settings.autoConfirm`（`AUTO_CONFIRM_STEPS` 升序为 0、0.2、0.4、0.5、1 … 10）、`cal-phone.settings.v1` 持久化、撤销提示与全部 data-testid，不重写计算或输入逻辑。只改「瞬时状态文字」的布局参与方式：让 `auto-confirm-feedback` 与 `undo-hint` 无论显示、隐藏、换行还是内容变化，都不会改变 `.display`、`[data-testid="keypad"]` 与每个 `[data-key]` 的几何位置。可选做法包括但不限于：为状态文字预留固定且足够的槽位并限制其换行/高度；把反馈移出文档流并用绝对/固定定位放到不遮挡控件与算式的位置；或让倒计时与撤销提示共享一个高度稳定的状态槽。**不要为了位置稳定而删除倒计时、删除撤销提示、降低键盘可点击尺寸，或把键盘推出 320×568 的可达范围。**

> 外部前提：无账号、服务、真实设备或人工授权依赖；无头 Playwright 1.64.0（已缓存在 `/ws/cal_phone/tests/node_modules`，浏览器缓存在 `/root/.cache/ms-playwright/chromium-1248`）即可完成全部验收。设置持久化依赖 localStorage；被禁用时页面仍须照常工作（既有行为，H5 回归）。

## 2. 不变约束（父级红线 · 任何修改不得破坏）
> 每条红线**必须标注归属**：`[H#]`（由该硬不变量机检）或 `[soft-only: 原因]`（只能主观把关，写明为何无法机检）。绝对不能改的代码块优先给 sha256 机检形式。不允许留下既非 `[H#]` 也非 `[soft-only]` 的悬空红线。
- 自动确认计时反馈是布局中性的：在相同逻辑状态（相同运算符、操作数、撤销提示与基数）下，倒计时隐藏与显示时 `[data-testid="keypad"]` 及每个 `[data-key]` 的视口矩形一致；从输入前到自动确认后、再到下一轮计时，键盘位置也不得移动 [H1]
- 倒计时反馈仍然可见：`[data-testid="auto-confirm-feedback"]` 非隐藏、进度条 `data-active="true"` 且高度 1–4px、文字含剩余秒数与待确认值；t>0 仍自动确认（含 0.2/0.4 的 200ms/400ms），t=0 永不确认 [H2]
- 倒计时期间按输入前坐标连续点击数字键，所有字符按序录入且不误触；跨过一次自动确认后继续按同一组坐标输入仍然正确 [H3]
- 320×568 与 390×844 下无横向溢出；键盘不因倒计时而新增视口外高度；可见控件尺寸与字号不回退；反馈不遮挡输入框、算式/结果或任何可交互控件 [H4]
- 既有状态机与交互不回归：手动确认、等号、重置、运算符、历史、编辑、除零、退格撤回、设置面板、自动确认计时重置/面板暂停/尾点不确认、基数与快照、持久化；`tests/suite.mjs` 18 个场景全 PASS [H5]
- 产物仍是单文件自包含、`</html>` 闭合、字节数 ≥1024、无外部 script/link/img/font/@import；所有被检页面 pageerror=0、console error=0 [H6]
- 两个全新 context 对相同设置与快速输入序列产生一致的键盘矩形、录入结果与历史 [H7]
- 保留 `[data-testid="auto-confirm-feedback"]`、`[data-testid="auto-confirm-progress"]`、`[data-testid="auto-confirm-countdown"]`、`[data-testid="undo-hint"]` 以及既有测试钩子；可新增 data-testid/data-*，不得改名或删除 [H5]
- 不删除倒计时或撤销提示来换取位置稳定；设置为 23 档（0、0.2、0.4、0.5、1 … 10，升序），存储键仍为 `cal-phone.settings.v1` [H2]

> 允许改动的范围豁免写在下面的定界块里（runner 会把它**逐字**内联进 first / recast / final 验收器的 runtime contract，避免首轮判合规、末轮判违规的判定分裂）。没有豁免就写 `无`。

<<<SCOPE-EXEMPTIONS
允许改动 /ws/cal_phone/index.html 与 /ws/cal_phone/tests/**：可调整反馈/撤销提示的布局与样式，可新增 scenarios 或辅助文件，可新增 data-testid / data-* 测试钩子；必须保留既有 suite 断言与选择器语义。不得改动既有 Telos/** 证据、docs/** 规格、.agents/skills/** 或其它业务文件。
SCOPE-EXEMPTIONS>>>

---

## 3. 硬目标（独立确定性验收 · 硬闸 · codex exec）

**输入矩阵（采样覆盖；含边界与「哪些算、哪些拒答」）：**
- 自动确认档位 t ∈ {0, 0.2, 0.4, 0.5, 1, 2, 10}
- 待输入值 ∈ {空, `9`, `95`, `9.`, `95.2`, `12345`, `123456789.5`}
- 操作数上下文 ∈ {未选运算符, 选中 `+`, 已有 1 笔且撤销提示可见, 基数 10 已启用}
- 视口 ∈ {390×844 Playwright viewport, 320×568 CDP `Emulation.setDeviceMetricsOverride`}
- 动效偏好 ∈ {no-preference, reduce}
- 状态 ∈ {idle, 倒计时刚出现, 倒计时文字更新后, 短档倒计时（0.2/0.4）, 自动确认后（撤销提示可见）, 下一轮倒计时}
- 交互 ∈ {屏幕键 `locator.click()`, 输入前坐标 `page.mouse.click()`, 手动“确认”, `=`, 设置面板开/关, 退格}
- 确定性 ∈ {两个全新 context 同设置同序列}
- 预期：每个状态下键盘与其同一逻辑状态的无倒计时测量值相同；倒计时仍可见；自动确认语义不变；无横向溢出、无遮挡、无页面错误。

**稳定测试入口：** `main.app[data-state]`、`main.app[data-operator]`、`input[data-testid="calc-input"]`、`[data-testid="keypad"]`、`[data-key="0"…"9", ".", "backspace", "enter", "equals"]`、`[data-testid="key-equals"]`、`[data-testid="key-op"]`、`[data-testid="op-picker"] button[data-op]`、`.display`、`[data-testid="expression"]`、`[data-testid="result"]`、`#state-label`、`[data-testid="history-item"]`、`[data-testid="history-result"]`、`[data-testid="history-edit"]`、`[data-testid="undo-hint"]`、`[data-testid="auto-confirm-feedback"]`、`[data-testid="auto-confirm-progress"]`、`[data-testid="auto-confirm-countdown"]`、`[data-testid="settings-toggle"]`、`[data-testid="settings-panel"]`、`[data-testid="settings-auto-confirm"]`、`[data-testid="settings-base-toggle"]`、`[data-testid="settings-base-value"]`、`[data-testid="settings-done"]`、`[data-testid="base-marker"]`、`[data-testid="edit-base-marker"]`、`[data-testid="operand-input"]`、`[data-testid="operand-chip"]`、`[data-testid="operand-remove"]`。

**不变量：**

| # | 不变量 | 硬闸怎么验（须真跑，非读源码目测） | 阈值 |
|---|---|---|---|
| H1 | 键盘位置对瞬时状态免疫 | 390×844 与 320×568 各开全新 context，设 t 后选 `+`，`scrollTo(0,0)`。先记录无倒计时参照值 `[data-testid="keypad"]` 与每个 `[data-key]` 的 rect；点击 `9` 后：t≥0.5 时轮询 `auto-confirm-feedback` 可见（≤500ms），在 150ms 与 600ms 记录；t=0.2/0.4 时在点击前装页内 `MutationObserver`，在 `hidden` 变为 false 的同一回调同步记录 rect（短窗口不依赖外部轮询）；自动确认后（撤销提示可见）记录，再输入 `8` 记录第二轮倒计时；覆盖 t=0.2/0.4/0.5/1/2/10、未选运算符、已有 1 笔、基数 10；再在 320 用 t=2 输入 `123456789.5` 让倒计时与撤销提示变长。另在同一逻辑状态内做“隐藏 vs 显示”配对比较 | 每个 rect 的 top/left/width/height 绝对差 ≤0.5px；键盘从未因倒计时出现、更新、消失或撤销提示出现而移动；长文本换行也不得移动 |
| H2 | 倒计时可见且自动确认语义不变 | t=2 输入 `9`：150ms 读 `auto-confirm-feedback` 可见性、`auto-confirm-progress` 的 `data-active` 与 rect 高度、`auto-confirm-countdown` 文本；900ms 再读文本；2.2s 后读表达式/输入框。t=0.2 输 `9`：用 MutationObserver/短轮询确认反馈可见并读进度条，0.35s 后读表达式；t=0.4 同法 0.6s 后读；t=0 输入 `9` 等 1.2s；t=0.5 等 0.9s；t=1 输 `9`、0.6s 后输 `5`、0.8s 后再等 0.6s；t=0.5 输 `9.` 等 0.8s 再补 `5`；t=1 输 `9` 开面板等 1.4s 后关闭再等 1.4s；t=1 输 `9` 立刻手动确认再等 1.4s；`reducedMotion:'reduce'` 下重跑 t=0.5 | 反馈 `hidden=false` 且 rect 高 ≥16；`data-active="true"` 且进度条高 1–4px；t=2 两次文本不同且含待确认值；t=0.2/0.4/0.5/2/reduce 自动确认一次、表达式含对应数字（0.2 在 0.35s 内、0.4 在 0.6s 内、0.5 在 0.9s 内）；t=0 不确认且反馈从未可见；计时重置后最终是一笔 `95`；`9.` 不确认、补 5 后确认 `9.5`；面板期间不确认、关闭后确认；手动确认只发生一次、无重复 |
| H3 | 固定坐标快速连续输入跨提交不丢字 | 390×844 与 320×568，t=2，选 `+`，`scrollTo(0,0)`；记录 `1`–`5` 键中心与键盘 rect；用 `page.mouse.click` 固定坐标依次点击 `1→5`，间隔 80ms，每次读输入框与键盘 rect；等 2.2s 自动确认后，再用**同一组输入前坐标**点击 `6→9`，间隔 80ms | 第一轮依次录入 `1,12,123,1234,12345`；第二轮依次录入 `6,67,678,6789`；每次键盘 rect 与参照值差 ≤0.5px；最终表达式含两笔 `12345` 与 `6789`，无丢字/重复/误触 |
| H4 | 窄屏、触控与不遮挡 | 320×568（CDP）与 390×844，逐态测：idle、t=1 倒计时、自动确认后、t=10+基数 10+倒计时。读 `documentElement`/`body` 的 `scrollWidth-clientWidth`、键盘与每个可见按键 rect、可见 `input/button/select` 的宽高与字号（checkbox 取其 `<label>`）、反馈 rect 与 `calc-input`/`.display`/键盘/每个可见 `input,button,select` 的交集 | 横向溢出 ≤1px；可见控件宽高 ≥43.5px；输入/选择控件字号 ≥15.5px；320 下键盘底边 ≤580px 且所有按键水平在 [0,320]；390 下键盘完全在视口；反馈与任何受保护元素的交集面积 ≤1px²、自身在视口内 |
| H5 | 既有计算、设置与撤回行为回归 | 调 `/ws/cal_phone/tests/suite.mjs` 的 `runSuite({ artifact })`；另用 Playwright 测：手动确认只一次、`=` 清计时、自动确认后按退格撤回该操作数、设置 23 档（含 0.2/0.4）与 `cal-phone.settings.v1` 持久化、面板暂停/关闭重启、尾点不确认、基数 10 下 `+9.5`=19.5、基数 10 算 `+2/3` 后改 20 再算并读两条历史 `data-base`、除零 `5/0` 为 error、旧记录编辑用自身基数 | 18/18 scenario PASS 且 cold-start 含 `cold-start.keys-enabled`；option values 恰为 23 项且含 0.2/0.4；设 0.2 reload 后仍生效并在 0.35s 内确认；`+9.5`=19.5；旧历史 `data-base="10"` 结果不变、新记录 `data-base="20"`；除零 `data-error="true"`；退格后表达式少一笔、历史 0；上述逐项一致 |
| H6 | 自包含与零页面错误 | Node 读产物文本，断言 `</html>`、字节数、外部引用（`<script src>`/`<link href>`/`<img src>`/`@import`/`url(...)` 中的 `^(https?:)?//`）；汇总 H1–H5 全部 Playwright 页面的 pageerror 与 console error | `</html>` 存在、≥1024 字节、外部引用 0；pageerror=0、console error=0 |
| H7 | 两个全新 context 确定性 | 两个全新 context 各自设 t=1、选 `+`，记录输入前键盘/按键 rect，按固定坐标输入 `1→5`，序列化输入框值、表达式、历史与设置键后深度比对 | 两次 rect 每边差 ≤0.5px；录入与历史数组深度一致 |

<<<HARD-VERIFY-PROMPT
你是确定性验收器。**不要评价 UI 美观、不要改产物源码。**本 prompt 会被单独抽取喂给你（读不到 frontmatter 与上表），所以下面所有文件都写**绝对路径**、阈值写具体数值；runner 会在其后追加 `[RUNTIME CONTRACT]`（round / phase / gate_dir / evidence_dir / out_dir / artifact_sha256 / expected_review_states / SCOPE-EXEMPTIONS 原文），以它为准。
按本闸输入矩阵 / 不变量逐条**实际执行**验证：界面用 Playwright 操控稳定选择器并读值；逻辑用 Node 调用函数并断言返回值/异常。冻结值只用于本任务明确要求不可更改的范围，不能自行冻结整个源码或妨碍授权修复。采用项目已有工具与依赖；缺依赖或设备时明确拒答，不能伪装成代码 FAIL。禁止用主观语言/肉眼通读代替实测证据。
量具卫生（三条，写量具时逐条自查）：① 不得含写死的恒 FAIL/恒 PASS 常量判据；② 扫描类不变量的扫描面必须与 §3 声明逐字一致、不得自行扩张，且**不得包含 evidence/ 或 evidence/runs/**（自引用扫描面一旦被本循环必写的证据污染就永远翻不了绿）；③ 断言锚定稳定选择器/数据钩子而非用户可见文案原文（本闸无软闸，但文案仍可能被授权修复改动）。子进程/步骤超时 ≥ 单次实测耗时的 2 倍。
量具接口（两条，runner 靠它做变异检查与尝试隔离，缺一即拒绝提升）：① 环境变量 `KEKKAI_ARTIFACT` 存在时用它覆盖目标文件路径；② `KEKKAI_OUT_DIR` 存在时，`hard-r<N>.txt` / `render-r<N>.txt` / `manifest-r<N>.json` / `review-shots/r<N>/` 全部写到该目录下，而不是 evidence/runs（所有路径以脚本自身所在目录解析、不依赖 cwd）。
目标文件（绝对路径）：/ws/cal_phone/index.html
量具覆盖（本闸强制）：`verify.mjs` 的非注释代码中必须出现字面 `H1`、`H2`、`H3`、`H4`、`H5`、`H6`、`H7`（例如测试表键名或 ID 常量）；仅 `testH1`、动态 `H${id}` 或注释中的 ID 不算——`kekkai lint --post` 会静态检查。
宿主约束（本机硬限制，first/replay/final 通用）：**不要直接启动 Chrome/Chromium 二进制**（本机 seccomp 会以 `Operation not permitted` / SIGSYS 终止，并会耗尽整轮时间）；所有浏览器测量一律通过 Playwright：从 `/ws/cal_phone/tests/node_modules` 解析 `playwright`（可用 `createRequire('/ws/cal_phone/tests/package.json')` 或 `NODE_PATH=/ws/cal_phone/tests/node_modules`），用 `chromium.launch({ headless: true })`，或复用 `/ws/cal_phone/tests/lib/browser.mjs` 的 `launchBrowser()`/`openApp()`。**不要用 `rm -rf` / `rm -f` 清理临时目录**（codex 宿主会拒绝）；每次改用新的唯一临时目录即可，残留目录可保留。若某个宿主命令被拒绝，立即改用 Playwright/共享套件，不得展开浏览器二进制或系统调用调试。`phase=final` 同样适用：在 scratch cwd 直接用 Node + Playwright/共享套件重新推导 H1–H7，不得启动浏览器二进制。若默认 Playwright 启动仍被 workspace-write 宿主的 Chromium 自带沙箱拒绝（`sandbox_host_linux.cc ... Operation not permitted` / SIGTRAP），用 `chromiumSandbox: false` 与 `args: ['--disable-gpu']` 重试一次，然后立即继续断言。
本闸具体（全部以 `/ws/cal_phone/index.html` 为目标，除非 `KEKKAI_ARTIFACT` 覆盖；几何容差 0.5px，数值容差 1e-9）：
- **H1（键盘位置对瞬时状态免疫）**：对 390×844 与 320×568 各开全新 context（320 用 `context.newCDPSession(page)` + `Emulation.setDeviceMetricsOverride({width:320,height:568,deviceScaleFactor:2,mobile:true})`，导航前设置）。设置 t 的方法：点 `[data-testid="settings-toggle"]`，`selectOption('[data-testid="settings-auto-confirm"]', String(t))`，点 `[data-testid="settings-done"]`。选 `+` 后 `window.scrollTo(0,0)`，记录 `keypadRect()` 与 `keyRects()`（`[data-key]` 每个键的 `getBoundingClientRect()`）。点击 `[data-key="9"]` 后：t≥0.5 时轮询 `[data-testid="auto-confirm-feedback"]` 的 `hidden` 为 false（超时 500ms），在 150ms 与 600ms 各记录一次；t=0.2/0.4 时在点击前 `page.evaluate` 装 `MutationObserver` 监听 feedback 的 `hidden`/`data-active`，在 `hidden` 变 false 的回调里同步把 `keypadRect()`、`keyRects()` 写入 `window.__stabilitySamples`（不要用外部 150ms 轮询，200ms 窗口会漏采）；等自动确认完成后记录“撤销提示可见”参照值；再点击 `[data-key="8"]` 记录第二轮的倒计时。覆盖 t=0.2/0.4/0.5/1/2/10；覆盖 320 下用 t=2 输入 `123456789.5`（逐键点击，等倒计时出现后读）以制造长文本换行；覆盖未选运算符与基数 10 两个上下文。每个 rect 的 top/left/width/height 与“同一逻辑状态无倒计时参照值”比较，绝对差必须 ≤0.5px；倒计时隐藏→显示→隐藏的配对比较也必须 ≤0.5px。若反馈自身 rect 高度为 0 或隐藏，H1 FAIL。
- **H2（倒计时可见且自动确认语义不变）**：t=2、选 `+`、输入 `9`；150ms 时读 `auto-confirm-feedback.hidden`、`auto-confirm-progress.getAttribute('data-active')` 与其 rect 高度、`auto-confirm-countdown.textContent`；900ms 再读文本，断言两次文本不同且都含 `9`；2.2s 后读 `[data-testid="expression"].textContent` 含 `9`、`calc-input` 值为空。t=0：输入 `9` 等 1.2s，输入仍 `9`、表达式空、反馈始终 hidden。t=0.2：输 `9` 后用 MutationObserver/10ms 轮询确认反馈可见并读 `data-active`/高度，0.35s 后表达式含 `9`；t=0.4：同法 0.6s 后表达式含 `9`。t=0.5：输入 `9` 等 0.9s，表达式含 `9`。t=1：输 `9`、等 0.6s、输 `5`、等 0.8s 时输入仍 `95`、表达式空；再等 0.6s 表达式含 `95` 且只一笔。t=0.5：输 `9.` 等 0.8s 输入仍 `9.`；补 `5` 后等 0.9s 表达式含 `9.5`。t=1：输 `9` 开设置面板等 1.4s 输入仍 `9`、表达式空；关闭面板等 1.4s 表达式含 `9`。t=1：输 `9` 后点 `[data-testid="enter"]` 立即手动确认，等 1.4s 表达式只含一笔 `9`。`reducedMotion:'reduce'` context 下 t=0.5 输 `9` 等 0.9s 仍确认。阈值：反馈可见时 rect.height ≥16；`data-active="true"`；进度条高 1–4px；t=2 文本含待确认值且至少变化一次；自动确认恰好 0 或 1 次，0.2/0.4 分别在 0.35s/0.6s 内完成。
- **H3（固定坐标快速连续输入）**：390×844 与 320×568，t=2，选 `+`，`scrollTo(0,0)`。记录 `1`–`5` 与 `6`–`9` 键中心的输入前坐标及键盘 rect。用 `page.mouse.click(cx, cy)` 依次点击 `1,2,3,4,5`，每次间隔 80ms，每次读 `calc-input.value` 与键盘 rect；预期依次为 `1,12,123,1234,12345`。等 2.2s 自动确认后，再用**输入前保存的同一组坐标**点击 `6,7,8,9`，间隔 80ms，预期依次为 `6,67,678,6789`。每次键盘 rect 与参照值差 ≤0.5px。最后表达式含 `12345` 与 `6789` 两笔；不得出现丢字、重复或误触（例如 `1` 后没有继续、或出现退格/确认副作用）。
- **H4（窄屏、触控与不遮挡）**：320×568（CDP）与 390×844。构造四态：idle（选 `+` 后）、t=1 倒计时（输入 `9` 后）、自动确认后（等 1.4s，撤销提示可见）、t=10 + 基数 10 + 倒计时（设置面板勾选 `settings-base-toggle`、填 `settings-base-value`=`10`，选 `+`，输入 `9`）。每态读 `document.documentElement.scrollWidth - document.documentElement.clientWidth` 与 `document.body` 同式；读键盘 rect 与每个可见 `[data-key]` rect；遍历可见 `input,button,select`（checkbox 取最近 `<label>` 的 rect）读宽高与 `getComputedStyle().fontSize`；读 `auto-confirm-feedback` rect 并与 `calc-input`、`.display`、`[data-testid="keypad"]`、每个可见 `input,button,select` 求交集面积。阈值：横向溢出 ≤1px；可见控件宽高 ≥43.5px；输入/选择控件字号 ≥15.5px；320 下键盘 `bottom` ≤580px 且每个键 `left≥0`、`right≤320`；390 下键盘完全在视口；反馈与任何受保护元素交集面积 ≤1px²、反馈自身在视口内。基数 10 态只要求无横向溢出、不遮挡与键盘不移动，不额外要求底边 ≤568（现状该态本身底边 575.5px）。
- **H5（既有行为回归）**：`const { runSuite } = await import('file:///ws/cal_phone/tests/suite.mjs')`，以 `runSuite({ artifact })` 运行；断言 `results.length === 18` 且全部 `pass`，cold-start 的 checks 含 id `cold-start.keys-enabled`。另用 Playwright 直接测：t=1 输 `9` 点 `[data-testid="enter"]` 后等 1.4s 表达式只一笔；t=1 选 `+` 输 `9` 确认、输 `9.2` 点 `[data-testid="key-equals"]` 等 1.5s，`result[data-value]` 为 `18.2`、历史 1 条、输入空；t=1 输 `9` 等 1.4s 后点 `[data-key="backspace"]`，表达式少一笔、历史 0；设置面板的 23 个 option values 恰为 `["0","0.2","0.4","0.5","1","1.5",…,"10"]`（升序）且默认 `"0"`，0.2/0.4 的 option 文本分别含 `0.2`/`0.4`；设 t=0.2 后 `localStorage.getItem("cal-phone.settings.v1")` 非空，reload 后仍为 `0.2`，输入 `9` 0.35s 内确认；设 t=1 reload 后仍为 `1`；基数 10 + `9.5` 结果 `19.5`；基数 10 算 `+2/3` 后改 20 再算，读两条 `history-item` 的 `data-base` 分别为 `10`/`20`、结果分别 `15`/`25`；`5/0` 后 `=` 得 `result[data-error="true"]`；旧记录 `history-edit` 的 `edit-base-marker` 含其自身基数。逐项等于上述值。
- **H6（自包含与零错误）**：Node 读目标文件文本，断言 `</html>` 存在、`Buffer.byteLength` ≥1024、外部引用 0；汇总 H1–H5 创建的全部页面的 `pageerror` 与 `console` error，要求 0。产物被截断或无法解析时 H6 必须 FAIL，脚本不得整体崩溃。
- **H7（确定性）**：两个全新 context 各设 t=1、选 `+`，记录输入前键盘/按键 rect，按固定坐标输入 `1→5`，序列化 `calc-input.value`、`expression.textContent`、全部 `history-item` 的 `{expression, result, data-base}` 与 `localStorage` 设置键，深度比对；rect 每边差 ≤0.5px，其余完全一致。
phase=first 时把验证逻辑写成脚本 `/ws/cal_phone/Telos/phone-calculator-stable-keypad-countdown-112012/evidence/verify.mjs`（接受轮号参数）并立即以 `node verify.mjs <round>` 运行；它按上面不变量逐条实测并写 `hard-r<N>.txt`：先写 `ROUND: <N>`、`ARTIFACT_SHA256: <64hex>`、`VERIFIER_SHA256: <64hex>`（脚本自身 sha256），再每条 `H<id> PASS|FAIL — 实测值/证据`，末行**严格** `HARD: PASS` 或 `HARD: FAIL (Hx,…)`。
若 runtime contract 的 `expected_review_states` 非 none：同一脚本还须把每个状态用 Playwright 渲染成**非空、非纯色、内容互不重复**的 PNG（≥ 240×160；真 320px 用 CDP `Emulation.setDeviceMetricsOverride`）落 `review-shots/r<N>/S<k>.png`——精确且仅这些文件；把带同样头的可见性/溢出/关键尺寸 `key=value` 实测写 `render-r<N>.txt`；写 `manifest-r<N>.json`：`round`、`artifact_sha256`、`verifier_sha256`、`metrics_sha256`、每张图的 `file/sha256/width/height`、`adhoc: []`。本闸 soft 为 null，通常 `expected_review_states` 为 none，不需要截图。
phase=final 时**禁止读取、运行或修改 verify.mjs / ledger / 旧证据**，在你被启动的隔离 scratch cwd 中重新推导全套检查；临时测量只落当前 scratch 目录，最终回复给出裁决，由 CLI 保存（不要自行写 `-o` 路径）；首行同样是 `ROUND:`、`ARTIFACT_SHA256:`，末行同样严格。
HARD-VERIFY-PROMPT>>>

---

## 5. 运行与停止（命令按需选用，非逐行执行的脚本；停止数字只在 frontmatter）
    # gate=/ws/cal_phone/Telos/phone-calculator-stable-keypad-countdown-112012 · rendered by kekkai new — do not edit
    kekkai doctor --gate "/ws/cal_phone/Telos/phone-calculator-stable-keypad-countdown-112012" --host     # before round 1 and after any host change
    kekkai hard "/ws/cal_phone/Telos/phone-calculator-stable-keypad-countdown-112012"                     # r1: independent author writes evidence/verify.mjs; later rounds replay it
    kekkai adhoc "/ws/cal_phone/Telos/phone-calculator-stable-keypad-countdown-112012" -- <command…>      # same-round measurement admissible as 误报 basis
    kekkai recast "/ws/cal_phone/Telos/phone-calculator-stable-keypad-countdown-112012" --reason "<why>"  # sick instrument: quarantine + fresh independent author (≤3 eras)
    kekkai hard "/ws/cal_phone/Telos/phone-calculator-stable-keypad-countdown-112012" --final             # terminal independent stamp at the stop candidate
    kekkai lint "/ws/cal_phone/Telos/phone-calculator-stable-keypad-countdown-112012" --post              # after round 1, on recovery, before STOP
    kekkai close "/ws/cal_phone/Telos/phone-calculator-stable-keypad-countdown-112012" --by <budget|host|instrument|oscillation|human> --blocker "<one sentence>"

- **轮次 = runner 提升进 `evidence/runs/hard-r<N>.txt` 的 canonical 盖章**；其余一切都是尝试（`evidence/attempts/`），不写台账、不占预算、不动 K。轮号由 runner 分配，不要手填；不要手跑 `node verify.mjs` 再拷文件进 runs/（缺 runner 头会被拒绝）。
- **`kekkai hard` 退出码**：`0` 提升为轮；`2` 尝试已归档（先读 `kekkai status --json` 和消息：若该轮已提升但 final 缺失，补 `--final`；否则修因后继续，不盲重跑）；`3` 重复/尝试上限——只有三条合法路：(1) change the business tree, (2) `kekkai recast --reason`, (3) `kekkai close --by <tag>`；`4` 规则拒绝（读消息，别原样重试）。管道故障同一输入有重试上限；无法修复就 `close`，不换措辞/增预算绕过。
- **首个 hard PASS 轮 runner 自动跑审计 final**；final 与量具不一致 ⇒ final 的 FAIL 成立，只能修代码或 `kekkai recast`，永不再跑一次 final 试运气。
- **停止**：`converged` = 最新轮 hard PASS + 当前产物/业务树字节的同 era 独立 final PASS（hard-only 不需要软评或 K 确认轮），且未超 frontmatter `max_rounds`；任何轮数（含 0）都可以 `kekkai close --by <budget|host|instrument|oscillation|human>` 写 blocked 终态并附 `blocker:` 行——绝不把 gate 停在 in-loop 而无 STOP。
- 第 1 轮后、恢复时、写 STOP 前各跑一次 `kekkai lint <本目录> --post`；`POST-IN-PROGRESS` 是运行中的预期警告。

---

## 附录 · 生成器判断记录（可审计的 taste↔structure 边界）
> 让执行者能看懂哪些是「结构强制」、哪些是「生成器的 taste 取舍」。不要复述停止数字（它们只在 frontmatter）。
- **为什么硬闸无软评**：本任务的目标是客观几何与行为（键盘 rect 不变、固定坐标点击不丢字、倒计时仍可见、布局不溢出），没有需要主观打分的呈现维度；按 Skill 指引用 `--soft none`。倒计时是否“好看”不在本闸范围，不能拿审美意见替代位置测量。
- **为什么 H1 覆盖整个自动确认周期而不只覆盖倒计时**：撤销提示与倒计时共用同一类“流内瞬时状态文字”机制，撤销提示恰在自动确认提交时出现；只修倒计时会留下 242→277.6（390）/256.1→291.4（320）的一次跳变，仍会在用户连续输入时移动键盘。H1/H3 因此要求从输入前到提交后、再到下一轮计时键盘都不动。
- **为什么 H3 用输入前坐标而不是 locator**：locator 会跟随元素移动，掩盖缺陷。生成前实测：按输入前坐标连点 `1→5`，现有实现只录入 `1`，其余点击落在移位后的空隙；这正是用户报告的快速输入被打断。固定坐标是对用户手指位置的确定性代理。
- **为什么纳入 0.2/0.4 秒**：用户明确 0.5 秒仍嫌长；两档必须真实按 200ms/400ms 生效，而不是只出现在下拉框。短窗口的倒计时测量用页内 `MutationObserver` 在 `hidden` 翻转的同一回调采样，避免 200ms 窗口的外部轮询漏采；`t=0.2` 不要求两次文本变化，只要求可见与按时确认。
- **320 键盘底边上限 580px**：现状最坏态（基数 10 + t=10 倒计时）底边 575.5px；上限 580 既保留现有可达性，又阻止“永久预留两行状态文字”把键盘推出屏幕。390 下键盘远在视口内，要求完全可见。
- **不创建冻结哈希**：修复横跨 CSS/HTML，冻结源码会妨碍授权修复；回归由共享套件 H5 与直接行为场景覆盖。H6 只保留自包含/闭合/无外链/零错误这些结构红线。
- **输入矩阵含长值 `123456789.5`**：倒计时与撤销提示都会把待确认值拼进文字；长值在 320 可能换行。若只用短数字，换行导致的键盘移动会漏检。
- **320px 必须用 CDP**：无头 Chrome 的 `--window-size` 有约 500px 下限，窗口尺寸做不出真实 320px。
- **宿主约束写进 HARD prompt**：不得直接启动 Chrome/Chromium 二进制（seccomp 拒绝），一律 Playwright/共享套件；不得 `rm -rf`/`rm -f`，改用新的唯一临时目录。这避免把宿主限制误判成产品 FAIL 或耗尽整轮。
- **`volatile` 为空**：artifact 是单个文件；gate 证据位于本目录、不参与业务树验收，仓库也没有构建产物或日志。
