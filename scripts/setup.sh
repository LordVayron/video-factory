#!/usr/bin/env bash
# One-shot setup for macOS or Linux.
#   bash scripts/setup.sh
# Expects node 22+, ffmpeg and python3 (macOS: brew install node ffmpeg python).
set -euo pipefail
cd "$(dirname "$0")/.."

for t in node ffmpeg python3; do
  command -v "$t" >/dev/null || { echo "missing $t (macOS: brew install node ffmpeg python; Linux: sudo apt install nodejs npm ffmpeg python3-pip)"; exit 1; }
done

npm ci
python3 -m pip install -r requirements.txt

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env. Open it and paste your KIE_API_TOKEN and ELEVENLABS_API_KEY."
fi

node scripts/doctor.mjs
