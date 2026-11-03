# 路径依赖清单

脚本内含**绝对路径**，迁移到新机器或新账号时需修改以下位置。

## 1. Node 可执行文件与 agent-browser

出现在：`fetch_inventory.mjs`、`erp_login_holder.mjs`、`erp_session.mjs`、`ab_run.mjs`

```
const NODE = 'C:/Users/xiaozhihe/.workbuddy/binaries/node/versions/22.22.2-6/node.exe';
const AB   = 'C:/Users/xiaozhihe/.workbuddy/binaries/node/versions/22.22.2-6/node_modules/agent-browser/bin/agent-browser.js';
```

> 注意版本号目录 `22.22.2-6` 可能变化；`ab_run.mjs` 里是 `22.22.2-3`（旧）。

## 2. Chrome 登录 Profile

出现在：上述所有 .mjs 的 `PROFILE` 常量

```
C:/Users/xiaozhihe/.workbuddy/erp-chrome-profile
```

登录态存于此 profile，过期需用户在弹出窗口重登。

## 3. 工作目录 / 状态文件

- `fetch_inventory.mjs` 的 `ROOT = 'C:/Users/xiaozhihe/WorkBuddy/1'`
- `convert_extracted.mjs` 的硬编码读写路径（extracted_raw.txt、inventory-today.txt）
- `erp_login_holder.mjs` / `erp_session.mjs` 的 `STATUS_FILE = '.../erp_session_status.json'`

## 4. Excel 文件

- `sync_excel.py`：`SRC` / `DST` = `C:/Users/xiaozhihe/Desktop/95已上产品-已同步最新库存-20260915.xlsx`
- `append_row.py`：`SRC` 同 Excel 路径

## 5. Python 与 editor_sdk

- `sync_excel.py` / `append_row.py`：
  - `PYTHON = C:/Users/xiaozhihe/.workbuddy/binaries/python/versions/3.13.12/python.exe`
  - `EDSdk_DIR`（sync_excel.py 指向 `workbuddy-local-office-edit`，append_row.py 指向 `tencent-local-office-edit`）

## 数据目录

运行时数据写入工作目录下的 `inventory-snapshots/`：
- `inventory-today.txt`（今日输入）
- `snapshot-YYYY-MM-DD.json`（每日快照，只保留最近两份）
- `excel-updates.json`（Excel 更新指令）
- `report-today.md`（日报）
