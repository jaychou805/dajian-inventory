// 一键跑完整个库存日报链路：采集 → 转换 → 比对/报告 → 同步 Excel → 上传报告到 GitHub
// 供定时自动化直接调用：node scripts/run_daily.mjs
//
// 退出码：
//   0  全部成功
//   2  采集时 ERP 会话过期（需先跑 erp_login_holder.mjs 恢复登录态）
//   3  配置不完整（config.json 里路径不存在，通常是换了机器没跑 setup.mjs）
//   其他  出错步骤的退出码（1 表示脚本自身异常）
//
// 可选参数：
//   --skip-fetch        跳过采集，从已存在的 extracted_raw.txt 继续
//   --skip-excel        跳过 Excel 写入（只出报告）
//   --only=a,b,c        只跑指定步骤（fetch/convert/process/excel/upload）
//   --quiet             只在最后打印汇总
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { cfg, WORKDIR, ensureDirs } from './config.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const hasFlag = (n) => argv.includes('--' + n);
const onlyArg = (argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const only = onlyArg ? onlyArg.split(',').map((s) => s.trim()).filter(Boolean) : null;

const quiet = hasFlag('quiet');
const skipFetch = hasFlag('skip-fetch');
const skipExcel = hasFlag('skip-excel');

const NODE = process.execPath;
const PYTHON = pickPython();

function pickPython() {
  const p = (cfg.paths && cfg.paths.python) || '';
  if (p && fs.existsSync(p)) return p;
  return process.platform === 'win32' ? 'python' : 'python3';
}

// 日志先缓冲在内存，等确认 workDir 可用后再落盘（避免在错误路径上创建目录）
let LOG_FILE = null;
const pendingLog = [];

function log(msg) {
  const line = '[' + new Date().toISOString().replace('T', ' ').slice(0, 19) + '] ' + msg;
  if (!quiet) console.log(line);
  if (!LOG_FILE) { pendingLog.push(line); return; }
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (e) { /* 日志失败不影响主流程 */ }
}

function enableFileLog() {
  const dir = path.join(WORKDIR, 'logs');
  try {
    fs.mkdirSync(dir, { recursive: true });
    LOG_FILE = path.join(dir, 'daily-' + new Date().toISOString().slice(0, 10) + '.log');
    for (const l of pendingLog) fs.appendFileSync(LOG_FILE, l + '\n');
    pendingLog.length = 0;
  } catch (e) {
    LOG_FILE = null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runStep(label, cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    log('▶ ' + label + ' 开始');
    const child = spawn(cmd, args, {
      cwd: SCRIPT_DIR,
      stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
      windowsHide: false,
    });
    let tail = '';
    if (quiet) {
      const grab = (d) => {
        tail = (tail + d.toString()).slice(-4000);
      };
      child.stdout.on('data', grab);
      child.stderr.on('data', grab);
    }
    let timer = null;
    if (timeoutMs) {
      timer = setTimeout(() => {
        log('✖ ' + label + ' 超时（' + Math.round(timeoutMs / 1000) + 's），终止进程');
        try { child.kill('SIGKILL'); } catch (e) { /* ignore */ }
      }, timeoutMs);
    }
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 1, sec: 0, err: String(e.message || e) });
    });
    child.on('exit', (code) => {
      if (timer) clearTimeout(timer);
      const sec = ((Date.now() - started) / 1000).toFixed(1);
      resolve({ code: code === null ? 1 : code, sec, tail });
    });
  });
}

const today = new Date().toISOString().slice(0, 10);
const summary = [];
const want = (s) => !only || only.includes(s);

// ---------- 0. 前置检查：配置里的路径必须在本机真实存在 ----------
// 换机器后最常见的失败就是 config.json 还指着上一台机器的路径，直接抛 EACCES 很难看懂
function preflight() {
  const p = cfg.paths || {};
  const problems = [];

  if (want('fetch') && !skipFetch) {
    if (!p.chrome) problems.push('paths.chrome 未配置（Chrome 可执行文件路径）');
    else if (!fs.existsSync(p.chrome)) problems.push('paths.chrome 不存在：' + p.chrome);
  }

  if (want('excel') && !skipExcel) {
    if (!p.excelFile) problems.push('paths.excelFile 未配置（要写入的 Excel 路径）');
    else if (!fs.existsSync(p.excelFile)) problems.push('paths.excelFile 不存在：' + p.excelFile);
    if (p.edsdkDir && !fs.existsSync(p.edsdkDir)) problems.push('paths.edsdkDir 不存在：' + p.edsdkDir);
    if (!p.edsdkDir) problems.push('paths.edsdkDir 未配置（edsdk.py 所在目录）');
    if (p.python && !fs.existsSync(p.python)) log('· 提示：paths.python 不存在，将回退到 PATH 里的 python');
  }

  // workDir 的父目录要能写（不存在则 ensureDirs 创建失败）
  const parent = path.dirname(WORKDIR);
  if (!fs.existsSync(parent)) problems.push('workDir 的上级目录不存在：' + parent);

  return problems;
}

log('===== 库存日报开始 ' + today + ' =====');
log('工作目录：' + WORKDIR);
log('Excel：' + ((cfg.paths && cfg.paths.excelFile) || '(未配置)'));

