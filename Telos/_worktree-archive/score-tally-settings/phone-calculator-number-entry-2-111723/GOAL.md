---
# ── Kekkai Goal Gate v4 · frontmatter（唯一机读区；停止数字只在这里；矩阵/不变量内容只在正文表格）──
slug: phone-calculator-number-entry-2-111723
version: 4
model_profile: astra-flash-3.8-v1  # 新任务冻结模型组合；执行中不可修改
status: converged                # draft | in-loop | converged（blocked 终态保持 in-loop）
repo: /ws/cal_phone
artifact: /ws/cal_phone/index.html
# artifact_kind: url | app | service   # 仅 artifact: null 时启用；此时 ARTIFACT_SHA256 := TREE_SHA256
parent_gate: null                  # 子闸填父 GOAL.md 绝对路径；只继承 round-0 决策，不继承证据或 verify.mjs
verifiers:
  hard: codex exec                 # 固定驱动器；pin 与访问标志在 bin/runner.mjs（docs/RUNNER.md）
  soft: null
stop:
  max_rounds: 10
hard_invariants: [H1, H2, H3, H4, H5, H6, H7, H8, H9, H10, H11, H12]
volatile: ["Telos/_worktree-archive"]                       # TREE_SHA256 排除的仓库相对路径（构建产物、日志、跨 worktree 归档证据等）；空数组即可
---

# Kekkai Goal Gate · 计算器数字输入可用性独立复核

> **运行指令**：你是执行者（Codex / Claude Code / ZCode / Cursor 之一，由 handoff 指定；生成本 gate 的那次调用不得兼任）。
> 开跑前先 `kekkai doctor --gate <本目录> --host`；只有 `requires_display: true` 的真实桌面测量依赖解锁与屏幕权限，普通无头浏览器/逻辑测量不占屏。
> 读**本文件全文** + 同目录 [`./ledger.md`](./ledger.md)（决策台账），然后只用 §5 的命令块驱动验收，直到 §5 的停止条件；在已授权范围内自主推进，缺少外部输入时写明 blocked 与恢复条件。
> 生命周期编辑是唯一允许的 GOAL 改动：第 1 轮前 `status: draft → in-loop`；写 `converged` STOP 前 → `status: converged`；blocked 终态保持 `in-loop`。
> 除此之外 GOAL.md 只读：不改 frontmatter 数字、不改 prompt、不改变 §5 命令的操作、目标路径和关键参数（注释与空白不影响验收）。
> 教义在 Kekkai skill 的 `docs/CREED.md`、runner 契约在该 skill 的 `docs/RUNNER.md`——本文件不复述它们；`kekkai hard/soft` 的退出码与消息就是你的下一步。

## 1. 目标（一句话 + 背景 + 实施指导）
确认当前 `index.html`（已由上一闸 round 4 在 artifact `d97565f0…` 上 H1–H12 全 PASS 修复）在全新独立量具下仍满足：冷启动数字键可用、先输入后选运算符不丢数字、物理键盘可输入并计算，且历史/编辑/除零/窄屏行为不回归。本闸的首要目标是独立重新验收当前字节；只有某个 H 实测失败时才修改产品。

**实施指导**：
复用现有 `select → input → result | error | edit` 状态机、`appendCharacter`/`deleteLastCharacter`/`commitInput`/`calculate` 与 float64 从左到右折叠口径，不引入表达式解析器或任意精度。注意契约变更：上一轮 `phone-calculator-keypad-111513`（在 `/ws/cal_phone-worktrees/keypad/`）的 H3/H6 曾明确断言 select 态 14/14 数字键 disabled、且 `page.keyboard.type("123")` 不改变输入框；本闸有意反转这两条产品决策，执行者按本闸执行，不要把本闸要求的行为当成回归。屏幕数字键盘（`button[data-key]`）在无运算符的冷启动态也必须 enabled；数字/小数点/退格不得因为「尚未选择运算符」而被丢弃，第一次点数字即进入可输入状态。`chooseOperator` 在用户已输入未提交数字时必须保留 `calc-input` 的值（可在输入前或输入后选运算符），不得清空刚输入的数字。结果态与错误态继续沿用粘性运算符：之后输入的第一个数字清空旧算式/结果并开始一次全新计算。物理键盘路径与屏幕键盘共用同一输入处理：数字、小数点、退格、回车、等号都能生效；若保留 `readonly`，就把监听放在 document/app 上，不要依赖 `fill()` 或直接写 DOM。历史记录、编辑草稿重算、除零错误态与「历史仅存在当前页面」的语义保持不变。继续使用单文件 HTML/CSS/JS、无外部依赖、移动端可见控件至少 44×44 CSS px、输入字号至少 16px、窄屏无横向溢出。外部前提：无需账号、服务、真实设备或人工授权；验收在无头 Chromium 中完成。上一闸（`phone-calculator-number-entry-111612`）的 round 4 已在当前字节上 H1–H12 全 PASS，但其 era 3 量具不满足 lint 的字面 H ID 覆盖，且独立 final 被宿主内存终止，故以 blocked by=instrument 收口；本闸不复用其量具、证据或终态，只继承当前业务字节。

