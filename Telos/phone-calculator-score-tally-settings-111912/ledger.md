# 决策台账 · phone-calculator-score-tally-settings-111912

> 教义与守卫见 `docs/CREED.md` Keystone 4；本文件是收敛引擎，不是日记。每条软闸 P0/P1 在「软闸 finding 处置」恰好一行：**有效**（台账外且复核为真——唯一算数、必修的一种）｜**台账命中**（命中**更早轮次**的已拍板/不修，按主张不按措辞，本轮写入的决策下一轮才生效）｜**误报**（引用同轮机检证据的精确 `key=value` 原文驳回）。
> 误报依据三选一：`render-r<N>.txt :: key=value`、`hard-r<N>.txt :: key=value`、`adhoc-r<N>-<k>.txt :: key=value`（后者必须由 `kekkai adhoc` 落盘并列于 `manifest-r<N>.json.adhoc[]`；同一主张不得两轮都靠临时测量驳回——把指标加进量具）。
> `noise: artifact unchanged r<N-1>→r<N>` 只在两轮 `ARTIFACT_SHA256` 相同且尾部 ≥ 4 轮 hard PASS + 去重后 P0=0 + 新增 P1>0 时可作「不修」依据；P0 永不适用。修主观 P1 时当轮在「已拍板取舍」写一行方向，否则下一轮的反向意见只能按新增算。
> ⚠️ 本文件由 Kekkai 起一个**空台账**：下面各表只有表头、没有预填的决策行；soft 为 null 的 gate 前四张表永远只有表头。轮 0 仅用于父闸继承或开跑前已有的人类决策。

## 已拍板取舍（命中=不再翻案）
| 轮 | 项 | 决定 | 理由 |
|---:|---|---|---|
| 2 | 设置状态标识 | 在齿轮旁常驻“已自定义”文字摘要，并同步齿轮的无障碍名称；保留小点作为辅助状态 | P1-R2-01 有效：裸点无法表达“设置已启用或已改动” |
| 2 | 自动确认撤回提示 | 有已确认操作数时显示“按退格可撤回上一笔”的行内提示；不做带时限的撤回按钮 | P1-R2-02 有效：让用户知道如何取回自动收走的数字，同时不增加新的定时状态 |
| 3 | 撤回提示的对象 | 当前有输入时明示“退格先修改当前输入；清空后再撤回”，无输入时点名将撤回的操作数 | P1-R3-01 有效：消除待确认态下退格对象的歧义 |
| 4 | 空算式预览的标识 | 空算式框显示低对比度“算式会显示在这里”，输入框继续用占位提示标识自身 | P1-R4-01 有效：用户可区分输入框与算式预览，不增加额外控件 |
| 5 | 当前运算符回显 | 右上按钮显示“运算：<op>”并更新无障碍名称；当前运算符键保持青色选中态 | P1-R5-01 有效：让当前模式可见且可直接重选，不改变既有状态机 |
| 7 | 撤回提示的视觉权重 | 将既有行内撤回提示升级为琥珀色恢复条，文案目标前置并区分“直接退格”与“先清空当前输入” | P1-R7-01 有效：保留已拍板的行内提示方向，同时让关键恢复路径在计时中可见 |

## 不修 + 原因（命中=不计入、不修）
| 轮 | 项 | 不修原因 |
|---:|---|---|

## 评审误报（本轮机证=驳回、不计入）
| 轮 | 误报 | 机检证据 | 复核结论 |
|---|---|---|---|

## 软闸 finding 处置
| 轮 | Finding ID | 处置 | 依据 |
|---:|---|---|---|
| 1 | P1-R1-01 | 有效 | Auto-confirm has a visible active line but no countdown/remaining-time text; needs a clear "N seconds until confirm" treatment in a later round. Deferred only because the independent final cannot be completed on r1 under the current attempt cap. |
| 2 | P1-R2-01 | 有效 | The gear still had only an unexplained gold dot; r3 adds the persistent “已自定义” summary beside it. |
| 2 | P1-R2-02 | 有效 | Auto-confirm gave no visible recovery affordance; r3 adds an inline backspace-to-undo hint whenever confirmed operands exist. |
| 3 | P1-R3-01 | 有效 | The pending-entry hint did not identify whether backspace edits 9.2 or withdraws the confirmed 9.5; r4 makes the hint state-aware and names the withdrawable operand. |
| 4 | P1-R4-01 | 有效 | S1's lower dark box had no visible label; r5 adds an empty-state formula placeholder while the input keeps its own placeholder. |
| 4 | P1-R4-02 | 台账命中 | 已拍板取舍 r2「自动确认撤回提示」，同一主张换了措辞 |
| 5 | P1-R5-01 | 有效 | The selected operator was only inferable from the formula; r6 exposes “运算：<op>” and a persistent pressed state on the active key. |
| 6 | P1-R6-01 | 台账命中 | 已拍板取舍 r2「设置状态标识」，同一主张换了措辞 |
| 6 | P1-R6-02 | 台账命中 | 已拍板取舍 r2「自动确认撤回提示」，同一主张换了措辞 |
| 7 | P1-R7-01 | 有效 | The inline hint was low-contrast during the timer; r8 promotes it to a high-contrast recovery strip without adding the rejected timed button. |
| 8 | P1-R8-01 | 误报 | adhoc-r8-1.txt :: S1_plus_equals_S3_plus_border=false |
| 8 | P1-R8-02 | 台账命中 | 已拍板取舍 r2「设置状态标识」，同一主张换了措辞 |
| 8 | P1-R8-03 | 台账命中 | 已拍板取舍 r2「自动确认撤回提示」，同一主张换了措辞 |

