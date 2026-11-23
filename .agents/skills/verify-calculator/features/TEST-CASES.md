# 测试用例目录

本文件是**用例索引**：给每个用例一个稳定 ID、优先级、前置条件、步骤、预期结果，并映射到 `scripts/drive.mjs` 中真正执行的断言。
机器可执行的源仍是 `drive.mjs`；本目录让人和 agent 能回答"到底测了哪些点、哪条没测"。

- 断言名（如 `result.value`）在 `run.json` 的 `assertions[].name` 中可查，是唯一机器标识。
- 证据：每次运行生成 `evidence/runs/<UTC>-<scenario>/run.json` 与 `steps/NN-*.png|aria.txt`。
- 优先级：`P0` 主路径/红线，`P1` 常见边界，`P2` 防御性细节。
- 改行为时的顺序：先改本目录 → 再改 `drive.mjs` 场景 → 最后改应用 → 重跑对应场景。禁止只改应用不改用例。

## 运行方式

```bash
bash .agents/skills/verify-calculator/scripts/launch.sh
node .agents/skills/verify-calculator/scripts/doctor.mjs
node .agents/skills/verify-calculator/scripts/drive.mjs --scenario <场景>
```

| 场景 | 覆盖用例 | 所属功能 |
| --- | --- | --- |
| `basic-addition` | ADD-01 … ADD-07 | addition-and-equals |
| `operator-coverage` | ADD-08, ADD-09 | addition-and-equals |
| `number-entry` | ENT-01 … ENT-07, KEY-01/02 | number-entry |
| `backspace-undo` | UND-01 … UND-04 | backspace-undo |
| `sticky-chaining` | CHN-01 … CHN-05 | chained-calculations |
| `edit-history` | EDT-01 … EDT-08 | edit-history |
| `division-by-zero` | DIV-01 … DIV-04 | division-by-zero |
| `settings-panel` | SET-01 … SET-06, AEQ-01 | score-tally-settings |
| `auto-confirm` | AUTO-01 … AUTO-05 | score-tally-settings |
| `base-score` | BASE-01 … BASE-09 | score-tally-settings |
| `auto-equals` | AEQ-02 … AEQ-14 | auto-equals |
| `mobile-layout` | LAY-01 … LAY-08 | mobile-layout |

仓库自带的 `tests/suite.mjs`（43 场景、673 检查）是独立回归基线；本目录的驱动额外负责设置持久化、截图与 ARIA 证据。改动计算/历史/编辑语义时两者都要跑。

---

## ADD · 运算符选择、输入与计算

| ID | P | 前置/入口 | 步骤 | 预期结果 | 断言前缀 | 场景 |
| --- | --- | --- | --- | --- | --- | --- |
| ADD-01 | P0 | 新开页面 | 不操作，观察初始态 | `data-state=select`；14 个数字键可用；恰有 4 个运算符；算式/结果/历史为空 | `initial.*` | basic-addition |
| ADD-02 | P0 | 初始态 | 点 `+` | 进入 `input`；键盘可用；提示"已选择 +，请输入数字" | `operator.*` | basic-addition |
| ADD-03 | P0 | 已选 `+` | 点 `12`，不按回车 | 显示区为 `12`；算式仍为空（未提交不得进入算式） | `typed.*` | basic-addition |
| ADD-04 | P0 | 显示区 `12` | 点 `回车` | 算式为 `12 +`；显示区清空 | `commit.*` | basic-addition |
| ADD-05 | P0 | 算式 `12 +` | 点 `30` 再 `回车` | 输入态算式为 `12 + 30 +`（尾随待定运算符） | `second_operand.*` | basic-addition |
| ADD-06 | P0 | 算式 `12 + 30 +` | 点 `=` | `data-state=result`；结果为 `42` 且 `data-value=42`；算式收敛为 `12 + 30`（无尾随运算符）；历史 1 条 `12 + 30 → 42` | `result.*`、`history.first.*` | basic-addition |
| ADD-07 | P1 | 上一条完成 | 刷新页面 | 回到 `select`；历史清空（仅当前页面） | `reload.*` | basic-addition |
| ADD-08 | P0 | 任意态 | 分别按 `+ - * /` 计算 `12+30+8`、`10-4-3`、`2*3*4`、`100/5/2` | 结果依次 `50`、`3`、`24`、`10`；算式为对应完整表达式；历史递增 | `case_<名称>.*` | operator-coverage |
| ADD-09 | P1 | 任意态 | 计算 `1.5 + 2.25` | 结果 `3.75`；算式 `1.5 + 2.25` | `case_decimal-sum.*` | operator-coverage |

