// Zebra printer discovery on the local network.
// Strategy: scan the given /24 subnet for open TCP 9100. Before sending
// ANY data to port 9100, identify the vendor over HTTP (ports 80/631/8080)
// — raw 9100 devices such as HP JetDirect print everything they receive,
// so only devices identified as Zebra via HTTP are interrogated with
// ZPL SGD commands to read model and dpi.
//
// The 9100 sweep itself runs in PowerShell on Windows: the @yao-pkg frozen
// runtime has a race where a burst of pending outbound TCP connects (a /24
// scan always produces dozens) can silently terminate the whole process —
// no JS exception, no Windows Error Reporting entry, the exe just vanishes
// (see test/pkg_repro and test/av_probe: plain node.exe survives, the frozen
// exe dies). PowerShell is immune, spawns fine from the frozen exe (the USB
// enumeration already relies on it) and sweeps 254 hosts in about a second.
// The per-device interrogation (vendor check + SGD) stays in node: a handful
// of connections to LIVE, fast-answering hosts, which never triggered the
// crash.

var net = require('net');
var http = require('http');
var os = require('os');
var fs = require('fs');
var path = require('path');
var execFile = require('child_process').execFile;
var profiles = require('./printer_profiles.js');

var SCAN_PORT = 9100;
// node sweep connect timeout. Must match the wait of the PowerShell sweep
// (SWEEP_PS WaitMs): 700 ms looked enough but Wi-Fi power-save plus a first
// SYN on a busy printer regularly needs ~1 s, and a half-swept /24 is
// indistinguishable from "no printers here" in the UI. Scans that come back
// empty are exactly what the "printer not found" reports were made of.
// Cost: 254 hosts / 32 concurrent x 1.2 s ~= 9.5 s worst case for a dead /24.
var SCAN_TIMEOUT = 1200;
// The PowerShell sweep collects answers incrementally and keeps polling until
// every socket has resolved or this deadline passes. A single fixed 1.2 s
// window (the previous design) silently dropped printers whose SYN or ARP
// reply was delayed — on Wi-Fi, where a 254-host burst competes for airtime,
// one printer of a fleet coming back late is enough to lose it from the list.
var SWEEP_DEADLINE = 3000;
// second chance: hosts present in the ARP table but not reported open by the
// sweep get one clean node connect each. Cheap (the table holds live hosts
// only) and targeted at exactly the "everything found except one" report.
var SWEEP_RECHECK_TIMEOUT = 2000;
var SWEEP_RECHECK_LIMIT = 64;
var SGD_TIMEOUT = 1500;
// interrogating live hosts only — a small burst is safe everywhere
var CONCURRENCY = 32;

// HTTP ports used for vendor identification (safe: never causes printing)
var HTTP_PORTS = [80, 631, 8080];
var HTTP_TIMEOUT = 1200;
// second, slower identification pass for hosts that did not answer at all
var HTTP_TIMEOUT_RETRY = 3000;

function mapLimit(items, limit, fn) {
  return new Promise(function (resolve) {
    var results = new Array(items.length);
    var index = 0;
    var active = 0;

    function next() {
      if (index >= items.length && active === 0) {
        return resolve(results);
      }
      while (active < limit && index < items.length) {
        (function (idx) {
          active++;
          fn(items[idx]).then(function (r) {
            results[idx] = r;
            active--;
            next();
          });
        })(index++);
      }
    }
    next();
  });
}

function probePort(ip, port, timeout) {
  return new Promise(function (resolve) {
    var socket = new net.Socket();
    var done = false;
    var probeN = (++probeSeq);
    var dbg = !!process.env.ZPL_SCAN_TRACE;
    function finish(open) {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(open);
    }
    socket.setTimeout(timeout);
    socket.once('connect', function () { finish(true); });
    socket.once('timeout', function () { finish(false); });
    socket.once('error', function () { finish(false); });
    if (dbg) { try { require('./crashlog.js').log('probe', '#' + probeN + ' connecting ' + ip + ':' + port); } catch (e) {} }
    socket.connect(port, ip);
    if (dbg) { try { require('./crashlog.js').log('probe', '#' + probeN + ' connect() returned'); } catch (e) {} }
  });
}
var probeSeq = 0;

