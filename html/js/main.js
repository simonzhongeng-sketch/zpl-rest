$(document).ready(function() {
  // always start at the top of the page: browsers restore the last scroll
  // position per URL, which made revisiting a page (e.g. Queue) jump to the
  // bottom where the user left off
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);

  updatePrinterDropdown();
  updateLabelDropdown();

  // timespan label: always translated (dashboard "last N hours/days" picker);
  // only the label span is replaced so its data-i18n binding stays intact
  var timespanKeys = { 24: 'dash.ts24', 168: 'dash.ts7d', 720: 'dash.ts30d' };
  function setTimespanLabel(hours) {
    $('#timespan-label').text(t(timespanKeys[hours] || 'dash.ts24'));
  }
  setTimespanLabel($('#timespan').data("time"));

  $('.time-item').click(function() {
    $this = $(this);
    var hours = parseInt($this.data("time"));
    setTimespanLabel(hours);
    $('#timespan').data("time", hours);

    $.ajax({
      url: "/rest/timespan/"+hours,
      type: 'post',
      contentType: 'application/json',
      dataType: 'json',
      error: function(data) {
        toastr.error(t('msg.update_timespan_failed'))
      }
    });

    if(typeof changeTimespan === "function")
      changeTimespan(hours);
  });

  $('.copy-button').click(function(){
    $this = $(this);
    if(!$this.data("target")){
      toastr.error(t('msg.no_copy_target'))
      return;
    }

    var element = "#"+$this.data("target");
    var $temp = $("<input>");
    $("body").append($temp);
    $temp.val($(element).val()).select();
    document.execCommand("copy");
    $temp.remove();
    toastr.info(t('msg.copied'));
  });

});

function updatePrinterDropdown() {
  $('.printer-dropdown').html("");
  $('.printer-dropdown').each(function() {
    var $this = $(this);
    $.getJSON("/rest/printer", function(data) {
      $.each(data, function(index, value) {
        $this.append('<a class="dropdown-item" data-id="'+value._id+'" href="#">'+value.name+' - '+value.address+'</a>');
      });
    });
  });
}

function updateLabelDropdown() {
  $('.label-dropdown').html("");
  $('.label-dropdown').each(function() {
    var $this = $(this);
    $.getJSON("/rest/label", function(data) {
      $.each(data, function(index, value) {
        $this.append('<a class="dropdown-item" data-id="'+value._id+'" href="#">'+value.name+'</a>');
      });
    });
  });

}
