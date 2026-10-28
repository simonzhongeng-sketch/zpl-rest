# zpl-rest 项目现状与后续开发手册

最后更新：2026-10-28（v1.1.0 收尾版）
适用对象：接手开发的人、隔一段时间回来的自己

这份文档只写"现在是什么样、为什么这样、下次从哪儿下手"，不重复 README 的使用说明，也不重复 CHANGES.md 的逐日流水。

---

## 一、一分钟了解

zpl-rest 是一个跑在 Windows 上的标签打印服务：把 Zebra 打印机的能力包成 HTTP 接口和网页，让不装 BarTender 的同事也能做标签、批量打印、看队列；同时通过 MCP 把打印能力暴露给 AI 客户端。

它解决的问题不是"能不能打"，而是"换纸、换碳带、对位、批量导入、谁打了什么"这些现场琐事。

当前形态：

- 单进程 Node 服务，无构建步骤，`node main.js` 就跑起来，代码即部署。
- 数据存本地 JSON 文件（diskdb），没有数据库服务要装，拷走目录就是完整备份。
- 两个分发形态：单文件 exe（免安装）与便携目录包（对抗企业 EDR 查杀，推荐）。
- 界面三语（简体中文 / English / العربية，阿拉伯语整站 RTL），后端无鉴权。

规模参考：main.js 2138 行、lib/ 下 10 个 js 模块、前端 13 个 js、界面文案 344 个 key × 3 语、REST 路由 41 个 + 页面路由 8 个、MCP 工具 16 个。

---

## 二、交付物与入口

代码仓库：https://github.com/simonzhongeng-sketch/zpl-rest （公开仓库，master 分支）

当前版本：1.1.0，HEAD 提交 `ea53cb3`，annotated tag `v1.1.0`（指向 `393fefa`）

发布页：https://github.com/simonzhongeng-sketch/zpl-rest/releases/tag/v1.1.0
附两个文件：`zpl-rest-1.1.0.exe`（单文件，约 78.5 MB）、`zpl-rest-portable-20261028.zip`（便携目录包，约 73.8 MB）

项目主页（GitHub Pages，三语单页，随 push 自动部署）：https://simonzhongeng-sketch.github.io/zpl-rest/

本机运行入口：`http://localhost:18420`（REST 与 Web UI 同端口），WebSocket 18421，MCP 18422

文档分工：

- `README.md` / `README.zh-CN.md` / `README.ar.md`：面向使用者的安装、接口、配置说明，三份结构必须保持一致。
- `CHANGES.md`：按日期记录的变更流水，882 行，是"某次改动为什么发生"的第一手材料。
- `docs/TECH_DESIGN.md`：最初的平台化技术方案（v1.0 基线，部分内容已被后续实现超越，读时注意）。
- `docs/label-page-margin.md`：打印位置与页边距的专项设计文档，483 行，改位置相关逻辑前必读。
- 本文：现状、契约、债务、路线图、排障。

---

## 三、起服务

开发模式（本机装 Node 22）：

```
npm install
node main.js
```

启动后自动打开浏览器并最小化控制台。想安静启动，把 `config.json` 里 `tray` 与 `open_browser` 置 false。

单文件 exe：双击 `zpl-rest-1.1.0.exe`。数据（`db/`、`config.json`、`logs/`）落在 exe 同级目录，不写系统盘。

便携目录包：解压后跑 `启动.bat`。内含官方 node.exe 与 node_modules，不经过 pkg 加壳，装云枢之类的终端防护时更稳。

隔离运行（测试、多实例、演示）：设环境变量 `ZPL_DATA_DIR` 指向一个绝对路径，数据全部写到那里，不碰项目本身的 `db/`。

```
ZPL_DATA_DIR=C:\temp\zpl-demo node main.js
```

注意两点容易踩的：

- 路径必须传绝对 Windows 路径。`/tmp/x` 在 cmd 或 PowerShell 下会落到当前盘符，看起来"隔离了"其实没有。
- `config.json` 会从数据目录读，不是从程序目录读。改配置要去数据目录改，否则以为没生效。

---

## 四、测试

两套回归，都不碰真实打印机。

开发环境：`node test/dev_func_test.js`
本次收尾实测 88 项全过、45.7 秒、跑完自动清理临时目录，并且校验了项目自身的 `db/` 与 `config.json` 前后 md5 一致（不会被测试污染）。

