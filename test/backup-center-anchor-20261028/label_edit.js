// Label editor page: label info (name/size/type/bound printer), visual or
// raw ZPL design, variable inputs, preview and test print.
$(document).ready(function() {

  var params = new URLSearchParams(location.search);
  var state = {
    id: params.get('id'),     // null = new label
    type: 'visual',
    printers: {}
  };

  if (state.id) {
    $('#edit-type-group').hide(); // type is fixed once saved
  }

  // ---------- random name for new labels ----------

  function randomLabelName() {
    var d = new Date();
    var pad = function(n) { return (n < 10 ? '0' : '') + n; };
    var stamp = '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
                pad(d.getHours()) + pad(d.getMinutes());
    var rand = Math.random().toString(36).slice(2, 5).toUpperCase();
    return 'LBL-' + stamp + '-' + rand;
  }

  // ---------- loading ----------

  loadPrinters(function() {
    if (state.id) {
      loadLabel();
    } else {
      $('#edit-name').val(randomLabelName()); // suggest a unique name
      applyType();
      fillPageInputs(null); // 新标签的位置微调全部为 0
      updatePageInfo();
      rebuildVars();
    }
  });

  function loadPrinters(cb) {
    $.getJSON('/rest/printer', function(list) {
      var $sel = $('#edit-printer').empty();
      $sel.append('<option value="">' + t('le.select_printer') + '</option>');
      list.forEach(function(p) {
        state.printers[p._id] = p;
        $sel.append($('<option/>').val(p._id).text(p.name + ' (' + p.address + ')'));
      });
      cb();
    });
  }

  // print settings follow the bound printer: picking a printer copies its
  // calibrated mode/darkness/speed into the label info card, so a label never
  // starts from a stale or generic value
  function applyPrinterSettings(pid, silent) {
    var p = state.printers[pid];
    var s = p && p.settings;
    if (!s) return false;
    $('#ve-mode').val(s.mode === 'direct_thermal' ? 'direct_thermal' : 'thermal_transfer');
    if (typeof s.darkness === 'number') $('#ve-darkness').val(s.darkness);
    if (typeof s.speed === 'number') $('#ve-speed').val(s.speed);
    // let the editor persist the new values into template.print_settings
    $('#ve-mode, #ve-darkness, #ve-speed').trigger('change');
    if (!silent) toastr.info(t('le.print_from_printer') + ' ' + p.name);
    return true;
  }

  $('#edit-printer').on('change', function() {
    applyPrinterSettings($(this).val());
    window.visualEditorApi.setDensity(printerDensity());
    updatePageInfo(); // 徽标里的 ^LH 依赖该机的密度与基础原点
  });

  // ---------- page geometry (page margins + print offset) ----------
  //
  // 契约：元素 x_mm/y_mm 永远相对标签物理左上角，整张标签都是可布置区域。
  // 页边距/偏移只是打印位置的微调——左边距 + X 偏移、上边距 + Y 偏移合成
  // 标签级一条 ^LH，再叠加打印机设置里的「左侧位置 / 标签顶部位置」
  // （基础原点 printer.settings.base_origin_mm，默认 1.5 / 0.8mm = ^LH18,10
  // @12dpmm，填 {0,0} 可关掉）。右/下边距仅作记录，永不进 ZPL。
  // 服务端 lib/page_geometry.js 是权威，这里只镜像钳位，好给出可读提示而不是
  // 原始 400；预览不体现这层偏移（见 main.js getPreview）。

  // 与 main.js 的 DEFAULT_BASE_ORIGIN_MM 保持一致
  var DEFAULT_BASE_ORIGIN_MM = { x: 1.5, y: 0.8 };

  function labelWidth() {
    return parseFloat($('#edit-width').val()) || 84.8;
  }
  function labelHeight() {
    return parseFloat($('#edit-height').val()) || 23.8;
  }
  // 徽标显示的是点，需要绑定打印机的 dpmm
  function printerDensity() {
    var p = state.printers[$('#edit-printer').val()];
    return parseInt(p && p.density, 10) || 12;
  }
  // 该机的基础原点：显式配置优先（含 {0,0}），否则用默认值
  function printerBaseOrigin() {
    var p = state.printers[$('#edit-printer').val()];
    var b = (p && p.settings && p.settings.base_origin_mm) || {};
    var x = parseFloat(b.x);
    var y = parseFloat(b.y);
    return {
      x: isFinite(x) ? x : DEFAULT_BASE_ORIGIN_MM.x,
      y: isFinite(y) ? y : DEFAULT_BASE_ORIGIN_MM.y
    };
  }
  function round2(v) { return Math.round(v * 100) / 100; }
  function clamp(v, lim) { return Math.max(-lim, Math.min(lim, v)); }
  function pageLimit(sizeMm) { return Math.min(20, sizeMm / 4); }

  function readPageInputs() {
    function numVal(sel) {
      var v = parseFloat($(sel).val());
      return isNaN(v) ? 0 : v;
    }
    return {
      margin_mm: {
        top: Math.max(0, numVal('#ve-margin-top')),
        right: Math.max(0, numVal('#ve-margin-right')),
        bottom: Math.max(0, numVal('#ve-margin-bottom')),
        left: Math.max(0, numVal('#ve-margin-left'))
      },
      offset_mm: { x: numVal('#ve-offset-x'), y: numVal('#ve-offset-y') }
    };
  }

  function fillPageInputs(page) {
    var p = page || {};
    var m = p.margin_mm || {};
    var o = p.offset_mm || {};
    $('#ve-margin-top').val(typeof m.top === 'number' ? m.top : 0);
    $('#ve-margin-right').val(typeof m.right === 'number' ? m.right : 0);
    $('#ve-margin-bottom').val(typeof m.bottom === 'number' ? m.bottom : 0);
    $('#ve-margin-left').val(typeof m.left === 'number' ? m.left : 0);
    $('#ve-offset-x').val(typeof o.x === 'number' ? o.x : 0);
    $('#ve-offset-y').val(typeof o.y === 'number' ? o.y : 0);
  }

  // 六个输入推进编辑器状态（偏移按物理上限钳位：20mm 或标签尺寸的 1/4，取小）
  function applyPageInputs() {
    var p = readPageInputs();
    p.offset_mm.x = round2(clamp(p.offset_mm.x, pageLimit(labelWidth())));
    p.offset_mm.y = round2(clamp(p.offset_mm.y, pageLimit(labelHeight())));
    window.visualEditorApi.setPage(p);
    updatePageInfo();
  }

  // 只读反馈：实际会发出的那条 ^LH（标签位移 + 该机基础原点）
  function updatePageInfo() {
    if (!window.visualEditorApi) return;
    if (!$('#edit-printer').val()) {
      $('#ve-lh-badge').text('^LH —');
      return;
    }
    var w = labelWidth();
    var h = labelHeight();
    var page = window.visualEditorApi.getPage();
    var m = page.margin_mm;
    var o = page.offset_mm;
    var sx = round2(clamp(round2(m.left + o.x), pageLimit(w)));
    var sy = round2(clamp(round2(m.top + o.y), pageLimit(h)));
    var base = printerBaseOrigin();
    var dpmm = printerDensity();
    var lx = Math.round((sx + base.x) * dpmm);
    var ly = Math.round((sy + base.y) * dpmm);
    $('#ve-lh-badge').text('^LH' + lx + ',' + ly);
  }

  ['ve-margin-top', 've-margin-right', 've-margin-bottom', 've-margin-left',
   've-offset-x', 've-offset-y'].forEach(function(id) {
    $('#' + id).on('input change', applyPageInputs);
  });
  // 偏移超出允许范围时在失焦时收回，并提示——输入框里的数字始终等于发出去的值
  $('#ve-offset-x, #ve-offset-y').on('blur', function() {
    var isX = this.id === 've-offset-x';
    var lim = isX ? pageLimit(labelWidth()) : pageLimit(labelHeight());
    var v = parseFloat($(this).val()) || 0;
    var c = round2(clamp(v, lim));
    if (c !== v) {
      $(this).val(c);
      applyPageInputs();
      toastr.warning(t('le.err_offset_range'));
    }
  });

  function loadLabel() {
    $.getJSON('/rest/label', function(list) {
      var l = list.find(function(x) { return x._id === state.id; });
      if (!l) {
        toastr.error('label not found');
        return;
      }
      $('#edit-name').val(l.name);
      $('#edit-width').val(l.width);
      $('#edit-height').val(l.height);
      var layout = l.print_layout || {};
      $('#edit-cols').val(layout.cols || 1);
      $('#edit-rows').val(layout.rows || 0);
      state.type = l.type === 'visual' ? 'visual' : 'zpl_raw';
      $('#edit-printer').val(l.printer_id || '');
      // 密度先给编辑器：条码盒宽按点换算，旧模板升级成中心坐标也依赖它
      window.visualEditorApi.setDensity(printerDensity());
      if (state.type === 'visual') {
        window.visualEditorApi.load(l.template || {});
        // labels saved without print settings inherit the bound printer's
        var ps = (l.template && l.template.print_settings) || {};
        if (!Object.keys(ps).length) applyPrinterSettings(l.printer_id, true);
      } else {
        $('#edit-zpl').val(l.zpl || '');
      }
      applyType();
      syncCanvasSize();
      fillPageInputs((l.template || {}).page);
      updatePageInfo();
      rebuildVars();
      if ($('#edit-printer').val()) preview();
    });
  }

  // ---------- type switching (new labels only) ----------

  // ---------- right column tabs (properties / preview) ----------

  function showPropsTab() {
    $('#ve-tabs a[href="#ve-tab-props"]').tab('show');
  }
  function showPreviewTab() {
    var $link = $('#ve-tabs a[href="#ve-tab-preview"]');
    if (!$link.hasClass('active')) $link.tab('show'); // no-op if already active
  }

  function applyType() {
    var t = state.id ? state.type : $('#edit-type').val();
    state.type = t;
    var visual = t === 'visual';
    // three-column design card: left elements / middle canvas / right tabs
    // (label info card — incl. print settings — stays identical in both modes)
    $('#ve-elements-block, #ve-canvas-wrap, #ve-tab-props-link').toggle(visual);
    $('#raw-design').toggle(!visual);
    // raw ZPL mode: hide the empty left column and let the ZPL editor
    // span the left + middle areas
    $('#design-left').toggle(visual);
    $('#design-middle').toggleClass('col-lg-6 col-md-9', visual)
                       .toggleClass('col-lg-8 col-md-12', !visual);
    $('#design-title-visual').toggle(visual);
    $('#design-title-raw').toggle(!visual);
    if (!visual) showPreviewTab(); // raw ZPL mode: only the preview tab applies
  }

  // adding an element or selecting one on the canvas opens the properties tab
  // (onSelect fires from the editor itself — element mousedown handlers stop
  // propagation, so delegated canvas events never reach us)
  $('.ve-add').on('click', showPropsTab);
  window.visualEditorApi.onSelect(showPropsTab);

  $('#edit-type').on('change', function() {
    applyType();
    rebuildVars();
  });

  // ---------- variables -> input fields ----------

  window.visualEditorApi.onChange(rebuildVars);
  $('#edit-zpl').on('input', rebuildVars);

  function parseVars(text) {
    var vars = [];
    var reg = /\$\{([^}]+)\}/g;
    var m;
    while ((m = reg.exec(text || '')) !== null) {
      if (vars.indexOf(m[1]) === -1) vars.push(m[1]);
    }
    return vars;
  }

  function currentVariables() {
    return state.type === 'visual'
      ? window.visualEditorApi.getVariables()
      : parseVars($('#edit-zpl').val());
  }

  function rebuildVars() {
    var vars = currentVariables();
    var $c = $('#var-inputs').empty();
    if (!vars.length) {
      $c.html('<p class="text-muted">no variables</p>');
      return;
    }
    vars.forEach(function(v) {
      var $g = $('<div class="form-group"/>');
      $g.append('<label for="var-' + v + '">' + v + '</label>');
      $g.append('<input type="text" class="form-control var-input" id="var-' + v + '" data-var="' + v + '">');
      $c.append($g);
    });
  }

  // ---------- canvas size sync ----------

  function syncCanvasSize() {
    window.visualEditorApi.setCanvasSize(
      parseFloat($('#edit-width').val()) || 84.8,
      parseFloat($('#edit-height').val()) || 23.8
    );
  }
  $('#edit-width, #edit-height').on('input change', function() {
    syncCanvasSize(); // the canvas is the label: it follows width x height
    updatePageInfo(); // 偏移上限随标签尺寸变化
  });

  // ---------- save ----------

  function collectLabel() {
    var name = $('#edit-name').val();
    if (!name) { toastr.error('name required'); return null; }
    var payload = {
      name: name,
      width: parseFloat($('#edit-width').val()) || 84.8,
      height: parseFloat($('#edit-height').val()) || 23.8,
      print_layout: {
        cols: Math.max(1, parseInt($('#edit-cols').val(), 10) || 1),
        rows: Math.max(0, parseInt($('#edit-rows').val(), 10) || 0)
      },
      type: state.type,
      printer_id: $('#edit-printer').val() || ''
    };
    if (state.type === 'visual') {
      // 位置微调（页边距/偏移）由 getTemplate 从编辑器状态写回 template.page；
      // 打印机设置里的左侧位置/标签顶部位置是基础原点，单独存在 printer.settings
      payload.template = window.visualEditorApi.getTemplate();
      if (!payload.template.elements.length) {
        toastr.error('add at least one element');
        return null;
      }
    } else {
      payload.zpl = $('#edit-zpl').val();
      if (!payload.zpl) { toastr.error('ZPL required'); return null; }
    }
    if (state.id) payload._id = state.id;
    return payload;
  }

  $('#edit-save').on('click', function() {
    var payload = collectLabel();
    if (!payload) return;
    // every label must be bound to a printer — warn prominently and block
    if (!payload.printer_id) {
      $('#edit-printer').addClass('border-danger shadow-sm');
      $('#edit-printer')[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('#edit-printer').focus();
      setTimeout(function() { $('#edit-printer').removeClass('border-danger shadow-sm'); }, 4000);
      toastr.warning(t('le.need_printer'), '', { timeOut: 6000, closeButton: true });
      return;
    }
    $.ajax({
      url: '/rest/label',
      type: 'post',
      contentType: 'application/json',
      data: JSON.stringify(payload),
      dataType: 'json',
      success: function(saved) {
        if (saved._id) state.id = saved._id;
        toastr.info('label saved');
        rebuildVars();
        if ($('#edit-printer').val()) preview();
      },
      error: function(xhr) {
        toastr.error(xhr.responseText || 'save failed');
      }
    });
  });

  // ---------- import / export (current label) ----------

  // export: download the CURRENT editor content (works even before saving)
  $('#label-export').on('click', function() {
    var type = state.id ? state.type : $('#edit-type').val();
    var l = {
      name: $('#edit-name').val() || '',
      width: parseFloat($('#edit-width').val()) || 84.8,
      height: parseFloat($('#edit-height').val()) || 23.8,
      print_layout: {
        cols: parseInt($('#edit-cols').val(), 10) || 1,
        rows: parseInt($('#edit-rows').val(), 10) || 0
      },
      type: type,
      printer_id: $('#edit-printer').val() || ''
    };
    if (type === 'visual') {
      l.template = window.visualEditorApi.getTemplate();
    } else {
      l.zpl = $('#edit-zpl').val() || '^XA\n\n^XZ';
    }
    var out = {
      format: 'zpl-rest-labels',
      version: 1,
      exported_at: new Date().toISOString(),
      count: 1,
      labels: [l]
    };
    var safeName = (l.name || 'label').replace(/[\\/:*?"<>|]/g, '_');
    var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'zpl-label-' + safeName + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  });

  // import: load a label JSON file INTO THE EDITOR (does not save by itself).
  // accepts the export format ({labels:[...]}), an array, or a single label
  function importLabel(l, total) {
    if (!l || typeof l !== 'object' || (!l.name && !l.zpl && !l.template)) {
      toastr.error(t('msg.import_bad_json'));
      return;
    }
    var type = l.type === 'visual' ? 'visual' : 'zpl_raw';
    if (state.id && type !== state.type) {
      toastr.error(t('le.import_type_fixed'));
      return;
    }
    if (l.name) $('#edit-name').val(l.name);
    if (l.width) $('#edit-width').val(l.width);
    if (l.height) $('#edit-height').val(l.height);
    var layout = l.print_layout || {};
    if (layout.cols) $('#edit-cols').val(layout.cols);
    if (typeof layout.rows === 'number') $('#edit-rows').val(layout.rows);
    if (l.printer_id && state.printers[l.printer_id]) $('#edit-printer').val(l.printer_id);
    if (!state.id) {
      $('#edit-type').val(type); // type is only selectable on unsaved labels
    }
    state.type = type;
    var tpl = {};
    if (type === 'visual') {
      tpl = (l.template && typeof l.template === 'object') ? l.template : {};
      if (!Array.isArray(tpl.elements)) tpl.elements = [];
      window.visualEditorApi.load(tpl);
    } else {
      $('#edit-zpl').val(l.zpl || '');
    }
    applyType();
    syncCanvasSize();
    // 导入文件里的 page（页边距 / 偏移 / 纸宽）一并回填到位置微调输入
    fillPageInputs((type === 'visual' ? tpl.page : null));
    updatePageInfo();
    rebuildVars();
    toastr.success(total > 1 ? t('le.import_multi', { n: total }) : t('le.import_loaded'));
  }

  $('#label-import').on('click', function() {
    $('#label-import-file').val('').click();
  });
  $('#label-import-file').on('change', function() {
    var f = this.files && this.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function() {
      var payload;
      try { payload = JSON.parse(reader.result); }
      catch (e) { toastr.error(t('msg.import_bad_json')); return; }
      var list = null;
      if (Array.isArray(payload)) list = payload;
      else if (payload && Array.isArray(payload.labels)) list = payload.labels;
      else if (payload && typeof payload === 'object') list = [payload];
      if (!list || !list.length) { toastr.error(t('msg.import_bad_json')); return; }
      importLabel(list[0], list.length);
    };
    reader.readAsText(f);
  });

  // ---------- preview & test print ----------

  function selectedPrinter() {
    return $('#edit-printer').val();
  }

  // collect the variable inputs (names match the ${var} placeholders found
  // in the design) so preview and test print use the same values
  function collectVarData() {
    var data = {};
    var hasValue = false;
    $('.var-input').each(function() {
      var v = $(this).val();
      data[$(this).data('var')] = v;
      if (v) hasValue = true;
    });
    return hasValue ? data : null;
  }

  // preview with sample data: empty variable inputs get "Sample"
  function fillSampleValues() {
    $('.var-input').each(function() {
      if (!$(this).val()) $(this).val('Sample');
    });
  }

  function preview() {
    if (!state.id) { toastr.info('save the label first'); return; }
    var pid = selectedPrinter();
    if (!pid) { toastr.info('select a printer first'); return; }
    showPreviewTab(); // jump to the preview tab when a preview is requested
    fillSampleValues();
    var payload = { printer: pid, label: state.id };
    var varData = collectVarData();
    if (varData) payload.data = varData;
    $.ajax({
      url: '/rest/preview',
      type: 'post',
      contentType: 'application/json',
      data: JSON.stringify(payload),
      dataType: 'json',
      success: function(data) {
        $('#ve-img').attr('src', 'data:image/png;base64, ' + data.img);
      },
      error: function(xhr) {
        toastr.error(xhr.responseText || 'preview failed');
      }
    });
  }

  $('#edit-preview').on('click', preview);

  // typing into the preview variable inputs auto-refreshes the preview
  var previewTimer = null;
  $('#var-inputs').on('input', '.var-input', function() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function() {
      if (state.id && selectedPrinter()) preview();
    }, 500);
  });

  // opening the preview tab fills empty variables with "Sample" and previews
  $('#ve-tabs a[href="#ve-tab-preview"]').on('shown.bs.tab', function() {
    fillSampleValues();
    if (state.id && selectedPrinter()) preview();
  });

  // test print: enqueue the job through the print queue (same path as manual
  // queue adds), so queue management / history / retry all apply
  $('#edit-test').on('click', function() {
    if (!state.id) { toastr.info('save the label first'); return; }
    var pid = selectedPrinter();
    if (!pid) { toastr.info('select a printer first'); return; }
    fillSampleValues(); // never send an empty test print
    var data = {};
    $('.var-input').each(function() {
      data[$(this).data('var')] = $(this).val();
    });
    $.ajax({
      url: '/rest/queue/add',
      type: 'post',
      contentType: 'application/json',
      data: JSON.stringify({ label_id: state.id, printer_id: pid, data: data }),
      dataType: 'json',
      success: function(item) {
        toastr.success(item.job_id || 'job added', 'queued for printing');
      },
      error: function(xhr) {
        toastr.error(xhr.responseText || 'enqueue failed');
      }
    });
  });
});
