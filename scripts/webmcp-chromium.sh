#!/usr/bin/env bash
# Launch a WebMCP-enabled Chromium with CDP exposed, for chrome-devtools-mcp.
#
#   StoryFlow's WebMCP tools (document.modelContext) activate only in secure
#   contexts (localhost) and behind Chrome's testing flag. This script starts
#   Chromium with both, opens the dev server, and leaves CDP on 9222 so the
#   official chrome-devtools-mcp server can attach (--browser-url):
#
#     npx -y chrome-devtools-mcp@latest --browser-url=http://127.0.0.1:9222
#
# Register that as an MCP server (project .mcp.json or `claude mcp add`) and
# Claude Code can drive StoryFlow's tools via evaluate_script.
set -euo pipefail

PORT=9222
URL="${1:-http://localhost:5173/}"
# Visible (non-dot) path: snap Chromium's home confinement blocks hidden
# directories like ~/.cache — a dotdir profile fails on SingletonLock.
PROFILE="${WEBMCP_PROFILE:-$HOME/webmcp-chromium-profile}"
CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"

if [ -z "$CHROME" ]; then
  echo "No Chrome/Chromium found." >&2
  exit 1
fi

mkdir -p "$PROFILE"

# Headless when there is no display (dev box is often SSH-only).
GUI_ARGS=()
if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
  GUI_ARGS=(--headless=new --disable-gpu)
fi

exec "$CHROME" \
  --enable-features=WebMCP \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE" \
  --no-first-run \
  --disable-extensions \
  "${GUI_ARGS[@]}" \
  "$URL"
