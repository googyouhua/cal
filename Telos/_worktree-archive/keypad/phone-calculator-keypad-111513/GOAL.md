---
# ── Kekkai Goal Gate v4 · frontmatter（唯一机读区；停止数字只在这里；矩阵/不变量内容只在正文表格）──
slug: phone-calculator-keypad-111513
version: 4
model_profile: astra-flash-3.8-v1  # 新任务冻结模型组合；执行中不可修改
status: converged                  # draft | in-loop | converged（blocked 终态保持 in-loop）
repo: /ws/cal_phone-worktrees/keypad
artifact: /ws/cal_phone-worktrees/keypad/index.html
# artifact_kind: url | app | service   # 仅 artifact: null 时启用；此时 ARTIFACT_SHA256 := TREE_SHA256
parent_gate: /ws/cal_phone/Telos/phone-calculator-sticky-operator-111512/GOAL.md                  # 子闸填父 GOAL.md 绝对路径；只继承 round-0 决策，不继承证据或 verify.mjs
verifiers:
  hard: codex exec                 # 固定驱动器；pin 与访问标志在 bin/runner.mjs（docs/RUNNER.md）
  soft: null
stop:
  max_rounds: 10
hard_invariants: [H1, H2, H3, H4, H5, H6, H7, H8, H9, H10, H11, H12]
volatile: []                       # TREE_SHA256 排除的仓库相对路径（构建产物、日志等）；空数组即可
---

# Kekkai Goal Gate · 手机计算器统一数字键盘与单屏布局

> **运行指令**：你是执行者（Codex / Claude Code / ZCode / Cursor 之一，由 handoff 指定；生成本 gate 的那次调用不得兼任）。
> 开跑前先 `kekkai doctor --gate <本目录> --host`；只有 `requires_display: true` 的真实桌面测量依赖解锁与屏幕权限，普通无头浏览器/逻辑测量不占屏。
> 读**本文件全文** + 同目录 [`./ledger.md`](./ledger.md)（决策台账），然后只用 §5 的命令块驱动验收，直到 §5 的停止条件；在已授权范围内自主推进，缺少外部输入时写明 blocked 与恢复条件。
> 生命周期编辑是唯一允许的 GOAL 改动：第 1 轮前 `status: draft → in-loop`；写 `converged` STOP 前 → `status: converged`；blocked 终态保持 `in-loop`。
> 除此之外 GOAL.md 只读：不改 frontmatter 数字、不改 prompt、不改变 §5 命令的操作、目标路径和关键参数（注释与空白不影响验收）。
> 教义在 Kekkai skill 的 `docs/CREED.md`、runner 契约在该 skill 的 `docs/RUNNER.md`——本文件不复述它们；`kekkai hard/soft` 的退出码与消息就是你的下一步。

## 1. 目标（一句话 + 背景 + 实施指导）
把手机计算器的主输入从系统软键盘换成**一个统一的屏幕数字键盘**：键盘里有 0–9、小数点、退格、**较大的回车键**、**较大的等号键**，以及四个可切换的运算符；用户不再需要弹出系统键盘，也不再需要在小键盘和运算符之间来回找入口。键盘和算式/结果必须在 320×568 与 390×844 的首屏内同时可见，方便边输入边查看。保留已收敛的「运算符粘性连续计算」、历史记录、历史数字直改、重置、除零恢复与移动端可用性。

**实施指导**：
主输入框 `calc-input` 改为只读展示（`readOnly` + `inputmode="none"`），所有数字输入由自定义键盘写入它的 `value`；不要依赖系统软键盘。新增 `[data-testid="keypad"]` 容器，里面放四个 `[data-op]` 运算符按钮、数字键 `[data-key="0"]`…`[data-key="9"]`、小数点 `[data-key="."]`、退格 `[data-key="backspace"]`、回车 `[data-key="enter"]`、等号 `[data-key="equals"]`；等号键同时保留 `data-testid="key-equals"`，重置键 `key-op` 继续保留。数字键把字符追加到 `calc-input.value`；小数点只允许一个；退格删除最后一个字符，空值 no-op；回车调用现有提交逻辑把当前数字加入算式；等号调用现有计算逻辑。select 态数字/退格/回车/等号禁用、四个运算符可用；选中运算符后数字键启用；结果态与错误态继续保持数字键可用（运算符粘性），上一次结果不参与新计算。布局上压缩页头/状态行/显示区的垂直空间，把 `op-picker` 移入键盘容器，让键盘底部在 320×568 首屏内不超出视口；历史面板放在键盘之后，允许在首屏之下滚动。回车与等号的可点击面积至少是数字键中位面积的 1.5 倍。历史编辑的 `operand-input` 保持可直接编辑（那是上一轮确认的独立能力）；键盘负责主计算输入，编辑态也可以通过键盘数字+回车追加新操作数。继续使用 float64 从左到右折叠，不引入表达式解析器、不持久化历史、保持单文件、无外部依赖、所有可见控件 ≥44×44、输入字号 ≥16px、窄屏无横向溢出。外部前提：无需账号、服务、真实设备或人工授权；验收在无头 Chromium 中完成。

> 外部前提（账号、服务、人工决定、设备权限）应在实施指导中明确；缺失时保留证据并 blocked，不把无法由代码修复的条件塞进硬不变量反复重跑。

