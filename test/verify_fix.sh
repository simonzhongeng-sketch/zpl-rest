#!/bin/bash
# final verification: the fixed exe must survive repeated subnet scans
# (empty + loopback with mock + the real LAN subnet) and keep serving.
cd "$(dirname "$0")/exe_bugg" || exit 1
EXE=./zpl-rest-20261027-1328.exe
cp ../../dist/zpl-rest-20261027-1328.exe .
printf '{\n  "port": 8400,\n  "websocket_port": 8401,\n  "mcp_port": 8402,\n  "tray": false,\n  "open_browser": false,\n  "public": true\n}' > config.json
rm -f logs/crash.log
"$EXE" > fix_out.txt 2> fix_err.txt &
PID=$!
sleep 7
alive() { curl -s --noproxy '*' -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:8400/ 2>/dev/null; }
echo "alive_start: $(alive)"
for i in 1 2 3; do
  r1=$(curl -s --noproxy '*' --max-time 60 -X POST http://127.0.0.1:8400/rest/discover -H "Content-Type: application/json" -d '{"subnet":"192.168.77.0"}' | head -c 80)
  echo "scan#$i empty-subnet: resp=${r1:0:60} alive=$(alive)"
done
for i in 1 2 3; do
  r2=$(curl -s --noproxy '*' --max-time 60 -X POST http://127.0.0.1:8400/rest/discover -H "Content-Type: application/json" -d '{"subnet":"127.0.0"}' | python -c "import json,sys; d=json.load(sys.stdin); print(len(d), 'zebra:', [p['ip'] for p in d])" 2>/dev/null)
  echo "scan#$i loopback: $r2 alive=$(alive)"
done
r3=$(curl -s --noproxy '*' --max-time 90 -X POST http://127.0.0.1:8400/rest/discover -H "Content-Type: application/json" -d '{"subnet":"192.168.8.0"}' | python -c "import json,sys; d=json.load(sys.stdin); print(len(d), 'devices:', [(p.get('ip') or p.get('name','?')) for p in d])" 2>/dev/null)
echo "real-subnet: $r3 alive=$(alive)"
echo "--- add printer (mock) ---"
curl -s --noproxy '*' --max-time 30 -X POST http://127.0.0.1:8400/rest/printer -H "Content-Type: application/json" -d '{"name":"FIX-CHECK","conn":"tcp","address":"127.0.0.60:9100","dpi":203}' | head -c 200
echo
echo "alive_final: $(alive)"
kill $PID 2>/dev/null
