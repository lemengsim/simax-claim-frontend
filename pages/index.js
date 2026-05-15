/**
 * 檔案：pages/index.js
 * 模組：SIMAX eSIM 領取中心前台（v2.25 — 方案資訊去背景卡片、排版強化）
 *
 * # v2.25.0 | 2026-05-15 | 方案區塊去框化：移除背景卡片、字體層次強化、間距重整
 * # v2.24.0 | 2026-05-15 | Step 3 新增「重發確認信件」按鈕，呼叫 /api/resend-notify
 * # v2.23.0 | 2026-05-15 | 啟用碼/訂單編號列：「點擊複製」文字改為小複製 Icon
 * # v2.22.0 | 2026-05-15 | Step 3：移除 QR 白框卡片、方案卡去 border/shadow，整體更清爽
 * # v2.21.0 | 2026-05-15 | Step 3：拿掉標題、方案卡改數位票卡風格、QR Code 加白框陰影、間距優化
 * # v2.20.0 | 2026-05-15 | Step 1/2/3 統一顯示「需要協助？聯繫售後客服」；移除 Footer 客服按鈕
 * # v2.19.0 | 2026-05-15 | 二次領取：展開 JSON 陣列格式 qr_code_data，多件正確顯示 Step 2
 * # v2.18.0 | 2026-05-15 | 啟用碼/訂單編號改為點擊整列複製；移除複製按鈕
 * # v2.17.0 | 2026-05-15 | 二次領取：verify 回傳 existingItems 時跳過 PIN 直接顯示 QR；Step 3 加客服連結
 * # v2.16.0 | 2026-05-15 | 售後客服改彈窗，顯示訂單編號讓顧客先複製再前往客服
 * # v2.15.0 | 2026-05-15 | 訂單編號一鍵複製；Footer 加售後客服連結
 * # v2.14.0 | 2026-05-15 | QRCodeSVG → QRCodeCanvas，手機長按可儲存圖片
 * # v2.13.0 | 2026-05-15 | Step 3 底部按鈕並排（領取其他票券 / 回首頁）；重新兌換改回首頁
 * # v2.12.0 | 2026-05-15 | Step 2 文案改「共N件eSIM」（去空格）；重新兌換按鈕 marginTop 32
 * # v2.11.0 | 2026-05-15 | 移除 Step 3「eSIM 領取成功！」上方 🎉 emoji
 * # v2.10.0 | 2026-05-15 | Step 2 標題文案改為「共N件eSIM · 可提早領取」；按鈕加大上方間距
 * # v2.9.0 | 2026-05-15 | 統一 Step 3 info block 字體/間距/對齊
 * # v2.8.0 | 2026-05-15 | 移除 header icon / 副標題；簡化 DJB 安裝說明文案
 * # v2.7.0 | 2026-05-15 | 整理 Step 3 info block：啟用碼+複製、訂單編號、ICCID
 * # v2.4.0 | 2026-05-15 | PIN 輸入框移除「例：AB1234567890」placeholder
 * # v2.3.0 | 2026-05-15 | PIN 輸入框 label 移至框內並加「共12碼」；「修改訂單編號」改為「回上一頁」
 * # v2.2.0 | 2026-05-14 | 修正 btn-submit CSS composes 無效問題；← 修改訂單按鈕改 btn-secondary；Email 存 localStorage
 * # v2.1.0 | 2026-05-14 | Multi-PIN：Step 1 拆成兩階段，第二階段收集所有電子票券序號
 * # v2.0.0 | 原始 Apple Minimalist 重構版
 *
 * 【UX 流程（v2.1）】
 *  Step 1a — 訂單驗證 : 輸入 MOMO 訂單編號 + Email → 呼叫 /api/verify → 得到 qty
 *  Step 1b — 票券序號 : 顯示 qty 個輸入框（12 碼英數字）→ 呼叫 /api/claim → 發貨
 *  Step 2  — Card List : 若 qty > 1，顯示商品卡片列表
 *  Step 3  — Dispatch  : 顯示 QR Code（DJB / WM / Pending 三種畫面）
 *
 * 【QR Code 類型判斷】
 *  qr_code_data.startsWith('LPA:')        → DJB eSIM，顯示 QR + iOS 安裝鈕
 *  qr_code_data.startsWith('WM_ORDER:')   → WM 廠商，顯示「已寄送」畫面
 *  qr_code_data.startsWith('DJB_PENDING:')→ 處理中，顯示「準備中」畫面
 *  其他 URL / 字串                         → DJB 舊格式，顯示 QR（無安裝鈕）
 */

