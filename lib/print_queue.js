// Batch print queue (stage 3).
// Items are persisted in the diskdb "queue" collection so the queue can
// resume after a service restart (items left "processing" are reset to
// "pending" on boot).
//
// Scheduling is per printer: every printer gets at most one job in flight, so
// the order inside a printer is preserved (oldest first) while jobs for
// DIFFERENT printers run in parallel. A printer that does not answer its TCP
// probe is skipped and retried after a cooldown — it never blocks the others.

'use strict';

var net = require('net');
var usbPrint = require('./usb_print');

var state = {
  db: null,
  broadcast: null,   // function(msg) -> websocket push
  labelToZpl: null,  // function(label, printer) -> zpl
  paused: false,
  active: {},        // printer key -> item currently in flight on that printer
  offline: {},       // printer key -> timestamp of the last failed probe
  pauseReason: null,
  holdTimer: null
};

// Newly enqueued items stay pending (and thus visible in Queue Items) for at
// least this long before the processor picks them up. Without it, a fast
// printer finishes the send within milliseconds and the item jumps straight
// to Print History, so the user never sees it appear in the queue.
var HOLD_MS = 2000;

// a printer that failed its probe is not probed again before this cooldown,
// so its pending items do not keep the queue busy in a tight retry loop
var OFFLINE_RETRY_MS = 5000;

function init(db, opts) {
  state.db = db;
  state.broadcast = opts.broadcast;
  state.labelToZpl = opts.labelToZpl;
  // 断点续传: on boot, items caught mid-flight are requeued
  var requeued = 0;
  db.queue.find({status: 'processing'}).forEach(function (item) {
    item.status = 'pending';
    item.error = null;
    db.queue.update({_id: item._id}, item);
    requeued++;
  });
  if (requeued) console.log('[queue] resumed after restart: ' + requeued + ' processing item(s) requeued');
}

function push(event, data) {
  if (state.broadcast) state.broadcast({source: 'queue', event: event, data: data});
}

function probe(ip, port, timeout) {
  return new Promise(function (resolve) {
    var socket = new net.Socket();
    var done = false;
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
    socket.connect(port, ip);
  });
}

// send zpl; resolves {failed, error}
function sendZpl(ip, port, zpl) {
  return new Promise(function (resolve) {
    var client = new net.Socket();
    var settled = false;
    function finish(r) {
      if (settled) return;
      settled = true;
      client.destroy();
      resolve(r);
    }
    client.setTimeout(5000, function () { finish({failed: true, error: 'connection timed out'}); });
    client.connect({port: port, host: ip}, function () {
      client.write(zpl);
      finish({failed: false});
    });
    client.on('error', function (err) { finish({failed: true, error: String(err.message || err)}); });
  });
}

