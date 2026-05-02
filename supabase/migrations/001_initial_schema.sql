-- ============================================================
-- WARISKAN — Initial Database Schema
-- Migration : 001_initial_schema
-- Paste this entire file into Supabase → SQL Editor → New query
-- Run once on a fresh project. Safe to re-run: uses IF NOT EXISTS.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- EXTENSIONS
-- ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ─────────────────────────────────────────────────────────────
-- HELPER TRIGGER: auto-update updated_at on any table that has it
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ─────────────────────────────────────────────────────────────
-- TABLE: users
-- Pemilik warung yang terdaftar via WhatsApp.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  whatsapp_phone   TEXT        NOT NULL,
  display_name     TEXT,
  sheet_id         TEXT,
  sheet_url        TEXT,
  timezone         TEXT        NOT NULL DEFAULT 'Asia/Jakarta',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at   TIMESTAMPTZ,

  CONSTRAINT users_whatsapp_phone_unique UNIQUE (whatsapp_phone),
  CONSTRAINT users_sheet_id_unique       UNIQUE (sheet_id)
);

COMMENT ON TABLE  users                  IS 'Pemilik warung yang terdaftar di Wariskan melalui WhatsApp.';
COMMENT ON COLUMN users.whatsapp_phone   IS 'Nomor WA format E.164 internasional. Contoh: +6281234567890. Ini adalah primary identifier user.';
COMMENT ON COLUMN users.sheet_id         IS 'Google Sheets ID milik user ini. Diambil dari URL sheet: docs.google.com/spreadsheets/d/{SHEET_ID}/edit.';
COMMENT ON COLUMN users.sheet_url        IS 'URL lengkap Google Sheet untuk ditampilkan di dashboard.';
COMMENT ON COLUMN users.timezone         IS 'Timezone user. Default Asia/Jakarta (UTC+7). Dipakai untuk menghitung tanggal lokal dari timestamp UTC.';
COMMENT ON COLUMN users.last_active_at   IS 'Timestamp terakhir user mengirim pesan ke bot. Dipakai untuk analytics retention.';

CREATE INDEX IF NOT EXISTS idx_users_phone ON users (whatsapp_phone);

CREATE TRIGGER set_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ─────────────────────────────────────────────────────────────
-- TABLE: transactions
-- Semua transaksi keuangan warung, diekstrak AI dari pesan WA.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS transactions (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  -- Input asli dari user
  raw_input             TEXT        NOT NULL,
  input_type            TEXT        NOT NULL,
  transcript            TEXT,

  -- Data transaksi hasil ekstraksi AI
  category              TEXT        NOT NULL,
  nominal               BIGINT      NOT NULL DEFAULT 0,
  pihak                 TEXT,
  item                  TEXT,
  tanggal               DATE        NOT NULL DEFAULT CURRENT_DATE,
  jatuh_tempo           DATE,
  status                TEXT        NOT NULL DEFAULT 'aktif',
  confidence            TEXT,

  -- Metadata AI
  ai_model_version      TEXT,

  -- Self-reference: bayar_hutang → hutang asal
  parent_transaction_id UUID        REFERENCES transactions (id),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT transactions_input_type_check
    CHECK (input_type IN ('text', 'voice', 'image')),

  CONSTRAINT transactions_category_check
    CHECK (category IN (
      'pemasukan', 'pengeluaran',
      'hutang', 'piutang',
      'bayar_hutang', 'terima_piutang',
      'unclear'
    )),

  CONSTRAINT transactions_status_check
    CHECK (status IN ('aktif', 'lunas', 'dibatalkan', 'pending_confirmation')),

  CONSTRAINT transactions_confidence_check
    CHECK (confidence IN ('high', 'medium', 'low'))
);

COMMENT ON TABLE  transactions                    IS 'Semua transaksi keuangan warung yang diekstrak dari pesan WhatsApp oleh AI.';
COMMENT ON COLUMN transactions.raw_input          IS 'Pesan asli dari user sebelum diproses: teks mentah, URL audio (voice note), atau URL gambar (foto struk).';
COMMENT ON COLUMN transactions.input_type         IS 'Jenis input: text = pesan teks, voice = voice note (ditranskripsi Whisper), image = foto struk (diproses vision model).';
COMMENT ON COLUMN transactions.transcript         IS 'Hasil transkripsi Whisper untuk voice note. NULL untuk input text atau image.';
COMMENT ON COLUMN transactions.category           IS 'pemasukan/pengeluaran = cash flow harian. hutang = warung berutang. piutang = orang lain berutang ke warung. bayar_hutang/terima_piutang = pelunasan. unclear = AI tidak yakin, butuh konfirmasi user.';
COMMENT ON COLUMN transactions.nominal            IS 'Jumlah dalam Rupiah bulat tanpa desimal. 25000 = Rp 25.000. Disimpan sebagai BIGINT karena PHP format Indonesia tidak pakai koma desimal.';
COMMENT ON COLUMN transactions.pihak              IS 'Nama pihak yang terlibat. Contoh: "Bu Endang", "Pak Budi". Dipakai sebagai key fuzzy-matching di link_payment_to_debt().';
COMMENT ON COLUMN transactions.item               IS 'Nama barang atau keterangan singkat. Contoh: "gula 2kg", "bayar listrik PLN".';
COMMENT ON COLUMN transactions.jatuh_tempo        IS 'Tanggal jatuh tempo hutang/piutang. NULL untuk transaksi cash biasa.';
COMMENT ON COLUMN transactions.status             IS 'aktif = belum lunas/valid. lunas = hutang sudah dibayar. dibatalkan = user batalkan. pending_confirmation = AI tidak yakin, menunggu konfirmasi.';
COMMENT ON COLUMN transactions.confidence         IS 'Keyakinan AI dalam ekstraksi data. high = langsung simpan. medium = simpan tapi tandai. low = tahan di pending_confirmation untuk konfirmasi manual.';
COMMENT ON COLUMN transactions.ai_model_version   IS 'Model AI yang memproses transaksi ini. Dipakai untuk audit dan analisis performa model. Contoh: claude-3-5-haiku-20241022.';
COMMENT ON COLUMN transactions.parent_transaction_id IS 'FK ke transaksi hutang/piutang asal. Diisi saat ini adalah bayar_hutang atau terima_piutang yang melunasi transaksi tertentu.';

