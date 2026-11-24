---
# ── Kekkai Goal Gate v4 · frontmatter（唯一机读区；停止数字只在这里；矩阵/不变量内容只在正文表格）──
slug: phone-calculator-edit-close-replace-111800
version: 4
model_profile: astra-flash-3.8-v1  # 新任务冻结模型组合；执行中不可修改
status: converged                  # draft | in-loop | converged（blocked 终态保持 in-loop）
repo: /ws/cal_phone
artifact: /ws/cal_phone/index.html
# artifact_kind: url | app | service   # 仅 artifact: null 时启用；此时 ARTIFACT_SHA256 := TREE_SHA256
parent_gate: /ws/cal_phone/Telos/phone-calculator-continue-edit-numbers-111511/GOAL.md                  # 子闸填父 GOAL.md 绝对路径；只继承 round-0 决策，不继承证据或 verify.mjs
verifiers:
  hard: codex exec                 # 固定驱动器；pin 与访问标志在 bin/runner.mjs（docs/RUNNER.md）
  soft: null
stop:
  max_rounds: 10
hard_invariants: [H1, H2, H3, H4, H5, H6, H7, H8, H9, H10, H11, H12, H13]
volatile: []                       # TREE_SHA256 排除的仓库相对路径（构建产物、日志等）；空数组即可
---

# Kekkai Goal Gate · 编辑历史记录的关闭退出与点选数字即替换

> **运行指令**：你是执行者（Codex / Claude Code / ZCode / Cursor 之一，由 handoff 指定；生成本 gate 的那次调用不得兼任）。
> 开跑前先 `kekkai doctor --gate <本目录> --host`；只有 `requires_display: true` 的真实桌面测量依赖解锁与屏幕权限，普通无头浏览器/逻辑测量不占屏。
> 读**本文件全文** + 同目录 [`./ledger.md`](./ledger.md)（决策台账），然后只用 §5 的命令块驱动验收，直到 §5 的停止条件；在已授权范围内自主推进，缺少外部输入时写明 blocked 与恢复条件。
> 生命周期编辑是唯一允许的 GOAL 改动：第 1 轮前 `status: draft → in-loop`；写 `converged` STOP 前 → `status: converged`；blocked 终态保持 `in-loop`。
> 除此之外 GOAL.md 只读：不改 frontmatter 数字、不改 prompt、不改变 §5 命令的操作、目标路径和关键参数（注释与空白不影响验收）。
> 教义在 Kekkai skill 的 `docs/CREED.md`、runner 契约在该 skill 的 `docs/RUNNER.md`——本文件不复述它们；`kekkai hard/soft` 的退出码与消息就是你的下一步。

## 1. 目标（一句话 + 背景 + 实施指导）
修复历史记录编辑态的两个用户可见问题：第一，编辑态没有明确的关闭/退出入口，用户点开「编辑」后只能靠右上角「运算类型」整页重置，无法回到编辑前的画面；目标是增加一个编辑态关闭控件，点它即丢弃草稿并恢复编辑前的显示与状态，历史记录完全不变。第二，编辑态里点选某个数字时输入框不清空，继续键入会拼在原值后面（例如把 `30` 点开再按 `7` 得到 `370`）；目标是点选数字即清空并等待新值：输入了新值就替换，未输入就离开（切换到另一个数字、换运算符、按 `=` 或关闭）则恢复该数字的原值。

**实施指导**：
沿用现有单文件结构与 `select → input → result | error | edit` 状态机，复用 `beginEdit`、`editDraft`、`renderEditDraft`、`renderExpression`、`calculate` 等既有函数，不引入表达式解析器，数值继续用 float64 从左到右折叠。

1. **编辑会话快照与关闭**：在 `beginEdit` 从非 `edit` 态进入时快照 `{state, operator, operands, expressionText, resultText, resultValue, resultError}`；若已在 `edit` 态又点开另一条记录，保留最早那份快照。在 `[data-testid="edit-draft"]` 内新增 `button[data-testid="edit-cancel"]`（仅编辑态可见，文案可为「关闭」/「取消」），点击时结束编辑：丢弃草稿，恢复快照中的 `main.app[data-state]`、`main.app[data-operator]`（快照无运算符则删除该属性）、`[data-testid="expression"]` 文本与 `[data-testid="result"]` 的 `textContent`/`data-value`/`data-error`，清空 `calc-input`，隐藏草稿与全部 chip，焦点回到 `calc-input`，历史 DOM 与数据一律不动。
2. **点选数字即替换（pending 模型）**：点选/聚焦某个 `operand-input` 且它当前不在 pending 时，记住它此刻的显示值作为“原值”，把输入框清空并聚焦，同时给该 chip 加 `data-pending="true"`；此时草稿值与上方算式**暂不改变**（仍显示原值），其他操作数不受影响。该输入框发生真实 `input` 事件后视为“已输入”：把输入框当前文本写回草稿、chip 的 `data-value` 与算式。离开该输入框（焦点移到另一个操作数、运算符、主输入框、关闭按钮或等号）时结算：若从未输入过，把原值写回输入框并移除 `data-pending`；若输入过，保留输入框当前文本（包括被删成空串）。先结算旧字段，再清空新点选的字段；按 `=` 前先结算全部 pending 再走既有 `calculate`，因此“未输入就按等号”会恢复原值后正常计算，而“输入过又删空”仍按既有非法操作数规则 no-op。
3. 既有行为保持不变：编辑态换运算符只改草稿运算符且保留全部值；删除 chip；在 `calc-input` 输入数字按回车在草稿末尾追加 chip；编辑后按 `=` 追加一条新记录、源记录逐字段不变；空/非有限值按 `=` no-op；编辑态除零进入 error 态且不写历史。屏幕数字键盘继续服务于主输入框（编辑态数字+回车是追加新操作数）；替换已有数字以被点选的 `operand-input` 自身的键盘输入为准，本闸不要求把屏幕键盘按键路由进 pending 输入框。
4. 同步更新共享回归场景 `/ws/cal_phone/tests/scenarios/edit.mjs` 中 `edit-invalid` 的构造方式：在“点选即清空”语义下，仅 `fill("")` 不再代表用户主动清空，应改为先输入再退格/删空以产生 touched-empty；不得删除或弱化其它既有断言。可用 `cd /ws/cal_phone && node tests/suite.mjs --only edit-recompute,edit-multi,edit-invalid,edit-divzero,layout` 自检（整套 suite 的 `cold-start` 是上一闸反转数字键策略前的旧期望，与本闸无关）。
5. 继续使用单文件 HTML/CSS/JS、无外部依赖；移动端可见控件至少 44×44 CSS px、输入字号至少 16px、窄屏无横向溢出。

