# 路径与配置说明

所有路径 / SKU / 仓库 / Excel 列配置已集中到仓库根目录的 **`config.json`**，脚本运行时读取它，无需改脚本内部代码。

`scripts/config.mjs` 会额外做两件事：
1. 把 `workDir`、`chromeProfile` 展开 `~` 并转成**绝对路径**（所以脚本在哪个目录运行都一样）；
2. 写文件前懒创建 `workDir` 与 `workDir/inventory-snapshots`。

## config.json 结构

```jsonc
{
  "erp": {
    "loginUrl": "...",      // ERP 登录页
    "overseasUrl": "...",   // 备货页（直连）
    "startTime": "2022-07-01",
    "pageSize": 200
  },
  "paths": {
    "node": "...",          // node.exe 绝对路径（建议 Node 22+）
    "chrome": "...",        // chrome.exe / msedge.exe 绝对路径（留空自动探测）
    "python": "...",        // python.exe 绝对路径
    "edsdkDir": "...",      // edsdk.py 所在目录（WorkBuddy 本地 Office 编辑技能）
    "chromeProfile": "...", // 登录态 profile 目录（删掉即需重登）
    "workDir": "...",       // 工作目录（快照/报告/中间产物）
    "excelFile": "..."      // Excel 源=目标文件（.xls 会自动另存 .xlsx）
  },
  "browser": {
    "headless": false,      // 定时任务可设 true；首次登录必须 false
    "launchTimeoutMs": 30000
  },
  "excel": {
    "sheetId": "000001",         // 子表 id（也可填子表名）
    "skuCol": "A",               // SKU 列
    "nameCol": "B",              // 名称列
    "inventoryCol": "C",         // 库存写入列 ← 关键，别写死假设
    "headerRow": 0,              // 表头所在行（0-based）
    "autoAppendMissing": false,  // 缺失 SKU 是否自动补行
    "appendOnlyWithData": true,  // 补行时只补 ERP 里有数据的
    "preferXlsx": true,          // .xls + 同名 .xlsx 并存时优先 .xlsx
    "outputFile": "",            // 空 = 原地覆盖 / 写同名 .xlsx
    "costCol": "",               // 搬列脚本用：成本列字母（空则按表头名找）
    "costHeaderNames": ["成本", "成本价", "采购成本"]
  },
  "warehouses": {
    "statistical": [...],   // 统计仓（严格精确匹配）
    "excluded": [...]       // 排除仓
  },
  "skuList": [...]          // SKU 清单（单一来源）
}
```

## 迁移到新机器：改什么

1. `paths.*` 全部改成新机器真实路径（或直接跑 `node setup.mjs --excel "..."`）。
2. 若 node 版本变化，注意版本目录名（如 `22.22.2-6`）可能不同。
3. `chromeProfile` 需在新机器重新登录 ERP（登录态无法跨机器迁移）。
4. `erp` / `warehouses` / `skuList` 通常无需改（除非业务变化）。
5. 换了 Excel 表结构，记得同步 `excel.*`（尤其 `inventoryCol`）。

## 依赖清单

| 依赖 | 用途 | 获取 |
|---|---|---|
| node.exe 22+ | 运行 .mjs 脚本（CDP 依赖内置 WebSocket） | WorkBuddy 内置，或自行安装 |
| 系统 Chrome / Edge | 浏览器自动化（CDP 直连） | 系统自带；**不再需要 agent-browser / Chrome for Testing** |
| Python 3.11+ | 运行 .py（Excel 写入、搬列） | 标准 Python |
| edsdk.py | 本地 Office/WPS 编辑 SDK | WorkBuddy 本地 Office 编辑技能目录；非 WorkBuddy 环境需自备等价工具 |

## 为什么不用 agent-browser

| 问题 | 说明 |
|---|---|
| DevToolsActivePort 不生成 | Chrome 157+ 只在 `--remote-debugging-port=0` 时才写该文件，agent-browser 0.27.0 是「指定端口 + 等文件」→ 必然超时 |
| 升级受阻 | agent-browser 0.41+ 要求 node ≥ 24 |
| WDAC 拦截 | 其预编译 exe 与下载的 Chrome for Testing 在启用应用程序控制策略的机器上会被拦（`os error 4551`） |

现方案：`scripts/cdp.mjs` 用系统 Chrome（`--remote-debugging-port=0`）+ Node 内置 WebSocket 走 CDP，零依赖。

## 数据目录

运行时数据写入 `workDir/inventory-snapshots/`：
- `inventory-today.txt`（今日输入）
- `snapshot-YYYY-MM-DD.json`（每日快照，只保留最近两份）
- `excel-updates.json`（Excel 更新指令，含 sku/name/value/a/b/redFlag/hasAny）
- `report-today.md`（日报）

`workDir/extracted_raw.txt` 为采集中间产物，`workDir/erp_session_status.json` 为登录保活状态。
