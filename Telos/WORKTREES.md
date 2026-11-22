# Worktree × Kekkai 交接约定

Kekkai gate 是 **checkout-local** 的，不是 branch-local 的：GOAL 的 `repo` / `artifact` 是绝对路径，
`Telos/<gate>/` 默认未跟踪，evidence 也不在 git 里。合并只带业务字节，不带 gate 和证据。

## 规则

1. **一个 gate 属于一个 checkout。** 在哪里跑，就在哪里收尾；不要把运行中的 gate 搬到另一个 worktree。
2. **合并前归档。** 在删除 worktree 之前运行归档脚本，冻结 `Telos/<gate>/` 和受验 artifact 的字节。
3. **合并后不要复用旧证据。** 旧证据只覆盖归档时的字节；主树继续改业务码，就新开 gate。
   如果 `archive.json` 显示 `artifact.matches_main=true`，可以把它当作**历史依据**引用，但不能当作之后改动的验收。
4. **归档不是活动 gate。** 不要改归档 GOAL 的 `repo`/`artifact`，也不要把归档拷进另一个 checkout 声称那边已验证。
5. **别让证据随 worktree 消失。** 未跟踪目录不会被 merge 或 worktree 删除保护；先归档再删。
6. **归档目录与 TREE_SHA256。** `Telos/_worktree-archive` 是证据目录，不是业务代码；新 gate 生成时把它写进
   frontmatter 的 `volatile`（例如 `volatile: ["Telos/_worktree-archive"]`），或在 gate 收敛后再归档。

## 用法

```sh
# 归档一个 worktree 里的全部 gate
node scripts/gate-worktree-archive.mjs --from /ws/cal_phone-worktrees/keypad

# 只归档一个 gate，或先看计划
node scripts/gate-worktree-archive.mjs --from /ws/cal_phone-worktrees/keypad --gate phone-calculator-keypad-111513
node scripts/gate-worktree-archive.mjs --from /ws/cal_phone-worktrees/keypad --dry-run
```

脚本会写到主 checkout 的 `Telos/_worktree-archive/<branch>/<gate>/`：

- gate 目录的完整副本（不含 `node_modules`）；
- `verified-artifact/`：该 gate 最近一次 hard 轮次声明的 artifact 字节（只有当前文件哈希仍等于声明哈希时才复制；文件已漂移则标记 `stale` 且不复制）；
- `archive.json`：source worktree、branch、HEAD、STOP、声明哈希、主树哈希与 artifact 是否一致；
- `PROVENANCE.md`：人读的归档说明。

默认只归档 `repo` 指向该 worktree 的 gate；从别处复制进来的遗留 gate 会跳过（`--include-external` 可强制）。
重复运行同一份未变化的归档会显示 `UNCHANGED`，不会重复复制。

查看 worktree 里的活动 gate（不复制、不搬家）：

```sh
kekkai status /ws/cal_phone-worktrees/keypad/Telos/phone-calculator-keypad-111513 --json
```

## 归档清单

<!-- archives:start -->
| 时间 | 分支 | gate | STOP | artifact | TREE | 归档目录 |
|---|---|---|---|---|---|---|
| 2026-11-22T01:51:32.040Z | roster-import | roster-import-111913 | — | `d482b3500291` | `1e6115483ab4` | `roster-import/roster-import-111913` |
| 2026-11-22T01:30:10.916Z | result-pause | phone-calculator-result-pause-3-112200 | STOP: rounds=1 reason=converged | `a275e40bf0e8` | `2ed177bb9eab` | `result-pause/phone-calculator-result-pause-3-112200` |
| 2026-11-22T00:56:51.450Z | result-pause | phone-calculator-result-pause-2-112200 | STOP: rounds=1 reason=converged | `b7447a32ff5d` | `ff099aba33fd` | `result-pause/phone-calculator-result-pause-2-112200` |
| 2026-11-22T00:56:51.378Z | result-pause | phone-calculator-result-pause-112113 | STOP: rounds=0 reason=blocked by=instrument | `b7447a32ff5d` | `—` | `result-pause/phone-calculator-result-pause-112113` |
| 2026-11-22T00:09:32.443Z | voice-double-announcement | phone-calculator-voice-double-announcement-112111 | STOP: rounds=1 reason=converged | `620ab30da006` | `a6ef39391d88` | `voice-double-announcement/phone-calculator-voice-double-announcement-112111` |
| 2026-11-22T00:09:32.356Z | voice-double-announcement | phone-calculator-voice-confirm-silent-v2-112114 | STOP: rounds=1 reason=converged | `a593d8b82bdb` | `b17eb0790916` | `voice-double-announcement/phone-calculator-voice-confirm-silent-v2-112114` |
| 2026-11-22T00:09:32.286Z | voice-double-announcement | phone-calculator-voice-confirm-silent-rebased-112113 | STOP: rounds=0 reason=blocked by=instrument | `a593d8b82bdb` | `—` | `voice-double-announcement/phone-calculator-voice-confirm-silent-rebased-112113` |
| 2026-11-21T12:42:05.553Z | haptic-feedback | phone-calculator-haptic-key-feedback-muse-112111 | STOP: rounds=1 reason=converged | `113cc7e749e6` | `4c455709e618` | `haptic-feedback/phone-calculator-haptic-key-feedback-muse-112111` |
| 2026-11-21T12:42:05.469Z | haptic-feedback | phone-calculator-haptic-key-feedback-112111 | STOP: rounds=0 reason=blocked by=host | `113cc7e749e6` | `—` | `haptic-feedback/phone-calculator-haptic-key-feedback-112111` |
| 2026-11-16T12:55:01.393Z | keypad | phone-calculator-keypad-111513 | STOP: rounds=2 reason=converged | `630392827703` | `d29a0399df77` | `keypad/phone-calculator-keypad-111513` |
<!-- archives:end -->
