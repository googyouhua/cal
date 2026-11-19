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
| `input-editing` | ADD-10 … ADD-14 | addition-and-equals |
| `sticky-chaining` | CHN-01 … CHN-05 | chained-calculations |
| `edit-history` | EDT-01 … EDT-05 | edit-history |
| `division-by-zero` | DIV-01 … DIV-04 | division-by-zero |
| `mobile-layout` | LAY-01 … LAY-06 | mobile-layout |

---

## ADD · 运算符选择、数字输入与计算

| ID | P | 前置/入口 | 步骤 | 预期结果 | 断言前缀 | 场景 |
| --- | --- | --- | --- | --- | --- | --- |
| ADD-01 | P0 | 新开页面 | 不操作，观察初始态 | `data-state=select`；数字键盘禁用；恰有 4 个运算符；算式/结果/历史为空 | `initial.*` | basic-addition |
| ADD-02 | P0 | 初始态 | 点 `+` | 进入 `input`；键盘启用；提示"已选择 +，请输入数字" | `operator.*` | basic-addition |
| ADD-03 | P0 | 已选 `+` | 点 `12`，不按回车 | 显示区为 `12`；算式仍为空（未提交不得进入算式） | `typed.*` | basic-addition |
| ADD-04 | P0 | 显示区 `12` | 点 `回车` | 算式为 `12 +`；显示区清空 | `commit.*` | basic-addition |
| ADD-05 | P0 | 算式 `12 +` | 点 `30` 再 `回车` | 算式为 `12 + 30` | `second_operand.*` | basic-addition |
| ADD-06 | P0 | 算式 `12 + 30` | 点 `=` | `data-state=result`；结果为 `42` 且 `data-value=42`；算式保留；历史 1 条 `12 + 30 → 42` | `result.*`、`history.first.*` | basic-addition |
| ADD-07 | P1 | 上一条完成 | 刷新页面 | 回到 `select`；历史清空（仅当前页面） | `reload.*` | basic-addition |
| ADD-08 | P0 | 任意态 | 分别按 `+ - * /` 计算 `12+30+8`、`10-4-3`、`2*3*4`、`100/5/2` | 结果依次 `50`、`3`、`24`、`10`；算式为对应完整表达式；历史递增 | `case_<名称>.*` | operator-coverage |
| ADD-09 | P1 | 任意态 | 计算 `1.5 + 2.25` | 结果 `3.75`；算式 `1.5 + 2.25` | `case_decimal-sum.*` | operator-coverage |
| ADD-10 | P1 | 已选 `+` | 依次点 `7 . . 5` | 显示区 `7.5`；第二个小数点被忽略 | `editing.duplicate_dot_ignored` | input-editing |
| ADD-11 | P1 | 显示区 `7.5` | 连点两次 `退格` | 依次变为 `7.`、`7` | `editing.backspace_once/twice` | input-editing |
| ADD-12 | P1 | 已提交一个 `7`，显示区为空 | 点 `回车` | 算式仍为 `7 +`；历史仍为 0（空回车不新增操作数） | `editing.empty_enter_*` | input-editing |
| ADD-13 | P2 | 显示区为空 | 连点两次 `退格` | 输入仍为空；状态仍为 `input`；无异常 | `editing.backspace_on_empty*` | input-editing |
| ADD-14 | P2 | 已提交 `7` | 直接点 `=` | 结果为 `7`；历史 1 条（单操作数等于自身） | `editing.single_operand_result`、`editing.history_count` | input-editing |

## CHN · 沿用运算符与切换

| ID | P | 前置/入口 | 步骤 | 预期结果 | 断言前缀 | 场景 |
| --- | --- | --- | --- | --- | --- | --- |
| CHN-01 | P0 | 已完成 `6 + 7 = 13` | 点 `5`，再点 `=` | 结果 `5`；算式 `5`；运算符仍为 `+`；历史 2 条 | `continued.*` | sticky-chaining |
| CHN-02 | P0 | 上一条完成 | 点 `2 回车 3 回车 =` | 结果 `5`；算式 `2 + 3`；历史 3 条 | `chained.*` | sticky-chaining |
| CHN-03 | P0 | 任意态 | 按 `运算类型`，选 `-`，点 `9`，再选 `*` | 仍为 `input`；显示区保留 `9`；提示"已更换为 *，已输入的数字会保留" | `switch.*` | sticky-chaining |
| CHN-04 | P0 | 上一条状态 | 点 `回车`，再点 `=` | 算式 `9 *`；结果 `9`；运算符 `*` | `switch.committed_expression`、`switch.result` | sticky-chaining |
| CHN-05 | P1 | 任意态 | 点 `运算类型` | 回到 `select`；算式/结果为空；键盘禁用 | `reset.*` | sticky-chaining |

## EDT · 编辑历史记录

