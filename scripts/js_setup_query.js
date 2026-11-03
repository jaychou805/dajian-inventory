(function(){
  if (!window.jQuery || !document.querySelector('#TextSKUs')) {
    return 'PAGE NOT READY: ' + location.href.slice(0, 70) + ' | jq=' + typeof window.jQuery;
  }
  const $ = window.jQuery;
  const out = [];
  const SKUS = '__SKUS_PLACEHOLDER__';
  const curB = $('#TextInputTimeB').datebox('getValue');
  const timePart = curB.indexOf(' ') >= 0 ? curB.substring(curB.indexOf(' ')) : '';
  $('#TextInputTimeB').datebox('setValue', '__START_TIME__' + timePart);
  out.push('newB=[' + $('#TextInputTimeB').datebox('getValue') + ']');
  $('#ddlPageSizes').combobox('setValue', '__PAGE_SIZE__');
  out.push('pageSize=[' + $('#ddlPageSizes').combobox('getValue') + ']');
  $('#TextSKUs').val(SKUS);
  out.push('skuCount=' + $('#TextSKUs').val().split('\n').length);
  out.push('muti=[' + $('#DDL_SerachMuti').val() + ']');
  SearchIt(2);
  out.push('SearchIt(2) CALLED');
  return out.join(' || ');
})()