// like probePort, but reports why: the connectivity tester in the UI needs
// "refused / timeout / unreachable" to tell a wrong port from a blocked route
function probeDetailed(host, port, timeout) {
  return new Promise(function (resolve) {
    var t0 = Date.now();
    var socket = new net.Socket();
    var done = false;
    function finish(ok, err) {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch (e) {}
      resolve({ host: host, port: port, reachable: ok, ms: Date.now() - t0, error: ok ? null : (err || 'timeout') });
    }
    socket.setTimeout(timeout);
    socket.once('connect', function () { finish(true); });
    socket.once('timeout', function () { finish(false, 'timeout (no answer — wrong IP, or the route is blocked)'); });
    socket.once('error', function (e) { finish(false, (e && e.code) || 'error'); });
    try { socket.connect(port, host); } catch (e) { finish(false, e.message); }
  });
}

// local addressing as the OS reports it (netmask straight from node, gateway
// from the routing table): the "why can't this PC see the printer" answer
// lives here — a Wi-Fi NIC on 10.x with the printers on 192.168.8 is visible
// at a glance
function networkInfo() {
  var out = [];
  var ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach(function (name) {
    (ifaces[name] || []).forEach(function (a) {
      if ((a.family !== 'IPv4' && a.family !== 4) || a.internal) return;
      out.push({ name: name, address: a.address, netmask: a.netmask, cidr: a.cidr || null, virtual: VIRTUAL_IF.test(name) });
    });
  });
  return out;
}

// default gateway (Windows routing table); resolves null elsewhere
function defaultGateway() {
  return new Promise(function (resolve) {
    if (process.platform !== 'win32') return resolve(null);
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command',
        "(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1).NextHop"],
      { windowsHide: true, timeout: 8000 },
      function (err, stdout) {
        var v = String(stdout || '').trim();
        resolve(!err && v && v !== '' ? v : null);
      });
  });
}

// single ICMP echo, used to prove the PC is on a live network at all
function pingHost(host, timeoutMs) {
  return new Promise(function (resolve) {
    var args = process.platform === 'win32'
      ? ['-n', '1', '-w', String(timeoutMs || 1500), host]
      : ['-c', '1', '-W', String(Math.max(1, Math.round((timeoutMs || 1500) / 1000))), host];
    var t0 = Date.now();
    execFile('ping', args, { windowsHide: true, timeout: (timeoutMs || 1500) + 3000 },
      function (err, stdout) {
        var txt = String(stdout || '');
        var ok = !err && /(?:TTL=|ttl=)/.test(txt);
        resolve({ host: host, ok: ok, ms: Date.now() - t0 });
      });
  });
}

// low-level variant of sgdQuery that also reports whether the device sent
// anything at all (even an empty line), so callers can decide whether it is
// safe to send a follow-up command (a device that never answers gets none).
function sgdQueryRaw(ip, port, variable, timeout) {
  return new Promise(function (resolve) {
    var socket = new net.Socket();
    var data = '';
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({data: data, value: cleanSgd(data)});
    }
    socket.setTimeout(timeout);
    socket.connect(port, ip, function () {
      socket.write('! U1 getvar "' + variable + '"\r\n');
    });
    socket.on('data', function (chunk) {
      data += chunk.toString();
      if (/[\r\n]/.test(data)) {
        finish();
      }
    });
    socket.on('timeout', finish);
    socket.on('error', finish);
  });
}

// run one SGD getvar on its own connection, resolve the cleaned value
// (null when the device did not answer). Robust against real-world
// firmware quirks:
// - answers may come WITHOUT a trailing newline (waited until timeout, but
//   partial data is kept, not discarded)
// - values may be wrapped in double quotes ("ZT510")
function sgdQuery(ip, port, variable, timeout) {
  return sgdQueryRaw(ip, port, variable, timeout).then(function (r) {
    return r.value;
  });
}

// strip surrounding quotes and whitespace from an SGD answer
function cleanSgd(val) {
  if (!val) return null;
  var v = String(val).trim().replace(/^"+|"+$/g, '').trim();
  return v || null;
}

// parse subnet input: "192.168.8", "192.168.8.0", "192.168.8.0/24" -> [ip, ...]
function expandSubnet(subnet) {
  var m = String(subnet).trim().match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})(?:\.(\d{1,3}))?(?:\/24)?$/);
  if (!m) return null;
  if (m[2] !== undefined && m[2] !== '0') return null; // only full /24 subnets
  var base = m[1];
  var hosts = [];
  for (var i = 1; i <= 254; i++) hosts.push(base + '.' + i);
  return hosts;
}

// best-effort guess of the server's own /24 subnet
// Adapters that never carry the printers (VM hosts, VPN clients, WSL,
// container bridges). On a laptop with any of these installed the OLD code
// picked whichever interface the OS happened to list first, scanned a dead
// /24 and honestly reported "no printers found" while the printers sat on
// the Ethernet NIC. Virtual ones are ranked last but still scanned if nothing
// else exists.
var VIRTUAL_IF = /(vmware|virtualbox|hyper-?v|vethernet|wsl|docker|loopback|tailscale|zerotier|wireguard|openvpn|tap|tun\d|npcap|bluetooth|hamachi|radmin|virtual|vpn)/i;

