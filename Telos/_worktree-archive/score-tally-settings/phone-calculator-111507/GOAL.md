---
# ── Kekkai Goal Gate v4 · frontmatter（唯一机读区；停止数字只在这里；矩阵/不变量内容只在正文表格）──
slug: phone-calculator-111507
version: 4
model_profile: astra-flash-3.8-v1  # 新任务冻结模型组合；执行中不可修改
status: converged                  # draft | in-loop | converged（blocked 终态保持 in-loop）
repo: /ws/cal_phone
artifact: /ws/cal_phone/index.html
# artifact_kind: url | app | service   # 仅 artifact: null 时启用；此时 ARTIFACT_SHA256 := TREE_SHA256
parent_gate: null                  # 子闸填父 GOAL.md 绝对路径；只继承 round-0 决策，不继承证据或 verify.mjs
verifiers:
  hard: codex exec                 # 固定驱动器；pin 与访问标志在 bin/runner.mjs（docs/RUNNER.md）
  soft: null
stop:
  max_rounds: 10
hard_invariants: [H1, H2, H3, H4, H5, H6, H7, H8]
volatile: []                       # TREE_SHA256 排除的仓库相对路径（构建产物、日志等）；空数组即可
---

# Kekkai Goal Gate · 手机网页计算器交互与计算正确性

> **运行指令**：你是执行者（Codex / Claude Code / ZCode / Cursor 之一，由 handoff 指定；生成本 gate 的那次调用不得兼任）。
> 开跑前先 `kekkai doctor --gate <本目录> --host`；只有 `requires_display: true` 的真实桌面测量依赖解锁与屏幕权限，普通无头浏览器/逻辑测量不占屏。
> 读**本文件全文** + 同目录 [`./ledger.md`](./ledger.md)（决策台账），然后只用 §5 的命令块驱动验收，直到 §5 的停止条件；在已授权范围内自主推进，缺少外部输入时写明 blocked 与恢复条件。
> 生命周期编辑是唯一允许的 GOAL 改动：第 1 轮前 `status: draft → in-loop`；写 `converged` STOP 前 → `status: converged`；blocked 终态保持 `in-loop`。
> 除此之外 GOAL.md 只读：不改 frontmatter 数字、不改 prompt、不改变 §5 的命令的操作、目标路径和关键参数（注释与空白不影响验收）。
> 教义在 Kekkai skill 的 `docs/CREED.md`、runner 契约在该 skill 的 `docs/RUNNER.md`——本文件不复述它们；`kekkai hard/soft` 的退出码与消息就是你的下一步。

## 1. 目标（一句话 + 背景 + 实施指导）
把 `/ws/cal_phone/index.html` 从空白占位页打磨成可在手机浏览器直接使用的网页计算器：用户先选 `+ - * /` 之一，再逐个输入数字并回车，按 `=` 后在同一屏看到完整算式与最终结果；点击 `op` 回到运算类型选择，开始下一次计算。产出一个无构建步骤、无外部依赖、可直接打开的网页。

**实施指导**：
用单文件 HTML/CSS/JS 实现显式状态机 `select → input → result | error`。操作数以所选运算符按输入顺序从左到右折叠，使用 JavaScript float64（不做任意精度）；`=` 必须先提交当前未回车确认的数字再求值。数字入口使用带 `inputmode="decimal"` 的文本框，回车提交；同时提供可点击的 `=` 与 `op` 控件。所有交互控件暴露本闸规定的稳定 `data-testid` / `data-op` hook；移动端使用 viewport meta、至少 44×44 CSS px 的触控目标与至少 16px 的输入字号，窄屏不横向溢出。页面不得引用外部脚本、样式、字体、图片或 CDN。外部前提：无需账号、服务、真实设备或人工授权；验收在无头 Chromium 中完成。

> 外部前提（账号、服务、人工决定、设备权限）应在实施指导中明确；缺失时保留证据并 blocked，不把无法由代码修复的条件塞进硬不变量反复重跑。