exe 端：`node test/exe_func_test.js dist/zpl-rest-1.1.0.exe`
58 项，覆盖打包后的路径解析、静态资源、托盘降级等。端口段 18440–18442。

纪律，破一条就可能出事故：

- **跑 dev 回归前必须先停掉正在运行的服务**。端口 18420 被占用时会连到真实实例，历史上有一次就这么污染了真实 db。
- 只有 exe 改了才需要重跑 exe 回归；改 README、截图、文档不用重打包。
- 测试替身：`test/mock_printer.js`（9100）、`test/mock_printer_single.js`（任意端口）、`test/mock_printers_parallel.js`（9200–9202，带时间戳，用来验证并行调度）。收到的 ZPL 落盘 `test/mock_printer_received.txt`，下次跑之前先删残留。
- 专项测试单独跑更省时间：`test/page_geometry_test.js`、`test/api_label_page_test.js`。

---

## 五、代码地图

改动前先看这张表，能省掉大量"这逻辑在哪"的搜索。

入口与路由

- `main.js`（2138 行）：Express 应用、全部页面路由与 REST 路由、ZPL 组装（`labelToZpl`）、预览接口、打印入口、静态资源与语言切换。职责明显过载，见债务 M1。
- `mcp.js`（348 行）：独立 Express 应用，Streamable HTTP 无状态 MCP，16 个工具。所有工具回环调本机 REST，不直接碰数据库——这是刻意设计，保证只有一条写数据路径。

核心库

- `lib/zpl_compiler.js`（210 行）：可视化元素 → ZPL。多列平铺（`repeatCols`/`stepMm`/`rowWidthMm`）、`^PW`/`^LL` 输出都在这里。
- `lib/page_geometry.js`（138 行）：纯函数，`shiftMm()` 算位移、`originDots()` 出 `^LH` 点值。前端有一份等价副本，见债务 M6。
- `lib/print_queue.js`（301 行）：队列调度。按打印机并行、同机串行（100ms 间隔）、离线冷却 5000ms 只跳过自己。
- `lib/discover.js`（843 行）：打印机发现。网段枚举、PowerShell 端口扫描、ARP 二次复核、本机 Zebra 驱动枚举。全项目最复杂也最脆的文件，动它要慢。
- `lib/usb_print.js`（233 行）：Windows 打印后台 RAW 直发，附带状态查询。
- `lib/printer_profiles.js`（102 行）：机型档案与默认打印设置。
- `lib/tray.js`（185 行）：托盘菜单。`lib/approot.js`（45 行）：数据目录解析，`ZPL_DATA_DIR` > exe 目录 > 项目目录。`lib/config.js`：默认配置与合并。`lib/crashlog.js`：崩溃日志，`logs/crash.log`。

前端

- `html/js/visual_editor.js`（619 行）：可视化编辑器，mm 网格画布 + 属性面板，暴露 `window.visualEditorApi`。几何逻辑与后端重复。
- `html/js/label_edit.js`（564 行）：标签编辑页胶水层，位置微调输入、`^LH` 徽标、预览、测试打印。
- `html/js/printer.js`（577 行）：打印机页，含 TCP/USB 双模式弹窗与基础原点两个输入。
- `html/js/queue.js`（466 行）与 `queue_new.js`：队列管理、xlsx 解析、暂存草稿。
- `html/js/i18n.js` + `html/js/locales/{en,zh,ar}.js`：三语，key 必须严格对齐。
- `site/`：GitHub Pages 三语介绍页，与主程序无关，改界面不需要动它。

视图：`views/` 下 7 个 EJS。`/reprint` 已并入队列页，路由只是 302 到 `/queue`。

---

## 六、数据模型

六个 collection，全在数据目录的 `db/` 下，JSON 数组，diskdb 直接读写。

`label.json`：标签模板。`name`、`width`/`height`（mm）、`zpl`（原始 ZPL）、`template`（可视化元素树，含 `page` 页边距）、`print_settings`（标签级打印参数）、`printer_id`（绑定的打印机）、`print_layout {cols, rows}`（多列小标）、`variables`。

