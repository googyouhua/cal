---
# ── Kekkai Goal Gate v4 · frontmatter（唯一机读区；停止数字只在这里；矩阵/不变量内容只在正文表格）──
slug: phone-calculator-history-111508
version: 4
model_profile: astra-flash-3.8-v1  # 新任务冻结模型组合；执行中不可修改
status: converged                  # draft | in-loop | converged（blocked 终态保持 in-loop）
repo: /ws/cal_phone
artifact: /ws/cal_phone/index.html
# artifact_kind: url | app | service   # 仅 artifact: null 时启用；此时 ARTIFACT_SHA256 := TREE_SHA256
parent_gate: /ws/cal_phone/Telos/phone-calculator-111507/GOAL.md                  # 子闸填父 GOAL.md 绝对路径；只继承 round-0 决策，不继承证据或 verify.mjs
verifiers:
  hard: codex exec                 # 固定驱动器；pin 与访问标志在 bin/runner.mjs（docs/RUNNER.md）
  soft: null
stop:
  max_rounds: 10
hard_invariants: [H1, H2, H3, H4, H5, H6, H7, H8, H9, H10, H11, H12]
volatile: []                       # TREE_SHA256 排除的仓库相对路径（构建产物、日志等）；空数组即可
---

# Kekkai Goal Gate · 手机网页计算器历史记录与编辑重算

> **运行指令**：你是执行者（Codex / Claude Code / ZCode / Cursor 之一，由 handoff 指定；生成本 gate 的那次调用不得兼任）。
> 开跑前先 `kekkai doctor --gate <本目录> --host`；只有 `requires_display: true` 的真实桌面测量依赖解锁与屏幕权限，普通无头浏览器/逻辑测量不占屏。
> 读**本文件全文** + 同目录 [`./ledger.md`](./ledger.md)（决策台账），然后只用 §5 的命令块驱动验收，直到 §5 的停止条件；在已授权范围内自主推进，缺少外部输入时写明 blocked 与恢复条件。
> 生命周期编辑是唯一允许的 GOAL 改动：第 1 轮前 `status: draft → in-loop`；写 `converged` STOP 前 → `status: converged`；blocked 终态保持 `in-loop`。
> 除此之外 GOAL.md 只读：不改 frontmatter 数字、不改 prompt、不改变 §5 命令的操作、目标路径和关键参数（注释与空白不影响验收）。
> 教义在 Kekkai skill 的 `docs/CREED.md`、runner 契约在该 skill 的 `docs/RUNNER.md`——本文件不复述它们；`kekkai hard/soft` 的退出码与消息就是你的下一步。

## 1. 目标（一句话 + 背景 + 实施指导）
在已收敛的单文件手机计算器上补充「计算历史」：每次成功计算把完整算式与结果记入一个可见历史列表（最新在顶部）；每条历史带「编辑」入口，点击后把该条记录的运算符与全部操作数载入编辑草稿，用户可以更换运算符、删除或追加数字，再按 `=` 重新计算；重算结果作为一条新记录追加到历史顶部，被编辑的原记录保持原样；历史只存在于当前页面，刷新或重新打开后清空。这样用户能回看过去的计算，并在不必从头输入的前提下复用或修正它。

**实施指导**：
在现有 `select → input → result | error` 状态机旁增加一个内存历史数组，元素形如 `{ operator, operands: [{ value, display }], expression, result }`；只在计算成功进入 `result` 态时把新元素插入数组头部并渲染到历史区，除零、空回车、没有操作数的 `=` 都不记录。渲染历史条目时把 `operator` 与按输入顺序的原始 `display` 字符串数组分别写入 `data-operator` 与 `data-operands`（JSON 数组），结果数值写入 `[data-testid="history-result"]` 的 `data-value`。编辑入口把该条目的运算符和操作数复制到一个独立的编辑草稿：编辑态下操作数渲染为带删除按钮的 chip，数字输入框回车追加新 chip；编辑态下选择不同运算符只替换运算符、不清空草稿里的操作数（这与普通选择运算符会重置操作数的行为不同，是编辑语义的一部分）；按 `=` 用草稿当前的运算符与操作数按从左到右顺序折叠计算，成功后追加一条新历史并退出编辑态，绝不修改或删除源条目。历史的递增与编辑都使用现有 float64 运算口径，不引入任意精度或新的表达式解析器；历史不要写入 `localStorage`/`sessionStorage`，刷新必须清空。保持单文件 HTML/CSS/JS、无构建步骤、无外部依赖、移动端控件至少 44×44 CSS px 且窄屏不横向溢出。外部前提：无需账号、服务、真实设备或人工授权；验收在无头 Chromium 中完成。