-- Index: query paling umum — semua transaksi user dalam rentang waktu
CREATE INDEX IF NOT EXISTS idx_transactions_user_tanggal
  ON transactions (user_id, tanggal DESC);

-- Index: fetch hutang/piutang aktif yang belum jatuh tempo (untuk reminder scheduler)
CREATE INDEX IF NOT EXISTS idx_transactions_user_aktif_jatuh_tempo
  ON transactions (user_id, status, jatuh_tempo)
  WHERE status = 'aktif';

-- Index: filter per kategori (pemasukan, pengeluaran, dll)
CREATE INDEX IF NOT EXISTS idx_transactions_user_category
  ON transactions (user_id, category);


-- ─────────────────────────────────────────────────────────────
-- TABLE: reminders
-- Jadwal pengiriman reminder hutang/piutang via WhatsApp.
-- Di-poll oleh n8n workflow setiap 15 menit.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reminders (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  transaction_id   UUID        NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
  reminder_type    TEXT        NOT NULL,
  remind_at        TIMESTAMPTZ NOT NULL,
  sent_at          TIMESTAMPTZ,
  status           TEXT        NOT NULL DEFAULT 'pending',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT reminders_type_check
    CHECK (reminder_type IN ('h_minus_1', 'on_due', 'overdue')),

  CONSTRAINT reminders_status_check
    CHECK (status IN ('pending', 'sent', 'failed', 'cancelled'))
);

COMMENT ON TABLE  reminders               IS 'Jadwal pengiriman reminder hutang/piutang ke user via WhatsApp. n8n polling tabel ini setiap 15 menit.';
COMMENT ON COLUMN reminders.reminder_type IS 'h_minus_1 = kirim sehari sebelum jatuh tempo. on_due = kirim di hari H. overdue = kirim setelah lewat jatuh tempo (setiap 3 hari).';
COMMENT ON COLUMN reminders.remind_at     IS 'Waktu dijadwalkan pengiriman, dalam UTC. n8n query WHERE status = pending AND remind_at <= NOW().';
COMMENT ON COLUMN reminders.sent_at       IS 'Waktu reminder berhasil dikirim ke WA. NULL = belum terkirim.';
COMMENT ON COLUMN reminders.status        IS 'pending = menunggu dikirim. sent = berhasil terkirim. failed = gagal (WA error). cancelled = dibatalkan karena hutang lunas.';

-- Index: n8n polling query — pending reminders yang sudah waktunya
CREATE INDEX IF NOT EXISTS idx_reminders_pending
  ON reminders (status, remind_at)
  WHERE status = 'pending';


-- ─────────────────────────────────────────────────────────────
-- TABLE: incoming_messages
-- Raw audit log semua pesan masuk dari WhatsApp Cloud API.
-- Dipakai untuk: debugging, idempotency, re-processing jika gagal.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS incoming_messages (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID        REFERENCES users (id) ON DELETE SET NULL,
  whatsapp_message_id   TEXT,
  phone_from            TEXT,
  message_type          TEXT,
  raw_text              TEXT,
  payload               JSONB,
  status                TEXT        NOT NULL DEFAULT 'received',
  processed             BOOLEAN     NOT NULL DEFAULT false,
  processing_error      TEXT,
  received_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT incoming_messages_wamid_unique  UNIQUE (whatsapp_message_id),
  CONSTRAINT incoming_messages_status_check  CHECK  (status IN ('received', 'processed', 'failed'))
);

COMMENT ON TABLE  incoming_messages                     IS 'Audit log semua pesan masuk dari WhatsApp Cloud API, tersimpan sebelum diproses. Dipakai untuk debugging dan idempotency.';
COMMENT ON COLUMN incoming_messages.user_id             IS 'NULL jika pengirim belum terdaftar (nomor tidak ada di tabel users).';
COMMENT ON COLUMN incoming_messages.whatsapp_message_id IS 'wamid (WhatsApp Message ID) unik dari Meta. Unique constraint mencegah proses pesan yang sama dua kali (idempotency).';
COMMENT ON COLUMN incoming_messages.phone_from          IS 'Nomor WA pengirim dalam format E.164. Dipakai untuk rate limiting dan abuse detection query.';
COMMENT ON COLUMN incoming_messages.raw_text            IS 'Teks mentah pesan (max 2000 char). NULL untuk audio/image. Dipakai untuk deteksi pesan identik berulang (flood).';
COMMENT ON COLUMN incoming_messages.payload             IS 'Raw JSON payload dari WhatsApp webhook, disimpan utuh tanpa modifikasi. Berguna untuk re-process atau debug.';
COMMENT ON COLUMN incoming_messages.message_type        IS 'Tipe pesan: text, audio, image, document, interactive, dll. Diambil dari payload.messages[0].type.';
COMMENT ON COLUMN incoming_messages.status              IS 'received = baru masuk. processed = berhasil diproses. failed = gagal diproses.';
COMMENT ON COLUMN incoming_messages.processed           IS 'false = n8n belum memproses pesan ini. true = sudah diproses (berhasil atau gagal). Legacy field, gunakan status untuk detail.';
COMMENT ON COLUMN incoming_messages.processing_error    IS 'Error message jika processing gagal. NULL jika sukses. Dipakai untuk analisis failure rate.';

