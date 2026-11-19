---
# ── Kekkai Goal Gate v4 · frontmatter（唯一机读区；停止数字只在这里；矩阵/不变量内容只在正文表格）──
slug: phone-calculator-continue-edit-numbers-111511
version: 4
model_profile: astra-flash-3.8-v1  # 新任务冻结模型组合；执行中不可修改
status: converged                  # draft | in-loop | converged（blocked 终态保持 in-loop）
repo: /ws/cal_phone
artifact: /ws/cal_phone/index.html
# artifact_kind: url | app | service   # 仅 artifact: null 时启用；此时 ARTIFACT_SHA256 := TREE_SHA256
parent_gate: /ws/cal_phone/Telos/phone-calculator-history-111508/GOAL.md                  # 子闸填父 GOAL.md 绝对路径；只继承 round-0 决策，不继承证据或 verify.mjs
verifiers:
  hard: codex exec                 # 固定驱动器；pin 与访问标志在 bin/runner.mjs（docs/RUNNER.md）
  soft: null
stop:
  max_rounds: 10
hard_invariants: [H1, H2, H3, H4, H5, H6, H7, H8, H9, H10, H11, H12]
volatile: []                       # TREE_SHA256 排除的仓库相对路径（构建产物、日志等）；空数组即可
---

# Kekkai Goal Gate · 计算器连续计算与历史数字直改

> **运行指令**：你是执行者（Codex / Claude Code / ZCode / Cursor 之一，由 handoff 指定；生成本 gate 的那次调用不得兼任）。
> 开跑前先 `kekkai doctor --gate <本目录> --host`；只有 `requires_display: true` 的真实桌面测量依赖解锁与屏幕权限，普通无头浏览器/逻辑测量不占屏。
> 读**本文件全文** + 同目录 [`./ledger.md`](./ledger.md)（决策台账），然后只用 §5 的命令块驱动验收，直到 §5 的停止条件；在已授权范围内自主推进，缺少外部输入时写明 blocked 与恢复条件。
> 生命周期编辑是唯一允许的 GOAL 改动：第 1 轮前 `status: draft → in-loop`；写 `converged` STOP 前 → `status: converged`；blocked 终态保持 `in-loop`。
> 除此之外 GOAL.md 只读：不改 frontmatter 数字、不改 prompt、不改变 §5 命令的操作、目标路径和关键参数（注释与空白不影响验收）。
> 教义在 Kekkai skill 的 `docs/CREED.md`、runner 契约在该 skill 的 `docs/RUNNER.md`——本文件不复述它们；`kekkai hard/soft` 的退出码与消息就是你的下一步。

## 1. 目标（一句话 + 背景 + 实施指导）
修复两个用户可见问题。第一，**计算完成后无法顺手开始下一次计算**：当前结果态把四个运算符选择器隐藏、输入框禁用，只留下右上角「运算类型」重置按钮，用户感觉被卡住。目标是在结果态继续显示四个运算符，直接点下一个运算符就清空算式/结果、启用并聚焦输入框、保留历史，开始一次全新计算；除零错误态同样可以直接选运算符恢复。第二，**历史记录只能删除数字再重新输入，不能直接改数字**：目标是在编辑态把每个操作数变成可直接编辑的输入框，改完数字按 `=` 就用新数字重算，新结果作为新记录追加到历史顶部，被编辑的原记录保持原样。

**实施指导**：
复用现有 `select → input → result | error | edit` 状态机和 float64 从左到右折叠口径，不引入表达式解析器或任意精度。结果态与错误态不要再把 `[data-testid="op-picker"]` 隐藏；`chooseOperator` 在这两个状态走「开始新计算」分支：清空当前算式与结果、启用并聚焦 `calc-input`、保留历史。编辑态把每个 `[data-testid="operand-chip"]` 里的数字渲染成 `<input data-testid="operand-input">`，其 `value` 是原始显示字符串；用户输入时同步更新编辑草稿并刷新 `[data-testid="expression"]`，这样换运算符、删除其他 chip 时不会丢掉刚改的数字。按 `=` 时读取全部 `operand-input` 的当前值，逐个 `Number()` 校验；空值或非有限数直接 no-op（不新增历史、不抛错、结果区不产生新 `data-value`）。校验通过后按草稿运算符计算，追加一条新历史记录，`data-operands` 必须等于当前输入值的原始字符串数组；退出编辑态，源记录与其他既有记录不变。保留 chip 的删除按钮和主输入框回车追加操作数的能力；除零仍进入可见错误态且不写历史，错误态可直接选运算符继续。历史仍然只存在当前页面，不写 `localStorage`/`sessionStorage`。保持单文件 HTML/CSS/JS、无外部依赖、移动端可见控件至少 44×44 CSS px、输入字号至少 16px、窄屏无横向溢出。外部前提：无需账号、服务、真实设备或人工授权；验收在无头 Chromium 中完成。

> 外部前提（账号、服务、人工决定、设备权限）应在实施指导中明确；缺失时保留证据并 blocked，不把无法由代码修复的条件塞进硬不变量反复重跑。

