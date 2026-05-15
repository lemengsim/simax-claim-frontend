/**
 * 檔案：pages/api/resend-logs.js
 * 模組：補寄紀錄查詢 API（Next.js Serverless Function）
 *
 * # v1.0.0 | 2026-05-15 | 新增：從 VM Supabase 撈取跨裝置補寄紀錄
 *
 * GET /api/resend-logs?limit=50
 *
 * 流程：轉發至 GCP Express GET /api/internal/resend-logs
 *       GCP 從 Supabase resend_logs 撈取最新紀錄回傳
 */

export const config = {
  api: { bodyParser: false },
  maxDuration: 15,
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: '不支援此 HTTP Method' });
  }

  const gcpUrl    = process.env.GCP_REDEEM_URL;
  const gcpApiKey = process.env.GCP_INTERNAL_KEY;

  if (!gcpUrl) {
    return res.status(500).json({ error: '伺服器設定錯誤' });
  }

  const limit = parseInt(req.query.limit || '50', 10);

  try {
    const gcpRes = await fetch(
      `${gcpUrl}/api/internal/resend-logs?limit=${limit}&internalKey=${encodeURIComponent(gcpApiKey || '')}`,
      {
        method:  'GET',
        headers: { 'Content-Type': 'application/json' },
        signal:  AbortSignal.timeout(12000),
      }
    );

    const data = await gcpRes.json().catch(() => ({}));
    return res.status(gcpRes.status).json(data);

  } catch (err) {
    if (err.name === 'TimeoutError') {
      return res.status(504).json({ error: '請求逾時' });
    }
    return res.status(502).json({ error: '後端服務暫時無法連線' });
  }
}