## 2. 不变约束（父级红线 · 任何修改不得破坏）
> 每条红线**必须标注归属**：`[H#]`（由该硬不变量机检）或 `[soft-only: 原因]`（只能主观把关，写明为何无法机检）。绝对不能改的代码块优先给 sha256 机检形式。不允许留下既非 `[H#]` 也非 `[soft-only]` 的悬空红线。
- 页面仍必须是可自包含加载的单文件 `index.html`：`</html>` 闭合、字节数 ≥ 1024，且不引用 `http(s):` 或协议相对的外部 script/link/img/font/@import [H1]
- 键盘与算式/结果必须同屏：320×568 与 390×844 首屏内 `expression`、`result`、`keypad` 均完整可见，键盘底部不超出视口，无横向溢出，所有可见控件 ≥44×44，回车/等号面积 ≥ 数字键中位面积的 1.5 倍 [H2]
- 主输入必须由统一键盘驱动：`calc-input` 为 `readOnly` 且 `inputmode="none"`，聚焦后键入数字不得改变其值；键盘必须包含四个运算符、0–9、小数点、退格、回车、等号，等号同时保留 `key-equals` hook；select 态数字键禁用、选运算符后启用 [H3]
- 键盘数字、小数点与退格必须正确：数字追加到当前值；小数点最多一个；退格删除最后一个字符，空值 no-op；回车提交当前数字，等号计算 [H4]
- 键盘必须支持运算符粘性连续计算：一次 `=` 后数字键仍可用，直接输入新数字+回车+等号即可用同一运算符计算，上一次结果不参与；需要时点键盘上的另一个 `[data-op]` 切换 [H5]
- 键盘运算符切换必须符合既有语义：`input` 态换运算符保留已输入数字并重绘算式；`result`/`error` 态换运算符为下一次全新计算做准备；`key-op` 重置清除当前运算符并保留历史 [H6]
- 通过键盘完成的每次成功计算必须在历史顶部恰好追加一条记录，字段完整且最新在前；空回车、除零、无操作数不写历史；历史不得跨刷新或跨页面存活 [H7]
- 历史编辑的数字直改能力不得回退：`operand-input` 可直接编辑，修改后算式区反映新值，按 `=` 用新值重算并追加新记录，源记录不变 [H8]
- 编辑态必须支持多数字修改、换运算符、删除 chip、通过键盘数字+回车追加操作数；换运算符或删除其他 chip 不得丢失已修改的数字 [H9]
- 编辑态操作数输入为空或非有限数时，按 `=` 不得新增历史、不得抛错、不得产生新的结果 `data-value`；修正后必须能继续计算 [H10]
- 编辑态除零必须进入可见错误态、不写历史、源记录不变；错误态键盘数字键仍可用，能直接换运算符或输入新数字恢复 [H11]
- 全流程不得产生未捕获页面错误或 console error；同一键盘连续计算序列在两次全新加载中产生完全一致的历史数据 [H12]

> 允许改动的范围豁免写在下面的定界块里（runner 会把它**逐字**内联进 first / recast / final 验收器的 runtime contract，避免首轮判合规、末轮判违规的判定分裂）。没有豁免就写 `无`。

<<<SCOPE-EXEMPTIONS
无
SCOPE-EXEMPTIONS>>>

---

## 3. 硬目标（独立确定性验收 · 硬闸 · codex exec）

**输入矩阵（采样覆盖；含边界与「哪些算、哪些拒答」）：**
状态 ∈ {初始 select, 已选类型 input, 成功 result, 除零 error, 编辑 edit}；历史条目数 ∈ {0, 1, 3}；视口 ∈ {320×568, 390×844}；键盘输入 ∈ {单个数字, 多位数, 小数, 重复小数点, 退格到空, 空退格, 回车提交, 等号直接计算}；连续计算 ∈ {同一运算符连续 2–3 次, 结果态直接输入新数字, 结果态空等号}；运算符变化 ∈ {键盘上换运算符, 输入到一半换运算符并保留数字, 错误态换运算符恢复}；编辑动作 ∈ {改一个数字, 改多个数字, 换运算符, 删除中间 chip, 键盘数字+回车追加, 输入空值, 输入非数字, 把除号操作数改成 0}；页面生命周期 ∈ {首次加载, 刷新后, 全新上下文}。预期：键盘数字只改 `calc-input.value`，不弹系统键盘；回车提交数字，等号计算；成功 `=` → 历史顶部加一条；空回车/除零 → 不加；结果态继续用同一运算符；编辑改数字 → 新结果追加且源记录不变；首屏内键盘与结果同时可见；刷新/新上下文 → 历史为 0 条并回到 select 态。

**稳定测试入口：** 既有：`main.app[data-state]`（取值 `select`、`input`、`result`、`error`、`edit`）、`main.app[data-operator]`（普通计算态为当前运算符；select 态缺失或为空）、`[data-testid="op-picker"]`（内含 `[data-op="+"]`、`[data-op="-"]`、`[data-op="*"]`、`[data-op="/"]`）、`input[data-testid="calc-input"]`（本闸要求 `readOnly` 且 `inputmode="none"`）、`[data-testid="expression"]`、`[data-testid="result"]`（成功时 `data-value` 为数值字符串，除零时 `data-error="true"`）、`button[data-testid="key-equals"]`、`button[data-testid="key-op"]`、`[data-testid="history"]`、`[data-testid="history-item"]`（带 `data-operator` 与 `data-operands`，后者可 `JSON.parse` 为按输入顺序的原始显示字符串数组）、条目内 `[data-testid="history-expression"]`、`[data-testid="history-result"]`（带 `data-value`）、`button[data-testid="history-edit"]`、`[data-testid="edit-draft"]`（带 `data-operator`）、`[data-testid="operand-chip"]`、`button[data-testid="operand-remove"]`、`input[data-testid="operand-input"]`（编辑态每个操作数一个，`value` 为当前显示字符串）。新增：`[data-testid="keypad"]` 容器；数字键 `button[data-key="0"]`…`[data-key="9"]`；小数点 `button[data-key="."]`；退格 `button[data-key="backspace"]`；回车 `button[data-key="enter"]`；等号 `button[data-key="equals"]`（同一元素同时带 `data-testid="key-equals"`）；四个 `[data-op]` 必须在 `[data-testid="keypad"]` 内的 `[data-testid="op-picker"]` 中。

