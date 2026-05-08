-- ============================================================
-- WARISKAN - Reset operational data only
-- Use this for a fresh demo start without dropping schema.
-- WARNING: This deletes all users, transactions, message logs,
-- reminders, and weekly reports in the current Supabase project.
-- ============================================================

TRUNCATE TABLE
  outgoing_messages,
  incoming_messages,
  reminders,
  weekly_reports,
  transactions,
  users
RESTART IDENTITY CASCADE;

-- Quick verification counts. All should return 0.
SELECT 'users' AS table_name, COUNT(*) AS rows FROM users
UNION ALL
SELECT 'transactions', COUNT(*) FROM transactions
UNION ALL
SELECT 'incoming_messages', COUNT(*) FROM incoming_messages
UNION ALL
SELECT 'outgoing_messages', COUNT(*) FROM outgoing_messages
UNION ALL
SELECT 'reminders', COUNT(*) FROM reminders
UNION ALL
SELECT 'weekly_reports', COUNT(*) FROM weekly_reports;
