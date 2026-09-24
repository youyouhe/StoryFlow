#!/usr/bin/env bash
# WhisperX 类对齐服务启动器(StoryFlow#6,docs/storyflow-ir-p8.md §2 契约)。
#
# GPU 纪律(派单原文):CUDA_DEVICE_ORDER=PCI_BUS_ID 且 CUDA_VISIBLE_DEVICES=3
# ——两个变量在此导出,进程级钉死;当前后端为 CPU 声学对齐(本机无 NVIDIA
# GPU),未来换 torch/WhisperX 后端零改动即落 GPU 3。
# 端口纪律:默认 8788;脚本拒绝 start/forward 8940/8940——生产服务勿动。
#
# 用法: align_service.sh {start|stop|status|restart|foreground} [port]
set -euo pipefail

PORT="${2:-8788}"
if [ "$PORT" = "8940" ] || [ "$PORT" = "8950" ]; then
  echo "拒绝使用端口 $PORT —— 生产服务端口,勿动 8950/8940" >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="/tmp/storyflow-align-service-${PORT}.pid"
LOG_FILE="/tmp/storyflow-align-service-${PORT}.log"

export CUDA_DEVICE_ORDER=PCI_BUS_ID
export CUDA_VISIBLE_DEVICES=3

is_up() { curl -s --max-time 2 "http://127.0.0.1:${PORT}/health" | grep -q '"ok"'; }

case "${1:-status}" in
  start)
    if is_up; then echo "align service already up on :${PORT}"; exit 0; fi
    nohup python3 "${HERE}/align_service.py" --port "$PORT" >>"$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    for _ in $(seq 1 20); do
      sleep 0.3
      if is_up; then
        echo "align service up on http://127.0.0.1:${PORT} (pid $(cat "$PID_FILE"), log $LOG_FILE)"
        exit 0
      fi
    done
    echo "align service failed to start — see $LOG_FILE" >&2
    tail -5 "$LOG_FILE" >&2 || true
    exit 1
    ;;
  stop)
    if [ -f "$PID_FILE" ]; then
      kill "$(cat "$PID_FILE")" 2>/dev/null || true
      rm -f "$PID_FILE"
    fi
    echo "align service stopped (:${PORT})"
    ;;
  status)
    if is_up; then
      echo "up"; curl -s "http://127.0.0.1:${PORT}/health"; echo
    else
      echo "down"
      exit 1
    fi
    ;;
  restart)
    "$0" stop "$PORT" || true
    "$0" start "$PORT"
    ;;
  foreground)
    exec python3 "${HERE}/align_service.py" --port "$PORT"
    ;;
  *)
    echo "usage: $0 {start|stop|status|restart|foreground} [port]" >&2
    exit 2
    ;;
esac
