#!/bin/bash
# =============================================================
# SIMAX eSIM 自動發貨引擎 — GCP VM 一鍵安裝腳本
# 用法：curl -fsSL https://raw.githubusercontent.com/lemengsim/simax-claim-frontend/main/momo-engine/setup.sh | bash
# =============================================================

set -e   # 任何指令失敗就立即停止

REPO_URL="https://github.com/lemengsim/simax-claim-frontend.git"
ENGINE_DIR="$HOME/simax-momo-engine"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  SIMAX eSIM Engine — GCP 安裝程式            ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── 1. 安裝 Node.js (若尚未安裝) ──────────────────────────────
if ! command -v node &>/dev/null; then
  echo "📦 安裝 Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "✅ Node.js 已安裝：$(node --version)"
fi

# ── 2. 安裝 PM2 (全域) ────────────────────────────────────────
if ! command -v pm2 &>/dev/null; then
  echo "📦 安裝 PM2..."
  sudo npm install -g pm2
else
  echo "✅ PM2 已安裝：$(pm2 --version)"
fi

# ── 3. Clone 或更新程式碼 ────────────────────────────────────
if [ -d "$ENGINE_DIR" ]; then
  echo "🔄 更新現有程式碼..."
  cd "$ENGINE_DIR" && git pull origin main
else
  echo "📥 Clone 程式碼..."
  git clone "$REPO_URL" "$HOME/simax-claim-frontend-repo"
  # 只取 momo-engine 資料夾
  cp -r "$HOME/simax-claim-frontend-repo/momo-engine" "$ENGINE_DIR"
  rm -rf "$HOME/simax-claim-frontend-repo"
fi

cd "$ENGINE_DIR"

# ── 4. 安裝 npm 套件 ─────────────────────────────────────────
echo "📦 安裝 npm 套件..."
npm install --production

# ── 5. 建立 .env（若尚未存在）────────────────────────────────
if [ ! -f .env ]; then
  echo "⚙️  建立 .env 範本（請填入真實值！）"
  cp .env.example .env
  echo ""
  echo "================================================================"
  echo "  ⚠️  請用以下指令填入真實的帳號密碼與 API 金鑰："
  echo "  nano $ENGINE_DIR/.env"
  echo "================================================================"
else
  echo "✅ .env 已存在，跳過建立"
fi

# ── 6. 啟動 PM2 ──────────────────────────────────────────────
echo "🚀 啟動 SIMAX 引擎..."
pm2 delete simax-engine 2>/dev/null || true   # 刪除舊的（若有）
pm2 start index.js --name simax-engine

# ── 7. 儲存並設定開機自動啟動 ────────────────────────────────
pm2 save
sudo env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$USER" --hp "$HOME" 2>/dev/null || \
  echo "(ℹ️  pm2 startup 請依提示手動執行)"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  ✅ 安裝完成！                               ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "📋 常用指令："
echo "  pm2 logs simax-engine      # 即時查看 Log"
echo "  pm2 status                 # 查看狀態"
echo "  pm2 restart simax-engine   # 重啟引擎"
echo ""
echo "⚠️  記得填入 .env 後重啟：pm2 restart simax-engine"
echo "   設定檔位置：$ENGINE_DIR/.env"
echo ""
