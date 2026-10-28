// MCP (Model Context Protocol) server for zpl-rest.
//
// Lets AI tools (WorkBuddy, Claude, Cursor, ...) drive the printing service:
// manage labels and printers, render previews, enqueue/print, watch the queue.
//
// Transport: Streamable HTTP at http://<host>:<mcp_port>/mcp
// Auth:      Authorization: Bearer <mcp_token>   (token is generated into
//            config.json on first start if not configured)
//
// The MCP server does not touch the database itself: every tool calls the
// existing REST endpoints on the local loopback, so MCP behaviour is always
// identical to the web UI (same validation, same side effects, same events).

const express = require('express');
// NOTE: required via the concrete dist/cjs files instead of the package
// exports map (@modelcontextprotocol/sdk/server/mcp.js): pkg's bundler cannot
// follow the SDK's wildcard exports, and Node's exports mapping double-resolves
// direct dist paths. The relative path works in dev and in the packaged exe.
const { McpServer } = require('./node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js');
const { StreamableHTTPServerTransport } = require('./node_modules/@modelcontextprotocol/sdk/dist/cjs/server/streamableHttp.js');
const { z } = require('zod');
const ConfigHandler = require('./lib/config.js');
// config.json lives next to the exe when packaged (see lib/approot.js)
const APP_ROOT = require('./lib/approot.js');

// ---------------------------------------------------------------------------
// configuration: mcp_port. Auth is OFF by default (empty mcp_token = open
// access); setting "mcp_token": "<secret>" in config.json enables Bearer auth.
// ---------------------------------------------------------------------------
function ensureMcpConfig() {
  var cfg = ConfigHandler.getConfig();
  if (cfg.mcp_port) return cfg;

  // first start: persist the port so it is visible/editable in config.json
  var onDisk = {};
  try { onDisk = JSON.parse(require('fs').readFileSync(APP_ROOT + '/config.json', 'utf8')); } catch (e) {}
  onDisk.mcp_port = cfg.mcp_port || 18422;
  if (!('mcp_token' in onDisk)) onDisk.mcp_token = cfg.mcp_token || "";
  require('fs').writeFileSync(APP_ROOT + '/config.json', JSON.stringify(onDisk, null, 2) + '\n');
  cfg.mcp_port = onDisk.mcp_port;
  return cfg;
}

// ---------------------------------------------------------------------------
// REST client (loopback calls into the existing service)
// ---------------------------------------------------------------------------
var cfg = ensureMcpConfig();
var REST = 'http://127.0.0.1:' + (cfg.port || 18420);

function callRest(method, path, body) {
  return fetch(REST + path, {
    method: method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  }).then(function (r) {
    return r.text().then(function (text) {
      var data = text;
      try { data = JSON.parse(text); } catch (e) { /* plain text (error) response */ }
      if (!r.ok) {
        throw new Error('REST ' + r.status + ': ' + (typeof data === 'string' ? data : JSON.stringify(data)));
      }
      return data;
    });
  });
}

function jsonResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

