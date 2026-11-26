# 手机计算器（cal_phone）

单文件移动端网页计算器：`index.html` 即全部应用，中文 UI，无构建步骤、无外部资源、无账号。除四则运算外，页面面向**统分**场景：自动确认、基数、输入满 N 笔后自动按等号。历史只存在当前页面；设置在 `localStorage`（`cal-phone.settings.v1`）中跨刷新保留。

## 快速开始

```bash
# 任选其一
open index.html                                   # file:// 直接打开（localStorage 行为随浏览器而异）
bash .agents/skills/verify-calculator/scripts/launch.sh   # → http://127.0.0.1:4173
```

页面没有后端；`launch.sh` 只是本地 `python3 -m http.server`，停止用同目录的 `stop.sh`。

## 功能

- 屏幕键盘与物理键盘；运算符可选，数字先输入后选运算符；`回车` 提交一笔，`=` 左到右折叠；`=` 后沿用运算符。
- 统分设置（右上齿轮）：自动确认 23 档（0、0.2、0.4、0.5、1 … 10 秒）、基数（作为第一笔操作数，快照进历史）、自动按等号（满 N 笔提交后自动计算，基数不计入 N）、结果后暂停输入（默认 2 秒；暂停中按数字/小数点/退格会发一声提示音）。
- 语音播报（默认关闭）：按键播报念数字、点、退格、确认与运算符；结果播报念中文结果，除零念「不能除以零」。加载、准备、失败与重试状态在主界面胶囊和设置面板中可见。
- 计算历史（新建、编辑、改运算符、删除操作数、关闭放弃）、退格撤回上一笔、除零错误与恢复。
- 320×568 / 390×844 移动布局。

## 语音资源（voice/）

语音引擎使用 sherpa-onnx 1.13.5 WASM + Matcha-TTS 中文女声，全程本地静态资源、无构建步骤。模型训练数据来自 Baker 数据集，**仅限非商用**；7 个文件约 96MB，不提交进 git，安装到 `voice/`：

```bash
bash scripts/install-voice-assets.sh       # 默认从 /ws/voice/public 复制并校验 7 个 sha256
node scripts/voice-server.mjs              # http://127.0.0.1:4174/ 本地试听（正确 wasm/onnx MIME）
```

`scripts/voice-assets.sha256` 固定 7 个资源哈希；`voice/` 已加入 `.gitignore`。浏览器必须通过 `http(s)` 网页地址打开才会启用语音，`file://` 下开关禁用且不请求任何 `voice/` 资源。离线含义：首次开启后从本机服务器下载并缓存，之后不再走公网。

## 验收

```bash
kekkai lint "Telos/<gate>" --post          # Kekkai 证据与终态一致性
node .agents/skills/verify-calculator/scripts/doctor.mjs        # doctor=ok
node .agents/skills/verify-calculator/scripts/drive.mjs --list  # 12 个场景
node .agents/skills/verify-calculator/scripts/drive.mjs --scenario auto-equals
cd tests && node suite.mjs                 # 45 场景 / 766 检查的独立回归基线
```

语音播报有常驻仓库的独立套件（本地 HTTP + Playwright + 假引擎，不依赖 `voice/` 或公网）：

```bash
node tests/voice/run.mjs                   # 设置、file://、按键/结果播报、队列、320/390 布局
node tests/voice/run.mjs --json            # stdout 仅一个 JSON 对象；诊断写 stderr
node tests/voice/run.mjs --artifact /tmp/index.html

# 真实 96MB 模型 smoke：必须显式准入，未设 VOICE_REAL=1 时 --real 会失败
VOICE_REAL=1 node tests/voice/run.mjs --real
```

功能级 recipe 在 `.agents/skills/verify-calculator/features/`；每个用例的稳定 ID 在 `features/TEST-CASES.md`。历史验收门禁与证据在 `Telos/`。

## 部署（192.168.1.25）

| 入口 | 说明 |
| --- | --- |
| **https://192.168.1.25:8444/** | HTTPS 主入口；复用 hotword 站点的自签 IP 证书，首次访问需「高级 → 继续前往」 |
| **http://192.168.1.25:8081/** | 纯 HTTP 备用入口 |

服务端布局：

| 项目 | 位置 |
| --- | --- |
| systemd | `/etc/systemd/system/cal-phone.service`（已 enable，开机自启） |
| 静态目录 | `/var/www/cal-phone/index.html` |
| 服务脚本 | `/opt/cal-phone/server.cjs` |
| 端口 | HTTP `8081` / HTTPS `8444` |
| 证书 | `/opt/hotword-asr-lab/tls/{cert,key}.pem`（共享，IP SAN `192.168.1.25`） |

### 只更新页面

```bash
rsync -az --checksum index.html root@192.168.1.25:/var/www/cal-phone/
```

服务每次请求都读磁盘，静态文件无需重启。校验：

```bash
curl -sk --noproxy '*' https://192.168.1.25:8444/ -o /tmp/remote-cal.html
cmp /tmp/remote-cal.html index.html && echo INDEX_MATCH
ssh root@192.168.1.25 'systemctl is-active cal-phone'
```

### 更新服务脚本 / unit

只有 `deploy/` 变化时才需要：

```bash
scp deploy/server.cjs root@192.168.1.25:/opt/cal-phone/server.cjs
scp deploy/cal-phone.service root@192.168.1.25:/etc/systemd/system/cal-phone.service
ssh root@192.168.1.25 'systemctl daemon-reload && systemctl restart cal-phone'
```

### 首次安装（2026-11-21 已完成）

```bash
ssh root@192.168.1.25 'mkdir -p /var/www/cal-phone /opt/cal-phone'
rsync -az --checksum index.html root@192.168.1.25:/var/www/cal-phone/
scp deploy/server.cjs root@192.168.1.25:/opt/cal-phone/server.cjs
scp deploy/cal-phone.service root@192.168.1.25:/etc/systemd/system/cal-phone.service
ssh root@192.168.1.25 'chmod a+rX /var/www/cal-phone /opt/cal-phone /opt/cal-phone/server.cjs && systemctl daemon-reload && systemctl enable --now cal-phone'
```

### 回滚

```bash
ssh root@192.168.1.25 'cp -a /var/www/cal-phone /var/www/cal-phone.bak'
ssh root@192.168.1.25 'rsync -a --delete /var/www/cal-phone.bak/ /var/www/cal-phone/'
```

完整说明（含证书、验证、排障）见 [`deploy/README.md`](./deploy/README.md)。本机 `curl` 若走代理，局域网地址需加 `--noproxy '*'`。

## 目录

```
index.html                        单文件应用（业务代码只在这里）
tests/                            独立 Playwright 回归套件（suite.mjs）
tests/lib/                        浏览器启动与共享夹具
.agents/skills/verify-calculator/ 验收 skill：features/、scripts/、evidence/
deploy/                           静态服务器、systemd unit、部署说明
Telos/                            Kekkai Goal Gates 与验收证据
```
