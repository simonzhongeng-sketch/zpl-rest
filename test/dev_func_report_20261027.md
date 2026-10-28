# 开发环境完整回归测试报告 — 2026-10-27

- **被测版本**：`D:\Desktop\zpl-rest-master`（Node 22，npm 直跑，非 exe）
- **被测源码指纹**（本次报告所有结论对应以下文件，均为 15:36–15:37 工程师最后一次修改后的版本）：

  | 文件 | md5 |
  |---|---|
  | `main.js` | `8b5a1aef33f149439dd3489f419c132a` |
  | `lib/discover.js` | `25ccfab2b6623d4013774ba85c9cd5d1` |
  | `lib/approot.js` | `5a55211abf82c0407740fad07783b9e5` |
  | `html/js/printer.js` | `22bcea75c7195cbefbbb9d6680634af7` |
  | `views/printer.ejs` | `724502d13cce0d1b09fe87a2ffd2b0dd` |

- **运行方式**：`node test/dev_func_test.js`（一键，退出码 0/1），完整输出留档 `test/dev_func_last_run.log`
- **隔离环境**：
  - `ZPL_DATA_DIR=C:\Users\...\Temp\zpl-dev-func`（**绝对 Windows 路径**，经 `path.resolve` 后由 `lib/approot.js` 接管 db/config/logs）
  - `ZPL_SKIP_TRAY_MOD=1`，`discovery_interval=3600`（避免周期重扫干扰）
  - 端口 18420/18421/18422，mock 打印机 `test/mock_printer.js`（127.0.0.1:9100 + 厂商页 8080）
  - 跑完自动清理临时数据目录、kill 进程

## 1. 总览

| 指标 | 结果 |
|---|---|
| 检查项总数 | **86** |
| 通过 | **86** |
| 失败 | **0** |
| 通过率 | **100%** |
| 总耗时 | 52.3s / 52.8s（连续两次运行结果一致，可重复） |
| 路由判定 | **NoOne（全部通过）**；另有 1 条非缺陷观察项（见 §6） |
| 真实打印机打印数据 | **0 字节**（所有打印只打到 loopback mock，见 §5） |
| 项目数据污染 | **零污染**（8 个文件 md5 前后完全一致，双份证据见 §7） |

## 2. 逐项结果（A–K）

### A. 启动与页面（11 项，全通过）

| 检查 | 结果 | 证据 |
|---|---|---|
| 服务在 18420 起来 | PASS | `/label` 200 |
| `ZPL_DATA_DIR` 生效（数据目录隔离） | PASS | db 生成在 Temp\zpl-dev-func\db |
| 三个端口监听日志正确 | PASS | `REST ... 18420 in public mode` / `MCP ... 18422` / `Websocket ... 18421` |
| `/`、`/printer`、`/label`、`/label/edit`、`/queue`、`/queue/new`、`/reprint`、`/manual` | PASS×8 | 全 200，均含 `accordionSidebar`（6840–20299 bytes） |
| `/js/i18n.js`、`/js/visual_editor.js`、`/css/custom.css` | PASS×3 | 200（6906 / 17610 / 5006 bytes） |

### B. 地址归一化与错误码（17 项，全通过）

| 检查 | 结果 | 证据 |
|---|---|---|
| 裸 IP → `:9100` | PASS | `127.0.0.1` → `127.0.0.1:9100` |
| 全角冒号 `：` | PASS | `127.0.0.2：9100` → `127.0.0.2:9100` |
| `http://` 前缀 + 尾斜杠 | PASS | `http://127.0.0.3/` → `127.0.0.3:9100` |
| 首尾空格 + 尾斜杠 | PASS | `"  127.0.0.4/  "` → `127.0.0.4:9100` |
| `::::` / 空串 / `garbage!!` / `-t` / 端口 99999 / 非数字端口 | PASS×6 | 全部 400 `{error:'address_invalid'}` |
| 重复（裸 IP vs 已存 `host:9100`） | PASS | 409 `{error:'duplicate_address'}` |
| 重复（`http://127.0.0.1:9100/` 写法） | PASS | 409 |
| 重复（对**历史裸 IP 记录** `127.0.0.9` 提交 `127.0.0.9:9100`） | PASS | 409，证明 `canonicalTcpAddress()` 跨写法生效 |
| 带 `_id` 编辑同地址不误报 409 | PASS | 200；GET 复核 `name=DEV-TCP-MOCK-RENAMED, address=127.0.0.1:9100` |
| 编辑保留 settings | PASS | `{mode:direct_thermal, darkness:15, speed:2}` 落库不变 |
| 保存返回可达性 | PASS | create: `reachable:true`；edit: `{updated:1,inserted:0,reachable:true}` |
| USB 与 TCP 同字符串不互相顶 | PASS | 预置 `conn:usb, address:"127.0.0.1:9100"` 记录后，TCP 建 `127.0.0.1` 仍 200 |

