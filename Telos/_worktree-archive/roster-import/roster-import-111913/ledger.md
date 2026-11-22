# 决策台账 · roster-import-111913

> 教义与守卫见 `docs/CREED.md` Keystone 4；本文件是收敛引擎，不是日记。每条软闸 P0/P1 在「软闸 finding 处置」恰好一行：**有效**（台账外且复核为真——唯一算数、必修的一种）｜**台账命中**（命中**更早轮次**的已拍板/不修，按主张不按措辞，本轮写入的决策下一轮才生效）｜**误报**（引用同轮机检证据的精确 `key=value` 原文驳回）。
> 误报依据三选一：`render-r<N>.txt :: key=value`、`hard-r<N>.txt :: key=value`、`adhoc-r<N>-<k>.txt :: key=value`（后者必须由 `kekkai adhoc` 落盘并列于 `manifest-r<N>.json.adhoc[]`；同一主张不得两轮都靠临时测量驳回——把指标加进量具）。
> `noise: artifact unchanged r<N-1>→r<N>` 只在两轮 `ARTIFACT_SHA256` 相同且尾部 ≥ 4 轮 hard PASS + 去重后 P0=0 + 新增 P1>0 时可作「不修」依据；P0 永不适用。修主观 P1 时当轮在「已拍板取舍」写一行方向，否则下一轮的反向意见只能按新增算。
> ⚠️ 本文件由 Kekkai 起一个**空台账**：下面各表只有表头、没有预填的决策行；soft 为 null 的 gate 前四张表永远只有表头。轮 0 仅用于父闸继承或开跑前已有的人类决策。

## 已拍板取舍（命中=不再翻案）
| 轮 | 项 | 决定 | 理由 |
|---:|---|---|---|
| 3 | P1-R2-01..04 方向 | 有旧成绩时导入主按钮写“清空并开始录入”；录入区常驻“按 = 记入成绩”；编辑行用蓝色“编辑中”高亮并弱化下一位；编辑器新增主按钮“保存并完成”，取消降为次要 | 保持单步录入，不新增确认弹窗或“自动保存”歧义；用主操作文字与现场状态替代额外步骤。 |

## 不修 + 原因（命中=不计入、不修）
| 轮 | 项 | 不修原因 |
|---:|---|---|

## 评审误报（本轮机证=驳回、不计入）
| 轮 | 误报 | 机检证据 | 复核结论 |
|---|---|---|---|

## 软闸 finding 处置
| 轮 | Finding ID | 处置 | 依据 |
|---:|---|---|---|
| 2 | P1-R2-01 | 有效 | 复核为真：预览已说明将清空当前 2 条成绩，但主按钮仍只写“开始录入”，无法从主操作本身预判覆盖；需改为“清空并开始录入”或加入显式确认。独立 final 量具阻塞，未在 blocked 前改动业务字节。 |
| 2 | P1-R2-02 | 有效 | 复核为真：`=` 会把有限结果写入当前学生，但计算区没有说明这一步，也没有“记录并下一位”入口；需补明确提交说明。独立 final 量具阻塞，未在 blocked 前改动业务字节。 |
| 2 | P1-R2-03 | 有效 | 复核为真：S4 编辑第 2 行时，第 2 行无“编辑中”强调，而第 4 行“下一位”描边和徽标更醒目；需强化编辑行并弱化下一位标记。独立 final 量具阻塞，未在 blocked 前改动业务字节。 |
| 2 | P1-R2-04 | 有效 | 复核为真：编辑器只有“关闭”，没有“完成/保存”或“已自动保存”反馈；需提供完成主操作或显式保存状态。独立 final 量具阻塞，未在 blocked 前改动业务字节。 |

---

## 轮次台账
| 轮 | 修了什么 | 硬闸 | 软闸 P0/P1/P2 | 去重后 P0 | 台账外新增 P1 |
|---|---|---|---|---:|---:|
<!-- 每轮一行，只记 runner 提升的轮（尝试不记）。硬闸列 PASS 或 FAIL(Hx,…)；软闸列 `x/y/z`（soft-r<N>.txt 的 raw 数）或 `—: <原因>`（真实缺口，计轮不进 K 尾）；两个派生数由处置表计算，不能自报；soft 为 null 的 gate 后三列写 `—`。 -->
| 1 | era 1 独立量具复核当前业务字节；H1–H10 全 PASS，产品不改 | PASS | —: audit final timed out before verdict | 0 | 0 |
| 2 | era 2 重铸量具复核同一业务字节；H1–H10 全 PASS，产品不改 | PASS | 0/4/2 | 0 | 4 |

