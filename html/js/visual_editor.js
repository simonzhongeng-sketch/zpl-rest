// Visual Template Editor component (used on the label editor page).
// mm-grid canvas, drag to move, property panel driven by the element
// registry. Templates are stored as JSON (all sizes in mm) and compiled
// to ZPL on the server per printer density (lib/zpl_compiler.js).
$(document).ready(function() {

  var SCALE = 4; // px per mm on the canvas

  // element type registry: editable properties + defaults (drives the
  // property panel and the canvas rendering)
  var REGISTRY = {
    text: {
      label: 'Text',
      props: {
        content:    { type: 'text',   def: 'Hello ${var}', title: 'Content (supports ${var})' },
        height_mm:  { type: 'number', def: 4,   step: 0.1, title: 'Font height (mm)' },
        width_mm:   { type: 'number', def: 0,   step: 0.1, title: 'Char width (mm, 0 = auto)' }
      }
    },
    barcode: {
      label: 'Barcode (Code128)',
      props: {
        content:     { type: 'text',   def: '${barcode}', title: 'Content (supports ${var})' },
        height_mm:   { type: 'number', def: 10,  step: 0.1, title: 'Bar height (mm)' },
        module_dots: { type: 'number', def: 2,   step: 1,   title: 'Module width (dots)' }
      }
    },
    qrcode: {
      label: 'QR Code',
      props: {
        content: { type: 'text',   def: '${qr}', title: 'Content (supports ${var})' },
        size_mm: { type: 'number', def: 10, step: 0.1, title: 'Approx. size (mm)' },
        ecc:     { type: 'select', def: 'M', title: 'Error correction',
                   options: [ { v: 'L', label: 'L (7%)' },
                              { v: 'M', label: 'M (15%)' },
                              { v: 'Q', label: 'Q (25%)' },
                              { v: 'H', label: 'H (30%)' } ] }
      }
    },
    box: {
      label: 'Box',
      props: {
        width_mm:     { type: 'number', def: 30,  step: 0.1, title: 'Width (mm)' },
        height_mm:    { type: 'number', def: 10,  step: 0.1, title: 'Height (mm)' },
        thickness_mm: { type: 'number', def: 0.5, step: 0.1, title: 'Line thickness (mm)' }
      }
    },
    line: {
      label: 'Line',
      props: {
        length_mm:    { type: 'number', def: 40,  step: 0.1, title: 'Length (mm)' },
        thickness_mm: { type: 'number', def: 0.5, step: 0.1, title: 'Thickness (mm)' }
      }
    },
    datamatrix: {
      label: 'DataMatrix',
      props: {
        content: { type: 'text',   def: '${dm}', title: 'Content (supports ${var})' },
        size_mm: { type: 'number', def: 8, step: 0.1, title: 'Approx. size (mm)' }
      }
    },
    code39: {
      label: 'Barcode (Code39)',
      props: {
        content:     { type: 'text',   def: '${code39}', title: 'Content (supports ${var})' },
        height_mm:   { type: 'number', def: 10,  step: 0.1, title: 'Bar height (mm)' },
        module_dots: { type: 'number', def: 2,   step: 1,   title: 'Module width (dots)' }
      }
    },
    text_rev: {
      label: 'Inverted Text',
      props: {
        content:   { type: 'text',   def: 'STOP', title: 'Content (supports ${var})' },
        height_mm: { type: 'number', def: 4,   step: 0.1, title: 'Font height (mm)' },
        width_mm:  { type: 'number', def: 25,  step: 0.1, title: 'Box width (mm)' }
      }
    },
    datetime: {
      label: 'Date / Time',
      props: {
        format:    { type: 'select', def: 'date', title: 'Format',
                     options: [ { v: 'date', label: 'Date (YYYY-MM-DD)' },
                                { v: 'time', label: 'Time (HH:MM)' },
                                { v: 'datetime', label: 'Date + Time' } ] },
        height_mm: { type: 'number', def: 4, step: 0.1, title: 'Font height (mm)' },
        width_mm:  { type: 'number', def: 0, step: 0.1, title: 'Char width (mm, 0 = auto)' }
      }
    },
    block: {
      label: 'Block Text',
      props: {
        content:   { type: 'text',   def: 'Wrapped text ${var}', title: 'Content (supports ${var})' },
        width_mm:  { type: 'number', def: 30, step: 0.1, title: 'Block width (mm)' },
        height_mm: { type: 'number', def: 3,  step: 0.1, title: 'Line height (mm)' },
        lines:     { type: 'number', def: 2,  step: 1,   title: 'Max lines' }
      }
    }
  };

  var state = {
    width_mm: 84.8,
    height_mm: 23.8,
    elements: [],      // { type, id, props }
    selected: null,    // element id
    nextId: 1,
    // 位置微调（页边距 + 打印偏移）：上/左边距与偏移合成标签级一条 ^LH，
    // 再叠加打印机设置里的「左侧位置 / 标签顶部位置」（基础原点
    // printer.settings.base_origin_mm）。右/下边距仅记录，永不进 ZPL。
    marginMm: { top: 0, right: 0, bottom: 0, left: 0 },
    offsetMm: { x: 0, y: 0 },
    // 纸带宽度（^PW 的 mm 值，仅多联/特殊纸宽的标签需要）
    rollWidthMm: 0
  };

  function round2(v) {
    return Math.round(v * 100) / 100;
  }
  // mm 数值兜底：非数字/NaN/Infinity 一律归 0，并保留 2 位小数
  function numMm(v) {
    var n = Number(v);
    return isFinite(n) ? round2(n) : 0;
  }

  var changeCbs = [];
  var selectCbs = [];   // fired whenever an element gets selected
  var canvas = $('#ve-canvas');
  var $props = $('#ve-props');
  var $vars = $('#ve-vars');

  function notify() {
    changeCbs.forEach(function (cb) {
      try { cb(); } catch (e) {}
    });
  }

  function notifySelect() {
    selectCbs.forEach(function (cb) {
      try { cb(); } catch (e) {}
    });
  }

  // ---------- template (de)serialization ----------

  function readPrintSettings() {
    var mode = $('#ve-mode').val();
    var ps = {};
    if (mode !== 'none') ps.mode = mode;
    var dark = parseFloat($('#ve-darkness').val());
    // keep 0 and negative offsets: 0 means "panel base", negative = lighter
    if (!isNaN(dark)) ps.darkness = dark;
    var speed = parseFloat($('#ve-speed').val());
    if (!isNaN(speed) && speed > 0) ps.speed = speed;
    var qty = parseInt($('#ve-quantity').val(), 10);
    if (!isNaN(qty) && qty > 0) ps.quantity = qty;
    return ps;
  }

  function getTemplate() {
    var t = {
      elements: state.elements.map(function (el) {
        return { type: el.type, props: $.extend({}, el.props) };
      }),
      print_settings: readPrintSettings()
    };
    // page = 位置微调 + 纸宽。全零且无纸宽的 page 不写进模板，存量/新建
    // 标签保持干净的 JSON（后端 isEmptyPage 同样会丢弃空 page）
    var page = {
      margin_mm: {
        top: round2(state.marginMm.top),
        right: round2(state.marginMm.right),
        bottom: round2(state.marginMm.bottom),
        left: round2(state.marginMm.left)
      },
      offset_mm: { x: round2(state.offsetMm.x), y: round2(state.offsetMm.y) }
    };
    if (state.rollWidthMm > 0) page.roll_width_mm = state.rollWidthMm;
    var mg = page.margin_mm, of = page.offset_mm;
    if (page.roll_width_mm || mg.top || mg.right || mg.bottom || mg.left || of.x || of.y) {
      t.page = page;
    }
    return t;
  }

  function loadTemplate(t) {
    state.elements = (t.elements || []).map(function (el, i) {
      return { type: el.type, id: 'e' + (i + 1), props: $.extend({}, el.props || {}) };
    });
    state.nextId = state.elements.length + 1;
    state.selected = null;
    // page：页边距 / 偏移 / 纸宽全部带回编辑器
    var p = (t.page && typeof t.page === 'object') ? t.page : {};
    var m = (p.margin_mm && typeof p.margin_mm === 'object') ? p.margin_mm : {};
    var o = (p.offset_mm && typeof p.offset_mm === 'object') ? p.offset_mm : {};
    state.marginMm = {
      top: Math.max(0, numMm(m.top)),
      right: Math.max(0, numMm(m.right)),
      bottom: Math.max(0, numMm(m.bottom)),
      left: Math.max(0, numMm(m.left))
    };
    state.offsetMm = { x: numMm(o.x), y: numMm(o.y) };
    var rw = numMm(p.roll_width_mm);
    state.rollWidthMm = rw > 0 ? rw : 0;
    var ps = t.print_settings || {};
    // new labels default to thermal transfer (ribbon); saved labels keep
    // whatever mode they were stored with
    $('#ve-mode').val(ps.mode === 'direct_thermal' ? 'direct_thermal' : (ps.mode === 'none' ? 'none' : 'thermal_transfer'));
    $('#ve-darkness').val(typeof ps.darkness === 'number' ? ps.darkness : 0);
    $('#ve-speed').val(typeof ps.speed === 'number' ? ps.speed : 2);
    $('#ve-quantity').val(typeof ps.quantity === 'number' ? ps.quantity : 1);
    renderAll();
  }

  // ---------- rendering ----------

  function renderAll() {
    renderCanvas();
    renderProps();
    renderVars();
    notify();
  }

  // format helper shared with the datetime element (canvas preview)
  function formatDateTime(fmt) {
    var n = new Date();
    function pad(v) { return (v < 10 ? '0' : '') + v; }
    var d = n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate());
    var t = pad(n.getHours()) + ':' + pad(n.getMinutes());
    if (fmt === 'time') return t;
    if (fmt === 'datetime') return d + ' ' + t;
    return d;
  }

  // mm rulers: 1/5/10mm ticks come from CSS gradients (4px = 1mm), the
  // numbers are rebuilt here so they follow the label size
  function renderRulers() {
    var w = Math.round(state.width_mm * SCALE);
    var h = Math.round(state.height_mm * SCALE);
    var $top = $('#ve-ruler-top');
    var $left = $('#ve-ruler-left');
    $top.css({ width: w + 'px' }).empty();
    $left.css({ height: h + 'px' }).empty();
    var x, y;
    for (x = 0; x <= Math.floor(state.width_mm / 10) * 10; x += 10) {
      $top.append($('<span/>').css({ left: (x * SCALE) + 'px' }).text(x));
    }
    for (y = 0; y <= Math.floor(state.height_mm / 10) * 10; y += 10) {
      $left.append($('<span/>').css({ top: (y * SCALE) + 'px' }).text(y));
    }
  }

  // the canvas is exactly the label: no paper web, no inner box, no origin
  // marker. Rulers start at 0 = the physical label corner, and every square
  // millimetre of it can hold an element.
  function renderCanvas() {
    canvas.css({ width: (state.width_mm * SCALE) + 'px', height: (state.height_mm * SCALE) + 'px' });
    canvas.empty();
    renderRulers();

    state.elements.forEach(function (el) {
      var p = el.props;
      var $el = $('<div/>')
        .attr('data-id', el.id)
        .css({
          position: 'absolute',
          left: ((p.x_mm || 0) * SCALE) + 'px',
          top: ((p.y_mm || 0) * SCALE) + 'px',
          cursor: 'move',
          boxSizing: 'border-box'
        });

      // canvas approximation of ZPL field rotation (N=0, R=90, I=180, B=270)
      var rotDeg = { N: 0, R: 90, I: 180, B: 270 }[p.rotation] || 0;
      if (rotDeg) $el.css({ transform: 'rotate(' + rotDeg + 'deg)', transformOrigin: 'center center' });

      switch (el.type) {
        case 'text':
          $el.css({
            fontSize: Math.max(4, (p.height_mm || 4) * SCALE) + 'px',
            lineHeight: 1.1,
            whiteSpace: 'nowrap',
            fontFamily: 'monospace'
          }).text(p.content || '');
          break;
        case 'barcode':
          $el.css({
            width: Math.max(20, (p.content || '').length * 1.2 * SCALE * (p.module_dots || 2) / 2) + 'px',
            height: (p.height_mm || 10) * SCALE + 'px',
            background: 'repeating-linear-gradient(90deg, #000 0 2px, #fff 2px 4px)',
            border: '1px dashed #999'
          });
          $el.append($('<div/>').css({
            position: 'absolute', bottom: '-1.1em', left: 0, fontSize: '10px',
            whiteSpace: 'nowrap'
          }).text(p.content || ''));
          break;
        case 'qrcode':
          $el.css({
            width: (p.size_mm || 10) * SCALE + 'px',
            height: (p.size_mm || 10) * SCALE + 'px',
            background: '#666',
            color: '#fff', textAlign: 'center', lineHeight: (p.size_mm || 10) * SCALE + 'px',
            fontSize: '10px'
          }).text('QR');
          break;
        case 'box':
          $el.css({
            width: (p.width_mm || 10) * SCALE + 'px',
            height: (p.height_mm || 10) * SCALE + 'px',
            border: Math.max(1, (p.thickness_mm || 0.5) * SCALE) + 'px solid #333'
          });
          break;
        case 'line':
          $el.css({
            width: (p.length_mm || 40) * SCALE + 'px',
            height: Math.max(1, (p.thickness_mm || 0.5) * SCALE) + 'px',
            background: '#333'
          });
          break;
        case 'datamatrix':
          $el.css({
            width: (p.size_mm || 8) * SCALE + 'px',
            height: (p.size_mm || 8) * SCALE + 'px',
            background: '#666',
            color: '#fff', textAlign: 'center', lineHeight: (p.size_mm || 8) * SCALE + 'px',
            fontSize: '10px'
          }).text('DM');
          break;
        case 'code39':
          $el.css({
            width: Math.max(20, (p.content || '').length * 1.6 * SCALE * (p.module_dots || 2) / 2) + 'px',
            height: (p.height_mm || 10) * SCALE + 'px',
            background: 'repeating-linear-gradient(90deg, #000 0 2px, #fff 2px 5px)',
            border: '1px dashed #999'
          });
          $el.append($('<div/>').css({
            position: 'absolute', bottom: '-1.1em', left: 0, fontSize: '10px',
            whiteSpace: 'nowrap'
          }).text(p.content || ''));
          break;
        case 'text_rev':
          $el.css({
            width: (p.width_mm || 25) * SCALE + 'px',
            background: '#000',
            color: '#fff',
            fontSize: Math.max(4, (p.height_mm || 4) * SCALE) + 'px',
            lineHeight: 1.1,
            whiteSpace: 'nowrap',
            fontFamily: 'monospace',
            padding: '1px 2px'
          }).text(p.content || '');
          break;
        case 'datetime':
          $el.css({
            fontSize: Math.max(4, (p.height_mm || 4) * SCALE) + 'px',
            lineHeight: 1.1,
            whiteSpace: 'nowrap',
            fontFamily: 'monospace'
          }).text(formatDateTime(p.format));
          break;
        case 'block':
          $el.css({
            width: (p.width_mm || 30) * SCALE + 'px',
            fontSize: Math.max(4, (p.height_mm || 3) * SCALE) + 'px',
            lineHeight: 1.2,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'monospace'
          }).text(p.content || '');
          break;
      }

      if (state.selected === el.id) {
        $el.css({ outline: '2px solid #4e73df', outlineOffset: '1px' });
      }

      $el.on('mousedown', function (ev) {
        ev.stopPropagation();
        selectElement(el.id);
        startDrag(el.id, ev);
      });

      canvas.append($el);
    });
  }

  function renderProps() {
    $props.empty();
    var el = currentElement();
    if (!el) {
      $props.html('<p class="text-muted">Select an element on the canvas, or add one.</p>');
      return;
    }
    var reg = REGISTRY[el.type];
    var $form = $('<div/>');

    $form.append($('<p/>').html('<span class="badge badge-primary">' + reg.label + '</span> <small class="text-muted">#' + el.id + '</small>'));

    ['x_mm', 'y_mm'].forEach(function (key) {
      $form.append(makePropInput(el, key, {
        type: 'number', step: 0.1, title: key === 'x_mm' ? 'X position (mm)' : 'Y position (mm)'
      }));
    });

    // rotation applies to every element (ZPL N/R/I/B = 0/90/180/270)
    $form.append(makePropInput(el, 'rotation', {
      type: 'select', def: 'N', title: 'Rotation',
      options: [ { v: 'N', label: '0\u00B0' }, { v: 'R', label: '90\u00B0' },
                 { v: 'I', label: '180\u00B0' }, { v: 'B', label: '270\u00B0' } ]
    }));

    Object.keys(reg.props).forEach(function (key) {
      $form.append(makePropInput(el, key, reg.props[key]));
    });

    $props.append($form);
  }

  function makePropInput(el, key, conf) {
    var $g = $('<div class="form-group"/>');
    $g.append('<label for="ve-prop-' + key + '">' + conf.title + '</label>');
    var $in;
    if (conf.type === 'select') {
      $in = $('<select class="form-control" id="ve-prop-' + key + '"/>');
      (conf.options || []).forEach(function (o) {
        $in.append($('<option/>').val(o.v).text(o.label));
      });
      $in.val(el.props[key] !== undefined ? el.props[key] : conf.def);
      $in.on('change', function () {
        el.props[key] = $in.val();
        renderCanvas();
        renderVars();
        notify();
      });
    } else {
      $in = $('<input class="form-control" id="ve-prop-' + key + '"/>')
        .attr('type', conf.type === 'number' ? 'number' : 'text')
        .attr('step', conf.step || (conf.type === 'number' ? 1 : null))
        .val(el.props[key] !== undefined ? el.props[key] : conf.def);
      $in.on('input', function () {
        var v = conf.type === 'number' ? parseFloat($in.val()) || 0 : $in.val();
        // position stays inside the physical label (same clamp as dragging)
        if (key === 'x_mm') v = Math.max(0, Math.min(state.width_mm, v));
        if (key === 'y_mm') v = Math.max(0, Math.min(state.height_mm, v));
        el.props[key] = v;
        renderCanvas();
        renderVars();
        notify();
      });
    }
    $g.append($in);
    return $g;
  }

  function renderVars() {
    var vars = getVariables();
    if (!vars.length) {
      $vars.html('<span class="text-muted">none</span>');
    } else {
      $vars.empty();
      vars.forEach(function (v) {
        $vars.append($('<span class="badge badge-info mr-1 mb-1"/>').text(v));
      });
    }
  }

  // ---------- selection / drag ----------

  function currentElement() {
    return state.elements.find(function (e) { return e.id === state.selected; }) || null;
  }

  function selectElement(id) {
    state.selected = id;
    renderCanvas();
    renderProps();
    notifySelect();
  }

  function startDrag(id, ev) {
    var el = state.elements.find(function (e) { return e.id === id; });
    if (!el) return;
    var startX = ev.pageX, startY = ev.pageY;
    var origX = el.props.x_mm || 0, origY = el.props.y_mm || 0;
    var moved = false;

    function onMove(e) {
      var dx = (e.pageX - startX) / SCALE;
      var dy = (e.pageY - startY) / SCALE;
      if (Math.abs(e.pageX - startX) + Math.abs(e.pageY - startY) > 3) moved = true;
      el.props.x_mm = Math.max(0, Math.min(state.width_mm, origX + dx));
      el.props.y_mm = Math.max(0, Math.min(state.height_mm, origY + dy));
      renderCanvas();
    }
    function onUp() {
      $(document).off('mousemove', onMove).off('mouseup', onUp);
      if (moved) {
        renderProps();
        notify();
      }
    }
    $(document).on('mousemove', onMove).on('mouseup', onUp);
  }

  canvas.on('mousedown', function () {
    state.selected = null;
    renderCanvas();
    renderProps();
  });

  // ---------- actions ----------

  $('.ve-add').click(function () {
    var type = $(this).data('type');
    var reg = REGISTRY[type];
    // new elements land at 5,5, clamped so a tiny label still gets a valid spot
    var px = Math.min(5, Math.max(0, state.width_mm - 1));
    var py = Math.min(5, Math.max(0, state.height_mm - 1));
    var props = { x_mm: round2(px), y_mm: round2(py) };
    Object.keys(reg.props).forEach(function (k) { props[k] = reg.props[k].def; });
    var el = { type: type, id: 'e' + (state.nextId++), props: props };
    state.elements.push(el);
    selectElement(el.id);
    notify();
  });

  $('#ve-delete').click(function () {
    if (!state.selected) { toastr.info(t('le.props_select')); return; }
    state.elements = state.elements.filter(function (e) { return e.id !== state.selected; });
    state.selected = null;
    renderAll();
  });

  ['ve-mode', 've-darkness', 've-speed', 've-quantity'].forEach(function (id) {
    $('#' + id).on('input change', notify);
  });

  $('#ve-export').click(function () {
    var out = {
      type: 'visual',
      template: getTemplate(),
      variables: getVariables()
    };
    var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'template.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // ---------- variables ----------

  function getVariables() {
    var vars = [];
    var reg = /\$\{([^}]+)\}/g;
    state.elements.forEach(function (el) {
      var c = el.props.content;
      if (typeof c !== 'string') return;
      var m;
      reg.lastIndex = 0;
      while ((m = reg.exec(c)) !== null) {
        if (vars.indexOf(m[1]) === -1) vars.push(m[1]);
      }
    });
    return vars;
  }

  // ---------- public API ----------

  window.visualEditorApi = {
    load: function (template) { loadTemplate(template || {}); },
    getTemplate: getTemplate,
    getVariables: getVariables,
    setCanvasSize: function (w, h) {
      state.width_mm = w || 84.8;
      state.height_mm = h || 23.8;
      renderCanvas();
    },
    // 位置微调：标签页的六个输入（4 边距 + X/Y 偏移）通过 setPage 推进
    // 编辑器状态，保存时由 getTemplate 写回 template.page
    setPage: function (page) {
      var p = (page && typeof page === 'object') ? page : {};
      var m = (p.margin_mm && typeof p.margin_mm === 'object') ? p.margin_mm : {};
      var o = (p.offset_mm && typeof p.offset_mm === 'object') ? p.offset_mm : {};
      state.marginMm = {
        top: Math.max(0, numMm(m.top)),
        right: Math.max(0, numMm(m.right)),
        bottom: Math.max(0, numMm(m.bottom)),
        left: Math.max(0, numMm(m.left))
      };
      state.offsetMm = { x: numMm(o.x), y: numMm(o.y) };
      if (p.roll_width_mm !== undefined) {
        var rw = numMm(p.roll_width_mm);
        state.rollWidthMm = rw > 0 ? rw : 0;
      }
      // 不触发 onChange：位置上没有元素属性变化，重建变量输入会打断用户
      // 正在填写的输入框
    },
    getPage: function () {
      var page = {
        margin_mm: $.extend({}, state.marginMm),
        offset_mm: $.extend({}, state.offsetMm)
      };
      if (state.rollWidthMm > 0) page.roll_width_mm = state.rollWidthMm;
      return page;
    },
    clear: function () {
      state.elements = [];
      state.selected = null;
      state.nextId = 1;
      state.marginMm = { top: 0, right: 0, bottom: 0, left: 0 };
      state.offsetMm = { x: 0, y: 0 };
      state.rollWidthMm = 0;
      renderAll();
    },
    onChange: function (cb) { changeCbs.push(cb); },
    onSelect: function (cb) { selectCbs.push(cb); }
  };
});