CREATE INDEX IF NOT EXISTS idx_incoming_wamid
  ON incoming_messages (whatsapp_message_id);

-- Index: rate limiting & abuse — cari pesan dari nomor tertentu dalam window waktu
CREATE INDEX IF NOT EXISTS idx_incoming_phone_received
  ON incoming_messages (phone_from, received_at DESC);

-- Index: n8n retry query — cari pesan yang belum diproses
CREATE INDEX IF NOT EXISTS idx_incoming_unprocessed
  ON incoming_messages (processed, received_at)
  WHERE processed = false;


-- ─────────────────────────────────────────────────────────────
-- TABLE: weekly_reports
-- Rekam jejak laporan mingguan yang dikirim ke user.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS weekly_reports (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  period_start  DATE        NOT NULL,
  period_end    DATE        NOT NULL,
  report_data   JSONB,
  sent_at       TIMESTAMPTZ,

  CONSTRAINT weekly_reports_unique_period
    UNIQUE (user_id, period_start, period_end)
);

COMMENT ON TABLE  weekly_reports             IS 'Rekam jejak laporan mingguan yang dikirimkan ke user via WhatsApp setiap Minggu pagi.';
COMMENT ON COLUMN weekly_reports.period_start IS 'Senin awal periode laporan.';
COMMENT ON COLUMN weekly_reports.period_end   IS 'Minggu akhir periode laporan.';
COMMENT ON COLUMN weekly_reports.report_data  IS 'Snapshot data laporan: {total_pemasukan, total_pengeluaran, net_cashflow, hutang_aktif, piutang_aktif, top_pengeluaran}. Disimpan JSONB agar laporan bisa di-render ulang tanpa re-query.';
COMMENT ON COLUMN weekly_reports.sent_at      IS 'NULL = laporan masih draft atau belum terkirim. Terisi setelah WA delivery confirmed.';


-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- MVP strategy: semua akses via service_role (n8n backend).
-- anon dan authenticated role diblok total.
-- service_role bypass RLS by default di Supabase.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE incoming_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_reports    ENABLE ROW LEVEL SECURITY;

-- Block anon (unauthenticated requests via anon key)
CREATE POLICY "deny_anon_users"              ON users             AS RESTRICTIVE FOR ALL TO anon        USING (false);
CREATE POLICY "deny_anon_transactions"       ON transactions      AS RESTRICTIVE FOR ALL TO anon        USING (false);
CREATE POLICY "deny_anon_reminders"          ON reminders         AS RESTRICTIVE FOR ALL TO anon        USING (false);
CREATE POLICY "deny_anon_incoming_messages"  ON incoming_messages AS RESTRICTIVE FOR ALL TO anon        USING (false);
CREATE POLICY "deny_anon_weekly_reports"     ON weekly_reports    AS RESTRICTIVE FOR ALL TO anon        USING (false);

-- Block authenticated (JWT-authenticated users — not used in MVP)
CREATE POLICY "deny_auth_users"              ON users             AS RESTRICTIVE FOR ALL TO authenticated USING (false);
CREATE POLICY "deny_auth_transactions"       ON transactions      AS RESTRICTIVE FOR ALL TO authenticated USING (false);
CREATE POLICY "deny_auth_reminders"          ON reminders         AS RESTRICTIVE FOR ALL TO authenticated USING (false);
CREATE POLICY "deny_auth_incoming_messages"  ON incoming_messages AS RESTRICTIVE FOR ALL TO authenticated USING (false);
CREATE POLICY "deny_auth_weekly_reports"     ON weekly_reports    AS RESTRICTIVE FOR ALL TO authenticated USING (false);


-- ─────────────────────────────────────────────────────────────
-- FUNCTION: get_active_debts
-- Hutang = warung punya kewajiban bayar ke orang lain.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_active_debts(p_user_id UUID)
RETURNS TABLE (
  id           UUID,
  pihak        TEXT,
  item         TEXT,
  nominal      BIGINT,
  tanggal      DATE,
  jatuh_tempo  DATE,
  days_overdue INTEGER,
  created_at   TIMESTAMPTZ
) AS $$
  SELECT
    t.id,
    t.pihak,
    t.item,
    t.nominal,
    t.tanggal,
    t.jatuh_tempo,
    CASE
      WHEN t.jatuh_tempo IS NOT NULL AND t.jatuh_tempo < CURRENT_DATE
        THEN (CURRENT_DATE - t.jatuh_tempo)
      ELSE 0
    END AS days_overdue,
    t.created_at
  FROM transactions t
  WHERE t.user_id     = p_user_id
    AND t.category    = 'hutang'
    AND t.status      = 'aktif'
  ORDER BY
    CASE WHEN t.jatuh_tempo < CURRENT_DATE THEN 0 ELSE 1 END,  -- overdue first
    t.jatuh_tempo ASC NULLS LAST,
    t.created_at DESC;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_active_debts IS 'Kembalikan semua hutang aktif user (warung punya kewajiban bayar). Diurutkan: overdue dulu, lalu terdekat jatuh tempo. Termasuk kolom days_overdue untuk template reminder.';


