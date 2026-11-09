// 全自动采集海外仓库存：open → ready → 设置查询 → 提取 → 写 extracted_raw.txt
// 浏览器层已改为「系统 Chrome + CDP 直连」（见 cdp.mjs），不再依赖 agent-browser。
// 仍建议以 run_in_background 方式运行（采集链路较长，前台容易超时中断）。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { cfg, WORKDIR, ensureDirs } from './config.mjs';
import { run, closeBrowser } from './cdp.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ERP_URL = cfg.erp.overseasUrl;

function log(msg) { console.log('[' + new Date().toISOString() + '] ' + msg); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function b64(js) { return Buffer.from(js, 'utf8').toString('base64'); }

// 页面内脚本一律从「脚本自身所在目录」读取（原版从 workDir 读，workDir 里没有副本会直接崩）
function readInject(name) {
  const p = path.join(SCRIPT_DIR, name);
  if (!fs.existsSync(p)) throw new Error('缺少注入脚本：' + p);
  return fs.readFileSync(p, 'utf8');
}

// eval 返回值经 JSON.stringify 包装，可能有 1~2 层引号，统一还原
function parseEvalJson(out) {
  let s = String(out || '').trim();
  for (let i = 0; i < 3 && s.startsWith('"'); i++) {
    try { s = JSON.parse(s); } catch (e) { return null; }
  }
  try { return JSON.parse(s); } catch (e) { return null; }
}

// 输出里可能含字面 \n\t 转义，统一还原为真实换行
function decodeOut(out) {
  let s = String(out || '').trim();
  for (let i = 0; i < 3 && s.startsWith('"'); i++) {
    try { s = JSON.parse(s); } catch (e) { break; }
  }
  if (s.includes('\\n')) s = s.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  return s;
}

// 退出前统一关掉浏览器，避免留下孤儿 Chrome 进程
async function fatal(code, msg) {
  log(msg);
  await closeBrowser();
  process.exit(code);
}

async function main() {
  ensureDirs();

  log('step1: 关闭可能残留的浏览器会话');
  await run(['close'], 20000);
  await sleep(1000);

  log('step2: 打开 ERP 备货页');
  const r1 = await run(['open', ERP_URL], 120000);
  const out1 = (r1.stdout || r1.stderr || '').trim();
  log('open 结果: ' + out1.split('\n').join(' | ').slice(0, 200));
  if (!out1.includes('✓')) {
    await fatal(1, 'FATAL: 打开页面失败 —— ' + (r1.stderr || 'unknown'));
  }
  // 主后台 Login.aspx / 备货页 NLogin.aspx 都算会话过期
  if (/N?Login\.aspx/i.test(out1)) {
    await fatal(2, 'FATAL: 已跳转到登录页，会话过期，需先跑 erp_login_holder.mjs 恢复');
  }
  await sleep(3000);

  // step3: 轮询页面就绪（jQuery + #TextSKUs）
  const readyJs = `(function(){ return JSON.stringify({href:location.href.slice(0,90), jq:typeof window.jQuery, hasSku:!!document.querySelector('#TextSKUs'), title:document.title}); })()`;
  let ready = null;
  for (let i = 0; i < 20; i++) {
    const r = await run(['eval', '-b', b64(readyJs)], 60000);
    const obj = parseEvalJson(r.stdout);
    if (obj && obj.jq === 'function' && obj.hasSku) { ready = obj; log('页面就绪: ' + JSON.stringify(ready)); break; }
    log('等待页面就绪 (' + (i + 1) + '): ' + (r.stdout || r.stderr || '').trim().slice(0, 120));
    await sleep(4000);
  }
  if (!ready) {
    await fatal(3, 'FATAL: 页面未就绪（jQuery 或 #TextSKUs 未出现），最后状态=' + JSON.stringify(ready));
  }

  // step4: 设置查询参数并触发搜索（SKU/起始时间/每页条数从 config 注入）
  let setupJs = readInject('js_setup_query.js')
    .replace('__SKUS_PLACEHOLDER__', cfg.skuList.join('\\n'))
    .replace('__START_TIME__', cfg.erp.startTime)
    .replace('__PAGE_SIZE__', String(cfg.erp.pageSize));
  const r4 = await run(['eval', '-b', b64(setupJs)], 90000);
  log('设置查询结果: ' + (r4.stdout || r4.stderr).trim().slice(0, 300));
  if (!(r4.stdout || '').includes('SearchIt(2) CALLED')) {
    await fatal(4, 'FATAL: 设置查询参数失败 —— ' + (r4.stderr || ''));
  }

  // step5: 提取数据（js_extract_all.js 自带 Promise 轮询，最长约 90s，留足缓冲）
  await sleep(5000);
  const extractJs = readInject('js_extract_all.js');
  let extractOut = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    log('提取第 ' + attempt + ' 次');
    const r5 = await run(['eval', '-b', b64(extractJs)], 200000);
    extractOut = decodeOut(r5.stdout);
    log('提取结果头部: ' + extractOut.slice(0, 120).replace(/\n/g, ' '));
    if (extractOut.includes('ROWS=')) break;
    if (extractOut.includes('GIVEUP')) {
      log('页面超时放弃，重新设置查询后再试');
      await run(['eval', '-b', b64(setupJs)], 90000);
      await sleep(8000);
    } else {
      await sleep(6000);
    }
  }
  if (!extractOut.includes('ROWS=')) {
    await fatal(5, 'FATAL: 提取失败，输出=' + extractOut.slice(0, 300));
  }

  // step6: 核对页面总记录数 + 翻页补采
  const totalJs = `(function(){ const m=(document.body.innerText||'').match(/共\\s*(\\d+)\\s*条/); return m ? m[0] : 'TOTAL_NOT_FOUND'; })()`;
  const r6 = await run(['eval', '-b', b64(totalJs)], 60000);
  log('页面总记录数: ' + (r6.stdout || '').trim());

  const totalMatch = (r6.stdout || '').match(/共\s*(\d+)\s*条/);
  const totalCount = totalMatch ? parseInt(totalMatch[1], 10) : 0;
  const firstCount = parseInt((extractOut.match(/ROWS=(\d+)/) || [])[1] || '0', 10);

  if (totalCount > firstCount) {
    const pageExtractJs = readInject('js_extract_page.js');
    let collected = firstCount;
    for (let page = 2; page <= 10 && collected < totalCount; page++) {
      const nextJs = `(function(){
        const sels = ["a:contains('下一页')", "a:contains('下页')", ".pager a:last-child", "a[title='下一页']"];
        for (const s of sels) {
          try {
            const el = window.jQuery(s).first();
            if (el.length && !el.hasClass('disabled') && el.css('display') !== 'none') {
              el[0].click();
              return JSON.stringify({clicked: s});
            }
          } catch(e) {}
        }
        const links = Array.from(document.querySelectorAll('a, input[type=button], input[type=submit]'));
        const nx = links.find(a => ((a.innerText || a.value || '').trim() === '下一页') || ((a.innerText || a.value || '').trim() === '>'));
        if (nx) { nx.click(); return JSON.stringify({clicked: 'fallback'}); }
        return JSON.stringify({clicked: null});
      })()`;
      const rNext = await run(['eval', '-b', b64(nextJs)], 60000);
      const nextRes = parseEvalJson(rNext.stdout);
      log('第 ' + page + ' 页翻页: ' + JSON.stringify(nextRes));
      if (!nextRes || !nextRes.clicked) { log('找不到下一页控件，停止翻页'); break; }
      await sleep(6000);

      let pageOut = '';
      for (let attempt = 1; attempt <= 3; attempt++) {
        const r5b = await run(['eval', '-b', b64(pageExtractJs)], 200000);
        pageOut = decodeOut(r5b.stdout);
        if (pageOut.includes('ROWS=')) break;
        await sleep(5000);
      }
      if (!pageOut.includes('ROWS=')) {
        await fatal(6, 'FATAL: 第 ' + page + ' 页提取失败');
      }
      const pageLines = pageOut.split('\n').slice(1);
      const cnt = parseInt((pageOut.match(/ROWS=(\d+)/) || [])[1] || '0', 10);
      extractOut += '\n' + pageLines.join('\n');
      collected += cnt;
      log('第 ' + page + ' 页: +' + cnt + ' 行，累计=' + collected);
    }
    extractOut = extractOut.replace(/^"?\s*ROWS=(\d+)/, 'ROWS=' + collected);
  }

  // step7: 写出原始提取结果
  const outFile = path.join(WORKDIR, 'extracted_raw.txt');
  fs.writeFileSync(outFile, extractOut, 'utf8');
  log('已写出 ' + outFile + '（' + extractOut.length + ' 字节）');
  log('ALL_DONE');
  await closeBrowser();
}

main().catch(async (e) => {
  log('CRASH: ' + ((e && e.stack) || String(e)).slice(0, 500));
  try { await closeBrowser(); } catch (e2) { /* ignore */ }
  process.exit(99);
});
