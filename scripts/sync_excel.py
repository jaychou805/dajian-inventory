# -*- coding: utf-8 -*-
"""库存 Excel 同步脚本（链路第 4 步）

输入：<workDir>/inventory-snapshots/excel-updates.json（由 process_inventory.mjs 生成）
功能：
  1. 列位置全部可配置（config.json 的 excel 段），不再把「库存列 = C」写死在代码里；
  2. 用 sheet_get_used_range 自动探测真实行数，不再硬编码 row 0~104；
  3. A 列解析 SKU → 写库存列（A+B 值）→ A 或 B ≤ 3 标红；
  4. 源文件是 OLE 老格式 .xls 时自动另存为 .xlsx（edsdk 只能写 OOXML，无法原地保存 .xls）；
  5. 可选「自动补全缺失 SKU 行」（config.excel.autoAppendMissing，默认关）。

输出：config.excel.outputFile；未配置时，.xlsx 源文件原地覆盖，.xls 源文件写到同目录同名 .xlsx。
"""
import datetime
import json
import os
import re
import subprocess
import sys

_here = os.path.dirname(os.path.abspath(__file__))
CFG_PATH = os.path.join(_here, '..', 'config.json')
with open(CFG_PATH, 'r', encoding='utf-8') as _f:
    CFG = json.load(_f)

P = CFG.get('paths', {})
EDS_DIR = P.get('edsdkDir', '')
PYTHON = P.get('python') or sys.executable
WORKDIR = P.get('workDir', '.')
UPDATES_JSON = os.path.join(WORKDIR, 'inventory-snapshots', 'excel-updates.json')

# Excel 配置默认值（旧 config 没有 excel 段也能跑）
EX = {
    'sheetId': '000001',
    'skuCol': 'A',
    'nameCol': 'B',
    'inventoryCol': 'C',
    'headerRow': 0,
    'autoAppendMissing': False,
    'appendOnlyWithData': True,
    'preferXlsx': True,
    'outputFile': '',
}
EX.update(CFG.get('excel') or {})

RED = 'FFFF0000'
BLACK = 'FF000000'


# ---------- 基础工具 ----------

def col_index(letter):
    """列字母 → 0-based 索引（A→0，C→2，AA→26）"""
    letter = str(letter or 'A').strip().upper()
    n = 0
    for ch in letter:
        if not ('A' <= ch <= 'Z'):
            raise ValueError('非法的列名：%r' % letter)
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def iter_dicts(obj):
    """深度遍历取出所有 dict，用于兼容 edsdk 各种返回结构"""
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
    """调用 edsdk.py call --json <args> <tool>"""
    blob = json.dumps(args, ensure_ascii=False)
    cmd = [PYTHON, os.path.join(EDS_DIR, 'edsdk.py'), 'call', '--json', blob, tool]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode != 0:
        raise RuntimeError('edsdk 调用失败: %s\nstdout=%s\nstderr=%s'
                           % (tool, (r.stdout or '')[-800:], (r.stderr or '')[-800:]))
    return (r.stdout or '').strip()


def find_int(obj, keys, default):
    for d in iter_dicts(obj):
        for k in keys:
            if k in d:
                try:
                    return int(d[k])
                except (TypeError, ValueError):
                    pass
    return default


# ---------- 文件 / 工作表定位 ----------

def resolve_files():
    """返回 (源文件, 目标文件)。源为 .xls 且同目录已有搬列后的 .xlsx 时，优先用 .xlsx。"""
    raw = (P.get('excelFile') or '').strip()
    if not raw:
        sys.exit('config.json 缺少 paths.excelFile')
    if not os.path.exists(raw):
        sys.exit('找不到 Excel 文件：%s（检查 config.json 的 paths.excelFile）' % raw)

    base, ext = os.path.splitext(raw)
    ext = ext.lower()
    out_cfg = (EX.get('outputFile') or '').strip()

    if ext == '.xlsx':
        return raw, (out_cfg or raw)

    sibling = base + '.xlsx'
    # .xls：若已有搬列后的 .xlsx，优先用它（否则会把搬列成果覆盖掉）
    if EX.get('preferXlsx', True) and os.path.exists(sibling):
        return sibling, (out_cfg or sibling)
    return raw, (out_cfg or sibling)


def open_book(path_):
    """打开工作簿，返回 file_id（取不到就退回用路径当 id，兼容旧行为）"""
    out = edsdk('open_file', {'file_path': path_, 'wait': True})
    obj = parse_json(out) or {}
    for d in iter_dicts(obj):
        v = d.get('file_id') or d.get('fileId')
        if isinstance(v, str) and v.strip():
            return v.strip()
    return path_


