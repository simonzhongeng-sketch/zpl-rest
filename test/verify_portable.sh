#!/bin/bash
# portable-package verification: the scan scenarios that killed the pkg exe
cd "$(dirname "$0")/../dist/zpl-rest-portable" || exit 1
rm -rf db logs config.json
./node.exe main.js > port_out.txt 2> port_err.txt &
PID=$!
sleep 8
alive() { curl -s --noproxy '*' -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:18420/ 2>/dev/null; }
echo "alive_start: $(alive)"
for i in 1 2 3; do
  curl -s --noproxy '*' --max-time 60 -X POST http://127.0.0.1:18420/rest/discover -H "Content-Type: application/json" -d '{"subnet":"192.168.77.0"}' -o /dev/null
  echo "scan#$i empty-subnet: alive=$(alive)"
done
for i in 1 2 3; do
  r=$(curl -s --noproxy '*' --max-time 60 -X POST http://127.0.0.1:18420/rest/discover -H "Content-Type: application/json" -d '{"subnet":"127.0.0"}' | python -c "import json,sys; d=json.load(sys.stdin); print(len(d), [p['ip'] for p in d if p.get('ip')=='127.0.0.60'])" 2>/dev/null)
  echo "scan#$i loopback(mock): $r alive=$(alive)"
done
r3=$(curl -s --noproxy '*' --max-time 90 -X POST http://127.0.0.1:18420/rest/discover -H "Content-Type: application/json" -d '{"subnet":"192.168.8.0"}' | python -c "import json,sys; d=json.load(sys.stdin); print(len(d), 'devices:', [p.get('ip') or p.get('name','?') for p in d])" 2>/dev/null)
echo "real-subnet: $r3 alive=$(alive)"
echo "--- add printer (mock) ---"
curl -s --noproxy '*' --max-time 30 -X POST http://127.0.0.1:18420/rest/printer -H "Content-Type: application/json" -d '{"name":"PORTABLE-CHECK","conn":"tcp","address":"127.0.0.60:9100","dpi":203}' | python -c "import json,sys; d=json.load(sys.stdin); print('added:', d.get('_id', d)[:40] if isinstance(d.get('_id'), str) else d)" 2>/dev/null
echo "alive_final: $(alive)"
echo "--- preview still works? ---"
curl -s --noproxy '*' -o /dev/null -w "manual page: %{http_code}\n" --max-time 5 http://127.0.0.1:18420/manual
kill $PID 2>/dev/null