---

## 轮次台账
| 轮 | 修了什么 | 硬闸 | 软闸 P0/P1/P2 | 去重后 P0 | 台账外新增 P1 |
|---|---|---|---|---:|---:|
<!-- 每轮一行，只记 runner 提升的轮（尝试不记）。硬闸列 PASS 或 FAIL(Hx,…)；软闸列 `x/y/z`（soft-r<N>.txt 的 raw 数）或 `—: <原因>`（真实缺口，计轮不进 K 尾）；两个派生数由处置表计算，不能自报；soft 为 null 的 gate 后三列写 `—`。 -->

| 1 | Recovered the host-tamper block and canonicalized the existing implementation; no additional product edits in this invocation | PASS | 0/1/2 | 0 | 1 |
| 2 | Added explicit auto-confirm countdown text and split the timer into a track plus draining fill; retired the era-1 instrument and promoted era 2 | PASS | 0/2/3 | 0 | 2 |
| 3 | Added the persistent “已自定义” settings summary and an inline backspace-to-undo hint after confirmed operands | PASS | 0/1/3 | 0 | 1 |
| 4 | Made the undo hint name the live-input-first behavior and the exact withdrawable operand; clarified the countdown sentence | PASS | 0/2/2 | 0 | 1 |
| 5 | Added the empty-state formula placeholder so the input and formula preview are distinguishable | PASS | 0/1/1 | 0 | 1 |
| 6 | Exposed the current operator in the top control and kept the active operator key visibly selected | PASS | 0/2/3 | 0 | 0 |
| 7 | Confirmation round on unchanged r6 bytes; no product edits | PASS | 0/1/4 | 0 | 1 |
| 8 | Promoted the inline undo guidance to a high-contrast recovery strip with target-first wording | PASS | 0/3/2 | 0 | 0 |

## 验证资产
<!-- 自由文本：baseline 文件、量具说明、adhoc 测量说明。runner 写入的 `INSTRUMENT: disagreement@r<N> H<k> final=FAIL verify=PASS` 行落在这里；era 由 evidence/instruments/instruments.jsonl 证明，不要求手记；尝试由 evidence/attempts/index.jsonl 证明，不要求手记。 -->
Recovery 2026-11-19 23:47 UTC: the host-tamper blocker cleared; the blamed process held no repo files and the protected skill files had been unchanged since 13:57 UTC. Prior tamper attempts remain under evidence/attempts/.

Final r1: the instrument PASSed and the supported Playwright path was proved healthy by `adhoc-r1-1.txt :: PROBE_OK 手机计算器 select 0 0`; three independent final attempts nevertheless timed out at 40 minutes after the final model detoured into unsupported direct-Chrome debugging.

Recovery 2026-11-20: the prior blocked terminal was reopened in a fresh executor invocation after `kekkai doctor --gate ... --host` passed. Preserved blocker: `STOP: rounds=1 reason=blocked by=host` — independent final r1 hit the 40-minute cap three times after the pinned final model wedged on direct-Chrome seccomp failures instead of the supported Playwright path; resume work is the product P1 fix plus a fresh instrument era, then final.

Recovery 2026-11-20 (r8): soft r8 findings are dispositioned — P1-R8-01 is a 误报 refuted by `adhoc-r8-1.txt :: S1_plus_equals_S3_plus_border=false`, while P1-R8-02/03 are ledger hits to the r2 settings-status and undo-prompt decisions. `kekkai lint --post` cannot clear `POST-HARD-FINAL`: era 1 r1 and era 2 r2 were each an era-first hard PASS whose audit final was never promoted (r1: three 40-minute final timeouts; r2: `HARD: REFUSED` because host seccomp blocked Chromium), and the runner refuses `kekkai hard --final` for any round but the latest (`exit=4 --final stamps the latest canonical round r8, not r2`). The current r8 bytes pass the instrument and the soft findings add no 有效 P1, but the historical era-first audit evidence cannot be regenerated with this runner, so convergence is not claimable.

## 停止
<!-- 恰好一条机器行，二选一：
     `STOP: rounds=<N> reason=converged P0=0`（soft 为 null 的 gate 省略 P0=；须先把 frontmatter status 改为 converged）
     `STOP: rounds=<N> reason=blocked by=<budget|host|instrument|oscillation|human>`，下一非空行 `blocker: <缺什么、谁能解除、从哪继续>`（N 可为 0；status 保持 in-loop；推荐用 `kekkai close` 写入）。 -->
STOP: rounds=8 reason=blocked by=host
blocker: Missing runner audit finals for era 1 r1 and era 2 r2 (r1 finals timed out; r2 final was HARD: REFUSED because host seccomp blocked Chromium), which kekkai hard --final can no longer produce because it stamps only the latest round r8; a Kekkai maintainer must provide an earlier-round final path or repair the gate history, then resume at r8 with kekkai hard --final on the current bytes.
