---
# ── Kekkai Goal Gate v4 · frontmatter（唯一机读区；停止数字只在这里；矩阵/不变量内容只在正文表格）──
slug: roster-import-111913
version: 4
model_profile: astra-flash-3.8-v1  # 新任务冻结模型组合；执行中不可修改
status: in-loop                    # draft | in-loop | converged（blocked 终态保持 in-loop）
repo: /ws/cal_phone-worktrees/roster-import
artifact: /ws/cal_phone-worktrees/roster-import/index.html
# artifact_kind: url | app | service   # 仅 artifact: null 时启用；此时 ARTIFACT_SHA256 := TREE_SHA256
parent_gate: null                  # 子闸填父 GOAL.md 绝对路径；只继承 round-0 决策，不继承证据或 verify.mjs
verifiers:
  hard: codex exec                 # 固定驱动器；pin 与访问标志在 bin/runner.mjs（docs/RUNNER.md）
  soft: agy -p (Gemini 3.8 Flash (High))   # 固定驱动器；无软闸的 gate 为 null（kekkai new --soft none）
stop:
  max_rounds: 10
hard_invariants: [H1, H2, H3, H4, H5, H6, H7, H8, H9, H10]
review_states: [S1, S2, S3, S4]
volatile: []                       # TREE_SHA256 排除的仓库相对路径（构建产物、日志等）；空数组即可
---

# Kekkai Goal Gate · 名单导入与成绩回填

> **运行指令**：你是执行者（Codex / Claude Code / ZCode / Cursor 之一，由 handoff 指定；生成本 gate 的那次调用不得兼任）。
> 开跑前先 `kekkai doctor --gate <本目录> --host`；只有 `requires_display: true` 的真实桌面测量依赖解锁与屏幕权限，普通无头浏览器/逻辑测量不占屏。
> 读**本文件全文** + 同目录 [`./ledger.md`](./ledger.md)（决策台账），然后只用 §5 的命令块驱动验收，直到 §5 的停止条件；在已授权范围内自主推进，缺少外部输入时写明 blocked 与恢复条件。
> 生命周期编辑是唯一允许的 GOAL 改动：第 1 轮前 `status: draft → in-loop`；写 `converged` STOP 前 → `status: converged`；blocked 终态保持 `in-loop`。
> 除此之外 GOAL.md 只读：不改 frontmatter 数字、不改 prompt、不改变 §5 命令的操作、目标路径和关键参数（注释与空白不影响验收）。
> 教义在 Kekkai skill 的 `docs/CREED.md`、runner 契约在该 skill 的 `docs/RUNNER.md`——本文件不复述它们；`kekkai hard/soft` 的退出码与消息就是你的下一步。

## 1. 目标（一句话 + 背景 + 实施指导）
让计算器从「算一笔、抄一笔」的会话工具，变成一张**能导入名单、按名单顺序连续统分、自动把每笔结果回填到对应学生、并能原地改错和导出交付 CSV 的名单成绩表**。导入后计算历史让位给名单成绩表：未录行留空占位、下一位高亮、录满有可见提示；刷新后名单与成绩仍在，无名单模式保持原样。

**实施指导**：
在 `/ws/cal_phone-worktrees/roster-import/index.html` 既有的单文件 IIFE 状态机（`select / input / result / error / edit`）与编辑草稿之上扩展，不引入框架、构建步骤、外部依赖或网络请求。新增唯一真值模型 `roster = { version, fileName, headers, rows[] }`，`rows[i] = { seq, id, name, extra[], entry|null }`，`entry` 与现有历史条目同构并带 `seq`（`{ seq, operator, operands:[{value,display}], base:null, expression, result }`）；名单模式下「历史」不再单独存在，`entry` 就是成绩真值。

导入：用 `FileReader`/`arrayBuffer` 读字节；先 `new TextDecoder("utf-8")` 解码，结果含 `U+FFFD` 时改用 `new TextDecoder("gbk")` 重解（Node 22 全 ICU，浏览器 Chromium 同样支持）。分隔符在表头行按 `,` `;` `\t` 出现次数取最多者（并列按 `,`→`;`→`\t` 优先）。按 RFC 4180 解析引号：引号内分隔符/换行合法，`""` 表示一个引号。表头别名：学号∈{学号,考号,学籍号}、姓名∈{姓名,名字,学生姓名}、成绩∈{成绩,分数,得分}、序号∈{序号}；同一含义多列时**从左到右取第一列**，其余同义列按普通列原样保留。列顺序任意，未识别列原样保留到 `extra`，导出按原列顺序写回。`seq` 恒为文件行顺序 1..N（文件里的「序号」值不采用）；姓名与学号都为空的非空行跳过；文件里的成绩值不采用。导入流程用原生 `<dialog>` + `showModal()` 两段式（说明/入口 → 预览），点「开始录入」才替换名单并把整个计算器归零：清空名单与成绩、历史、编辑草稿与快照、运算符、操作数、算式、结果、主输入框、任何计时，回到 `select` 并从第 1 位开始；取消/关闭不改任何状态。

回填：按 `=` 且结果有限时，若存在 `entry === null` 的行，把结果写入 `seq` 最小的一行（不按数组位置猜），成功后下一位后移；名单已录满则照常显示结果、不写名单、不新增行，状态行含 `名单已录满`。除零、非法输入、没有操作数的 `=` 不写名单、不消耗下一位。名单模式下点行内「编辑」复用现有 `beginEdit` 草稿；按 `=` 重算成功后**原地替换该行 `entry`**（序号/姓名/学号/行位置/行数不变，不消耗下一位），关闭编辑丢弃草稿，行保持原样。

持久化：键 `cal-phone.roster.v1`；导入、成功 `=`、编辑成功、清除后立即写入；启动时读取并恢复名单/成绩/顺序/下一位，计算器回到 `select`；读写全部包在 try/catch，失败时降级为内存并显示不可关闭提示 `本机存储不可用，刷新会丢失成绩。`；坏 JSON 或未知版本忽略且不覆盖原值。导出：BOM + CRLF 的 CSV，列按原文件顺序，缺「序号」时最前补、缺「成绩」时末尾补，「序号」写 1..N，「成绩」已录用现有 `formatValue` 口径、未录留空，其余列原样；文件名 `<原名去扩展>-成绩-YYYYMMDD.csv`；`Blob` + `<a download>`，`file://` 可用。

数值继续用 float64 从左到右折叠，不引入任意精度；名单行、导出、状态行共用同一个 `formatValue`。屏幕键用 `locator.click()` 驱动，编辑操作数用 `locator.fill()`，不要直接写 DOM。