## 2. 不变约束（父级红线 · 任何修改不得破坏）
> 每条红线**必须标注归属**：`[H#]`（由该硬不变量机检）或 `[soft-only: 原因]`（只能主观把关，写明为何无法机检）。绝对不能改的代码块优先给 sha256 机检形式。不允许留下既非 `[H#]` 也非 `[soft-only]` 的悬空红线。
- 页面必须是可自包含加载的单文件 `index.html`：`</html>` 闭合，字节数 ≥ 1024，且不引用 `http(s):` 或协议相对的外部 script/link/img/font/@import [H1]
- 手机窄屏布局可用：在 320×568 与 390×844 视口下无横向溢出，可见交互控件宽高均 ≥ 44 CSS px，数字输入字号 ≥ 16px [H2]
- 必须先选择运算类型：初始态运算选择器可见、恰好四个 `[data-op]` 为 `+ - * /`，数字输入禁用；选择后输入启用并获得焦点 [H3]
- 数字必须经回车逐个提交：每次回车清空输入并让算式区包含该数字与所选运算符；未回车的数字不得提前进入算式 [H4]
- `=`（键盘输入或点击按钮）必须提交未提交数字，并按所选运算符从左到右算出结果，同时显示算式与结果 [H5]
- 点击 `op` 必须回到运算类型选择态，并清空上一轮算式与结果；重新选择后可开始全新计算 [H6]
- 空回车不得添加操作数；除零必须进入可见错误态且不崩溃，并且可经 `op` 恢复后继续计算 [H7]
- 全流程不得产生未捕获页面错误或 console error；同一输入重复计算的结果确定性一致 [H8]

> 允许改动的范围豁免写在下面的定界块里（runner 会把它**逐字**内联进 first / recast / final 验收器的 runtime contract，避免首轮判合规、末轮判违规的判定分裂）。没有豁免就写 `无`。

<<<SCOPE-EXEMPTIONS
无
SCOPE-EXEMPTIONS>>>

---

## 3. 硬目标（独立确定性验收 · 硬闸 · codex exec）

**输入矩阵（采样覆盖；含边界与「哪些算、哪些拒答」）：**
状态 ∈ {初始 select, 已选类型 input, 结果 result, 除零 error, `op` 重置后}；视口 ∈ {320×568, 390×844}；运算符 ∈ {`+`, `-`, `*`, `/`}。数值案例：`+` 12/30/8→50；`-` 10/4/3→3；`*` 2/3/4→24；`/` 100/5/2→10；小数 `+` 1.5/2.25→3.75；除零 `/` 5/0→可见错误态。每个状态断言「无未捕获错误 + 稳定 hook 仍存在」；未选类型时输入必须禁用；空回车不得增加操作数。

**稳定测试入口：** `[data-testid="op-picker"]`（内含 `[data-op="+"]`、`[data-op="-"]`、`[data-op="*"]`、`[data-op="/"]`）、`input[data-testid="calc-input"]`、`[data-testid="expression"]`、`[data-testid="result"]`（成功时 `data-value` 为数值字符串，除零时 `data-error="true"`）、`button[data-testid="key-equals"]`、`button[data-testid="key-op"]`。

**不变量：**

