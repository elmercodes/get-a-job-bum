#!/usr/bin/env bash
# Run the regression suite with disposable fictional data and credentials.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)/server"
phase1_temp=$(mktemp -d)
phase1_port=${AUTOJOB_TEST_PORT:-}
if [[ -z "$phase1_port" ]]; then phase1_port=18787; fi
phase1_pid=
cleanup() {
  if [[ -n "$phase1_pid" ]]; then kill "$phase1_pid" 2>/dev/null || true; fi
  rm -rf -- "$phase1_temp"
}
trap cleanup EXIT
export AUTOJOB_TOKEN
AUTOJOB_TOKEN=$(node -p 'require("node:crypto").randomBytes(32).toString("hex")')
export AUTOJOB_URL="http://127.0.0.1:$phase1_port"
export AUTOJOB_DATA="$phase1_temp/data"
export CI=true
if [[ -z "${CHROME:-}" ]]; then CHROME=$(command -v google-chrome); fi
export CHROME
mkdir -m 700 "$AUTOJOB_DATA"
cp test/fixtures/*.json "$AUTOJOB_DATA/"
node test/seed-evidence.mjs "$AUTOJOB_DATA/profile.json"
env -i PATH="$PATH" CI=true AUTOJOB_TOKEN="$AUTOJOB_TOKEN" AUTOJOB_TEST=1 AUTOJOB_DATA="$AUTOJOB_DATA" \
  PORT="$phase1_port" DOTENV_CONFIG_PATH="$phase1_temp/missing.env" \
  LLM_PROVIDER=ollama OLLAMA_URL=http://127.0.0.1:9 OLLAMA_FALLBACK=off node src/index.js >"$phase1_temp/server.log" 2>&1 &
phase1_pid=$!
for attempt in {1..30}; do
  kill -0 "$phase1_pid" 2>/dev/null
  if curl -fsS -H "Authorization: Bearer $AUTOJOB_TOKEN" "$AUTOJOB_URL/api/health" >/dev/null 2>&1; then break; fi
  sleep 0.25
done
if (($#)); then
  node test/run-all.mjs "$@"
else
  npm test
fi
