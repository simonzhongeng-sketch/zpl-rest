'use strict';

// System tray integration (Windows first class, also works on mac/linux via
// systray2's bundled tray binaries). Gives the packaged exe a life outside the
// console window: right-click menu with "open homepage", "copy MCP address"
// and "close service", plus helpers to auto-open the browser and minimize the
// console window on startup.

const child = require('child_process');
const fs = require('fs');
const path = require('path');

const SysTray = require('systray2').default;

// 32x32 printer icon (html/img/tray.ico, generated) as base64 so it works
// inside the pkg snapshot without file lookups
const ICON_BASE64 = fs.readFileSync(path.join(__dirname, '..', 'html', 'img', 'tray.ico')).toString('base64');

// ---------------------------------------------------------------------------

function shellOut(cmd) {
  child.exec(cmd, { windowsHide: true }, function () { /* fire and forget */ });
}

// open url in the default browser (win: start, mac: open, linux: xdg-open)
function openBrowser(url) {
  if (process.platform === 'win32') {
    shellOut('start "" "' + url + '"');
  } else if (process.platform === 'darwin') {
    shellOut('open "' + url + '"');
  } else {
    shellOut('xdg-open "' + url + '"');
  }
}

// minimize the console window of this process (works for the pkg exe console
// and for a normal cmd/powershell window running `node main.js`)
function minimizeConsole() {
  if (process.platform !== 'win32') return;
  const ps =
    'powershell -NoProfile -WindowStyle Hidden -Command ' +
    '"Add-Type -Name U32 -Namespace W -MemberDefinition \'[DllImport(\\"user32.dll\\")] public static extern bool ShowWindow(IntPtr h,int c);\'; ' +
    '[W.U32]::ShowWindow((Get-Process -Id ' + process.pid + ').MainWindowHandle, 6)"';
  shellOut(ps);
}

function copyToClipboard(text) {
  if (process.platform === 'win32') {
    shellOut('powershell -NoProfile -WindowStyle Hidden -Command "Set-Clipboard -Value \'' + text + '\'"');
  } else if (process.platform === 'darwin') {
    shellOut('printf \'%s\' \'' + text + '\' | pbcopy');
  } else {
    shellOut('printf \'%s\' \'' + text + '\' | xclip -selection clipboard');
  }
}

// ---------------------------------------------------------------------------

// Right-click menu texts per UI language. The language follows the one chosen
// in the web UI (persisted as config.ui_lang via POST /rest/lang) and can be
// switched at runtime through setTrayLang().
var TRAY_I18N = {
  en: {
    open: 'Open Homepage',
    copy: 'Copy MCP Address',
    close: 'Close Service',
    noMcp: 'MCP not enabled',
    stop: 'Stop restZPL'
  },
  zh: {
    open: '打开主页',
    copy: '复制 MCP 地址',
    close: '关闭服务',
    noMcp: 'MCP 未启用',
    stop: '停止 restZPL'
  },
  ar: {
    open: 'فتح الصفحة الرئيسية',
    copy: 'نسخ عنوان MCP',
    close: 'إيقاف الخدمة',
    noMcp: 'MCP غير مُمكَّن',
    stop: 'إيقاف restZPL'
  }
};

// flat menu layout: index (= seq_id the tray binary assigns to each item in
// order) -> role. The separator (index 2) is hidden and never updated.
var ITEM_SEQ = { open: 0, copy: 1, close: 3 };

var trayInstance = null;
var trayLang = 'en';

function trayText(lang) {
  return TRAY_I18N[lang] || TRAY_I18N.en;
}

