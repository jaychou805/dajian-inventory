# 同事上手文档（从零到能跑）

> 适用：已经装了 **WorkBuddy**、且有 **智汇 ERP 账号** 的同事。
> 全程 4 步，约 10 分钟。照着做即可，不用懂代码。

---

## 第 1 步：下载 skill

打开 WorkBuddy，在对话里让 AI 帮你装，或手动 clone：

```bash
git clone https://github.com/jaychou805/dajian-inventory.git ~/.workbuddy/skills/dajian-inventory
```

> 没有 git 的话，直接到 GitHub 页面点「Code → Download ZIP」，解压后把 `dajian-inventory/` 整个文件夹放到 `C:\Users\<你的用户名>\.workbuddy\skills\` 下。

装完**重启 WorkBuddy**（或重开一个新对话），skill 生效。

前置条件（WorkBuddy 环境一般已自带）：Node 22+、Python 3.11+、系统 Chrome。**不需要装 agent-browser**——浏览器用的是你机器上现成的 Chrome。

---

## 第 2 步：一键配置（自动探测路径）

```bash
cd ~/.workbuddy/skills/dajian-inventory
node setup.mjs --excel "C:\Users\<你的用户名>\Desktop\你的库存表.xlsx"
```

脚本会**自动探测**并填入：
- `node` / `python`（从 WorkBuddy 内置目录自动找版本号）
- `chrome`（系统 Chrome / Edge，找不到时用 `--chrome "路径"` 指定）
- `edsdkDir`（自动找 WorkBuddy 安装目录）
- `chromeProfile` / `workDir`（按默认规则自动填，并创建目录）

**你只需要提供 `--excel`**（你自己的库存表路径），其余全自动。

运行后看到：

```
✅ node        : .../node.exe
✅ chrome      : C:/Program Files/Google/Chrome/Application/chrome.exe
✅ python      : .../python.exe
✅ edsdkDir    : ...
✅ excelFile   : 你的表.xlsx
   node 版本: 22.x（≥22，可用内置 WebSocket 直连 CDP）
SKU 数: 89
```

就说明配置成功。

### 如果不想用脚本（手动改）

打开 `config.json`，把 `paths` 里的 `你的用户名`、版本号、路径换成你自己的。模板参考 `config.example.json`。

### Excel 表结构要求（`--excel` 指向的文件）

默认约定（都可在 `config.json` 的 `excel` 段改）：

| 配置项 | 默认 | 含义 |
|---|---|---|
| `excel.skuCol` | `A` | SKU 列（8 位数字） |
| `excel.nameCol` | `B` | 商品名称列（自动补行时用） |
| `excel.inventoryCol` | `C` | 库存写入列，内容形如 `12+8`（美东+美西） |
| `excel.autoAppendMissing` | `false` | 表里没有的监控 SKU 是否自动补行 |

> ⚠️ 如果你的表 **C 列是成本/售价**，先跑一次搬列脚本（另存新文件、带校验，不动原表）：
> ```bash
> python scripts/restructure_excel.py
> ```
> 成功后按提示把 `paths.excelFile` 指向输出的 `<原名>-库存列已调整.xlsx`。

> `.xls` 老格式也能跑：脚本会自动另存一份 `.xlsx` 再写（edsdk 无法原地保存 OLE 格式），原 `.xls` 保留不动。

---

## 第 3 步：登录 ERP

```bash
node ~/.workbuddy/skills/dajian-inventory/scripts/erp_login_holder.mjs
```

会弹出一个 Chrome 窗口，在里面登录智汇 ERP（备货页）。登录成功后查看状态文件：

```bash
cat ~/.workbuddy/skills/dajian-inventory/erp_session_status.json
```

看到 `"phase": "logged_in"` 就成功了，按 Ctrl+C 停掉保活脚本。

> 登录态存在 `chromeProfile` 目录里，之后不用每次重登（约 1 天有效期，过期重跑这一步即可）。
> 注意：你自己日常用的 Chrome 登录 ≠ 这里弹出的窗口登录，两者 profile 是分开的。

---

## 第 4 步：日常使用

以后直接对 WorkBuddy 说：

- 「跑库存监控」
- 「查库存」
- 「同步库存」

它会自动走 `采集 → 比对 → 报告 → 写 Excel` 全流程，输出库存变化报告 + 更新好的 Excel。

---

## 遇到问题？

| 现象 | 原因 | 解法 |
|---|---|---|
| 输出 `SKU数` 不是 89 | config.json 没改对 | 回第 2 步重查路径 |
| 启动报「未找到 Chrome」 | 路径没探测到 | `node setup.mjs --excel ... --chrome "C:\Program Files\Google\Chrome\Application\chrome.exe"` |
| 启动报「Chrome 提前退出」/ 30s 内无 DevToolsActivePort | 同一 profile 已被占，或 Chrome 被杀软拦 | 关掉遗留的 Chrome 窗口重试；确认 `chromeProfile` 没被其他程序占用 |
| fetch 报 `Login.aspx` / 返回码 2 | ERP 会话过期 | 回第 3 步重登 |
| fetch 报「页面未就绪（#TextSKUs 未出现）」 | 备货页跳了登录页或加载太慢 | 先跑登录保活确认能进备货页 |
| 报告说「记录数不一致」 | 采集不完整 | 脚本会拒绝写快照与 Excel，重跑采集即可 |
| Excel 保存报 `occupied` | 你的表被 WPS/Excel 打开着 | 关闭表格后重跑，脚本会自动改存日期文件名 |
| 库存写到了错的列 | 表结构与默认约定不同 | 改 `excel.inventoryCol`，或先跑 `restructure_excel.py` |
| 库存列出现「0+0」但实际有货 | 该 SKU 不在三个统计仓里 | 核对 `warehouses.statistical` 与 SKU 仓库名 |
| 脚本找不到文件 | `workDir`/`excelFile` 路径错 | 检查路径是否真实存在 |
