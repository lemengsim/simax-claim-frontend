/**
 * 檔案：pages/admin/index.js
 * 模組：SIMAX 後台管理中心
 * # v1.0.0 | 2026-05-15 | 新增：後台管理頁（補寄信件 + Google Sheets 同步記錄）
 */

import Head from 'next/head';
import { useState, useEffect } from 'react';

const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || 'simax2026';

export default function AdminPage() {
  const [authed,       setAuthed]       = useState(false);
  const [passcode,     setPasscode]     = useState('');
  const [authError,    setAuthError]    = useState('');
  const [orderId,      setOrderId]      = useState('');
  const [email,        setEmail]        = useState('');
  const [loading,      setLoading]      = useState(false);
  const [result,       setResult]       = useState(null);
  const [history,      setHistory]      = useState([]);

  // 載入本地補寄紀錄
  useEffect(() => {
    if (!authed) return;
    try {
      const saved = JSON.parse(localStorage.getItem('simax_resend_log') || '[]');
      setHistory(saved);
    } catch { /* ignore */ }
  }, [authed]);

  const handleAuth = (e) => {
    e.preventDefault();
    if (passcode === ADMIN_PASSWORD) { setAuthed(true); setAuthError(''); }
    else { setAuthError('密碼錯誤'); }
  };

  const handleResend = async (e) => {
    e.preventDefault();
    if (!orderId.trim() || !email.trim() || loading) return;
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
        const entry = {
          orderId:   orderId.trim(),
          email:     email.trim().toLowerCase(),
          time:      new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
          status:    'success',
        };
        const newHistory = [entry, ...history].slice(0, 20);
        setHistory(newHistory);
        try { localStorage.setItem('simax_resend_log', JSON.stringify(newHistory)); } catch { /* ignore */ }
        setResult({ ok: true, message: `✅ 信件已成功補寄至 ${email.trim()}` });
        setOrderId('');
        setEmail('');
      } else {
        setResult({ ok: false, message: `❌ ${data.error || '補寄失敗，請確認訂單編號是否正確'}` });
      }
    } catch (err) {
      setResult({ ok: false, message: `❌ 網路錯誤：${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>SIMAX 後台管理</title>
        <meta name="robots" content="noindex,nofollow" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { background: #f0f4f8; font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif; }
          input:focus { outline: none; border-color: #6366f1 !important; box-shadow: 0 0 0 3px rgba(99,102,241,0.12); }
          button:active { transform: scale(0.98); }
          ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 3px; }
        `}</style>
      </Head>

      {/* ── 頂部 Header ── */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e8eaed', padding: '0 32px', height: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>📡</div>
          <div>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a' }}>SIMAX 後台管理</span>
            <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 8 }}>Admin Console</span>
          </div>
        </div>
        {authed && (
          <button onClick={() => { setAuthed(false); setPasscode(''); }}
            style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 14px', fontSize: 12, color: '#6b7280', cursor: 'pointer' }}>
            登出
          </button>
        )}
      </div>

      <div style={{ minHeight: 'calc(100vh - 58px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: authed ? 'flex-start' : 'center', padding: authed ? '32px 24px' : 24 }}>

        {/* ════ 登入頁 ════ */}
        {!authed && (
          <div style={{ background: '#fff', borderRadius: 20, padding: '40px 36px', width: '100%', maxWidth: 380, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
            <div style={{ textAlign: 'center', marginBottom: 28 }}>
              <div style={{ width: 52, height: 52, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, margin: '0 auto 12px' }}>🔐</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#1a1a1a' }}>後台登入</div>
              <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 4 }}>SIMAX 管理人員專用</div>
            </div>
            <form onSubmit={handleAuth} autoComplete="off">
              <input
                type="password"
                style={{ width: '100%', padding: '13px 14px', fontSize: 15, borderRadius: 12, border: '1.5px solid #e5e7eb', fontFamily: 'inherit', color: '#1a1a1a', marginBottom: 8 }}
                value={passcode}
                onChange={e => { setPasscode(e.target.value); setAuthError(''); }}
                placeholder="輸入管理員密碼"
                autoFocus
              />
              {authError && <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 8, textAlign: 'center' }}>{authError}</div>}
              <button type="submit" style={{ width: '100%', padding: '13px 0', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: 'pointer', marginTop: 4 }}>
                進入後台
              </button>
            </form>
          </div>
        )}

        {/* ════ 主畫面 ════ */}
        {authed && (
          <div style={{ width: '100%', maxWidth: 960 }}>

            {/* 頁面標題 */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#1a1a1a' }}>📧 補寄確認信件</div>
              <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>顧客信箱輸入錯誤時，在此補寄含 QR Code 的確認信</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>

              {/* 左：補寄表單 */}
              <div style={{ background: '#fff', borderRadius: 16, padding: '24px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid #e8eaed' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a', marginBottom: 20, paddingBottom: 14, borderBottom: '1px solid #f3f4f6' }}>
                  訂單資訊
                </div>

                <form onSubmit={handleResend} autoComplete="off">
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                      MOMO 訂單編號 <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      type="text"
                      style={{ width: '100%', padding: '11px 14px', fontSize: 14, borderRadius: 10, border: '1.5px solid #e5e7eb', fontFamily: 'inherit', color: '#1a1a1a' }}
                      value={orderId}
                      onChange={e => { setOrderId(e.target.value); setResult(null); }}
                      placeholder="例：26051512526631"
                      autoFocus
                    />
                  </div>

                  <div style={{ marginBottom: 20 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                      正確收件信箱 <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      type="email"
                      style={{ width: '100%', padding: '11px 14px', fontSize: 14, borderRadius: 10, border: '1.5px solid #e5e7eb', fontFamily: 'inherit', color: '#1a1a1a' }}
                      value={email}
                      onChange={e => { setEmail(e.target.value); setResult(null); }}
                      placeholder="customer@example.com"
                    />
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>⚠️ 請務必確認信箱正確，系統會直接寄出</div>
                  </div>

                  {result && (
                    <div style={{ padding: '12px 16px', borderRadius: 10, marginBottom: 16, background: result.ok ? '#f0fdf4' : '#fef2f2', border: `1px solid ${result.ok ? '#86efac' : '#fca5a5'}`, fontSize: 13, color: result.ok ? '#15803d' : '#dc2626', lineHeight: 1.6 }}>
                      {result.message}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading || !orderId.trim() || !email.trim()}
                    style={{ width: '100%', padding: '13px 0', background: loading || !orderId.trim() || !email.trim() ? '#d1d5db' : '#16a34a', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: loading || !orderId.trim() || !email.trim() ? 'not-allowed' : 'pointer', transition: 'background 0.2s' }}
                  >
                    {loading ? '寄送中...' : '立即補寄'}
                  </button>
                </form>
              </div>

              {/* 右：補寄紀錄 */}
              <div style={{ background: '#fff', borderRadius: 16, padding: '24px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid #e8eaed' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a', marginBottom: 20, paddingBottom: 14, borderBottom: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>補寄紀錄</span>
                  <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>僅保留本裝置最近 20 筆</span>
                </div>

                {history.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: '#d1d5db' }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
                    <div style={{ fontSize: 13 }}>尚無補寄記錄</div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {history.map((h, i) => (
                      <div key={i} style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 14px', border: '1px solid #e8eaed' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{h.orderId}</div>
                            <div style={{ fontSize: 12, color: '#6366f1', marginTop: 2 }}>{h.email}</div>
                          </div>
                          <div style={{ flexShrink: 0 }}>
                            <span style={{ fontSize: 11, background: h.status === 'success' ? '#dcfce7' : '#fee2e2', color: h.status === 'success' ? '#16a34a' : '#dc2626', borderRadius: 6, padding: '2px 8px', fontWeight: 600 }}>
                              {h.status === 'success' ? '成功' : '失敗'}
                            </span>
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>{h.time}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 底部提示 */}
            <div style={{ marginTop: 20, padding: '14px 18px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 12, fontSize: 12, color: '#92400e', lineHeight: 1.7 }}>
              💡 <strong>Google Sheets 同步：</strong>每次補寄成功後，系統會自動在 Google Sheets 的自助領取紀錄中，於對應訂單列的備註欄寫入「補寄：收件人信箱 | 時間」，方便追蹤。
            </div>
          </div>
        )}
      </div>
    </>
  );
}