> 外部前提（账号、服务、人工决定、设备权限）应在实施指导中明确；缺失时保留证据并 blocked，不把无法由代码修复的条件塞进硬不变量反复重跑。

## 2. 不变约束（父级红线 · 任何修改不得破坏）
> 每条红线**必须标注归属**：`[H#]`（由该硬不变量机检）或 `[soft-only: 原因]`（只能主观把关，写明为何无法机检）。绝对不能改的代码块优先给 sha256 机检形式。不允许留下既非 `[H#]` 也非 `[soft-only]` 的悬空红线。
- 页面仍必须是可自包含加载的单文件 `index.html`：`</html>` 闭合、字节数 ≥ 1024，且不引用 `http(s):` 或协议相对的外部 script/link/img/font/@import [H1]
- 手机窄屏布局仍可用：320×568 与 390×844 视口下（含存在历史记录与进入编辑态时）无横向溢出，可见交互控件宽高均 ≥ 44 CSS px，数字输入字号 ≥ 16px [H2]
- 既有选择流程不得回退：初始必须先在四个 `[data-op]` 中选择运算类型，数字输入才启用并聚焦；新加载时历史为空 [H3]
- 既有输入流程不得回退：数字必须回车逐个提交，未回车的数字不得提前进入算式；`=`（键盘或按钮）先提交未确认数字再计算 [H4]
- 四则运算与小数结果必须继续正确，按所选运算符从左到右折叠，使用 float64 [H5]
- 点击 `op` 必须回到运算类型选择态并清空算式与结果，但**不得清空历史** [H6]
- 空回车不得添加操作数；除零必须进入可见错误态且不写历史，并可经 `op` 恢复后继续计算 [H7]
- 每次成功计算必须在历史顶部恰好追加一条记录：`data-operator`、`data-operands`（按输入顺序的原始显示字符串 JSON 数组）、`history-expression` 文本与 `history-result` 的 `data-value` 必须与该次计算一致；错误与空操作不产生记录 [H8]
- 点击某条历史的编辑入口必须把该条记录的运算符与全部操作数载入可见的编辑草稿；编辑态下更换运算符不得丢失已载入的操作数 [H9]
- 编辑态必须允许删除任意操作数、追加新操作数；重算结果必须正确，并作为**新记录**追加到历史顶部，源记录与其他既有记录的字段与相对顺序不得改变 [H10]
- 历史不得跨刷新或跨页面存活：刷新后历史为空并回到 select 态 [H11]
- 全流程不得产生未捕获页面错误或 console error；同一计算序列在两次全新加载中产生完全一致的历史数据 [H12]

> 允许改动的范围豁免写在下面的定界块里（runner 会把它**逐字**内联进 first / recast / final 验收器的 runtime contract，避免首轮判合规、末轮判违规的判定分裂）。没有豁免就写 `无`。

<<<SCOPE-EXEMPTIONS
无
SCOPE-EXEMPTIONS>>>

---

## 3. 硬目标（独立确定性验收 · 硬闸 · codex exec）

**输入矩阵（采样覆盖；含边界与「哪些算、哪些拒答」）：**
历史条目数 ∈ {0, 1, 3}；运算符 ∈ {`+`, `-`, `*`, `/`}；记录位置 ∈ {最新, 较旧}；编辑动作 ∈ {仅更换运算符, 删除中间操作数后重算, 追加操作数后重算, 删除全部操作数后按 `=`}；视口 ∈ {320×568, 390×844}；页面生命周期 ∈ {首次加载, 刷新后, 全新上下文}；计算边界 ∈ {四则, 小数, 空回车, 除零}。预期：成功 `=` → 历史顶部恰好加一条且字段完整；空回车/除零/无操作数 `=` → 不加历史；编辑重算 → 加新记录且源记录不变；刷新/新上下文 → 历史为 0 条并回到 select 态。

**稳定测试入口：** 既有：`[data-testid="op-picker"]`（内含 `[data-op="+"]`、`[data-op="-"]`、`[data-op="*"]`、`[data-op="/"]`）、`input[data-testid="calc-input"]`、`[data-testid="expression"]`、`[data-testid="result"]`（成功时 `data-value` 为数值字符串，除零时 `data-error="true"`）、`button[data-testid="key-equals"]`、`button[data-testid="key-op"]`。新增：`[data-testid="history"]` 容器；`[data-testid="history-item"]`（带 `data-operator` 与 `data-operands`，后者可 `JSON.parse` 为按输入顺序的原始显示字符串数组）；条目内 `[data-testid="history-expression"]`、`[data-testid="history-result"]`（带 `data-value`）、`button[data-testid="history-edit"]`；编辑态 `[data-testid="edit-draft"]`（带 `data-operator`），其中每个操作数一个 `[data-testid="operand-chip"]`（带 `data-value`），每个 chip 内有 `button[data-testid="operand-remove"]`。

