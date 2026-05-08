-- Wariskan reminder hardening.
-- Keeps reminder creation idempotent when jobs run more than once.

CREATE UNIQUE INDEX IF NOT EXISTS reminders_transaction_type_unique
  ON reminders (transaction_id, reminder_type);