**不变量：**

| # | 不变量 | 硬闸怎么验（须真跑，非读源码目测） | 阈值 |
|---|---|---|---|
| H1 | 页面为可加载的自包含单文件且加载不抛错 | Playwright 以 `file://` 打开 `/ws/cal_phone-worktrees/keypad/index.html` 并监听 `pageerror`；Node 用 `fs.readFileSync` 读取原始 HTML，断言 `</html>` 存在且字节数达标，并统计 `<script src>`、`<link href>`、`<img src>`、`@import`、`url(...)` 中指向 `(https?:)?//` 的数量 | 0 个 pageerror；`</html>` 存在；字节数 ≥ 1024；外部引用 0 处 |
| H2 | 键盘与结果在手机首屏内同屏 | Playwright 在 320×568 与 390×844（`isMobile: true, hasTouch: true`）各建上下文；每个视口测 select 态与 result 态（result 态先用键盘算两条记录）；在 scrollY=0 读取 `[data-testid="expression"]`、`[data-testid="result"]`、`[data-testid="keypad"]` 的 `getBoundingClientRect()`、`documentElement`/`body` 的 `scrollWidth`/`clientWidth`、`innerHeight`，以及所有可见 `button, input, [data-key], [data-op]` 的尺寸和数字键/回车/等号面积 | 两种视口两种状态均：expression/result/keypad 在视口内，`result.bottom <= keypad.top + 1`，`keypad.bottom <= innerHeight`，无横向溢出；每个可见控件宽高 ≥ 44（容差 0.5px）；回车与等号面积各 ≥ 数字键中位面积的 1.5 倍 |
| H3 | 统一键盘结构与系统键盘抑制 | 加载后断言 `[data-testid="keypad"]` 可见，其中 `[data-testid="op-picker"]` 恰有 4 个 `[data-op]`，且存在 `[data-key="0"]`…`[data-key="9"]`、`[data-key="."]`、`[data-key="backspace"]`、`[data-key="enter"]`、`[data-key="equals"]`；等号元素同时有 `data-testid="key-equals"`；断言 `calc-input.readOnly === true` 且 `inputMode === "none"`；聚焦 `calc-input` 后 `page.keyboard.type("123")`，断言其 `value` 不变；select 态断言数字/退格/回车/等号 `disabled === true`、四个 `[data-op]` 未禁用；点击 `[data-op="+"]` 后断言数字键 `disabled === false`、`calc-input` 仍只读 | 结构、属性、禁用态与只读输入断言全部成立；键入数字后 `value` 不变 |
| H4 | 键盘数字、小数点与退格 | 全新加载选 `+`；依次点击 `[data-key="1"]`、`[data-key="2"]`、`[data-key="."]`、`[data-key="5"]`，断言 `calc-input.value === "12.5"`；再点 `[data-key="."]` 断言仍为 `"12.5"`；点退格断言 `"12."`，再点两次断言 `"12"`、`"1"`，再点断言 `""`，空值再点退格断言仍为 `""` 且无 pageerror；点击 `3`、`0`、回车，断言 `calc-input.value === ""`、expression 含 `30` 与 `+`、history 数为 0；点击 `4`、等号，断言 result 为 34、history 数为 1、新条目 `data-operator === "+"`、`data-operands === ["30","4"]`；另以全新加载点击 `1`、`.`、`5`、回车、`2`、`.`、`2`、`5`、等号，断言结果 3.75、history 数为 2 | 输入值序列精确；重复小数点不追加；退格到空与空退格 no-op；34、3.75 误差 ≤ 1e-9；history 计数正确 |
| H5 | 键盘回车/等号与运算符粘性 | 全新加载选 `+`；点击 `1`、`2`、回车、`3`、`0`、回车、等号，断言结果 42、history 数为 1；结果态断言数字键 `disabled === false`、`calc-input.value === ""`；不点任何 `[data-op]`，点击 `5`、回车、`6`、回车、等号，断言结果 11、history 数为 2、索引 0 新条目 `data-operator === "+"`、`data-operands === ["5","6"]`、结果为 11，索引 1 原记录快照不变；点击 `[data-op="*"]`，再点击 `5`、回车、`6`、回车、等号，断言结果 30、history 数为 3、索引 0 新条目 `data-operator === "*"`、`data-operands === ["5","6"]`、结果为 30，前两条记录不变 | 结果 42、11、30 误差 ≤ 1e-9；第二次 `+` 计算未点击运算符；新记录只含新操作数；旧记录不变 |
| H6 | 键盘运算符切换与重置 | 全新加载断言 keypad 可见、数字/退格/回车/等号禁用、四个 `[data-op]` 可用、`calc-input.readOnly === true`、`data-operator` 缺失或为空；点击 `+` 断言 `data-operator === "+"`、数字键启用；点击 `*` 断言 `data-operator === "*"`；点击 `+` 断言 `data-operator === "+"`、expression 为空、history 为 0；点击 `5`、回车、`6`、回车，点击 `*`，断言 `data-operator === "*"`、expression 含 5、6 与 `*` 且不含 `+`、数字键仍启用；点击等号，断言结果 30、history 数为 1、新条目为 `* ["5","6"]=30`；点击 `key-op`，断言 `data-state="select"`、`data-operator` 缺失或为空、数字键禁用、history 快照不变 | 运算符切换与表达式重绘正确；输入到一半换运算符保留 5、6；重置清除运算符且保留历史 |
| H7 | 键盘计算的历史记录与会话性 | 全新加载通过键盘依次计算 `+` 12/30/8=50、`-` 10/4/3=3、`*` 2/3/4=24、`+` 1.5/2.25=3.75（每次先点对应 `[data-op]`，数字用键盘，回车提交，等号计算）；每次 `=` 后断言 history 数恰好加 1、最新条目在索引 0；对每个最新条目断言 `data-operator`、`JSON.parse(data-operands)` 与输入顺序的原始显示字符串数组完全相等、`history-result[data-value]` 与预期差 ≤ 1e-9、`history-expression` 非空且含全部操作数与可接受运算符字形；最终自顶向下为 `+["1.5","2.25"]=3.75`、`*["2","3","4"]=24`、`-["10","4","3"]=3`、`+["12","30","8"]=50`；空回车与 `/` 5/0 除零不新增记录；`page.reload()` 后 history 数为 0、select 态；全新浏览器上下文加载同一 file URL 后 history 数为 0 | 4/4 次追加条数正确；顺序、运算符、操作数数组、结果精确匹配；误差 ≤ 1e-9；空回车/除零 0 条；刷新与新上下文 0 条 |
| H8 | 历史编辑数字直改回归 | 全新加载通过键盘计算 `+` 12/30/8=50 与 `*` 2/3/4=24（后者最新）；快照两条记录；点击较旧 `+` 记录的 `history-edit`，断言 `data-state="edit"`、edit-draft 可见、`data-operator === "+"`、恰好 3 个 `operand-input` 且 `value` 依次为 `["12","30","8"]`、每个 input 未禁用且未只读；把中间 input 填为 `5`，断言 expression 文本含 `5` 且不含 `30`；点击等号，断言 result 的 `data-value` 与 25 差 ≤ 1e-9、history 数为 3、索引 0 新条目 `data-operator === "+"`、`data-operands === ["12","5","8"]`、结果为 25、编辑态结束；索引 1、2 的原记录快照逐字段不变 | 初始 operand-input 值逐项相等；改数字后 expression 反映新值；新结果 25；新记录操作数为 `["12","5","8"]`；原记录不变；无 pageerror |
| H9 | 编辑态多数字、换运算符、删除与键盘追加 | 全新加载通过键盘计算 `*` 2/3/4=24 与 `+` 1.5/2.25=3.75（后者最新）；点击较旧 `*` 记录的编辑入口；点击 `[data-op="+"]`，断言 edit-draft 的 `data-operator === "+"` 且三个 `operand-input` 仍为 `["2","3","4"]`；把第 1 个 input 填为 `10`、第 3 个填为 `5`，断言 expression 含 10 与 5；点击中间 chip 的 `operand-remove`，断言剩余 input 值依次为 `["10","5"]`；用键盘点击 `[data-key="2"]`、`[data-key="enter"]`，断言 input 值依次为 `["10","5","2"]`；点击等号，断言结果 17、history 数为 3、索引 0 新条目 `data-operator === "+"`、`data-operands === ["10","5","2"]`、结果为 17；索引 1、2 的原记录快照与相对顺序不变 | 换运算符后 input 值不变；删除后剩余已改值保留；键盘追加后序列精确；新结果 17；原记录不变；无 pageerror |
| H10 | 编辑态非法输入 no-op | 全新加载通过键盘计算 `+` 12/30/8=50；点击该记录的编辑入口；把中间 `operand-input` 填为空串后点击等号，断言 history 数仍为 1、result 无 `data-value`、无 pageerror；再把该 input 填为 `abc` 后点击等号，断言同样 no-op；最后填为 `5` 并点击等号，断言结果 25、history 数为 2、新条目操作数为 `["12","5","8"]` | 空值与 `abc` 均不新增历史、不产生新 `data-value`、不抛错；修正后正常得到 25 且追加 1 条 |
| H11 | 编辑态除零与键盘恢复 | 全新加载通过键盘计算 `/` 100/5/2=10；点击该记录的编辑入口；把第 2 个 `operand-input` 填为 `0` 后点击等号，断言 `data-state="error"`、result 的 `data-error === "true"`、history 数仍为 1、原记录快照不变、无 pageerror、keypad 可见、数字键 `disabled === false`、`calc-input.readOnly === true`；点击 `[data-op="+"]`，断言 `data-operator === "+"`、数字键可用；点击 `1`、`[data-key="enter"]`、`2`、`[data-key="enter"]`、等号，断言结果 3、history 数为 2 | 编辑态除零可见错误且 0 条新增；原记录不变；错误态键盘可用；换运算符后 1+2=3 误差 ≤ 1e-9 |
| H12 | 全流程无页面错误且历史确定 | 在 H3–H11 的全部交互上累计 `pageerror` 与 console `error` 消息；在两次全新加载中执行同一键盘序列：选 `+`、12/30/8=50、5/6=11（不点运算符）、点 `*`、5/6=30；把每次 history 序列化为 `[{operator, operands, resultValue, expressionText}]` 并深度比对 | pageerror=0、console error=0；两次序列化历史完全相同 |

