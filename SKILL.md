---
name: dajian-inventory
description: 大件库存——工作日海外仓库存自动监控与 Excel 同步。从智汇创想 ERP「海外仓备货」页全自动采集指定 SKU 的三个统计仓可用库存，与前一工作日快照比对，标红低库存（A 或 B ≤3），并同步写回本机 Excel 的库存列（默认 C 列，位置可配置）。浏览器层用系统 Chrome + CDP 直连，零 npm 依赖。适用于跨境电商海外仓库存日常巡检、低库存预警、库存日报生成。关键词：大件库存、海外仓库存、库存监控、库存日报、库存日报定时任务、工作日自动化、备货、智汇 ERP、低库存预警、inventory monitor、stock sync、海外仓。
agent_created: true
---

# 大件库存（ERP Inventory Monitor）

## Overview

工作日每天自动从智汇创想 ERP 采集海外仓库存，比对前一工作日快照，生成变化报告并同步 Excel。核心产出：`report-today.md`（库存变化报告）+ 更新后的 Excel（库存列 `A+B` + 低库存标红）。

技术栈要点：**系统 Chrome + CDP 直连**（`scripts/cdp.mjs`，零依赖），已彻底移除 `agent-browser`。

## 何时使用

- 用户要求「查库存 / 同步库存 / 跑库存监控 / 生成库存日报」。
- 用户要求「开启定时巡检 / 加个工作日 9 点的定时任务」→ 见「定时自动化」章节，直接建 recurring 任务。
- 每日定时自动化触发（周一至周五 9:00）。
- 用户粘贴 ERP 查询结果，要求生成变化报告与 Excel 更新。

## 首次使用（别人 clone 后必读）

所有可配置项集中在 **`config.json`**（仓库根目录），脚本运行时读取它，无需改脚本内部。

1. **一键探测路径**（推荐）：
   ```bash
   node setup.mjs --excel "C:\Users\你\Desktop\你的库存表.xlsx"
   ```
   自动填入 `node` / `chrome` / `python` / `edsdkDir` / `chromeProfile` / `workDir`，并创建目录。
   也可手动改 `config.json`（模板见 `config.example.json`）。
2. **准备 Excel**：A 列是 SKU、库存列（默认 C）留空待写。若原表 C 列是成本/售价，先跑一次搬列：
   ```bash
   python scripts/restructure_excel.py
   ```
3. **登录 ERP**：
   ```bash
   node scripts/erp_login_holder.mjs
   ```
   在弹出窗口内登录智汇 ERP（备货页），登录态持久化到 `paths.chromeProfile`。

依赖：Node 22+（需要内置 WebSocket）、Python 3.11+、系统 Chrome（或 Edge）、`edsdk.py`（WorkBuddy 本地 Office 编辑技能；非 WorkBuddy 环境需自备等价 Excel 写入工具）。

## 关键配置（改 config.json，不改脚本内部）

