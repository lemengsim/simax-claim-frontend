/**
 * 檔案：core-mapper.js
 * 模組：【大腦模組 (Core/Mapping)】產品字典比對引擎
 *
 * 負責：
 *  1. 從 Google Sheets「Plans」分頁載入產品字典（每 30 分鐘快取一次）
 *  2. 對傳入的商品名稱進行多策略比對，回傳最佳廠商代碼
 *
 * Plans 分頁欄位對應（A2:L）：
 *   A(0):  搜尋關鍵字 (keywords)   — 逗號分隔，用於 MOMO 商品名稱比對
 *   B(1):  上架區域                 — 略（不參與比對）
 *   C(2):  上架類別                 — 略（不參與比對）
 *   D(3):  上架名稱 (title)         — 內部顯示名稱
 *   E(4):  廠商一代碼 (DJB code)
 *   F(5):  廠商一品名 (DJB name)    — 自助領取紀錄「商品名稱」欄
 *   G(6):  廠商一規格 (DJB spec)    — 自助領取紀錄「規格」欄
 *   H(7):  廠商一成本 (DJB cost)
 *   I(8):  廠商二代碼 (WM code)
 *   J(9):  廠商二品名 (WM name)     — 自助領取紀錄「商品名稱」欄
 *   K(10): 廠商二規格 (WM spec)     — 自助領取紀錄「規格」欄
 *   L(11): 廠商二成本 (WM cost)
 *
 * 比對策略（四層防護）：
 *  A. 字首 30 字鎖定：僅取商品名稱前 30 字進行比對，避免冗餘尾巴干擾
 *  B. 逗號陣列嚴格 AND 比對：keywords 以逗號分割後，每個關鍵字都必須命中
 *  C. 正則邊界防護：使用邊界確保「日」不誤匹配「日本」
 *  D. 加權計分機制：命中越多關鍵字、且關鍵字越長，分數越高 → 取最高分者
 *
 * 環境變數：
 *  GOOGLE_SHEET_ID  — Google Sheet 試算表 ID（選填，有預設值）
 *
 * 前置需求（GCP VM 上執行一次）：
 *  npm install googleapis
 *  並將 VM service account email 加入 Google Sheet「共用」（編輯者）
 */

'use strict';

// googleapis 已不需要（改用公開 CSV URL 方式）

// ── 環境變數 ───────────────────────────────────────────────────────────────
const SHEET_ID    = process.env.GOOGLE_SHEET_ID
  || '1foLTvkiN7gLtxDrFXFOoLviloop2qYduTGG_LpK8glQ';
// 讀取 Plans 分頁 A2:L（跳過第一行標題，讀到廠商二成本）
const SHEET_RANGE = 'Plans!A2:L';

// ── 快取（避免每次比對都打 Sheets API）──────────────────────────────────────
let _dictCache      = null;
let _cacheFetchedAt = 0;
const CACHE_TTL_MS  = 30 * 60 * 1000; // 30 分鐘

/**
 * 從 Google Sheets Plans 分頁讀取所有產品資料
 * 使用 Application Default Credentials (ADC)：
 *   - GCP Compute Engine VM 上自動使用 VM service account
 *   - 本機開發時可設定 GOOGLE_APPLICATION_CREDENTIALS 環境變數
 * @returns {Promise<Array>}
 */
