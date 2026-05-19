/**
 * 檔案：activation-poller.js
 * 模組：【啟用偵測模組 (Activation Poller)】
 * # v1.0.1 | 2026-05-15 | 修正 Sheets 寫入欄位：P → Q（QR Code/狀態欄）
 *
 * 功能：每 4 小時輪詢 DJB API，偵測 eSIM 是否已在買家設備上安裝（activated）
 *       確認後回填 Google Sheets 自助領取紀錄，並更新 Supabase status → 'activated'
 *
 * 執行方式（由 index.js 或 pm2 ecosystem 引入）：
 *   require('./activation-poller').startActivationPoller();
 *
 * 或單獨測試：
 *   node activation-poller.js
 */

'use strict';

require('dotenv').config();

const https  = require('https');
const http   = require('http');
const crypto = require('crypto');
const { google }      = require('googleapis');
const { createClient } = require('@supabase/supabase-js');

// ── 初始化 ─────────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

const SHEET_ID         = process.env.GOOGLE_SHEET_ID
  || '1foLTvkiN7gLtxDrFXFOoLviloop2qYduTGG_LpK8glQ';
const RECORD_SHEET_TAB = '自助領取紀錄';

// 輪詢間隔：4 小時
const POLL_INTERVAL_MS = 4 * 60 * 60 * 1000;