// ---------------------------------------------------------------------------
// tool registration
// ---------------------------------------------------------------------------
function buildServer() {
  var server = new McpServer({ name: 'zpl-rest', version: '1.0.0' });

  // ---- labels ----
  server.registerTool('list_labels', {
    description: 'List all label templates (id, name, size in mm, type, bound printer).',
    inputSchema: {}
  }, function () {
    return callRest('GET', '/rest/label').then(jsonResult);
  });

  server.registerTool('get_label', {
    description: 'Get one label template by id: full record including ZPL code and its variable names (${var} / {{var}} placeholders).',
    inputSchema: z.object({ id: z.string().describe('label id (from list_labels)') })
  }, function (args) {
    return Promise.all([
      callRest('GET', '/rest/label').then(function (list) {
        var l = list.find(function (x) { return x._id === args.id; });
        if (!l) throw new Error('label not found: ' + args.id);
        return l;
      }),
      callRest('GET', '/rest/label/variables/' + args.id).catch(function () { return { variables: [] }; })
    ]).then(function (r) { return jsonResult({ label: r[0], variables: r[1].variables }); });
  });

  server.registerTool('create_label', {
    description: 'Create a label template. Width/height in millimetres. ZPL template may contain ${var} or {{var}} placeholders.',
    inputSchema: z.object({
      name: z.string().describe('display name'),
      width_mm: z.number().positive().describe('label width in mm'),
      height_mm: z.number().positive().describe('label height in mm'),
      zpl: z.string().describe('ZPL template code, e.g. ^XA ... ^XZ'),
      printer_id: z.string().optional().describe('optional printer id to bind')
    })
  }, function (args) {
    return callRest('POST', '/rest/label', {
      name: args.name, width: args.width_mm, height: args.height_mm,
      zpl: args.zpl, printer_id: args.printer_id
    }).then(jsonResult);
  });

  server.registerTool('update_label', {
    description: 'Update fields of an existing label template (merge: only given fields change).',
    inputSchema: z.object({
      id: z.string(),
      name: z.string().optional(),
      width_mm: z.number().positive().optional(),
      height_mm: z.number().positive().optional(),
      zpl: z.string().optional(),
      printer_id: z.string().nullable().optional()
    })
  }, function (args) {
    return callRest('GET', '/rest/label').then(function (list) {
      var l = list.find(function (x) { return x._id === args.id; });
      if (!l) throw new Error('label not found: ' + args.id);
      if (args.name !== undefined) l.name = args.name;
      if (args.width_mm !== undefined) l.width = args.width_mm;
      if (args.height_mm !== undefined) l.height = args.height_mm;
      if (args.zpl !== undefined) l.zpl = args.zpl;
      if (args.printer_id !== undefined) l.printer_id = args.printer_id;
      return callRest('POST', '/rest/label', l);
    }).then(jsonResult);
  });

  server.registerTool('delete_label', {
    description: 'Delete a label template by id.',
    inputSchema: z.object({ id: z.string() })
  }, function (args) {
    return callRest('DELETE', '/rest/label/' + args.id).then(jsonResult);
  });

  // ---- previews ----
  server.registerTool('render_preview', {
    description: 'Render arbitrary ZPL code to a PNG image (local renderer, no cloud). Width/height in mm, dpmm = printer resolution in dots per mm (8 = 203 dpi).',
    inputSchema: z.object({
      zpl: z.string().describe('complete ZPL code ^XA...^XZ'),
      width_mm: z.number().positive(),
      height_mm: z.number().positive(),
      dpmm: z.number().int().min(2).max(24).optional().describe('dots per mm, default 8 (203 dpi)')
    })
  }, function (args) {
    return require('zpl-renderer-js').ready.then(function (ready) {
      return ready.api.zplToBase64Async(args.zpl, args.width_mm, args.height_mm, args.dpmm || 8);
    }).then(function (b64) {
      return { content: [{ type: 'image', data: b64, mimeType: 'image/png' }] };
    });
  });

  // resolve a printer for a label: explicit argument, else the printer bound
  // to the label (REST endpoints need a printer id for density/settings)
  function resolvePrinterId(labelId, printerId) {
    if (printerId) return Promise.resolve(printerId);
    return callRest('GET', '/rest/label').then(function (labels) {
      var label = (labels || []).find(function (l) { return l._id === labelId; });
      if (!label) throw new Error('label not found: ' + labelId);
      if (!label.printer_id) throw new Error('label "' + label.name + '" has no printer bound and no printer_id was given');
      return label.printer_id;
    });
  }

  server.registerTool('label_preview', {
    description: 'Render the preview of a stored label template (optionally with variable data substituted) to a PNG image.',
    inputSchema: z.object({
      label_id: z.string(),
      printer_id: z.string().optional().describe('printer whose density is used; defaults to the printer bound to the label'),
      data: z.record(z.string(), z.string()).optional().describe('variable values for ${var} placeholders')
    })
  }, function (args) {
    return resolvePrinterId(args.label_id, args.printer_id).then(function (printerId) {
      var body = { label: args.label_id, printer: printerId, data: args.data };
      return callRest('POST', '/rest/preview', body).then(function (r) {
        return { content: [{ type: 'image', data: r.img, mimeType: 'image/png' }] };
      });
    });
  });

  // ---- printers ----
  server.registerTool('list_printers', {
    description: 'List all configured printers (id, name, ip:port, model, density, print settings).',
    inputSchema: {}
  }, function () {
    return callRest('GET', '/rest/printer').then(jsonResult);
  });

  server.registerTool('printer_status', {
    description: 'Probe every printer (TCP connect) and return {printer_id: online} booleans.',
    inputSchema: {}
  }, function () {
    return callRest('GET', '/rest/printer/status').then(jsonResult);
  });

  // ---- printing ----
  server.registerTool('print_label', {
    description: 'Print a label immediately (bypasses the queue): renders the template with the given variable data and sends the ZPL to the printer.',
    inputSchema: z.object({
      label_id: z.string(),
      printer_id: z.string().optional().describe('defaults to the printer bound to the label'),
      data: z.record(z.string(), z.string()).optional().describe('variable values'),
      copies: z.number().int().min(1).max(1000).optional().describe('print the same job N times, default 1')
    })
  }, function (args) {
    var copies = args.copies || 1;
    return resolvePrinterId(args.label_id, args.printer_id).then(function (printerId) {
      var body = { label: args.label_id, printer: printerId, data: args.data || {} };
      var chain = Promise.resolve();
      var results = [];
      for (var i = 0; i < copies; i++) {
        chain = chain.then(function () {
          return callRest('POST', '/rest/print', body).then(function (job) {
            results.push({ job_id: job._id, label: job.label_name, printer: job.printer_name, status: job.status });
          });
        });
      }
      return chain.then(function () { return jsonResult({ printed: results.length, jobs: results }); });
    });
  });

  server.registerTool('enqueue_print', {
    description: 'Add a print job to the print queue (processed one by one; fails are retriable).',
    inputSchema: z.object({
      label_id: z.string(),
      printer_id: z.string().optional().describe('required when the label has no bound printer'),
      data: z.record(z.string(), z.string()).optional().describe('variable values')
    })
  }, function (args) {
    return callRest('POST', '/rest/queue/add', {
      label_id: args.label_id, printer_id: args.printer_id, data: args.data || {}
    }).then(jsonResult);
  });

  // ---- queue ----
  server.registerTool('list_queue', {
    description: 'Current print queue: paused flag, unfinished items (pending/processing/failed) and finished history, newest first.',
    inputSchema: {}
  }, function () {
    return callRest('GET', '/rest/queue').then(jsonResult);
  });

  server.registerTool('pause_queue', {
    description: 'Pause the print queue (no jobs are sent to printers until resumed).',
    inputSchema: {}
  }, function () {
    return callRest('POST', '/rest/queue/pause', {}).then(jsonResult);
  });

  server.registerTool('resume_queue', {
    description: 'Resume the print queue.',
    inputSchema: {}
  }, function () {
    return callRest('POST', '/rest/queue/resume', {}).then(jsonResult);
  });

  server.registerTool('retry_failed', {
    description: 'Requeue failed print jobs: all of them, or only the given queue item ids.',
    inputSchema: z.object({
      ids: z.array(z.string()).optional().describe('queue item ids; omit to retry all failed')
    })
  }, function (args) {
    return callRest('POST', '/rest/queue/retry', { ids: args.ids }).then(jsonResult);
  });

  server.registerTool('delete_queue_items', {
    description: 'Delete queue items: by ids, or by status ("done" / "failed" / "items" = unfinished / "all"). Processing items are never deleted.',
    inputSchema: z.object({
      ids: z.array(z.string()).optional(),
      status: z.enum(['done', 'failed', 'items', 'all']).optional()
    })
  }, function (args) {
    return callRest('POST', '/rest/queue/delete', { ids: args.ids, status: args.status }).then(jsonResult);
  });

  return server;
}