**不变量：**

| # | 不变量 | 硬闸怎么验（须真跑，非读源码目测） | 阈值 |
|---|---|---|---|
| H1 | 页面为可加载的自包含单文件且加载不抛错 | Playwright 以 `file://` 打开 `/ws/cal_phone/index.html` 并监听 `pageerror`；Node 用 `fs.readFileSync` 读取原始 HTML，断言 `</html>` 存在且字节数达标，并统计 `<script src>`、`<link href>`、`<img src>`、`@import`、`url(...)` 中指向 `(https?:)?//` 的数量 | 0 个 pageerror；`</html>` 存在；字节数 ≥ 1024；外部引用 0 处 |
| H2 | 手机视口下历史与编辑界面可用 | Playwright 在 320×568 与 390×844（`isMobile: true, hasTouch: true`）各建上下文；先算两条记录进入 result 态，再点开较旧记录的编辑入口进入编辑态；两种状态都读取 `documentElement`/`body` 的 `scrollWidth` 与 `clientWidth`、所有可见 `input, button, [data-op]`（含 `history-edit`、`operand-remove`）的 `getBoundingClientRect()` 与 `calc-input` 的 computed `font-size` | 4 个状态组合均 `scrollWidth <= clientWidth + 1`；每个可见控件宽高 ≥ 44（容差 0.5px）；输入字号 ≥ 16px |
| H3 | 初始必须选运算类型且历史为空 | 加载后断言 op-picker 可见、`[data-op]` 恰好 4 个且值集合为 `{+,-,*,/}`、`calc-input.disabled === true`、expression/result 文本为空、`[data-testid="history"]` 可见且 `history-item` 数为 0；键入 `12` 并回车后 expression 仍为空；点击 `[data-op="+"]` 后断言 `disabled === false`、`document.activeElement` 为该 input、expression/result 仍为空、历史仍为 0 | 上述断言全部成立 |
| H4 | 数字经回车逐个提交，`=` 提交未确认数字 | 选中 `+` 后键入 `12` 回车、`30` 回车，断言输入框清空且 expression 含 `12`、`30` 与 `+`；再键入 `8` 不回车，断言 expression 尚不含 `8`；按键盘 `=` 后断言 expression 含 `8`、result 的 `data-value` 解析值与 50 的差 ≤ 1e-9；另以点击 `key-equals` 的路径复验 `*` 2/3/4→24 | 提交序列成立；两次结果误差 ≤ 1e-9 |
| H5 | 四种运算与小数结果正确 | 每个案例全新加载：选运算符，逐个键入数字并回车，点击 `key-equals`，读取 result 的 `data-value` 与 expression 文本。案例：`+` 12/30/8→50；`-` 10/4/3→3；`*` 2/3/4→24；`/` 100/5/2→10；`+` 1.5/2.25→3.75 | 5/5 案例数值误差 ≤ 1e-9；expression 含全部操作数与可接受运算符字形（`+`；`-` 或 `−`；`*` 或 `×`；`/` 或 `÷`） |
| H6 | `op` 重置交互且不清空历史 | 完成 `+` 12/30/8=50 后快照 item 0 的 `data-operator`、`data-operands`、`history-expression` 文本与 `history-result` 的 `data-value`；点击 `key-op`，断言 op-picker 可见、input 禁用、expression 为空、result 无文本且无 `data-value`/`data-error`、`history-item` 数仍为 1 且 item 0 快照不变；再选 `*` 计算 2/3/4=24，断言 history 数为 2 且 item 0 为 `*` 记录 | 重置后的状态断言全部成立；历史条数与既有条目快照逐字段不变 |
| H7 | 空回车与除零不产生历史且可恢复 | 选中 `+` 后在空输入按回车，断言 expression/result 仍为空、无 `data-error`、history 数不变（0）；选中 `/` 输入 5 回车、0 回车、点击 `key-equals`，断言 result 的 `data-error === "true"`、文本非空、无 pageerror、history 数仍为 0；点击 `key-op` 后选 `+` 输入 1/2/`=` 得到 3，断言 history 数为 1 | 空回车不添加操作数；除零可见错误且 0 条历史；恢复后 1+2=3 且恰好 1 条历史 |
| H8 | 成功计算按最新在前追加完整历史记录 | 全新加载后依次计算：`+` 12/30/8=50、`-` 10/4/3=3、`*` 2/3/4=24、`+` 1.5/2.25=3.75；每次 `=` 后断言 `history-item` 数恰好加 1、最新条目位于 DOM 索引 0；对每个最新条目断言 `data-operator`、`JSON.parse(data-operands)` 与进入顺序的原始显示字符串数组完全相等、`history-result[data-value]` 与预期差 ≤ 1e-9、`history-expression` 文本非空且含全部操作数与可接受运算符字形；最终自顶向下断言四条记录依次为 `+["1.5","2.25"]=3.75`、`*["2","3","4"]=24`、`-["10","4","3"]=3`、`+["12","30","8"]=50`；每条记录有可见的 `history-edit` | 4/4 次追加条数正确；顺序、运算符、操作数数组、结果全部精确匹配；误差 ≤ 1e-9 |
| H9 | 编辑载入运算符与全部操作数，换运算符不丢数字 | 全新加载后计算 `*` 2/3/4=24 与 `+` 1.5/2.25=3.75（后者最新）；快照两条记录；点击较旧 `*` 记录的 `history-edit`，断言 `edit-draft` 可见、`data-operator === "*"`、恰好 3 个 `operand-chip` 且 `data-value` 依次为 `["2","3","4"]`、`calc-input` 启用且 `document.activeElement` 为该 input、op-picker 可见、history 数为 2 且两条快照不变；点击 `[data-op="+"]` 后断言 `edit-draft` 的 `data-operator === "+"`、chip 仍精确为 `["2","3","4"]`、history 快照不变 | 恢复的运算符与 chip 序列逐项相等；换运算符后 chip 数量与顺序不变；两条历史快照不变 |
| H10 | 删除/追加数字后重算，新结果追加且源记录不变 | 接续 H9 的编辑态（`+` 2,3,4）：点击中间 chip 的 `operand-remove`，断言 chip 变为 `["2","4"]`；键入 `10` 回车，断言 chip 变为 `["2","4","10"]`；按 `=`，断言 result 的 `data-value` 与 16 差 ≤ 1e-9、history 数变为 3、索引 0 的新条目 `data-operator === "+"`、`data-operands === ["2","4","10"]`、结果为 16、编辑态结束；索引 1、2 的原记录快照与相对顺序不变；再点开索引 0 新记录的编辑，删除全部 chip 后按 `=`，断言 history 数仍为 3 且无 pageerror | 删除/追加后的 chip 序列精确；新结果 16；历史数 3 且源记录逐字段不变；全删后不新增、不抛错 |
| H11 | 历史仅当前页面，刷新即清空 | 全新加载并完成 2 次计算，断言 history 数为 2；`page.reload()` 后断言 history 数为 0、op-picker 可见、input 禁用、expression/result 为空、无 pageerror；另开全新浏览器上下文/页面加载同一 `file://` 地址，断言 history 数为 0 | 刷新与全新上下文均为 0 条；刷新后回到 select 态 |
| H12 | 全流程无页面错误且历史确定 | 在 H3–H11 的全部交互上累计 `pageerror` 与 console `error` 消息；在两次全新加载中执行同一四计算序列（H8），把每次的历史序列化为 `[{operator, operands, resultValue, expressionText}]` 并深度比对 | pageerror=0、console error=0；两次序列化历史完全相同 |

