#!/usr/bin/env python3
"""
patch_resend_logs.py
在 VM 的 express-server.js 中：
1. 新增 GET /api/internal/resend-logs 端點（從 Supabase 撈補寄紀錄）
2. 在 resend-notify 成功後，寫入 Supabase resend_logs 並更新 Google Sheets O 欄

使用方式：python3 /home/order/simax-momo-engine/patch_resend_logs.py
"""

TARGET = '/home/order/simax-momo-engine/express-server.js'

with open(TARGET, 'r', encoding='utf-8') as f:
    src = f.read()

# ── 確認還沒有 patch 過 ───────────────────────────────────────────────────────
if 'resend_logs' in src:
    print('ALREADY PATCHED — 跳過')
    exit(0)

# =========================================================================
# PATCH 1：在「啟動伺服器」注釋前插入 GET /api/internal/resend-logs 端點
# =========================================================================
ANCHOR_START = '// ── 啟動伺服器 ────────────────────────────────────────────────────────────────'

if ANCHOR_START not in src:
    print(f'ERROR: 找不到 ANCHOR_START，請確認 express-server.js 內容')
    exit(1)

NEW_ENDPOINT = '''
// ── GET /api/internal/resend-logs ────────────────────────────────────────────
/**
 * 查詢最近補寄紀錄（從 Supabase resend_logs 表）
 * GET /api/internal/resend-logs?limit=50&internalKey=xxx
 */
app.get('/api/internal/resend-logs', async (req, res) => {
  const key = req.query.internalKey || req.headers['x-internal-key'] || '';
  if (key !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: '未授權' });
  }

  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);

  try {
    const { data, error } = await supabase
      .from('resend_logs')
      .select('id, order_id, email, status, resent_at')
      .order('resent_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[express] resend_logs 查詢失敗:', error.message);
      return res.status(500).json({ error: '查詢失敗' });
    }

    return res.status(200).json({ logs: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

''' + ANCHOR_START

src = src.replace(ANCHOR_START, NEW_ENDPOINT, 1)
print('PATCH 1 完成：新增 GET /api/internal/resend-logs 端點')

# =========================================================================
# PATCH 2：在 resend-notify 成功回傳前插入雙寫邏輯
# 定位字串：sendOrderNotification 呼叫之後的 return { success: true }
# =========================================================================
# 找到 resend-notify handler 裡特有的 "成功寄信後" 回傳
RESEND_OLD = "    return res.status(200).json({ success: true });"

if RESEND_OLD not in src:
    print(f'ERROR: 找不到 RESEND_OLD，請確認 VM 上的 resend-notify 格式')
    exit(1)

count = src.count(RESEND_OLD)
print(f'找到 RESEND_OLD 共 {count} 次')

RESEND_NEW = """    // ── 寫入 Supabase resend_logs ───────────────────────────────────────────
    try {
      await supabase.from('resend_logs').insert({
        order_id:  orderId,
        email:     email,
        status:    'success',
        resent_at: new Date().toISOString(),
      });
      console.log(`[express] ✅ resend_logs 寫入完成: ${orderId} → ${email}`);
    } catch (dbErr) {
      console.error(`[express] ⚠️  resend_logs 寫入失敗（不影響補寄）: ${dbErr.message}`);
    }

    // ── 更新 Google Sheets 對應訂單列 O 欄，加入補寄備註 ─────────────────────
    try {
      const sheets  = await getSheetsClient();
      const readRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range:         `${RECORD_SHEET_TAB}!D:O`,
      });
      const rows   = readRes.data.values || [];
      const baseId = orderId.replace(/-item\\d+$/, '');
      const tsTW   = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
      const note   = `補寄：${email} | ${tsTW}`;

      for (let i = 1; i < rows.length; i++) {
        const rowD = (rows[i][0] || '').toString().trim();   // D 欄 = 訂單編號
        if (rowD === baseId || rowD.startsWith(baseId + '-item')) {
          const rowNum = i + 1;                               // Sheets 1-indexed
          // D:O 共 12 欄，O 欄 = index 11
          const curO   = (rows[i][11] || '').toString();
          const newO   = curO ? `${curO} | ${note}` : note;
          await sheets.spreadsheets.values.update({
            spreadsheetId:    SHEET_ID,
            range:            `${RECORD_SHEET_TAB}!O${rowNum}`,
            valueInputOption: 'USER_ENTERED',
            requestBody:      { values: [[newO]] },
          });
          console.log(`[express] ✅ Sheets 補寄備註更新 row=${rowNum}`);
        }
      }
    } catch (sheetErr) {
      console.error(`[express] ⚠️  Sheets 補寄備註更新失敗（不影響補寄）: ${sheetErr.message}`);
    }

    return res.status(200).json({ success: true });"""

# 只替換最後一個出現的（resend-notify 末尾）
last_idx = src.rfind(RESEND_OLD)
src = src[:last_idx] + RESEND_NEW + src[last_idx + len(RESEND_OLD):]
print('PATCH 2 完成：resend-notify 成功後雙寫 Supabase + Sheets')

# ── 寫回檔案 ─────────────────────────────────────────────────────────────────
with open(TARGET, 'w', encoding='utf-8') as f:
    f.write(src)

print()
print('===== ALL DONE =====')
print('請執行：pm2 restart simax-engine')