// ---------------------------------------------------------------------------
// HTTP transport (stateless streamable HTTP, one server instance per request)
// ---------------------------------------------------------------------------
function start() {
  var app = express();
  app.use(express.json());

  // bearer token auth for everything below; disabled entirely when
  // config.json has an empty mcp_token (open access, e.g. localhost use)
  if (cfg.mcp_token) {
    app.use(function (req, res, next) {
      var auth = req.headers.authorization || '';
      if (auth !== 'Bearer ' + cfg.mcp_token) {
        return res.status(401).json({ error: 'unauthorized: send "Authorization: Bearer <mcp_token>"' });
      }
      next();
    });
  }

  app.post('/mcp', function (req, res) {
    var server = buildServer();
    var transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true
    });
    res.on('close', function () {
      transport.close();
      server.close();
    });
    server.connect(transport).then(function () {
      return transport.handleRequest(req, res, req.body);
    }).catch(function (err) {
      console.error((new Date()) + ' MCP request failed:', err);
      if (!res.headersSent) res.status(500).json({ error: 'internal MCP error' });
    });
  });

  // stateless mode: no sessions to read or terminate
  app.get('/mcp', function (req, res) {
    res.status(405).json({ error: 'GET not supported (stateless mode)' });
  });
  app.delete('/mcp', function (req, res) {
    res.status(405).json({ error: 'DELETE not supported (stateless mode)' });
  });

  var bind = cfg.public ? undefined : 'localhost';
  var mcpServer = app.listen(cfg.mcp_port, bind, function () {
    console.log((new Date()) + ' MCP is listening on port ' + cfg.mcp_port +
      ' (Bearer token in config.json -> mcp_token)');
  });
  // a busy MCP port must not take the whole service down (AI access degrades,
  // REST/UI/printing keep working)
  mcpServer.on('error', function (err) {
    try {
      const crashLog = require('./lib/crashlog.js');
      crashLog.log('mcp listen failed', err);
    } catch (e) { console.error('mcp listen failed: ' + (err && err.message)); }
  });
}

module.exports = { start: start };