// all usable IPv4 interfaces, physical/private ones first
function ifaceList() {
  var ifaces = os.networkInterfaces();
  var out = [];
  Object.keys(ifaces).forEach(function (name) {
    (ifaces[name] || []).forEach(function (a) {
      if (a.family !== 'IPv4' && a.family !== 4) return;
      if (a.internal) return;
      var parts = String(a.address).split('.');
      if (parts.length !== 4) return;
      var ip = parts.map(Number);
      if (ip[0] === 169 && ip[1] === 254) return; // APIPA: no DHCP lease
      var isVirtual = VIRTUAL_IF.test(name);
      var rank = isVirtual ? 100 : 0;
      if (ip[0] === 192 && ip[1] === 168) rank += 0;
      else if (ip[0] === 10) rank += 1;
      else if (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31) rank += 2;
      else if (ip[0] === 127) rank += 50;
      else rank += 10;
      out.push({ name: name, address: a.address, base: ip.slice(0, 3).join('.'), virtual: isVirtual, rank: rank });
    });
  });
  out.sort(function (x, y) { return x.rank - y.rank; });
  return out;
}

// candidate /24 bases to scan, best first (virtual adapters included last)
function localSubnets() {
  return ifaceList();
}

// the subnet the service is most likely printing from (x.x.x.0/24)
function localSubnet() {
  var list = localSubnets();
  return list.length ? list[0].base + '.0/24' : null;
}

// fetch a page over plain HTTP (GET /), resolve headers+body lowercase text
// or null on any error/timeout. Sending HTTP requests never causes printing.
function httpFetch(ip, port, timeout) {
  return new Promise(function (resolve) {
    var req = http.get({ host: ip, port: port, path: '/' }, function (res) {
      var chunks = [];
      var len = 0;
      res.on('data', function (c) {
        len += c.length;
        if (len <= 65536) chunks.push(c);
      });
      res.on('end', function () {
        var head = JSON.stringify(res.headers || {});
        var body = Buffer.concat(chunks).toString('utf8').slice(0, 65536);
        resolve((head + ' ' + body).toLowerCase());
      });
    });
    req.setTimeout(timeout, function () { req.destroy(); resolve(null); });
    req.on('error', function () { resolve(null); });
  });
}

// identify the device vendor WITHOUT touching port 9100.
// returns: { isZebra: true|false|null, page: <first fetched page or null> }
// (the page is reused as a dpi fallback, e.g. "ZTC ZT510-300dpi ZPL")
// A conflicting vendor keyword always wins over a zebra match: we never
// risk printing on HP-style devices that print everything they receive.
// isZebra === null means "no web server answered within the timeout" — that
// is NOT proof of a non-Zebra device, so the caller retries slower before
// dropping the host (a busy 300 dpi printer answers HTTP in ~2 s under load).
function httpIdentifyVendor(ip, timeout) {
  return mapLimit(HTTP_PORTS, HTTP_PORTS.length, function (port) {
    return httpFetch(ip, port, timeout || HTTP_TIMEOUT);
  }).then(function (pages) {
    var result = { isZebra: null, page: null };
    for (var i = 0; i < pages.length; i++) {
      var p = pages[i];
      if (!p) continue;
      if (!result.page) result.page = p;
      if (/(hewlett|laserjet|jetdirect|\bhp\b|canon|brother|epson|xerox|kyocera|ricoh|\boki\b|lexmark|samsung)/.test(p)) {
        result.isZebra = false;
        return result;
      }
      if (p.indexOf('zebra') !== -1) {
        result.isZebra = true;
      }
    }
    return result;
  });
}

// identification with one slow second pass when nothing answered at all.
// A confirmed non-Zebra answer is final (never re-asked, never printed to);
// only the "no answer" case is retried, which costs time but can only turn a
// miss into a hit, never an unsafe host into an interrogated one.
function identifyVendor(ip) {
  return httpIdentifyVendor(ip).then(function (id) {
    if (id.isZebra !== null) return id;
    return httpIdentifyVendor(ip, HTTP_TIMEOUT_RETRY).then(function (id2) {
      return id2.isZebra !== null ? id2 : id;
    });
  });
}

