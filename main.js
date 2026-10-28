var fs = require('fs');
var path = require('path');

// crash safety nets FIRST: from here on a stray async error is logged to
// logs/crash.log next to the exe instead of killing the process (which looks
// like an instant "flash crash" of the packaged exe)
const crashLog = require('./lib/crashlog.js');
crashLog.install();

// config stuff
const ConfigHandler = require('./lib/config.js');
const config = ConfigHandler.getConfig();

// window / taskbar title of the console app: a fixed brand string, never
// translated (the operator has to recognise the window regardless of the UI
// language chosen in the browser); guarded — title APIs misbehave in some
// frozen/pkg environments and must never block startup
try { process.title = 'restZPL 标签打印'; } catch (e) { /* cosmetic only */ }
crashLog.log('service started',
  'pid=' + process.pid + ' frozen=' + !!process.pkg);
// optional heartbeat for diagnosing silent terminations: ZPL_HEARTBEAT=1
if (process.env.ZPL_HEARTBEAT) {
  var beat = 0;
  setInterval(function () { crashLog.log('heartbeat', 'tick ' + (++beat)); }, 500);
}

// mustache
var Mustache = require('mustache');

// express
var express = require('express')
var favicon = require('serve-favicon')
var session = require('express-session')
var cors = require('cors')

// express stuff
var rest = express()

//cors
rest.use(cors())

// application root: project dir on a normal run, exe dir when packaged (pkg),
// ZPL_DATA_DIR when set (development / automated tests keep their data out of
// the project tree — see lib/approot.js)
var APP_ROOT = require('./lib/approot.js');
// tray icon / open browser / minimize console (lib/tray.js)
// diagnostic switches (env): skip heavy subsystems to bisect the frozen-exe
// crash during subnet scans; all default to "on"
var SKIP_TRAY_MOD = !!process.env.ZPL_SKIP_TRAY_MOD;   // don't even require tray/systray2
var SKIP_MCP = !!process.env.ZPL_SKIP_MCP;             // don't start the MCP server
var SKIP_WS = !!process.env.ZPL_SKIP_WS;               // don't create the WebSocket server

var trayLib = SKIP_TRAY_MOD ? { openBrowser: function(){}, minimizeConsole: function(){}, startTray: function(){ return null; }, setTrayLang: function(){} } : require('./lib/tray.js');

// ejs
rest.set('view engine', 'ejs');
// explicit views dir: do not depend on the process cwd (packaged exe may be
// started from anywhere; under pkg the views live in the embedded snapshot)
rest.set('views', path.join(__dirname, 'views'));
// never let browsers cache the rendered HTML pages (i18n / layout updates must
// show up without a hard refresh); static assets still use their own defaults
rest.use(function(req, res, next) {
  if (req.method === 'GET' && !path.extname(req.path)) {
    res.set('Cache-Control', 'no-cache');
  }
  next();
});
rest.use(express.static(__dirname + '/html'));
rest.use(favicon(path.join(__dirname, 'html', 'favicon.ico')))

//may edit session secret
// Session config
rest.use(session({
  secret: config.secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 36000000
  }
}))

// JSON
rest.use(express.json());

// datastorage stuff (db lives next to the exe when packaged, or inside
// ZPL_DATA_DIR when that env var is set — see lib/approot.js)
if (!fs.existsSync(APP_ROOT + '/db')) {
  fs.mkdirSync(APP_ROOT + '/db', { recursive: true });
}

// data storage
var db = require('diskdb');
db.connect(APP_ROOT + '/db', ['label', 'printer', 'jobs', 'queue', 'meta', 'draft']);

// persistent counters (queue batch numbers, global queue sequence numbers)
function nextCounter(key) {
  var doc = db.meta.findOne({key: key});
  if (!doc) {
    db.meta.save({key: key, value: 1});
    return 1;
  }
  doc.value = parseInt(doc.value, 10) + 1;
  db.meta.update({key: key}, doc);
  return doc.value;
}

// requester ip of an enqueue call, normalised ("::ffff:1.2.3.4" -> "1.2.3.4")
function requestIp(req) {
  var ip = req.ip || (req.connection && req.connection.remoteAddress) || '';
  return String(ip).replace(/^::ffff:/, '');
}

// lookup key for copy numbers within one enqueue batch (identical content)
function copyKey(item) {
  return item.label_id + '|' + item.printer_id + '|' + JSON.stringify(item.data);
}

// websocket
var WebSocketServer = require('websocket').server;
var http = require('http');

// socket for sending data to the printer
const Net = require('net');

// printer discovery and model profiles
const discover = require('./lib/discover.js');
const printerProfiles = require('./lib/printer_profiles.js');

// visual template compiler: template JSON (mm) -> ZPL at printer density
const zplCompiler = require('./lib/zpl_compiler.js');

// page geometry of a template (safe-area margins + print offset); also the
// server-side validator for POST /rest/label
const pageGeometry = require('./lib/page_geometry.js');

// Default printer base origin (mm): the media-loading compensation applied to
// EVERY printer that has no explicit settings.base_origin_mm. 1.5/0.8mm at
// 12dpmm = ^LH18,10 (the field-calibrated value of the ZT510 fleet). A
// printer can override it per machine with settings.base_origin_mm — including
// {x:0,y:0} to pin that machine to ^LH0,0.
const DEFAULT_BASE_ORIGIN_MM = { x: 1.5, y: 0.8 };

// batch print queue (stage 3)
const printQueue = require('./lib/print_queue.js');
const usbPrint = require('./lib/usb_print.js');
printQueue.init(db, {broadcast: broadcastMsg, labelToZpl: labelToZpl});

// variables used by a label: visual -> from template, raw -> scan placeholders
function labelVariables(label) {
  if (label.type === 'visual' && label.template) {
    return zplCompiler.collectVariables(label.template);
  }
  var vars = [];
  var m;
  var re1 = /\$\{([^}]+)\}/g;
  var re2 = /{{([^}]+)}}/g;
  while ((m = re1.exec(label.zpl || ''))) if (vars.indexOf(m[1]) === -1) vars.push(m[1]);
  while ((m = re2.exec(label.zpl || ''))) if (vars.indexOf(m[1]) === -1) vars.push(m[1]);
  return vars;
}

// resolve the ZPL of a label; visual templates are compiled with the
// target printer's density, raw templates use their stored ZPL as-is.
// Print settings: the printer record holds the calibrated defaults; explicit
// values on the label override them field by field ('none' / missing = fall
// back to the printer), so a label can still tune its own darkness or speed.
function labelToZpl(label, printer, opts) {
  if (label.type === 'visual' && label.template) {
    var ps = label.template.print_settings || {};
    var base = (printer && printer.settings) ? printer.settings : {};
    var merged = {
      mode: (ps.mode && ps.mode !== 'none') ? ps.mode : base.mode,
      darkness: (typeof ps.darkness === 'number') ? ps.darkness : base.darkness,
      speed: (typeof ps.speed === 'number' && ps.speed > 0) ? ps.speed : base.speed,
      quantity: ps.quantity
    };
    // the compiler needs the physical label size to emit ^PW/^LL. Shallow copy:
    // the caller's opts (repeatCols / stepMm / rowWidthMm of a multi-up row)
    // must survive, so they are merged, never replaced.
    var copts = Object.assign({}, opts);
    copts.widthMm = Number(label.width) || 0;
    copts.heightMm = Number(label.height) || 0;
    // printer-level base origin (mm): that machine's media-loading
    // compensation, applied to every label on it before the label's own
    // margins/offset. Defaults to DEFAULT_BASE_ORIGIN_MM (^LH18,10); an
    // explicit settings.base_origin_mm wins (even {x:0,y:0}).
    copts.baseOriginMm = (base && base.base_origin_mm && typeof base.base_origin_mm === 'object')
      ? base.base_origin_mm : DEFAULT_BASE_ORIGIN_MM;
    // 预览：位置微调（页边距/偏移）与打印机基础原点只影响实际打印的 ^LH，
    // 不在预览里体现——预览要把设计原样画在标签上，不能被 ^LH 推着走。
    var tplForCompile = label.template;
    if (copts.previewOrigin) {
      delete copts.previewOrigin;
      copts.baseOriginMm = { x: 0, y: 0 };
      if (tplForCompile && tplForCompile.page) {
        var zeroPage = {
          margin_mm: { top: 0, right: 0, bottom: 0, left: 0 },
          offset_mm: { x: 0, y: 0 }
        };
        // 纸带宽度仍是 ^PW 的来源，不能丢
        if (Number(tplForCompile.page.roll_width_mm) > 0) {
          zeroPage.roll_width_mm = Number(tplForCompile.page.roll_width_mm);
        }
        tplForCompile = Object.assign({}, tplForCompile, { page: zeroPage });
      }
    }
    return zplCompiler.compile(tplForCompile, parseInt(printer.density, 10) || 8, merged, copts);
  }
  return label.zpl;
}

// placeholder slots of a compiled label
var ROW_SLOT_RE = /(\$\{[^}]+\}|\{\{[^}]+\}\})/g;
function countSlots(zpl) {
  return ((zpl || '').match(ROW_SLOT_RE) || []).length;
}

// Base ZPL for ONE printed row of a multi-up label. Some labels are designed as
// a single piece (e.g. 22mm wide) although the roll carries several of them per
// row: their template only has one variable slot. In that case the whole design
// is repeated across the row so every cell receives its own value.
function rowBaseZpl(label, printer, cols) {
  var base = labelToZpl(label, printer);
  if (cols > 1 && countSlots(base) < cols) {
    var wmm = Number(label.width) || 0;
    var tiled = labelToZpl(label, printer, {
      repeatCols: cols,
      stepMm: wmm,
      rowWidthMm: wmm * cols
    });
    if (countSlots(tiled) >= cols) base = tiled;
  }
  return base;
}

// Main
rest.get('/', function(req, res) {
  var data = {};
  data.config = config;
  data.timespan = req.session.timespan ? req.session.timespan : 24;
  res.render('index', data);
});

