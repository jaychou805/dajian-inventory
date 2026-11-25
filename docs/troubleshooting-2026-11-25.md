# 问题复盘 2026-11-25

## 1. 会话过期误判（登录保活卡住）

**现象**：`fetch_inventory.mjs` 首跑报 `redirected to login - session expired`，随后启动 `erp_login_holder.mjs` 弹登录窗，但状态文件 `erp_session_status.json` 一直停在 `starting`，持续数分钟不更新。

**根因**：agent-browser daemon 已在运行，`--profile` 参数被忽略，`open` 调用卡住未返回。实际浏览器早已加载到备货页 —— `default.target` 显示 `OverseasAnalysis.aspx`（未跳 Login），会话其实是有效的。

**解决**：直接停掉 holder，重跑 `fetch_inventory.mjs` 即成功。

**经验**：判定会话是否过期，优先查 `.agent-browser/default.target` 的实际 URL，而非仅凭 fetch 脚本的 redirect 报错；daemon 已运行时 holder 脚本的 open 轮询会失效。

## 2. sync_excel.py 硬编码读取范围 bug（核心问题）

**现象**：同步后报「表格缺失 114 个 SKU」，列表几乎覆盖全部新增 SKU。

**根因**：`sync_excel.py` 读取 A 列时写死 `end_row: 104`，只读到前 104 行；而表格 A 列实际已有 218 行 SKU（217 个监控 SKU + 1 个杂项行 `22862384`），105~218 行的 SKU 全被漏掉，误报为「缺失」。

**解决**：将读取范围改为 `end_row: 300`，全量同步 218 行、标红 159 行，真实缺失 = 0。

**经验**：SKU 清单 2026-11-24 扩充到 217 个后，A 列行数早已超过 104，硬编码上限必须同步放宽；用 `sheet_get_cell_data` 读大范围（如 300 行）不会有副作用，应设为足够大的固定值。

## 3. 全量同步超时

**现象**：修复后前台运行 `sync_excel.py`，300 秒超时（EXIT=124）。

**根因**：全量 218 行逐个 `sheet_set_cell_value` + `sheet_set_cell_style`，每次调用独立 subprocess 启动 python 进程，总耗时约 5 分钟。

**解决**：改为后台运行（run_in_background），等待完成。

**经验**：全量同步必须后台执行，前台 timeout 上限不够。
