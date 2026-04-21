import Head from 'next/head';
import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

// Step progress bar
function StepBar({ step }) {
    return (
          <div className="steps">
            <div className="step">
              <div className={`step-dot ${step >= 1 ? (step > 1 ? 'done' : 'active') : ''}`}>
{step > 1 ? 'v' : '1'}
</div>
        <span className={`step-label ${step === 1 ? 'active' : ''}`}>PIN</span>
  </div>
      <div className={`step-line ${step >= 2 ? 'active' : ''}`} />
      <div className="step">
          <div className={`step-dot ${step >= 2 ? (step > 2 ? 'done' : 'active') : ''}`}>
{step > 2 ? 'v' : '2'}
</div>
        <span className={`step-label ${step === 2 ? 'active' : ''}`}>Email</span>
  </div>
      <div className={`step-line ${step >= 3 ? 'active' : ''}`} />
      <div className="step">
          <div className={`step-dot ${step >= 3 ? 'active' : ''}`}>3</div>
        <span className={`step-label ${step === 3 ? 'active' : ''}`}>eSIM</span>
  </div>
  </div>
  );
}

// DJB QR Code result
function ResultDjb({ data }) {
    const qr = data.qr_code_data || '';
    const isUrl = qr.startsWith('http');
    return (
          <div className="result-card">
            <div style={{ fontSize: 36, marginBottom: 8 }}>🎉</div>
      <div className="result-title">eSIM 領取成功！</div>
      <div className="result-sub">請掃描 QR Code 或點擊連結啟用您的 eSIM</div>
      <div className="qr-wrap">
          <QRCodeSVG value={qr} size={200} level="M" includeMargin={false} />
  </div>
{isUrl && (
          <div style={{ marginTop: 12 }}>
          <a href={qr} target="_blank" rel="noopener noreferrer"
             style={{ color: 'var(--brand)', fontSize: 13, textDecoration: 'underline', wordBreak: 'break-all' }}>
{qr}
</a>
  </div>
      )}
      <div className="qr-raw">
                <span style={{ color: 'var(--muted)', fontSize: 10, display: 'block', marginBottom: 4 }}>啟用碼</span>
{qr}
</div>
      <div className="result-order-id">訂單編號：{data.order_id}</div>
  </div>
  );
}

// WM result (code sent by email)
function ResultWm({ data }) {
    return (
          <div className="result-card">
            <div style={{ fontSize: 36, marginBottom: 8 }}>✉️</div>
      <div className="result-title">eSIM 兌換碼已寄出！</div>
        <div className="result-sub">
          世界移動將於數分鐘內將兌換碼寄至<br />
          <strong style={{ color: 'var(--brand)' }}>{data.customer_email}</strong>
        </div>
        <div className="result-order-id">訂單編號：{data.order_id}</div>
      <p style={{ marginTop: 16, fontSize: 12, color: 'var(--muted)' }}>
        若超過 30 分鐘未收到，請檢查垃圾郵件或聯繫客服。
  </p>
</div>
    );
}

  // DJB pending result
  function ResultPending({ data }) {
      return (
            <div className="status-pending">
                      <div className="icon">⏳</div>
                <h3>eSIM 準備中</h3>
            <p>
        您的訂單 <strong style={{ color: '#fbbf24' }}>{data.order_id}</strong><br />
        正在建立 eSIM，通常需要 5-15 分鐘。
        </p>
      <p style={{ marginTop: 10, fontSize: 12 }}>如超過 30 分鐘請聯繫客服。</p>
    </div>
    );
}

 // Main page
      export default function ClaimPage() {
          const [ticketPin,  setTicketPin]  = useState('');
    const [email,      setEmail]      = useState('');
          const [result,     setResult]     = useState(null);
  const [loading,    setLoading]    = useState(false);
    const [error,      setError]      = useState('');

          const showEmailField = ticketPin.trim().length > 0;
                        const currentStep    = result ? 3 : showEmailField ? 2 : 1;
  const canSubmit      = ticketPin.trim().length > 0 && email.trim().length > 5 && !loading;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
            setError('');
        setResult(null);
      try {
            const res = await fetch('/api/claim', {
            method:  'POST',
        headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ ticketPin: ticketPin.trim(), email: email.trim() }),
});
        const data = await res.json();
              if (!res.ok) throw new Error(data.error || `發生錯誤 (${res.status})`);
              setResult(data);
      } catch (err) {
              setError(err.message);
      } finally {
              setLoading(false);
      }
  };

  const handleReset = () => {
        setTicketPin(''); setEmail(''); setResult(null); setError('');
  };

  const isWmResult   = result?.qr_code_data?.startsWith('WM_ORDER:');
          const isDjbPending = result?.qr_code_data?.startsWith('DJB_PENDING:');
          const isDjbSuccess = result?.success && !isWmResult && !isDjbPending;

  return (
        <>
          <Head>
            <title>SIMAX eSIM 領取中心</title>
                <meta name="description" content="輸入 MOMO 票券序號，立即領取您的 eSIM" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
    </Head>
              <div className="page">
            <div className="card">
              <div className="logo-wrap">
                <div className="logo-icon">📡</div>
                    <div className="logo-title">SIMAX eSIM 領取中心</div>
                    <div className="logo-sub">輸入 MOMO 票券序號，立即取得您的 eSIM</div>
    </div>
                  <StepBar step={currentStep} />
  {result ? (
                <>
    {isDjbSuccess   && <ResultDjb   data={result} />}
{isWmResult     && <ResultWm    data={{ ...result, customer_email: email }} />}
{isDjbPending   && <ResultPending data={result} />}
              <button className="btn-submit"
                 style={{ marginTop: 20, background: 'rgba(255,255,255,0.08)', boxShadow: 'none', color: 'var(--muted)' }}
                onClick={handleReset}>
                                  ← 查詢其他票券
                  </button>
                  </>
          ) : (
                        <form className="form" onSubmit={handleSubmit} autoComplete="off">
                          <div className="field">
                            <label>MOMO 票券序號（PIN碼）</label>
                <input
                  type="text"
                  placeholder="請輸入 MOMO 電子票券序號"
                  value={ticketPin}
                  onChange={(e) => { setTicketPin(e.target.value); setError(''); setResult(null); }}
                  autoFocus autoComplete="off" spellCheck={false}
                />
                                    <span className="hint">💡 至 MOMO 購物 App「訂單明細 → 電子票券」查看序號</span>
                    </div>
              <div className={`second-field ${showEmailField ? 'visible' : ''}`}>
                <div className="field">
                                      <label>聯絡 Email</label>
                  <input
                    type="email"
                    placeholder="例：user@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                                        <span className="hint">請輸入下單時使用的電子信箱</span>
                      </div>
                      </div>
{error && (
                  <div className="error-box">
                    <span>⚠️</span>
                   <span>{error}</span>
  </div>
               )}
              <button type="submit" className="btn-submit" disabled={!canSubmit}>
              {loading ? <><span className="spinner" /> 核銷中，請稍候...</> : '核銷領取 eSIM →'}
                </button>
                </form>
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
