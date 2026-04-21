import Head from 'next/head';
import { useState, useRef, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';

// ─── 平台辨識邏輯 ────────────────────────────────────────────────────────────
/**
 * 根據訂單編號格式即時判斷來源平台
 * @param {string} raw - 使用者輸入的原始訂單編號
 * @returns {'MOMO'|'SHOPEE'|'OFFICIAL'|null}
 */
function detectPlatform(raw) {
  if (!raw || raw.trim().length === 0) return null;
  const val = raw.trim();

  // MOMO：去除 '-' 後為純數字且長度 >= 12
  // 例：20160108063116-001-001-001  或  20250101123456
  const noHyphen = val.replace(/-/g, '');
  if (/^[\d-]{12,}$/.test(val) && /^\d+$/.test(noHyphen) && noHyphen.length >= 12) {
    return 'MOMO';
  }

  // SHOPEE：14-15 碼英數混合大寫 (包含至少一個英文字母)
  // 例：2602099DFW8JFR
  if (/^[A-Z0-9]{14,15}$/i.test(val) && /[A-Za-z]/.test(val)) {
    return 'SHOPEE';
  }

  // OFFICIAL：# 前綴、品牌前綴 SIMAX，或短純數字 (1-10碼)
  if (/^#\d+$/.test(val) || /^SIMAX\d+$/i.test(val) || /^\d{1,10}$/.test(val)) {
    return 'OFFICIAL';
  }

  return null;
}

const PLATFORM_META = {
  MOMO:     { label: 'MOMO 購物', color: 'badge-momo',     emoji: '🛍️', verify: 'phone' },
  SHOPEE:   { label: '蝦皮購物',  color: 'badge-shopee',   emoji: '🦀', verify: 'email' },
  OFFICIAL: { label: '官方網站',  color: 'badge-official', emoji: '🌐', verify: 'email' },
};

// ─── 步驟進度條 ────────────────────────────────────────────────────────────
function StepBar({ step }) {
  // step: 1=輸入訂單, 2=驗證身份, 3=完成領取
  return (
    <div className="steps">
      <div className="step">
        <div className={`step-dot ${step >= 1 ? (step > 1 ? 'done' : 'active') : ''}`}>
          {step > 1 ? '✓' : '1'}
        </div>
        <span className={`step-label ${step === 1 ? 'active' : ''}`}>輸入訂單</span>
      </div>
      <div className={`step-line ${step >= 2 ? 'active' : ''}`} />
      <div className="step">
        <div className={`step-dot ${step >= 2 ? (step > 2 ? 'done' : 'active') : ''}`}>
          {step > 2 ? '✓' : '2'}
        </div>
        <span className={`step-label ${step === 2 ? 'active' : ''}`}>驗證身份</span>
      </div>
      <div className={`step-line ${step >= 3 ? 'active' : ''}`} />
      <div className="step">
        <div className={`step-dot ${step >= 3 ? 'active' : ''}`}>3</div>
        <span className={`step-label ${step === 3 ? 'active' : ''}`}>領取 eSIM</span>
      </div>
    </div>
  );
}

// ─── 結果顯示：成功 ────────────────────────────────────────────────────────
function ResultSuccess({ data }) {
  const isUrl = data.qr_code_data?.startsWith('http');
  return (
    <div className="result-card">
      <div style={{ fontSize: 36, marginBottom: 8 }}>🎉</div>
      <div className="result-title">eSIM 領取成功！</div>
      <div className="result-sub">請掃描以下 QR Code 或點擊連結啟用您的 eSIM</div>

      {data.qr_code_data && (
        <>
          <div className="qr-wrap">
            <QRCodeSVG
              value={data.qr_code_data}
              size={200}
              level="M"
              includeMargin={false}
            />
          </div>

          {isUrl && (
            <div style={{ marginTop: 12 }}>
              <a
                href={data.qr_code_data}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--brand)',
                  fontSize: 13,
                  textDecoration: 'underline',
                  wordBreak: 'break-all',
                }}
              >
                {data.qr_code_data}
              </a>
            </div>
          )}

          <div className="qr-raw">
            <span style={{ color: 'var(--muted)', fontSize: 10, display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>啟用碼</span>
            {data.qr_code_data}
          </div>
        </>
      )}

      <div className="result-order-id">訂單編號：{data.order_id}</div>
    </div>
  );
}

// ─── 結果顯示：待處理 ──────────────────────────────────────────────────────
function ResultPending({ orderId }) {
  return (
    <div className="status-pending">
      <div className="icon">⏳</div>
      <h3>eSIM 準備中</h3>
      <p>
        您的訂單 <strong style={{ color: '#fbbf24' }}>{orderId}</strong> 正在處理中，<br />
        通常需要 5-15 分鐘，請稍候再試。
      </p>
      <p style={{ marginTop: 10, fontSize: 12 }}>如超過 30 分鐘請聯繫客服。</p>
    </div>
  );
}

