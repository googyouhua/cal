# 决策台账 · roster-import-v2-112203

> 教义与守卫见 `docs/CREED.md` Keystone 4；本文件是收敛引擎，不是日记。每条软闸 P0/P1 在「软闸 finding 处置」恰好一行：**有效**（台账外且复核为真——唯一算数、必修的一种）｜**台账命中**（命中**更早轮次**的已拍板/不修，按主张不按措辞，本轮写入的决策下一轮才生效）｜**误报**（引用同轮机检证据的精确 `key=value` 原文驳回）。
> 误报依据三选一：`render-r<N>.txt :: key=value`、`hard-r<N>.txt :: key=value`、`adhoc-r<N>-<k>.txt :: key=value`（后者必须由 `kekkai adhoc` 落盘并列于 `manifest-r<N>.json.adhoc[]`；同一主张不得两轮都靠临时测量驳回——把指标加进量具）。
> `noise: artifact unchanged r<N-1>→r<N>` 只在两轮 `ARTIFACT_SHA256` 相同且尾部 ≥ 4 轮 hard PASS + 去重后 P0=0 + 新增 P1>0 时可作「不修」依据；P0 永不适用。修主观 P1 时当轮在「已拍板取舍」写一行方向，否则下一轮的反向意见只能按新增算。
> ⚠️ 本文件由 Kekkai 起一个**空台账**：下面各表只有表头、没有预填的决策行；soft 为 null 的 gate 前四张表永远只有表头。轮 0 仅用于父闸继承或开跑前已有的人类决策。

## 已拍板取舍（命中=不再翻案）
| 轮 | 项 | 决定 | 理由 |
|---:|---|---|---|
| 0 | 导入方式 | 预览里让用户选「保留同学号成绩 / 清空重录」；可保留时默认保留 | 用户故事 2 需要改名重导不丢成绩；破坏性操作必须显式选择，避免换班时静默带入旧成绩（规格 §5 导入语义 C） |
| 0 | 合并键 | 只认所选学号列，按去首尾空白后的原字符串精确匹配；任一侧出现重复非空学号就禁用保留 | 姓名可能重复/改名，不能做键；重复学号是数据错误，不替用户隐式挑一条（规格 §5 合并键） |
| 0 | 列映射 | 表头别名只作默认值，预览固定显示四个手动下拉；确认时存 `roles`，导出按 `roles` 写回 | 自定义表头（`编号`/`总分`）必须能正确映射与导出；只存 `headers` 认不出角色还会重复补列（规格 §5 列映射） |
| 0 | 文件里的成绩 | 永不采用；保留的是本机 `entry` | 避免文件旧成绩覆盖本机新成绩；代价是导出文件不能当存档恢复，已明确接受（规格 §5 文件里的成绩） |
| 0 | 编辑 | 复用现有计算器草稿并浮动到行旁；名单模式编辑中阻止切换目标，先保存或取消 | 一套求值/基数/操作数逻辑；浮动草稿在手机上不用滚回键盘；阻止切换避免未保存数字被静默丢弃（规格 §5 编辑、编辑目标切换） |
| 0 | 结果后暂停 | 名单模式保留结果后暂停；想快由用户把设置改为 0 | 与既有设置语义一致，防止下一位数字抢到上一位结果后面；用户已明确要求保留（规格 §5 结果后暂停） |
| 0 | 自动等号 | 满 N 笔自动算一次成功计算并照常回填、推进下一位 | 与「满 N 笔自动算」的意图一致；结果后暂停给一拍确认（规格 §5 自动按等号） |
| 0 | 语音 | v1 只念结果，不念姓名/序号/下一位；导入确认丢弃未播放的按键/结果任务 | 现有引擎对姓名/生僻字可能 OOV；不把语音与名单耦合，只保证名单模式仍念结果（规格 §5 语音） |
| 0 | 对话框与键盘 | 导入对话框打开时停自动确认，自动确认 guard 与物理键盘 keydown 都直接返回 | 否则重导入预览时会在背后写旧名单、物理键盘会改计算器，破坏「取消不变」（规格 §5 对话框与计时/键盘） |
| 0 | 布局 | 手机一律两行卡片，按整页滚动，不做 5 列表格或列表内部滚动区 | 320/390 都不挤；计算器始终在上方（规格 §5 布局） |
| 0 | 导出 | 只导成绩列，不加算式列；BOM + CRLF；缺序号前补、缺成绩后补 | 交付物是分数表，算式留在页面可查；加算式列会改变交付格式（规格 §5 导出） |
| 0 | 不做名单级撤回 | 误录用行内编辑改 | 少一个状态；行内编辑已覆盖改错需求（规格 §5 撤回） |
| 0 | 只做 CSV 与粘贴入口 | 不解析 xlsx；文件与粘贴共用同一套解析/映射/预览 | 浏览器读 xlsx 需打包依赖或自解 zip+XML，违背单文件；手机上班群名单常是文本（规格 §2.1.1、§5 粘贴） |
| 0 | 无名单模式 | 保持现状：历史最新在上、刷新清空、无序号、编辑追加、草稿按钮「关闭」 | 现有测试与用户习惯不动；名单模式是叠加而非替换（规格 §2.7、§6） |

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
|---|---|---|---|---|---:|---:|
<!-- 每轮一行，只记 runner 提升的轮（尝试不记）。硬闸列 PASS 或 FAIL(Hx,…)；软闸列 `x/y/z`（soft-r<N>.txt 的 raw 数）或 `—: <原因>`（真实缺口，计轮不进 K 尾）；两个派生数由处置表计算，不能自报；soft 为 null 的 gate 后三列写 `—`。 -->

