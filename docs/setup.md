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

---

## 第 2 步：一键配置（自动探测路径）

跑仓库根目录的一键配置脚本：

```bash
cd ~/.workbuddy/skills/dajian-inventory
node setup.mjs --excel "C:\Users\<你的用户名>\Desktop\你的库存表.xlsx"
```

脚本会**自动探测**并填入：
- `node` / `agent-browser` / `python`（从 WorkBuddy 内置目录自动找版本号）
- `edsdkDir`（自动找 WorkBuddy 安装目录）
- `chromeProfile` / `workDir`（按默认规则自动填）

**你只需要提供 `--excel`**（你自己的库存表路径），其余全自动。

运行后看到：

```
✅ node       : .../node.exe
✅ agentBrowser: .../agent-browser.js
✅ python     : .../python.exe
✅ edsdkDir   : ...
✅ excelFile  : 你的表.xlsx
SKU 数: 89
✅ 全部就绪，请登录 ERP
```

就说明配置成功。

### 如果不想用脚本（手动改）

打开 `config.json`，把 `paths` 里的 `xiaozhihe`、版本号、路径换成你自己的。模板参考 `config.example.json`。

### Excel 表结构要求（`--excel` 指向的文件）

- **A 列** = SKU（8 位数字）
- **C 列** = 库存值（脚本会写 `A+B`，即美东仓+美西仓，格式如 `12+8`）
- A 列里的 SKU 要和 `config.json` 的 `skuList` 一致（不同 SKU 会跳过，并在报告里提示缺失）

---

## 第 3 步：登录 ERP

跑下面命令，会弹出一个 Chrome 窗口：

```bash
node ~/.workbuddy/skills/dajian-inventory/scripts/erp_login_holder.mjs
```

在弹出的窗口里登录智汇 ERP（备货页），登录成功后：

```bash
cat ~/.workbuddy/skills/dajian-inventory/erp_session_status.json
```

看到 `"phase": "logged_in"` 就成功了，按 Ctrl+C 停掉保活脚本。

> 登录态会存到 `chromeProfile`，之后不用每次重登（约 1 天有效期，过期重跑这一步即可）。

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
| fetch 报 `Login.aspx` / 返回码 2 | ERP 会话过期 | 回第 3 步重登 |
| Excel 保存报 `occupied` | 你的表被 WPS/Excel 打开着 | 关闭表格后重跑，脚本会自动改存日期文件名 |
| 脚本找不到文件 | `workDir`/`excelFile` 路径错 | 检查路径是否真实存在 |
