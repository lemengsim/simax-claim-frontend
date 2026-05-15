/**
 * 檔案：pages/admin/resend.js
 * 模組：後台補寄工具
 * # v1.0.0 | 2026-05-15 | 新增：管理員補寄 eSIM 確認信（支援指定任意收件信箱）
 *
 * 使用方式：https://your-domain.com/admin/resend
 * 需輸入管理員密碼才能使用
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
  const [loading,  setLoading]  = useState(false);
  const [result,   setResult]   = useState(null); // { ok, message }

  // ── 密碼驗證 ────────────────────────────────────────────────────────────
  const handleAuth = (e) => {
    e.preventDefault();
    if (passcode === ADMIN_PASSWORD) {
      setAuthed(true);
      setAuthError('');
    } else {
      setAuthError('密碼錯誤');
    }
  };

  // ── 補寄信件 ────────────────────────────────────────────────────────────
  const handleResend = async (e) => {
    e.preventDefault();
    if (!orderId.trim() || !email.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res  = await fetch('/api/resend-notify', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          orderId: orderId.trim(),
          email:   email.trim().toLowerCase(),
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setResult({ ok: true, message: `✅ 信件已成功補寄至 ${email.trim()}` });
      } else {
        setResult({ ok: false, message: `❌ 失敗：${data.error || '未知錯誤'}` });
      }
    } catch (err) {
      setResult({ ok: false, message: `❌ 網路錯誤：${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  // ── 樣式 ────────────────────────────────────────────────────────────────
  const card = {
    background: '#fff',
    borderRadius: 16,
    padding: '36px 32px',
    maxWidth: 440,
    width: '100%',
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
  };

  const label = {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: 6,
  };

  const input = {
    width: '100%',
    padding: '12px 14px',
    fontSize: 14,
    borderRadius: 10,
    border: '1px solid #e5e7eb',
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  };

  const btn = {
    width: '100%',
    padding: '13px 0',
    background: '#111',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 8,
  };

  return (
    <>
      <Head>
        <title>SIMAX 後台 — 補寄信件</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>

      <div style={{
        minHeight: '100vh',
        background: '#f3f4f6',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily: '-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif',
      }}>

        {/* ── 密碼頁 ── */}
        {!authed && (
          <div style={card}>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#111', marginBottom: 4 }}>🔐 後台登入</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 24 }}>SIMAX 補寄工具</div>
            <form onSubmit={handleAuth} autoComplete="off">
              <label style={label}>管理員密碼</label>
              <input
                type="password"
                style={input}
                value={passcode}
                onChange={e => { setPasscode(e.target.value); setAuthError(''); }}
                placeholder="輸入密碼"
                autoFocus
              />
              {authError && (
                <div style={{ color: '#ef4444', fontSize: 13, marginTop: 8 }}>{authError}</div>
              )}
              <button type="submit" style={{ ...btn, marginTop: 16 }}>進入</button>
            </form>
          </div>
        )}

        {/* ── 補寄工具 ── */}
        {authed && (
          <div style={card}>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#111', marginBottom: 4 }}>📧 補寄確認信件</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 28, lineHeight: 1.6 }}>
              輸入訂單編號與正確信箱，系統會重新寄出 eSIM 確認信（含 QR Code）。
            </div>

            <form onSubmit={handleResend} autoComplete="off">
              <div style={{ marginBottom: 16 }}>
                <label style={label}>MOMO 訂單編號</label>
                <input
                  type="text"
                  style={input}
                  value={orderId}
                  onChange={e => { setOrderId(e.target.value); setResult(null); }}
                  placeholder="例：26051512526631"
                  autoFocus
                />
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={label}>正確收件信箱</label>
                <input
                  type="email"
                  style={input}
                  value={email}
                  onChange={e => { setEmail(e.target.value); setResult(null); }}
                  placeholder="customer@example.com"
                />
              </div>

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
                  {result.message}
                </div>
              )}

              <button
                type="submit"
                style={{ ...btn, opacity: loading ? 0.7 : 1 }}
                disabled={loading || !orderId.trim() || !email.trim()}
              >
                {loading ? '寄送中...' : '立即補寄'}
              </button>
            </form>

            <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid #f3f4f6', textAlign: 'center' }}>
              <button
                onClick={() => { setAuthed(false); setPasscode(''); setResult(null); setOrderId(''); setEmail(''); }}
                style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 12, cursor: 'pointer' }}
              >
                登出
              </button>
            </div>
          </div>
        )}

      </div>
    </>
  );
}
