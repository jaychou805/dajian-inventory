# -*- coding: utf-8 -*-
"""一次性搬列脚本：把「成本」列挪到末尾，腾出库存列位置。

背景：原版 skill 假设「库存写到 C 列」，但实际表里 C 列往往是成本/售价，直接写会覆盖。
本脚本把配置的库存列（config.excel.inventoryCol，默认 C）先插入一整列空列，
再把成本列移动到末尾，最终得到「表头: sku, 商品名称, 库存(A+B), ... , 成本」的结构。

两个关键坑（原版踩过）：
  1. sheet_move_dimension 的 to 是「删除后插入」语义（Apps Script moveColumns 风格），
     不是「腾出空位」；所以必须先 sheet_insert_dimension 插空列，再 move，顺序不能反。
  2. 不能原地改动用户表：这里一律另存为新文件，并且用「表头多重集比对」验证
     没有列被挤丢（原版就出现过「售价」列被吃掉），验证不过就报错退出。

用法：
  python scripts/restructure_excel.py            # 默认输出 <原名>-库存列已调整.xlsx
  python scripts/restructure_excel.py --force    # 目标文件已存在时覆盖

输出确认无误后，把 config.json 的 paths.excelFile 指向新文件（或保持指向同名 .xlsx）。
"""
import json
import os
import sys
from collections import Counter

_here = os.path.dirname(os.path.abspath(__file__))
CFG_PATH = os.path.join(_here, '..', 'config.json')
with open(CFG_PATH, 'r', encoding='utf-8') as _f:
    CFG = json.load(_f)

P = CFG.get('paths', {})
EDS_DIR = P.get('edsdkDir', '')
PYTHON = P.get('python') or sys.executable

EX = {
    'sheetId': '000001',
    'skuCol': 'A',
    'inventoryCol': 'C',
    'headerRow': 0,
    'costCol': '',
    'costHeaderNames': ['成本', '成本价', '采购成本'],
    'restructureOutputFile': '',
}
EX.update(CFG.get('excel') or {})


def col_index(letter):
    letter = str(letter or 'A').strip().upper()
    n = 0
    for ch in letter:
        if not ('A' <= ch <= 'Z'):
            raise ValueError('非法的列名：%r' % letter)
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def col_letter(idx):
    s = ''
    idx += 1
    while idx:
        idx, rem = divmod(idx - 1, 26)
        s = chr(65 + rem) + s
    return s


def iter_dicts(obj):
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            for d in iter_dicts(v):
                yield d
    elif isinstance(obj, list):
        for v in obj:
            for d in iter_dicts(v):
                yield d


def parse_json(text):
    s = (text or '').strip()
    try:
        return json.loads(s)
    except Exception:
        pass
    start, end = s.find('{'), s.rfind('}')
    if start >= 0 and end > start:
        try:
            return json.loads(s[start:end + 1])
        except Exception:
            return None
    return None


def edsdk(tool, args):
    blob = json.dumps(args, ensure_ascii=False)
    cmd = [PYTHON, os.path.join(EDS_DIR, 'edsdk.py'), 'call', '--json', blob, tool]
    r = subprocess_call(cmd)
    if r[0] != 0:
        raise RuntimeError('edsdk 调用失败: %s\nstdout=%s\nstderr=%s'
                           % (tool, (r[1] or '')[-800:], (r[2] or '')[-800:]))
    return (r[1] or '').strip()


def subprocess_call(cmd):
    import subprocess
    p = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return p.returncode, p.stdout, p.stderr


def find_int(obj, keys, default):
    for d in iter_dicts(obj):
        for k in keys:
            if k in d:
                try:
                    return int(d[k])
                except (TypeError, ValueError):
                    pass
    return default


def open_book(path_):
    out = edsdk('open_file', {'file_path': path_, 'wait': True})
    obj = parse_json(out) or {}
    for d in iter_dicts(obj):
        v = d.get('file_id') or d.get('fileId')
        if isinstance(v, str) and v.strip():
            return v.strip()
    return path_


