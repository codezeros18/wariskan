-- ============================================================
-- WARISKAN - Audit, idempotency, and WhatsApp command support
-- Migration : 002_audit_idempotency_commands
-- Run once in Supabase SQL Editor after 001_initial_schema.
-- ============================================================

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS source_message_id TEXT,
  ADD COLUMN IF NOT EXISTS source_chat_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

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

CREATE INDEX IF NOT EXISTS idx_transactions_user_created_at
  ON transactions (user_id, created_at DESC);

DROP TRIGGER IF EXISTS set_transactions_updated_at ON transactions;
CREATE TRIGGER set_transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMENT ON COLUMN transactions.source_message_id IS 'WhatsApp/WAHA message id that produced this transaction. Used for idempotency.';
COMMENT ON COLUMN transactions.source_chat_id IS 'Original WAHA chat id used for replies, including @lid when present.';

CREATE TABLE IF NOT EXISTS outgoing_messages (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID        REFERENCES users (id) ON DELETE SET NULL,
  transaction_id        UUID        REFERENCES transactions (id) ON DELETE SET NULL,
  incoming_message_id   TEXT,
  chat_id               TEXT        NOT NULL,
  reply_text            TEXT        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'sent',
  provider              TEXT        NOT NULL DEFAULT 'waha',
  provider_message_id   TEXT,
  provider_response     JSONB,
  error                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT outgoing_messages_status_check
    CHECK (status IN ('sent', 'failed', 'skipped'))
);

CREATE INDEX IF NOT EXISTS idx_outgoing_user_created
  ON outgoing_messages (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outgoing_incoming_message
  ON outgoing_messages (incoming_message_id);

COMMENT ON TABLE outgoing_messages IS 'Audit log of all WhatsApp replies sent by Wariskan.';

ALTER TABLE outgoing_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_anon_outgoing_messages" ON outgoing_messages;
CREATE POLICY "deny_anon_outgoing_messages"
  ON outgoing_messages AS RESTRICTIVE FOR ALL TO anon USING (false);

DROP POLICY IF EXISTS "deny_auth_outgoing_messages" ON outgoing_messages;
CREATE POLICY "deny_auth_outgoing_messages"
  ON outgoing_messages AS RESTRICTIVE FOR ALL TO authenticated USING (false);