async function fetchDictFromSheets() {
  // 使用 Google Sheets 公開 CSV 匯出 URL（不需要 OAuth scope）
  // 前提：Plans 分頁需設定「知道連結的人皆可檢視」
  const csvUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Plans`;

  const https = require('https');
  const http  = require('http');

  // 支援重導向（Google 偶爾會 302 → 新 URL）
  function fetchWithRedirect(url, redirectCount) {
    redirectCount = redirectCount || 0;
    if (redirectCount > 5) return Promise.reject(new Error('CSV URL 重導向次數過多'));
    const mod = url.startsWith('https') ? https : http;
    return new Promise((resolve, reject) => {
      mod.get(url, { headers: { 'User-Agent': 'SIMAX-core-mapper/1.0' } }, res => {
        if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303) && res.headers.location) {
          return fetchWithRedirect(res.headers.location, redirectCount + 1).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Google Sheets CSV 取得失敗（HTTP ${res.statusCode}）`));
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      }).on('error', reject);
    });
  }

  const csvText = await fetchWithRedirect(csvUrl);

  // 解析 CSV（處理帶引號的欄位）
  function parseCSVLine(line) {
    const result = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i+1] === '"') { cur += '"'; i++; }
        else { inQ = !inQ; }
      } else if (c === ',' && !inQ) {
        result.push(cur); cur = '';
      } else { cur += c; }
    }
    result.push(cur);
    return result;
  }

  const lines = csvText.split('\n').filter(l => l.trim());
  // 第一行為 header，從第二行開始
  const rows = lines.slice(1).map(l => parseCSVLine(l));

  // 過濾空行（至少要有 keywords）並轉換為字典格式
  return rows
    .filter(row => row[0] && row[0].trim())
    .map(row => ({
      keywords: (row[0]  || '').trim(),   // A: 搜尋關鍵字
      region:   (row[1]  || '').trim(),   // B: 上架區域（備用）
      title:    (row[3]  || '').trim(),   // D: 上架名稱
      p1_code:  (row[4]  || '').trim(),   // E: 廠商一代碼 (DJB)
      p1_name:  (row[5]  || '').trim(),   // F: 廠商一品名 (DJB)
      p1_spec:  (row[6]  || '').trim(),   // G: 廠商一規格 (DJB)
      p1_cost:  parseFloat(row[7]) || 0,  // H: 廠商一成本
      p2_code:  (row[8]  || '').trim(),   // I: 廠商二代碼 (WM)
      p2_name:  (row[9]  || '').trim(),   // J: 廠商二品名 (WM)
      p2_spec:  (row[10] || '').trim(),   // K: 廠商二規格 (WM)
      p2_cost:  parseFloat(row[11]) || 0, // L: 廠商二成本
    }));
}

/**
 * 取得產品字典（含快取機制）
 * @returns {Promise<Array>}
 */
async function getDictionary() {
  const now = Date.now();
  if (_dictCache && (now - _cacheFetchedAt) < CACHE_TTL_MS) {
    return _dictCache;
  }

  console.log('[core-mapper] 重新載入產品字典 from Google Sheets...');
  const items = await fetchDictFromSheets();
  _dictCache      = items;
  _cacheFetchedAt = now;
  console.log(`[core-mapper] 字典載入完成，共 ${items.length} 筆`);
  return items;
}

/**
 * 強制清除快取（例如字典更新後手動呼叫）
 */
function clearCache() {
  _dictCache      = null;
  _cacheFetchedAt = 0;
}

// ── 比對核心 ───────────────────────────────────────────────────────────────

/**
 * 建立關鍵字的正則，加上「詞邊界」保護
 * 中文無 \b，改以前後位置為非中文數字字母或字串頭尾來模擬邊界
 * @param {string} keyword
 * @returns {RegExp}
 */
function buildKeywordRegex(keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 前置邊界：空白、標點、括號、或中文常用分隔字（天日GB）
  // 注意：連字符 - 必須放在字元類的最後，避免被解釋為範圍
  return new RegExp(
    `(?:^|[\\s,，、()（）【】／/天日%GB\uff0d\u002d])${escaped}`,
    'i'
  );
}

/**
 * 【大腦比對主函式】
 * @param {string} rawProductName - MOMO 訂單中的原始商品名稱
 * @returns {Promise<{
 *   matched:     boolean,
 *   planTitle:   string|null,   // 上架名稱（D欄）
 *   vendor:      'DJB'|'WM'|null,
 *   vendorCode:  string|null,   // 廠商代碼
 *   vendorName:  string|null,   // 廠商品名（F或J欄）→ 自助領取紀錄「商品名稱」
 *   vendorSpec:  string|null,   // 廠商規格（G或K欄）→ 自助領取紀錄「規格」
 *   vendorCost:  number,        // 廠商成本（H或L欄）
 *   score:       number,
 *   debugInfo:   string
 * }>}
 */
