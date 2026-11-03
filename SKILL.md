---
name: dajian-inventory
description: 大件库存——工作日海外仓库存自动监控与 Excel 同步。从智汇创想 ERP「海外仓备货」页全自动采集指定 SKU 的三个统计仓可用库存，与前一工作日快照比对，标红低库存（A 或 B ≤3），并同步写回本机 Excel 的 C 列。适用于跨境电商海外仓库存日常巡检、低库存预警、库存日报生成。关键词：大件库存、海外仓库存、库存监控、库存日报、备货、智汇 ERP、低库存预警、inventory monitor、stock sync、海外仓。
agent_created: true
---

# 大件库存（ERP Inventory Monitor）

## Overview

工作日每天自动从智汇创想 ERP 采集海外仓库存，比对前一工作日快照，生成变化报告并同步 Excel。核心产出：`report-today.md`（库存变化报告）+ 更新后的 Excel（C 列库存值 + 低库存标红）。

## 何时使用

- 用户要求「查库存 / 同步库存 / 跑库存监控 / 生成库存日报」。
- 每日定时自动化触发（周一至周五 9:00）。
- 用户粘贴 ERP 查询结果，要求生成变化报告与 Excel 更新。

## 关键配置（改这里，不改脚本内部）

| 项 | 值 |
|---|---|
| ERP 登录页 | `https://888.zhcxkj.com/Manager/index.aspx?IsWeakPassword=false` |
| 备货页（直连，绕过 frameset） | `https://888.zhcxkj.com/IrobotBox/SalesAnalysis/OverseasAnalysis.aspx` |
| 统计仓（严格精确匹配） | 易达云美东仓、盛宝隆美西仓（共仓）、易可达美南仓 |
| 排除仓（一律排除） | 易可达美东仓、西邮美东（以及任何非统计仓名称，如盛宝隆美客多墨西哥仓、盛宝隆波兰仓） |
| 查询起始时间 | 2022-07-01 |
| 每页条数 | 200（不支持则 100） |
| SKU 清单 | `scripts/js_setup_query.js` 内 SKUS 变量 + `scripts/process_inventory.mjs` 内 SKU_ORDER 数组（两者须同步维护） |
| Excel 源/目标文件 | `C:\Users\xiaozhihe\Desktop\95已上产品-已同步最新库存-20260915.xlsx`（原地迭代，源=目标；被占用时改存 `95已上产品-已同步最新库存-YYYYMMDD.xlsx`） |
| C 列 = 易达云美东(A) + 盛宝隆美西(B)，格式 `A+B` | 标红规则：A 或 B 任一 ≤3 → 整格红字（判单个，不是合计） |

> **路径依赖**：脚本内含绝对路径（node.exe、agent-browser、erp-chrome-profile、Excel 文件、工作目录）。迁移到新机器需改 `scripts/` 下各文件顶部的常量。清单见 `references/paths.md`。

## 工作流程（全自动链路）

```
fetch_inventory.mjs  →  convert_extracted.mjs  →  process_inventory.mjs  →  sync_excel.py
     采集+翻页              提取结果转 inventory-today.txt       比对+报告+Excel指令         写 C 列 + 标红
```

### 1. 采集（fetch_inventory.mjs）

- **必须以 `run_in_background` 运行**（agent-browser daemon 由父进程持有，Bash 沙箱单命令结束即清进程树，前台跑会丢状态）。
- 流程：close 旧 daemon → open 备货页 → 轮询页面就绪（jQuery + #TextSKUs）→ 执行 `js_setup_query.js` 设参并 `SearchIt(2)` → `js_extract_all.js` 提取 → 核对页面「共 N 条」→ 超过首页行数时翻页补采（`js_extract_page.js`）→ 写 `extracted_raw.txt`。
- **会话过期识别**：open 结果含 `Login.aspx` 即 session expired（返回码 2）。

```bash
node scripts/fetch_inventory.mjs   # 必须 run_in_background
```

### 2. 会话恢复（erp_login_holder.mjs）

fetch 返回码 2（跳 Login.aspx）时，先用保活脚本直接打开备货页尝试恢复会话（多数情况是「伪过期」，cookie 仍在）：

```bash
node scripts/erp_login_holder.mjs   # run_in_background，弹可见 Chrome 窗口
```

- 保活 30 分钟，轮询 URL 写 `erp_session_status.json`。备货页能直接显示 → 会话已通（伪过期），停掉保活重跑 fetch 即可。
- 若一直 `waiting_login`（真过期），需用户在弹出窗口内手动重登，再重跑 fetch。
- 用户在自己浏览器登录 ≠ erp-chrome-profile 登录；主后台(index.aspx)会话有效 ≠ 备货页(IrobotBox)会话有效——备货页会话独立，过期跳 `NLogin.aspx`。

### 3. 转换（convert_extracted.mjs）

`extracted_raw.txt` → `inventory-snapshots/inventory-today.txt`（兼容带引号与已解码两种格式，统一 decodeOut）。

```bash
node scripts/convert_extracted.mjs
```

### 4. 比对 + 报告（process_inventory.mjs）

