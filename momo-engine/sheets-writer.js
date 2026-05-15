/**
 * 檔案：sheets-writer.js
 * 模組：【日誌模組 (Logger)】Google Sheets 統一寫入層（Primary + Fallback）
 *
 * 【設計目標】
 *  所有對「自助領取紀錄」分頁的寫入都經過這裡，提供三個動作：
 *    - appendRow(row)                       → 永遠新增一行（即時核銷用）
 *    - upsertByTicketPin({ ticketPin, ...}) → 先查再寫：存在則只更新 O 欄，否則 append
 *    - updateStatus(ticketPin, status)      → 僅更新既有列的 O 欄（找不到就 noop）
 *
 *  每個動作都有「雙通道自動 fallback」：
 *    Primary  : Google Sheets API（googleapis + OAuth 或 ADC）
 *    Fallback : Apps Script Webhook（POST JSON，支援 action 分流）
 *
 *  若 Primary 失敗（例如 GOOGLE_REFRESH_TOKEN 已過期 / invalid_grant），
 *  會自動走 Fallback，確保日誌不中斷；兩邊都失敗才會 throw。
 *
 * 【Sheets 分頁欄位對應】
 *  A: 訂單時間   B: 時間戳記   C: 平台        D: 訂單編號   E: 票券PIN
 *  F: 客戶Email  G: 商品名稱   H: 規格        I: 數量       J: 售價
 *  K: 廠商代碼   L: 廠商品名   M: 廠商規格    N: 廠商成本   O: QR Code/狀態
 *
 *  【重要】upsert / updateStatus 的「主鍵」= E 欄（票券 PIN = 完整子訂單號，每張卡唯一）
 *          D 欄（訂單編號）= MOMO 訂單基號（多件共用，消費者輸入端）— 非主鍵
 *          狀態欄 = O 欄
 *
 * 【環境變數】
 *  GOOGLE_SHEET_ID          - 試算表 ID（選填，有預設值）
 *  GOOGLE_CLIENT_ID         - OAuth 用戶端 ID（Primary 路徑）
 *  GOOGLE_CLIENT_SECRET     - OAuth 用戶端 Secret
 *  GOOGLE_REFRESH_TOKEN     - OAuth refresh token（過期時 Primary 自動 fallback）
 *  SHEETS_WEBHOOK_URL       - Apps Script Webhook URL（Fallback 路徑，必填）
 */

'use strict';

const { google } = require('googleapis');

// ── 常數 ──────────────────────────────────────────────────────────────────────
const SHEET_ID = process.env.GOOGLE_SHEET_ID
  || '1foLTvkiN7gLtxDrFXFOoLviloop2qYduTGG_LpK8glQ';
const SHEET_TAB = '自助領取紀錄';
const STATUS_COLUMN_INDEX     = 15; // O 欄（1-indexed）
const TICKET_PIN_COLUMN_INDEX = 5;  // E 欄（1-indexed）— 票券 PIN 為 upsert 主鍵

const WEBHOOK_URL = process.env.SHEETS_WEBHOOK_URL
  || 'https://script.google.com/macros/s/AKfycbw9k6vbARFTlzbYBDjgTB8vvo4M9e_AUowVuF9_iLlrMnzX3YCLwzCgRxIsQS6ndZ0/exec';

const REQUEST_TIMEOUT_MS = 15000;

// ── Sheets API Client（Primary 路徑） ────────────────────────────────────────
let _cachedSheetsClient = null;

async function getSheetsClient() {
  if (_cachedSheetsClient) return _cachedSheetsClient;
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_REFRESH_TOKEN) {
    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      'urn:ietf:wg:oauth:2.0:oob'
    );
    oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    _cachedSheetsClient = google.sheets({ version: 'v4', auth: oauth2 });
    return _cachedSheetsClient;
  }
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  _cachedSheetsClient = google.sheets({ version: 'v4', auth });
  return _cachedSheetsClient;
}

// ── Webhook Client（Fallback 路徑） ──────────────────────────────────────────
async function postWebhook(payload) {
  const resp = await fetch(WEBHOOK_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
    signal:  AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await resp.text();
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`Webhook 回傳非 JSON: ${text.substring(0, 200)}`); }
  if (!json.ok) throw new Error(`Webhook 失敗: ${json.error || '未知錯誤'}`);
  return json;
}

// ── 內部：Sheets API 實作 ─────────────────────────────────────────────────────
async function _apiAppendRow(row) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId:    SHEET_ID,
    range:            `${SHEET_TAB}!A:O`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody:      { values: [row] },
  });
}

/**
 * 以票券 PIN（E 欄）查找列號；找不到回傳 -1
 */