`printer.json`：打印机。`name`、`address`（TCP 为 ip:port，USB 为 Windows 打印机名）、`conn`（`tcp`/`usb`）、`density`（dpmm）、`settings {mode, darkness, speed, base_origin_mm}`。`base_origin_mm` 是这台机的基础原点，默认 1.5/0.8 mm。

`queue.json`：打印任务。`job_id`（Q<批次>-<排号>-<序号>）、`status`（pending/processing/done/failed）、`source`（xlsx/manual/reprint）、`zpl_override`、`zpl_sent`（实际发出的 ZPL，重打用）、`print_layout`、`row_index`。

`jobs.json`：历史打印记录，供仪表盘统计。
`draft.json`：队列暂存草稿。
`meta.json`：全局计数器（`job_id` 序号）。

当前本机数据：3 个标签、3 台打印机、102 条已完成队列记录。`queue.json` 已 61 KB 且没有清理机制，见债务 D3。

---

## 七、五条硬契约

这几条是踩过坑之后定下来的，改动时优先保证不破坏。

**1. 全部尺寸用 mm，ZPL 内部才是点。**
数据库字段、界面输入、画布坐标都是 mm。写模板时按 mm 布局，按打印机 dpmm 换算成点。8dpmm 时 1mm = 8 点。任何新加字段不要引入 dot 或 inch。

**2. 元素坐标永远是相对标签物理左上角。**
没有"安全区"概念，整张 `width × height` 都可布置，不做越界拦截，新元素固定落 5,5。2026-10-28 曾短暂改成中心定位（`template.anchor:'center'`），当天按需求回退，备份在 `test/backup-center-anchor-20261028/`。如果以后要重做中心定位，先读备份里的 `toTopLeft` 换算逻辑，并且必须保证老模板逐点不漂移。

**3. `^LH` 只有一个，标签级只发一次，位于首条 `^FO` 之前。**

```
^LH = round((base_origin_mm.x + margin.left + offset.x) × dpmm)
    , round((base_origin_mm.y + margin.top  + offset.y) × dpmm)
```

mm 层先按 `min(20, size/4)` 钳位、再一次性取整，避免两次取整叠加误差。右/下边距只记录、永不进 ZPL——ZPL 只有一个原点，写进去只会误导人。编译顺序固定 `^PW` → `^LL` → `^LH`。`^PW` 优先级：`page.roll_width_mm` > 多列 `rowWidthMm` > 标签宽。

**4. 预览与打印必须分离。**
`labelToZpl(label, printer, opts)` 的 `opts.previewOrigin` 打开时，基础原点与 margin/offset 全部归零（`roll_width_mm` 保留），画布恒为标签本体。也就是：**预览看到的就是标签长什么样，打印才叠加机器位置**。手写 ZPL 的预览不归零。

**5. 打印设置两级覆盖。**
`printer.settings` 是该机校准默认，`template.print_settings` 是标签显式值，逐项覆盖；`mode='none'` 或字段缺失则回退打印机。`darkness=0` 表示用面板基准、不输出 `^MD`，负数输出 `^MD-6` 这种形式。

---

## 八、已知问题与技术债

按"会不会咬人"排序，不是按工作量。

**D1（安全，高）后端没有任何鉴权，且默认对全网开放。**
`config.json` 里 `public: true` 时监听 0.0.0.0，REST 41 个接口全部匿名可调，包括删除标签、删除打印机、直接打印。同网段任何人都能调。`secret` 只是 express-session 的密钥，不是访问口令。MCP 侧有可选的 `mcp_token`，REST 侧没有对应机制。
建议：加一层 API key 中间件（复用 `mcp_token` 的思路），默认 `public: false`，前端请求头带上 key；页面本身可以保留会话 cookie 免密。

**D2（安全，中）`config.json` 被纳入了公开仓库。**
里面是默认 session secret，且 `public: true`。虽然只是 session 密钥、风险有限，但公开仓库里放配置文件是坏习惯。
建议：改为 `config.example.json` 入库，`config.json` 进 .gitignore，首次启动自动从 example 生成。

**D3（稳定，中）队列历史无上限。**
`queue.json` 只增不减，102 条已 61 KB。长期跑批量打印会到几万条，diskdb 每次全量读写 JSON，写队列会变慢、进程内存上涨。
建议：保留策略（如仅留最近 90 天或最近 5000 条，可配置），超出部分归档到按月文件或导出 CSV；`jobs.json` 同理。