读取 `inventory-today.txt`，与前一工作日 `snapshot-YYYY-MM-DD.json` 比对，排除非统计仓，生成 `report-today.md` + `snapshot-今日.json` + `excel-updates.json`，并清理旧快照（只保留前一工作日 + 今日）。

```bash
node scripts/process_inventory.mjs
```

### 5. 同步 Excel（sync_excel.py）

读 `excel-updates.json`，走 editor_sdk（edsdk.py）打开 Excel，匹配 A 列 SKU，写 C 列 `A+B` 值并按 A/B ≤3 标红，保存回固定文件名。

```bash
python scripts/sync_excel.py
```

### 兜底链路（用户粘贴数据）

用户手动粘贴 ERP 数据 → 存到 `inventory-snapshots/inventory-today.txt`（格式：首行「共 N 条记录」，次行表头 `产品SKU,产品名称,发货仓库,可用库存`，其后 CSV 数据行）→ 从 `process_inventory.mjs` 开始执行。

## 比较基准规则

- **周一**：与上周五最后一次成功快照比较。
- **其他工作日**：与前一工作日最后一次成功快照比较。
- 快照缺失时（如某日采集失败），自动取最近一次成功快照。

## 结果报告格式（严格遵守）

```
**结果（YYYY-MM-DD 周X）：**
- 采集 N 条一致 → 三仓 M 条（易达云美东 X + 盛宝隆美西 Y + 易可达美南 Z，排除 K 行）
- 对比 snapshot-基准日期.json（基准说明）→ **N 条变化，M 处触红**
- Excel：C 列更新 N 行、标红 M 行，存回固定文件名；表格缺失 N 个（SKU 列表）

**触红 SKU：** （三列表格 SKU | 仓库 | 变化，仓库用简称，变化格式 旧→新）
**显著补货：** （一行，SKU 仓库 +N（旧→新），分号分隔）

最后 present_files 附 Excel 文件 + report-today.md
```

仓库简称映射：易达云美东仓→易达云美东；盛宝隆美西仓（共仓）→盛宝隆美西；易可达美南仓→易可达美南。

## 关键坑（勿再踩）

1. agent-browser Chrome 参数必须 `--no-sandbox,--disable-gpu`；**加 `--disable-crashpad` 会让页面崩回 about:blank**。
2. agent-browser daemon 由父进程持有 → 所有浏览器操作必须串行写进一个后台 node 脚本（fetch_inventory.mjs 模式）。
3. agent-browser `eval` 返回值是**双重 JSON.stringify** → node 侧需 `JSON.parse` 两次；提取输出统一 decodeOut（字面 `\n\t` 转义还原）。
4. daemon 已运行时 `--profile` 等参数被忽略；不要同时存在带/不带 `--profile` 的调用。
5. agent-browser refs 跨 CLI 调用失效，batch 内 snapshot 重新编号 → 用元素 ID + eval，不用 refs。
6. Edge/Chrome 127+ cookies 是 v20 App-Bound 加密，无法外部解密提取登录态 → 登录态靠 erp-chrome-profile 持久化。
7. editor_sdk：`open_file` 异步需轮询 `sheet_get_sheet_info` 就绪；`save_file` 遇 WPS(et.exe) 占用报 `Export file is occupied` → 改存新文件名，勿杀用户 WPS；**`set_cell_value` 后必须 `save_file`**，否则下次 open_file 从磁盘重载丢弃未保存修改。
8. Excel A 列有杂项行（如 row82 '22862384'）要跳过（sync_excel.py 已处理）。
9. ERP 会话有效期约 1 天，工作日早间首次触发大概率 session expired（返回码 2）→ 走 erp_login_holder 恢复会话再重跑。

## 脚本清单

| 脚本 | 语言 | 作用 |
|---|---|---|
| fetch_inventory.mjs | Node | 全自动采集 + 翻页补采 |
| erp_login_holder.mjs | Node | 备货页保活 + 会话恢复 |
| erp_session.mjs | Node | 主后台(index.aspx)保活（旧，可不用） |
| convert_extracted.mjs | Node | extracted_raw → inventory-today |
| process_inventory.mjs | Node | 比对 + 报告 + Excel 指令 |
| sync_excel.py | Python | 写 C 列 + 标红 |
| append_row.py | Python | 表格缺行时补 A/B/C 行 |
| js_setup_query.js | JS | 设查询参数 + 提交 SKU（浏览器内 eval） |
| js_extract_all.js | JS | 首页提取（浏览器内 eval） |
| js_extract_page.js | JS | 翻页提取（浏览器内 eval） |
| ab_run.mjs | Node | 单次 agent-browser 命令封装（调试用） |

## 维护 SKU 清单

新增/删除 SKU 时，**同时**改两处：
1. `scripts/js_setup_query.js` 的 `SKUS` 变量（换行分隔，浏览器查询用）。
2. `scripts/process_inventory.mjs` 的 `SKU_ORDER` 数组（报告排序 + Excel 更新用）。

两处顺序与数量必须一致，否则报告排序错乱或 Excel 漏更新。