<<<HARD-VERIFY-PROMPT
你是确定性验收器。**不要评价 UI 美观、不要改产物源码。**本 prompt 会被单独抽取喂给你（读不到 frontmatter 与上表），所以下面所有文件都写**绝对路径**、基线写 **sha256 值**；runner 会在其后追加 `[RUNTIME CONTRACT]`（round / phase / gate_dir / evidence_dir / out_dir / artifact_sha256 / expected_review_states / SCOPE-EXEMPTIONS 原文），以它为准。
按本闸输入矩阵 / 不变量逐条**实际执行**验证：优先复用已有测试入口，逻辑用 Node 调用函数并断言返回值/异常；界面用 Playwright/jsdom 操控稳定选择器并读值。基线只用于本任务明确要求不可更改的范围，不能自行冻结整个源码或妨碍授权修复。采用项目已有工具与依赖；缺依赖或设备时明确拒答，不能伪装成代码 FAIL。禁止用主观语言/肉眼通读代替实测证据。
量具卫生（三条，写量具时逐条自查）：① 不得含写死的恒 FAIL/恒 PASS 常量判据；② 扫描类不变量的扫描面必须与 §3 声明逐字一致、不得自行扩张，且**不得包含 evidence/ 或 evidence/runs/**（自引用扫描面一旦被本循环必写的证据污染就永远翻不了绿）；③ 断言锚定稳定选择器/数据钩子而非用户可见文案原文（软闸可能正当地要求改文案）；子进程/步骤超时 ≥ 单次实测耗时的 2 倍。
量具接口（两条，runner 靠它做变异检查与尝试隔离，缺一即拒绝提升）：① 环境变量 `KEKKAI_ARTIFACT` 存在时用它覆盖目标文件路径；② `KEKKAI_OUT_DIR` 存在时，`hard-r<N>.txt` / `render-r<N>.txt` / `manifest-r<N>.json` / `review-shots/r<N>/` 全部写到该目录下，而不是 evidence/runs（所有路径以脚本自身所在目录解析、不依赖 cwd）。
目标文件（绝对路径）：/ws/cal_phone-worktrees/keypad/index.html
本闸具体：被测文件是 `/ws/cal_phone-worktrees/keypad/index.html`，一个可从 `file:///ws/cal_phone-worktrees/keypad/index.html` 直接加载的单文件手机计算器。稳定契约分两组。既有 hook（不得删除或改名）：`main.app[data-state]` 取 `select`、`input`、`result`、`error`、`edit`；`main.app[data-operator]` 在普通计算态（input/result/error）等于当前运算符，在 select 态缺失或为空字符串；`[data-testid="op-picker"]` 容器内恰好四个按钮 `[data-op="+"]`、`[data-op="-"]`、`[data-op="*"]`、`[data-op="/"]`；`input[data-testid="calc-input"]`；`[data-testid="expression"]`；`[data-testid="result"]`（成功时 `data-value` 是可 `parseFloat` 的十进制数值字符串，除零时 `data-error="true"`）；`button[data-testid="key-equals"]`；`button[data-testid="key-op"]`；`[data-testid="history"]`；`[data-testid="history-item"]`（带 `data-operator` 与 `data-operands`，后者 `JSON.parse` 后是按输入顺序的原始显示字符串数组）；条目内 `[data-testid="history-expression"]`、`[data-testid="history-result"]`（带 `data-value`）、`button[data-testid="history-edit"]`；`[data-testid="edit-draft"]`（带 `data-operator`）；`[data-testid="operand-chip"]`；`button[data-testid="operand-remove"]`；`input[data-testid="operand-input"]`（编辑态每个操作数一个，`value` 为当前显示字符串）。新增 hook：`[data-testid="keypad"]` 容器，必须包含 `[data-testid="op-picker"]`（四个 `[data-op]` 在其中）、`button[data-key="0"]`…`button[data-key="9"]`、`button[data-key="."]`、`button[data-key="backspace"]`、`button[data-key="enter"]`、`button[data-key="equals"]`；等号元素同时带 `data-testid="key-equals"`。
交互契约：主输入 `calc-input` 必须是 `readOnly === true` 且 `inputMode === "none"`，聚焦后键入数字不得改变其 `value`；所有主输入数字由键盘写入。初始 select 态：keypad 可见、四个 `[data-op]` 可用、数字/退格/回车/等号禁用、`calc-input` 只读、`data-operator` 缺失或为空、history 为 0。点击 `[data-op]` 后进入 input 态：数字/退格/回车/等号启用，`data-operator` 等于所选运算符。点击数字键把对应字符追加到 `calc-input.value`；小数点最多一个（已含 `.` 时再点不追加）；退格删除最后一个字符，空值 no-op；点击回车键调用提交逻辑：把当前数字作为一个操作数加入算式，清空 `calc-input.value`，expression 更新，history 不变；空输入回车 no-op。点击等号键调用计算逻辑：先提交当前未确认数字（若有），按当前运算符把已提交操作数从左到右折叠，结果写入 result 的 `data-value`，history 顶部恰好新增一条只含本次新操作数的记录。**运算符是粘性的：一次成功 `=` 后进入 result 态，保留 `data-operator`，数字/退格/回车/等号仍启用，`calc-input` 仍只读；不需要再点任何 `[data-op]`，直接输入新数字+回车+等号即可用同一运算符开始全新计算，上一次结果不得作为新列表的操作数。** result 态空等号必须 no-op。需要换运算符时点击另一个 `[data-op]`：在 input 态更换运算符必须保留已提交的操作数并重绘 expression；在 result 态更换运算符只更新当前运算符并为下一次全新计算做准备，history 不变；在 error 态更换运算符清除错误/算式/结果并准备新计算。除零进入 `data-error="true"` 的 error 态且不新增历史；error 态数字键仍可用，输入新数字或换运算符后输入可直接开始新计算。点击 key-op 回到 select 态、清除 `data-operator`、清空 expression/result，但保留全部历史和条目内容不变。点击某条 history-edit 进入 edit 态：edit-draft 可见，`data-operator` 等于该条目的 `data-operator`，每个操作数对应一个可编辑的 `operand-input`，其 `value` 初始等于该条目的 `data-operands` 对应项；`calc-input` 仍只读、op-picker 可见。编辑态修改某个 `operand-input` 后，`[data-testid="expression"]` 的文本必须反映新值（含新值、不含被替换掉的旧值）；编辑态点击不同 `[data-op]` 只改变 `edit-draft` 的 `data-operator`，所有 `operand-input` 的当前值与顺序不变；点击某 chip 的 operand-remove 删除该 chip，剩余 `operand-input` 的当前值与顺序不变；编辑态用键盘数字+回车可以在草稿末尾追加一个带 `operand-input` 的 chip；编辑态点击等号时读取全部 `operand-input.value`，空值或非有限数必须 no-op（不新增历史、不产生新的 result `data-value`、不抛错）；全部合法时按草稿运算符从左到右计算，结果写入 result 的 `data-value`，history 顶部恰好新增一条 `data-operator` 与 `data-operands`（等于当前输入值数组）一致的新记录，退出编辑态；所有既有条目（含被编辑的源条目）的 DOM 顺序、`data-operator`、`data-operands`、`history-expression` 文本、`history-result` 的 `data-value` 与文本都保持不变，仅整体下移一位。编辑态除零必须进入 `data-error="true"` 的 error 态、不新增历史、源记录不变，并保持 keypad 可见、数字键可用以便继续。刷新页面后 history 条目数必须为 0 且回到 select 态，不得借助 localStorage/sessionStorage 让历史跨刷新存活。页面不得引用外部 http(s) 或协议相对资源（允许 data: 与内联）。
逐条测量口径：H1 用 `fs.readFileSync` 读取 `/ws/cal_phone-worktrees/keypad/index.html` 断言 `</html>` 存在、`Buffer.byteLength >= 1024`，并用正则统计 `<script ... src>`、`<link ... href>`、`<img ... src>`、`@import`、`url(...)` 中指向 `(https?:)?//` 的数量为 0；同时用 Playwright 以 `file:///ws/cal_phone-worktrees/keypad/index.html` 打开并监听 `pageerror` 为 0。H2 用 Playwright 分别建立 320×568 与 390×844（`isMobile: true, hasTouch: true`）上下文；每个视口测 select 态与 result 态（result 态先用键盘算 `+` 12/30/8=50 与 `*` 2/3/4=24 两条记录）；在 scrollY=0 读取 expression/result/keypad 的 boundingRect、documentElement/body 的 scrollWidth/clientWidth、innerHeight，以及所有可见 `button, input, [data-key], [data-op]` 的尺寸；计算数字键 `[data-key="0"]`…`[data-key="9"]` 面积中位数，断言回车与等号面积各 ≥ 1.5×中位数；断言 expression/result/keypad 在视口内、`result.bottom <= keypad.top + 1`、`keypad.bottom <= innerHeight`、无横向溢出、所有可见控件宽高 ≥44（容差 0.5px）。H3 断言 keypad 可见、op-picker 在 keypad 内且恰有 4 个 `[data-op]`、0–9/./backspace/enter/equals 均存在、equals 同时带 `data-testid="key-equals"`、`calc-input.readOnly === true` 且 `inputMode === "none"`；聚焦 calc-input 后 `page.keyboard.type("123")` 断言 value 不变；select 态数字/退格/回车/等号 disabled 为 true、四个 data-op 未禁用；点击 `+` 后数字键 disabled 为 false、calc-input 仍只读。H4 选 `+` 后依次点击 `1`、`2`、`.`、`5`，断言 value 为 `"12.5"`；再点 `.` 仍为 `"12.5"`；退格得到 `"12."`、`"12"`、`"1"`、`""`，空值再退格仍为 `""` 且无 pageerror；点击 `3`、`0`、回车，断言 value 为 `""`、expression 含 30 与 `+`、history 为 0；点击 `4`、等号，断言 result 为 34、history 为 1、新条目 `data-operator === "+"` 且 `data-operands === ["30","4"]`；另以全新加载点击 `1`、`.`、`5`、回车、`2`、`.`、`2`、`5`、等号，断言结果 3.75、history 为 2。H5 选 `+` 后点击 `1`、`2`、回车、`3`、`0`、回车、等号，断言结果 42、history 为 1；结果态断言数字键 disabled 为 false、value 为 `""`；不点任何 data-op，点击 `5`、回车、`6`、回车、等号，断言结果 11、history 为 2、索引 0 新条目 `data-operator === "+"` 且 `data-operands === ["5","6"]` 且结果 11，索引 1 原记录快照不变；点击 `*` 后点击 `5`、回车、`6`、回车、等号，断言结果 30、history 为 3、索引 0 新条目 `data-operator === "*"` 且 `data-operands === ["5","6"]` 且结果 30，前两条不变。H6 全新加载断言 keypad 可见、数字/退格/回车/等号禁用、四个 data-op 可用、calc-input 只读、data-operator 缺失或为空；点击 `+` 断言 data-operator 为 `+`、数字键启用；点击 `*` 断言为 `*`；点击 `+` 断言为 `+`、expression 为空、history 为 0；点击 `5`、回车、`6`、回车，点击 `*`，断言 data-operator 为 `*`、expression 含 5、6、`*` 且不含 `+`、数字键仍启用；点击等号断言结果 30、history 为 1、新条目为 `* ["5","6"]=30`；点击 key-op 断言 select、data-operator 缺失或为空、数字键禁用、history 快照不变。H7 全新加载通过键盘依次计算 `+` 12/30/8=50、`-` 10/4/3=3、`*` 2/3/4=24、`+` 1.5/2.25=3.75，每次 `=` 后断言 history 数恰好加 1、最新条目在索引 0，并断言 data-operator、JSON.parse(data-operands)、history-result 的 data-value 与 history-expression 文本；最终自顶向下四条为 `+["1.5","2.25"]=3.75`、`*["2","3","4"]=24`、`-["10","4","3"]=3`、`+["12","30","8"]=50`；空回车与 `/` 5/0 除零后断言 history 不增加；page.reload() 后 history 为 0、select 态；全新浏览器上下文加载同一 file URL 后 history 为 0。H8 全新加载通过键盘计算 `+` 12/30/8=50 与 `*` 2/3/4=24，快照两条；点击较旧 `+` 记录的 history-edit，断言 edit 态、edit-draft 可见、data-operator 为 `+`、恰好 3 个 operand-input 且 value 依次为 `["12","30","8"]`、每个 input 未禁用且未只读；把中间 input 填为 `5`，断言 expression 含 5 且不含 30；点击等号，断言 result 的 data-value 与 25 差 ≤1e-9、history 为 3、索引 0 新条目 data-operator 为 `+` 且 data-operands 为 `["12","5","8"]` 且结果 25、编辑态结束；索引 1、2 原记录快照逐字段不变。H9 全新加载通过键盘计算 `*` 2/3/4=24 与 `+` 1.5/2.25=3.75，点击较旧 `*` 记录的编辑入口；点击 `+` 断言 edit-draft 的 data-operator 为 `+` 且三个 operand-input 仍为 `["2","3","4"]`；把第 1 个 input 填为 `10`、第 3 个填为 `5`，断言 expression 含 10 与 5；点击中间 chip 的 operand-remove，断言剩余 input 值依次为 `["10","5"]`；点击 `[data-key="2"]`、`[data-key="enter"]`，断言 input 值依次为 `["10","5","2"]`；点击等号，断言结果 17、history 为 3、索引 0 新条目 data-operator 为 `+` 且 data-operands 为 `["10","5","2"]` 且结果 17；索引 1、2 原记录快照与相对顺序不变。H10 全新加载通过键盘计算 `+` 12/30/8=50，点击该记录的编辑入口；把中间 operand-input 填为空串后点击等号，断言 history 仍为 1、result 无 data-value、无 pageerror；再把该 input 填为 `abc` 后点击等号，断言同样 no-op；最后填为 `5` 并点击等号，断言结果 25、history 为 2、新条目操作数为 `["12","5","8"]`。H11 全新加载通过键盘计算 `/` 100/5/2=10，点击该记录的编辑入口；把第 2 个 operand-input 填为 `0` 后点击等号，断言 error 态、result 的 data-error 为 `"true"`、history 仍为 1、原记录快照不变、无 pageerror、keypad 可见、数字键 disabled 为 false、calc-input 只读；点击 `+` 断言 data-operator 为 `+`、数字键可用；点击 `1`、回车、`2`、回车、等号，断言结果 3、history 为 2。H12 在 H3–H11 全部交互上收集 pageerror 与 console error 计数，并在两次全新加载中执行同一键盘序列（选 `+`、12/30/8=50、5/6=11 不点运算符、点 `*`、5/6=30），将 history 序列化为 `[{operator, operands, resultValue, expressionText}]` 后深度比对。
环境与工具（当前主机实测）：Node v22.23.2；jsdom@27.2.0 已全局安装（`require('jsdom')` 失败时先 `export NODE_PATH=$(npm root -g)` 再重试）；Playwright 浏览器已缓存在 `/root/.cache/ms-playwright`（chromium-1248，对应 `playwright@1.64.0`），网络可用。可在 `/tmp` 或本 gate 目录执行 `npm i playwright@1.64.0`，脚本通过绝对路径或 gate 目录下的 `node_modules` 解析；**不得**把 `node_modules` 安装到 worktree 根目录。若浏览器缓存不可用可让 Playwright 自行下载；仍不可用则按缺设备拒答，不能伪装成产物 FAIL。
phase=first 时把验证逻辑写成脚本 `/ws/cal_phone-worktrees/keypad/Telos/phone-calculator-keypad-111513/evidence/verify.mjs`（接受轮号参数）并立即以 `node verify.mjs <round>` 运行；它按上面不变量逐条实测并写 `hard-r<N>.txt`：先写 `ROUND: <N>`、`ARTIFACT_SHA256: <64hex>`、`VERIFIER_SHA256: <64hex>`（脚本自身 sha256），再每条 `H<id> PASS|FAIL — 实测值/证据`，末行**严格** `HARD: PASS` 或 `HARD: FAIL (Hx,…)`。
若 runtime contract 的 `expected_review_states` 非 none：同一脚本还须把每个状态用 Playwright/无头 Chrome 渲染成**非空、非纯色、内容互不重复**的 PNG（≥ 240×160；真 320px 用 CDP `Emulation.setDeviceMetricsOverride`）落 `review-shots/r<N>/S<k>.png`——精确且仅这些文件；把带同样头的可见性/溢出/关键尺寸 `key=value` 实测写 `render-r<N>.txt`；写 `manifest-r<N>.json`：`round`、`artifact_sha256`、`verifier_sha256`、`metrics_sha256`、每张图的 `file/sha256/width/height`、`adhoc: []`。
phase=final 时**禁止读取、运行或修改 verify.mjs / ledger / 旧证据**，在你被启动的隔离 scratch cwd 中重新推导全套检查；临时测量只落当前 scratch 目录，最终回复给出裁决，由 CLI 保存（不要自行写 `-o` 路径）；首行同样是 `ROUND:`、`ARTIFACT_SHA256:`，末行同样严格。
HARD-VERIFY-PROMPT>>>

---

## 5. 运行与停止（命令按需选用，非逐行执行的脚本；停止数字只在 frontmatter）
    # gate=/ws/cal_phone-worktrees/keypad/Telos/phone-calculator-keypad-111513 · rendered by kekkai new — do not edit
    kekkai doctor --gate "/ws/cal_phone-worktrees/keypad/Telos/phone-calculator-keypad-111513" --host     # before round 1 and after any host change
    kekkai hard "/ws/cal_phone-worktrees/keypad/Telos/phone-calculator-keypad-111513"                     # r1: independent author writes evidence/verify.mjs; later rounds replay it
    kekkai adhoc "/ws/cal_phone-worktrees/keypad/Telos/phone-calculator-keypad-111513" -- <command…>      # same-round measurement admissible as 误报 basis
    kekkai recast "/ws/cal_phone-worktrees/keypad/Telos/phone-calculator-keypad-111513" --reason "<why>"  # sick instrument: quarantine + fresh independent author (≤3 eras)
    kekkai hard "/ws/cal_phone-worktrees/keypad/Telos/phone-calculator-keypad-111513" --final             # terminal independent stamp at the stop candidate
    kekkai lint "/ws/cal_phone-worktrees/keypad/Telos/phone-calculator-keypad-111513" --post              # after round 1, on recovery, before STOP
    kekkai close "/ws/cal_phone-worktrees/keypad/Telos/phone-calculator-keypad-111513" --by <budget|host|instrument|oscillation|human> --blocker "<one sentence>"

- **轮次 = runner 提升进 `evidence/runs/hard-r<N>.txt` 的 canonical 盖章**；其余一切都是尝试（`evidence/attempts/`），不写台账、不占预算、不动 K。轮号由 runner 分配，不要手填；不要手跑 `node verify.mjs` 再拷文件进 runs/（缺 runner 头会被拒绝）。
- **`kekkai hard` 退出码**：`0` 提升为轮；`2` 尝试已归档（先读 `kekkai status --json` 和消息：若该轮已提升但 final 缺失，补 `--final`；否则修因后继续，不盲重跑）；`3` 重复/尝试上限——只有三条合法路：(1) change the business tree, (2) `kekkai recast --reason`, (3) `kekkai close --by <tag>`；`4` 规则拒绝（读消息，别原样重试）。管道故障同一输入有重试上限；无法修复就 `close`，不换措辞/增预算绕过。
- **首个 hard PASS 轮 runner 自动跑审计 final**；final 与量具不一致 ⇒ final 的 FAIL 成立，只能修代码或 `kekkai recast`，永不再跑一次 final 试运气。
- **停止**：`converged` = 最新轮 hard PASS + 当前产物/业务树字节的同 era 独立 final PASS（hard-only 不需要软评或 K 确认轮），且未超 frontmatter `max_rounds`；任何轮数（含 0）都可以 `kekkai close --by <budget|host|instrument|oscillation|human>` 写 blocked 终态并附 `blocker:` 行——绝不把 gate 停在 in-loop 而无 STOP。
- 第 1 轮后、恢复时、写 STOP 前各跑一次 `kekkai lint <本目录> --post`；`POST-IN-PROGRESS` 是运行中的预期警告。

---

## 附录 · 生成器判断记录（可审计的 taste↔structure 边界）
> 让执行者能看懂哪些是「结构强制」、哪些是「生成器的 taste 取舍」。不要复述停止数字（它们只在 frontmatter）。
- **为何 hard-only**：键盘输入、单屏可见、按钮尺寸都是可确定性测量的行为；没有品牌或视觉质感目标。因此 `--soft none`，不设 §4 与像素评审。
- **为何在 worktree 里建闸**：主工作树已有多个收敛闸和未提交的业务改动；键盘是独立增量，放在 `/ws/cal_phone-worktrees/keypad` 可以隔离开发，避免与主工作树的历史证据和未提交字节互相污染。基线是 sticky-operator 闸收敛后的 `index.html`（`908c79d3…`），复制进 worktree；主工作树不被改动。
- **父闸只记录血缘**：hard-only 子闸不继承父闸的决策表、证据、量具或轮次；sticky-operator 的连续计算与历史编辑语义在本闸 H5–H11 重新实测。
- **为何主输入 readOnly**：用户明确要摆脱系统软键盘。`readOnly` + `inputmode="none"` 是「不弹系统键盘」的可测代理；键盘按钮是主输入的唯一来源。历史编辑的 `operand-input` 仍可直接编辑，因为那是上一轮明确要求的能力；键盘负责主计算输入，编辑态也可以用键盘数字+回车追加操作数。
- **为何用 `data-key`**：数字/小数点/退格/回车/等号需要机器可读入口，不能靠按钮文案；等号同时保留 `data-testid="key-equals"` 以复用既有契约。
- **为何单屏阈值这样定**：320×568 是最紧的手机视口；要求 expression/result/keypad 在 scrollY=0 时都在视口内、键盘底部不超出、无横向溢出，才能保证「键盘+结果同屏」。历史面板允许在首屏之下滚动，因为用户的目标是边输入边看结果，不是同时看全部历史。
- **为何回车/等号要 ≥1.5× 数字键中位面积**：用户要求「可以大一点」；用相对面积而不是绝对像素，允许实现自由选择网格和跨列方式，同时保证它们确实比数字键更醒目。
- **为何连续计算用键盘重新验收**：键盘改变了输入入口，必须确认运算符粘性、回车提交、等号计算在键盘路径上仍然成立；不能拿旧闸的鼠标/键盘事件证据替代。
- **工具取舍**：用无头 Playwright（chromium-1248 已缓存）做真实点击、视口与尺寸测量；不设 `--requires-display`。
- **volatile 为空**：worktree 没有构建产物或日志；gate 目录本身被 TREE_SHA256 排除，依赖安装不会污染业务树。