| 项 | config 键 | 说明 |
|---|---|---|
| ERP 登录页 | `erp.loginUrl` | 默认 `https://888.zhcxkj.com/Manager/index.aspx?IsWeakPassword=false` |
| 备货页（直连，绕过 frameset） | `erp.overseasUrl` | `https://888.zhcxkj.com/IrobotBox/SalesAnalysis/OverseasAnalysis.aspx` |
| 查询起始时间 | `erp.startTime` | 默认 `2022-07-01` |
| 每页条数 | `erp.pageSize` | 默认 `200` |
| 系统浏览器 | `paths.chrome` | chrome.exe 绝对路径（留空会自动按常见路径探测） |
| 登录 profile | `paths.chromeProfile` | 登录态目录，删掉即需重新登录 |
| 工作目录 | `paths.workDir` | 快照/报告/中间产物都写这里（脚本内统一转绝对路径） |
| Excel 文件 | `paths.excelFile` | 源=目标；`.xls` 会自动另存 `.xlsx` |
| 无头模式 | `browser.headless` | 默认 `false`（登录需要可见窗口；定时任务可改 `true`） |
| **库存列** | `excel.inventoryCol` | 默认 `C`，可改成任意列字母 |
| SKU 列 / 名称列 | `excel.skuCol` / `excel.nameCol` | 默认 `A` / `B` |
| 表头行 | `excel.headerRow` | 0-based，默认 0 |
| 自动补缺失 SKU 行 | `excel.autoAppendMissing` | 默认 `false`；开启后表格里没有的监控 SKU 会自动补行 |
| 只补有库存数据的 SKU | `excel.appendOnlyWithData` | 默认 `true`，避免把空 SKU 铺满表 |
| 输出文件 | `excel.outputFile` | 留空 = 原地覆盖（`.xls` 则写同名 `.xlsx`） |
| 成本列定位（搬列用） | `excel.costCol` / `excel.costHeaderNames` | 列字母或表头名，默认按「成本」匹配 |
| 统计仓（严格精确匹配） | `warehouses.statistical` | 易达云美东仓、盛宝隆美西仓（共仓）、易可达美南仓 |
| 排除仓 | `warehouses.excluded` | 易可达美东仓、西邮美东（非统计仓名称一律排除） |
| SKU 清单 | `skuList` | 单一来源；脚本运行时自动注入查询与报告 |

**标红规则**：库存列 = 易达云美东(A) + 盛宝隆美西(B)，格式 `A+B`；A 或 B 任一 ≤3 → 整格红字（判单个，不是合计）。

> 路径依赖已从脚本内抽离到 `config.json`，迁移只需改这一处。详见 `references/paths.md`。

## 工作流程（全自动链路）

```
fetch_inventory.mjs  →  convert_extracted.mjs  →  process_inventory.mjs  →  sync_excel.py
    采集+翻页（CDP）      转 inventory-today.txt      比对+报告+Excel指令        写库存列 + 标红
```

**一条命令跑完四步**（定时自动化用的就是它）：

```bash
node scripts/run_daily.mjs
```

### 1. 采集（fetch_inventory.mjs）

- 浏览器：`cdp.mjs` 拉起系统 Chrome（`--remote-debugging-port=0`）→ 读 `DevToolsActivePort` → Node 内置 WebSocket 走 CDP。
- 流程：关旧会话 → open 备货页 → 轮询页面就绪（jQuery + #TextSKUs）→ `js_setup_query.js` 设参并 `SearchIt(2)` → `js_extract_all.js` 提取 → 核对页面「共 N 条」→ 超过首页行数时翻页补采（`js_extract_page.js`）→ 写 `<workDir>/extracted_raw.txt` → 关浏览器。
- **返回码**：`2` = 跳转 `Login.aspx` / `NLogin.aspx`（会话过期）；其他非 0 见日志。

```bash
node scripts/fetch_inventory.mjs   # 建议 run_in_background
```

### 2. 会话恢复（erp_login_holder.mjs）

fetch 返回码 2 时，先用保活脚本直接打开备货页尝试恢复会话（多数是「伪过期」，cookie 仍在）：

```bash
node scripts/erp_login_holder.mjs   # run_in_background，弹可见 Chrome 窗口
```

- 保活 30 分钟，轮询 URL 写 `erp_session_status.json`。
- 备货页能直接显示 → 会话已通（伪过期），停掉保活重跑 fetch 即可。
- 一直 `waiting_login`（真过期）→ 用户在窗口内手动重登，再重跑 fetch。
- 用户自己浏览器登录 ≠ skill 的 chromeProfile 登录；主后台(index.aspx)会话有效 ≠ 备货页(IrobotBox)会话有效（备货页会跳 `NLogin.aspx`）。

### 3. 转换（convert_extracted.mjs）

`extracted_raw.txt` → `<workDir>/inventory-snapshots/inventory-today.txt`。

```bash
node scripts/convert_extracted.mjs
```

### 4. 比对 + 报告（process_inventory.mjs）

读 `inventory-today.txt`，与前一工作日 `snapshot-YYYY-MM-DD.json` 比对，排除非统计仓，生成 `report-today.md` + `snapshot-今日.json` + `excel-updates.json`，并清理旧快照（只保留前一工作日 + 今日）。记录数与页面「共 N 条」不一致会直接报错退出，不写快照。