## ENT/KEY · 数字录入与键盘

| ID | P | 前置/入口 | 步骤 | 预期结果 | 断言前缀 | 场景 |
| --- | --- | --- | --- | --- | --- | --- |
| ENT-01 | P0 | 新开页面，未选运算符 | 直接点 `1 2` | 进入 `input`；显示区 `12`；算式为空；提示"请输入数字，或先选择运算类型" | `entry.optional_operator_*` | number-entry |
| ENT-02 | P0 | 上一条状态 | 点 `回车` | 算式为 `12`；提示"已确认 12，可继续输入或按 = 计算" | `entry.commit_without_operator_*` | number-entry |
| ENT-03 | P0 | 上一条状态 | 选 `+`，输入 `3` 回车，点 `=` | 算式 `12 + 3`；结果 `15`；历史 1 | `entry.operator_after_commit_*` | number-entry |
| ENT-04 | P1 | 已选 `+` | 依次点 `7 . . 5` | 显示区 `7.5`；第二个小数点被忽略 | `entry.duplicate_dot_ignored` | number-entry |
| ENT-05 | P1 | 显示区 `7.5` | 连点两次 `退格` | 依次变为 `7.`、`7` | `entry.backspace_once/twice` | number-entry |
| ENT-06 | P1 | 已提交一个 `7`，显示区为空 | 点 `回车` | 算式仍为 `7 +`；历史不变（空回车不新增操作数） | `entry.empty_enter_*` | number-entry |
| ENT-07 | P2 | 已提交一个 `7` | 直接点 `=` | 结果为 `7`；历史 +1（单操作数等于自身） | `entry.single_operand_result` | number-entry |
| KEY-01 | P1 | 已选 `+` | 物理键盘输入 `45`、Enter、`5`、Enter、`=` | 结果 `50`；算式 `45 + 5`；历史 +1 | `keyboard.sum_*` | number-entry |
| KEY-02 | P2 | 已选 `+` | 物理键盘输入 `9`，按 Backspace | 显示区清空 | `keyboard.backspace_input` | number-entry |

## UND · 退格撤回

| ID | P | 前置/入口 | 步骤 | 预期结果 | 断言前缀 | 场景 |
| --- | --- | --- | --- | --- | --- | --- |
| UND-01 | P0 | 已提交 `9.5`、`9.2`，显示区为空 | 点 `退格` | 算式 `9.5 +`；提示"已撤回 9.2" | `undo.first_*` | backspace-undo |
| UND-02 | P0 | 上一条状态 | 再点两次 `退格` | 第二次后算式为空、提示"已撤回 9.5"；第三次无变化 | `undo.second_*`、`undo.exhausted_*` | backspace-undo |
| UND-03 | P1 | 已完成 `7 =` | 点 `退格` | 结果仍为 `7`，状态仍为 `result`（结果不可撤回） | `undo.result_*` | backspace-undo |
| UND-04 | P1 | 编辑 `2 + 3` 记录 | 点 `退格` | 剩 1 个 chip；算式 `2 +`；提示"已撤回 3" | `undo.edit_*` | backspace-undo |

## CHN · 沿用运算符与切换

