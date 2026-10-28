$(document).ready(function() {

  $('.density-item').click(function(){
    $this = $(this);
    var button = $this.parent().parent().find('.dropdown-toggle');
    button.text($this.text());
    button.data("density",$this.data("density"));
  });

  // ---------- connection type (tcp / usb) ----------

  // driver names of Zebra-family printers: those are listed first so the
  // common case is one click away, but nothing is filtered out (a Zebra queue
  // may carry an arbitrary custom name, and non-Zebra queues must stay usable)
  var ZEBRA_DRIVER_RE = /zebra|zdesigner|ztc/i;

  // The API answers {error:'address_invalid'} and friends: map them to a
  // localized line so a rejected save never surfaces raw English or a blank
  // toast (the old "address is not valid" was both cryptic and untranslated).
  var API_ERR_KEYS = {
    address_invalid: 'pr.err_address_invalid',
    duplicate_address: 'pr.err_duplicate_address',
    usb_name_required: 'pr.err_usb_name_required',
    usb_not_found: 'pr.err_usb_not_found'
  };
  function printerApiError(xhr, fallbackKey) {
    var j = xhr && xhr.responseJSON;
    if (j && j.error && API_ERR_KEYS[j.error]) {
      var k = API_ERR_KEYS[j.error];
      var msg = t(k, { name: j.name || '', address: j.address || '' });
      if (msg !== k) return msg;
    }
    if (j && j.message) return j.message;
    return (xhr && xhr.responseText) || t(fallbackKey);
  }

  // 解析 mm 数字输入：空 / 非法时返回默认值（新建打印机默认 1.5 / 0.8，
  // 与 main.js 的 DEFAULT_BASE_ORIGIN_MM 保持一致；显式填 0 合法，保留 0）
  function numOr(v, def) {
    var n = parseFloat(v);
    return isNaN(n) ? def : n;
  }

  // load the Windows printer dropdown; `selected` is pre-selected, and
  // `keepMissing` adds a synthetic option when that value is not installed
  // (used when editing, so a name-only edit cannot silently rewrite address)
  function loadWindowsPrinters(sel, selected, keepMissing) {
    $(sel).html('<option value="">...</option>');
    $.getJSON('/rest/printer/windows', function(list) {
      var $s = $(sel).empty();
      if (!list.length) {
        // a stored address whose printer is gone must remain selectable so an
        // edit that only touches the name never rewrites it
        if (keepMissing && selected) {
          $s.append('<option value="' + selected + '">' + selected + ' (not installed)</option>');
          $s.val(selected);
          return;
        }
        $s.append('<option value="">' + t('pr.usb_none') + '</option>');
        return;
      }
      // sort, never filter: Zebra drivers first, everything else after with a
      // "(non-Zebra)" hint
      var zebra = [];
      var other = [];
      list.forEach(function(p) {
        if (ZEBRA_DRIVER_RE.test(p.driver || '')) {
          zebra.push(p);
        } else {
          other.push(p);
        }
      });
      zebra.concat(other).forEach(function(p) {
        var isZebra = ZEBRA_DRIVER_RE.test(p.driver || '');
        $s.append('<option value="' + p.name + '">' + p.name + (p.driver ? ' — ' + p.driver : '')
          + (isZebra ? '' : ' (non-Zebra)') + '</option>');
      });
      if (selected) {
        // the selected address may reference a printer that is no longer
        // installed (uninstalled / renamed): add it as an extra option instead
        // of silently falling back to the first entry
        var present = false;
        $s.find('option').each(function() {
          if ($(this).val() === selected) {
            present = true;
            return false; // break
          }
        });
        if (!present && keepMissing) {
          $s.prepend('<option value="' + selected + '">' + selected + ' (not installed)</option>');
        }
        $s.val(selected);
      }
    }).fail(function(xhr) {
      $(sel).empty().append('<option value="">(list failed)</option>');
      toastr.error(xhr.responseText || 'failed to list Windows printers');
    });
  }

  // switch the connection type of a create/edit form; `selected` is the
  // Windows printer name that should be pre-selected in the USB dropdown and
  // `keepMissing` says whether an uninstalled value must survive the reload
  function setConn(prefix, conn, selected, keepMissing) {
    var usb = conn === 'usb';
    $('#' + prefix + 'conn-group .conn-btn').each(function() {
      var active = $(this).data('conn') === conn;
      $(this).toggleClass('btn-primary active', active).toggleClass('btn-secondary', !active);
    });
    $('#' + prefix + '-address-group').toggle(!usb);
    $('#' + prefix + '-usb-group').toggle(usb);
    if (usb) loadWindowsPrinters('#' + prefix + 'usb', selected, keepMissing);
  }

  $('.conn-btn').click(function() {
    var prefix = $(this).closest('.btn-group').attr('id').replace('conn-group', '');
    // in the edit modal the stored address travels with the switch, so a user
    // flipping TCP -> USB keeps the original value when it is a printer name
    // (an IP simply matches no option and the dropdown starts empty)
    var selected = prefix === 'edit' ? $('#editaddress').val() : null;
    setConn(prefix, $(this).data('conn'), selected);
  });
  $('#newusb-refresh').click(function() { loadWindowsPrinters('#newusb'); });
  $('#editusb-refresh').click(function() { loadWindowsPrinters('#editusb', $('#editaddress').val()); });

  function currentConn(prefix) {
    return $('#' + prefix + 'conn-group .conn-btn.active').data('conn') || 'tcp';
  }

  // ---------- printer list ----------

  function loadPrinters() {
    $.getJSON('/rest/printer', function(printers) {
      var $list = $('#printer-list');
      $list.empty();
      if (!printers.length) {
        $list.html('<tr><td colspan="7" class="text-muted text-center">No printers configured. Scan or create one above.</td></tr>');
        return;
      }
      $.each(printers, function(i, p) {
        var s = p.settings || {};
        var settingsText = (s.mode ? (s.mode === 'direct_thermal' ? 'DT' : 'TT') : '-') +
          ' / MD' + (typeof s.darkness === 'number' ? s.darkness : '-') +
          ' / ' + (s.speed ? s.speed + 'ips' : '-');
        // 追加 ^LH 基础原点简示：显式配置 base_origin_mm 显示实际值；
        // 未配置时显示带 * 的默认值（1.5 / 0.8mm，* 表示继承机群默认）
        var bo = (s.base_origin_mm && typeof s.base_origin_mm === 'object') ? s.base_origin_mm : null;
        if (bo && !isNaN(parseFloat(bo.x)) && !isNaN(parseFloat(bo.y))) {
          settingsText += ' L' + parseFloat(bo.x) + '/T' + parseFloat(bo.y);
        } else {
          settingsText += ' L1.5*/T0.8*';
        }
        var $tr = $('<tr></tr>').attr('data-id', p._id);
        var isUsb = p.conn === 'usb';
        $tr.append('<td class="status-cell"><span class="badge badge-light">...</span></td>');
        $tr.append('<td>' + p.name + '</td>');
        $tr.append('<td>' + p.address + (isUsb ? ' <span class="badge badge-info">USB</span>' : '') + '</td>');
        $tr.append('<td>' + (p.device_model || '-') + '</td>');
        $tr.append('<td>' + (p.density || '-') + '</td>');
        $tr.append('<td><small>' + settingsText + '</small></td>');
        var $actions = $('<td></td>');
        $actions.append('<button class="btn btn-sm btn-primary btn-edit mr-1" data-id="' + p._id + '">' + t('btn.edit') + '</button>');
        $actions.append('<button class="btn btn-sm btn-danger btn-del" data-id="' + p._id + '" data-name="' + p.name + '">' + t('btn.delete') + '</button>');
        $tr.append($actions);
        $list.append($tr);
      });

      // status probe
      $.getJSON('/rest/printer/status', function(status) {
        $list.find('tr').each(function() {
          var id = $(this).data('id');
          var online = status[id];
          var $badge = $(this).find('.status-cell .badge');
          if (online === true) {
            $badge.removeClass('badge-light badge-danger badge-info').addClass('badge-success').text(t('status.online'));
          } else if (online === false) {
            $badge.removeClass('badge-light badge-success badge-info').addClass('badge-danger').text(t('status.offline'));
          } else {
            $badge.removeClass('badge-success badge-danger badge-info').addClass('badge-light').text(t('status.unknown'));
          }
        });
      });
    });
  }

  $('#refresh-printers').click(loadPrinters);
  loadPrinters();

  // ---------- edit (modal, from list) ----------

  $('#printer-list').on('click', '.btn-edit', function() {
    var id = $(this).data('id');
    $.getJSON('/rest/printer', function(printers) {
      $.each(printers, function(i, p) {
        if (p._id == id) {
          $('#printerid').val(p._id);
          $('#editname').val(p.name);
          $('#editaddress').val(p.address);
          // pass the stored address so the USB dropdown pre-selects it (and
          // keeps it even when that printer is not installed any more)
          setConn('edit', p.conn === 'usb' ? 'usb' : 'tcp',
            p.conn === 'usb' ? p.address : null, p.conn === 'usb');
          $('#editPrinterModal').data('model', p.device_model || '');
          var text = $('#editdensity').parent().find('.density-item[data-density="' + p.density + '"]').text();
          $('#editdensity').text(text);
          $('#editdensity').data("density", p.density);
          var s = p.settings || {};
          $('#editmode').val(s.mode === 'thermal_transfer' ? 'thermal_transfer' : 'direct_thermal');
          $('#editdarkness').val(typeof s.darkness === 'number' ? s.darkness : 0);
          $('#editspeed').val(s.speed > 0 ? s.speed : 2);
          // 位置参数：预填 base_origin_mm（x = 左侧位置，y = 标签顶部位置），
          // 未配置时填机群默认 1.5 / 0.8（显式 {x:0,y:0} 必须显示 0）
          var bo = (s.base_origin_mm && typeof s.base_origin_mm === 'object') ? s.base_origin_mm : {};
          $('#editleft').val(!isNaN(parseFloat(bo.x)) ? parseFloat(bo.x) : 1.5);
          $('#edittop').val(!isNaN(parseFloat(bo.y)) ? parseFloat(bo.y) : 0.8);
          $('#editPrinterModal').modal('show');
          return false;
        }
      });
    });
  });

  $('#editprinter').click(function(ev) {
    if(!$('#printerid').val()){
      toastr.error(t('pr.select_first'))
      return;
    }
    if(!$('#editname').val()){
      toastr.error(t('pr.name_required'))
      return;
    }
    var editConn = currentConn('edit');
    var editAddress = editConn === 'usb' ? $('#editusb').val() : $('#editaddress').val();
    // fallback: if the dropdown could not offer the stored name (list failed),
    // keep the stored address instead of blocking an otherwise valid edit
    if (!editAddress && editConn === 'usb') editAddress = $('#editaddress').val();
    if(!editAddress){
      toastr.error(editConn === 'usb' ? t('pr.usb_pick') : t('pr.address_required'))
      return;
    }
    if(!$('#editdensity').data("density")){
      toastr.error(t('pr.density_required'))
      return;
    }

    $.ajax({
      url: "/rest/printer",
      type: 'post',
      contentType: 'application/json',
      data: JSON.stringify({
        _id: $('#printerid').val(),
        name: $('#editname').val(),
        address: editAddress,
        conn: editConn === 'usb' ? 'usb' : undefined,
        density: $('#editdensity').data("density"),
        device_model: $('#editPrinterModal').data('model') || undefined,
        settings: {
          mode: $('#editmode').val(),
          darkness: parseInt($('#editdarkness').val(), 10) || 0,
          speed: parseInt($('#editspeed').val(), 10) || 2,
          // 物理位置参数：清空视为 0（显式关闭该机器的原点补偿）
          base_origin_mm: {
            x: parseFloat($('#editleft').val()) || 0,
            y: parseFloat($('#edittop').val()) || 0
          }
        }
      }),
      dataType: 'json',
      success: function(data) {
        if (data && data.reachable === false) {
          toastr.warning(t('pr.saved_unreachable'));
        } else {
          toastr.info(t('pr.updated'));
        }
        $('#editPrinterModal').modal('hide');
        loadPrinters();
      },
      error: function(xhr) {
        toastr.error(printerApiError(xhr, 'pr.update_failed'));
      }
    });
  });

  // ---------- delete (from list) ----------

  $('#printer-list').on('click', '.btn-del', function() {
    if (!confirm(t('confirm.delete_printer', {name: $(this).data('name')}))) return;
    var $btn = $(this);
    $.ajax({
      url: "/rest/printer/" + $btn.data("id"),
      type: 'delete',
      success: function(data) {
        toastr.info(t('pr.deleted'));
        loadPrinters();
      },
      error: function(data) {
        toastr.error(t('pr.delete_failed'))
      }
    });
  });

  // ---------- discovery ----------

  var lastScan = [];

  function runScan() {
    // empty input = 'auto' = every local interface (Ethernet/Wi-Fi/VPN);
    // a value pins the scan to that /24, e.g. when the printers sit on
    // another NIC than the one the OS lists first
    var sub = String($('#discover-subnet').val() || '').trim();
    $('#discover-results').html('<div class="text-center text-muted"><i class="fas fa-spinner fa-spin"></i> ' + t('pr.scanning') + '</div>');
    $.ajax({
      url: '/rest/discover',
      type: 'post',
      contentType: 'application/json',
      data: JSON.stringify({subnet: sub || 'auto'}),
      dataType: 'json',
      timeout: 180000,
      success: function(list, status, xhr) {
        lastScan = list;
        // how many hosts had 9100 open vs how many were confirmed as Zebra:
        // when a known printer is missing from the list, this single line
        // tells the user whether the scan never reached it (network) or
        // reached it and refused to identify it (non-Zebra answer / timeout)
        var openN = parseInt(xhr.getResponseHeader('X-Sweep-Open'), 10);
        var zebraN = parseInt(xhr.getResponseHeader('X-Sweep-Zebra'), 10);
        var statsHtml = '';
        if (!isNaN(openN) && !isNaN(zebraN)) {
          statsHtml = '<p class="small text-muted mb-1">' + t('pr.scan_summary', {open: openN, found: zebraN}) + '</p>';
          if (openN > zebraN) {
            statsHtml += '<p class="small text-warning mb-1">' + t('pr.scan_filtered', {n: openN - zebraN}) + '</p>';
          }
        }
        if (!list.length) {
          var scanned = String(xhr.getResponseHeader('X-Scanned-Subnets') || sub || 'auto')
            .split(',').filter(Boolean).join(', ');
          $('#discover-results').html(
            '<p class="text-muted mb-1">' + t('pr.none_found') + '</p>' +
            statsHtml +
            '<p class="small text-muted mb-0">' + t('pr.none_found_hint', {subnets: scanned}) + '</p>');
          return;
        }
        var html = '';
        $.each(list, function(i, p) {
          var added = p.already_added;
          var isUsb = p.conn === 'usb';
          var label = isUsb
            ? '<strong>' + p.model + '</strong> <span class="badge badge-info">USB</span>'
              + ' <span class="text-muted">' + p.name + '</span>'
            : '<strong>' + p.model + '</strong>'
              + ' <span class="text-muted">' + p.ip + ':' + p.port + '</span>';
          html += '<div class="border rounded p-2 mb-2 d-flex justify-content-between align-items-center">'
            + '<div>' + label
            + (p.density ? ' <span class="badge badge-secondary">' + p.density + '</span>' : '')
            + (added ? ' <span class="badge badge-info">' + t('pr.already_added') + '</span>' : '')
            + '</div>'
            + '<button class="btn btn-sm btn-primary add-discovered" data-idx="' + i + '"' + (added ? ' disabled' : '') + '>'
            + (added ? t('pr.added') : t('pr.add'))
            + '</button></div>';
        });
        $('#discover-results').html(html + statsHtml);
        $('.add-discovered').click(function() {
          var $btn = $(this);
          var found = lastScan[$btn.data('idx')] || {};
          var isUsb = found.conn === 'usb';
          var name = isUsb ? (found.model + ' (USB)') : (found.model + ' (' + found.ip + ')');
          var payload = isUsb ? {
            name: name,
            address: found.name, // Windows printer name
            conn: 'usb',
            density: found.density,
            device_model: found.model,
            dpi: found.dpi,
            media: found.media,
            zpl_header: found.zpl_header,
            settings: found.settings
          } : {
            name: name,
            address: found.ip + ':' + found.port,
            density: found.density,
            device_model: found.model,
            dpi: found.dpi,
            media: found.media,
            zpl_header: found.zpl_header,
            settings: found.settings
          };
          $btn.prop('disabled', true).text('...');
          $.ajax({
            url: '/rest/printer',
            type: 'post',
            contentType: 'application/json',
            data: JSON.stringify(payload),
            dataType: 'json',
            success: function() {
              toastr.info(t('pr.added_msg', {name: name}));
              $btn.text(t('btn.added'));
              loadPrinters();
            },
            error: function(xhr) {
              // localized reason from the API error code (address_invalid /
              // duplicate_address / ...) instead of a raw JSON blob
              toastr.error(printerApiError(xhr, 'pr.add_failed'));
              var code = xhr && xhr.responseJSON && xhr.responseJSON.error;
              // already present: keep the button in its final state
              if (code === 'duplicate_address' || String(xhr.responseText || '').indexOf('already exists') !== -1) {
                $btn.text(t('btn.added'));
              } else {
                $btn.prop('disabled', false).text(t('btn.add'));
              }
            }
          });
        });
      },
      error: function(data) {
        $('#discover-results').html('<p class="text-danger">' + t('pr.scan_failed') + ': ' + (data.responseText || '') + '</p>');
      }
    });
  }

  $('#scanprinters').click(runScan);
  $('#discover-subnet').on('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); runScan(); }
  });

  // connectivity tester: answers "can THIS pc reach the printer at all?"
  // without adding anything — separates an app problem from a network one
  function runProbe() {
    var v = String($('#probe-address').val() || '').trim();
    if (!v) { toastr.error(t('pr.address_required')); return; }
    var $r = $('#probe-result');
    $r.removeClass('text-success text-danger').addClass('text-muted').text(t('pr.probing'));
    $.ajax({
      url: '/rest/discover/probe',
      type: 'post',
      contentType: 'application/json',
      data: JSON.stringify({address: v}),
      dataType: 'json',
      timeout: 20000,
      success: function(res) {
        var tcp = res.tcp || {};
        if (tcp.reachable) {
          $r.removeClass('text-muted text-danger').addClass('text-success')
            .text(t('pr.probe_ok', {ms: tcp.ms}));
          return;
        }
        var why = tcp.error || '';
        var extra = (res.ping && res.ping.ok) ? t('pr.probe_ping_ok') : t('pr.probe_ping_fail');
        $r.removeClass('text-muted text-success').addClass('text-danger')
          .text(t('pr.probe_fail', {why: why}) + ' ' + extra);
      },
      error: function(xhr) {
        $r.removeClass('text-success').addClass('text-danger')
          .text(printerApiError(xhr, 'pr.probe_fail'));
      }
    });
  }
  $('#probe-btn').click(runProbe);
  $('#probe-address').on('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); runProbe(); }
  });

  // ---------- rediscover (re-find printers that changed their IP) ----------

  // asks the server to run one rebind round immediately: offline tcp printers
  // with a known serial are looked up in their subnet and moved addresses are
  // rewritten (the same thing the periodic timer does in the background)
  $('#rediscover-printers').click(function() {
    var $btn = $(this);
    $btn.prop('disabled', true);
    $.ajax({
      url: '/rest/printer/rediscover',
      type: 'post',
      contentType: 'application/json',
      data: '{}',
      dataType: 'json',
      timeout: 180000,
      success: function(results) {
        $btn.prop('disabled', false);
        var moved = (results || []).filter(function(r) { return r.new_address; }).length;
        if (moved) {
          toastr.success(t('pr.rediscover_moved', {n: moved}));
        } else {
          toastr.info(t('pr.rediscover_none'));
        }
        loadPrinters();
      },
      error: function(data) {
        $btn.prop('disabled', false);
        toastr.error(data.responseText || t('pr.rediscover_failed'));
      }
    });
  });

  // no auto scan on page load: scanning only runs when the user clicks
  // "Auto Scan" (avoids touching devices on the network every refresh);
  // the static hint in the view already explains this, keep the box empty
  // to avoid a duplicated sentence

  // ---------- create (modal) ----------

  $('#manual-add-btn').click(function() {
    $('#createPrinterModal').modal('show');
  });

  // prefill print settings from the model profile when the user types a model
  $('#newmodel').on('change', function() {
    var model = $(this).val();
    if (!model) return;
    var density = $('#newdensity').data('density') || '';
    var dpi = density === '12dpmm' ? 300 : density === '8dpmm' ? 203 : density === '6dpmm' ? 152 : density === '24dpmm' ? 600 : '';
    $.getJSON('/rest/profile/settings?model=' + encodeURIComponent(model) + '&dpi=' + dpi, function(s) {
      $('#newmode').val(s.mode === 'thermal_transfer' ? 'thermal_transfer' : 'direct_thermal');
      $('#newdarkness').val(typeof s.darkness === 'number' ? s.darkness : 0);
      $('#newspeed').val(s.speed > 0 ? s.speed : 2);
    });
  });

  $('#createprinter').click(function(ev) {
    if(!$('#newname').val()){
      toastr.error(t('pr.name_required'))
      return;
    }
    var newConn = currentConn('new');
    var newAddress = newConn === 'usb' ? $('#newusb').val() : $('#newaddress').val();
    if(!newAddress){
      toastr.error(newConn === 'usb' ? t('pr.usb_pick') : t('pr.address_required'))
      return;
    }
    if(!$('#newdensity').data("density")){
      toastr.error(t('pr.density_required'))
      return;
    }

    $.ajax({
      url: "/rest/printer",
      type: 'post',
      contentType: 'application/json',
      data: JSON.stringify({
        name: $('#newname').val(),
        address: newAddress,
        conn: newConn === 'usb' ? 'usb' : undefined,
        density: $('#newdensity').data("density"),
        device_model: $('#newmodel').val(),
        settings: {
          mode: $('#newmode').val(),
          darkness: parseInt($('#newdarkness').val(), 10) || 0,
          speed: parseInt($('#newspeed').val(), 10) || 2,
          // 物理位置参数：空则用机群默认 1.5 / 0.8（与 DEFAULT_BASE_ORIGIN_MM 一致）
          base_origin_mm: {
            x: numOr($('#newleft').val(), 1.5),
            y: numOr($('#newtop').val(), 0.8)
          }
        }
      }),
      dataType: 'json',
      success: function(data) {
        if (data && data.reachable === false) {
          // saved, but the device does not answer on that address right now:
          // say so instead of letting it look like a working setup
          toastr.warning(t('pr.saved_unreachable'));
        } else {
          toastr.info(t('pr.saved'));
        }
        $('#createPrinterModal').modal('hide');
        $('#newname').val("");
        $('#newaddress').val("");
        $('#newmodel').val("");
        $('#newdensity').data("density","")
        $('#newdensity').text("Density / Resolution")
        setConn('new', 'tcp');
        loadPrinters();
      },
      error: function(xhr) {
        toastr.error(printerApiError(xhr, 'pr.creation_failed'));
      }
    });
  });
});
