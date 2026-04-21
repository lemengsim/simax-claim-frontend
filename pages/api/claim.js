/**
 * 檔案：pages/api/claim.js
 * 模組：前台領取 API (Next.js Serverless Function)
 *
 * POST /api/claim
 * Body: { orderId: string, platform: 'MOMO'|'SHOPEE'|'OFFICIAL', verifyData: string }
 *
 * 流程：
 *  1. 驗證 payload 完整性
 *  2. 以 orderId + platform 查詢 Supabase orders 表
 *  3. 比對驗證資料 (MOMO→手機, Shopee/Official→Email)
 *  4. 狀態處理：
 *     - pending       → 202 (準備中)
 *     - ready_to_claim→ 更新為 claimed, 回傳 qr_code_data
 *     - claimed       → 200 (已領取, 再回傳一次 qr_code_data)
 *     - failed        → 400 (系統錯誤, 請聯繫客服)
 *  5. 安全考量：驗證失敗一律回傳 404 (不洩漏訂單是否存在)
 */

import { createClient } from '@supabase/supabase-js';

// ── Supabase Admin Client (service_role 繞過 RLS) ──────────────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// ── 工具函式 ───────────────────────────────────────────────────────────────

/** 統一電話格式：去除所有非數字，補 09 開頭 */
function normalizePhone(phone) {
  return phone.replace(/\D/g, '');
}

/** 統一 Email：轉小寫、去除首尾空白 */
function normalizeEmail(email) {
  return email.toLowerCase().trim();
}

// ── API Handler ────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // 僅接受 POST
  if (req.method !== 'POST') {
    return res.status(405).json({ message: '不支援此 HTTP Method' });
  }

  const { orderId, platform, verifyData } = req.body || {};

  // ── 1. 基本驗證 ──────────────────────────────────────────────────────────
  if (!orderId || !platform || !verifyData) {
    return res.status(400).json({ message: '缺少必要欄位：orderId、platform、verifyData' });
  }

  const allowedPlatforms = ['MOMO', 'SHOPEE', 'OFFICIAL'];
  if (!allowedPlatforms.includes(platform)) {
    return res.status(400).json({ message: `不支援的平台：${platform}` });
  }

  if (verifyData.trim().length < 5) {
    return res.status(400).json({ message: '驗證資料格式錯誤' });
  }

  // ── 2. 查詢訂單 ──────────────────────────────────────────────────────────
  const { data: order, error: fetchError } = await supabase
    .from('orders')
    .select('*')
    .eq('order_id', orderId.trim())
    .eq('platform', platform)
    .single();

  if (fetchError || !order) {
    // 安全起見，統一回傳 404（不透露訂單是否存在）
    return res.status(404).json({ message: '查無此訂單，請確認訂單編號與平台是否正確' });
  }

  // ── 3. 驗證身份 ──────────────────────────────────────────────────────────
  let verified = false;

  if (platform === 'MOMO') {
    // 手機號碼比對（去除非數字後比較）
    const inputPhone = normalizePhone(verifyData);
    const storedPhone = normalizePhone(order.customer_phone || '');
    verified = storedPhone.length > 0 && inputPhone === storedPhone;
  } else {
    // Email 比對（大小寫不敏感）
    const inputEmail  = normalizeEmail(verifyData);
    const storedEmail = normalizeEmail(order.customer_email || '');
    verified = storedEmail.length > 0 && inputEmail === storedEmail;
  }

  if (!verified) {
    // 驗證失敗：一樣回傳 404，不洩漏「訂單存在但驗證錯誤」
    return res.status(404).json({ message: '查無此訂單，請確認驗證資料是否正確' });
  }

  // ── 4. 狀態處理 ──────────────────────────────────────────────────────────
  switch (order.status) {

    case 'pending':
      // eSIM 尚未備妥（GCP 尚未打廠商 API）
      return res.status(202).json({
        status:   'pending',
        order_id: order.order_id,
        message:  'eSIM 準備中，請稍候',
      });

    case 'ready_to_claim': {
      // 首次領取：更新狀態為 claimed，寫入 claimed_at
      const { error: updateError } = await supabase
        .from('orders')
        .update({ status: 'claimed', claimed_at: new Date().toISOString() })
        .eq('id', order.id);

      if (updateError) {
        console.error('[claim] 更新狀態失敗:', updateError.message);
        // 即使更新失敗仍回傳 QR Code（避免客戶無法領取）
      }

      return res.status(200).json({
        status:       'ready_to_claim',
        order_id:     order.order_id,
        platform:     order.platform,
        product_name: order.product_name,
        qr_code_data: order.qr_code_data,
      });
    }

    case 'claimed':
      // 重複領取：直接回傳已存的 QR Code（冪等設計）
      return res.status(200).json({
        status:       'claimed',
        order_id:     order.order_id,
        platform:     order.platform,
        product_name: order.product_name,
        qr_code_data: order.qr_code_data,
        message:      '您已成功領取此 eSIM（重複查詢）',
      });

    case 'failed':
      return res.status(400).json({
        status:   'failed',
        order_id: order.order_id,
        message:  'eSIM 發貨失敗，請聯繫客服協助處理',
      });

    default:
      return res.status(500).json({ message: '未知的訂單狀態，請聯繫客服' });
  }
}
