/**
 * 檔案：pages/api/claim.js
 * 模組：前台領取 API（Next.js Serverless Function）
 *
 * 【架構切換 — 電子票券即時核銷版】
 *  舊版：查詢 Supabase 已發貨記錄 → 回傳 QR Code
 *  新版：轉發至 GCP Express API → 即時驗證票券 + 發貨 + 核銷 → 回傳 QR Code
 *
 * POST /api/claim
 * Body: { ticketPin: string, email: string }
 *
 * 流程：
 *  1. 驗證 payload
 *  2. 轉發至 GCP Express  POST /api/internal/redeem
 *  3. 透傳 GCP 回傳結果給前台
 *
 * 環境變數（需在 Vercel 設定）：
 *  GCP_REDEEM_URL    - GCP Express 伺服器 URL，例：http://34.xx.xx.xx:3001
 *  GCP_INTERNAL_KEY  - 內部呼叫金鑰（與 GCP .env INTERNAL_API_KEY 一致）
 *  RESEND_API_KEY    - 寄送確認信（選填，目前由 GCP 端處理）
 */

// ── Vercel Serverless Function 逾時設定（最長 60 秒）────────────────────────
export const config = {
  api: {
    responseLimit:  false,
    bodyParser:     { sizeLimit: '1mb' },
  },
  maxDuration: 60,  // 秒（Vercel Pro/Team plan 支援）
};

// ── API Handler ────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // 僅接受 POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '不支援此 HTTP Method' });
  }

  const { orderNo, email } = req.body || {};

  // ── 1. 基本驗證 ──────────────────────────────────────────────────────────
  if (!orderNo || orderNo.trim().length === 0) {
    return res.status(400).json({ error: '請輸入 MOMO 訂單編號' });
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: '請輸入有效的 Email' });
  }

  // ── 2. 確認 GCP 設定 ─────────────────────────────────────────────────────
  const gcpUrl    = process.env.GCP_REDEEM_URL;
  const gcpApiKey = process.env.GCP_INTERNAL_KEY;

  if (!gcpUrl) {
    console.error('[claim] GCP_REDEEM_URL 未設定');
    return res.status(500).json({ error: '伺服器設定錯誤，請聯繫客服' });
  }

  // ── 3. 轉發至 GCP Express API ────────────────────────────────────────────
  let gcpResponse;
  try {
    gcpResponse = await fetch(`${gcpUrl}/api/internal/redeem`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        orderNo:     orderNo.trim(),
        email:       email.trim().toLowerCase(),
        internalKey: gcpApiKey || '',
      }),
      // 注意：Node.js fetch 預設無 timeout；GCP 端有 25s 個別請求逾時
      signal: AbortSignal.timeout(55000),   // 55 秒，保留 5 秒 Vercel 緩衝
    });
  } catch (fetchErr) {
    console.error('[claim] 無法連接 GCP Express:', fetchErr.message);
    if (fetchErr.name === 'TimeoutError' || fetchErr.code === 'UND_ERR_CONNECT_TIMEOUT') {
      return res.status(504).json({ error: 'eSIM 建立逾時，請稍後再試或聯繫客服' });
    }
    return res.status(502).json({ error: '後端服務暫時無法連線，請稍後再試' });
  }

  // ── 4. 透傳 GCP 回傳結果 ─────────────────────────────────────────────────
  let data;
  try {
    data = await gcpResponse.json();
  } catch {
    return res.status(502).json({ error: '後端回傳格式錯誤，請聯繫客服' });
  }

  if (!gcpResponse.ok) {
    // 將 GCP 的錯誤訊息原封不動傳給前台（含特殊 status 欄位，若有的話）
    return res.status(gcpResponse.status).json({
      success: false,
      status:  data.status  || null,
      error:   data.error   || data.message || `處理失敗 (${gcpResponse.status})`,
    });
  }

  // ── 5a. 業務層失敗（HTTP 200 但 success: false）─────────────────────────
  // 例：票券已退款 / 已作廢 → GCP 回傳 { success:false, status:'TICKET_REFUNDED' }
  if (!data.success) {
    console.log(`[claim] GCP 業務層失敗 status=${data.status || 'n/a'} message=${data.message}`);
    return res.status(200).json({
      success: false,
      status:  data.status  || null,
      message: data.message || data.error || '處理失敗，請聯繫客服',
    });
  }

  // ── 5b. 成功：回傳 items 陣列（含 QR Code）────────────────────────────────
  // GCP 後端統一回傳 items[]，前台 normalizeResponse 已相容多件 / 單件格式
  return res.status(200).json({
    success:  true,
    items:    data.items   || null,
    // 保留單件欄位供向下相容（若 GCP 舊版仍回傳單件格式）
    order_id:     data.order_id     || (data.items && data.items[0] && data.items[0].order_id)     || null,
    product_name: data.product_name || (data.items && data.items[0] && data.items[0].product_name) || null,
    vendor:       data.vendor       || (data.items && data.items[0] && data.items[0].vendor)       || null,
    qr_code_data: data.qr_code_data || null,
    message:      data.message || null,
  });
}
