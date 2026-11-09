# 开启工作日 09:00 定时巡检

本文解决一件事：**让这台机器每个工作日早 9 点自动跑完库存日报**。

## 为什么仓库里没有「现成的定时任务」

定时任务存在**本机 WorkBuddy**（跟账号、跟机器走），不跟 git 仓库走。所以 skill 提供两样东西：

1. `scripts/run_daily.mjs` —— 一条命令跑完整链路，任务只需要调它；
2. 本文件里的**创建参数与提示词模板** —— 让 agent 照抄即可建任务，不用自己想。

换机器、重装 skill、换账号，都要重新开启一次。

## 步骤

### 1. 先确认手动能跑通

```bash
node setup.mjs --excel "D:\你的库存表.xlsx"     # 按本机重写 config.json
node scripts/erp_login_holder.mjs               # 弹窗登录 ERP，登录态存进 chromeProfile
node scripts/run_daily.mjs                      # 应能跑完四步、写出 report-today.md
```

手动跑不通就别开定时任务——9 点没人看着，报错只能等你看日志。

### 2. 让 agent 创建定时任务

对 WorkBuddy 说：

> 用大件库存 skill 开启工作日 9 点的定时巡检

agent 会调用 `automation_update`（`mode=create`），按下面参数建任务：

| 参数 | 值 |
|---|---|
| name | `大件库存 · 工作日 09:00 巡检` |
| scheduleType | `recurring` |
| rrule | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0` |
| status | `ACTIVE` |
| cwds | 本机 skill 目录绝对路径（含 `scripts/run_daily.mjs` 的那一层） |
| prompt | 下方模板，`<SKILL_DIR>` 换成本机路径 |

提示词模板：

```
运行大件库存 skill（目录：<SKILL_DIR>）。在该目录执行 `node scripts/run_daily.mjs`，它会依次完成
采集海外仓库存 → 转换 → 与前一工作日快照比对生成报告 → 同步 Excel（配置见同目录 config.json，
日志写到 workDir/logs/）。完成后按 SKILL.md「结果报告格式」输出当日结论：采集条数与页面
「共 N 条」是否一致、三个统计仓分布、变化与触红 SKU（A 或 B ≤3）、Excel 更新行数与缺失 SKU，
并附 workDir/inventory-snapshots/report-today.md。失败处置：退出码 3 = config.json 路径在本机
不可用，报告缺哪几项并提示运行 `node setup.mjs --excel "<库存表路径>"`；退出码 2 = ERP 会话过期，
先运行 `node scripts/erp_login_holder.mjs` 恢复后重跑一次，仍失败则说明需要人工登录；其他退出码
按日志如实报告失败步骤。严禁编造或沿用昨日库存数字。
```

> 为什么必须写成自包含：定时任务运行时是全新会话，看不到你现在的对话，所有路径、处置规则都得写进去。

### 3. 核对与维护

| 操作 | 做法 |
|---|---|
| 核对下次触发 | `automation_update` `mode=list`，看 `nextRunAt` 是否为下一个工作日 09:00 |
| 临时停 | `mode=update`，`status=PAUSED` |
| 删除 | `mode=delete` + id |
| 改时间 | `mode=update` 改 `rrule`（不要删了重建） |

## 常见问题

**9:00 报「配置不完整（退出码 3）」**
`config.json` 里的 `paths` 还是别的机器的。跑 `node setup.mjs --excel "..."` 重写，或手改 `paths`。

**9:00 报「ERP 会话过期（退出码 2）」**
ERP 会话大约 1 天有效，早上第一次触发大概率已过期。这是常态，提示词里已内置「先跑 `erp_login_holder.mjs` 再重跑」。真过期时 Chrome 会停在登录页，需要人到窗口里登一次。

**要不要再配一个 08:50 的保活任务？**
不建议。`erp_login_holder.mjs` 会占用同一个 `chromeProfile` 并保活 30 分钟，和 9:00 的采集抢同一个 profile，反而更容易出问题。交给提示词里的「失败后保活再重跑」更稳。

**定时跑的时候会不会弹出 Chrome 窗口？**
会。`browser.headless` 默认 `false`——登录和排障都需要可见窗口。确认长期稳定后可改 `true`，但首次登录仍要改回来。

**改了 SKU 清单或 Excel 列要重建任务吗？**
不用。任务只调 `run_daily.mjs`，一切读 `config.json`。

## 无人值守时的注意事项

- 机器要开机、不能睡眠；Windows 休眠会错过触发时间。
- Chrome 若被安全软件拦（WDAC / `os error 4551`），必须用系统 Chrome——`cdp.mjs` 默认就是系统 Chrome，别改成下载版。
- 日志在 `<workDir>/logs/daily-YYYY-MM-DD.log`，出问题先看它，再看 `report-today.md` 是否更新。