## 2. 不变约束（父级红线 · 任何修改不得破坏）
> 每条红线**必须标注归属**：`[H#]`（由该硬不变量机检）或 `[soft-only: 原因]`（只能主观把关，写明为何无法机检）。绝对不能改的代码块优先给 sha256 机检形式。不允许留下既非 `[H#]` 也非 `[soft-only]` 的悬空红线。
- 页面仍必须是可自包含加载的单文件 `index.html`：`</html>` 闭合、字节数 ≥ 1024，且不引用 `http(s):` 或协议相对的外部 script/link/img/font/@import [H1]
- 手机窄屏布局仍可用：320×568 与 390×844 视口下（含结果态带历史、编辑态带数字输入框时）无横向溢出，可见交互控件宽高均 ≥ 44 CSS px，`calc-input` 与 `operand-input` 字号 ≥ 16px [H2]
- 计算成功后必须能直接连续计算：结果态 `op-picker` 可见且四个 `[data-op]` 可用，点击任一运算符直接进入新的 input 态（输入启用并聚焦、算式/结果清空），历史条数与内容不变 [H3]
- 除零错误后必须能直接恢复：错误态 `op-picker` 可见，点击任一运算符直接开始新计算，历史不受错误影响 [H4]
- 既有计算流程不得回退：初始必须先在四个 `[data-op]` 中选择运算类型；数字必须回车逐个提交，未回车的数字不得提前进入算式；`=`（键盘或按钮）先提交未确认数字再按所选运算符从左到右折叠计算 [H5]
- 每次成功计算必须在历史顶部恰好追加一条记录，字段完整且最新在前；空回车、除零、无操作数不写历史；每条记录有可见的编辑入口 [H6]
- 点击 `op` 仍必须回到运算类型选择态并清空算式/结果，但不得清空历史；历史不得跨刷新或跨页面存活 [H7]
- 编辑态每个操作数必须是可直接编辑的输入框：其 `value` 初始等于该记录的原始显示字符串，修改后算式区必须反映新值；按 `=` 必须用当前输入值重算，而不是原记录值 [H8]
- 编辑态必须支持同时修改多个数字、更换运算符、删除 chip、通过主输入框追加操作数；换运算符或删除其他 chip 不得丢失已修改的数字；重算结果作为新记录追加，源记录与其他既有记录的字段和相对顺序不变 [H9]
- 编辑态操作数输入为空或非有限数时，按 `=` 不得新增历史、不得抛错、不得产生新的结果 `data-value`；用户修正后必须能继续计算 [H10]
- 编辑态除零必须进入可见错误态、不写历史、源记录不变，并且错误态可直接选运算符继续计算 [H11]
- 全流程不得产生未捕获页面错误或 console error；同一计算序列在两次全新加载中产生完全一致的历史数据 [H12]

> 允许改动的范围豁免写在下面的定界块里（runner 会把它**逐字**内联进 first / recast / final 验收器的 runtime contract，避免首轮判合规、末轮判违规的判定分裂）。没有豁免就写 `无`。

<<<SCOPE-EXEMPTIONS
无
SCOPE-EXEMPTIONS>>>

---

## 3. 硬目标（独立确定性验收 · 硬闸 · codex exec）

**输入矩阵（采样覆盖；含边界与「哪些算、哪些拒答」）：**
状态 ∈ {初始 select, 已选类型 input, 成功 result, 除零 error, 编辑 edit}；历史条目数 ∈ {0, 1, 3}；视口 ∈ {320×568, 390×844}；连续计算动作 ∈ {结果态直接点不同运算符, 结果态直接点相同运算符, 错误态直接点运算符, 先点 `op` 再选}；编辑动作 ∈ {改一个数字, 改多个数字, 换运算符, 删除中间 chip, 主输入框追加数字, 输入空值, 输入非数字, 把除号操作数改成 0}；页面生命周期 ∈ {首次加载, 刷新后, 全新上下文}。预期：成功 `=` → 历史顶部加一条；空回车/除零/无操作数 → 不加；结果态/错误态点运算符 → 立即进入新的 input 态且历史不变；编辑改数字后 `=` → 用新数字算出新结果并追加新记录，源记录不变；非法输入 `=` → no-op；刷新/新上下文 → 历史为 0 条并回到 select 态。

**稳定测试入口：** 既有：`main.app[data-state]`（取值 `select`、`input`、`result`、`error`、`edit`）、`[data-testid="op-picker"]`（内含 `[data-op="+"]`、`[data-op="-"]`、`[data-op="*"]`、`[data-op="/"]`）、`input[data-testid="calc-input"]`、`[data-testid="expression"]`、`[data-testid="result"]`（成功时 `data-value` 为数值字符串，除零时 `data-error="true"`）、`button[data-testid="key-equals"]`、`button[data-testid="key-op"]`、`[data-testid="history"]`、`[data-testid="history-item"]`（带 `data-operator` 与 `data-operands`，后者可 `JSON.parse` 为按输入顺序的原始显示字符串数组）、条目内 `[data-testid="history-expression"]`、`[data-testid="history-result"]`（带 `data-value`）、`button[data-testid="history-edit"]`、`[data-testid="edit-draft"]`（带 `data-operator`）、`[data-testid="operand-chip"]`、`button[data-testid="operand-remove"]`。新增：每个 `[data-testid="operand-chip"]` 内有一个可编辑的 `input[data-testid="operand-input"]`，其 `value` 是该操作数当前显示字符串；chip 的 `data-value` 只作为初始值参考，编辑后以 `operand-input.value` 为准。