| ID | P | 前置/入口 | 步骤 | 预期结果 | 断言前缀 | 场景 |
| --- | --- | --- | --- | --- | --- | --- |
| CHN-01 | P0 | 已完成 `6 + 7 = 13` | 点 `5`，再点 `=` | 结果 `5`；算式 `5`；运算符仍为 `+`；历史 2 条 | `continued.*` | sticky-chaining |
| CHN-02 | P0 | 上一条完成 | 点 `2 回车 3 回车 =` | 结果 `5`；算式 `2 + 3`；历史 3 条 | `chained.*` | sticky-chaining |
| CHN-03 | P0 | 任意态 | 按 `运算类型`，选 `-`，点 `9`，再选 `*` | 仍为 `input`；显示区保留 `9`；提示"已更换为 *，已输入的数字会保留" | `switch.*` | sticky-chaining |
| CHN-04 | P0 | 上一条状态 | 点 `回车`，再点 `=` | 算式 `9 *`；结果 `9`；运算符 `*` | `switch.committed_expression`、`switch.result` | sticky-chaining |
| CHN-05 | P1 | 任意态 | 点 `运算类型` | 回到 `select`；算式/结果为空；键盘仍可用 | `reset.*` | sticky-chaining |

## EDT · 编辑历史记录

| ID | P | 前置/入口 | 步骤 | 预期结果 | 断言前缀 | 场景 |
| --- | --- | --- | --- | --- | --- | --- |
| EDT-01 | P0 | 已完成 `2 + 3 = 5` | 点该记录的 `编辑` | `data-state=edit`；草稿可见；2 个 chip（`2`、`3`）；编辑运算符 `+`；算式 `2 + 3 +`；显示区为空 | `edit.*` | edit-history |
| EDT-02 | P0 | 编辑草稿 | 把第一个操作数改为 `10` | 算式实时变为 `10 + 3 +` | `edit.operand_change_expression` | edit-history |
| EDT-03 | P0 | 算式 `10 + 3 +` | 点 `=` | 结果 `13`；算式收敛为 `10 + 3`；历史 2 条；最新 `10 + 3 → 13` | `recompute.*` | edit-history |
| EDT-04 | P1 | 打开最新记录的 `编辑` | 选 `*` | 编辑运算符显示 `*`；算式 `10 * 3 *`；重算得 `30`；历史 3 条 | `edit.switch*` | edit-history |
| EDT-05 | P1 | 再次打开 `编辑` | 点第二个操作数的 `×`，再点 `=` | 剩 1 个 chip；算式 `10 *`；结果 `10`；历史 4 条 | `edit.removed*`、`edit.single_operand*` | edit-history |
| EDT-06 | P1 | 打开最新记录的 `编辑` | 点击某个操作数输入框，再点页面其他位置 | 聚焦时该输入框清空并标 `data-pending`；失焦后恢复原值 | `edit.pending_*` | edit-history |
| EDT-07 | P1 | 编辑草稿，改一个值 | 点 `关闭` | 恢复编辑前的表达式/结果；历史不变；chip 消失 | `edit.cancel_*` | edit-history |
| EDT-08 | P2 | 带基数的历史记录 | 打开 `编辑` | `edit-base-marker` 显示该记录的基数；重算仍用旧基数 | `base.edit_*` | base-score |

## DIV · 除零错误与恢复

| ID | P | 前置/入口 | 步骤 | 预期结果 | 断言前缀 | 场景 |
| --- | --- | --- | --- | --- | --- | --- |
| DIV-01 | P0 | 新开页面 | 选 `/`，输入 `5 回车 0 回车`，点 `=` | `data-state=error`；结果显示 `不能除以零`；`data-error=true`；算式清空；历史 0；提示含"不能除以零" | `error.*` | division-by-zero |
| DIV-02 | P0 | 错误态 | 点 `8`，再点 `=` | 结果 `8`；运算符仍为 `/`；历史 1 条；错误消失且无异常 | `typing_recovery.*` | division-by-zero |
| DIV-03 | P1 | 任意态 | 选 `/`，计算 `0 / 5` | 结果 `0`；状态 `result`，不是错误 | `zero_dividend.*` | division-by-zero |
| DIV-04 | P1 | 错误态 | 点 `运算类型` | 回到 `select`；算式/结果清空；键盘可用 | `reset_recovery.*` | division-by-zero |

## SET · 统分设置面板