-- ─────────────────────────────────────────────────────────────
-- FUNCTION: get_active_credits
-- Piutang = orang lain punya hutang ke warung.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_active_credits(p_user_id UUID)
RETURNS TABLE (
  id           UUID,
  pihak        TEXT,
  item         TEXT,
  nominal      BIGINT,
  tanggal      DATE,
  jatuh_tempo  DATE,
  days_overdue INTEGER,
  created_at   TIMESTAMPTZ
) AS $$
  SELECT
    t.id,
    t.pihak,
    t.item,
    t.nominal,
    t.tanggal,
    t.jatuh_tempo,
    CASE
      WHEN t.jatuh_tempo IS NOT NULL AND t.jatuh_tempo < CURRENT_DATE
        THEN (CURRENT_DATE - t.jatuh_tempo)
      ELSE 0
    END AS days_overdue,
    t.created_at
  FROM transactions t
  WHERE t.user_id  = p_user_id
    AND t.category = 'piutang'
    AND t.status   = 'aktif'
  ORDER BY
    CASE WHEN t.jatuh_tempo < CURRENT_DATE THEN 0 ELSE 1 END,
    t.jatuh_tempo ASC NULLS LAST,
    t.created_at DESC;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_active_credits IS 'Kembalikan semua piutang aktif user (orang yang masih berutang ke warung). Diurutkan: overdue dulu, lalu terdekat jatuh tempo.';


-- ─────────────────────────────────────────────────────────────
-- FUNCTION: get_weekly_aggregate
-- Agregasi keuangan warung dalam rentang tanggal.
-- Dipakai untuk laporan mingguan dan dashboard.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_weekly_aggregate(
  p_user_id UUID,
  p_start   DATE,
  p_end     DATE
)
RETURNS TABLE (
  total_pemasukan      BIGINT,
  total_pengeluaran    BIGINT,
  total_hutang_baru    BIGINT,
  total_piutang_baru   BIGINT,
  total_bayar_hutang   BIGINT,
  total_terima_piutang BIGINT,
  net_cashflow         BIGINT,
  transaction_count    BIGINT
) AS $$
  SELECT
    COALESCE(SUM(nominal) FILTER (WHERE category = 'pemasukan'),      0) AS total_pemasukan,
    COALESCE(SUM(nominal) FILTER (WHERE category = 'pengeluaran'),    0) AS total_pengeluaran,
    COALESCE(SUM(nominal) FILTER (WHERE category = 'hutang'),         0) AS total_hutang_baru,
    COALESCE(SUM(nominal) FILTER (WHERE category = 'piutang'),        0) AS total_piutang_baru,
    COALESCE(SUM(nominal) FILTER (WHERE category = 'bayar_hutang'),   0) AS total_bayar_hutang,
    COALESCE(SUM(nominal) FILTER (WHERE category = 'terima_piutang'), 0) AS total_terima_piutang,
    COALESCE(SUM(nominal) FILTER (WHERE category = 'pemasukan'),      0)
      - COALESCE(SUM(nominal) FILTER (WHERE category = 'pengeluaran'), 0) AS net_cashflow,
    COUNT(*)                                                              AS transaction_count
  FROM transactions
  WHERE user_id = p_user_id
    AND tanggal BETWEEN p_start AND p_end
    AND status  NOT IN ('dibatalkan');
$$ LANGUAGE sql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_weekly_aggregate IS 'Hitung agregasi keuangan warung dalam rentang tanggal. Dikecualikan: transaksi dibatalkan. Tidak dikecualikan: unclear/pending_confirmation agar tetap terhitung.';


-- ─────────────────────────────────────────────────────────────
-- FUNCTION: link_payment_to_debt
-- Matching engine: ketika user bilang "bayar Bu Endang 180rb",
-- cari hutang/piutang aktif yang paling cocok.
-- Return: matched row + match_type (exact/partial/none)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION link_payment_to_debt(
  p_user_id UUID,
  p_pihak   TEXT,
  p_nominal BIGINT
)
RETURNS TABLE (
  matched_id       UUID,
  matched_pihak    TEXT,
  matched_nominal  BIGINT,
  matched_category TEXT,
  match_type       TEXT
) AS $$
DECLARE
  v_norm TEXT;
  v_found BOOLEAN := false;
BEGIN
  -- Normalize input: lowercase + trim whitespace
  v_norm := LOWER(TRIM(p_pihak));

  -- Pass 1: exact match on pihak (normalized) AND nominal
  RETURN QUERY
    SELECT t.id, t.pihak, t.nominal, t.category, 'exact'::TEXT
    FROM transactions t
    WHERE t.user_id  = p_user_id
      AND t.status   = 'aktif'
      AND t.category IN ('hutang', 'piutang')
      AND LOWER(TRIM(t.pihak)) = v_norm
      AND t.nominal  = p_nominal
    ORDER BY t.created_at DESC
    LIMIT 1;

  GET DIAGNOSTICS v_found = ROW_COUNT;

  IF v_found THEN RETURN; END IF;

  -- Pass 2: partial name match, ignore nominal
  -- Useful when user pays partial amount ("bayar sebagian Bu Endang 50rb")
  RETURN QUERY
    SELECT t.id, t.pihak, t.nominal, t.category, 'partial'::TEXT
    FROM transactions t
    WHERE t.user_id  = p_user_id
      AND t.status   = 'aktif'
      AND t.category IN ('hutang', 'piutang')
      AND LOWER(TRIM(t.pihak)) LIKE '%' || v_norm || '%'
    ORDER BY t.created_at DESC
    LIMIT 1;

  GET DIAGNOSTICS v_found = ROW_COUNT;

  IF v_found THEN RETURN; END IF;

  -- Pass 3: no match — return sentinel row so caller always gets a row
  RETURN QUERY
    SELECT
      NULL::UUID, NULL::TEXT, NULL::BIGINT, NULL::TEXT, 'none'::TEXT;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION link_payment_to_debt IS 'Cari hutang/piutang aktif paling cocok untuk transaksi bayar_hutang/terima_piutang. Pass 1: nama + nominal exact. Pass 2: nama partial. Pass 3: tidak ketemu (return match_type=none). Caller harus handle none dengan konfirmasi ke user.';


