#!/usr/bin/env bash
# One-time setup on Fedora: installs uv, the Python dependencies and the Kokoro model files.
# uv fetches a compatible Python itself, so the system Python version doesn't matter.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v uv >/dev/null; then
  sudo dnf install -y uv
fi
uv sync

# KOKORO_MODEL=kokoro-v1.0.int8.onnx downloads the ~4x smaller quantised model instead.
model="${KOKORO_MODEL:-kokoro-v1.0.onnx}"
base=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
mkdir -p models
for file in "$model" voices-v1.0.bin; do
  if [ ! -f "models/$file" ]; then
    curl -L --fail -o "models/$file.part" "$base/$file"
    mv "models/$file.part" "models/$file"
  fi
done

echo "Done. Start the service with: cd tts && uv run server.py"