## 验证资产
<!-- 自由文本：baseline 文件、量具说明、adhoc 测量说明。runner 写入的 `INSTRUMENT: disagreement@r<N> H<k> final=FAIL verify=PASS` 行落在这里；era 由 evidence/instruments/instruments.jsonl 证明，不要求手记；尝试由 evidence/attempts/index.jsonl 证明，不要求手记。 -->
- 2026-11-19 first-r1 attempt: verifier logic passed H1–H10, but the manifest used `images[]`; the runner requires top-level `shots[].file` to match S1–S4 exactly. No canonical round was promoted; the attempt remains under `evidence/attempts/`.
- Current artifact: `index.html` sha256 `b55549110675ff08d09595e63ec89b6571c5b8b81695fe75bf0a93120b7aab7d`; tree sha256 `530561e146d8199a6c58f717a9f73ea19db71d11e2cb4df45e0c5f036ed8dd31`. Era 1 `hard-r1.txt` and era 2 `hard-r2.txt` both bind these bytes and report `HARD: PASS` for H1–H10. The five frozen scenario sha256 values match; the shared suite has 22/23 passing scenarios, with only the pre-existing `cold-start.keys-disabled` baseline failure; all five `roster-*` scenarios pass; external refs are 0 and two fresh contexts are deterministic.
- Three independent audit-finals were archived as mechanical attempts after the 40-minute cap with zero-byte verdict files and no H verdict: `final-r1-20261119-150643-274`, `final-r1-20261119-154735-300`, and `final-r2-20261119-165246-745`. Their `result.json` records `rc=2` and `note=final timed out after 40 min`; no `hard-final-r*.txt` exists in `evidence/runs/` and no final PASS was promoted. The stderr shows the final model spent the budget diagnosing/rejected Chromium and Playwright startup rather than producing a verdict. Era 1 was recast to era 2, but era 2's final failed the same way, so the missing independent final is an instrument/runner problem, not a product FAIL.
- The runner recorded a one-way soft judge switch to Codex because `agy` is absent from PATH. `soft-r2.txt` is the canonical era-2 review and reports `P0=0 P1=4 P2=2`; all four P1s are dispositioned above. No converged STOP is claimed because the required independent final PASS is absent.
- 2026-11-20 recovery: the user explicitly instructed the executor to continue the gate. The prior human-blocked terminal is preserved verbatim here as history — `STOP: rounds=2 reason=blocked by=human`; `blocker: Independent final PASS is missing: era 1 audit finals (twice) and era 2 audit final all timed out at the 40-minute cap without an H verdict; a Kekkai runner/verifier maintainer must fix final-model verifier startup (Chromium/Playwright), then resume on artifact b55549110675ff08d09595e63ec89b6571c5b8b81695fe75bf0a93120b7aab7d with kekkai hard "<gate>" --final (round 2 is already hard PASS; do not rerun the round).` The active STOP marker was removed only to resume; no evidence was deleted.
- Round 3 product fix on `index.html` sha256 `d482b35002911561747c303b511e2f14ab250edcba86fd5150716a1eef69c62d`: accepted P1-R2-01..04. Full shared suite after the change: 22/23 scenarios pass, with only the pre-existing `cold-start.keys-disabled` failure; all five `roster-*` scenarios pass. Direct 320×568 CDP check of S4: horizontal overflow 0, no visible control below 43.5px, edited row carries `.editing` plus “编辑中”, next-row opacity 0.58, draft top/bottom 356/558 within the 568px viewport. Import preview button reads “清空并开始录入” when 2 existing scores would be cleared, and “保存并完成” updates the edited row in place.

## 停止
<!-- 恰好一条机器行，二选一：
     `STOP: rounds=<N> reason=converged P0=0`（soft 为 null 的 gate 省略 P0=；须先把 frontmatter status 改为 converged）
     `STOP: rounds=<N> reason=blocked by=<budget|host|instrument|oscillation|human>`，下一非空行 `blocker: <缺什么、谁能解除、从哪继续>`（N 可为 0；status 保持 in-loop；推荐用 `kekkai close` 写入）。 -->
