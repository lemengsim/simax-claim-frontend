/**
 * 檔案：pages/index.js
 * 模組：SIMAX eSIM 領取中心前台（v2.0 — Apple Minimalist 重構）
 *
 * 【UX 三步流程】
 *  Step 1 — Login     : PIN 碼 + Email 同時顯示，送出後呼叫 /api/claim
 *  Step 2 — Card List : 若回傳多件商品，顯示卡片列表，每張卡片有獨立「領取」按鈕
 *  Step 3 — Dispatch  : 顯示 QR Code + iOS 一鍵安裝按鈕（LPA 格式）
 *                       WM 廠商顯示「已寄送兌換碼」畫面
 *                       DJB 處理中顯示「eSIM 準備中」畫面
 *
 * 【API 回傳格式】
 *  單件：{ success, order_id, product_name, vendor, qr_code_data, message }
 *  多件：{ success, items: [{ order_id, product_name, vendor, qr_code_data }] }
 *        （多件格式為未來擴充，目前後端統一回傳單件）
 *
 * 【QR Code 類型判斷】
 *  qr_code_data.startsWith('LPA:')        → DJB eSIM，顯示 QR + iOS 安裝鈕
 *  qr_code_data.startsWith('WM_ORDER:')   → WM 廠商，顯示「已寄送」畫面
 *  qr_code_data.startsWith('DJB_PENDING:')→ 處理中，顯示「準備中」畫面
 *  其他 URL / 字串                         → DJB 舊格式，顯示 QR（無安裝鈕）
 */