> 外部前提：无账号、服务、真实设备或人工授权依赖；无头 Chromium（Playwright 1.64.0，已缓存于 `/ws/cal_phone/tests/node_modules`，本 worktree 未安装）即可完成全部验收。**本闸基于 `origin/master`（65e6ccd）**，该基线尚未合入自动回车/基数快照/退格撤回特性；本闸不实现这些特性，也不得因它们缺失而阻塞，`entry.base` 允许恒为 `null`。

## 2. 不变约束（父级红线 · 任何修改不得破坏）
> 每条红线**必须标注归属**：`[H#]`（由该硬不变量机检）或 `[soft-only: 原因]`（只能主观把关，写明为何无法机检）。绝对不能改的代码块优先给 sha256 机检形式。不允许留下既非 `[H#]` 也非 `[soft-only]` 的悬空红线。
- 产物仍是单文件、自包含、`</html>` 闭合、字节数 ≥ 1024，且不引用 `http(s):` 或协议相对外部 script/link/img/font/@import/url() [H10]
- 无名单模式完全保持现状：历史最新在上、刷新清空、无序号、编辑后**追加**新记录且原记录保留、不写任何历史存储、不写 `cal-phone.roster.v1` [H5, H9]
- 名单模式下编辑必须原地覆盖：序号/姓名/学号/行位置/总行数不变，不消耗下一位，不新增行，不产生“新记录” [H4]
- 序号恒等于名单行顺序 1..N；文件里的「序号」旧值不参与编号，导出与名单行都写 1..N；无名单历史没有序号 [H5]
- 导入确认前、取消或关闭对话框时，当前名单、成绩与计算器状态完全不变 [H2]
- 导入成功后计算器整体归零：无 `data-operator`、算式/结果/主输入框为空、编辑草稿不可见、状态为 `select`、从第 1 位开始 [H2]
- 顺序回填只写 `seq` 最小的空成绩行；除零/非法/空 `=` 不消耗下一位；录满时结果照常显示且状态行可见提示 `名单已录满`，不得静默吞掉 [H3]
- 持久化键固定 `cal-phone.roster.v1`；刷新恢复名单/成绩/顺序/下一位，计算器回 `select`；清除删除该键；localStorage 抛错时降级为内存并显示不可关闭提示；坏数据/未知版本忽略且不覆盖原值 [H7]
- 导出为 UTF-8 带 BOM、CRLF、逗号分隔；列序与原文件一致（缺序号前补、缺成绩后补）；未录成绩为空字符串而非 `0`/`NaN`；已录成绩为 `formatValue` 结果；文件名含原名与日期；导出不改变页面或存储 [H6]
- 320×568 与 390×844 下导入对话框、3 行/50 行名单、编辑态均无横向溢出；可见交互控件 ≥44×44 CSS px；输入字号 ≥16px；名单行正文 ≥13px [H8]
- 名单表使用列表/表格语义；每个编辑按钮有含序号与姓名的 `aria-label`；`下一位` 不能只靠颜色；导入对话框为原生 `<dialog>`，Esc 可关，焦点进入主按钮并在关闭后回到导入按钮 [H8]
- 既有 18 个场景除 `origin/master` 上已存在的唯一过期断言 `cold-start.keys-disabled` 外全绿；`tests/scenarios/{core,continuity,edit,layout,determinism}.mjs` 五个文件字节不变 [H9]
- 新增名单行为由 `tests/scenarios/roster-*.mjs` 场景覆盖并注册进 `tests/suite.mjs`，新增 `roster-*` 场景 ≥5 个且全部 PASS [H9]
- 导入预览、名单进度与编辑现场的文案清楚、警告显眼、信息层级不误导 [soft-only: 文案清晰度与视觉权重属像素评审，机检无法判断]

> 允许改动的范围豁免写在下面的定界块里（runner 会把它**逐字**内联进 first / recast / final 验收器的 runtime contract，避免首轮判合规、末轮判违规的判定分裂）。没有豁免就写 `无`。

