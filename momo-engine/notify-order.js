/**
 * 檔案：notify-order.js
 * 模組：【發信模組 (Notify)】
 * # v1.1.0 | 2026-05-15 | 改用 api.qrserver.com 外部 QR 圖片 URL，移除 CID inline attachment 破圖問題
 * # v1.0.0 | 原始版（CID inline attachment，多數 email client 破圖）
 */

'use strict';

const { Resend } = require('resend');
const fs   = require('fs');
const path = require('path');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_FROM    = process.env.NOTIFY_FROM    || 'SIMAX 發貨中心 <noreply@simax-esim.com>';
const NOTIFY_BCC     = process.env.NOTIFY_BCC     || 'order@simax-esim.com';
const NOTIFY_REPLY_TO = process.env.NOTIFY_REPLY_TO || 'order@simax-esim.com';

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

let TEMPLATE = '';
try { TEMPLATE = fs.readFileSync(path.join(__dirname, 'notify-template.html'), 'utf8'); }
catch (e) { console.warn('[notify] template load failed:', e.message); }

// 從 LPA 字串取最後一段作為啟用碼
function extractActivationCode(lpa) {
  if (!lpa) return '';
  const p = String(lpa).split('$');
  return p[p.length - 1] || '';
}

// 將 LPA 啟用碼轉為 api.qrserver.com 的圖片 URL
// 此方法不依賴本地生成，所有 email client 均可正常顯示
function buildQrImageUrl(qrData) {
  return 'https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=10&data='
    + encodeURIComponent(qrData);
}

function renderTemplate(vars) {
  return TEMPLATE.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
}

function buildText(v) {
  return [
    '【SIMAX】eSIM 兑換成功',
    '',
    '訂單編號：' + v.orderId,
    '商品：'     + v.productName,
    '方案：'     + v.planSpec,
    '天數：'     + v.days,
    '查詢編號：' + v.sourceNumber,
    '',
    'ICCID：'   + v.iccid,
    '啟用碼：'  + v.activationCode,
    'QR / LPA：'+ v.qrCodeData,
    '',
    '一鍵安裝 (iOS 17.4+)：https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=' + encodeURIComponent(v.qrCodeData),
    '',
    '⚠️ QR 僅能掃描一次，請勿刪除已安裝的 eSIM。抵達目的地再開啟並務必開「數據漫遊」。',
    '',
    '如有問題請聯繫 24hr LINE 客服：https://eipstore.net/SIMAXCS',
  ].join('\n');
}

async function sendOrderNotification(payload) {
  if (!resend)                        return { ok: false, error: 'RESEND_API_KEY missing' };
  if (!payload || !payload.customerEmail) return { ok: false, error: 'customerEmail missing' };
  if (!payload.qrCodeData)            return { ok: false, error: 'qrCodeData missing' };
  if (!TEMPLATE)                      return { ok: false, error: 'template missing' };

  const oid = payload.orderId || '';
  const qr  = payload.qrCodeData;
  const ac  = extractActivationCode(qr);

  // ── 用外部 QR 圖片 URL 取代 CID inline attachment ──────────────────────────
  const qrImageUrl = buildQrImageUrl(qr);

  const vars = {
    orderId:        oid,
    productName:    payload.productName  || 'eSIM',
    planSpec:       payload.planSpec     || '',
    days:           payload.days         || '',
    sourceNumber:   payload.sourceNumber || '',
    qrCodeData:     qr,
    iccid:          payload.iccid        || '',
    activationCode: ac,
    qrCodeImage:    qrImageUrl,   // <img src="{{qrCodeImage}}"> 直接使用此 URL
    iosSetupUrl:    'https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=' + encodeURIComponent(qr),
  };

  const html    = renderTemplate(vars);
  const text    = buildText(vars);
  const subject = '【SIMAX】您的 eSIM 兑換成功！訂單編號：' + oid;

  try {
    const r = await resend.emails.send({
      from:    NOTIFY_FROM,
      to:      payload.customerEmail,
      bcc:     NOTIFY_BCC,
      replyTo: NOTIFY_REPLY_TO,
      subject,
      html,
      text,
      // ✅ 不再使用 attachments，改用外部 URL，各 email client 均可正常顯示
    });

    if (r && r.error) {
      console.warn('[notify] ⚠️ ' + oid + ' resend error: ' + JSON.stringify(r.error));
      return { ok: false, error: JSON.stringify(r.error) };
    }

    const id = (r && r.data && r.data.id) || '';
    console.log('[notify] ✅ 兑換信已寄 ' + oid + ' → ' + payload.customerEmail + ' (bcc:' + NOTIFY_BCC + ') id=' + id);
    return { ok: true, id };

  } catch (e) {
    console.warn('[notify] ⚠️ ' + oid + ' exception: ' + e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { sendOrderNotification };