def resolve_sheet(fid):
    """取子表 id：优先 config.excel.sheetId，其次按名称，最后取第一个"""
    want = str(EX.get('sheetId') or '').strip()
    try:
        info = parse_json(edsdk('sheet_get_sheet_info', {'file_id': fid})) or {}
    except RuntimeError:
        return want or '000001'

    sheets = []
    for d in iter_dicts(info):
        sid = d.get('sheet_id') or d.get('sheetId')
        if not (isinstance(sid, str) and sid.strip()):
            continue
        name = str(d.get('name') or d.get('sheet_name') or d.get('title') or '')
        pair = (sid.strip(), name)
        if pair not in sheets:
            sheets.append(pair)

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
    """返回 (end_row, end_col)，0-based 闭区间；探测失败时给保守默认值"""
    try:
        obj = parse_json(edsdk('sheet_get_used_range', {'file_id': fid, 'sheet_id': sid})) or {}
    except RuntimeError:
        return 200, 26
    end_row = find_int(obj, ['end_row', 'endRow'], -1)
    end_col = find_int(obj, ['end_col', 'endCol'], -1)
    if end_row < 0:
        end_row = 200
    if end_col < 0:
        end_col = 26
    return end_row, end_col


def cell_text(cell):
    """单元格对象 → 字符串"""
    vt = cell.get('value_type')
    if vt == 'NUMBER' or 'number_value' in cell:
        v = cell.get('number_value')
        try:
            return str(int(float(v)))
        except (TypeError, ValueError):
            return ''
    if vt == 'BOOLEAN':
        return str(cell.get('boolean_value', ''))
    return str(cell.get('string_value') or cell.get('value') or '').strip()


def sku_of(text):
    """从单元格文本里抠出 SKU（优先 8 位）"""
    nums = re.findall(r'\d{6,}', text or '')
    if not nums:
        return None
    eight = [n for n in nums if len(n) == 8]
    return eight[-1] if eight else nums[-1]


def read_sku_column(fid, sid, col, start_row, end_row):
    """分块读取 SKU 列，返回 {row: sku}"""
    row_to_sku = {}
    chunk = 200
    r = start_row
    while r <= end_row:
        r2 = min(r + chunk - 1, end_row)
        try:
            out = edsdk('sheet_get_cell_data', {
                'file_id': fid, 'sheet_id': sid,
                'start_row': r, 'end_row': r2,
                'start_col': col, 'end_col': col,
                'return_csv': False,
            })
        except RuntimeError as e:
            print('读取行 %d~%d 失败，停止读取：%s' % (r, r2, str(e)[:120]))
            break
        obj = parse_json(out) or {}
        cells = obj.get('cells')
        if cells is None:
            for d in iter_dicts(obj):
                if isinstance(d.get('cells'), list):
                    cells = d['cells']
                    break
        for cell in (cells or []):
            try:
                row = int(cell.get('row'))
                col_i = int(cell.get('col', col))
            except (TypeError, ValueError):
                continue
            if col_i != col:
                continue
            sku = sku_of(cell_text(cell))
            if sku:
                row_to_sku[row] = sku
        r = r2 + 1
    return row_to_sku


def set_value(fid, sid, row, col, value):
    edsdk('sheet_set_cell_value', {
        'file_id': fid, 'sheet_id': sid,
        'cell': {'row': row, 'col': col, 'value_type': 'STRING', 'string_value': value},
    })


def set_color(fid, sid, row, col, color):
    edsdk('sheet_set_cell_style', {
        'file_id': fid, 'sheet_id': sid,
        'start_row': row, 'start_col': col, 'end_row': row, 'end_col': col,
        'format': {'font_color': color},
    })


# ---------- 主流程 ----------