async function _apiFindRowByTicketPin(ticketPin) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range:         `${SHEET_TAB}!E:E`,
  });
  const rows = res.data.values || [];
  for (let i = 1; i < rows.length; i++) { // 跳過標題列
    if ((rows[i][0] || '').trim() === String(ticketPin).trim()) {
      return i + 1; // Sheets 為 1-indexed
    }
  }
  return -1;
}

async function _apiUpdateStatus(rowNum, status) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId:    SHEET_ID,
    range:            `${SHEET_TAB}!O${rowNum}`,
    valueInputOption: 'USER_ENTERED',
    requestBody:      { values: [[status]] },
  });
}

// ── 公開 API 1：永遠 append ────────────────────────────────────────────────────
/**
 * 直接 append 一行（即時核銷用）
 * @param {Array} row 15 欄陣列，依 A..O 順序
 */
async function appendRow(row) {
  if (!Array.isArray(row) || row.length !== 17) {
    throw new Error(`appendRow: row 需為 17 欄陣列，實為 ${row && row.length}`);
  }
  try {
    await _apiAppendRow(row);
    console.log('[sheets] ✅ append 成功（Primary / Sheets API）');
    return { ok: true, path: 'api', action: 'appended' };
  } catch (err) {
    console.warn(`[sheets] ⚠️ Sheets API append 失敗，fallback：${err.message}`);
  }
  try {
    await postWebhook({ action: 'append', row });
    console.log('[sheets] ✅ append 成功（Fallback / Webhook）');
    return { ok: true, path: 'webhook', action: 'appended' };
  } catch (webhookErr) {
    console.error(`[sheets] ❌ append 兩條路徑都失敗：${webhookErr.message}`);
    throw new Error(`sheets.appendRow 全失敗：${webhookErr.message}`);
  }
}

// ── 公開 API 2：以票券 PIN upsert ─────────────────────────────────────────────
/**
 * 先以票券 PIN（E 欄）查找；存在則只更新 O 欄狀態，不存在則 append 整行
 *
 * @param {object} opts
 * @param {string} opts.ticketPin     必填，E 欄主鍵（完整子訂單號）
 * @param {string} opts.status        必填，O 欄狀態文字
 * @param {Array}  opts.rowIfAppend   選填，若不存在要 append 的完整 15 欄資料
 */
async function upsertByTicketPin({ ticketPin, status, rowIfAppend }) {
  if (!ticketPin) throw new Error('upsertByTicketPin: ticketPin 必填');
  if (!status)    throw new Error('upsertByTicketPin: status 必填');

  // Primary
  try {
    const rowNum = await _apiFindRowByTicketPin(ticketPin);
    if (rowNum > 0) {
      await _apiUpdateStatus(rowNum, status);
      console.log(`[sheets] ✅ upsert=update row=${rowNum} pin=${ticketPin} status=${status}（Primary）`);
      return { ok: true, path: 'api', action: 'updated', row: rowNum };
    }
    if (rowIfAppend) {
      const row = rowIfAppend.slice();
      row[14] = status;
      await _apiAppendRow(row);
      console.log(`[sheets] ✅ upsert=append pin=${ticketPin} status=${status}（Primary）`);
      return { ok: true, path: 'api', action: 'appended' };
    }
    console.log(`[sheets] upsert noop：pin=${ticketPin} 不存在且未提供 rowIfAppend`);
    return { ok: true, path: 'api', action: 'noop' };
  } catch (err) {
    console.warn(`[sheets] ⚠️ Sheets API upsert 失敗，fallback：${err.message}`);
  }

  // Fallback
  try {
    const payload = {
      action:      'upsert',
      ticketPin:   String(ticketPin),
      statusValue: status,
    };
    if (rowIfAppend) {
      const row = rowIfAppend.slice();
      row[14] = status;
      payload.row = row;
    }
    const resp = await postWebhook(payload);
    console.log(`[sheets] ✅ upsert 成功（Fallback / Webhook）action=${resp.action}`);
    return { ok: true, path: 'webhook', action: resp.action || 'unknown' };
  } catch (webhookErr) {
    console.error(`[sheets] ❌ upsert 兩條路徑都失敗：${webhookErr.message}`);
    throw new Error(`sheets.upsertByTicketPin 全失敗：${webhookErr.message}`);
  }
}

// ── 公開 API 3：updateStatus ──────────────────────────────────────────────────
/**
 * 只更新既有列的 O 欄，找不到就 noop
 * @param {string} ticketPin
 * @param {string} status
 */
