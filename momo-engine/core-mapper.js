/**
 * 檔案：core-mapper.js
 * 模組：【大腦模組 (Core/Mapping)】產品字典比對引擎
 *
 * 負責：
 *  1. 從 Firebase Realtime Database 載入產品字典（每 30 分鐘快取一次）
 *  2. 對傳入的商品名稱進行多策略比對，回傳最佳廠商代碼
 *
 * 比對策略（四層防護）：
 *  A. 字首 30 字鎖定：僅取商品名稱前 30 字進行比對，避免冗餘尾巴干擾
 *  B. 逗號陣列嚴格 AND 比對：keywords 以逗號分割後，每個關鍵字都必須命中
 *  C. 正則邊界防護：使用 \b 或 [\s,，、] 邊界確保「日」不誤匹配「日本」
 *  D. 加權計分機制：命中越多關鍵字、且關鍵字越長，分數越高 → 取最高分者
 */

const https = require('https');

// ── 環境變數 ───────────────────────────────────────────────────────────────
// Firebase Realtime Database URL (asia-southeast1)
const FB_DB_URL   = process.env.FIREBASE_DB_URL
  || 'https://esim-system-default-rtdb.asia-southeast1.firebasedatabase.app';
// Firebase Realtime DB 的 REST API secret (在 Firebase 主控台 > 服務帳號 > 資料庫密碼)
const FB_SECRET   = process.env.FIREBASE_DB_SECRET
  || '5ogfZra90hd8bq6rYCoS1oHHV2gdza5UzmZ8so8b';

// ── 快取（避免每次比對都打 Firebase）────────────────────────────────────────
let _dictCache      = null;   // { id: { keywords, title, p1_code, p1_cost, p2_code, p2_cost, ... } }
let _cacheFetchedAt = 0;      // Unix ms
const CACHE_TTL_MS  = 30 * 60 * 1000; // 30 分鐘

/**
 * 從 Firebase Realtime DB 讀取所有 plans，回傳物件陣列
 * @returns {Promise<Array<{id, keywords, title, p1_code, p1_cost, p2_code, p2_cost}>>}
 */
async function fetchDictFromFirebase() {
  const url = `${FB_DB_URL}/plans.json?auth=${FB_SECRET}`;

  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      let body = '';
      response.on('data', chunk => body += chunk);
      response.on('end', () => {
        try {
          const raw = JSON.parse(body);
          if (!raw || typeof raw !== 'object') return resolve([]);

          // Firebase 回傳格式：{ planId: { keywords, title, ... }, ... }
          const items = Object.entries(raw).map(([id, val]) => ({ id, ...val }));
          resolve(items);
        } catch (err) {
          reject(new Error(`Firebase JSON 解析失敗: ${err.message}`));
        }
      });
    }).on('error', reject);
  });
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

  console.log('[core-mapper] 重新載入產品字典 from Firebase...');
  const items = await fetchDictFromFirebase();
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
 * 中文無 \b，改以前後位置為「非中文數字字母」或字串頭尾來模擬邊界
 * @param {string} keyword
 * @returns {RegExp}
 */
function buildKeywordRegex(keyword) {
  // 跳脫正則特殊字元
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 前後各加「零寬斷言」：(?<![^\s,，、])...(?![^\s,，、])
  // 對於中文關鍵字，用 (?:^|[\s,，、()（）【】]) 做左邊界，右邊類似
  return new RegExp(
    `(?:^|[\\s,，、()（）【】／/－-])${escaped}(?=$|[\\s,，、()（）【】／/－-\\d天日GB])`,
    'i'
  );
}

/**
 * 【大腦比對主函式】
 * @param {string} rawProductName - MOMO 訂單中的原始商品名稱
 * @returns {Promise<{
 *   matched: boolean,
 *   planId: string|null,
 *   planTitle: string|null,
 *   vendor: 'DJB'|'WM'|null,
 *   vendorCode: string|null,
 *   score: number,
 *   debugInfo: string
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
    const rawKeywords = (entry.keywords || '').trim();
    if (!rawKeywords) continue;

    // ── B. 逗號陣列嚴格 AND 比對 ──────────────────────────────────────
    const keywords = rawKeywords.split(/[,，]/).map(k => k.trim()).filter(Boolean);
    if (keywords.length === 0) continue;

    let allMatch = true;
    let matchScore = 0;

    for (const kw of keywords) {
      // ── C. 正則邊界防護 ───────────────────────────────────────────────
      const regex = buildKeywordRegex(kw);
      if (!regex.test(target)) {
        allMatch = false;
        break;
      }
      // ── D. 加權計分：關鍵字越長分數越高（越精確） ─────────────────────
      matchScore += kw.length * 2 + 1;  // 長度 × 2 + 基礎分
    }

    if (!allMatch) continue;

    // 命中的關鍵字數量再加分
    matchScore += keywords.length * 3;

    debugLines.push(`  [${entry.id}] "${entry.title}" score=${matchScore}`);

    if (matchScore > bestScore) {
      bestScore = matchScore;
      bestEntry = entry;
    }
  }

  if (!bestEntry) {
    return _noMatch(`無法比對：${rawProductName.substring(0, 40)}`);
  }

  // 選擇廠商（優先 p1，若 p1 無貨時可擴充為 fallback p2）
  const vendor     = _pickVendor(bestEntry);
  const vendorCode = vendor === 'DJB' ? bestEntry.p1_code : bestEntry.p2_code;

  console.log(
    `[core-mapper] 比對成功 → "${rawProductName.substring(0, 30)}" → [${bestEntry.id}] ` +
    `"${bestEntry.title}" (${vendor}/${vendorCode}) score=${bestScore}`
  );
  if (debugLines.length > 1) {
    console.log('[core-mapper] 所有命中：\n' + debugLines.join('\n'));
  }

  return {
    matched:    true,
    planId:     bestEntry.id,
    planTitle:  bestEntry.title,
    vendor,
    vendorCode,
    score:      bestScore,
    debugInfo:  `Matched: ${bestEntry.title} (score ${bestScore})`,
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
  return 'DJB'; // 預設
}

/** 比對失敗的標準回傳格式 */
function _noMatch(reason) {
  return {
    matched:    false,
    planId:     null,
    planTitle:  null,
    vendor:     null,
    vendorCode: null,
    score:      0,
    debugInfo:  reason,
  };
}

module.exports = { mapProductToVendor, getDictionary, clearCache };