// set timespan for index
rest.post('/rest/timespan/(:timespan)', function(req, res) {
  if (!req.params.timespan) {
    return res.status(400).send('no timespan was given');
  }
  req.session.timespan = req.params.timespan;
  res.json({})
});

// Printer
rest.get('/printer', function(req, res) {
  var data = {};
  data.config = config;
  res.render('printer', data);
});

// Manual: user guide rendered from html/js/manual_content.js
rest.get('/manual', function(req, res) {
  var data = {};
  data.config = config;
  res.render('manual', data);
});

// Label
rest.get('/label', function(req, res) {
  var data = {};
  data.config = config;
  res.render('label', data);
});

// label editor page (new label without id, existing with ?id=)
rest.get('/label/edit', function(req, res) {
  var data = {};
  data.config = config;
  res.render('label_edit', data);
});

// reprint was merged into the print queue: the old page redirects there
rest.get('/reprint', function(req, res) {
  res.redirect('/queue');
});

// rest section
rest.get('/rest/printer', function(req, res) {
  res.json(db.printer.find())
});

rest.get('/rest/label', function(req, res) {
  res.json(db.label.find())
});

// export all labels as a JSON file (browser downloads it)
rest.get('/rest/label/export', function(req, res) {
  var labels = db.label.find();
  var stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  res.set('Content-Disposition', 'attachment; filename="zpl-labels-' + stamp + '.json"');
  res.json({
    format: 'zpl-rest-labels',
    version: 1,
    exported_at: new Date().toISOString(),
    count: labels.length,
    labels: labels
  });
});

// import labels from an exported JSON file (or an array / single label object).
// always creates NEW labels (ids are regenerated); printer bindings that do
// not exist on this instance are dropped, everything else is kept as-is.
rest.post('/rest/label/import', function(req, res) {
  var body = req.body;
  var list = null;
  if (Array.isArray(body)) list = body;
  else if (body && Array.isArray(body.labels)) list = body.labels;
  else if (body && typeof body === 'object' && (body.name || body.zpl || body.template)) list = [body];
  if (!list || !list.length) {
    return res.status(400).send('no labels found in payload (expect {labels:[...]}, an array, or a single label object)');
  }

  var printerIds = {};
  db.printer.find().forEach(function(p) { printerIds[p._id] = true; });

  var created = [], skipped = 0;
  list.forEach(function(l) {
    if (!l || typeof l !== 'object' || (!l.name && !l.zpl && !l.template)) { skipped++; return; }
    var doc;
    try { doc = JSON.parse(JSON.stringify(l)); } catch (e) { skipped++; return; }
    delete doc._id;

    if (doc.type === 'visual') {
      if (typeof doc.template === 'string') {
        try { doc.template = JSON.parse(doc.template); } catch (e) { skipped++; return; }
      }
      if (!doc.template || typeof doc.template !== 'object') { skipped++; return; }
      if (doc.template.elements && !Array.isArray(doc.template.elements)) { skipped++; return; }
    } else if (!doc.zpl) {
      doc.zpl = '^XA\n\n^XZ';
    }

    // drop a binding that does not exist locally (label can still be saved)
    if (doc.printer_id && !printerIds[doc.printer_id]) doc.printer_id = '';

    created.push(db.label.save(doc));
  });

  if (created.length) {
    broadcastMsg({ source: 'label', action: 'create', data: { imported: created.length } });
  }
  res.json({ imported: created.length, skipped: skipped, labels: created });
});

rest.get('/rest/jobs', function(req, res) {
  res.json(db.jobs.find())
});

// substitute ${var} / {{var}} placeholders with the given data (used for
// data-aware previews)
function substituteVars(zpl, data) {
  var out = zpl;
  Object.keys(data || {}).forEach(function (key) {
    out = out.split('${' + key + '}').join(data[key] === undefined ? '' : String(data[key]));
  });
  if (/{{/.test(out)) {
    try { out = require('mustache').render(out, data || {}); } catch (e) { /* leave as-is */ }
  }
  return out;
}

// preview zpl code
rest.post('/rest/preview', function(req, res) {
  var response = {};
  if (!req.body.printer) {
    return res.status(400).send('no printer id was given');
  }
  if (!req.body.label) {
    return res.status(400).send('no label id was given');
  }

  var printer = db.printer.findOne({
    _id: req.body.printer
  });
  if (!printer) {
    return res.status(400).send('given printer id ('+req.body.printer+') was not valid');
  }
  var label = db.label.findOne({
    _id: req.body.label
  });
  if (!label) {
    return res.status(400).send('given label id ('+req.body.label+') was not valid');
  }

  if (!printer.density) {
    return res.status(400).send('in this printer no density is defined');
  }

  if (!label.width) {
    return res.status(400).send('in this label no width is defined');
  }

  if (!label.height) {
    return res.status(400).send('in this label no height is defined');
  }

  // 预览不带位置微调/基础原点（previewOrigin）：见 getPreview 的注释
  var zpl = req.body.zpl ? req.body.zpl : labelToZpl(label, printer, {previewOrigin: true});
  if (req.body.data) zpl = substituteVars(zpl, req.body.data);
  getPreview(res,req,printer,label, zpl);

});

rest.get('/rest/preview', function(req, res) {
  var response = {};
  if (!req.query.printer) {
    return res.status(400).send('no printer id was given');
  }
  if (!req.query.label) {
    return res.status(400).send('no label id was given');
  }

  var printer = db.printer.findOne({
    _id: req.query.printer
  });
  if (!printer) {
    return res.status(400).send('given printer id was not valid');
  }
  var label = db.label.findOne({
    _id: req.query.label
  });
  if (!label) {
    return res.status(400).send('given label id was not valid');
  }

  if (!printer.density) {
    return res.status(400).send('in this printer no density is defined');
  }

  if (!label.width) {
    return res.status(400).send('in this label no width is defined');
  }

  if (!label.height) {
    return res.status(400).send('in this label no height is defined');
  }

  getPreview(res,req,printer,label,(req.query.zpl?req.query.zpl:labelToZpl(label,printer,{previewOrigin:true})));

});

// local ZPL renderer — previews are rendered entirely offline (no external
// service involved). NOTE: label.width / label.height are stored in mm.
var zplRendererApi = null;
function getZplRenderer() {
  if (!zplRendererApi) {
    return require('zpl-renderer-js').ready.then(function(ready) {
      zplRendererApi = ready.api;
      return zplRendererApi;
    });
  }
  return Promise.resolve(zplRendererApi);
}

function getPreview(res,req,printer,label,zpl){
  var dpmm = parseInt(printer.density);
  // 预览画布 = 标签本体（width × height）：位置微调与打印机基础原点只改变
  // 实际打印时的 ^LH，不进预览。调用方用 labelToZpl(..., {previewOrigin:true})
  // 拿到的 ZPL 已经把这两层位移归零，所以设计原样落在标签上。
  var widthMm = Number(label.width) || 0;
  var heightMm = Number(label.height) || 0;

  getZplRenderer().then(function(api) {
    return api.zplToBase64Async(zpl, widthMm, heightMm, dpmm);
  }).then(function(base64) {
    res.json({"img": base64});
  }).catch(function(err) {
    console.error((new Date()) + ' local preview failed:', err);
    res.status(500).json({"error": 'local ZPL rendering failed: ' + (err && err.message ? err.message : err)});
  });
}

// reprint: enqueue a job from the print history (job_id) or a finished queue
// item (item_id) back into the print queue. Optionally with another printer
// and/or an edited ZPL. The queue processor sends it like any other item.
rest.post('/rest/queue/reprint', function(req, res) {
  var job = null;
  var originItem = null;

  if (req.body.job_id) {
    job = db.jobs.findOne({_id: req.body.job_id});
    if (!job) {
      return res.status(400).send('given job id was not valid');
    }
  } else if (req.body.item_id) {
    originItem = db.queue.findOne({_id: req.body.item_id});
    if (!originItem) {
      return res.status(400).send('given item id was not valid');
    }
  } else {
    return res.status(400).send('no job_id or item_id was given');
  }

  // printer: explicit choice wins, else the printer of the original entry
  var printerId = originItem ? originItem.printer_id : job.printer_id;
  if (req.body.printer) {
    var printer = db.printer.findOne({_id: req.body.printer});
    if (!printer) {
      return res.status(400).send('given printer id was not valid');
    }
    printerId = printer._id;
  }

  // ZPL source: an edited ZPL wins. Otherwise, if the label template still
  // exists, leave zpl_override empty so the queue compiles it fresh with the
  // target printer's density (important when reprinting on another printer).
  // Only when the template is gone, fall back to the historical ZPL.
  var labelId = originItem ? originItem.label_id : job.label_id;
  var data = originItem ? (originItem.data || {}) : (job.data || {});
  var fallbackZpl = originItem ? originItem.zpl_override : job.zpl;
  var labelExists = labelId && !!db.label.findOne({_id: labelId});
  var zplOverride;
  if (req.body.zpl) {
    zplOverride = req.body.zpl;
  } else if (labelExists) {
    zplOverride = null;
  } else {
    zplOverride = fallbackZpl || null;
  }

  // Job ID = Q + batch - copy - seq; a reprint is a new batch, copy 1
  var batch = nextCounter('queue_batch');
  var seq = nextCounter('queue_seq');

  var item = {
    job_id: 'Q' + batch + '-1-' + seq,
    label_id: labelId || null,
    label_name: originItem ? originItem.label_name : job.label_name,
    printer_id: printerId,
    row_index: null,
    data: data,
    zpl_override: zplOverride,
    source: 'reprint',
    source_ip: requestIp(req),
    status: 'pending',
    error: null,
    created_at: new Date(),
    finished_at: null
  };

  console.log((new Date()) + ' reprint enqueued (' + item.job_id + ')');
  db.queue.save(item);
  broadcastMsg({source: 'queue', event: 'updated', data: {item: item}});
  printQueue.tick();
  res.json(item);
});

// add a single print job to the queue without an xlsx upload.
// printer_id is optional: when omitted the label's bound printer is used.
rest.post('/rest/queue/add', function(req, res) {
  if (!req.body.label_id) return res.status(400).send('no label_id was given');

  var label = db.label.findOne({_id: req.body.label_id});
  if (!label) return res.status(400).send('label not found');

  var printerId = null;
  if (req.body.printer_id) {
    var printer = db.printer.findOne({_id: req.body.printer_id});
    if (!printer) return res.status(400).send('printer_id is not valid');
    printerId = printer._id;
  } else if (!label.printer_id) {
    return res.status(400).send('this label has no printer bound: select a printer');
  }

  var data = (req.body.data && typeof req.body.data === 'object') ? req.body.data : {};

  // multi-value print: a plain value list fills the placeholders left to
  // right, row by row. cols comes from label.print_layout.cols (default 1);
  // rows > 0 caps the value count (fixed-sheet media), rows = 0 means a
  // continuous roll where the row count follows the value count.
  //
  // each printed row becomes its OWN queue item (never one ZPL blob with
  // several rows): the queue is strictly sequential, so row 1 is printed and
  // finished before row 2 is sent - required for small multi-up labels where
  // feeding all rows in one send drifts out of position.
  var zplOverride = null;
  var rowOverrides = null;
  var values = Array.isArray(req.body.values) ? req.body.values.map(String) : null;
  if (values && values.length) {
    var layout = label.print_layout || {};
    var cols = Math.max(1, parseInt(layout.cols, 10) || 1);
    var maxRows = Math.max(0, parseInt(layout.rows, 10) || 0);
    if (maxRows && values.length > maxRows * cols) {
      return res.status(400).send('too many values: this label holds ' + (maxRows * cols) + ' (' + maxRows + ' rows x ' + cols + ' cols)');
    }
    var vp = printerId ? db.printer.findOne({_id: printerId})
           : (label.printer_id ? db.printer.findOne({_id: label.printer_id}) : null);
    if (!vp) return res.status(400).send('a bound printer is required for multi-value printing');
    var base = rowBaseZpl(label, vp, cols);
    var phRe = /(\$\{[^}]+\}|\{\{[^}]+\}\})/g;
    if (!(base.match(phRe) || []).length) {
      return res.status(400).send('this label has no variables to fill');
    }
    rowOverrides = [];
    for (var vi = 0; vi < values.length; vi += cols) {
      var group = values.slice(vi, vi + cols);
      // an all-blank row means the data has ended: stop, do not print it or
      // anything after it (a partially filled last row still prints)
      if (!group.some(function (v) { return String(v).trim() !== ''; })) break;
      var gidx = 0;
      rowOverrides.push(base.replace(phRe, function () {
        var v = group[gidx];
        gidx++;
        return v === undefined ? '' : v;
      }));
    }
    if (!rowOverrides.length) {
      return res.status(400).send('all values are blank: nothing to print');
    }
    data = {}; // placeholders are already resolved row by row
  }

  // Job ID = Q + batch - copy - seq; a single add is its own batch, copy 1
  // (multi-row adds use the row number as the copy index: Q51-2-37 = row 2)
  var batch = nextCounter('queue_batch');
  var slots = rowOverrides || [null];
  var items = [];

  slots.forEach(function (rowZpl, ri) {
    var item = {
      job_id: 'Q' + batch + '-' + (rowOverrides ? (ri + 1) : 1) + '-' + nextCounter('queue_seq'),
      label_id: label._id,
      label_name: label.name,
      printer_id: printerId,
      row_index: rowOverrides ? (ri + 1) : null,
      data: data,
      zpl_override: rowZpl,
      source: 'manual',
      source_ip: requestIp(req),
      status: 'pending',
      error: null,
      created_at: new Date(),
      finished_at: null
    };
    db.queue.save(item);
    items.push(item);
  });

  broadcastMsg({source: 'queue', event: 'updated', data: {queued: items.length, items: items}});
  printQueue.tick();
  // backward compatible: the first item's fields stay at the top level
  var out = Object.assign({}, items[0]);
  out.queued = items.length;
  out.items = items.map(function (i) {
    return { job_id: i.job_id, row_index: i.row_index, status: i.status };
  });
  res.json(out);
});

