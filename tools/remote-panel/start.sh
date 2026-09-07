#!/bin/bash
# Reasonix 移动遥控面板 — 独立启动脚本
#
# 用途：手机浏览器远程查看/推进 Reasonix 会话。
# 本脚本用 nohup 独立启动面板，使其不再依附于桌面 App 或终端。
# 桌面 App 开关、本终端关闭，都不影响手机访问。
#
# 用法：
#   ./start.sh            启动（后台常驻）
#   ./start.sh stop       停止
#   ./start.sh status     查看状态
#   ./start.sh restart    重启
#
# 配置：TOKEN 固定为首次生成的随机值（保存在 ~/.reasonix/remote-panel-token），
#       这样手机收藏的链接不会变。PORT 默认 8788。

set -euo pipefail

PORT="${REMOTE_PANEL_PORT:-8788}"
ADDR="0.0.0.0:${PORT}"
TOKEN_FILE="$HOME/.reasonix/remote-panel-token"
LOG_FILE="$HOME/.reasonix/remote-panel.log"
PID_FILE="$HOME/.reasonix/remote-panel.pid"

# 面板二进制：优先用项目内编译好的，其次 ~/.local/bin
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -x "$SCRIPT_DIR/bin/reasonix-remote-panel" ]]; then
  BIN="$SCRIPT_DIR/bin/reasonix-remote-panel"
elif [[ -x "$HOME/.local/bin/reasonix-remote-panel" ]]; then
  BIN="$HOME/.local/bin/reasonix-remote-panel"
else
  echo "错误：找不到 reasonix-remote-panel 二进制。先构建："
  echo "  cd $SCRIPT_DIR && go build -o bin/reasonix-remote-panel ."
  exit 1
fi

# reasonix 主程序路径（注入指令用）
REASONIX_BIN="$(command -v reasonix || true)"
if [[ -z "$REASONIX_BIN" ]]; then
  REASONIX_BIN="$HOME/.npm-global/bin/reasonix"
fi

# 首次启动生成固定 token
if [[ ! -f "$TOKEN_FILE" ]]; then
  mkdir -p "$(dirname "$TOKEN_FILE")"
  openssl rand -hex 16 > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
fi
TOKEN="$(cat "$TOKEN_FILE")"

get_lan_ip() {
  local ip
  ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
  [[ -z "$ip" ]] && ip="$(ipconfig getifaddr en1 2>/dev/null || true)"
  [[ -z "$ip" ]] && ip="127.0.0.1"
  echo "$ip"
}

status() {
  if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "运行中 (pid $(cat "$PID_FILE"))"
    echo "手机访问: http://$(get_lan_ip):${PORT}/?token=${TOKEN}"
    return 0
  fi
  echo "未运行"
  return 1
}

start() {
  if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "已在运行 (pid $(cat "$PID_FILE"))"
    echo "手机访问: http://$(get_lan_ip):${PORT}/?token=${TOKEN}"
    return 0
  fi
  rm -f "$PID_FILE"
  # If the port is already taken by another process (e.g. a previous panel),
  # fail fast with a clear message instead of a raw bind error later.
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "启动失败：端口 $PORT 已被占用。先执行 ./start.sh stop，或结束占用进程。"
    echo "占用进程:"
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN | head -3
    exit 1
  fi
  # nohup + disown：脱离当前进程组，桌面 App / 终端退出不影响面板。
  # Log is overwritten (>) each start so stale errors never mislead.
  nohup "$BIN" --reasonix-bin "$REASONIX_BIN" --addr "$ADDR" --token "$TOKEN" \
    > "$LOG_FILE" 2>&1 &
  local pid=$!
  disown "$pid" 2>/dev/null || true
  echo "$pid" > "$PID_FILE"
  sleep 1
  if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "已启动 (pid $(cat "$PID_FILE"))"
    echo "日志: $LOG_FILE"
    echo "手机访问: http://$(get_lan_ip):${PORT}/?token=${TOKEN}"
  else
    echo "启动失败，查看日志: $LOG_FILE"
    cat "$LOG_FILE"
    exit 1
  fi
}

stop() {
  if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    kill "$(cat "$PID_FILE")"
    rm -f "$PID_FILE"
    echo "已停止"
  else
    echo "未在运行"
  fi
}

case "${1:-start}" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; sleep 1; start ;;
  status)  status ;;
  *) echo "用法: $0 {start|stop|restart|status}"; exit 1 ;;
esac
