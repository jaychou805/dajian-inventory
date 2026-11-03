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

## 第 2 步：改配置（唯一要动手的地方）

打开文件：

```
C:\Users\<你的用户名>\.workbuddy\skills\dajian-inventory\config.json
```

里面有一块 `paths`，长这样（这是作者的机器，你要改成自己的）：

```jsonc
"paths": {
  "node": "C:/Users/xiaozhihe/.workbuddy/binaries/node/versions/22.22.2-6/node.exe",
  "agentBrowser": "C:/Users/xiaozhihe/.workbuddy/binaries/node/versions/22.22.2-6/node_modules/agent-browser/bin/agent-browser.js",
  "python": "C:/Users/xiaozhihe/.workbuddy/binaries/python/versions/3.13.12/python.exe",
  "edsdkDir": "D:/WorkBuddy/resources/app.asar.unpacked/resources/plugins/workbuddy-builtin/skills/workbuddy-local-office-edit",
  "chromeProfile": "C:/Users/xiaozhihe/.workbuddy/erp-chrome-profile",
  "workDir": "C:/Users/xiaozhihe/WorkBuddy/1",
  "excelFile": "C:/Users/xiaozhihe/Desktop/95已上产品-已同步最新库存-20260915.xlsx"
}
```

### 逐个字段怎么填

| 字段 | 填什么 | 怎么找到真实值 |
|---|---|---|
| `node` | 你机器上的 node.exe | 见下方「查路径」命令 ① |
| `agentBrowser` | agent-browser.js | 和 node 同版本目录，见命令 ② |
| `python` | 你机器上的 python.exe | 见命令 ③ |
| `edsdkDir` | WorkBuddy 的本地 Office 编辑技能目录 | 见命令 ④ |
| `chromeProfile` | 任意目录，建议 `C:/Users/<你>/.workbuddy/erp-chrome-profile` | 不存在会自动创建，不用预先建 |
| `workDir` | 你想放数据的地方，建议 `C:/Users/<你>/WorkBuddy/1` | 随便填，能建目录即可 |
| `excelFile` | **你自己的库存 Excel 路径** | 你的表在哪就填哪，文件名按实际 |

### 查路径命令（复制到 WorkBuddy 终端或 CMD 跑）

```bash
# ① node 版本目录
ls ~/.workbuddy/binaries/node/versions/

# ② agent-browser（和 node 同目录）
ls ~/.workbuddy/binaries/node/versions/<上一步的版本号>/node_modules/agent-browser/bin/

# ③ python 版本目录
ls ~/.workbuddy/binaries/python/versions/

# ④ edsdk 目录（WorkBuddy 装在哪个盘就换成哪个盘）
# 常见：D:/WorkBuddy 或 C:/Program Files/WorkBuddy
ls "D:/WorkBuddy/resources/app.asar.unpacked/resources/plugins/workbuddy-builtin/skills/"
```

> 核心就是：把 `xiaozhihe` 换成你的用户名，把版本号换成你机器上的实际版本号。

### 最容易踩的两个坑

1. **版本号目录不同**：`22.22.2-6`、`3.13.12` 这类目录名每台机器可能不一样，务必用 `ls` 查实际值，别照抄。
2. **`excelFile` 必须是自己的表**：这是库存要写进去的目标文件，结构要求见下。

### Excel 表结构要求（`excelFile` 指向的文件）

- **A 列** = SKU（8 位数字）
- **C 列** = 库存值（脚本会写 `A+B`，即美东仓+美西仓，格式如 `12+8`）
- A 列里的 SKU 要和 `config.json` 的 `skuList` 一致（不同 SKU 会跳过，并在报告里提示缺失）

### 改完验证

```bash
cd ~/.workbuddy/skills/dajian-inventory/scripts
node -e "import('./config.mjs').then(m=>console.log('SKU数:', m.cfg.skuList.length))"
```

输出 `SKU数: 89` 就说明配置读对了。

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
