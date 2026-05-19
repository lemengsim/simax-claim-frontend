#!/usr/bin/env python3
"""
patch_reconciler.py
修補 status-reconciler.js 的三個 Bug：
  1. let 宣告缺少 vendorDays = 0
  2. 比對成功後未擷取 vendorDays
  3. 寫入 Sheets 的 row 陣列欄位順序錯誤（N=天數, O=成本, P=狀態）
"""
import re, sys, shutil, datetime

PATH = '/home/order/simax-momo-engine/status-reconciler.js'

with open(PATH, 'r', encoding='utf-8') as f:
    c = f.read()

original = c   # 保留原始內容，出錯時用來比對

changed = 0

# ── 修補 1：let 宣告加入 vendorDays ────────────────────────────────────────
pat1 = r"let vendorCode = '', vendorName = '', vendorSpec = '', vendorCost = '';"
rep1 =  "let vendorCode = '', vendorName = '', vendorSpec = '', vendorDays = 0, vendorCost = '';"
if pat1 in c:
    c = c.replace(pat1, rep1)
    print('[patch 1] ✅ let 宣告已加入 vendorDays')
    changed += 1
elif "vendorDays = 0" in c:
    print('[patch 1] ℹ️  vendorDays 已存在，略過')
else:
    print('[patch 1] ⚠️  找不到 let 宣告目標字串，請手動確認')

# ── 修補 2：比對成功後擷取 vendorDays ──────────────────────────────────────
pat2 = r"(vendorCost\s*=\s*m\.vendorCost[^;]*;)"
if re.search(pat2, c):
    if 'vendorDays = m.vendorDays' not in c:
        c = re.sub(pat2, r"\1\n        vendorDays = m.vendorDays || 0;", c)
        print('[patch 2] ✅ vendorDays = m.vendorDays 已加入')
        changed += 1
    else:
        print('[patch 2] ℹ️  vendorDays 擷取已存在，略過')
else:
    print('[patch 2] ⚠️  找不到 vendorCost 擷取行，請手動確認')

# ── 修補 3：row 陣列欄位順序（N=天數, O=成本, P=狀態）─────────────────────
# 目標：vendorCost 在 N, status 在 O → 改為 vendorDays 在 N, vendorCost 在 O, status 在 P
# 使用寬鬆 regex，不依賴精確空白與行尾註解
pat3 = re.compile(
    r"(vendorCode,\s*//[^\n]*\n\s*vendorName,\s*//[^\n]*\n\s*vendorSpec,\s*//[^\n]*\n)"
    r"\s*vendorCost,\s*//[^\n]*\n"
    r"\s*status,\s*//[^\n]*\n"
    r"(\s*\];)",
    re.DOTALL
)
m3 = pat3.search(c)
if m3:
    # 取得縮排（從第一個 group 的最後一行縮排推算）
    indent = '    '
    replacement = (
        m3.group(1) +
        f"{indent}vendorDays,       // N: 天數\n"
        f"{indent}vendorCost,       // O: 成本\n"
        f"{indent}status,           // P: QR Code / 狀態\n"
        + m3.group(2)
    )
    c = c[:m3.start()] + replacement + c[m3.end():]
    print('[patch 3] ✅ row 陣列欄位順序已修正（N=天數, O=成本, P=狀態）')
    changed += 1
elif 'vendorDays,       // N' in c:
    print('[patch 3] ℹ️  row 陣列已是正確格式，略過')
else:
    print('[patch 3] ⚠️  找不到 row 陣列目標欄位，請手動確認')

if changed == 0:
    print('⚠️  無任何修補被套用，請確認原始檔案內容')
    sys.exit(0)

# 備份原始檔案
ts = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
bak = PATH + f'.bak_{ts}'
shutil.copy2(PATH, bak)
print(f'[backup] 原始檔案已備份至 {bak}')

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(c)

print(f'✅ status-reconciler.js 已成功套用 {changed} 項修補')
