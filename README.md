# 大件库存（dajian-inventory）

工作日海外仓库存自动监控与 Excel 同步 skill。

从智汇创想 ERP「海外仓备货」页全自动采集指定 SKU 的三个统计仓可用库存，与前一工作日快照比对，标红低库存（A 或 B ≤3），并同步写回本机 Excel 的库存列（默认 C 列，位置可在 `config.json` 里改）。

**浏览器层：系统 Chrome + CDP 直连（零 npm 依赖）**，不需要安装 `agent-browser`，也不受 WDAC 拦截第三方 Chrome 的影响。

## 安装

```bash
git clone https://github.com/jaychou805/dajian-inventory.git ~/.workbuddy/skills/dajian-inventory
```

也可以直接下载 ZIP 解压，把整个 `dajian-inventory/` 放到 `~/.workbuddy/skills/`（用户级）或项目 `.workbuddy/skills/`（项目级）。

## 首次使用

**👉 直接看 [`docs/setup.md`](docs/setup.md)**——同事专用傻瓜式上手文档，4 步从零到能跑：

1. 下载 skill
2. **一键配置**：`node setup.mjs --excel "你的库存表.xlsx"`（自动探测 node/chrome/python/edsdk 路径）
3. 登录 ERP：`node scripts/erp_login_holder.mjs`
4. 日常对 WorkBuddy 说「跑库存监控」即可

> 所有路径/SKU/仓库/Excel 列配置集中在 `config.json`，`setup.mjs` 自动探测生成；`config.example.json` 是带占位符的模板。

## 环境要求

| 项 | 要求 |
|---|---|
| Node | 22+（`cdp.mjs` 用内置 WebSocket 直连 CDP） |
| Python | 3.11+ |
| 浏览器 | 系统 Chrome 或 Edge（路径写进 `paths.chrome`，留空自动探测） |
| edsdk | WorkBuddy 本地 Office 编辑技能里的 `edsdk.py`（非 WorkBuddy 环境需自备等价 Excel 写入工具） |

## 结构

```
dajian-inventory/
├── setup.mjs                  # 一键配置（自动探测路径生成 config.json）
├── config.json                # 配置中心（你的真实路径，已在仓库）
├── config.example.json        # 模板（占位符，供参考）
├── SKILL.md                   # skill 主文档（含关键坑）
├── README.md
├── docs/
│   └── setup.md               # 同事上手文档（从零到能跑）
├── scripts/
│   ├── config.mjs             # 共享配置加载 + 路径绝对化
│   ├── cdp.mjs                # 系统 Chrome + CDP 直连（替代 agent-browser）
│   ├── fetch_inventory.mjs    # 采集 + 翻页
│   ├── erp_login_holder.mjs   # 会话恢复（备货页）
│   ├── erp_session.mjs        # 主后台保活（旧，可不用）
│   ├── convert_extracted.mjs  # 原始数据 → inventory-today
│   ├── process_inventory.mjs  # 比对 + 报告 + Excel 指令
│   ├── sync_excel.py          # 写库存列 + 标红
│   ├── restructure_excel.py   # 一次性搬列（成本列挪末尾）
│   ├── ab_run.mjs             # CDP 版调试工具
│   └── js_*.js                # 浏览器内 eval 脚本
└── references/
    └── paths.md               # 路径与配置说明
```

## 说明

详见 `SKILL.md`（含 14 条踩坑记录与改造说明）。
