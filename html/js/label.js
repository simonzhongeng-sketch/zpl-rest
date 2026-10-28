// Label list page: search, new (-> editor page), edit (-> editor page), delete.
$(document).ready(function() {

  var labels = [];
  var printers = {}; // id -> printer record

  function load() {
    $.when($.getJSON('/rest/label'), $.getJSON('/rest/printer')).then(function(l, p) {
      labels = l[0];
      printers = {};
      p[0].forEach(function(pr) { printers[pr._id] = pr; });
      render();
    });
  }

  function render() {
    var q = ($('#label-search').val() || '').toLowerCase();
    var $tb = $('#label-table tbody').empty();

    labels
      .filter(function(l) {
        if (!q) return true;
        var bound = printers[l.printer_id];
        return (l.name || '').toLowerCase().indexOf(q) !== -1 ||
               (bound && bound.name.toLowerCase().indexOf(q) !== -1);
      })
      .sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); })
      .forEach(function(l) {
        var pr = printers[l.printer_id];
        var $tr = $('<tr/>');

        var $name = $('<td/>').text(l.name || '');
        $tr.append($name);

        $tr.append('<td><span dir="ltr">' + l.width + ' x ' + l.height + '</span></td>');

        var type = l.type === 'visual' ? 'Visual' : 'ZPL';
        $tr.append('<td><span class="badge badge-' + (l.type === 'visual' ? 'success' : 'secondary') + '">' + type + '</span></td>');

        var $pr = $('<td/>');
        if (pr) {
          $pr.append($('<span class="badge badge-primary mr-1"/>').text(pr.name));
        } else {
          $pr.append('<span class="text-muted">not bound</span>');
        }
        $tr.append($pr);

        var $act = $('<td/>');
        var $edit = $('<button class="btn btn-sm btn-primary mr-1"/>').text(t('btn.edit'));
        $edit.on('click', function() { location.href = '/label/edit?id=' + l._id; });
        var $del = $('<button class="btn btn-sm btn-danger"/>').text(t('btn.delete'));
        $del.on('click', function() {
          if (!confirm(t('confirm.delete_label', {name: l.name || ''}))) return;
          $.ajax({
            url: '/rest/label/' + l._id,
            type: 'delete',
            success: function() {
              toastr.info(t('msg.label_deleted'));
              load();
            },
            error: function() {
              toastr.error(t('msg.delete_failed'));
            }
          });
        });
        $act.append($edit, $del);
        $tr.append($act);

        $tb.append($tr);
      });

    if (!$tb.children().length) {
      $tb.append('<tr><td colspan="5" class="text-center text-muted">no labels found</td></tr>');
    }
  }

  $('#label-search').on('input', render);

  $('#new-label').on('click', function() {
    location.href = '/label/edit';
  });

  // refresh list when a label changes in another tab (websocket broadcast)
  if (typeof WSClient !== 'undefined') {
    // websocket.js may expose hooks; safe-guarded below
  }
  try {
    var sock = new WebSocket('ws://' + location.hostname + ':' + config.websocket_port);
    sock.onmessage = function(msg) {
      try {
        var d = JSON.parse(msg.data);
        if (d.source === 'label') load();
      } catch (e) {}
    };
  } catch (e) {}

  load();
});
