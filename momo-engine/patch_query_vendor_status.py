#!/usr/bin/env python3
"""
patch_query_vendor_status.py
修補 status-reconciler.js：補上缺失的 queryVendorStatus 函式

問題：status-reconciler.js 呼叫 queryVendorStatus()，但該函式從未被定義，
      導致 PM2 log 出現 "queryVendorStatus is not a function"

修補方式：在 status-reconciler.js 頂部區域插入 queryVendorStatus 函式

執行：python3 /tmp/patch_query_vendor_status.py
"""

import re, sys, shutil, datetime

PATH = '/home/order/simax-momo-engine/status-reconciler.js'

try:
    with open(PATH, 'r', encoding='utf-8') as f:
        src = f.read()
except FileNotFoundError:
    print(f'❌ 找不到檔案：{PATH}')
    sys.exit(1)

# 檢查是否已有此函式
if 'async function queryVendorStatus' in src:
    print('✅ queryVendorStatus 已存在，略過 patch。')
    sys.exit(0)

# ── 新增的 queryVendorStatus 函式 ─────────────────────────────────────────────
FUNC = r'''
// ── queryVendorStatus：查詢廠商訂單狀態（由 patch_query_vendor_status.py 補入）────
/**
 * 查詢廠商 API 取得訂單狀態（QR Code 是否就緒）
 * @param {string} vendor       - 'DJB' | 'WM'
 * @param {string} djbOrderId   - DJB channel_sub_order_id（或 MOMO 訂單號）
 * @param {string} sourceNo     - DJB source_number（本次查詢用）
 * @returns {Promise<string|null>} QR Code LPA 字串；未就緒或 WM 廠商回傳 null
 */
async function queryVendorStatus(vendor, djbOrderId, sourceNo) {
  if (vendor !== 'DJB') return null;   // WM 由廠商直接寄信，不需查詢

  const baseUrl = process.env.DJB_BASE_URL;
  const apiIv   = process.env.DJB_API_IV;
  const apiKey  = process.env.DJB_API_KEY;

  if (!baseUrl || !apiIv || !apiKey) {
    console.warn('[reconciler] queryVendorStatus: DJB 環境變數不完整，略過查詢');
    return null;
  }

  // 計算 Checksum（複製自 dispatch-worker.js 的邏輯）
  const crypto = require('crypto');
  const tw   = new Date(new Date().getTime() + 8 * 3600 * 1000);
  const y    = tw.getUTCFullYear();
  const m    = String(tw.getUTCMonth() + 1).padStart(2, '0');
  const d    = String(tw.getUTCDate()).padStart(2, '0');
  const raw  = apiIv + `${y}${m}${d}` + sourceNo;
  const b64  = Buffer.from(raw, 'utf8').toString('base64');
  const checksum = crypto.createHash('md5').update(b64, 'utf8').digest('hex');

  const date = `${y}-${m}-${d}`;

  // 呼叫 DJB /api/order/info
  const https  = require('https');
  const http   = require('http');
  const body   = new URLSearchParams({
    key:                  apiKey,
    date,
    checksum,
    source_number:        sourceNo,
    channel_sub_order_id: djbOrderId,
  }).toString();

  const urlObj = new URL(`${baseUrl}/api/order/info`);
  const lib    = urlObj.protocol === 'https:' ? https : http;

  return new Promise((resolve) => {
    const options = {
      hostname: urlObj.hostname,
      port:     urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path:     urlObj.pathname + urlObj.search,
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = lib.request(options, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const result = JSON.parse(raw);
          // 嘗試各路徑取得 qrcode_content
          const qr =
            result?.data?.qrcode_content           ||
            result?.data?.data?.qrcode_content     ||
            result?.data?.cards?.[0]?.qrcode_content ||
            result?.qrcode_content                 ||
            null;
          resolve(qr);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(20000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

'''

# ── 插入位置：在 'use strict' 後面，或在第一個 require 後面 ─────────────────────
insert_after = "'use strict';"
if insert_after in src:
    src = src.replace(insert_after, insert_after + '\n' + FUNC, 1)
    print('[patch] ✅ queryVendorStatus 已插入（位置：use strict 之後）')
else:
    # 備用：插入到 module.exports 之前
    if 'module.exports' in src:
        src = src.replace('module.exports', FUNC + 'module.exports', 1)
        print('[patch] ✅ queryVendorStatus 已插入（位置：module.exports 之前）')
    else:
        # 最後手段：貼到最前面
        src = FUNC + src
        print('[patch] ✅ queryVendorStatus 已插入（位置：檔案開頭）')

# ── 備份並寫回 ────────────────────────────────────────────────────────────────
ts  = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
bak = PATH + f'.bak_{ts}'
shutil.copy2(PATH, bak)
print(f'[backup] 原始檔案已備份至 {bak}')

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(src)

print('✅ patch_query_vendor_status.py 套用完成！')
print('   請執行：pm2 restart simax-engine && pm2 logs simax-engine --lines 20')
