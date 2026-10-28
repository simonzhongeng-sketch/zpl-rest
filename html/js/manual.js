// Renders /manual from window.MANUAL_CONTENT: sticky table of contents on the
// left, one card per section on the right, a keyword filter above the TOC and
// a scroll-spy highlight. Language comes from i18n (window.__LANG); missing
// languages fall back to English, same as I18N.t().
(function() {
  function pickPack() {
    var lang = window.__LANG || document.documentElement.getAttribute('lang') || 'en';
    var all = window.MANUAL_CONTENT || {};
    return all[lang] || all.en || { toc: '', search_ph: '', no_result: '', sections: [] };
  }

  function el(tag, className, html) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  function render() {
    var root = document.getElementById('manual-root');
    if (!root) return;
    var pack = pickPack();
    var sections = pack.sections || [];
    if (!sections.length) return;

    var toc = document.getElementById('manual-toc');
    var body = document.getElementById('manual-body');
    var search = document.getElementById('manual-search');
    var empty = document.getElementById('manual-empty');
    if (!toc || !body) return;

    toc.innerHTML = '';
    body.innerHTML = '';
    if (search) {
      search.setAttribute('placeholder', pack.search_ph || '');
      search.setAttribute('data-empty', '');
    }
    if (empty) {
      empty.textContent = pack.no_result || '';
      empty.style.display = 'none';
    }

    var links = [];
    sections.forEach(function(sec) {
      var a = el('a', 'manual-toc-link', '<i class="fas fa-fw ' + sec.icon + ' mr-2"></i><span></span>');
      a.href = '#sec-' + sec.id;
      a.setAttribute('data-target', 'sec-' + sec.id);
      a.querySelector('span').textContent = sec.title;
      toc.appendChild(a);
      links.push(a);

      var card = el('div', 'card shadow mb-4 manual-section');
      card.id = 'sec-' + sec.id;
      var head = el('div', 'card-header py-3');
      head.innerHTML = '<h6 class="m-0 font-weight-bold text-primary"><i class="fas fa-fw ' +
        sec.icon + ' mr-2"></i><span>' + esc(sec.title) + '</span></h6>';
      var cardBody = el('div', 'card-body manual-body', sec.html);
      card.appendChild(head);
      card.appendChild(cardBody);
      body.appendChild(card);
    });

    // keyword filter: hide sections (and their TOC entries) that do not match
    if (search) {
      search.addEventListener('input', function() {
        var q = search.value.trim().toLowerCase();
        var shown = 0;
        sections.forEach(function(sec, i) {
          var card = document.getElementById('sec-' + sec.id);
          var hit = !q || (sec.title + ' ' + (card ? card.textContent : '')).toLowerCase().indexOf(q) !== -1;
          if (card) card.style.display = hit ? '' : 'none';
          if (links[i]) links[i].style.display = hit ? '' : 'none';
          if (hit) shown++;
        });
        if (empty) empty.style.display = shown ? 'none' : '';
      });
    }

    // scroll-spy: highlight the section currently under the top of the viewport
    var ticking = false;
    function sync() {
      ticking = false;
      var current = links[0];
      sections.forEach(function(sec, i) {
        var card = document.getElementById('sec-' + sec.id);
        if (!card || card.style.display === 'none') return;
        if (card.getBoundingClientRect().top <= 140) current = links[i];
      });
      links.forEach(function(a) { a.classList.toggle('active', a === current); });
      // when the TOC has its own scrollbar, keep the active entry in view
      var scroller = current && current.closest('.card-body');
      if (scroller && scroller.scrollHeight > scroller.clientHeight) {
        var ar = current.getBoundingClientRect();
        var sr = scroller.getBoundingClientRect();
        if (ar.top < sr.top || ar.bottom > sr.bottom) {
          current.scrollIntoView({ block: 'nearest' });
        }
      }
    }
    window.addEventListener('scroll', function() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(sync);
    }, { passive: true });
    sync();
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // i18n.js registers its own ready handler first (it is loaded earlier), so
  // window.__LANG is already resolved when this runs
  if (window.jQuery) {
    jQuery(function() { render(); });
  } else {
    document.addEventListener('DOMContentLoaded', render);
  }
})();