> 外部前提：无需账号、服务、真实设备或人工授权；验收在无头 Chromium 中完成（Playwright 已缓存）。缺失的只有代码行为，没有需要 blocked 的外部条件。

## 2. 不变约束（父级红线 · 任何修改不得破坏）
> 每条红线**必须标注归属**：`[H#]`（由该硬不变量机检）或 `[soft-only: 原因]`（只能主观把关，写明为何无法机检）。绝对不能改的代码块优先给 sha256 机检形式。不允许留下既非 `[H#]` 也非 `[soft-only]` 的悬空红线。
- 页面仍是可自包含加载的单文件 `index.html`：`</html>` 闭合、字节数 ≥ 1024，且不引用 `http(s):` 或协议相对的外部 script/link/img/font/@import [H1]
- 历史记录每条仍有可用的 `history-edit` 入口；进入编辑态后 `edit-draft` 可见，并出现可见、可点击、非空的 `button[data-testid="edit-cancel"]`；非编辑态该按钮不可见 [H2]
- 编辑态关闭必须恢复编辑前的画面（状态、运算符、算式、结果），不得清空历史或改动任何记录 [H3][H4][H5]
- 关闭发生在用户已改过草稿之后时，改动全部丢弃，不得追加历史 [H4]
- 点选操作数后该输入框必须清空并标记 `data-pending="true"`，草稿值与算式暂不改变，其他操作数不变 [H6]
- 未输入就切换到另一个数字、换运算符或关闭时，原值必须恢复；不得把空值留在草稿里 [H7]
- 已输入的新值在切换后必须保留；再次点选同一数字应清空并可在离开时恢复“当前值”，而不是更早的初始值 [H8]
- 未输入就按 `=` 必须先恢复原值再计算，新记录的操作数等于源记录，源记录不变 [H9]
- 输入过又把输入框删空/填成非数字时按 `=` 仍为 no-op：不新增历史、不产生新的 `result[data-value]`、不抛错 [H10]
- 既有编辑协同不得回归：换运算符保留值、删除 chip、主输入框回车追加、按 `=` 追加新记录且旧记录逐字段不变 [H11]
- 移动窄屏布局仍可用：320×568 与 390×844 的编辑态（含关闭按钮与 pending 输入框）无横向溢出，可见交互控件宽高 ≥ 44 CSS px，`calc-input` 与 `operand-input` 字号 ≥ 16px [H12]
- 所有验收场景不得产生 pageerror 或 console error；同一交互序列在两个全新上下文中产生完全相同的历史序列 [H13]
- 历史仍仅存于当前页面（不写 localStorage/sessionStorage），刷新后回到 select 且历史为空 [H11]

> 允许改动的范围豁免写在下面的定界块里（runner 会把它**逐字**内联进 first / recast / final 验收器的 runtime contract，避免首轮判合规、末轮判违规的判定分裂）。没有豁免就写 `无`。

<<<SCOPE-EXEMPTIONS
业务改动仅限 /ws/cal_phone/index.html。允许同步更新 /ws/cal_phone/tests/scenarios/edit.mjs 与 /ws/cal_phone/tests/lib/selectors.mjs，使共享回归场景反映本闸「点选清空、未输入恢复、输入过为空则 no-op」的语义；不得删除或弱化其它既有场景断言，不得修改仓库内其它业务文件或既有 Telos/ gate 证据。
SCOPE-EXEMPTIONS>>>

---

## 3. 硬目标（独立确定性验收 · 硬闸 · codex exec）

**输入矩阵（采样覆盖；含边界与「哪些算、哪些拒答」）：**
编辑前状态 ∈ {result, select}；编辑动作 ∈ {立即关闭, 改值后关闭, 点选后切到另一数字, 点选后换运算符, 点选后输入新值, 点选后按等号, 输入后删空按等号, 输入后填非数字按等号, 删除中间 chip, 主输入框回车追加}；操作数位置 ∈ {第一个, 中间, 最后}；数字来源 ∈ {屏幕键完成初始计算, 物理/OS 键盘在 operand-input 输入}；视口 ∈ {320×568, 390×844}；生命周期 ∈ {首次加载, 刷新后, 全新上下文}。预期：点选数字 → 输入框空且 chip 带 `data-pending="true"`、算式与草稿暂不变；未输入离开 → 原值恢复；已输入离开 → 新值保留；未输入按 `=` → 恢复后计算并追加新记录；输入过为空/非数字按 `=` → no-op；关闭 → 恢复编辑前画面、历史零变化；既有换运算符/删除/追加/重算流程不变。

