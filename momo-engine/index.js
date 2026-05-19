/**
 * 檔案：index.js
 * PM2 主入口 — SIMAX eSIM 自動發貨背景引擎
 *
 * 啟動方式：
 *   pm2 start index.js --name simax-engine
 *   pm2 save
 *   pm2 startup   # 設定開機自動啟動
 *
 * 同時啟動：
 *   - momo-ingest.js  : 每 5 分鐘撈 MOMO 訂單（進件模組）
 *   - dispatch-worker.js : 每 3 分鐘叫貨 DJB/WM（發貨模組）
 */

'use strict';

require('dotenv').config();   // 載入 .env 環境變數

const { startIngestScheduler }   = require('./momo-ingest');
const { startDispatchScheduler } = require('./dispatch-worker');

console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log('║  SIMAX eSIM 自動發貨引擎 — 啟動中            ║');
console.log('╚══════════════════════════════════════════════╝');
console.log(`  Node.js: ${process.version}`);
console.log(`  PID    : ${process.pid}`);
console.log(`  時間   : ${new Date().toISOString()}`);
console.log('');

// ── 啟動兩個排程模組 ────────────────────────────────────────────────────────
startIngestScheduler();    // MOMO 撈單（每 5 分鐘）
startDispatchScheduler();  // 叫貨 Worker（每 3 分鐘，延遲 30 秒後啟動）

// ── 全域錯誤保護（防止 PM2 意外重啟） ────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] uncaughtException:', err.message, err.stack);
  // 不 exit，讓 PM2 繼續維持程序
});

process.on('unhandledRejection', (reason) => {
  console.error('[CRITICAL] unhandledRejection:', reason);
});

process.on('SIGTERM', () => {
  console.log('[index] 收到 SIGTERM，引擎正常關閉');
  process.exit(0);
});
