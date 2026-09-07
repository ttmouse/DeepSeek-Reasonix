#!/bin/bash
# Reasonix 系统诊断脚本 — 用于排查桌面版长期运行的资源消耗问题
# 使用方式: bash scripts/debug-reasonix.sh

set -euo pipefail

echo "=============================================="
echo "  Reasonix 系统诊断 $(date)"
echo "=============================================="

echo ""
echo "=== 1. Reasonix 进程 ==="
ps aux | grep -i reasonix | grep -v grep || echo "(无)"

echo ""
echo "=== 2. Reasonix FD 数 ==="
PID=$(pgrep -f reasonix-desktop | head -1)
if [ -n "$PID" ]; then
  echo "PID $PID, FD: $(lsof -p "$PID" 2>/dev/null | wc -l)"
else
  echo "No reasonix-desktop running"
fi

echo ""
echo "=== 3. WebKit XPC 进程数 ==="
echo "WebContent: $(ps aux | grep 'com.apple.WebKit.WebContent.xpc' | grep -v grep | wc -l)"
echo "GPU:        $(ps aux | grep 'com.apple.WebKit.GPU.xpc' | grep -v grep | wc -l)"
echo "Networking: $(ps aux | grep 'com.apple.WebKit.Networking.xpc' | grep -v grep | wc -l)"

echo ""
echo "=== 4. 僵尸进程 ==="
zombies=$(ps -eo pid,ppid,stat,lstart,comm 2>/dev/null | awk '$3=="Z"{print}')
if [ -n "$zombies" ]; then
  echo "$zombies"
else
  echo "(无)"
fi

echo ""
echo "=== 5. 用户进程总数 ==="
ps -U "$(whoami)" | wc -l

echo ""
echo "=== 6. Karabiner 状态 ==="
ps aux | grep -i karabiner | grep -v grep || echo "(未运行)"

echo ""
echo "=== 7. MCP 插件子进程 ==="
ps aux | grep -iE 'codegraph|mcp-server|browser-tools|puppeteer|playwright-mcp' | grep -v grep || echo "(无)"

echo ""
echo "=== 8. Reasonix 子进程 (僵尸/存活) ==="
REASONIX_PID=$(pgrep -f reasonix-desktop | head -1)
if [ -n "$REASONIX_PID" ]; then
  ps -eo pid,ppid,stat,comm | awk -v parent="$REASONIX_PID" '$2==parent{print}'
fi

echo ""
echo "=============================================="
echo "  诊断完成"
echo "=============================================="