-- ─────────────────────────────────────────────────────────────
-- SEED DATA — Development Only
-- 5 users, 30 transactions, 1 reminder, 1 report, 3 messages
-- Hapus section ini sebelum deploy ke production.
-- ─────────────────────────────────────────────────────────────

-- Users
INSERT INTO users (id, whatsapp_phone, display_name, timezone, last_active_at) VALUES
  ('a0000001-0000-0000-0000-000000000001', '+6281234567001', 'Ibu Sari — Warung Sari Jaya',   'Asia/Jakarta', NOW() - INTERVAL '2 hours'),
  ('a0000001-0000-0000-0000-000000000002', '+6281234567002', 'Pak Joko — Warung Pojok',       'Asia/Jakarta', NOW() - INTERVAL '5 hours'),
  ('a0000001-0000-0000-0000-000000000003', '+6281234567003', 'Ibu Dewi — Warung Bahagia',     'Asia/Jakarta', NOW() - INTERVAL '1 day'),
  ('a0000001-0000-0000-0000-000000000004', '+6281234567004', 'Mas Budi — Warung Maju Jaya',   'Asia/Jakarta', NOW() - INTERVAL '3 hours'),
  ('a0000001-0000-0000-0000-000000000005', '+6281234567005', 'Mbak Rina — Warung Rina Asri',  'Asia/Jakarta', NOW() - INTERVAL '30 minutes')
ON CONFLICT DO NOTHING;

-- ── User 1: Ibu Sari (6 transactions) ────────────────────────
INSERT INTO transactions (
  user_id, raw_input, input_type, category,
  nominal, pihak, item, tanggal, status, confidence, ai_model_version
) VALUES
  -- pemasukan harian
  ('a0000001-0000-0000-0000-000000000001',
   'jualan hari ini 350rb',
   'text', 'pemasukan', 350000,
   NULL, 'Penjualan harian',
   CURRENT_DATE, 'aktif', 'high', 'claude-3-5-haiku-20241022'),

  -- pengeluaran belanja
  ('a0000001-0000-0000-0000-000000000001',
   'beli gula 5kg sama minyak goreng 2L total 125rb',
   'text', 'pengeluaran', 125000,
   'Toko Indah', 'Gula 5kg + Minyak goreng 2L',
   CURRENT_DATE, 'aktif', 'high', 'claude-3-5-haiku-20241022'),

  -- piutang (orang lain utang ke warung)
  ('a0000001-0000-0000-0000-000000000001',
   'bu endang utang beras 5kg senilai 75rb',
   'text', 'piutang', 75000,
   'Bu Endang', 'Beras 5kg',
   CURRENT_DATE - 3, 'aktif', 'high', 'claude-3-5-haiku-20241022'),

  -- bayar hutang warung ke supplier
  ('a0000001-0000-0000-0000-000000000001',
   'bayar utang ke supplier telur 200rb',
   'text', 'bayar_hutang', 200000,
   'Pak Ahmad Telur', NULL,
   CURRENT_DATE - 1, 'aktif', 'high', 'claude-3-5-haiku-20241022'),

  -- pemasukan kemarin
  ('a0000001-0000-0000-0000-000000000001',
   'jualan kemarin 280rb',
   'text', 'pemasukan', 280000,
   NULL, 'Penjualan harian',
   CURRENT_DATE - 1, 'aktif', 'high', 'claude-3-5-haiku-20241022'),

  -- pengeluaran operasional
  ('a0000001-0000-0000-0000-000000000001',
   'bayar listrik 150rb',
   'text', 'pengeluaran', 150000,
   'PLN', 'Listrik bulanan',
   CURRENT_DATE - 2, 'aktif', 'high', 'claude-3-5-haiku-20241022');

-- ── User 2: Pak Joko (6 transactions) ────────────────────────
INSERT INTO transactions (
  user_id, raw_input, input_type, category,
  nominal, pihak, item, tanggal, jatuh_tempo, status, confidence, ai_model_version
) VALUES
  ('a0000001-0000-0000-0000-000000000002',
   'penjualan rokok dan minuman hari ini 420rb',
   'text', 'pemasukan', 420000,
   NULL, 'Rokok + minuman', CURRENT_DATE, NULL,
   'aktif', 'high', 'claude-3-5-haiku-20241022'),

  -- hutang warung ke grosir, ada jatuh tempo
  ('a0000001-0000-0000-0000-000000000002',
   'utang ke grosir minyak goreng 10L = 180rb jatuh tempo akhir bulan',
   'text', 'hutang', 180000,
   'Grosir Pak Hasan', 'Minyak goreng 10L',
   CURRENT_DATE - 2, CURRENT_DATE + 25,
   'aktif', 'high', 'claude-3-5-haiku-20241022'),

  -- piutang: pelanggan titip belanja
  ('a0000001-0000-0000-0000-000000000002',
   'pak budi titip bayar 50rb',
   'text', 'piutang', 50000,
   'Pak Budi', 'Titipan belanja', CURRENT_DATE - 1, NULL,
   'aktif', 'high', 'claude-3-5-haiku-20241022'),

  -- pengeluaran restock
  ('a0000001-0000-0000-0000-000000000002',
   'beli stock minuman botol 240rb',
   'text', 'pengeluaran', 240000,
   'Distributor Minuman', 'Stock minuman', CURRENT_DATE - 1, NULL,
   'aktif', 'high', 'claude-3-5-haiku-20241022'),

  -- terima piutang dari pak budi (lunas)
  ('a0000001-0000-0000-0000-000000000002',
   'pak budi bayar titipannya 50rb',
   'text', 'terima_piutang', 50000,
   'Pak Budi', NULL, CURRENT_DATE, NULL,
   'aktif', 'high', 'claude-3-5-haiku-20241022'),

  ('a0000001-0000-0000-0000-000000000002',
   'jualan 390rb',
   'text', 'pemasukan', 390000,
   NULL, 'Penjualan harian', CURRENT_DATE - 3, NULL,
   'aktif', 'high', 'claude-3-5-haiku-20241022');

