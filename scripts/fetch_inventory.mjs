// 全自动采集海外仓库存：open → ready → 设置查询 → 提取 → 写 extracted_raw.txt
// 必须以 run_in_background 方式运行（daemon 需要父进程存活）
import { execFile } from 'child_process';
import fs from 'fs';
import { cfg } from './config.mjs';

const NODE = cfg.paths.node;
const AB = cfg.paths.agentBrowser;
const PROFILE = cfg.paths.chromeProfile;
const ROOT = cfg.paths.workDir;

const GLOBAL_FLAGS = ['--profile', PROFILE, '--headed', '--args', '--no-sandbox,--disable-gpu'];
const ERP_URL = cfg.erp.overseasUrl;

function log(msg) { console.log('[' + new Date().toISOString() + '] ' + msg); }

function run(args, timeoutMs = 90000) {
  return new Promise((resolve) => {
    execFile(NODE, [AB, ...GLOBAL_FLAGS, ...args], { timeout: timeoutMs, windowsHide: true, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err, stdout: (stdout || '').toString(), stderr: (stderr || '').toString() });
    });
  });
}

function b64(js) { return Buffer.from(js, 'utf8').toString('base64'); }

// eval 返回的 JS 值会被 agent-browser 再 JSON.stringify 包一层引号，需两次 parse
function parseEvalJson(out) {
  let s = (out || '').trim();
  if (s.startsWith('"')) {
    try { s = JSON.parse(s); } catch (e) { return null; }
  }
  try { return JSON.parse(s); } catch (e) { return null; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// eval 输出可能是 JSON 字符串或含字面 \n\t 转义，统一还原为真实换行
function decodeOut(out) {
  let s = (out || '').trim();
  for (let i = 0; i < 3 && s.startsWith('"'); i++) {
    try { s = JSON.parse(s); } catch (e) { break; }
  }
  if (s.includes('\\n')) s = s.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  return s;
}

async function main() {
  log('step1: close stale daemon');
  await run(['close'], 30000);
  await sleep(2000);

  log('step2: open ERP overseas page');
  const r1 = await run(['open', ERP_URL], 120000);
  log('open result: ' + (r1.stdout || r1.stderr).trim().split('\n').join(' | ').slice(0, 200));
  if (!(r1.stdout || '').includes('✓')) { log('FATAL: open failed'); process.exit(1); }
  if ((r1.stdout || '').includes('Login.aspx')) { log('FATAL: redirected to login - session expired, user must re-login'); process.exit(2); }
  await sleep(3000);

  // step3: 轮询页面就绪（jQuery + #TextSKUs）
  const readyJs = `(function(){ return JSON.stringify({href:location.href.slice(0,90), jq:typeof window.jQuery, hasSku:!!document.querySelector('#TextSKUs'), title:document.title}); })()`;
  let ready = null;
  for (let i = 0; i < 20; i++) {
    const r = await run(['eval', '-b', b64(readyJs)], 60000);
    const obj = parseEvalJson(r.stdout);
    if (obj && obj.jq === 'function' && obj.hasSku) { ready = obj; log('page ready: ' + JSON.stringify(ready)); break; }
    log('waiting page ready (' + (i + 1) + '): ' + (r.stdout || r.stderr || '').trim().slice(0, 120));
    await sleep(4000);
  }
  if (!ready || ready.jq !== 'function' || !ready.hasSku) {
    log('FATAL: page not ready, last=' + JSON.stringify(ready));
    process.exit(3);
  }

  // step4: 设置查询参数并触发搜索（从 config 注入 SKU/起始时间/每页条数）
  let setupJs = fs.readFileSync(ROOT + '/js_setup_query.js', 'utf8');
  setupJs = setupJs
    .replace('__SKUS_PLACEHOLDER__', cfg.skuList.join('\\n'))
    .replace('__START_TIME__', cfg.erp.startTime)
    .replace('__PAGE_SIZE__', String(cfg.erp.pageSize));
  const r4 = await run(['eval', '-b', b64(setupJs)], 90000);
  log('setup result: ' + (r4.stdout || r4.stderr).trim().slice(0, 300));
  if (!(r4.stdout || '').includes('SearchIt(2) CALLED')) { log('FATAL: setup failed'); process.exit(4); }

  // step5: 提取数据（js_extract_all.js 自带 Promise 轮询，最长约 90s + 缓冲）
  await sleep(5000);
  const extractJs = fs.readFileSync(ROOT + '/js_extract_all.js', 'utf8');
  let extractOut = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    log('extract attempt ' + attempt);
    const r5 = await run(['eval', '-b', b64(extractJs)], 200000);
    extractOut = decodeOut(r5.stdout);
    log('extract result head: ' + extractOut.slice(0, 120).replace(/\n/g, ' '));
    if (extractOut.startsWith('"ROWS=') || extractOut.includes('ROWS=')) break;
    if (extractOut.includes('GIVEUP')) { log('page gave up, retrying after re-setup'); await run(['eval', '-b', b64(setupJs)], 90000); await sleep(8000); }
    else await sleep(6000);
  }
  if (!extractOut.includes('ROWS=')) { log('FATAL: extract failed, output=' + extractOut.slice(0, 300)); process.exit(5); }

  // step6: 页面总记录数核对 + 翻页补采
  const totalJs = `(function(){ const m=(document.body.innerText||'').match(/共\\s*(\\d+)\\s*条/); return m ? m[0] : 'TOTAL_NOT_FOUND'; })()`;
  const r6 = await run(['eval', '-b', b64(totalJs)], 60000);
  log('page total: ' + (r6.stdout || '').trim());

  // 若首页行数 < 总数，翻页继续采集
  const totalMatch = (r6.stdout || '').match(/共\s*(\d+)\s*条/);
  const totalCount = totalMatch ? parseInt(totalMatch[1], 10) : 0;
  const firstCount = parseInt((extractOut.match(/ROWS=(\d+)/) || [])[1] || '0', 10);
  if (totalCount > firstCount) {
    const pageExtractJs = fs.readFileSync(ROOT + '/js_extract_page.js', 'utf8');
    let collected = firstCount;
    for (let page = 2; page <= 10 && collected < totalCount; page++) {
      // 点击下一页
      const nextJs = `(function(){
        const sels = ["a:contains('下一页')", "a:contains('下页')", ".pager a:last-child", "a[title='下一页']"];
        for (const s of sels) {
          try {
            const el = window.jQuery(s).first();
            if (el.length && !el.hasClass('disabled') && el.css('display') !== 'none') {
              const prev = document.body.innerText.match(/共\\s*(\\d+)\\s*条/);
              el[0].click();
              return JSON.stringify({clicked: s});
            }
          } catch(e) {}
        }
        const links = Array.from(document.querySelectorAll('a, input[type=button], input[type=submit]'));
        const nx = links.find(a => (a.innerText || a.value || '').trim() === '下一页' || (a.innerText || a.value || '').trim() === '>');
        if (nx) { nx.click(); return JSON.stringify({clicked: 'fallback'}); }
        return JSON.stringify({clicked: null});
      })()`;
      const rNext = await run(['eval', '-b', b64(nextJs)], 60000);
      const nextRes = parseEvalJson(rNext.stdout);
      log('page ' + page + ' next-click: ' + JSON.stringify(nextRes));
      if (!nextRes || !nextRes.clicked) { log('no next page control, stop'); break; }
      await sleep(6000);
      let pageOut = '';
      for (let attempt = 1; attempt <= 3; attempt++) {
        const r5b = await run(['eval', '-b', b64(pageExtractJs)], 200000);
        pageOut = decodeOut(r5b.stdout);
        if (pageOut.includes('ROWS=')) break;
        await sleep(5000);
      }
      if (!pageOut.includes('ROWS=')) { log('FATAL: page ' + page + ' extract failed'); process.exit(6); }
      // 去掉第一行 ROWS=xxx，追加数据行
      const pageLines = pageOut.split('\n').slice(1);
      const cnt = parseInt((pageOut.match(/ROWS=(\d+)/) || [])[1] || '0', 10);
      extractOut += '\n' + pageLines.join('\n');
      collected += cnt;
      log('page ' + page + ': +' + cnt + ' rows, collected=' + collected);
    }
    // 更新首行 ROWS 计数为总行数
    extractOut = extractOut.replace(/^"?\s*ROWS=(\d+)/, 'ROWS=' + collected);
  }

  // step7: 写出原始提取结果
  fs.writeFileSync(ROOT + '/extracted_raw.txt', extractOut, 'utf8');
  log('WROTE extracted_raw.txt (' + extractOut.length + ' bytes)');
  log('ALL_DONE');
}

main().catch(e => { log('CRASH: ' + (e.stack || String(e)).slice(0, 500)); process.exit(99); });
