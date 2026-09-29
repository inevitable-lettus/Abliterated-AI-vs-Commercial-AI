#!/usr/bin/env bash
# Point the app at Krish's Ollama and test the link. The running app picks it up within ~10 s.
#   ./connect-krish.sh 172.20.10.5          (IP he sends you; port 11434 assumed)
#   ./connect-krish.sh http://host:port     (full URL)
set -euo pipefail
cd "$(dirname "$0")"

[ $# -eq 1 ] || { echo "usage: ./connect-krish.sh <krish-ip | url>"; exit 1; }
case "$1" in
  http://*|https://*) URL="${1%/}" ;;
  *:*)                URL="http://$1" ;;
  *)                  URL="http://$1:11434" ;;
esac

if grep -q '^OLLAMA_URL=' .env; then
  sed -i '' "s|^OLLAMA_URL=.*|OLLAMA_URL=$URL|" .env
else
  echo "OLLAMA_URL=$URL" >> .env
fi
MODEL=$(grep '^OLLAMA_MODEL=' .env | cut -d= -f2-)
echo "OLLAMA_URL set to $URL"
echo "Expecting model: $MODEL"
echo

if ! TAGS=$(curl -s -m 5 "$URL/api/tags"); then
  echo "✗ Can't reach $URL"
  echo "  - Same hotspot? Your IP: $(ipconfig getifaddr en0 2>/dev/null || echo unknown)"
  echo "  - Krish: OLLAMA_HOST=0.0.0.0:11434 set, Ollama restarted, firewall rule added?"
  exit 1
fi

if echo "$TAGS" | grep -Eq "\"$MODEL(:latest)?\""; then
  echo "✓ Connected. '$MODEL' is available. The left dot should turn green within 10 s."
else
  echo "✗ Reached Ollama, but '$MODEL' isn't in its model list. Models on Krish's machine:"
  echo "$TAGS" | grep -o '"name":"[^"]*"' | cut -d'"' -f4 | sed 's/^/    /'
  echo "  Fix OLLAMA_MODEL in .env to one of these."
  exit 1
fi
