/**
 * 檔案：pages/api/verify.js
 * 模組：訂單驗證 API（Next.js Serverless Function）
 *
 * # v1.0.0 | 2026-05-14 | 新增：Multi-PIN 流程第一步，驗證訂單取得 qty
 *
 * POST /api/verify
 * Body: { orderNo: string, email: string }
 *
 * 流程：
 *  1. 驗證 payload
 *  2. 轉發至 GCP Express  POST /api/internal/verify
 *  3. 回傳 { qty, goodsName } 供前端顯示對應數量的票券輸入框
 */

export const config = {
  api: {
    bodyParser: { sizeLimit: '1mb' },
  },
  maxDuration: 30,
};

export default async function handler(req, res) {
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

  const gcpUrl    = process.env.GCP_REDEEM_URL;
  const gcpApiKey = process.env.GCP_INTERNAL_KEY;

  if (!gcpUrl) {
    return res.status(500).json({ error: '伺服器設定錯誤，請聯繫客服' });
  }

  // ── 2. 轉發至 GCP Express /api/internal/verify ─────────────────────────
  let gcpResponse;
  try {
    gcpResponse = await fetch(`${gcpUrl}/api/internal/verify`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        orderNo:     orderNo.trim(),
        email:       email.trim().toLowerCase(),
        internalKey: gcpApiKey || '',
      }),
      signal: AbortSignal.timeout(25000),
    });
  } catch (fetchErr) {
    if (fetchErr.name === 'TimeoutError') {
      return res.status(504).json({ error: '驗證逾時，請稍後再試' });
    }
    return res.status(502).json({ error: '後端服務暫時無法連線，請稍後再試' });
  }

  // ── 3. 回傳結果 ──────────────────────────────────────────────────────────
  let data;
  try {
    data = await gcpResponse.json();
  } catch {
    return res.status(502).json({ error: '後端回傳格式錯誤，請聯繫客服' });
  }

  return res.status(gcpResponse.status).json(data);
}
