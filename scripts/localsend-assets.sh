#!/usr/bin/env bash
# Phone → asset-folder bridge via LocalSend.
#
#   scripts/localsend-assets.sh /path/to/asset-folder ["设备别名"]
#
# Requires the LocalSend app on the phone (same Wi-Fi). Files land directly
# in the asset folder; StoryFlow's library auto-adopts them on scan (the
# in-app 手机投递 panel rescans automatically when new files arrive).
#
# Multi-NIC / phone-hotspot case — force the multicast interface:
#   LOCALSEND_IF_IP=192.168.x.x scripts/localsend-assets.sh <folder>
set -euo pipefail
DIR="${1:?usage: localsend-assets.sh <asset-folder> [alias]}"
ALIAS="${2:-StoryFlow 资产库}"
exec python3 "$(dirname "$0")/localsend_recv.py" "$DIR" "$ALIAS"
