---
# ── Kekkai Goal Gate v4 · frontmatter（唯一机读区；停止数字只在这里；矩阵/不变量内容只在正文表格）──
slug: phone-calculator-auto-equals-count-11202346-112023
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

# Kekkai Goal Gate · 自动按等号（输入满 N 笔后自动计算）

> **运行指令**：你是执行者（Codex / Claude Code / ZCode / Cursor 之一，由 handoff 指定；生成本 gate 的那次调用不得兼任）。
> 开跑前先 `kekkai doctor --gate <本目录> --host`；只有 `requires_display: true` 的真实桌面测量依赖解锁与屏幕权限，普通无头浏览器/逻辑测量不占屏。
> 读**本文件全文** + 同目录 [`./ledger.md`](./ledger.md)（决策台账），然后只用 §5 的命令块驱动验收，直到 §5 的停止条件；在已授权范围内自主推进，缺少外部输入时写明 blocked 与恢复条件。
> 生命周期编辑是唯一允许的 GOAL 改动：第 1 轮前 `status: draft → in-loop`；写 `converged` STOP 前 → `status: converged`；blocked 终态保持 `in-loop`。
> 除此之外 GOAL.md 只读：不改 frontmatter 数字、不改 prompt、不改变 §5 命令的操作、目标路径和关键参数（注释与空白不影响验收）。
> 教义在 Kekkai skill 的 `docs/CREED.md`、runner 契约在该 skill 的 `docs/RUNNER.md`——本文件不复述它们；`kekkai hard/soft` 的退出码与消息就是你的下一步。

## 1. 目标（一句话 + 背景 + 实施指导）
在统分设置里新增「自动按等号」笔数设置：用户设为 N（1–999）后，每提交一笔数字（屏幕「确认」、物理 Enter 或自动确认）计数一次；当本轮已提交的用户数字达到 N 笔且已选运算符时，立即执行与手动按 `=` 完全相同的计算，直接显示合计并写入一条历史，用户不必再按 `=`。N 为 0 或留空即关闭（默认）。基数是计算起点，**不计入** N 笔：启用基数 10 且设 N=3 时，用户仍需输入 3 个成绩，合计包含基数。

**背景（生成前实测，Playwright 1.64.0 / Chromium 无头，`file://` 加载 `/ws/cal_phone/index.html`）：**
- 选 `+` 后依次提交 `95`、`92`、`90`，表达式为 `95 + 92 + 90`，结果为空，`data-state=input`；只有点击 `[data-testid="key-equals"]` 后结果才变成 `277`，并产生 1 条历史。
- 自动确认设为 1 秒时，三笔数字会按停顿自动提交（表达式同样为 `95 + 92 + 90`、输入框清空），但结果仍为空——自动确认只提交，不计算，用户仍必须手动按 `=`。
- 现有设置面板的 testid 只有 `settings-auto-confirm`（23 档）、`settings-base-toggle`、`settings-base-value`、`settings-done` 等，没有任何「自动按等号」控件；`cal-phone.settings.v1` 只存 `autoConfirm`/`baseEnabled`/`baseValue`。
- 320×568 下设置对话框 304×383.7、max-height `calc(100dvh - 64px)`、`overflow-y:auto`，新增一个字段仍在可视与滚动范围内。

**实施指导**：
复用提交漏斗 `commitInput()`（屏幕「确认」按钮、物理 Enter、自动确认计时器都走它）和既有 `=` 路径 `calculate()`；在**成功提交一笔**之后检查是否触发，不要复制折叠或舍入逻辑。`operands` 数组只装用户提交的数字（基数由 `effectiveBase()` 单独处理、不在其中），因此计数直接用本轮 `operands.length`，天然满足「基数不计入」。建议在 `settings` 增加整数 `autoEquals`（0=关闭），随 `cal-phone.settings.v1` 读写字段 `autoEquals`；设置面板新增可见字段「自动按等号」，输入 `data-testid="settings-auto-equals"`（文本输入 + `inputmode="numeric"`，初值 `0`），提示 `data-testid="auto-equals-hint"` 说明「输入满 N 笔后自动按 =；0 或留空为关闭」。只有 1–999 的正整数生效；0/空为关闭；其他输入不生效并在 blur 时恢复上一个有效值。齿轮指示点与「已自定义」摘要的条件加入 `autoEquals > 0`。触发条件：`autoEquals > 0`、已选运算符、状态为 `input`、本轮用户已提交笔数 ≥ `autoEquals`；满足时同步调用 `calculate()`（与点击 `=` 同一条路径），每轮计算至多触发一次。不要在 `edit` 状态、空提交或未选运算符时触发；选择运算符本身也不触发（只在下一次成功提交时检查）；不要改动自动确认计时、基数、历史或输入语义。