async function mapProductToVendor(rawProductName) {
  const dict = await getDictionary();

  if (!rawProductName || dict.length === 0) {
    return _noMatch('商品名稱為空或字典為空');
  }

  // ── A. 字首 30 字鎖定 ──────────────────────────────────────────────────
  const target = rawProductName.trim().substring(0, 30).toLowerCase();

  let bestScore  = -1;
  let bestEntry  = null;
  let debugLines = [];

  for (const entry of dict) {
    const rawKeywords = entry.keywords;
    if (!rawKeywords) continue;

    // ── B. 逗號陣列嚴格 AND 比對 ──────────────────────────────────────
    const keywords = rawKeywords.split(/[,，]/).map(k => k.trim()).filter(Boolean);
    if (keywords.length === 0) continue;

    let allMatch   = true;
    let matchScore = 0;

    for (const kw of keywords) {
      // ── C. 正則邊界防護 ───────────────────────────────────────────────
      const regex = buildKeywordRegex(kw);
      if (!regex.test(target)) {
        allMatch = false;
        break;
      }
      // ── D. 加權計分：關鍵字越長分數越高（越精確） ─────────────────────
      matchScore += kw.length * 2 + 1;
    }

    if (!allMatch) continue;

    // 命中的關鍵字數量再加分
    matchScore += keywords.length * 3;

    debugLines.push(`  keywords="${entry.keywords}" title="${entry.title}" score=${matchScore}`);

    if (matchScore > bestScore) {
      bestScore = matchScore;
      bestEntry = entry;
    }
  }

  if (!bestEntry) {
    return _noMatch(`無法比對：${rawProductName.substring(0, 40)}`);
  }

  // ── 選擇廠商，並取出對應的品名、規格、成本 ────────────────────────────
  const vendor     = _pickVendor(bestEntry);
  const isDjb      = vendor === 'DJB';

  const vendorCode = isDjb ? bestEntry.p1_code : bestEntry.p2_code;
  const vendorName = isDjb ? bestEntry.p1_name : bestEntry.p2_name;
  const vendorSpec = isDjb ? bestEntry.p1_spec : bestEntry.p2_spec;
  const vendorCost = isDjb ? bestEntry.p1_cost : bestEntry.p2_cost;

  console.log(
    `[core-mapper] 比對成功 → "${rawProductName.substring(0, 30)}"` +
    ` → "${bestEntry.title}" (${vendor}/${vendorCode}) score=${bestScore}`
  );
  if (debugLines.length > 1) {
    console.log('[core-mapper] 所有命中：\n' + debugLines.join('\n'));
  }

  // 從關鍵字中提取天數（例如「日本, 吃到飽, 5天」→ 5）
  const dayMatch = (bestEntry.keywords || '').match(/(\d+)天/);
  const vendorDays = dayMatch ? parseInt(dayMatch[1], 10) : 0;

  return {
    matched:    true,
    planTitle:  bestEntry.title,
    vendor,
    vendorCode,
    vendorName,   // 廠商品名 → 自助領取紀錄 G欄「商品名稱」
    vendorSpec,   // 廠商規格 → 自助領取紀錄 H欄「規格」
    vendorCost,
    vendorDays,   // 天數（DJB API 需要）
    score:      bestScore,
    debugInfo:  `Matched: ${bestEntry.title} (score ${bestScore}) days=${vendorDays}`,
  };
}

/**
 * 選擇廠商：預設 DJB (p1)，若 p1_code 為空則使用 WM (p2)
 * 未來可擴充為庫存優先、成本最低策略
 * @param {object} entry
 * @returns {'DJB'|'WM'}
 */
function _pickVendor(entry) {
  if (entry.p1_code && entry.p1_code.trim()) return 'DJB';
  if (entry.p2_code && entry.p2_code.trim()) return 'WM';
  return 'DJB';
}

/** 比對失敗的標準回傳格式 */
function _noMatch(reason) {
  return {
    matched:    false,
    planTitle:  null,
    vendor:     null,
    vendorCode: null,
    vendorName: null,
    vendorSpec: null,
    vendorCost: 0,
    score:      0,
    debugInfo:  reason,
  };
}

module.exports = { mapProductToVendor, getDictionary, clearCache };
