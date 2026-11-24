---
# ── Kekkai Goal Gate v4 · frontmatter（唯一机读区；停止数字只在这里；矩阵/不变量内容只在正文表格）──
slug: roster-import-v2-112203
version: 4
model_profile: muse-spark-1.3-v1  # 本机 codex provider 不提供 gpt-6-astra；新闸在首轮前显式选定，执行中不可修改
status: in-loop                      # draft | in-loop | converged（blocked 终态保持 in-loop）
repo: /ws/cal_phone
artifact: /ws/cal_phone/index.html
# artifact_kind: url | app | service   # 仅 artifact: null 时启用；此时 ARTIFACT_SHA256 := TREE_SHA256
parent_gate: null                  # 子闸填父 GOAL.md 绝对路径；只继承 round-0 决策，不继承证据或 verify.mjs
verifiers:
  hard: codex exec                 # 固定驱动器；pin 与访问标志在 bin/runner.mjs（docs/RUNNER.md）
  soft: agy -p (Gemini 3.8 Flash (High))   # 固定驱动器；无软闸的 gate 为 null（kekkai new --soft none）
stop:
  max_rounds: 12
hard_invariants: [H1, H2, H3, H4, H5, H6, H7, H8, H9, H10, H11]
review_states: [S1, S2, S3, S4]
volatile: ["Telos/_worktree-archive"]   # 归档证据目录不是业务码；避免归档动作扰动 TREE_SHA256
---

# Kekkai Goal Gate · 名单导入与成绩回填 v2（四角色列映射 · 保留/清空导入）

> **运行指令**：你是执行者（Codex / Claude Code / ZCode / Cursor 之一，由 handoff 指定；生成本 gate 的那次调用不得兼任）。
> 开跑前先 `kekkai doctor --gate <本目录> --host`；只有 `requires_display: true` 的真实桌面测量依赖解锁与屏幕权限，普通无头浏览器/逻辑测量不占屏。
> 读**本文件全文** + 同目录 [`./ledger.md`](./ledger.md)（决策台账），然后只用 §5 的命令块驱动验收，直到 §5 的停止条件；在已授权范围内自主推进，缺少外部输入时写明 blocked 与恢复条件。
> 生命周期编辑是唯一允许的 GOAL 改动：第 1 轮前 `status: draft → in-loop`；写 `converged` STOP 前 → `status: converged`；blocked 终态保持 `in-loop`。
> 除此之外 GOAL.md 只读：不改 frontmatter 数字、不改 prompt、不改变 §5 命令的操作、目标路径和关键参数（注释与空白不影响验收）。
> 教义在 Kekkai skill 的 `docs/CREED.md`、runner 契约在该 skill 的 `docs/RUNNER.md`——本文件不复述它们；`kekkai hard/soft` 的退出码与消息就是你的下一步。

## 1. 目标（一句话 + 背景 + 实施指导）
让 `/ws/cal_phone/index.html` 从「算一笔、抄一笔」的会话工具，变成一张**能导入名单、按名单顺序连续统分、把每笔成功计算自动回填到对应学生、能原地改错、刷新不丢、并能导出可直接交付的 CSV** 的名单成绩表。导入后「计算历史」让位给「名单成绩」：未录行留空占位、下一位在列表与输入框下方双重提示、录满有可见提示；无名单模式（历史最新在上、刷新清空、编辑追加、草稿按钮「关闭」）保持原样。设计依据是 `/ws/cal_phone/docs/superpowers/specs/2026-11-19-roster-import-design.md`（2026-11-22 修订版，按当前自动确认/自动等号/结果后暂停/语音语义对齐），该文件的 §2 行为、§6 钩子契约与 §7 验收场景是本闸的产品真值；本文件不复述其全部细节，但 §3 的不变量就是它的可执行子集。

**实施指导**：
在现有单文件 IIFE 状态机（`select / input / result / error / edit`）之上扩展，保持 float64 从左到右折叠、`formatValue` 口径、自动确认、自动等号、基数快照、结果后暂停、退格撤回、震动与「语音只念结果」的既有语义。新增唯一真值 `roster = { version, fileName, headers[], roles[], rows[] }`，`rows[i] = { seq, id, name, extra[], entry|null }`，`entry` 与现有历史条目同构并带 `seq`：`{ seq, operator, operands:[{value,display}], base:null|{value,display}, expression, result }`。名单模式下 `history-item` 不再渲染，名单行是成绩唯一真值；无名单模式完全不动。

导入：`FileReader`/`arrayBuffer` 读字节，先 `new TextDecoder("utf-8")` 解码，含 `U+FFFD` 时改用 `new TextDecoder("gbk")` 重解，仍失败或含 NUL 则拒绝；去掉 BOM。分隔符只在表头行、引号感知地统计 `,` `;` `\t` 的出现次数，取最多者，并列按 `,`→`;`→`\t`。CSV 按 RFC 4180 解析（引号内分隔符/换行合法、`""` 表示一个引号、支持 LF/CRLF/孤立 CR）。第一行固定是表头；数据行按表头列数对齐，少补空、多忽略，空行跳过；被所选「学号」和「姓名」都为空的行跳过，`seq` 在跳过之后按 1..N 生成。文件里的成绩值一律不采用。「选择文件」与「粘贴名单」共用同一套解析/映射/预览逻辑（粘贴的文件名固定为 `粘贴名单`）。

列映射：预览固定显示四个 `select`（学号/姓名/成绩/序号），选项为表头每列（带列号，如 `第 2 列：学号`）+ `无`；默认按别名最左列（学号 `学号/考号/学籍号`、姓名 `姓名/名字/学生姓名`、成绩 `成绩/分数/得分`、序号 `序号`），别名只决定默认值；四个角色两两不能同列，学号与姓名至少选一个，映射变化实时重算人数/前 3 行/列标签/可保留计数。确认时把映射写成与 `headers` 对齐的 `roles` 数组（`seq | id | name | score | extra`，每角色至多一个）存进名单；导出按 `roles` 写回，不再猜表头。

导入方式：仅当本机已有名单且至少 1 条已录成绩时出现。`保留同学号成绩` 只按所选学号列去首尾空白后的原字符串精确匹配，不按姓名/行号/序号；任一侧出现重复非空学号（宽判定：任意两条非空学号相同，不管是否已录）就禁用保留，只留清空并列出最多 3 个重复学号；未选学号列或可保留数为零时同理只留清空。保留时新名单按新顺序/姓名/表头重建，同学号行带上旧 `entry`（只把 `entry.seq` 改成新行号，其余字段原样），不匹配的旧成绩丢弃，新行从空开始；清空时全部 `entry=null` 且旧成绩删除。两种方式都清空计算历史、丢弃编辑草稿与快照、清空运算符/操作数/算式/结果/主输入框、停掉自动确认与结果后暂停的计时、丢弃未播放的按键/结果语音任务（正在播的句子可播完）、回到 `select`、按新顺序定位第一个空成绩行并写入本机存储。

对话框：一个原生 `<dialog>`，三段式（入口 / 粘贴 / 预览）。打开时 `stopAutoConfirm()`，自动确认的 guard 与物理键盘 keydown 在**任何打开的 dialog** 面前直接返回；确认、取消、Esc、关闭都不得在「未确认」时改动名单/成绩/计算器。确认后焦点回到「导入」按钮，状态行给出导入结果（保留 K 条 / 从第 1 位开始）；解析失败时 `data-error="true"` 并把原因写进 `role="alert"`，停在可重选状态。

回填与编辑：按 `=` 且结果有限时，名单模式未编辑则写 `seq` 最小的空成绩行，已录满则照常显示结果并给出可见的 `名单已录满` 状态、不写名单不新增行；除零/非法/空 `=` 不消耗下一位。名单模式点行内「编辑」复用现有编辑草稿，草稿浮动到视口底部（`position: fixed`、左右 10px、`max-height: calc(100dvh - 20px)`、内部滚动、层级高于名单），被编辑行滚到草稿上方；保存（「保存并完成」或 `=`）原地覆盖该行、不消耗下一位、不新增行、行数/序号/姓名/学号不变；取消恢复快照；编辑中再点另一行不静默切换，状态行提示先保存或取消。无名单模式仍是「关闭」+ 追加新记录。

