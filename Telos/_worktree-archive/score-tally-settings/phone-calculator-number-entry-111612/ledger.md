# 决策台账 · phone-calculator-number-entry-111612

> 教义与守卫见 `docs/CREED.md` Keystone 4；本文件是收敛引擎，不是日记。每条软闸 P0/P1 在「软闸 finding 处置」恰好一行：**有效**（台账外且复核为真——唯一算数、必修的一种）｜**台账命中**（命中**更早轮次**的已拍板/不修，按主张不按措辞，本轮写入的决策下一轮才生效）｜**误报**（引用同轮机检证据的精确 `key=value` 原文驳回）。
> 误报依据三选一：`render-r<N>.txt :: key=value`、`hard-r<N>.txt :: key=value`、`adhoc-r<N>-<k>.txt :: key=value`（后者必须由 `kekkai adhoc` 落盘并列于 `manifest-r<N>.json.adhoc[]`；同一主张不得两轮都靠临时测量驳回——把指标加进量具）。
> `noise: artifact unchanged r<N-1>→r<N>` 只在两轮 `ARTIFACT_SHA256` 相同且尾部 ≥ 4 轮 hard PASS + 去重后 P0=0 + 新增 P1>0 时可作「不修」依据；P0 永不适用。修主观 P1 时当轮在「已拍板取舍」写一行方向，否则下一轮的反向意见只能按新增算。
> ⚠️ 本文件由 Kekkai 起一个**空台账**：下面各表只有表头、没有预填的决策行；soft 为 null 的 gate 前四张表永远只有表头。轮 0 仅用于父闸继承或开跑前已有的人类决策。

## 已拍板取舍（命中=不再翻案）
| 轮 | 项 | 决定 | 理由 |
|---:|---|---|---|

## 不修 + 原因（命中=不计入、不修）
| 轮 | 项 | 不修原因 |
|---:|---|---|

## 评审误报（本轮机证=驳回、不计入）
| 轮 | 误报 | 机检证据 | 复核结论 |
|---|---|---|---|

## 软闸 finding 处置
| 轮 | Finding ID | 处置 | 依据 |
|---:|---|---|---|

---

## 轮次台账
| 轮 | 修了什么 | 硬闸 | 软闸 P0/P1/P2 | 去重后 P0 | 台账外新增 P1 |
|---|---|---|---|---:|---:|
<!-- 每轮一行，只记 runner 提升的轮（尝试不记）。硬闸列 PASS 或 FAIL(Hx,…)；软闸列 `x/y/z`（soft-r<N>.txt 的 raw 数）或 `—: <原因>`（真实缺口，计轮不进 K 尾）；两个派生数由处置表计算，不能自报；soft 为 null 的 gate 后三列写 `—`。 -->
| 1 | 冷启动启用数字键；首字符进入输入态；先输入后选运算符保留数字；恢复 document 级数字、退格、回车和等号键盘输入 | FAIL(H6,H10) | — | — | — |
| 2 | 所有可见控件字号提升到 ≥16px；无运算符提交表达式只显示数字，不再泄露 `undefined` | FAIL(H6) | — | — | — |
| 3 | era 2 独立复核当前字节；除 H6 历史计数矛盾外 H1–H5、H7–H12 全部通过 | FAIL(H6) | — | — | — |
| 4 | era 3 量具按修正后的 H6 契约复核当前字节；H1–H12 全 PASS（产品未再改动；独立终审因宿主内存终止未完成） | PASS | — | — | — |

## 验证资产
<!-- 自由文本：baseline 文件、量具说明、adhoc 测量说明。runner 写入的 `INSTRUMENT: disagreement@r<N> H<k> final=FAIL verify=PASS` 行落在这里；era 由 evidence/instruments/instruments.jsonl 证明，不要求手记；尝试由 evidence/attempts/index.jsonl 证明，不要求手记。 -->
- 前置 gate（跨 worktree）：`/ws/cal_phone-worktrees/keypad/Telos/phone-calculator-keypad-111513/`，STOP `rounds=2 reason=converged`，r2 artifact `630392827703060cfbccdefc549b71db6ec2656fb7870a20901aa7b6352d02a1`（与当前 `/ws/cal_phone/index.html` 相同）。其量具点击真实 `[data-key]` 并通过；其 H3/H6 契约要求 select 态数字键禁用、物理键盘键入无效，本闸 H2/H5 有意反转。该 gate 目录在 worktree 中未跟踪，合并提交 `48692eb` 只带回 `index.html`，因此主 worktree 无此证据；不要把它拷入本仓（路径与 TREE_SHA256 不匹配）。
- 轮 3 `blocked by=human` 已由人类决策解除：原 H6 契约写 `history=3；前两条历史快照`，与它自己的两次计算序列矛盾（`+12/30/8=50` 产生一条三操作数记录，随后 `+5/6=11` 产生第二条；H12 的 3 条是三次计算）。现改为 `history=2；前一条历史快照`，H12 不变。原 blocker 与停止原因保留在 `naraku/report.json`。旧量具（era 2）硬编码 `expectedHistory=3`，按修正后的契约重铸为 era 3，从 round 4 继续；旧 STOP 行已移除以便恢复运行，产品代码未因该决策改动。

## 停止
<!-- 恰好一条机器行，二选一：
     `STOP: rounds=<N> reason=converged P0=0`（soft 为 null 的 gate 省略 P0=；须先把 frontmatter status 改为 converged）
     `STOP: rounds=<N> reason=blocked by=<budget|host|instrument|oscillation|human>`，下一非空行 `blocker: <缺什么、谁能解除、从哪继续>`（N 可为 0；status 保持 in-loop；推荐用 `kekkai close` 写入）。 -->
STOP: rounds=4 reason=blocked by=instrument
blocker: era 3 量具非注释代码缺少字面 H1、H3–H12 token（仅 testH1/动态 H${id}），lint --post POST-VERIFY 无法通过；era 上限 3 已用尽，recast 不可用；独立 final 因宿主内存终止未完成。产品字节已由 hard-r4 全 PASS 覆盖。解除者：人类；恢复点：在相同 /ws/cal_phone/index.html 字节上新开 gate（新 era 预算，量具须在非注释代码中写字面 H ID）并从 round 1 重新独立验收。
