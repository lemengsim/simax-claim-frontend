-- ============================================================
-- 補充 schema：dispatch-worker 需要的欄位
-- 請在 Supabase SQL Editor 執行
-- ============================================================

-- 叫貨失敗重試次數（最多 3 次後標記 failed）
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS retry_count  INTEGER DEFAULT 0;

-- 最後一次失敗的錯誤訊息（方便排查）
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS last_error   TEXT DEFAULT NULL;

-- 確認欄位已加入
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'orders'
  AND column_name IN ('retry_count', 'last_error');