> 外部前提：无账号、服务、真实设备或人工授权；无头 Playwright 1.64.0 已缓存在 `/ws/cal_phone/tests/node_modules`（浏览器缓存 `/root/.cache/ms-playwright/chromium-1248`）即可完成全部验收。设置持久化依赖 `localStorage`；被禁用时页面仍须照常工作（既有行为，H5 回归）。

## 2. 不变约束（父级红线 · 任何修改不得破坏）
> 每条红线**必须标注归属**：`[H#]`（由该硬不变量机检）或 `[soft-only: 原因]`（只能主观把关，写明为何无法机检）。绝对不能改的代码块优先给 sha256 机检形式。不允许留下既非 `[H#]` 也非 `[soft-only]` 的悬空红线。
- 设置面板新增「自动按等号」笔数字段：`[data-testid="settings-auto-equals"]` 可见、初值 `0`，可访问名称（`aria-label` 或关联 label）含「自动」「等号」，提示 `[data-testid="auto-equals-hint"]` 非空并含「等号」或 `=`；1–999 正整数生效，0/空关闭，非法输入不生效并在 blur 或关闭面板后恢复；持久化字段 `autoEquals`（整数）写入 `cal-phone.settings.v1`，reload 后保留；`autoEquals > 0` 时齿轮指示点与「已自定义」摘要可见 [H1]
- 触发语义：每次成功提交一笔数字（屏幕「确认」、物理 Enter、自动确认）后，若 `autoEquals > 0`、已选运算符、状态 `input` 且本轮用户提交笔数 ≥ N，则自动执行与手动 `=` 完全相同的计算并立即显示结果；每轮计算至多触发一次，输入框清空，`data-state=result` [H2]
- 计数口径：只计本轮用户提交的数字，基数不计入；空提交不计；退格撤回减少计数；`edit` 状态不触发；未选运算符不触发，选择运算符本身也不触发（只在下一次成功提交时检查）[H3]
- 等价性：相同数字序列下，自动触发与手动 `=` 的表达式文本、`result[data-value]`、`data-state`、历史条数与每条历史的 `data-operator`/`data-operands`/`data-base`/结果完全一致；触发后沿用运算符，下一轮达到 N 笔时再次触发；N=1 时单笔即计算 [H4]
- 既有行为不回归：`tests/suite.mjs` 18 场景全 PASS（含 `cold-start.keys-enabled`）；自动确认 23 档、暂停/重启/尾点不确认、手动确认、手动 `=`、基数与快照、历史编辑/删除/关闭、退格撤回、除零、设置持久化均保持 [H5]
- 窄屏与自包含：320×568（CDP）设置面板无横向溢出、`settings-done` 可到达、新输入控件可见且可操作；产物仍单文件自包含、`</html>` 闭合、无外部 script/link/img/font/@import；所有被检页面 pageerror=0、console error=0 [H6]
- 两个全新 context 对相同设置与序列产生一致的结果、历史与设置存储 [H7]
- 保留全部既有 `data-testid`、`data-*` 与 `cal-phone.settings.v1` 键；只能新增钩子，不得改名或删除 [H1/H5]

> 允许改动的范围豁免写在下面的定界块里（runner 会把它**逐字**内联进 first / recast / final 验收器的 runtime contract，避免首轮判合规、末轮判违规的判定分裂）。没有豁免就写 `无`。