// variables (${var} / {{var}}) of a label, used by the manual-add form
rest.get('/rest/label/variables/(:id)', function(req, res) {
  var label = db.label.findOne({_id: req.params.id});
  if (!label) return res.status(400).send('label not found');
  res.json({variables: labelVariables(label)});
});

// actuall print
rest.post('/rest/print', function(req, res) {
  var response = {};
  if (!req.body.printer) {
    return res.status(400).send('no printer id was given');
  }
  if (!req.body.label) {
    return res.status(400).send('no label id was given');
  }

  var printer = db.printer.findOne({
    _id: req.body.printer
  });
  if (!printer) {
    return res.status(400).send('given printer id was not valid');
  }
  var label = db.label.findOne({
    _id: req.body.label
  });
  if (!label) {
    return res.status(400).send('given label id was not valid');
  }

  var job = {};
  job.date = new Date();
  job.printer_id = printer._id;
  job.printer_name = printer.name;
  job.printer_address = printer.address;
  job.printer_conn = printer.conn === 'usb' ? 'usb' : 'tcp';
  job.printer_ip = printer.address.split(':')[0];
  job.printer_port = parseInt(printer.address.split(':')[1]);
  job.label_id = label._id;
  job.label_name = label.name;
  var baseZpl = labelToZpl(label, printer);
  job.label_zpl = baseZpl;
  job.data = req.body.data;
  job.job_id = typeof req.body.job_id !== 'undefined' ? req.body.job_id : null;


  job.zpl = baseZpl;
  for (key in job.data) {
    job.zpl = job.zpl.replace("${" + key + "}", job.data[key])
  }

  var mustache_reg = /{{(.*)}}/gm;
  if (mustache_reg.exec(job.zpl)) {
    job.mustache = true;
    job.zpl = Mustache.render(job.zpl, job.data);
  } else {
    job.mustache = false;
  }

  console.log((new Date()) + ' print job received', job);

  executeRequest(job, function(ret) {
    job = ret;
    db.jobs.save(job);

    var broadcast = {};
    broadcast.source = "job";
    broadcast.data = job;
    broadcastMsg(broadcast);

    res.json(job)
  });
});

function executeRequest(job, callback) {
  // USB printers: hand the ZPL to the Windows spooler (RAW) instead of a socket
  if (job.printer_conn === 'usb') {
    usbPrint.sendZpl(job.printer_address, job.zpl).then(function (r) {
      job.failed = r.failed;
      job.error = r.error;
      callback(job);
    });
    return;
  }

  var client = new Net.Socket();

  client.setTimeout(5000, function() {
    console.error((new Date()) + " " + "connection timed out");
    job.failed = true;
    job.error = "connection timed out";
    callback(job);
    client.destroy();
  });

  client.connect({
    port: job.printer_port,
    host: job.printer_ip
  }, function() {
    client.write(job.zpl);
    job.failed = false;
    callback(job);
    client.destroy();
  });

  client.on('error', function(err) {
    console.error((new Date()) + " " + err);
    job.failed = true;
    job.error = err;
    callback(job);
    client.destroy();
  });

  client.on('data', function(chunk) {
    job.printer_data = chunk;
    console.log(new Date() + " received data from printer:", chunk);
  });

  client.on('end', function() {});
}

// ---------------- Batch print queue (stage 3) ----------------

// queue page
rest.get('/queue', function(req, res) {
  var data = {};
  data.config = config;
  res.render('queue', data);
});

// new print queue page: single manual job or xlsx batch upload
rest.get('/queue/new', function(req, res) {
  var data = {};
  data.config = config;
  res.render('queue_new', data);
});

// parse an uploaded xlsx (base64) against a label; returns preview info
rest.post('/rest/queue/parse', function(req, res) {
  if (!req.body.label_id) return res.status(400).send('no label_id was given');
  if (!req.body.content_b64) return res.status(400).send('no file content was given');

  var label = db.label.findOne({_id: req.body.label_id});
  if (!label) return res.status(400).send('label not found');

  var wb;
  try {
    var buf = Buffer.from(req.body.content_b64, 'base64');
    var XLSX = require('xlsx');
    wb = XLSX.read(buf, {type: 'buffer'});
  } catch (e) {
    return res.status(400).send('cannot parse file as xlsx: ' + e.message);
  }
  var sheet = wb.Sheets[wb.SheetNames[0]];
  var rows = XLSX.utils.sheet_to_json(sheet, {header: 1, raw: false, defval: ''});
  if (!rows.length) return res.status(400).send('the first sheet is empty');

  var headers = rows[0].map(function (h) { return String(h).trim(); });
  var dataRows = rows.slice(1).filter(function (r) {
    return r.some(function (c) { return String(c).trim() !== ''; });
  });

  var variables = labelVariables(label);
  var missing = variables.filter(function (v) { return headers.indexOf(v) === -1; });

  var sample = dataRows.slice(0, 3).map(function (r) {
    var obj = {};
    headers.forEach(function (h, i) { obj[h] = String(r[i] === undefined ? '' : r[i]).trim(); });
    return obj;
  });

  var payload = {
    columns: headers,
    variables: variables,
    missing: missing,
    total_rows: dataRows.length,
    sample: sample
  };

  // rows_all: client wants every data row (staged batch add on /queue/new)
  if (req.body.rows_all) {
    payload.rows = dataRows.map(function (r) {
      var obj = {};
      headers.forEach(function (h, i) { obj[h] = String(r[i] === undefined ? '' : r[i]).trim(); });
      return obj;
    });
  }

  res.json(payload);
});