> USB/TCP 隔离与"历史裸 IP"两项通过**在隔离目录预置 db 记录**验证（12:44 先于 diskdb 连接写 `printer.json`），这样才可能在不碰真实数据、不依赖本机 spooler 命名的前提下复现两个边界。

### C. `POST /rest/discover/probe`（9 项，全通过）

| 检查 | 结果 | 证据 |
|---|---|---|
| 可达（mock 9100） | PASS | `tcp{reachable:true, ms:1}`，`ping.ok=true`，请求 40–45ms |
| 不可达 `192.168.99.254` | PASS | `ping.ok=false`、`tcp{reachable:false, ms:2007, error:"timeout …"}`，请求 **2014ms** |
| 拒绝 `127.0.0.1:1` | PASS | `reachable:false, error:"ECONNREFUSED"`，41ms |
| 响应 < 5s（可达/拒绝/不可达） | PASS×3 | 45ms / 41ms / 2014ms —— **不挂** |
| `garbage!!` / `-t` / 空串 → 400 `address_invalid` | PASS×3 | 1ms 返回，说明 `isValidHost()` 前置拦截生效 |

### D. `GET /rest/discover/diag`（6 项，全通过）

| 检查 | 结果 | 证据 |
|---|---|---|
| 无参 200 + `interfaces`/`chosen`/`network`/`gateway`/`last_sweep` | PASS | ifaces=1，chosen=`192.168.8.0/24`，gw=`192.168.8.1` |
| `?target=127.0.0.1` | PASS | `target={host,port:9100,ping{ok:true,ms:50},tcp{reachable:true,ms:2}}` |
| `?target=%%%` / `?target=a&target=b`（数组）/ `?target=-t` | PASS×3 | 均 200，`target` 为空但不抛错 |
| `?probe=1` | PASS | `powershell_probe {ok:true, version:"5.1.26100.9711"}` |

### E. 扫描（7 项，全通过）

| 检查 | 结果 | 证据 / 耗时 |
|---|---|---|
| ① loopback 网段扫到 mock 并识别 | PASS | 127.0.0.1 → `model=ZT510, dpi=203, density=8dpmm`；**6408 / 6851 / 7175ms**（三次） |
| ② `auto` 200 + 实际扫描网段列表 | PASS | 响应头 `X-Scanned-Subnets: 192.168.8`，≤3 网段；**15235 / 15308 / 14967ms** |
| ③ 空网段 `10.99.99` | PASS | 200，**network 结果 0 条**（仅有本机 spooler 的 2 台 USB Zebra，属设计行为） |
| ③ `last_sweep` 降级记录 | PASS | `{base:"10.99.99", mode:"powershell", ps_ms:2510–2588, count:0, ms:12232–12297}`，总耗时 − PS 耗时 ≈ 9.7s → **确证 PS 返回空后 node 复核真的跑了** |
| mock 未被误判成非 Zebra / 未触发打印 | PASS | mock 只收到 SGD 查询与 ZPL 打印各 3 次（见 §5） |

**扫描耗时客观数字（工程师关心的 1200ms 对齐问题）**

| 场景 | 耗时 | 说明 |
|---|---|---|
| PS 扫描（空网段） | 2.51–2.59s | `WaitMs=1200` + 进程启动 ≈ 1.3s，paced 模式 |
| node 复核（空网段 254 host，并发 32） | ≈9.7s | 8 批 × 1200ms ≈ 9.6s，**与 1200ms 完全对应**；若仍是旧值 700ms 则约 5.6s，即空网段场景每网段 +4s |
| 单网段有结果（192.168.8，5 台） | 15.0–15.3s | 含 PS 扫描 + 5 台设备的 HTTP 厂商识别 + SGD 型号/DPI/序列号 |
| loopback 254 host 全部"开放" | 6.4–7.2s | 极端场景（测试环境所有 127.0.0.x 都因 0.0.0.0 绑定而"开放"），真实网段不会有此规模 |

> 结论：1200ms 对齐在**空网段降级路径**上带来 +4s 量级代价，在有设备的真实网段上代价可忽略（远小于设备识别耗时）。属于可接受的权衡；若将来要优化，应减小 node 复核的 host 并发批次数而不是回退超时值。

### F. 打印链路（仅 mock）（11 项，全通过）