async function updateStatus(ticketPin, status) {
  if (!ticketPin) throw new Error('updateStatus: ticketPin 必填');
  if (!status)    throw new Error('updateStatus: status 必填');

  try {
    const rowNum = await _apiFindRowByTicketPin(ticketPin);
    if (rowNum < 0) {
      console.log(`[sheets] updateStatus noop：pin=${ticketPin} 不存在`);
      return { ok: true, path: 'api', action: 'noop' };
    }
    await _apiUpdateStatus(rowNum, status);
    console.log(`[sheets] ✅ updateStatus row=${rowNum} pin=${ticketPin} status=${status}（Primary）`);
    return { ok: true, path: 'api', action: 'updated', row: rowNum };
  } catch (err) {
    console.warn(`[sheets] ⚠️ Sheets API updateStatus 失敗，fallback：${err.message}`);
  }

  try {
    const resp = await postWebhook({
      action:      'updateStatus',
      ticketPin:   String(ticketPin),
      statusValue: status,
    });
    console.log(`[sheets] ✅ updateStatus 成功（Fallback）action=${resp.action}`);
    return { ok: true, path: 'webhook', action: resp.action || 'unknown' };
  } catch (webhookErr) {
    console.error(`[sheets] ❌ updateStatus 兩條路徑都失敗：${webhookErr.message}`);
    throw new Error(`sheets.updateStatus 全失敗：${webhookErr.message}`);
  }
}

// ── 公開 API 4：replaceByTicketPin（找到就整列覆蓋，找不到就 append）──────────
/**
 * 以票券 PIN 查找 → 找到就用新 row 覆蓋整列 A-O；找不到就 append。
 * 用於：即時核銷時把 reconciler 預先建的「未領取」列升級成「已出票」含 email + QR + 售價。
 *
 * @param {object} opts
 * @param {string} opts.ticketPin  必填，E 欄主鍵
 * @param {Array}  opts.row        必填，15 欄完整列資料
 */
async function replaceByTicketPin({ ticketPin, row }) {
  if (!ticketPin) throw new Error('replaceByTicketPin: ticketPin 必填');
  if (!Array.isArray(row) || row.length !== 17) {
    throw new Error(`replaceByTicketPin: row 需為 17 欄陣列，實為 ${row && row.length}`);
  }

  // Primary：Sheets API
  try {
    const rowNum = await _apiFindRowByTicketPin(ticketPin);
    if (rowNum > 0) {
      const sheets = await getSheetsClient();
      await sheets.spreadsheets.values.update({
        spreadsheetId:    SHEET_ID,
        range:            `${SHEET_TAB}!A${rowNum}:Q${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody:      { values: [row] },
      });
      console.log(`[sheets] ✅ replace row=${rowNum} pin=${ticketPin}（Primary）`);
      return { ok: true, path: 'api', action: 'replaced', row: rowNum };
    }
    await _apiAppendRow(row);
    console.log(`[sheets] ✅ replace=append pin=${ticketPin}（Primary）`);
    return { ok: true, path: 'api', action: 'appended' };
  } catch (err) {
    console.warn(`[sheets] ⚠️ Sheets API replace 失敗，fallback：${err.message}`);
  }

  // Fallback：Webhook
  try {
    const resp = await postWebhook({
      action:    'replaceRow',
      ticketPin: String(ticketPin),
      row,
    });
    console.log(`[sheets] ✅ replace 成功（Fallback / Webhook）action=${resp.action}`);
    return { ok: true, path: 'webhook', action: resp.action || 'unknown' };
  } catch (webhookErr) {
    console.error(`[sheets] ❌ replace 兩條路徑都失敗：${webhookErr.message}`);
    throw new Error(`sheets.replaceByTicketPin 全失敗：${webhookErr.message}`);
  }
}

// ── 公開 API 5：markRefundByBase（強制把基號下所有票券標為已退貨）──────────
/**
 * 依基號掃 E 欄，把所有匹配 rows（E === base 或 E 以 base+'-' 開頭）的 O 欄設為「已退貨」。
 * 用於：MOMO recoverCompanyQuery API 尚未返回時，管理員手動旗標。
 * 目前僅走 Webhook（Apps Script 內掃描整欄效率高於 Sheets API 多次 call）。
 *
 * @param {string} baseOrderNo  訂單基號（14 碼）
 */
async function markRefundByBase(baseOrderNo) {
  if (!baseOrderNo) throw new Error('markRefundByBase: baseOrderNo 必填');
  try {
    const resp = await postWebhook({
      action:      'markRefundByBase',
      baseOrderNo: String(baseOrderNo),
    });
    console.log(`[sheets] ✅ markRefundByBase base=${baseOrderNo} updated=${resp.updated}`);
    return { ok: true, path: 'webhook', updated: resp.updated || 0, base: baseOrderNo };
  } catch (err) {
    console.error(`[sheets] ❌ markRefundByBase 失敗: ${err.message}`);
    throw new Error(`sheets.markRefundByBase: ${err.message}`);
  }
}

module.exports = {
  appendRow,
  upsertByTicketPin,
  updateStatus,
  replaceByTicketPin,
  markRefundByBase,
  SHEET_ID,
  SHEET_TAB,
  STATUS_COLUMN_INDEX,
  TICKET_PIN_COLUMN_INDEX,
};
