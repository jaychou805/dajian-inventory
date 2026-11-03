(function(){
  return new Promise(function(resolve){
    let tries = 0;
    function retry() {
      tries++;
      if (tries > 45) { resolve('GIVEUP tries=' + tries + ' url=' + location.href.slice(0, 80) + ' jq=' + typeof window.jQuery); return; }
      setTimeout(attempt, 2000);
    }
    function attempt() {
      try {
        if (!window.jQuery) { retry(); return; }
        const tables = Array.from(document.querySelectorAll('table'));
        let main = null;
        for (let i = 0; i < tables.length; i++) {
          if (tables[i].id === 'headtable') continue;
          const fr = tables[i].querySelector('tr');
          if (fr && fr.querySelectorAll('td,th').length === 19 && tables[i].rows.length > 50) { main = tables[i]; break; }
        }
        if (!main) { retry(); return; }
        const dataRows = Array.from(main.rows).filter(function(r) { return r.querySelectorAll('td').length === 19; });
        if (dataRows.length < 150) { retry(); return; }
        const lines = [];
        for (let i = 0; i < dataRows.length; i++) {
          const tds = dataRows[i].cells;
          const prodText = (tds[2].innerText || '').replace(/\s+/g, ' ');
          let sku = '';
          const mSku = prodText.match(/渠道SKU[:：]\s*(\d+)/);
          if (mSku) sku = mSku[1];
          else { const m2 = prodText.match(/产品状态[:：]\S*\s*(\d+)/); if (m2) sku = m2[1]; }
          let name = '';
          const mName = prodText.match(/名称[:：]\s*(.+?)(?:\s*物流属性|$)/);
          if (mName) name = mName[1].trim().slice(0, 60);
          const wh = (tds[3].innerText || '').trim();
          const stockText = (tds[7].innerText || '').trim();
          const mStock = stockText.match(/-?\d+/);
          const stock = mStock ? mStock[0] : '';
          lines.push(sku + '\t' + name + '\t' + wh + '\t' + stock);
        }
        resolve('ROWS=' + dataRows.length + '\n' + lines.join('\n'));
      } catch (e) { retry(); }
    }
    attempt();
  });
})()