| 检查 | 结果 | 证据 |
|---|---|---|
| 建打印机 `127.0.0.1:9100` + `mode=direct_thermal/darkness=15/speed=2` | PASS | 200 |
| 建单值标签 / cols=3 多列标签 | PASS×2 | 200 |
| 预览返回 PNG（本地 WASM，无联网） | PASS | `iVBORw0KGgo…`，~1590 bytes |
| `/rest/queue/add` 单条 | PASS | `job_id Q1-1-1` |
| mock 收到含 `^XA`/`^FD` 的 ZPL | PASS | 113 bytes |
| ZPL 含 `^MD15` / `^PR2` | PASS | `^MTD ^MD15 ^PR2` |
| 6 值按 cols=3 拆 2 排 | PASS | `rows=2`，`A1\|A2\|A3` / `B1\|B2\|B3` |
| 队列排空 → history，`source=manual` | PASS | `history=3`，`manual,manual,manual` |

### G. MCP（3 项，全通过）

`initialize` 200（stateless）；`tools/list` **16** 个工具；`tools/call list_printers` 能看到 `DEV-TCP-MOCK`。

### H. WebSocket（1 项，通过）

`ws://127.0.0.1:18421/` 连接成功（不传子协议，faye 协商正常）。

### I. 语言与 i18n（5 项，全通过）

| 检查 | 结果 | 证据 |
|---|---|---|
| `POST /rest/lang {lang:'ar'}` | PASS | 200，**隔离目录** config.json `ui_lang=ar` |
| 非法语言 `xx` | PASS | 400 |
| `/printer` 新输入框使用 `data-i18n-placeholder` | PASS | `discover-subnet`=`pr.subnet_ph`、`probe-address`=`pr.probe_ph`；页面中 **`data-i18n-ph` 残留 0 处**（工程师改对了） |
| zh/en/ar 三份 locales 含 4 个新 key | PASS | `pr.subnet_ph`、`pr.probe_ph`、`pr.subnet_hint`、`pr.subnet_label` 齐全 |
| 三语 key 集合一致性 | PASS | zh/ar 各 329 key，**对 en 缺失 0** |

### J. 数据落盘与退出（6 项，全通过）

- 隔离 `db/` 六个 collection 全部生成：`label, printer, jobs, queue, meta, draft`
- `logs/crash.log` 生成，内容 1352 bytes，**无 `uncaughtException` / `unhandledRejection`**（仅有 beforeExit/exit 正常日志）
- 进程收到 terminate 后干净退出；18420/18421/18422 **端口全部释放**

### K. 污染检查（1 项，通过）

脚本内 md5 快照对比：项目 `db/*.json` + `config.json` 共 **8 个文件前后完全一致**。另有一份**独立于脚本**的 shell 快照（见 §7）同样一致。

## 3. 失败项分析（第 1 轮 → 第 2 轮）

第 1 轮 84 项中 3 项 FAIL，**全部为测试脚本自身问题，源码无 bug**，已自行修复后第 2 轮 86/86 通过（新增 2 项更严格的检查）。

| 第 1 轮失败项 | 判定 | 分析与处理 |
|---|---|---|
| `edit same printer with same address -> 200` 断言响应含 `_id` | **测试脚本问题** | `db.printer.update()` 返回 `{updated:1,inserted:0}` 而非文档，断言写错。改为"200 + 不回 409 + GET 复核落库结果"，并新增 `edit response carries the reachability flag` 断言（`reachable:true` 存在）。**注意**：请求本身行为正确，未误报 409 |
| `edit keeps settings` | **测试脚本问题** | 同上，从响应体取不到 settings；改为从 `GET /rest/printer` 复核，实测 `{darkness:15,speed:2}` 保留正确 |
| `empty subnet -> 200 with empty list` | **测试脚本问题** | `/rest/discover` 除网络扫描外**还会合并本机 spooler 里已安装的 Zebra USB 打印机**（本机 2 台 `ZDesigner ZT510-300dpi ZPL(01)`），所以"空网段"不等于"空数组"。断言改为"网络结果（含 `ip` 字段）为 0 条"，并额外断言降级路径 |

## 4. 新增/修改的文件

| 文件 | 变更 |
|---|---|
| `test/dev_func_test.js` | **新增**，一键开发环境回归脚本（86 项检查，自带 mock 打印机、自带隔离 data dir、跑完清理、返回退出码） |
| `test/exe_func_test.js` | **修改**，在 discover 段（rediscover 之后）新增 `probe` 段 6 项 + `diag` 段 5 项，共 **+11 项**（43 → 54），沿用既有 `record(cat,name,ok,detail)` 风格，未改动任何已有断言 |
| `test/dev_func_report_20261027.md` | **新增**，本报告 |
| `test/dev_func_last_run.log` | **新增**，最近一次完整运行日志（证据留档） |

> `test/exe_func_test.js` 本轮**未执行**：`dist/` 里最新构建的 `zpl-rest-20261027-1523.exe`（15:26）早于工程师 15:36/15:37 的加固提交，直接跑会把"旧 exe 没有 `isValidHost`"误报成缺陷。建议下次 `npm run build:win` 之后跑一次 `node test/exe_func_test.js dist/<新exe>` 收口。

