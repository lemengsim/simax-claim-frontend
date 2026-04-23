/**
 * 檔案：express-server.js
 * 模組：GCP 內部 API 伺服器（Express.js）
 *
 * 對外開放一支 API：
 *   POST /api/internal/redeem
 *   Body:  { orderNo: string, email: string, internalKey: string }
 *   成功回傳：{ success: true, order_id, product_name, vendor, qr_code_data, message }
 *   失敗回傳：{ success: false, error: string }
 *
 * 流程（MOMO 訂單編號驗證架構）：
 *  1. 驗證 internalKey（防止外部直接呼叫）
 *  2. 呼叫 momo-ingest.verifyMomoOrder() 透過 C1105 API 驗證訂單已出貨並取得品名
 *  3. 呼叫 core-mapper.js 比對廠商代碼
 *  4. 呼叫 dispatch-worker.js 向 DJB / WM 叫貨取得 QR Code
 *  5. 寫入 Supabase 留存記錄（防重複領取）
 *  6. 寫入 Google Sheets 自助領取紀錄分頁
 *  7. 回傳 QR Code 給 Vercel 前台
 *
 * 環境變數：
 *  EXPRESS_PORT         - HTTP 監聽埠（預設 3001）
 *  INTERNAL_API_KEY     - 內部呼叫金鑰（Vercel 設定此值，防止濫用）
 *  SUPABASE_URL         - Supabase Project URL
 *  SUPABASE_SERVICE_KEY - service_role key
 *  GOOGLE_SHEET_ID      - Google Sheet 試算表 ID（選填，有預設值）
 */

'use strict';

const express              = require('express');
const { google }           = require('googleapis');
const { createClient }     = require('@supabase/supabase-js');
const { verifyMomoOrder }    = require('./momo-ingest');
const { mapProductToVendor } = require('./core-mapper');
const { dispatchOrder }      = require('./dispatch-worker');

// ── Supabase ─────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

// ── Google Sheets 設定 ────────────────────────────────────────────────────────
const SHEET_ID         = process.env.GOOGLE_SHEET_ID
  || '1foLTvkiN7gLtxDrFXFOoLviloop2qYduTGG_LpK8glQ';
// 自助領取紀錄 分頁（gid=692566222）：欄位 A–O（共 15 欄）
// A: 訂單時間, B: 時間戳記, C: 平台, D: 訂單編號, E: 票券PIN
// F: 客戶Email, G: 商品名稱, H: 規格, I: 數量, J: 售價
// K: 廠商代碼, L: 廠商品名, M: 廠商規格, N: 廠商成本, O: QR Code/狀態
const RECORD_SHEET_TAB = '自助領取紀錄';

/**
 * 取得 Google Sheets API client（使用 ADC，GCP VM 自動套用 service account）
 */
async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

/**
 * 在「自助領取紀錄」分頁末尾 append 一行
 * @param {object} params
 */