```bash
node scripts/process_inventory.mjs
```

### 5. 同步 Excel（sync_excel.py）

读 `excel-updates.json`，走 editor_sdk（edsdk.py）打开 Excel，按 `excel.skuCol` 匹配 SKU，写 `excel.inventoryCol` 列 `A+B` 值并按 A/B ≤3 标红，保存。

```bash
python scripts/sync_excel.py
```

- 行数用 `sheet_get_used_range` 自动探测（不再写死 row 0~104）。
- `.xls` 源：先另存 `.xlsx` 再写（edsdk 只能写 OOXML），原 `.xls` 保留。
- 目标被 WPS/Excel 占用 → 自动改存 `<原名>-YYYYMMDD.xlsx`，不动用户进程。

### 6. 搬列（restructure_excel.py，一次性）

把「成本」列挪到末尾、腾出库存列。产品**另存新文件**并用表头多重集校验，不会原地破坏原表：

```bash
python scripts/restructure_excel.py          # 输出 <原名>-库存列已调整.xlsx
```

### 兜底链路（用户粘贴数据）

用户手动粘贴 ERP 数据 → 存到 `<workDir>/inventory-snapshots/inventory-today.txt`（首行「共 N 条记录」，次行表头 `产品SKU,产品名称,发货仓库,可用库存`，其后 CSV 行）→ 从 `process_inventory.mjs` 开始执行。

## 定时自动化（工作日 09:00）

定时任务**不随仓库分发**——它属于每台机器、每个 WorkBuddy 账号。安装后按本节开启一次，之后每个工作日早 9 点自动跑；换机器 / 重装 skill 需要重新开启。

### 一条命令跑完整链路

```bash
node scripts/run_daily.mjs
```

- 依次执行 采集 → 转换 → 比对/报告 → 同步 Excel，任一步失败**立即停止**，不写半份快照、不动 Excel。
- 日志追加到 `<workDir>/logs/daily-YYYY-MM-DD.log`；全部成功时把 `report-today.md` 全文打印出来。
- 退出码：`0` 成功 / `2` ERP 会话过期 / `3` 配置路径在本机不完整（换机器没跑 setup.mjs）/ 其他 = 出错步骤的退出码。
- 调试参数：`--skip-fetch`（复用已有 `extracted_raw.txt`）、`--skip-excel`（只出报告不动表）、`--only=fetch,convert,process,excel`、`--quiet`。

### 怎么开启（给 agent 的执行指令）

用户说「开启每日库存巡检 / 加个工作日 9 点的定时任务」时，**直接调用 `automation_update`（mode=create）**。不要改用 Windows 计划任务或 crontab——那两条路拿不到 WorkBuddy 侧的浏览器登录态与提示词编排。