持久化：键 `cal-phone.roster.v1`；导入、成功 `=`、编辑成功、清除后立即写入；启动时恢复名单/成绩/顺序/`roles`/下一位，计算器回 `select`；读写包 try/catch，失败降级为内存并显示不可关闭提示；坏 JSON/未知 version/缺 `roles`/角色非法/行不合法时忽略整份存储、不覆盖原值，并显示与「不可用」分开的「无法读取」提示。导出：UTF-8 带 BOM、CRLF、RFC 4180，列按 `headers` 原顺序与 `roles` 写回；缺序号最前补 `序号`、缺成绩末尾补 `成绩`；未录为空字符串，已录为 `formatValue(entry.result)`；文件名 `<原名去扩展>-成绩-YYYYMMDD.csv`，空原名用 `名单`，非法字符替换为 `_`；`Blob` + `<a download>`，导出不改变页面/名单/存储。

**可复用的历史实现（仅供参考，不作验收依据）**：旧分支 `roster-import` 的工作树 `/ws/cal_phone-worktrees/roster-import`（提交 `250e966`，归档副本 `/ws/cal_phone/Telos/_worktree-archive/roster-import/roster-import-111913/verified-artifact/index.html`）已有一版按旧规格实现的名单/回填/编辑/导出/存储与 5 个 `roster-*` 场景。它基于旧 `origin/master`（`65e6ccd`），**缺少**当前分支的自动确认/自动等号/结果后暂停/基数快照/退格撤回，也**缺少**本修订版的四角色下拉、粘贴入口、保留/清空单选与 `roles` 持久化；只能作为移植参考，旧证据不能用于本闸。移植后必须以本闸 H1–H11 在当前工作树重新实测。

> 外部前提：无需账号、服务、真实设备或人工授权；全部验收在无头 Chromium（Playwright 1.64.0，已缓存于 `/ws/cal_phone/tests/node_modules`）中完成。语音资源与真实 TTS 不在本闸验收范围；需要验「导入后丢弃未播放语音」时，复用 `tests/voice/run.mjs` 的本地 HTTP + 假引擎模式做观测，不修改该文件、不依赖真实模型。

## 2. 不变约束（父级红线 · 任何修改不得破坏）
> 每条红线**必须标注归属**：`[H#]`（由该硬不变量机检）或 `[soft-only: 原因]`（只能主观把关，写明为何无法机检）。绝对不能改的代码块优先给 sha256 机检形式。不允许留下既非 `[H#]` 也非 `[soft-only]` 的悬空红线。
- 产物仍是单文件、自包含、以 `</html>` 闭合、字节数 ≥1024，不引用 `http(s):` 或协议相对外部 script/link/img/font/@import/url()，不引入依赖、构建步骤或网络请求 [H11]
- 无名单模式完全保持现状：历史最新在上、刷新清空、无序号、编辑后追加新记录且原记录保留、草稿按钮「关闭」、不写 `cal-phone.roster.v1` [H10]
- 导入确认前、取消、Esc 或关闭对话框时，当前名单、成绩与计算器状态完全不变；关闭后若主输入框非空则重新开始自动确认计时 [H4]
- 导入确认后计算器整体归零：无 `data-operator`、算式/结果/主输入框为空、编辑草稿不可见、状态为 `select`、历史清空、自动确认/结果后暂停/未播放语音任务都已清理、从第一个空成绩行开始 [H4]
- 导入对话框打开期间，自动确认的 guard 返回 false，物理键盘的数字/回车/等号不会在背后改计算器或写旧名单 [H4]
- 名单模式按 `=` 只写 `seq` 最小的空成绩行；除零/非法/空 `=` 不消耗下一位；录满时结果照常显示且状态行含 `名单已录满`，不得静默吞掉 [H5]
- 自动确认、自动等号、基数快照、结果后暂停、退格撤回的既有语义不变；自动等号算出的成功结果照常回填并推进下一位，基数不计入自动等号笔数 [H5]
- 名单模式编辑必须原地覆盖：序号/姓名/学号/行位置/总行数不变，不消耗下一位，不新增行；编辑中切换目标被阻止并给出可读提示 [H6]
- 只按学号合并：去首尾空白后的原字符串精确匹配；任一侧存在重复非空学号时「保留」不可用；绝不按姓名/行号猜，也不静默取第一条 [H3]
- 文件里的成绩值永不采用：导入永远从本机 `entry` 出发；保留的是本机成绩，导出文件不能当存档恢复 [H3]
- 列映射与 `roles` 一一对应，四个角色两两不同列，学号/姓名至少一个；确认时写入 `roles`，导出按 `roles` 写回，自定义表头（如 `编号`/`总分`）不会丢角色或重复补列 [H2]
- 持久化键固定 `cal-phone.roster.v1`；刷新恢复名单/成绩/顺序/`roles`/下一位，计算器回 `select`；清除删除该键；localStorage 抛错时降级为内存并显示不可关闭提示；坏数据/未知 version/缺 roles/角色非法时忽略且不覆盖原值 [H7]
- 导出为 UTF-8 带 BOM、CRLF、逗号分隔；列序与 `headers` 一致（缺序号前补、缺成绩后补）；未录成绩为空字符串而非 `0`/`NaN`；已录成绩为 `formatValue`；文件名含原名与本地日期；导出不改变页面或存储 [H8]
- 320×568 与 390×844 下导入入口/粘贴/预览四下拉/导入方式/3 行/50 行名单/编辑浮动草稿均无横向溢出；可见交互控件 ≥44×44 CSS px；输入字号 ≥16px；名单行正文 ≥13px [H9]
- 名单表用列表语义（`role="list"` + 每行 `role="listitem"`）；每行编辑按钮 `aria-label` 含序号与姓名；`下一位` 有可读文字而非只靠颜色；导入对话框为原生 `<dialog>`，Esc 可关，焦点进入可见控件并在关闭后回到打开它的按钮 [H9]
- 既有 18 个套件场景全部 PASS；`tests/scenarios/{core,continuity,edit,layout,determinism}.mjs` 五个文件字节不变 [H10]
- `tests/voice/run.mjs` 字节不变，其失败 check 集合不得超出已记录的基线签名；新增 `roster-*` 场景 ≥6 个且全部 PASS，覆盖 import/fill/edit/export/storage 五类关键词 [H10]
- 页面全流程 `pageerror` 与 console error 为 0；同一导入+映射+保留/清空+录入+编辑序列在两个全新 context 得到相同名单、成绩与导出 CSV [H11]
- 导入首段/预览的文案清楚、清空警告显眼、名单进度与编辑现场的信息层级不误导，窄屏下主次与可操作性良好 [soft-only: 文案清晰度、视觉权重与「首次使用者是否困惑」属像素评审，机检无法判断]

> 允许改动的范围豁免写在下面的定界块里（runner 会把它**逐字**内联进 first / recast / final 验收器的 runtime contract，避免首轮判合规、末轮判违规的判定分裂）。没有豁免就写 `无`。