// downloadable xlsx template for a label: header row = its variables
rest.get('/rest/queue/template/(:labelId)', function(req, res) {
  var label = db.label.findOne({_id: req.params.labelId});
  if (!label) return res.status(400).send('label not found');

  var XLSX = require('xlsx');
  var variables = labelVariables(label);
  // header row = label variables only; copies are set once via the Copies input
  var ws = XLSX.utils.aoa_to_sheet([variables, variables.map(function () { return ''; })]);
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'template');
  var buf = XLSX.write(wb, {type: 'buffer', bookType: 'xlsx'});

  res.json({
    filename: (label.name || 'template') + '-template.xlsx',
    content_b64: buf.toString('base64')
  });
});

// ---------- queue drafts: staged task batches saved on /queue/new, opened later from /queue ----------
function draftListItem(d) {
  var label = db.label.findOne({_id: d.label_id});
  var printer = db.printer.findOne({_id: d.printer_id});
  return {
    _id: d._id,
    name: d.name,
    label_id: d.label_id,
    label_name: label ? label.name : '(label deleted)',
    printer_id: d.printer_id,
    printer_name: printer ? printer.name : '(printer deleted)',
    copies: d.copies,
    task_count: (d.items || []).length,
    created_at: d.created_at,
    updated_at: d.updated_at
  };
}

// list drafts (summary view for the Print Queue page)
rest.get('/rest/queue/drafts', function(req, res) {
  var drafts = db.draft.find() || [];
  res.json(drafts.map(draftListItem).sort(function(a, b) {
    return (b.updated_at || '').localeCompare(a.updated_at || '');
  }));
});

// create a draft from the staged tasks on /queue/new
rest.post('/rest/queue/drafts', function(req, res) {
  var b = req.body || {};
  if (!b.label_id || !db.label.findOne({_id: b.label_id})) {
    return res.status(400).send('a valid label_id is required');
  }
  if (!b.printer_id || !db.printer.findOne({_id: b.printer_id})) {
    return res.status(400).send('a valid printer_id is required');
  }
  if (!Array.isArray(b.items) || !b.items.length) {
    return res.status(400).send('at least one staged task is required');
  }
  var now = new Date().toISOString();
  var doc = {
    name: String(b.name || '').trim() || ('Draft ' + now.slice(0, 16).replace('T', ' ')),
    label_id: b.label_id,
    printer_id: b.printer_id,
    copies: Math.max(1, parseInt(b.copies, 10) || 1),
    items: b.items.map(function(it) { return {data: it.data || {}, source: it.source || 'manual'}; }),
    created_at: now,
    updated_at: now
  };
  res.json(db.draft.save(doc));
});

// full draft (opened from the Print Queue page)
rest.get('/rest/queue/drafts/(:id)', function(req, res) {
  var d = db.draft.findOne({_id: req.params.id});
  if (!d) return res.status(404).send('draft not found');
  res.json(d);
});

// update a draft (re-save from /queue/new)
rest.put('/rest/queue/drafts/(:id)', function(req, res) {
  var d = db.draft.findOne({_id: req.params.id});
  if (!d) return res.status(404).send('draft not found');
  var b = req.body || {};
  if (b.name !== undefined) d.name = String(b.name).trim() || d.name;
  if (b.printer_id && db.printer.findOne({_id: b.printer_id})) d.printer_id = b.printer_id;
  if (b.copies !== undefined) d.copies = Math.max(1, parseInt(b.copies, 10) || 1);
  if (Array.isArray(b.items) && b.items.length) {
    d.items = b.items.map(function(it) { return {data: it.data || {}, source: it.source || 'manual'}; });
  }
  d.updated_at = new Date().toISOString();
  db.draft.update({_id: req.params.id}, d);
  res.json(d);
});

rest.delete('/rest/queue/drafts/(:id)', function(req, res) {
  db.draft.remove({_id: req.params.id}, false);
  res.json({deleted: true});
});

// enqueue a batch of staged tasks (from /queue/new): each task is printed
// `copies` times; identical content within this batch gets copy numbers
rest.post('/rest/queue/add-many', function(req, res) {
  if (!req.body.items || !req.body.items.length) {
    return res.status(400).send('no items were given');
  }
  var copies = Math.max(1, parseInt(req.body.copies, 10) || 1);
  var printers = {};
  db.printer.find().forEach(function (p) { printers[p._id] = p; });

  var batch = nextCounter('queue_batch');
  var copiesCounter = {};
  var requesterIp = requestIp(req);
  var now = new Date();
  var created = 0;
  var failed = 0;
  var multiRowNo = 0; // printed-row counter for multi-up (values) tasks

  // ---- automatic row merging on multi-up media ---------------------------
  // Die-cut rolls that carry several labels per row (label.print_layout.cols
  // > 1) hold `cols` values in a single pass. So on such media, tasks that
  // each carry one value of a single-variable label are merged — in the order
  // they were added — into one job per printed row. Copies are applied per
  // round afterwards, so `copies` rounds produce `copies` rows.
  var baseCache = {};
  function multiUpBase(labelId, printerId, cols) {
    var ck = labelId + '|' + (printerId || '') + '|' + cols;
    if (!(ck in baseCache)) {
      var lb = db.label.findOne({_id: labelId});
      var pr = printerId ? printers[printerId]
             : (lb && lb.printer_id ? printers[lb.printer_id] : null);
      var out = null;
      if (lb && pr) { try { out = rowBaseZpl(lb, pr, cols); } catch (e) { out = null; } }
      baseCache[ck] = out;
    }
    return baseCache[ck];
  }

  var queuedItems = [];
  var mergeRun = null;
  req.body.items.forEach(function (staged) {
    var mLabel = db.label.findOne({_id: staged.label_id});
    if (!mLabel) { mergeRun = null; queuedItems.push(staged); return; }

    var rowCols = Math.max(1, parseInt((mLabel.print_layout || {}).cols, 10) || 1);
    var mVars = labelVariables(mLabel);
    var mKeys = Object.keys(staged.data || {});

    var mergeable = rowCols > 1 && !staged.values && !staged.zpl_override &&
      mVars.length === 1 && mKeys.length === 1 && mKeys[0] === mVars[0];
    if (mergeable) {
      var mBase = multiUpBase(staged.label_id, staged.printer_id, rowCols);
      if (!mBase || countSlots(mBase) < rowCols) mergeable = false; // no room for a full row
    }
    if (!mergeable) { mergeRun = null; queuedItems.push(staged); return; }

    var runKey = staged.label_id + '|' + (staged.printer_id || '') + '|' + (staged.source || 'manual');
    var mVal = staged.data[mVars[0]];
    mVal = (mVal === undefined || mVal === null) ? '' : String(mVal);

    if (mergeRun && mergeRun.key === runKey) { mergeRun.values.push(mVal); return; }
    mergeRun = {key: runKey, values: []};
    // the holder shares the array reference, so later values land in it too
    mergeRun.holder = Object.assign({}, staged, {data: {}, values: mergeRun.values, merged_rows: true});
    mergeRun.values.push(mVal);
    queuedItems.push(mergeRun.holder);
  });

  queuedItems.forEach(function (staged) {
    var label = db.label.findOne({_id: staged.label_id});
    if (!label) { failed++; return; }

    // staged.values (array) -> fill placeholders left to right, row by row,
    // using label.print_layout.cols; every printed row becomes its own job
    // (the queue is sequential: row N finishes before row N+1 is sent)
    var stagedOverride = staged.zpl_override || null;
    var stagedRows = null;
    if (Array.isArray(staged.values) && staged.values.length) {
      var sLayout = label.print_layout || {};
      var sCols = Math.max(1, parseInt(sLayout.cols, 10) || 1);
      var sPrinter = printers[staged.printer_id]
        || (label.printer_id ? printers[label.printer_id] : null);
      if (!sPrinter) { failed++; return; }
      var sBase = rowBaseZpl(label, sPrinter, sCols);
      var sPhRe = /(\$\{[^}]+\}|\{\{[^}]+\}\})/g;
      if (!countSlots(sBase)) { failed++; return; }
      stagedRows = [];
      // copies repeat the whole value sequence, so k rounds fill k row sets
      var sValues = staged.values.slice();
      if (staged.merged_rows && copies > 1) {
        var rep = [];
        for (var rc = 0; rc < copies; rc++) rep = rep.concat(sValues);
        sValues = rep;
      }
      for (var si = 0; si < sValues.length; si += sCols) {
        var sGroup = sValues.slice(si, si + sCols).map(String);
        // an all-blank row ends this staged group (nothing more to print)
        if (!sGroup.some(function (v) { return v.trim() !== ''; })) break;
        var sIdx = 0;
        stagedRows.push(sBase.replace(sPhRe, function () {
          var v = sGroup[sIdx];
          sIdx++;
          return v === undefined ? '' : v;
        }));
      }
      if (!stagedRows.length) return; // all blank: skip this staged item
      staged = Object.assign({}, staged, {data: {}});
    }

    var rowSlots = stagedRows || [stagedOverride];
    // merged rows already contain every copy round, so they are queued once
    var effCopies = (staged.merged_rows && stagedRows) ? 1 : copies;

    for (var c = 0; c < effCopies; c++) {
      for (var r = 0; r < rowSlots.length; r++) {
        // multi-up rows are numbered within the batch (1,2,3...) so the queue
        // shows which printed row each task is
        if (stagedRows) multiRowNo++;
        var item = {
          job_id: null,
          label_id: label._id,
          label_name: label.name,
          printer_id: staged.printer_id || null,
          row_index: stagedRows ? multiRowNo : null,
          data: staged.data || {},
          zpl_override: rowSlots[r],
          source: staged.source || 'manual',
          source_ip: requesterIp,
          status: 'pending',
          error: null,
          created_at: now,
          finished_at: null
        };

        // printer given but unknown -> keep the item, mark failed at enqueue
        if (item.printer_id && !printers[item.printer_id]) {
          item.status = 'failed';
          item.error = 'printer not found';
          failed++;
        }

        var ck = copyKey(item);
        copiesCounter[ck] = (copiesCounter[ck] || 0) + 1;
        item.job_id = 'Q' + batch + '-' + copiesCounter[ck] + '-' + nextCounter('queue_seq');

        db.queue.save(item);
        created++;
      }
    }
  });

  if (created) broadcastMsg({source: 'queue', event: 'updated', data: {queued: created}});
  printQueue.tick();
  res.json({queued: created, failed_at_enqueue: failed});
});

