// i18n core: extensible locale registry + client-side translation.
//
// Add a new language in three steps (no other code changes needed):
//   1. create html/js/locales/<lang>.js  ->  I18N.register('<lang>', { key: '...' });
//   2. add <script src="js/locales/<lang>.js"></script> to every view
//      (next to the other locale includes)
//   3. add an <option> to the language selector in I18N.LANGS below
//
// Views mark static text with data-i18n="key" (text nodes only, icons and
// child elements are preserved), data-i18n-placeholder / data-i18n-title for
// attributes. Dynamic strings in page scripts use t('key').
(function() {
  var LOCALES = {};
  // supported languages: [code, native label shown in the selector]
  var LANGS = [
    ['en', 'English'],
    ['zh', '中文'],
    ['ar', 'العربية']
  ];
  var DEFAULT_LANG = 'en';

  function detectLang() {
    // url ?lang= wins (easy to share/bookmark), then saved choice, then default
    var urlLang = new URLSearchParams(window.location.search).get('lang');
    if (urlLang && LOCALES[urlLang]) return urlLang;
    var saved = localStorage.getItem('lang');
    if (saved && LOCALES[saved]) return saved;
    return DEFAULT_LANG;
  }

  function t(key, vars) {
    var lang = window.__LANG || DEFAULT_LANG;
    var dict = LOCALES[lang] || {};
    var s = dict[key];
    if (s === undefined) s = (LOCALES[DEFAULT_LANG] || {})[key];
    if (s === undefined) s = key;
    if (vars) {
      Object.keys(vars).forEach(function(k) {
        s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
      });
    }
    return s;
  }

  // translate an element's own text nodes, keep child elements (icons etc.)
  function translateEl(el, val) {
    var replaced = false;
    var nodes = Array.prototype.slice.call(el.childNodes);
    nodes.forEach(function(n) {
      if (n.nodeType === 3 && n.nodeValue.replace(/\u00a0/g, ' ').trim()) {
        if (!replaced) { n.nodeValue = '\u00a0' + val + '\u00a0'; replaced = true; }
        else n.nodeValue = '';
      }
    });
    if (!replaced) el.textContent = val;
  }

  function applyI18n() {
    var lang = window.__LANG || DEFAULT_LANG;
    document.documentElement.setAttribute('lang', lang);
    // Arabic reads right-to-left; SB Admin 2 uses a flex layout so the
    // sidebar flips to the right automatically, custom.css fixes the rest
    document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');

    // browser tab title: translate directly (translateEl pads text nodes with
    // nbsp for button layouts, which would pollute the tab caption)
    var titleEl = document.querySelector('title[data-i18n]');
    if (titleEl) document.title = t(titleEl.getAttribute('data-i18n'));

    document.querySelectorAll('[data-i18n]').forEach(function(el) {
      if (el.tagName === 'TITLE') return; // handled above without nbsp padding
      translateEl(el, t(el.getAttribute('data-i18n')));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function(el) {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });

    // keep the sidebar selector in sync
    var sel = document.getElementById('lang-select');
    if (sel) sel.value = lang;
  }

  // language selector on the right side of the page heading row, next to the
  // existing action buttons (e.g. right of the timespan selector on Dashboard)
  function injectLangSelector() {
    if (document.getElementById('lang-select')) return;
    var heading = document.querySelector('.container-fluid .d-sm-flex.align-items-center.justify-content-between.mb-4');
    if (!heading) return;
    // sit next to the existing right-side actions so the selector is always
    // at the far right of the heading row:
    //   - plain flex DIV container (e.g. the button group) -> append inside it
    //   - other action elements (bare button/anchor, or a d-none wrapper like
    //     the Dashboard timespan) -> wrap both into a flex group, otherwise
    //     justify-content-between would push the action to the middle
    //   - only the H1 title (or nothing) on the right -> append directly to
    //     the row, justify-content-between pushes the selector to the far
    //     right (the H1 itself must never be wrapped)
    var last = heading.lastElementChild;
    var bar = document.createElement('span');
    bar.id = 'lang-bar';
    bar.className = 'd-flex align-items-center';
    var icon = document.createElement('i');
    icon.className = 'fas fa-globe text-gray-400';
    var sel = document.createElement('select');
    sel.id = 'lang-select';
    sel.className = 'lang-select';
    LANGS.forEach(function(l) {
      var o = document.createElement('option');
      o.value = l[0];
      o.textContent = l[1];
      sel.appendChild(o);
    });
    bar.appendChild(icon);
    bar.appendChild(sel);
    if (last && last.tagName === 'DIV' && !last.classList.contains('d-none')) {
      last.appendChild(bar);
    } else if (last && last.tagName !== 'H1') {
      var group = document.createElement('div');
      group.className = 'd-flex align-items-center';
      heading.replaceChild(group, last);
      group.appendChild(last);
      group.appendChild(bar);
    } else {
      heading.appendChild(bar);
    }
    sel.addEventListener('change', function() {
      localStorage.setItem('lang', sel.value);
      // report the choice so the server side follows it too: the tray
      // right-click menu switches to the same language (fire and forget —
      // the page reload below must not wait for or fail on this)
      try {
        fetch('/rest/lang', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lang: sel.value })
        }).catch(function() {});
      } catch (e) { /* older browsers: tray just keeps the last language */ }
      // navigate with ?lang= instead of a plain reload: a changed URL forces
      // Chrome to fetch the document again (bypasses its in-memory cache of
      // stale HTML), and the url param has top priority in detectLang()
      window.location.replace(window.location.pathname + '?lang=' + encodeURIComponent(sel.value));
    });
  }

  window.I18N = {
    register: function(code, dict) { LOCALES[code] = dict; },
    LANGS: LANGS,
    t: t,
    apply: function() {
      window.__LANG = detectLang();
      injectLangSelector();
      applyI18n();
    }
  };

  window.t = function(key, vars) { return window.I18N.t(key, vars); };

  // runs when jquery is ready (jquery is always loaded before this script)
  if (window.jQuery) {
    jQuery(function() { window.I18N.apply(); });
  } else {
    document.addEventListener('DOMContentLoaded', function() { window.I18N.apply(); });
  }
})();