| ID | P | 前置/入口 | 步骤 | 预期结果 | 断言前缀 | 场景 |
| --- | --- | --- | --- | --- | --- | --- |
| SET-01 | P0 | 新开页面 | 观察右上角齿轮 | 可见、≥44×44；设置面板初始关闭；指示点隐藏 | `settings.toggle_*`、`panel_closed_initially`、`indicator_hidden_initially` | settings-panel |
| SET-02 | P0 | 初始态 | 点齿轮 | 原生 dialog 打开；`aria-expanded=true`；焦点进入"自动确认秒数"；23 个档位且默认 `0`；自动按等号字段为 `0` 且可访问名称含"自动/等号"；基数未勾选且输入禁用 | `settings.panel_open`、`auto_confirm_*`、`auto_equals_*`、`base_*_default` | settings-panel |
| SET-03 | P0 | 面板打开 | 按 `Esc` | 面板关闭；焦点回到齿轮 | `settings.escape_closes`、`focus_returns_to_toggle` | settings-panel |
| SET-04 | P0 | 面板打开 | 选 `1.5`，勾选基数，填 `10`，点 `完成` | 指示点出现；面板关闭 | `settings.indicator_visible_when_changed`、`done_closes` | settings-panel |
| SET-05 | P0 | 已配置 | 刷新页面并重开面板 | 指示点仍在；档位 `1.5`、基数开启、值 `10` 全部保留 | `settings.persist_*` | settings-panel |
| SET-06 | P1 | 已配置 | 做一次计算后点 `运算类型` | 回到 `select`；设置指示点仍显示（设置不被重置清空） | `settings.reset_*` | settings-panel |

## AUTO · 自动确认

| ID | P | 前置/入口 | 步骤 | 预期结果 | 断言前缀 | 场景 |
| --- | --- | --- | --- | --- | --- | --- |
| AUTO-01 | P0 | 自动确认设为 2 秒，已选 `+` | 输入 `95` 后停手 | 约 2 秒后数字进入算式（`95 +`）、显示区清空、状态标签文本含"已确认 95"（叠加层显示时 `visibility:hidden`）；可见的撤回提示含 `95`；进度条转为 inactive | `auto_confirm.*`、`undo_hint_*` | auto-confirm |
| AUTO-02 | P0 | 同上 | 输入 `9`，等 0.9 秒，再输入 `5`，等 0.7 秒 | 此时仍未提交，显示区 `95`；随后按完整 2 秒提交一次 `95`（计时被按键重置） | `auto_confirm.timer_active`、`restarted_*` | auto-confirm |
| AUTO-03 | P1 | 同上 | 输入 `9.` 后等 2.5 秒 | 不提交；显示区仍 `9.`；补输入 `5` 后按完整时长提交 `9.5` | `auto_confirm.trailing_dot_*` | auto-confirm |
| AUTO-04 | P1 | 自动确认设为 0 | 输入 `9` 后等 1.5 秒 | 不提交；显示区仍 `9` | `auto_confirm.disabled_*` | auto-confirm |
| AUTO-05 | P1 | 自动确认 2 秒 | 输入 `9` 后立即打开设置面板并等 2.5 秒 | 不提交；关闭面板后重新等满 2 秒才提交 | `auto_confirm.paused_*` | auto-confirm |

## BASE · 基数

