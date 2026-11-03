# 大件库存（dajian-inventory）

工作日海外仓库存自动监控与 Excel 同步 skill。

从智汇创想 ERP「海外仓备货」页全自动采集指定 SKU 的三个统计仓可用库存，与前一工作日快照比对，标红低库存（A 或 B ≤3），并同步写回本机 Excel 的 C 列。

## 安装

复制整个 `dajian-inventory/` 目录到 `~/.workbuddy/skills/`（用户级）或项目 `.workbuddy/skills/`（项目级）。

```bash
git clone https://github.com/jaychou805/dajian-inventory.git ~/.workbuddy/skills/dajian-inventory
```

## 首次使用

**👉 直接看 [`docs/setup.md`](docs/setup.md)**——同事专用傻瓜式上手文档，4 步从零到能跑：

1. 下载 skill
2. 改 `config.json`（复制 `config.example.json` 改路径）
3. 登录 ERP
4. 日常对 WorkBuddy 说「跑库存监控」即可

> 所有路径/SKU/仓库配置集中在 `config.json`，脚本运行时读取，改这一处即可迁移。`config.example.json` 是带占位符的模板，供首次配置参考。

## 结构

```
dajian-inventory/
├── config.json               # 配置中心（你的真实路径，已在仓库）
├── config.example.json       # 模板（占位符，供同事参考）
├── SKILL.md                  # skill 主文档
├── README.md
├── docs/
│   └── setup.md              # 同事上手文档（从零到能跑）
├── scripts/
│   ├── config.mjs            # 共享配置加载
│   ├── fetch_inventory.mjs   # 采集
│   ├── erp_login_holder.mjs  # 会话恢复
│   ├── convert_extracted.mjs # 转换
│   ├── process_inventory.mjs # 比对+报告
│   ├── sync_excel.py         # 写 Excel
│   ├── append_row.py         # 补行
│   └── js_*.js               # 浏览器内 eval 脚本
└── references/
    └── paths.md              # 路径说明（已抽到 config.json）
```

## 说明

详见 `SKILL.md`。
