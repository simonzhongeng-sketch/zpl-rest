// USB / locally installed Windows printers (stage: USB printing).
//
// ZPL is delivered through the Windows print spooler as a RAW job
// (winspool WritePrinter), so any Zebra with a Windows driver installed —
// typically connected via USB — can print without a TCP socket.
// The printer's "address" field holds the Windows printer name for conn=usb.
//
// Implementation: a small PowerShell helper (RawPrinterHelper, P/Invoke of
// winspool.drv) is written to the temp dir once; every send spawns
// powershell.exe with the ZPL in a temp file (avoids command line limits).

'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var execFile = require('child_process').execFile;

var PS = ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];

// ASCII-only helper script (no localized characters -> no encoding issues)
var RAW_PRINT_PS = [
  'param([string]$PrinterName, [string]$FilePath, [int]$DeleteFile = 0)',
  "$src = @'",
  'using System;',
  'using System.Runtime.InteropServices;',
  'public class RawPrinterHelper {',
  '  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]',
  '  public struct DOCINFOA {',
  '    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;',
  '    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;',
  '    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;',
  '  }',
  '  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]',
  '  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);',
  '  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true)]',
  '  public static extern bool ClosePrinter(IntPtr hPrinter);',
  '  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]',
  // NOTE: the struct must be passed by ref. Marshalling it with
  // UnmanagedType.LPStruct throws "Invalid managed/unmanaged type combination"
  // at call time (LPStruct only accepts classes), which used to surface as a
  // bogus "Win32 error 0" without ever reaching the spooler.
  '  public static extern int StartDocPrinter(IntPtr hPrinter, int level, [In] ref DOCINFOA di);',
  '  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true)]',
  '  public static extern bool EndDocPrinter(IntPtr hPrinter);',
  '  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true)]',
  '  public static extern bool StartPagePrinter(IntPtr hPrinter);',
  '  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true)]',
  '  public static extern bool EndPagePrinter(IntPtr hPrinter);',
  '  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true)]',
  '  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);',
  '  public static string SendBytesToPrinter(string szPrinterName, IntPtr pBytes, int dwCount) {',
  '    int dwWritten = 0; IntPtr hPrinter = IntPtr.Zero;',
  '    DOCINFOA di = new DOCINFOA();',
  '    di.pDocName = "zpl-rest raw job";',
  '    di.pDataType = "RAW";',
  '    if (!OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) {',
  '      return "FAIL OpenPrinter " + Marshal.GetLastWin32Error();',
  '    }',
  '    try {',
  '      int job = StartDocPrinter(hPrinter, 1, ref di);',
  '      if (job == 0) { return "FAIL StartDocPrinter " + Marshal.GetLastWin32Error(); }',
  '      try {',
  '        if (!StartPagePrinter(hPrinter)) { return "FAIL StartPagePrinter " + Marshal.GetLastWin32Error(); }',
  '        bool ok = WritePrinter(hPrinter, pBytes, dwCount, out dwWritten);',
  '        int writeErr = Marshal.GetLastWin32Error();',
  '        EndPagePrinter(hPrinter);',
  '        if (!ok) { return "FAIL WritePrinter " + writeErr; }',
  '      } finally { EndDocPrinter(hPrinter); }',
  '    } finally { ClosePrinter(hPrinter); }',
  '    return "OK " + dwWritten;',
  '  }',
  '  public static string SendFileToPrinter(string szPrinterName, string szFileName) {',
  '    byte[] b = System.IO.File.ReadAllBytes(szFileName);',
  '    IntPtr pBytes = Marshal.AllocCoTaskMem(b.Length);',
  '    Marshal.Copy(b, 0, pBytes, b.Length);',
  '    string r = SendBytesToPrinter(szPrinterName, pBytes, b.Length);',
  '    Marshal.FreeCoTaskMem(pBytes);',
  '    return r;',
  '  }',
  '}',
  "'@",
  "if (-not ('RawPrinterHelper' -as [type])) { Add-Type -TypeDefinition $src }",
  '$n = [RawPrinterHelper]::SendFileToPrinter($PrinterName, $FilePath)',
  'Write-Output $n',
  "if ($n -like 'OK *') {",
  '  if ($DeleteFile -eq 1) { Remove-Item -LiteralPath $FilePath -Force -ErrorAction SilentlyContinue }',
  '} else {',
  '  exit 1',
  '}'
].join('\r\n');

var scriptPath = path.join(os.tmpdir(), 'zpl-rest-rawprint.ps1');
var scriptReady = false;

function ensureScript() {
  if (scriptReady) return;
  fs.writeFileSync(scriptPath, RAW_PRINT_PS, 'utf8');
  scriptReady = true;
}

// translate the helper's "FAIL <step> <code>" marker into a message the user
// can act on; the step name is the winspool call that refused the job
var FAIL_HINTS = {
  OpenPrinter: 'the printer name was not found (or access was denied)',
  StartDocPrinter: 'the driver or spooler refused the job (printer offline, paused, or driver problem)',
  StartPagePrinter: 'the spooler refused to start a page',
  WritePrinter: 'the spooler could not accept the data (port or driver problem)'
};

function describeFailure(step, code) {
  return 'spooler rejected the job at ' + step + ' (Win32 error ' + code + '): ' +
    (FAIL_HINTS[step] || 'check the printer name and driver');
}

