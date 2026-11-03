# 补行脚本：在 A 列末尾追加缺失 SKU（22441555），写 A/B/C 并标红
import json
import subprocess
import os
import sys
import time

# 从 config.json 读取路径
_here = os.path.dirname(os.path.abspath(__file__))
_cfg_path = os.path.join(_here, "..", "config.json")
with open(_cfg_path, "r", encoding="utf-8") as _f:
    _CFG = json.load(_f)

EDSdk_DIR = _CFG["paths"]["edsdkDir"]
PYTHON = _CFG["paths"]["python"]
SRC = _CFG["paths"]["excelFile"]

SKU = "22441555"
NAME = "50层橱柜门干燥架 油画艺术展示架 重型金属晾画架"
C_VAL = "56"  # 易达云美东仓 0 + 盛宝隆美西仓 56

def edsdk(*args):
    cmd = [PYTHON, os.path.join(EDSdk_DIR, "edsdk.py"), *args]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        raise RuntimeError(f"edsdk 调用失败: {args}\n{r.stdout}\n{r.stderr}")
    return r.stdout.strip()

def set_cell(row, col, value):
    cell_arg = json.dumps({"cell": {"row": row, "col": col, "value_type": "STRING", "string_value": value}})
    edsdk("call", "sheet_set_cell_value", f"file_id={SRC}", "sheet_id=000001", "--json", cell_arg)

# 1. 打开 + 就绪
edsdk("call", "open_file", f"file_path={SRC}")
ready = False
for i in range(45):
    time.sleep(2)
    try:
        edsdk("call", "sheet_get_sheet_info", f"file_id={SRC}")
        ready = True
        print(f"workbook 就绪（第 {i+1} 次探测）")
        break
    except RuntimeError:
        continue
if not ready:
    print("FAIL: 打开超时")
    sys.exit(1)

# 2. 目标行：0-based row 88（第 89 个数据行）
ROW = 88

set_cell(ROW, 0, SKU)
set_cell(ROW, 1, NAME)
set_cell(ROW, 2, C_VAL)
print(f"已写入 row {ROW+1}: A={SKU} B={NAME} C={C_VAL}")

# 3. 整行标红（A=0 ≤ 3）
for col in range(3):
    edsdk("call", "sheet_set_cell_style", f"file_id={SRC}", "sheet_id=000001",
          f"start_row={ROW}", f"start_col={col}", f"end_row={ROW}", f"end_col={col}",
          "--json", '{"format":{"font_color":"FFFF0000"}}')
print("已标红 3 格")

# 4. 保存
out = edsdk("call", "save_file", f"file_id={SRC}", f"file_path={SRC}")
print("保存:", out[:120])
