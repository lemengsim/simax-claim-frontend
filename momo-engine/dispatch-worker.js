/**
 * 檔案：dispatch-worker.js
 * 模組：【發貨模組 (Dispatch)】叫貨 Worker
 *
 * 負責：
 *  1. 每 3 分鐘掃描 Supabase 中 status='pending' 且 vendor_code 已有值的訂單
 *  2. 依 vendor 呼叫 DJB 或 世界移動 (WM) API 取得 QR Code / 兌換碼
 *  3. 成功後更新 Supabase：qr_code_data + status='ready_to_claim'
 *  4. 失敗超過 3 次標記為 'failed'（需人工介入）
 *
 * 環境變數：
 *  DJB_BASE_URL     - DJB API 基礎網址，例如 https://api.djbsim.com
 *  DJB_API_IV       - DJB API IV（用於 MD5 Checksum 計算）
 *  DJB_SOURCE_NO    - DJB source_number（帳號識別碼）
 *  WM_BASE_URL      - 世界移動 API，例如 https://fmshippingsys.fastmove.com.tw
 *  WM_MERCHANT_ID   - 世界移動 merchantId
 *  WM_DEPT_ID       - 世界移動 deptId
 *  WM_EMAIL         - 世界移動 下單用 Email
 *  WM_TOKEN         - 世界移動 SHA-1 簽章用 Token
 *  SUPABASE_URL     - Supabase Project URL
 *  SUPABASE_SERVICE_KEY - service_role key
 */

'use strict';

const https    = require('https');
const http     = require('http');
const crypto   = require('crypto');
const cron     = require('node-cron');
const { createClient } = require('@supabase/supabase-js');

// ── Supabase ─────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

// ── 工具函式 ─────────────────────────────────────────────────────────────────

/**
 * 通用 HTTP POST（支援 http / https）
 * @param {string} url
 * @param {object} payload
 * @param {object} extraHeaders
 * @returns {Promise<object>}
 */