// first meaningful line of a PowerShell error blob
function firstErrorLine(text) {
  var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); })
    .filter(function (l) { return l && l.indexOf('At ') !== 0 && l.indexOf('+') !== 0; });
  return lines.length ? lines[0] : '';
}

// send raw ZPL to a Windows printer by name; resolves {failed, error, bytes}
function sendZpl(printerName, zpl) {
  return new Promise(function (resolve) {
    if (!printerName) return resolve({failed: true, error: 'no Windows printer name given'});
    try {
      ensureScript();
    } catch (e) {
      return resolve({failed: true, error: 'cannot write print helper: ' + e.message});
    }
    var tmp = path.join(os.tmpdir(), 'zpl-rest-' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '.zpl');
    try {
      fs.writeFileSync(tmp, zpl, 'utf8'); // matches socket.write() utf8 encoding
    } catch (e) {
      return resolve({failed: true, error: 'cannot write temp ZPL file: ' + e.message});
    }
    execFile('powershell.exe', PS.slice(1).concat([
      '-File', scriptPath,
      '-PrinterName', printerName,
      '-FilePath', tmp
    ]), {timeout: 20000, windowsHide: true}, function (err, stdout, stderr) {
      fs.unlink(tmp, function () {}); // always clean up, success or failure
      var out = String(stdout || '').trim();

      // success marker wins even if PowerShell returns an odd exit code
      var ok = /^OK (\d+)$/m.exec(out);
      if (ok) return resolve({failed: false, bytes: Number(ok[1])});

      var fail = /^FAIL (\w+) (\d+)$/m.exec(out);
      if (fail) return resolve({failed: true, error: describeFailure(fail[1], fail[2])});

      // the helper itself broke (Add-Type blocked, marshalling error, policy)
      var detail = firstErrorLine(stderr) || out || String((err && err.message) || err || '');
      resolve({failed: true, error: 'print helper failed: ' + (detail || 'unknown error')});
    });
  });
}

// A Windows printer is effectively online when the spooler does NOT flag it
// "Work Offline" and its PrinterStatus is not one of the known "bad" states.
// Missing WorkOffline info is treated as false (most drivers never report it).
var BAD_PRINTER_STATUSES = ['offline', 'notavailable', 'serveroffline'];

function isPrinterOnline(printerStatus, workOffline) {
  var ps = String(printerStatus || '').toLowerCase();
  var wo = (workOffline === true); // anything but a real true counts as false
  return !wo && BAD_PRINTER_STATUSES.indexOf(ps) === -1;
}

// Cached listPrinters() result (also caches error results) to avoid spawning
// a fresh PowerShell process on every /rest/printer/status refresh (1-2s).
var listCache = null;
var listCacheAt = 0;
var LIST_CACHE_MS = 5000;

// list the Windows-installed printers (USB and otherwise); resolves
// {printers: [{name, driver, port, status: 'online'|'offline',
//              printerStatus, workOffline}]} or {error}
function listPrinters() {
  return new Promise(function (resolve) {
    if (listCache && (Date.now() - listCacheAt) < LIST_CACHE_MS) {
      return resolve(listCache);
    }
    // One PowerShell pass: Get-Printer for the driver/port/status and
    // Get-CimInstance Win32_Printer for WorkOffline, merged by printer name.
    // Plain statements only (no inline if) -> Windows PowerShell 5.1 safe.
    var cmd = [
      '$gp = Get-Printer | Select-Object Name,DriverName,PortName,PrinterStatus;',
      '$cim = @{};',
      'Get-CimInstance Win32_Printer | ForEach-Object { $cim[$_.Name] = [bool]$_.WorkOffline };',
      '$out = @();',
      'foreach ($p in $gp) {',
      '  $wo = $false;',
      '  if ($cim.ContainsKey($p.Name)) { $wo = $cim[$p.Name] }',
      '  $out += [pscustomobject]@{ Name = $p.Name; DriverName = $p.DriverName; PortName = $p.PortName; PrinterStatus = $p.PrinterStatus; WorkOffline = $wo }',
      '};',
      '$out | ConvertTo-Json -Compress'
    ].join(' ');
    execFile('powershell.exe', PS.slice(1).concat(['-Command', cmd]),
      {timeout: 15000, windowsHide: true, maxBuffer: 4 * 1024 * 1024}, function (err, stdout) {
        var result;
        if (err) {
          result = {error: String((err && err.message) || err)};
        } else {
          try {
            var parsed = JSON.parse(String(stdout || '[]'));
            if (!Array.isArray(parsed)) parsed = [parsed];
            result = {printers: parsed.filter(function (p) { return p && p.Name; }).map(function (p) {
              return {
                name: String(p.Name),
                driver: String(p.DriverName || ''),
                port: String(p.PortName || ''),
                status: isPrinterOnline(p.PrinterStatus, p.WorkOffline) ? 'online' : 'offline',
                printerStatus: String(p.PrinterStatus || ''),
                workOffline: p.WorkOffline === true
              };
            })};
          } catch (e) {
            result = {error: 'cannot parse printer list: ' + e.message};
          }
        }
        listCache = result; // error results are cached too (fail fast for 5s)
        listCacheAt = Date.now();
        resolve(result);
      });
  });
}

module.exports = {
  sendZpl: sendZpl,
  listPrinters: listPrinters
};