<<<SCOPE-EXEMPTIONS
允许改动 /ws/cal_phone-worktrees/roster-import/index.html 与 /ws/cal_phone-worktrees/roster-import/tests/**：可新增 tests/scenarios/roster-*.mjs，在 tests/suite.mjs 中注册新场景，更新 tests/README.md；可新增 §3 规定的 data-testid / data-* 测试钩子（含 roster-row 的 data-name/data-id、roster-next 的 data-seq、import-summary 的 data-count、import-dialog 的 data-error）。不得修改 tests/scenarios/{core,continuity,edit,layout,determinism}.mjs 的既有断言（五个文件 sha256 已冻结），不得改动既有 Telos/** 证据、docs/** 规格或其它业务文件。不得引入依赖、构建步骤、网络请求或外部资源。
SCOPE-EXEMPTIONS>>>

---

## 3. 硬目标（独立确定性验收 · 硬闸 · codex exec）

**输入矩阵（采样覆盖；含边界与「哪些算、哪些拒答」）：**
- 编码 ∈ {UTF-8 带 BOM, UTF-8 无 BOM, GBK}；分隔符 ∈ {逗号, 分号, 制表符}；行尾 ∈ {LF, CRLF}。
- 表头 ∈ {姓名, 名字, 学生姓名} × {学号, 考号, 学籍号} × {成绩, 分数, 得分} × {序号, 无序号}；列顺序打乱；含额外列 `班级`/`备注`；同时含 `姓名` 与 `名字`；缺姓名；缺学号；姓名与学号都有。
- 行数 ∈ {1, 3, 50}；空行穿插；姓名与学号都为空的非空行跳过。
- 拒绝 ∈ {0 字节, 仅空行, 首行是数据而非表头, 表头既无姓名也无学号（如仅 `班级,成绩`）, 不可解码的二进制垃圾}；拒绝后当前名单与成绩不变、可重新选择。
- 状态 ∈ {无名单且已有 2 条历史并停在结果态, 无名单空, 名单 3 行全空, 部分已录, 全部录满, 编辑态, 清除确认}。
- 操作 ∈ {导入确认/取消/重新选择, 成功 `=`, 除零 `=`, 空 `=`, 行内编辑后 `=`, 关闭编辑, 清除二次确认, 未录完导出, 导出后重导入}。
- 持久化 ∈ {刷新恢复, 清除后刷新, 坏 JSON, 未知 version, Storage.prototype.getItem/setItem 抛错}。
- 视口 ∈ {320×568 CDP 真机度量, 390×844}；确定性 ∈ {两个全新 context 执行同一导入+录入+编辑序列}。

**稳定测试入口：** 既有 `main.app[data-state]`、`main.app[data-operator]`、`input[data-testid="calc-input"]`、`#state-label`、`[data-testid="expression"]`、`[data-testid="result"]`、`[data-testid="keypad"]`、`[data-testid="op-picker"] button[data-op]`、`[data-key="0"…"9", ".", "backspace", "enter", "equals"]`、`[data-testid="key-equals"]`、`[data-testid="key-op"]`、`[data-testid="history-item"]`、`[data-testid="history-result"]`、`[data-testid="history-edit"]`、`[data-testid="edit-draft"]`、`[data-testid="operand-input"]`、`[data-testid="operand-remove"]`。本闸要求新增：`[data-testid="roster"]`、`[data-testid="roster-summary"]`、`[data-testid="roster-row"]`（带 `data-seq`、`data-filled="true|false"`、`data-name`、`data-id`）、`[data-testid="roster-score"]`、`[data-testid="roster-expression"]`、`button[data-testid="roster-edit"]`、`[data-testid="roster-next"]`（带 `data-seq`）、`button[data-testid="roster-import"]`、`button[data-testid="roster-export"]`、`button[data-testid="roster-clear"]`、`input[data-testid="roster-file"][type=file]`、`dialog[data-testid="import-dialog"]`（带 `data-error` 表示解析失败）、`[data-testid="import-summary"]`（带 `data-count`）、`button[data-testid="import-sample"]`、`button[data-testid="import-confirm"]`、`button[data-testid="import-cancel"]`；清除的二次确认可用原生 `confirm()`（监听 page dialog 接受）或页内 `[data-testid="roster-clear-confirm"]` 按钮。

**不变量：**

| # | 不变量 | 硬闸怎么验（须真跑，非读源码目测） | 阈值 |
|---|---|---|---|
| H1 | CSV 导入解析、列保真与拒绝 | 用 `setInputFiles` 向 `input[data-testid="roster-file"]` 喂 7 组可导入 fixture（UTF-8 BOM 逗号 3 人、UTF-8 无 BOM 分号 2 人且列序打乱、GBK 制表符 2 人、缺学号、缺姓名、额外列、`姓名/名字` 同义列、带引号逗号/引号/换行的姓名），每组读 `import-summary` 的 `data-count` 与预览文本，确认后读 `roster-row` 的 `data-seq`/`data-name`/`data-id`/`data-filled` 与总行数；再喂 5 组拒绝 fixture（0 字节、仅空行、数据首行、仅班级+成绩表头、二进制垃圾），读 `import-dialog[data-error]` 与 `roster-row` 数；点 `import-sample` 捕获下载并读字节 | 三种编码与三种分隔符均 `data-count` 正确、姓名/学号正确、行数正确；`序号` 列不改变 `data-seq`（恒 1..N）；缺学号/缺姓名可导入；额外列与右侧同义列不丢；引号 fixture 的姓名逐字符一致（`张,三`、`李"四`）；5 组拒绝均 `data-error="true"`、dialog 仍开、`roster-row` 数不变、localStorage 无 `cal-phone.roster.v1`；样例下载字节以 `EF BB BF` 开头且 ≥4 行（表头+3 行） |
| H2 | 导入即重置，取消/关闭不变 | 无名单先算 `+` 12、30、8 `=`（结果 50），再算 `*` 2、3、4 `=`（结果 24），停在结果态；导入 3 人 fixture A 到预览后点 `import-confirm`；读 `roster-row` 数/`data-filled`、`roster-summary`、`roster-next[data-seq]`、`main.app[data-state]`/`data-operator`、`expression`、`result[data-value]`、`calc-input`、`edit-draft` 可见性、`history-item` 数。另开全新 context 重做 2 条历史后打开导入、预览 3 人名单，分别点 `import-cancel` 与按 Esc | 确认后：名单 3 行且全 `data-filled="false"`、摘要含 `已录 0`、`roster-next[data-seq="1"]`、state=`select`、无 `data-operator`、算式空、结果无值、输入框空、编辑草稿不可见、`history-item`=0；取消/Esc 后：`history-item` 仍 2、结果仍 24、运算符/算式/输入框与导入前一致、无名单区 |
| H3 | 顺序回填、下一位推进与录满 | 导入 3 人（1 张三 / 2 李四 / 3 王五）；先做 `5 / 0 =` 与空 `=`；再依次 `+` 10、20 `=`；`+` 3、4 `=`；`+` 5、6 `=`；最后 `+` 1、1 `=`。每次读三行的 `data-filled`、`roster-score`、`roster-expression`、`roster-next[data-seq]`、摘要与 `#state-label` | 除零与空 `=` 后仍 0 条已录、`roster-next[data-seq="1"]`；第 1/2/3 次成功依次写 seq 1/2/3，分数 `30`/`7`/`11` 且姓名对应不变，下一位依次 2→3→无；第 4 次结果区显示 `2` 但名单仍 3 行、三条 score 不变（`30/7/11`）、无新行、`#state-label` 含 `名单已录满` |
| H4 | 原地编辑同步、下一位不动 | 3 人全部录满（12+30+8=50、9+1=10、5+5=10），快照第 1/3 行全字段；点第 2 行 `roster-edit`，读编辑草稿与 `#state-label`，用 `operand-input.fill("7")` 把 9 改成 7 后 `=`；读三行与行数，刷新后再读。另做 5 人名单只录 2 条，编辑第 1 行后读 `roster-next`。50 人名单全部录完后滚到末行点编辑，读 `edit-draft` 的视口位置；关闭后读焦点。3 人场景另测编辑中关「关闭」 | 编辑后第 2 行 seq=2、姓名=李四、行数=3，score 由 `10` 变 `8` 且算式含 `7`；第 1/3 行逐字段不变；刷新后第 2 行仍为 `8`；录满时编辑前后 `roster-next` 均不存在；5 人场景编辑后 `roster-next[data-seq]` 仍为 `3`、已录条数仍 2；50 人末行点击后 `edit-draft` 的 rect 顶部 ≥0 且底部 ≤ viewport 高度；关闭后 `document.activeElement` 是该行 `roster-edit`；关「关闭」后该行 score 不变 |
| H5 | 序号语义与无名单模式回归 | 导入 3 人后读三行 `data-seq` 与可见序号；无名单 context 算 2 条历史，读 `history-item` 的 `data-seq` 与顺序；对较早一条点 `history-edit`、改一个操作数后 `=`，读历史条数与顺序 | 名单 `data-seq` 恰为 `["1","2","3"]`、无空洞；无名单 `history-item` 均无 `data-seq`、最新在上；无名单编辑后历史 3 条（追加语义），原两条内容不变 |
| H6 | 导出 CSV 的内容、文件名与无副作用 | 导入 fixture A（表头 `序号,学号,姓名,成绩,班级`）并录 2 条（50、10），点 `roster-export` 捕获下载，读文件名与字节；再分别导入缺序号、缺成绩、重复同义列、带引号姓名的 fixture 后导出；导出后读页面与 localStorage；把导出文件重新当名单导入 | 字节前 3 字节 `EF BB BF`、行尾全为 CRLF、表头恰为 `序号,学号,姓名,成绩,班级`；数据行 `1,20230101,张三,50,高一3班` / `2,20230102,李四,10,高一3班` / `3,20230103,王五,,高一3班`；缺序号时表头以 `序号` 开头、缺成绩时以 `成绩` 结尾；同义列两列都在且右侧值保留；引号姓名按 RFC 4180 加引号并可被自身重导入还原；文件名为 `高一3班-成绩-YYYYMMDD.csv`；导出前后 roster/score/localStorage/计算器状态逐字段不变；重导入后人数与姓名/学号一致、成绩全空 |
| H7 | 持久化对象、刷新恢复、清除与降级 | 导入 3 人录 2 条后读 `localStorage["cal-phone.roster.v1"]` 并解析；`page.reload()` 后重读页面；点 `roster-clear` 并接受二次确认，读存储/名单/历史，再 reload；新 context 用 `addInitScript` 让 `Storage.prototype.getItem/setItem` 抛错，导入并录 1 条；另用 `addInitScript` 预置坏 JSON 与 `{"version":99}` 后打开页面并读存储值 | 存储对象 `version=1`、有 `fileName`/`headers`、`rows.length=3`、`rows[0].entry=null`、`rows[1].entry` 的 `seq/operator/operands/expression/result` 与页面一致；reload 后 3 行、2 条已录、分数不变、`roster-next[data-seq="3"]`、state=`select` 且输入/算式/结果为空；清除后键不存在、名单区消失、无名单历史为空、reload 仍无名单；storage 抛错时页面无 pageerror、录入仍成功、可见提示含 `本机存储不可用，刷新会丢失成绩。`；坏 JSON/version=99 时无名单、无 pageerror、存储原值未被覆盖 |
| H8 | 320/390 布局、触控、字号与可达性 | 390×844 与 320×568（CDP `Emulation.setDeviceMetricsOverride`）分别构造：导入首段、预览段、3 行混合名单、50 行名单、编辑态；逐态读 `documentElement/body` 溢出、可见 `input/button` rect 与字号、`roster-row`/`roster-score`/`roster-expression` 字号；读 `roster` 与行的语义角色、`roster-edit` 的 `aria-label`、`roster-next` 文本、工具栏与首行的纵向顺序；打开导入 dialog 读 `tagName/open/:modal` 与 activeElement，按 Esc 关闭后读焦点 | 每态横向溢出 ≤1px；可见控件 rect 宽高均 ≥43.5；可见输入字号 ≥15.5；`roster-row` 与 score/expression 字号 ≥12.5；`roster` 匹配 `[role=list],table,ul` 且每行匹配 `article,li,tr,[role=listitem]`；第 3 行编辑按钮 `aria-label` 含 `编辑第 3 位` 与 `李四`；`roster-next` 文本含 `下一位`；工具栏 bottom ≤ 首个 `roster-row` top；dialog 为 `DIALOG` 且 `:modal`、`activeElement` 是 dialog 内的可见 button、Esc 后关闭且焦点回到 `roster-import` |
| H9 | 既有套件回归与新增场景 | 对 `tests/scenarios/{core,continuity,edit,layout,determinism}.mjs` 计算 sha256；用 `node tests/suite.mjs --json`（`PLAYWRIGHT_MODULE` 指向 `/ws/cal_phone/tests/node_modules/playwright`）跑全量，按 18 个基线 id 过滤；`--list` 读新增 id，再 `--only <roster ids>` 跑新场景 | 五个文件 sha256 分别为 `e15f0e95a86269e88c67c5af4b4af12650bb0cd3a4902f29e7ccfc9876e290ab`、`51521723e6df99dbfabd06ff855f42cfcba14a3652cb720119256802869f58ee`、`f61188e63586e8afa2883f6db3d3e88f7cc216a9a0c8dc7d465953ad37ceadc1`、`c96ed96499a18b9731a8e10dabb579a761d445534105caabfa7424803def65a0`、`64bc09c49ac56c21aef77bdd1a7f7c365b8791d0690076f5964b58f06e69ddff`；18 个基线场景中 17 个 PASS，`cold-start` 的唯一失败 check 必须是 `cold-start.keys-disabled`（其余 check 全 PASS），其它基线场景失败数 0；新增 `roster-` 前缀场景 ≥5 个，id 覆盖 import、fill、edit、export、storage/persist 五类，且用 `--only` 跑全部 PASS |
| H10 | 自包含、零页面错误与确定性 | Node 读产物文本统计 `</html>`、字节数、外链；汇总 H1–H9 全部页面的 `pageerror` 与 console error；两个全新 context 各自导入同一 3 人 CSV、录 2 条、编辑第 1 行并 `=`，序列化 rows 与导出 CSV 文本后深度比对 | `</html>` 存在、字节 ≥1024、外链计数 0；pageerror 总数 0、console error 总数 0；两个 context 的 rows（含 entry 的 seq/operator/operands/expression/result）与导出 CSV 文本完全一致 |

<<<HARD-VERIFY-PROMPT
你是确定性验收器。**不要评价 UI 美观、不要改产物源码。**本 prompt 会被单独抽取喂给你（读不到 frontmatter 与上表），所以下面所有文件都写**绝对路径**、基线写 **sha256 值**；runner 会在其后追加 `[RUNTIME CONTRACT]`（round / phase / gate_dir / evidence_dir / out_dir / artifact_sha256 / expected_review_states / SCOPE-EXEMPTIONS 原文），以它为准。
按本闸输入矩阵 / 不变量逐条**实际执行**验证：优先复用已有测试入口，逻辑用 Node 调用函数并断言返回值/异常；界面用 Playwright/jsdom 操控稳定选择器并读值。基线只用于本任务明确要求不可更改的范围，不能自行冻结整个源码或妨碍授权修复。采用项目已有工具与依赖；缺依赖或设备时明确拒答，不能伪装成代码 FAIL。禁止用主观语言/肉眼通读代替实测证据。
量具卫生（三条，写量具时逐条自查）：① 不得含写死的恒 FAIL/恒 PASS 常量判据；② 扫描类不变量的扫描面必须与 §3 声明逐字一致、不得自行扩张，且**不得包含 evidence/ 或 evidence/runs/**（自引用扫描面一旦被本循环必写的证据污染就永远翻不了绿）；③ 断言锚定稳定选择器/数据钩子而非用户可见文案原文（软闸可能正当地要求改文案）；子进程/步骤超时 ≥ 单次实测耗时的 2 倍。
量具接口（两条，runner 靠它做变异检查与尝试隔离，缺一即拒绝提升）：① 环境变量 `KEKKAI_ARTIFACT` 存在时用它覆盖目标文件路径；② `KEKKAI_OUT_DIR` 存在时，`hard-r<N>.txt` / `render-r<N>.txt` / `manifest-r<N>.json` / `review-shots/r<N>/` 全部写到该目录下，而不是 evidence/runs（所有路径以脚本自身所在目录解析、不依赖 cwd）。
目标文件（绝对路径）：/ws/cal_phone-worktrees/roster-import/index.html
本闸具体：复用 `/ws/cal_phone-worktrees/roster-import/tests/lib/browser.mjs` 的 `launchBrowser`/`openApp` 与 `/ws/cal_phone-worktrees/roster-import/tests/lib/dom.mjs` 的既有辅助；Playwright 从 `/ws/cal_phone/tests/node_modules` 解析——在导入任何测试库**之前**设置 `process.env.PLAYWRIGHT_MODULE="/ws/cal_phone/tests/node_modules/playwright"`（或 `NODE_PATH=/ws/cal_phone/tests/node_modules` 并用 `createRequire('/ws/cal_phone/tests/package.json')`）。所有页面收集 `pageerror` 与 `console` error，最后汇总为 0。数值容差 1e-9，布局容差 0.5px；320px 必须 `const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setDeviceMetricsOverride',{width:320,height:568,deviceScaleFactor:2,mobile:true});` 后再导航。屏幕键用 `locator.click()`，编辑操作数用 `locator.fill()`；文件导入用 `locator.setInputFiles()`（隐藏 input 也可用）；下载用 `page.waitForEvent("download")` 读 `suggestedFilename()` 与字节，若 `file://` 下不触发，则在导航前注入钩子捕获 `URL.createObjectURL` 的 Blob 文本并同时断言锚点 `download` 属性。fixture 写在 `KEKKAI_OUT_DIR`（缺省时写 `os.tmpdir()` 下的新目录），GBK 用 `python3 -c "import sys;sys.stdout.buffer.write(open(...,'rb').read().decode('utf-8').encode('gbk'))"` 或 `iconv -f UTF-8 -t GBK` 生成，不要污染仓库。等待一律用 `page.waitForFunction` 轮询稳定选择器状态，不要用固定 sleep（滚动/焦点落定可等 100–200ms）。点击屏幕键必须用 `locator.click()`，不得直接写 `input.value`；物理键盘用 `page.keyboard.press()`。

逐条验法：
- H1：写 7 组可导入 fixture 与 5 组拒绝 fixture（内容见 §3 输入矩阵与下条；fixture A 用 CRLF，其余用 LF）。每组：全新 context 打开产物，点 `[data-testid="roster-import"]`，`setInputFiles` 到 `input[data-testid="roster-file"]`，等 `[data-testid="import-summary"]` 的 `data-count`；读预览文本；点 `import-confirm`；读 `[data-testid="roster-row"]` 的 `data-seq`/`data-name`/`data-id`/`data-filled`。fixture A（UTF-8 BOM，逗号）：`序号,学号,姓名,成绩,班级` + `1,20230101,张三,85,高一3班` / `2,20230102,李四,92,高一3班` / `3,20230103,王五,78,高一3班`，期望 3 人、seq 1..3、姓名张三/李四/王五。fixture B（UTF-8 无 BOM，分号，列序打乱）：`学号;名字;班级` + `20230104;赵六;高二1班` / `20230105;钱七;高二1班`，期望 2 人、名字别名生效。fixture C（GBK，制表符）：`考号\t姓名\t得分` + `20230106\t孙八\t88` / `20230107\t周九\t91`，期望 2 人。缺学号 fixture：`姓名,班级` + `吴十,高三1班`。缺姓名 fixture：`学号,备注` + `20230108,无姓名`。额外列与同义列 fixture：`姓名,名字,学号,班级` + `张三,小三,20230101,高一3班`，期望姓名取左列 `张三`、`名字` 列保留 `小三`。引号 fixture：`姓名,学号,备注` + `"张,三",20230101,"含,逗号"` / `"李""四",20230102,"含\n换行"`，期望姓名逐字符为 `张,三` 与 `李"四`。拒绝：0 字节、仅 `\n\n`、首行 `张三,20230101`（无表头关键字）、`班级,成绩\n高一3班,88`、字节 `0xFF 0xFE 0x00 0x01 0xFF`。拒绝后断言 `[data-testid="import-dialog"][data-error="true"]`、第二段未出现（`data-count` 缺省）、`roster-row` 数 0、`localStorage.getItem("cal-phone.roster.v1")` 为 null。样例：全新页点 `import-sample`，读下载字节以 `EF BB BF` 开头且按 UTF-8 去 BOM 后行数 ≥4。
- H2：无名单 context：`+` 12 回车 30 回车 8 回车 `=`（结果 50），再 `*` 2 回车 3 回车 4 回车 `=`（结果 24），停在结果态并记下 `data-operator`/算式/结果/输入框。打开导入 → fixture A → 预览 → `import-confirm`。断言 §3 H2 阈值全部成立。取消/Esc 路径：另开 context 重做 2 条历史，打开导入、预览 fixture A，分别点 `import-cancel` 和 `page.keyboard.press("Escape")`，断言状态逐项不变且无 `[data-testid="roster"]`。
- H3：导入 fixture A 的 3 人；`5` `/` `0` `=` 读错误态与名单；空 `=`；然后按 `+` 10 回车 20 回车 `=`、`+` 3 回车 4 回车 `=`、`+` 5 回车 6 回车 `=`；每次等 `roster-row[data-filled="true"]` 数增加再读三行 `roster-score`/`roster-expression`/`roster-next[data-seq]`、摘要与 `#state-label`；最后 `+` 1 回车 1 回车 `=` 读结果与名单。
- H4：导入 fixture A；`+` 12 回车 30 回车 8 回车 `=`、`+` 9 回车 1 回车 `=`、`+` 5 回车 5 回车 `=`；快照第 1/3 行 `data-seq/data-name/data-id/data-filled/roster-score/roster-expression`；点 `[data-testid="roster-row"]:nth-child(2) [data-testid="roster-edit"]`（或按 data-seq=2 定位）；读 `edit-draft` 可见与 `#state-label` 含 `李四`；`operand-input` 第一/nth 个 `fill("7")`（把 9 改 7，保持两操作数 7+1），点 `=`；读三行与行数；`page.reload()` 后等 roster 恢复再读第 2 行。5 人部分名单：导入 5 人、录 2 条、编辑第 1 行后读 `roster-next[data-seq]`。50 人：生成 50 行 fixture，导入后循环用 `+` 10 回车 10 回车 `=` 录满；`page.evaluate(() => document.querySelectorAll('[data-testid="roster-row"]')[49].scrollIntoView())`，点末行编辑，读 `[data-testid="edit-draft"]` 的 `getBoundingClientRect()` 是否在 `0..window.innerHeight`；点 `[data-testid="edit-cancel"]` 后读 `document.activeElement` 是否为该行 `roster-edit`。
- H5：导入 fixture A 读 `data-seq`；无名单 context 算 2 条，读 `history-item` 无 `data-seq` 且最新在上；点较早的 `history-edit`，`operand-input` 改一个值后 `=`，读 `history-item` 数 3 与原两条快照不变。
- H6：导入 fixture A 录 2 条（`+` 12 30 8 `=`；`+` 9 1 `=`），点导出读文件名/字节/行；文件名的 8 位日期必须等于验收时刻本地日期（`new Date()` 的 YYYYMMDD），前缀为原文件名去扩展；断言表头与三行内容、BOM、CRLF。缺序号 fixture `学号,姓名,班级`、缺成绩 fixture `学号,姓名`、同义列 fixture `姓名,名字,学号` 各导出一次并断言补列与保留列。引号 fixture 导入后录 1 条并导出，用最小 RFC 4180 解析器读回字段，断言逗号/引号/换行姓名完整。把 fixture A 的导出文件保存后，在新 context 里把它当名单导入，断言人数与姓名/学号一致、全部 `data-filled="false"`。导出前后读 roster 快照、`localStorage` 原文与计算器状态，断言不变。
- H7：导入 fixture A 录 2 条，读并 JSON.parse `localStorage["cal-phone.roster.v1"]`；断言 `version=1`、`rows[0].entry=null`、`rows[1].entry.seq=2` 且 `operator="+"`、`operands` 的 display 为 `["3","4"]`、`result=7`；reload 后等 `roster-row` 数 3，读 `data-filled`/score/`roster-next[data-seq]`/state/输入/算式/结果。清除：点 `roster-clear`，若出现 `page.on("dialog")` 则 accept，若出现 `[data-testid="roster-clear-confirm"]` 则 click；断言键删除、`roster` 消失、`history-item`=0、state=`select`；reload 后再断言。storage 抛错：`context.addInitScript(() => { Storage.prototype.getItem = () => { throw new Error("blocked") }; Storage.prototype.setItem = () => { throw new Error("blocked") }; })`，打开后导入 fixture A 并录 1 条，断言 score 写入内存、页面出现含 `本机存储不可用，刷新会丢失成绩。` 的可见文本、pageerror=0。坏数据：`addInitScript` 里 `localStorage.setItem("cal-phone.roster.v1", "{bad")`（以及 `{"version":99}` 另一次），打开后断言无 roster、pageerror=0，且读取该键仍等于预置原文。
- H8：390×844 与 320×568 各构造 5 态（导入首段、预览、3 行混合、50 行、编辑态）。每态读 `documentElement.scrollWidth-clientWidth`、`body.scrollWidth-clientWidth`；遍历可见 `input,button`（排除 disabled 且 `getClientRects().length=0`）读 rect 与 `getComputedStyle().fontSize`；读 `roster-row`/`roster-score`/`roster-expression` 字号；读 `[data-testid="roster"]` 的 tag/role 与每行 tag/role；读第 3 行 `roster-edit` 的 `aria-label`；读 `roster-next` 文本；读 `roster-import` 与首个 `roster-row` 的 rect 纵向关系；打开 dialog 读 `tagName/open/matches(':modal')`/activeElement，Esc 后读 `open` 与 activeElement。编辑态用 3 人或 5 人名单点第 2 行编辑。
- H9：`sha256sum` 五个文件对照上表 64hex；`PLAYWRIGHT_MODULE=/ws/cal_phone/tests/node_modules/playwright node /ws/cal_phone-worktrees/roster-import/tests/suite.mjs --json`，解析 results，只看 18 个基线 id（`self-contained,cold-start,compute,arithmetic,history-order,reset,continuity,error-recovery,sticky-operator,edit-recompute,edit-multi,edit-invalid,edit-divzero,edit-cancel-restore,edit-pending-replace,edit-pending-recent-value,layout,determinism`）：17 个 `pass=true`，`cold-start` 的失败 check id 集合必须恰为 `{cold-start.keys-disabled}`；`--list` 过滤 `roster-` 前缀，断言 ≥5 且 id 覆盖 import/fill/edit/export/storage 五类关键词；`--only <逗号分隔>` 跑这些 id，全部 `pass=true`。
- H10：Node 读目标文件文本，断言 `</html>`、字节数、用正则统计 `<script src>`/`<link href>`/`<img src>`/`@import`/`url(...)` 中 `^(https?:)?//` 为 0；汇总全部页面 `pageErrors`/`consoleErrors` 为 0；两个全新 context 各导入 fixture A、`+` 12 30 8 `=`、`+` 9 1 `=`、编辑第 1 行改一个操作数后 `=`，序列化全部 `roster-row` 的 `{data-seq,data-name,data-id,data-filled,score,expression}` 与导出 CSV 文本，深度比对。
phase=first 时把验证逻辑写成脚本 `/ws/cal_phone-worktrees/roster-import/Telos/roster-import-111913/evidence/verify.mjs`（接受轮号参数）并立即以 `node verify.mjs <round>` 运行；它按上面不变量逐条实测并写 `hard-r<N>.txt`：先写 `ROUND: <N>`、`ARTIFACT_SHA256: <64hex>`、`VERIFIER_SHA256: <64hex>`（脚本自身 sha256），再每条 `H<id> PASS|FAIL — 实测值/证据`，末行**严格** `HARD: PASS` 或 `HARD: FAIL (Hx,…)`。
若 runtime contract 的 `expected_review_states` 非 none：同一脚本还须把每个状态用 Playwright/无头 Chrome 渲染成**非空、非纯色、内容互不重复**的 PNG（≥ 240×160；真 320px 用 CDP `Emulation.setDeviceMetricsOverride`）落 `review-shots/r<N>/S<k>.png`——精确且仅这些文件；把带同样头的可见性/溢出/关键尺寸 `key=value` 实测写 `render-r<N>.txt`；写 `manifest-r<N>.json`：`round`、`artifact_sha256`、`verifier_sha256`、`metrics_sha256`、每张图的 `file/sha256/width/height`、`adhoc: []`。四态：S1 全新页 390×844 点 `roster-import`（首段）；S2 全新页先算 2 条成绩，再点导入并预览 fixture A（3 人）；S3 390×844 导入 5 人名单并录 2 条（`+` 12 30 8 `=`、`+` 9 1 `=`），下一位停在第 3 人；S4 320×568（CDP）导入 5 人名单、录 3 条后点第 2 行编辑，使编辑草稿与该行同时在视口内。每态截图前等待布局稳定；S3 不输入、不启动任何计时。
phase=final 时**禁止读取、运行或修改 verify.mjs / ledger / 旧证据**，在你被启动的隔离 scratch cwd 中重新推导全套检查；临时测量只落当前 scratch 目录，最终回复给出裁决，由 CLI 保存（不要自行写 `-o` 路径）；首行同样是 `ROUND:`、`ARTIFACT_SHA256:`，末行同样严格。
HARD-VERIFY-PROMPT>>>

---

## 4. 软目标（独立像素评审 · 软闸 · agy -p Gemini 3.8 Flash (High)）
**维度：** 易懂性、信息层级、名单进度的可读性、窄屏排布、编辑现场的可理解性

**代表性状态：** 逐个走查（**枚举写在下方 SOFT-REVIEW-PROMPT 内**，随 prompt 一并抽取，保证自足）。产物没有 URL 查询参数路由，因此每态给「到达该态的操作步骤」；截图由 §3 的量具渲染，评审只看副本像素 + 内联指标，永不看源码。

<<<SOFT-REVIEW-PROMPT
你是资深「用户界面 UI 评审官」。只评审、不改文件、不贴整页代码。运行时会追加真实 round/hash 与隔离目录内的该轮 PNG 清单；用可用的图像查看工具逐张看**真实像素**、以首次使用者视角通读。**你自身不起浏览器、不渲染；禁止搜索/读取业务源码、`ledger.md`、目标仓库规则或任何旧轮评审。**若本轮附图/指标不完整，输出 `EVIDENCE_INCOMPLETE` 并停止，绝不拿旧图或源码顶替。
**只看用户可见呈现是否清楚/好懂/好用；不判计算、导入解析或规则正误（那是硬闸职责）。**
**运行时会把本轮机检指标原文内联进 prompt**（关键选择器的可见性/溢出/关键尺寸实测）：你的判断**不得与之矛盾**——若指标显示某元素 visible / 可滚动 / 无溢出，就不得断言它不可见/不可滚动/破版（截图 + 指标都对不上的判断＝幻觉，会被台账记为「评审误报」驳回）。
再依次走查以下代表性状态各一遍（每态对应本轮一张附图 `S<k>.png`）：
S1 | 导入首段（390×844）：直接打开 /ws/cal_phone-worktrees/roster-import/index.html，点「导入名单」；看格式说明、`下载样例名单`、`选择文件`、`取消` 的层级，首次使用者能否一眼知道要准备什么文件、主操作是哪个。
S2 | 导入预览（390×844）：先在没有名单时算 2 条成绩，再点导入并选择 3 人 CSV；看 `识别到 3 人`、识别列、前 3 行预览，以及「导入会清空当前 2 条成绩」这类警告是否显眼、`开始录入/重新选择/取消` 是否主次分明，用户会不会误点。
S3 | 名单录入中（390×844）：导入 5 人名单，录 2 条（12+30+8=50、9+1=10）；看已录行的算式+成绩是否可查、未录行的 `—` 占位、第 3 行「下一位」高亮与文字标签、摘要行 `已录 2 · 下一位 3` 是否让人知道该录谁；工具条 `导入/导出/清除` 是否可辨。
S4 | 窄屏编辑态（320×568，CDP）：导入 5 人名单、录 3 条，点第 2 行「编辑」；看卡片式两行布局、序号/姓名/学号/成绩是否仍可读、编辑草稿与被编辑行是否同屏可确认、44px 触控目标是否拥挤、是否出现横向溢出或错位。
评审重点：首次使用者能否不读说明就理解「导入 → 从第 1 位开始 → 录满 → 导出」的流程？预览里的清空警告会不会被当成普通提示而忽略？「下一位」是否只在颜色上区分、还是文字也说得清？已录行的算式会不会太抢眼、未录行的 `—` 会不会被误认为成绩？320px 下编辑时还知道自己改的是哪一位吗？
先原样回显三行绑定头：`ROUND: <N>`、`ARTIFACT_SHA256: <64hex>`、`MANIFEST_SHA256: <64hex>`。
## P0 严重：每条严格一行 `P0-R<N>-<两位序号> | 区域 | 问题 | 为什么影响理解 | 建议修法`
## P1 重要：每条严格一行 `P1-R<N>-<两位序号> | 区域 | 问题 | 为什么 | 建议修法`
## P2 轻微（可选，不凑数）：同格式 `P2-R<N>-<两位序号> | …`
序号在每个级别内从 01 连续递增；末行计数必须与上面结构化 finding 行数完全一致。
末行：`P0=x P1=y P2=z`。
SOFT-REVIEW-PROMPT>>>

**P0 定义（硬性必修）：** 导入首段/预览的关键操作（选择文件、开始录入、取消）被挤压或遮挡到无法辨认；清空成绩的警告在预览中不可见，用户会在不知情下覆盖成绩；名单里看不出谁是「下一位」（只剩颜色、没有可读文字）；320px 下名单行或编辑草稿横向溢出导致姓名/成绩/编辑按钮不可读；编辑态无法确认自己正在改哪一位。计算错误、导入解析失败、存储失败与测试断言失败属于硬闸，不得在这里重复判为 P0。

---

## 5. 运行与停止（命令按需选用，非逐行执行的脚本；停止数字只在 frontmatter）
    # gate=/ws/cal_phone-worktrees/roster-import/Telos/roster-import-111913 · rendered by kekkai new — do not edit
    kekkai doctor --gate "/ws/cal_phone-worktrees/roster-import/Telos/roster-import-111913" --host     # before round 1 and after any host change
    kekkai hard "/ws/cal_phone-worktrees/roster-import/Telos/roster-import-111913"                     # r1: independent author writes evidence/verify.mjs; later rounds replay it
    kekkai soft "/ws/cal_phone-worktrees/roster-import/Telos/roster-import-111913"                     # only after a hard PASS: fresh AGY review over copied pixels
    kekkai adhoc "/ws/cal_phone-worktrees/roster-import/Telos/roster-import-111913" -- <command…>      # same-round measurement admissible as 误报 basis
    kekkai recast "/ws/cal_phone-worktrees/roster-import/Telos/roster-import-111913" --reason "<why>"  # sick instrument: quarantine + fresh independent author (≤3 eras)
    kekkai hard "/ws/cal_phone-worktrees/roster-import/Telos/roster-import-111913" --final             # terminal independent stamp at the stop candidate
    kekkai lint "/ws/cal_phone-worktrees/roster-import/Telos/roster-import-111913" --post              # after round 1, on recovery, before STOP
    kekkai close "/ws/cal_phone-worktrees/roster-import/Telos/roster-import-111913" --by <budget|host|instrument|oscillation|human> --blocker "<one sentence>"

- **轮次 = runner 提升进 `evidence/runs/hard-r<N>.txt` 的 canonical 盖章**；其余一切都是尝试（`evidence/attempts/`），不写台账、不占预算、不动 K。轮号由 runner 分配，不要手填；不要手跑 `node verify.mjs` 再拷文件进 runs/（缺 runner 头会被拒绝）。
- **`kekkai hard` 退出码**：`0` 提升为轮；`2` 尝试已归档（先读 `kekkai status --json` 和消息：若该轮已提升但 final 缺失，补 `--final`；否则修因后继续，不盲重跑）；`3` 重复/尝试上限——只有三条合法路：(1) change the business tree, (2) `kekkai recast --reason`, (3) `kekkai close --by <tag>`；`4` 规则拒绝（读消息，别原样重试）。管道故障同一输入有重试上限；无法修复就 `close`，不换措辞/增预算绕过。
- **软闸只在该轮 hard PASS 后有资格发言**；硬闸通过后修复主观 P1 要当轮记录取舍，后续同主张不翻案；不为纯偏好/P2制造新工作。每条 P0/P1 在 ledger「软闸 finding 处置」恰好一行（有效｜台账命中｜误报），派生数由处置行计算；命中按主张不按措辞，当轮拍板次轮生效；合法 verdict 前发现真实缺口时软闸列写 `—: <原因>`。
- **首个 hard PASS 轮 runner 自动跑审计 final**；final 与量具不一致 ⇒ final 的 FAIL 成立，只能修代码或 `kekkai recast`，永不再跑一次 final 试运气。
- **停止**：`converged` = 最新轮 hard PASS + 去重后 P0=0 + 连续 K 轮（K 为 CREED 常量）无台账外新增 P1 + 同 era 的独立 final PASS，且未超 frontmatter `max_rounds`；任何轮数（含 0）都可以 `kekkai close --by <budget|host|instrument|oscillation|human>` 写 blocked 终态并附 `blocker:` 行——绝不把 gate 停在 in-loop 而无 STOP。
- 第 1 轮后、恢复时、写 STOP 前各跑一次 `kekkai lint <本目录> --post`；`POST-IN-PROGRESS` 是运行中的预期警告。

---

## 附录 · 生成器判断记录（可审计的 taste↔structure 边界）
> 让执行者能看懂哪些是「结构强制」、哪些是「生成器的 taste 取舍」。不要复述停止数字（它们只在 frontmatter）。
- **worktree 基线**：本闸按要求基于 `origin/master`（65e6ccd）新建 worktree `/ws/cal_phone-worktrees/roster-import`，规格文件已复制到 `docs/superpowers/specs/2026-11-19-roster-import-design.md`。主 checkout `/ws/cal_phone` 的 `index.html` 有未提交的统分设置（自动回车/基数/退格撤回）改动，**不在本基线上**；因此本闸不实现这些特性、不要求设置键互动，`entry.base` 允许恒为 `null`。合入含设置的分支时需另行适配，不能把本闸当作那部分行为的验收。
- **全量改动，无 sha256 基线**：名单功能横跨整份单文件应用，冻结引擎 sha256 会妨碍授权修复；回归由共享套件（H9）覆盖，结构红线只保留自包含/闭合/无外链（H10）。
- **五个既有场景文件冻结**：`core/continuity/edit/layout/determinism.mjs` 给出完整 sha256，防止为了新功能改旧断言；`tests/suite.mjs` 不冻结，因为必须注册新场景。`origin/master` 上 `cold-start.keys-disabled`（期望 14 禁用，实测 0）是既有过期断言，本闸不要求修复它，只要求它仍是唯一失败 check。
- **新增机器钩子**：规格给了 `roster-*` / `import-*`，但姓名/学号、下一位序号、预览人数、解析失败没有机读属性。为使硬闸不依赖文案，追加 `roster-row[data-name][data-id]`、`roster-next[data-seq]`、`import-summary[data-count]`、`import-dialog[data-error]`；这些在 SCOPE-EXEMPTIONS 中显式授权。
- **软闸保留**：导入对话框、预览警告、名单进度、320px 卡片与编辑现场都是首次使用者可见的呈现面，需要像素评审。当前宿主机没有 `agy`，doctor 会报告缺失；runner 按协议准入后可用一次性 Codex 软审回退，不在执行中改 profile。
- **320px 用 CDP**：无头 Chrome 的 `--window-size` 有约 500px 下限，320px 必须 `Emulation.setDeviceMetricsOverride`，否则窄屏评审是假的。
- **无 URL 深链**：产物是单文件、没有查询参数路由；各评审态用 UI 控件到达，量具按步骤渲染。
- **`volatile` 为空**：产物是单个文件，gate 目录与复制进来的 `docs/` 均未跟踪、不进入 TREE_SHA256，仓库没有构建产物；归档在 gate 收敛后由 `scripts/gate-worktree-archive.mjs` 处理，不需要在本闸运行期排除。
- **下载与文件输入的测法**：导入用隐藏 `<input type=file>` + `setInputFiles`；导出用 Playwright download 事件读字节，必要时注入 `URL.createObjectURL` 捕获 Blob。GBK fixture 用 Python3/iconv 生成，不引第三方编码库。