import Head from 'next/head';
import { useState, useCallback, useEffect } from 'react';
import { QRCodeCanvas } from 'qrcode.react';

// localStorage keys
const LS_EMAIL_KEY = 'simax_saved_email';
const LS_CLAIM_KEY = 'simax_last_claim';

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
        <button className="btn-claimed" onClick={() => onClaim(item)}>查看 QR →</button>
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
  const [copied, setCopied]     = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  const handleCopy = useCallback(async () => {
    try { await navigator.clipboard.writeText(qr); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  }, [qr]);

  const handleCopyId = useCallback(async () => {
    try { await navigator.clipboard.writeText(item.order_id || ''); setCopiedId(true); setTimeout(() => setCopiedId(false), 2000); } catch { /* ignore */ }
  }, [item.order_id]);

  // 嘗試將「日本,吃到飽,1天」格式拆成各部分，用分隔線顯示
  const planParts = item.product_name
    ? item.product_name.split(',').map(p => p.trim()).filter(Boolean)
    : [];

  return (
    <div className="result-card">

      {/* ── 方案資訊（去框化，純文字層次）── */}
      {item.product_name && (
        <div style={{ textAlign: 'center', marginTop: 8, marginBottom: 4 }}>
          <div style={{ fontSize: 11, color: '#8E8E93', marginBottom: 8, letterSpacing: '0.2px' }}>
            📡 &nbsp;您的 eSIM 方案
          </div>
          {planParts.length >= 2 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', rowGap: 4 }}>
              {planParts.map((part, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center' }}>
                  <span style={{ fontSize: 22, fontWeight: 700, color: '#1C1C1E', lineHeight: 1.2 }}>{part}</span>
                  {i < planParts.length - 1 && (
                    <span style={{ color: '#D1D1D6', fontSize: 18, fontWeight: 300, margin: '0 10px' }}>|</span>
                  )}
                </span>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 22, fontWeight: 700, color: '#1C1C1E', lineHeight: 1.3 }}>{item.product_name}</div>
          )}
        </div>
      )}

      {/* ── 引導文字（輕量化）── */}
      <div style={{ marginTop: 24, marginBottom: 8, fontSize: 12, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.5 }}>
        {isLpa ? '點擊下方按鈕，或長按 QR Code 儲存圖片' : '請掃描以下 QR Code 或點擊連結啟用您的 eSIM'}
      </div>

      {/* ── QR Code ── */}
      <div className="qr-wrap">
        <QRCodeCanvas
          value={qr}
          size={200}
          level="M"
          includeMargin={false}
          style={{ display: 'block', borderRadius: 6 }}
        />
      </div>

      {/* ── iOS 一鍵安裝（僅 LPA 格式）── */}
      {isLpa && (
        <a
          href={`${IOS_SETUP_BASE}${encodeURIComponent(qr)}`}
          className="btn-ios"
          style={{ display: 'flex', textDecoration: 'none', marginTop: 20 }}
        >
          <span style={{ fontSize: 20 }}></span>
          <span>一鍵立即安裝 eSIM</span>
        </a>
      )}

      {/* ── URL 連結（舊格式）── */}
      {isUrl && !isLpa && (
        <div style={{ marginTop: 14 }}>
          <a href={qr} target="_blank" rel="noopener noreferrer"
             style={{ color: 'var(--brand)', fontSize: 13, textDecoration: 'underline', wordBreak: 'break-all' }}>
            {qr}
          </a>
        </div>
      )}

      {/* ── 資訊列：啟用碼 / 訂單編號 / ICCID ── */}
      <div style={{ width: '100%', marginTop: 20, borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden', textAlign: 'left' }}>

        {/* 啟用碼 */}
        <div onClick={handleCopy} style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: copied ? 'rgba(99,102,241,0.06)' : 'transparent', transition: 'background 0.2s' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>啟用碼</div>
            {copied
              ? <span style={{ fontSize: 11, color: 'var(--brand)', fontWeight: 600 }}>✓ 已複製</span>
              : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
            }
          </div>
          <div style={{ fontFamily: "'SF Mono', 'Menlo', monospace", fontSize: 13, wordBreak: 'break-all', color: 'var(--text)', lineHeight: 1.6 }}>{qr}</div>
        </div>

        {/* 訂單編號 */}
        {item.order_id && (
          <div onClick={handleCopyId} style={{ padding: '12px 14px', borderBottom: item.iccid ? '1px solid var(--border)' : 'none', cursor: 'pointer', background: copiedId ? 'rgba(99,102,241,0.06)' : 'transparent', transition: 'background 0.2s' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>訂單編號</div>
              {copiedId
                ? <span style={{ fontSize: 11, color: 'var(--brand)', fontWeight: 600 }}>✓ 已複製</span>
                : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
              }
            </div>
            <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.4 }}>{item.order_id}</div>
          </div>
        )}

        {/* ICCID */}
        {item.iccid && (
          <div style={{ padding: '12px 14px' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 5 }}>ICCID</div>
            <div style={{ fontFamily: "'SF Mono', 'Menlo', monospace", fontSize: 13, color: 'var(--text)', letterSpacing: '0.3px', lineHeight: 1.4 }}>{item.iccid}</div>
          </div>
        )}

      </div>

      {/* ── 截圖提醒 ── */}
      <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 12, padding: '12px 16px', marginTop: 18, textAlign: 'left' }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#92400e', marginBottom: 4 }}>【小提醒】</div>
        <div style={{ fontSize: 13, color: '#78350f', lineHeight: 1.7 }}>
          若您稍後才要安裝，建議先將此 QR Code 截圖保存。<br />
          日後需要使用時，直接掃描圖片即可輕鬆安裝。
        </div>
      </div>

    </div>
  );
}

// ─── 結果：WM（兌換碼由 WM 直接寄信） ────────────────────────────────────
function ResultWm({ item, email, onBack }) {
  return (
    <div className="result-wm">
      <div style={{ fontSize: 40, marginBottom: 12 }}>✉️</div>
      <div className="result-title">兌換碼已寄出！</div>
      {item.product_name && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px', margin: '10px 0 4px', textAlign: 'left' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>您的 eSIM 方案</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{item.product_name}</div>
        </div>
      )}
      <div className="result-sub" style={{ marginBottom: 16 }}>
        世界移動將於數分鐘內將兌換碼寄至<br />
        <strong style={{ color: 'var(--brand)' }}>{email}</strong>
      </div>
      {item.order_id && <div className="result-order-id">訂單編號：{item.order_id}</div>}
      <p style={{ marginTop: 16, fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
        若超過 30 分鐘未收到，請檢查垃圾郵件或聯繫客服。
      </p>
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
      {item.product_name && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px', margin: '8px 0', textAlign: 'left' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>您的 eSIM 方案</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{item.product_name}</div>
        </div>
      )}
      <p>
        您的訂單 <strong style={{ color: '#f59e0b' }}>{item.order_id}</strong><br />
        正在建立 eSIM，通常需要 5–15 分鐘，<br />請稍候後重新輸入序號查詢。
      </p>
      <p style={{ marginTop: 10, fontSize: 12 }}>如超過 30 分鐘請聯繫客服。</p>
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

// ─── 電子票券序號格式正則（12 碼英數字）────────────────────────────────────
const CUSTOMER_PIN_REGEX = /^[A-Za-z0-9]{12}$/;

// ─── 主頁面 ────────────────────────────────────────────────────────────────
export default function ClaimPage() {
  // ── 表單狀態 ──
  const [orderNo,  setOrderNo]  = useState('');
  const [email,    setEmail]    = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  // ── 步驟狀態（1=訂單驗證, 1b=票券序號, 2=CardList, 3=Dispatch） ──
  const [step,          setStep]          = useState(1);
  const [phase,         setPhase]         = useState('order');  // 'order' | 'pins'
  const [verifiedQty,   setVerifiedQty]   = useState(1);        // 從 /api/verify 拿到的張數
  const [ticketPins,    setTicketPins]    = useState(['']);      // 電子票券序號輸入陣列
  const [items,         setItems]         = useState([]);
  const [activeItem,    setActiveItem]    = useState(null);
  const [claimingId,    setClaimingId]    = useState(null);
  const [specialStatus, setSpecialStatus] = useState(null);
  const [showCsModal,   setShowCsModal]   = useState(false);
  const [csCopied,      setCsCopied]      = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendDone,    setResendDone]    = useState(false);

  const canSubmitOrder = orderNo.trim().length > 0 && email.trim().length > 5 && !loading;
  const hasDuplicatePin = ticketPins.length > 1 && new Set(ticketPins.map(p => p.trim().toUpperCase()).filter(p => p)).size < ticketPins.filter(p => p.trim()).length;
  const canSubmitPins  = ticketPins.every(p => CUSTOMER_PIN_REGEX.test(p.trim())) && !hasDuplicatePin && !loading;

  // ── mount：還原上次領取記錄 ───────────────────────────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_CLAIM_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // 支援新格式 { orderNo, items } 與舊格式（純陣列）
        const itemList = Array.isArray(parsed) ? parsed : parsed?.items;
        if (itemList && itemList.length > 0) {
          setItems(itemList);
          if (itemList.length === 1) {
            setActiveItem(itemList[0]);
            setStep(3);
          } else {
            setStep(2);
          }
        }
      }
    } catch { /* ignore */ }
  }, []);

  // ── Step 1a：送出訂單編號 + Email → 驗證 qty ─────────────────────────
  const handleVerify = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res  = await fetch('/api/verify', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ orderNo: orderNo.trim(), email: email.trim() }),
      });
      const data = await res.json();

      if (data.status === 'ORDER_RECOVERING') {
        setSpecialStatus('TICKET_REFUNDED');
        return;
      }
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || `發生錯誤 (${res.status})`);
      }

      // ① 若 Supabase 已有出貨記錄（任何裝置二次領取），直接跳過 PIN
      if (data.existingItems && data.existingItems.length > 0) {
        const ei = data.existingItems;

        // 展開 JSON 陣列格式的 qr_code_data（多件訂單儲存為單一記錄時）
        const expandedItems = [];
        for (const item of ei) {
          if (item.qr_code_data && item.qr_code_data.startsWith('[')) {
            try {
              const qrArr = JSON.parse(item.qr_code_data);
              if (Array.isArray(qrArr) && qrArr.length > 0) {
                qrArr.forEach((qr, idx) => expandedItems.push({
                  ...item,
                  order_id:     `${item.order_id}-item${idx + 1}`,
                  qr_code_data: qr,
                }));
              } else {
                expandedItems.push(item);
              }
            } catch { expandedItems.push(item); }
          } else {
            expandedItems.push(item);
          }
        }

        setItems(expandedItems);
        try { localStorage.setItem(LS_CLAIM_KEY, JSON.stringify({ orderNo: orderNo.trim(), items: expandedItems })); } catch { /* ignore */ }
        if (expandedItems.length === 1) { setActiveItem(expandedItems[0]); setStep(3); }
        else { setStep(2); }
        return;
      }

      // ② 若此裝置 localStorage 有快取，直接跳過 PIN
      try {
        const cached = JSON.parse(localStorage.getItem(LS_CLAIM_KEY) || 'null');
        const cachedItems = cached?.items || (Array.isArray(cached) ? cached : null);
        if (cachedItems && cached?.orderNo === orderNo.trim() && cachedItems.length > 0) {
          setItems(cachedItems);
          if (cachedItems.length === 1) { setActiveItem(cachedItems[0]); setStep(3); }
          else { setStep(2); }
          return;
        }
      } catch { /* ignore */ }

      // ③ 首次領取 → 進入 PIN 輸入
      const qty = data.qty || 1;
      setVerifiedQty(qty);
      setTicketPins(Array(qty).fill(''));
      setPhase('pins');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Step 1b：送出所有電子票券序號 → 發貨 ────────────────────────────
  const handleClaim = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res  = await fetch('/api/claim', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          orderNo:    orderNo.trim(),
          email:      email.trim(),
          ticketPins: ticketPins.map(p => p.trim()),
        }),
      });
      const data = await res.json();

      if (data.status === 'ORDER_RECOVERING' || data.status === 'TICKET_REFUNDED') {
        setSpecialStatus('TICKET_REFUNDED');
        return;
      }
      if (!res.ok) {
        throw new Error(data.error || data.message || `發生錯誤 (${res.status})`);
      }
      if (!data.success) {
        throw new Error(data.message || data.error || '處理失敗，請聯繫客服');
      }

      const normalized = normalizeResponse(data);
      setItems(normalized);
      try { localStorage.setItem(LS_CLAIM_KEY, JSON.stringify({ orderNo: orderNo.trim(), items: normalized })); } catch { /* ignore */ }

      if (normalized.length === 1) {
        setActiveItem(normalized[0]);
        setStep(3);
      } else {
        setStep(2);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2：Card List 點擊「領取」───────────────────────────────────────
  const handleSelectItem = useCallback((item) => {
    setActiveItem(item);
    setStep(3);
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
    try { localStorage.removeItem(LS_EMAIL_KEY); } catch {}
    setError('');
    setItems([]);
    setActiveItem(null);
    setClaimingId(null);
    setSpecialStatus(null);
    setPhase('order');
    setVerifiedQty(1);
    setTicketPins(['']);
    setStep(1);
  }, []);

  // ── 重發確認信件 ──────────────────────────────────────────────────────
  const handleResendEmail = useCallback(async () => {
    if (!activeItem || resendLoading || resendDone) return;
    setResendLoading(true);
    try {
      await fetch('/api/resend-notify', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ orderId: activeItem.order_id, email: email.trim() }),
      });
      setResendDone(true);
      setTimeout(() => setResendDone(false), 6000);
    } catch { /* ignore */ }
    finally { setResendLoading(false); }
  }, [activeItem, email, resendLoading, resendDone]);

  // ── 當前 Step 3 顯示類型 ─────────────────────────────────────────────
  const qrType = activeItem ? getQrType(activeItem.qr_code_data) : null;

  // ── 多件時返回按鈕設定 ────────────────────────────────────────────────
  const backHandler = items.length > 1 ? handleBackToList : null;

  // ── 票券序號輸入框更新 ────────────────────────────────────────────────
  const handlePinChange = (idx, val) => {
    setTicketPins(prev => prev.map((p, i) => i === idx ? val : p));
    setError('');
  };

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
          </div>

          {/* ════════════════ 特殊狀態：票券退款 / 作廢 / 查無此票 ═══════════ */}
          {specialStatus === 'TICKET_REFUNDED' && (
            <ResultRefunded onConfirm={handleReset} />
          )}

          {/* ── 步驟進度條 + 步驟內容（特殊狀態時整體隱藏） ── */}
          {!specialStatus && <StepBar step={step} />}

          {/* ════════════════ STEP 1a：輸入訂單編號 + Email ════════════════ */}
          {!specialStatus && step === 1 && phase === 'order' && (
            <form className="form" onSubmit={handleVerify} autoComplete="off">

              <div className="field">
                <input
                  type="text"
                  placeholder="MOMO 訂單編號"
                  value={orderNo}
                  onChange={(e) => { setOrderNo(e.target.value.trim()); setError(''); }}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>

              <div className="field">
                <input
                  type="email"
                  placeholder="信箱"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>

              {error && (
                <div className="error-box">
                  <span>⚠️</span>
                  <span>{error}</span>
                </div>
              )}

              <button type="submit" className="btn-submit" disabled={!canSubmitOrder}>
                {loading
                  ? <><span className="spinner" /> 驗證中，請稍候...</>
                  : '下一步 →'
                }
              </button>

              <div style={{ textAlign: 'center', marginTop: 14 }}>
                <button
                  type="button"
                  onClick={() => { setShowCsModal(true); setCsCopied(false); }}
                  style={{ background: 'none', border: 'none', padding: 0, color: 'var(--muted)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}
                >
                  需要協助？聯繫售後客服
                </button>
              </div>

            </form>
          )}

          {/* ════════════════ STEP 1b：輸入電子票券序號 ════════════════ */}
          {!specialStatus && step === 1 && phase === 'pins' && (
            <form className="form" onSubmit={handleClaim} autoComplete="off">

              <div style={{ marginBottom: 16, padding: '10px 14px', background: 'rgba(99,102,241,0.06)', borderRadius: 10, fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
                📋 訂單共 <strong style={{ color: 'var(--brand)' }}>{verifiedQty} 張</strong> eSIM，請輸入所有電子票券序號才能領取。
              </div>

              {ticketPins.map((pin, idx) => (
                <div className="field" key={idx}>
                  <input
                    type="text"
                    placeholder={`電子票券序號${verifiedQty > 1 ? `（第 ${idx + 1} 張）` : ''}　共12碼`}
                    value={pin}
                    onChange={(e) => handlePinChange(idx, e.target.value.toUpperCase())}
                    autoFocus={idx === 0}
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={12}
                    style={{ fontFamily: 'monospace', letterSpacing: '0.05em' }}
                  />
                  {pin.length > 0 && !CUSTOMER_PIN_REGEX.test(pin.trim()) && (
                    <span className="hint" style={{ color: '#ef4444' }}>⚠️ 需為 12 碼英數字</span>
                  )}
                  {pin.length > 0 && CUSTOMER_PIN_REGEX.test(pin.trim()) && ticketPins.some((p, i) => i !== idx && p.trim().toUpperCase() === pin.trim().toUpperCase()) && (
                    <span className="hint" style={{ color: '#ef4444' }}>⚠️ 票券序號不能重複</span>
                  )}
                </div>
              ))}

              {error && (
                <div className="error-box">
                  <span>⚠️</span>
                  <span>{error}</span>
                </div>
              )}

              <button type="submit" className="btn-submit" disabled={!canSubmitPins}>
                {loading
                  ? <><span className="spinner" /> 核銷中，請稍候...</>
                  : '核銷領取 eSIM →'
                }
              </button>

              <button
                type="button"
                className="btn-secondary"
                style={{ marginTop: 8 }}
                onClick={() => { setPhase('order'); setError(''); setTicketPins(Array(verifiedQty).fill('')); setOrderNo(''); setEmail(''); try { localStorage.removeItem(LS_EMAIL_KEY); } catch {}; }}
              >
                ← 回上一頁
              </button>

              <div style={{ textAlign: 'center', marginTop: 14 }}>
                <button
                  type="button"
                  onClick={() => { setShowCsModal(true); setCsCopied(false); }}
                  style={{ background: 'none', border: 'none', padding: 0, color: 'var(--muted)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}
                >
                  需要協助？聯繫售後客服
                </button>
              </div>

            </form>
          )}

          {/* ════════════════ STEP 2：Card List ════════════════ */}
          {!specialStatus && step === 2 && (
            <div>
              <div className="list-header">
                <div style={{ fontSize: 15, color: 'var(--muted)', textAlign: 'center' }}>共{items.length}件eSIM · 可提早領取</div>
              </div>

              <div className="card-list">
                {items.map((item, i) => (
                  <ItemCard
                    key={item.order_id || i}
                    item={item}
                    onClaim={handleSelectItem}
                    claiming={claimingId === item.order_id}
                  />
                ))}
              </div>

              <div style={{ marginTop: 32 }}>
                <button
                  className="btn-submit"
                  style={{ background: 'rgba(0,0,0,0.04)', boxShadow: 'none', color: 'var(--muted)', fontSize: 13 }}
                  onClick={handleReset}
                >
                  回首頁
                </button>
              </div>

              <div style={{ textAlign: 'center', marginTop: 14 }}>
                <button
                  onClick={() => { setShowCsModal(true); setCsCopied(false); }}
                  style={{ background: 'none', border: 'none', padding: 0, color: 'var(--muted)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}
                >
                  需要協助？聯繫售後客服
                </button>
              </div>
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

              <div className="divider" style={{ marginTop: 28 }} />

              <div style={{ display: 'flex', gap: 8 }}>
                {backHandler && (
                  <button
                    className="btn-submit"
                    style={{ flex: 1, background: 'rgba(0,0,0,0.04)', boxShadow: 'none', color: 'var(--muted)', fontSize: 13 }}
                    onClick={backHandler}
                  >
                    領取其他票券
                  </button>
                )}
                <button
                  className="btn-submit"
                  style={{ flex: 1, background: 'rgba(0,0,0,0.04)', boxShadow: 'none', color: 'var(--muted)', fontSize: 13 }}
                  onClick={handleReset}
                >
                  回首頁
                </button>
              </div>

              {/* 重發信件 */}
              <div style={{ textAlign: 'center', marginTop: 12 }}>
                <button
                  onClick={handleResendEmail}
                  disabled={resendLoading || resendDone}
                  style={{
                    background: resendDone ? 'rgba(99,102,241,0.08)' : 'var(--surface)',
                    border: 'none',
                    borderRadius: 10,
                    padding: '10px 20px',
                    fontSize: 13,
                    color: resendDone ? 'var(--brand)' : 'var(--muted)',
                    cursor: resendLoading || resendDone ? 'default' : 'pointer',
                    width: '100%',
                    fontWeight: resendDone ? 600 : 400,
                    transition: 'all 0.2s',
                  }}
                >
                  {resendLoading ? '寄送中...' : resendDone ? '✓ 確認信已重發至您的信箱' : '📧 重發確認信件'}
                </button>
              </div>

              <div style={{ textAlign: 'center', marginTop: 10 }}>
                <button
                  onClick={() => { setShowCsModal(true); setCsCopied(false); }}
                  style={{ background: 'none', border: 'none', padding: 0, color: 'var(--muted)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}
                >
                  需要協助？聯繫售後客服
                </button>
              </div>
            </>
          )}

        </div>

        {/* ── Footer ── */}
        <div className="footer">
          SIMAX eSIM<br />
          <span style={{ fontSize: 11 }}>© {new Date().getFullYear()} SIMAX. All rights reserved.</span>
        </div>

        {/* ── 客服彈窗 ── */}
        {showCsModal && (
          <div
            onClick={() => setShowCsModal(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{ background: '#fff', borderRadius: 16, padding: '28px 24px', width: '100%', maxWidth: 360, textAlign: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
            >
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>聯繫售後客服前</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20, lineHeight: 1.6 }}>
                請先複製您的訂單編號，<br />客服人員可以更快幫您查詢。
              </div>
              {orderNo && (
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 14, color: 'var(--text)', wordBreak: 'break-all' }}>{orderNo}</span>
                  <button
                    className="btn-copy"
                    style={{ flexShrink: 0 }}
                    onClick={async () => {
                      try { await navigator.clipboard.writeText(orderNo); setCsCopied(true); setTimeout(() => setCsCopied(false), 2000); } catch {}
                    }}
                  >{csCopied ? '✓' : '複製'}</button>
                </div>
              )}
              <a
                href="https://esim-simax.com/CSNEW"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'block', background: 'var(--brand)', color: '#fff', borderRadius: 10, padding: '13px 0', fontWeight: 600, fontSize: 15, textDecoration: 'none', marginBottom: 10 }}
                onClick={() => setShowCsModal(false)}
              >
                前往客服 →
              </a>
              <button
                onClick={() => setShowCsModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 13, cursor: 'pointer', padding: '4px 0' }}
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