**D4（可维护，中）`main.js` 是 2138 行的单体。**
路由、编译、预览、打印、静态资源混在一个文件，改一处要先滑很久。新人接手成本高。
建议：拆 `routes/{labels,printers,queue,discover,preview}.js`，`main.js` 只留装配与启动。拆的时候不要顺手改逻辑，先纯搬迁 + 回归通过，再谈优化。

**D5（可维护，中）几何逻辑前后端各一份。**
`lib/page_geometry.js` 与 `visual_editor.js` 里的副本必须手工同步，已经出现过一边改一边忘的风险。
建议：抽成 UMD 或纯 ESM 单文件，Node `require` 与浏览器 `<script>` 共用同一份，前端只保留取值适配。

**D6（工程，中）没有 CI，`npm test` 是空的。**
`package.json` 的 `test` 脚本直接 `exit 1`，回归靠人记着跑。GitHub 上只有 Pages 部署的 workflow。
建议：加 `test:dev` / `test:exe` / `test:i18n` 三个 script；加一个 Actions workflow 在 push 时跑 dev 回归 + i18n 三语 key 对齐校验（现在这条校验藏在 dev_func_test 里，可抽出来单独跑）。

**D7（分发，中）单文件 exe 会被企业 EDR 杀。**
pkg 加壳 + 网段扫描的批量出站 SYN，会触发云枢这类终端防护的进程树查杀，间歇性、代码层无法根治。已经用便携包绕过，但用户仍可能双击 exe。
建议：文档层面持续主推便携包；有条件的话给 exe 做代码签名，能显著降低启发式误杀；或者干脆把便携包做成默认下载。

**D8（工程，低）Dockerfile 还停在 node:16-alpine。**
项目实际跑 Node 22，镜像构建出来大概率跑不起来或行为不一致。Docker 这条路目前没人用。
建议：升到 `node:22-alpine`，或者直接删掉，避免误导。

**D9（运维，低）仓库与本地目录体积偏大。**
`node_modules` 129 MB、`dist` 384 MB（含 exe、便携目录、zip 三份）、`test` 79 MB（`test/exe_func/` 里有一份 exe 副本）。这些都已 gitignore，但本地占空间。
建议：定期清 `dist/` 与 `test/exe_func/`；需要归档的构建产物只留 zip。

**D10（跨平台，低）打印机发现依赖 Windows PowerShell。**
非 win32 平台上扫描直接降级返回 null。当前场景全是 Windows，不算问题，但如果哪天要跑 Linux 容器就废了。
建议：真要跨平台时，把 PS 扫描换成纯 node 的并发 TCP connect + ARP 表读取（注意：node 侧批量出站正是 D7 的触发点，二者需要一起权衡）。

---

## 九、下一步优化路线

分三批，前一批不做完不要开下一批。每批结束都跑一次 dev 回归。

**第一批：让它更难出事（安全 + 数据）**
1. D1 REST 鉴权 + 默认只听 localhost
2. D2 config 从仓库摘出来
3. D3 队列与历史保留策略 + 导出
4. 全量备份/恢复：一键打包 `db/` 与 `config.json`（现在只有标签级的 export/import）

**第二批：让它更好改（可维护）**
1. D6 npm scripts + CI（push 即跑回归与 i18n 校验）
2. D4 拆 main.js（纯搬迁，不改逻辑）
3. D5 几何逻辑单源化
4. D8 Dockerfile 处理掉
5. 补 `docs/` 与代码注释：`discover.js` 是最需要注释的文件

**第三批：让它更好用（功能）**
1. 模板版本管理：每次保存留快照，可回滚可对比（现在改坏只能靠 `test/*.bak-*` 手工恢复）
2. 元素对齐与吸附：中心定位那次回退说明需求没谈清，重做前先确认交互（居中落点 vs 对齐参考线是两件事）
3. 队列按打印机分视图 + 失败原因归类统计
4. 预置模板库（常用尺寸 84.8×23.8、60×8 三列等），新用户开箱可用
5. MCP 增强：按变量批量入队、批量预览、查询打印机耗材状态
6. 成本/用量报表：按标签、按打印机、按月统计张数（仪表盘已有数据基础）

---

## 十、排障手册