def main():
    if not os.path.exists(UPDATES_JSON):
        sys.exit('找不到 %s，请先跑 process_inventory.mjs' % UPDATES_JSON)

    with open(UPDATES_JSON, 'r', encoding='utf-8') as f:
        data = json.load(f)
    updates = data.get('updates', [])
    update_map = {u['sku']: u for u in updates}
    print('读取更新指令：%d 个监控 SKU' % len(updates))

    src, dst = resolve_files()
    print('源文件：%s' % src)
    print('目标文件：%s' % dst)

    # .xls 无法原地保存（edsdk 只能写 OOXML）→ 先另存一份 .xlsx，后续都在 .xlsx 上做
    if os.path.splitext(src)[1].lower() == '.xls':
        fid = open_book(src)
        sid = resolve_sheet(fid)
        print('检测到 OLE 老格式 .xls，先另存为 .xlsx（edsdk 只能写 OOXML）')
        converted = edsdk('save_file', {
            'file_id': fid, 'file_path': dst, 'allow_format_change': True,
        })
        print('另存结果：%s' % converted[:200])
        src = dst
        fid = open_book(src)
        sid = resolve_sheet(fid)
    else:
        fid = open_book(src)
        sid = resolve_sheet(fid)

    print('file_id=%s | sheet_id=%s' % (fid, sid))

    sku_col = col_index(EX['skuCol'])
    name_col = col_index(EX['nameCol'])
    inv_col = col_index(EX['inventoryCol'])
    print('SKU 列=%s(%d) 名称列=%s(%d) 库存列=%s(%d)'
          % (EX['skuCol'], sku_col, EX['nameCol'], name_col, EX['inventoryCol'], inv_col))

    end_row, end_col = used_range(fid, sid)
    print('已用区域：末行=%d 末列=%d（0-based）' % (end_row, end_col))

    header_row = int(EX.get('headerRow') or 0)
    row_to_sku = read_sku_column(fid, sid, sku_col, header_row, end_row)
    print('SKU 列解析出 %d 行' % len(row_to_sku))

    table_skus = set(row_to_sku.values())
    missing = [u for u in updates if u['sku'] not in table_skus]

    # 可选：自动补全缺失 SKU 行（默认只补 ERP 里有记录的，避免把空 SKU 也铺满表）
    appended = []
    if EX.get('autoAppendMissing') and missing:
        only_data = bool(EX.get('appendOnlyWithData', True))
        to_append = [u for u in missing if (u.get('hasAny') or not only_data)]
        if to_append:
            start = end_row + 1
            print('自动补行：%d 个缺失 SKU（从 row %d 开始）' % (len(to_append), start))
            edsdk('sheet_insert_dimension', {
                'file_id': fid, 'sheet_id': sid,
                'dimension_type': 'row', 'index': start, 'count': len(to_append), 'direction': 'after',
            })
            # 结构性改动后坐标失效，重新探测
            end_row, end_col = used_range(fid, sid)
            r = start
            for u in to_append:
                set_value(fid, sid, r, sku_col, u['sku'])
                if u.get('name'):
                    set_value(fid, sid, r, name_col, u['name'])
                set_value(fid, sid, r, inv_col, u['value'])
                set_color(fid, sid, r, inv_col, RED if u['redFlag'] else BLACK)
                row_to_sku[r] = u['sku']
                appended.append((r, u['sku']))
                r += 1
            table_skus = set(row_to_sku.values())

    # 写入库存列
    updated = 0
    red_count = 0
    skipped = []
    for row in sorted(row_to_sku):
        sku = row_to_sku[row]
        if sku not in update_map:
            skipped.append((row, sku))
            continue
        u = update_map[sku]
        set_value(fid, sid, row, inv_col, u['value'])
        set_color(fid, sid, row, inv_col, RED if u['redFlag'] else BLACK)
        updated += 1
        if u['redFlag']:
            red_count += 1

    print('库存列(%s)更新：%d 行，其中标红 %d 行' % (EX['inventoryCol'], updated, red_count))
    if skipped:
        print('跳过非监控 SKU 行（%d）：%s' % (len(skipped), skipped[:10]))

    still_missing = [u['sku'] for u in updates if u['sku'] not in table_skus]
    if still_missing:
        print('表格仍缺失的监控 SKU（%d）：%s' % (len(still_missing), still_missing))
        if not EX.get('autoAppendMissing'):
            print('  提示：把 config.json 的 excel.autoAppendMissing 设为 true 可自动补行')

    # 保存（固定名优先；被 WPS/Excel 占用则改存带日期的文件名）
    try:
        out = edsdk('save_file', {'file_id': fid, 'file_path': dst})
        print('保存结果：%s' % out[:200])
        final_path = dst
    except RuntimeError as e:
        msg = str(e)
        if 'occupied' in msg.lower() or '占用' in msg:
            today = datetime.date.today().strftime('%Y%m%d')
            base, ext = os.path.splitext(dst)
            fallback = '%s-%s%s' % (base, today, ext or '.xlsx')
            print('目标文件被占用，改存：%s' % fallback)
            out = edsdk('save_file', {'file_id': fid, 'file_path': fallback})
            print('保存结果：%s' % out[:200])
            final_path = fallback
        else:
            raise

    print('\n=== Excel 同步完成 ===')
    print('最终输出文件：%s' % final_path)
    print('更新行数：%d' % updated)
    print('标红行数：%d' % red_count)
    print('自动补行：%d' % len(appended))
    print('表格缺失的监控 SKU 数：%d' % len(still_missing))


if __name__ == '__main__':
    main()
