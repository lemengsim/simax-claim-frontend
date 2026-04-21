/**
 * 檔案：momo-ingest.js
 * 模組：【進件模組 (Ingestion) — MOMO 端】
 *
 * 負責：
 *  1. 每 5 分鐘 (node-cron) 主動打 MOMO SCM API 撈取未出貨訂單
 *  2. AES-128-ECB 解密 dataList（密鑰 = 密碼補 0 至 16 位數）
 *  3. 呼叫大腦模組比對廠商代碼
 *  4. 使用 service_role key 寫入 Supabase orders（UPSERT，避免重複）
 *
 * 環境變數（需在 GCP 主機的 .env 設定）：
 *  MOMO_ENTP_CODE       - 廠商編號 (6碼)，例如 001005
 *  MOMO_ENTP_ID         - 統一編號 (8碼)，例如 12345678
 *  MOMO_ENTP_PWD        - SCM 主帳號密碼（同時作為 AES 金鑰來源）
 *  MOMO_OTP_BACK_NO     - momoOTP 序號後 3 碼（SCM C1209 查詢）
 *  SUPABASE_URL         - Supabase Project URL
 *  SUPABASE_SERVICE_KEY - Supabase service_role key（繞過 RLS）
 */

'use strict';

const https         = require('https');
const crypto        = require('crypto');
const cron          = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const { mapProductToVendor } = require('./core-mapper');

// ── 環境變數讀取 ────────────────────────────────────────────────────────────
const MOMO_ENTP_CODE   = process.env.MOMO_ENTP_CODE;
const MOMO_ENTP_ID     = process.env.MOMO_ENTP_ID;
const MOMO_ENTP_PWD    = process.env.MOMO_ENTP_PWD;
const MOMO_OTP_BACK_NO = process.env.MOMO_OTP_BACK_NO;
const MOMO_API_URL     = 'https://scmapi.momoshop.com.tw/OrderServlet.do';

// Supabase Admin Client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

// ── AES-128-ECB 解密 ────────────────────────────────────────────────────────

/**
 * 解密 MOMO SCM API 回傳的 dataList
 * @param {string} encryptedBase64 - dataList 原始加密字串（Base64）
 * @param {string} rawPassword     - SCM 主帳號密碼（明文）
 * @returns {Array<object>}        - 解密後的訂單 JSON 陣列
 */
function decryptMomoData(encryptedBase64, rawPassword) {
  // 1. 密碼補 0 至 16 位數（非常關鍵：不足補 0，超過取前 16 位）
  const aesKey    = rawPassword.padEnd(16, '0').substring(0, 16);
  const keyBuffer = Buffer.from(aesKey, 'utf8');

  // 2. Base64 Decode → AES-128-ECB 解密（PKCS5Padding 對應 Node.js 的 auto-padding）
  const decipher  = crypto.createDecipheriv('aes-128-ecb', keyBuffer, '');
  let decrypted   = decipher.update(encryptedBase64, 'base64', 'utf8');
  decrypted      += decipher.final('utf8');

  // 3. 轉為 JSON 陣列（MOMO 解密後為訂單物件陣列）
  return JSON.parse(decrypted);
}

// ── MOMO SCM API 呼叫 ───────────────────────────────────────────────────────

/**
 * 取得今天到前兩個月的日期區間（MOMO 格式 YYYY/MM/DD）
 * MOMO 限制最大查詢區間為兩個月
 */
function getQueryDateRange() {
  const today   = new Date();
  const fromDay = new Date(today);
  fromDay.setDate(today.getDate() - 60); // 往前 60 天

  const fmt = (d) =>
    `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;

  return { from: fmt(fromDay), to: fmt(today) };
}

/**
 * 呼叫 MOMO SCM unsendCompanyQuery API，回傳加密的 dataList 字串
 * @returns {Promise<string|null>} - 加密的 Base64 字串，或 null（無資料）
 */
async function fetchMomoOrders() {
  const { from, to } = getQueryDateRange();

  const payload = JSON.stringify({
    doAction:  'unsendCompanyQuery',
    loginInfo: {
      entpCode:  MOMO_ENTP_CODE,
      entpID:    MOMO_ENTP_ID,
      entpPwd:   MOMO_ENTP_PWD,
      otpBackNo: MOMO_OTP_BACK_NO,
    },
    sendInfo: {
      company_fr_dd: from,
      company_fr_hh: '00',
      company_fr_mm: '00',
      company_to_dd: to,
      company_to_hh: '23',
      company_to_mm: '59',
      company_receiver:              '',
      company_goodsCode:             '',
      company_orderNo:               '',
      company_entpGoodsNo:           '',
      company_orderGb:               '',
      company_recycleLargeMachineType: '',
      company_ChangeAddressAll:      '',
    },
  });

  return new Promise((resolve, reject) => {
    const urlObj = new URL(MOMO_API_URL);
    const options = {
      hostname: urlObj.hostname,
      path:     urlObj.pathname,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          // MOMO 回應格式：{ rtnCode: '0000', rtnMsg: 'success', dataList: '加密字串' }
          if (json.rtnCode !== '0000' && json.rtnCode !== '00') {
            console.warn(`[momo-ingest] MOMO API 回應異常 rtnCode=${json.rtnCode} msg=${json.rtnMsg}`);
            return resolve(null);
          }
          resolve(json.dataList || null);
        } catch (err) {
          reject(new Error(`MOMO API 回應解析失敗: ${err.message}\nRaw: ${body.substring(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('MOMO API 請求逾時 (30s)'));
    });
    req.write(payload);
    req.end();
  });
}

