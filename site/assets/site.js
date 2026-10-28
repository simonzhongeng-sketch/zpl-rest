/* zpl-rest project page — trilingual (zh / en / ar) with RTL support. */
(function () {
  'use strict';

  var ICONS = [
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h10M4 18h7"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M3 9h18"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="4"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="7" height="12" rx="1"/><rect x="14" y="6" width="7" height="12" rx="1"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h10"/><path d="M18 15l3 2-3 2"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/><rect x="4" y="7" width="16" height="9" rx="2"/><path d="M9 16v5h6v-5"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3h8v5H8zM4 8h16v13H4z"/><path d="M8 12h8M8 16h5"/></svg>'
  ];

  var DATA = {
    zh: {
      type: 'zh', dir: 'ltr',
      text: {
        'nav.features': '功能', 'nav.position': '打印位置', 'nav.shots': '截图', 'nav.start': '快速开始',
        'hero.eyebrow': '自托管 · 开源 · MIT',
        'hero.title': '从任意系统打印 Zebra 标签',
        'hero.lead': '保存 ZPL 模板，把 JSON 里的变量填进去，通过网络发给打印机。可视化编辑器、打印队列、打印位置微调、MCP 接口，一个本地服务全包。',
        'hero.download': '下载 v1.1.0', 'hero.source': '查看源码', 'hero.docs': '文档',
        'hero.b1': '免安装 exe + 便携包', 'hero.b2': '三语界面',
        'strip.ports': 'REST + Web UI（WS 18421 / MCP 18422）',
        'strip.tools': 'MCP 工具', 'strip.langs': '界面语言', 'strip.cloud': '外发数据 · 预览本地渲染',
        'features.title': '主要功能',
        'features.lead': '打印这件事需要的东西都在这里，不需要再写 socket 代码。',
        'pos.title': '打印位置：一条 ^LH 说清',
        'pos.lead': 'ZPL 每份格式只有一个原点。zpl-rest 从两个层级合成它，全部按毫米处理，只取整一次。',
        'pos.f1': '打印机基础原点', 'pos.f2': '左/上边距', 'pos.f3': '偏移 X/Y',
        'shots.title': '界面截图', 'shots.lead': '点开看大图，截图随界面语言切换。',
        'start.title': '快速开始', 'start.node': 'Node.js',
        'start.node.hint': '然后打开 http://localhost:18420',
        'start.win': 'Windows',
        'start.win.body': '下载 Release 里的单文件 exe 双击运行；装有企业终端防护的机器建议用便携目录包（加壳单文件可能被启发式查杀）。',
        'start.mcp': 'MCP 接入', 'start.mcp.body': 'AI 工具可以直接管理标签、渲染预览、驱动打印。',
        'foot.based': '基于上游 mrothenbuecher/zpl-rest 的定制版本',
        'foot.releases': '发布版本', 'foot.changes': '变更记录'
      },
      features: [
        ['REST API 管打印机与标签', '新增、修改、删除都走一套接口，脚本和 ERP 都能直接用。'],
        ['可视化 mm 网格编辑器', '文本、条码、QR/DataMatrix、方框、线条、色块，本地实时预览。'],
        ['打印位置微调', '标签边距/偏移加打印机基础原点，合成单条 ^LH，预览不带位移。'],
        ['多列模切介质', '一份设计横向平铺成整排，^PW 由卷宽决定，整排空白即数据结束。'],
        ['并行打印队列', '每台打印机同时一条在发、同机串行；离线只跳过自己，恢复后自动补打。'],
        ['网段自动发现', '跳过 APIPA 网卡，DHCP 换地址后按序列号重新找到打印机。'],
        ['内置 MCP 服务器', '16 个工具，AI 工具能管理标签、渲染预览、直接驱动打印。'],
        ['xlsx 批量导入', '表头即变量名，导入即入队，历史任务可重打。']
      ],
      pos: [
        ['标签位置微调', '四个页边距加 Offset X/Y。左/上与两个偏移参与定位，右/下仅作记录；偏移钳位到 20 mm 或标签尺寸的四分之一。'],
        ['打印机基础原点', '该机的装纸补偿，默认 1.5 / 0.8 mm（12dpmm 即 ^LH18,10），可按台覆盖，填 0 / 0 关闭。'],
        ['预览与打印分离', '预览恒为设计原样，^LH 只作用于实际输出——所见即所画。']
      ],
      shots: [
        ['dashboard.png', '仪表盘：打印统计与失败任务'],
        ['queue.png', '打印队列与历史'],
        ['label-editor.png', '标签编辑器：画布、属性、位置微调'],
        ['printer-position.png', '打印机设置：左侧位置 / 标签顶部位置']
      ]
    },

    en: {
      type: 'en', dir: 'ltr',
      text: {
        'nav.features': 'Features', 'nav.position': 'Print position', 'nav.shots': 'Screenshots', 'nav.start': 'Quick start',
        'hero.eyebrow': 'Self-hosted · Open source · MIT',
        'hero.title': 'Print Zebra labels from any system',
        'hero.lead': 'Store your ZPL templates, fill the variables from JSON and send the result to the printer over the network. Visual editor, print queue, position fine adjustment and an MCP server — all in one local service.',
        'hero.download': 'Download v1.1.0', 'hero.source': 'Source code', 'hero.docs': 'Docs',
        'hero.b1': 'portable exe + folder package', 'hero.b2': 'trilingual UI',
        'strip.ports': 'REST + Web UI (WS 18421 / MCP 18422)',
        'strip.tools': 'MCP tools', 'strip.langs': 'UI languages', 'strip.cloud': 'data sent out · previews render locally',
        'features.title': 'Features',
        'features.lead': 'Everything printing needs, without writing socket code again.',
        'pos.title': 'Print position: one ^LH, explained',
        'pos.lead': 'ZPL has exactly one origin per format. zpl-rest composes it from two levels, all in millimetres, rounded to dots once.',
        'pos.f1': 'printer base origin', 'pos.f2': 'left/top margin', 'pos.f3': 'offset X/Y',
        'shots.title': 'Screenshots', 'shots.lead': 'Click to enlarge — screenshots follow the UI language.',
        'start.title': 'Quick start', 'start.node': 'Node.js',
        'start.node.hint': 'Then open http://localhost:18420',
        'start.win': 'Windows',
        'start.win.body': 'Take the single-file exe from the release and double-click it. On machines with an enterprise endpoint agent, prefer the portable folder package — a packed binary may be killed heuristically.',
        'start.mcp': 'MCP access', 'start.mcp.body': 'AI tools can manage labels, render previews and drive printing directly.',
        'foot.based': 'customised fork of the upstream mrothenbuecher/zpl-rest',
        'foot.releases': 'Releases', 'foot.changes': 'Changelog'
      },
      features: [
        ['REST API for printers and labels', 'One set of endpoints for create, update and delete — scripts and ERPs use it directly.'],
        ['Visual mm-grid editor', 'Text, barcodes, QR/DataMatrix, boxes, lines and blocks with a live local preview.'],
        ['Print position fine adjustment', 'Label margins and offset plus a per-printer base origin, compiled into a single ^LH; previews stay unshifted.'],
        ['Multi-column die-cut media', 'One design tiled into a row, ^PW from the roll width, a blank row ends the data.'],
        ['Parallel print queue', 'One job in flight per printer, serial within a printer; an offline printer only skips itself and catches up later.'],
        ['Subnet discovery', 'Ignores APIPA adapters and re-finds a printer by serial number after a DHCP change.'],
        ['Built-in MCP server', '16 tools so AI agents can manage labels, render previews and print.'],
        ['xlsx batch import', 'Headers become variables, the import enqueues, and history can be reprinted.']
      ],
      pos: [
        ['Label fine adjustment', 'Four page margins plus Offset X/Y. The left/top margins and both offsets move the print position; right/bottom are a note only; offsets clamp to 20 mm or a quarter of the label.'],
        ['Printer base origin', 'That machine\'s media-loading compensation, default 1.5 / 0.8 mm (= ^LH18,10 at 12dpmm). Override per printer, or 0 / 0 to disable.'],
        ['Preview vs. print', 'Previews always show the design as drawn; ^LH only affects the printed output.']
      ],
      shots: [
        ['dashboard.png', 'Dashboard: print statistics and failures'],
        ['queue.png', 'Print queue and history'],
        ['label-editor.png', 'Label editor: canvas, properties, fine adjustment'],
        ['printer-position.png', 'Printer settings: left position / label top position']
      ]
    },

    ar: {
      type: 'ar', dir: 'rtl',
      text: {
        'nav.features': 'المزايا', 'nav.position': 'موضع الطباعة', 'nav.shots': 'لقطات', 'nav.start': 'البدء السريع',
        'hero.eyebrow': 'ذاتيّ الاستضافة · مفتوح المصدر · MIT',
        'hero.title': 'اطبع ملصقات Zebra من أي نظام',
        'hero.lead': 'احفظ قوالب ZPL، واملأ المتغيّرات من JSON، وأرسل الناتج إلى الطابعة عبر الشبكة. محرّر مرئي وطابور طباعة وضبط دقيق للموضع وخادم MCP — كل ذلك في خدمة محلية واحدة.',
        'hero.download': 'تنزيل الإصدار 1.1.0', 'hero.source': 'الشيفرة المصدرية', 'hero.docs': 'التوثيق',
        'hero.b1': 'ملف exe + حزمة مجلد محمولة', 'hero.b2': 'واجهة بثلاث لغات',
        'strip.ports': 'REST + واجهة الويب (WS 18421 / MCP 18422)',
        'strip.tools': 'أدوات MCP', 'strip.langs': 'لغات الواجهة', 'strip.cloud': 'بيانات تُرسل للخارج · المعاينة محلية',
        'features.title': 'المزايا',
        'features.lead': 'كل ما تحتاجه الطباعة، دون كتابة شيفرة socket مرة أخرى.',
        'pos.title': 'موضع الطباعة: تعليمة ^LH واحدة',
        'pos.lead': 'تحتوي ZPL على نقطة أصل واحدة لكل تنسيق. يبنيها zpl-rest من مستويين، بالمليمتر، ويقرّبها إلى نقاط مرة واحدة.',
        'pos.f1': 'نقطة الأصل الأساسية', 'pos.f2': 'هامش اليسار/الأعلى', 'pos.f3': 'الإزاحة X/Y',
        'shots.title': 'لقطات الشاشة', 'shots.lead': 'اضغط للتكبير — اللقطات تتبع لغة الواجهة.',
        'start.title': 'البدء السريع', 'start.node': 'Node.js',
        'start.node.hint': 'ثم افتح http://localhost:18420',
        'start.win': 'Windows',
        'start.win.body': 'نزّل ملف exe من صفحة الإصدارات وشغّله بالنقر المزدوج. على الأجهزة التي تعمل عليها أدوات حماية مؤسسية يُفضَّل المجلد المحمول، فقد يُنهى الملف المُغلَّف استنادًا إلى قواعد استكشافية.',
        'start.mcp': 'الوصول عبر MCP', 'start.mcp.body': 'تستطيع أدوات الذكاء الاصطناعي إدارة الملصقات وعرض المعاينات والطباعة مباشرةً.',
        'foot.based': 'نسخة مخصّصة من مشروع mrothenbuecher/zpl-rest',
        'foot.releases': 'الإصدارات', 'foot.changes': 'سجلّ التغييرات'
      },
      features: [
        ['واجهة REST للطابعات والملصقات', 'مجموعة واحدة من نقاط النهاية للإضافة والتعديل والحذف، تستخدمها السكربتات وأنظمة ERP مباشرةً.'],
        ['محرّر مرئي بشبكة مليمترية', 'نصوص وباركود وQR/DataMatrix وإطارات وخطوط ومساحات مع معاينة محلية فورية.'],
        ['ضبط دقيق لموضع الطباعة', 'هوامش وإزاحة للملصق مع نقطة أصل لكل طابعة، تُدمج في ^LH واحدة، والمعاينة تبقى دون إزاحة.'],
        ['وسائط متعدّدة الأعمدة', 'تصميم واحد يُكرَّر أفقيًا في صف، و^PW من عرض البكرة، والصف الفارغ ينهي البيانات.'],
        ['طابور طباعة متوازٍ', 'مهمة واحدة قيد الإرسال لكل طابعة وتسلسل داخلها؛ والطابعة غير المتصلة تتخطّى نفسها ثم تُكمل لاحقًا.'],
        ['اكتشاف تلقائي في الشبكة', 'يتجاهل بطاقات APIPA ويعيد إيجاد الطابعة بالرقم التسلسلي بعد تغيّر عنوان DHCP.'],
        ['خادم MCP مدمج', '16 أداة تتيح لوكلاء الذكاء الاصطناعي إدارة الملصقات وعرض المعاينات والطباعة.'],
        ['استيراد دفعي من xlsx', 'رؤوس الأعمدة تصبح متغيّرات، والاستيراد يُدرج في الطابور، والسجلّ قابل لإعادة الطباعة.']
      ],
      pos: [
        ['الضبط الدقيق للملصق', 'أربعة هوامش صفحة مع Offset X/Y. هامش اليسار/الأعلى والإزاحتان يؤثّران على الموضع، وهامش اليمين/الأسفل للتوثيق فقط؛ والإزاحة تُقيَّد بـ 20 مم أو ربع مقاس الملصق.'],
        ['نقطة الأصل الأساسية للطابعة', 'تعويض تحميل الوسيط لتلك الآلة، افتراضيًا 1.5 / 0.8 مم (= ^LH18,10 عند 12dpmm). يمكن تجاوزه لكل طابعة أو تعطيله بـ 0 / 0.'],
        ['المعاينة مقابل الطباعة', 'المعاينة تُظهر التصميم كما رُسم دائمًا، و^LH تؤثّر على ناتج الطباعة فقط.']
      ],
      shots: [
        ['dashboard.png', 'لوحة المعلومات: إحصاءات الطباعة والإخفاقات'],
        ['queue.png', 'طابور الطباعة والسجلّ'],
        ['label-editor.png', 'محرّر الملصقات: اللوحة والخصائص والضبط الدقيق'],
        ['printer-position.png', 'إعدادات الطابعة: موضع اليسار / أعلى الملصق']
      ]
    }
  };

  var current = 'zh';

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function renderCards() {
    var d = DATA[current];

    var host = document.getElementById('feature-cards');
    host.innerHTML = '';
    d.features.forEach(function (f, i) {
      var c = el('article', 'card');
      c.appendChild(el('div', 'ico', ICONS[i] || ICONS[0]));
      c.appendChild(el('h3', null, f[0]));
      c.appendChild(el('p', null, f[1]));
      host.appendChild(c);
    });

    var pos = document.getElementById('pos-items');
    pos.innerHTML = '';
    d.pos.forEach(function (p) {
      var c = el('article', 'card');
      c.appendChild(el('h3', null, p[0]));
      c.appendChild(el('p', null, p[1]));
      pos.appendChild(c);
    });

    var shots = document.getElementById('shots');
    shots.innerHTML = '';
    d.shots.forEach(function (s) {
      var a = el('a', 'shot');
      a.href = 'img/' + current + '/' + s[0];
      a.target = '_blank';
      a.rel = 'noopener';
      var img = el('img');
      img.src = 'img/' + current + '/' + s[0];
      img.alt = s[1];
      img.loading = 'lazy';
      a.appendChild(img);
      var fig = el('figure', 'shot');
      fig.appendChild(a);
      var cap = el('figcaption', null, s[1]);
      fig.appendChild(cap);
      fig.style.margin = '0';
      shots.appendChild(fig);
    });
  }

  function setLang(lang) {
    if (!DATA[lang]) lang = 'zh';
    current = lang;
    var d = DATA[lang];

    document.documentElement.lang = d.type;
    document.documentElement.dir = d.dir;
    document.title = lang === 'zh'
      ? 'zpl-rest — 从任意系统打印 Zebra 标签'
      : (lang === 'ar' ? 'zpl-rest — اطبع ملصقات Zebra من أي نظام' : 'zpl-rest — Print Zebra labels from any system');

    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute('data-i18n');
      if (d.text[key]) nodes[i].textContent = d.text[key];
    }

    var btns = document.querySelectorAll('.langs button');
    for (var j = 0; j < btns.length; j++) {
      btns[j].classList.toggle('on', btns[j].getAttribute('data-lang') === lang);
    }

    renderCards();
    try { localStorage.setItem('site-lang', lang); } catch (e) {}
  }

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('.langs button') : null;
    if (b) setLang(b.getAttribute('data-lang'));
  });

  var saved = null;
  try { saved = localStorage.getItem('site-lang'); } catch (e) {}
  var nav = (navigator.language || 'zh').toLowerCase();
  setLang(saved || (nav.indexOf('zh') === 0 ? 'zh' : (nav.indexOf('ar') === 0 ? 'ar' : 'en')));
})();
