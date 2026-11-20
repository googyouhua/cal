# 决策台账 · phone-calculator-score-tally-settings-converge-112004

> 教义与守卫见 `docs/CREED.md` Keystone 4；本文件是收敛引擎，不是日记。每条软闸 P0/P1 在「软闸 finding 处置」恰好一行：**有效**（台账外且复核为真——唯一算数、必修的一种）｜**台账命中**（命中**更早轮次**的已拍板/不修，按主张不按措辞，本轮写入的决策下一轮才生效）｜**误报**（引用同轮机检证据的精确 `key=value` 原文驳回）。
> 误报依据三选一：`render-r<N>.txt :: key=value`、`hard-r<N>.txt :: key=value`、`adhoc-r<N>-<k>.txt :: key=value`（后者必须由 `kekkai adhoc` 落盘并列于 `manifest-r<N>.json.adhoc[]`；同一主张不得两轮都靠临时测量驳回——把指标加进量具）。
> `noise: artifact unchanged r<N-1>→r<N>` 只在两轮 `ARTIFACT_SHA256` 相同且尾部 ≥ 4 轮 hard PASS + 去重后 P0=0 + 新增 P1>0 时可作「不修」依据；P0 永不适用。修主观 P1 时当轮在「已拍板取舍」写一行方向，否则下一轮的反向意见只能按新增算。
> ⚠️ 本文件由 Kekkai 起一个**空台账**：下面各表只有表头、没有预填的决策行；soft 为 null 的 gate 前四张表永远只有表头。轮 0 仅用于父闸继承或开跑前已有的人类决策。

## 已拍板取舍（命中=不再翻案）
| 轮 | 项 | 决定 | 理由 |
|---:|---|---|---|
| 0 | 设置状态标识 | 在齿轮旁常驻“已自定义”文字摘要，并同步齿轮的无障碍名称；保留小点作为辅助状态 | P1-R2-01 有效：裸点无法表达“设置已启用或已改动”；继承自 phone-calculator-score-tally-settings-111912 |
| 0 | 自动确认撤回提示 | 有已确认操作数时显示“按退格可撤回上一笔”的行内提示；不做带时限的撤回按钮 | P1-R2-02 有效：让用户知道如何取回自动收走的数字，同时不增加新的定时状态；继承自 phone-calculator-score-tally-settings-111912 |
| 0 | 撤回提示的对象 | 当前有输入时明示“退格先修改当前输入；清空后再撤回”，无输入时点名将撤回的操作数 | P1-R3-01 有效：消除待确认态下退格对象的歧义；继承自 phone-calculator-score-tally-settings-111912 |
| 0 | 空算式预览的标识 | 空算式框显示低对比度“算式会显示在这里”，输入框继续用占位提示标识自身 | P1-R4-01 有效：用户可区分输入框与算式预览，不增加额外控件；继承自 phone-calculator-score-tally-settings-111912 |
| 0 | 当前运算符回显 | 右上按钮显示“运算：<op>”并更新无障碍名称；当前运算符键保持青色选中态 | P1-R5-01 有效：让当前模式可见且可直接重选，不改变既有状态机；继承自 phone-calculator-score-tally-settings-111912 |
| 0 | 撤回提示的视觉权重 | 将既有行内撤回提示升级为琥珀色恢复条，文案目标前置并区分“直接退格”与“先清空当前输入” | P1-R7-01 有效：保留已拍板的行内提示方向，同时让关键恢复路径在计时中可见；继承自 phone-calculator-score-tally-settings-111912 |
| 3 | 确认键可见标签 | 将主键盘“回车”改为可见的“确认”，保留物理回车行为；同步无障碍名称、隐藏提示与编辑提示 | P1-R3-02 有效：S3 主提示隐藏，用户需从按键本身区分“确认输入”与“= 计算” |

