---
# ── Kekkai Goal Gate v4 · frontmatter（唯一机读区；停止数字只在这里；矩阵/不变量内容只在正文表格）──
slug: roster-compact-skip-11230638-112306
version: 4
model_profile: muse-spark-1.3-v1  # 本机 codex provider 不提供 gpt-6-astra；新闸在首轮前显式选定，执行中不可修改
status: converged                  # draft | in-loop | converged（blocked 终态保持 in-loop）
repo: /ws/cal_phone
artifact: /ws/cal_phone/index.html
# artifact_kind: url | app | service   # 仅 artifact: null 时启用；此时 ARTIFACT_SHA256 := TREE_SHA256
parent_gate: null                  # 子闸填父 GOAL.md 绝对路径；只继承 round-0 决策，不继承证据或 verify.mjs
verifiers:
  hard: codex exec                 # 固定驱动器；pin 与访问标志在 bin/runner.mjs（docs/RUNNER.md）
  soft: agy -p (Gemini 3.8 Flash (High))   # 固定驱动器；无软闸的 gate 为 null（kekkai new --soft none）
stop:
  max_rounds: 10
hard_invariants: [H1, H2, H3, H4, H5]
review_states: [S1, S2, S3, S4]
volatile: ["Telos/_worktree-archive"]   # 归档证据目录不是业务码；避免归档动作扰动 TREE_SHA256
---

# Kekkai Goal Gate · 名单行与导入方式压缩 + 空按 = 跳过

> **运行指令**：你是执行者（Codex / Claude Code / ZCode / Cursor 之一，由 handoff 指定；生成本 gate 的那次调用不得兼任）。
> 开跑前先 `kekkai doctor --gate <本目录> --host`；只有 `requires_display: true` 的真实桌面测量依赖解锁与屏幕权限，普通无头浏览器/逻辑测量不占屏。
> 读**本文件全文** + 同目录 [`./ledger.md`](./ledger.md)（决策台账），然后只用 §5 的命令块驱动验收，直到 §5 的停止条件；在已授权范围内自主推进，缺少外部输入时写明 blocked 与恢复条件。
> 生命周期编辑是唯一允许的 GOAL 改动：第 1 轮前 `status: draft → in-loop`；写 `converged` STOP 前 → `status: converged`；blocked 终态保持 `in-loop`。
> 除此之外 GOAL.md 只读：不改 frontmatter 数字、不改 prompt、不改变 §5 命令的操作、目标路径和关键参数（注释与空白不影响判定）。
> 教义在 Kekkai skill 的 `docs/CREED.md`、runner 契约在该 skill 的 `docs/RUNNER.md`——本文件不复述它们；`kekkai hard/soft` 的退出码与消息就是你的下一步。

## 1. 目标（一句话 + 背景 + 实施指导）

让 `/ws/cal_phone/index.html` 的名单界面从「一行人占两行、50 人时整页约 4640px，导入方式单选 44px 高」压缩到 **名单行高度约减半（已录行 ≤46px、未录行 ≤38px）、导入方式单选组约缩小 30% 但文字仍清楚可点**，并新增 **空输入按 `=` 跳过当前「下一位」、指针移到下一个未录人员** 的课堂缺席处理能力；所有既有计算、回填、编辑、导入/保留、存储、导出与语音语义保持不变。

**实施指导**：
当前实现是单文件 IIFE。名单行 `.roster-row` 由 `.roster-top`（序号/姓名/学号/下一位徽标）+ `.roster-bottom`（算式/成绩/编辑按钮）+ 10px padding + 6px margin 组成；生成时实测 390×844 下未录行 75.6px、已录带「编辑」按钮行 91.6px，50 行全空时 `documentElement.scrollHeight=4640`。导入方式 `.import-mode-option` 为 `min-height:44px; padding:8px`，内部 `input[type=radio]` 为 44×44，`fieldset` 实测 167px；生成时选项 label 60px。压缩目标是把行内信息合并为紧凑的一行或等价的低高度排布：可缩小 padding/行距/徽标/编辑按钮，可用 `overflow:hidden + text-overflow:ellipsis` 截断算式，但**不得删除**姓名、学号、成绩、算式文本、`下一位` 徽标、编辑按钮或既有 data-* 钩子（`textContent` 仍保留完整值）；编辑按钮与导入方式单选可以低于 44px，但不得小于 28×28 CSS px。继续复用现有 CSS 变量与视觉语言，不引入外部依赖。

未知需求 3 已与用户确认：**空输入按 `=` 是跳过当前下一位，不是修复误跳。** 现有 `calculate()` 在 `input` 为空时直接 `return`；需要新增会话内指针（例如 `skippedSeqs:Set` 或 `skipPointer`），让 `renderRoster()` / `nextEmptyRow()` 的「下一位」跳过已跳过的行。触发条件必须同时满足：名单存在、主输入框 `trim()===""`、没有待计算操作数、`editRosterSeq===null`（编辑态不跳过）、状态 ∈ {select,input,result,error}。触发后只把指针移到「当前下一位之后的下一个未录且未跳过行」，到尾部回绕到第一个未录行；**不写成绩、不写 localStorage、不改结果/算式/运算符/既有成绩、不新增历史**，`#state-label` 要包含「跳过」和下一个人员（含姓名或序号）。指针仅会话内有效：导入、清空、刷新后回到第一个未录行；不扩展 `cal-phone.roster.v1` 的 schema。录满时按 `=` 不跳过，保持现有「名单已录满」计算语义。屏幕 `=` 与物理键盘 `=` 两条路径都走 `calculate()`，不要只修其中一条。

