# 决策台账 · phone-calculator-number-entry-2-111723

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
| 1 | 未改业务代码；全新独立量具复核当前 `index.html` | PASS | — | — | — |
<!-- 每轮一行，只记 runner 提升的轮（尝试不记）。硬闸列 PASS 或 FAIL(Hx,…)；软闸列 `x/y/z`（soft-r<N>.txt 的 raw 数）或 `—: <原因>`（真实缺口，计轮不进 K 尾）；两个派生数由处置表计算，不能自报；soft 为 null 的 gate 后三列写 `—`。 -->

## 验证资产
<!-- 自由文本：baseline 文件、量具说明、adhoc 测量说明。runner 写入的 `INSTRUMENT: disagreement@r<N> H<k> final=FAIL verify=PASS` 行落在这里；era 由 evidence/instruments/instruments.jsonl 证明，不要求手记；尝试由 evidence/attempts/index.jsonl 证明，不要求手记。 -->
- 前置 gate：`/ws/cal_phone/Telos/phone-calculator-number-entry-111612/`，`STOP: rounds=4 reason=blocked by=instrument`。其 round 4 在 artifact `d97565f096ed1c336eae9eac9ec75b1cc980bef6c0318027018a3f2291a8486a` 上 `HARD: PASS`，H1–H12 全 PASS；但 era 3 量具的非注释代码只含字面 H2，缺少 lint 要求的字面 H1、H3–H12，且 era 上限 3 已用尽无法 recast，独立 final 又因宿主内存终止未完成，故 blocked by=instrument。本 gate 从相同业务字节重新开始，不复用其量具、证据或终态；本 gate 的量具必须在非注释代码中包含字面 H1..H12。
- 轮 0 人类决策（沿自上一闸）：H6 的期望是 `history=2；前一条历史快照不变`，因为 `+12/30/8=50` 产生一条三操作数记录、随后 `+5/6=11` 产生第二条；H12 的 3 条记录来自三次计算，保持不变。
- 轮 1（era 1）：`evidence/instruments/verify-740e268e.mjs`（sha256 `740e268e…`）在 artifact `d97565f0…` / tree `6185a012…` 上 H1–H12 全 PASS；同 era 独立 final 在相同 artifact/tree 字节上复验 H1–H12 全 PASS。

## 停止
<!-- 恰好一条机器行，二选一：
     `STOP: rounds=<N> reason=converged P0=0`（soft 为 null 的 gate 省略 P0=；须先把 frontmatter status 改为 converged）
     `STOP: rounds=<N> reason=blocked by=<budget|host|instrument|oscillation|human>`，下一非空行 `blocker: <缺什么、谁能解除、从哪继续>`（N 可为 0；status 保持 in-loop；推荐用 `kekkai close` 写入）。 -->

STOP: rounds=1 reason=converged
