/**
 * 檔案：pages/admin/resend.js
 * 模組：SIMAX 後台 — 補寄確認信工具
 * # v1.1.0 | 2026-05-15 | 改版：對齊樂萌-DJB 後台視覺風格
 */

import { useState } from 'react';
import Head from 'next/head';

const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || 'simax2026';

export default function AdminResend() {
  const [authed,    setAuthed]    = useState(false);
  const [passcode,  setPasscode]  = useState('');
  const [authError, setAuthError] = useState('');

  const [orderId,  setOrderId]  = useState('');
  const [email,    setEmail]    = useState('');
  const [note,     setNote]     = useState('');
  const [loading,  setLoading]  = useState(false);
  const [result,   setResult]   = useState(null);

  const handleAuth = (e) => {
    e.preventDefault();
    if (passcode === ADMIN_PASSWORD) { setAuthed(true); setAuthError(''); }
    else { setAuthError('密碼錯誤，請再試一次'); }
  };

  const handleResend = async (e) => {
    e.preventDefault();
    if (!orderId.trim() || !email.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res  = await fetch('/api/resend-notify', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ orderId: orderId.trim(), email: email.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setResult({ ok: true, message: `信件已成功補寄至 ${email.trim()}` });
      } else {
        setResult({ ok: false, message: data.error || '補寄失敗，請確認訂單編號是否正確' });
      }
    } catch (err) {
      setResult({ ok: false, message: `網路錯誤：${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setOrderId(''); setEmail(''); setNote(''); setResult(null);
  };

  return (
    <>
      <Head>
        <title>SIMAX 後台管理</title>
        <meta name="robots" content="noindex,nofollow" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div style={{ minHeight: '100vh', background: '#f0f2f5', fontFamily: '-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif' }}>

        {/* ── 頂部導覽列 ── */}
        <div style={{ background: '#fff', borderBottom: '1px solid #e8eaed', padding: '0 28px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 }}>
          <div>
            <span style={{ fontSize: 17, fontWeight: 700, color: '#1a1a1a' }}>SIMAX 後台管理</span>
            <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 10 }}>eSIM Management System</span>
          </div>
          {authed && (
            <button
              onClick={() => { setAuthed(false); setPasscode(''); handleReset(); }}
              style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 14px', fontSize: 13, color: '#6b7280', cursor: 'pointer' }}
            >
              登出
            </button>
          )}
        </div>

        {/* ── 登入頁 ── */}
        {!authed && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 56px)' }}>
            <div style={{ background: '#fff', borderRadius: 16, padding: '40px 36px', width: 360, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#1a1a1a', marginBottom: 6 }}>後台登入</div>
              <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 28 }}>請輸入管理員密碼繼續</div>
              <form onSubmit={handleAuth} autoComplete="off">
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>管理員密碼</label>
                  <input
                    type="password"
                    style={inputStyle}
                    value={passcode}
                    onChange={e => { setPasscode(e.target.value); setAuthError(''); }}
                    placeholder="••••••••"
                    autoFocus
                  />
                  {authError && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>{authError}</div>}
                </div>
                <button type="submit" style={{ ...btnStyle, background: '#2563eb' }}>登入</button>
              </form>
            </div>
          </div>
        )}

        {/* ── 主畫面 ── */}
        {authed && (
          <div style={{ padding: '24px 28px' }}>

            {/* 頁面標題 */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a1a' }}>📧 補寄確認信件</div>
              <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>輸入訂單資訊，系統將重新寄出 eSIM QR Code 確認信</div>
            </div>

            {/* 三欄佈局 */}
            <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr 340px', gap: 20, alignItems: 'start' }}>

              {/* 左欄：訂單資訊 */}
              <div style={cardStyle}>
                <div style={cardTitleStyle}>訂單資訊</div>
                <form onSubmit={handleResend} autoComplete="off">
                  <div style={{ marginBottom: 16 }}>
                    <label style={labelStyle}>MOMO 訂單編號 <span style={{ color: '#ef4444' }}>*</span></label>
                    <input
                      type="text"
                      style={inputStyle}
                      value={orderId}
                      onChange={e => { setOrderId(e.target.value); setResult(null); }}
                      placeholder="請輸入訂單號碼"
                      autoFocus
                    />
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={labelStyle}>客戶正確信箱 <span style={{ color: '#ef4444' }}>*</span></label>
                    <input
                      type="email"
                      style={inputStyle}
                      value={email}
                      onChange={e => { setEmail(e.target.value); setResult(null); }}
                      placeholder="重要：輸入正確收件信箱"
                    />
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <label style={labelStyle}>備註</label>
                    <input
                      type="text"
                      style={inputStyle}
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      placeholder="選填（僅供自己記錄）"
                    />
                  </div>
                </form>
              </div>

              {/* 中欄：說明 */}
              <div style={cardStyle}>
                <div style={cardTitleStyle}>補寄說明</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[
                    { icon: '📋', title: '適用情況', desc: '顧客首次領取時輸入了錯誤信箱，導致確認信寄到錯誤地址。' },
                    { icon: '🔍', title: '系統行為', desc: '系統會從 Supabase 查找訂單，並將含有 QR Code 的確認信重新寄至您指定的信箱。' },
                    { icon: '✅', title: 'QR Code 有效性', desc: 'QR Code 本身不受影響，補寄的信件包含完整的啟用碼與一鍵安裝連結。' },
                    { icon: '⚠️', title: '注意事項', desc: '請確認輸入的是顧客「正確且可收信」的信箱，系統不會驗證信箱格式以外的資訊。' },
                  ].map((item, i) => (
                    <div key={i} style={{ background: '#f8fafc', borderRadius: 10, padding: '14px 16px', display: 'flex', gap: 12 }}>
                      <span style={{ fontSize: 20, flexShrink: 0 }}>{item.icon}</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginBottom: 4 }}>{item.title}</div>
                        <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.6 }}>{item.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 右欄：執行補寄 */}
              <div style={cardStyle}>
                <div style={cardTitleStyle}>執行補寄</div>

                {/* 確認資訊預覽 */}
                <div style={{ background: '#f8fafc', borderRadius: 10, padding: '14px 16px', marginBottom: 20 }}>
                  <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>補寄資訊確認</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: '#6b7280' }}>訂單編號</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: orderId ? '#1a1a1a' : '#d1d5db' }}>{orderId || '—'}</span>
                    </div>
                    <div style={{ height: 1, background: '#e5e7eb' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: '#6b7280' }}>收件信箱</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: email ? '#2563eb' : '#d1d5db', wordBreak: 'break-all', textAlign: 'right', maxWidth: 180 }}>{email || '—'}</span>
                    </div>
                  </div>
                </div>

                {/* 結果提示 */}
                {result && (
                  <div style={{
                    padding: '12px 16px',
                    borderRadius: 10,
                    marginBottom: 16,
                    background: result.ok ? '#f0fdf4' : '#fef2f2',
                    border: `1px solid ${result.ok ? '#86efac' : '#fca5a5'}`,
                    fontSize: 13,
                    color: result.ok ? '#15803d' : '#dc2626',
                    lineHeight: 1.6,
                  }}>
                    {result.ok ? '✅ ' : '❌ '}{result.message}
                  </div>
                )}

                {/* 執行按鈕 */}
                <button
                  onClick={handleResend}
                  disabled={loading || !orderId.trim() || !email.trim()}
                  style={{
                    ...btnStyle,
                    background: loading || !orderId.trim() || !email.trim() ? '#9ca3af' : '#16a34a',
                    cursor: loading || !orderId.trim() || !email.trim() ? 'not-allowed' : 'pointer',
                    fontSize: 15,
                    padding: '14px 0',
                  }}
                >
                  {loading ? '寄送中...' : '執行補寄（確認後送出）'}
                </button>

                <button
                  onClick={handleReset}
                  style={{ ...btnStyle, background: 'transparent', color: '#6b7280', border: '1px solid #e5e7eb', marginTop: 10 }}
                >
                  清除重填
                </button>
              </div>

            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── 共用樣式 ────────────────────────────────────────────────────────────────
const cardStyle = {
  background: '#fff',
  borderRadius: 12,
  padding: '20px 20px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  border: '1px solid #e8eaed',
};

const cardTitleStyle = {
  fontSize: 14,
  fontWeight: 700,
  color: '#1a1a1a',
  marginBottom: 16,
  paddingBottom: 12,
  borderBottom: '1px solid #f3f4f6',
};

const labelStyle = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: '#374151',
  marginBottom: 6,
  letterSpacing: '0.2px',
};

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  fontSize: 14,
  borderRadius: 8,
  border: '1px solid #e5e7eb',
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
  color: '#1a1a1a',
  background: '#fff',
};

const btnStyle = {
  width: '100%',
  padding: '12px 0',
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'block',
  textAlign: 'center',
};