## 不修 + 原因（命中=不计入、不修）
| 轮 | 项 | 不修原因 |
|---:|---|---|
| 1 | P2-R1-01 进度条底轨 | 纯 P2 偏好；进度条已以可见 2px、`data-active=true` 与倒计时文字提供计时反馈，不新增工作 |
| 1 | P2-R1-02 320px 顶部说明换行 | 纯 P2 偏好；实测 S4 `doc_overflow=0`、`body_overflow=0`，控件仍 ≥44px，不新增工作 |
| 2 | P2-R2-01 设置状态摘要 | 纯 P2 且重复轮 0「设置状态标识」已拍板方向；当前摘要与小点保留，不新增工作 |
| 2 | P2-R2-02 进度条底轨 | 纯 P2 且重复 P2-R1-01；计时反馈已有 2px 活动条与倒计时文字，不新增工作 |
| 2 | P2-R2-03 撤回提示视觉权重 | 纯 P2 且反向于轮 0「撤回提示的视觉权重」已拍板方向；不翻案、不新增工作 |
| 3 | P2-R3-01 进度条底轨 | 纯 P2 且重复 P2-R1-01；计时反馈已有 2px 活动条与倒计时文字，不新增工作 |
| 3 | P2-R3-02 撤回提示 | 纯 P2 且反向于轮 0「撤回提示的视觉权重」已拍板方向；不翻案、不新增工作 |
| 4 | P2-R4-01 运算类型入口 | 纯 P2；现有入口已有选中态与无障碍名称，未影响 H7 或主流程，不新增工作 |
| 5 | P2-R5-01 运算类型入口 | 纯 P2 且重复 P2-R4-01；现有选中态与无障碍名称已足够，不新增工作 |
| 5 | P2-R5-02 设置状态摘要 | 纯 P2 且重复轮 0「设置状态标识」已拍板方向；不新增工作 |
| 5 | P2-R5-03 计时进度 | 纯 P2 且重复 P2-R1-01；2px 活动条与倒计时文字仍提供反馈，不新增工作 |

## 评审误报（本轮机证=驳回、不计入）
| 轮 | 误报 | 机检证据 | 复核结论 |
|---|---|---|---|

## 软闸 finding 处置
| 轮 | Finding ID | 处置 | 依据 |
|---:|---|---|---|
| 1 | P1-R1-01 | 台账命中 | 设置状态标识 |
| 1 | P1-R1-02 | 台账命中 | 撤回提示的视觉权重 |
| 3 | P1-R3-01 | 台账命中 | 设置状态标识 |
| 3 | P1-R3-02 | 有效 | 主屏提示在 S3 隐藏；已改可见确认键并同步提示 |
| 4 | P1-R4-01 | 台账命中 | 确认键可见标签 |
| 4 | P1-R4-02 | 台账命中 | 设置状态标识 |
| 5 | P1-R5-01 | 台账命中 | 确认键可见标签 |
| 5 | P1-R5-02 | 台账命中 | 撤回提示的视觉权重 |

---

## 轮次台账
| 轮 | 修了什么 | 硬闸 | 软闸 P0/P1/P2 | 去重后 P0 | 台账外新增 P1 |
|---|---|---|---|---:|---:|
| 1 | 未改业务树；独立复验父闸 r8 字节 | PASS | 0/2/2 | 0 | 0 |
| 2 | 未改业务树；宿主修复后重建 era 2 量具并复验同一字节 | PASS | 0/0/3 | 0 | 0 |
| 3 | 未改业务树；r3 软闸发现确认键语义缺口 | PASS | 0/2/2 | 0 | 1 |
| 4 | 确认键改为“确认”并同步提示；重验新字节 | PASS | 0/2/1 | 0 | 0 |
| 5 | 未改业务树；同字节确认轮 | PASS | 0/2/3 | 0 | 0 |
<!-- 每轮一行，只记 runner 提升的轮（尝试不记）。硬闸列 PASS 或 FAIL(Hx,…)；软闸列 `x/y/z`（soft-r<N>.txt 的 raw 数）或 `—: <原因>`（真实缺口，计轮不进 K 尾）；两个派生数由处置表计算，不能自报；soft 为 null 的 gate 后三列写 `—`。 -->

