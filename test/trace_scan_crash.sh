#!/bin/bash
# fine-grained trace: where exactly does the frozen exe die during the scan?
cd "$(dirname "$0")/exe_bugg" || exit 1
rm -f trace_out.txt trace_err.txt logs/crash.log
printf '{\n  "port": 8400,\n  "websocket_port": 8401,\n  "mcp_port": 8402,\n  "tray": false,\n  "open_browser": false,\n  "public": true\n}' > config.json
ZPL_SCAN_TRACE=1 ZPL_HEARTBEAT=1 ./zpl-rest-20261027-1250.exe > trace_out.txt 2> trace_err.txt &
PID=$!
sleep 7
alive1=$(curl -s --noproxy '*' -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:8400/ 2>/dev/null)
echo "alive_before=$alive1"
scan=$(curl -s --noproxy '*' -o /dev/null -w "%{http_code}:%{time_total}" --max-time 60 -X POST http://127.0.0.1:8400/rest/discover -H "Content-Type: application/json" -d '{"subnet":"192.168.77.0"}' 2>/dev/null)
echo "scan=$scan"
sleep 2
alive2=$(curl -s --noproxy '*' -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:8400/ 2>/dev/null)
echo "alive_after=$alive2"
kill $PID 2>/dev/null; wait $PID 2>/dev/null
echo "=== stderr tail ==="
tail -30 trace_err.txt
echo "=== crash.log tail ==="
tail -15 logs/crash.log 2>/dev/null