| ID | P | 前置/入口 | 步骤 | 预期结果 | 断言前缀 | 场景 |
| --- | --- | --- | --- | --- | --- | --- |
| EDT-01 | P0 | 已完成 `2 + 3 = 5` | 点该记录的 `编辑` | `data-state=edit`；草稿可见；2 个操作数 chip（`2`、`3`）；编辑运算符 `+`；算式 `2 + 3`；显示区为空 | `edit.*` | edit-history |
| EDT-02 | P0 | 编辑草稿 | 把第一个操作数改为 `10` | 算式实时变为 `10 + 3` | `edit.operand_change_expression` | edit-history |
| EDT-03 | P0 | 算式 `10 + 3` | 点 `=` | 结果 `13`；历史 2 条；最新一条为 `10 + 3 → 13` | `recompute.*` | edit-history |
| EDT-04 | P1 | 重新打开最新记录的 `编辑` | 选 `*` | 编辑运算符显示 `*`；算式 `10 * 3`；重算得 `30`；历史 3 条 | `edit.switch*` | edit-history |
| EDT-05 | P1 | 再次打开 `编辑` | 点第二个操作数的 `×`，再点 `=` | 剩 1 个 chip；算式 `10 *`；结果 `10`；历史 4 条 | `edit.removed*`、`edit.single_operand*` | edit-history |

## DIV · 除零错误与恢复

| ID | P | 前置/入口 | 步骤 | 预期结果 | 断言前缀 | 场景 |
| --- | --- | --- | --- | --- | --- | --- |
| DIV-01 | P0 | 新开页面 | 选 `/`，输入 `5 回车 0 回车`，点 `=` | `data-state=error`；结果显示 `不能除以零`；`data-error=true`；算式清空；历史 0；提示含"不能除以零" | `error.*` | division-by-zero |
| DIV-02 | P0 | 错误态 | 点 `8`，再点 `=` | 结果 `8`；运算符仍为 `/`；历史 1 条；错误消失且无异常 | `typing_recovery.*` | division-by-zero |
| DIV-03 | P1 | 任意态 | 选 `/`，计算 `0 / 5` | 结果 `0`；状态 `result`，不是错误 | `zero_dividend.*` | division-by-zero |
| DIV-04 | P1 | 错误态 | 点 `运算类型` | 回到 `select`；算式/结果清空；键盘禁用 | `reset_recovery.*` | division-by-zero |

## LAY · 移动端布局

| ID | P | 前置/入口 | 步骤 | 预期结果 | 断言前缀 | 场景 |
| --- | --- | --- | --- | --- | --- | --- |
| LAY-01 | P0 | 320×568 | 依次处于 select、长输入、长算式、长结果、编辑草稿 | 每个阶段 `scrollWidth <= clientWidth`（无横向溢出） | `layout_320x568.*.no_horizontal_overflow` | mobile-layout |
| LAY-02 | P0 | 390×844 | 同上 | 每个阶段均无横向溢出 | `layout_390x844.*.no_horizontal_overflow` | mobile-layout |
| LAY-03 | P0 | select 态 | 测量所有可见按钮 | 每个按钮宽、高均 ≥ 44 CSS px | `layout_*.touch_targets_min_44` | mobile-layout |
| LAY-04 | P0 | select / 编辑态 | 读取计算显示区与操作数输入框的字号 | 均 ≥ 16 px | `layout_*.input_font_min_16`、`operand_font_min_16` | mobile-layout |
| LAY-05 | P1 | 320/390 | 输入 9 位数并提交；计算 `1 / 3` | 长算式与 `0.3333333333333333` 正常换行，页面不横向溢出 | `layout_*.long_*` | mobile-layout |
| LAY-06 | P1 | 320/390 | 完成 `2 + 3 =` 后打开 `编辑` | 操作数输入框 ≥16px；`×` 按钮 ≥44×44；草稿不横向溢出 | `layout_*.operand_targets_min_44`、`edit-draft` 截图 | mobile-layout |

---

## 明确不在范围内

以下内容**没有**用例，因为它们不是该应用的行为契约：

- 刷新后保留历史：历史按设计只存在内存（`仅当前页面`）。
- 跨浏览器一致性：当前只在 Chromium（Playwright）验证；Safari/Firefox 差异未覆盖。
- 任意精度小数：使用 JavaScript float64，`1 / 3` 的展示就是 `0.3333333333333333`，不做四舍五入断言。
- 键盘物理按键（Enter/数字键）：页面只绑定屏幕按钮，未绑定 document 键盘事件。
- 外部账号、网络、存储：应用无这些依赖，无需前置数据。

## 变更检查清单

1. 行为变了 → 先更新本目录中对应用例的"步骤/预期"。
2. 同步修改 `drive.mjs` 中该场景的断言（断言名保持稳定，除非用例本身被删除）。
3. 重跑该场景与相邻场景，确认旧断言没有回归。
4. 保留新旧两份 `run.json`，不要覆盖证据。