**不变量：**

| # | 不变量 | 硬闸怎么验（须真跑，非读源码目测） | 阈值 |
|---|---|---|---|
| H1 | 页面为可加载的自包含单文件且加载不抛错 | Playwright 以 `file://` 打开 `/ws/cal_phone/index.html` 并监听 `pageerror`；Node 用 `fs.readFileSync` 读取原始 HTML，断言 `</html>` 存在且字节数达标，并统计 `<script src>`、`<link href>`、`<img src>`、`@import`、`url(...)` 中指向 `(https?:)?//` 的数量 | 0 个 pageerror；`</html>` 存在；字节数 ≥ 1024；外部引用 0 处 |
| H2 | 手机视口下结果态与编辑数字界面可用 | Playwright 在 320×568 与 390×844（`isMobile: true, hasTouch: true`）各建上下文；先算两条记录进入 result 态，再点开较旧记录的编辑入口进入 edit 态；两种状态都读取 `documentElement`/`body` 的 `scrollWidth` 与 `clientWidth`、所有可见 `input, button, [data-op]`（含 `operand-input`、`operand-remove`）的 `getBoundingClientRect()`，以及 `calc-input` 与 `operand-input` 的 computed `font-size` | 4 个状态组合均 `scrollWidth <= clientWidth + 1`；每个可见控件宽高 ≥ 44（容差 0.5px）；`calc-input` 与所有 `operand-input` 字号 ≥ 16px |
| H3 | 成功后可直接连续计算 | 全新加载选 `+`，输入 12/30/8 各回车后点击 `key-equals`，断言 `app[data-state="result"]`、`op-picker` 可见、四个 `[data-op]` 均可点击、history 数为 1；点击 `[data-op="*"]`，断言 `app[data-state="input"]`、`calc-input` 启用且 `document.activeElement` 为它、expression/result 为空、history 数仍为 1 且 item 0 快照不变；输入 2/3/4 各回车后点击 `key-equals`，断言结果 24、history 数为 2、item 0 为 `*` 记录 | 结果态选择器可见；一次点击即进入新 input 态；历史条数与既有条目不变；新结果 24 误差 ≤ 1e-9 |
| H4 | 错误后可直接恢复计算 | 全新加载选 `/`，输入 5 回车、0 回车、点击 `key-equals`，断言 `app[data-state="error"]`、result 的 `data-error === "true"`、history 数为 0、`op-picker` 可见；点击 `[data-op="+"]`，断言 `app[data-state="input"]`、`calc-input` 启用且聚焦、expression/result 为空；输入 1/2 各回车后点击 `key-equals`，断言结果 3、history 数为 1、无 pageerror | 错误态选择器可见；一次点击即恢复 input 态；1+2=3 误差 ≤ 1e-9；错误不写历史 |
| H5 | 既有输入与计算流程回归 | 全新加载断言 op-picker 可见、`[data-op]` 恰为 `{+,-,*,/}`、`calc-input.disabled === true`、expression/result 为空；点击 `+` 后断言输入启用并聚焦；键入 12 回车、30 回车，断言输入框为空、expression 含 12、30 与 `+`；键入 8 不回车时 expression 不含 8；按键盘 `=` 后断言 expression 含 8、result 为 50；另以五个全新加载案例逐数键入回车并点击 `key-equals`：`+` 12/30/8→50、`-` 10/4/3→3、`*` 2/3/4→24、`/` 100/5/2→10、`+` 1.5/2.25→3.75 | 初始态断言全部成立；两次键盘/点击结果误差 ≤ 1e-9；五个案例 5/5 误差 ≤ 1e-9 且 expression 含全部操作数与可接受运算符字形 |
| H6 | 成功计算按最新在前追加完整历史 | 全新加载依次计算 `+` 12/30/8=50、`-` 10/4/3=3、`*` 2/3/4=24、`+` 1.5/2.25=3.75；每次 `=` 后断言 history 数恰好加 1、最新条目在 DOM 索引 0；对每个最新条目断言 `data-operator`、`JSON.parse(data-operands)` 与输入顺序的原始显示字符串数组完全相等、`history-result[data-value]` 与预期差 ≤ 1e-9、`history-expression` 非空且含全部操作数与可接受运算符字形；最终自顶向下为 `+["1.5","2.25"]=3.75`、`*["2","3","4"]=24`、`-["10","4","3"]=3`、`+["12","30","8"]=50`；每条有可见 `history-edit`；空输入回车与除零不新增记录 | 4/4 次追加条数正确；顺序、运算符、操作数数组、结果全部精确匹配；误差 ≤ 1e-9；空回车/除零新增 0 条 |
| H7 | `op` 重置与历史会话性 | 完成 2 次计算后快照 history；点击 `key-op`，断言 `app[data-state="select"]`、op-picker 可见、input 禁用、expression/result 为空、history 快照不变；`page.reload()` 后断言 history 数为 0、回到 select 态、无 pageerror；另开全新浏览器上下文加载同一 `file://` 地址，断言 history 数为 0 | 重置后历史快照逐字段不变；刷新与全新上下文均为 0 条并回到 select 态 |
| H8 | 编辑态直接修改数字并用新值重算 | 全新加载计算 `+` 12/30/8=50 与 `*` 2/3/4=24（后者最新）；快照两条记录；点击较旧 `+` 记录的 `history-edit`，断言 `app[data-state="edit"]`、edit-draft 可见、`data-operator === "+"`、恰好 3 个 `operand-input` 且 `value` 依次为 `["12","30","8"]`、每个 input 未禁用且未只读；把中间 input 填为 `5`，断言 `[data-testid="expression"]` 文本含 `5` 且不含 `30`；点击 `key-equals`，断言 result 的 `data-value` 与 25 差 ≤ 1e-9、history 数为 3、索引 0 新条目 `data-operator === "+"`、`data-operands === ["12","5","8"]`、结果为 25、编辑态结束；索引 1 的 `*` 记录与索引 2 的原 `+` 记录快照逐字段不变 | 初始 operand-input 值逐项相等；改数字后 expression 反映新值；新结果 25；新记录操作数为 `["12","5","8"]`；原记录不变；无 pageerror |
| H9 | 多数字修改、换运算符、删除与追加协同 | 全新加载计算 `*` 2/3/4=24 与 `+` 1.5/2.25=3.75（后者最新）；点击较旧 `*` 记录的编辑入口；点击 `[data-op="+"]`，断言 edit-draft 的 `data-operator === "+"` 且三个 `operand-input` 仍为 `["2","3","4"]`；把第 1 个 input 填为 `10`、第 3 个填为 `5`，断言 expression 含 10 与 5；点击中间 chip 的 `operand-remove`，断言剩余 input 值依次为 `["10","5"]`；在 `calc-input` 输入 `2` 回车，断言 input 值依次为 `["10","5","2"]`；点击 `key-equals`，断言结果 17、history 数为 3、索引 0 新条目 `data-operator === "+"`、`data-operands === ["10","5","2"]`、结果为 17；索引 1、2 的原记录快照与相对顺序不变 | 换运算符后 input 值不变；删除后剩余已改值保留；追加后序列精确；新结果 17；原记录不变；无 pageerror |
| H10 | 非法操作数输入按 `=` 为 no-op | 全新加载计算 `+` 12/30/8=50；点击该记录的编辑入口；把中间 `operand-input` 填为空串后点击 `key-equals`，断言 history 数仍为 1、result 无 `data-value`、无 pageerror；再把该 input 填为 `abc` 后点击 `key-equals`，断言同样 no-op；最后填为 `5` 并点击 `key-equals`，断言结果 25、history 数为 2、新条目操作数为 `["12","5","8"]` | 空值与 `abc` 均不新增历史、不产生新 `data-value`、不抛错；修正后正常得到 25 且追加 1 条 |
| H11 | 编辑态除零不写历史且可继续 | 全新加载计算 `/` 100/5/2=10；点击该记录的编辑入口；把第 2 个 `operand-input` 填为 `0` 后点击 `key-equals`，断言 `app[data-state="error"]`、result 的 `data-error === "true"`、history 数仍为 1、原记录快照不变、无 pageerror、`op-picker` 可见；点击 `[data-op="+"]`，断言进入 input 态且输入聚焦；输入 1/2 各回车后点击 `key-equals`，断言结果 3、history 数为 2 | 编辑态除零可见错误且 0 条新增；原记录不变；错误后一次点击即可继续；1+2=3 误差 ≤ 1e-9 |
| H12 | 全流程无页面错误且历史确定 | 在 H3–H11 的全部交互上累计 `pageerror` 与 console `error` 消息；在两次全新加载中执行同一序列：`+` 12/30/8=50、`*` 2/3/4=24、编辑较旧 `+` 记录把中间数字改为 5 并重算；把每次 history 序列化为 `[{operator, operands, resultValue, expressionText}]` 并深度比对 | pageerror=0、console error=0；两次序列化历史完全相同 |

