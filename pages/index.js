/**
 * 檔案：pages/index.js
 * 模組：SIMAX eSIM 領取中心前台（v2.0 — Apple Minimalist 重構）
 */

import Head from 'next/head';
import { useState, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';

const IOS_SETUP_BASE = 'https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=';
const STEPS = ['輸入資訊', '確認商品', '取得 eSIM'];

function StepBar({ step }) {
  return (
    <div className="steps">
      {STEPS.map((label, i) => {
        const idx = i + 1;
        const isDone = step > idx;
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

function ItemCard({ item, onClaim, claiming }) {
  const isClaimed = !!item.dispatched;
  return (
    <div className="item-card">
      <div className="item-card-icon">📡</div>
      <div className="item-card-info">
        <div className="item-card-name">{item.product_name || '未知商品'}</div>
        <div className="item-card-meta">
          <span className="vendor-badge">{item.vendor || 'DJB'}</span>
          {item.order_id && <span style={{ color: 'var(--muted)', fontSize: 11 }}>#{item.order_id}</span>}
        </div>
      </div>
      {isClaimed ? (
        <button className="btn-claimed" disabled>已領取 ✓</button>
      ) : (
        <button className="btn-claim" onClick={() => onClaim(item)} disabled={claiming}>
          {claiming ? <><span className="spinner-dark" /> 處理中</> : '領取 →'}
        </button>
      )}
    </div>
  );
}

function ResultDjb({ item, onBack }) {
  const qr = item.qr_code_data || '';
  const isLpa = qr.startsWith('LPA:');
  const isUrl = qr.startsWith('http');
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try { await navigator.clipboard.writeText(qr); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  }, [qr]);
  return (
    <div className="result-card">
      <div style={{ fontSize: 40, marginBottom: 8 }}>🎉</div>
      <div className="result-title">eSIM 領取成功！</div>
      <div className="result-sub">
        {isLpa ? '點擊下方按鈕，或掃描 QR Code 在 iPhone 上安裝 eSIM' : '請掃描以下 QR Code 或點擊連結啟用您的 eSIM'}
      </div>
      <div className="qr-wrap">
        <QRCodeSVG value={qr} size={200} level="M" includeMargin={false} />
      </div>
      {isLpa && (
        <a href={`${IOS_SETUP_BASE}${encodeURIComponent(qr)}`} className="btn-ios" style={{ display: 'flex', textDecoration: 'none', marginTop: 16 }}>
          <span style={{ fontSize: 20 }}></span>
          <span>一鍵立即安裝 eSIM</span>
        </a>
      )}
      {isUrl && !isLpa && (
        <div style={{ marginTop: 12 }}>
          <a href={qr} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--brand)', fontSize: 13, textDecoration: 'underline', wordBreak: 'break-all' }}>{qr}</a>
        </div>
      )}
      <div className="qr-raw-box">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>啟用碼</span>
          <button className="btn-copy" onClick={handleCopy}>{copied ? '已複製 ✓' : '複製'}</button>
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', color: 'var(--text)', lineHeight: 1.5 }}>{qr}</div>
      </div>
      {item.order_id && <div className="result-order-id">訂單編號：{item.order_id}</div>}
      {onBack && <button className="btn-submit" style={{ marginTop: 16, background: 'rgba(0,0,0,0.04)', boxShadow: 'none', color: 'var(--muted)', fontSize: 13 }} onClick={onBack}>← 返回商品列表</button>}
    </div>
  );
}

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
      <p style={{ marginTop: 16, fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>若超過 30 分鐘未收到，請檢查垃圾郵件或聯繫客服。</p>
      {onBack && <button className="btn-submit" style={{ marginTop: 16, background: 'rgba(0,0,0,0.04)', boxShadow: 'none', color: 'var(--muted)', fontSize: 13 }} onClick={onBack}>← 返回商品列表</button>}
    </div>
  );
}

function ResultRefunded({ onConfirm }) {
  return (
    <div style={{ textAlign: 'center', padding: '4px 0 8px' }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(99,102,241,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 32 }}>ℹ️</div>
      <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>票券已失效或已退款</div>
      <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.8, margin: '0 0 28px' }}>
        系統顯示此序號已辦理退票手續，<br />因此無法兌換網卡。<br />若您仍有上網需求，<br />歡迎隨時至 SIMAX 重新下單。
      </p>
      <button className="btn-submit" onClick={onConfirm}>確定</button>
    </div>
  );
}

function ResultPending({ item, onBack }) {
  return (
    <div className="status-pending">
      <div className="icon">⏳</div>
      <h3>eSIM 準備中</h3>
      <p>您的訂單 <strong style={{ color: '#f59e0b' }}>{item.order_id}</strong><br />正在建立 eSIM，通常需要 5–15 分鐘，<br />請稍候後重新輸入序號查詢。</p>
      <p style={{ marginTop: 10, fontSize: 12 }}>如超過 30 分鐘請聯繫客服。</p>
      {onBack && <button className="btn-submit" style={{ marginTop: 16, background: 'rgba(0,0,0,0.04)', boxShadow: 'none', color: 'var(--muted)', fontSize: 13 }} onClick={onBack}>← 返回商品列表</button>}
    </div>
  );
}

function normalizeResponse(data) {
  if (Array.isArray(data.items) && data.items.length > 0) return data.items;
  return [{ order_id: data.order_id, product_name: data.product_name, vendor: data.vendor, qr_code_data: data.qr_code_data, message: data.message || null }];
}

function getQrType(qr_code_data) {
  if (!qr_code_data) return 'unknown';
  if (qr_code_data.startsWith('WM_ORDER:')) return 'wm';
  if (qr_code_data.startsWith('DJB_PENDING:')) return 'pending';
  return 'djb';
}

export default function ClaimPage() {
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const [items, setItems] = useState([]);
  const [activeItem, setActiveItem] = useState(null);
  const [claimingId, setClaimingId] = useState(null);
  const [specialStatus, setSpecialStatus] = useState(null);

  const canSubmit = pin.trim().length > 0 && email.trim().length > 5 && !loading;

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketPin: pin.trim(), email: email.trim() }),
      });
      const data = await res.json();
      if (data.status === 'TICKET_REFUNDED') { setSpecialStatus('TICKET_REFUNDED'); return; }
      if (!res.ok) throw new Error(data.error || data.message || `發生錯誤 (${res.status})`);
      const normalized = normalizeResponse(data);
      setItems(normalized);
      if (normalized.length === 1) { setActiveItem(normalized[0]); setStep(3); } else { setStep(2); }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = useCallback((item) => {
    setActiveItem(item);
    setStep(3);
    setItems(prev => prev.map(i => i.order_id === item.order_id ? { ...i, dispatched: true } : i));
  }, []);

  const handleBackToList = useCallback(() => { setActiveItem(null); setStep(2); }, []);

  const handleReset = useCallback(() => {
    setPin(''); setEmail(''); setError(''); setItems([]); setActiveItem(null); setClaimingId(null); setSpecialStatus(null); setStep(1);
  }, []);

  const qrType = activeItem ? getQrType(activeItem.qr_code_data) : null;
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
          <div className="logo-wrap">
            <div className="logo-icon">📡</div>
            <div className="logo-title">SIMAX eSIM 領取中心</div>
            <div className="logo-sub">輸入票券序號，即時取得您的 eSIM</div>
          </div>

          {specialStatus === 'TICKET_REFUNDED' && <ResultRefunded onConfirm={handleReset} />}
          {!specialStatus && <StepBar step={step} />}

          {!specialStatus && step === 1 && (
            <form className="form" onSubmit={handleLogin} autoComplete="off">
              <div className="field">
                <label>票券序號（PIN 碼）</label>
                <input type="text" placeholder="請輸入 MOMO 電子票券序號" value={pin} onChange={(e) => { setPin(e.target.value); setError(''); }} autoFocus autoComplete="off" spellCheck={false} />
                <span className="hint">💡 MOMO 購物→訂單明細 → 電子票券</span>
              </div>
              <div className="field">
                <label>信箱</label>
                <input type="email" placeholder="例：user@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                <span className="hint">為確保您能順利接收 QR Code，請再次確認 Email 是否正確</span>
              </div>
              {error && <div className="error-box"><span>⚠️</span><span>{error}</span></div>}
              <button type="submit" className="btn-submit" disabled={!canSubmit}>
                {loading ? <><span className="spinner" /> 核銷中，請稍候...</> : '核銷領取 eSIM →'}
              </button>
            </form>
          )}

          {!specialStatus && step === 2 && (
            <div>
              <div className="list-header">
                <div className="list-header-title">您的商品清單</div>
                <div className="list-header-sub">共 {items.length} 件 · 請點擊「領取」取得各品項的 eSIM</div>
              </div>
              <div className="card-list">
                {items.map((item, i) => <ItemCard key={item.order_id || i} item={item} onClaim={handleClaim} claiming={claimingId === item.order_id} />)}
              </div>
              <div className="divider" />
              <button className="btn-submit" style={{ background: 'rgba(0,0,0,0.04)', boxShadow: 'none', color: 'var(--muted)', fontSize: 13 }} onClick={handleReset}>← 查詢其他票券</button>
            </div>
          )}

          {!specialStatus && step === 3 && activeItem && (
            <>
              {qrType === 'djb' && <ResultDjb item={activeItem} onBack={backHandler} />}
              {qrType === 'wm' && <ResultWm item={activeItem} email={email} onBack={backHandler} />}
              {qrType === 'pending' && <ResultPending item={activeItem} onBack={backHandler} />}
              <div className="divider" />
              <button className="btn-submit" style={{ background: 'rgba(0,0,0,0.04)', boxShadow: 'none', color: 'var(--muted)', fontSize: 13 }} onClick={handleReset}>← 查詢其他票券</button>
            </>
          )}
        </div>
        <div className="footer">
          SIMAX eSIM &nbsp;·&nbsp; 如有問題請聯繫客服<br />
          <span style={{ fontSize: 11 }}>© {new Date().getFullYear()} SIMAX. All rights reserved.</span>
        </div>
      </div>
    </>
  );
}