| ID | P | 前置/入口 | 步骤 | 预期结果 | 断言前缀 | 场景 |
| --- | --- | --- | --- | --- | --- | --- |
| BASE-01 | P0 | 基数 10 开启 | 选 `+` | 算式显示 `10`；`基数 10` 标记可见；提示带"基数 10" | `base.expression_before_operands`、`marker_*`、`operator_label` | base-score |
| BASE-02 | P0 | 基数 10，选 `+` | 输入 `9.5 回车 9.2 回车 9 回车`，点 `=` | 结果 `37.7`；算式 `10 + 9.5 + 9.2 + 9`；历史 `data-base=10` | `base.sum_*`、`history_data_base` | base-score |
| BASE-03 | P1 | 关闭基数 | 计算 `9.5 + 9.2 + 9` | 结果 `27.7`；算式不含基数；历史 `data-base` 为空 | `base.off_*` | base-score |
| BASE-04 | P1 | 基数 100 | 计算 `100 / 4` | 结果 `25`；算式 `100 / 4`（基数不作除数） | `base.division_*` | base-score |
| BASE-05 | P1 | 基数 0 | 计算 `0 * 5` | 结果 `0`；算式 `0 * 5`；历史 `data-base=0` | `base.zero_*` | base-score |
| BASE-06 | P0 | 基数 10 的旧记录，当前基数改为 100 | 打开旧记录 `编辑` 并重算 | 编辑标记 `基数 10`；结果仍为 `37.7`；新历史记录 `data-base=10` | `base.edit_*` | base-score |
| BASE-07 | P0 | 当前基数 100 | 计算 `100 + 1` | 结果 `101`；新计算使用当前基数 | `base.current_*` | base-score |
| BASE-08 | P1 | 已选 `+`，输入 `5`（未回车），改基数为 200 | 关闭面板 | 算式立即重绘为 `200`；显示区仍保留 `5`；提交后 `200 + 5 = 205` | `base.live_*` | base-score |
| BASE-09 | P1 | 任意基数 | 检查历史条目 | 每条历史带 `data-base`，编辑后代数的快照不随当前设置变化 | `base.edit_old_history_base` | base-score |

## AEQ · 自动按等号

| ID | P | 前置/入口 | 步骤 | 预期结果 | 断言前缀 | 场景 |
| --- | --- | --- | --- | --- | --- | --- |
| AEQ-01 | P0 | 新开页面 | 开设置面板观察「自动按等号」 | 字段可见、值 `0`；可访问名称含"自动""等号"；提示含"等号"或 `=` | `settings.auto_equals_*` | settings-panel |
| AEQ-02 | P0 | 设 N=3，选 `+` | 提交 `95`、`92` | 仍 `input`；算式依次 `95 +`、`95 + 92 +`；结果空 | `auto_equals.before_n.*`、`second.*` | auto-equals |
| AEQ-03 | P0 | 上一条状态 | 提交 `90` | 自动 `result`；结果 `277`；算式 `95 + 92 + 90`；输入清空；历史 1 条；全程未点 `=` | `auto_equals.third.*` | auto-equals |
| AEQ-04 | P1 | 设 N=1，选 `+` | 提交 `8` | 结果 `8`；历史 +1 | `auto_equals.n1.*` | auto-equals |
| AEQ-05 | P0 | N=3，基数 10，选 `+` | 提交 `95`、`92` | 仍 `input`；算式 `10 + 95 + 92 +`；结果空（基数不计入 N） | `auto_equals.base.before_n.*` | auto-equals |
| AEQ-06 | P0 | 上一条状态 | 提交 `90` | 结果 `287`；算式 `10 + 95 + 92 + 90`；历史 `data-base=10` | `auto_equals.base.*` | auto-equals |
| AEQ-07 | P1 | N=2，未选运算符 | 提交 `1`、`2`，再选 `+` | 仍 `input`；结果空（选运算符本身不触发） | `auto_equals.no_operator.*` | auto-equals |
| AEQ-08 | P1 | 上一条状态 | 再提交 `3` | 结果 `6`；算式 `1 + 2 + 3` | `auto_equals.no_operator.third.*` | auto-equals |
| AEQ-09 | P1 | N=2 已自动算出 `5 + 5 = 10`，改 N=1 | 打开记录 `编辑`，输入 `3` 并 `确认` | 仍 `edit`；历史条数不变；关闭后回到 `result` | `auto_equals.edit.*` | auto-equals |
| AEQ-10 | P1 | N=2，自动确认 2 秒，选 `+` | 输入 `95` 等自动提交，再输入 `92` | 第一笔不计算；第二笔自动提交后结果 `187`、状态 `result` | `auto_equals.auto_confirm.*` | auto-equals |
| AEQ-11 | P1 | N=2，选 `/` | 提交 `5`、`0` | 进入 `error`；结果 `不能除以零`；`data-error=true` | `auto_equals.divzero.*` | auto-equals |
| AEQ-12 | P1 | N=0，选 `+` | 提交 `95`、`92`、`90` | 仍 `input`、结果空；手动 `=` 得 `277` | `auto_equals.off.*` | auto-equals |
| AEQ-13 | P1 | 设置 N=3 | 刷新页面并重开面板 | 指示点可见；字段仍为 `3` | `auto_equals.persist_*` | auto-equals |
| AEQ-14 | P2 | N=0，已提交 `1`、`2` | 把 N 改为 2 并关闭面板 | 不立即计算；下一次提交 `3` 后结果 `6` | `auto_equals.threshold_change.*` | auto-equals |