**稳定测试入口：** 既有：`main.app[data-state]`（`select`、`input`、`result`、`error`、`edit`）、`main.app[data-operator]`、`[data-testid="op-picker"]` 内 `[data-op="+"|"-"|"*"|"/"]`、`input[data-testid="calc-input"]`、`[data-testid="expression"]`、`[data-testid="result"]`（`data-value`/`data-error`）、`button[data-testid="key-equals"]`、`button[data-testid="key-op"]`、`[data-testid="keypad"] [data-key]`、`[data-testid="history-item"]`（`data-operator`/`data-operands`）、`[data-testid="history-expression"]`、`[data-testid="history-result"]`（`data-value`）、`button[data-testid="history-edit"]`、`[data-testid="edit-draft"]`（`data-operator`）、`[data-testid="operand-chip"]`、`input[data-testid="operand-input"]`、`button[data-testid="operand-remove"]`。新增：`button[data-testid="edit-cancel"]`（仅编辑态可见）；被点选等待替换的 chip 带 `[data-pending="true"]`，结算后该属性必须消失；`operand-input.value` 始终是该操作数当前显示文本的唯一真值。

**不变量：**

| # | 不变量 | 硬闸怎么验（须真跑，非读源码目测） | 阈值 |
|---|---|---|---|
| H1 | 自包含单文件且加载不抛错 | Playwright 以 `file:///ws/cal_phone/index.html` 打开并收集 pageerror；Node `fs.readFileSync` 读原文，断言 `</html>` 存在、字节数达标；正则统计 `<script src>`、`<link href>`、`<img src>`、`@import`、`url(...)` 中指向 `(https?:)?//` 的引用数 | pageerror = 0；`</html>` 存在；字节数 ≥ 1024；外部引用 = 0 |
| H2 | 编辑入口与关闭控件 | 屏幕键完成 `+` 12/30/8 后，非编辑态断言 `edit-cancel` 不可见；点击 `history-edit`，断言 `state=edit`、`edit-draft` 可见、3 个 `operand-input`、`edit-cancel` 可见且 enabled、`textContent`/`aria-label` 非空 | 入口可用；关闭控件仅编辑态可见且可点击；名称非空 |
| H3 | 立即关闭恢复到编辑前画面 | 完成 `+12/30/8=50` 与 `*2/3/4=24`，快照 state/operator/expression/result 文本与 `data-value`、history 全字段；点开较早的 `+` 记录，断言 `state=edit` 且 result 无 `data-value`；点 `edit-cancel`；读关闭后的同组字段 | state 恢复 `result`；operator 恢复 `*`；expression 文本逐字符一致（忽略首尾空白）；result `data-value` 与文本一致；history 2 条逐字段不变；无 `operand-input`；`calc-input` 为空且 `activeElement` 为它 |
| H4 | 改值后关闭丢弃全部草稿 | 同上准备；进入编辑态后把中间 `operand-input` 填成 `5`，再点选最后一个 input（pending 空），点 `edit-cancel`；读 state/expression/result/history 与编辑前快照 | 与 H3 相同：恢复编辑前画面；history 仍 2 条且逐字段不变（不得新增第 3 条）；无 pending/chip 残留；pageerror = 0 |
| H5 | 从 select 态进入编辑后关闭回到 select | 完成 `+12/30=42`，点 `key-op` 进入 select 并快照（state、expression 空、result 空、无 `data-operator`、history 1 条）；点开该记录编辑，再点 `edit-cancel` | state 恢复 `select`；expression/result 为空；`main.app` 无 `data-operator`；history 1 条逐字段不变；关闭控件不可见；pageerror = 0 |
| H6 | 点选数字即清空并进入 pending | 完成 `+12/30/8=50` 并进入编辑；快照算式与三个 input 值；点击中间 `operand-input`；读三个 input 的 value、chip 的 `data-pending`、算式、`edit-draft` 的 `data-operator` | 被点 input value = `""`；该 chip `data-pending="true"`；另两个值仍 `12`、`8`；算式仍等于快照（含 `30`）；`data-operator` 仍 `+`；history 1 条；`activeElement` 为该 input |
| H7 | 未输入离开则恢复原值 | 在 H6 状态点第一个 input：断言中间 input 恢复 `30`、第一个为 `""`、只有第一个 chip pending、算式不变；再点最后 input：断言第一个恢复 `12`、最后为 `""`、只有最后 chip pending；再点 `[data-op="*"]`：断言最后恢复 `8`、无任何 `data-pending`、三个值 `["12","30","8"]`、`edit-draft[data-operator]="*"`、history 不变 | 每次切换：旧 pending 恢复原值、新选中清空；换运算符后全部原值保留、无 pending；history 1 条不变 |
| H8 | 已输入的新值替换并在再次点选时成为“原值” | 编辑 `+12/30/8`；点中间 input 后 `keyboard.type("7")`，断言 value=`7`、算式含 `7` 不含 `30`；点最后 input，断言中间仍 `7`、最后为 `""`；再点中间 input，断言其清空、最后恢复 `8`；再点最后 input，断言中间恢复 `7`（不是 `30`）、最后恢复 `8`、算式含 `7`；再点第一个 input 后用 `fill("9")`，断言 value=`9`、算式含 `9` 不含 `12`；history 始终 1 条 | 输入值保留；再次点选清空；离开恢复“最近一次值”；算式同步；history 不变 |
| H9 | 未输入按等号先恢复再计算 | 完成 `+12/30/8=50` 并编辑；点中间 input（空、pending）后点击 `key-equals`；读 state、result、history 与两条记录快照 | state=`result`；result `data-value`=50；history=2；索引 0 新记录 `+["12","30","8"]=50`，与索引 1 源记录逐字段一致；源记录不变；无 chip/pending 残留；pageerror=0 |
| H10 | 输入过又删空/填非数字仍为 no-op | 完成 `+12/30/8=50` 并编辑；点中间 input，键入 `5` 后按 Backspace（值为空），点 `=`：断言 history 仍 1、result 无 `data-value`、state 仍 `edit`；再 `fill("abc")` 后点 `=`：同样 no-op；再 `fill("7")` 后点 `=`：断言 result=27、history=2、索引 0 为 `+["12","7","8"]=27`、源记录不变 | 两次非法均 0 新增、无新 `data-value`、无异常；合法修正后 27 且新增 1 条 |
| H11 | 既有编辑协同与历史会话性回归 | 完成 `*2/3/4=24` 与 `+1.5/2.25=3.75` 并快照；编辑较早的 `*`：点第一个 input 后键入 `10`，点 `[data-op="+"]`（断言三值 `["10","3","4"]`），点最后 input 后键入 `5`，删除中间 chip（断言剩 `["10","5"]`），在 `calc-input` 键入 `2` 回车（断言 `["10","5","2"]`），点 `=`；断言 result=17、history=3、索引 0 为 `+["10","5","2"]=17`、原两条不变；`page.reload()` 后断言 history=0、state=`select` | 换运算符保留值；删除/追加序列正确；新结果 17；旧记录逐字段不变；刷新后 0 条且 select |
| H12 | 移动窄屏编辑态布局 | 320×568 与 390×844（`isMobile:true, hasTouch:true`）各完成两条记录、进入编辑、点选中间 input（pending 空）；每态读 `documentElement`/`body` 的 `scrollWidth-clientWidth`，遍历可见 `input, button, [data-op]`（含 `edit-cancel`、`operand-remove`）的 `getBoundingClientRect()`，读 `calc-input` 与 `operand-input` 的 computed `font-size` | 横向溢出 ≤ 1px；全部可见控件宽高 ≥ 43.5px；字号 ≥ 16px；`edit-cancel` 与数字键盘可见 |
| H13 | 无页面/控制台错误且历史确定 | 汇总 H2–H12 全部场景的 pageerror 与 console error；两个全新 context 各跑同一序列：`+12/30/8=50` → 编辑该记录 → 点中间 input → 键入 `7` → 点最后 input → 再点中间 input → 点第一个 input → `edit-cancel` → 点 `*` 输入 2/3/4 `=` → 编辑较早 `+` 记录 → 点中间 input → 键入 `5` → `=`；序列化每条历史的 operator/operands/result/expression 后深度比对 | pageerror=0、console error=0；两个上下文历史数组深度一致；records=3 |