-- ── User 3: Ibu Dewi (6 transactions — ada status unclear) ───
INSERT INTO transactions (
  user_id, raw_input, input_type, category,
  nominal, pihak, item, tanggal, jatuh_tempo, status, confidence, ai_model_version
) VALUES
  ('a0000001-0000-0000-0000-000000000003',
   'omset warung hari ini 520000',
   'text', 'pemasukan', 520000,
   NULL, 'Omset harian', CURRENT_DATE, NULL,
   'aktif', 'high', 'claude-3-5-haiku-20241022'),

  ('a0000001-0000-0000-0000-000000000003',
   'belanja ke pasar 315rb buat stok',
   'text', 'pengeluaran', 315000,
   'Pasar Tradisional', 'Belanja stok harian', CURRENT_DATE, NULL,
   'aktif', 'high', 'claude-3-5-haiku-20241022'),

  -- piutang pelanggan kredit, ada jatuh tempo 1 minggu
  ('a0000001-0000-0000-0000-000000000003',
   'mbak sri ambil sembako kredit 95rb',
   'text', 'piutang', 95000,
   'Mbak Sri', 'Sembako kredit', CURRENT_DATE - 1, CURRENT_DATE + 6,
   'aktif', 'medium', 'claude-3-5-haiku-20241022'),

  ('a0000001-0000-0000-0000-000000000003',
   'sewa lapak bulan ini 400rb',
   'text', 'pengeluaran', 400000,
   'Pemilik Lapak', 'Sewa tempat usaha', CURRENT_DATE - 5, NULL,
   'aktif', 'high', 'claude-3-5-haiku-20241022'),

  -- terima piutang dari mbak sri (akan dilunaskan via UPDATE di bawah)
  ('a0000001-0000-0000-0000-000000000003',
   'mbak sri bayar 95rb',
   'text', 'terima_piutang', 95000,
   'Mbak Sri', NULL, CURRENT_DATE, NULL,
   'aktif', 'high', 'claude-3-5-haiku-20241022'),

  -- contoh pesan yang tidak jelas, AI tidak yakin
  ('a0000001-0000-0000-0000-000000000003',
   'tadi ada yang beli tapi lupa catatnya ya',
   'text', 'unclear', 0,
   NULL, NULL, CURRENT_DATE, NULL,
   'pending_confirmation', 'low', 'claude-3-5-haiku-20241022');

-- ── User 4: Mas Budi (6 transactions — hutang overdue) ───────
INSERT INTO transactions (
  user_id, raw_input, input_type, category,
  nominal, pihak, item, tanggal, jatuh_tempo, status, confidence, ai_model_version
) VALUES
  ('a0000001-0000-0000-0000-000000000004',
   'jualan warung hari ini 445rb',
   'text', 'pemasukan', 445000,
   NULL, 'Penjualan harian', CURRENT_DATE, NULL,
   'aktif', 'high', 'claude-3-5-haiku-20241022'),

  -- hutang warung, OVERDUE 7 hari — untuk test reminder
  ('a0000001-0000-0000-0000-000000000004',
   'utang ke agen sembako 350rb jatuh tempo minggu lalu',
   'text', 'hutang', 350000,
   'Bu Tini Sembako', 'Stok sembako', CURRENT_DATE - 14, CURRENT_DATE - 7,
   'aktif', 'high', 'claude-3-5-haiku-20241022'),

  ('a0000001-0000-0000-0000-000000000004',
   'beli tepung terigu 10kg 90rb',
   'text', 'pengeluaran', 90000,
   'Toko Sumber Makmur', 'Tepung terigu 10kg', CURRENT_DATE - 1, NULL,
   'aktif', 'high', 'claude-3-5-haiku-20241022'),

  -- piutang ke pelanggan
  ('a0000001-0000-0000-0000-000000000004',
   'pak eko ngutang rokok 2 bungkus 38rb',
   'text', 'piutang', 38000,
   'Pak Eko', 'Rokok 2 bungkus', CURRENT_DATE - 3, CURRENT_DATE + 7,
   'aktif', 'high', 'claude-3-5-haiku-20241022'),

  ('a0000001-0000-0000-0000-000000000004',
   'jualan 398rb',
   'text', 'pemasukan', 398000,
   NULL, 'Penjualan harian', CURRENT_DATE - 1, NULL,
   'aktif', 'high', 'claude-3-5-haiku-20241022'),

  -- bayar sebagian hutang ke Bu Tini (partial payment)
  ('a0000001-0000-0000-0000-000000000004',
   'bayar sebagian utang ke bu tini 150rb',
   'text', 'bayar_hutang', 150000,
   'Bu Tini Sembako', NULL, CURRENT_DATE, NULL,
   'aktif', 'high', 'claude-3-5-haiku-20241022');