<<<HARD-VERIFY-PROMPT
你是确定性验收器。**不要评价 UI 美观、不要改产物源码。**本 prompt 会被单独抽取喂给你（读不到 frontmatter 与上表），所以下面所有文件都写**绝对路径**、基线写 **sha256 值**；runner 会在其后追加 `[RUNTIME CONTRACT]`（round / phase / gate_dir / evidence_dir / out_dir / artifact_sha256 / expected_review_states / SCOPE-EXEMPTIONS 原文），以它为准。
按本闸输入矩阵 / 不变量逐条**实际执行**验证：优先复用已有测试入口，逻辑用 Node 调用函数并断言返回值/异常；界面用 Playwright/jsdom 操控稳定选择器并读值。基线只用于本任务明确要求不可更改的范围，不能自行冻结整个源码或妨碍授权修复。采用项目已有工具与依赖；缺依赖或设备时明确拒答，不能伪装成代码 FAIL。禁止用主观语言/肉眼通读代替实测证据。
量具卫生（三条，写量具时逐条自查）：① 不得含写死的恒 FAIL/恒 PASS 常量判据；② 扫描类不变量的扫描面必须与 §3 声明逐字一致、不得自行扩张，且**不得包含 evidence/ 或 evidence/runs/**（自引用扫描面一旦被本循环必写的证据污染就永远翻不了绿）；③ 断言锚定稳定选择器/数据钩子而非用户可见文案原文（软闸可能正当地要求改文案）；子进程/步骤超时 ≥ 单次实测耗时的 2 倍。
量具接口（两条，runner 靠它做变异检查与尝试隔离，缺一即拒绝提升）：① 环境变量 `KEKKAI_ARTIFACT` 存在时用它覆盖目标文件路径；② `KEKKAI_OUT_DIR` 存在时，`hard-r<N>.txt` / `render-r<N>.txt` / `manifest-r<N>.json` / `review-shots/r<N>/` 全部写到该目录下，而不是 evidence/runs（所有路径以脚本自身所在目录解析、不依赖 cwd）。
目标文件（绝对路径）：/ws/cal_phone/index.html
本闸具体：被测文件是 `/ws/cal_phone/index.html`，一个可从 `file:///ws/cal_phone/index.html` 直接加载的单文件手机计算器。稳定契约分两组。既有 hook（不得删除或改名）：`main.app[data-state]` 取 `select`、`input`、`result`、`error`、`edit`；`[data-testid="op-picker"]` 容器内恰好四个按钮 `[data-op="+"]`、`[data-op="-"]`、`[data-op="*"]`、`[data-op="/"]`；`input[data-testid="calc-input"]`；`[data-testid="expression"]`；`[data-testid="result"]`（成功时 `data-value` 是可 `parseFloat` 的十进制数值字符串，除零时 `data-error="true"`）；`button[data-testid="key-equals"]`；`button[data-testid="key-op"]`；`[data-testid="history"]`；`[data-testid="history-item"]`（带 `data-operator` 与 `data-operands`，后者 `JSON.parse` 后是按输入顺序的原始显示字符串数组）；条目内 `[data-testid="history-expression"]`、`[data-testid="history-result"]`（带 `data-value`）、`button[data-testid="history-edit"]`；`[data-testid="edit-draft"]`（带 `data-operator`）；`[data-testid="operand-chip"]`；`button[data-testid="operand-remove"]`。新增 hook：每个 `operand-chip` 内有一个可编辑的 `input[data-testid="operand-input"]`，其 `value` 是该操作数当前显示字符串；chip 的 `data-value` 只作为初始值参考，编辑后以 `operand-input.value` 为准。
交互契约：初始为 select 态（op-picker 可见、`calc-input.disabled` 为 true、expression/result 为空、history 条目数为 0）；点击 `[data-op]` 后进入 input 态（输入启用并聚焦）；输入数字按 Enter 提交一个操作数（输入框清空、expression 含该数字与所选运算符）；键盘 `=` 或点击 key-equals 先提交未确认数字，再按所选运算符把已提交操作数从左到右折叠求值；成功结果写入 result 的 `data-value`，并在 history 顶部恰好新增一条对应记录，进入 result 态。**结果态必须保持 `op-picker` 可见且四个 `[data-op]` 可点击；点击任一运算符必须直接进入新的 input 态：清空 expression/result、启用并聚焦 calc-input、history 条数与既有条目不变。** 除零进入 `data-error="true"` 的 error 态且不新增历史；**error 态也必须保持 `op-picker` 可见，点击任一运算符直接进入新的 input 态，history 不受影响。** 空输入回车不新增操作数也不新增历史；点击 key-op 回到 select 态、清空 expression/result，但保留全部历史和条目内容不变。点击某条 history-edit 进入 edit 态：edit-draft 可见，`data-operator` 等于该条目的 `data-operator`，每个操作数对应一个可编辑的 `operand-input`，其 `value` 初始等于该条目的 `data-operands` 对应项；calc-input 启用并聚焦、op-picker 可见。编辑态修改某个 `operand-input` 后，`[data-testid="expression"]` 的文本必须反映新值（含新值、不含被替换掉的旧值）；编辑态点击不同 `[data-op]` 只改变 `edit-draft` 的 `data-operator`，所有 `operand-input` 的当前值与顺序不变；点击某 chip 的 operand-remove 删除该 chip，剩余 `operand-input` 的当前值与顺序不变；在 calc-input 输入数字按 Enter 在草稿末尾追加一个带 `operand-input` 的 chip；编辑态按 `=` 或点击 key-equals 时读取全部 `operand-input.value`，空值或非有限数必须 no-op（不新增历史、不产生新的 result `data-value`、不抛错）；全部合法时按草稿运算符从左到右计算，结果写入 result 的 `data-value`，history 顶部恰好新增一条 `data-operator` 与 `data-operands`（等于当前输入值数组）一致的新记录，退出编辑态；所有既有条目（含被编辑的源条目）的 DOM 顺序、`data-operator`、`data-operands`、`history-expression` 文本、`history-result` 的 `data-value` 与文本都保持不变，仅整体下移一位。编辑态除零必须进入 `data-error="true"` 的 error 态、不新增历史、源记录不变，并保持 op-picker 可见以便继续。刷新页面后 history 条目数必须为 0 且回到 select 态，不得借助 localStorage/sessionStorage 让历史跨刷新存活。页面不得引用外部 http(s) 或协议相对资源（允许 data: 与内联）。
逐条测量口径：H1 用 `fs.readFileSync` 读取 `/ws/cal_phone/index.html` 断言 `</html>` 存在、`Buffer.byteLength >= 1024`，并用正则统计 `<script ... src>`、`<link ... href>`、`<img ... src>`、`@import`、`url(...)` 中指向 `(https?:)?//` 的数量为 0；同时用 Playwright 以 `file:///ws/cal_phone/index.html` 打开并监听 `pageerror` 为 0。H2 用 Playwright 分别建立 320×568 与 390×844（`isMobile: true, hasTouch: true`）上下文；每个视口先完成 `+` 12/30/8=50 与 `*` 2/3/4=24 两条记录（进入 result 态），读取溢出与可见控件尺寸；再点击较旧记录的 history-edit 进入 edit 态，再次读取；断言 4 个状态组合的 `documentElement` 与 `body` 均满足 `scrollWidth <= clientWidth + 1`，所有可见 `input, button, [data-op]`（含 operand-input 与 operand-remove）宽高 ≥ 44（容差 0.5px），`calc-input` 与所有 `operand-input` 的 computed font-size ≥ 16。H3 全新加载选 `+`，键入 12/30/8 各回车，点击 key-equals，断言 `data-state="result"`、op-picker 可见、四个 `[data-op]` 可点击、history 数为 1；点击 `[data-op="*"]`，断言 `data-state="input"`、calc-input 启用且 activeElement 为它、expression/result 为空、history 数仍为 1 且 item 0 快照不变；键入 2/3/4 各回车后点击 key-equals，断言结果 24、history 数为 2、item 0 为 `*`。H4 全新加载选 `/`，键入 5 回车、0 回车、点击 key-equals，断言 `data-state="error"`、result 的 `data-error === "true"`、history 数为 0、op-picker 可见；点击 `[data-op="+"]`，断言 `data-state="input"`、calc-input 启用且聚焦、expression/result 为空；键入 1/2 各回车后点击 key-equals，断言结果 3、history 数为 1、无 pageerror。H5 断言初始 op-picker 可见、`[data-op]` 值集合恰为 `{+,-,*,/}`、`calc-input.disabled === true`、expression/result 为空；点击 `+` 后断言输入启用且聚焦；键入 12 回车、30 回车，断言输入框为空、expression 含 12、30 与 `+`；键入 8 不回车时 expression 不含 8；按键盘 `=` 后 expression 含 8 且 result 与 50 差 ≤ 1e-9；另对五个案例各自全新加载：`+` 12/30/8→50、`-` 10/4/3→3、`*` 2/3/4→24、`/` 100/5/2→10、`+` 1.5/2.25→3.75，逐数键入回车并点击 key-equals，断言 result 误差 ≤ 1e-9 且 expression 含全部操作数与可接受运算符字形（`+`；`-` 或 `−`；`*` 或 `×`；`/` 或 `÷`）。H6 全新加载依次计算四条记录，每次 `=` 后断言 history 数恰好加 1、最新条目在 DOM 索引 0；断言每条 `data-operator` 正确、`JSON.parse(data-operands)` 与输入顺序的原始显示字符串数组完全相等（分别 `["12","30","8"]`、`["10","4","3"]`、`["2","3","4"]`、`["1.5","2.25"]`）、`history-result[data-value]` 与预期差 ≤ 1e-9、`history-expression` 非空且含全部操作数与可接受运算符字形；最终自顶向下四条为 `+["1.5","2.25"]=3.75`、`*["2","3","4"]=24`、`-["10","4","3"]=3`、`+["12","30","8"]=50`；每条有可见 history-edit；另在空输入回车与 `/` 5/0 除零后断言 history 不增加。H7 完成 2 次计算后快照 history，点击 key-op 断言 `data-state="select"`、op-picker 可见、input 禁用、expression/result 为空、history 快照逐字段不变；`page.reload()` 后断言 history 数为 0、select 态、无 pageerror；另开全新浏览器上下文加载同一 file URL 断言 history 数为 0。H8 全新加载计算 `+` 12/30/8=50 与 `*` 2/3/4=24（后者最新），快照两条；点击较旧 `+` 记录的 history-edit，断言 `data-state="edit"`、edit-draft 可见、`data-operator === "+"`、恰好 3 个 operand-input 且 value 依次为 `["12","30","8"]`、每个 input 未禁用且未只读；把中间 input 填为 `5`，断言 expression 文本含 `5` 且不含 `30`；点击 key-equals，断言 result 的 `data-value` 与 25 差 ≤ 1e-9、history 数为 3、索引 0 新条目 `data-operator === "+"` 且 `data-operands === ["12","5","8"]` 且结果 25、编辑态结束；索引 1、2 的原记录快照逐字段不变。H9 全新加载计算 `*` 2/3/4=24 与 `+` 1.5/2.25=3.75（后者最新），点击较旧 `*` 记录的编辑入口；点击 `[data-op="+"]`，断言 edit-draft 的 `data-operator === "+"` 且三个 operand-input 仍为 `["2","3","4"]`；把第 1 个 input 填为 `10`、第 3 个填为 `5`，断言 expression 含 10 与 5；点击中间 chip 的 operand-remove，断言剩余 input 值依次为 `["10","5"]`；在 calc-input 输入 `2` 回车，断言 input 值依次为 `["10","5","2"]`；点击 key-equals，断言结果 17、history 数为 3、索引 0 新条目 `data-operator === "+"` 且 `data-operands === ["10","5","2"]` 且结果 17；索引 1、2 的原记录快照与相对顺序不变。H10 全新加载计算 `+` 12/30/8=50，点击该记录的编辑入口；把中间 operand-input 填为空串后点击 key-equals，断言 history 数仍为 1、result 无 `data-value`、无 pageerror；再把该 input 填为 `abc` 后点击 key-equals，断言同样 no-op；最后填为 `5` 并点击 key-equals，断言结果 25、history 数为 2、新条目操作数为 `["12","5","8"]`。H11 全新加载计算 `/` 100/5/2=10，点击该记录的编辑入口；把第 2 个 operand-input 填为 `0` 后点击 key-equals，断言 `data-state="error"`、result 的 `data-error === "true"`、history 数仍为 1、原记录快照不变、无 pageerror、op-picker 可见；点击 `[data-op="+"]`，断言进入 input 态且输入聚焦；输入 1/2 各回车后点击 key-equals，断言结果 3、history 数为 2。H12 在 H3–H11 全部交互上收集 pageerror 与 console error 计数，并在两次全新加载中执行同一序列（`+` 12/30/8=50、`*` 2/3/4=24、编辑较旧 `+` 记录把中间数字改为 5 并重算），将 history 序列化为 `[{operator, operands, resultValue, expressionText}]` 后深度比对。
环境与工具（当前主机实测）：Node v22.23.2；jsdom@27.2.0 已全局安装（`require('jsdom')` 失败时先 `export NODE_PATH=$(npm root -g)` 再重试）；Playwright 浏览器已缓存在 `/root/.cache/ms-playwright`（chromium-1248，对应 `playwright@1.64.0`），网络可用。可在 `/tmp` 或本 gate 目录执行 `npm i playwright@1.64.0`，脚本通过绝对路径或 gate 目录下的 `node_modules` 解析；**不得**把 `node_modules` 安装到 `/ws/cal_phone` 根目录。若浏览器缓存不可用可让 Playwright 自行下载；仍不可用则按缺设备拒答，不能伪装成产物 FAIL。
phase=first 时把验证逻辑写成脚本 `/ws/cal_phone/Telos/phone-calculator-continue-edit-numbers-111511/evidence/verify.mjs`（接受轮号参数）并立即以 `node verify.mjs <round>` 运行；它按上面不变量逐条实测并写 `hard-r<N>.txt`：先写 `ROUND: <N>`、`ARTIFACT_SHA256: <64hex>`、`VERIFIER_SHA256: <64hex>`（脚本自身 sha256），再每条 `H<id> PASS|FAIL — 实测值/证据`，末行**严格** `HARD: PASS` 或 `HARD: FAIL (Hx,…)`。
若 runtime contract 的 `expected_review_states` 非 none：同一脚本还须把每个状态用 Playwright/无头 Chrome 渲染成**非空、非纯色、内容互不重复**的 PNG（≥ 240×160；真 320px 用 CDP `Emulation.setDeviceMetricsOverride`）落 `review-shots/r<N>/S<k>.png`——精确且仅这些文件；把带同样头的可见性/溢出/关键尺寸 `key=value` 实测写 `render-r<N>.txt`；写 `manifest-r<N>.json`：`round`、`artifact_sha256`、`verifier_sha256`、`metrics_sha256`、每张图的 `file/sha256/width/height`、`adhoc: []`。
phase=final 时**禁止读取、运行或修改 verify.mjs / ledger / 旧证据**，在你被启动的隔离 scratch cwd 中重新推导全套检查；临时测量只落当前 scratch 目录，最终回复给出裁决，由 CLI 保存（不要自行写 `-o` 路径）；首行同样是 `ROUND:`、`ARTIFACT_SHA256:`，末行同样严格。
HARD-VERIFY-PROMPT>>>

---

## 5. 运行与停止（命令按需选用，非逐行执行的脚本；停止数字只在 frontmatter）
    # gate=/ws/cal_phone/Telos/phone-calculator-continue-edit-numbers-111511 · rendered by kekkai new — do not edit
    kekkai doctor --gate "/ws/cal_phone/Telos/phone-calculator-continue-edit-numbers-111511" --host     # before round 1 and after any host change
    kekkai hard "/ws/cal_phone/Telos/phone-calculator-continue-edit-numbers-111511"                     # r1: independent author writes evidence/verify.mjs; later rounds replay it
    kekkai adhoc "/ws/cal_phone/Telos/phone-calculator-continue-edit-numbers-111511" -- <command…>      # same-round measurement admissible as 误报 basis
    kekkai recast "/ws/cal_phone/Telos/phone-calculator-continue-edit-numbers-111511" --reason "<why>"  # sick instrument: quarantine + fresh independent author (≤3 eras)
    kekkai hard "/ws/cal_phone/Telos/phone-calculator-continue-edit-numbers-111511" --final             # terminal independent stamp at the stop candidate
    kekkai lint "/ws/cal_phone/Telos/phone-calculator-continue-edit-numbers-111511" --post              # after round 1, on recovery, before STOP
    kekkai close "/ws/cal_phone/Telos/phone-calculator-continue-edit-numbers-111511" --by <budget|host|instrument|oscillation|human> --blocker "<one sentence>"

- **轮次 = runner 提升进 `evidence/runs/hard-r<N>.txt` 的 canonical 盖章**；其余一切都是尝试（`evidence/attempts/`），不写台账、不占预算、不动 K。轮号由 runner 分配，不要手填；不要手跑 `node verify.mjs` 再拷文件进 runs/（缺 runner 头会被拒绝）。
- **`kekkai hard` 退出码**：`0` 提升为轮；`2` 尝试已归档（先读 `kekkai status --json` 和消息：若该轮已提升但 final 缺失，补 `--final`；否则修因后继续，不盲重跑）；`3` 重复/尝试上限——只有三条合法路：(1) change the business tree, (2) `kekkai recast --reason`, (3) `kekkai close --by <tag>`；`4` 规则拒绝（读消息，别原样重试）。管道故障同一输入有重试上限；无法修复就 `close`，不换措辞/增预算绕过。
- **首个 hard PASS 轮 runner 自动跑审计 final**；final 与量具不一致 ⇒ final 的 FAIL 成立，只能修代码或 `kekkai recast`，永不再跑一次 final 试运气。
- **停止**：`converged` = 最新轮 hard PASS + 当前产物/业务树字节的同 era 独立 final PASS（hard-only 不需要软评或 K 确认轮），且未超 frontmatter `max_rounds`；任何轮数（含 0）都可以 `kekkai close --by <budget|host|instrument|oscillation|human>` 写 blocked 终态并附 `blocker:` 行——绝不把 gate 停在 in-loop 而无 STOP。
- 第 1 轮后、恢复时、写 STOP 前各跑一次 `kekkai lint <本目录> --post`；`POST-IN-PROGRESS` 是运行中的预期警告。

---

## 附录 · 生成器判断记录（可审计的 taste↔structure 边界）
> 让执行者能看懂哪些是「结构强制」、哪些是「生成器的 taste 取舍」。不要复述停止数字（它们只在 frontmatter）。
- **为何 hard-only**：两个问题都是可确定性测量的行为（连续计算入口、数字直改与重算），没有品牌或视觉质感目标；移动端可用性继续用可测阈值纳入硬闸，因此 `--soft none`。
- **为何记录父闸**：本 gate 是在已收敛的 `phone-calculator-history-111508` 产物上修 bug，`parent_gate` 只记录血缘；hard-only 子闸不继承父闸的决策表、证据、量具或轮次，所有 H 都在本 gate 内重新实测。
- **连续计算的语义取舍**：用户说「计算完一次后无法再继续」，当前实现其实可以点右上角「运算类型」重置，但选择器被隐藏，用户找不到入口。因此契约选择「结果态/错误态保持四个运算符可见，直接点运算符开始新计算」，而不是要求用户先找重置按钮；`key-op` 仍然保留为显式重置。
- **数字编辑的语义取舍**：用户强调「主要的功能是编辑数字」，当前 chip 只能删除后重填。因此每个操作数改成可直接编辑的 `operand-input`，输入事件同步草稿与算式区；删除 chip 和主输入框追加仍保留，覆盖「改、删、加」三种编辑动作。
- **为何用 `operand-input.value` 作为唯一真值**：编辑后 chip 的 `data-value` 容易与输入框脱节；契约明确编辑后以输入框当前值为准，新历史记录的 `data-operands` 必须等于该值数组，避免两套数据源。
- **为何要求 expression 反映新值**：只改输入框而上方算式仍显示旧值会让用户无法确认改的是哪一项；这是编辑功能的可用性要求，不是审美要求，因此纳入硬闸。
- **非法输入的处理**：空值/非数字按 `=` 选择 no-op（不新增历史、不产生新结果、不抛错），而不是静默按 0 计算或整页报错；修正后仍可继续。
- **为何刷新清空**：沿用父闸确认的「仅当前页面」；H7 用 reload 与全新上下文两种行为测量，不检查具体存储实现。
- **工具取舍**：用无头 Playwright（chromium-1248 已缓存）做真实键盘/点击/输入/视口测量；不设 `--requires-display`，因为无头浏览器测量不依赖真实桌面解锁。
- **volatile 为空**：仓库没有构建产物或日志；gate 目录本身被 TREE_SHA256 排除，依赖安装不会污染业务树。