> 外部前提：无需账号、服务、真实设备或人工授权；全部验收在无头 Chromium（Playwright 1.64.0，已缓存于 `/ws/cal_phone/tests/node_modules`）中完成。语音资源与真实 TTS 不在本闸验收范围，语音只看既有回归是否新增失败。

## 2. 不变约束（父级红线 · 任何修改不得破坏）
> 每条红线**必须标注归属**：`[H#]`（由该硬不变量机检）或 `[soft-only: 原因]`（只能主观把关，写明为何无法机检）。绝对不能改的代码块优先给 sha256 机检形式。不允许留下既非 `[H#]` 也非 `[soft-only]` 的悬空红线。
- 产物仍是单文件、自包含、以 `</html>` 闭合、字节数 ≥1024，不引用 `http(s):` 或协议相对外部 script/link/img/font/@import/url()，不引入依赖、构建步骤或网络请求 [H5]
- 计算器既有语义完全不变：float64 从左到右折叠、`formatValue`、自动确认、自动等号、基数快照、结果后暂停、退格撤回、语音只在结果产生时播报 [H4]
- 名单既有语义完全不变：按 seq 顺序回填、录满提示、原地编辑、地下草稿、导入解析/映射/保留/清空、导出、`cal-phone.roster.v1` 存储与坏数据降级 [H4]
- 名单行高度必须相对生成基线约减半：390 与 320 下已录行 ≤46.0px、未录行 ≤38.0px；50 人全空时页面总高 ≤2800px [H1]
- 压缩后姓名、学号、成绩、算式文本、`下一位` 徽标和行内编辑按钮仍存在且可读可点，文字不得相互遮挡 [H1]
- 导入方式单选组相对基线约缩小 30%：选项 label 高度 ≤42px、radio ≤31×31px、fieldset ≤120px；K/M 文案与选择行为不变 [H2]
- 空输入按 `=` 只移动下一位指针：不写成绩、不写存储、不改结果/算式/运算符、不新增历史、不改变 `data-filled` [H3]
- 主输入非空、存在待计算操作数、或正在编辑草稿时，`=` 必须走原有计算/保存路径，绝不触发跳过 [H3]
- `=` 跳过只在会话内生效；刷新、重新导入、清空后下一位回到第一个未录行；不改写 `cal-phone.roster.v1` 的既有 schema [H3][H5]
- 320×568 与 390×844 下名单与导入对话框无横向溢出（≤1px）；压缩后的可见控件不得小于 28×28 CSS px，名单文字 ≥12.5px [H1][H2][H5]
- 既有 18 个非名单场景与 11 个 `roster-*` 场景保持通过；五个非名单场景文件 sha256 冻结；新增 `roster-compact` 场景覆盖本闸目标 [H4]
- 允许对 `tests/scenarios/roster-layout.mjs` 只放宽控件尺寸下限（43.5 → 最低 28.0，检查本身不得删除）；允许 `tests/voice/run.mjs` 只更新 `regression.scenarios` / `regression.checks` 两个期望值 [H4]
- 压缩后的密度、信息层级、导入方式取舍的可理解性、跳过反馈是否让人放心，需像素评审判断 [soft-only: 视觉密度与「首次使用者是否困惑」无法由几何阈值机检]
- 继续使用现有深色主题、CSS 变量与圆角/边框语言，不像素化或引入刺眼原生控件 [soft-only: 质感与一致性属视觉评审]

> 允许改动的范围豁免写在下面的定界块里（runner 会把它**逐字**内联进 first / recast / final 验收器的 runtime contract，避免首轮判合规、末轮判违规的判定分裂）。没有豁免就写 `无`。