// substitute ${var} and {{var}} placeholders
function substitute(zpl, data) {
  var out = zpl;
  Object.keys(data || {}).forEach(function (key) {
    out = out.split('${' + key + '}').join(data[key] === undefined ? '' : String(data[key]));
  });
  if (/{{/.test(out)) {
    try {
      out = require('mustache').render(out, data || {});
    } catch (e) { /* leave as-is */ }
  }
  return out;
}

// Start a job on every printer that is idle and has work waiting. Printers are
// independent: one printer never waits for another one, but a single printer
// still prints strictly in enqueue order.
function tick() {
  if (state.paused) return;

  var db = state.db;
  var items = db.queue.find({status: 'pending'}).slice().sort(function (a, b) {
    return new Date(a.created_at) - new Date(b.created_at);
  });

  // label/printer lookups are cached for the duration of one tick: a large
  // batch would otherwise walk the collections once per item
  var labelCache = {};
  var printerCache = {};
  function getLabel(id) {
    if (!(id in labelCache)) labelCache[id] = id ? db.label.findOne({_id: id}) : null;
    return labelCache[id];
  }
  function getPrinter(id) {
    if (!(id in printerCache)) printerCache[id] = id ? db.printer.findOne({_id: id}) : null;
    return printerCache[id];
  }

  var wakeIn = null;
  function wake(ms) {
    if (wakeIn === null || ms < wakeIn) wakeIn = ms;
  }

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    // target: item-level override (reprint/manual add) wins, else the label's
    // binding. Items without a printer get their own key so one broken item
    // cannot block the rest.
    var label = getLabel(item.label_id);
    var printerId = item.printer_id || (label ? label.printer_id : null);
    var key = printerId || ('unbound:' + item._id);

    if (state.active[key]) continue; // that printer has a job in flight

    // hold window: let the user see the item in Queue Items before sending
    var age = Date.now() - new Date(item.created_at).getTime();
    if (age < HOLD_MS) {
      wake(HOLD_MS - age + 10);
      continue;
    }

    var offSince = state.offline[key];
    if (offSince) {
      var left = OFFLINE_RETRY_MS - (Date.now() - offSince);
      if (left > 0) {
        wake(left + 10);
        continue;
      }
      delete state.offline[key];
    }

    startItem(item, {label: label, printerId: printerId, printer: getPrinter(printerId), key: key});
  }

  if (wakeIn !== null) scheduleTick(wakeIn);
}

function scheduleTick(ms) {
  if (state.holdTimer) clearTimeout(state.holdTimer);
  state.holdTimer = setTimeout(function () {
    state.holdTimer = null;
    tick();
  }, ms);
}

function startItem(item, target) {
  var key = target.key;
  state.active[key] = item;
  processItem(item, target, function () {
    if (state.active[key] === item) delete state.active[key];
    setImmediate(tick);
  });
}

function processItem(item, target, done) {
  var db = state.db;
  var label = target.label;
  var printer = target.printer;

  if (!printer) {
    item.status = 'failed';
    item.error = 'no printer bound (item or label)';
    item.finished_at = new Date();
    db.queue.update({_id: item._id}, item);
    push('updated', {item: item});
    return done();
  }

  var ip = printer.address.split(':')[0];
  var port = parseInt(printer.address.split(':')[1], 10);

  var isUsb = printer.conn === 'usb'; // usb: address = Windows printer name

  // printer status gate: an offline printer is skipped (its items stay
  // pending and are retried later) instead of pausing the whole queue, so the
  // other printers keep printing
  // (USB/spooler printers have no TCP port to probe: attempt the send directly)
  var gate = isUsb ? Promise.resolve(true) : probe(ip, port, 800);
  gate.then(function (online) {
    if (!online) {
      state.offline[target.key] = Date.now();
      push('printer_offline', {
        printer: printer.name,
        address: printer.address,
        item_id: item._id,
        job_id: item.job_id
      });
      console.log('[queue] printer offline, skipped: ' + printer.name + ' (' + printer.address + ')');
      return done();
    }
    delete state.offline[target.key];

    // ZPL source: an explicit override (reprint with the historical/edited
    // ZPL) wins, otherwise the label template is compiled at printer density
    var zpl;
    if (item.zpl_override) {
      zpl = substitute(item.zpl_override, item.data);
    } else {
      if (!label) {
        item.status = 'failed';
        item.error = 'label no longer exists';
        item.finished_at = new Date();
        db.queue.update({_id: item._id}, item);
        push('updated', {item: item});
        return done();
      }
      zpl = state.labelToZpl(label, printer);
      zpl = substitute(zpl, item.data);
    }

    item.status = 'processing';
    item.zpl_sent = zpl; // keep the actually printed ZPL for history/reprint
    db.queue.update({_id: item._id}, item);
    push('updated', {item: item});

    var sendP = isUsb
      ? usbPrint.sendZpl(printer.address, zpl)
      : sendZpl(ip, port, zpl);
    return sendP.then(function (r) {
      item.status = r.failed ? 'failed' : 'done';
      item.error = r.failed ? r.error : null;
      item.printer_name = printer.name;
      item.finished_at = new Date();
      db.queue.update({_id: item._id}, item);
      push('updated', {item: item});
      // small gap between labels so printers can keep up
      return new Promise(function (res) { setTimeout(res, 100); });
    }).then(function () {
      done();
    });
  }).catch(function (err) {
    console.log('[queue] item failed: ' + (err && err.message ? err.message : err));
    done();
  });
}

module.exports = {
  init: init,
  tick: tick,
  isPaused: function () { return state.paused; },
  pauseReason: function () { return state.pauseReason; },
  // jobs currently being sent, per printer (used by the queue page)
  activeJobs: function () {
    var out = [];
    Object.keys(state.active).forEach(function (k) {
      var it = state.active[k];
      out.push({printer_id: it.printer_id, job_id: it.job_id});
    });
    return out;
  },
  pause: function (reason) {
    state.paused = true;
    state.pauseReason = reason || 'paused by user';
    push('paused', {reason: state.pauseReason});
  },
  resume: function () {
    state.paused = false;
    state.pauseReason = null;
    state.offline = {}; // give every printer a fresh chance
    push('resumed', {});
    tick();
  },
  // drop one printer's offline cooldown (e.g. after it was re-found at a
  // new address): its pending items are probed again on the next tick
  clearOffline: function (printerId) {
    delete state.offline[printerId];
  }
};