// resolve the printhead dpi with a fallback chain:
// 1. SGD device.head.resolution.in_dpi (works on most firmwares)
// 2. SGD device.head.resolution.in_dots_per_mm (some firmwares only)
// 3. parse the identification web page (e.g. "ZTC ZT510-300dpi ZPL")
function resolveDpi(ip, page) {
  return sgdQuery(ip, SCAN_PORT, 'device.head.resolution.in_dpi', SGD_TIMEOUT).then(function (raw) {
    var dpi = parseInt(raw, 10);
    if (dpi > 0 && dpi < 10000) return { dpi: dpi, dpmm: null };
    return sgdQuery(ip, SCAN_PORT, 'device.head.resolution.in_dots_per_mm', SGD_TIMEOUT).then(function (raw2) {
      var v = parseFloat(raw2);
      if (v >= 1 && v <= 30) return { dpi: null, dpmm: Math.round(v) };
      if (page) {
        var m = page.match(/(\d{2,3})\s*dpi/);
        if (m) return { dpi: parseInt(m[1], 10), dpmm: null };
      }
      return { dpi: null, dpmm: null };
    });
  });
}

// read the device serial number, the stable identity of a physical printer
// (survives DHCP address changes). Falls back to device.unique_id when the
// firmware does not implement device.serial_number. Some firmwares answer
// unsupported getvars with a bare "?" placeholder — that is NOT an identity,
// so the fallback chain must continue (real ZT510: serial_number -> "?",
// unique_id -> "34J244300042").
function plausibleSerial(v) {
  return !!v && /[A-Za-z0-9]/.test(v);
}

function resolveSerial(ip) {
  return sgdQuery(ip, SCAN_PORT, 'device.serial_number', SGD_TIMEOUT).then(function (serial) {
    if (plausibleSerial(serial)) return serial;
    return sgdQuery(ip, SCAN_PORT, 'device.unique_id', SGD_TIMEOUT);
  });
}

// ---- 9100 sweep ------------------------------------------------------------