def close_book(fid):
    try:
        edsdk('close_file', {'file_id': fid, 'force': True})
    except Exception:
        pass


def resolve_sheet(fid):
    want = str(EX.get('sheetId') or '').strip()
    try:
        info = parse_json(edsdk('sheet_get_sheet_info', {'file_id': fid})) or {}
    except RuntimeError:
        return want or '000001'
    sheets = []
    for d in iter_dicts(info):
        sid = d.get('sheet_id') or d.get('sheetId')
        if isinstance(sid, str) and sid.strip() and (sid.strip(), ) not in [(s[0],) for s in sheets]:
            sheets.append((sid.strip(), str(d.get('name') or d.get('sheet_name') or d.get('title') or '')))
    if want:
        for sid, _ in sheets:
            if sid == want:
                return sid
        for sid, name in sheets:
            if name == want:
                return sid
    if sheets:
        return sheets[0][0]
    return want or '000001'


def used_range(fid, sid):
    obj = parse_json(edsdk('sheet_get_used_range', {'file_id': fid, 'sheet_id': sid})) or {}
    return find_int(obj, ['end_row', 'endRow'], 50), find_int(obj, ['end_col', 'endCol'], 20)


def cell_text(cell):
    vt = cell.get('value_type')
    if vt == 'NUMBER' or 'number_value' in cell:
        try:
            return str(int(float(cell.get('number_value'))))
        except (TypeError, ValueError):
            return ''
    return str(cell.get('string_value') or cell.get('value') or '').strip()


def read_header(fid, sid, header_row, end_col):
    out = edsdk('sheet_get_cell_data', {
        'file_id': fid, 'sheet_id': sid,
        'start_row': header_row, 'end_row': header_row,
        'start_col': 0, 'end_col': end_col,
        'return_csv': False,
    })
    obj = parse_json(out) or {}
    cells = obj.get('cells')
    if cells is None:
        for d in iter_dicts(obj):
            if isinstance(d.get('cells'), list):
                cells = d['cells']
                break
    headers = [''] * (end_col + 1)
    for cell in (cells or []):
        try:
            c = int(cell.get('col'))
        except (TypeError, ValueError):
            continue
        if 0 <= c <= end_col:
            headers[c] = cell_text(cell)
    return headers


def find_cost_index(headers):
    """按 config 指定的列字母，或按表头名找成本列"""
    explicit = str(EX.get('costCol') or '').strip()
    if explicit:
        idx = col_index(explicit)
        return idx, (headers[idx] if idx < len(headers) else '')
    names = [n for n in (EX.get('costHeaderNames') or []) if n]
    for i, h in enumerate(headers):
        if h.strip() in names:
            return i, h
    # 兜底：包含「成本」字样
    for i, h in enumerate(headers):
        if '成本' in h:
            return i, h
    return None, None