const preProblems = preflight();
if (preProblems.length) {
  log('✖ 配置不完整，已中止（未采集、未改任何文件）');
  for (const s of preProblems) log('   - ' + s);
  log('  处置：在本机跑一次  node setup.mjs --excel "你的库存表.xlsx"  （会按本机路径重写 config.json）');
  log('        或直接编辑 config.json 的 paths 段。详见 references/paths.md');
  process.exit(3);
}

// 前置检查通过后才建目录、开日志文件
ensureDirs();
enableFileLog();
let failed = null;

// ---------- 1. 采集 ----------
if (want('fetch') && !skipFetch) {
  const r = await runStep('采集海外仓库存', NODE, [path.join(SCRIPT_DIR, 'fetch_inventory.mjs')], 20 * 60 * 1000);
  summary.push({ step: '采集', code: r.code, sec: r.sec });
  if (r.code === 2) {
    log('✖ ERP 会话已过期（返回码 2）');
    log('  处置：先运行 node scripts/erp_login_holder.mjs 恢复登录态，再重跑本脚本');
    failed = { step: '采集（会话过期）', code: 2 };
  } else if (r.code !== 0) {
    log('✖ 采集失败，退出码 ' + r.code);
    failed = { step: '采集', code: r.code, tail: r.tail };
  }
} else {
  const rawPath = path.join(WORKDIR, 'extracted_raw.txt');
  if (!fs.existsSync(rawPath)) {
    log('✖ 跳过采集，但缺少 ' + rawPath);
    failed = { step: '采集（已跳过且无输入）', code: 1 };
  } else {
    log('· 跳过采集，沿用已有 extracted_raw.txt');
  }
}

// ---------- 2. 转换 ----------
if (!failed && want('convert')) {
  const r = await runStep('转换数据', NODE, [path.join(SCRIPT_DIR, 'convert_extracted.mjs')], 5 * 60 * 1000);
  summary.push({ step: '转换', code: r.code, sec: r.sec });
  if (r.code !== 0) {
    log('✖ 转换失败，退出码 ' + r.code);
    failed = { step: '转换', code: r.code, tail: r.tail };
  }
}

// ---------- 3. 比对 + 报告 ----------
if (!failed && want('process')) {
  const r = await runStep('比对并生成报告', NODE, [path.join(SCRIPT_DIR, 'process_inventory.mjs')], 10 * 60 * 1000);
  summary.push({ step: '比对/报告', code: r.code, sec: r.sec });
  if (r.code !== 0) {
    log('✖ 比对失败（条数不一致或快照异常），未写快照');
    failed = { step: '比对/报告', code: r.code, tail: r.tail };
  }
}

// ---------- 4. 同步 Excel ----------
if (!failed && want('excel') && !skipExcel) {
  const r = await runStep('同步 Excel', PYTHON, [path.join(SCRIPT_DIR, 'sync_excel.py')], 15 * 60 * 1000);
  summary.push({ step: 'Excel', code: r.code, sec: r.sec });
  if (r.code !== 0) {
    log('✖ Excel 写入失败，退出码 ' + r.code);
    failed = { step: 'Excel', code: r.code, tail: r.tail };
  }
} else if (!failed && (skipExcel || !want('excel'))) {
  log('· 跳过 Excel 写入');
}

// ---------- 5. 上传报告到 GitHub（失败不阻断主流程，只告警） ----------
if (!failed && want('upload')) {
  const hasGithub = cfg.github && cfg.github.repo && (cfg.github.token || process.env.GITHUB_TOKEN);
  if (!hasGithub) {
    log('· 跳过上传：未配置 github.repo / github.token');
  } else {
    const r = await runStep('上传报告到 GitHub', NODE, [path.join(SCRIPT_DIR, 'upload_report.mjs')], 3 * 60 * 1000);
    summary.push({ step: '上传报告', code: r.code, sec: r.sec });
    if (r.code !== 0) {
      log('⚠ 上传报告失败（退出码 ' + r.code + '），不影响库存与 Excel 结果');
      if (r.tail) log('  末尾输出：\n  ' + r.tail.trim().split('\n').slice(-4).join('\n  '));
    }
  }
}

// ---------- 汇总 ----------
log('===== 汇总 =====');
for (const s of summary) log('  ' + s.step + '：' + (s.code === 0 ? 'OK' : 'FAIL(' + s.code + ')') + '  ' + s.sec + 's');
const reportPath = path.join(WORKDIR, 'inventory-snapshots', 'report-today.md');
if (fs.existsSync(reportPath) && !failed) log('  报告：' + reportPath);
else if (fs.existsSync(reportPath)) log('  报告（可能为旧文件）：' + reportPath);
log('  日志：' + LOG_FILE);

if (failed) {
  log('结果：失败于「' + failed.step + '」');
  if (failed.tail) {
    const last = failed.tail.trim().split('\n').slice(-6).join('\n  ');
    log('  末尾输出：\n  ' + last);
  }
  process.exit(failed.code || 1);
} else {
  log('结果：全部成功');
  if (reportPath && fs.existsSync(reportPath)) {
    console.log('\n' + fs.readFileSync(reportPath, 'utf8'));
  }
  process.exit(0);
}
