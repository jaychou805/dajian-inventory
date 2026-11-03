// 单次执行 agent-browser 命令并可靠捕获 stdout/stderr
import { execFile } from 'child_process';
import { cfg } from './config.mjs';

const NODE = cfg.paths.node;
const AB = cfg.paths.agentBrowser;
const PROFILE = cfg.paths.chromeProfile;

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