-- ── User 5: Mbak Rina (6 transactions — voice + image mix) ───
INSERT INTO transactions (
  user_id, raw_input, input_type, transcript, category,
  nominal, pihak, item, tanggal, status, confidence, ai_model_version
) VALUES
  -- voice note: pemasukan pagi
  ('a0000001-0000-0000-0000-000000000005',
   'https://cdn.whatsapp.net/audio/test-voice-001.ogg',
   'voice',
   'tadi pagi jualan nasi uduk 180rb sama gorengan 45rb jadi total 225rb',
   'pemasukan', 225000, NULL, 'Nasi uduk + gorengan',
   CURRENT_DATE, 'aktif', 'high', 'claude-3-5-haiku-20241022'),

  -- image: foto struk belanja (diproses vision model)
  ('a0000001-0000-0000-0000-000000000005',
   'https://cdn.whatsapp.net/image/struk-indomaret-001.jpg',
   'image', NULL,
   'pengeluaran', 187500, 'Indomaret', 'Belanja sembako',
   CURRENT_DATE, 'aktif', 'high', 'claude-3-5-sonnet-20241022'),

  -- piutang ke Ibu Kartini
  ('a0000001-0000-0000-0000-000000000005',
   'ibu kartini kredit 2 liter minyak goreng 35rb',
   'text', NULL,
   'piutang', 35000, 'Ibu Kartini', 'Minyak goreng 2L',
   CURRENT_DATE - 2, 'aktif', 'high', 'claude-3-5-haiku-20241022'),

  -- piutang ke Pak Rudi (ini yang akan dilunasi)
  ('a0000001-0000-0000-0000-000000000005',
   'pak rudi ngutang kopi gula 60rb',
   'text', NULL,
   'piutang', 60000, 'Pak Rudi', 'Kopi + gula',
   CURRENT_DATE - 5, 'aktif', 'high', 'claude-3-5-haiku-20241022'),

  ('a0000001-0000-0000-0000-000000000005',
   'bayar BPJS 59500',
   'text', NULL,
   'pengeluaran', 59500, 'BPJS Kesehatan', 'Iuran BPJS bulan ini',
   CURRENT_DATE - 2, 'aktif', 'high', 'claude-3-5-haiku-20241022'),

  -- voice note: terima piutang dari Pak Rudi
  ('a0000001-0000-0000-0000-000000000005',
   'https://cdn.whatsapp.net/audio/test-voice-002.ogg',
   'voice',
   'tadi pak rudi bayar hutangnya 60rb lunas',
   'terima_piutang', 60000, 'Pak Rudi', NULL,
   CURRENT_DATE, 'aktif', 'high', 'claude-3-5-haiku-20241022');


-- ─────────────────────────────────────────────────────────────
-- POST-SEED: Link payments → original debts
-- ─────────────────────────────────────────────────────────────

-- Link: Pak Joko — terima_piutang Pak Budi → piutang Pak Budi
UPDATE transactions SET parent_transaction_id = (
  SELECT id FROM transactions
  WHERE user_id  = 'a0000001-0000-0000-0000-000000000002'
    AND category = 'piutang'
    AND pihak    = 'Pak Budi'
  ORDER BY created_at DESC LIMIT 1
)
WHERE user_id  = 'a0000001-0000-0000-0000-000000000002'
  AND category = 'terima_piutang'
  AND pihak    = 'Pak Budi';

-- Link: Mbak Rina — terima_piutang Pak Rudi → piutang Pak Rudi
UPDATE transactions SET parent_transaction_id = (
  SELECT id FROM transactions
  WHERE user_id  = 'a0000001-0000-0000-0000-000000000005'
    AND category = 'piutang'
    AND pihak    = 'Pak Rudi'
  ORDER BY created_at DESC LIMIT 1
)
WHERE user_id  = 'a0000001-0000-0000-0000-000000000005'
  AND category = 'terima_piutang'
  AND pihak    = 'Pak Rudi';

-- Mark lunas: piutang Mbak Sri (Ibu Dewi) setelah terima_piutang
UPDATE transactions
SET status = 'lunas'
WHERE user_id  = 'a0000001-0000-0000-0000-000000000003'
  AND category = 'piutang'
  AND pihak    = 'Mbak Sri'
  AND status   = 'aktif';

-- Mark lunas: piutang Pak Budi (Pak Joko) setelah bayar
UPDATE transactions
SET status = 'lunas'
WHERE user_id  = 'a0000001-0000-0000-0000-000000000002'
  AND category = 'piutang'
  AND pihak    = 'Pak Budi'
  AND status   = 'aktif';

-- Mark lunas: piutang Pak Rudi (Mbak Rina) setelah bayar
UPDATE transactions
SET status = 'lunas'
WHERE user_id  = 'a0000001-0000-0000-0000-000000000005'
  AND category = 'piutang'
  AND pihak    = 'Pak Rudi'
  AND status   = 'aktif';


-- ─────────────────────────────────────────────────────────────
-- POST-SEED: Reminders for Mas Budi's overdue debt
-- ─────────────────────────────────────────────────────────────

INSERT INTO reminders (user_id, transaction_id, reminder_type, remind_at, status)
SELECT
  t.user_id,
  t.id,
  'overdue',
  NOW(),   -- sudah waktunya dikirim
  'pending'
FROM transactions t
WHERE t.user_id  = 'a0000001-0000-0000-0000-000000000004'
  AND t.category = 'hutang'
  AND t.status   = 'aktif'
  AND t.jatuh_tempo < CURRENT_DATE;


-- ─────────────────────────────────────────────────────────────
-- POST-SEED: Sample weekly report (Ibu Sari, minggu ini)
-- ─────────────────────────────────────────────────────────────

INSERT INTO weekly_reports (user_id, period_start, period_end, report_data, sent_at)
VALUES (
  'a0000001-0000-0000-0000-000000000001',
  date_trunc('week', CURRENT_DATE)::DATE,
  (date_trunc('week', CURRENT_DATE) + INTERVAL '6 days')::DATE,
  jsonb_build_object(
    'total_pemasukan',   630000,
    'total_pengeluaran', 275000,
    'net_cashflow',      355000,
    'piutang_aktif',     75000,
    'hutang_aktif',      0,
    'notes',             'Minggu ini surplus Rp 355.000. Ada 1 piutang aktif dari Bu Endang Rp 75.000.'
  ),
  NOW() - INTERVAL '12 hours'
) ON CONFLICT DO NOTHING;