> 外部前提（账号、服务、人工决定、设备权限）应在实施指导中明确；缺失时保留证据并 blocked，不把无法由代码修复的条件塞进硬不变量反复重跑。

## 2. 不变约束（父级红线 · 任何修改不得破坏）
> 每条红线**必须标注归属**：`[H#]`（由该硬不变量机检）或 `[soft-only: 原因]`（只能主观把关，写明为何无法机检）。绝对不能改的代码块优先给 sha256 机检形式。不允许留下既非 `[H#]` 也非 `[soft-only]` 的悬空红线。
- 页面仍必须是可自包含加载的单文件 `index.html`：`</html>` 闭合、字节数 ≥ 1024，且不引用 `http(s):` 或协议相对的外部 script/link/img/font/@import [H1]
- 冷启动（未选运算符、无历史）时数字键必须可用：`button[data-key="1"]` 等数字键 enabled，点击后 `calc-input` 出现对应数字；不得把「初始数字键 disabled」当作正确行为 [H2]
- 先选运算符再输入数字的既有流程不得回归：`+` → 12 → 回车 → 30 → 回车 → `=` 得到 42，历史顶条 `+["12","30"]=42` [H3]
- 先输入数字再选运算符不得丢失已输入数字：冷启动点击 1、2 后再点 `+`，`calc-input` 仍为 "12"；随后回车、输入 30、回车、`=` 仍得到 42 [H4]
- 物理键盘必须能输入数字并计算：键入 "12"、回车、选 `+`、键入 "30"、回车、按 `=` 得到 42；不得只支持鼠标点击 [H5]
- 结果态粘性运算符不回归：12+30+8=50 后，仅用屏幕键盘输入 5、回车、6、回车、`=` 得到 11，`main.app[data-operator]` 保持 `+` [H6]
- 历史与编辑重算不回归：编辑较早记录的操作数后按 `=` 追加新记录，原记录逐字段不变；刷新后历史为空（不写 localStorage/sessionStorage）[H7]
- 除零错误态不回归：`5 / 0` 显示错误、不写历史，数字键保持可用；切换运算符后能恢复并继续计算 [H8]
- 无运算符或空输入时按 `=` 必须是 no-op：不新增历史、不产生新的 `result[data-value]`、不抛错 [H9]
- 手机窄屏布局仍可用：320×568 与 390×844 视口下（冷启动、输入中、结果态含历史、编辑态含数字输入框）无横向溢出，可见交互控件宽高均 ≥ 44 CSS px，`calc-input` 与 `operand-input` 字号 ≥ 16px [H10]
- 所有验收场景不得产生 pageerror 或 console error [H11]
- 同一交互序列在两个全新浏览器上下文中必须产生完全相同的历史序列（确定性），不得依赖时间、随机数或局部存储 [H12]

> 允许改动的范围豁免写在下面的定界块里（runner 会把它**逐字**内联进 first / recast / final 验收器的 runtime contract，避免首轮判合规、末轮判违规的判定分裂）。没有豁免就写 `无`。

<<<SCOPE-EXEMPTIONS
无（业务改动仅限 /ws/cal_phone/index.html；不得放宽到仓库内其它业务文件或既有 Telos/ gate 证据）
SCOPE-EXEMPTIONS>>>

---

## 3. 硬目标（独立确定性验收 · 硬闸 · codex exec）

**输入矩阵（采样覆盖；含边界与「哪些算、哪些拒答」）：**
交互维度 ∈ {冷启动直接点数字, 先选运算符, 先输入再选运算符, 物理键盘输入, 结果态继续计算, 错误态恢复, 编辑历史重算, 空等号}；视口维度 ∈ {320×568, 390×844}。

