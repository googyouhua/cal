#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VOICE_SRC="${VOICE_SRC:-/ws/voice/public}"
VOICE_DST="${VOICE_DST:-$ROOT/voice}"

if [[ ! -d "$VOICE_SRC/sherpa-tts" ]]; then
  cat >&2 <<'EOF'
缺少语音资源源目录（默认 /ws/voice/public）。

可手动下载 Matcha-TTS 中文模型与 sherpa-onnx 1.13.5 WASM 运行时：
  https://huggingface.co/csukuangfj/matcha-icefall-zh-baker
  https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.13.5

把 7 个文件按下述相对路径放进 voice/，再运行 `sha256sum -c scripts/voice-assets.sha256`：
  sherpa-onnx-wasm-web.js, sherpa-onnx-wasm-web.wasm, sherpa-onnx-tts.js,
  sherpa-tts/matcha-zh-baker.onnx, sherpa-tts/hifigan_v2.onnx,
  sherpa-tts/lexicon.txt, sherpa-tts/tokens.txt
EOF
  exit 1
fi

if [[ ! -d "$VOICE_DST/sherpa-tts" ]]; then
  mkdir -p "$VOICE_DST/sherpa-tts"
fi

install_asset() {
  local src="$1" dst="$2"
  # Idempotent: an already-correct destination (even on a read-only mount) needs no write.
  if [[ -f "$dst" ]] && cmp -s "$src" "$dst"; then
    return 0
  fi
  cp -f "$src" "$dst"
}

install_asset "$VOICE_SRC/sherpa-onnx-wasm-web.js" "$VOICE_DST/sherpa-onnx-wasm-web.js"
install_asset "$VOICE_SRC/sherpa-onnx-wasm-web.wasm" "$VOICE_DST/sherpa-onnx-wasm-web.wasm"
install_asset "$VOICE_SRC/sherpa-onnx-tts.js" "$VOICE_DST/sherpa-onnx-tts.js"
install_asset "$VOICE_SRC/sherpa-tts/matcha-zh-baker.onnx" "$VOICE_DST/sherpa-tts/matcha-zh-baker.onnx"
install_asset "$VOICE_SRC/sherpa-tts/hifigan_v2.onnx" "$VOICE_DST/sherpa-tts/hifigan_v2.onnx"
install_asset "$VOICE_SRC/sherpa-tts/lexicon.txt" "$VOICE_DST/sherpa-tts/lexicon.txt"
install_asset "$VOICE_SRC/sherpa-tts/tokens.txt" "$VOICE_DST/sherpa-tts/tokens.txt"

cd "$ROOT"
sha256sum -c scripts/voice-assets.sha256
echo "语音资源已安装：$VOICE_DST"
