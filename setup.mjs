// 一键配置脚本：自动探测本机 node/python/edsdk 路径，生成 config.json
// 用法：
//   node setup.mjs --excel "C:\Users\xxx\Desktop\我的库存.xlsx"
//   node setup.mjs --excel "..." --workdir "C:\Users\xxx\WorkBuddy\1"
// 若省略 --excel，会沿用 config.example.json 的占位（需之后手动补 excelFile）
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname; // setup.mjs 位于仓库根目录
const HOME = os.homedir();

// --- 解析命令行参数 ---
const args = process.argv.slice(2);
function argVal(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}
const excelArg = argVal('--excel');
const workdirArg = argVal('--workdir');

// --- 路径探测 ---
function exists(p) { try { return fs.existsSync(p); } catch (e) { return false; } }
function ls(dir) { try { return fs.readdirSync(dir); } catch (e) { return []; } }

function pickVersionDir(base) {
  // 优先真实版本号目录（排除 "current" 软链）
  const list = ls(base).filter(n => n !== 'current' && n !== '.DS_Store');
  if (list.length) return list.sort().pop(); // 取最新版本
  return null;
}

function findNode() {
  const base = path.join(HOME, '.workbuddy', 'binaries', 'node', 'versions');
  const v = pickVersionDir(base);
  if (!v) return null;
  const p = path.join(base, v, 'node.exe');
  return exists(p) ? p : null;
}

function findAgentBrowser(nodePath) {
  if (!nodePath) return null;
  const dir = path.dirname(nodePath); // .../versions/<v>
  const p = path.join(dir, 'node_modules', 'agent-browser', 'bin', 'agent-browser.js');
  return exists(p) ? p : null;
}

function findPython() {
  const base = path.join(HOME, '.workbuddy', 'binaries', 'python', 'versions');
  const v = pickVersionDir(base);
  if (!v) return null;
  const p = path.join(base, v, 'python.exe');
  return exists(p) ? p : null;
}

function findEdsdkDir() {
  // 探测 WorkBuddy 安装位置（常见盘符 + 常见目录）
  const candidates = [
    'D:/WorkBuddy', 'C:/WorkBuddy',
    'D:/Program Files/WorkBuddy', 'C:/Program Files/WorkBuddy',
    'D:/Program Files (x86)/WorkBuddy', 'C:/Program Files (x86)/WorkBuddy',
  ];
  for (const base of candidates) {
    const p = path.join(base, 'resources', 'app.asar.unpacked', 'resources', 'plugins', 'workbuddy-builtin', 'skills', 'workbuddy-local-office-edit');
    if (exists(p)) return p.replace(/\\/g, '/');
  }
  return null;
}

function toWin(p) { return p ? p.replace(/\\/g, '/') : p; }

// --- 主流程 ---
function main() {
  console.log('大件库存 skill 一键配置\n');

  // 读取 example 作为模板（保留 erp / warehouses / skuList）
  const examplePath = path.join(ROOT, 'config.example.json');
  let cfg;
  if (exists(examplePath)) {
    cfg = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
  } else {
    console.error('缺少 config.example.json，无法生成配置');
    process.exit(1);
  }

  const node = findNode();
  const agentBrowser = findAgentBrowser(node);
  const python = findPython();
  const edsdkDir = findEdsdkDir();
  const chromeProfile = path.join(HOME, '.workbuddy', 'erp-chrome-profile');
  const workDir = workdirArg || path.join(HOME, 'WorkBuddy', '1');
  const excelFile = excelArg || cfg.paths.excelFile; // 未给则保留占位

  cfg.paths.node = toWin(node || cfg.paths.node);
  cfg.paths.agentBrowser = toWin(agentBrowser || cfg.paths.agentBrowser);
  cfg.paths.python = toWin(python || cfg.paths.python);
  cfg.paths.edsdkDir = toWin(edsdkDir || cfg.paths.edsdkDir);
  cfg.paths.chromeProfile = toWin(chromeProfile);
  cfg.paths.workDir = toWin(workDir);
  cfg.paths.excelFile = toWin(excelFile);

  // 打印探测结果
  const check = (name, v) => `${exists(v) ? '✅' : '❌'} ${name}: ${v}`;
  console.log(check('node       ', cfg.paths.node));
  console.log(check('agentBrowser', cfg.paths.agentBrowser));
  console.log(check('python     ', cfg.paths.python));
  console.log(check('edsdkDir   ', cfg.paths.edsdkDir));
  console.log(check('chromeProfile(自动建)', cfg.paths.chromeProfile));
  console.log(`   workDir    : ${cfg.paths.workDir}`);
  console.log(check('excelFile  ', cfg.paths.excelFile));

  // 写 config.json
  fs.writeFileSync(path.join(ROOT, 'config.json'), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  console.log('\n已写入 config.json');

  // 验证 SKU 数
  const skuCount = (cfg.skuList || []).length;
  console.log(`SKU 数: ${skuCount}`);

  // 提示下一步
  const missing = [];
  if (!exists(cfg.paths.node)) missing.push('node');
  if (!exists(cfg.paths.agentBrowser)) missing.push('agent-browser');
  if (!exists(cfg.paths.python)) missing.push('python');
  if (!exists(cfg.paths.edsdkDir)) missing.push('edsdkDir');
  if (!excelArg) missing.push('excelFile（未指定 --excel，仍为占位）');

  console.log('\n=== 下一步 ===');
  if (missing.length) {
    console.log('⚠️ 以下项未就绪，请检查：' + missing.join('、'));
    if (!excelArg) console.log('   补填：node setup.mjs --excel "你的库存表.xlsx"');
  } else {
    console.log('✅ 全部就绪，请登录 ERP：');
  }
  console.log('   node scripts/erp_login_holder.mjs');
  console.log('   登录后对 WorkBuddy 说「跑库存监控」即可');
}

main();