<<<SCOPE-EXEMPTIONS
允许改动 /ws/cal_phone/index.html 与 /ws/cal_phone/tests/**：可新增设置控件、data-testid/data-* 钩子、scenarios 或辅助文件；必须保留既有 suite 断言与选择器语义。不得改动既有 Telos/** 证据、docs/** 规格、.agents/skills/** 或其它业务文件。
SCOPE-EXEMPTIONS>>>

---

## 3. 硬目标（独立确定性验收 · 硬闸 · codex exec）

**输入矩阵（采样覆盖；含边界与「哪些算、哪些拒答」）：**
- 笔数 N ∈ {0（关闭）, 1, 2, 3, 5, 999}；非法输入 ∈ {空, `-1`, `2.5`, `abc`, `1000`}
- 运算符 ∈ {`+`, `-`, `*`, `/`}
- 提交通道 ∈ {屏幕「确认」, 物理 Enter, 自动确认 t=1s}
- 已提交笔数 ∈ {0, N−1, N, 下一轮再次达到 N}
- 基数 ∈ {关闭, 10}
- 数值 ∈ {整数 `95`, 小数 `9.5`, 尾点 `9.`（手动确认）, 三位数 `100`}
- 特殊态 ∈ {空提交, 退格撤回, 除零 `5 / 0`, 历史编辑草稿, 未选运算符后选运算符, 阈值中途由 0 改 N}
- 视口 ∈ {390×844, 320×568 CDP `Emulation.setDeviceMetricsOverride`}
- 持久化 ∈ {全新 context, reload}
- 确定性 ∈ {两个全新 context 同设置同序列}
- 预期：恰好达到 N 笔即自动计算且与手动 `=` 等价；未达到不计算；基数不计入；关闭时不计算；非法设置值不生效；无页面错误。

**稳定测试入口：** `main.app[data-state]`、`main.app[data-operator]`、`input[data-testid="calc-input"]`、`[data-testid="keypad"]`、`[data-key="0"…"9", ".", "backspace", "enter", "equals"]`、`[data-testid="key-equals"]`、`[data-testid="key-op"]`、`[data-testid="op-picker"] button[data-op]`、`.display`、`[data-testid="expression"]`、`[data-testid="result"]`、`#state-label`、`[data-testid="history-item"]`、`[data-testid="history-expression"]`、`[data-testid="history-result"]`、`[data-testid="history-edit"]`、`[data-testid="settings-toggle"]`、`[data-testid="settings-panel"]`、`[data-testid="settings-auto-confirm"]`、`[data-testid="settings-base-toggle"]`、`[data-testid="settings-base-value"]`、`[data-testid="settings-done"]`、`[data-testid="settings-indicator"]`、`[data-testid="settings-summary"]`、`[data-testid="base-marker"]`、`[data-testid="edit-base-marker"]`、`[data-testid="edit-cancel"]`、`[data-testid="operand-input"]`、`[data-testid="operand-chip"]`、`[data-testid="operand-remove"]`、`[data-testid="undo-hint"]`、`[data-testid="auto-confirm-feedback"]`、`[data-testid="auto-confirm-progress"]`、`[data-testid="auto-confirm-countdown"]`。**本任务新增：** `[data-testid="settings-auto-equals"]`（笔数输入）、`[data-testid="auto-equals-hint"]`（设置提示）。

**不变量：**

| # | 不变量 | 硬闸怎么验（须真跑，非读源码目测） | 阈值 |
|---|---|---|---|
| H1 | 设置字段、生效范围与持久化 | 390×844 全新 context 开面板：读 `settings-auto-equals` 的可见性与初值、可访问名称（`aria-label`/关联 label）、`auto-equals-hint` 文本；填 `3` 后读 `localStorage["cal-phone.settings.v1"]` 的 `autoEquals`、指示点与摘要；reload 后再读控件值与存储；再分别填 `0`、`abc`、`2.5`、`1000`、`999` 复测 | 初值 `0`；可访问名称含「自动」「等号」；提示非空且含「等号」或 `=`；填 `3` 后 `autoEquals === 3`（整数）、指示点与摘要可见；reload 后控件值 `3` 且存储 `3`；`0` 关闭且指示点隐藏；非法值不改变存储、关闭面板后恢复上一个有效值；`999` 生效 |
| H2 | 达到 N 笔自动计算 | N=3 选 `+`，用屏幕键依次提交 `95`、`92`、`90`，每次提交后读 `data-state`、表达式、结果、输入框与历史；**全程不点 `key-equals`**。另测 N=1（`8`）、N=5（4 笔不触发/第 5 笔触发）、N=0（3 笔不触发，手动 `=` 得 `277`）、值 `100`/`9.5`/`9.` | 第 1/2 笔后 `input` 且结果空；第 3 笔后 `result`、表达式 `95 + 92 + 90`、`result[data-value]="277"`、输入空、历史 1 条（`data-operands=["95","92","90"]`）；N=1 得 `8`；N=5 第 4 笔仍空、第 5 笔出结果；N=0 不触发；`100 + 9.5 + 9.` 结果 `118.5` |
| H3 | 计数口径、提交通道与特殊态 | 自动确认 t=1+N=2；物理键盘 Enter+N=2；基数 10+N=3；空提交；退格撤回；未选运算符后选运算符；edit 草稿；N=2 的 `5 / 0`；阈值中途由 0 改 2 | 自动确认与物理 Enter 两笔后均得 `187`，随后 1.2s 内无重复；基数 10 下两笔不出结果、第三笔 `287` 且历史 `data-base="10"`；空提交不推进（仍 `1 +`、无历史）；撤回后补足 3 笔得 `8`；未选运算符 2 笔不计算，选 `+` 不立即计算，下一次提交得 `6`；edit 中追加数字后仍是 `edit` 且历史/结果不变；`5 / 0` 进入 `error`（`data-error="true"`、历史 0）；中途改 N=2 后面板关闭不计算，下一次提交得 `6` |
| H4 | 与手动 `=` 等价、可重复 | 两个全新 context：A 设 N=3，B 设 0；同样 `+` 提交 `95,92,90`，A 自动、B 点击 `=`；比较表达式、结果、状态、历史（条数、operator、operands、base、表达式、结果）；A 再提交 `85,86,87` 触发第二条；另测 N=1+基数 10 | A 与 B 的上述字段完全一致；A 每条计算恰好 1 条历史，500ms 内不新增；第二轮结果 `258`、历史 2 条（旧记录仍 `277`）；N=1+基数 10 输入 `5` 得 `15`、表达式 `10 + 5`、`data-base="10"` |
| H5 | 既有行为回归与窄屏 | `runSuite({ artifact })` 18 场景；设置 23 档；t=1 且 N=0 时只提交不计算；基数手动 `10 + 9.5 = 19.5`；`=` 直接提交草稿 `8`；320×568 CDP 开面板测溢出/可达/控件尺寸；设置后按「运算类型」不清设置 | 18/18 scenario PASS 且含 `cold-start.keys-enabled`；option values 恰 23 项、升序 `0,0.2,0.4,0.5,1,1.5,…,10`；t=1/N=0 两笔后结果空、手动 `=` 得 `14`；`19.5`；`8`；横向溢出 ≤1px、对话框水平在视口内、`settings-done` 滚动后可见、新输入高 ≥43.5px 且字号 ≥15.5px；reset 后 `autoEquals` 仍为 3 |
| H6 | 自包含与零页面错误 | Node 读产物文本断言 `</html>`、字节数、外部引用（`<script src>`/`<link href>`/`<img src>`/`@import`/`url(...)` 中的 `^(https?:)?//`）；汇总 H1–H5 全部 Playwright 页面的 pageerror 与 console error | `</html>` 存在、≥1024 字节、外部引用 0；pageerror=0、console error=0 |
| H7 | 两个全新 context 确定性 | 两个全新 context 各设 N=3、基数 10、`+`，提交 `95,92,90`；序列化状态、表达式、结果、历史、`localStorage` 设置键后深度比对 | 所有字段深度一致 |

<<<HARD-VERIFY-PROMPT
你是确定性验收器。**不要评价 UI 美观、不要改产物源码。**本 prompt 会被单独抽取喂给你（读不到 frontmatter 与上表），所以下面所有文件都写**绝对路径**、阈值写具体数值；runner 会在其后追加 `[RUNTIME CONTRACT]`（round / phase / gate_dir / evidence_dir / out_dir / artifact_sha256 / expected_review_states / SCOPE-EXEMPTIONS 原文），以它为准。
按本闸输入矩阵 / 不变量逐条**实际执行**验证：界面用 Playwright 操控稳定选择器并读值；本任务没有可提取的纯逻辑入口，全部检查都通过真实 UI 完成。采用项目已有工具与依赖；缺依赖或设备时明确拒答，不能伪装成代码 FAIL。禁止用主观语言/肉眼通读代替实测证据。
量具卫生（三条，写量具时逐条自查）：① 不得含写死的恒 FAIL/恒 PASS 常量判据；② 扫描类不变量的扫描面必须与 §3 声明逐字一致、不得自行扩张，且**不得包含 evidence/ 或 evidence/runs/**（自引用扫描面一旦被本循环必写的证据污染就永远翻不了绿）；③ 断言锚定稳定选择器/数据钩子而非用户可见文案原文（本闸无软闸，但设置字段的可访问名称与提示文本是产品要求，按下方 H1 明示的片段检查）；子进程/步骤超时 ≥ 单次实测耗时的 2 倍。
量具接口（两条，runner 靠它做变异检查与尝试隔离，缺一即拒绝提升）：① 环境变量 `KEKKAI_ARTIFACT` 存在时用它覆盖目标文件路径；② `KEKKAI_OUT_DIR` 存在时，`hard-r<N>.txt` / `render-r<N>.txt` / `manifest-r<N>.json` / `review-shots/r<N>/` 全部写到该目录下，而不是 evidence/runs（所有路径以脚本自身所在目录解析、不依赖 cwd）。
目标文件（绝对路径）：/ws/cal_phone/index.html
量具覆盖（本闸强制）：`verify.mjs` 的非注释代码中必须出现字面 `H1`、`H2`、`H3`、`H4`、`H5`、`H6`、`H7`（例如测试表键名或 ID 常量）；仅 `testH1`、动态 `H${id}` 或注释中的 ID 不算——`kekkai lint --post` 会静态检查。
宿主约束（本机硬限制，first/replay/final 通用）：**不要直接启动 Chrome/Chromium 二进制**（本机 seccomp 会以 `Operation not permitted` / SIGSYS 终止，并会耗尽整轮时间）；所有浏览器测量一律通过 Playwright：从 `/ws/cal_phone/tests/node_modules` 解析 `playwright`（可用 `createRequire('/ws/cal_phone/tests/package.json')` 或 `NODE_PATH=/ws/cal_phone/tests/node_modules`），用 `chromium.launch({ headless: true })`，或复用 `/ws/cal_phone/tests/lib/browser.mjs` 的 `launchBrowser()`/`openApp()`。**不要用 `rm -rf` / `rm -f` 清理临时目录**（codex 宿主会拒绝）；每次改用新的唯一临时目录即可。若默认 Playwright 启动仍被 workspace-write 宿主的 Chromium 自带沙箱拒绝（`sandbox_host_linux.cc ... Operation not permitted` / SIGTRAP），用 `chromiumSandbox: false` 与 `args: ['--disable-gpu']` 重试一次，然后立即继续断言。页面一律用 `file:///ws/cal_phone/index.html`（或 `KEKKAI_ARTIFACT` 覆盖值）加载；Chromium 下 `file://` 的 `localStorage` 可用，本闸依赖它。`phase=final` 同样适用：在 scratch cwd 直接用 Node + Playwright 重新推导 H1–H7，不得启动浏览器二进制。
本闸具体（全部以 `/ws/cal_phone/index.html` 为目标，除非 `KEKKAI_ARTIFACT` 覆盖；数值容差 1e-9）：
- **通用夹具**：`openApp({width=390,height=844})` = 新建 context（`viewport`、`isMobile:true`、`hasTouch:true`）→ 若 width===320，在 `page.goto` 前用 `context.newCDPSession(page)` 发 `Emulation.setDeviceMetricsOverride({width:320,height:568,deviceScaleFactor:2,mobile:true})` → `page.goto('file:///ws/cal_phone/index.html', {waitUntil:'load'})`；收集 `pageerror` 与 `console` type==='error'。`setSettings(page, {autoEquals, autoConfirm, base})` = 点 `settings-toggle` → 若给 autoEquals 用 `page.fill('[data-testid="settings-auto-equals"]', String(n))` → 若给 autoConfirm 用 `page.selectOption('[data-testid="settings-auto-confirm"]', String(t))` → 若给 base 勾 `settings-base-toggle` 并 `fill('settings-base-value', String(base))` → 点 `settings-done`。`commitNumber(page, '95')` = 逐位点 `[data-key="<digit>"]` 再点 `[data-key="enter"]`。每个 scenario 用全新 context。
- **H1（设置字段与持久化）**：390×844 全新 context 开面板。断言 `[data-testid="settings-auto-equals"]` 可见、`inputValue==='0'`；可访问名称用 `el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].textContent) || ''`，必须同时含「自动」与「等号」；`[data-testid="auto-equals-hint"]` 可见、`textContent.trim()` 非空且匹配 `/等号|=/`。`fill('3')` 后：`JSON.parse(localStorage.getItem('cal-phone.settings.v1')).autoEquals === 3`（严格整数）、`settings-indicator` 非 hidden、`settings-summary` 非 hidden；点 `settings-done` 后指示点仍可见；`page.reload()` 后开面板 `inputValue==='3'` 且存储仍 3。再 `fill('0')` → 存储 `autoEquals===0` 且指示点 hidden（本 context 的 autoConfirm=0、base 关闭）；reload 后控件值 `'0'`。非法值逐个在 autoEquals 为 0 时测：`fill('abc')`、`fill('2.5')`、`fill('1000')`、`fill('-1')`，每次点 `settings-done` 再开面板，断言 `inputValue==='0'` 且存储 `autoEquals===0`。最后 `fill('999')` → 存储 `999`、控件值 `'999'`。
- **H2（达到 N 笔自动计算）**：全新 context，`setSettings({autoEquals:3})`，点 `[data-op="+"]`。依次 `commitNumber('95')`、`('92')`、`('90')`，每次提交后立即读 `.app[data-state]`、`expression.textContent`、`result.textContent`、`result[data-value]`、`calc-input.value`、`history-item` 数量。第 1 笔后：`input`、结果空、表达式 `95 +`；第 2 笔后：`input`、结果空、表达式 `95 + 92 +`；第 3 笔后：`result`、表达式 `95 + 92 + 90`、`result[data-value]` 与文本均 `277`、输入空、历史 1 条且 `data-operands` 为 `["95","92","90"]`、`data-operator` 为 `+`、`history-result[data-value]` 为 `277`。**整个 scenario 不点 `key-equals`**。N=1：新 context，`{autoEquals:1}`，选 `+`，`commitNumber('8')` → 立即 `result`、结果 `8`、历史 1。N=5：`{autoEquals:5}`，选 `+`，提交 `1,2,3,4` 每笔后仍 `input` 且结果空，提交 `5` → 结果 `15`、历史 1。N=0：新 context 不设或 `{autoEquals:0}`，选 `+`，提交 `95,92,90` → `input`、结果空，点 `key-equals` → `277`。数值覆盖：`{autoEquals:3}`，选 `+`，提交 `100`、`9.5`、`9.`（点 `9`、`.`、`enter`）→ 表达式 `100 + 9.5 + 9.`、结果 `118.5`、历史 1。
- **H3（计数口径、提交通道与特殊态）**：（a）自动确认：`setSettings({autoEquals:2, autoConfirm:1})`，选 `+`，逐位点 `9`、`5`，等 1400ms → `input`、表达式 `95 +`、结果空；再点 `9`、`2`，等 1400ms → `result`、结果 `187`、历史 1、输入空；再等 1200ms → 历史仍 1、结果仍 `187`。（b）物理键盘：`{autoEquals:2}`，选 `+`，`keyboard.type('95')` + `keyboard.press('Enter')`，再 `type('92')` + `Enter` → 结果 `187`、历史 1。（c）基数：`{autoEquals:3, base:10}`，选 `+`，提交 `95`、`92` → 仍 `input`、结果空；提交 `90` → 表达式 `10 + 95 + 92 + 90`、结果 `287`、历史 1 且 `data-base="10"`、`base-marker` 文本含 `10`。（d）空提交：`{autoEquals:2}`，选 `+`，提交 `1`，在空输入上点 `enter` → `input`、表达式 `1 +`、结果空、历史 0；提交 `2` → 结果 `3`。（e）退格撤回：`{autoEquals:3}`，选 `+`，提交 `1`、`2`，点 `backspace`（输入为空、`input` 态）→ 表达式 `1 +`、结果空；提交 `3`、`4` → 结果 `8`、历史 1。（f）未选运算符：`{autoEquals:2}`，不选运算符，提交 `1`、`2` → `input`、表达式 `1 2`、结果空；点 `[data-op="+"]` → 仍无结果（不立即计算）；提交 `3` → 结果 `6`、表达式 `1 + 2 + 3`。（g）edit：`{autoEquals:0}`，选 `+`，提交 `5`、`5`，点 `key-equals` → 历史 1、结果 `10`；`setSettings({autoEquals:1})`；点 `history-edit` → `edit`；点 `3` 再点 `enter` → 仍 `edit`、历史仍 1、`result[data-value]` 仍 `10`（edit 不触发）；点 `edit-cancel` → `result`、结果仍 `10`。（h）除零：`{autoEquals:2}`，选 `/`，提交 `5` → 无结果；提交 `0` → `error`、`result[data-error="true"]`、文本 `不能除以零`、历史 0。（i）阈值中途变更：`{autoEquals:0}`，选 `+`，提交 `1`、`2` → `input`、结果空；`setSettings({autoEquals:2})` 并关闭 → 仍 `input`、结果空、历史 0（关闭面板不触发）；提交 `3` → 结果 `6`。
- **H4（与手动 `=` 等价、可重复）**：context A `{autoEquals:3}` 与 context B `{autoEquals:0}` 各选 `+` 并提交 `95,92,90`；A 自动出结果，B 点 `key-equals`。逐项比较：`expression.textContent`、`result.textContent`、`result[data-value]`、`data-state`、历史条数，以及每条历史的 `data-operator`、`data-operands`、`data-base`（无则 null）、`history-expression.textContent`、`history-result[data-value]`——必须完全一致。A 在第三笔提交后历史恰 1 条，等 500ms 后仍 1 条。A 继续提交 `85,86,87`（前两笔后仍 `input`，第三笔后）→ 结果 `258`、历史 2 条、最新一条 `data-operands=["85","86","87"]`、旧记录仍 `277`。N=1+基数：全新 context `{autoEquals:1, base:10}`，选 `+`，提交 `5` → 结果 `15`、表达式 `10 + 5`、历史 `data-base="10"`。
- **H5（既有行为回归与窄屏）**：`const { runSuite } = await import('file:///ws/cal_phone/tests/suite.mjs')`，`const results = await runSuite({ artifact })`；断言 `results.length === 18` 且全部 `pass`，`cold-start` 的 checks 含 id `cold-start.keys-enabled`。设置面板：全新 context 的 `settings-auto-confirm` 恰 23 个 option，values 依次为 `0,0.2,0.4,0.5,1,1.5,…,10`（升序）、默认选中 `0`。自动确认单独：`{autoConfirm:1}`（N=0），选 `+`，点 `9` 等 1400ms → 表达式 `9 +`、结果空；点 `5` 等 1400ms → 表达式 `9 + 5 +`、结果空；点 `key-equals` → `14`。基数手动：`{base:10}`，选 `+`，提交 `9.5`，点 `key-equals` → `19.5`、历史 `data-base="10"`。`=` 提交草稿：选 `+`，点 `8`，不按确认直接点 `key-equals` → 结果 `8`、历史 1。320×568（CDP）：开面板，读 `documentElement` 与 `body` 的 `scrollWidth-clientWidth`、`settings-panel` rect、`settings-auto-equals` 的 rect 与 `getComputedStyle().fontSize`、`settings-done` 的 rect（先 `scrollIntoViewIfNeeded()`）；阈值：横向溢出 ≤1px、panel `left≥0` 且 `right≤320`、done 的 `top≥0` 且 `bottom≤568`、新输入 `height≥43.5`、字号 ≥15.5px。reset 不清设置：`{autoEquals:3}`，点 `[data-testid="key-op"]` 后 `localStorage` 的 `autoEquals` 仍 3；重开面板控件值仍 `'3'`。
- **H6（自包含与零错误）**：`fs.readFileSync(artifact,'utf8')`，断言含 `</html>`、`Buffer.byteLength(text)>=1024`；外部引用正则扫描 `<script[^>]+src=|<link[^>]+href=|<img[^>]+src=|@import|url\(` 中的 `^(https?:)?//`，命中 0。汇总 H1–H5 创建的全部页面的 `pageerror` 与 `console` error，要求 0。产物被截断或无法解析时 H6 必须 FAIL，脚本不得整体崩溃。
- **H7（确定性）**：两个全新 context 各 `setSettings({autoEquals:3, base:10})`、选 `+`、提交 `95,92,90`；序列化 `{state, expression, resultValue, resultText, inputValue, history: [每个 item 的 data-operator/data-operands/data-base/expression/result], settings: JSON.parse(localStorage.getItem('cal-phone.settings.v1'))}`，`JSON.stringify` 后必须完全一致。
phase=first 时把验证逻辑写成脚本 `/ws/cal_phone/Telos/phone-calculator-auto-equals-count-11202346-112023/evidence/verify.mjs`（接受轮号参数）并立即以 `node verify.mjs <round>` 运行；它按上面不变量逐条实测并写 `hard-r<N>.txt`：先写 `ROUND: <N>`、`ARTIFACT_SHA256: <64hex>`、`VERIFIER_SHA256: <64hex>`（脚本自身 sha256），再每条 `H<id> PASS|FAIL — 实测值/证据`，末行**严格** `HARD: PASS` 或 `HARD: FAIL (Hx,…)`。
若 runtime contract 的 `expected_review_states` 非 none：同一脚本还须把每个状态用 Playwright 渲染成**非空、非纯色、内容互不重复**的 PNG（≥ 240×160；真 320px 用 CDP `Emulation.setDeviceMetricsOverride`）落 `review-shots/r<N>/S<k>.png`——精确且仅这些文件；把带同样头的可见性/溢出/关键尺寸 `key=value` 实测写 `render-r<N>.txt`；写 `manifest-r<N>.json`：`round`、`artifact_sha256`、`verifier_sha256`、`metrics_sha256`、每张图的 `file/sha256/width/height`、`adhoc: []`。本闸 soft 为 null，通常 `expected_review_states` 为 none，不需要截图。
phase=final 时**禁止读取、运行或修改 verify.mjs / ledger / 旧证据**，在你被启动的隔离 scratch cwd 中重新推导全套检查；临时测量只落当前 scratch 目录，最终回复给出裁决，由 CLI 保存（不要自行写 `-o` 路径）；首行同样是 `ROUND:`、`ARTIFACT_SHA256:`，末行同样严格。
HARD-VERIFY-PROMPT>>>

---

## 5. 运行与停止（命令按需选用，非逐行执行的脚本；停止数字只在 frontmatter）
    # gate=/ws/cal_phone/Telos/phone-calculator-auto-equals-count-11202346-112023 · rendered by kekkai new — do not edit
    kekkai doctor --gate "/ws/cal_phone/Telos/phone-calculator-auto-equals-count-11202346-112023" --host     # before round 1 and after any host change
    kekkai hard "/ws/cal_phone/Telos/phone-calculator-auto-equals-count-11202346-112023"                     # r1: independent author writes evidence/verify.mjs; later rounds replay it
    kekkai adhoc "/ws/cal_phone/Telos/phone-calculator-auto-equals-count-11202346-112023" -- <command…>      # same-round measurement admissible as 误报 basis
    kekkai recast "/ws/cal_phone/Telos/phone-calculator-auto-equals-count-11202346-112023" --reason "<why>"  # sick instrument: quarantine + fresh independent author (≤3 eras)
    kekkai hard "/ws/cal_phone/Telos/phone-calculator-auto-equals-count-11202346-112023" --final             # terminal independent stamp at the stop candidate
    kekkai lint "/ws/cal_phone/Telos/phone-calculator-auto-equals-count-11202346-112023" --post              # after round 1, on recovery, before STOP
    kekkai close "/ws/cal_phone/Telos/phone-calculator-auto-equals-count-11202346-112023" --by <budget|host|instrument|oscillation|human> --blocker "<one sentence>"

- **轮次 = runner 提升进 `evidence/runs/hard-r<N>.txt` 的 canonical 盖章**；其余一切都是尝试（`evidence/attempts/`），不写台账、不占预算、不动 K。轮号由 runner 分配，不要手填；不要手跑 `node verify.mjs` 再拷文件进 runs/（缺 runner 头会被拒绝）。
- **`kekkai hard` 退出码**：`0` 提升为轮；`2` 尝试已归档（先读 `kekkai status --json` 和消息：若该轮已提升但 final 缺失，补 `--final`；否则修因后继续，不盲重跑）；`3` 重复/尝试上限——只有三条合法路：(1) change the business tree, (2) `kekkai recast --reason`, (3) `kekkai close --by <tag>`；`4` 规则拒绝（读消息，别原样重试）。管道故障同一输入有重试上限；无法修复就 `close`，不换措辞/增预算绕过。
- **首个 hard PASS 轮 runner 自动跑审计 final**；final 与量具不一致 ⇒ final 的 FAIL 成立，只能修代码或 `kekkai recast`，永不再跑一次 final 试运气。
- **停止**：`converged` = 最新轮 hard PASS + 当前产物/业务树字节的同 era 独立 final PASS（hard-only 不需要软评或 K 确认轮），且未超 frontmatter `max_rounds`；任何轮数（含 0）都可以 `kekkai close --by <budget|host|instrument|oscillation|human>` 写 blocked 终态并附 `blocker:` 行——绝不把 gate 停在 in-loop 而无 STOP。
- 第 1 轮后、恢复时、写 STOP 前各跑一次 `kekkai lint <本目录> --post`；`POST-IN-PROGRESS` 是运行中的预期警告。

---

## 附录 · 生成器判断记录（可审计的 taste↔structure 边界）
> 让执行者能看懂哪些是「结构强制」、哪些是「生成器的 taste 取舍」。不要复述停止数字（它们只在 frontmatter）。
- **为什么按「笔数」而不是「位数」触发**：用户已确认计数单位是输入的数字笔数（每提交一笔算一笔），不是单个数字的字符位数；按位数会在每个成绩录入后立即结算，把统分提前结束。按笔数才对应「录入 N 个成绩后自动出合计」。
- **为什么基数不计入 N**：用户已确认基数是计算起点，不是用户要输入的成绩；计入会让启用基数时的实际录入数比设置值少一笔。`operands` 本来就不含基数，直接用其长度计数即可。
- **为什么只在成功提交时检查**：提交是「数量满足」的唯一时刻，触发点确定且可测；在打开/关闭设置面板或仅选择运算符时触发，会让「改设置」产生意外结算。阈值中途变小时，已提交的笔数保留，下一次提交按总数判断（文档化为 ≥ N 而非 == N）。
- **为什么用 `calculate()` 而不是新写折叠**：自动按等号必须与手动 `=` 完全等价（表达式、结果、历史、除零、编辑快照）；复用同一路径是该等价性的最简保证，也让 H4 的对照有意义。
- **为什么硬闸无软评**：本任务的目标是客观行为与持久化，设置文案只按可访问名称/提示的功能性片段检查；没有需要主观打分的呈现维度，按 Skill 指引用 `--soft none`。
- **为什么新控件用文本输入而非 select**：用户要设置的是任意正整数笔数（1–999），与现有基数输入一致的 `type="text" inputmode="numeric"` 足够；关闭用 0/空表示，避免多一档「关闭」选项改变现有自动确认下拉的 23 档语义。
- **为什么 320 布局只在设置面板内检查**：新功能只改设置面板，不新增流内反馈；计算态键盘几何由既有行为与 suite 覆盖，无需重复上一闸的固定坐标测量。
- **不创建冻结哈希**：改动横跨 HTML/CSS/JS 与设置面板，冻结源码会妨碍授权修复；回归由共享 suite 与逐条行为场景覆盖，H6 只保留自包含/闭合/无外链/零错误的结构红线。
- **320px 必须用 CDP**：无头 Chrome 的 `--window-size` 有约 500px 下限，窗口尺寸做不出真实 320px。
- **宿主约束写进 HARD prompt**：不得直接启动 Chrome/Chromium 二进制（seccomp 拒绝），一律 Playwright/共享套件；不得 `rm -rf`/`rm -f`。这避免把宿主限制误判成产品 FAIL 或耗尽整轮。
- **`volatile` 为空**：artifact 是单个文件；gate 证据位于本目录、不参与业务树验收，仓库也没有构建产物或日志。