- 冷启动空白页：数字键 enabled；点击 1、2 后 `calc-input` 值为 "12"；回车后算式包含 12；pageerror=0。
- 先选运算符：`+` → 12 → 回车 → 30 → 回车 → `=` 得 42，历史顶条 `+["12","30"]=42`。
- 先输入后选运算符：点击 1、2 → 点 `+` → `calc-input` 仍为 "12" → 回车 → 30 → 回车 → `=` 得 42。
- 物理键盘：键入 "12" → 回车 → 点 `+` → 键入 "30" → 回车 → 按 `=` 得 42。
- 结果态粘性：12+30+8=50 后，屏幕键盘输入 5、回车、6、回车、`=` 得 11，运算符仍为 `+`。
- 错误态：5 ÷ 0 显示 `data-error="true"` 且历史不变；数字键仍 enabled；点 `+` 后 1、回车、2、回车、`=` 得 3。
- 编辑历史：两条记录后编辑较早的 `+[12,30,8]`，把中间值改为 5，`=` 得 25，新顶条 `+["12","5","8"]=25`，原两条不变；reload 后 history=0。
- 空等号：冷启动或仅输入数字但未选运算符时按 `=` 不新增历史、无 `result[data-value]`、无异常。
- 窄屏：320×568、390×844 的冷启动/输入中/结果/编辑四态均 0 横向溢出、控件 ≥44×44、输入字号 ≥16。
- 确定性：同一序列在两个全新上下文产生逐字段一致的历史数组。

**稳定测试入口：** `main.app[data-state]`、`main.app[data-operator]`、`input[data-testid="calc-input"]`、`[data-testid="expression"]`、`[data-testid="result"]`（`data-value`/`data-error`）、`[data-testid="keypad"]`、`[data-testid="op-picker"] button[data-op]`、`[data-key="0"…"9", ".", "backspace", "enter", "equals"]`、`[data-testid="key-equals"]`、`[data-testid="key-op"]`、`[data-testid="history-item"]`（`data-operator`/`data-operands`）、`[data-testid="history-result"]`（`data-value`）、`[data-testid="history-edit"]`、`[data-testid="edit-draft"]`、`[data-testid="operand-input"]`、`[data-testid="operand-remove"]`。

**不变量：**