// PowerShell sweep script: fire 254 async TcpClient connects, then poll them
// in small steps, banking every socket that reaches "connected" and stopping
// as soon as nothing is pending (or the $MaxMs deadline passes). The earlier
// version slept a single fixed window and polled once: any host whose connect
// completed after that window was reported as absent, which is exactly how a
// live printer went missing on a Wi-Fi connected machine.
// ZPL_SWEEP_PSMODE (read from the env inside the script) selects:
//   sleep  - no network at all (diagnostic: is spawning PS itself safe?)
//   paced  - 12 connects per 25 ms batch (diagnostic / low-noise mode)
//   burst  - all 254 at once
//
// After the first pass the script re-probes the hosts the OS ARP table shows
// inside this /24 but that never answered: a SYN dropped during the burst (the
// "one printer of the fleet is missing" report) is recovered that way. This
// second pass stays INSIDE PowerShell on purpose — extra sockets opened by the
// node process are exactly what the frozen pkg runtime (and endpoint agents
// watching its process tree) reacts badly to, so node must keep making only
// the handful of per-device connections it always did.
var SWEEP_PS = [
  'param([string]$Base, [int]$Port = ' + SCAN_PORT + ', [int]$MaxMs = ' + SWEEP_DEADLINE + ')',
  '$mode = $env:ZPL_SWEEP_PSMODE',
  'if ($mode -eq "sleep") { Start-Sleep -Milliseconds 800; "[]"; exit }',
  '$clients = New-Object System.Collections.ArrayList',
  'foreach ($i in 1..254) {',
  '  $ip = "$Base.$i"',
  '  $t = New-Object System.Net.Sockets.TcpClient',
  '  try { [void]$t.BeginConnect($ip, $Port, $null, $null) } catch {}',
  '  [void]$clients.Add(@{ ip = $ip; c = $t; done = $false })',
  '  if ($mode -eq "paced" -and ($i % 12) -eq 0) { Start-Sleep -Milliseconds 25 }',
  '}',
  '$open = New-Object System.Collections.ArrayList',
  '$sw = [System.Diagnostics.Stopwatch]::StartNew()',
  'while ($true) {',
  '  $pending = 0',
  '  foreach ($e in $clients) {',
  '    if ($e.done) { continue }',
  '    try {',
  '      $s = $e.c.Client',
  '      if ($s.Poll(0, [System.Net.Sockets.SelectMode]::SelectWrite)) {',
  '        $e.done = $true',
  '        if (-not $s.Poll(0, [System.Net.Sockets.SelectMode]::SelectError)) { [void]$open.Add($e.ip) }',
  '      } elseif ($s.Poll(0, [System.Net.Sockets.SelectMode]::SelectError)) {',
  '        $e.done = $true',
  '      } else { $pending++ }',
  '    } catch { $e.done = $true }',
  '  }',
  '  if ($pending -eq 0) { break }',
  '  if ($sw.ElapsedMilliseconds -ge $MaxMs) { break }',
  '  Start-Sleep -Milliseconds 40',
  '}',
  'foreach ($e in $clients) { try { $e.c.Close() } catch {} }',
  'try {',
  '  $known = @{}',
  '  foreach ($o in $open) { $known[$o] = 1 }',
  '  $cand = New-Object System.Collections.ArrayList',
  '  foreach ($ln in (& arp -a 2>$null)) {',
  '    if ($ln -match "\s(\d{1,3}(?:\.\d{1,3}){3})\s+((?:[0-9a-fA-F]{2}[-:]){5}[0-9a-fA-F]{2})") {',
  '      $nip = $matches[1]',
  '      $nmac = $matches[2].Replace("-", "").Replace(":", "")',
  '      if ($nmac -match "^0+$" -or $nmac -match "^[fF]+$") { continue }',
  '      if ($nip.StartsWith("$Base.") -and -not $known.ContainsKey($nip) -and -not $cand.Contains($nip)) { [void]$cand.Add($nip) }',
  '    }',
  '  }',
  '  if ($cand.Count -gt 0) {',
  '    $c2 = New-Object System.Collections.ArrayList',
  '    $n = 0',
  '    foreach ($ip in $cand) {',
  '      if ($n -ge 32) { break }',
  '      $n++',
  '      $t2 = New-Object System.Net.Sockets.TcpClient',
  '      try { [void]$t2.BeginConnect($ip, $Port, $null, $null) } catch {}',
  '      [void]$c2.Add(@{ ip = $ip; c = $t2; done = $false })',
  '      Start-Sleep -Milliseconds 20',
  '    }',
  '    $sw2 = [System.Diagnostics.Stopwatch]::StartNew()',
  '    while ($true) {',
  '      $pend2 = 0',
  '      foreach ($e2 in $c2) {',
  '        if ($e2.done) { continue }',
  '        try {',
  '          $s2 = $e2.c.Client',
  '          if ($s2.Poll(0, [System.Net.Sockets.SelectMode]::SelectWrite)) {',
  '            $e2.done = $true',
  '            if (-not $s2.Poll(0, [System.Net.Sockets.SelectMode]::SelectError)) { [void]$open.Add($e2.ip) }',
  '          } elseif ($s2.Poll(0, [System.Net.Sockets.SelectMode]::SelectError)) {',
  '            $e2.done = $true',
  '          } else { $pend2++ }',
  '        } catch { $e2.done = $true }',
  '      }',
  '      if ($pend2 -eq 0) { break }',
  '      if ($sw2.ElapsedMilliseconds -ge 2000) { break }',
  '      Start-Sleep -Milliseconds 40',
  '    }',
  '    foreach ($e2 in $c2) { try { $e2.c.Close() } catch {} }',
  '  }',
  '} catch {}',
  '$open | ConvertTo-Json -Compress',
  'if (@($open).Count -eq 0) { "[]" }'
].join('\r\n');

var sweepScriptPath = null;
function ensureSweepScript() {
  if (!sweepScriptPath) {
    sweepScriptPath = path.join(os.tmpdir(), 'zpl-rest-scan9100.ps1');
    try { fs.writeFileSync(sweepScriptPath, SWEEP_PS, 'utf8'); } catch (e) {
      sweepScriptPath = null;
      throw e;
    }
  }
  return sweepScriptPath;
}

// returns a Promise of {ok, list, error, ms}: ok=false means PowerShell
// itself failed (blocked by policy, missing, killed) — the caller then falls
// back to the node sweep instead of pretending the network is empty
function psSweep(base) {
  return new Promise(function (resolve) {
    var t0 = Date.now();
    var script;
    try { script = ensureSweepScript(); } catch (e) { return resolve({ ok: false, list: [], error: 'script write failed: ' + e.message, ms: 0 }); }
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', script, '-Base', base],
      // paced sweep by default: enterprise endpoint agents (e.g. 云枢/YunShu)
      // heuristically kill unsigned binaries whose process tree does burst
      // port scans — 12 connects / 25 ms keeps the scan below that radar
      { windowsHide: true, timeout: 45000,
        env: Object.assign({}, process.env,
          { ZPL_SWEEP_PSMODE: process.env.ZPL_SWEEP_PSMODE || 'paced' }) },
      function (err, stdout, stderr) {
        var ms = Date.now() - t0;
        // PowerShell prints nothing when the pipeline yields no objects
        // (older script versions on disk): that is a valid "nothing open",
        // not a failure — only a spawn error means PowerShell never ran
        if (err && !stdout) {
          return resolve({ ok: false, list: [], error: (err.message || 'exec failed') + (stderr ? ' / ' + String(stderr).slice(0, 200) : ''), ms: ms });
        }
        if (!String(stdout || '').trim()) {
          return resolve({ ok: true, list: [], error: null, ms: ms, empty: true });
        }
        try {
          var parsed = JSON.parse(String(stdout).trim());
          // PS 5.1 collapses single-element arrays to a bare string
          var list = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
          resolve({ ok: true, list: list, error: null, ms: ms });
        } catch (e) {
          resolve({ ok: false, list: [], error: 'unparsable output: ' + String(stdout).slice(0, 120), ms: ms });
        }
      });
  });
}

