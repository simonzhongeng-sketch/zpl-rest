#!/bin/bash
# which sweep mode survives the security agent's tree-kill?
cd "$(dirname "$0")/exe_bugg" || exit 1
cp ../../dist/zpl-rest-20261027-1322.exe .
printf '{\n  "port": 8400,\n  "websocket_port": 8401,\n  "mcp_port": 8402,\n  "tray": false,\n  "open_browser": false,\n  "public": true\n}' > config.json

run_mode() {
  local mode="$1"
  rm -f logs/crash.log mode_err.txt
  ZPL_SWEEP_PSMODE="$mode" ./zpl-rest-20261027-1322.exe > mode_out.txt 2> mode_err.txt &
  local pid=$!
  sleep 7
  local a1=$(curl -s --noproxy '*' -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:8400/ 2>/dev/null)
  local r1=$(curl -s --noproxy '*' --max-time 60 -X POST http://127.0.0.1:8400/rest/discover -H "Content-Type: application/json" -d '{"subnet":"127.0.0"}' 2>/dev/null | python -c "import json,sys; d=json.load(sys.stdin); print(len(d), [p['ip'] for p in d if p.get('ip')=='127.0.0.60'])" 2>/dev/null)
  sleep 1
  local a2=$(curl -s --noproxy '*' -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:8400/ 2>/dev/null)
  echo "[$mode] alive_before=$a1 scan_result=$r1 alive_after=$a2"
  kill $pid 2>/dev/null; wait $pid 2>/dev/null
  sleep 1
}

run_mode sleep
run_mode paced
run_mode burst
