(function(){
  if (!window.jQuery || !document.querySelector('#TextSKUs')) {
    return 'PAGE NOT READY: ' + location.href.slice(0, 70) + ' | jq=' + typeof window.jQuery;
  }
  const $ = window.jQuery;
  const out = [];
  const SKUS = '22609577\n23147389\n22543798\n21828126\n21596642\n22746153\n23099218\n21617402\n22221924\n21950073\n21760616\n21605550\n22939355\n22607814\n22886567\n23068415\n22229383\n21849568\n23042729\n21828274\n22504701\n22931694\n22354746\n21844802\n22481612\n22766367\n22342499\n22634028\n21594621\n21538348\n23017172\n22802956\n21528974\n22881955\n23291458\n22625731\n23068364\n23099106\n21552221\n22937113\n22337338\n23130056\n22634112\n23305628\n23099975\n23100315\n23100342\n22609734\n22931529\n21657851\n22443675\n22250205\n21981272\n21849416\n21536612\n21935816\n23067817\n21537372\n21552723\n23017301\n22607116\n22503619\n22746620\n22801168\n22503694\n21678873\n22520305\n23068324\n23306230\n22931770\n22491953\n22425147\n22225773\n23418819\n23418978\n23305008\n22571216\n21740083\n22608036\n22749294\n22773245\n22639294\n22875802\n23044695\n23399446\n23419085\n22029226\n22333041\n22441555';
  const curB = $('#TextInputTimeB').datebox('getValue');
  const timePart = curB.indexOf(' ') >= 0 ? curB.substring(curB.indexOf(' ')) : '';
  $('#TextInputTimeB').datebox('setValue', '2022-07-01' + timePart);
  out.push('newB=[' + $('#TextInputTimeB').datebox('getValue') + ']');
  $('#ddlPageSizes').combobox('setValue', '200');
  out.push('pageSize=[' + $('#ddlPageSizes').combobox('getValue') + ']');
  $('#TextSKUs').val(SKUS);
  out.push('skuCount=' + $('#TextSKUs').val().split('\n').length);
  out.push('muti=[' + $('#DDL_SerachMuti').val() + ']');
  SearchIt(2);
  out.push('SearchIt(2) CALLED');
  return out.join(' || ');
})()
