/**
 * 檔案：pages/api/claim.js
 * 模組：前台領取 API（Next.js Serverless Function）
 *
 * 【架構切換 — 電子票券即時核銷版】
 *  新版：轉發至 GCP Express API → 即時驗證票券 + 發貨 + 核銷 → 回傳 QR Code
 *
 * POST /api/claim
 * Body: { ticketPin: string, email: string }
 *
 * 環境變數（需在 Vercel 設定）：
 *  GCP_REDEEM_URL    - GCP Express 伺服器 URL，例：http://34.172.1.185:3001
 *  GCP_INTERNAL_KEY  - 內部呼叫金鑰
 */

export const config = {
    api: {
          responseLimit: false,
          bodyParser: { sizeLimit: '1mb' },
    },
    maxDuration: 60,
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
          return res.status(405).json({ error: '不支援此 HTTP Method' });
    }

  const { ticketPin, email } = req.body || {};

  if (!ticketPin || ticketPin.trim().length === 0) {
        return res.status(400).json({ error: '請輸入票券序號 (PIN碼)' });
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        return res.status(400).json({ error: '請輸入有效的 Email' });
  }

  const gcpUrl    = process.env.GCP_REDEEM_URL;
    const gcpApiKey = process.env.GCP_INTERNAL_KEY;

  if (!gcpUrl) {
        console.error('[claim] GCP_REDEEM_URL 未設定');
        return res.status(500).json({ error: '伺服器設定錯誤，請聯繫客服' });
  }

  let gcpResponse;
    try {
          gcpResponse = await fetch(gcpUrl + '/api/internal/redeem', {
                  method:  'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                            ticketPin:   ticketPin.trim(),
                            email:       email.trim().toLowerCase(),
                            internalKey: gcpApiKey || '',
                  }),
                  signal: AbortSignal.timeout(55000),
          });
    } catch (fetchErr) {
          console.error('[claim] 無法連接 GCP Express:', fetchErr.message);
          if (fetchErr.name === 'TimeoutError') {
                  return res.status(504).json({ error: 'eSIM 建立逾時，請稍後再試或聯繫客服' });
          }
          return res.status(502).json({ error: '後端服務暫時無法連線，請稍後再試' });
    }

  let data;
    try {
          data = await gcpResponse.json();
    } catch {
          return res.status(502).json({ error: '後端回傳格式錯誤，請聯繫客服' });
    }

  if (!gcpResponse.ok) {
        return res.status(gcpResponse.status).json({
                error: data.error || data.message || '處理失敗 (' + gcpResponse.status + ')',
        });
  }

  return res.status(200).json({
        success:      true,
        order_id:     data.order_id,
        product_name: data.product_name,
        vendor:       data.vendor,
        qr_code_data: data.qr_code_data,
        message:      data.message || null,
  });
}