## 验证资产
<!-- 自由文本：baseline 文件、量具说明、adhoc 测量说明。runner 写入的 `INSTRUMENT: disagreement@r<N> H<k> final=FAIL verify=PASS` 行落在这里；era 由 evidence/instruments/instruments.jsonl 证明，不要求手记；尝试由 evidence/attempts/index.jsonl 证明，不要求手记。 -->
- 生成时基线（2026-11-22，`/ws/cal_phone` 分支 `score-tally-settings`，`HEAD=c86d40a`）：`index.html` sha256 `a275e40bf0e85ec0e86bc8bda88bee15a5bde4048677594d113e1c4a31371a14`；`tests/suite.mjs` 18/18 PASS；`tests/voice/run.mjs` 固定 3 个既有失败 check：`result.crash`、`queue.quick-no-result`、`queue.quick-keys`（其余 63 checks PASS）。
- 冻结字节（H10）：`tests/scenarios/core.mjs` `2b35cce880e336882e384e940d28b103acc270a7931552dea5d5c9c79c9eeb7e`；`continuity.mjs` `d53f1a4ce357bb200a4e811aa45d3dad187d40279c5f747c7ebb38c28e810a56`；`edit.mjs` `f61188e63586e8afa2883f6db3d3e88f7cc216a9a0c8dc7d465953ad37ceadc1`；`layout.mjs` `c96ed96499a18b9731a8e10dabb579a761d445534105caabfa7424803def65a0`；`determinism.mjs` `64bc09c49ac56c21aef77bdd1a7f7c365b8791d0690076f5964b58f06e69ddff`；`tests/voice/run.mjs` `dcc96cc884f469fa18b5defd486adc30250c5ae24d9b7f58630d16d485d11733`。
- 历史参考（不作验收）：`/ws/cal_phone-worktrees/roster-import` 分支提交 `250e966` 与归档 `/ws/cal_phone/Telos/_worktree-archive/roster-import/roster-import-111913/verified-artifact/index.html` 有旧规格实现，缺少当前计算特性与本修订版的四下拉/粘贴/导入方式。

## 停止
<!-- 恰好一条机器行，二选一：
     `STOP: rounds=<N> reason=converged P0=0`（soft 为 null 的 gate 省略 P0=；须先把 frontmatter status 改为 converged）
     `STOP: rounds=<N> reason=blocked by=<budget|host|instrument|oscillation|human>`，下一非空行 `blocker: <缺什么、谁能解除、从哪继续>`（N 可为 0；status 保持 in-loop；推荐用 `kekkai close` 写入）。 -->
STOP: rounds=0 reason=blocked by=instrument
blocker: hard author (codex exec muse-spark-1.3-contributor, max effort) dies silently ~28min into every r1 attempt (2 timeouts + 1 orphan, 0 canonical rounds, exit-3 ATTEMPT_LIMIT recorded so hard/recast both refuse), and H10's frozen voice asserts (18 scenarios/206 checks) contradict the mandated 29-id suite; infra owner must restore a reliable 40-min author run and the gate author must reconcile the H10 voice counts, then resume on the unchanged tree with kekkai hard