<<<HARD-VERIFY-PROMPT
你是确定性验收器。**不要评价 UI 美观、不要改产物源码。**本 prompt 会被单独抽取喂给你（读不到 frontmatter 与上表），所以下面所有文件都写**绝对路径**、基线写 **sha256 值**；runner 会在其后追加 `[RUNTIME CONTRACT]`（round / phase / gate_dir / evidence_dir / out_dir / artifact_sha256 / expected_review_states / SCOPE-EXEMPTIONS 原文），以它为准。
按本闸输入矩阵 / 不变量逐条**实际执行**验证：优先复用已有测试入口，逻辑用 Node 调用函数并断言返回值/异常；界面用 Playwright/jsdom 操控稳定选择器并读值。基线只用于本任务明确要求不可更改的范围，不能自行冻结整个源码或妨碍授权修复。采用项目已有工具与依赖；缺依赖或设备时明确拒答，不能伪装成代码 FAIL。禁止用主观语言/肉眼通读代替实测证据。
量具卫生（三条，写量具时逐条自查）：① 不得含写死的恒 FAIL/恒 PASS 常量判据；② 扫描类不变量的扫描面必须与 §3 声明逐字一致、不得自行扩张，且**不得包含 evidence/ 或 evidence/runs/**（自引用扫描面一旦被本循环必写的证据污染就永远翻不了绿）；③ 断言锚定稳定选择器/数据钩子而非用户可见文案原文（软闸可能正当地要求改文案）；子进程/步骤超时 ≥ 单次实测耗时的 2 倍。
量具覆盖（本闸强制）：`verify.mjs` 的非注释代码中必须出现字面 `H1`、`H2`、…、`H13`（例如测试表键名或 ID 常量）；仅 `testH1`、动态 `H${id}` 或注释中的 `H1` 不算——`kekkai lint --post` 会静态检查覆盖。
量具接口（两条，runner 靠它做变异检查与尝试隔离，缺一即拒绝提升）：① 环境变量 `KEKKAI_ARTIFACT` 存在时用它覆盖目标文件路径；② `KEKKAI_OUT_DIR` 存在时，`hard-r<N>.txt` / `render-r<N>.txt` / `manifest-r<N>.json` / `review-shots/r<N>/` 全部写到该目录下，而不是 evidence/runs（所有路径以脚本自身所在目录解析、不依赖 cwd）。
目标文件（绝对路径）：/ws/cal_phone/index.html
本闸具体：被测文件是 `/ws/cal_phone/index.html`，一个可从 `file:///ws/cal_phone/index.html` 直接加载的单文件手机计算器。既有 hook（不得删除或改名）：`main.app[data-state]` 取 `select`、`input`、`result`、`error`、`edit`；`main.app[data-operator]`；`[data-testid="op-picker"]` 内恰好四个按钮 `[data-op="+"]`、`[data-op="-"]`、`[data-op="*"]`、`[data-op="/"]`；`input[data-testid="calc-input"]`；`[data-testid="expression"]`；`[data-testid="result"]`（成功时 `data-value` 是可 `parseFloat` 的十进制数值字符串，除零时 `data-error="true"`）；`button[data-testid="key-equals"]`；`button[data-testid="key-op"]`；`[data-testid="keypad"] [data-key="0"…"9", ".", "backspace", "enter", "equals"]`；`[data-testid="history-item"]`（带 `data-operator` 与 `data-operands`，后者 `JSON.parse` 后是按输入顺序的原始显示字符串数组）；条目内 `[data-testid="history-expression"]`、`[data-testid="history-result"]`（带 `data-value`）、`button[data-testid="history-edit"]`；`[data-testid="edit-draft"]`（带 `data-operator`）；`[data-testid="operand-chip"]`；`input[data-testid="operand-input"]`（可编辑，`value` 是该操作数当前显示文本的唯一真值）；`button[data-testid="operand-remove"]`。**本闸新增且必须存在**：`button[data-testid="edit-cancel"]`，位于 `edit-draft` 内，仅在 `state=edit` 时可见、enabled，且 `textContent` 或 `aria-label` 非空；被点选等待替换的 `operand-chip` 带 `data-pending="true"`，结算后该属性必须消失。

交互契约（关闭）：点击某条 `history-edit` 进入 `edit`，`edit-draft` 可见，`data-operator` 等于源记录，每个操作数一个可编辑 `operand-input`，值等于 `data-operands`，result 的 `data-value`/`data-error` 被清除。进入编辑时记录一份快照：当前 `state`、`data-operator`（可能没有）、`expression` 的文本、`result` 的文本与 `data-value`/`data-error`。点击 `edit-cancel` 必须结束编辑并**精确恢复**该快照：`state`、`data-operator`（快照无则移除）、`expression` 文本（忽略首尾空白后逐字符一致）、`result` 文本与 `data-value`/`data-error`；同时清空 `calc-input`、隐藏 `edit-draft`、移除全部 `operand-input`、焦点回到 `calc-input`；history 的条目数、顺序、`data-operator`、`data-operands`、`history-expression` 文本、`history-result[data-value]` 与文本全部不变。若在已编辑草稿（改过值、存在 pending）后关闭，仍然只恢复快照、丢弃全部草稿，不得追加历史。若进入编辑前是 `select`，关闭后回到 `select`、expression/result 为空、无 `data-operator`；若进入编辑前是 `result`，关闭后 operator/expression/result 与进入前一致。

交互契约（点选替换）：点击（聚焦）一个 `operand-input` 时，如果它当前不是 pending，必须立即把它的 `value` 清空、保持聚焦，并给其 `operand-chip` 加 `data-pending="true"`；此时草稿中该操作数的值、`edit-draft` 的 `data-operator`、`expression` 文本、其他 `operand-input` 的值都不变（算式仍显示原值）。在 pending 输入框内发生真实输入（`input` 事件，可用 `keyboard.type()` 或 `fill()` 触发）后，该输入框当前文本成为草稿值：chip 的 `data-value`、`expression` 同步更新（算式含新值、不含被替换的旧值；被删成空串则算式不再含旧值）。离开该输入框（焦点转移到另一个 `operand-input`、`[data-op]`、`calc-input`、`key-equals` 或 `edit-cancel`）时必须结算：若从未输入过，把进入 pending 前的原值写回 `value` 并移除 `data-pending`；若输入过，保留输入框当前文本（包括空串）。点选另一个 `operand-input` 时应先结算旧的，再清空新的，因此任意时刻最多一个 chip 带 `data-pending="true"`。点击 `=` 前必须先结算所有 pending，再走既有计算流程：未输入过 → 原值恢复后正常计算；输入过且为空串或非有限数 → 保持既有 no-op（不新增历史、不产生新的 `result[data-value]`、不抛错，state 仍 `edit`）。在 pending 状态下点击 `[data-op]`，原值必须恢复且换运算符后全部值保留。再次点选一个已提交过新值的输入框，应清空它，并在未输入离开时恢复“最近一次值”（而不是更早的初始值）。

既有行为回归：编辑态换运算符只改 `edit-draft[data-operator]` 且全部 `operand-input` 值不变；点 `operand-remove` 删除对应 chip 且余值顺序不变；在 `calc-input` 键入数字按回车在草稿末尾追加一个 chip；编辑态按 `=` 合法时从左到右计算，追加一条新记录（操作数等于全部 `operand-input` 当前值），源记录与其它历史逐字段不变；除零进入 `data-error="true"` 的 error 态且不写历史；`key-op` 回到 select 但保留历史；刷新后 history=0 且回 select，不得借助 localStorage/sessionStorage。页面不得引用外部 http(s) 或协议相对资源（允许 data: 与内联）。

逐条验法：
- H1：`fs.readFileSync("/ws/cal_phone/index.html")`；断言 `</html>` 存在、`Buffer.byteLength >= 1024`；正则统计 `<script ... src>`、`<link ... href>`、`<img ... src>`、`@import`、`url(...)` 中匹配 `^(https?:)?//` 的引用数 = 0；Playwright 以 `file:///ws/cal_phone/index.html` 打开并监听 `pageerror` = 0。
- H2：屏幕键完成 `+` 12/30/8（每数按数字键、回车）后点击 `key-equals`；断言非编辑态 `edit-cancel` 不可见（`isVisible()` false）；点击 `history-edit`；断言 `state=edit`、`edit-draft` 可见、`operand-input` 数=3、`edit-cancel` 可见且 `isEnabled()`、其 `textContent.trim()` 或 `aria-label` 非空。
- H3：屏幕键完成 `+12/30/8=50` 与 `*2/3/4=24`；读并保存 `state`、`data-operator`、`expression` 文本、`result` 文本与 `data-value`、`historySnapshots()`；点击索引 1（较早 `+` 记录）的 `history-edit`；断言 `state=edit`、`result[data-value]` 为 null；点击 `edit-cancel`；断言 `state` 恢复为快照值、`data-operator` 恢复为快照值、`expression` 文本 `trim()` 后等于快照、`result` 文本与 `data-value` 等于快照、`historySnapshots()` 深度等于快照、`operand-input` 数=0、`edit-draft` 不可见、`calc-input.value=""`、`document.activeElement===calc-input`。
- H4：同 H3 准备并进入编辑；用 `fill("5")` 改中间 input；点选最后一个 input（其 value 变为空、chip pending）；点击 `edit-cancel`；断言与 H3 相同的全套恢复、history 仍 2 条且深度等于快照、无 `operand-input`/`[data-pending]`、pageerror 累计 0。
- H5：完成 `+12/30=42`；点击 `key-op`；断言 `state=select`、expression/result 为空、`main.app` 无 `data-operator`、history 1 条；快照这四项；点击 `history-edit`；点击 `edit-cancel`；断言恢复 `state=select`、expression/result 为空、无 `data-operator`、history 快照深度不变、`edit-cancel` 不可见。
- H6：完成 `+12/30/8=50` 并点击 `history-edit`；快照 `expression` 文本与三个 input 值；点击索引 1 的 `operand-input`；断言其 `value=""`、其 chip 的 `data-pending="true"`、另外两个值分别 `"12"`/`"8"`、`expression` 文本等于快照、`edit-draft[data-operator]="+"`、history 1 条、`document.activeElement` 为该 input。
- H7：在 H6 后点击索引 0 的 input，断言索引 1 的 value 恢复 `"30"`、索引 0 的 value `""`、只有索引 0 的 chip pending、expression 仍等于初始快照；再点击索引 2 的 input，断言索引 0 恢复 `"12"`、索引 2 为 `""`、只有索引 2 pending；再点击 `[data-op="*"]`，断言索引 2 恢复 `"8"`、`document.querySelectorAll('[data-pending="true"]').length===0`、三个 value 为 `["12","30","8"]`、`edit-draft[data-operator]="*"`、history 仍 1 条。
- H8：完成 `+12/30/8=50` 并编辑；点索引 1 input，`keyboard.type("7")`，断言 value `"7"`、expression 含 `7` 且不含 `30`；点索引 2 input，断言索引 1 仍 `"7"`、索引 2 `""`；再点索引 1 input，断言其 `""`、索引 2 恢复 `"8"`；再点索引 2 input，断言索引 1 恢复 `"7"`（绝不能是 `"30"`）、索引 2 恢复 `"8"`、expression 含 `7`；点索引 0 input 后 `fill("9")`，断言 value `"9"`、expression 含 `9` 不含 `12`；全程 history 1 条。
- H9：完成 `+12/30/8=50` 并编辑；点中间 input（空、pending）；点击 `key-equals`；断言 `state=result`、`result[data-value]` 数值等于 50（容差 1e-9）、history=2、索引 0 的 `data-operator="+"`、`JSON.parse(data-operands)=["12","30","8"]`、`history-result[data-value]`=50、索引 1 源记录与编辑前快照逐字段一致、无 `operand-input`/pending、pageerror 0。
- H10：完成 `+12/30/8=50` 并编辑；点中间 input，`keyboard.type("5")`，`keyboard.press("Backspace")`，断言 value `""`；点击 `key-equals`，断言 history 仍 1、`result[data-value]` 为 null、`state=edit`、pageerror 0；`fill("abc")` 后点击 `key-equals`，断言同样 no-op；`fill("7")` 后点击 `key-equals`，断言 result=27、history=2、索引 0 为 `+["12","7","8"]=27`、源记录不变。
- H11：完成 `*2/3/4=24` 与 `+1.5/2.25=3.75` 并快照；点击索引 1（`*`）的 `history-edit`；点索引 0 input，`keyboard.type("10")`；点击 `[data-op="+"]`，断言三值 `["10","3","4"]` 且 `edit-draft[data-operator]="+"`；点索引 2 input，`keyboard.type("5")`；点索引 1 的 `operand-remove`，断言剩 `["10","5"]`；在 `calc-input` 键入 `2` 后按 `[data-key="enter"]`，断言 `["10","5","2"]`；点击 `key-equals`，断言 result=17、history=3、索引 0 为 `+["10","5","2"]=17`、索引 1/2 原记录逐字段不变；`page.reload()` 后断言 history=0、`state=select`。
- H12：320×568 与 390×844（`isMobile:true, hasTouch:true`）各新开 context；完成 `+12/30/8=50` 与 `*2/3/4=24`；点击较早 `+` 记录 `history-edit`；点选中间 input（value 空、pending）；每态读 `documentElement.scrollWidth-documentElement.clientWidth` 与 `body.scrollWidth-body.clientWidth`、遍历所有可见 `input,button,[data-op]`（含 `edit-cancel`、`operand-remove`）的 `getBoundingClientRect()`、读 `calc-input` 与全部 `operand-input` 的 computed `font-size`；断言溢出 ≤1px、宽高 ≥43.5px、字号 ≥16px、`edit-cancel` 与数字键盘可见。
- H13：汇总所有页面 `pageerror` 与 console `error` 计数 = 0；两个全新 context 各执行同一序列：屏幕键 `+12/30/8=50` → 点击 `history-edit` → 点中间 input → `keyboard.type("7")` → 点最后 input → 再点中间 input → 点第一个 input → 点击 `edit-cancel` → 点 `*` 输入 2/3/4 `=` → 点击较早 `+` 记录 `history-edit` → 点中间 input → `keyboard.type("5")` → `=`；把每条历史序列化为 `{operator, operands, result, expression}` 后 `JSON.stringify` 深度比对，records=3。

环境与工具（当前主机实测）：Node v22.23.2；jsdom@27.2.0 已全局安装（`require('jsdom')` 失败时先 `export NODE_PATH=$(npm root -g)` 再重试）；Playwright 浏览器已缓存在 `/root/.cache/ms-playwright`（chromium-1248，对应 `playwright@1.64.0`），`/ws/cal_phone/tests/node_modules` 已有 playwright@1.64.0 与共享 harness，可直接复用 `/ws/cal_phone/tests/lib/*.mjs` 或从该目录解析依赖；网络可用。**不得**把 `node_modules` 安装到 `/ws/cal_phone` 根目录。若浏览器缓存不可用可让 Playwright 自行下载；仍不可用则按缺设备拒答，不能伪装成产物 FAIL。
phase=first 时把验证逻辑写成脚本 `/ws/cal_phone/Telos/phone-calculator-edit-close-replace-111800/evidence/verify.mjs`（接受轮号参数）并立即以 `node verify.mjs <round>` 运行；它按上面不变量逐条实测并写 `hard-r<N>.txt`：先写 `ROUND: <N>`、`ARTIFACT_SHA256: <64hex>`、`VERIFIER_SHA256: <64hex>`（脚本自身 sha256），再每条 `H<id> PASS|FAIL — 实测值/证据`，末行**严格** `HARD: PASS` 或 `HARD: FAIL (Hx,…)`。
若 runtime contract 的 `expected_review_states` 非 none：同一脚本还须把每个状态用 Playwright/无头 Chrome 渲染成**非空、非纯色、内容互不重复**的 PNG（≥ 240×160；真 320px 用 CDP `Emulation.setDeviceMetricsOverride`）落 `review-shots/r<N>/S<k>.png`——精确且仅这些文件；把带同样头的可见性/溢出/关键尺寸 `key=value` 实测写 `render-r<N>.txt`；写 `manifest-r<N>.json`：`round`、`artifact_sha256`、`verifier_sha256`、`metrics_sha256`、每张图的 `file/sha256/width/height`、`adhoc: []`。
phase=final 时**禁止读取、运行或修改 verify.mjs / ledger / 旧证据**，在你被启动的隔离 scratch cwd 中重新推导全套检查；临时测量只落当前 scratch 目录，最终回复给出裁决，由 CLI 保存（不要自行写 `-o` 路径）；首行同样是 `ROUND:`、`ARTIFACT_SHA256:`，末行同样严格。
HARD-VERIFY-PROMPT>>>

---

## 5. 运行与停止（命令按需选用，非逐行执行的脚本；停止数字只在 frontmatter）
    # gate=/ws/cal_phone/Telos/phone-calculator-edit-close-replace-111800 · rendered by kekkai new — do not edit
    kekkai doctor --gate "/ws/cal_phone/Telos/phone-calculator-edit-close-replace-111800" --host     # before round 1 and after any host change
    kekkai hard "/ws/cal_phone/Telos/phone-calculator-edit-close-replace-111800"                     # r1: independent author writes evidence/verify.mjs; later rounds replay it
    kekkai adhoc "/ws/cal_phone/Telos/phone-calculator-edit-close-replace-111800" -- <command…>      # same-round measurement admissible as 误报 basis
    kekkai recast "/ws/cal_phone/Telos/phone-calculator-edit-close-replace-111800" --reason "<why>"  # sick instrument: quarantine + fresh independent author (≤3 eras)
    kekkai hard "/ws/cal_phone/Telos/phone-calculator-edit-close-replace-111800" --final             # terminal independent stamp at the stop candidate
    kekkai lint "/ws/cal_phone/Telos/phone-calculator-edit-close-replace-111800" --post              # after round 1, on recovery, before STOP
    kekkai close "/ws/cal_phone/Telos/phone-calculator-edit-close-replace-111800" --by <budget|host|instrument|oscillation|human> --blocker "<one sentence>"

- **轮次 = runner 提升进 `evidence/runs/hard-r<N>.txt` 的 canonical 盖章**；其余一切都是尝试（`evidence/attempts/`），不写台账、不占预算、不动 K。轮号由 runner 分配，不要手填；不要手跑 `node verify.mjs` 再拷文件进 runs/（缺 runner 头会被拒绝）。
- **`kekkai hard` 退出码**：`0` 提升为轮；`2` 尝试已归档（先读 `kekkai status --json` 和消息：若该轮已提升但 final 缺失，补 `--final`；否则修因后继续，不盲重跑）；`3` 重复/尝试上限——只有三条合法路：(1) change the business tree, (2) `kekkai recast --reason`, (3) `kekkai close --by <tag>`；`4` 规则拒绝（读消息，别原样重试）。管道故障同一输入有重试上限；无法修复就 `close`，不换措辞/增预算绕过。
- **首个 hard PASS 轮 runner 自动跑审计 final**；final 与量具不一致 ⇒ final 的 FAIL 成立，只能修代码或 `kekkai recast`，永不再跑一次 final 试运气。
- **停止**：`converged` = 最新轮 hard PASS + 当前产物/业务树字节的同 era 独立 final PASS（hard-only 不需要软评或 K 确认轮），且未超 frontmatter `max_rounds`；任何轮数（含 0）都可以 `kekkai close --by <budget|host|instrument|oscillation|human>` 写 blocked 终态并附 `blocker:` 行——绝不把 gate 停在 in-loop 而无 STOP。
- 第 1 轮后、恢复时、写 STOP 前各跑一次 `kekkai lint <本目录> --post`；`POST-IN-PROGRESS` 是运行中的预期警告。

---

## 附录 · 生成器判断记录（可审计的 taste↔structure 边界）
> 让执行者能看懂哪些是「结构强制」、哪些是「生成器的 taste 取舍」。不要复述停止数字（它们只在 frontmatter）。
- **为何 hard-only**：两个问题都是可确定性测量的行为（关闭后的状态恢复、点选/输入/离开后的值），没有品牌或视觉质感目标；移动端可用性继续用可测阈值纳入硬闸，因此 `--soft none`。
- **为何记录父闸**：本 gate 直接建立在 `phone-calculator-continue-edit-numbers-111511` 引入的编辑草稿之上，`parent_gate` 只记录血缘；hard-only 子闸不继承父闸决策、证据、量具或轮次，所有 H 在本 gate 内重新实测。
- **关闭的语义取舍**：用户说「无法关闭退出」，当前唯一退路是「运算类型」整页重置。契约选择新增专用关闭控件并恢复**进入编辑前的快照**，而不是固定回到 result 或 select；这样从结果态误入编辑、或先重置再点开历史，都能原路返回，且关闭永远不产生历史副作用。
- **恢复触发点的取舍**：用户只明确说「未输入且切换到其他数字则恢复」。契约把它推广到任何焦点离开（换运算符、点主输入框、按 `=`）；因为 pending 期间原值只存在于内存，若按 `=` 不恢复就会把「只是点了一下」误判成空操作数。输入过又删空则视为用户主动清空，保留既有「非法操作数 no-op」决策。两者用「是否发生过 input 事件」区分。
- **为何算式在 pending 未输入时不变**：点选数字只是选中，尚未表达替换意图；若立刻把算式抹掉，用户看到的是一次无声的删除。让旧值继续显示、只在真实输入后更新，失败恢复时画面也无需二次重绘。
- **为何用 `data-pending` 作为新钩子**：空 `value` 无法区分「点选后等待」与「输入过又删空」。显式 pending 属性让验收器和用户辅助技术都能判断当前是否处于“可恢复的等待”状态。
- **屏幕数字键盘的范围**：手机端主输入框是只读的，数字键服务于 `calc-input`；操作数输入框本身是原生可编辑字段（`inputmode="decimal"`）。本闸把替换入口定义在被点选的输入框自身，不要求把屏幕键盘按键路由进 pending 字段，避免与「数字+回车追加新操作数」的既有编辑流程冲突。
- **共享测试的改动边界**：既有 `edit-invalid` 用 `fill("")` 构造空操作数；在「点选即清空」语义下，`fill("")` 不再触发 input 事件，代表的是“未输入”而非“主动删空”。因此允许把该场景改成先输入再删空，保留其“非法输入 no-op”的原始意图；其它场景断言不动。
- **为何不设基线**：普通行为修复，源码需要授权修改；没有需要冻结的引擎块。唯一冻结的是 H1 的自包含/闭合/体积条件。
- **工具取舍**：用无头 Playwright（chromium-1248 已缓存）做真实点击、键盘输入、焦点切换与视口测量；不设 `--requires-display`，因为无头测量不依赖真实桌面解锁。
- **volatile 为空**：仓库没有构建产物或日志；`tests/node_modules` 已被 `tests/.gitignore` 排除，不进入 TREE_SHA256。
