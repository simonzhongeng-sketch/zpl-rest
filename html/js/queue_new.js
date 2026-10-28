// New Print Queue page: staged task workflow.
// Step 1 (on /queue): choose a label template -> redirected here with ?label=
// Step 2 (this page): top card = template setup (preview / printer / copies,
//   Add Single with live preview, Batch Add with downloadable xlsx template);
//   bottom card = staged print tasks shown as a list or preview cards;
//   Enqueue All submits everything to the real print queue.
$(document).ready(function() {

  var url = new URL(window.location.href);
  var labelId = url.searchParams.get('label');
  if (!labelId) {
    toastr.error(t('qn.no_label'));
    setTimeout(function() { window.location.href = '/queue'; }, 1500);
    return;
  }

  var label = null;          // selected label record
  var variables = [];        // label variables
  var cols = 1;              // labels per row (label.print_layout.cols)
  var multiUp = false;       // cols > 1 with a single variable -> values are merged per row
  var staged = [];           // staged tasks: [{data, source}] or [{values, ...}] on multi-up media
  var view = 'list';         // 'list' | 'cards'
  var batchRows = null;      // parsed xlsx rows awaiting "Add Tasks"
  var previewSeq = 0;        // guards stale live previews
  var draftId = url.searchParams.get('draft') || null;  // editing an existing draft
  var draftName = null;      // current draft name (for the badge and save prompt)
  var draftData = null;      // loaded draft record waiting to be applied

  // ---------- load template ----------

  $.getJSON('/rest/label', function(labels) {
    label = labels.find(function(l) { return l._id === labelId; });
    if (!label) {
      toastr.error(t('qn.label_not_found'));
      setTimeout(function() { window.location.href = '/queue'; }, 1500);
      return;
    }
    $('#tpl-name').text('- ' + label.name);
    $('#single-tpl-name').text('- ' + label.name);
    cols = (label.print_layout && parseInt(label.print_layout.cols, 10)) || 1;
    // show the media layout so the grouping rule is visible before adding tasks
    if (cols > 1) {
      $('#tpl-layout-badge').text(t('qn.layout_badge', {cols: cols})).show();
    } else {
      $('#tpl-layout-badge').hide();
    }

    $.getJSON('/rest/label/variables/' + labelId, function(r) {
      variables = r.variables;
      // multi-up media with one variable: each printed row takes `cols` values
      multiUp = cols > 1 && variables.length === 1;
      var $box = $('#tpl-variables').empty();
      if (!variables.length) {
        $box.append('<p class="text-muted small mb-0">this label has no variables</p>');
      } else {
        $.each(variables, function(i, v) {
          $box.append('<span class="badge badge-secondary var-chip">${' + v + '}</span>');
        });
      }
    });

    $.getJSON('/rest/printer', function(printers) {
      var $sel = $('#tpl-printer');
      $.each(printers, function(i, p) {
        $sel.append('<option value="' + p._id + '">' + p.name + ' (' + p.address + ')</option>');
      });
      // auto-fill the printer bound to the label
      if (label.printer_id && printers.some(function(p) { return p._id === label.printer_id; })) {
        $sel.val(label.printer_id);
      }
      renderTemplatePreview();
      applyDraft(); // an opened draft overrides printer / copies / staged tasks
    });
  });

  // fetch the draft referenced by ?draft= and apply it once the page is ready
  if (draftId) {
    $.getJSON('/rest/queue/drafts/' + draftId, function(d) {
      draftData = d;
      applyDraft();
    }).fail(function() {
      toastr.error(t('qn.draft_not_found'));
    });
  }

  function applyDraft() {
    if (!draftData) return;
    var d = draftData;
    draftData = null; // apply only once (called from two async paths)
    if (d.printer_id && $('#tpl-printer').find('option[value="' + d.printer_id + '"]').length) {
      $('#tpl-printer').val(d.printer_id);
      renderTemplatePreview();
    }
    $('#copies').val(d.copies || 1);
    staged = (d.items || []).map(function(it) {
      return {label_id: labelId, printer_id: d.printer_id, data: it.data || {}, values: it.values, source: it.source || 'manual'};
    });
    draftName = d.name;
    updateDraftBadge();
    renderTasks();
    if (staged.length) {
      toastr.info(t('qn.draft_loaded', {name: d.name, n: staged.length}));
    }
  }

  function updateDraftBadge() {
    var $b = $('#draft-badge');
    if (draftId) {
      $b.text(t('qn.draft_badge', {name: draftName || draftId})).show();
    } else {
      $b.hide();
    }
  }

  // save the staged tasks as a draft (create on first save, update afterwards)
  $('#btn-save-draft').click(function() {
    if (!staged.length) { toastr.error(t('qn.no_tasks_save')); return; }
    var printerId = $('#tpl-printer').val();
    if (!printerId) { toastr.error(t('qn.select_printer_first')); return; }
    var name = prompt(t('qn.draft_name_ph'), draftName || (label.name + ' draft'));
    if (name === null) return; // cancelled
    var payload = {
      name: name,
      label_id: labelId,
      printer_id: printerId,
      copies: $('#copies').val(),
      items: staged
    };
    if (draftId) {
      $.ajax({
        url: '/rest/queue/drafts/' + draftId,
        type: 'put',
        contentType: 'application/json',
        data: JSON.stringify(payload),
        dataType: 'json',
        success: function(d) {
          draftName = d.name;
          updateDraftBadge();
          toastr.info(t('qn.draft_updated', {name: d.name}));
        },
        error: function(x) { toastr.error(x.responseText || t('qn.save_failed')); }
      });
    } else {
      $.ajax({
        url: '/rest/queue/drafts',
        type: 'post',
        contentType: 'application/json',
        data: JSON.stringify(payload),
        dataType: 'json',
        success: function(d) {
          draftId = d._id;
          draftName = d.name;
          updateDraftBadge();
          if (window.history && history.replaceState) {
            history.replaceState(null, '', '/queue/new?label=' + labelId + '&draft=' + draftId);
          }
          toastr.info(t('qn.draft_saved', {name: d.name}));
        },
        error: function(x) { toastr.error(x.responseText || t('qn.save_failed')); }
      });
    }
  });

  // template preview: variables are left as ${name} placeholders on purpose
  function renderTemplatePreview() {
    var printerId = $('#tpl-printer').val();
    if (!printerId) return;
    $.ajax({
      url: '/rest/preview',
      type: 'post',
      contentType: 'application/json',
      data: JSON.stringify({printer: printerId, label: labelId}),
      dataType: 'json',
      success: function(data) {
        $('#tpl-preview').attr('src', 'data:image/png;base64, ' + data.img);
      },
      error: function(x) {
        $('#tpl-preview').removeAttr('src');
        toastr.error(x.responseText || t('msg.preview_failed'));
      }
    });
  }

  $('#tpl-printer').change(renderTemplatePreview);

  // ---------- single add: modal with live preview ----------

  // one task = one value; on multi-up media several such tasks are merged into
  // one printed row later, when the queue is actually filled (server side)
  $('#btn-single').click(function() {
    var $box = $('#single-variables').empty();
    if (!variables.length) {
      $box.append('<p class="text-muted small mb-0">this label has no variables - the task will print the template as-is</p>');
    }
    $.each(variables, function(i, v) {
      $box.append(
        '<div class="form-group"><label for="sv-' + i + '">' + v + '</label>' +
        '<input type="text" class="form-control single-var" data-var="' + v + '" id="sv-' + i + '"></div>');
    });
    if (multiUp) {
      $box.append('<div class="small text-info">' + t('qn.merge_hint', {cols: cols}) + '</div>');
    }
    $('#single-preview').removeAttr('src');
    $('#singleModal').modal();
    setTimeout(renderSinglePreview, 300); // initial preview with empty data
  });

  var previewTimer = null;
  $('#single-variables').on('input', '.single-var', function() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderSinglePreview, 400); // debounced live preview
  });

  function collectSingleData() {
    var data = {};
    $('.single-var').each(function() {
      var v = $(this).data('var');
      var val = $(this).val();
      if (val !== '') data[v] = val;
    });
    return data;
  }

  function renderSinglePreview() {
    var printerId = $('#tpl-printer').val();
    if (!printerId) { toastr.error(t('qn.select_printer_first')); return; }
    var seq = ++previewSeq;
    $.ajax({
      url: '/rest/preview',
      type: 'post',
      contentType: 'application/json',
      data: JSON.stringify({printer: printerId, label: labelId, data: collectSingleData()}),
      dataType: 'json',
      success: function(data) {
        if (seq !== previewSeq) return; // a newer keystroke superseded this one
        $('#single-preview').attr('src', 'data:image/png;base64, ' + data.img);
      },
      error: function(x) {
        if (seq !== previewSeq) return;
        $('#single-preview').removeAttr('src');
        toastr.error(x.responseText || t('msg.preview_failed'));
      }
    });
  }

  $('#single-add-confirm').click(function() {
    var printerId = $('#tpl-printer').val();
    if (!printerId) { toastr.error(t('qn.select_printer_first')); return; }
    staged.push({label_id: labelId, printer_id: printerId, data: collectSingleData(), source: 'manual'});
    renderTasks();
    $('#singleModal').modal('hide');
    toastr.info(t('qn.task_added'));
  });

  // ---------- batch add: xlsx template download + parse + stage ----------

  $('#btn-batch').click(function() {
    $('#batch-panel').toggle();
  });

  $('#btn-dl-template').click(function() {
    $.ajax({
      url: '/rest/queue/template/' + labelId,
      type: 'get',
      dataType: 'json',
      success: function(r) {
        var a = document.createElement('a');
        a.href = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + r.content_b64;
        a.download = r.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      },
      error: function(x) { toastr.error(x.responseText || t('qn.dl_failed')); }
    });
  });

  function parseBatchFile() {
    var file = $('#batch-file')[0].files[0];
    if (!file) { toastr.error(t('qn.choose_file')); return; }
    var reader = new FileReader();
    reader.onload = function(e) {
      var b64 = e.target.result.split(',')[1];
      $.ajax({
        url: '/rest/queue/parse',
        type: 'post',
        contentType: 'application/json',
        data: JSON.stringify({label_id: labelId, content_b64: b64, rows_all: true}),
        dataType: 'json',
        success: function(r) {
          batchRows = r;
          var html = '';
          if (r.missing.length) {
            html += '<div class="alert alert-danger py-2">missing columns: <strong>' + r.missing.join(', ') + '</strong></div>';
          } else {
            html += '<div class="alert alert-success py-2">OK: ' + r.total_rows + ' data row(s) ready to add.</div>';
          }
          html += '<p class="mb-2"><small>columns: ' + r.columns.join(', ') + '</small></p>';
          $('#batch-result').html(html);
          $('#batch-add').prop('disabled', !!r.missing.length || !r.total_rows);
        },
        error: function(x) { toastr.error(x.responseText || t('qn.parse_failed')); }
      });
    };
    reader.readAsDataURL(file);
  }

  // parse automatically as soon as a file is chosen (no extra button needed)
  $('#batch-file').on('change', parseBatchFile);

  $('#batch-add').click(function() {
    if (!batchRows || !batchRows.total_rows) return;
    if (batchRows.missing.length) { toastr.error(t('qn.parse_failed')); return; }
    var printerId = $('#tpl-printer').val();
    if (!printerId) { toastr.error(t('qn.select_printer_first')); return; }

    // multi-up media: label.print_layout.cols > 1 with a single variable ->
    // the xlsx holds one value per row; fold every `cols` rows into one
    // staged task (one printed row, filled left to right)
    var cols = (label && label.print_layout && parseInt(label.print_layout.cols, 10)) || 1;
    if (cols > 1 && variables.length === 1) {
      var flat = batchRows.rows.map(function(row) { return row[variables[0]]; });
      var added = 0;
      for (var i = 0; i < flat.length; i += cols) {
        var group = flat.slice(i, i + cols).map(function(v) { return v === undefined || v === null ? '' : String(v); });
        // an all-blank row marks the end of the data: stop folding further rows
        if (!group.some(function(v) { return v.trim() !== ''; })) break;
        staged.push({
          label_id: labelId,
          printer_id: printerId,
          values: group,
          data: {values: group.join(', ')},
          source: 'xlsx'
        });
        added++;
      }
      toastr.info(t('qn.tasks_added', {n: added}));
    } else {
      batchRows.rows.forEach(function(row) {
        staged.push({label_id: labelId, printer_id: printerId, data: row, source: 'xlsx'});
      });
      toastr.info(t('qn.tasks_added', {n: batchRows.total_rows}));
    }
    batchRows = null;
    $('#batch-result').empty();
    $('#batch-add').prop('disabled', true);
    $('#batch-file').val('');
    renderTasks();
  });

  // ---------- staged task list / preview cards ----------

  function dataSummary(task) {
    if (task && Array.isArray(task.values) && task.values.length) {
      return task.values.map(function(v) { return v === '' ? '-' : v; }).join(' | ');
    }
    var data = (task && task.data) || {};
    var keys = Object.keys(data);
    if (!keys.length) return '-';
    return keys.map(function (k) { return k + '=' + data[k]; }).join(', ');
  }

  // preview payload for a staged task: a multi-up row previews its first cell
  function taskPreviewData(task) {
    if (task && Array.isArray(task.values) && task.values.length && variables.length) {
      var d = {};
      d[variables[0]] = task.values[0] || '';
      return d;
    }
    return (task && task.data) || {};
  }

  function renderTasks() {
    $('#task-count').text(staged.length);
    $('#btn-enqueue').prop('disabled', !staged.length);
    $('#task-empty').toggle(!staged.length);

    if (view === 'list') renderTaskList(); else renderTaskCards();
  }

  function renderTaskList() {
    var $tb = $('#task-list').empty();
    staged.forEach(function(task, i) {
      var $tr = $('<tr></tr>');
      $tr.append('<td><input type="checkbox" class="task-check" data-idx="' + i + '"></td>');
      $tr.append('<td>' + (i + 1) + '</td>');
      $tr.append('<td><small>' + dataSummary(task) + '</small></td>');
      $tr.append('<td><small>' + (task.source === 'xlsx' ? t('qn.xlsx_batch') : t('qn.manual')) + '</small></td>');
      $tr.append('<td><button class="btn btn-sm btn-outline-danger btn-del-task" data-idx="' + i + '"><i class="fas fa-trash fa-sm"></i></button></td>');
      $tb.append($tr);
    });
    $('#task-sel-all').prop('checked', false);
    $('#btn-enqueue-selected').prop('disabled', true);
  }

  // ---------- partial enqueue: checkbox selection + number-range selection ----------

  function updateSelectedState() {
    var checked = $('#task-list .task-check:checked').length;
    $('#btn-enqueue-selected').prop('disabled', !checked);
    $('#task-sel-all').prop('checked', checked > 0 && checked === staged.length);
  }

  $('#task-list').on('change', '.task-check', updateSelectedState);

  $('#task-sel-all').change(function() {
    $('#task-list .task-check').prop('checked', $(this).prop('checked'));
    updateSelectedState();
  });

  $('#btn-sel-range').click(function() {
    if (!staged.length) return;
    var from = Math.max(1, parseInt($('#sel-from').val(), 10) || 1);
    var to = Math.min(staged.length, parseInt($('#sel-to').val(), 10) || staged.length);
    if (from > to) { var tmp = from; from = to; to = tmp; }
    $('#task-list .task-check').each(function() {
      var n = parseInt($(this).data('idx'), 10) + 1; // No. column is 1-based
      $(this).prop('checked', n >= from && n <= to);
    });
    updateSelectedState();
  });

  $('#btn-enqueue-selected').click(function() {
    var idxs = [];
    $('#task-list .task-check:checked').each(function() {
      idxs.push(parseInt($(this).data('idx'), 10));
    });
    if (!idxs.length) return;
    var printerId = $('#tpl-printer').val();
    if (!printerId) { toastr.error(t('qn.select_printer_first')); return; }
    var copies = Math.max(1, parseInt($('#copies').val(), 10) || 1);
    var items = idxs.map(function(i) { return staged[i]; });
    $.ajax({
      url: '/rest/queue/add-many',
      type: 'post',
      contentType: 'application/json',
      data: JSON.stringify({items: items, copies: copies}),
      dataType: 'json',
      success: function(r) {
        toastr.info(t('qn.enqueued', {n: r.queued}) + (r.failed_at_enqueue ? t('qn.enqueue_failed_part', {n: r.failed_at_enqueue}) : ''));
        // remove only the enqueued tasks, keep the rest staged on this page
        idxs.sort(function(a, b) { return b - a; }).forEach(function(i) { staged.splice(i, 1); });
        renderTasks();
      },
      error: function(x) { toastr.error(x.responseText || t('qn.enqueue_failed')); }
    });
  });

  function renderTaskCards() {
    var $wrap = $('#task-cards-wrap').empty();
    staged.forEach(function(t, i) {
      var $col = $('<div class="col-md-3 task-card mb-3"></div>');
      var $card = $('<div class="card shadow-sm"></div>');
      var $body = $('<div class="card-body p-2"></div>');
      $body.append('<div class="task-img-box"><img class="label-preview" data-idx="' + i + '"></div>');
      $body.append('<p class="small mb-1 task-summary" title="' + dataSummary(t) + '">' + dataSummary(t) + '</p>');
      $body.append('<div class="d-flex justify-content-between align-items-center">' +
        '<span class="badge badge-light">#' + (i + 1) + '</span>' +
        '<button class="btn btn-sm btn-outline-danger btn-del-task" data-idx="' + i + '"><i class="fas fa-trash fa-sm"></i></button></div>');
      $card.append($body);
      $col.append($card);
      $wrap.append($col);

      // lazy per-task preview
      $.ajax({
        url: '/rest/preview',
        type: 'post',
        contentType: 'application/json',
        data: JSON.stringify({printer: t.printer_id, label: t.label_id, data: taskPreviewData(t)}),
        dataType: 'json',
        success: function(data) {
          $wrap.find('img[data-idx="' + i + '"]').attr('src', 'data:image/png;base64, ' + data.img);
        }
      });
    });
  }

  $('#task-list').on('click', '.btn-del-task', removeTask);
  $('#task-cards-wrap').on('click', '.btn-del-task', removeTask);
  function removeTask() {
    staged.splice(parseInt($(this).data('idx'), 10), 1);
    renderTasks();
  }

  $('#view-list').click(function() {
    view = 'list';
    $('#view-list').addClass('active');
    $('#view-cards').removeClass('active');
    $('#task-list-wrap').show();
    $('#task-cards-wrap').hide();
    renderTasks();
  });

  $('#view-cards').click(function() {
    view = 'cards';
    $('#view-cards').addClass('active');
    $('#view-list').removeClass('active');
    $('#task-list-wrap').hide();
    $('#task-cards-wrap').show();
    renderTasks();
  });

  $('#btn-clear').click(function() {
    if (!staged.length) return;
    if (!confirm(t('qn.confirm_clear'))) return;
    staged = [];
    renderTasks();
  });

  // ---------- enqueue everything ----------

  $('#btn-enqueue').click(function() {
    if (!staged.length) return;
    var copies = Math.max(1, parseInt($('#copies').val(), 10) || 1);
    $.ajax({
      url: '/rest/queue/add-many',
      type: 'post',
      contentType: 'application/json',
      data: JSON.stringify({items: staged, copies: copies}),
      dataType: 'json',
      success: function(r) {
        toastr.info(t('qn.enqueued', {n: r.queued}) + (r.failed_at_enqueue ? t('qn.enqueue_failed_part', {n: r.failed_at_enqueue}) : ''));
        window.location.href = '/queue';
      },
      error: function(x) { toastr.error(x.responseText || t('qn.enqueue_failed')); }
    });
  });

});
