# SIMAX eSIM 全通路自動發貨系統 — CLAUDE.md

> AI 工作手冊：每次新對話請先閱讀此文件，再 @ 相關功能 MD。

## 系統定位

MOMO 電商平台 eSIM 商品的「全自動叫貨 + 自助領取」後端系統。
顧客在 MOMO 下單後，系統自動向廠商（DJB / WM）取得 QR Code，
顧客再透過前台網站輸入訂單號 + Email 自助領取。

---

## 架構三層

```
[MOMO 平台]
    ↓ (SCM API 每5分鐘撈單)
[GCP VM: esim-vm]  ← PM2 simax-engine
    ├── momo-ingest.js    進件：撈單 + AES解密 + 寫 Supabase
    ├── core-mapper.js    大腦：字典比對 (Google Sheets Plans分頁)
    ├── dispatch-worker.js 發貨：DJB / WM API 叫貨
    ├── express-server.js  API：/api/internal/redeem (port 3001)
    └── sheets-writer.js   日誌：寫自助領取紀錄分頁
         ↓ (REST API)
[Vercel: simax-clone]  ← Next.js
    ├── pages/index.js         前台 UI (v2.12)
    ├── pages/api/verify.js    訂單驗證 proxy
    └── pages/api/claim.js     領取 proxy → GCP
         ↓ (upsert / query)
[Supabase: orders 表]
[Google Sheets: 自助領取紀錄 + Plans 字典]
```

---

## 關鍵數值

| 項目 | 值 |
|------|----|
| GCP VM 名稱 | esim-vm |
| PM2 process | simax-engine |
| Express port | 3001 |
| 撈單頻率 | 每 5 分鐘 |
| 字典快取 | 30 分鐘 TTL |
| Supabase project | ivyczzhzusqjkqmfnwlw |
| Google Sheet ID | 1foLTvkiN7gLtxDrFXFOoLviloop2qYduTGG_LpK8glQ |
| 前台 repo | simax-clone (Vercel 自動部署) |

---

## 檔案對應

| 功能 | 本地路徑 | VM 路徑 |
|------|----------|---------|
| PM2入口 | momo-engine/index.js | /home/order/simax-momo-engine/index.js |
| 進件 | momo-engine/momo-ingest.js | 同上目錄 |
| 大腦 | momo-engine/core-mapper.js | 同上目錄 |
| 發貨 | momo-engine/dispatch-worker.js | 同上目錄 |
| API伺服器 | momo-engine/express-server.js | 同上目錄 |
| 前台UI | pages/index.js | Vercel |
| 環境變數 | momo-engine/.env.example | /home/order/simax-momo-engine/.env |

⚠️ **VM 與本地程式碼可能不同步**，修改後需手動 scp 或在 VM 上直接 patch。

---

## 當前狀態

- 正在做：MOMO 單渠道已上線運作
- 下一步：蝦皮/官網進件模組（Gmail 解析）尚未建立
- MOMO supplier 類型確認中（待廠服回覆 ticket PIN 是否需申請電子票券類型）

---

## 操作 VM 快速指令

```bash
# SSH 進 VM（需先設定 gcloud）
gcloud compute ssh esim-vm --zone=asia-east1-b

# 查看引擎狀態
pm2 status

# 查看最新 log
pm2 logs simax-engine --lines 30

# 重啟引擎
pm2 restart simax-engine

# 健康檢查
curl http://localhost:3001/health
```

---

## 詳細文件

- [系統交接文件](docs/系統交接文件.md) — 架構說明、渠道規劃、交接重點
- [工程技術手冊](docs/工程技術手冊.md) — API規格、資料庫Schema、環境變數、除錯指南
