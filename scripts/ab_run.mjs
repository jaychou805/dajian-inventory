// 单次执行 agent-browser 命令并可靠捕获 stdout/stderr
import { execFile } from 'child_process';

const NODE = 'C:/Users/xiaozhihe/.workbuddy/binaries/node/versions/22.22.2-3/node.exe';
const AB = 'C:/Users/xiaozhihe/.workbuddy/binaries/node/versions/22.22.2-3/node_modules/agent-browser/bin/agent-browser.js';
const PROFILE = 'C:/Users/xiaozhihe/.workbuddy/erp-chrome-profile';

const GLOBAL_FLAGS = ['--profile', PROFILE, '--headed', '--args', '--no-sandbox,--disable-gpu'];

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: node ab_run.mjs <agent-browser args...>');
  process.exit(2);
}

const timeoutMs = parseInt(process.env.AB_TIMEOUT || '90000', 10);

execFile(NODE, [AB, ...GLOBAL_FLAGS, ...args], { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
  process.stdout.write((stdout || '').toString());
  if (stderr && stderr.toString().trim()) process.stderr.write(stderr.toString());
  if (err) {
    process.stderr.write('\n[ERR] ' + (err.message || String(err)) + '\n');
    process.exit(err.code || 1);
  }
  process.exit(0);
});