async function appendToSheetLog(params) {
  const {
    orderTime,    // string：MOMO 訂單時間（ISO or 格式化字串）
    platform,     // string：'MOMO' | '蝦皮' | '官網'
    orderId,      // string：訂單編號
    ticketPin,    // string：票券 PIN
    customerEmail,// string
    planTitle,    // string：上架名稱（MOMO 商品名稱）
    spec,         // string：規格（天數/GB 等）
    qty,          // number：數量
    sellingPrice, // number | string：售價（無法取得時填 ''）
    vendorCode,   // string：廠商代碼（e.g. ESIM-CJP-VN4-BU2-D5）
    vendorName,   // string：廠商品名
    vendorSpec,   // string：廠商規格
    cost,         // number：廠商成本
    qrCodeOrStatus, // string：QR Code 內容或狀態文字
  } = params;

  const now = new Date().toISOString();

  // 欄位順序：A B C D E F G H I J K L M N O（共 15 欄）
  const row = [
    orderTime    || '',   // A 訂單時間
    now,                  // B 時間戳記（寫入當下）
    platform     || '',   // C 平台
    orderId      || '',   // D 訂單編號
    ticketPin    || '',   // E 票券 PIN
    customerEmail|| '',   // F 客戶 Email
    planTitle    || '',   // G 商品名稱（上架名稱）
    spec         || '',   // H 規格
    qty          ?? 1,    // I 數量
    sellingPrice ?? '',   // J 售價
    vendorCode   || '',   // K 廠商代碼
    vendorName   || '',   // L 廠商品名
    vendorSpec   || '',   // M 廠商規格
    cost         ?? '',   // N 廠商成本
    qrCodeOrStatus || '', // O QR Code / 狀態
  ];

  try {
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range:         `${RECORD_SHEET_TAB}!A:O`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });
    console.log(`[express] ✅ Google Sheets 寫入完成: ${orderId}`);
  } catch (err) {
    // 寫入失敗不中斷主流程（客戶仍能拿到 QR Code）
    console.error(`[express] ⚠️  Google Sheets 寫入失敗（QR Code 已正常回傳）: ${err.message}`);
  }
}

/**
 * 更新「自助領取紀錄」分頁中特定 ticketPin 那列的 O 欄狀態
 * 用於：買家領取 QR（已領取）、eSIM 安裝後回填（已安裝）
 * @param {string} ticketPin  票券 PIN（用來找對應列）
 * @param {string} newStatus  新狀態文字（e.g. '已領取｜2026-04-22 15:30'）
 */
async function updateSheetRowStatus(ticketPin, newStatus) {
  try {
    const sheets = await getSheetsClient();
    // 讀 E 欄（票券 PIN）找到對應列號
    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range:         `${RECORD_SHEET_TAB}!E:E`,
    });
    const rows = readRes.data.values || [];
    // 跳過第一列（標題），從 index 1 開始找
    const idx = rows.findIndex((r, i) => i > 0 && r[0] === ticketPin);
    if (idx < 0) {
      console.log(`[express] Sheets 找不到 PIN=${ticketPin}，略過狀態更新`);
      return;
    }
    const rowNum = idx + 1; // Sheets 1-indexed
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range:         `${RECORD_SHEET_TAB}!O${rowNum}`,
      valueInputOption: 'USER_ENTERED',
      requestBody:   { values: [[newStatus]] },
    });
    console.log(`[express] ✅ Sheets 狀態更新 row=${rowNum} PIN=${ticketPin} → ${newStatus}`);
  } catch (err) {
    console.error(`[express] ⚠️ Sheets 狀態更新失敗: ${err.message}`);
  }
}

// ── Express App ───────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '1mb' }));

// ── 健康檢查 ──────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ── 主核銷 API ────────────────────────────────────────────────────────────────
/**
 * POST /api/internal/redeem
 * 電子票券驗證 → 廠商叫貨 → 核銷 → Supabase 存檔 → Sheets 寫入 → 回傳 QR Code
 */
