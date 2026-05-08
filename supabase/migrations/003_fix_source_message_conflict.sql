-- ============================================================
-- WARISKAN - Fix PostgREST on_conflict for source_message_id
-- Migration : 003_fix_source_message_conflict
--
-- Why:
-- PostgREST upsert with on_conflict=source_message_id requires a
-- normal UNIQUE/EXCLUSION constraint target. The previous partial
-- unique index is not accepted for this upsert path.
-- ============================================================

DROP INDEX IF EXISTS transactions_source_message_id_unique;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transactions_source_message_id_key'
      AND conrelid = 'transactions'::regclass
  ) THEN
    ALTER TABLE transactions
      ADD CONSTRAINT transactions_source_message_id_key UNIQUE (source_message_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transactions_source_chat_id
  ON transactions (source_chat_id);