<<<SCOPE-EXEMPTIONS
允许改动 /ws/cal_phone/index.html 与 /ws/cal_phone/tests/**：可新增 tests/scenarios/roster-*.mjs，在 tests/suite.mjs 中注册新场景，更新 tests/README.md；可新增 §6 规定的 data-testid / data-* 测试钩子（含 roster-row 的 data-name/data-id/data-next、roster-next 的 data-seq、import-summary 的 data-count/data-keep-count/data-drop-count/data-new-count、import-map 的 data-id-index/data-name-index/data-score-index/data-seq-index、import-dialog 的 data-error/data-mode）。可在 tests/lib/selectors.mjs 中追加新选择器，但不得改名或删除既有导出；tests/lib 其它文件只允许不改变既有行为的必要修正。不得修改 tests/scenarios/{core,continuity,edit,layout,determinism}.mjs 的既有断言（五个文件 sha256 已冻结），不得修改 tests/voice/run.mjs（其 sha256 已冻结），不得改动既有 Telos/** 证据、docs/** 规格或其它业务文件。不得引入依赖、构建步骤、网络请求或外部资源。
SCOPE-EXEMPTIONS>>>

---

## 3. 硬目标（独立确定性验收 · 硬闸 · codex exec）

**输入矩阵（采样覆盖；含边界与「哪些算、哪些拒答」）：**
- 编码 ∈ {UTF-8 带 BOM, UTF-8 无 BOM, GBK}；分隔符 ∈ {逗号, 分号, 制表符}；行尾 ∈ {LF, CRLF, 孤立 CR}；引号字段含分隔符/`""`/换行。
- 表头 ∈ {姓名/名字/学生姓名} × {学号/考号/学籍号} × {成绩/分数/得分} × {序号/无序号}；列序打乱；额外列 `班级`/`备注`；多同义列取最左；缺姓名；缺学号；两者都有；表头带首尾空白；重名表头。
- 数据行 ∈ {1, 3, 50}；空行穿插；少列补空；多列忽略；所选学号与姓名都为空的行跳过；首行是数据（会被当表头丢弃）。
- 拒绝 ∈ {0 字节, 只有空行, 表头全空, 不可解码的二进制/含 NUL}；拒绝后当前名单/成绩/计算器与存储不变、可重新选择。
- 列映射 ∈ {默认别名, 自定义 `编号/学生/总分/No.` 全映射, 只映射学号, 只映射姓名, 两者都 `无`, 四角色同列冲突尝试, 映射后 0 人, 改映射实时重算, 成绩/序号 `无` 时导出补列}。
- 导入方式 ∈ {无已录成绩（无方式区）, 可保留数大于零时默认保留, 可保留数为零时仅清空, 无学号列仅清空, 新旧名单任一侧重复学号仅清空, 改名后同号保留, 删除/新增学生, 改映射导致保留不可用自动切清空, 重新选择文件重置默认, 取消/Esc 不变}。
- 计算状态 ∈ {无名单且已有 2 条历史并停在结果态, 无名单空, 名单 3 行全空, 部分已录, 全部录满, 编辑态, 清除二次确认, 自动确认计时中打开对话框}。
- 操作 ∈ {文件导入, 粘贴导入, 成功 `=`, 除零 `=`, 空 `=`, 行内编辑后 `=`, 取消编辑, 清除二次确认, 未录完导出, 导出后重导入}。
- 计算特性 ∈ {自动确认停顿, 自动等号 N=2, 基数 100+, 结果后暂停 1s / 0s, 退格撤回, 名单录满, 语音只在 HTTP+假引擎下观测}。
- 持久化 ∈ {刷新恢复, 清除后刷新, 坏 JSON, 未知 version, 缺 roles, 角色非法, Storage.prototype.getItem/setItem 抛错}。
- 视口 ∈ {320×568 CDP 真机度量, 390×844}；确定性 ∈ {两个全新 context 执行同一导入+映射+保留/清空+录入+编辑序列}。

**稳定测试入口：** 既有 `main.app[data-state]`、`main.app[data-operator]`、`main.app[data-speech-log]`、`main.app[data-speech-played]`、`input[data-testid="calc-input"]`、`#state-label`、`[data-testid="expression"]`、`[data-testid="result"]`、`[data-testid="keypad"] [data-key]`、`[data-testid="op-picker"] button[data-op]`、`[data-testid="history-item"]`、`[data-testid="history-edit"]`、`[data-testid="edit-draft"]`、`[data-testid="operand-input"]`、`[data-testid="operand-remove"]`、`[data-testid="edit-cancel"]`、`[data-testid="settings-*"]`。本闸要求新增/落实的钩子以规格 §6 为准，至少包括：`roster`（`role=list`）、`roster-summary`、`roster-list`、`roster-row`（`data-seq`、`data-filled`、`data-name`、`data-id`，下一行另带 `data-next="true"`）、`roster-score`（已录带 `data-value`）、`roster-expression`、`roster-edit`、`roster-next`（`data-seq`）、`roster-presence`、`roster-import`、`roster-export`、`roster-clear`、`roster-file`、`storage-warning`、`roster-data-warning`、`import-dialog`（`data-error`、`data-mode`）、`import-summary`（`data-count`、`data-keep-count`、`data-drop-count`、`data-new-count`）、`import-map`（`data-id-index`、`data-name-index`、`data-score-index`、`data-seq-index`）、`import-id-column`、`import-name-column`、`import-score-column`、`import-seq-column`、`import-map-note`、`import-columns`、`import-preview`、`import-warning`、`import-mode`、`import-mode-keep`、`import-mode-clear`、`import-select`、`import-paste`、`import-paste-text`、`import-paste-parse`、`import-paste-back`、`import-sample`、`import-confirm`、`import-reselect`、`import-cancel`、`import-error`、`edit-draft-title`、`edit-done`。

**不变量：**

| # | 不变量 | 硬闸怎么验（须真跑，非读源码目测） | 阈值 |
|---|---|---|---|
| H1 | 文件/粘贴 CSV 的编码、分隔符、RFC 4180、表头、行对齐与拒绝 | Playwright 用 `setInputFiles` 喂 8 组可导入 fixture（UTF-8 BOM 逗号、UTF-8 分号列序打乱、GBK 制表符、CRLF、引号含逗号/引号/换行、多同义列、缺学号、缺姓名、少列/多列/空行），每组读 `import-summary[data-count]`、预览文本与确认后的 `roster-row` 属性；再走 `import-paste` → `import-paste-text` → `import-paste-parse` 重复一组；喂 4 组拒绝 fixture（0 字节、仅空行、表头全空、含 NUL 二进制）读 `import-dialog[data-error]`、`import-error`、名单与存储；点 `import-sample` 捕获下载并解析 | 三种编码/三种分隔符的人数、姓名、学号逐项正确；CRLF 与孤立 CR 行尾一致；引号姓名逐字符保留、引号内换行在 extra 中原样保留；多同义列取最左且右侧列进 extra；缺学号/缺姓名可导入；少列补空、多列忽略、空行跳过；粘贴结果与同文本文件导入逐字段一致且 fileName=`粘贴名单`；4 组拒绝均 `data-error="true"`、`import-error` 非空、dialog 仍开、`roster-row` 数 0、`localStorage["cal-phone.roster.v1"]` 不存在；样例以 `EF BB BF` 开头且去 BOM 后 ≥4 行（表头+3 数据） |
| H2 | 四角色列映射、互斥、默认别名、实时重算与 `roles` 持久化 | 导入多列表头 fixture 后读四个 `<select>` 的 `value`、选项文本与 `import-map[data-*-index]`；逐个改选到自定义列，记录 `import-map-note`、`import-columns` 标签、`import-preview` 文本、`import-summary[data-count]`；尝试把同一列选给两个角色；把学号/姓名都设 `无`；改选后再确认并读存储 `roles` 与导出 CSV；刷新后重导同一文件 | 默认值等于别名最左列索引，无别名时为 `""`；选项含 `第 N 列：<表头>` 与 `无`；四个 `data-*-index` 两两不同；`import-columns` 每列文本为角色名或 `保留：<表头>`；改任一映射后人数/前 3 行/列标签/可保留计数在同一次 DOM 更新内改变；学号/姓名都 `无` 时 `import-confirm.disabled=true` 且 `import-map-note` 出现；0 人时同样禁用；确认后存储 `roles` 与所选一致且每角色至多一个；刷新重导后按 `roles` 导出，自定义表头列位不变、无重复补列 |
| H3 | 保留/清空导入的匹配、计数、重复学号与正确落位 | 构造旧名单 A（4 人）并录 2 条不同学号成绩；导入新名单 B（同学号乱序/1 人改名/1 人删除/1 人新增）；读 `import-summary`（`data-count`/`data-keep-count`/`data-drop-count`/`data-new-count`）、`import-mode`、`import-mode-keep/clear`、`import-warning`、`import-confirm` 文本与 `import-dialog[data-mode]`；分别选保留、清空并确认后读 `roster-row` 与存储 `entry`；再构造新旧任一侧重复学号、无学号列、可保留数为零、改映射导致保留不可用、重新选择文件五条路径 | 旧 2 条成绩时保留数 2、丢弃数 0、新增数 1，且保留数+丢弃数等于已录数；默认保留；保留后同学号行 `entry.result`/`expression`/`operands`/`base` 逐字段等于旧值且 `entry.seq` 改为新行号，改名行仍保留，删除行成绩消失，新增行为 `null`；清空后全部 `entry=null` 且存储中无旧成绩；任一侧重复非空学号时 `import-mode-keep` 不存在、`data-mode="clear"`、主按钮为 `清空并开始录入`、警告列出 ≤3 个重复学号且不含 K/D/A；无学号列或可保留数为零时同样只留清空并说明原因；改映射致保留不可用时自动切清空，保留仍可用时保持当前选择；重新选择文件后按新文件可保留性取默认；取消/Esc 后旧名单与 2 条成绩逐字段不变 |
| H4 | 对话框生命周期、自动确认/键盘守卫、确认归零与语音队列清理 | 无名单先算 2 条历史停在结果态；打开导入、预览 3 人，分别走取消、Esc、确认三条路径；在自动确认 0.2s 计时中打开对话框并等待 >1s 再取消；对话框打开时用 `page.keyboard.press` 发数字、Enter、=；用本地 HTTP + 假引擎开启结果播报，队列中放慢速句子后确认导入，等待 ≥2 倍假时长读 `data-speech-log`/`data-speech-played`；读确认后的 `main.app[data-state]`、`data-operator`、输入/算式/结果、`edit-draft`、`history-item`、`roster-*` | 确认后：3 行全 `data-filled="false"`、摘要已录 0、`roster-next[data-seq="1"]`、state=`select`、无 `data-operator`、输入/算式/结果为空、草稿不可见、`history-item`=0、焦点回到打开按钮、状态行含导入结果；取消/Esc：历史仍 2、结果/运算符/算式/输入与导入前逐字段一致、无 `roster`；自动确认计时中打开对话框后等待不产生任何确认或计算，取消后输入仍在且倒计时重新开始；对话框打开时按数字/Enter/= 不改变 state、输入、算式、结果；确认后 `data-speech-played` 的长度不再增长（已在播的句子可留在确认前快照里），旧结果文本不会在确认后开始播放，且无 pageerror |
| H5 | 顺序回填、下一位推进、录满、自动等号、基数与结果后暂停 | 导入 3 人（1 张三 / 2 李四 / 3 王五）；先做除零 `=` 与空 `=`；依次 `+` 10、20 `=`、`+` 3、4 `=`、`+` 5、6 `=`、再 `+` 1、1 `=`；每次读三行 `data-filled`、`roster-score[data-value]`、`roster-expression`、`roster-next[data-seq]`、摘要与 `#state-label`；设置自动等号 N=2 后重复一组 3 人；开启基数 100 做 `+` 10 `=`；设置结果后暂停 1s 与 0s 各做一次 `=` 后立即按数字 | 除零/空 `=` 后已录 0、下一位 1；三次成功依次写 seq 1/2/3，分数 30/7/11 且姓名对应，下一位 2→3→不存在；第 4 次结果区显示 2 但名单仍 3 行、三条成绩不变、无新行、状态行含 `名单已录满`；自动等号 N=2 时 `10`、`20` 后自动计算并回填 seq1、下一位 2；基数 100 时结果 110、名单与导出都是 110、条目 `base.display="100"`；结果后暂停 1s 时立即按数字被忽略（结果/名单不变），≥1.2s 后可输入；暂停 0s 时立即输入生效；暂停期间状态行仍显示已记录 |
| H6 | 原地编辑、浮动草稿、切换保护、焦点与持久化 | 3 人录满后编辑第 2 行，改一个操作数后 `=`；快照第 1/3 行全字段与行数；刷新再读；5 人只录 2 条时编辑第 1 行；3 人编辑第 2 行时点第 3 行编辑；50 人录满后滚到末行点编辑；分别读 `edit-draft` 的 rect/position/z-index、`edit-draft-title`、`edit-done`、`edit-cancel`、`document.activeElement`、页面底部 padding | 编辑保存后第 2 行 seq/name/id/行位置/行数不变，score 由 10 变 8 且算式含 7；第 1/3 行逐字段不变；刷新后仍为 8；下一位始终不存在；5 人场景编辑后 `roster-next[data-seq="3"]`、已录仍 2；编辑中再点另一行时 state/草稿/第 2 行都不变且状态行含 `先保存或取消`，取消后第 3 行可编辑；50 人末行点击后 `edit-draft` 为 `position: fixed`、左右各 10px、rect 完整落在视口内、被编辑行 bottom ≤ 草稿 top；保存/取消后草稿回到非 fixed 原位、底部 padding 移除、焦点回到该行 `roster-edit`；取消后行内容逐字段不变；无名单模式编辑仍追加且草稿按钮为 `关闭` |
| H7 | 存储对象、刷新恢复、清除、不可用与坏数据降级 | 导入 3 人录 2 条后立即读并 JSON.parse `localStorage["cal-phone.roster.v1"]`；`page.reload()` 后重读页面；点 `roster-clear` 接受二次确认后读存储/名单/历史并 reload；用 `addInitScript` 让 `Storage.prototype.getItem/setItem` 抛错后导入并录 1 条；分别预置坏 JSON、`{"version":99}`、缺 `roles`、非法 role、非法 row 后打开页面读存储原文与提示 | 对象含 `version=1`、`fileName`、`headers`、等长 `roles`（仅 `seq/id/name/score/extra`，每角色至多一个）、`rows.length=3`、`rows[0].entry=null`、`rows[1].entry` 的 `seq/operator/operands/base/expression/result` 与页面一致、`extra` 长度等于 extra 列数、seq 为 1..3；reload 后 3 行、2 条已录、分数/顺序/roles/下一位不变、state=`select` 且输入/算式/结果为空、状态行含 `名单已恢复`；清除后键不存在、名单区消失、无名单历史为空、reload 仍无名单；storage 抛错时无 pageerror、仍可录入、`storage-warning` 文本为 `本机存储不可用，刷新会丢失成绩。`；坏数据五种均无名单、无 pageerror、存储原文逐字未变、`roster-data-warning` 文本为 `本机名单数据无法读取，已忽略；原数据未覆盖。` |
| H8 | 导出 CSV 的字节、列映射、补列、转义、文件名与无副作用 | 导入 fixture A（表头 `序号,学号,姓名,成绩,班级`）录 2 条后点 `roster-export`，用 `page.waitForEvent("download")` 读文件名与字节；再分别导入缺序号、缺成绩、`姓名,名字,学号` 同义列、自定义 `编号,学生,总分` 全映射、引号姓名、未映射成绩列等 fixture 后导出；导出后读页面/存储快照；把导出文件重新当名单导入 | 字节前 3 字节 `EF BB BF`、行尾全为 CRLF、表头与三行数据内容精确匹配、未录为空字符串、已录为 `formatValue`；缺序号时首列为 `序号`、缺成绩时末列为 `成绩`；自定义表头按 `roles` 写回原列且不重复补列；文件里未映射为 score 的成绩列原值保留并另补 `成绩`；引号/逗号/换行按 RFC 4180 可被自身重新导入还原；文件名为 `<原名去扩展>-成绩-YYYYMMDD.csv`，日期等于导出时本地日期，非法字符替换为 `_`，空原名用 `名单`；导出前后 roster/存储/计算器状态逐字段不变、状态行含 `已导出 N 人（M 条成绩）`；重导入人数/姓名/学号一致且全部 `data-filled="false"` |
| H9 | 320/390 布局、触控、字号、焦点与可达性 | 390×844 与 320×568（CDP `Emulation.setDeviceMetricsOverride`）分别构造：导入首段、粘贴段、预览（四下拉+导入方式）、3 行混合名单、50 行名单、编辑浮动草稿；逐态读 document/body/dialog 溢出、可见 `input/button` rect 与字号、名单行字号、四个下拉的排列、`roster` 与行的语义、`roster-edit` 的 aria-label、`roster-next` 文本、工具栏 rect、打开 dialog 的 tag/open/:modal/activeElement、Esc 后焦点 | 每态横向溢出 ≤1px；可见控件宽高 ≥43.5；可见输入字号 ≥15.5；名单正文与成绩/算式字号 ≥12.5；320 下四个下拉纵向排列（同 top 不出现两个 select）、工具栏可换行且不溢出；`roster` 匹配 `[role=list],ul` 且每行匹配 `li,[role=listitem],article,tr`；第 3 行编辑按钮 `aria-label` 同时含 `编辑第 3 位` 与 `李四`，无姓名时只含 `编辑第 3 位`；`roster-next` 文本含 `下一位`；dialog 为 `DIALOG` 且 `:modal`、activeElement 是 dialog 内可见控件、Esc 后关闭且焦点回到打开它的按钮；浮动草稿左右各 10px、max-height ≤ `100dvh - 20px`、内部可滚动、被编辑行在草稿上方 |
| H10 | 既有套件回归、冻结字节、语音基线签名与新增场景 | 对五个既有场景文件与 `tests/voice/run.mjs` 计算 sha256；用 `node tests/suite.mjs --json` 跑全量并按 18 个既有 id 过滤；用 `--list` 读 `roster-` 前缀 id，再 `--only <roster ids>` 跑新场景；用 `node tests/voice/run.mjs --json` 跑语音套件（最多 2 次，取失败更少的一次） | 六个冻结文件 sha256 分别精确等于本文件附录列出的 64hex；18 个既有场景全部 `pass=true`；新增 `roster-` 前缀场景 ≥6 个，id 至少覆盖 import、fill、edit、export、storage 五类关键词，且 `--only` 全部 `pass=true`；语音套件失败 check 集合 ⊆ {result.crash, queue.quick-no-result, queue.quick-keys} 且失败数 ≤3，其余 check 全 PASS |
| H11 | 自包含、零页面错误与确定性 | Node 读产物文本统计 `</html>`、字节数与外链；汇总 H1–H10 全部页面的 `pageerror` 与 console error；两个全新 context 各自导入同一 3 人 CSV、映射同一 `roles`、录 2 条、编辑第 1 行并 `=`，序列化全部 `roster-row` 属性、存储 JSON 与导出 CSV 文本后深度比对 | `</html>` 存在、字节 ≥1024、外链计数 0；pageerror 总数 0、console error 总数 0；两个 context 的 rows（含 entry 全字段）、`roles` 与导出 CSV 文本完全一致 |

<<<HARD-VERIFY-PROMPT
你是确定性验收器。**不要评价 UI 美观、不要改产物源码。**本 prompt 会被单独抽取喂给你（读不到 frontmatter 与上表），所以下面所有文件都写**绝对路径**、基线写 **sha256 值**；runner 会在其后追加 `[RUNTIME CONTRACT]`（round / phase / gate_dir / evidence_dir / out_dir / artifact_sha256 / expected_review_states / SCOPE-EXEMPTIONS 原文），以它为准。
按本闸输入矩阵 / 不变量逐条**实际执行**验证：优先复用已有测试入口，逻辑用 Node 调用函数并断言返回值/异常；界面用 Playwright 操控稳定选择器并读值。基线只用于本任务明确要求不可更改的范围，不能自行冻结整个源码或妨碍授权修复。采用项目已有工具与依赖；缺依赖或设备时明确拒答，不能伪装成代码 FAIL。禁止用主观语言或肉眼通读代替实测证据。
量具卫生（三条，写量具时逐条自查）：① 不得含写死的恒 FAIL/恒 PASS 常量判据；② 扫描类不变量的扫描面必须与 §3 声明逐字一致、不得自行扩张，且**不得包含 evidence/ 或 evidence/runs/**（自引用扫描面一旦被本循环必写的证据污染就永远翻不了绿）；③ 断言锚定稳定选择器/数据钩子而非用户可见文案原文（软闸可能正当地要求改文案）；子进程/步骤超时 ≥ 单次实测耗时的 2 倍。
量具接口（两条，runner 靠它做变异检查与尝试隔离，缺一即拒绝提升）：① 环境变量 `KEKKAI_ARTIFACT` 存在时用它覆盖目标文件路径；② `KEKKAI_OUT_DIR` 存在时，`hard-r<N>.txt` / `render-r<N>.txt` / `manifest-r<N>.json` / `review-shots/r<N>/` 全部写到该目录下，而不是 evidence/runs（所有路径以脚本自身所在目录解析、不依赖 cwd）。
目标文件（绝对路径）：/ws/cal_phone/index.html
本闸具体：复用 `/ws/cal_phone/tests/lib/browser.mjs` 的 `launchBrowser`/`openApp` 与 `/ws/cal_phone/tests/lib/dom.mjs` 的既有辅助；Playwright 已缓存在 `/ws/cal_phone/tests/node_modules`，在导入任何测试库**之前**设置 `process.env.PLAYWRIGHT_MODULE="/ws/cal_phone/tests/node_modules/playwright"`（或 `NODE_PATH=/ws/cal_phone/tests/node_modules` 并用 `createRequire('/ws/cal_phone/tests/package.json')`）。所有页面收集 `pageerror` 与 console error，最后汇总为 0。数值容差 1e-9，布局容差 0.5px；320px 必须 `const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setDeviceMetricsOverride',{width:320,height:568,deviceScaleFactor:2,mobile:true});` 后再导航。屏幕键用 `locator.click()`，编辑操作数用 `locator.fill()`；文件导入用 `locator.setInputFiles()`（隐藏 input 也可用）；下载用 `page.waitForEvent("download")` 读 `suggestedFilename()` 与字节，若 `file://` 下不触发，则在导航前注入钩子捕获 `URL.createObjectURL` 的 Blob 文本并同时断言锚点 `download` 属性。fixture 写在 `KEKKAI_OUT_DIR`（缺省时写系统临时目录下的新目录），GBK 用 `iconv -f UTF-8 -t GBK` 或 `python3 -c "import sys;sys.stdout.buffer.write(open(sys.argv[1],'rb').read().decode('utf-8').encode('gbk'))" <src> <dst>` 生成，不要污染仓库。等待一律用 `page.waitForFunction` 轮询稳定选择器状态，不要用固定 sleep（滚动/焦点落定可等 100–200ms）。点击屏幕键必须用 `locator.click()`，不得直接写 `input.value`；物理键盘用 `page.keyboard.press()`。

逐条验法：
- H1：写可导入 fixture：A（UTF-8 BOM，逗号，`序号,学号,姓名,成绩,班级`，CRLF，3 人）`1,20230101,张三,85,高一3班` / `2,20230102,李四,92,高一3班` / `3,20230103,王五,78,高一3班`；B（UTF-8 无 BOM，分号，`学号;名字;班级`，列序打乱）2 人；C（GBK，制表符，`考号\t姓名\t得分`）2 人；D（孤立 CR）2 人；E（引号含逗号/引号，`"张,三"` 与 `"李""四"`）；F（多同义列 `姓名,名字,学号`，断言姓名取左列且 `名字` 进 extra）；G（缺学号）；H（缺姓名）；I（少列/多列/空行穿插）。每组全新 context：点 `[data-testid="roster-import"]`，`setInputFiles` 到 `input[data-testid="roster-file"]`，等 `[data-testid="import-summary"][data-count]`，读预览，点 `import-confirm`，读 `[data-testid="roster-row"]` 的 `data-seq/data-name/data-id/data-filled`。粘贴组：全新页点导入 → `import-paste` → `import-paste-text.fill(同一文本)` → `import-paste-parse` → 读预览并确认。拒绝组：0 字节、仅 `\n\n`、表头 `,,,\n,,,`、字节 `0xFF 0xFE 0x00 0x01 0xFF`；每组断言 `[data-testid="import-dialog"][data-error="true"]`、`[data-testid="import-error"]` 非空、`roster-row` 数 0、`localStorage.getItem("cal-phone.roster.v1")` 为 null。样例：全新页点 `import-sample`，读下载字节以 `EF BB BF` 开头且去 BOM 后 ≥4 行。
- H2：用表头 `编号,学生,班级,总分,考号,No.` 的 3 人 fixture。读默认四个 select 的 `value` 与 `import-map[data-id-index]/[data-name-index]/[data-score-index]/[data-seq-index]`；依次把学号选 `考号`、姓名选 `学生`、成绩选 `总分`、序号选 `No.`，每步读 `import-summary[data-count]`、`import-columns` 文本、`import-preview` 前 3 行；尝试把学号列改成姓名已用的列（断言另一个角色不会被静默改掉，或该选项不可选）；把学号和姓名都选 `""`（断言 `import-confirm.disabled` 且 `import-map-note` 存在）；确认后读存储 `roles` 与导出 CSV；刷新后重导同一文件并再次导出。
- H3：先导入 4 人 fixture A2（`学号,姓名`：20230101 张三 / 20230102 李四 / 20230103 王五 / 20230104 赵六），录 20230101 与 20230102 两条成绩；再导入新名单 B2（`学号,姓名`：20230104 赵六 / 20230102 李四改名 / 20230101 张三 / 20230105 钱七）。读 `import-summary` 的 K/D/A 与 `import-mode` 默认选中；选保留并确认，读每行 score 与存储 `entry`（断言 20230101/20230102 保留、20230104 的旧成绩丢弃、20230105 为空、名额/顺序按 B2）。另起 context 走清空并断言全部为空。重复学号路径：旧名单含两个 20230101（可用 localStorage 预置合法 v1 对象）或新名单含两个相同非空学号；断言 `import-mode-keep` 不存在、`data-mode="clear"`、`import-confirm` 文本为 `清空并开始录入`、`import-warning` 列出 ≤3 个重复学号。无学号列：映射学号为 `无` 后断言只留清空；可保留数为零：导入与旧名单无交集的新名单后断言只留清空并说明。改映射：先选保留，再把学号列改成会导致重复/无匹配的列，断言自动切清空；若保留仍可用则保持保留。重新选择文件：在预览点 `import-reselect` 换一个可保留/不可保留的文件，断言默认选择随新文件。取消/Esc 后断言旧名单与 2 条成绩逐字段不变。
- H4：无名单 context：`+` 12 回车 30 回车 8 回车 `=`（50），再 `*` 2 回车 3 回车 4 回车 `=`（24），停在结果态并记下运算符/算式/结果/输入。打开导入 → fixture A → 预览 → `import-confirm`，断言阈值。取消/Esc：另开 context 重做 2 条历史，打开导入预览 A 后分别点 `import-cancel` 与按 `Escape`，断言状态逐项不变且无 `roster`。自动确认：用 `localStorage["cal-phone.settings.v1"]={"autoConfirm":0.2}` 预置后打开，输入 `1` 等 `[data-testid="auto-confirm-feedback"][data-active="true"]`，立即打开导入并等待 1200ms，断言没有产生计算/名单；取消后断言输入仍为 `1` 且倒计时重新出现。键盘守卫：dialog 打开时依次 `page.keyboard.press("5")`、`"Enter"`、`"="`，断言 state/输入/算式/结果与打开前一致。语音：参考 `/ws/cal_phone/tests/voice/run.mjs` 的本地 HTTP 服务与假引擎注入方式（不要修改该文件），预置 `voiceResult=true`、假引擎时长 2500ms，先按几次屏幕键让队列非空，记录 `main.app[data-speech-played]` 长度，随后打开导入并确认，等待 6000ms，断言 `data-speech-played` 长度不再增长且无 pageerror；正在播的那一句允许留在确认前的快照里。
- H5：导入 fixture A 的 3 人；`5` `/` `0` `=` 与空 `=` 后读名单；依次 `+` 10 回车 20 回车 `=`、`+` 3 回车 4 回车 `=`、`+` 5 回车 6 回车 `=`；每次等 `roster-row[data-filled="true"]` 数增加再读三行 score/expression/`roster-next`、摘要与 `#state-label`；最后 `+` 1 回车 1 回车 `=`。自动等号：预置 `{"autoEquals":2}` 后导入 3 人，`+` 10 回车 20 回车，等回填 seq1 并读下一位。基数：预置 `{"baseEnabled":true,"baseValue":"100"}` 做 `+` 10 `=`，读 score/存储/导出。暂停：预置 `{"resultPause":1}` 与 `{"resultPause":0}` 各一次，在 `=` 后立即按数字键并读结果/名单；暂停期间再等 1200ms 补按一次。
- H6：导入 A 录满（`+` 12 30 8 `=`、`+` 9 1 `=`、`+` 5 5 `=`），快照第 1/3 行；点 `[data-testid="roster-row"][data-seq="2"] [data-testid="roster-edit"]`，读 `edit-draft-title` 与 `#state-label`，把第二个 `operand-input` 从 1 改成 7 后 `=`；读三行与行数；`page.reload()` 后重读第 2 行。5 人部分名单：导入 5 人、录 2 条、编辑第 1 行后读 `roster-next[data-seq]`。切换保护：3 人编辑第 2 行时点第 3 行 `roster-edit`，读 state/草稿/第 2 行与 `#state-label`；点 `edit-cancel` 后再点第 3 行。50 人：生成 50 行 fixture，循环 `+` 10 回车 10 回车 `=` 录满；`scrollIntoView` 末行后点编辑，读 `edit-draft` 的 `getBoundingClientRect()`、`getComputedStyle().position`、左右偏移、`maxHeight`、名单末行 rect；点 `edit-done` 与 `edit-cancel` 后分别读焦点与草稿 position/padding。
- H7：导入 A 录 2 条，立即读并 JSON.parse `localStorage["cal-phone.roster.v1"]`，逐字段断言；reload 后读名单/成绩/`roster-next`/state/输入/算式/结果；清除：点 `roster-clear`，若出现 `page.on("dialog")` 则 accept，若出现 `[data-testid="roster-clear-confirm"]` 则 click；断言键删除、`roster` 消失、`history-item`=0、state=`select`，reload 后仍无名单。storage 抛错：`context.addInitScript(() => { Storage.prototype.getItem = () => { throw new Error("blocked") }; Storage.prototype.setItem = () => { throw new Error("blocked") }; })`，打开后导入 A 并录 1 条，断言 score 在内存生效、`[data-testid="storage-warning"]` 可见且文本精确、pageerror=0。坏数据：分别 `addInitScript` 预置 `"{bad"`、`{"version":99}`、缺少 `roles`、`roles` 含 `"foo"`、`rows` 含非法 `entry` 的合法 JSON 字符串，打开后断言无 roster、pageerror=0、原键值逐字未变、`[data-testid="roster-data-warning"]` 可见且文本精确。
- H8：导入 A 录 2 条（50、10），点 `[data-testid="roster-export"]` 捕获下载读文件名/字节；断言 BOM/CRLF/表头/三行内容；文件名日期等于验收时刻本地日期、前缀为原文件名去扩展。再分别导入缺序号、缺成绩、同义列、自定义 `编号,学生,总分` 全映射、未映射成绩列、引号姓名 fixture，各导出一次并断言补列/写回/保留/转义。导出前后读 roster 快照、存储原文、计算器状态，断言不变；把 A 的导出文件保存后在新 context 当名单导入，断言人数/姓名/学号一致且全部 `data-filled="false"`。
- H9：390×844 与 320×568 各构造 6 态（入口、粘贴、预览、3 行混合、50 行、编辑态）。每态读 `documentElement.scrollWidth-clientWidth`、`body.scrollWidth-clientWidth` 与 dialog 内滚动容器的溢出；遍历可见 `input,button`（排除 disabled 且 `getClientRects().length=0`）读 rect 与 `getComputedStyle().fontSize`；读 `roster-row`/`roster-score`/`roster-expression` 字号；读四个 select 的 rect 判断 320 下是否纵向；读 `[data-testid="roster"]` 的 tag/role 与每行 tag/role；读第 3 行 `roster-edit` 的 aria-label；读 `roster-next` 文本；读 `roster-import`/`roster-export`/`roster-clear` 的 rect 是否溢出；打开 dialog 读 tagName/open/matches(':modal')/activeElement，Esc 后读 open 与 activeElement。编辑态用 5 人名单录 3 条后点第 2 行编辑。
- H10：用 `sha256sum` 对照六个冻结文件的完整 64hex：core.mjs=`2b35cce880e336882e384e940d28b103acc270a7931552dea5d5c9c79c9eeb7e`，continuity.mjs=`d53f1a4ce357bb200a4e811aa45d3dad187d40279c5f747c7ebb38c28e810a56`，edit.mjs=`f61188e63586e8afa2883f6db3d3e88f7cc216a9a0c8dc7d465953ad37ceadc1`，layout.mjs=`c96ed96499a18b9731a8e10dabb579a761d445534105caabfa7424803def65a0`，determinism.mjs=`64bc09c49ac56c21aef77bdd1a7f7c365b8791d0690076f5964b58f06e69ddff`，tests/voice/run.mjs=`dcc96cc884f469fa18b5defd486adc30250c5ae24d9b7f58630d16d485d11733`；`PLAYWRIGHT_MODULE=/ws/cal_phone/tests/node_modules/playwright node /ws/cal_phone/tests/suite.mjs --json`，解析 `results`，断言 18 个既有 id 全 `pass=true`；`--list` 过滤 `roster-` 前缀，断言 ≥6 且 id 覆盖 import/fill/edit/export/storage 五类关键词；`--only <逗号分隔>` 跑这些 id，全部 `pass=true`。`PLAYWRIGHT_MODULE=/ws/cal_phone/tests/node_modules/playwright node /ws/cal_phone/tests/voice/run.mjs --json`，最多跑 2 次，取失败更少的一次，断言失败 check 集合 ⊆ 基线三 id 且失败数 ≤3。
- H11：Node 读目标文件文本，断言 `</html>`、字节数、用正则统计 `<script src>`/`<link href>`/`<img src>`/`<source src>`/`@import`/`url(...)` 中 `^(https?:)?//` 为 0；汇总全部页面 `pageErrors`/`consoleErrors` 为 0；两个全新 context 各导入 A、映射同一 `roles`、`+` 12 30 8 `=`、`+` 9 1 `=`、编辑第 1 行改一个操作数后 `=`，序列化 `roster-row` 的 `{data-seq,data-name,data-id,data-filled,score,expression}`、存储 JSON 与导出 CSV 文本，深度比对。
phase=first 时把验证逻辑写成脚本 `/ws/cal_phone/Telos/roster-import-v2-112203/evidence/verify.mjs`（接受轮号参数）并立即以 `node verify.mjs <round>` 运行；它按上面不变量逐条实测并写 `hard-r<N>.txt`：先写 `ROUND: <N>`、`ARTIFACT_SHA256: <64hex>`、`VERIFIER_SHA256: <64hex>`（脚本自身 sha256），再每条 `H<id> PASS|FAIL — 实测值/证据`，末行**严格** `HARD: PASS` 或 `HARD: FAIL (Hx,…)`。
若 runtime contract 的 `expected_review_states` 非 none：同一脚本还须把每个状态用 Playwright 渲染成**非空、非纯色、内容互不重复**的 PNG（≥ 240×160；真 320px 用 CDP `Emulation.setDeviceMetricsOverride`）落 `review-shots/r<N>/S<k>.png`——精确且仅这些文件；把带同样头的可见性/溢出/关键尺寸 `key=value` 实测写 `render-r<N>.txt`；写 `manifest-r<N>.json`：顶层字段 `round`、`artifact_sha256`、`verifier_sha256`、`metrics_sha256`，以及**顶层 `shots` 数组**（不是 `images`）逐项 `{file:'S<k>.png', sha256, width, height}`，另有 `adhoc: []`。四态：S1 全新页 390×844 点 `roster-import`（入口段）；S2 390×844 先导入 4 人名单并录 2 条，点工具条 `导入`，选择 3 人自定义表头 fixture（`编号,学生,班级,总分`），把学号/姓名/成绩分别映射到 `编号/学生/总分`，使预览同时出现四下拉、列标签、前 3 行、导入方式（默认保留）与 K/D/A；S3 390×844 导入 5 人名单并录 2 条（`+` 12 30 8 `=`、`+` 9 1 `=`），滚动到名单区使摘要、已录 2 行、下一位第 3 行与工具条同屏；S4 320×568（CDP）导入 5 人名单、录 3 条后点第 2 行编辑，使编辑草稿与该行同时在视口内。每态截图前等待布局稳定；S2/S3/S4 不启动自动确认计时。
phase=final 时**禁止读取、运行或修改 verify.mjs / ledger / 旧证据**，在你被启动的隔离 scratch cwd 中重新推导全套检查；临时测量只落当前 scratch 目录，最终回复给出裁决，由 CLI 保存（不要自行写 `-o` 路径）；首行同样是 `ROUND:`、`ARTIFACT_SHA256:`，末行同样严格。
**最终回复格式（本闸硬要求）**：最终回复就是裁决本身，每个不变量从第 0 列开始单独一行写作 `H<id> PASS — 实测值/证据` 或 `H<id> FAIL — 实测值/证据`；不要用 Markdown 列表符号、不要加解释性段落、不要在 H 行前后叙述；内容与你写入的 `hard-r<N>.txt` 逐字一致（runner 头可省略，由 runner 盖章）。若只返回叙述或空 H 集合，runner 会把它判为机械失败。
HARD-VERIFY-PROMPT>>>

---

## 4. 软目标（独立像素评审 · 软闸 · agy -p Gemini 3.8 Flash (High)）
**维度：** 易懂性、信息层级、导入决策的清晰度、名单进度的可读性、窄屏排布与编辑现场的可理解性

**代表性状态：** 逐个走查（**枚举写在下方 SOFT-REVIEW-PROMPT 内**，随 prompt 一并抽取，保证自足）。产物没有 URL 查询参数路由，因此每态给「到达该态的操作步骤」；截图由 §3 的量具渲染，评审只看副本像素 + 内联指标，永不看源码。

<<<SOFT-REVIEW-PROMPT
你是资深「用户界面 UI 评审官」。只评审、不改文件、不贴整页代码。运行时会追加真实 round/hash 与隔离目录内的该轮 PNG 清单；用可用的图像查看工具逐张看**真实像素**、以首次使用者视角通读。**你自身不起浏览器、不渲染；禁止搜索/读取业务源码、`ledger.md`、目标仓库规则或任何旧轮评审。**若本轮附图/指标不完整，输出 `EVIDENCE_INCOMPLETE` 并停止，绝不拿旧图或源码顶替。
**只看用户可见呈现是否清楚/好懂/好用；不判计算、导入解析、合并规则或导出正误（那是硬闸职责）。**
**运行时会把本轮机检指标原文内联进 prompt**（关键选择器的可见性/溢出/关键尺寸实测）：你的判断**不得与之矛盾**——若指标显示某元素 visible / 可滚动 / 无溢出，就不得断言它不可见/不可滚动/破版（截图 + 指标都对不上的判断＝幻觉，会被台账记为「评审误报」驳回）。
再依次走查以下代表性状态各一遍（每态对应本轮一张附图 `S<k>.png`）：
S1 | 导入首段（390×844）：全新页点「导入名单」；看格式说明、`下载样例名单`、`选择文件`、`粘贴名单`、`取消` 的层级，首次使用者能否一眼知道要准备什么文件、主操作是哪个。
S2 | 导入预览与导入方式（390×844）：先导入 4 人名单并录 2 条，点工具条「导入」，选择 3 人自定义表头 CSV，把 `编号/学生/总分` 映射为学号/姓名/成绩；看 `识别到 3 人`、四个列映射下拉、列标签、前 3 行、`保留同学号成绩（K 条）/清空重录（M 条）` 的取舍与清空警告是否显眼、主按钮 `保留成绩并开始录入` 是否与选择一致，用户会不会误触破坏性操作。
S3 | 名单录入中（390×844）：导入 5 人名单，录 2 条；看已录行的算式+成绩是否可查、未录行的 `—` 占位、第 3 行「下一位」高亮与文字标签、摘要行 `已录 2 · 下一位 3`、输入框下方 `下一位 … · 按 = 记入成绩` 是否让人知道该录谁；工具条 `导入/导出/清除` 是否可辨。
S4 | 窄屏编辑态（320×568，CDP）：导入 5 人名单、录 3 条，点第 2 行「编辑」；看两行卡片、序号/姓名/学号/成绩是否仍可读、浮动草稿与被编辑行是否同屏可确认、`正在编辑 3 李四`、`保存并完成/取消` 是否清楚、44px 触控目标是否拥挤、是否出现横向溢出或错位。
评审重点：首次使用者能否不读说明就理解「导入 → 选列 → 选保留/清空 → 从第 1 位开始 → 录满 → 导出」？清空警告会不会被当成普通提示而忽略？「下一位」是否只在颜色上区分、还是文字也说得清？已录行的算式会不会太抢眼、未录行的 `—` 会不会被误认为成绩？四个下拉在 320px 下是否挤到看不清？320px 编辑时还知道自己改的是哪一位吗？
先原样回显三行绑定头：`ROUND: <N>`、`ARTIFACT_SHA256: <64hex>`、`MANIFEST_SHA256: <64hex>`。
## P0 严重：每条严格一行 `P0-R<N>-<两位序号> | 区域 | 问题 | 为什么影响理解 | 建议修法`
## P1 重要：每条严格一行 `P1-R<N>-<两位序号> | 区域 | 问题 | 为什么 | 建议修法`
## P2 轻微（可选，不凑数）：同格式 `P2-R<N>-<两位序号> | …`
序号在每个级别内从 01 连续递增；末行计数必须与上面结构化 finding 行数完全一致。
末行：`P0=x P1=y P2=z`。
SOFT-REVIEW-PROMPT>>>

**P0 定义（硬性必修）：** 导入首段/预览的关键操作（选择文件、粘贴、开始录入、取消）被挤压或遮挡到无法辨认；清空成绩的警告或「保留/清空」取舍在预览中不可见，用户会在不知情下覆盖成绩；名单里看不出谁是「下一位」（只剩颜色、没有可读文字）；320px 下四个下拉、名单行或编辑草稿横向溢出导致姓名/成绩/编辑按钮不可读；编辑态无法确认自己正在改哪一位。计算错误、导入解析失败、合并错误、存储失败与测试断言失败属于硬闸，不得在这里重复判为 P0。

---

## 5. 运行与停止（命令按需选用，非逐行执行的脚本；停止数字只在 frontmatter）
    # gate=/ws/cal_phone/Telos/roster-import-v2-112203 · rendered by kekkai new — do not edit
    kekkai doctor --gate "/ws/cal_phone/Telos/roster-import-v2-112203" --host     # before round 1 and after any host change
    kekkai hard "/ws/cal_phone/Telos/roster-import-v2-112203"                     # r1: independent author writes evidence/verify.mjs; later rounds replay it
    kekkai soft "/ws/cal_phone/Telos/roster-import-v2-112203"                     # only after a hard PASS: fresh AGY review over copied pixels
    kekkai adhoc "/ws/cal_phone/Telos/roster-import-v2-112203" -- <command…>      # same-round measurement admissible as 误报 basis
    kekkai recast "/ws/cal_phone/Telos/roster-import-v2-112203" --reason "<why>"  # sick instrument: quarantine + fresh independent author (≤3 eras)
    kekkai hard "/ws/cal_phone/Telos/roster-import-v2-112203" --final             # terminal independent stamp at the stop candidate
    kekkai lint "/ws/cal_phone/Telos/roster-import-v2-112203" --post              # after round 1, on recovery, before STOP
    kekkai close "/ws/cal_phone/Telos/roster-import-v2-112203" --by <budget|host|instrument|oscillation|human> --blocker "<one sentence>"

- **轮次 = runner 提升进 `evidence/runs/hard-r<N>.txt` 的 canonical 盖章**；其余一切都是尝试（`evidence/attempts/`），不写台账、不占预算、不动 K。轮号由 runner 分配，不要手填；不要手跑 `node verify.mjs` 再拷文件进 runs/（缺 runner 头会被拒绝）。
- **`kekkai hard` 退出码**：`0` 提升为轮；`2` 尝试已归档（先读 `kekkai status --json` 和消息：若该轮已提升但 final 缺失，补 `--final`；否则修因后继续，不盲重跑）；`3` 重复/尝试上限——只有三条合法路：(1) change the business tree, (2) `kekkai recast --reason`, (3) `kekkai close --by <tag>`；`4` 规则拒绝（读消息，别原样重试）。管道故障同一输入有重试上限；无法修复就 `close`，不换措辞/增预算绕过。
- **软闸只在该轮 hard PASS 后有资格发言**；硬闸通过后修复主观 P1 要当轮记录取舍，后续同主张不翻案；不为纯偏好/P2制造新工作。每条 P0/P1 在 ledger「软闸 finding 处置」恰好一行（有效｜台账命中｜误报），派生数由处置行计算；命中按主张不按措辞，当轮拍板次轮生效；合法 verdict 前发现真实缺口时软闸列写 `—: <原因>`。
- **首个 hard PASS 轮 runner 自动跑审计 final**；final 与量具不一致 ⇒ final 的 FAIL 成立，只能修代码或 `kekkai recast`，永不再跑一次 final 试运气。
- **停止**：`converged` = 最新轮 hard PASS + 去重后 P0=0 + 连续 K 轮（K 为 CREED 常量）无台账外新增 P1 + 同 era 的独立 final PASS，且未超 frontmatter `max_rounds`；任何轮数（含 0）都可以 `kekkai close --by <budget|host|instrument|oscillation|human>` 写 blocked 终态并附 `blocker:` 行——绝不把 gate 停在 in-loop 而无 STOP。
- 第 1 轮后、恢复时、写 STOP 前各跑一次 `kekkai lint <本目录> --post`；`POST-IN-PROGRESS` 是运行中的预期警告。

---

## 附录 · 生成器判断记录（可审计的 taste↔structure 边界）
> 让执行者能看懂哪些是「结构强制」、哪些是「生成器的 taste 取舍」。不要复述停止数字（它们只在 frontmatter）。
- **工作树与基线**：本闸绑定主 checkout `/ws/cal_phone`（分支 `score-tally-settings`，生成时 `HEAD=c86d40a`）。生成时 `index.html` sha256 为 `a275e40bf0e85ec0e86bc8bda88bee15a5bde4048677594d113e1c4a31371a14`，已包含自动确认/自动等号/结果后暂停/基数/退格/语音只念结果；这是本闸必须保留的行为基线。规格文件 `/ws/cal_phone/docs/superpowers/specs/2026-11-19-roster-import-design.md` 当前为 2026-11-22 修订版且工作树有未提交改动，产品真值以磁盘上的该版本为准。
- **模型 profile**：新闸默认冻结 `astra-flash-3.8-v1`，但本机 codex provider（`127.0.0.1:15721`）只暴露 `muse-spark-1.3-contributor` 与 `deepseek-v4.1-flash`，不提供 `gpt-6-astra`；按宿主约束在首轮前显式改为 opt-in 的 `muse-spark-1.3-v1`。执行中不得再改 profile；也不得把不同模型别名成 pin 名。`agy` 当前不在 PATH，runner 会在准入后走协议允许的一次性 Codex 软闸回退。
- **全量改动，无 sha256 引擎基线**：名单功能横跨整份单文件应用，冻结脚本块会妨碍授权修复；回归由共享套件（H10）与自包含/确定性（H11）覆盖，不额外冻结业务字节。
- **五个既有场景文件冻结**：`tests/scenarios/core.mjs`=`2b35cce880e336882e384e940d28b103acc270a7931552dea5d5c9c79c9eeb7e`，`continuity.mjs`=`d53f1a4ce357bb200a4e811aa45d3dad187d40279c5f747c7ebb38c28e810a56`，`edit.mjs`=`f61188e63586e8afa2883f6db3d3e88f7cc216a9a0c8dc7d465953ad37ceadc1`，`layout.mjs`=`c96ed96499a18b9731a8e10dabb579a761d445534105caabfa7424803def65a0`，`determinism.mjs`=`64bc09c49ac56c21aef77bdd1a7f7c365b8791d0690076f5964b58f06e69ddff`；`tests/voice/run.mjs`=`dcc96cc884f469fa18b5defd486adc30250c5ae24d9b7f58630d16d485d11733`。`tests/suite.mjs` 不冻结，因为必须注册新场景。
- **语音基线不是全绿**：生成时在当前树上连跑两次 `tests/voice/run.mjs --json`，固定失败 check 为 `result.crash`、`queue.quick-no-result`、`queue.quick-keys`（63 passed / 3 failed），与名单功能无关，属既有状态。把它写成永久全绿 H 会让本闸无法合法收敛；H10 因此要求「失败集合 ⊆ 该基线且 ≤3 个」，既禁止新增回归，也不把既有缺口伪装成通过。若执行中修复了它，子集条件仍成立。
- **新增机器钩子**：规格 §6 已给出完整 `roster-*` / `import-*` / `storage-warning` / `roster-data-warning` / `edit-draft-title` / `edit-done` 契约；H4 额外使用既有的 `main.app[data-speech-log]` 与 `main.app[data-speech-played]` 观测语音队列，不需要新增全局测试 API。所有新增钩子都在 SCOPE-EXEMPTIONS 中显式授权。
- **软闸保留**：导入对话框、保留/清空取舍、名单进度、320px 卡片与浮动编辑草稿都是首次使用者可见的呈现面，需要像素评审；硬闸不评文案与视觉层级。S2 特意构造「已有 2 条成绩 + 自定义表头映射 + 保留默认」的组合，让预览中最容易误判的决策现场进入评审。
- **320px 用 CDP**：无头 Chrome 的 `--window-size` 有约 500px 下限，320px 必须 `Emulation.setDeviceMetricsOverride`，否则窄屏评审是假的。
- **无 URL 深链**：产物是单文件、没有查询参数路由；各评审态用 UI 控件到达，量具按步骤渲染并等待稳定选择器。
- **volatile**：只列 `Telos/_worktree-archive`（归档证据目录不是业务码，且 WORKTREES 约定新闸应排除它）；gate 目录与 sibling 门禁目录由 runner 自动排除，`*.log`/`node_modules` 由 gitignore 排除。
- **历史实现参考**：旧分支工作树 `/ws/cal_phone-worktrees/roster-import`（`250e966`）与归档副本可作移植参考，但它基于旧 master、缺少当前计算特性与本次修订的映射/粘贴/导入方式；旧归档证据只描述旧字节，不能提升为本闸的轮次或 PASS。
- **测试与 fixture 卫生**：GBK 用 iconv/python3 在 `KEKKAI_OUT_DIR` 生成；文件导入用隐藏 `<input type=file>` + `setInputFiles`；导出用 Playwright download 或 `URL.createObjectURL` 捕获；语音观测复用 `tests/voice/run.mjs` 的本地 HTTP + 假引擎模式但不得修改该文件。