-- ─────────────────────────────────────────────────────────────
-- POST-SEED: Sample incoming_messages (audit log)
-- ─────────────────────────────────────────────────────────────

INSERT INTO incoming_messages (user_id, whatsapp_message_id, phone_from, message_type, raw_text, payload, status, processed, received_at)
VALUES
  -- pesan text dari Ibu Sari (sudah diproses)
  ('a0000001-0000-0000-0000-000000000001',
   'wamid.HBgLNjI4MTIzNDU2NzAwMQAA',
   '+6281234567001',
   'text', 'jualan hari ini 350rb',
   '{"object":"whatsapp_business_account","entry":[{"changes":[{"value":{"messages":[{"from":"+6281234567001","type":"text","text":{"body":"jualan hari ini 350rb"},"id":"wamid.HBgLNjI4MTIzNDU2NzAwMQAA"}]}}]}]}',
   'processed', true,
   NOW() - INTERVAL '2 hours'),

  -- voice note dari Mbak Rina (sudah diproses)
  ('a0000001-0000-0000-0000-000000000005',
   'wamid.HBgLNjI4MTIzNDU2NzAwNQAA',
   '+6281234567005',
   'audio', NULL,
   '{"object":"whatsapp_business_account","entry":[{"changes":[{"value":{"messages":[{"from":"+6281234567005","type":"audio","audio":{"id":"audio-001","mime_type":"audio/ogg; codecs=opus"},"id":"wamid.HBgLNjI4MTIzNDU2NzAwNQAA"}]}}]}]}',
   'processed', true,
   NOW() - INTERVAL '30 minutes'),

  -- pesan dari nomor tidak dikenal (belum diproses)
  (NULL,
   'wamid.UNKNOWN00000000001',
   '+6299999999999',
   'text', 'halo ini warung apa?',
   '{"object":"whatsapp_business_account","entry":[{"changes":[{"value":{"messages":[{"from":"+6299999999999","type":"text","text":{"body":"halo ini warung apa?"},"id":"wamid.UNKNOWN00000000001"}]}}]}]}',
   'received', false,
   NOW() - INTERVAL '45 minutes')
ON CONFLICT DO NOTHING;


-- ─────────────────────────────────────────────────────────────
-- VERIFICATION QUERIES
-- Uncomment dan jalankan satu per satu untuk verifikasi.
-- ─────────────────────────────────────────────────────────────

/*

-- 1. Cek semua tabel ada dan berisi data
SELECT 'users'             AS tabel, COUNT(*) FROM users
UNION ALL
SELECT 'transactions',       COUNT(*) FROM transactions
UNION ALL
SELECT 'reminders',          COUNT(*) FROM reminders
UNION ALL
SELECT 'incoming_messages',  COUNT(*) FROM incoming_messages
UNION ALL
SELECT 'weekly_reports',     COUNT(*) FROM weekly_reports;
-- Expected: users=5, transactions=30, reminders=1, incoming=3, reports=1

-- 2. Test get_active_debts (Mas Budi — punya hutang overdue)
SELECT * FROM get_active_debts('a0000001-0000-0000-0000-000000000004');

-- 3. Test get_active_credits (Ibu Sari — punya piutang ke Bu Endang)
SELECT * FROM get_active_credits('a0000001-0000-0000-0000-000000000001');

-- 4. Test get_weekly_aggregate (Ibu Sari, minggu ini)
SELECT * FROM get_weekly_aggregate(
  'a0000001-0000-0000-0000-000000000001',
  date_trunc('week', CURRENT_DATE)::DATE,
  (date_trunc('week', CURRENT_DATE) + INTERVAL '6 days')::DATE
);

-- 5. Test link_payment_to_debt — exact match
SELECT * FROM link_payment_to_debt(
  'a0000001-0000-0000-0000-000000000004',  -- Mas Budi
  'Bu Tini Sembako',
  350000
);

-- 6. Test link_payment_to_debt — partial match (nama disingkat)
SELECT * FROM link_payment_to_debt(
  'a0000001-0000-0000-0000-000000000004',
  'bu tini',
  99999  -- nominal beda, tapi nama partial match
);

-- 7. Test link_payment_to_debt — no match
SELECT * FROM link_payment_to_debt(
  'a0000001-0000-0000-0000-000000000004',
  'Pak Tidak Ada',
  100000
);

-- 8. Cek pending reminders (n8n polling query)
SELECT r.*, u.whatsapp_phone, t.nominal, t.pihak
FROM reminders r
JOIN users u ON u.id = r.user_id
JOIN transactions t ON t.id = r.transaction_id
WHERE r.status = 'pending'
  AND r.remind_at <= NOW();

-- 9. Cek parent-child linkage (terima_piutang → piutang asal)
SELECT
  child.category     AS payment_type,
  child.pihak,
  child.nominal      AS payment_amount,
  parent.nominal     AS original_amount,
  parent.status      AS parent_status
FROM transactions child
JOIN transactions parent ON parent.id = child.parent_transaction_id
WHERE child.category IN ('bayar_hutang', 'terima_piutang');

-- 10. Cek transaksi yang perlu konfirmasi user
SELECT user_id, raw_input, confidence, created_at
FROM transactions
WHERE status = 'pending_confirmation'
ORDER BY created_at DESC;

*/

-- ─────────────────────────────────────────────────────────────
-- END: 001_initial_schema.sql
-- ─────────────────────────────────────────────────────────────