def build_once(src, dst, inv_idx, header_row):
    """执行一次「插空列 + 移动成本列」，返回 (成功?, 说明)"""
    fid = open_book(src)
    try:
        sid = resolve_sheet(fid)
        end_row, end_col = used_range(fid, sid)
        headers0 = read_header(fid, sid, header_row, end_col)
        cost_idx, cost_name = find_cost_index(headers0)
        if cost_idx is None:
            return False, '未找到成本列（可用 excel.costCol 指定列字母，或改 excel.costHeaderNames）'
        if cost_idx == inv_idx:
            print('成本列本来就在库存列位置（%s），需要插空列后把它挪到末尾' % col_letter(cost_idx))

        print('原始表头：', ' | '.join('%s:%s' % (col_letter(i), h or '(空)') for i, h in enumerate(headers0)))
        print('库存列 = %s(%d)，成本列 = %s(%d)[%s]'
              % (col_letter(inv_idx), inv_idx, col_letter(cost_idx), cost_idx, cost_name))

        # 1) 先插入一整列空列，把库存列腾出来（其余列整体右移）
        edsdk('sheet_insert_dimension', {
            'file_id': fid, 'sheet_id': sid,
            'dimension_type': 'col', 'index': inv_idx, 'count': 1, 'direction': 'before',
        })
        # 2) 结构变了，旧坐标失效，重新读取
        end_row, end_col = used_range(fid, sid)
        headers1 = read_header(fid, sid, header_row, end_col)
        cost_idx2, cost_name2 = find_cost_index(headers1)
        if cost_idx2 is None:
            return False, '插入空列后找不到成本列（表头被覆盖？）'
        print('插空后表头：', ' | '.join('%s:%s' % (col_letter(i), h or '(空)') for i, h in enumerate(headers1)))

        # 3) 把成本列移动到末尾
        #    to 的语义（实测）：传「插空后的列数」= end_col + 1 才会落到已用区最后一列；
        #    且 to 不能落在 [index, index+count] 区间内（否则报 invalid parameters）。
        if cost_idx2 == end_col:
            print('成本列已在末尾，无需移动')
        else:
            to = end_col + 1
            if cost_idx2 <= to <= cost_idx2 + 1:
                print('成本列已在末尾（to=%d 落在无效区间），跳过移动' % to)
            else:
                edsdk('sheet_move_dimension', {
                    'file_id': fid, 'sheet_id': sid,
                    'dimension_type': 'col', 'index': cost_idx2, 'count': 1, 'to': to,
                })
                print('已移动成本列：index=%d → to=%d' % (cost_idx2, to))
        end_row2, end_col2 = used_range(fid, sid)
        headers2 = read_header(fid, sid, header_row, end_col2)
        print('移动后表头：', ' | '.join('%s:%s' % (col_letter(i), h or '(空)') for i, h in enumerate(headers2)))

        # 4) 验证：库存列位置为空；成本列在末尾且只剩一列；其余表头一个不少
        problems = []
        if headers2[inv_idx].strip():
            problems.append('库存列 %s 位置仍为「%s」，没腾空' % (col_letter(inv_idx), headers2[inv_idx]))
        if not headers2 or headers2[-1].strip() != (cost_name2 or '').strip():
            problems.append('成本列不在末尾（末列是「%s」）' % (headers2[-1] if headers2 else ''))
        cnt0 = Counter([h for h in headers0 if h.strip()])
        cnt2 = Counter([h for h in headers2 if h.strip()])
        if cnt0 != cnt2:
            lost = cnt0 - cnt2
            extra = cnt2 - cnt0
            problems.append('表头集合变化，疑似列丢失 %s / 多出 %s' % (dict(lost), dict(extra)))

        if problems:
            return False, '；'.join(problems)

        out = edsdk('save_file', {
            'file_id': fid, 'file_path': dst, 'allow_format_change': True,
        })
        print('已另存：%s（%s）' % (dst, out[:120]))
        return True, '成功'
    finally:
        close_book(fid)


def main():
    force = '--force' in sys.argv
    src = (P.get('excelFile') or '').strip()
    if not src or not os.path.exists(src):
        sys.exit('找不到源文件，检查 config.json 的 paths.excelFile：%r' % src)

    base, ext = os.path.splitext(src)
    dst = (EX.get('restructureOutputFile') or '').strip() or (base + '-库存列已调整.xlsx')
    if os.path.exists(dst) and not force:
        sys.exit('目标文件已存在：%s\n确认要覆盖请加 --force' % dst)

    inv_idx = col_index(EX.get('inventoryCol') or 'C')
    header_row = int(EX.get('headerRow') or 0)

    print('源文件：%s' % src)
    print('目标文件：%s' % dst)
    ok, msg = build_once(src, dst, inv_idx, header_row)

    print('\n=== 结果 ===')
    if ok:
        print('✅ 搬列完成并通过校验')
        print('下一步：')
        print('  1) 把 config.json 的 paths.excelFile 改成：%s' % dst.replace('\\', '/'))
        print('  2) 重跑 python scripts/sync_excel.py')
    else:
        print('❌ 未生成新文件：%s' % msg)
        print('原文件未被修改（本脚本只写新文件）。')
        sys.exit(1)


if __name__ == '__main__':
    main()