## LAY · 移动端布局

| ID | P | 前置/入口 | 步骤 | 预期结果 | 断言前缀 | 场景 |
| --- | --- | --- | --- | --- | --- | --- |
| LAY-01 | P0 | 320×568 | 依次处于 select、长输入、长算式、长结果、编辑草稿、设置面板、基数+进度条 | 每个阶段 `scrollWidth <= clientWidth` | `layout_320x568.*.no_horizontal_overflow` | mobile-layout |
| LAY-02 | P0 | 390×844 | 同上 | 每个阶段均无横向溢出 | `layout_390x844.*.no_horizontal_overflow` | mobile-layout |
| LAY-03 | P0 | select 态 | 测量所有可见按钮 | 每个按钮宽、高均 ≥44 CSS px | `layout_*.touch_targets_min_44` | mobile-layout |
| LAY-04 | P0 | select / 编辑态 | 读取显示区与操作数输入框字号 | 均 ≥16 px | `layout_*.input_font_min_16`、`operand_font_min_16` | mobile-layout |
| LAY-05 | P1 | 320/390 | 输入 9 位数并提交；计算 `1 / 3` | 长算式与 `0.3333333333333333` 正常换行，页面不横向溢出 | `layout_*.long_*` | mobile-layout |
| LAY-06 | P1 | 320/390 | 完成 `2 + 3 =` 后打开 `编辑` | 操作数输入框 ≥16px；`×` 按钮 ≥44×44；草稿不横向溢出 | `layout_*.operand_*`、`edit-draft` 截图 | mobile-layout |
| LAY-07 | P0 | 320/390 | 打开设置面板 | 面板完整落在视口内；面板内控件 ≥44×44；字号 ≥16px；页面不溢出 | `layout_*.settings_*` | mobile-layout |
| LAY-08 | P1 | 320/390 | 开基数 10、自动确认 2 秒后输入一位 | 基数标记可见；进度条 active 且高度 ≤4px；两者都不造成横向溢出 | `layout_*.base_marker_visible`、`progress_*` | mobile-layout |

---

## PAUSE · 结果后暂停输入（suite 新增）

设置项 `resultPause`，默认 `1` 秒，取值 0–10、一位小数，`0` 为关闭。只拦数字与小数点，不拦运算符。

| ID | P | 前置/入口 | 步骤 | 预期结果 | 断言前缀 | 场景 |
| --- | --- | --- | --- | --- | --- | --- |
| PAUSE-01 | P1 | 默认设置，算完 `5 + 6 =` | 立即点 `9` | 显示区仍空；算式 `5 + 6`、结果 `11`、状态 `result`（输入被静默丢弃） | `settings-pause.default.blocked-*` | settings-pause |
| PAUSE-02 | P1 | 上一条状态 | 点 `退格` | 算式/结果/状态都不变 | `settings-pause.default.backspace-*` | settings-pause |
| PAUSE-03 | P1 | 上一条状态 | 点 `-`，再点 `8` | 运算符照常生效：状态转 `input`、结果清空；`8` 进入显示区 | `settings-pause.default.operator-*` | settings-pause |
| PAUSE-04 | P1 | `resultPause=0` | 算完后立即点 `9` | 立即进入 `input`，显示区 `9`，算式/结果清空 | `settings-pause.zero.*` | settings-pause |
| PAUSE-05 | P1 | `resultPause=0.5` | 算完后轮询点击 `9` | 首次点击被拒；至少第 2 次轮询后接受（证明暂停按时间结束而非立即失效） | `settings-pause.restore.polls`、`restore.*` | settings-pause |
| PAUSE-06 | P1 | 设置面板 | 输入 `12` 后失焦 | 字段回到原值，存储值不变（越界不接受） | `settings-pause.panel.reject-*`、`revert-*` | settings-pause |
| PAUSE-07 | P1 | 设置面板 | 输入 `2.5`，关闭面板并刷新 | 字段与 `localStorage.resultPause` 均为 `2.5` | `settings-pause.panel.accepted/persisted/*-after-reload` | settings-pause |

