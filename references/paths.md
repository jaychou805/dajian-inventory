# 路径与配置说明

所有路径/SKU/仓库配置已集中到仓库根目录的 **`config.json`**，脚本运行时读取它，无需改脚本内部代码。

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
    "node": "...",          // node.exe 绝对路径
    "agentBrowser": "...",  // agent-browser.js 绝对路径
    "python": "...",        // python.exe 绝对路径
    "edsdkDir": "...",      // edsdk.py 所在目录（WorkBuddy 本地 Office 编辑技能）
    "chromeProfile": "...", // Chrome 登录 profile 目录
    "workDir": "...",       // 工作目录（脚本/数据所在）
    "excelFile": "..."      // Excel 源=目标文件
  },
  "warehouses": {
    "statistical": [...],   // 统计仓（严格精确匹配）
    "excluded": [...]       // 排除仓
  },
  "skuList": [...]          // SKU 清单（单一来源）
}
```

## 迁移到新机器：改什么

1. `paths.*` 全部改成新机器真实路径。
2. 若 node 版本变化，注意 `node.exe` 版本目录名（如 `22.22.2-6`）可能不同。
3. `chromeProfile` 需在新机器重新登录 ERP（登录态存于该 profile，无法跨机器迁移）。
4. `erp` / `warehouses` / `skuList` 通常无需改（除非业务变化）。

## 依赖清单

| 依赖 | 用途 | 获取 |
|---|---|---|
| node.exe | 运行 .mjs 脚本 | WorkBuddy 内置，或自行安装 Node 22+ |
| agent-browser | 浏览器自动化 CLI | node 模块，含各平台二进制（win32/darwin/linux） |
| Python 3.11+ | 运行 .py（Excel 写入） | 标准 Python |
| edsdk.py | 本地 Office/WPS 编辑 SDK | WorkBuddy 本地 Office 编辑技能目录；非 WorkBuddy 环境需自备等价工具 |
| Chrome + 登录 profile | ERP 登录态 | 首次用 erp_login_holder.mjs 登录后持久化 |

## 数据目录

运行时数据写入 `workDir/inventory-snapshots/`：
- `inventory-today.txt`（今日输入）
- `snapshot-YYYY-MM-DD.json`（每日快照，只保留最近两份）
- `excel-updates.json`（Excel 更新指令）
- `report-today.md`（日报）

`workDir/extracted_raw.txt` 为采集中间产物。