<<<HARD-VERIFY-PROMPT
你是确定性验收器。**不要评价 UI 美观、不要改产物源码。**本 prompt 会被单独抽取喂给你（读不到 frontmatter 与上表），所以下面所有文件都写**绝对路径**、基线写 **sha256 值**；runner 会在其后追加 `[RUNTIME CONTRACT]`（round / phase / gate_dir / evidence_dir / out_dir / artifact_sha256 / expected_review_states / SCOPE-EXEMPTIONS 原文），以它为准。
按本闸输入矩阵 / 不变量逐条**实际执行**验证：优先复用已有测试入口，逻辑用 Node 调用函数并断言返回值/异常；界面用 Playwright/jsdom 操控稳定选择器并读值。基线只用于本任务明确要求不可更改的范围，不能自行冻结整个源码或妨碍授权修复。采用项目已有工具与依赖；缺依赖或设备时明确拒答，不能伪装成代码 FAIL。禁止用主观语言/肉眼通读代替实测证据。
量具卫生（三条，写量具时逐条自查）：① 不得含写死的恒 FAIL/恒 PASS 常量判据；② 扫描类不变量的扫描面必须与 §3 声明逐字一致、不得自行扩张，且**不得包含 evidence/ 或 evidence/runs/**（自引用扫描面一旦被本循环必写的证据污染就永远翻不了绿）；③ 断言锚定稳定选择器/数据钩子而非用户可见文案原文（软闸可能正当地要求改文案）；子进程/步骤超时 ≥ 单次实测耗时的 2 倍。
量具接口（两条，runner 靠它做变异检查与尝试隔离，缺一即拒绝提升）：① 环境变量 `KEKKAI_ARTIFACT` 存在时用它覆盖目标文件路径；② `KEKKAI_OUT_DIR` 存在时，`hard-r<N>.txt` / `render-r<N>.txt` / `manifest-r<N>.json` / `review-shots/r<N>/` 全部写到该目录下，而不是 evidence/runs（所有路径以脚本自身所在目录解析、不依赖 cwd）。
目标文件（绝对路径）：/ws/cal_phone/index.html
本闸具体：被测文件是 `/ws/cal_phone/index.html`，一个可从 `file:///ws/cal_phone/index.html` 直接加载的单文件手机计算器。稳定契约分两组。既有 hook（不得删除或改名）：`[data-testid="op-picker"]` 容器内恰好四个按钮 `[data-op="+"]`、`[data-op="-"]`、`[data-op="*"]`、`[data-op="/"]`；`input[data-testid="calc-input"]`；`[data-testid="expression"]`；`[data-testid="result"]`（成功时 `data-value` 是可 `parseFloat` 的十进制数值字符串，除零时 `data-error="true"`）；`button[data-testid="key-equals"]`；`button[data-testid="key-op"]`。新增 hook：可见容器 `[data-testid="history"]`；每次成功计算对应一个 `[data-testid="history-item"]`，条目按最新在前的 DOM 顺序排列，条目带 `data-operator`（`"+"`、`"-"`、`"*"`、`"/"`）与 `data-operands`（`JSON.parse` 后是按输入顺序的原始显示字符串数组，例如 `["12","30","8"]`）；每个条目内有 `[data-testid="history-expression"]`（非空文本，含全部操作数与可接受运算符字形）、`[data-testid="history-result"]`（`data-value` 为结果数值字符串）与 `button[data-testid="history-edit"]`；编辑态有可见的 `[data-testid="edit-draft"]`，其 `data-operator` 为当前草稿运算符，内含与草稿操作数一一对应的 `[data-testid="operand-chip"]`（`data-value` 为原始显示字符串）以及每个 chip 内的 `button[data-testid="operand-remove"]`。
交互契约：初始 select 态（op-picker 可见、`calc-input.disabled` 为 true、expression/result 为空、history 条目数为 0）；点击 `[data-op]` 后输入启用并聚焦；输入数字按 Enter 提交一个操作数（输入框清空、expression 含该数字与所选运算符）；键盘 `=` 或点击 key-equals 先提交未确认数字，再按所选运算符把已提交操作数从左到右折叠求值；成功结果写入 result 的 `data-value`，并在 history 顶部恰好新增一条对应记录；除零进入 `data-error="true"` 且不新增历史；空输入回车不新增操作数也不新增历史；点击 key-op 回到 select 态、清空 expression/result，但保留全部历史和条目内容不变；点击某条 history-edit 进入编辑态，`edit-draft` 的 `data-operator` 与 chip 的 `data-value` 序列必须等于该条目的 `data-operator` 与 `data-operands`；编辑态下 `calc-input` 启用并聚焦、op-picker 可见；编辑态下点击不同 `[data-op]` 只改变 `edit-draft` 的 `data-operator`，chip 数量与顺序不变；点击某 chip 的 operand-remove 删除该 chip，剩余顺序不变；在 `calc-input` 输入数字按 Enter 在草稿末尾追加一个 chip；编辑态按 `=` 或点击 key-equals 以当前草稿计算，结果写入 result 的 `data-value`，history 顶部恰好新增一条 `data-operator`/`data-operands` 与草稿一致的新记录，并退出编辑态；所有既有条目（含被编辑的源条目）的 DOM 顺序、`data-operator`、`data-operands`、`history-expression` 文本、`history-result` 的 `data-value` 与文本都保持不变，仅整体下移一位；编辑态把操作数全部删除后按 `=` 不得新增历史、不得抛错；刷新页面后 history 条目数必须为 0 且回到 select 态，不得借助 localStorage/sessionStorage 让历史跨刷新存活。页面不得引用外部 http(s) 或协议相对资源（允许 data: 与内联）。
逐条测量口径：H1 用 `fs.readFileSync` 读取 `/ws/cal_phone/index.html` 断言 `</html>` 存在、`Buffer.byteLength >= 1024`，并用正则统计 `<script ... src>`、`<link ... href>`、`<img ... src>`、`@import`、`url(...)` 中指向 `(https?:)?//` 的数量为 0；同时用 Playwright 以 `file:///ws/cal_phone/index.html` 打开并监听 `pageerror` 为 0。H2 用 Playwright 分别建立 320×568 与 390×844（`isMobile: true, hasTouch: true`）上下文；每个视口先完成 `+` 12/30/8=50 与 `*` 2/3/4=24 两条记录（进入 result 态），读取溢出与可见控件尺寸；再点击较旧记录的 history-edit 进入编辑态，再次读取；断言 4 个状态组合的 `documentElement` 与 `body` 均满足 `scrollWidth <= clientWidth + 1`，所有可见 `input, button, [data-op]`（含 history-edit 与 operand-remove）宽高 ≥ 44（容差 0.5px），`calc-input` 的 computed font-size ≥ 16。H3 断言 `[data-op]` 值集合恰为 `{+,-,*,/}`、初始 `calc-input.disabled === true`、expression/result 文本为空、history 可见且条目数为 0；尝试键入 12 回车后 expression 仍为空；点击 `[data-op="+"]` 后断言 `disabled === false`、`document.activeElement === calc-input`、expression/result 仍为空、history 仍为 0。H4 选中 `+` 后键入 12 回车、30 回车，断言输入框为空、expression 含 12、30 与 `+`；键入 8 不回车时 expression 不含 8；按键盘 `=` 后 expression 含 8 且 result 的 `data-value` 与 50 差 ≤ 1e-9；另以全新加载选 `*` 键入 2/3/4 各回车后点击 key-equals，断言结果 24。H5 对五个案例各自全新加载：`+` 12/30/8→50、`-` 10/4/3→3、`*` 2/3/4→24、`/` 100/5/2→10、`+` 1.5/2.25→3.75；逐数键入回车，点击 key-equals，读取 `data-value` 断言误差 ≤ 1e-9，并断言 expression 含全部操作数与可接受运算符字形（`+`；`-` 或 `−`；`*` 或 `×`；`/` 或 `÷`）。H6 完成 `+` 12/30/8=50 后快照 item 0 的 `data-operator`、`data-operands`、`history-expression` 文本、`history-result` 的 `data-value` 与文本；点击 key-op 后断言 op-picker 可见、`calc-input.disabled === true`、expression 为空、result 无文本且无 `data-value`/`data-error`、history 数仍为 1 且 item 0 快照不变；再选 `*` 计算 2/3/4 得 24，断言 history 数为 2 且 item 0 是 `*`。H7 选中 `+` 后在空输入按 Enter，断言 expression/result 仍为空、无 `data-error`、history 数不变；选中 `/` 输入 5 回车、0 回车、点击 key-equals，断言 result 的 `data-error === "true"`、文本非空、无 pageerror、history 数仍为 0；点击 key-op 后选 `+` 输入 1/2/`=` 断言得到 3 且 history 数为 1。H8 全新加载后依次计算 `+` 12/30/8=50、`-` 10/4/3=3、`*` 2/3/4=24、`+` 1.5/2.25=3.75；每次 `=` 后断言 history 条目数恰好加 1、最新条目在 DOM 索引 0；对每条最新条目断言 `data-operator` 正确、`JSON.parse(data-operands)` 与按输入顺序的原始显示字符串数组完全相等（分别 `["12","30","8"]`、`["10","4","3"]`、`["2","3","4"]`、`["1.5","2.25"]`）、`history-result[data-value]` 与预期差 ≤ 1e-9、`history-expression` 非空且含全部操作数与可接受运算符字形；最终自顶向下四条为 `+["1.5","2.25"]=3.75`、`*["2","3","4"]=24`、`-["10","4","3"]=3`、`+["12","30","8"]=50`；每条有可见 history-edit。H9 全新加载后计算 `*` 2/3/4=24 与 `+` 1.5/2.25=3.75，快照两条记录；点击较旧 `*` 记录的 history-edit，断言 edit-draft 可见、`data-operator === "*"`、恰好 3 个 operand-chip 且 `data-value` 依次为 `["2","3","4"]`、calc-input 启用且 activeElement 为该 input、op-picker 可见、history 数仍为 2 且两条快照不变；点击 `[data-op="+"]` 后断言 edit-draft 的 `data-operator === "+"`、chip 仍为 `["2","3","4"]`、history 快照不变。H10 接续 H9 的编辑态：点击中间 chip（值 3）的 operand-remove，断言 chip 为 `["2","4"]`；键入 10 回车，断言 chip 为 `["2","4","10"]`；按 `=`，断言 result 的 `data-value` 与 16 差 ≤ 1e-9、history 数变为 3、索引 0 的新条目 `data-operator === "+"` 且 `data-operands === ["2","4","10"]` 且结果 16、编辑态结束；索引 1、2 的原记录快照与相对顺序不变；再点开索引 0 新记录的 history-edit，删除全部 chip 后按 `=`，断言 history 数仍为 3 且无 pageerror。H11 全新加载完成 2 次计算后断言 history 数为 2；`page.reload()` 后断言 history 数为 0、op-picker 可见、input 禁用、expression/result 为空、无 pageerror；另开全新浏览器上下文加载同一 file URL，断言 history 数为 0。H12 在 H3–H11 全部交互上收集 pageerror 与 console error 计数，并在两次全新加载中执行同一四计算序列，将历史序列化为 `[{operator, operands, resultValue, expressionText}]` 后深度比对。
环境与工具（当前主机实测）：Node v22.23.2；jsdom@27.2.0 已全局安装（`require('jsdom')` 失败时先 `export NODE_PATH=$(npm root -g)` 再重试）；Playwright 浏览器已缓存在 `/root/.cache/ms-playwright`（chromium-1248，对应 `playwright@1.64.0`），网络可用。可在 `/tmp` 或本 gate 目录执行 `npm i playwright@1.64.0`，脚本通过绝对路径或 gate 目录下的 `node_modules` 解析；**不得**把 `node_modules` 安装到 `/ws/cal_phone` 根目录。若浏览器缓存不可用可让 Playwright 自行下载；仍不可用则按缺设备拒答，不能伪装成产物 FAIL。
phase=first 时把验证逻辑写成脚本 `/ws/cal_phone/Telos/phone-calculator-history-111508/evidence/verify.mjs`（接受轮号参数）并立即以 `node verify.mjs <round>` 运行；它按上面不变量逐条实测并写 `hard-r<N>.txt`：先写 `ROUND: <N>`、`ARTIFACT_SHA256: <64hex>`、`VERIFIER_SHA256: <64hex>`（脚本自身 sha256），再每条 `H<id> PASS|FAIL — 实测值/证据`，末行**严格** `HARD: PASS` 或 `HARD: FAIL (Hx,…)`。
若 runtime contract 的 `expected_review_states` 非 none：同一脚本还须把每个状态用 Playwright/无头 Chrome 渲染成**非空、非纯色、内容互不重复**的 PNG（≥ 240×160；真 320px 用 CDP `Emulation.setDeviceMetricsOverride`）落 `review-shots/r<N>/S<k>.png`——精确且仅这些文件；把带同样头的可见性/溢出/关键尺寸 `key=value` 实测写 `render-r<N>.txt`；写 `manifest-r<N>.json`：`round`、`artifact_sha256`、`verifier_sha256`、`metrics_sha256`、每张图的 `file/sha256/width/height`、`adhoc: []`。
phase=final 时**禁止读取、运行或修改 verify.mjs / ledger / 旧证据**，在你被启动的隔离 scratch cwd 中重新推导全套检查；临时测量只落当前 scratch 目录，最终回复给出裁决，由 CLI 保存（不要自行写 `-o` 路径）；首行同样是 `ROUND:`、`ARTIFACT_SHA256:`，末行同样严格。
HARD-VERIFY-PROMPT>>>

---

## 5. 运行与停止（命令按需选用，非逐行执行的脚本；停止数字只在 frontmatter）
    # gate=/ws/cal_phone/Telos/phone-calculator-history-111508 · rendered by kekkai new — do not edit
    kekkai doctor --gate "/ws/cal_phone/Telos/phone-calculator-history-111508" --host     # before round 1 and after any host change
    kekkai hard "/ws/cal_phone/Telos/phone-calculator-history-111508"                     # r1: independent author writes evidence/verify.mjs; later rounds replay it
    kekkai adhoc "/ws/cal_phone/Telos/phone-calculator-history-111508" -- <command…>      # same-round measurement admissible as 误报 basis
    kekkai recast "/ws/cal_phone/Telos/phone-calculator-history-111508" --reason "<why>"  # sick instrument: quarantine + fresh independent author (≤3 eras)
    kekkai hard "/ws/cal_phone/Telos/phone-calculator-history-111508" --final             # terminal independent stamp at the stop candidate
    kekkai lint "/ws/cal_phone/Telos/phone-calculator-history-111508" --post              # after round 1, on recovery, before STOP
    kekkai close "/ws/cal_phone/Telos/phone-calculator-history-111508" --by <budget|host|instrument|oscillation|human> --blocker "<one sentence>"

- **轮次 = runner 提升进 `evidence/runs/hard-r<N>.txt` 的 canonical 盖章**；其余一切都是尝试（`evidence/attempts/`），不写台账、不占预算、不动 K。轮号由 runner 分配，不要手填；不要手跑 `node verify.mjs` 再拷文件进 runs/（缺 runner 头会被拒绝）。
- **`kekkai hard` 退出码**：`0` 提升为轮；`2` 尝试已归档（先读 `kekkai status --json` 和消息：若该轮已提升但 final 缺失，补 `--final`；否则修因后继续，不盲重跑）；`3` 重复/尝试上限——只有三条合法路：(1) change the business tree, (2) `kekkai recast --reason`, (3) `kekkai close --by <tag>`；`4` 规则拒绝（读消息，别原样重试）。管道故障同一输入有重试上限；无法修复就 `close`，不换措辞/增预算绕过。
- **首个 hard PASS 轮 runner 自动跑审计 final**；final 与量具不一致 ⇒ final 的 FAIL 成立，只能修代码或 `kekkai recast`，永不再跑一次 final 试运气。
- **停止**：`converged` = 最新轮 hard PASS + 当前产物/业务树字节的同 era 独立 final PASS（hard-only 不需要软评或 K 确认轮），且未超 frontmatter `max_rounds`；任何轮数（含 0）都可以 `kekkai close --by <budget|host|instrument|oscillation|human>` 写 blocked 终态并附 `blocker:` 行——绝不把 gate 停在 in-loop 而无 STOP。
- 第 1 轮后、恢复时、写 STOP 前各跑一次 `kekkai lint <本目录> --post`；`POST-IN-PROGRESS` 是运行中的预期警告。

---

## 附录 · 生成器判断记录（可审计的 taste↔structure 边界）
> 让执行者能看懂哪些是「结构强制」、哪些是「生成器的 taste 取舍」。不要复述停止数字（它们只在 frontmatter）。
- **为何 hard-only**：历史记录、编辑恢复与重算追加都是可确定性测量的行为；没有品牌、视觉质感或信息层级等主观目标。移动端可用性继续用可测阈值（横向溢出、44px 触控、输入字号）纳入硬闸，因此 `--soft none`，不设 §4 与像素评审。
- **为何记录父闸**：本 gate 是在已收敛的 `phone-calculator-111507` 产物上追加功能，`parent_gate` 只记录血缘；hard-only 子闸不继承父闸的决策表、证据、量具或轮次，所有 H 都必须在本 gate 内重新实测。
- **编辑语义来自用户确认**：用户明确选择「可修改运算符和数字」「重算追加新记录、原记录保留」「历史仅当前页面」。因此编辑态下更换运算符不得清空已载入的操作数（这与普通选择运算符会重置的既有行为不同），编辑重算也不得覆盖源记录。
- **为何新增 `data-operator` / `data-operands` / `edit-draft` / `operand-chip` 契约**：编辑的正确性必须能逐步测量「载入了哪些数字、删掉了哪个、追加了什么、新记录是什么」，仅靠可见文案会随样式与措辞变化而脆断。原始显示字符串（而非归一化数值）保留用户输入，便于精确断言顺序与内容。
- **为何 number 修改用 chip 删除 + 重新输入**：复用现有「输入数字回车提交」的交互，不引入新的表达式解析器；删除错误数字再补正确数字即可完成修改，测试也能稳定定位中间操作数。
- **为何刷新清空**：用户选择仅当前页面；H11 用 reload 与全新上下文两种行为测量，不检查具体存储实现，避免把实现选择冻结成红线。
- **为何用 float64**：沿用现有计算器的左到右浮点折叠口径，不引入任意精度；数值断言统一用 1e-9 容差。
- **工具取舍**：用无头 Playwright（chromium-1248 已缓存）做真实键盘/点击/视口测量，jsdom 仅作辅助；不设 `--requires-display`，因为无头浏览器测量不依赖真实桌面解锁。
- **volatile 为空**：仓库没有构建产物或日志；gate 目录本身被 TREE_SHA256 排除，依赖安装不会污染业务树。
