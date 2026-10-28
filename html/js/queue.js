$(document).ready(function() {

  var parsed = null; // last parse result

  // ---------- helpers ----------

  function statusBadge(status) {
    var map = {
      pending: 'badge-secondary',
      processing: 'badge-primary',
      done: 'badge-success',
      failed: 'badge-danger'
    };
    return '<span class="badge ' + (map[status] || 'badge-light') + '">' + t('status.' + status) + '</span>';
  }

  function fmtTime(d) {
    if (!d) return '-';
    var t = new Date(d);
    return t.toLocaleDateString() + ' ' + t.toLocaleTimeString();
  }

  function dataSummary(data) {
    if (!data) return '-';
    var keys = Object.keys(data);
    return keys.map(function (k) { return k + '=' + data[k]; }).join(', ').slice(0, 120);
  }

  function sourceBadge(source) {
    var map = {
      xlsx: 'badge-info',
      manual: 'badge-primary',
      reprint: 'badge-warning'
    };
    var label = source || 'xlsx';
    return '<span class="badge ' + (map[label] || 'badge-light') + '">' + t('source.' + label) + '</span>';
  }

  // ---------- choose-a-template modal (Add Print Queue) ----------

  var printersById = {};

  $.getJSON('/rest/printer', function(printers) {
    $.each(printers, function(i, p) {
      printersById[p._id] = p;
      $('#job-printer-select').append('<option value="' + p._id + '">' + p.name + ' (' + p.address + ')</option>');
    });
  });

  function refreshChoosePreview() {
    var label = $('#sel-label').data('label');
    if (!label) return;
    // printer auto-filled from the label binding; fall back to the first
    // available one if the binding is empty or points to a removed printer
    var printerId = (label.printer_id && printersById[label.printer_id])
      ? label.printer_id
      : Object.keys(printersById)[0];
    var p = printersById[printerId];
    if (!p) {
      $('#sel-printer').removeClass('text-muted small').text(t('queue.no_printer'));
      $('#sel-preview').removeAttr('src');
      return;
    }
    $('#sel-printer').removeClass('text-muted small').text(p.name + ' (' + p.address + ')' + (label.printer_id === p._id ? '' : t('queue.fallback')));

    // variables shown by name (chips)
    var $box = $('#sel-variables').empty();
    $.getJSON('/rest/label/variables/' + label._id, function(r) {
      if (!r.variables.length) {
        $box.append('<p class="text-muted small mb-0">' + t('queue.no_vars') + '</p>');
        return;
      }
      $.each(r.variables, function(i, v) {
        $box.append('<span class="badge badge-secondary mr-1 mb-1">${' + v + '}</span>');
      });
    });

    // template preview rendered at the bound printer's density
    $.ajax({
      url: '/rest/preview',
      type: 'post',
      contentType: 'application/json',
      data: JSON.stringify({printer: printerId, label: label._id}),
      dataType: 'json',
      success: function(data) {
        $('#sel-preview').attr('src', 'data:image/png;base64, ' + data.img);
      },
      error: function(x) {
        $('#sel-preview').removeAttr('src');
        toastr.error(x.responseText || t('msg.preview_failed'));
      }
    });
  }

  $('#sel-label').change(function() {
    var id = $(this).val();
    $('#sel-next').prop('disabled', !id);
    $('#sel-preview').removeAttr('src');
    $('#sel-variables').html('<p class="text-muted small mb-0">' + t('queue.pick_vars') + '</p>');
    $('#sel-printer').addClass('text-muted small').text(t('queue.pick_printer'));
    if (!id) { $('#sel-label').removeData('label'); return; }
    $.getJSON('/rest/label', function(labels) {
      var label = labels.find(function(l) { return l._id === id; });
      if (!label) return;
      $('#sel-label').data('label', label);
      refreshChoosePreview();
    });
  });

  $('#sel-next').click(function() {
    var id = $('#sel-label').val();
    if (!id) return;
    window.location.href = '/queue/new?label=' + id;
  });

  // ---------- queue list / print history (same columns, split by status) ----------

  // row builder shared by both tables: identical fields,
  // action buttons depend on status:
  //   pending    -> preview + delete
  //   failed     -> preview + delete + retry
  //   processing -> preview
  //   done       -> preview + reprint one copy
  function buildRow(it) {
    var $tr = $('<tr></tr>');
    $tr.append('<td><small>' + fmtTime(it.created_at) + '</small></td>');
    $tr.append('<td><small>' + (it.job_id || '-') + '</small></td>');
    $tr.append('<td><small>' + (it.label_name || '-') + '</small></td>');
    $tr.append('<td><small>' + (it.printer_name || (it.printer_id ? it.printer_id.slice(0, 8) : t('queue.label_default'))) + '</small></td>');
    $tr.append('<td><small>' + dataSummary(it.data) + '</small></td>');
    $tr.append('<td>' + sourceBadge(it.source) + '</td>');
    $tr.append('<td><small>' + (it.source_ip || '-') + '</small></td>');
    $tr.append('<td>' + statusBadge(it.status) + '</td>');
    $tr.append('<td><small class="text-danger">' + (it.error || '') + '</small></td>');
    var $act = $('<td style="white-space: nowrap;"></td>');
    if (it.status !== 'done') {
      $act.append('<button class="btn btn-sm btn-outline-secondary btn-review' + (it.status === 'failed' ? ' mr-1' : '') + '" data-id="' + it._id + '" title="' + t('btn.preview') + '"><i class="fas fa-search fa-sm"></i></button>');
    }
    if (it.status === 'failed') {
      $act.append('<button class="btn btn-sm btn-outline-danger btn-del-item mr-1" data-id="' + it._id + '" title="' + t('btn.delete') + '"><i class="fas fa-trash fa-sm"></i></button>');
      $act.append('<button class="btn btn-sm btn-outline-warning btn-retry-item" data-id="' + it._id + '" title="' + t('btn.retry') + '"><i class="fas fa-redo fa-sm"></i></button>');
    } else if (it.status === 'pending') {
      $act.append('<button class="btn btn-sm btn-outline-danger btn-del-item" data-id="' + it._id + '" title="' + t('btn.delete') + '"><i class="fas fa-trash fa-sm"></i></button>');
    } else if (it.status === 'done') {
      $act.append('<button class="btn btn-sm btn-outline-secondary btn-review mr-1" data-id="' + it._id + '" title="' + t('btn.preview') + '"><i class="fas fa-search fa-sm"></i></button>');
      $act.append('<button class="btn btn-sm btn-primary btn-reprint" data-id="' + it._id + '" title="' + t('msg.reprint_one') + '"><i class="fas fa-copy fa-sm"></i></button>');
    }
    $tr.append($act);
    $tr.data('item', it);
    return $tr;
  }

  function itemMatches(it, term) {
    var hay = [
      it.job_id || '',
      it.label_name || '',
      it.printer_name || '',
      it.source || '',
      it.source_ip || '',
      dataSummary(it.data)
    ].join(' ').toLowerCase();
    return hay.indexOf(term) !== -1;
  }

  var lastHistory = [];

  function loadQueue() {
    $.getJSON('/rest/queue', function(r) {
      if (r.paused) {
        $('#pause-banner').text(t('queue.paused') + (r.pause_reason || t('msg.queue_paused'))).show();
      } else {
        $('#pause-banner').hide();
      }

      // several printers may print at the same time: show how many are busy
      var active = r.active || [];
      if (active.length > 1) {
        $('#parallel-badge').text(t('queue.parallel', {n: active.length})).show();
      } else {
        $('#parallel-badge').hide();
      }

      // unfinished items (pending / processing / failed)
      var $list = $('#queue-list');
      $list.empty();
      if (!r.items.length) {
        $list.html('<tr><td colspan="10" class="text-muted text-center">' + t('queue.no_items') + '</td></tr>');
      }
      $.each(r.items, function(i, it) {
        $list.append(buildRow(it));
      });

      // completed items -> print history (with search)
      lastHistory = r.history || [];
      renderHistory();
    });
  }

  function renderHistory() {
    var term = ($('#history-search').val() || '').trim().toLowerCase();
    var $tbody = $('#history-table').find('tbody');
    $tbody.empty();
    var rows = lastHistory;
    if (term) {
      rows = rows.filter(function(it) { return itemMatches(it, term); });
    }
    if (!rows.length) {
      $tbody.html('<tr><td colspan="10" class="text-muted text-center">' +
        (term ? t('queue.no_history_match', {term: term}) : t('queue.no_history')) + '</td></tr>');
      return;
    }
    $.each(rows, function(i, it) {
      $tbody.append(buildRow(it));
    });
  }

  $('#history-search').on('input', renderHistory);

  // delete a failed item from the queue list
  $('#queue-list').on('click', '.btn-del-item', function() {
    $.ajax({
      url: '/rest/queue/delete',
      type: 'post',
      contentType: 'application/json',
      data: JSON.stringify({ids: [$(this).data('id')]}),
      success: function() { loadQueue(); },
      error: function() { toastr.error(t('msg.delete_failed')); }
    });
  });

  // retry a single failed item
  $('#queue-list').on('click', '.btn-retry-item', function() {
    $.ajax({
      url: '/rest/queue/retry',
      type: 'post',
      contentType: 'application/json',
      data: JSON.stringify({ids: [$(this).data('id')]}),
      success: function(r) {
        toastr.info(t('msg.requeued', {n: r.requeued}));
        loadQueue();
      },
      error: function() { toastr.error(t('msg.retry_failed')); }
    });
  });

  // quick reprint: enqueue the finished item as-is
  $('#history-table').on('click', '.btn-reprint', function() {
    var it = $(this).closest('tr').data('item');
    $.ajax({
      url: '/rest/queue/reprint',
      type: 'post',
      contentType: 'application/json',
      data: JSON.stringify({item_id: it._id}),
      dataType: 'json',
      success: function(enqueued) {
        toastr.info((enqueued && enqueued.job_id ? enqueued.job_id + ' ' : '') + t('msg.added_to_queue'));
        loadQueue();
      },
      error: function(x) { toastr.error(x.responseText || t('msg.reprint_failed')); }
    });
  });

  // review modal: preview + editable ZPL + printer choice, then enqueue.
  // Available for both queue items (preview before send) and history items.
  function showJobModal(it) {
    $('#jobModal').data('job', it);
    $('#job-data').val(JSON.stringify(it.data || {}, null, 2));
    $('#gzpl').val(it.zpl_sent || it.zpl_override || '');
    if (it.printer_id && $('#job-printer-select option[value="' + it.printer_id + '"]').length) {
      $('#job-printer-select').val(it.printer_id);
    }
    $('#jobModalLabel').text(it.job_id ? 'Job ' + it.job_id : 'Job');
    // reprint (enqueue again) only makes sense for finished items
    $('#reprint').toggle(it.status === 'done');
    refreshJobPreview();
    $('#jobModal').modal();
  }

  $('#history-table').on('click', '.btn-review', function() {
    showJobModal($(this).closest('tr').data('item'));
  });

  $('#queue-list').on('click', '.btn-review', function() {
    showJobModal($(this).closest('tr').data('item'));
  });

  function refreshJobPreview() {
    var it = $('#jobModal').data('job');
    if (!it) return;
    var params = {
      printer: $('#job-printer-select').val() || it.printer_id,
      label: it.label_id
    };
    var zpl = $('#gzpl').val();
    if (zpl) params.zpl = zpl;
    $.ajax({
      url: '/rest/preview',
      type: 'post',
      contentType: 'application/json',
      data: JSON.stringify(params),
      dataType: 'json',
      success: function(data) {
        $('#imgContainer').find('img').attr('src', 'data:image/png;base64, ' + data.img);
      },
      error: function(data) {
        $('#imgContainer').find('img').attr('src', '');
      toastr.error(JSON.stringify(data), t('msg.preview_failed'));
      }
    });
  }

  $('#gzpl').change(refreshJobPreview);
  $('#job-printer-select').change(refreshJobPreview);

  $('#reprint').click(function() {
    var it = $('#jobModal').data('job');
    if (!it) return;
    if (!$('#job-printer-select').val()) { toastr.error(t('msg.printer_required')); return; }
    $.ajax({
      url: '/rest/queue/reprint',
      type: 'post',
      contentType: 'application/json',
      data: JSON.stringify({
        item_id: it._id,
        printer: $('#job-printer-select').val(),
        zpl: $('#gzpl').val() || null
      }),
      dataType: 'json',
      success: function(enqueued) {
        toastr.info((enqueued && enqueued.job_id ? enqueued.job_id + ' ' : '') + t('msg.added_to_queue'));
        $('#jobModal').modal('hide');
        loadQueue();
      },
      error: function(x) { toastr.error(x.responseText || t('msg.reprint_failed')); }
    });
  });

  // upload / single-add moved to /queue/new (html/js/queue_new.js)

  // ---------- queue list & controls ----------

  $('#queue-list').on('click', '.btn-del-item', function() {
    $.ajax({
      url: '/rest/queue/delete',
      type: 'post',
      contentType: 'application/json',
      data: JSON.stringify({ids: [$(this).data('id')]}),
      success: function() { loadQueue(); },
      error: function() { toastr.error(t('msg.delete_failed')); }
    });
  });

  $('#q-retry').click(function() {
    $.post('/rest/queue/retry', function(r) {
      toastr.info(t('msg.requeued', {n: r.requeued}) + ' (' + t('status.failed') + ')');
      loadQueue();
    });
  });

  $('#q-clear-failed').click(function() {
    if (!confirm(t('confirm.delete_failed_items'))) return;
    $.ajax({
      url: '/rest/queue/delete',
      type: 'post',
      contentType: 'application/json',
      data: JSON.stringify({status: 'failed'}),
      success: function(r) {
        toastr.info(t('msg.deleted_failed', {n: r.removed}));
        loadQueue();
      },
      error: function() { toastr.error(t('msg.delete_failed')); }
    });
  });

  $('#q-clear-all').click(function() {
    if (!confirm(t('confirm.delete_all_items'))) return;
    $.ajax({
      url: '/rest/queue/delete',
      type: 'post',
      contentType: 'application/json',
      data: JSON.stringify({status: 'items'}),
      success: function() { loadQueue(); }
    });
  });

  // websocket live updates (dispatched from websocket.js)
  window.onQueueUpdate = function(msg) {
    if (msg && msg.event === 'paused') {
      toastr.warning(msg.data && msg.data.reason ? msg.data.reason : t('msg.queue_paused'));
    }
    // an offline printer no longer pauses the whole queue: its items wait
    // while the other printers keep going
    if (msg && msg.event === 'printer_offline') {
      toastr.warning(t('queue.printer_offline', {
        printer: (msg.data && msg.data.printer) || '',
        address: (msg.data && msg.data.address) || ''
      }));
    }
    loadQueue();
  };

  // polling fallback: keeps the status fresh even if the websocket drops
  setInterval(loadQueue, 5000);

  // step 1 of the new print queue flow: choose a label template
  $('#btn-add-queue').click(function() {
    $.getJSON('/rest/label', function(labels) {
      var $sel = $('#sel-label');
      $sel.find('option:not(:first)').remove();
      $.each(labels, function(i, l) {
        $sel.append('<option value="' + l._id + '">' + l.name + '</option>');
      });
      // reset state so re-opening the modal and re-picking the same label works
      $sel.val('').removeData('label');
      $('#sel-next').prop('disabled', true);
      $('#sel-preview').removeAttr('src');
      $('#sel-variables').html('<p class="text-muted small mb-0">' + t('queue.pick_vars') + '</p>');
      $('#sel-printer').addClass('text-muted small').text(t('queue.pick_printer'));
      $('#chooseModal').modal();
    });
  });

  // ---------- queue drafts (saved staged batches from the New Print Queue page) ----------

  function fmtTime(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    var p = function(n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function loadDrafts() {
    $.getJSON('/rest/queue/drafts', function(drafts) {
      var $tb = $('#draft-list').empty();
      $('#draft-empty').toggle(!drafts.length);
      drafts.forEach(function(d) {
        var $tr = $('<tr></tr>');
        $tr.append('<td>' + d.name + '</td>');
        $tr.append('<td><small>' + d.label_name + '</small></td>');
        $tr.append('<td><small>' + d.printer_name + '</small></td>');
        $tr.append('<td>' + d.task_count + '</td>');
        $tr.append('<td>' + d.copies + '</td>');
        $tr.append('<td><small>' + fmtTime(d.updated_at) + '</small></td>');
        $tr.append('<td nowrap>' +
          '<a class="btn btn-sm btn-outline-primary mr-1" href="/queue/new?label=' + d.label_id + '&draft=' + d._id + '" title="' + t('btn.open') + '"><i class="fas fa-folder-open fa-sm"></i></a>' +
          '<button class="btn btn-sm btn-outline-danger btn-draft-del" data-id="' + d._id + '" title="' + t('queue.draft_del') + '"><i class="fas fa-trash fa-sm"></i></button>' +
          '</td>');
        $tb.append($tr);
      });
    });
  }

  $('#draft-list').on('click', '.btn-draft-del', function() {
    var id = $(this).data('id');
    if (!confirm(t('confirm.delete_draft'))) return;
    $.ajax({
      url: '/rest/queue/drafts/' + id,
      type: 'delete',
      success: function() { toastr.info(t('msg.draft_deleted')); loadDrafts(); },
      error: function(x) { toastr.error(x.responseText || t('msg.delete_failed')); }
    });
  });

  loadQueue();
  loadDrafts();
});
