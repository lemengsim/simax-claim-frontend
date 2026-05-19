/**
 * 檔案：pages/api/resend-notify.js
 * 模組：重發通知信 API（Next.js Serverless Function）
 *
 * # v1.0.0 | 2026-05-15 | 新增：Step 3「重發確認信件」按鈕觸發此端點
 *
 * POST /api/resend-notify
 * Body: { orderId: string, email: string }
 *
 * 流程：轉發至 GCP Express POST /api/internal/resend-notify
 *       GCP 從 Supabase 查訂單資料 → 呼叫 sendOrderNotification 重寄信
 */

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
  maxDuration: 30,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '不支援此 HTTP Method' });
  }

  const { orderId, email } = req.body || {};

  if (!orderId || !email) {
    return res.status(400).json({ error: 'orderId 與 email 為必填' });
  }

  const gcpUrl    = process.env.GCP_REDEEM_URL;
  const gcpApiKey = process.env.GCP_INTERNAL_KEY;

  if (!gcpUrl) {
    return res.status(500).json({ error: '伺服器設定錯誤' });
  }

  try {
    const gcpRes = await fetch(`${gcpUrl}/api/internal/resend-notify`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ orderId, email, internalKey: gcpApiKey || '' }),
      signal:  AbortSignal.timeout(25000),
    });

    const data = await gcpRes.json().catch(() => ({}));
    return res.status(gcpRes.status).json(data);

  } catch (err) {
    if (err.name === 'TimeoutError') {
      return res.status(504).json({ error: '請求逾時，請稍後再試' });
    }
    return res.status(502).json({ error: '後端服務暫時無法連線' });
  }
}