app.post('/api/internal/redeem', async (req, res) => {
  const { orderNo, email, internalKey } = req.body || {};

  console.log(`\n[express] ===== 兌換請求 ${new Date().toISOString()} =====`);
  console.log(`[express] orderNo=${orderNo} email=${email}`);

  // ── 1. 內部金鑰驗證 ──────────────────────────────────────────────────────
  const expectedKey = process.env.INTERNAL_API_KEY;
  if (expectedKey && internalKey !== expectedKey) {
    console.warn('[express] ⚠️  internalKey 驗證失敗');
    return res.status(401).json({ success: false, error: '授權失敗' });
  }

  // ── 2. 基本欄位驗證 ──────────────────────────────────────────────────────
  if (!orderNo || orderNo.trim().length === 0) {
    return res.status(400).json({ success: false, error: '請輸入 MOMO 訂單編號' });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ success: false, error: '請輸入有效的 Email' });
  }

  const momoOrderNo   = orderNo.trim();
  const customerEmail = email.trim().toLowerCase();

  // ── 3. 重複領取防護：檢查 Supabase 是否已處理過此訂單 ────────────────────
  const { data: existing } = await supabase
    .from('orders')
    .select('order_id, status, qr_code_data, product_name, vendor')
    .eq('order_id', momoOrderNo)
    .maybeSingle();

  if (existing) {
    console.log(`[express] 此訂單已處理過：${existing.order_id} status=${existing.status}`);

    // 解析已儲存的 QR codes（支援單件字串 或 多件 JSON 陣列字串）
    let savedCodes = [];
    try {
      const parsed = JSON.parse(existing.qr_code_data);
      savedCodes = Array.isArray(parsed) ? parsed : [existing.qr_code_data];
    } catch {
      savedCodes = [existing.qr_code_data || ''];
    }

    const existingItems = savedCodes.map((qr, i) => ({
      order_id:     savedCodes.length > 1 ? `${existing.order_id}-item${i + 1}` : existing.order_id,
      product_name: existing.product_name || '',
      vendor:       existing.vendor || '',
      qr_code_data: qr,
    }));

    return res.status(200).json({
      success: true,
      items:   existingItems,
      message: '此訂單已兌換（重複查詢）',
    });
  }

  // ── 4. MOMO C1105 訂單驗證（確認已出貨 + 取得品名）──────────────────────
  let orderInfo;
  try {
    orderInfo = await verifyMomoOrder(momoOrderNo);
  } catch (err) {
    console.error('[express] MOMO 訂單驗證失敗:', err.message);
    return res.status(400).json({ success: false, error: `訂單驗證失敗：${err.message}` });
  }

  if (!orderInfo.valid) {
    return res.status(400).json({ success: false, error: orderInfo.message || '查無此訂單或尚未完成出貨' });
  }

  console.log(`[express] 訂單有效：goodsName="${orderInfo.goodsName}" qty=${orderInfo.qty}`);

  // ── 5. 商品比對 ───────────────────────────────────────────────────────────
  let mapping;
  try {
    mapping = await mapProductToVendor(orderInfo.goodsName);
  } catch (err) {
    console.error('[express] core-mapper 錯誤:', err.message);
    return res.status(500).json({ success: false, error: '商品比對系統錯誤，請聯繫客服' });
  }

  if (!mapping.matched) {
    console.error(`[express] 商品比對失敗：${orderInfo.goodsName}`);
    return res.status(400).json({
      success: false,
      error:   `無法比對商品「${orderInfo.goodsName}」，請聯繫客服協助處理`,
    });
  }

  console.log(`[express] 比對成功：${mapping.planTitle} → ${mapping.vendor}/${mapping.vendorCode}`);

  // ── 6. 廠商叫貨（依訂單數量迴圈，每件取一個 QR Code）───────────────────
  const qty        = orderInfo.qty || 1;
  const qrCodes    = [];
  let   dispatchNote = '';

  console.log(`[express] 開始叫貨，共 ${qty} 件`);

  for (let i = 0; i < qty; i++) {
    const itemOrderId = qty > 1 ? `${momoOrderNo}-item${i + 1}` : momoOrderNo;
    let qr;

    try {
      qr = await dispatchOrder({
        vendor:        mapping.vendor,
        vendorCode:    mapping.vendorCode,
        vendorDays:    mapping.vendorDays || 0,
        customerEmail: customerEmail,
        orderId:       itemOrderId,
      });
      console.log(`[express] ✅ 第 ${i + 1}/${qty} 件叫貨完成`);
    } catch (err) {
      if (err.code === 'DJB_QR_PENDING') {
        console.warn(`[express] DJB QR Pending (第 ${i + 1} 件): ${err.message}`);
        qr           = `DJB_PENDING:${err.djbOrderId}`;
        dispatchNote = 'eSIM 建立中，QR Code 將於 5-15 分鐘內備妥，請稍候再試';
      } else {
        console.error(`[express] 發貨失敗（第 ${i + 1} 件）:`, err.message);
        return res.status(502).json({
          success: false,
          error:   `發貨失敗（第 ${i + 1}/${qty} 件）：${err.message}，請聯繫客服`,
        });
      }
    }
    qrCodes.push(qr);
  }

  // ── 7. Supabase 存檔（防重複兌換）────────────────────────────────────────
  // 多件時以 JSON 陣列字串儲存；單件維持字串，向下相容
  const qrCodeStored = qrCodes.length === 1 ? qrCodes[0] : JSON.stringify(qrCodes);
  const anyPending   = qrCodes.some(q => q.startsWith('DJB_PENDING:'));

  const orderRecord = {
    order_id:       momoOrderNo,
    platform:       'MOMO',
    ticket_pin:     momoOrderNo,   // 以訂單號代替 PIN 欄位
    product_name:   mapping.planTitle,
    customer_email: customerEmail,
    vendor:         mapping.vendor,
    vendor_code:    mapping.vendorCode,
    qr_code_data:   qrCodeStored,
    status:         anyPending ? 'pending' : 'ready_to_claim',
    claimed_at:     anyPending ? null : new Date().toISOString(),
    retry_count:    0,
    created_at:     new Date().toISOString(),
  };

  const { error: dbErr } = await supabase
    .from('orders')
    .upsert(orderRecord, { onConflict: 'order_id' });

  if (dbErr) {
    console.error(`[express] ⚠️  Supabase 存檔失敗（QR Code 已正常回傳）: ${dbErr.message}`);
  } else {
    console.log(`[express] ✅ Supabase 存檔完成: ${momoOrderNo} (${qty} 件)`);
  }

  // ── 8. Google Sheets 自助領取紀錄寫入（每件 QR 各寫一行）────────────────
  qrCodes.forEach((qr, i) => {
    const isPending = qr.startsWith('DJB_PENDING:');
    appendToSheetLog({
      orderTime:      new Date().toISOString(),
      platform:       'MOMO',
      orderId:        momoOrderNo,
      ticketPin:      qty > 1 ? `${momoOrderNo}-item${i + 1}` : momoOrderNo,
      customerEmail:  customerEmail,
      planTitle:      mapping.planTitle  || '',
      spec:           mapping.vendorSpec || '',
      qty:            1,  // 每行代表 1 個 QR Code
      sellingPrice:   '',
      vendorCode:     mapping.vendorCode || '',
      vendorName:     mapping.vendorName || '',
      vendorSpec:     mapping.vendorSpec || '',
      cost:           mapping.vendorCost || 0,
      qrCodeOrStatus: isPending ? `建立中（${qr}）` : `已出票｜${qr}`,
    }).catch(err => console.error(`[express] Sheets 寫入未預期錯誤 (第 ${i + 1} 件): ${err.message}`));
  });

  // ── 9. 回傳成功結果（items 陣列格式，前台 normalizeResponse 已支援）──────
  const responseItems = qrCodes.map((qr, i) => ({
    order_id:     qty > 1 ? `${momoOrderNo}-item${i + 1}` : momoOrderNo,
    product_name: mapping.planTitle,
    vendor:       mapping.vendor,
    qr_code_data: qr,
  }));

  console.log(`[express] ===== 兌換完成 ${new Date().toISOString()} (${qty} 件) =====\n`);

  return res.status(200).json({
    success: true,
    items:   responseItems,
    message: dispatchNote || null,
  });
});

// ── 啟動伺服器 ────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.EXPRESS_PORT || '3001', 10);

function startExpressServer() {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[express] ✅ GCP 內部 API 伺服器啟動 → http://0.0.0.0:${PORT}`);
    console.log(`[express]    POST /api/internal/redeem  — 電子票券核銷端點`);
    console.log(`[express]    GET  /health               — 健康檢查`);
  });
}

module.exports = { startExpressServer };