<<<SCOPE-EXEMPTIONS
允许改动 /ws/cal_phone/index.html 与 /ws/cal_phone/tests/**：可新增 tests/scenarios/roster-compact.mjs 并在 tests/suite.mjs 注册；tests/scenarios/roster-layout.mjs 只允许把 `preview-controls` / `mixed-controls` 的 43.5px 数值下限放宽到 ≥28.0（可只针对 radio/button 分类），不得删除该检查或修改其它断言；tests/voice/run.mjs 只允许更新 `regression.scenarios` 与 `regression.checks` 两个期望值为当前套件实测值，其余断言字节不变；可在 tests/lib/selectors.mjs 追加新选择器、在 tests/lib/* 做不改变既有行为的必要修正；可在 index.html 新增 data-testid / data-* 测试钩子或测试专用查询（不得移除既有钩子）。不得修改 tests/scenarios/{core,continuity,edit,layout,determinism}.mjs（sha256 已冻结），不得改写既有 Telos/** 证据或 docs/** 规格，不得引入依赖、构建步骤、网络请求或外部资源。
SCOPE-EXEMPTIONS>>>

---

## 3. 硬目标（独立确定性验收 · 硬闸 · codex exec）

**输入矩阵（采样覆盖；含边界与「哪些算、哪些拒答」）：**
- 视口 ∈ {390×844, 320×568 CDP `Emulation.setDeviceMetricsOverride`}。
- 名单状态 ∈ {无名单, 3 人全空, 3 人 1 条已录（出现编辑按钮）, 5 人 2 条已录, 50 人全空}。
- 导入方式状态 ∈ {本机已有 4 人且录 2 条 → 导入 3 人同学号乱序/改名/删/增（保留可用）, 新旧任一侧重复学号或无可保留（仅清空）}。
- 跳过交互 ∈ {空输入按屏幕 `=`, 空输入按物理 `=`, 连续跳过 1/2/3 次并回绕, 跳过后再录入, 部分已录时跳过, 全录满时空按 `=`, 编辑态空按 `=`, 主输入非空, 有待计算操作数, 无名单, 刷新}。
- 回归 ∈ {共享套件全部场景, 新增 roster-compact 场景, 语音套件失败集合基线}。
- 确定性 ∈ {两个全新 context 执行同一「导入 3 人 → 空 `=` 跳过 → + 10 20 `=` → 刷新」序列}。

**稳定测试入口：** 既有 `main.app[data-state]`、`main.app[data-operator]`、`#state-label`、`input[data-testid="calc-input"]`、`[data-testid="expression"]`、`[data-testid="result"]`、`[data-testid="keypad"] [data-key]`、`[data-testid="op-picker"] [data-op]`、`[data-testid="key-equals"]`、`[data-testid="history-item"]`；名单与导入：`roster`、`roster-summary`、`roster-list`、`roster-row`（`data-seq/data-filled/data-name/data-id/data-next`）、`roster-score`（`data-value`）、`roster-expression`、`roster-edit`、`roster-next`（`data-seq`）、`roster-presence`、`roster-import`、`roster-export`、`roster-clear`、`roster-file`、`import-dialog`、`import-summary`（`data-count/data-keep-count/data-drop-count/data-new-count`）、`import-map`、`import-mode`、`import-mode-keep`、`import-mode-clear`、`import-confirm`、`import-cancel`、`import-warning`、`edit-draft`、`operand-input`、`edit-cancel`、`edit-done`。存储键 `cal-phone.roster.v1`。测试库：`tests/lib/browser.mjs` 的 `launchBrowser/openApp`、`tests/lib/roster.mjs` 的 `importText/compute/rosterRows`、`tests/suite.mjs` 的 `runSuite`。

**不变量：**

| # | 不变量 | 硬闸怎么验（须真跑，非读源码目测） | 阈值 |
|---|---|---|---|
| H1 | 名单行高度约减半且信息仍可见、可读、可点 | 390 与 320 各：导入 3 人 fixture，录 1 条（让编辑按钮出现），读每行 `getBoundingClientRect().height`、`.roster-name/.roster-id/.roster-score/[data-testid=roster-edit]` 的 rect 与字号；再导入 50 人全空读 `documentElement.scrollHeight` 与 `scrollWidth-clientWidth`；另在 5 人录 2 条状态重复读行高 | 已录行 ≤46.0px、未录行 ≤38.0px（生成基线 91.6 / 75.6）；50 行 `scrollHeight ≤2800`（基线 4640）；姓名/成绩/编辑 rect 面积 >0、互不重叠、均落在行内；名单正文字号 ≥12.5px；横向溢出 ≤1px |
| H2 | 导入方式单选组约缩小 30%、文案与选择行为不变 | 先导入 4 人并录 2 条，再导入 3 人同学号乱序 CSV，等 `import-mode` 可见；读两个 `label`、两个 `input[type=radio]`、`fieldset` 的 rect 与文本；分别点击 label 文本区域与 radio 中心，读 `checked`、`import-mode` 与 `import-confirm` 文本；在 320 重复；再构造新旧重复学号走仅清空路径 | label 高度 ≤42.0px（基线 60）、radio 宽高 ≤31.0px（基线 44）、fieldset ≤120.0px（基线 167）；K/M 与「保留/清空」文案仍存在；点 label 与点 radio 均能切换 checked，`import-confirm` 文本随选择更新；320 横向溢出 ≤1px |
| H3 | 空输入按 `=` 跳过当前下一位，指针推进且无成绩副作用 | 导入 3 人：空输入点 `key-equals` 读 `roster-next[data-seq]`、`data-filled`、score、`#state-label`、state、input、localStorage 原文；再按两次验证回绕；物理 `page.keyboard.press("=")` 重复一次；跳过第 1 位后 `+` 10 Enter 20 `=` 验证写入第 2 位；另测部分已录、全录满、编辑态、主输入非空、`+` 10 Enter 后 `=`、无名单、刷新 | 全空名单连续跳过：next 1→2→3→1；`data-filled` 全为 false、score 不变、localStorage 原文逐字不变、无 history、结果/算式/运算符/state 不变、label 含「跳过」与目标 seq；跳过后录入只写 seq2、seq1 仍空；主输入非空或待算操作数时 `=` 正常计算回填且 next 不变；编辑态 `=` 保存草稿；无名单空 `=` 无副作用；全录满空 `=` 不跳过且 label 含「名单已录满」；reload 后 next 回 1 |
| H4 | 既有行为回归、冻结字节与授权测试更新 | `sha256sum` 五个场景文件；`node /ws/cal_phone/tests/suite.mjs --json` 跑全量；`--list` 确认 `roster-compact` 已注册；检查 `roster-layout.mjs` 的 diff 只动授权的尺寸下限；跑 `node /ws/cal_phone/tests/voice/run.mjs --json` 最多 2 次取失败更少一次；检查 voice diff 只动两个计数 | 五个 sha256 精确等于附录值；全量所有场景 `pass=true`（含新增 `roster-compact`）；`roster-layout` 检查未被删除且未改其它断言；语音失败集合 ⊆ {result.crash, queue.quick-no-result, queue.quick-keys} 且失败数 ≤3，`regression.scenarios` 与 `regression.checks` 均 PASS；voice 其它断言字节不变 |
| H5 | 自包含、零页面错误、确定性与跳过只读存储 | Node 读产物统计；汇总 H1–H4 全部页面 `pageerror`/console error；两个全新 context 各做「导入 3 人 → 空 `=` → + 10 Enter 20 `=` → reload」并序列化 rows、next、存储 JSON | `</html>` 存在、字节 ≥1024、外链 0；pageerror 与 console error 总数 0；两 context rows/next/存储一致；导入后跳过前后 localStorage 原文一致，且跳过不新增 `cal-phone.roster.v1` 之外的键 |

<<<HARD-VERIFY-PROMPT
你是确定性验收器。**不要评价 UI 美观、不要改产物源码。**本 prompt 会被单独抽取喂给你（读不到 frontmatter 与上表），所以下面所有文件都写**绝对路径**、基线写 **sha256 值**；runner 会在其后追加 `[RUNTIME CONTRACT]`（round / phase / gate_dir / evidence_dir / out_dir / artifact_sha256 / expected_review_states / SCOPE-EXEMPTIONS 原文），以它为准。
按本闸输入矩阵 / 不变量逐条**实际执行**验证：优先复用已有测试入口，逻辑用 Node 调用函数并断言返回值/异常；界面用 Playwright 操控稳定选择器并读值。基线只用于本任务明确要求不可更改的范围，不能自行冻结整个源码或妨碍授权修复。采用项目已有工具与依赖；缺依赖或设备时明确拒答，不能伪装成代码 FAIL。禁止用主观语言或肉眼通读代替实测证据。
量具卫生（三条，写量具时逐条自查）：① 不得含写死的恒 FAIL/恒 PASS 常量判据；② 扫描类不变量的扫描面必须与 §3 声明逐字一致、不得自行扩张，且**不得包含 evidence/ 或 evidence/runs/**（自引用扫描面一旦被本循环必写的证据污染就永远翻不了绿）；③ 断言锚定稳定选择器/数据钩子而非用户可见文案原文（软闸可能正当地要求改文案）；子进程/步骤超时 ≥ 单次实测耗时的 2 倍。
量具接口（两条，runner 靠它做变异检查与尝试隔离，缺一即拒绝提升）：① 环境变量 `KEKKAI_ARTIFACT` 存在时用它覆盖目标文件路径；② `KEKKAI_OUT_DIR` 存在时，`hard-r<N>.txt` / `render-r<N>.txt` / `manifest-r<N>.json` / `review-shots/r<N>/` 全部写到该目录下，而不是 evidence/runs（所有路径以脚本自身所在目录解析、不依赖 cwd）。
目标文件（绝对路径）：/ws/cal_phone/index.html
本闸具体：复用 `/ws/cal_phone/tests/lib/browser.mjs` 的 `launchBrowser/openApp`、`/ws/cal_phone/tests/lib/roster.mjs` 的 `importText/compute/rosterRows` 与 `/ws/cal_phone/tests/suite.mjs` 的 `runSuite`；Playwright 已缓存在 `/ws/cal_phone/tests/node_modules`，在导入任何测试库**之前**设置 `process.env.PLAYWRIGHT_MODULE="/ws/cal_phone/tests/node_modules/playwright"`（或 `NODE_PATH=/ws/cal_phone/tests/node_modules` 并用 `createRequire('/ws/cal_phone/tests/package.json')`）。数值容差 1e-9，布局容差 0.5px；320px 必须 `const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setDeviceMetricsOverride',{width:320,height:568,deviceScaleFactor:2,mobile:true});` 后再导航。fixture 写在 `KEKKAI_OUT_DIR`（缺省时写系统临时目录下的新目录），不污染仓库。等待一律用 `page.waitForFunction` 轮询稳定选择器状态，不用固定 sleep；点击屏幕键用 `locator.click()`，物理键盘用 `page.keyboard.press()`，文件导入用 `setInputFiles()`。

**本机 codex 工具有已知的整数参数问题**：① 产品实现已存在，不要重写产品，除非某条 H 失败需要最小修复；② 优先复用共享套件与现有场景，别重写几百个 check；③ 先写一个可运行的薄量具跑通，再补细节，不要先写 80KB 再调试；④ 所有工具调用整数参数（`timeout`、`limit` 等）必须是 JSON 整数，不能写 `30000.0`；⑤ 不要在 shell 里用 `rm -f`，也不要 `setsid`/`nohup` 后台启动量具；临时文件用 Node `fs.rmSync`，量具在同一 node 进程内跑。

逐条验法：
- H1：390×844 与 320×568（CDP）各开全新 context。导入 fixture A（`序号,学号,姓名,成绩,班级` + 张三/李四/王五，UTF-8）后 `compute(page,"+",["12","30","8"])` 让第 1 行出现 `roster-edit`；读三行 `getBoundingClientRect().height` 与姓名/成绩/编辑 rect、`getComputedStyle` 字号，断言已录行 ≤46.0、未录行 ≤38.0、元素 area>0、两两不重叠、均在行内、字号 ≥12.5、document/body 横向溢出 ≤1。再导入 50 人全空 fixture（`学号,姓名` + S1..S50），断言 `documentElement.scrollHeight ≤2800`。另在 5 人录 2 条状态重复行高读取。
- H2：全新 context 导入 4 人并录 2 条；点 `roster-import`，`setInputFiles` 喂 3 人同学号乱序 fixture（1 改名、1 删除、1 新增），等 `import-summary[data-count]` 与 `import-mode` 可见；读 `[data-testid=import-mode-keep]`/`-clear` 的 `closest("label")` 与 radio 的 rect、`fieldset` rect、label 文本；先点 keep label 文本区域，再点 clear radio 中心，读 `checked` 与 `import-confirm` 文本；在 320 重复（重新打开页面）；用新旧任一侧重复学号 fixture 断言保留不可用、仅清空可见。
- H3：全新 context 导入 3 人 A。记录 `roster-next[data-seq]`、`data-filled`、localStorage 原文。点 `key-equals` 三次，每次读 next、data-filled、score、`#state-label`、`main.app[data-state]`、输入框、`result`、`expression`、`roster` 存储原文；断言 next 1→2→3→1 且无写成绩/存储。再 `page.keyboard.press("=")` 一次验证物理键。跳过第 1 位后做 `+` 10 Enter 20 `=`，断言成绩写在 seq2、seq1 仍空。另起 context：录 1 条后跳过验证 next 2；3 人录满后空 `=` 不跳过且 label 含「名单已录满」；点第 1 行编辑后空 `=` 走保存草稿而不是跳过；输入 `5` 后 `=` 不跳过；按 `+`、10、Enter 后 `=` 正常计算回填；无名单空 `=` 无副作用；导入后跳过再 reload，next 回 1。
- H4：`sha256sum` 对照：core.mjs=`2b35cce880e336882e384e940d28b103acc270a7931552dea5d5c9c79c9eeb7e`，continuity.mjs=`d53f1a4ce357bb200a4e811aa45d3dad187d40279c5f747c7ebb38c28e810a56`，edit.mjs=`f61188e63586e8afa2883f6db3d3e88f7cc216a9a0c8dc7d465953ad37ceadc1`，layout.mjs=`c96ed96499a18b9731a8e10dabb579a761d445534105caabfa7424803def65a0`，determinism.mjs=`64bc09c49ac56c21aef77bdd1a7f7c365b8791d0690076f5964b58f06e69ddff`。用 `runSuite({ artifact })` 断言所有场景 `pass=true` 且存在 `roster-compact`。用 git diff 或文本检查 `roster-layout.mjs`：只允许 `43.5` 下限被放宽到 ≥28，检查名与其它断言不得消失。语音套件最多跑 2 次，失败集合 ⊆ `{result.crash, queue.quick-no-result, queue.quick-keys}` 且 ≤3，`regression.scenarios`/`regression.checks` 必须 PASS；`tests/voice/run.mjs` 除这两个期望值外不得有其它改动。
- H5：Node 读目标文本断言 `</html>`、字节 ≥1024、正则统计外部 `<script src>/<link href>/<img src>/<source src>/@import/url(...)` 中 `^(https?:)?//` 为 0；汇总所有页面 pageerror/consoleErrors 为 0；两个全新 context 重复同一序列并深度比对 rows/next/存储 JSON；断言跳过前后的 `cal-phone.roster.v1` 原文逐字一致。
phase=first 时把验证逻辑写成脚本 `/ws/cal_phone/Telos/roster-compact-skip-11230638-112306/evidence/verify.mjs`（接受轮号参数）并立即以 `node verify.mjs <round>` 运行；它按上面不变量逐条实测并写 `hard-r<N>.txt`：先写 `ROUND: <N>`、`ARTIFACT_SHA256: <64hex>`、`VERIFIER_SHA256: <64hex>`（脚本自身 sha256），再每条 `H<id> PASS|FAIL — 实测值/证据`，末行**严格** `HARD: PASS` 或 `HARD: FAIL (Hx,…)`。
若 runtime contract 的 `expected_review_states` 非 none：同一脚本还须把每个状态用 Playwright 渲染成**非空、非纯色、内容互不重复**的 PNG（≥ 240×160；真 320px 用 CDP）落 `review-shots/r<N>/S<k>.png`——精确且仅这些文件；把带同样头的可见性/溢出/关键尺寸 `key=value` 实测写 `render-r<N>.txt`；写 `manifest-r<N>.json`：顶层字段 `round`、`artifact_sha256`、`verifier_sha256`、`metrics_sha256`，以及**顶层 `shots` 数组**（不是 `images`）逐项 `{file:'S<k>.png', sha256, width, height}`，另有 `adhoc: []`。四态：S1 390×844 导入 5 人并录 2 条（`+` 12 30 8 `=`、`+` 9 1 `=`），滚动到名单区使摘要、已录 2 行、下一位第 3 行与工具条同屏；S2 390×844 导入 4 人并录 2 条后打开导入，选择 3 人自定义表头 fixture（`编号,学生,班级,总分`），映射 编号/学生/总分 为学号/姓名/成绩，使预览同时出现四下拉、列标签、前 3 行、导入方式（默认保留）与 K/D/A；S3 320×568（CDP）导入 5 人、录 1 条后空按 `=` 跳过第 2 位，使名单、下一位徽标/文字、状态行「已跳过…」与输入框同屏；S4 390×844 导入 50 人并录前 3 条，滚动到名单区看 50 行密度与行间分隔。每态截图前等待布局稳定；S1–S4 不启动自动确认计时。
phase=final 时**禁止读取、运行或修改 verify.mjs / ledger / 旧证据**，在你被启动的隔离 scratch cwd 中重新推导全套检查；临时测量只落当前 scratch 目录，最终回复给出裁决，由 CLI 保存（不要自行写 `-o` 路径）；首行同样是 `ROUND:`、`ARTIFACT_SHA256:`，末行同样严格。
**最终回复格式（本闸硬要求）**：最终回复就是裁决本身，每个不变量从第 0 列开始单独一行写作 `H<id> PASS — 实测值/证据` 或 `H<id> FAIL — 实测值/证据`；不要用 Markdown 列表符号、不要加解释性段落、不要在 H 行前后叙述；内容与你写入的 `hard-r<N>.txt` 逐字一致（runner 头可省略，由 runner 盖章）。若只返回叙述或空 H 集合，runner 会把它判为机械失败。
HARD-VERIFY-PROMPT>>>

---

## 4. 软目标（独立像素评审 · 软闸 · agy -p Gemini 3.8 Flash (High)）
**维度：** 信息密度与可读性、行内主次层级、导入方式取舍的清晰度、跳过反馈的可理解性、窄屏排布、压缩后控件的可操作性。

**代表性状态：** 逐个走查（**枚举写在下方 SOFT-REVIEW-PROMPT 内**，随 prompt 一并抽取，保证自足）。产物没有 URL 查询参数路由，因此每态给「到达该态的操作步骤」；截图由 §3 的量具渲染，评审只看副本像素 + 内联指标，永不看源码。

<<<SOFT-REVIEW-PROMPT
你是资深「用户界面 UI 评审官」。只评审、不改文件、不贴整页代码。运行时会追加真实 round/hash 与隔离目录内的该轮 PNG 清单；用可用的图像查看工具逐张看**真实像素**、以首次使用者视角通读。**你自身不起浏览器、不渲染；禁止搜索/读取业务源码、`ledger.md`、目标仓库规则或任何旧轮评审。**若本轮附图/指标不完整，输出 `EVIDENCE_INCOMPLETE` 并停止，绝不拿旧图或源码顶替。
**只看用户可见呈现是否清楚/好懂/好用；不判计算、回填顺序、跳过规则或导入解析正误（那是硬闸职责）。**
**运行时会把本轮机检指标原文内联进 prompt**（关键选择器的可见性/溢出/关键尺寸实测）：你的判断**不得与之矛盾**——若指标显示某元素 visible / 可滚动 / 无溢出，就不得断言它不可见/不可滚动/破版（截图 + 指标都对不上的判断＝幻觉，会被台账记为「评审误报」驳回）。
再依次走查以下代表性状态各一遍（每态对应本轮一张附图 `S<k>.png`）：
S1 | 名单录入中（390×844）：导入 5 人名单，录 2 条（`+` 12 30 8 `=`、`+` 9 1 `=`），滚到名单区；看压缩后的行是否还能一眼读出名、成绩与算式，已录行与未录行的区别是否清楚，第 3 行「下一位」徽标是否醒目但不喧宾夺主，行内「编辑」是否看得出可点。
S2 | 导入方式（390×844）：先导入 4 人名单并录 2 条，再点工具条「导入」，选择 3 人自定义表头 CSV（`编号,学生,班级,总分`），把 `编号/学生/总分` 映射为学号/姓名/成绩；看缩小后的 `保留同学号成绩（K 条）/清空重录（M 条）` 两行是否文字清楚、单选是否好点、清空警告是否仍显眼、主按钮 `保留成绩并开始录入` 是否与选择一致。
S3 | 窄屏跳过（320×568，CDP）：导入 5 人名单，录 1 条后空按 `=` 跳过第 2 位；看名单行是否横向溢出、姓名/成绩/编辑是否仍在、`下一位` 是否明确指向第 3 位、状态行「已跳过…」是否让人知道跳过了谁、28–31px 控件是否仍值得点。
S4 | 50 人密度（390×844）：导入 50 人名单并录前 3 条，滚到名单区；看 50 行压缩后是否仍可扫描、行与行之间是否分得开、摘要/下一位是否还能在长列表中定位、是否出现文字重叠或截断到不可理解。
评审重点：压缩后每行会不会挤到分不清姓名和成绩？已录行的算式截断后是否还知道算的是什么？「下一位」是否只靠颜色而文字不可读？导入方式缩小后是否变得难点或两行文案连成一片？清空成绩的警告会不会被当成普通提示？320px 跳过之后，用户是否知道自己跳过了谁、下一位是谁？50 行时页面是否仍然像一张可用的点名册，而不是一堵文字墙？
先原样回显三行绑定头：`ROUND: <N>`、`ARTIFACT_SHA256: <64hex>`、`MANIFEST_SHA256: <64hex>`。
## P0 严重：每条严格一行 `P0-R<N>-<两位序号> | 区域 | 问题 | 为什么影响理解 | 建议修法`
## P1 重要：每条严格一行 `P1-R<N>-<两位序号> | 区域 | 问题 | 为什么 | 建议修法`
## P2 轻微（可选，不凑数）：同格式 `P2-R<N>-<两位序号> | …`
序号在每个级别内从 01 连续递增；末行计数必须与上面结构化 finding 行数完全一致。
末行：`P0=x P1=y P2=z`。
SOFT-REVIEW-PROMPT>>>

**P0 定义（硬性必修）：** 压缩后姓名、成绩或「下一位」徽标相互遮挡/截断到不可读，导致无法确认在录谁；行内编辑按钮被压到无法点或完全看不见；导入方式的「保留/清空」两行文字重叠或单选缩到无法点，用户在不知情下覆盖成绩；320px 下名单或导入对话框横向溢出导致姓名/成绩不可读；空输入按 `=` 后完全没有任何可见反馈，用户不知道是否跳过了人；50 行列表行间没有分隔、连成不可扫描的文字墙。计算错误、回填错位、跳过规则错误、存储失败与测试断言失败属于硬闸，不得在这里重复判为 P0。

---

## 5. 运行与停止（命令按需选用，非逐行执行的脚本；停止数字只在 frontmatter）
    # gate=/ws/cal_phone/Telos/roster-compact-skip-11230638-112306 · rendered by kekkai new — do not edit
    kekkai doctor --gate "/ws/cal_phone/Telos/roster-compact-skip-11230638-112306" --host     # before round 1 and after any host change
    kekkai hard "/ws/cal_phone/Telos/roster-compact-skip-11230638-112306"                     # r1: independent author writes evidence/verify.mjs; later rounds replay it
    kekkai soft "/ws/cal_phone/Telos/roster-compact-skip-11230638-112306"                     # only after a hard PASS: fresh AGY review over copied pixels
    kekkai adhoc "/ws/cal_phone/Telos/roster-compact-skip-11230638-112306" -- <command…>      # same-round measurement admissible as 误报 basis
    kekkai recast "/ws/cal_phone/Telos/roster-compact-skip-11230638-112306" --reason "<why>"  # sick instrument: quarantine + fresh independent author (≤3 eras)
    kekkai hard "/ws/cal_phone/Telos/roster-compact-skip-11230638-112306" --final             # terminal independent stamp at the stop candidate
    kekkai lint "/ws/cal_phone/Telos/roster-compact-skip-11230638-112306" --post              # after round 1, on recovery, before STOP
    kekkai close "/ws/cal_phone/Telos/roster-compact-skip-11230638-112306" --by <budget|host|instrument|oscillation|human> --blocker "<one sentence>"

- **轮次 = runner 提升进 `evidence/runs/hard-r<N>.txt` 的 canonical 盖章**；其余一切都是尝试（`evidence/attempts/`），不写台账、不占预算、不动 K。轮号由 runner 分配，不要手填；不要手跑 `node verify.mjs` 再拷文件进 runs/（缺 runner 头会被拒绝）。
- **`kekkai hard` 退出码**：`0` 提升为轮；`2` 尝试已归档（先读 `kekkai status --json` 和消息：若该轮已提升但 final 缺失，补 `--final`；否则修因后继续，不盲重跑）；`3` 重复/尝试上限——只有三条合法路：(1) change the business tree, (2) `kekkai recast --reason`, (3) `kekkai close --by <tag>`；`4` 规则拒绝（读消息，别原样重试）。管道故障同一输入有重试上限；无法修复就 `close`，不换措辞/增预算绕过。
- **软闸只在该轮 hard PASS 后有资格发言**；硬闸通过后修复主观 P1 要当轮记录取舍，后续同主张不翻案；不为纯偏好/P2制造新工作。每条 P0/P1 在 ledger「软闸 finding 处置」恰好一行（有效｜台账命中｜误报），派生数由处置行计算；命中按主张不按措辞，当轮拍板次轮生效；合法 verdict 前发现真实缺口时软闸列写 `—: <原因>`。
- **首个 hard PASS 轮 runner 自动跑审计 final**；final 与量具不一致 ⇒ final 的 FAIL 成立，只能修代码或 `kekkai recast`，永不再跑一次 final 试运气。
- **停止**：`converged` = 最新轮 hard PASS + 去重后 P0=0 + 连续 K 轮（K 为 CREED 常量）无台账外新增 P1 + 同 era 的独立 final PASS，且未超 frontmatter `max_rounds`；任何轮数（含 0）都可以 `kekkai close --by <budget|host|instrument|oscillation|human>` 写 blocked 终态并附 `blocker:` 行——绝不把 gate 停在 in-loop 而无 STOP。
- 第 1 轮后、恢复时、写 STOP 前各跑一次 `kekkai lint <本目录> --post`；`POST-IN-PROGRESS` 是运行中的预期警告。

---

## 附录 · 生成器判断记录（可审计的 taste↔structure 边界）
> 让执行者能看懂哪些是「结构强制」、哪些是「生成器的 taste 取舍」。不要复述停止数字（它们只在 frontmatter）。
- **需求来源与确认**：用户提出三条：(1) 名单每条区域太大、50 人屏幕太长，希望高度约缩一半；(2) 导入方式「是否保留」按钮太大，希望约缩 30%；(3) 没有输入时按 `=` 自动跳到下一个人。生成器实测当前版本空输入按 `=` 是 no-op，经问询确认第 3 条是**新功能（空按 = 跳过）**，不是误跳缺陷。
- **生成基线（2026-11-23，主 checkout `/ws/cal_phone`，分支 `score-tally-settings`，HEAD `faa376a`）**：`index.html` sha256=`ed2e034f537aeaa4a4fe98a3f2d333469447df9e13f03e1b58092a9c1bd1f400`；390×844 下已录带编辑按钮行 91.6px、未录行 75.6px、50 行全空 `scrollHeight=4640`；导入方式 option label 60px、radio 44×44、fieldset 167px。这些是生成基线，不是本闸验收证据。
- **模型 profile**：新闸默认冻结 `astra-flash-3.8-v1`，但本机 codex provider（`127.0.0.1:15721`）只暴露 `muse-spark-1.3-contributor` 与 `deepseek-v4.1-flash`，不提供 `gpt-6-astra`；按宿主既有结论在首轮前显式改为 opt-in 的 `muse-spark-1.3-v1`。执行中不得再改 profile；也不得把不同模型别名成 pin 名。`agy` 不在 PATH，runner 会在准入后走协议允许的一次性 Codex 软闸回退。
- **为什么改测试**：既有 `tests/scenarios/roster-layout.mjs` 要求所有可见控件 ≥43.5px，与「行高减半、导入方式缩 30%」直接冲突。本闸把这条旧阈值视为本需求的显式取舍：只授权把 `preview-controls`/`mixed-controls` 的数值下限放宽到 ≥28，检查本身保留；新增 `roster-compact` 场景把新目标固化为回归。其它五个非名单场景文件继续 sha256 冻结，防止顺手弱化。
- **跳过语义的取舍**：用户只说「没有输入时按 = 跳到下一个人」，没有指定回绕、持久化和编辑态。生成器选择：仅会话内、到尾部回绕、编辑态/非空输入/待算操作数不触发、刷新回第一个未录行。这样既满足课堂快速越过缺席者，又不悄悄改写 `cal-phone.roster.v1` 或吃掉一次正常计算。若执行中发现回绕造成困惑，按软闸 P1 处理并记录取舍，不改硬闸阈值。
- **无 sha256 引擎基线**：改动横跨单文件应用的行布局与状态机，冻结脚本块会妨碍授权修复；回归由共享套件（H4）、自包含与确定性（H5）覆盖。
- **语音基线不是全绿**：生成时既有语音套件有 3 个与本需求无关的固定失败（`result.crash`、`queue.quick-no-result`、`queue.quick-keys`）。H4 要求失败集合 ⊆ 该基线且 ≤3，既禁止新增回归，也不把既有缺口伪装成通过；若执行中修复，子集条件仍成立。新增 `roster-compact` 会改变共享套件计数，因此允许只更新 voice 的两个计数期望值。
- **320px 用 CDP**：无头 Chrome 的 `--window-size` 有约 500px 下限，320px 必须 `Emulation.setDeviceMetricsOverride`，否则窄屏评审是假的。
- **软闸保留**：压缩密度、导入方式取舍、跳过反馈与窄屏可操作性都是首次使用者可见的呈现面，几何阈值只能证明「变小了」，不能证明「还看得懂、点得动」，因此保留四态像素评审。
- **无 URL 深链**：产物是单文件、没有查询参数路由；各评审态用 UI 控件到达，量具按步骤渲染并等待稳定选择器。
- **volatile**：只列 `Telos/_worktree-archive`（归档证据目录不是业务码）；gate 目录与 sibling 门禁目录由 runner 自动排除。