// enqueue all rows of an xlsx for a label
rest.post('/rest/queue/enqueue', function(req, res) {
  if (!req.body.label_id) return res.status(400).send('no label_id was given');
  if (!req.body.content_b64) return res.status(400).send('no file content was given');

  var label = db.label.findOne({_id: req.body.label_id});
  if (!label) return res.status(400).send('label not found');

  var wb;
  var XLSX = require('xlsx');
  try {
    wb = XLSX.read(Buffer.from(req.body.content_b64, 'base64'), {type: 'buffer'});
  } catch (e) {
    return res.status(400).send('cannot parse file as xlsx: ' + e.message);
  }
  var sheet = wb.Sheets[wb.SheetNames[0]];
  var rows = XLSX.utils.sheet_to_json(sheet, {header: 1, raw: false, defval: ''});
  if (rows.length < 2) return res.status(400).send('the file has no data rows');

  var headers = rows[0].map(function (h) { return String(h).trim(); });
  var variables = labelVariables(label);
  var missing = variables.filter(function (v) { return headers.indexOf(v) === -1; });
  if (missing.length) {
    return res.status(400).send('the file misses columns for variables: ' + missing.join(', '));
  }

  var printerColumn = req.body.printer_column ? String(req.body.printer_column).trim() : null;
  if (printerColumn && headers.indexOf(printerColumn) === -1) {
    return res.status(400).send('printer column "' + printerColumn + '" does not exist in the file');
  }
  var printers = db.printer.find();

  // one batch per enqueue call; identical rows within the batch get copy numbers
  var batch = nextCounter('queue_batch');
  var copies = {};
  var requesterIp = requestIp(req);

  var created = 0;
  var failed = 0;
  var now = new Date();
  rows.slice(1).forEach(function (r, idx) {
    var empty = r.every(function (c) { return String(c).trim() === ''; });
    if (empty) return;

    var data = {};
    headers.forEach(function (h, i) { data[h] = String(r[i] === undefined ? '' : r[i]).trim(); });

    var item = {
      job_id: null, // set below
      label_id: label._id,
      label_name: label.name,
      printer_id: null,
      row_index: idx + 2, // excel row number (1-based + header)
      data: data,
      zpl_override: null,
      source: 'xlsx',
      source_ip: requesterIp,
      status: 'pending',
      error: null,
      created_at: now,
      finished_at: null
    };

    if (printerColumn) {
      var key = String(data[printerColumn] || '').trim();
      var found = null;
      for (var i = 0; i < printers.length; i++) {
        var p = printers[i];
        if (p.name === key || p.address === key || p.address.split(':')[0] === key) { found = p; break; }
      }
      if (!found) {
        item.status = 'failed';
        item.error = 'printer not found for "' + printerColumn + '" value: ' + key;
        failed++;
      } else {
        item.printer_id = found._id;
      }
    }

    // Job ID = Q + batch(queue) - copy(duplicate) - seq(global sequence)
    var ck = copyKey(item);
    copies[ck] = (copies[ck] || 0) + 1;
    item.job_id = 'Q' + batch + '-' + copies[ck] + '-' + nextCounter('queue_seq');

    db.queue.save(item);
    created++;
  });

  if (created) broadcastMsg({source: 'queue', event: 'updated', data: {queued: created}});
  printQueue.tick();
  res.json({queued: created, failed_at_enqueue: failed});
});

// queue status: unfinished items (pending/processing/failed) + finished
// history (done), both newest first; printer names resolved for display
rest.get('/rest/queue', function(req, res) {
  var printers = {};
  db.printer.find().forEach(function(p) { printers[p._id] = p.name; });
  var all = db.queue.find().sort(function (a, b) {
    return new Date(b.created_at) - new Date(a.created_at);
  }).map(function (item) {
    if (!item.printer_name && item.printer_id && printers[item.printer_id]) {
      item.printer_name = printers[item.printer_id];
    }
    return item;
  });
  var items = [];
  var history = [];
  all.forEach(function (item) {
    if (item.status === 'done') history.push(item);
    else items.push(item);
  });
  res.json({
    paused: printQueue.isPaused(),
    pause_reason: printQueue.pauseReason(),
    active: printQueue.activeJobs(), // jobs in flight, one per printer
    items: items,
    history: history
  });
});

rest.post('/rest/queue/pause', function(req, res) {
  printQueue.pause();
  res.json({paused: true});
});

rest.post('/rest/queue/resume', function(req, res) {
  printQueue.resume();
  res.json({paused: false});
});

// requeue failed items: all of them, or only the given ids (single retry)
// NOTE: diskdb does not support the $in operator, filter in memory instead
rest.post('/rest/queue/retry', function(req, res) {
  var n = 0;
  var idSet = {};
  var ids = (req.body && req.body.ids && req.body.ids.length) ? req.body.ids : null;
  if (ids) ids.forEach(function (id) { idSet[id] = true; });
  db.queue.find({status: 'failed'}).forEach(function (item) {
    if (ids && !idSet[item._id]) return;
    item.status = 'pending';
    item.error = null;
    item.finished_at = null;
    db.queue.update({_id: item._id}, item);
    n++;
  });
  printQueue.resume();
  res.json({requeued: n});
});

// delete queue items: by ids, by status ("done" / "failed"), or all.
// NOTE: diskdb does not support the $in operator, filter in memory instead
rest.post('/rest/queue/delete', function(req, res) {
  var ids = (req.body.ids && req.body.ids.length) ? req.body.ids : null;
  var idSet = {};
  if (ids) ids.forEach(function (id) { idSet[id] = true; });

  var toDelete = db.queue.find().filter(function (item) {
    if (item.status === 'processing') return false; // never delete in-flight items
    if (ids) return !!idSet[item._id];
    if (req.body.status === 'done' || req.body.status === 'failed') return item.status === req.body.status;
    if (req.body.status === 'items') return item.status === 'pending' || item.status === 'failed'; // Queue Items only (unfinished)
    if (req.body.status === 'all') return true;
    return false;
  });

  var removed = 0;
  toDelete.forEach(function (item) {
    if (db.queue.remove({_id: item._id}, false)) removed++;
  });
  printQueue.tick();
  res.json({removed: removed});
});

// export failed items as xlsx (base64), original columns + error
rest.post('/rest/queue/failed/export', function(req, res) {
  var failedItems = db.queue.find({status: 'failed'});
  if (!failedItems.length) return res.status(400).send('no failed items');
  var XLSX = require('xlsx');

  var headers = null;
  var data = failedItems.map(function (item) {
    if (!headers) headers = Object.keys(item.data || {});
    var row = headers.map(function (h) { return (item.data || {})[h] || ''; });
    row.push(item.job_id || '');
    row.push(item.source_ip || '');
    row.push(item.error || '');
    row.push(item.label_name || '');
    return row;
  });
  var headerRow = headers.concat(['job_id', 'source_ip', 'error', 'label']);
  var ws = XLSX.utils.aoa_to_sheet([headerRow].concat(data));
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'failed');
  var buf = XLSX.write(wb, {type: 'buffer', bookType: 'xlsx'});
  res.json({filename: 'queue_failed.xlsx', content_b64: buf.toString('base64')});
});

// printer discovery: return the server's own /24 subnet for the UI to prefill
rest.get('/rest/discover/subnet', function(req, res) {  res.json({subnet: discover.localSubnet()});
});

// every candidate /24 the machine can reach (Ethernet + Wi-Fi + virtual),
// best first: the UI shows them when a scan comes back empty
rest.get('/rest/discover/subnets', function(req, res) {
  res.json(discover.localSubnets());
});

// diagnostics for "printers not found from this PC": what interfaces exist,
// which subnet would be scanned, whether PowerShell exists, and how the last
// sweep actually ran (PowerShell or node fallback, host count, errors).
// ?target=192.168.8.43:9100 additionally pings and connects to that printer,
// which separates "app cannot scan" from "this PC cannot reach the printer".
rest.get('/rest/discover/diag', function(req, res) {
  var target = null;
  if (req.query && req.query.target) {
    // invalid / hostile input (garbage, a repeated ?target=a&target=b array,
    // a "-t"-style value) simply yields no target instead of throwing
    var t = normalizeTcpAddress(req.query.target);
    if (t) target = { host: t.host, port: t.port };
  }
  discover.getDiagAsync(target).then(function(diag) {
    if (!req.query || req.query.probe !== '1') return res.json(diag);
    // optional live probe: can this machine run PowerShell at all?
    require('child_process').execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'],
      { windowsHide: true, timeout: 8000 },
      function(err, stdout) {
        diag.powershell_probe = err
          ? { ok: false, error: err.message }
          : { ok: true, version: String(stdout || '').trim() };
        res.json(diag);
      });
  }).catch(function(err) {
    // a diagnostics endpoint must always answer: never leave the request open
    if (res.headersSent) return;
    res.status(500).json({ error: 'diag_failed', message: String(err && err.message || err) });
  });
});

// connectivity tester: "can this PC reach 192.168.8.43:9100 right now?"
// answers ping + TCP connect with timings, no printing, no data sent
rest.post('/rest/discover/probe', function(req, res) {
  var raw = req.body && (req.body.address || req.body.host || '');
  var t = normalizeTcpAddress(raw);
  if (!t) {
    return res.status(400).json({
      error: 'address_invalid',
      message: 'address is not a valid IP or IP:port (e.g. 192.168.8.43 or 192.168.8.43:9100)'
    });
  }
  // both probes are individually time-boxed (ping 1.5s + exec cap, TCP 2s), so
  // the request cannot hang; the catch is the defensive net for the unlikely
  // case that one of them throws instead of resolving
  Promise.all([
    discover.pingHost(t.host, 1500),
    discover.probeDetailed(t.host, t.port, 2000)
  ]).then(function(r) {
    res.json({ address: t.address, host: t.host, port: t.port, ping: r[0], tcp: r[1] });
  }).catch(function(err) {
    if (res.headersSent) return;
    res.status(500).json({ error: 'probe_failed', message: String(err && err.message || err) });
  });
});