// node fallback sweep (mac/linux, or when PowerShell is unavailable)
function nodeSweep(base) {
  var hosts = expandSubnet(base + '.0');
  if (!hosts) return Promise.resolve([]);
  return mapLimit(hosts, 32, function (ip) {
    return probePort(ip, SCAN_PORT, SCAN_TIMEOUT).then(function (open) {
      return open ? ip : null;
    });
  }).then(function (r) { return r.filter(function (x) { return x !== null; }); });
}

// parse `arp -a` output and keep the entries inside one /24.
// Accepted shapes (all three OSes, verified against real output):
//   Windows : "  192.168.8.45          00-07-4f-dd-ee-ff     dynamic"
//   macOS   : "? (192.168.8.45) at 0:7:4f:dd:ee:ff on en0 ..."
//   Linux   : "192.168.8.45      ether   00:07:4f:dd:ee:ff   C   eth0"
// Entries with an all-zero or broadcast MAC are placeholder rows, and
// "(incomplete)" rows never got a real answer — neither proves a live device.
function parseArpTable(txt, base) {
  var out = [];
  var seen = {};
  var mac = '(?:(?:[0-9a-fA-F]{1,2}[-:]){5}[0-9a-fA-F]{1,2}|[0-9a-fA-F]{12})';
  var re = new RegExp('(\\d{1,3}(?:\\.\\d{1,3}){3})\\)?\\s+(?:at\\s+|ether\\s+)?(' + mac + ')', 'g');
  var m;
  var text = String(txt || '');
  while ((m = re.exec(text))) {
    var ip = m[1];
    if (base && ip.indexOf(base + '.') !== 0) continue;
    var hex = m[2].replace(/[:-]/g, '').toLowerCase();
    if (/^0+$/.test(hex) || /^f+$/.test(hex)) continue;
    if (seen[ip]) continue;
    seen[ip] = true;
    out.push(ip);
  }
  return out;
}

// Hosts the machine has actually exchanged frames with inside this /24, read
// from the OS ARP table. The sweep itself creates these entries, so a printer
// whose SYN was lost on the way still shows up here — that is the whole point:
// it proves the device is alive on this link even though port 9100 never
// answered.
function arpNeighbors(base) {
  return new Promise(function (resolve) {
    if (process.platform !== 'win32' && process.platform !== 'darwin' && process.platform !== 'linux') {
      return resolve([]);
    }
    var args = process.platform === 'win32' ? ['-a'] : ['-an'];
    execFile('arp', args, { windowsHide: true, timeout: 6000 }, function (err, stdout) {
      if (!String(stdout || '')) return resolve([]);
      resolve(parseArpTable(stdout, base));
    });
  });
}

// one clean connect per ARP-known host that the sweep did not report open.
// Single connections to live hosts — the same shape the per-device
// interrogation already uses — so this cannot trigger the frozen-exe crash
// that a 254-host burst does. `provider` exists for tests: it replaces the
// ARP lookup so the merge path can be exercised without a real neighbour.
function recheckNeighbors(base, openHosts, provider) {
  return (provider ? provider(base) : arpNeighbors(base)).then(function (neighbors) {
    var known = {};
    (openHosts || []).forEach(function (ip) { known[ip] = true; });
    var todo = neighbors.filter(function (ip) { return !known[ip]; }).slice(0, SWEEP_RECHECK_LIMIT);
    if (!todo.length) return [];
    return mapLimit(todo, 12, function (ip) {
      return probePort(ip, SCAN_PORT, SWEEP_RECHECK_TIMEOUT).then(function (open) {
        return open ? ip : null;
      });
    }).then(function (r) {
      var extra = r.filter(function (x) { return x !== null; });
      try {
        require('./crashlog.js').log('discover', 'neighbour recheck: ' + todo.length
          + ' candidate(s), ' + extra.length + ' extra open (' + extra.join(',') + ')');
      } catch (e) {}
      return extra;
    });
  }).catch(function () { return []; });
}