// ── DJB 工具函式 ───────────────────────────────────────────────────────────────
function httpPostForm(url, params) {
  const body   = new URLSearchParams(params).toString();
  const urlObj = new URL(url);
  const lib    = urlObj.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const options = {
      hostname: urlObj.hostname,
      port:     urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path:     urlObj.pathname + urlObj.search,
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = lib.request(options, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try   { resolve(JSON.parse(raw)); }
        catch { reject(new Error(`JSON 解析失敗: ${raw.substring(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('請求逾時 20s')); });
    req.write(body);
    req.end();
  });
}

function calcDjbChecksum(apiIv, sourceNo) {
  const tw  = new Date(new Date().getTime() + 8 * 3600 * 1000);
  const y   = tw.getUTCFullYear();
  const m   = String(tw.getUTCMonth() + 1).padStart(2, '0');
  const d   = String(tw.getUTCDate()).padStart(2, '0');
  const raw = apiIv + `${y}${m}${d}` + sourceNo;
  const b64 = Buffer.from(raw, 'utf8').toString('base64');
  return crypto.createHash('md5').update(b64, 'utf8').digest('hex');
}

/**
 * 判斷 DJB API 回傳是否表示「已安裝/已啟用」
 * DJB 回傳的 status 欄位可能為：'activated', 'used', 'installed', 'downloaded'
 */
function isDjbActivated(result) {
  const s = (
    result?.data?.status    ||
    result?.data?.data?.status ||
    result?.status          ||
    ''
  ).toLowerCase();
  return ['activated', 'used', 'installed', 'downloaded', 'active'].includes(s);
}

// ── Google Sheets 工具 ─────────────────────────────────────────────────────────
async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

/**
 * 找到對應 ticketPin 的列號，並更新 O 欄狀態
 */
async function updateSheetActivated(ticketPin) {
  try {
    const sheets  = await getSheetsClient();
    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range:         `${RECORD_SHEET_TAB}!E:E`,
    });
    const rows = readRes.data.values || [];
    const idx  = rows.findIndex((r, i) => i > 0 && r[0] === ticketPin);
    if (idx < 0) {
      console.log(`[poller] Sheets 找不到 PIN=${ticketPin}，略過`);
      return;
    }
    const rowNum = idx + 1;
    const twNow  = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range:         `${RECORD_SHEET_TAB}!Q${rowNum}`,
      valueInputOption: 'USER_ENTERED',
      requestBody:   { values: [[`已安裝｜${twNow}`]] },
    });
    console.log(`[poller] ✅ Sheets 已安裝 row=${rowNum} PIN=${ticketPin}`);
  } catch (err) {
    console.error(`[poller] ⚠️ Sheets 更新失敗: ${err.message}`);
  }
}

// ── 主輪詢邏輯 ─────────────────────────────────────────────────────────────────
async function pollActivations() {
  console.log(`[poller] ===== 啟用狀態輪詢開始 ${new Date().toISOString()} =====`);

  const baseUrl = process.env.DJB_BASE_URL;
  const apiIv   = process.env.DJB_API_IV;
  const apiKey  = process.env.DJB_API_KEY;

  if (!baseUrl || !apiIv || !apiKey) {
    console.warn('[poller] DJB 環境變數不完整，跳過本次輪詢');
    return;
  }

  // 查詢 Supabase：狀態為 ready_to_claim（已出票但未確認安裝）且是 DJB 廠商
  // 只查 30 天內建立的訂單，避免重複查詢過期訂單
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, order_id, ticket_pin, vendor, vendor_code, qr_code_data, created_at')
    .eq('vendor', 'DJB')
    .eq('status', 'ready_to_claim')
    .gte('created_at', cutoff)
    .limit(50);

  if (error) {
    console.error(`[poller] Supabase 查詢失敗: ${error.message}`);
    return;
  }

  if (!orders || orders.length === 0) {
    console.log('[poller] 無待確認訂單，本次輪詢結束');
    return;
  }

  console.log(`[poller] 待確認訂單：${orders.length} 筆`);

  // 台灣時區日期（DJB date 欄位格式）
  const tw   = new Date(new Date().getTime() + 8 * 3600 * 1000);
  const date = `${tw.getUTCFullYear()}-${String(tw.getUTCMonth() + 1).padStart(2,'0')}-${String(tw.getUTCDate()).padStart(2,'0')}`;

  for (const order of orders) {
    try {
      // 從 qr_code_data 或 order_id 取得 source_number（若有儲存）
      // 若沒有，嘗試以 order_id 作為 channel_sub_order_id 查詢
      const djbOrderId = order.order_id; // MOMO 訂單號；DJB channel_sub_order_id 可能不同
      // 注意：這裡用 order_id 當 source_number 是近似做法；
      // 若 DJB 需要原始 source_number，需在 Supabase 另存欄位
      const sourceNo   = `check${order.id.replace(/-/g, '').substring(0, 16)}`;
      const checksum   = calcDjbChecksum(apiIv, sourceNo);

      const result = await httpPostForm(`${baseUrl}/api/order/info`, {
        key:                  apiKey,
        date,
        checksum,
        source_number:        sourceNo,
        channel_sub_order_id: djbOrderId,
      });

      console.log(`[poller] PIN=${order.ticket_pin} DJB 回應: ${JSON.stringify(result).substring(0, 150)}`);

      if (isDjbActivated(result)) {
        console.log(`[poller] ✅ PIN=${order.ticket_pin} 已安裝！更新 Supabase + Sheets`);

        // 更新 Supabase status → 'activated'（需先 ALTER TABLE 加此值，見備注）
        const { error: upErr } = await supabase
          .from('orders')
          .update({ status: 'activated' })
          .eq('id', order.id);

        if (upErr) {
          // status CHECK constraint 可能尚未加 'activated'，記錄但繼續更新 Sheets
          console.warn(`[poller] Supabase status 更新失敗（可能需 ALTER TABLE）: ${upErr.message}`);
        }

        // 更新 Google Sheets
        await updateSheetActivated(order.ticket_pin);
      }

    } catch (err) {
      console.error(`[poller] PIN=${order.ticket_pin} 查詢失敗: ${err.message}`);
    }

    // 每筆間隔 500ms，避免對 DJB API 過快請求
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[poller] ===== 本次輪詢結束 ${new Date().toISOString()} =====\n`);
}

// ── 啟動週期輪詢 ───────────────────────────────────────────────────────────────
function startActivationPoller() {
  console.log(`[poller] 啟用偵測器啟動，每 ${POLL_INTERVAL_MS / 3600000} 小時輪詢一次`);
  // 啟動後 30 秒先跑一次（讓主服務先啟動完）
  setTimeout(pollActivations, 30 * 1000);
  // 之後每 4 小時跑一次
  setInterval(pollActivations, POLL_INTERVAL_MS);
}

module.exports = { startActivationPoller, pollActivations };

// 若直接執行（測試用）
if (require.main === module) {
  pollActivations().then(() => process.exit(0)).catch(e => {
    console.error(e.message);
    process.exit(1);
  });
}