// ─── 主頁面 ────────────────────────────────────────────────────────────────
export default function ClaimPage() {
  const [orderId, setOrderId]       = useState('');
  const [platform, setPlatform]     = useState(null);
  const [verifyData, setVerifyData] = useState('');
  const [result, setResult]         = useState(null);   // { status, qr_code_data, order_id }
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');

  const verifyRef = useRef(null);

  // 計算目前在第幾步
  const currentStep = result ? 3 : platform ? 2 : 1;

  // ── 訂單號碼變動：即時偵測平台 ──
  const handleOrderChange = (e) => {
    const val = e.target.value;
    setOrderId(val);
    const detected = detectPlatform(val);
    if (detected !== platform) {
      setPlatform(detected);
      setVerifyData('');
    }
    setError('');
    setResult(null);
  };

  // 偵測到平台後，自動 focus 第二個欄位
  useEffect(() => {
    if (platform && verifyRef.current) {
      setTimeout(() => verifyRef.current?.focus(), 320);
    }
  }, [platform]);

  // ── 送出表單 ──
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!platform) return;

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const res = await fetch('/api/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId:    orderId.trim(),
          platform,
          verifyData: verifyData.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || `查詢失敗 (${res.status})`);
      }

      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── 重置 ──
  const handleReset = () => {
    setOrderId('');
    setPlatform(null);
    setVerifyData('');
    setResult(null);
    setError('');
  };

  const meta = platform ? PLATFORM_META[platform] : null;
  const canSubmit = platform && verifyData.trim().length > 0 && !loading;

  return (
    <>
      <Head>
        <title>SIMAX eSIM 領取中心</title>
        <meta name="description" content="輸入訂單編號，立即領取您的 eSIM QR Code" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="page">
        <div className="card">

          {/* Logo */}
          <div className="logo-wrap">
            <div className="logo-icon">📡</div>
            <div className="logo-title">SIMAX eSIM 領取中心</div>
            <div className="logo-sub">輸入訂單編號，立即取得您的 eSIM</div>
          </div>

          {/* 步驟進度 */}
          <StepBar step={currentStep} />

          {/* ── 結果顯示 ── */}
          {result ? (
            <>
              {result.status === 'ready_to_claim' || result.status === 'claimed'
                ? <ResultSuccess data={result} />
                : <ResultPending orderId={result.order_id || orderId} />
              }
              <button
                className="btn-submit"
                style={{ marginTop: 20, background: 'rgba(255,255,255,0.08)', boxShadow: 'none', color: 'var(--muted)' }}
                onClick={handleReset}
              >
                ← 查詢其他訂單
              </button>
            </>
          ) : (
            /* ── 輸入表單 ── */
            <form className="form" onSubmit={handleSubmit} autoComplete="off">

              {/* 訂單編號欄 */}
              <div className="field">
                <label>
                  訂單編號
                  {meta && (
                    <span className={`platform-badge ${meta.color}`}>
                      {meta.emoji} {meta.label}
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  placeholder="輸入 MOMO / 蝦皮 / 官網訂單編號"
                  value={orderId}
                  onChange={handleOrderChange}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                />
                {!platform && orderId.length > 3 && (
                  <span className="hint">⚠️ 無法辨識平台，請確認訂單號碼格式</span>
                )}
                {platform === 'MOMO' && (
                  <span className="hint">💡 MOMO 訂單通常為 14 碼以上純數字，如：20250101123456</span>
                )}
                {platform === 'SHOPEE' && (
                  <span className="hint">💡 蝦皮訂單通常為 14-15 碼英數混合，如：2602099DFW8JFR</span>
                )}
              </div>

              {/* 第二驗證欄（動態顯示） */}
              <div className={`second-field ${platform ? 'visible' : ''}`}>
                <div className="field">
                  {platform === 'MOMO' ? (
                    <>
                      <label>手機號碼（驗證用）</label>
                      <input
                        ref={verifyRef}
                        type="tel"
                        placeholder="例：0912345678"
                        value={verifyData}
                        onChange={(e) => setVerifyData(e.target.value)}
                        autoComplete="tel"
                        maxLength={10}
                      />
                      <span className="hint">請輸入下單時使用的手機號碼</span>
                    </>
                  ) : (
                    <>
                      <label>電子信箱（驗證用）</label>
                      <input
                        ref={verifyRef}
                        type="email"
                        placeholder="例：user@example.com"
                        value={verifyData}
                        onChange={(e) => setVerifyData(e.target.value)}
                        autoComplete="email"
                      />
                      <span className="hint">請輸入下單時使用的電子信箱</span>
                    </>
                  )}
                </div>
              </div>

              {/* 錯誤提示 */}
              {error && (
                <div className="error-box">
                  <span>⚠️</span>
                  <span>{error}</span>
                </div>
              )}

              {/* 送出按鈕 */}
              <button
                type="submit"
                className="btn-submit"
                disabled={!canSubmit}
              >
                {loading ? (
                  <><span className="spinner" /> 查詢中...</>
                ) : (
                  '領取 eSIM →'
                )}
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