// diagnostics of the last sweep, surfaced by GET /rest/discover/diag so a
// "nothing found" report from another PC can be told apart from "the scan
// never really ran" (PowerShell blocked, wrong NIC, firewall)
var lastSweep = null;

// per-scan counters handed back to the UI: "9100 was open on N hosts, M of
// them confirmed as Zebra" tells the user whether a missing printer was never
// reached (network) or was reached and then not identified (vendor filter).
// Without that split, "one printer is missing" is indistinguishable from
// "that printer is not a Zebra".
var scanStats = { open: 0, zebra: 0, subnets: {} };
function resetScanStats() {
  scanStats = { open: 0, zebra: 0, subnets: {} };
  return scanStats;
}
function getScanStats() {
  return scanStats;
}

function sweepPort9100(base) {
  var t0 = Date.now();
  var primary;
  if (process.platform === 'win32') {
    primary = psSweep(base).then(function (ps) {
      if (!ps.ok) {
        return nodeSweep(base).then(function (r) {
          try { require('./crashlog.js').log('discover', 'powershell sweep failed (' + ps.error + ') -> node fallback, ' + r.length + ' hosts'); } catch (e) {}
          return { mode: 'node (powershell failed)', hosts: r, ps_ms: ps.ms, ps_error: ps.error };
        });
      }
      if (ps.list.length === 0) {
        // PowerShell answered "[]": before telling the user the network is
        // empty, corroborate with the node sweep — a security agent can let
        // PowerShell start yet silently block its connections
        return nodeSweep(base).then(function (r) {
          return { mode: r.length ? 'node (after empty powershell)' : 'powershell', hosts: r, ps_ms: ps.ms, ps_count: ps.list.length };
        });
      }
      return { mode: 'powershell', hosts: ps.list, ps_ms: ps.ms, ps_count: ps.list.length };
    });
  } else {
    primary = nodeSweep(base).then(function (r) {
      return { mode: 'node', hosts: r, ps_ms: null };
    });
  }
  return primary.then(function (res) {
    // the PowerShell sweep re-checks ARP neighbours inside its own process
    // (see SWEEP_PS) — node must not open a second burst of sockets, because
    // that is what destabilises the frozen exe. Only the node fallback path
    // runs the node-side re-check, where a few extra probes are negligible.
    var recheck = /^node/.test(res.mode)
      ? recheckNeighbors(base, res.hosts)
      : Promise.resolve([]);
    return recheck.then(function (extra) {
      var hosts = res.hosts.concat(extra);
      lastSweep = {
        base: base,
        at: new Date().toISOString(),
        mode: res.mode,
        ps_ms: res.ps_ms,
        ps_error: res.ps_error || null,
        ps_count: res.ps_count === undefined ? null : res.ps_count,
        count: hosts.length,
        recheck_extra: extra.length,
        ms: Date.now() - t0
      };
      return hosts;
    });
  });
}

// scan several /24 bases in turn and merge the results (dedupe by ip/name):
// used for 'auto', where the machine may have Ethernet + Wi-Fi + VPN and the
// printers can sit on any of them
function discoverPrintersAll(subsets) {
  var bases = [];
  (subsets || []).forEach(function (s) {
    var b = subnetBase(s && s.base ? s.base : s);
    if (b && bases.indexOf(b) === -1) bases.push(b);
  });
  if (!bases.length) return Promise.reject(new Error('no subnet to scan'));
  var acc = [];
  var seen = {};
  var i = 0;
  function step() {
    if (i >= bases.length) return Promise.resolve(acc);
    var b = bases[i++];
    return discoverPrinters(b).then(function (list) {
      (list || []).forEach(function (p) {
        var key = p.ip || p.name;
        if (key && seen[key]) return;
        if (key) seen[key] = true;
        acc.push(p);
      });
      return step();
    }, function () { return step(); }); // one dead subnet must not kill the rest
  }
  return step();
}

// what the service sees of its own network, for the diag endpoint
function getDiag() {
  var psPath = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';
  return {
    platform: process.platform,
    node: process.version,
    frozen: !!process.pkg,
    powershell: {
      path: psPath,
      exists: process.platform === 'win32' ? fs.existsSync(psPath) : false
    },
    sweep_script: sweepScriptPath,
    interfaces: ifaceList(),
    network: networkInfo(),
    chosen: localSubnet(),
    last_sweep: lastSweep
  };
}