| 参数 | 值 |
|---|---|
| name | `大件库存 · 工作日 09:00 巡检` |
| scheduleType | `recurring` |
| rrule | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0` |
| status | `ACTIVE` |
| cwds | 本机 skill 目录绝对路径（含 `scripts/run_daily.mjs` 的那一层） |
| prompt | 下面的模板，把 `<SKILL_DIR>` 换成本机实际路径 |

prompt 模板（必须自包含——每次运行看不到历史对话）：

> 运行大件库存 skill（目录：`<SKILL_DIR>`）。在该目录执行 `node scripts/run_daily.mjs`，它会依次完成 采集海外仓库存 → 转换 → 与前一工作日快照比对生成报告 → 同步 Excel（配置见同目录 `config.json`，日志写到 `workDir/logs/`）。完成后按 SKILL.md「结果报告格式」输出当日结论：采集条数与页面「共 N 条」是否一致、三个统计仓分布、变化与触红 SKU（A 或 B ≤3）、Excel 更新行数与缺失 SKU，并附 `workDir/inventory-snapshots/report-today.md`。失败处置：退出码 3 = `config.json` 路径在本机不可用，报告缺哪几项并提示运行 `node setup.mjs --excel "<库存表路径>"`；退出码 2 = ERP 会话过期，先运行 `node scripts/erp_login_holder.mjs` 恢复后重跑一次，仍失败则说明需要人工登录；其他退出码按日志如实报告失败步骤。严禁编造或沿用昨日库存数字。

创建后 `automation_update` 会返回 `nextRunAt`，核对是否为下一个工作日 09:00。停用：mode=update + status=`PAUSED`；删除：mode=delete。

完整步骤（验证 / 停用 / 换机器 / 排查）见 [`docs/automation.md`](docs/automation.md)。

### 前置条件与失败处置

| 情况 | 表现 | 处置 |
|---|---|---|
| config.json 还是上一台机器的路径 | `run_daily` 退出码 3，逐项列出缺失路径 | 跑 `node setup.mjs --excel "你的表.xlsx"` 按本机重写 |
| ERP 会话过期（最常见） | `run_daily` 退出码 2 | 跑 `erp_login_holder.mjs` 弹窗恢复；真过期需人工登录一次后重跑 |
| 采集条数与页面不符 | `convert` 退出 2，`run_daily` 停在「转换」 | 不写快照、不动 Excel；查页面分页/筛选是否被改动 |
| Excel 被 WPS/Excel 占用 | 保存报 `Export file is occupied` | 自动改存 `<原名>-YYYYMMDD.xlsx`，不杀用户进程 |
| 前一工作日无快照 | 报告标注「首次建立基准」 | 正常，当日只建基准不出变化 |

## 比较基准规则

- **周一**：与上周五最后一次成功快照比较。
- **其他工作日**：与前一工作日最后一次成功快照比较。
- 快照缺失时（如某日采集失败），自动取最近一次成功快照。

## 结果报告格式（严格遵守）

```
**结果（YYYY-MM-DD 周X）：**
- 采集 N 条一致 → 三仓 M 条（易达云美东 X + 盛宝隆美西 Y + 易可达美南 Z，排除 K 行）
- 对比 snapshot-基准日期.json（基准说明）→ **N 条变化，M 处触红**
- Excel：库存列更新 N 行、标红 M 行，存回固定文件名；表格缺失 N 个（SKU 列表）

**触红 SKU：** （三列表格 SKU | 仓库 | 变化，仓库用简称，变化格式 旧→新）
**显著补货：** （一行，SKU 仓库 +N（旧→新），分号分隔）

