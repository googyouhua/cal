# Deployment · cal-phone (192.168.1.25)

Mirrors the `/ws/voice` static-site pattern: one Node static server per app, systemd, HTTP + HTTPS on
dedicated ports.

## URLs

- `https://192.168.1.25:8444/` — HTTPS (reuses the hotword app's self-signed IP-SAN certificate; the browser
  warns once, choose 高级 → 继续前往).
- `http://192.168.1.25:8081/` — plain HTTP.

The calculator needs no COOP/COEP, but the shared server sends them; harmless.

## Voice assets

Install the local TTS runtime into the served `voice/` directory before enabling voice announcements:

```bash
bash scripts/install-voice-assets.sh    # defaults to /ws/voice/public and verifies 7 sha256 hashes
rsync -az --checksum voice/ root@192.168.1.25:/var/www/cal-phone/voice/
```

`voice/` holds approximately 96MB of sherpa-onnx 1.13.5 WASM + Matcha-TTS files. The model training data is
**非商用** (non-commercial use only). `deploy/server.cjs` serves files under `voice/` with immutable long-lived
caching and the correct `.wasm` / `.onnx` MIME types, so a refresh reuses the browser cache instead of downloading
again. Voice is disabled on `file://` and never blocks calculation when loading fails.

## Server layout

| Item | Path |
| --- | --- |
| systemd unit | `/etc/systemd/system/cal-phone.service` |
| static root | `/var/www/cal-phone` (`index.html` plus optional `voice/` assets) |
| server script | `/opt/cal-phone/server.cjs` |
| TLS | `/opt/hotword-asr-lab/tls/{cert,key}.pem` (shared, IP SAN `192.168.1.25`) |

## Redeploy the page

```bash
rsync -az --checksum index.html root@192.168.1.25:/var/www/cal-phone/
```

No restart is needed: the server reads from disk per request (cache header is `no-cache`). Only reinstall the
script/unit when `deploy/` changes:

```bash
scp deploy/server.cjs root@192.168.1.25:/opt/cal-phone/server.cjs
scp deploy/cal-phone.service root@192.168.1.25:/etc/systemd/system/cal-phone.service
ssh root@192.168.1.25 'systemctl daemon-reload && systemctl restart cal-phone'
```

## Verify

```bash
curl -s http://127.0.0.1:8081/ | sha256sum     # on the server, or with the host IP + --noproxy '*'
curl -sk https://192.168.1.25:8444/ -o /tmp/remote-cal.html
cmp /tmp/remote-cal.html index.html && echo INDEX_MATCH
ssh root@192.168.1.25 'systemctl is-active cal-phone'
```

## Rollback

```bash
ssh root@192.168.1.25 'cp -a /var/www/cal-phone /var/www/cal-phone.bak'
ssh root@192.168.1.25 'rsync -a --delete /var/www/cal-phone.bak/ /var/www/cal-phone/'
```

## First install (already done 2026-11-21)

```bash
ssh root@192.168.1.25 'mkdir -p /var/www/cal-phone /opt/cal-phone'
rsync -az --checksum index.html root@192.168.1.25:/var/www/cal-phone/
scp deploy/server.cjs root@192.168.1.25:/opt/cal-phone/server.cjs
scp deploy/cal-phone.service root@192.168.1.25:/etc/systemd/system/cal-phone.service
ssh root@192.168.1.25 'chmod a+rX /var/www/cal-phone /opt/cal-phone /opt/cal-phone/server.cjs && systemctl daemon-reload && systemctl enable --now cal-phone'
```