| # | 不变量 | 硬闸怎么验（须真跑，非读源码目测） | 阈值 |
|---|---|---|---|
| H1 | 页面为可加载的自包含单文件 | Playwright 以 `file://` 打开 `/ws/cal_phone/index.html` 并监听 `pageerror`；Node 用 `fs.readFileSync` 读取原始 HTML，正则断言 `</html>` 存在、字节数达标，并统计指向外部 `http(s):` 或协议相对地址的 script/link/img/font/@import 引用数 | 0 个 pageerror；`</html>` 存在；字节数 ≥ 1024；外部引用 0 处 |
| H2 | 手机视口布局可用 | Playwright 用 320×568 与 390×844 视口（isMobile/hasTouch）加载，在 select 态和选中 `+` 后的 input 态读取 `documentElement`/`body` 的 `scrollWidth` 与 `clientWidth`、每个可见 input/button/`[data-op]` 的 boundingBox、`calc-input` 的 computed font-size | 两个视口两种状态均 satisfy `scrollWidth <= clientWidth + 1`；可见交互控件宽高均 ≥ 44；输入字号 ≥ 16px |
| H3 | 初始必须选择运算类型 | 加载后断言 op-picker 可见、`[data-op]` 恰好 4 个且值集合为 `{+,-,*,/}`、`calc-input.disabled === true`、expression/result 文本为空；尝试键盘输入 12 并回车后仍为空；点击 `[data-op="+"]` 后断言 `disabled === false`、`document.activeElement` 为该 input、expression/result 仍为空 | 上述断言全部成立 |
| H4 | 数字必须经回车逐个提交 | 选中 `+` 后键入 `12` 回车、`30` 回车，断言输入框清空且 expression 依次包含 `12`、`30` 与 `+`；再键入 `8` 但不回车，断言 expression 尚不含 `8`；键入 `=` 后断言 expression 含 `8`、result 的 `data-value` 解析为 50；另以点击 `key-equals` 的路径复验一次 `*` 2/3/4→24 | 提交序列成立；两次结果误差 ≤ 1e-9 |
| H5 | 四种运算与小数结果正确 | 每个案例重新加载页面：选运算符，逐个键入数字并回车，点击 `key-equals`，读取 result 的 `data-value` 与 expression 文本。案例：`+` 12/30/8→50；`-` 10/4/3→3；`*` 2/3/4→24；`/` 100/5/2→10；`+` 1.5/2.25→3.75 | 5/5 案例数值误差 ≤ 1e-9；expression 含全部操作数与所选运算符的可接受字形 |
| H6 | `op` 重置并允许重新选择类型 | 完成 `+` 12/30/8=50 后点击 `key-op`，断言 op-picker 可见、input 禁用、expression 为空、result 无文本且无 `data-value`/`data-error`；点击 `*` 后输入 2/3/4 得到 24。另一轮：选中 `-` 并提交 10/4 后点击 `key-op`，再选 `+` 输入 1/2 得到 3 | 两次重置后的状态与结果全部成立 |
| H7 | 空回车与除零边界 | 选中 `+` 后在空输入上回车，断言 expression 仍为空、result 仍为空且无错误；选中 `/` 输入 5 回车、0 回车、点击 `key-equals`，断言 result 的 `data-error=true`、文本非空、无 pageerror；点击 `key-op` 后选 `+` 输入 1/2/`=` 得到 3 | 空回车不添加操作数；除零进入可见错误态；之后 1+2=3 成立 |
| H8 | 全流程无错误且结果确定 | 在 H3–H7 的所有交互上累计 `pageerror` 与 console error；并对 `+` 12/30/8 案例在两次全新加载中重复计算，比较 result 的 `data-value` 与 expression 文本 | pageerror=0、console error=0；两次 `data-value` 完全相同且为 50 |