// Create the tray icon. `opts`:
//   uiBase   - base url of the web UI (e.g. http://localhost:18420)
//   mcpUrl   - full MCP endpoint (e.g. http://localhost:18422/mcp), optional
//   lang     - UI language for the menu texts ('en' | 'zh' | 'ar')
//   onQuit   - called when the user picks "close service"
// Returns the systray2 instance or null if the platform is not supported /
// the icon could not be created (never let the tray break the server).
function startTray(opts) {
  try {
    if (process.platform !== 'win32' && process.platform !== 'darwin' && process.platform !== 'linux') {
      return null;
    }
    trayLang = TRAY_I18N[opts.lang] ? opts.lang : 'en';
    var txt = trayText(trayLang);
    var items = [
      { title: txt.open, tooltip: opts.uiBase, enabled: true },
      { title: txt.copy, tooltip: opts.mcpUrl || txt.noMcp, enabled: !!opts.mcpUrl },
      SysTray.separator,
      { title: txt.close, tooltip: txt.stop, enabled: true }
    ];
    const tray = new SysTray({
      menu: {
        icon: ICON_BASE64,
        // fixed brand text: the tray label must stay recognisable no matter
        // which UI language the operator picked in the browser
        title: 'restZPL 标签打印',
        tooltip: 'restZPL 标签打印 - ' + opts.uiBase.replace(/^https?:\/\//, ''),
        items: items
      },
      // copy the bundled tray binary out of the (possibly frozen) package to a
      // writable place before spawning; also avoids concurrent-run file locks
      copyDir: path.join(require('os').tmpdir(), 'zpl-rest-tray'),
      debug: false
    });
    tray.onClick(function (action) {
      // match by seq_id (index of the clicked item) so the handler keeps
      // working after setTrayLang() replaced the menu texts
      if (action.seq_id === ITEM_SEQ.open || (action.seq_id == null && (action.item ? action.item.title : '').indexOf('Open Homepage') !== -1)) {
        openBrowser(opts.uiBase);
      } else if (action.seq_id === ITEM_SEQ.copy || (action.seq_id == null && (action.item ? action.item.title : '').indexOf('Copy MCP') !== -1)) {
        if (opts.mcpUrl) copyToClipboard(opts.mcpUrl);
      } else if (action.seq_id === ITEM_SEQ.close || (action.seq_id == null && (action.item ? action.item.title : '').indexOf('Close Service') !== -1)) {
        try { tray.kill(); } catch (e) {}
        if (opts.onQuit) opts.onQuit();
      }
    });
    // make sure the tray binary never outlives the server (e.g. Ctrl+C)
    process.on('exit', function () {
      try { tray.process.kill(); } catch (e) {}
    });
    // and a failing tray binary must never take the server down with it
    try {
      tray.process.on('error', function (err) {
        try {
          require('./crashlog.js').log('tray process error', err);
        } catch (e) { console.error('tray process error: ' + (err && err.message)); }
      });
    } catch (e) { /* older systray2 without .process accessor */ }
    trayInstance = tray;
    return tray;
  } catch (e) {
    console.error((new Date()) + ' tray init failed (server keeps running): ' + e.message);
    return null;
  }
}

// Switch the right-click menu to another UI language while running. No-op if
// the tray is unavailable or the language is unknown.
function setTrayLang(lang) {
  if (!trayInstance || !TRAY_I18N[lang] || lang === trayLang) return;
  trayLang = lang;
  var txt = trayText(lang);
  var items = trayInstance._conf.menu.items;
  var updates = [
    { seq_id: ITEM_SEQ.open, item: { title: txt.open, tooltip: items[ITEM_SEQ.open].tooltip } },
    { seq_id: ITEM_SEQ.copy, item: { title: txt.copy, tooltip: items[ITEM_SEQ.copy].tooltip } },
    { seq_id: ITEM_SEQ.close, item: { title: txt.close, tooltip: txt.stop } }
  ];
  updates.forEach(function (u) {
    trayInstance.sendAction({ type: 'update-item', seq_id: u.seq_id, item: u.item });
  });
}

module.exports = {
  openBrowser: openBrowser,
  minimizeConsole: minimizeConsole,
  startTray: startTray,
  setTrayLang: setTrayLang
};