**扫不到打印机**
先看 `GET /rest/discover/diag`：`interfaces` 里有没有 169.254.x 的 APIPA 网卡（企业办公机常见 4–5 块，且在枚举顺序里排在 Wi-Fi 前面，是历史事故根因），再看 `last_sweep.mode` 与 `arp_neighbors`。需要细节就设 `ZPL_SCAN_TRACE=1` 重启。单次 auto 扫描正常应 16–18 秒。

**USB 打印失败**
`lib/usb_print.js` 返回 `FAIL <step> <code>`。step 指卡在枚举打印机、打开打印队列还是写 RAW 数据；code 是 Win32 错误码。常见是打印机名不匹配（同名驱动被 Windows 加了 `(01)`/`(02)` 后缀）。

**预览 500**
本地 WASM 渲染失败，不会外发到 Labelary（那条兜底早已移除，故意的）。看 `logs/crash.log`，多数是 ZPL 语法错误或缺字体。

**EADDRINUSE**
说明已有实例在跑。程序有单实例守卫，会直接打开浏览器后退出。若你是在跑测试，先停服务，否则测试会连到真实实例。

**数据库被写坏**
绝不在服务运行时改 `db/*.json`。diskdb 在内存里持有全量数据，外部改文件后下一次写操作可能把整个 collection 覆盖成单条记录（2026-10-26 真发生过）。正确做法：停服务 → 从 `test/label.json.bak-*` 恢复 → 起服务 → 走 REST 修正。所有写操作一律走 REST。

**exe 被杀 / 启动后消失**
EDR 查杀，改用便携目录包。不要试图在代码层对抗。

**打印浓度不对**
`node test/calib_tt.js "打印机名" "0,-6,-12"` 打阶梯，人眼选。原则：`^MD` 是相对面板的偏移，总浓度 = 面板值 + MD，热敏纸目标总浓度约 30。**不要用高浓度实心黑块试**，会烧穿蜡基色带。

**页面文案显示成 key 名**
`html/js/locales/` 三个文件缺 key。跑 dev 回归会报 `locale zh/ar: N missing`。

---

## 十一、交接清单

**代码与发布**
仓库为公开仓库，推送身份是 repo 级配置（`simonzhongeng-sketch` 及其 noreply 邮箱）。HTTPS 凭据存在 Windows 凭据管理器，形如 `gho_...`，不要写进任何文件或提交记录。
Pages 用 Actions 部署（`build_type: workflow`），workflow 在 `.github/workflows/pages.yml`，构建期把 `img/{en,zh,ar}/` 拷进产物，`site/img/` 已 gitignore。
Release 附件是手工上传的，没有 CI 自动化。出新版本时：`git tag -a vX.Y.Z` → push tag → 建 Release → 上传 exe 与 zip → 更新 notes 里的下载表。

**不要进仓库的东西**
真实打印机清单、内网 IP、单机浓度校准值：记在本地 `.workbuddy/memory/MEMORY.md`，已 gitignore。仓库是公开的，这类现场信息一律不写进 `docs/`。
`db/`、`volumes/`、`logs/`、`config.json`（理想状态）、`test/*.bak-*`、`test/exe_func/`、`test/mock_printer_received.txt` 都在忽略列表里。

**环境依赖**
Node 22（开发与打包都用它）。打包走 `@yao-pkg/pkg`，MCP SDK 必须按具体文件 `require` `dist/cjs` 路径，`exports` 通配符 pkg 解析不了——这条踩过，改依赖时留意。
真实打印机只有现场有，开发一律用 `test/mock_*`，别拿真机试错。

---

## 十二、下次开工的前 30 分钟

1. `node test/dev_func_test.js`，确认 88 项还全过（约 46 秒）。这一步能排掉"环境坏了"的干扰。
2. `node main.js`，打开 `http://localhost:18420`，扫一眼仪表盘与队列页有没有报错。
3. 读 `CHANGES.md` 最近三条，回忆上次改了什么、为什么。
4. 要动打印位置，先读 `docs/label-page-margin.md` 的 §12 和本文第七节第 3、4 条。
5. 要动扫描，先读 `lib/discover.js` 顶部注释与本文第十节第一条，别在 node 侧加新的批量出站。
6. 选一件事做，做完跑回归，跑完再提交。别攒。

项目不缺功能，缺的是"出事时不慌"。真要投入，从第九节第一批开始。