<<<HARD-VERIFY-PROMPT
你是确定性验收器。**不要评价 UI 美观、不要改产物源码。**本 prompt 会被单独抽取喂给你（读不到 frontmatter 与上表），所以下面所有文件都写**绝对路径**、基线写 **sha256 值**；runner 会在其后追加 `[RUNTIME CONTRACT]`（round / phase / gate_dir / evidence_dir / out_dir / artifact_sha256 / expected_review_states / SCOPE-EXEMPTIONS 原文），以它为准。
按本闸输入矩阵 / 不变量逐条**实际执行**验证：优先复用已有测试入口，逻辑用 Node 调用函数并断言返回值/异常；界面用 Playwright/jsdom 操控稳定选择器并读值。基线只用于本任务明确要求不可更改的范围，不能自行冻结整个源码或妨碍授权修复。采用项目已有工具与依赖；缺依赖或设备时明确拒答，不能伪装成代码 FAIL。禁止用主观语言/肉眼通读代替实测证据。
量具卫生（三条，写量具时逐条自查）：① 不得含写死的恒 FAIL/恒 PASS 常量判据；② 扫描类不变量的扫描面必须与 §3 声明逐字一致、不得自行扩张，且**不得包含 evidence/ 或 evidence/runs/**（自引用扫描面一旦被本循环必写的证据污染就永远翻不了绿）；③ 断言锚定稳定选择器/数据钩子而非用户可见文案原文（软闸可能正当地要求改文案）；子进程/步骤超时 ≥ 单次实测耗时的 2 倍。
量具接口（两条，runner 靠它做变异检查与尝试隔离，缺一即拒绝提升）：① 环境变量 `KEKKAI_ARTIFACT` 存在时用它覆盖目标文件路径；② `KEKKAI_OUT_DIR` 存在时，`hard-r<N>.txt` / `render-r<N>.txt` / `manifest-r<N>.json` / `review-shots/r<N>/` 全部写到该目录下，而不是 evidence/runs（所有路径以脚本自身所在目录解析、不依赖 cwd）。
目标文件（绝对路径）：/ws/cal_phone/index.html
本闸具体：被测页面是一个手机网页计算器，产物必须存在并可从 `file:///ws/cal_phone/index.html` 直接加载。稳定契约（实现可自由选择文案、样式与布局，但这些 hook 必须存在）：`[data-testid="op-picker"]` 容器内恰好四个按钮 `[data-op="+"]`、`[data-op="-"]`、`[data-op="*"]`、`[data-op="/"]`；`input[data-testid="calc-input"]`；`[data-testid="expression"]`；`[data-testid="result"]`，成功计算时其 `data-value` 属性是可 `parseFloat` 的十进制数值字符串，除零时其 `data-error` 属性为 `"true"`；`button[data-testid="key-equals"]`；`button[data-testid="key-op"]`。交互契约：初始为 select 态（op-picker 可见、calc-input.disabled 为 true、expression/result 为空）；点击任一 `[data-op]` 后进入 input 态（输入启用并聚焦、expression/result 为空）；在输入框键入数字后按 Enter 提交该数（输入框清空、expression 包含该数字与所选运算符），可重复；键入 `=`（键盘）或点击 key-equals 时先提交当前未确认数字，再按所选运算符把已提交操作数从左到右折叠求值，result 显示数值、expression 显示完整算式；点击 key-op 回到 select 态并清空算式与结果；除零时 result 进入 `data-error="true"` 的错误态且页面不崩溃，key-op 可恢复到 select 态并开始新计算。页面不得引用外部 http(s) 或协议相对资源（允许 data: 与内联）。
逐条测量口径：H1 用 `fs.readFileSync` 读取 /ws/cal_phone/index.html 断言 `</html>` 存在、`Buffer.byteLength >= 1024`，并用正则统计 `<script ... src>`、`<link ... href>`、`<img ... src>`、`@import`、`url(...)` 中指向 `(https?:)?//` 的数量为 0；同时用 Playwright 以 `file://` 打开并监听 `pageerror` 为 0。H2 用 Playwright 分别建立 320×568 与 390×844（`isMobile: true, hasTouch: true`）上下文，在各视口的 select 态与选中 `+` 后的 input 态读取 `document.documentElement.scrollWidth/clientWidth`、`document.body.scrollWidth/clientWidth`、所有可见 `input, button, [data-op]` 的 `getBoundingClientRect()`，以及 `getComputedStyle(calc-input).fontSize`，断言无横向溢出、每个可见控件宽高 ≥44（允许 0.5 误差）、字号 ≥16。H3 统计 `[data-op]` 的值集合必须恰为 `{+,-,*,/}`，在初始态断言 `op-picker` 可见、`calc-input.disabled === true`、expression 与 result 的 `textContent.trim() === ""`；尝试 `page.keyboard.type("12"); page.keyboard.press("Enter")` 后 expression 仍为空；点击 `[data-op="+"]` 后断言 `disabled === false`、`document.activeElement === calc-input`、expression/result 仍为空。H4 选中 `+` 后键入 `12` 按 Enter、键入 `30` 按 Enter，断言输入框值为空串、expression 文本包含 `12`、`30` 与 `+`；键入 `8` 不回车时 expression 不含 `8`；再按键盘 `=`，断言 expression 含 `8` 且 result 的 `data-value` 解析值与 50 的差 ≤ 1e-9；另以全新加载、选 `*`、键入 2/3/4 各回车后点击 `key-equals`，断言结果 24。H5 对五个案例各自全新加载：`+` 12/30/8→50、`-` 10/4/3→3、`*` 2/3/4→24、`/` 100/5/2→10、`+` 1.5/2.25→3.75；每例逐数键入并回车，点击 `key-equals`，读取 result 的 `data-value`，断言与预期值差 ≤ 1e-9，并断言 expression 含全部操作数与运算符可接受字形（`+`；`-` 或 `−`；`*` 或 `×`；`/` 或 `÷`）。H6 完成一次 `+` 12/30/8=50 后点击 `key-op`，断言 op-picker 可见、`calc-input.disabled === true`、expression 文本为空、result 文本为空且无 `data-value`/`data-error`；再点 `*` 并计算 2/3/4 得 24；另一次加载选 `-` 提交 10/4 后点 `key-op`，再选 `+` 计算 1/2 得 3。H7 选中 `+` 后在空输入按 Enter，断言 expression 与 result 仍为空且 result 无 `data-error`；选中 `/` 输入 5 回车、0 回车、点击 `key-equals`，断言 result 的 `data-error === "true"`、`textContent.trim()` 非空、无 pageerror；点击 `key-op` 后选 `+` 输入 1/2/`=` 断言得到 3。H8 在全部交互上收集 `pageerror` 与 `console` 的 `error` 类型消息计数为 0，并对 `+` 12/30/8 在两次全新加载中比较 result 的 `data-value` 与 expression 文本，要求完全相同且数值为 50。
环境与工具（当前主机实测）：Node v22.23.2；jsdom 已全局安装；无项目 node_modules；Playwright 浏览器已缓存在 `/root/.cache/ms-playwright`（chromium-1248，对应 `playwright@1.64.0`），网络可用。可在 `/tmp` 或本 gate 目录（TREE_SHA256 已排除 gate 父目录）执行 `npm i playwright@1.64.0`，脚本通过绝对路径或 gate 目录下的 `node_modules` 解析；**不得**把 `node_modules` 安装到 `/ws/cal_phone` 根目录。若浏览器缓存不可用可让 Playwright 自行下载；仍不可用则按缺设备拒答，不能伪装成产物 FAIL。
phase=first 时把验证逻辑写成脚本 `/ws/cal_phone/Telos/phone-calculator-111507/evidence/verify.mjs`（接受轮号参数）并立即以 `node verify.mjs <round>` 运行；它按上面不变量逐条实测并写 `hard-r<N>.txt`：先写 `ROUND: <N>`、`ARTIFACT_SHA256: <64hex>`、`VERIFIER_SHA256: <64hex>`（脚本自身 sha256），再每条 `H<id> PASS|FAIL — 实测值/证据`，末行**严格** `HARD: PASS` 或 `HARD: FAIL (Hx,…)`。
若 runtime contract 的 `expected_review_states` 非 none：同一脚本还须把每个状态用 Playwright/无头 Chrome 渲染成**非空、非纯色、内容互不重复**的 PNG（≥ 240×160；真 320px 用 CDP `Emulation.setDeviceMetricsOverride`）落 `review-shots/r<N>/S<k>.png`——精确且仅这些文件；把带同样头的可见性/溢出/关键尺寸 `key=value` 实测写 `render-r<N>.txt`；写 `manifest-r<N>.json`：`round`、`artifact_sha256`、`verifier_sha256`、`metrics_sha256`、每张图的 `file/sha256/width/height`、`adhoc: []`。
phase=final 时**禁止读取、运行或修改 verify.mjs / ledger / 旧证据**，在你被启动的隔离 scratch cwd 中重新推导全套检查；临时测量只落当前 scratch 目录，最终回复给出裁决，由 CLI 保存（不要自行写 `-o` 路径）；首行同样是 `ROUND:`、`ARTIFACT_SHA256:`，末行同样严格。
HARD-VERIFY-PROMPT>>>

---

## 5. 运行与停止（命令按需选用，非逐行执行的脚本；停止数字只在 frontmatter）
    # gate=/ws/cal_phone/Telos/phone-calculator-111507 · rendered by kekkai new — do not edit
    kekkai doctor --gate "/ws/cal_phone/Telos/phone-calculator-111507" --host     # before round 1 and after any host change
    kekkai hard "/ws/cal_phone/Telos/phone-calculator-111507"                     # r1: independent author writes evidence/verify.mjs; later rounds replay it
    kekkai adhoc "/ws/cal_phone/Telos/phone-calculator-111507" -- <command…>      # same-round measurement admissible as 误报 basis
    kekkai recast "/ws/cal_phone/Telos/phone-calculator-111507" --reason "<why>"  # sick instrument: quarantine + fresh independent author (≤3 eras)
    kekkai hard "/ws/cal_phone/Telos/phone-calculator-111507" --final             # terminal independent stamp at the stop candidate
    kekkai lint "/ws/cal_phone/Telos/phone-calculator-111507" --post              # after round 1, on recovery, before STOP
    kekkai close "/ws/cal_phone/Telos/phone-calculator-111507" --by <budget|host|instrument|oscillation|human> --blocker "<one sentence>"

- **轮次 = runner 提升进 `evidence/runs/hard-r<N>.txt` 的 canonical 盖章**；其余一切都是尝试（`evidence/attempts/`），不写台账、不占预算、不动 K。轮号由 runner 分配，不要手填；不要手跑 `node verify.mjs` 再拷文件进 runs/（缺 runner 头会被拒绝）。
- **`kekkai hard` 退出码**：`0` 提升为轮；`2` 尝试已归档（先读 `kekkai status --json` 和消息：若该轮已提升但 final 缺失，补 `--final`；否则修因后继续，不盲重跑）；`3` 重复/尝试上限——只有三条合法路：(1) change the business tree, (2) `kekkai recast --reason`, (3) `kekkai close --by <tag>`；`4` 规则拒绝（读消息，别原样重试）。管道故障同一输入有重试上限；无法修复就 `close`，不换措辞/增预算绕过。
- **首个 hard PASS 轮 runner 自动跑审计 final**；final 与量具不一致 ⇒ final 的 FAIL 成立，只能修代码或 `kekkai recast`，永不再跑一次 final 试运气。
- **停止**：`converged` = 最新轮 hard PASS + 当前产物/业务树字节的同 era 独立 final PASS（hard-only 不需要软评或 K 确认轮），且未超 frontmatter `max_rounds`；任何轮数（含 0）都可以 `kekkai close --by <budget|host|instrument|oscillation|human>` 写 blocked 终态并附 `blocker:` 行——绝不把 gate 停在 in-loop 而无 STOP。
- 第 1 轮后、恢复时、写 STOP 前各跑一次 `kekkai lint <本目录> --post`；`POST-IN-PROGRESS` 是运行中的预期警告。

---

## 附录 · 生成器判断记录（可审计的 taste↔structure 边界）
> 让执行者能看懂哪些是「结构强制」、哪些是「生成器的 taste 取舍」。不要复述停止数字（它们只在 frontmatter）。
- **为何 hard-only**：需求只规定交互顺序、四则运算与 `op` 重置，没有品牌、视觉质感或信息层级等主观目标；手机可用性用可测阈值（横向溢出、触控尺寸、输入字号）纳入硬闸，因此 `--soft none`，不设 §4 与像素评审。
- **为何锚定 `data-testid` / `data-op` / `data-value`**：实现可自由调整中文文案、配色和布局；断言只绑行为与数据 hook，避免把用户可见文案冻结成红线。
- **为何要求单文件自包含**：产物是本地网页，`file://` 直接打开即可验收；禁止外部 CDN 可避免网络差异造成的假 FAIL，也让 ARTIFACT_SHA256 完整覆盖页面。
- **`op` 的语义**：按独立按钮 `[data-testid="key-op"]` 解释，点击即回到运算类型选择并清空上一轮；`=` 同时接受键盘键入与屏幕按钮两种入口，覆盖「输入数字、回车」与手机无 `=` 键的现实情况。
- **输入矩阵取舍**：覆盖四种运算符、小数、空回车、除零与重置中间态，以及 320/390 两个手机视口；单操作数按 `=` 的行为需求未规定，因此不写成硬不变量。
- **工具取舍**：用无头 Playwright（chromium-1248 已缓存）做真实键盘/点击/视口测量，jsdom 仅作辅助；不设 `--requires-display`，因为无头浏览器测量不依赖真实桌面解锁。
- **volatile 为空**：仓库没有构建产物或日志；gate 目录本身被 TREE_SHA256 排除，依赖安装不会污染业务树。