// printer discovery: scan a /24 subnet, report Zebra devices only,
// each result flagged already_added when its IP is already in the database
rest.post('/rest/discover', function(req, res) {
  var subnet = req.body && req.body.subnet;
  try { crashLog.log('discover', 'route entered, subnet=' + subnet); } catch (e) {}
  if (!subnet) {
    return res.status(400).send('no subnet was given');
  }
  var scanPromise;
  // counters of this scan only ("9100 open on N hosts, M confirmed Zebra"),
  // reported back in headers so the UI can say where a missing printer was
  // lost: never reached, or reached and not identified
  discover.resetScanStats();
  if (subnet === 'auto') {
    // scan every usable interface, not just the first one: a PC with
    // Ethernet + Wi-Fi + VPN otherwise scans the wrong /24 and reports
    // "no printers" while the printers are on another NIC
    var bases = discover.localSubnets().map(function(s) { return s.base; }).slice(0, 3);
    if (!bases.length) {
      return res.status(400).send('could not detect the server subnet');
    }
    res.setHeader('X-Scanned-Subnets', bases.join(','));
    try { crashLog.log('discover', 'auto -> subnets ' + bases.join(',')); } catch (e) {}
    scanPromise = discover.discoverPrintersAll(bases);
  } else {
    scanPromise = discover.discoverPrinters(subnet);
  }
  scanPromise.then(function(list) {
    try { crashLog.log('discover', 'scan promise resolved, ' + list.length + ' raw results'); } catch (e) {}
    var zebraOnly = list.filter(function(p) { return p.is_zebra; });
    // also pick up locally installed (USB) Zebra printers from the Windows spooler
    return usbPrint.listPrinters().then(function(usb) {
      try { crashLog.log('discover', 'usb list done, ' + (usb.printers || []).length + ' printers'); } catch (e) {}
      var existing = {};
      var knownByIp = {};
      db.printer.find().forEach(function(pr) {
        if (pr.conn === 'usb') existing[pr.address] = true;
        else {
          var ip = pr.address.split(':')[0];
          existing[ip] = true;
          if (!knownByIp[ip]) knownByIp[ip] = pr;
        }
      });
      zebraOnly.forEach(function(p) {
        p.already_added = !!existing[p.ip];
        // backfill the serial of an already added printer stored without one
        // (pre-serial record): keeps the automatic rebind working for it
        var known = knownByIp[p.ip];
        if (known && p.serial && !known.serial) {
          known.serial = p.serial;
          db.printer.update({_id: known._id}, known);
          console.log('discover: stored serial of "' + known.name + '" (' + p.serial + ')');
        }
      });

      var usbList = [];
      (usb.printers || []).forEach(function(p) {
        // only Zebra drivers: "ZDesigner ZT510-203dpi ZPL", "ZTC ..." etc.
        var drv = String(p.driver || '');
        if (!/zebra|zdesigner|ztc/i.test(drv) && !/zebra|zdesigner|ztc/i.test(p.name)) return;
        var model = null;
        var m = drv.match(/(?:ZDesigner|ZTC|Zebra)\s+([A-Za-z]+\d+[A-Za-z]*)/i);
        if (m) model = m[1].toUpperCase();
        var dm = drv.match(/(\d{3})\s*dpi/i);
        var dpi = dm ? parseInt(dm[1], 10) : null;
        var profile = model ? printerProfiles.getProfile(model) : null;
        usbList.push({
          conn: 'usb',
          name: p.name, // Windows printer name -> printer.address for conn=usb
          model: model || drv,
          is_zebra: true,
          dpi: dpi,
          density: dpi ? printerProfiles.dpmmFromDpi(dpi) : null,
          media: profile ? profile.media : null,
          zpl_header: profile ? profile.zpl_header : null,
          profile_name: profile ? profile.name : null,
          settings: model ? printerProfiles.getSettings(model, dpi) : null,
          already_added: !!existing[p.name]
        });
      });

      var stats = discover.getScanStats();
      res.setHeader('X-Sweep-Open', String(stats.open));
      res.setHeader('X-Sweep-Zebra', String(stats.zebra));
      res.json(zebraOnly.concat(usbList));
    });
  }).catch(function(err) {
    res.status(400).send(String(err.message || err));
  });
});

// split a printer address "host:port" into its parts (port defaults to 9100)
function parseAddress(address) {
  var parts = String(address || '').split(':');
  return {host: parts[0] || '', port: parseInt(parts[1], 10) || 9100};
}

// TCP online probe for a printer record, shared by /rest/printer/status and
// the automatic rebind (printer re-found at its new address after a DHCP
// address change). USB/spooler printers have no socket to probe.
function probePrinterOnline(printer) {
  var a = parseAddress(printer.address);
  return discover.probePort(a.host, a.port, 800);
}

// best-effort read of a printer's serial number over SGD. Resolves '' when
// the device does not answer: adding or editing a printer must never fail
// or slow down noticeably because of this. The fallback to device.unique_id
// is only sent to devices that actually answered the first query (a silent
// or refused device receives no second command, mirroring the discovery
// safety rule of not writing to unverified devices).
function queryPrinterSerial(address) {
  var a = parseAddress(address);
  // "?" (or any answer without letters/digits) is a firmware placeholder for
  // an unsupported getvar — treat it as no answer and continue the fallback
  function plausible(v) { return !!v && /[A-Za-z0-9]/.test(v); }
  return discover.sgdQueryRaw(a.host, a.port, 'device.serial_number', 2000)
    .then(function (r) {
      if (plausible(r.value)) return r.value;
      if (!r.data) return ''; // no answer -> no fallback command
      return discover.sgdQueryRaw(a.host, a.port, 'device.unique_id', 2000)
        .then(function (r2) { return plausible(r2.value) ? r2.value : ''; });
    })
    .catch(function () { return ''; });
}

// printer online/offline probe (TCP connect to each network printer's port;
// USB/spooler printers are matched against the local spooler state, which is
// queried once per call and cached for 5s inside usb_print.listPrinters())
rest.get('/rest/printer/status', function(req, res) {
  var printers = db.printer.find();
  var usbQuery = usbPrint.listPrinters().catch(function() { return {error: 'spooler query failed'}; });
  Promise.all(printers.map(function(p) {
    if (p.conn === 'usb') {
      return usbQuery.then(function(r) {
        // no usable spooler info (error / empty list / non-Windows) -> do not guess
        if (!r || r.error || !r.printers || !r.printers.length) {
          return { id: p._id, online: 'unknown' };
        }
        var hit = null;
        r.printers.forEach(function(w) {
          if (!hit && w.name === p.address) hit = w; // exact name, as on creation
        });
        // driver uninstalled / renamed -> effectively offline
        return { id: p._id, online: hit ? (hit.status === 'online') : false };
      });
    }
    return probePrinterOnline(p)
      .then(function(online) {
        return { id: p._id, online: online };
      });
  })).then(function(statuses) {
    var map = {};
    statuses.forEach(function(s) { map[s.id] = s.online; });
    res.json(map);
  });
});

// ---------------- automatic printer rebind (DHCP address changes) ---------
// Factory printers get their IP from DHCP, so the configured address goes
// stale from time to time and the queue keeps skipping the printer. Zebra
// devices keep a stable serial number, so offline printers with a known
// serial are looked up in their /24 subnet: the subnet is scanned, the
// device with the matching serial rewrites the stored address (the port is
// kept), the queue cooldown is dropped and the UI is notified. One scan
// round runs at a time; a trigger during a round is skipped.

var rebindRunning = false;

// look for one offline printer's serial in its current /24 subnet
function rebindSingle(printer) {
  var oldAddress = printer.address;
  var subnet = oldAddress.split(':')[0].split('.').slice(0, 3).join('.') + '.0/24';
  var port = parseInt(oldAddress.split(':')[1], 10) || 9100;
  return discover.discoverPrinters(subnet).then(function (list) {
    var matches = list.filter(function (d) { return d.serial && d.serial === printer.serial; });
    if (matches.length === 1) {
      var newAddress = matches[0].ip + ':' + port;
      console.log('rebind: printer "' + printer.name + '" serial ' + printer.serial
        + ' found at ' + newAddress + ' (was ' + oldAddress + ')');
      // the device may simply have been busy: found back at the old address
      // means no change, but the queue still gets a fresh chance
      printQueue.clearOffline(printer._id);
      if (newAddress !== oldAddress) {
        printer.address = newAddress;
        db.printer.update({_id: printer._id}, printer);
        broadcastMsg({source: 'printer', event: 'rebound', data: {
          printer_id: printer._id,
          name: printer.name,
          old_address: oldAddress,
          new_address: newAddress
        }});
      }
      return {printer: printer.name, old_address: oldAddress, new_address: newAddress};
    }
    if (!matches.length) {
      console.log('rebind: no device with serial ' + printer.serial + ' found in ' + subnet
        + ', keeping ' + oldAddress);
    } else {
      console.log('rebind: ' + matches.length + ' devices in ' + subnet + ' share serial '
        + printer.serial + ', keeping ' + oldAddress + ' (ambiguous)');
    }
    return {printer: printer.name, old_address: oldAddress, new_address: null};
  }).catch(function (err) {
    console.log('rebind: scan of ' + subnet + ' failed: ' + (err && err.message ? err.message : err));
    return {printer: printer.name, old_address: oldAddress, new_address: null};
  });
}