// ── 訂單欄位映射 ─────────────────────────────────────────────────────────────
/**
 * 將 MOMO 解密後的單一訂單物件，映射為 Supabase orders 表欄位
 *
 * MOMO SCM 解密後的常見欄位（請依實際 API 文件 PDF p.387 確認）：
 *  orderNo         → order_id
 *  goodsName       → product_name（商品名稱，用於字典比對）
 *  receiverTelNo   → customer_phone（收件人電話）
 *  receiverEmail   → customer_email（收件人 Email，若有的話）
 *
 * 📌 實際欄位名稱請在拿到真實解密結果後對照調整！
 */
function mapOrderFields(momoOrder) {
  return {
    // ── 必填欄位 ──────────────────────────────────────────────
    order_id:       String(momoOrder.orderNo        || momoOrder.company_orderNo || '').trim(),
    platform:       'MOMO',
    product_name:   String(momoOrder.goodsName      || momoOrder.entpGoodsName   || '').trim(),
    // ── 客戶資訊 ──────────────────────────────────────────────
    customer_phone: String(momoOrder.receiverTelNo  || momoOrder.receiver_phone  || '').replace(/\D/g, ''),
    customer_email: String(momoOrder.receiverEmail  || momoOrder.receiver_email  || '').toLowerCase().trim() || null,
    // ── 初始狀態 ──────────────────────────────────────────────
    status:         'pending',
    qr_code_data:   null,
    vendor_code:    null,
    vendor:         null,
  };
}

// ── 主邏輯：一次完整的撈單 → 解密 → 比對 → 寫入循環 ─────────────────────────

async function runIngestCycle() {
  console.log(`\n[momo-ingest] ===== 撈單開始 ${new Date().toISOString()} =====`);

  // ── 1. 驗證環境變數 ────────────────────────────────────────────────────────
  if (!MOMO_ENTP_CODE || !MOMO_ENTP_ID || !MOMO_ENTP_PWD || !MOMO_OTP_BACK_NO) {
    console.error('[momo-ingest] ❌ MOMO 環境變數不完整，跳過本次執行');
    return;
  }

  try {
    // ── 2. 呼叫 MOMO SCM API ──────────────────────────────────────────────
    console.log('[momo-ingest] 呼叫 MOMO SCM API...');
    const encryptedDataList = await fetchMomoOrders();

    if (!encryptedDataList) {
      console.log('[momo-ingest] 無新訂單（dataList 為空），結束本次循環');
      return;
    }

    // ── 3. AES-128-ECB 解密 ───────────────────────────────────────────────
    console.log('[momo-ingest] 開始 AES-128-ECB 解密...');
    const orders = decryptMomoData(encryptedDataList, MOMO_ENTP_PWD);
    console.log(`[momo-ingest] 解密成功，共 ${orders.length} 筆訂單`);

    if (orders.length === 0) {
      console.log('[momo-ingest] 解密後訂單數為 0，結束本次循環');
      return;
    }

    // ── 4. 逐筆處理：字典比對 + 寫入 Supabase ─────────────────────────────
    let inserted = 0;
    let skipped  = 0;
    let failed   = 0;

    for (const momoOrder of orders) {
      try {
        const mapped = mapOrderFields(momoOrder);

        // 訂單號必填，跳過異常資料
        if (!mapped.order_id) {
          console.warn('[momo-ingest] ⚠️ 訂單缺少 orderNo，跳過:', JSON.stringify(momoOrder).substring(0, 100));
          skipped++;
          continue;
        }

        // ── 大腦模組比對 ────────────────────────────────────────────────
        if (mapped.product_name) {
          const matchResult = await mapProductToVendor(mapped.product_name);
          if (matchResult.matched) {
            mapped.vendor      = matchResult.vendor;
            mapped.vendor_code = matchResult.vendorCode;
          } else {
            console.warn(`[momo-ingest] ⚠️ 無法比對廠商代碼: "${mapped.product_name.substring(0, 40)}"`);
            // 仍寫入 Supabase（vendor/vendor_code 為 null），方便人工處理
          }
        }

        // ── UPSERT 寫入 Supabase（以 order_id 為唯一鍵，避免重複） ─────────
        const { error: upsertError } = await supabase
          .from('orders')
          .upsert(mapped, { onConflict: 'order_id', ignoreDuplicates: true });

        if (upsertError) {
          console.error(`[momo-ingest] ❌ Supabase 寫入失敗 (${mapped.order_id}):`, upsertError.message);
          failed++;
        } else {
          console.log(`[momo-ingest] ✅ 寫入成功: ${mapped.order_id} | ${mapped.product_name?.substring(0, 30)} | ${mapped.vendor || '待比對'}`);
          inserted++;
        }

      } catch (orderErr) {
        console.error('[momo-ingest] ❌ 處理單筆訂單異常:', orderErr.message);
        failed++;
      }
    }

    console.log(`[momo-ingest] ===== 本次循環結束：插入 ${inserted}，重複跳過 ${skipped}，失敗 ${failed} =====\n`);

  } catch (err) {
    console.error('[momo-ingest] ❌ 撈單循環發生嚴重錯誤:', err.message);
  }
}

// ── Cron 排程：每 5 分鐘執行一次 ───────────────────────────────────────────
function startIngestScheduler() {
  console.log('[momo-ingest] 啟動撈單排程：每 5 分鐘執行');

  // 立即執行一次（避免等第一個 5 分鐘才跑）
  runIngestCycle();

  // 之後每 5 分鐘觸發（0,5,10,...,55 分的第 0 秒）
  cron.schedule('*/5 * * * *', () => {
    runIngestCycle();
  });
}

module.exports = { startIngestScheduler, runIngestCycle, decryptMomoData };
