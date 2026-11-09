// 一键配置脚本：自动探测本机 node / chrome / python / edsdk 路径，生成 config.json
// 用法：
//   node setup.mjs --excel "C:\Users\xxx\Desktop\我的库存.xlsx"
//   node setup.mjs --excel "..." --workdir "C:\Users\xxx\WorkBuddy\1"
//   node setup.mjs --excel "..." --chrome "D:\Chrome\chrome.exe"
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname; // setup.mjs 位于仓库根目录
const HOME = os.homedir();

const args = process.argv.slice(2);
function argVal(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}
const excelArg = argVal('--excel');
const workdirArg = argVal('--workdir');
const chromeArg = argVal('--chrome');

function exists(p) { try { return !!p && fs.existsSync(p); } catch (e) { return false; } }
function ls(dir) { try { return fs.readdirSync(dir); } catch (e) { return []; } }
function toWin(p) { return p ? p.replace(/\\/g, '/') : p; }

function pickVersionDir(base) {
  const list = ls(base).filter(n => n !== 'current' && n !== '.DS_Store');
  if (list.length) return list.sort().pop();
  return null;
}

function findNode() {
  const base = path.join(HOME, '.workbuddy', 'binaries', 'node', 'versions');
  const v = pickVersionDir(base);
  if (!v) return null;
  const p = path.join(base, v, 'node.exe');
  return exists(p) ? p : null;
}

function findPython() {
  const base = path.join(HOME, '.workbuddy', 'binaries', 'python', 'versions');
  const v = pickVersionDir(base);
  if (!v) return null;
  const p = path.join(base, v, 'python.exe');
  return exists(p) ? p : null;
}

function findChrome() {
  if (exists(chromeArg)) return chromeArg;
  if (exists(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe') : null,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ];
  for (const c of candidates) if (exists(c)) return c;
  return null;
}

function findEdsdkDir() {
  const candidates = [
    'D:/WorkBuddy', 'C:/WorkBuddy',
    'D:/Program Files/WorkBuddy', 'C:/Program Files/WorkBuddy',
    'D:/Program Files (x86)/WorkBuddy', 'C:/Program Files (x86)/WorkBuddy',
    'D:/all app/workbuddy',
  ];
  for (const base of candidates) {
    const p = path.join(base, 'resources', 'app.asar.unpacked', 'resources', 'plugins', 'workbuddy-builtin', 'skills', 'workbuddy-local-office-edit');
    if (exists(p)) return toWin(p);
  }
  return null;
}

// 校验 node 版本：cdp.mjs 依赖 Node 22+ 的内置 WebSocket
function nodeVersion(p) {
  if (!p) return null;
  try {
    const out = execFileSync(p, ['-v'], { encoding: 'utf8' }).trim();
    return out.replace(/^v/, '');
  } catch (e) {
    return null;
  }
}

function main() {
  console.log('大件库存 skill 一键配置\n');

  const examplePath = path.join(ROOT, 'config.example.json');
  if (!exists(examplePath)) {
    console.error('缺少 config.example.json，无法生成配置');
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(examplePath, 'utf8'));

  const node = findNode();
  const chrome = findChrome();
  const python = findPython();
  const edsdkDir = findEdsdkDir();
  const chromeProfile = path.join(HOME, '.workbuddy', 'erp-chrome-profile');
  const workDir = workdirArg || path.join(HOME, 'WorkBuddy', '1');
  const excelFile = excelArg || cfg.paths.excelFile;

  cfg.paths.node = toWin(node || cfg.paths.node);
  cfg.paths.chrome = toWin(chrome || cfg.paths.chrome);
  cfg.paths.python = toWin(python || cfg.paths.python);
  cfg.paths.edsdkDir = toWin(edsdkDir || cfg.paths.edsdkDir);
  cfg.paths.chromeProfile = toWin(chromeProfile);
  cfg.paths.workDir = toWin(workDir);
  cfg.paths.excelFile = toWin(excelFile);

  const check = (name, v) => `${exists(v) ? '✅' : '❌'} ${name}: ${v}`;
  console.log(check('node        ', cfg.paths.node));
  console.log(check('chrome      ', cfg.paths.chrome));
  console.log(check('python      ', cfg.paths.python));
  console.log(check('edsdkDir    ', cfg.paths.edsdkDir));
  console.log(`   chromeProfile（自动创建）: ${cfg.paths.chromeProfile}`);
  console.log(`   workDir    : ${cfg.paths.workDir}`);
  console.log(check('excelFile   ', cfg.paths.excelFile));

  const ver = nodeVersion(node);
  if (ver) {
    const major = parseInt(ver.split('.')[0], 10);
    if (major < 22) console.log(`⚠️  Node ${ver} 太旧：cdp.mjs 需要 Node 22+（内置 WebSocket），请升级`);
    else console.log(`   node 版本: ${ver}（≥22，可用内置 WebSocket 直连 CDP）`);
  }

  // 建目录
  for (const d of [cfg.paths.chromeProfile, path.join(cfg.paths.workDir, 'inventory-snapshots')]) {
    try { fs.mkdirSync(d, { recursive: true }); } catch (e) { /* ignore */ }
  }

  fs.writeFileSync(path.join(ROOT, 'config.json'), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  console.log('\n已写入 config.json');
  console.log(`SKU 数: ${(cfg.skuList || []).length}`);

  const missing = [];
  if (!exists(cfg.paths.node)) missing.push('node');
  if (!exists(cfg.paths.chrome)) missing.push('chrome（用 --chrome 指定）');
  if (!exists(cfg.paths.python)) missing.push('python');
  if (!exists(cfg.paths.edsdkDir)) missing.push('edsdkDir');
  if (!excelArg) missing.push('excelFile（未指定 --excel，仍为占位路径）');

  console.log('\n=== 下一步 ===');
  if (missing.length) {
    console.log('⚠️ 以下项未就绪：' + missing.join('、'));
    if (!excelArg) console.log('   补填：node setup.mjs --excel "你的库存表.xlsx"');
  } else {
    console.log('✅ 全部就绪');
  }
  if (path.extname(cfg.paths.excelFile).toLowerCase() === '.xls') {
    console.log('⚠️ 你的表是 OLE 老格式 .xls：edsdk 无法原地保存，先跑一次搬列脚本转成 .xlsx：');
    console.log('   python scripts/restructure_excel.py');
  }
  console.log('   然后登录 ERP：node scripts/erp_login_holder.mjs');
  console.log('   登录后对 WorkBuddy 说「跑库存监控」即可');
}

main();