// one rebind round: probe every tcp printer that has a serial, scan the
// subnet of each offline one (sequentially, to keep the network load low)
function rebindOfflinePrinters() {
  if (rebindRunning) {
    console.log('rebind: previous round still running, skipping this trigger');
    return Promise.resolve([]);
  }
  rebindRunning = true;
  var candidates = db.printer.find().filter(function (p) {
    return p.conn !== 'usb' && p.serial;
  });
  return Promise.all(candidates.map(function (p) {
    return probePrinterOnline(p).then(function (online) {
      return {printer: p, online: online};
    });
  })).then(function (checked) {
    var offline = checked.filter(function (c) { return !c.online; });
    if (!offline.length) return [];
    console.log('rebind: ' + offline.length + ' offline printer(s) with serial, scanning ...');
    var chain = Promise.resolve();
    var results = [];
    offline.forEach(function (c) {
      chain = chain.then(function () {
        return rebindSingle(c.printer).then(function (r) {
          results.push(r);
        });
      });
    });
    return chain.then(function () { return results; });
  }).catch(function (err) {
    console.log('rebind: round failed: ' + (err && err.message ? err.message : err));
    return [];
  }).then(function (results) {
    rebindRunning = false;
    return results;
  });
}

// manual trigger of the rebind: immediately look for offline serial-tagged
// printers in their subnets and rewrite moved addresses
rest.post('/rest/printer/rediscover', function(req, res) {
  rebindOfflinePrinters().then(function(results) {
    res.json(results);
  });
});

// periodic rebind: config.discovery_interval seconds (default 120, minimum 30)
var discoveryIntervalSec = Math.max(30, parseInt(config.discovery_interval, 10) || 120);
setInterval(function () {
  rebindOfflinePrinters();
}, discoveryIntervalSec * 1000);
console.log((new Date()) + ' printer rebind timer: every ' + discoveryIntervalSec + 's');

// UI language: the web UI selector reports its choice here; the value is
// persisted as config.ui_lang and the tray right-click menu follows it
rest.post('/rest/lang', function(req, res) {
  var lang = req.body && req.body.lang;
  if (['en', 'zh', 'ar'].indexOf(lang) === -1) {
    return res.status(400).json({ error: 'unsupported lang' });
  }
  ConfigHandler.set('ui_lang', lang); // config holds the plain object; the handler persists
  if (tray) trayLib.setTrayLang(lang);
  res.json({ ok: true, lang: lang });
});

// list the Windows-installed printers (for adding a USB printer)
rest.get('/rest/printer/windows', function(req, res) {
  usbPrint.listPrinters().then(function(r) {
    if (r.error) return res.status(500).send(r.error);
    res.json(r.printers);
  });
});

// default print settings for a device model (used to prefill the create modal)
rest.get('/rest/profile/settings', function(req, res) {
  var model = req.query.model;
  if (!model) {
    return res.status(400).send('no model was given');
  }
  res.json(printerProfiles.getSettings(model, parseInt(req.query.dpi, 10)));
});

// create or update printer
// Accept what users actually type: "192.168.8.43", "192.168.8.43:9100",
// "192.168.8.43：9100" (full-width colon from a Chinese IME),
// "http://192.168.8.43/". A bare host gets the default ZPL port 9100 — the
// old strict "<host>:<port>" check rejected the most natural input with a
// cryptic English 400 ("address is not valid"), which read as "cannot add".
function normalizeTcpAddress(input) {
  var s = String(input || '').trim();
  if (!s) return null;
  s = s.replace(/\uff1a/g, ':');            // full-width colon
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ''); // strip scheme
  s = s.replace(/\/.*$/, '');               // strip path
  s = s.replace(/\s+/g, '');
  if (!s) return null;
  var parts = s.split(':');
  if (parts.length === 1) {
    if (!isValidHost(parts[0])) return null;
    return { address: parts[0] + ':9100', host: parts[0], port: 9100 };
  }
  if (parts.length !== 2) return null;
  var host = parts[0];
  if (!isValidHost(host) || !/^\d+$/.test(parts[1])) return null;
  var port = parseInt(parts[1], 10);
  if (!(port >= 1 && port <= 65535)) return null;
  return { address: host + ':' + port, host: host, port: port };
}

/**
 * Shape check for the host part of an address (IPv4 dotted quad or a plain
 * hostname). Besides rejecting obvious junk it keeps values starting with "-"
 * out of the address: this host is handed to ping/zebra sockets, where a
 * leading dash would be parsed as a command line option instead of a target.
 *
 * @param {string} host Host without port.
 * @return {boolean} True when the host may be used as a network target.
 */
function isValidHost(host) {
  if (!host || host.length > 253) return false;
  return /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(host);
}

/**
 * Canonical comparable form of a stored TCP address: a legacy record saved as
 * a bare IP ("192.168.8.43") and a current one ("192.168.8.43:9100") describe
 * the same device, so duplicates must be detected across both spellings.
 *
 * @param {string} address Stored or submitted address.
 * @return {string|null} "host:port" in lower case, null when unparsable.
 */
function canonicalTcpAddress(address) {
  var t = normalizeTcpAddress(address);
  return t ? (String(t.host).toLowerCase() + ':' + t.port) : null;
}

/**
 * Find an existing printer that occupies the same endpoint. TCP printers are
 * compared on the canonical host:port so the two spellings of one address can
 * not be saved twice; USB printers are compared on the exact spooler name.
 *
 * @param {string} address Address of the document being saved (already
 *     normalised for TCP).
 * @param {string} conn 'tcp' or 'usb'.
 * @param {string} selfId _id of the document being edited (excluded).
 * @return {Object|null} The conflicting printer document, if any.
 */
function findDuplicatePrinter(address, conn, selfId) {
  var list = db.printer.find() || [];
  var wantTcp = conn === 'tcp' ? canonicalTcpAddress(address) : null;
  var wantUsb = String(address || '');
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    if (!p) continue;
    if (selfId && p._id === selfId) continue;
    if ((p.conn === 'usb' ? 'usb' : 'tcp') !== conn) continue;
    if (conn === 'tcp') {
      if (wantTcp && canonicalTcpAddress(p.address) === wantTcp) return p;
    } else if (String(p.address || '') === wantUsb) {
      return p;
    }
  }
  return null;
}

rest.post('/rest/printer', function(req, res) {
  var address = req.body.address;
  // connection type: 'tcp' (network socket, default) or 'usb' (Windows
  // spooler RAW via the locally installed driver; address = printer name)
  var conn = (req.body.conn === 'usb') ? 'usb' : 'tcp';

  if (conn === 'tcp') {
    var tcp = normalizeTcpAddress(address);
    if (!tcp) {
      return res.status(400).json({
        error: 'address_invalid',
        message: 'address is not a valid IP or IP:port (e.g. 192.168.8.43 or 192.168.8.43:9100)'
      });
    }
    req.body.address = tcp.address; // persist the normalised form
    return createOrUpdatePrinter(req, res, tcp);
  }

  // usb: the address holds the Windows printer name
  address = String(address || '').trim();
  if (!address) {
    return res.status(400).json({ error: 'usb_name_required', message: 'a Windows printer name is required for USB printers' });
  }
  req.body.conn = 'usb';

  // verify the name against the local spooler. Enumeration problems (non
  // Windows host, PowerShell blocked by policy, Get-Printer failing, empty
  // list) must never block creation: those cases fall through with a log line.
  usbPrint.listPrinters().then(function(result) {
    if (result && result.error) {
      console.log('printer create: cannot list Windows printers, skipping name check: ' + result.error);
      return createOrUpdatePrinter(req, res);
    }
    var installed = (result && Array.isArray(result.printers)) ? result.printers : [];
    if (!installed.length) {
      console.log('printer create: Windows printer list is empty, skipping name check for "' + address + '"');
      return createOrUpdatePrinter(req, res);
    }
    var exists = installed.some(function(p) {
      return p && String(p.name) === address;
    });
    if (!exists) {
      return res.status(400).json({ error: 'usb_not_found', message: 'Windows printer not found: ' + address });
    }
    return createOrUpdatePrinter(req, res);
  }).catch(function(err) {
    // defensive: listPrinters() resolves rather than rejects, but a throw in
    // the continuation above must not leave the request hanging
    console.log('printer create: Windows printer lookup failed, skipping name check: ' + err);
    if (res.headersSent) return; // never answer twice
    createOrUpdatePrinter(req, res);
  });
});

/**
 * Persists a printer document (create or update) once the request has been
 * validated by the /rest/printer handler above.
 *
 * @param {Object} req Express request with a validated body.
 * @param {Object} res Express response.
 * @param {Object} tcp Parsed {host, port, address} for TCP printers, null for USB.
 * @return {void}
 */