## NUM · 数值边界（suite 新增，4 个场景）

| ID | P | 前置/入口 | 步骤 | 预期结果 | 断言前缀 | 场景 |
| --- | --- | --- | --- | --- | --- | --- |
| NUM-01 | P1 | `resultPause=0` | 计算 `5 - 12` | 算式 `5 - 12`；结果文本与 `data-value` 均为 `-7`；历史 1 条 `-7` | `number-negative.result.*` | number-negative |
| NUM-02 | P1 | 基数 `-5` | 计算 `+ 3 + 2 =` | 算式 `-5 + 3 + 2`；结果 `0`；标记 `基数 -5`；历史 `data-base="-5"` | `number-negative.base.*` | number-negative |
| NUM-03 | P2 | `resultPause=0` | 计算 `0.1 + 0.2` | 结果 `0.30000000000000004`（float64，不四舍五入）；历史同值 | `number-float-display.sum.*` | number-float-display |
| NUM-04 | P2 | 同上 | 计算 `1 / 3` | `0.3333333333333333` | `number-float-display.third.*` | number-float-display |
| NUM-05 | P2 | 同上 | 选 `+`，输入 20 位 `12345678901234567890` 后 `=` | 算式保留 20 位字面量；结果 `12345678901234567000`（float64） | `number-float-display.long.*` | number-float-display |
| NUM-06 | P2 | 同上 | 输入 `007` 回车、`.5` 回车、`=` | 算式保留字面量 `007 + .5`；结果 `7.5`；历史 operands 为 `["007",".5"]` | `number-literal-preserved.*` | number-literal-preserved |
| NUM-07 | P1 | 同上 | 计算 `9.5 + 9.2 + 9` | `27.7`（十进制和不漂移） | `number-decimal-sum.*` | number-decimal-sum |

## STORE · 计算器设置存储健壮性（suite 新增，3 个场景）

键 `cal-phone.settings.v1`；形状含 `autoConfirm/autoEquals/resultPause/baseEnabled/baseValue/haptics/voiceKeys/voiceResult`。

| ID | P | 前置/入口 | 步骤 | 预期结果 | 断言前缀 | 场景 |
| --- | --- | --- | --- | --- | --- | --- |
| STORE-01 | P1 | 键值写成 `{not json` | 加载页面并打开设置 | 页面进入 `select`、无 pageerror；面板为默认值（0/0/1/未勾选/震动勾选） | `settings-storage-corrupt.*` | settings-storage-corrupt |
| STORE-02 | P1 | 写入越界值 | 加载并打开设置 | `autoConfirm 999→0`、`autoEquals -3→0`、`resultPause 99→1`；`baseEnabled:true` 保留；`baseValue:"abc"→"0"`；`haptics:"no"→勾选` | `settings-storage-corrupt.range-*` | settings-storage-corrupt |
| STORE-03 | P1 | 面板改暂停 `2.5`、关震动 | 读存储并刷新 | 存储含 8 个键且仅此一键；刷新后面板保持，且暂停行为仍生效 | `settings-storage-round-trip.*` | settings-storage-round-trip |
| STORE-04 | P1 | `localStorage` 读写抛错 | 加载并计算 `2 + 3 =` | 显示"本机存储不可用"警告；结果 `5`；无 pageerror | `settings-storage-denied.*` | settings-storage-denied |