import Head from 'next/head';
import { useState, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';

// ─── 常數 ──────────────────────────────────────────────────────────────────
const IOS_SETUP_BASE = 'https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=';

// ─── 步驟進度條 ────────────────────────────────────────────────────────────
const STEPS = ['輸入資訊', '確認商品', '取得 eSIM'];

function StepBar({ step }) {
  return (
    <div className="steps">
      {STEPS.map((label, i) => {
        const idx     = i + 1;
        const isDone  = step > idx;
        const isActive = step === idx;
        return (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', flex: idx < STEPS.length ? 1 : 'none' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div className={`step-dot ${isDone ? 'done' : isActive ? 'active' : ''}`}>
                {isDone ? '✓' : idx}
              </div>
              <span className={`step-label ${isActive ? 'active' : ''}`}>{label}</span>
            </div>
            {idx < STEPS.length && (
              <div className={`step-line ${step > idx ? 'active' : ''}`} style={{ flex: 1, marginBottom: 20 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── 商品卡片（Card List 頁） ───────────────────────────────────────────────
function ItemCard({ item, onClaim, claiming }) {
  const isClaimed = !!item.dispatched;
  return (
    <div className="item-card">
      <div className="item-card-icon">📡</div>
      <div className="item-card-info">
        <div className="item-card-name">{item.product_name || '未知商品'}</div>
        <div className="item-card-meta">
          {item.order_id && <span style={{ color: 'var(--muted)', fontSize: 11 }}>#{item.order_id}</span>}
        </div>
      </div>
      {isClaimed ? (
        <button className="btn-claimed" disabled>已領取 ✓</button>
      ) : (
        <button
          className="btn-claim"
          onClick={() => onClaim(item)}
          disabled={claiming}
        >
          {claiming ? <><span className="spinner-dark" /> 處理中</> : '領取 →'}
        </button>
      )}
    </div>
  );
}

// ─── 結果：DJB QR Code（LPA 或 URL 格式） ─────────────────────────────────
function ResultDjb({ item, onBack }) {
  const qr    = item.qr_code_data || '';
  const isLpa = qr.startsWith('LPA:');
  const isUrl = qr.startsWith('http');
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(qr);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }, [qr]);

  return (
    <div className="result-card">
      <div style={{ fontSize: 40, marginBottom: 8 }}>🎉</div>
      <div className="result-title">eSIM 領取成功！</div>
      <div className="result-sub">
        {isLpa
          ? '點擊下方按鈕，或掃描 QR Code 在 iPhone 上安裝 eSIM'
          : '請掃描以下 QR Code 或點擊連結啟用您的 eSIM'}
      </div>

      {/* QR Code */}
      <div className="qr-wrap">
        <QRCodeSVG value={qr} size={200} level="M" includeMargin={false} />
      </div>

      {/* iOS 一鍵安裝（僅 LPA 格式） */}
      {isLpa && (
        <a
          href={`${IOS_SETUP_BASE}${encodeURIComponent(qr)}`}
          className="btn-ios"
          style={{ display: 'flex', textDecoration: 'none', marginTop: 16 }}
        >
          <span style={{ fontSize: 20 }}></span>
          <span>一鍵立即安裝 eSIM</span>
        </a>
      )}

      {/* URL 連結（舊格式） */}
      {isUrl && !isLpa && (
        <div style={{ marginTop: 12 }}>
          <a href={qr} target="_blank" rel="noopener noreferrer"
             style={{ color: 'var(--brand)', fontSize: 13, textDecoration: 'underline', wordBreak: 'break-all' }}>
            {qr}
          </a>
        </div>
      )}

      {/* 啟用碼原文 + 複製 */}
      <div className="qr-raw-box">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>啟用碼</span>
          <button className="btn-copy" onClick={handleCopy}>{copied ? '已複製 ✓' : '複製'}</button>
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', color: 'var(--text)', lineHeight: 1.5 }}>
          {qr}
        </div>
      </div>

      {item.order_id && (
        <div className="result-order-id">訂單編號：{item.order_id}</div>
      )}

      {onBack && (
        <button
          className="btn-submit"
          style={{ marginTop: 16, background: 'rgba(0,0,0,0.04)', boxShadow: 'none', color: 'var(--muted)', fontSize: 13 }}
          onClick={onBack}
        >
          ← 返回商品列表
        </button>
      )}
    </div>
  );
}

// ─── 結果：WM（兌換碼由 WM 直接寄信） ────────────────────────────────────
function ResultWm({ item, email, onBack }) {
  return (
    <div className="result-wm">
      <div style={{ fontSize: 40, marginBottom: 12 }}>✉️</div>
      <div className="result-title">兌換碼已寄出！</div>
      <div className="result-sub" style={{ marginBottom: 16 }}>
        世界移動將於數分鐘內將兌換碼寄至<br />
        <strong style={{ color: 'var(--brand)' }}>{email}</strong>
      </div>
      {item.order_id && <div className="result-order-id">訂單編號：{item.order_id}</div>}
      <p style={{ marginTop: 16, fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
        若超過 30 分鐘未收到，請檢查垃圾郵件或聯繫客服。
      </p>
      {onBack && (
        <button
          className="btn-submit"
          style={{ marginTop: 16, background: 'rgba(0,0,0,0.04)', boxShadow: 'none', color: 'var(--muted)', fontSize: 13 }}
          onClick={onBack}
        >
          ← 返回商品列表
        </button>
      )}
    </div>
  );
}

// ─── 結果：訂單回收中（退換貨流程）─────────────────────────────────────
function ResultRecovering({ onConfirm }) {
  return (
    <div style={{ textAlign: 'center', padding: '4px 0 8px' }}>
      <div style={{
        width: 64, height: 64, borderRadius: '50%',
        background: 'rgba(59,130,246,0.08)',   // 柔和藍底
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 16px',
        fontSize: 34,
        color: '#3b82f6',                       // 藍色資訊圖示
        lineHeight: 1,
      }}>ⓘ</div>
      <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>
        訂單狀態確認中
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.8, margin: '0 0 28px' }}>
        由於您的訂單目前正在處理退換貨流程，<br />
        領取功能已暫時關閉。<br />
        這是為了確保您的權益不受影響，請您諒解。
      </p>
      <button className="btn-submit" onClick={onConfirm}>
        好的，我了解了
      </button>
    </div>
  );
}

// ─── 結果：票券已退款 / 作廢 / 無效 ──────────────────────────────────────
function ResultRefunded({ onConfirm }) {
  return (
    <div style={{ textAlign: 'center', padding: '4px 0 8px' }}>
      {/* 中性資訊圖示 */}
      <div style={{
        width: 64, height: 64, borderRadius: '50%',
        background: 'rgba(99,102,241,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 16px',
        fontSize: 32,
      }}>
        ℹ️
      </div>

      <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>
        票券已失效或已退款
      </div>

      <p style={{
        color: 'var(--muted)',
        fontSize: 14,
        lineHeight: 1.8,
        margin: '0 0 28px',
      }}>
        系統顯示此序號已辦理退票手續，<br />
        因此無法兌換網卡。<br />
        若您仍有上網需求，<br />歡迎隨時至 SIMAX 重新下單。
      </p>

      <button className="btn-submit" onClick={onConfirm}>
        確定
      </button>
    </div>
  );
}

// ─── 結果：DJB 處理中 ─────────────────────────────────────────────────────
function ResultPending({ item, onBack }) {
  return (
    <div className="status-pending">
      <div className="icon">⏳</div>
      <h3>eSIM 準備中</h3>
      <p>
        您的訂單 <strong style={{ color: '#f59e0b' }}>{item.order_id}</strong><br />
        正在建立 eSIM，通常需要 5–15 分鐘，<br />請稍候後重新輸入序號查詢。
      </p>
      <p style={{ marginTop: 10, fontSize: 12 }}>如超過 30 分鐘請聯繫客服。</p>
      {onBack && (
        <button
          className="btn-submit"
          style={{ marginTop: 16, background: 'rgba(0,0,0,0.04)', boxShadow: 'none', color: 'var(--muted)', fontSize: 13 }}
          onClick={onBack}
        >
          ← 返回商品列表
        </button>
      )}
    </div>
  );
}

// ─── 工具：正規化 API 回應為統一 items 陣列 ───────────────────────────────
function normalizeResponse(data) {
  // 多件格式（未來）
  if (Array.isArray(data.items) && data.items.length > 0) {
    return data.items;
  }
  // 單件格式（目前）
  return [{
    order_id:     data.order_id,
    product_name: data.product_name,
    vendor:       data.vendor,
    qr_code_data: data.qr_code_data,
    message:      data.message || null,
  }];
}

// ─── 工具：判斷 QR 類型 ────────────────────────────────────────────────────
function getQrType(qr_code_data) {
  if (!qr_code_data) return 'unknown';
  if (qr_code_data.startsWith('WM_ORDER:'))    return 'wm';
  if (qr_code_data.startsWith('DJB_PENDING:')) return 'pending';
  return 'djb';  // LPA: 或 https:// 都走 DJB 顯示
}

// ─── 主頁面 ────────────────────────────────────────────────────────────────
export default function ClaimPage() {
  // ── 表單狀態 ──
  const [orderNo,  setOrderNo]  = useState('');
  const [email,    setEmail]    = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  // ── 步驟狀態（1=Login, 2=CardList, 3=Dispatch） ──
  const [step,          setStep]          = useState(1);
  const [items,         setItems]         = useState([]);      // 正規化後的商品陣列
  const [activeItem,    setActiveItem]    = useState(null);    // 當前顯示的商品（Step 3）
  const [claimingId,    setClaimingId]    = useState(null);    // 正在領取的 order_id
  // 特殊業務狀態（覆蓋步驟流程，直接顯示說明頁）
  // 'TICKET_REFUNDED' → 票券已退款 / 作廢 / 查無此票
  const [specialStatus, setSpecialStatus] = useState(null);

  const canSubmit = orderNo.trim().length > 0 && email.trim().length > 5 && !loading;

  // ── Step 1：送出訂單編號 + Email ──────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/claim', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ orderNo: orderNo.trim(), email: email.trim() }),
      });

      const data = await res.json();

      // 特殊業務狀態：票券已退款 / 作廢 / 查無此票
      // → 不顯示 error 彈窗，平滑切換至說明頁
      if (data.status === 'TICKET_REFUNDED') {
        setSpecialStatus('TICKET_REFUNDED');
        return;
      }

      if (data.status === 'ORDER_RECOVERING') {
        setSpecialStatus('ORDER_RECOVERING');
        return;
      }

      if (!res.ok) {
        throw new Error(data.error || data.message || `發生錯誤 (${res.status})`);
      }

      const normalized = normalizeResponse(data);
      setItems(normalized);

      // 不論單件/多件都進 Step 2 讓客人確認商品再按「領取」
      setStep(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2：Card List 點擊「領取」───────────────────────────────────────
  const handleClaim = useCallback((item) => {
    setActiveItem(item);
    setStep(3);
    // 標記該 item 已領取（更新 items 陣列）
    setItems(prev => prev.map(i =>
      i.order_id === item.order_id ? { ...i, dispatched: true } : i
    ));
  }, []);

  // ── 返回 Card List（Step 3 → 2） ─────────────────────────────────────
  const handleBackToList = useCallback(() => {
    setActiveItem(null);
    setStep(2);
  }, []);

  // ── 全部重置（返回 Step 1） ─────────────────────────────────────────
  const handleReset = useCallback(() => {
    setOrderNo('');
    setEmail('');
    setError('');
    setItems([]);
    setActiveItem(null);
    setClaimingId(null);
    setSpecialStatus(null);
    setStep(1);
  }, []);

  // ── 當前 Step 3 顯示類型 ─────────────────────────────────────────────
  const qrType = activeItem ? getQrType(activeItem.qr_code_data) : null;

  // ── 多件時返回按鈕設定 ────────────────────────────────────────────────
  const backHandler = items.length > 1 ? handleBackToList : null;

  return (
    <>
      <Head>
        <title>SIMAX eSIM 領取中心</title>
        <meta name="description" content="輸入票券序號，立即領取您的 eSIM" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="page">
        <div className="card">

          {/* ── Logo ── */}
          <div className="logo-wrap">
            <div className="logo-title">SIMAX eSIM 領取中心</div>
            <div className="logo-sub">輸入訂單編號，即刻領取您的 eSIM</div>
          </div>

          {/* ════════════════ 特殊狀態：票券退款 / 作廢 / 查無此票 ═══════════ */}
          {specialStatus === 'TICKET_REFUNDED' && (
            <ResultRefunded onConfirm={handleReset} />
          )}
          {specialStatus === 'ORDER_RECOVERING' && (
            <ResultRecovering onConfirm={handleReset} />
          )}

          {/* ── 步驟進度條 + 步驟內容（特殊狀態時整體隱藏） ── */}
          {!specialStatus && <StepBar step={step} />}

          {/* ════════════════ STEP 1：Login ════════════════ */}
          {!specialStatus && step === 1 && (
            <form className="form" onSubmit={handleLogin} autoComplete="off">

              <div className="field">
                <label>MOMO 訂單編號</label>
                <input
                  type="text"
                  placeholder="例：26042217105803"
                  value={orderNo}
                  onChange={(e) => { setOrderNo(e.target.value.trim()); setError(''); }}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>

              <div className="field">
                <label>信箱</label>
                <input
                  type="email"
                  placeholder="例：user@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
                <span className="hint">為確保您能順利接收 QR Code，請再次確認 Email 是否正確</span>
              </div>

              {error && (
                <div className="error-box">
                  <span>⚠️</span>
                  <span>{error}</span>
                </div>
              )}

              <button type="submit" className="btn-submit" disabled={!canSubmit}>
                {loading
                  ? <><span className="spinner" /> 處理中，請稍候...</>
                  : '領取 eSIM →'
                }
              </button>

            </form>
          )}

          {/* ════════════════ STEP 2：Card List ════════════════ */}
          {!specialStatus && step === 2 && (
            <div>
              <div className="list-header">
                <div className="list-header-title">您的商品清單</div>
                <div className="list-header-sub">共 {items.length} 件 · 請點擊「領取」取得各品項的 eSIM</div>
              </div>

              <div className="card-list">
                {items.map((item, i) => (
                  <ItemCard
                    key={item.order_id || i}
                    item={item}
                    onClaim={handleClaim}
                    claiming={claimingId === item.order_id}
                  />
                ))}
              </div>

              <div className="divider" />

              <button
                className="btn-submit"
                style={{ background: 'rgba(0,0,0,0.04)', boxShadow: 'none', color: 'var(--muted)', fontSize: 13 }}
                onClick={handleReset}
              >
                ← 查詢其他票券
              </button>
            </div>
          )}

          {/* ════════════════ STEP 3：Dispatch ════════════════ */}
          {!specialStatus && step === 3 && activeItem && (
            <>
              {qrType === 'djb' && (
                <ResultDjb item={activeItem} onBack={backHandler} />
              )}
              {qrType === 'wm' && (
                <ResultWm item={activeItem} email={email} onBack={backHandler} />
              )}
              {qrType === 'pending' && (
                <ResultPending item={activeItem} onBack={backHandler} />
              )}

              <div className="divider" />

              <button
                className="btn-submit"
                style={{ background: 'rgba(0,0,0,0.04)', boxShadow: 'none', color: 'var(--muted)', fontSize: 13 }}
                onClick={handleReset}
              >
                ← 查詢其他票券
              </button>
            </>
          )}

        </div>

        {/* ── Footer ── */}
        <div className="footer" style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: 12, color: 'var(--muted)', fontSize: 12 }}>
            SIMAX eSIM &nbsp;·&nbsp; 如有問題請聯繫
          </div>
          <a
            href="https://line.me/R/ti/p/@357wafqg?ts=01291734&oat_content=url"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 18px',
              borderRadius: 9999,
              border: '1px solid rgba(0,0,0,0.08)',
              background: '#fff',
              color: '#4b5563',          // text-gray-600
              fontSize: 13,
              fontWeight: 500,
              textDecoration: 'none',
              transition: 'background 0.15s, box-shadow 0.15s',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#f3f4f6';
              e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.06)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#fff';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#06C755" aria-hidden="true">
              <path d="M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314M9.614 13.19H7.205c-.346 0-.627-.285-.627-.63V8.108c0-.346.281-.63.627-.63.349 0 .63.284.63.63v4.141h1.779c.349 0 .627.283.627.629 0 .344-.278.629-.627.629m1.784-.63c0 .344-.282.629-.63.629-.346 0-.627-.285-.627-.629V8.108c0-.345.281-.63.627-.63.348 0 .63.285.63.63v4.772zm5.928 0c0 .27-.175.51-.43.596-.066.021-.135.031-.2.031-.205 0-.398-.09-.519-.254l-2.464-3.353v2.98c0 .344-.278.629-.627.629-.346 0-.63-.285-.63-.629V8.108c0-.27.174-.51.428-.597.064-.022.137-.03.199-.03.194 0 .384.089.503.253l2.484 3.355v-2.98c0-.346.276-.63.628-.63.346 0 .63.284.63.63v4.452zm3.637-2.506h-1.757v1.126h1.757c.344 0 .626.282.626.629 0 .346-.282.628-.626.628h-2.389c-.344 0-.629-.282-.629-.628v-4.77c0-.345.285-.63.629-.63h2.389c.344 0 .626.285.626.63 0 .346-.282.629-.626.629h-1.757v1.124h1.757c.344 0 .626.285.626.629 0 .346-.279.626-.626.629"/>
            </svg>
            聯繫 LINE 客服
          </a>
          <div style={{ marginTop: 14, fontSize: 11, color: '#9ca3af' }}>
            © {new Date().getFullYear()} SIMAX. All rights reserved.
          </div>
        </div>
      </div>
    </>
  );
}