function createOrUpdatePrinter(req, res, tcp) {
  var address = req.body.address;
  var conn = (req.body.conn === 'usb') ? 'usb' : 'tcp';
  if (conn === 'usb') {
    address = String(address || '').trim();
    req.body.address = address; // persist exactly the value that was validated
  } else {
    delete req.body.conn; // keep old records without the field
  }

  // one printer per endpoint: reject duplicates. The comparison runs on the
  // normalised address (see normalizeTcpAddress), so "192.168.8.43" and
  // "192.168.8.43:9100" — or "http://192.168.8.43/" — can never end up as two
  // records for the same device, including against legacy bare-IP records.
  var duplicate = findDuplicatePrinter(address, conn, req.body._id);
  if (duplicate) {
    return res.status(409).json({ error: 'duplicate_address', message: 'a printer with this address already exists: ' + duplicate.name, name: duplicate.name });
  }

  // printer-level print settings (mode/darkness/speed): explicit values win,
  // otherwise defaults are resolved from the device model + dpi
  var modelDefaults = null;
  if (req.body.device_model) {
    var profile = printerProfiles.getProfile(req.body.device_model);
    if (profile) {
      req.body.media = profile.media;
      if (profile.zpl_header && !req.body.zpl_header) {
        req.body.zpl_header = profile.zpl_header;
      }
      modelDefaults = printerProfiles.getSettings(req.body.device_model, parseInt(req.body.dpi, 10));
    }
  }
  if (req.body.settings && typeof req.body.settings === 'object') {
    var s = req.body.settings;
    var newSettings = {
      mode: (s.mode === 'thermal_transfer') ? 'thermal_transfer' : 'direct_thermal',
      darkness: (typeof parseInt(s.darkness, 10) === 'number' && !isNaN(parseInt(s.darkness, 10))) ? parseInt(s.darkness, 10) : 0,
      speed: (parseInt(s.speed, 10) > 0) ? parseInt(s.speed, 10) : 2
    };
    // printer base origin (mm): that machine's media-loading compensation,
    // added to every label's ^LH before the label's own margins/offset.
    // Absent -> no base origin (plain ^LH0,0 behaviour).
    if (s.base_origin_mm && typeof s.base_origin_mm === 'object') {
      var bx = parseFloat(s.base_origin_mm.x), by = parseFloat(s.base_origin_mm.y);
      newSettings.base_origin_mm = { x: isFinite(bx) ? bx : 0, y: isFinite(by) ? by : 0 };
    }
    req.body.settings = newSettings;
  } else if (modelDefaults) {
    req.body.settings = modelDefaults;
  } else {
    delete req.body.settings; // no explicit settings and no model to derive from
  }
  if (!req.body.density && req.body.dpi) {
    req.body.density = printerProfiles.dpmmFromDpi(parseInt(req.body.dpi, 10));
  }

  // best-effort serial capture for tcp printers: the serial is the stable
  // identity used by the automatic rebind after a DHCP address change. A
  // device that does not answer leaves the field empty and never blocks
  // the create/update flow (worst case ~2s, usually milliseconds).
  var serialP = (conn === 'usb')
    ? Promise.resolve('')
    : queryPrinterSerial(address);

  return serialP.then(function (serial) {
    if (conn === 'tcp') {
      if (serial) {
        req.body.serial = serial;
      } else if (req.body._id) {
        // address edited to another device and it did not answer: drop the
        // stale serial so the rebind cannot follow the wrong device
        var prior = db.printer.findOne({_id: req.body._id});
        if (prior && prior.serial && prior.address !== address) {
          req.body.serial = '';
        }
      }
    }

    var response;
    var broadcast = {};
    broadcast.source = "printer";
    if (req.body._id) {
      broadcast.action = "update";
      // diskdb replaces the whole document: merge with the existing record so
      // fields not present in the request (media, settings, ...) survive edits
      var existing = db.printer.findOne({_id: req.body._id});
      var doc = Object.assign({}, existing || {}, req.body);
      response = db.printer.update({
        _id: req.body._id
      }, doc, {
        upsert: true
      });
    } else {
      broadcast.action = "create";
      response = db.printer.save(req.body);
    }
    broadcast.data = response;
    broadcastMsg(broadcast);

    // tell the UI whether the device answers right now: the record is saved
    // either way, but "saved yet unreachable" is exactly the state a user
    // must not mistake for a successful setup
    if (!tcp) return res.json(response);
    discover.probePort(tcp.host, tcp.port, 1200).then(function(ok) {
      response.reachable = ok;
      res.json(response);
    }, function() {
      response.reachable = false;
      res.json(response);
    });
  });
}

// create or update label
rest.post('/rest/label', function(req, res) {
  var response;
  var broadcast = {};
  broadcast.source = "label";

  // each label corresponds to one printer: validate the binding
  if (req.body.printer_id) {
    var bound = db.printer.findOne({ _id: req.body.printer_id });
    if (!bound) {
      return res.status(400).send('printer_id is not valid');
    }
  }

  // visual template: accept template as object or JSON string, validate basics
  if (req.body.type === 'visual') {
    if (typeof req.body.template === 'string') {
      try {
        req.body.template = JSON.parse(req.body.template);
      } catch (e) {
        return res.status(400).send('template is not valid JSON');
      }
    }
    if (!req.body.template || typeof req.body.template !== 'object') {
      return res.status(400).send('a visual label requires a template object');
    }
    if (req.body.template.elements && !Array.isArray(req.body.template.elements)) {
      return res.status(400).send('template.elements must be an array');
    }
    // page geometry (safe-area margins / print offset): the server is the
    // authority. Margins never reach the ZPL, the offset becomes the single
    // ^LH; both are normalised before they are stored, and an all-zero page is
    // dropped so untouched/legacy labels keep clean JSON.
    if (req.body.template.page !== undefined && req.body.template.page !== null) {
      var vpage = pageGeometry.validatePage(req.body.template.page,
        Number(req.body.width) || 0, Number(req.body.height) || 0);
      if (vpage.errors.length) {
        return res.status(400).send(vpage.errors[0]);
      }
      if (pageGeometry.isEmptyPage(vpage.page)) delete req.body.template.page;
      else req.body.template.page = vpage.page;
    }
  }

  if (req.body._id) {
    broadcast.action = "update";
    response = db.label.update({
      _id: req.body._id
    }, req.body, {
      upsert: true
    });
  } else {
    broadcast.action = "create";
    if (req.body.type !== 'visual' && !req.body.zpl) req.body.zpl = "^XA\n\n^XZ"
    response = db.label.save(req.body);
  }
  broadcast.data = response;
  broadcastMsg(broadcast);
  res.json(response)
});

// delete printer
rest.delete('/rest/printer/(:id)', function(req, res) {
  if (!req.params.id) {
    return res.status(400).send('no id was given');
  }
  var broadcast = {};
  broadcast.source = "printer";
  broadcast.action = "delete";
  var response = db.printer.remove({
    _id: req.params.id
  });
  broadcast.data = response;
  broadcastMsg(broadcast);
  res.json(response);
});

// delete label
rest.delete('/rest/label/(:id)', function(req, res) {
  if (!req.params.id) {
    return res.status(400).send('no id was given');
  }
  var broadcast = {};
  broadcast.source = "label";
  broadcast.action = "delete";
  var response = db.label.remove({
    _id: req.params.id
  });
  broadcast.data = response;
  broadcastMsg(broadcast);
  res.json(response);
});

// tray / auto browser helpers (see lib/tray.js); config.tray=false disables
var trayUi = 'http://localhost:' + config.port;
// MCP always listens on mcp_port; auth is optional (only when mcp_token set)
var trayMcp = 'http://localhost:' + (config.mcp_port || 18422) + '/mcp';
var tray = null;
var isFrozen = !!process.pkg; // running as packaged exe

// single instance guard: when the port is already taken by a running
// instance, open the browser on it and leave quietly instead of crashing
// (so a second double-click on the exe just opens the UI)

// starting rest
var httpServer = config.public
  ? rest.listen(config.port, function() {
      console.log((new Date()) + " REST is listening on port %d in %s mode", config.port, "public");
    })
  : rest.listen(config.port, 'localhost', function() {
      console.log((new Date()) + " REST is listening on port %d in %s mode", config.port, "localhost");
    });

// tray icon + browser behaviour: the packaged exe opens the UI and minimizes
// its console window on start; `node main.js` only gets the tray icon.
// (note: the 'listening' event lives on the http server, not the express app)
httpServer.on('listening', function() {
  try {
    trayLib.minimizeConsole();
    if (config.open_browser !== false && (isFrozen || config.open_browser === true)) {
      trayLib.openBrowser(trayUi);
    }
  } catch (e) {}
});

httpServer.on('error', function(err) {
  if (err && err.code === 'EADDRINUSE') {
    console.log((new Date()) + ' already running, opened browser and exiting');
    trayLib.openBrowser(trayUi);
    process.exit(0);
  }
  // REST port unusable = nothing to serve: log the reason (e.g. the port fell
  // into a Windows reserved port range) and exit loudly instead of limping
  crashLog.log('http listen failed', err);
  process.exit(1);
});

// MCP server (AI tool access, streamable HTTP + bearer token, see mcp.js)
if (!SKIP_MCP) require('./mcp').start();
else console.log((new Date()) + ' ZPL_SKIP_MCP=1 -> MCP server skipped');

if (config.tray !== false) {
  tray = trayLib.startTray({
    uiBase: trayUi,
    mcpUrl: trayMcp,
    // tray menu language: follows the web UI selection (config.ui_lang,
    // reported by the browser via POST /rest/lang), defaults to English
    lang: config.ui_lang,
    onQuit: function() {
      console.log((new Date()) + ' service closed from tray');
      process.exit(0);
    }
  });
}

// websocket
var server = null;
if (!SKIP_WS) {
  server = http.createServer(function(request, response) {
    // process HTTP request. Since we're writing just WebSockets
    // server we don't have to implement anything.
  });
  // a busy/failed websocket port (e.g. Windows reserved port ranges) must not
  // crash the service — the web UI keeps working, only live refresh degrades
  server.on('error', function(err) {
    crashLog.log('websocket listen failed', err);
  });
  server.listen(config.websocket_port, function() {
    console.log((new Date()) + " Websocket is listening on port " +
      config.websocket_port);
  });
} else {
  console.log((new Date()) + ' ZPL_SKIP_WS=1 -> websocket server skipped');
}

// create the server
if (SKIP_WS) {
  wsServer = null;
} else {
  wsServer = new WebSocketServer({
    httpServer: server
  });
}

var websockt_clients = [];

// WebSocket server
if (wsServer) wsServer.on('request', function(request) {
  console.log((new Date()) + ' Connection from origin ' + request.origin + '.');
  var connection = request.accept(null, request.origin);
  var index = websockt_clients.push(connection) - 1;

  console.log((new Date()) + ' Connection accepted.');
  connection.on('message', function(message) {});

  // a dying socket must never bubble up as an uncaughtException
  connection.on('error', function(err) {
    crashLog.log('websocket connection error', err);
  });

  connection.on('close', function(connection) {
    console.log((new Date()) + " Peer " + connection.remoteAddress + " disconnected.");
    websockt_clients.splice(index, 1);
  });
});

function broadcastMsg(json) {
  var payload = null;
  for (var i = 0; i < websockt_clients.length; i++) {
    try {
      if (payload === null) payload = JSON.stringify(json);
      websockt_clients[i].sendUTF(payload);
    } catch (e) {
      // client vanished between frame and send: drop it, keep broadcasting
      crashLog.log('websocket broadcast error', e);
      websockt_clients.splice(i, 1);
      i--;
    }
  }
}
