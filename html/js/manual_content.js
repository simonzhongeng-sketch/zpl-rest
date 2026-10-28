// Manual content, kept out of the locale files on purpose: a manual is long
// form text with tables and code samples, not short UI labels.
//
// Each section is rendered into /manual as a card; the TOC and the search box
// are generated from this list (see manual.js). Missing languages fall back to
// English, which is also the i18n default.
(function() {
  var zh = {
    toc: '目录',
    search_ph: '搜索手册内容，例如：浓度、多列、MCP…',
    no_result: '没有匹配的章节，换个关键词试试。',
    sections: [
      {
        id: 'start',
        icon: 'fa-rocket',
        title: '快速开始',
        html: '' +
          '<p>本软件是一套 ZPL 标签打印服务：把打印机、标签模板和打印任务集中在一台电脑上管理，其他电脑、脚本或 AI 客户端通过网页、REST 接口、MCP 调用它来打印。</p>' +
          '<div class="alert alert-info py-2 mb-3"><b>第一次使用请按顺序配置：</b>打印机 → 标签 → 打印队列。标签必须绑定一台打印机，队列才能出纸。</div>' +
          '<h6 class="manual-h">三个入口</h6>' +
          '<table class="table table-sm table-bordered manual-table"><thead><tr><th style="width:34%">入口</th><th>用途</th></tr></thead><tbody>' +
          '<tr><td><code>http://&lt;服务器IP&gt;:18420</code></td><td>网页界面与 REST 接口（默认 18420）</td></tr>' +
          '<tr><td><code>ws://&lt;服务器IP&gt;:18421</code></td><td>WebSocket，推送打印机在线状态、队列进度、任务找回事件</td></tr>' +
          '<tr><td><code>http://&lt;服务器IP&gt;:18422/mcp</code></td><td>MCP 服务，供 AI 客户端调用（可选）</td></tr>' +
          '</tbody></table>' +
          '<h6 class="manual-h">启动方式</h6>' +
          '<ul>' +
          '<li><b>免安装 exe：</b>双击 <code>zpl-rest.exe</code> 即可，数据（<code>db/</code>）和 <code>config.json</code> 就放在 exe 旁边，整个文件夹可以整体拷走。</li>' +
          '<li><b>便携版（推荐企业电脑使用）：</b>文件夹内含官方 node 运行时，双击「启动.bat」启动，用法与 exe 相同。部分企业终端安全软件（如云枢）会误杀单文件 exe（扫描打印机时闪退且无报错），便携版不会；若安全软件仍拦截，请将本文件夹加入信任区/白名单。</li>' +
          '<li><b>源码运行：</b><code>npm install</code> 后执行 <code>node main.js</code>。</li>' +
          '<li>启动后自动打开浏览器，控制台窗口可以最小化但不要关闭，关闭即停止服务。</li>' +
          '<li>托盘图标右键菜单：<b>打开主页</b> / <b>复制 MCP 地址</b> / <b>关闭服务</b>。菜单文字跟随网页右上角选择的语言（英文/中文/阿拉伯语），切换后立即生效，选择会保存在 <code>config.json</code> 的 <code>ui_lang</code>。</li>' +
          '</ul>' +
          '<h6 class="manual-h">config.json 常用项</h6>' +
          '<table class="table table-sm table-bordered manual-table"><thead><tr><th style="width:30%">键</th><th style="width:14%">默认值</th><th>说明</th></tr></thead><tbody>' +
          '<tr><td><code>port</code></td><td>18420</td><td>网页与 REST 端口</td></tr>' +
          '<tr><td><code>websocket_port</code></td><td>18421</td><td>WebSocket 端口</td></tr>' +
          '<tr><td><code>mcp_port</code></td><td>18422</td><td>MCP 服务端口</td></tr>' +
          '<tr><td><code>mcp_token</code></td><td>空</td><td>留空=局域网内开放访问；填值后 MCP 请求必须带 <code>Authorization: Bearer &lt;token&gt;</code></td></tr>' +
          '<tr><td><code>tray</code></td><td>true</td><td>是否显示托盘图标</td></tr>' +
          '<tr><td><code>open_browser</code></td><td>true</td><td>启动时自动打开浏览器</td></tr>' +
          '<tr><td><code>discovery_interval</code></td><td>120</td><td>后台巡检打印机地址的间隔（秒，最小 30），用于 DHCP 换 IP 后自动找回</td></tr>' +
          '<tr><td><code>ui_lang</code></td><td>en</td><td>托盘菜单语言，跟随网页语言选择自动写入（en / zh / ar），无需手改</td></tr>' +
          '</tbody></table>' +
          '<p class="text-muted small mb-0">改完 config.json 需要重启服务生效。端口被占用时服务会提示并退出，先关掉占用端口的程序再启动。</p>'
      },
      {
        id: 'printer',
        icon: 'fa-print',
        title: '打印机管理',
        html: '' +
          '<p>所有打印机操作都在左侧「打印机」页面：自动扫描、手动创建、测试标签、重新查找、编辑与删除。</p>' +
          '<h6 class="manual-h">两种连接方式</h6>' +
          '<table class="table table-sm table-bordered manual-table"><thead><tr><th style="width:16%">方式</th><th style="width:32%">地址填写</th><th>适用场景</th></tr></thead><tbody>' +
          '<tr><td><b>网络 TCP</b></td><td><code>192.168.8.43:9100</code></td><td>打印机接网线或 Wi-Fi，直接向 9100 端口发 ZPL，最稳定、速度最快</td></tr>' +
          '<tr><td><b>USB</b></td><td>Windows 打印机名，如 <code>ZDesigner ZT510-300dpi ZPL(02)</code></td><td>打印机用 USB 线接在本机，经 Windows 打印后台以 RAW 方式发送</td></tr>' +
          '</tbody></table>' +
          '<p class="mb-2">新建时点「创建打印机」，先选 TCP 或 USB，再填地址；USB 下拉框会列出本机所有打印机，Zebra 驱动排在前面。填完点「测试标签」，能打出一张测试页说明链路通了。</p>' +
          '<h6 class="manual-h">打印机 IP 会变怎么办（DHCP）</h6>' +
          '<p>DHCP 环境下打印机断电重启后可能拿到新 IP，导致原来的地址离线。本软件用<b>序列号</b>认机器，不靠 IP 认机器：</p>' +
          '<ul>' +
          '<li>每台网络打印机保存后会自动读取机身序列号（如 <code>34J244300042</code>）。</li>' +
          '<li>点击「重新查找」会扫描本机所在网段，按序列号把新 IP 写回原记录，打印队列不受影响。</li>' +
          '<li>后台每 <code>discovery_interval</code> 秒自动巡检一次离线的网络打印机，找回后网页右下角提示并自动继续打印之前跳过的任务。</li>' +
          '<li>同名多台打印机时，序列号不同不会串台；如果扫描到两台序列号相同会判定为歧义，不做任何修改。</li>' +
          '</ul>' +
          '<p class="text-muted small">提示：打印机名称建议写上位置（如「包装线 ZT510」），搬机换 IP 后名称不会误导。</p>' +
          '<h6 class="manual-h">扫描不到打印机</h6>' +
          '<p>扫描按钮默认扫描<b>本机所有网卡</b>所在的 /24 网段（有线、无线都会扫，虚拟网卡/VPN 排在最后），并在结果为空时自动用两种方式复核一次。仍扫不到时按顺序排查：</p>' +
          '<ul>' +
          '<li><b>网段不对：</b>在「扫描网段」输入框里填打印机所在网段（如 <code>192.168.8</code>）再扫。多网卡电脑、或打印机在另一台交换机的网段时，必须手动指定。</li>' +
          '<li><b>网络不通：</b>在服务器上 <code>ping 打印机IP</code>，能通再扫；通了但扫不到，用浏览器打开 <code>http://打印机IP</code> 看是否是 Zebra 网页。</li>' +
          '<li><b>被安全软件拦截：</b>终端安全软件可能允许 PowerShell 启动却静默拦截它发起的连接，表现就是「扫了半天一个都没有」。把程序目录加白名单后重试；扫描会自动降级为 node 直连方式复核，两条路都被挡就只能加白。</li>' +
          '<li><b>看诊断：</b>浏览器打开 <code>http://本机IP:18420/rest/discover/diag</code>，能看到本机所有网卡、实际会扫哪个网段、上次扫描用的是 PowerShell 还是 node 兜底、扫到几个 9100 开放主机；加 <code>?probe=1</code> 还会实测一次 PowerShell 能否运行。</li>' +
          '<li>实在扫不到就直接「创建打印机」，填 <code>IP:9100</code>，能打测试页就行——扫描只是省事，不是必须。</li>' +
          '</ul>' +
          '<h6 class="manual-h">无线网卡的电脑扫不到（重点）</h6>' +
          '<p>用 Wi-Fi 的电脑扫不到打印机，多半不是软件问题，而是「这台电脑根本到不了打印机」。常见三种：</p>' +
          '<ul>' +
          '<li><b>无线客户端隔离（AP isolation）：</b>路由器/AP 禁止无线终端互访，能上网但看不到同网段的其他设备。访客网络（Guest SSID）几乎都这样。</li>' +
          '<li><b>Wi-Fi 与打印机不同网段/VLAN：</b>办公 Wi-Fi 常是 10.x 或 172.x 段，打印机在有线 192.168.8.x 段。扫描只会扫本机网段，自然什么都没有。</li>' +
          '<li><b>网络位置是「公用」且安全软件从严：</b>防火墙或终端安全软件拦截本程序的出站连接，PowerShell 能启动但连接被丢。</li>' +
          '</ul>' +
          '<p>用「连通测试」一步判断：在打印机页的测试框里填 <code>192.168.8.43</code>，点「测试连接」。</p>' +
          '<ul>' +
          '<li>显示<b>可连接</b>：网络没问题，扫不到就是软件侧，看下面的诊断地址。</li>' +
          '<li>显示<b>连不上 + ping 能通</b>：网络可达但 9100 被挡（打印机 Raw 端口关闭或防火墙拦截）。</li>' +
          '<li>显示<b>连不上 + ping 也不通</b>：不同网段/VLAN，或无线隔离。这种情况任何扫描都无能为力——请让网络管理员放通，或把服务器放到打印机所在网段。</li>' +
          '</ul>' +
          '<h6 class="manual-h">扫描到一部分，少了一台</h6>' +
          '<p>扫描结果下方有一行统计：「9100 端口开放 N 台，确认为 Zebra M 台」。少了某台时先看这一行，它直接说明漏在哪一步：</p>' +
          '<ul>' +
          '<li><b>N 比预期少</b>（扫描根本没摸到那台）：程序先并发扫一遍，再对系统 ARP 表里「二层可见但没应答」的地址逐个复核——所以网络慢、丢一两个 SYN 时也会补回来。仍缺就在「扫描网段」里指定该网段再扫一次，并用「连通测试」确认这个 IP 此刻能不能连上。</li>' +
          '<li><b>N 够、M 比 N 少</b>（摸到了但没认出来）：该设备开放了 9100，但网页里没有 Zebra 字样，或网页 2 秒内没应答。程序出于安全<b>不会</b>向未确认的设备发送任何数据（非 Zebra 设备会直接把收到的内容打出来），因此不列出。可在「连通测试」里核实，或按型号手动「创建打印机」。</li>' +
          '<li>用 Wi-Fi 的电脑在打印机多、网络忙时偶尔漏一台，直接再点一次扫描通常就补齐了。</li>' +
          '</ul>' +
          '<h6 class="manual-h">打印浓度与介质</h6>' +
          '<p>打印深浅由<b>面板浓度</b>和 ZPL 里的 <code>^MD</code> 偏移共同决定，总浓度 = 面板浓度 + MD。同一型号不同机器面板基准可能不同，必须按台校准。</p>' +
          '<ul>' +
          '<li>直热（热敏纸）：指令 <code>^MTD</code>，总浓度目标约 30。</li>' +
          '<li>热转印（色带）：指令 <code>^MTT</code>，总浓度通常低于直热，按实际目测定。</li>' +
          '<li><code>^MD0</code> 表示完全跟随面板基准，负数表示在面板基础上调淡。</li>' +
          '</ul>' +
          '<div class="alert alert-warning py-2 mb-0"><b>两个典型故障：</b>① 字发糊、边缘糊成一片 → 浓度过高或速度太快，先降 MD；② 色带出现针孔状破洞 → 热转印机被当成直热发指令（<code>^MTD</code> 能量过高烧穿色带），把介质类型改成热转印。</div>'
      },
      {
        id: 'label',
        icon: 'fa-tags',
        title: '标签模板',
        html: '' +
          '<p>「标签」页是模板列表：支持搜索、新增、删除，点行进入编辑页。编辑页可以做可视化设计、填变量、预览、测试打印，右上角还有<b>导入 / 导出 JSON</b>。</p>' +
          '<h6 class="manual-h">尺寸与变量</h6>' +
          '<ul>' +
          '<li>标签宽高一律用 <b>毫米（mm）</b>，输入 84.8 × 23.8 就是一张 84.8mm 宽、23.8mm 高的标签；内部按打印机 dpi 换算成点，不用你操心。</li>' +
          '<li>变量写成 <code>${name}</code>，打印时按名字填值；同一个变量可以在模板里出现多次。</li>' +
          '<li>每张标签必须绑定一台打印机，绑定后打印设置会默认套用该机参数。</li>' +
          '</ul>' +
          '<h6 class="manual-h">可视化编辑器元素</h6>' +
          '<table class="table table-sm table-bordered manual-table"><thead><tr><th style="width:22%">元素</th><th>说明</th></tr></thead><tbody>' +
          '<tr><td>文本 text</td><td>单行文字，可设字高、旋转</td></tr>' +
          '<tr><td>多行块 block</td><td>自动换行的段落，指定宽高与行数</td></tr>' +
          '<tr><td>一维码 barcode</td><td>Code128 等常用码制</td></tr>' +
          '<tr><td>二维码 qrcode</td><td>可设纠错等级（默认 M）</td></tr>' +
          '<tr><td>DataMatrix</td><td>小面积高密度码</td></tr>' +
          '<tr><td>Code39</td><td>老系统常见的字母数字码</td></tr>' +
          '<tr><td>反白文本 text_rev</td><td>黑底白字</td></tr>' +
          '<tr><td>日期时间 datetime</td><td>打印时取当前时间</td></tr>' +
          '<tr><td>方框 box / 直线 line</td><td>边框、分隔线</td></tr>' +
          '</tbody></table>' +
          '<p>也可以直接在「原始 ZPL」里写模板，两种方式随时切换、互不影响。</p>' +
          '<h6 class="manual-h">每排多列（小标签）</h6>' +
          '<p>一张纸排 3 枚小标这类介质，在编辑页把「每排列数」设为 3、行数设 0（连续卷）或实际行数。设置后：</p>' +
          '<ul>' +
          '<li>填多个值时按<b>每 3 个一排</b>自动拆成多条任务，不是一次性把整卷发下去，避免走纸错位。</li>' +
          '<li>某一排全为空白即视为数据结束，后面不再打；最后一排不满 3 个也照打，空位留白。</li>' +
          '<li>模板只有一个变量槽位时，系统会把模板横向复制 3 份铺满一排。</li>' +
          '</ul>' +
          '<h6 class="manual-h">打印设置优先级</h6>' +
          '<p>标签上的设置优先，没设的项回落到打印机默认值。换绑定打印机时，界面会自动套用新机器的浓度、速度、介质类型并提示。</p>' +
          '<h6 class="manual-h">导入导出</h6>' +
          '<p>编辑页「导出」会把当前模板（含元素、变量、打印设置、版式）存成一个 <code>zpl-label-&lt;名称&gt;.json</code> 文件，方便备份和在另一台服务器上复用；「导入」读取这种 JSON 放进编辑器，<b>不会自动保存</b>，确认无误后自己点保存。</p>' +
          '<p class="text-muted small mb-0">预览是本地渲染（WASM），标签内容不会发到任何外部服务。</p>'
      },
      {
        id: 'queue',
        icon: 'fa-list-ol',
        title: '打印队列',
        html: '' +
          '<p>「打印队列」页记录所有任务：草稿、待打印、打印中、已完成历史和失败记录。点「添加打印队列」进入新建页（<code>/queue/new</code>）。</p>' +
          '<h6 class="manual-h">三种录入方式</h6>' +
          '<ul>' +
          '<li><b>单条：</b>每个变量一个输入框，填完可以看实时预览，点「单条添加」暂存。</li>' +
          '<li><b>批量 xlsx：</b>点「批量添加」先下载模板（首行是变量名），填好数据上传，点「添加任务」一次性暂存多行。</li>' +
          '<li><b>草稿：</b>暂存区点「保存草稿」，下次在队列页打开继续，适合当天没打完的批次。</li>' +
          '</ul>' +
          '<p>暂存区支持勾选、按序号区间选择，确认打印机无误后点「全部入队」或「打印选中」正式进入打印队列。</p>' +
          '<div class="alert alert-warning py-2"><b>注意：</b>草稿和暂存任务的打印机是<b>添加时快照</b>的，之后在页面上换下拉框不会改动已暂存的任务。打之前务必确认列表里的打印机列。</div>' +
          '<h6 class="manual-h">并行打印</h6>' +
          '<ul>' +
          '<li>不同打印机之间<b>同时</b>触发，互不排队；标题旁徽标实时显示「并行打印中：N 台」。</li>' +
          '<li>同一台打印机内部严格串行，按入队顺序一条一条发，保证走纸不打架。</li>' +
          '<li>某台离线只跳过它自己的任务（5 秒冷却），其他机器照常工作；恢复在线后自动补打，不需要手工重排。</li>' +
          '<li>需要整体停一下时用「暂停」，恢复后继续。</li>' +
          '</ul>' +
          '<h6 class="manual-h">任务状态与操作</h6>' +
          '<table class="table table-sm table-bordered manual-table"><thead><tr><th style="width:18%">状态</th><th style="width:36%">含义</th><th>可用操作</th></tr></thead><tbody>' +
          '<tr><td><code>pending</code></td><td>等待发送</td><td>预览、删除</td></tr>' +
          '<tr><td><code>processing</code></td><td>正在发送或等待打印机响应</td><td>预览</td></tr>' +
          '<tr><td><code>done</code></td><td>已发送成功</td><td>预览、再打印一份</td></tr>' +
          '<tr><td><code>failed</code></td><td>发送失败（离线、超时、地址错误）</td><td>预览、重试、删除</td></tr>' +
          '</tbody></table>' +
          '<p>顶部三个按钮：<b>重试失败</b>（重新发送全部 failed）、<b>删除失败</b>、<b>全部删除</b>。历史区可按任务号、标签、打印机、数据、来源 IP 搜索。</p>' +
          '<p class="mb-0">任务号格式 <code>Q&lt;批次&gt;-&lt;排号&gt;-&lt;序号&gt;</code>，例如 <code>Q88-1-147</code>：第 88 批发出的第 1 排、全局第 147 条。多列标签的一排一个任务，排号会跟着变。</p>'
      },
      {
        id: 'api',
        icon: 'fa-plug',
        title: '接口与 AI 接入',
        html: '' +
          '<p>网页上的每个动作都有对应的 REST 接口，可直接用脚本或别的系统调用。</p>' +
          '<h6 class="manual-h">常用 REST 接口</h6>' +
          '<table class="table table-sm table-bordered manual-table"><thead><tr><th style="width:44%">接口</th><th>说明</th></tr></thead><tbody>' +
          '<tr><td><code>GET /rest/printer</code></td><td>打印机列表（含序列号、设置）</td></tr>' +
          '<tr><td><code>GET /rest/printer/status</code></td><td>各打印机实时在线状态</td></tr>' +
          '<tr><td><code>POST /rest/printer</code></td><td>新建或更新打印机</td></tr>' +
          '<tr><td><code>POST /rest/printer/rediscover</code></td><td>按序列号重新查找已换 IP 的打印机</td></tr>' +
          '<tr><td><code>GET /rest/label</code></td><td>标签列表</td></tr>' +
          '<tr><td><code>POST /rest/label</code></td><td>新建或更新标签</td></tr>' +
          '<tr><td><code>GET /rest/label/export</code> / <code>POST /rest/label/import</code></td><td>标签 JSON 导出 / 导入</td></tr>' +
          '<tr><td><code>POST /rest/preview</code></td><td>把 ZPL 渲染成图片（返回 base64 PNG）</td></tr>' +
          '<tr><td><code>POST /rest/print</code></td><td>不排队，直接打印</td></tr>' +
          '<tr><td><code>POST /rest/queue/add</code></td><td>入队一条任务，支持 <code>values</code> 数组按排拆分</td></tr>' +
          '<tr><td><code>POST /rest/queue/add-many</code></td><td>批量入队（多列标签自动合并成整排）</td></tr>' +
          '<tr><td><code>GET /rest/queue</code></td><td>队列内容：待打印、历史、并行在发、暂停状态</td></tr>' +
          '<tr><td><code>POST /rest/queue/retry</code> / <code>/pause</code> / <code>/resume</code></td><td>重试失败、暂停、恢复</td></tr>' +
          '</tbody></table>' +
          '<h6 class="manual-h">MCP（给 AI 客户端用）</h6>' +
          '<p>服务启动时同时开一个 MCP 端点：<code>http://&lt;服务器IP&gt;:18422/mcp</code>，传输方式 Streamable HTTP，无状态。客户端配置示例：</p>' +
          '<pre class="manual-code">{\n  "mcpServers": {\n    "zpl-rest": { "url": "http://192.168.8.10:18422/mcp" }\n  }\n}</pre>' +
          '<p>config.json 里 <code>mcp_token</code> 留空即可直接连；填了值则请求头要带 <code>Authorization: Bearer &lt;token&gt;</code>。托盘菜单的「复制 MCP 地址」可直接拿到带端口的地址。</p>' +
          '<p class="mb-0">可用工具：<code>list_labels</code>、<code>get_label</code>、<code>create_label</code>、<code>update_label</code>、<code>delete_label</code>、<code>render_preview</code>、<code>label_preview</code>、<code>list_printers</code>、<code>printer_status</code>、<code>print_label</code>、<code>enqueue_print</code>、<code>list_queue</code>、<code>pause_queue</code>、<code>resume_queue</code>、<code>retry_failed</code>、<code>delete_queue_items</code>。</p>'
      },
      {
        id: 'faq',
        icon: 'fa-life-ring',
        title: '常见问题',
        html: '' +
          '<h6 class="manual-h">队列不动了，任务一直是 pending</h6>' +
          '<ul>' +
          '<li>先看打印机页在线状态；离线的话检查电源、网线、IP 是否被 DHCP 改掉，点「重新查找」。</li>' +
          '<li>看队列页顶部是否有黄色暂停提示，有就点「恢复」。</li>' +
          '<li>USB 打印机检查 Windows 打印队列里是否有卡住的任务，清掉后重试。</li>' +
          '</ul>' +
          '<h6 class="manual-h">打印发糊、条码扫不出来</h6>' +
          '<ul>' +
          '<li>降低浓度（MD 往负方向调）或降低打印速度。</li>' +
          '<li>标签纸与介质类型要对应：热敏纸配 <code>^MTD</code>，色带配 <code>^MTT</code>。</li>' +
          '<li>条码太窄也会扫不出，适当加大高度和模块宽度。</li>' +
          '</ul>' +
          '<h6 class="manual-h">换了 IP 后打印机一直离线</h6>' +
          '<ul>' +
          '<li>点「重新查找」，它会扫描本机网段并按序列号写回新地址。</li>' +
          '<li>如果打印机和服务器不在同一网段，扫描不到，需要手动把地址改成新 IP。</li>' +
          '<li>序列号读不到时（个别固件对查询返回 <code>?</code>），系统会尝试备用标识；仍失败就只能手工改。</li>' +
          '</ul>' +
          '<h6 class="manual-h">网页打不开</h6>' +
          '<ul>' +
          '<li>确认服务窗口没被关闭；exe 版可右键托盘图标查看是否还在运行。</li>' +
          '<li>端口被别的程序占用时，改 config.json 的 <code>port</code> 后重启。</li>' +
          '<li>别的电脑访问不了，检查 Windows 防火墙是否放行 18420 端口。</li>' +
          '</ul>' +
          '<h6 class="manual-h">程序一闪就关、扫描打印机后进程消失</h6>' +
          '<ul>' +
          '<li>先看程序目录 <code>logs/crash.log</code>：有内容说明是程序内部错误，按日志排查；日志记到最后一步就断、系统也没有报错，多半是被终端安全软件（如云枢 EDR）整树查杀——加壳的单文件 exe 加上扫描打印机时的批量连接行为容易触发。</li>' +
          '<li>解决办法按优先级：① 改用<b>便携版</b>（官方 node 运行时，不加壳，不会触发）；② 在安全软件控制台把程序目录加入信任区/白名单。</li>' +
          '<li>判断安全软件是否动手：把 <code>node.exe</code> 之类进程行为对照、或直接看安全软件的拦截记录。</li>' +
          '</ul>'
      },
      {
        id: 'data',
        icon: 'fa-database',
        title: '数据与备份',
        html: '' +
          '<p>所有数据都在程序目录下的 <code>db/</code> 里（JSON 文件形式）：打印机、标签、队列、历史、元数据。</p>' +
          '<ul>' +
          '<li><b>备份：</b>停掉服务后整目录复制 <code>db/</code> 即可；也可以整体拷走 exe + <code>db/</code> + <code>config.json</code>。</li>' +
          '<li><b>迁移：</b>把这三样拷到新机器，启动就能继续用。</li>' +
          '<li><b>不要手改 db 里的文件：</b>服务运行时内存里有一份数据，直接改文件会和内存状态冲突，之后的一次网页保存可能把整张表覆盖掉。要改数据请走网页或 REST 接口；确实要手改必须先停服务。</li>' +
          '<li>队列历史会一直累积，长期跑建议定期用「全部删除」清理已完成记录，避免文件过大。</li>' +
          '</ul>' +
          '<p class="mb-0"><code>logs/crash.log</code> 是诊断日志：全局异常兜底、启动/发现/打印等关键动作都会记录（超 2MB 自动截断），排查闪退和打印异常时先看它。</p>' +
          '<p class="text-muted small mb-0">更新版本时保留 <code>db/</code> 与 <code>config.json</code>，替换程序本体即可。</p>'
      }
    ]
  };

  var en = {
    toc: 'Contents',
    search_ph: 'Search the manual, e.g. darkness, multi-column, MCP…',
    no_result: 'No section matches that keyword. Try another one.',
    sections: [
      {
        id: 'start',
        icon: 'fa-rocket',
        title: 'Quick start',
        html: '' +
          '<p>This service manages ZPL label printing from one machine: printers, label templates and print jobs. Other computers, scripts or AI clients drive it through the web UI, the REST API or MCP.</p>' +
          '<div class="alert alert-info py-2 mb-3"><b>Set up in this order:</b> Printer → Label → Print Queue. A label must be bound to a printer before the queue can produce output.</div>' +
          '<h6 class="manual-h">Three entry points</h6>' +
          '<table class="table table-sm table-bordered manual-table"><thead><tr><th style="width:34%">Entry</th><th>Purpose</th></tr></thead><tbody>' +
          '<tr><td><code>http://&lt;host&gt;:18420</code></td><td>Web UI and REST API (default 18420)</td></tr>' +
          '<tr><td><code>ws://&lt;host&gt;:18421</code></td><td>WebSocket: printer online state, queue progress, rebind events</td></tr>' +
          '<tr><td><code>http://&lt;host&gt;:18422/mcp</code></td><td>MCP endpoint for AI clients (optional)</td></tr>' +
          '</tbody></table>' +
          '<h6 class="manual-h">Running it</h6>' +
          '<ul>' +
          '<li><b>Portable exe:</b> double-click <code>zpl-rest.exe</code>. Data (<code>db/</code>) and <code>config.json</code> live next to the exe, so the whole folder is copyable.</li>' +
          '<li><b>Portable folder (recommended on managed PCs):</b> ships an official node runtime — start with <code>启动.bat</code>. Some enterprise endpoint agents (e.g. YunShu) kill the single-file exe during printer scans (crash with no error); the folder build is immune. If the agent still complains, trust the folder in its console.</li>' +
          '<li><b>From source:</b> <code>npm install</code>, then <code>node main.js</code>.</li>' +
          '<li>The browser opens automatically. The console window may be minimised but must stay open — closing it stops the service.</li>' +
          '<li>Tray icon right-click: <b>Open home page</b> / <b>Copy MCP address</b> / <b>Close service</b>. The menu text follows the language chosen in the web UI (English / 中文 / العربية) — switching applies instantly and is saved as <code>ui_lang</code> in <code>config.json</code>.</li>' +
          '</ul>' +
          '<h6 class="manual-h">Common config.json keys</h6>' +
          '<table class="table table-sm table-bordered manual-table"><thead><tr><th style="width:30%">Key</th><th style="width:14%">Default</th><th>Meaning</th></tr></thead><tbody>' +
          '<tr><td><code>port</code></td><td>18420</td><td>Web UI and REST port</td></tr>' +
          '<tr><td><code>websocket_port</code></td><td>18421</td><td>WebSocket port</td></tr>' +
          '<tr><td><code>mcp_port</code></td><td>18422</td><td>MCP port</td></tr>' +
          '<tr><td><code>mcp_token</code></td><td>empty</td><td>Empty = open on the LAN; when set, MCP calls need <code>Authorization: Bearer &lt;token&gt;</code></td></tr>' +
          '<tr><td><code>tray</code></td><td>true</td><td>Show the tray icon</td></tr>' +
          '<tr><td><code>open_browser</code></td><td>true</td><td>Open the browser on start</td></tr>' +
          '<tr><td><code>discovery_interval</code></td><td>120</td><td>Seconds between background re-find scans (min 30) for DHCP address changes</td></tr>' +
          '<tr><td><code>ui_lang</code></td><td>en</td><td>Tray menu language, written automatically when you pick a language in the web UI (en / zh / ar)</td></tr>' +
          '</tbody></table>' +
          '<p class="text-muted small mb-0">Restart after editing config.json. If a port is taken the service reports it and exits — free the port first.</p>'
      },
      {
        id: 'printer',
        icon: 'fa-print',
        title: 'Printers',
        html: '' +
          '<p>Everything printer-related is on the <b>Printer</b> page: auto scan, manual create, test label, re-find, edit and delete.</p>' +
          '<h6 class="manual-h">Two connection types</h6>' +
          '<table class="table table-sm table-bordered manual-table"><thead><tr><th style="width:16%">Type</th><th style="width:32%">Address format</th><th>When to use</th></tr></thead><tbody>' +
          '<tr><td><b>Network TCP</b></td><td><code>192.168.8.43:9100</code></td><td>Printer on Ethernet/Wi-Fi; ZPL goes straight to port 9100 — fastest and most reliable</td></tr>' +
          '<tr><td><b>USB</b></td><td>Windows printer name, e.g. <code>ZDesigner ZT510-300dpi ZPL(02)</code></td><td>Printer cabled to this PC; sent as RAW through the Windows spooler</td></tr>' +
          '</tbody></table>' +
          '<p class="mb-2">Click <b>Create Printer</b>, pick TCP or USB, then enter the address. The USB dropdown lists local printers with Zebra drivers first. <b>Test Label</b> prints a sample page to prove the link.</p>' +
          '<h6 class="manual-h">When the printer IP changes (DHCP)</h6>' +
          '<p>On DHCP a printer may come back with a new address after a power cycle. This service identifies machines by <b>serial number</b>, not by IP:</p>' +
          '<ul>' +
          '<li>Each network printer stores its serial (e.g. <code>34J244300042</code>) when saved.</li>' +
          '<li><b>Refind Printers</b> scans the local subnet and writes the new IP back onto the same record; queued jobs are untouched.</li>' +
          '<li>Every <code>discovery_interval</code> seconds offline network printers are re-checked in the background; when found, a toast appears and skipped jobs resume automatically.</li>' +
          '<li>Same-named printers are matched by serial, never crossed. Two identical serials count as ambiguous and nothing is changed.</li>' +
          '</ul>' +
          '<p class="text-muted small">Name printers after their location (e.g. "Packing line ZT510") so a moved unit is not misleading.</p>' +
          '<h6 class="manual-h">Printer not found by the scan</h6>' +
          '<p>The scan button covers the /24 of <b>every local network interface</b> (wired and wireless; virtual adapters/VPN go last) and re-checks with a second method when the result is empty. If it still finds nothing, go through these in order:</p>' +
          '<ul>' +
          '<li><b>Wrong subnet:</b> type the printer subnet (e.g. <code>192.168.8</code>) into the Subnet box and scan again. Multi-NIC PCs and printers on another switch always need this.</li>' +
          '<li><b>No connectivity:</b> <code>ping &lt;printer-ip&gt;</code> from the server; then open <code>http://&lt;printer-ip&gt;</code> in a browser to confirm it is a Zebra device.</li>' +
          '<li><b>Blocked by a security agent:</b> the agent may let PowerShell start but silently drop its connections — the scan then reports an empty network. Trust the program folder and retry; the scan already retries with a direct node sweep, and if both are blocked only a whitelist helps.</li>' +
          '<li><b>Read the diagnostics:</b> open <code>http://&lt;this-pc&gt;:18420/rest/discover/diag</code> — interfaces seen, subnet that would be scanned, whether the last sweep ran via PowerShell or the node fallback, and how many hosts had 9100 open. Add <code>?probe=1</code> for a live PowerShell check.</li>' +
          '<li>If all else fails, just use <b>Create Printer</b> with <code>IP:9100</code> — the scan is a convenience, not a requirement.</li>' +
          '</ul>' +
          '<h6 class="manual-h">A Wi-Fi PC finds nothing (most common case)</h6>' +
          '<p>When the PC is on Wi-Fi, a failed scan usually means the PC cannot reach the printer at all:</p>' +
          '<ul>' +
          '<li><b>Wi-Fi client isolation (AP isolation):</b> the AP blocks wireless-to-wireless and wireless-to-wired client traffic; guest SSIDs almost always do this.</li>' +
          '<li><b>Different subnet / VLAN:</b> office Wi-Fi is often 10.x or 172.x while the printers live on a wired 192.168.8.x. A scan only covers the PC\'s own subnets.</li>' +
          '<li><b>Public network profile plus a strict agent:</b> the firewall or endpoint agent drops the app\'s outbound connects; PowerShell starts but its connections go nowhere.</li>' +
          '</ul>' +
          '<p>Use the <b>Test connection</b> box on the Printers page: type <code>192.168.8.43</code> and press the button.</p>' +
          '<ul>' +
          '<li><b>Reachable</b>: the network is fine — a failed scan is an app-side issue, check the diag URL below.</li>' +
          '<li><b>Unreachable, ping OK</b>: the host answers but 9100 is closed (Raw disabled on the printer, or a firewall).</li>' +
          '<li><b>Unreachable, ping fails</b>: another subnet/VLAN or Wi-Fi isolation. No scan can fix that — ask the network admin or move the server onto the printer network.</li>' +
          '</ul>' +
          '<h6 class="manual-h">The scan finds some printers but not all</h6>' +
          '<p>Under the results the app prints a summary: "port 9100 open on N host(s), M confirmed as Zebra". That line tells you which step lost the missing unit:</p>' +
          '<ul>' +
          '<li><b>N lower than expected</b> (the sweep never reached it): the scan sweeps in parallel, then re-probes every address the OS ARP table shows as reachable on the link but that did not answer — a dropped SYN on Wi-Fi is recovered that way. If it is still missing, pin the subnet in the Subnet box and scan again, then confirm with <b>Test connection</b>.</li>' +
          '<li><b>N high enough but M lower</b> (reached, not identified): the device has 9100 open but its web page does not say Zebra, or did not answer within 2 s. The app deliberately sends <b>nothing</b> to an unconfirmed device (a non-Zebra device prints whatever it receives), so it is not listed. Verify it with <b>Test connection</b> or add it manually with <b>Create Printer</b>.</li>' +
          '<li>On a Wi-Fi PC with many printers and a busy network, one unit can occasionally be missed — pressing scan again normally completes the list.</li>' +
          '</ul>' +
          '<h6 class="manual-h">Darkness and media</h6>' +
          '<p>Print darkness = <b>panel darkness</b> + the <code>^MD</code> offset in ZPL. Panel baselines differ per unit, so calibrate each printer.</p>' +
          '<ul>' +
          '<li>Direct thermal: <code>^MTD</code>, target total darkness around 30.</li>' +
          '<li>Thermal transfer (ribbon): <code>^MTT</code>, usually lower than direct thermal — judge by eye.</li>' +
          '<li><code>^MD0</code> follows the panel baseline exactly; negative values lighten it.</li>' +
          '</ul>' +
          '<div class="alert alert-warning py-2 mb-0"><b>Two typical faults:</b> (1) smudged, blobby text → darkness too high or speed too fast, lower MD first; (2) pinholes burned in the ribbon → a thermal-transfer printer was sent <code>^MTD</code>, whose energy burns through the ribbon. Set the media type to thermal transfer.</div>'
      },
      {
        id: 'label',
        icon: 'fa-tags',
        title: 'Label templates',
        html: '' +
          '<p>The <b>Label</b> page lists templates: search, create, delete, click a row to edit. The editor offers visual design, variables, preview, test print, and <b>Import / Export JSON</b> in its header.</p>' +
          '<h6 class="manual-h">Size and variables</h6>' +
          '<ul>' +
          '<li>Width and height are in <b>millimetres</b>: 84.8 × 23.8 means an 84.8mm wide, 23.8mm high label. Dots are computed from the printer dpi.</li>' +
          '<li>Variables are written <code>${name}</code> and filled at print time; the same variable may appear several times.</li>' +
          '<li>Every label is bound to one printer; binding it applies that printer\'s settings as defaults.</li>' +
          '</ul>' +
          '<h6 class="manual-h">Editor elements</h6>' +
          '<table class="table table-sm table-bordered manual-table"><thead><tr><th style="width:22%">Element</th><th>Notes</th></tr></thead><tbody>' +
          '<tr><td>text</td><td>Single line, height and rotation configurable</td></tr>' +
          '<tr><td>block</td><td>Wrapping paragraph with width, height and line count</td></tr>' +
          '<tr><td>barcode</td><td>Code128 and other common symbologies</td></tr>' +
          '<tr><td>qrcode</td><td>Error correction level selectable (default M)</td></tr>' +
          '<tr><td>DataMatrix</td><td>Small, high-density code</td></tr>' +
          '<tr><td>Code39</td><td>Alphanumeric code common in legacy systems</td></tr>' +
          '<tr><td>text_rev</td><td>White text on black</td></tr>' +
          '<tr><td>datetime</td><td>Current time at print</td></tr>' +
          '<tr><td>box / line</td><td>Borders and separators</td></tr>' +
          '</tbody></table>' +
          '<p>You can also write raw ZPL directly; both views stay in sync.</p>' +
          '<h6 class="manual-h">Multi-column media (small labels)</h6>' +
          '<p>For 3 small labels per row, set <b>columns</b> to 3 and rows to 0 (continuous roll) or the real row count. Then:</p>' +
          '<ul>' +
          '<li>Multiple values are split <b>3 per row</b>, one job each — never one long blob, which drifts out of position.</li>' +
          '<li>An all-blank row ends the data; a partial last row still prints with blanks left empty.</li>' +
          '<li>If the template has a single variable slot, it is tiled 3× across the row automatically.</li>' +
          '</ul>' +
          '<h6 class="manual-h">Settings precedence</h6>' +
          '<p>Label settings win; anything unset falls back to the printer default. Switching the bound printer applies the new machine\'s darkness, speed and media type with a toast.</p>' +
          '<h6 class="manual-h">Import / export</h6>' +
          '<p><b>Export</b> saves the current template (elements, variables, print settings, layout) as <code>zpl-label-&lt;name&gt;.json</code> for backup or reuse on another server. <b>Import</b> loads such a file into the editor and does <b>not</b> save automatically — review, then save.</p>' +
          '<p class="text-muted small mb-0">Previews render locally via WASM; label content never leaves the machine.</p>'
      },
      {
        id: 'queue',
        icon: 'fa-list-ol',
        title: 'Print queue',
        html: '' +
          '<p>The <b>Queue</b> page holds drafts, pending jobs, in-flight jobs, completed history and failures. <b>Add Print Queue</b> opens the staging page (<code>/queue/new</code>).</p>' +
          '<h6 class="manual-h">Three ways to enter data</h6>' +
          '<ul>' +
          '<li><b>Single:</b> one input per variable with a live preview, then <b>Add Single</b> to stage it.</li>' +
          '<li><b>Batch xlsx:</b> download the template (first row = variable names), fill it in, upload, then <b>Add Tasks</b>.</li>' +
          '<li><b>Draft:</b> <b>Save Draft</b> keeps a staged batch for later; reopen it from the Queue page.</li>' +
          '</ul>' +
          '<p>Staged tasks can be ticked or selected by number range; once the printer column is right, use <b>Enqueue All</b> or <b>Print Selected</b>.</p>' +
          '<div class="alert alert-warning py-2"><b>Note:</b> the printer of a staged or draft task is snapshotted when it is added — changing the dropdown afterwards does not affect it. Always check the printer column before printing.</div>' +
          '<h6 class="manual-h">Parallel printing</h6>' +
          '<ul>' +
          '<li>Different printers fire <b>simultaneously</b>; the badge next to the title shows "printing in parallel: N".</li>' +
          '<li>Within one printer jobs are strictly serial in enqueue order, so paper feeding never collides.</li>' +
          '<li>An offline printer only skips its own jobs (5s cooldown) while the others keep working; when it returns, skipped jobs resume automatically.</li>' +
          '<li><b>Pause</b> halts everything; <b>Resume</b> continues.</li>' +
          '</ul>' +
          '<h6 class="manual-h">Statuses and actions</h6>' +
          '<table class="table table-sm table-bordered manual-table"><thead><tr><th style="width:18%">Status</th><th style="width:36%">Meaning</th><th>Actions</th></tr></thead><tbody>' +
          '<tr><td><code>pending</code></td><td>Waiting to be sent</td><td>Preview, delete</td></tr>' +
          '<tr><td><code>processing</code></td><td>Being sent / awaiting printer</td><td>Preview</td></tr>' +
          '<tr><td><code>done</code></td><td>Sent successfully</td><td>Preview, print one more</td></tr>' +
          '<tr><td><code>failed</code></td><td>Send failed (offline, timeout, bad address)</td><td>Preview, retry, delete</td></tr>' +
          '</tbody></table>' +
          '<p>Top buttons: <b>Retry Failed</b>, <b>Delete Failed</b>, <b>Delete All</b>. History is searchable by job id, label, printer, data or source IP.</p>' +
          '<p class="mb-0">Job id format <code>Q&lt;batch&gt;-&lt;row&gt;-&lt;seq&gt;</code>, e.g. <code>Q88-1-147</code> = batch 88, row 1, global job 147. Multi-column labels get one job per row.</p>'
      },
      {
        id: 'api',
        icon: 'fa-plug',
        title: 'API and AI access',
        html: '' +
          '<p>Every UI action has a REST endpoint, so scripts and other systems can drive the same operations.</p>' +
          '<h6 class="manual-h">Common REST endpoints</h6>' +
          '<table class="table table-sm table-bordered manual-table"><thead><tr><th style="width:44%">Endpoint</th><th>Purpose</th></tr></thead><tbody>' +
          '<tr><td><code>GET /rest/printer</code></td><td>Printer list (serial, settings)</td></tr>' +
          '<tr><td><code>GET /rest/printer/status</code></td><td>Live online state per printer</td></tr>' +
          '<tr><td><code>POST /rest/printer</code></td><td>Create or update a printer</td></tr>' +
          '<tr><td><code>POST /rest/printer/rediscover</code></td><td>Find moved printers by serial</td></tr>' +
          '<tr><td><code>GET /rest/label</code></td><td>Label list</td></tr>' +
          '<tr><td><code>POST /rest/label</code></td><td>Create or update a label</td></tr>' +
          '<tr><td><code>GET /rest/label/export</code> / <code>POST /rest/label/import</code></td><td>Export / import label JSON</td></tr>' +
          '<tr><td><code>POST /rest/preview</code></td><td>Render ZPL to an image (base64 PNG)</td></tr>' +
          '<tr><td><code>POST /rest/print</code></td><td>Print immediately, bypassing the queue</td></tr>' +
          '<tr><td><code>POST /rest/queue/add</code></td><td>Enqueue one job; a <code>values</code> array is split by row</td></tr>' +
          '<tr><td><code>POST /rest/queue/add-many</code></td><td>Batch enqueue (multi-column labels merged per row)</td></tr>' +
          '<tr><td><code>GET /rest/queue</code></td><td>Pending, history, in-flight, paused state</td></tr>' +
          '<tr><td><code>POST /rest/queue/retry</code> / <code>/pause</code> / <code>/resume</code></td><td>Retry, pause, resume</td></tr>' +
          '</tbody></table>' +
          '<h6 class="manual-h">MCP (for AI clients)</h6>' +
          '<p>An MCP endpoint runs alongside the service: <code>http://&lt;host&gt;:18422/mcp</code>, Streamable HTTP, stateless. Client config example:</p>' +
          '<pre class="manual-code">{\n  "mcpServers": {\n    "zpl-rest": { "url": "http://192.168.8.10:18422/mcp" }\n  }\n}</pre>' +
          '<p>Leave <code>mcp_token</code> empty to connect directly; when set, send <code>Authorization: Bearer &lt;token&gt;</code>. The tray menu item <b>Copy MCP address</b> gives you the full URL.</p>' +
          '<p class="mb-0">Tools: <code>list_labels</code>, <code>get_label</code>, <code>create_label</code>, <code>update_label</code>, <code>delete_label</code>, <code>render_preview</code>, <code>label_preview</code>, <code>list_printers</code>, <code>printer_status</code>, <code>print_label</code>, <code>enqueue_print</code>, <code>list_queue</code>, <code>pause_queue</code>, <code>resume_queue</code>, <code>retry_failed</code>, <code>delete_queue_items</code>.</p>'
      },
      {
        id: 'faq',
        icon: 'fa-life-ring',
        title: 'Troubleshooting',
        html: '' +
          '<h6 class="manual-h">Queue is stuck, jobs stay pending</h6>' +
          '<ul>' +
          '<li>Check the printer is online; a DHCP address change shows as offline — click <b>Refind Printers</b>.</li>' +
          '<li>Look for the yellow pause banner on the Queue page and resume.</li>' +
          '<li>For USB printers, clear stranded jobs in the Windows spooler, then retry.</li>' +
          '</ul>' +
          '<h6 class="manual-h">Smudged print, unscannable barcode</h6>' +
          '<ul>' +
          '<li>Lower the darkness (more negative MD) or reduce speed.</li>' +
          '<li>Match media type: <code>^MTD</code> for direct thermal paper, <code>^MTT</code> for ribbon.</li>' +
          '<li>Very narrow bars also fail to scan — increase bar height and module width.</li>' +
          '</ul>' +
          '<h6 class="manual-h">Printer went offline after an IP change</h6>' +
          '<ul>' +
          '<li>Click <b>Refind Printers</b>: it scans the subnet and rebinds by serial.</li>' +
          '<li>If the printer is on another subnet it cannot be scanned — set the new address manually.</li>' +
          '<li>If the serial cannot be read (some firmware answers <code>?</code>), a fallback identifier is tried; failing that, edit manually.</li>' +
          '</ul>' +
          '<h6 class="manual-h">Web UI will not load</h6>' +
          '<ul>' +
          '<li>Make sure the console window is still running (check the tray icon).</li>' +
          '<li>If the port is taken, change <code>port</code> in config.json and restart.</li>' +
          '<li>Remote machines blocked: allow port 18420 in Windows Firewall.</li>' +
          '</ul>' +
          '<h6 class="manual-h">Program flashes closed, or the process dies during printer scans</h6>' +
          '<ul>' +
          '<li>Check <code>logs/crash.log</code> next to the program first: entries there mean an internal error — follow the log. If the log stops abruptly at the last step with no system error, an endpoint security agent (e.g. YunShu EDR) is likely killing the process tree — a packed single-file exe plus the burst of connections during printer scans is a common trigger.</li>' +
          '<li>Fixes in order of preference: ① switch to the <b>portable folder build</b> (official node runtime, not packed, not targeted); ② trust the program folder in the security agent console.</li>' +
          '<li>To confirm the agent is responsible, compare its interception records against the process disappearing.</li>' +
          '</ul>'
      },
      {
        id: 'data',
        icon: 'fa-database',
        title: 'Data and backup',
        html: '' +
          '<p>All data lives in <code>db/</code> next to the program, as JSON files: printers, labels, queue, history, metadata.</p>' +
          '<ul>' +
          '<li><b>Backup:</b> stop the service and copy <code>db/</code>; or copy exe + <code>db/</code> + <code>config.json</code> together.</li>' +
          '<li><b>Migration:</b> copy those three items to the new machine and start it.</li>' +
          '<li><b>Never edit db files by hand while running:</b> the service holds an in-memory copy, and a later save from the UI can overwrite a whole collection. Use the UI or REST; if you must edit files, stop the service first.</li>' +
          '<li>History grows forever — use <b>Delete All</b> periodically to trim completed records.</li>' +
          '</ul>' +
          '<p class="mb-0"><code>logs/crash.log</code> is the diagnostic log: the global exception guard plus key actions (startup, discovery, printing) are recorded there (auto-truncated at 2 MB). Start there when debugging crashes or print problems.</p>' +
          '<p class="text-muted small mb-0">When upgrading, keep <code>db/</code> and <code>config.json</code> and replace only the program files.</p>'
      }
    ]
  };

  window.MANUAL_CONTENT = { zh: zh, en: en };
})();