## 5. 安全证据：真实打印机零接触

- 全部打印请求的 `printer_id` 均为 `DEV-TCP-MOCK`（`127.0.0.1:9100`）；未对 192.168.8.43/.45/.19/.42 或任何 USB 打印机入队
- mock 落盘 `test/mock_printer_received.txt` 仅 3 条：单值 1 条（113 bytes，含 `DEV-ABC-001`）、3 列 2 条（`A1|A2|A3`、`B1|B2|B3`）
- 本机确实装有 2 台 Zebra USB 打印机（spooler 可见），`/rest/discover` 的枚举会列出它们，但**只做枚举，未发送任何打印数据**
- `auto` 扫描会按产品设计对 192.168.8.0/24 发起 TCP 9100 探测 + 只读 SGD `getvar`（等同 UI 里点"扫描"），**不含任何打印数据写入**

## 6. 非缺陷观察项（供工程师参考，未计入失败）

1. **`POST /rest/printer`（带 `_id`）响应体是 `{updated:1, inserted:0, reachable:true}`，而新建返回的是打印机文档**。前端 `printer.js` 的 success 回调只读 `data.reachable`，WS 客户端对 `update` 事件的 data 也不做消费，因此**功能无影响**，属 API 形状不一致。若要统一，可在 `createOrUpdatePrinter()` 的 update 分支回填 `doc` 再 `res.json`。
2. `mode: "powershell"` + `count: 0` 这一组合下，`last_sweep` 里"PS 空 + node 复核"只能靠 `ms - ps_ms` 差值间接体现。若希望诊断更直白，可在 `sweepPort9100()` 的该分支把 `node_ms`/`node_count` 显式写进 `last_sweep`。

## 7. 零污染证据（项目数据）

独立于测试脚本的 shell 快照（测试前 15:31 / 全部测试完成后）：

```
$ diff md5_before.txt md5_after.txt && echo ZERO_POLLUTION
ZERO_POLLUTION: db/*.json + config.json identical
```

```
1a7079fae809c718e91ad0b3453f754c  db/draft.json
5c95b90b790f6e5af125e71b83dd9eab  db/jobs.json
3d4c1afce5c9edd1b4442b0ae575aa7f  db/label.json
c0caafe6eaf53fb9d4439fd404dd1d95  db/meta.json
a32a3e13b8d45546e50063013a4ccdc2  db/printer.json
9f63784ea8b67133b7055c38da04c750  db/queue.json
dcdccb5c06bb2eec98ec2a300f49d94c  config.json
```
（测试前后 7 个文件 md5 完全一致，项目 `db/`、`logs/` 未删除或新增任何文件；未执行 `npm install`）

## 8. 遗留风险

| 风险 | 说明 / 建议 |
|---|---|
| 多网卡 `auto` 合并未在本机验证 | 本机仅 1 块在用网卡（192.168.8.0/24），`X-Scanned-Subnets` 只出现 1 个网段，`slice(0,3)` 与去重合并逻辑未被真实多网卡环境覆盖。需要在有 Wi-Fi + 以太网 + VPN 的机器上复测 |
| 空网段扫描 +4s | node 复核 254 host × 1200ms/批（并发 32）≈ 9.7s。产品层面可接受，但 UI 端建议保留"扫描中"提示；若要提速，优先调并发批次而非超时 |
| `ZPL_DATA_DIR` 传相对路径或 posix 路径 | `path.resolve()` 会按 cwd / 当前盘符解析，Git Bash 下 `/tmp/x` 还会被 MSYS 转换。已在脚本注释与报告中强调**必须传绝对 Windows 路径**，但代码本身不校验，属易踩坑点 |
| 空网段返回里混有 USB 打印机 | 设计如此（`/rest/discover` 合并 spooler 枚举），但"扫描不到打印机"的排查语义会因此含混，UI 若能区分展示更佳 |
| exe 端回归未跑 | 见 §4；需在新构建后补跑，确认打包环境下 probe/diag 与 `isValidHost` 加固同样生效 |
| 真实设备兼容性 | 本机 mock 为 ZT510/203dpi 行为，`^MD/^PR/^MT` 编译、3 列拆排已验；300dpi 真实机型（8.43/.45）本轮按安全约束未接触 |

## 9. 复现命令

```bash
# 一键开发环境回归（约 53s，需 18420-18422 / 9100 / 8080 空闲）
node test/dev_func_test.js

# 保留隔离数据目录以便排查
ZPL_DEV_KEEP=1 node test/dev_func_test.js

# 指定隔离目录（必须是绝对 Windows 路径）
ZPL_DEV_DATA_DIR=D:/tmp/zplqa/data node test/dev_func_test.js

# exe 端端到端（需先构建）
node test/exe_func_test.js dist/<刚构建的>.exe
```
