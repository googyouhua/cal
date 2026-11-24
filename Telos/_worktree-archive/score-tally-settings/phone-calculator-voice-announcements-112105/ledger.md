# 决策台账 · phone-calculator-voice-announcements-112105

> 教义与守卫见 `docs/CREED.md` Keystone 4；本文件是收敛引擎，不是日记。每条软闸 P0/P1 在「软闸 finding 处置」恰好一行：**有效**（台账外且复核为真——唯一算数、必修的一种）｜**台账命中**（命中**更早轮次**的已拍板/不修，按主张不按措辞，本轮写入的决策下一轮才生效）｜**误报**（引用同轮机检证据的精确 `key=value` 原文驳回）。
> 误报依据三选一：`render-r<N>.txt :: key=value`、`hard-r<N>.txt :: key=value`、`adhoc-r<N>-<k>.txt :: key=value`（后者必须由 `kekkai adhoc` 落盘并列于 `manifest-r<N>.json.adhoc[]`；同一主张不得两轮都靠临时测量驳回——把指标加进量具）。
> `noise: artifact unchanged r<N-1>→r<N>` 只在两轮 `ARTIFACT_SHA256` 相同且尾部 ≥ 4 轮 hard PASS + 去重后 P0=0 + 新增 P1>0 时可作「不修」依据；P0 永不适用。修主观 P1 时当轮在「已拍板取舍」写一行方向，否则下一轮的反向意见只能按新增算。
> ⚠️ 本文件由 Kekkai 起一个**空台账**：下面各表只有表头、没有预填的决策行；soft 为 null 的 gate 前四张表永远只有表头。轮 0 仅用于父闸继承或开跑前已有的人类决策。

## 已拍板取舍（命中=不再翻案）
| 轮 | 项 | 决定 | 理由 |
|---:|---|---|---|
| 4 | 语音进度条的就绪/失败呈现 | 保留进度元素并在就绪显示绿色「已完成」、失败显示红色「已中断」，不隐藏它 | H9 要求 error 态 `voice-progress` 仍 visible 且矩形在视口内，故用明确状态标签和颜色消除「仍在进行」歧义 |
| 5 | 主界面摘要胶囊的语义 | 就绪时文本保持「已自定义」（H1 强制），语音可用性用胶囊内状态图标（✓/…/!）独立表达；加载/失败文本按 §2 显示「语音准备中 / 语音不可用」 | H1 要求 ready 的 `settings-summary` 文本精确为「已自定义」，§2 又要求加载/失败显示语音状态；图标把配置与可用性拆开且不改变 textContent |
| 5 | 语音组信息层级 | 实时状态、进度、重试置于语音组首位；96MB 提示保留在开关之前但作为次级说明 | 先让用户看到就绪/失败与重试，同时首次开启前仍能看到下载成本与静音/非商用限制 |

## 不修 + 原因（命中=不计入、不修）
| 轮 | 项 | 不修原因 |
|---:|---|---|

## 评审误报（本轮机证=驳回、不计入）
| 轮 | 误报 | 机检证据 | 复核结论 |
|---|---|---|---|

## 软闸 finding 处置
| 轮 | Finding ID | 处置 | 依据 |
|---:|---|---|---|
| 3 | P1-R3-01 | 有效 | 失败行暴露英文内部串；改为中文可行动原因并把原始错误折叠到「技术详情」 |
| 4 | P1-R4-01 | 有效 | 就绪/失败态进度条改为带「已完成 / 已中断」文字与绿/红状态的明确标记 |
| 4 | P1-R4-02 | 有效 | 96MB 下载与静音、非商用提示提为开关上方的琥珀色主提示 |
| 5 | P1-R5-01 | 有效 | 胶囊文本继续保持 ready=已自定义，新增 ✓/…/! 可用性图标，拆开配置状态与语音状态 |
| 5 | P1-R5-02 | 有效 | 语音状态、进度、重试移到组首；96MB 提示仍在开关之前但降为次级说明 |

---

## 轮次台账
| 轮 | 修了什么 | 硬闸 | 软闸 P0/P1/P2 | 去重后 P0 | 台账外新增 P1 |
|---|---|---|---|---:|---:|
| 1 | 实现语音播报、语音资源安装/服务脚本、部署长缓存与文档 | PASS | —: 审计 final H8 FAIL（install cp 在只读挂载上重写相同资源） | — | — |
| 2 | 安装脚本改为幂等：已存在的相同资源跳过写入，修复 final H8 | PASS | —: 软闸 EVIDENCE_INCOMPLETE（S3 截图未呈现失败原因/重试） | — | — |
| 3 | 失败态把语音组前置，320px S3 首屏可见失败原因/重试；恢复关闭 dialog 的 display | PASS | 0/1/2 | 0 | 1 |
| 4 | P1-R3-01：失败行改中文可行动原因，原始错误折叠到「技术详情」 | PASS | 0/2/1 | 0 | 2 |
| 5 | P1-R4-01/02：进度条加状态标签与绿/红态；96MB 提示提到开关上方 | PASS | 0/2/2 | 0 | 2 |
| 6 | P1-R5-01/02：胶囊加语音可用性图标；语音状态/进度/重试前置；进度条加高加对比；提示短语不可断行 | PASS | 0/0/3 | 0 | 0 |
| 7 | 无业务代码改动；重放同一 current bytes 并复跑软闸 | PASS | 0/0/2 | 0 | 0 |
<!-- 每轮一行，只记 runner 提升的轮（尝试不记）。硬闸列 PASS 或 FAIL(Hx,…)；软闸列 `x/y/z`（soft-r<N>.txt 的 raw 数）或 `—: <原因>`（真实缺口，计轮不进 K 尾）；两个派生数由处置表计算，不能自报；soft 为 null 的 gate 后三列写 `—`。 -->

## 验证资产
<!-- 自由文本：baseline 文件、量具说明、adhoc 测量说明。runner 写入的 `INSTRUMENT: disagreement@r<N> H<k> final=FAIL verify=PASS` 行落在这里；era 由 evidence/instruments/instruments.jsonl 证明，不要求手记；尝试由 evidence/attempts/index.jsonl 证明，不要求手记。 -->
INSTRUMENT: disagreement@r1 H8 final=FAIL verify=PASS

## 停止
<!-- 恰好一条机器行，二选一：
     `STOP: rounds=<N> reason=converged P0=0`（soft 为 null 的 gate 省略 P0=；须先把 frontmatter status 改为 converged）
     `STOP: rounds=<N> reason=blocked by=<budget|host|instrument|oscillation|human>`，下一非空行 `blocker: <缺什么、谁能解除、从哪继续>`（N 可为 0；status 保持 in-loop；推荐用 `kekkai close` 写入）。 -->
STOP: rounds=7 reason=converged P0=0