最后 present_files 附 Excel 文件 + report-today.md
```

仓库简称映射：易达云美东仓→易达云美东；盛宝隆美西仓（共仓）→盛宝隆美西；易可达美南仓→易可达美南。

## 关键坑（勿再踩）

**浏览器 / CDP 层**

1. **Chrome 157+ 只在 `--remote-debugging-port=0` 时写 `DevToolsActivePort`**。显式指定端口就不写 → 任何「指定端口 + 等文件」的实现（含 agent-browser 0.27.0）必然超时。`cdp.mjs` 固定用 0。
2. **不要再引入 agent-browser**：0.41+ 要求 node≥24；其预编译 exe 与被下载的 Chrome for Testing 在开 WDAC 的机器上会被拦截（`os error 4551`）。
3. **profile 被占**：同一个 `--user-data-dir` 已有实例在跑时，新进程会交接给旧实例并直接退出、不写端口文件。`cdp.mjs` 先探测端口，能连就复用；连不上才清 `SingletonLock/Cookie/Socket` 后重试。
4. Node 内置 WebSocket 连 CDP 必须带 `--remote-allow-origins=*`，否则 Chrome 111+ 会 403。
5. 采集脚本要 `awaitPromise`（`js_extract_all.js` 返回 Promise），并给足 200s 超时。

**编辑器（edsdk）层**

6. `open_file` 建议 `wait=true`；`save_file` 遇 WPS(et.exe) 占用报 `Export file is occupied` → 改存新文件名，勿杀用户 WPS。
7. **`set_cell_value` 之后必须 `save_file`**，否则下次 `open_file` 从磁盘重载会丢弃未保存修改。
8. **edsdk 只能写 OOXML**：OLE 老格式 `.xls` 无法原地保存（即使保存到同一路径也会被拒），必须 `allow_format_change=true` 另存 `.xlsx`。
9. **`sheet_move_dimension` 的 `to` 是「删除后插入」语义**（Apps Script moveColumns 风格），不是「腾出空位」。要么先 `sheet_insert_dimension` 再 move，要么用 `restructure_excel.py`（已按此顺序实现并做表头校验）。原版没注意，直接把「售价」列挤丢过。
10. **写值前必须 `sheet_get_used_range` 探真实边界**；结构性增行要先 `sheet_insert_dimension`，之后旧坐标全部失效需重读。
11. Excel A 列有杂项行（如 '22862384'）要跳过（`sync_excel.py` 已按 6 位以上纯数字 + 优先 8 位处理）。

**数据一致性**

12. **目录必须统一**：旧版 convert 写 `workDir`、process 用 `resolve('.')`，靠「在 workDir 下运行」对齐，极易错位。现已全部走 `config.mjs` 的 `WORKDIR` / `DATA_DIR` 绝对路径。
13. 页面「共 N 条」与实际解析行数不一致时一律报错退出，宁可不跑也不写半份快照。
14. ERP 会话有效期约 1 天，工作日早间首次触发大概率 session expired（返回码 2）→ 先 `erp_login_holder.mjs` 恢复再重跑。

## 脚本清单

| 脚本 | 语言 | 作用 |
|---|---|---|
| config.mjs | Node | 共享配置加载 + workDir/chromeProfile 绝对化 + 目录懒创建 |
| cdp.mjs | Node | 系统 Chrome + CDP 直连封装（替代 agent-browser），对外提供 `run()` 兼容层 |
| run_daily.mjs | Node | **一键编排**：采集→转换→比对→同步 Excel，含分步日志/耗时/退出码（定时自动化入口） |
| fetch_inventory.mjs | Node | 全自动采集 + 翻页补采 |
| erp_login_holder.mjs | Node | 备货页保活 + 会话恢复 |
| erp_session.mjs | Node | 主后台(index.aspx)保活（旧，可不用） |
| convert_extracted.mjs | Node | extracted_raw → inventory-today |
| process_inventory.mjs | Node | 比对 + 报告 + Excel 指令 |
| sync_excel.py | Python | 写库存列 + 标红（列可配置、自动探行、xls→xlsx、可选补行） |
| restructure_excel.py | Python | 一次性搬列：成本列挪末尾、库存列腾空（另存新文件 + 校验） |
| setup.mjs | Node | 一键探测路径生成 config.json |
| js_setup_query.js | JS | 设查询参数 + 提交 SKU（浏览器内 eval，含占位符） |
| js_extract_all.js | JS | 首页提取（浏览器内 eval） |
| js_extract_page.js | JS | 翻页提取（浏览器内 eval） |
| ab_run.mjs | Node | CDP 版单次调试工具（`open/eval/get/close`） |

## 维护 SKU 清单

新增/删除 SKU 只改**一处**：`config.json` 的 `skuList` 数组。

脚本运行时自动：
- `fetch_inventory.mjs` 把 `skuList` 注入 `js_setup_query.js` 的 SKUS（浏览器查询）。
- `process_inventory.mjs` 用同一 `skuList` 做报告排序 + Excel 更新。

无需再手动同步 `js_setup_query.js` 里的硬编码 SKUS（该文件是占位符模板）。

## 环境限制（作者实测）

- Windows + Chrome 157 系统版（`C:/Program Files/Google/Chrome/Application/chrome.exe`）。
- 系统启用 WDAC 时，`Program Files` 之外的可执行文件会被拦（`os error 4551`）——这也是必须用系统 Chrome 而不是 agent-browser 自带 Chrome for Testing 的原因。
- 后台任务跑 Chrome 时，注意 Bash 沙箱「单命令结束即清进程树」：长驻浏览器要放在同一个后台任务里跑（`chrome ... & sleep N` 或在脚本内保持进程存活）。