| # | 不变量 | 硬闸怎么验（须真跑，非读源码目测） | 阈值 |
|---|---|---|---|
| H1 | 自包含单文件 | Node 读取产物：断言含 `</html>`、字节数 ≥ 1024；统计 `<script src>` / `<link href>` / `<img src>` / `@import` / `url(...)` 中 http(s) 或协议相对外链数为 0；Playwright 以 `file://` 直载一次，收集 pageerror | 外链数 = 0，pageerror = 0，字节数 ≥ 1024 |
| H2 | 冷启动数字键可输入 | 全新 context（390×844, isMobile, hasTouch）打开产物；断言 `[data-key="1"]`…`[data-key="9"]`、`[data-key="0"]` 均 enabled；用 Playwright **click()** 依次点击 1、2（禁止 `fill()`/直接写 value），读 `calc-input` 值；点击 `[data-key="enter"]` 读算式 | 数字键全部 enabled；`calc-input` = "12"；算式包含 "12"；pageerror = 0 |
| H3 | 先选运算符流程回归 | 点击 `[data-op="+"]`；点击 1、2、回车、3、0、回车、`[data-testid="key-equals"]`；读 result `data-value` 与历史顶条字段 | result = 42；历史顶条 operator=`+`、operands=["12","30"]、result=42；history 数 = 1 |
| H4 | 先输入后选运算符保留数字 | 冷启动点击 1、2；点击 `[data-op="+"]`；读 `calc-input`；继续回车、点击 3、0、回车、`=` | 选运算符后 `calc-input` 仍 = "12"（不得清空）；最终 result = 42；历史顶条 operands=["12","30"] |
| H5 | 物理键盘输入 | 全新页面点击 `calc-input` 聚焦；`page.keyboard.type("12")`；`page.keyboard.press("Enter")`；点击 `+`；`page.keyboard.type("30")`；`Enter`；`page.keyboard.press("=")`；读 result 与历史 | 键入后 `calc-input` = "12"；最终 result = 42；历史顶条 `+["12","30"]=42` |
| H6 | 结果态粘性运算符 | 用屏幕键点击完成 12+30+8=50；再点击 5、回车、6、回车、`=`；读 result、`main.app[data-operator]`、历史数 | result = 11；operator 仍 = `+`；history = 2（两次计算各一条记录：`+["12","30","8"]=50` 与 `+["5","6"]=11`）；前一条历史快照不变 |
| H7 | 历史与编辑重算回归 | 完成 `+12/30/8=50` 与 `*2/3/4=24`；点击较早 `+` 记录的 `history-edit`；把中间 `operand-input` 改为 5；点 `=`；比对历史快照；reload 后统计历史 | 新顶条 `+["12","5","8"]=25`；原两条逐字段不变；reload 后 history = 0 |
| H8 | 除零错误态与恢复 | 选 `/`；点击 5、回车、0、回车、`=`；读 `result[data-error]` 与历史数；错误态断言数字键 enabled；点 `+` 再 1、回车、2、回车、`=` | 错误 `data-error="true"`；错误时历史数不变、数字键 enabled；恢复后 result = 3、error 清除、history +1 |
| H9 | 空等号 no-op | 冷启动直接点 `=`；另开新页点击 1、2 后（未选运算符）点 `=`；各读历史数与 result | 两种情形 history = 0；result 无 `data-value`；pageerror = 0 |
| H10 | 移动窄屏布局 | 320×568 与 390×844 各测冷启动/输入中/结果/编辑四态：读 documentElement/body `scrollWidth-clientWidth`，遍历可见 input/button 的 rect，读 calc-input 与 operand-input 字号 | 横向溢出 ≤ 1px；所有可见控件宽高 ≥ 43.5px；字号 ≥ 16px；数字键盘可见 |
| H11 | 无页面/控制台错误 | 汇总 H2–H10 所有 tracker 的 pageerror 与 console error | 两类计数均为 0 |
| H12 | 确定性 | 两个全新 context 各跑同一序列：`+12/30/8=50`、结果态 5/6=11、切 `*` 后 5/6=30；序列化每条的 operator/operands/result 后深度比对 | 两次历史数组深度一致；records = 3 |

