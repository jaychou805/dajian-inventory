# 库存 Excel 同步脚本（第二步）
# 输入：excel-updates.json（由 process_inventory.mjs 生成）
# 功能：读取源 Excel 的 A 列 SKU，匹配后更新 C 列库存值，并按规则标红
# 输出：覆盖保存为 95已上产品-已同步最新库存.xlsx

import json
import subprocess
import sys
import os
import time
import datetime
import re

# 从 config.json 读取路径（与 Node 脚本共享同一配置）
_here = os.path.dirname(os.path.abspath(__file__))
_cfg_path = os.path.join(_here, "..", "config.json")
with open(_cfg_path, "r", encoding="utf-8") as _f:
    _CFG = json.load(_f)

EDSdk_DIR = _CFG["paths"]["edsdkDir"]
PYTHON = _CFG["paths"]["python"]
SRC = _CFG["paths"]["excelFile"]
DST = _CFG["paths"]["excelFile"]
UPDATES_JSON = os.path.join(_CFG["paths"]["workDir"], "inventory-snapshots", "excel-updates.json")


def edsdk_call(tool, args):
    """调用 edsdk.py call --json <args> <tool>，返回 stdout"""
    blob = json.dumps(args, ensure_ascii=False)
    cmd = [PYTHON, os.path.join(EDSdk_DIR, "edsdk.py"), "call", "--json", blob, tool]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        raise RuntimeError(f"edsdk 调用失败: {tool}\nstdout={r.stdout}\nstderr={r.stderr}")
    return r.stdout.strip()


def parse_json(s):
    s = s.strip()
    try:
        return json.loads(s)
    except Exception:
        pass
    start = s.find('{')
    end = s.rfind('}')
    if start >= 0 and end > start:
        return json.loads(s[start:end + 1])
    return None


def main():
    with open(UPDATES_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)
    updates = data["updates"]
    update_map = {u["sku"]: u for u in updates}
    print(f"读取更新指令：{len(updates)} 个 SKU")

    file_id = SRC

    # 打开源文件（阻塞等待就绪）
    out = edsdk_call("open_file", {"file_path": SRC, "wait": True})
    print(f"打开源文件: {out[:120]}")

    sheet_id = "000001"

    # 读取 A 列全部 SKU（row 0 ~ 104，col 0）
    out = edsdk_call("sheet_get_cell_data", {
        "file_id": file_id, "sheet_id": sheet_id,
        "start_row": 0, "end_row": 104, "start_col": 0, "end_col": 0,
        "return_csv": False,
    })
    cell_data = parse_json(out)
    if not cell_data:
        print("读取 A 列失败")
        print(out)
        sys.exit(1)

    row_to_sku = {}
    for cell in cell_data.get("cells", []):
        row = cell["row"]
        col = cell["col"]
        if col != 0:
            continue
        sku_raw = None
        if cell.get("value_type") == "NUMBER":
            sku_raw = str(int(cell["number_value"]))
        elif cell.get("value_type") == "STRING":
            sku_raw = cell.get("string_value", "").strip()
        if not sku_raw:
            continue
        nums = re.findall(r'\d{6,}', sku_raw)
        if not nums:
            continue
        sku8 = [n for n in nums if len(n) == 8]
        if sku8:
            target_sku = sku8[-1]
        else:
            target_sku = nums[-1]
        row_to_sku[row] = target_sku

    print(f"A 列解析出 {len(row_to_sku)} 个 SKU 行")

    updated_count = 0
    red_count = 0
    skipped_rows = []
    not_found = []

    for row, sku in sorted(row_to_sku.items()):
        if sku not in update_map:
            skipped_rows.append((row, sku))
            continue
        u = update_map[sku]
        value = u["value"]
        red_flag = u["redFlag"]

        # 写 C 列（col=2）
        cell_arg = {"row": row, "col": 2, "value_type": "STRING", "string_value": value}
        edsdk_call("sheet_set_cell_value", {
            "file_id": file_id, "sheet_id": sheet_id, "cell": cell_arg,
        })

        # 标红：A或B ≤3 时整格红色；否则黑色
        color = "FFFF0000" if red_flag else "FF000000"
        edsdk_call("sheet_set_cell_style", {
            "file_id": file_id, "sheet_id": sheet_id,
            "start_row": row, "start_col": 2, "end_row": row, "end_col": 2,
            "format": {"font_color": color},
        })

        if red_flag:
            red_count += 1
        updated_count += 1

    print(f"更新 C 列：{updated_count} 行，其中标红 {red_count} 行")

    if skipped_rows:
        print(f"跳过非监控 SKU 行（{len(skipped_rows)}）：{skipped_rows}")

    # 保存（固定文件名优先；被占用则改存当日日期文件名）
    try:
        out = edsdk_call("save_file", {"file_id": file_id, "file_path": DST})
        print(f"保存结果(固定名): {out[:200]}")
        final_path = DST
    except RuntimeError as e:
        msg = str(e)
        if "occupied" in msg.lower() or "占用" in msg:
            today = datetime.date.today().strftime("%Y%m%d")
            fallback = os.path.join(os.path.dirname(DST), f"95已上产品-已同步最新库存-{today}.xlsx")
            print(f"固定文件名被占用，改存当日日期文件名: {fallback}")
            out = edsdk_call("save_file", {"file_id": file_id, "file_path": fallback})
            print(f"保存结果(当日名): {out[:200]}")
            final_path = fallback
        else:
            raise

    all_monitor_skus = [u["sku"] for u in updates]
    table_skus = set(row_to_sku.values())
    missing_in_table = [s for s in all_monitor_skus if s not in table_skus]

    print("\n=== Excel 同步完成 ===")
    print(f"最终输出文件：{final_path}")
    print(f"更新行数：{updated_count}")
    print(f"标红行数：{red_count}")
    print(f"表格缺失的监控 SKU 数：{len(missing_in_table)}")
    if missing_in_table:
        print(f"  缺失 SKU：{missing_in_table}")


if __name__ == "__main__":
    main()