## 验证资产
<!-- 自由文本：baseline 文件、量具说明、adhoc 测量说明。runner 写入的 `INSTRUMENT: disagreement@r<N> H<k> final=FAIL verify=PASS` 行落在这里；era 由 evidence/instruments/instruments.jsonl 证明，不要求手记；尝试由 evidence/attempts/index.jsonl 证明，不要求手记。 -->
INSTRUMENT: disagreement@r1 H1 final=FAIL verify=PASS
INSTRUMENT: disagreement@r1 H2 final=FAIL verify=PASS
INSTRUMENT: disagreement@r1 H3 final=FAIL verify=PASS
INSTRUMENT: disagreement@r1 H4 final=FAIL verify=PASS
INSTRUMENT: disagreement@r1 H5 final=FAIL verify=PASS
INSTRUMENT: disagreement@r1 H6 final=FAIL verify=PASS
INSTRUMENT: disagreement@r1 H7 final=FAIL verify=PASS
INSTRUMENT: disagreement@r1 H8 final=FAIL verify=PASS
INSTRUMENT: disagreement@r1 H9 final=FAIL verify=PASS
r1：硬量具 9/9 PASS；独立 audit final 在 Playwright `chromium.launch` 阶段被宿主的 final `workspace-write` 沙箱拒绝（`sandbox_host_linux.cc:41 ... shutdown: Operation not permitted` / SIGTRAP），未进入页面断言，不是产物行为 FAIL。软闸因 AGY 缺失按 admitted fallback 使用 Codex，`soft-r1.txt` 为 0/2/2，两条 P1 均命中轮 0 取舍。
r1 恢复：宿主修复 `/root/.codex/config.toml` 增加 `[sandbox_workspace_write] network_access = true`；随后在相同 `workspace-write` 沙箱内直跑 Playwright 探针得到 `PROBE_PASS 156.0.8078.4 state=select`，Chromium 已可启动。原 blocked STOP 保留如下供审计，清终端标记后从 r1 证据恢复：`STOP: rounds=1 reason=blocked by=host` / `blocker: The Codex audit-final workspace-write sandbox cannot launch Playwright Chromium (sandbox_host_linux.cc:41 shutdown: Operation not permitted / SIGTRAP); a host administrator must permit Chromium in that final sandbox and then resume from the r1 evidence on the repaired host with a fresh recast/final.`
r2（era 2）：独立量具 9/9 PASS，独立 audit final 9/9 PASS（H1–H9），软闸 Codex fallback 0/0/3；三条 P2 均为已拍板方向或既有 P2 重复偏好，台账外新增 P1=0。
r3：硬闸 replay 9/9 PASS；软闸 Codex fallback 0/2/2。P1-R3-01 命中轮 0 设置状态标识；P1-R3-02 有效——S3 中 `#calc-hint` 隐藏，可见操作只有“回车”与“=”，故将确认键可见文字改为“确认”，并同步 aria、隐藏提示与编辑提示。修改后共享套件 18/18、206/206 PASS，320px `doc_overflow=0`、`body_overflow=0`。
r4：新字节（`31d7e739…`）hard replay 9/9 PASS，独立 terminal final 9/9 PASS，软闸 Codex fallback 0/2/1。P1-R4-01 与轮 3 已拍板的确认键方向同主张（仅建议更强措辞），P1-R4-02 与轮 0 设置状态标识同主张，均按台账命中；台账外新增 P1=0。
r5：同字节 hard replay 9/9 PASS，软闸 Codex fallback 0/2/3；P1-R5-01 命中轮 3 确认键方向，P1-R5-02 命中轮 0 撤回提示视觉权重，三条 P2 均为既有偏好重复；台账外新增 P1=0。r4 terminal final 与当前 `ARTIFACT_SHA256`/`TREE_SHA256` 相同，可复用为停止候选 final。

## 停止
<!-- 恰好一条机器行，二选一：
     `STOP: rounds=<N> reason=converged P0=0`（soft 为 null 的 gate 省略 P0=；须先把 frontmatter status 改为 converged）
     `STOP: rounds=<N> reason=blocked by=<budget|host|instrument|oscillation|human>`，下一非空行 `blocker: <缺什么、谁能解除、从哪继续>`（N 可为 0；status 保持 in-loop；推荐用 `kekkai close` 写入）。 -->
STOP: rounds=5 reason=converged P0=0
