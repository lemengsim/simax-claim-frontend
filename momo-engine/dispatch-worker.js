/**
 * 檔案：dispatch-worker.js
 * 模組：【發貨模組 (Dispatch)】廠商叫貨引擎
 *
 * 【架構切換說明 — 電子票券即時核銷版】
 *  舊版：每 3 分鐘輪詢 Supabase pending 訂單 → 批量叫貨
 *  新版：由 express-server.js 同步呼叫 dispatchOrder()，即時取得 QR Code
 *
 * 對外介面（唯一 export）：
 *  dispatchOrder({ vendor, vendorCode, vendorDays, customerEmail, orderId })
 *    → Promise<string>  QR Code 內容 (DJB) 或世界移動訂單號 (WM)
 *
 * 環境變數：
 *  DJB_BASE_URL   - DJB API 基礎網址，例：https://api.djbsim.com
 *  DJB_API_IV     - DJB IV（用於 MD5 Checksum 計算）
 *  DJB_API_KEY    - DJB API Key
 *  WM_BASE_URL    - 世界移動 API，例：https://fmshippingsys.fastmove.com.tw
 *  WM_MERCHANT_ID - 世界移動 merchantId
 *  WM_DEPT_ID     - 世界移動 deptId
 *  WM_TOKEN       - 世界移動 SHA-1 簽章用 Token
 */

'use strict';

const https  = require('https');
const http   = require('http');
const crypto = require('crypto');

// ── 工具函式 ─────────────────────────────────────────────────────────────────

/**
 * 通用 HTTP/HTTPS POST（JSON body）
 */