<<<HARD-VERIFY-PROMPT
你是确定性验收器。**不要评价 UI 美观、不要改产物源码。**本 prompt 会被单独抽取喂给你（读不到 frontmatter 与上表），所以下面所有文件都写**绝对路径**、基线写 **sha256 值**；runner 会在其后追加 `[RUNTIME CONTRACT]`（round / phase / gate_dir / evidence_dir / out_dir / artifact_sha256 / expected_review_states / SCOPE-EXEMPTIONS 原文），以它为准。
按本闸输入矩阵 / 不变量逐条**实际执行**验证：优先复用已有测试入口，逻辑用 Node 调用函数并断言返回值/异常；界面用 Playwright/jsdom 操控稳定选择器并读值。基线只用于本任务明确要求不可更改的范围，不能自行冻结整个源码或妨碍授权修复。采用项目已有工具与依赖；缺依赖或设备时明确拒答，不能伪装成代码 FAIL。禁止用主观语言/肉眼通读代替实测证据。
量具卫生（三条，写量具时逐条自查）：① 不得含写死的恒 FAIL/恒 PASS 常量判据；② 扫描类不变量的扫描面必须与 §3 声明逐字一致、不得自行扩张，且**不得包含 evidence/ 或 evidence/runs/**（自引用扫描面一旦被本循环必写的证据污染就永远翻不了绿）；③ 断言锚定稳定选择器/数据钩子而非用户可见文案原文（软闸可能正当地要求改文案）；子进程/步骤超时 ≥ 单次实测耗时的 2 倍。
量具覆盖（本闸强制）：`verify.mjs` 的非注释代码中必须出现字面 `H1`、`H2`、…、`H12`（例如测试表键名或 ID 常量）；仅 `testH1`、动态 `H${id}` 或注释中的 `H1` 不算——`kekkai lint --post` 会静态检查覆盖。
量具接口（两条，runner 靠它做变异检查与尝试隔离，缺一即拒绝提升）：① 环境变量 `KEKKAI_ARTIFACT` 存在时用它覆盖目标文件路径；② `KEKKAI_OUT_DIR` 存在时，`hard-r<N>.txt` / `render-r<N>.txt` / `manifest-r<N>.json` / `review-shots/r<N>/` 全部写到该目录下，而不是 evidence/runs（所有路径以脚本自身所在目录解析、不依赖 cwd）。
目标文件（绝对路径）：/ws/cal_phone/index.html
本闸具体：**本闸的根因约束（必须遵守）**：当前产物（sha256 `d97565f096ed1c336eae9eac9ec75b1cc980bef6c0318027018a3f2291a8486a`）是上一闸 `phone-calculator-number-entry-111612` round 4 在 era 3 量具下 H1–H12 全 PASS 的字节；上一闸因量具缺少 lint 要求的字面 H ID 且独立 final 被宿主内存终止而 blocked by=instrument。本闸不复用其量具/证据，只从这些业务字节出发独立重新验收；若 H 实测失败才修改产品。历史背景：更早的 `phone-calculator-keypad-111513`（在 `/ws/cal_phone-worktrees/keypad/`）曾把「select 态数字键 disabled」和「聚焦后键入数字不改变 value」写成预期；本闸反转这两条契约，冷启动数字键若 `disabled`，H2 必须 FAIL。数字输入仍必须通过 **Playwright `locator.click()` 点击 `button[data-key="…"]`** 完成，禁止用 `fill()`、`evaluate` 或任何方式直接写 `input.value`；物理键盘路径必须用 `page.keyboard.type()` / `page.keyboard.press()`。

逐条验法：
- H1：读取 `/ws/cal_phone/index.html` 字节与文本；`</html>` 存在且 length ≥ 1024；用正则统计 `<script src>`、`<link href>`、`<img src>`、`@import`、`url(...)` 中匹配 `^(https?:)?//` 的引用 = 0；`file://` 直载一次并收集 pageerror = 0。
- H2：390×844、`isMobile:true`、`hasTouch:true` 的新 context；断言 `[data-key="0"]`…`[data-key="9"]` 全部 `isEnabled()`；依次 `click()` 数字 1、2；断言 `calc-input` 的 `inputValue()` 为 `"12"`；`click()` 回车（`[data-key="enter"]`）；断言 `[data-testid="expression"]` 文本包含 `"12"`；pageerror = 0。
- H3：点击 `[data-op="+"]`；点 1、2、回车、3、0、回车、`[data-testid="key-equals"]`；`Number.parseFloat(result.getAttribute("data-value"))` 与 42 比较，容差 1e-9；历史顶条 `data-operator`=`+`、`JSON.parse(data-operands)` 深度等于 `["12","30"]`、`history-result[data-value]`=42。
- H4：冷启动点击 1、2 后，点 `+`，断言 `calc-input` 的 `inputValue()` 仍为 `"12"`；回车、点 3、0、回车、`=`；断言 result = 42、顶条 operands=`["12","30"]`。
- H5：新页面 `click()` `calc-input` 聚焦；`keyboard.type("12")`；断言 inputValue=`"12"`；`keyboard.press("Enter")`；点击 `+`；`keyboard.type("30")`；`Enter`；`keyboard.press("=")`；断言 result=42、顶条 `+["12","30"]`。
- H6：屏幕键完成 12+30+8=50；再用屏幕键 5、回车、6、回车、`=`；断言 result=11、`main.app[data-operator]`=`+`、history=2；前一条历史快照 `+["12","30","8"]=50` 逐字段不变。
- H7：屏幕键完成 `+12/30/8=50` 与 `*2/3/4=24`；点较早 `+` 记录的 `history-edit`；把第二个 `operand-input` 用 `fill("5")`（编辑态输入框是普通可编辑输入，允许 fill）后点 `=`；断言新顶条 `+["12","5","8"]=25`、原两条快照不变；`reload` 后 history=0。
- H8：选 `/`；5、回车、0、回车、`=`；断言 `result[data-error]="true"`、history 数不变、数字键仍 `isEnabled()`；点 `+` 后再 1、回车、2、回车、`=`；断言 result=3、`data-error` 为 null、history +1。
- H9：冷启动直接点 `=`；另开新页点 1、2 后点 `=`；两次断言 history=0 且 `result[data-value]` 为 null、pageerror=0。
- H10：320×568 与 390×844（`isMobile:true`,`hasTouch:true`）各测冷启动、输入 "12" 后未提交、结果态（含两条历史）、编辑态（三个 operand-input）；每态读 `documentElement.scrollWidth-clientWidth`、`body.scrollWidth-clientWidth`，遍历所有可见 `input,button` 的 `getBoundingClientRect()`，读 `getComputedStyle` 字号；断言溢出 ≤1、宽高 ≥43.5、字号 ≥16、数字键盘可见。
- H11：汇总所有页面的 `pageerror` 与 `console` error 事件，断言均为 0。
- H12：两个全新 context 各跑同一序列（屏幕键 `+12/30/8=50`；结果态 5/6=11；切 `*` 后 5/6=30）；把每条历史的 `{operator, operands, result}` 序列化后 `JSON.stringify` 深度比对，records=3。

普通行为修复，不设 sha256 基线；唯一冻结的是 H1 的自包含/闭合/体积条件。容差 1e-9（数值），布局 0.5px。
phase=first 时把验证逻辑写成脚本 `/ws/cal_phone/Telos/phone-calculator-number-entry-2-111723/evidence/verify.mjs`（接受轮号参数）并立即以 `node verify.mjs <round>` 运行；它按上面不变量逐条实测并写 `hard-r<N>.txt`：先写 `ROUND: <N>`、`ARTIFACT_SHA256: <64hex>`、`VERIFIER_SHA256: <64hex>`（脚本自身 sha256），再每条 `H<id> PASS|FAIL — 实测值/证据`，末行**严格** `HARD: PASS` 或 `HARD: FAIL (Hx,…)`。
若 runtime contract 的 `expected_review_states` 非 none：同一脚本还须把每个状态用 Playwright/无头 Chrome 渲染成**非空、非纯色、内容互不重复**的 PNG（≥ 240×160；真 320px 用 CDP `Emulation.setDeviceMetricsOverride`）落 `review-shots/r<N>/S<k>.png`——精确且仅这些文件；把带同样头的可见性/溢出/关键尺寸 `key=value` 实测写 `render-r<N>.txt`；写 `manifest-r<N>.json`：`round`、`artifact_sha256`、`verifier_sha256`、`metrics_sha256`、每张图的 `file/sha256/width/height`、`adhoc: []`。
phase=final 时**禁止读取、运行或修改 verify.mjs / ledger / 旧证据**，在你被启动的隔离 scratch cwd 中重新推导全套检查；临时测量只落当前 scratch 目录，最终回复给出裁决，由 CLI 保存（不要自行写 `-o` 路径）；首行同样是 `ROUND:`、`ARTIFACT_SHA256:`，末行同样严格。
HARD-VERIFY-PROMPT>>>

---

## 5. 运行与停止（命令按需选用，非逐行执行的脚本；停止数字只在 frontmatter）
    # gate=/ws/cal_phone/Telos/phone-calculator-number-entry-2-111723 · rendered by kekkai new — do not edit
    kekkai doctor --gate "/ws/cal_phone/Telos/phone-calculator-number-entry-2-111723" --host     # before round 1 and after any host change
    kekkai hard "/ws/cal_phone/Telos/phone-calculator-number-entry-2-111723"                     # r1: independent author writes evidence/verify.mjs; later rounds replay it
    kekkai adhoc "/ws/cal_phone/Telos/phone-calculator-number-entry-2-111723" -- <command…>      # same-round measurement admissible as 误报 basis
    kekkai recast "/ws/cal_phone/Telos/phone-calculator-number-entry-2-111723" --reason "<why>"  # sick instrument: quarantine + fresh independent author (≤3 eras)
    kekkai hard "/ws/cal_phone/Telos/phone-calculator-number-entry-2-111723" --final             # terminal independent stamp at the stop candidate
    kekkai lint "/ws/cal_phone/Telos/phone-calculator-number-entry-2-111723" --post              # after round 1, on recovery, before STOP
    kekkai close "/ws/cal_phone/Telos/phone-calculator-number-entry-2-111723" --by <budget|host|instrument|oscillation|human> --blocker "<one sentence>"

- **轮次 = runner 提升进 `evidence/runs/hard-r<N>.txt` 的 canonical 盖章**；其余一切都是尝试（`evidence/attempts/`），不写台账、不占预算、不动 K。轮号由 runner 分配，不要手填；不要手跑 `node verify.mjs` 再拷文件进 runs/（缺 runner 头会被拒绝）。
- **`kekkai hard` 退出码**：`0` 提升为轮；`2` 尝试已归档（先读 `kekkai status --json` 和消息：若该轮已提升但 final 缺失，补 `--final`；否则修因后继续，不盲重跑）；`3` 重复/尝试上限——只有三条合法路：(1) change the business tree, (2) `kekkai recast --reason`, (3) `kekkai close --by <tag>`；`4` 规则拒绝（读消息，别原样重试）。管道故障同一输入有重试上限；无法修复就 `close`，不换措辞/增预算绕过。
- **首个 hard PASS 轮 runner 自动跑审计 final**；final 与量具不一致 ⇒ final 的 FAIL 成立，只能修代码或 `kekkai recast`，永不再跑一次 final 试运气。
- **停止**：`converged` = 最新轮 hard PASS + 当前产物/业务树字节的同 era 独立 final PASS（hard-only 不需要软评或 K 确认轮），且未超 frontmatter `max_rounds`；任何轮数（含 0）都可以 `kekkai close --by <budget|host|instrument|oscillation|human>` 写 blocked 终态并附 `blocker:` 行——绝不把 gate 停在 in-loop 而无 STOP。
- 第 1 轮后、恢复时、写 STOP 前各跑一次 `kekkai lint <本目录> --post`；`POST-IN-PROGRESS` 是运行中的预期警告。

---

## 附录 · 生成器判断记录（可审计的 taste↔structure 边界）
> 让执行者能看懂哪些是「结构强制」、哪些是「生成器的 taste 取舍」。不要复述停止数字（它们只在 frontmatter）。
- **为什么上一轮没有发现**：当前产物不是漏检。`phone-calculator-keypad-111513` 存在于 `/ws/cal_phone-worktrees/keypad/Telos/`，其 r2 量具点击真实 `[data-key]` 按钮，并在 artifact `63039282…` 上 H1–H12 全 PASS；它的 H3/H6 明确要求 `select` 态数字键 14/14 disabled、聚焦后 `keyboard.type("123")` 不改变输入框。也就是说，「冷启动点数字没反应」被那一轮契约**验成了正确行为**。本闸反转该契约，并把冷启动数字键 enabled 与物理键盘输入写成新的硬断言。
- **worktree 证据未回流**：keypad 分支的合并提交只包含 `index.html`；`Telos/phone-calculator-keypad-111513/` 在 worktree 里是未跟踪目录，所以主 worktree 看不到那份证据。不能直接把它拷进主 worktree——GOAL 的 `repo`/`artifact` 路径与 `TREE_SHA256` 绑定的是 worktree，拷贝会让 `lint --post` 的树哈希不匹配。本闸在 ledger 的「验证资产」里登记该前置 gate 的路径与 artifact 哈希，作为跨 worktree 的血缘指针；新证据仍由本闸重新生成。
- **为什么重开本闸**：上一闸 round 4 在当前字节上 H1–H12 全 PASS，但其 era 3 量具的非注释代码缺少 lint 要求的字面 H1、H3–H12 token，era 上限 3 已用尽，无法 recast；独立 final 又被宿主内存终止。按协议以 blocked by=instrument 收口，并在相同字节上以新 era 预算重建 gate；本闸的量具必须在非注释代码中包含字面 H ID。
- **为什么没有软闸**：这是纯功能缺陷修复，没有主观呈现目标；可读性、美感不进入验收。
- **为什么用视口态而非 URL**：产物是无路由的单文件，用 Playwright context 的 viewport/isMobile/hasTouch 表达 320/390 两档。
- **为什么不用 sha256 基线**：任务允许改动 `index.html` 的交互逻辑，冻结整段脚本会妨碍授权修复；只冻结「单文件、自包含、闭合、体积」这些结构红线。历史/编辑/除零等既有行为用行为断言保护。
- **键盘路径**：keypad gate 为了摆脱系统软键盘，把 `calc-input` 设为 `readOnly` + `inputmode="none"`，并用 H3 断言键入无效；本闸要求物理键盘也能输入，但**不要求**系统软键盘弹出：可保留 `readonly`/`inputmode="none"` 并在 document/app 上监听 keydown，也可移除 readonly；实现方式由执行者选择。
- **volatile 仅排除 `Telos/_worktree-archive`**：该目录是跨 worktree 的证据归档，不属于业务代码；仓库没有构建产物或运行日志需要排除。