function httpPost(url, payload, extraHeaders = {}) {
  const body    = JSON.stringify(payload);
  const urlObj  = new URL(url);
  const lib     = urlObj.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const options = {
      hostname: urlObj.hostname,
      port:     urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path:     urlObj.pathname + urlObj.search,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...extraHeaders,
      },
    };

    const req = lib.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (_) { reject(new Error(`JSON 解析失敗: ${raw.substring(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('請求逾時')); });
    req.write(body);
    req.end();
  });
}

// ── DJB API ──────────────────────────────────────────────────────────────────

/**
 * 計算 DJB Checksum：MD5( Base64( API_IV + YYYYMMDD + source_number ) )
 */
function calcDjbChecksum(apiIv, sourceNo) {
  const today     = new Date();
  const dateStr   = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const raw       = apiIv + dateStr + sourceNo;
  const b64       = Buffer.from(raw).toString('base64');
  return crypto.createHash('md5').update(b64).digest('hex');
}

/**
 * 向 DJB 下單，取得 QR Code 資料
 * @param {object} order - Supabase 訂單資料列
 * @returns {Promise<string>} - QR Code 內容（URL 或 LPA 字串）
 */
async function dispatchDjb(order) {
  const baseUrl  = process.env.DJB_BASE_URL;
  const apiIv    = process.env.DJB_API_IV;
  const sourceNo = process.env.DJB_SOURCE_NO;

  if (!baseUrl || !apiIv || !sourceNo) throw new Error('DJB 環境變數不完整');

  const checksum = calcDjbChecksum(apiIv, sourceNo);

  const payload = {
    source_number: sourceNo,
    checksum,
    product_code:  order.vendor_code,
    order_ref:     order.order_id,           // 我們的訂單編號作為廠商備註
    quantity:      1,
  };

  const result = await httpPost(`${baseUrl}/api/order/buy`, payload);

  // DJB 回傳格式（請依實際 API 文件確認）：
  //   { code: 0, data: { qr_code: 'LPA:1$...' } }
  if (result.code !== 0 && result.code !== '0') {
    throw new Error(`DJB API 回應錯誤: code=${result.code} msg=${result.message || result.msg}`);
  }

  const qrCode = result?.data?.qr_code || result?.data?.activation_code;
  if (!qrCode) throw new Error('DJB API 未回傳 qr_code');

  return qrCode;
}

// ── 世界移動 (WM/FastMove) API ───────────────────────────────────────────────

/**
 * 計算 WM SHA-1 簽章：SHA1( merchantId + deptId + email + prodListStr + token )
 */
function calcWmSign(merchantId, deptId, email, prodListStr, token) {
  const raw = merchantId + deptId + email + prodListStr + token;
  return crypto.createHash('sha1').update(raw).digest('hex');
}

/**
 * 向世界移動下單，取得兌換碼（世界移動直接寄信給客戶）
 * @param {object} order
 * @returns {Promise<string>} - 10 碼兌換碼或啟用連結
 */
async function dispatchWm(order) {
  const baseUrl    = process.env.WM_BASE_URL;
  const merchantId = process.env.WM_MERCHANT_ID;
  const deptId     = process.env.WM_DEPT_ID;
  const email      = process.env.WM_EMAIL;
  const token      = process.env.WM_TOKEN;

  if (!baseUrl || !merchantId || !deptId || !email || !token) {
    throw new Error('WM 環境變數不完整');
  }

  // prodListStr 格式：productCode:qty（請依 WM 實際格式確認）
  const prodListStr = `${order.vendor_code}:1`;
  const sign        = calcWmSign(merchantId, deptId, email, prodListStr, token);

  const payload = {
    merchantId,
    deptId,
    email,
    prodList:   [{ prodCode: order.vendor_code, qty: 1 }],
    prodListStr,
    sign,
    orderRef:   order.order_id,
    // 若 WM 支援直接寄信給消費者，可傳 consumerEmail
    consumerEmail: order.customer_email || '',
  };

  const result = await httpPost(`${baseUrl}/Api/SOrder/mybuyesim`, payload);

  // WM 回傳格式（請依實際 API 文件確認）：
  //   { code: '00', data: { redeemCode: 'ABCD123456' } }
  if (result.code !== '00' && result.code !== 0) {
    throw new Error(`WM API 回應錯誤: code=${result.code} msg=${result.message || result.msg}`);
  }

  // 世界移動回傳兌換碼（10碼英數），也可能是啟用連結
  const redeemCode = result?.data?.redeemCode || result?.data?.activation_url;
  if (!redeemCode) throw new Error('WM API 未回傳 redeemCode');

  return redeemCode;
}

// ── 主發貨流程 ────────────────────────────────────────────────────────────────
const MAX_RETRY = 3;

/**
 * 處理單筆 pending 訂單：叫貨 → 更新 Supabase
 * @param {object} order - Supabase 訂單資料列
 */
async function processPendingOrder(order) {
  console.log(`[dispatch] 處理訂單: ${order.order_id} | vendor=${order.vendor} | code=${order.vendor_code}`);

  let qrCodeData;

  try {
    if (order.vendor === 'DJB') {
      qrCodeData = await dispatchDjb(order);
    } else if (order.vendor === 'WM') {
      qrCodeData = await dispatchWm(order);
    } else {
      throw new Error(`未知廠商: ${order.vendor}`);
    }
  } catch (dispatchErr) {
    // 取得目前失敗次數（存在 metadata 欄位，若無此欄位請在 schema 新增）
    const retryCount = (order.retry_count || 0) + 1;
    const newStatus  = retryCount >= MAX_RETRY ? 'failed' : 'pending';

    console.error(`[dispatch] ❌ 叫貨失敗 (${order.order_id}) #${retryCount}: ${dispatchErr.message}`);

    await supabase
      .from('orders')
      .update({
        status:      newStatus,
        retry_count: retryCount,
        last_error:  dispatchErr.message.substring(0, 200),
      })
      .eq('id', order.id);

    if (newStatus === 'failed') {
      console.error(`[dispatch] ❌ 訂單 ${order.order_id} 已失敗 ${MAX_RETRY} 次，標記為 failed`);
    }
    return;
  }

  // ── 叫貨成功：寫入 qr_code_data，更新狀態為 ready_to_claim ───────────────
  const { error: updateErr } = await supabase
    .from('orders')
    .update({
      qr_code_data: qrCodeData,
      status:       'ready_to_claim',
      retry_count:  0,
      last_error:   null,
    })
    .eq('id', order.id);

  if (updateErr) {
    console.error(`[dispatch] ❌ 更新 Supabase 失敗 (${order.order_id}):`, updateErr.message);
  } else {
    console.log(`[dispatch] ✅ 已備妥: ${order.order_id} → ready_to_claim`);
  }
}

/**
 * 一次完整的 dispatch 循環：掃 pending → 逐筆叫貨
 */
async function runDispatchCycle() {
  console.log(`\n[dispatch] ===== Dispatch 循環開始 ${new Date().toISOString()} =====`);

  try {
    // 撈出所有 pending 且 vendor_code 已有值的訂單（最多 50 筆/次）
    const { data: pendingOrders, error } = await supabase
      .from('orders')
      .select('*')
      .eq('status', 'pending')
      .not('vendor_code', 'is', null)
      .lt('retry_count', MAX_RETRY)   // 未達重試上限
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) {
      console.error('[dispatch] Supabase 查詢失敗:', error.message);
      return;
    }

    if (!pendingOrders || pendingOrders.length === 0) {
      console.log('[dispatch] 無待發貨訂單');
      return;
    }

    console.log(`[dispatch] 找到 ${pendingOrders.length} 筆 pending 訂單，開始逐筆叫貨...`);

    // 循序處理（避免同時打爆廠商 API）
    for (const order of pendingOrders) {
      await processPendingOrder(order);
      // 每筆之間稍微間隔，避免觸發 rate limit
      await new Promise(r => setTimeout(r, 500));
    }

  } catch (err) {
    console.error('[dispatch] ❌ Dispatch 循環嚴重錯誤:', err.message);
  }

  console.log(`[dispatch] ===== Dispatch 循環結束 =====\n`);
}

// ── Cron 排程：每 3 分鐘執行一次 ────────────────────────────────────────────
function startDispatchScheduler() {
  console.log('[dispatch] 啟動 Dispatch Worker：每 3 分鐘執行');

  // 啟動後延遲 30 秒再跑第一次（讓 ingest 先寫入資料）
  setTimeout(() => {
    runDispatchCycle();
    cron.schedule('*/3 * * * *', () => {
      runDispatchCycle();
    });
  }, 30 * 1000);
}

module.exports = { startDispatchScheduler, runDispatchCycle };