function httpPostJson(url, payload, extraHeaders = {}) {
  const body   = JSON.stringify(payload);
  const urlObj = new URL(url);
  const lib    = urlObj.protocol === 'https:' ? https : http;

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
      res.on('data', c => raw += c);
      res.on('end', () => {
        try   { resolve(JSON.parse(raw)); }
        catch { reject(new Error(`JSON 解析失敗: ${raw.substring(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(); reject(new Error('請求逾時 (25s)')); });
    req.write(body);
    req.end();
  });
}

/**
 * 通用 HTTP/HTTPS POST（application/x-www-form-urlencoded）
 * DJB API 使用此格式
 */
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
    req.setTimeout(25000, () => { req.destroy(); reject(new Error('請求逾時 (25s)')); });
    req.write(body);
    req.end();
  });
}

/** 暫停 ms 毫秒 */
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── DJB API ──────────────────────────────────────────────────────────────────

/**
 * 動態生成 DJB source_number
 * 格式：simax + YYMMDDHHmmss + 3碼亂數 + 1
 */
function generateDjbSourceNumber() {
  const now  = new Date();
  // 以台灣時區 (UTC+8) 計算
  const tw   = new Date(now.getTime() + 8 * 3600 * 1000);
  const yy   = String(tw.getUTCFullYear()).slice(-2);
  const mm   = String(tw.getUTCMonth() + 1).padStart(2, '0');
  const dd   = String(tw.getUTCDate()).padStart(2, '0');
  const hh   = String(tw.getUTCHours()).padStart(2, '0');
  const min  = String(tw.getUTCMinutes()).padStart(2, '0');
  const ss   = String(tw.getUTCSeconds()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `simax${yy}${mm}${dd}${hh}${min}${ss}${rand}1`;
}

/**
 * 計算 DJB Checksum：MD5( Base64( API_IV + YYYYMMDD + source_number ) )
 * 日期使用台灣時區 (UTC+8)
 */
function calcDjbChecksum(apiIv, sourceNo) {
  const now  = new Date();
  const tw   = new Date(now.getTime() + 8 * 3600 * 1000);
  const y    = tw.getUTCFullYear();
  const m    = String(tw.getUTCMonth() + 1).padStart(2, '0');
  const d    = String(tw.getUTCDate()).padStart(2, '0');
  const raw  = apiIv + `${y}${m}${d}` + sourceNo;
  const b64  = Buffer.from(raw, 'utf8').toString('base64');
  return crypto.createHash('md5').update(b64, 'utf8').digest('hex');
}

/**
 * 從 DJB 查詢 API 多層路徑中安全取出 qrcode_content
 */
function extractDjbQrCode(result) {
  return (
    result?.data?.qrcode_content           ||
    result?.data?.data?.qrcode_content     ||
    result?.data?.cards?.[0]?.qrcode_content ||
    result?.qrcode_content                 ||
    null
  );
}

/**
 * 向 DJB 下單並輪詢取得 QR Code
 * @param {{ vendorCode: string, vendorDays: number, orderId: string }} params
 * @returns {Promise<string>} LPA QR Code 內容
 */
async function dispatchDjb({ vendorCode, vendorDays, orderId }) {
  const baseUrl  = process.env.DJB_BASE_URL;
  const apiIv    = process.env.DJB_API_IV;
  const apiKey   = process.env.DJB_API_KEY;

  if (!baseUrl || !apiIv || !apiKey) {
    throw new Error('DJB 環境變數不完整 (DJB_BASE_URL / DJB_API_IV / DJB_API_KEY)');
  }

  const sourceNo = generateDjbSourceNumber();
  const checksum = calcDjbChecksum(apiIv, sourceNo);

  // 台灣時區今日日期 YYYY-MM-DD（DJB date 欄位格式）
  const tw   = new Date(new Date().getTime() + 8 * 3600 * 1000);
  const date = `${tw.getUTCFullYear()}-${String(tw.getUTCMonth() + 1).padStart(2, '0')}-${String(tw.getUTCDate()).padStart(2, '0')}`;

  console.log(`[dispatch-djb] 下單 product_code=${vendorCode} days=${vendorDays} source=${sourceNo}`);

  // ── 1. 下單 ─────────────────────────────────────────────────────────────
  const buyResult = await httpPostForm(`${baseUrl}/api/order/buy`, {
    key:           apiKey,
    date,
    checksum,
    source_number: sourceNo,
    product_code:  vendorCode,
    days:          vendorDays || 1,   // DJB 要求至少 1 天
    quantity:      1,
    name:          'simax-esim',
    email:         'order@simax-esim.com',   // 系統信箱，不用客戶信箱
  });

  // 多重成功判斷（DJB 回傳格式不固定）
  const djbOrderId =
    buyResult?.id                   ||
    buyResult?.data?.id             ||
    buyResult?.data?.channel_sub_order_id ||
    null;

  const isSuccess =
    buyResult?.status === 'received' ||
    buyResult?.success_code === 'SUCCESS' ||
    djbOrderId != null;

  if (!isSuccess) {
    throw new Error(`DJB 下單失敗: ${JSON.stringify(buyResult).substring(0, 200)}`);
  }

  console.log(`[dispatch-djb] 下單成功 djbOrderId=${djbOrderId}`);

  // ── 2. 輪詢取得 QR Code（最多 5 次，每次間隔 3 秒，共 15 秒）───────────
  const queryChecksum = calcDjbChecksum(apiIv, sourceNo);

  for (let attempt = 1; attempt <= 5; attempt++) {
    await sleep(attempt === 1 ? 2000 : 3000);

    const queryResult = await httpPostForm(`${baseUrl}/api/order/info`, {
      key:                    apiKey,
      date,
      checksum:               queryChecksum,
      source_number:          sourceNo,
      channel_sub_order_id:   djbOrderId,
    });

    const qrCode = extractDjbQrCode(queryResult);

    if (qrCode) {
      console.log(`[dispatch-djb] ✅ QR Code 取得成功 (第 ${attempt} 次查詢)`);
      return qrCode;
    }

    console.log(`[dispatch-djb] QR 尚未就緒，第 ${attempt}/5 次查詢...`);
  }

  // 15 秒內未取得：部分地區 DJB 需要更長時間
  // 丟出特殊錯誤讓 Express 回傳「處理中」狀態給前台
  const err = new Error(`DJB QR Code 尚未就緒，訂單已建立 (djbOrderId=${djbOrderId})，請稍後再試`);
  err.code        = 'DJB_QR_PENDING';
  err.djbOrderId  = djbOrderId;
  err.sourceNo    = sourceNo;
  throw err;
}

// ── 世界移動 (WM / FastMove) API ─────────────────────────────────────────────

/**
 * 計算 WM SHA-1 encStr
 * 新格式：SHA1( merchantId + deptId + email + prodListStr + token )
 * prodListStr = wmproductId + qty（直接拼接，無分隔符）
 */
function calcWmEncStr(merchantId, deptId, email, prodListStr, token) {
  const raw = merchantId + deptId + email + prodListStr + token;
  return crypto.createHash('sha1').update(raw, 'utf8').digest('hex').toUpperCase();
}

/**
 * 向世界移動下單
 * 世界移動模式：下單成功後 WM 直接寄兌換碼給客戶 (systemMail: true)
 * 我方回傳 WM 訂單號（wmOrderId），兌換碼由 callback 或延遲查詢補回
 *
 * @param {{ vendorCode: string, customerEmail: string, orderId: string }} params
 * @returns {Promise<string>} WM 訂單號（作為暫時佔位，兌換碼由 WM 寄信給客戶）
 */
async function dispatchWm({ vendorCode, customerEmail, orderId }) {
  const baseUrl    = process.env.WM_BASE_URL;
  const merchantId = process.env.WM_MERCHANT_ID;
  const deptId     = process.env.WM_DEPT_ID;
  const token      = process.env.WM_TOKEN;

  if (!baseUrl || !merchantId || !deptId || !token) {
    throw new Error('WM 環境變數不完整 (WM_BASE_URL / WM_MERCHANT_ID / WM_DEPT_ID / WM_TOKEN)');
  }

  if (!customerEmail) {
    throw new Error('世界移動發貨需要客戶 Email');
  }

  // prodListStr = wmproductId + qty（拼接，無分隔符）
  const prodListStr = `${vendorCode}1`;
  const encStr      = calcWmEncStr(merchantId, deptId, customerEmail, prodListStr, token);

  const payload = {
    merchantId,
    deptId,
    email:      customerEmail,   // WM 將兌換碼寄給此 Email
    prodList:   [{ wmproductId: vendorCode, qty: 1 }],
    systemMail: true,            // 由 WM 直接寄信給客戶
    encStr,
    remark:     `SIMAX-${orderId}`,
  };

  console.log(`[dispatch-wm] 下單 wmproductId=${vendorCode} email=${customerEmail}`);

  const result = await httpPostJson(`${baseUrl}/Api/SOrder/mybuyesim`, payload);

  if (result.code !== 0 && result.code !== '0') {
    throw new Error(`WM API 回應錯誤: code=${result.code} msg=${result.msg || result.message}`);
  }

  const wmOrderId = result.orderId || result.data?.orderId;
  if (!wmOrderId) {
    throw new Error('WM API 未回傳 orderId');
  }

  console.log(`[dispatch-wm] ✅ WM 下單成功 wmOrderId=${wmOrderId}（兌換碼已由 WM 寄至 ${customerEmail}）`);

  // 回傳 WM 訂單號作為 qr_code_data 佔位
  // 前台收到此格式時顯示「兌換碼已由世界移動寄送至您的 Email」
  return `WM_ORDER:${wmOrderId}`;
}

// ── 主發貨介面（統一入口）────────────────────────────────────────────────────

/**
 * 統一發貨入口
 * @param {{
 *   vendor:        'DJB'|'WM',
 *   vendorCode:    string,   // DJB product_code 或 WM wmproductId
 *   vendorDays:    number,   // DJB 需要（天數）；WM 不需要
 *   customerEmail: string,   // 客戶 Email（WM 必填；DJB 非必填）
 *   orderId:       string,   // MOMO 訂單編號或內部 ID（作為備注）
 * }} params
 * @returns {Promise<string>} QR Code 內容 (DJB) 或 WM_ORDER:<orderId> (WM)
 */
async function dispatchOrder({ vendor, vendorCode, vendorDays, customerEmail, orderId }) {
  if (!vendor || !vendorCode) {
    throw new Error('dispatchOrder 缺少必要參數: vendor, vendorCode');
  }

  if (vendor === 'DJB') {
    return dispatchDjb({ vendorCode, vendorDays: vendorDays || 0, orderId });
  }

  if (vendor === 'WM') {
    return dispatchWm({ vendorCode, customerEmail, orderId });
  }

  throw new Error(`未知廠商: ${vendor}`);
}

module.exports = { dispatchOrder };
