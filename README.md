# 大件库存（dajian-inventory）

工作日海外仓库存自动监控与 Excel 同步 skill。

从智汇创想 ERP「海外仓备货」页全自动采集指定 SKU 的三个统计仓可用库存，与前一工作日快照比对，标红低库存（A 或 B ≤3），并同步写回本机 Excel 的 C 列。

## 安装

复制整个 `dajian-inventory/` 目录到 `~/.workbuddy/skills/`（用户级）或项目 `.workbuddy/skills/`（项目级）。

## 结构

```
dajian-inventory/
├── SKILL.md                  # skill 主文档（触发、流程、配置、坑）
├── scripts/                  # 全部可执行脚本
│   ├── fetch_inventory.mjs   # 采集
│   ├── erp_login_holder.mjs  # 会话恢复
│   ├── convert_extracted.mjs # 转换
│   ├── process_inventory.mjs # 比对+报告
│   ├── sync_excel.py         # 写 Excel
│   ├── append_row.py         # 补行
│   └── js_*.js               # 浏览器内 eval 脚本
└── references/
    └── paths.md              # 绝对路径依赖清单（迁移必读）
```

## 说明

- 脚本内含本机绝对路径，迁移需改（见 `references/paths.md`）。
- 详见 `SKILL.md`。