// async part of the diagnostics: gateway lookup + optional reachability probe
// Never rejects: both probes below resolve on every failure path, and the catch
// keeps the endpoint answering even if a future probe starts rejecting.
function getDiagAsync(probeAddress) {
  return defaultGateway().then(function(gw) {
    var diag = getDiag();
    diag.gateway = gw;
    // ARP table of the subnet that gets scanned: every entry is a host that
    // answered at layer 2. A printer that answers here but is absent from the
    // scan result means the sweep lost its SYN, not that the device is gone.
    var base = subnetBase(diag.chosen || '');
    return (base ? arpNeighbors(base) : Promise.resolve([])).then(function(neighbors) {
      diag.arp_neighbors = neighbors;
      if (!probeAddress || !probeAddress.host) return diag;
      return Promise.all([
        pingHost(probeAddress.host, 1500),
        probeDetailed(probeAddress.host, probeAddress.port || 9100, 2000)
      ]).then(function(r) {
        diag.target = { host: probeAddress.host, port: probeAddress.port || 9100, ping: r[0], tcp: r[1] };
        return diag;
      });
    });
  }).catch(function(err) {
    // degrade to the static view instead of failing the diagnostics call
    var diag = getDiag();
    diag.gateway = null;
    diag.error = String(err && err.message || err);
    return diag;
  });
}

// parse subnet input to the x.x.x base ('192.168.8', '192.168.8.0/24' -> '192.168.8')
function subnetBase(subnet) {
  var m = String(subnet).trim().match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})(?:\.\d{1,3})?(?:\/24)?$/);
  return m ? m[1] : null;
}

function discoverPrinters(subnet) {
  var base = subnetBase(subnet);
  if (!base) {
    return Promise.reject(new Error('subnet format must be x.x.x or x.x.x.0/24'));
  }
  // stage logs: if the frozen exe dies during a scan, the last line in
  // logs/crash.log pinpoints the fatal step
  try { require('./crashlog.js').log('discover', 'sweep start, base ' + base); } catch (e) {}

  return sweepPort9100(base).then(function (openHosts) {
    try { require('./crashlog.js').log('discover', 'sweep done, ' + openHosts.length + ' hosts with 9100 open'); } catch (e) {}
    scanStats.open += openHosts.length;
    scanStats.subnets[base] = openHosts.length;
    return mapLimit(openHosts, CONCURRENCY, function (ip) {
      // identify vendor over HTTP first; anything not confirmed Zebra
      // receives NO data on 9100 (HP etc. would print it)
      return identifyVendor(ip).then(function (id) {
        if (id.isZebra !== true) return null;
        // even for HTTP-confirmed Zebra devices, verify the SGD answer is
        // a real Zebra model BEFORE sending a second command
        return sgdQuery(ip, SCAN_PORT, 'device.product_name', SGD_TIMEOUT).then(function (model) {
          if (!model || !profiles.isZebraModel(model)) return null;
          var profile = profiles.getProfile(model);
          return resolveDpi(ip, id.page).then(function (res) {
            var density = res.dpmm
              ? Math.round(res.dpmm) + 'dpmm'
              : profiles.dpmmFromDpi(res.dpi);
            return resolveSerial(ip).then(function (serial) {
              return {
                ip: ip,
                port: SCAN_PORT,
                model: model,
                is_zebra: true,
                serial: serial || null,
                dpi: res.dpi || null,
                density: density,
                media: profile.media,
                zpl_header: profile.zpl_header,
                profile_name: profile.name,
                settings: profiles.getSettings(model, res.dpi)
              };
            });
          });
        });
      });
    });
  }).then(function (results) {
    var hits = results.filter(function (r) { return r !== null; });
    scanStats.zebra += hits.length;
    try { require('./crashlog.js').log('discover', 'scan finished, zebra hits: ' + hits.length); } catch (e) {}
    return hits;
  });
}

module.exports = {
  discoverPrinters: discoverPrinters,
  discoverPrintersAll: discoverPrintersAll,
  probeDetailed: probeDetailed,
  pingHost: pingHost,
  localSubnet: localSubnet,
  localSubnets: localSubnets,
  getDiag: getDiag,
  getDiagAsync: getDiagAsync,
  resetScanStats: resetScanStats,
  getScanStats: getScanStats,
  expandSubnet: expandSubnet,
  probePort: probePort,
  sgdQuery: sgdQuery,
  sgdQueryRaw: sgdQueryRaw,
  arpNeighbors: arpNeighbors,
  parseArpTable: parseArpTable,
  recheckNeighbors: recheckNeighbors
};
