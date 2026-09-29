#!/usr/bin/env bash
# Demo-day launcher: build the frontend, then serve everything on http://localhost:8000
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "Missing .env — copy .env.example to .env and fill it in."; exit 1; }

(cd frontend && { [ -d node_modules ] || npm install; } && npm run build)
cd backend && exec uv run uvicorn main:app --host 127.0.0.1 --port 8000
