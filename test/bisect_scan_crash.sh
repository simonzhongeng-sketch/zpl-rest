#!/bin/bash
# bisect which subsystem makes the frozen exe die on a real-subnet scan
cd "$(dirname "$0")/exe_bugg"
EXE=./zpl-rest-20261027-1226.exe
SCAN='{"subnet":"192.168.77.0"}'

run_combo() {
  local label="$1"; shift
  rm -rf combo_db combo_logs; mkdir -p combo_db combo_logs
  printf '{\n  "port": 8400,\n  "websocket_port": 8401,\n  "mcp_port": 8402,\n  "tray": false,\n  "open_browser": false,\n  "public": true\n}' > config.json
  env "$@" "$EXE" > combo_out.txt 2> combo_err.txt &
  local pid=$!
  sleep 6
  local alive1=$(curl -s --noproxy '*' -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:8400/ 2>/dev/null)
  local scan=$(curl -s --noproxy '*' -o /dev/null -w "%{http_code}" --max-time 60 -X POST http://127.0.0.1:8400/rest/discover -H "Content-Type: application/json" -d "$SCAN" 2>/dev/null)
  sleep 1
  local alive2=$(curl -s --noproxy '*' -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:8400/ 2>/dev/null)
  echo "[$label] alive_before=$alive1 scan=$scan alive_after=$alive2"
  if [ "$alive2" != "200" ]; then echo "  DIED. stderr tail:"; tail -3 combo_err.txt | sed 's/^/    /'; fi
  kill $pid 2>/dev/null; wait $pid 2>/dev/null
  sleep 1
}

# move config next to nothing: exe reads config.json from ITS OWN dir; the
# combos must share the exe dir, so instead copy exe per combo? No — config
# ports conflict; simply run sequentially, each kills the previous.
run_combo "all-on (baseline)"
run_combo "skip-tray-mod"  ZPL_SKIP_TRAY_MOD=1
run_combo "skip-mcp"       ZPL_SKIP_MCP=1
run_combo "skip-ws"        ZPL_SKIP_WS=1
run_combo "skip-all"       ZPL_SKIP_TRAY_MOD=1 ZPL_SKIP_MCP=1 ZPL_SKIP_WS=1