## KEYF · 物理键盘与焦点（suite 新增，4 个场景）

| ID | P | 前置/入口 | 步骤 | 预期结果 | 断言前缀 | 场景 |
| --- | --- | --- | --- | --- | --- | --- |
| KEYF-01 | P1 | 打开设置面板 | 按 `7` | 显示区仍空、状态与算式不变（模态吞掉物理键） | `keyboard-dialog.*` | keyboard-dialog |
| KEYF-02 | P1 | 设置面板打开 | 按 `Esc` | 面板关闭；焦点回到齿轮；`aria-expanded=false` | `keyboard-dialog.focus-returned/aria-expanded` | keyboard-dialog |
| KEYF-03 | P1 | 结果态 | 按 `5` | 开始新计算：状态 `input`、显示区 `5`、算式清空；`运算类型` 回到 `select` | `keyboard-result-state.*` | keyboard-result-state |
| KEYF-04 | P1 | 编辑草稿 | 按 `7` 再按 `Enter` | 显示区先收 `7`；确认后草稿多一个操作数（3 个，`["2","3","7"]`）、算式 `2 + 3 + 7 +`、提示"已加入 7，可继续编辑或按 = 重算" | `keyboard-edit-draft.*` | keyboard-edit-draft |
| KEYF-05 | P1 | 编辑草稿 | 聚焦第 1 个操作数输入框后按 `5` | 字符进入该输入框；显示区不变；chip `data-value=5` | `keyboard-operand-input.*` | keyboard-operand-input |
| KEYF-06 | P2 | 编辑草稿 | 按 `Esc` | 草稿保持打开（当前行为；与设置面板不一致，待产品决定） | `keyboard-edit-draft.escape-*` | keyboard-edit-draft |

## HAP · 按键震动（suite 新增）

| ID | P | 前置/入口 | 步骤 | 预期结果 | 断言前缀 | 场景 |
| --- | --- | --- | --- | --- | --- | --- |
| HAP-01 | P2 | 默认开启 | 依次按 `1 2 退格 + 3 确认 =` | `navigator.vibrate` 被调用 7 次，参数均为 `10` | `settings-haptics.on.*` | settings-haptics |
| HAP-02 | P2 | 默认开启 | 用物理键盘输入 `5`、`Enter` | 震动 0 次；计算照常 | `settings-haptics.keyboard.*` | settings-haptics |
| HAP-03 | P2 | `haptics=false` | 重放同一按键序列 | 震动 0 次，结果 `4` 不变 | `settings-haptics.off.*` | settings-haptics |
| HAP-04 | P2 | 面板取消勾选 | 读存储并刷新 | 存储 `haptics=false`；刷新后仍静音且输入正常 | `settings-haptics.toggle.*` | settings-haptics |

---

## 明确不在范围内

以下内容**没有**用例，因为它们不是该应用的行为契约：

- 刷新后保留历史：历史按设计只存在内存（`仅当前页面`）；设置则持久化。
- 跨浏览器一致性：当前只在 Chromium（Playwright）验证；Safari/Firefox 差异未覆盖。
- 任意精度小数：使用 JavaScript float64，`1 / 3` 的展示就是 `0.3333333333333333`，不做四舍五入断言。
- 外部账号、网络、存储：应用无这些依赖，无需前置数据。
- 存储结构版本迁移：坏 JSON 与越界值已由 `settings-storage`、`roster-storage` 覆盖；但没有"旧版本数据迁移到新结构"的用例，当前不存在版本升级逻辑。
- 动画逐帧效果：只断言 `data-active` 与几何尺寸，不比对进度条像素宽度。

## 变更检查清单

1. 行为变了 → 先更新本目录中对应用例的"步骤/预期"。
2. 同步修改 `drive.mjs` 中该场景的断言（断言名保持稳定，除非用例本身被删除）。
3. 重跑该场景与相邻场景，确认旧断言没有回归；同时跑 `tests/suite.mjs`。
4. 保留新旧两份 `run.json`，不要覆盖证据。
