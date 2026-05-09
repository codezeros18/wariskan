# Wariskan — AI Bookkeeper WhatsApp
**Hackathon:** Code the Future by Skystar Capital  
**Status terakhir diupdate:** 9 Mei 2026

---

## Apa yang sudah jalan ✅

Pipeline utama **sudah bekerja end-to-end**:

1. WhatsApp webhook menerima pesan masuk via **WAHA** (self-hosted gateway)
2. Payload di-parse, pesan stale (>10 menit), grup, dan fromMe di-skip otomatis
3. User di-lookup atau dibuat di Supabase (`users`), `last_active_at` diupdate
4. Pesan masuk dicatat ke tabel `incoming_messages`
5. Pesan diroute berdasarkan tipe: text / audio / image / unsupported
6. **Text** → **Claude (`claude-sonnet-4-20250514`)** ekstrak JSON transaksi
7. **Audio** → **OpenAI (`gpt-4o-mini-transcribe`)** STT → Claude Extract
8. **Image** → **Claude Vision (`claude-sonnet-4-20250514`)** baca struk
9. Transaksi disimpan ke Supabase (`transactions`) — idempotent via `source_message_id`
10. Google Sheets per-user disinkron via Helper API (`localhost:3001`)
11. Reply teks dikirim ke **owner saja** (`6281284818862@c.us`) via WAHA
12. Outgoing message dicatat ke tabel `outgoing_messages`

**Commands yang sudah bisa dipakai user:**
- `laporan` / `ringkasan` / `rekap` — lihat summary hari ini + bulan ini
- `hutang` / `piutang` — list hutang/piutang aktif
- `hapus terakhir` — batalkan transaksi terakhir
- `koreksi nominal 52000` / `koreksi kategori pengeluaran` — koreksi transaksi terakhir

**Yang belum selesai:**
- Google Sheets belum aktif jika user tidak punya `sheet_id` (auto-create via Helper API)
- Reminder harian dan weekly report belum aktif (workflow terpisah, butuh Helper API jalan)

---

## Cara Run (Windows, PowerShell)

### Prasyarat
- Node.js 18+ terinstall
- Docker Desktop terinstall dan **sudah jalan**
- ngrok atau Cloudflare Tunnel untuk expose localhost ke internet

### 1. Jalankan WAHA (WhatsApp gateway)

WAHA berjalan di Docker. Jalankan setiap kali laptop dinyalakan:

```powershell
docker start waha
```

Jika container belum ada (pertama kali / setelah reset Docker):
```powershell
docker run -d --name waha -p 3000:3000 -v D:/waha-data:/app/.sessions -e WHATSAPP_API_KEY=wariskan123 devlikeapro/waha
```

Cek status WAHA:
```powershell
curl http://localhost:3000/api/sessions/default -H "X-Api-Key: wariskan123"
```
Status harus `"WORKING"`. Kalau `"STOPPED"`, jalankan:
```powershell
curl -X POST http://localhost:3000/api/sessions/default/start -H "X-Api-Key: wariskan123"
```

**Scan QR (jika session baru / expired):**
```powershell
curl "http://localhost:3000/api/default/auth/qr?format=image" -H "X-Api-Key: wariskan123" --output D:/waha-qr.png
Start-Process "D:\waha-qr.png"
```
Scan QR dengan WhatsApp HP → **Linked Devices → Link a Device**.

### 2. Jalankan n8n

```powershell
cd D:\wariskan
.\start-n8n.ps1
```

n8n akan berjalan di `http://localhost:5678`.  
**Jangan tutup terminal ini** selama n8n dibutuhkan.

### 3. Expose ke internet (wajib untuk webhook WhatsApp)

```powershell
ngrok http 5678
```

Catat URL yang muncul, contoh: `https://abc123.ngrok.io`

Daftarkan webhook di WAHA dashboard → Sessions → Webhooks:
```
https://abc123.ngrok.io/webhook/whatsapp-webhook
```

### 4. Import workflow ke n8n

1. Buka `http://localhost:5678`
2. Buat workflow baru → **⋮ → Import from file**
3. Pilih `D:\wariskan\n8n-workflows\wariskan-base-workflow.json`
4. **Save** dan **Activate** (toggle hijau kanan atas)

Untuk workflow cron, import secara terpisah:
- `wariskan-daily-reminder.json` — reminder hutang harian
- `wariskan-weekly-report.json` — laporan mingguan

---

## Kredensial & API Keys

Semua key sudah diisi di `start-n8n.ps1`.

### Supabase
| Key | Lokasi |
|-----|--------|
| `SUPABASE_URL` | Supabase dashboard → Settings → API |
| `SUPABASE_SERVICE_KEY` | Supabase dashboard → Settings → API → `service_role` key |

Tidak perlu direfresh — berlaku permanen.

### WAHA (WhatsApp HTTP API)
| Key | Nilai |
|-----|-------|
| API Key | `wariskan123` |
| Port | `3000` |
| Session | `default` |
| Send endpoint | `POST http://localhost:3000/api/sendText` |
| Owner chat ID | `6281284818862@c.us` |

WAHA terhubung ke nomor WhatsApp: **+62 812-8481-8862** (Lintang).  
Semua reply dikirim **hanya ke nomor ini** (owner-only mode), bukan ke nomor pengirim.

### Anthropic (Claude)
| Key | Lokasi |
|-----|--------|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API Keys |
| `ANTHROPIC_MODEL` | (opsional) override model, default: `claude-sonnet-4-20250514` |
| `ANTHROPIC_EXTRACT_MODEL` | (opsional) override model text extraction |
| `ANTHROPIC_VISION_MODEL` | (opsional) override model vision |

Model fallback hierarchy (text): `ANTHROPIC_EXTRACT_MODEL` → `ANTHROPIC_MODEL` → `claude-3-5-haiku-20241022` → `claude-sonnet-4-20250514`  
Model fallback hierarchy (vision): `ANTHROPIC_VISION_MODEL` → `ANTHROPIC_MODEL` → `claude-sonnet-4-20250514` → `claude-3-7-sonnet-20250219` → `claude-3-5-haiku-20241022`

### OpenAI (Whisper/Transcription)
| Key | Lokasi |
|-----|--------|
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) → API Keys |
| `OPENAI_TRANSCRIBE_MODEL` | (opsional) default: `gpt-4o-mini-transcribe` |

Dipakai untuk STT voice note.

### Helper API (Google Sheets & Scheduler)
| Key | Nilai |
|-----|-------|
| `HELPER_API_URL` | `http://localhost:3001` |
| `HELPER_API_KEY` | `dev` |

Health check: `GET http://localhost:3001/health`  
Dipakai untuk Google Sheets sync (`/api/sheets/append`, `/api/sheets/create`) dan scheduler cron.

### Error Notification (opsional)
| Key | Nilai |
|-----|-------|
| `SLACK_ERROR_WEBHOOK` | Slack webhook URL untuk notifikasi error |

Jika tidak diisi, error notification node tetap berjalan tapi request gagal secara silent.

---

## Arsitektur Workflow n8n

### 1. Base Workflow — Pesan Masuk

```
[WAHA Webhook POST /webhook/whatsapp-webhook]
        ↓
[Parse WhatsApp Payload]
    • Skip: fromMe, grup (@g.us), pesan stale (>10 menit)
    • Extract: senderPhone, chatId, messageType, textContent, mediaUrl
        ↓
[Get or Create User]     ← lookup Supabase, create jika baru, update last_active_at
        ↓
[Log Incoming Message]   ← simpan ke tabel incoming_messages
        ↓
[Route by Message Type]
    ├── text  → [Handle Text]          → [Claude Extract] ──────────────────┐
    ├── audio → [Download Audio Media] → [Whisper STT]                      │
    │           (WAHA media endpoint)   → [Merge Whisper Result] → [Claude Extract]
    ├── image → [Download Image Media] → [Claude Vision] ─────────────────┐ │
    └── other → [Send Unsupported Reply] → [Send WhatsApp Reply]          │ │
                                                                           ↓ ↓
                                                                    [Validate JSON]
                                                                           ↓
                                                                   [Save to Supabase]
                                                                     • Idempotent
                                                                     • Handle commands
                                                                           ↓
                                                                 [Save to Google Sheets]
                                                                     • via Helper API
                                                                     • Auto-create sheet
                                                                           ↓
                                                                  [Build Reply Message]
                                                                     • Summary hari ini
                                                                     • Summary bulan ini
                                                                           ↓
                                                                  [Send WhatsApp Reply]
                                                                     • OWNER ONLY
                                                                     • 6281284818862@c.us
                                                                     • Log ke outgoing_messages
```

**Handle Text** juga mendeteksi commands sebelum Claude Extract:
- `laporan/ringkasan/rekap` → query summary, skip extraction
- `hapus terakhir` → batalkan transaksi terakhir
- `koreksi [field] [value]` → update transaksi terakhir

### 2. Daily Reminder Cron

```
[Schedule Trigger — 09:00 WIB (02:00 UTC) setiap hari]
        ↓
[Create Due Reminders]   ← POST $SCHEDULER_BASE_URL/run/reminder-creation
        ↓
[Log Creation Result]    ← throw error jika gagal
        ↓
[Send Debt Reminders]    ← POST $SCHEDULER_BASE_URL/run/debt-reminder
        ↓
[Log Reminder Result]    ← log summary: remindersSent, skipped, errors
```

### 3. Weekly Report Cron

```
[Schedule Trigger — Minggu 20:00 WIB (13:00 UTC)]
        ↓
[Run Weekly Report Job]  ← POST $SCHEDULER_BASE_URL/run/weekly-report
        ↓
[Log Weekly Report Result]
```

Laporan idempotent — duplikat untuk minggu yang sama di-skip via tabel `weekly_reports`.

---

## Known Issues

### 1. Reply WhatsApp hanya ke owner (by design, tapi jadi kendala demo)
**Gejala:** Bot hanya membalas ke `6281284818862@c.us`, bukan ke nomor pengirim.

**Root cause:** `Send WhatsApp Reply` hardcode ke `OWNER_CHAT_ID = '6281284818862@c.us'` karena nomor WAHA = nomor pribadi Lintang.

**Untuk demo multi-user:** Perlu nomor kedua sebagai nomor bot (SIM terpisah / WhatsApp Business).

### 2. Google Sheets hanya aktif jika user punya `sheet_id`
**Gejala:** Node `Save to Google Sheets` memanggil `Helper API /api/sheets/create` untuk user baru. Jika Helper API tidak jalan, sheet tidak dibuat dan sync di-skip.

**Solusi:** Pastikan Helper API jalan di `localhost:3001` sebelum demo. Cek: `curl http://localhost:3001/health`

### 3. WAHA session reset setiap Docker restart
Jika Docker Desktop restart, session WAHA perlu scan QR ulang kecuali volume `-v D:/waha-data:/app/.sessions` berhasil menyimpan session.

### 4. Reminder dan Weekly Report butuh Helper API
Workflow `wariskan-daily-reminder.json` dan `wariskan-weekly-report.json` keduanya memanggil `$SCHEDULER_BASE_URL`. Jika Helper API tidak jalan, workflow ini akan error.

---

## Supabase Database

**Project URL:** `https://oigrftmbfzflyznlgnyc.supabase.co`

Tabel yang ada:
| Tabel | Isi |
|-------|-----|
| `users` | Data pengguna: `whatsapp_phone`, `display_name`, `sheet_id`, `sheet_url`, `last_active_at` |
| `transactions` | Transaksi: `user_id`, `category`, `nominal`, `item`, `pihak`, `tanggal`, `jatuh_tempo`, `status`, `confidence`, `ai_model_version`, `source_message_id` |
| `incoming_messages` | Log pesan masuk: `user_id`, `whatsapp_message_id`, `message_type`, `raw_text`, `status`, `processed` |
| `outgoing_messages` | Log pesan keluar: `user_id`, `transaction_id`, `chat_id`, `reply_text`, `status`, `provider`, `provider_message_id` |
| `reminders` | Reminder hutang: `transaction_id`, `status` (pending/sent/cancelled) |
| `weekly_reports` | Track laporan mingguan yang sudah dikirim (idempotency) |

User yang sudah terdaftar: **Lintang Balakosa Ardhana** (`id: 3a8c818a-f264-49ef-9a54-c46508384175`)

---

## Struktur File

```
D:\wariskan\
├── start-n8n.ps1                    ← Script untuk jalankan n8n (semua env var di sini)
├── README.md                        ← File ini
├── tool_list.md                     ← Daftar tools/integrasi yang dipakai
├── system_prompts.md                ← System prompt Claude extraction dan vision
├── .env.example                     ← Template env vars
├── n8n-workflows/
│   ├── wariskan-base-workflow.json  ← Workflow utama (IMPORT INI ke n8n)
│   ├── wariskan-daily-reminder.json ← Workflow reminder harian (import terpisah)
│   ├── wariskan-weekly-report.json  ← Workflow laporan mingguan (import terpisah)
│   ├── wariskan-demo-trigger.json   ← Manual trigger untuk demo/pitch
│   └── webhook-security-code-node.js ← Helper validasi signature
└── helpers/
    ├── whatsappHelper.js            ← Helper kirim pesan via WAHA
    ├── googleSheetsHelper.js        ← Helper Google Sheets
    ├── formatters.js                ← Format Rupiah, tanggal
    ├── messages.js                  ← Template pesan Bahasa Indonesia
    ├── scheduler.js                 ← Helper scheduler (daily reminder, weekly report)
    └── webhookSecurity.js           ← Validasi webhook signature
```

---

## Selanjutnya yang Bisa Dikerjakan Tim

### Prioritas 1 — Nomor Bot Terpisah
Daftarkan nomor WhatsApp kedua ke WAHA agar reply bisa ke semua user (bukan owner-only). Update `OWNER_CHAT_ID` di node `Send WhatsApp Reply` dan `Build Reply Message`.

### Prioritas 2 — Aktifkan Helper API
Pastikan `helpers/scheduler.js` / helper server jalan di `localhost:3001` agar:
- Google Sheets auto-create dan sync aktif
- Daily reminder dan weekly report bisa berjalan

### Prioritas 3 — Deploy ke Railway
1. Deploy n8n ke Railway dengan env vars dari `start-n8n.ps1`
2. Update webhook URL di WAHA dashboard ke URL Railway
3. Update `HELPER_API_URL` ke URL Railway helper API

---

## Quick Checklist Setiap Sesi Development

```
[ ] Docker Desktop sudah jalan
[ ] docker start waha
[ ] WAHA status WORKING: curl http://localhost:3000/api/sessions/default -H "X-Api-Key: wariskan123"
[ ] .\start-n8n.ps1 dijalankan di terminal
[ ] Helper API jalan: curl http://localhost:3001/health
[ ] ngrok/cloudflare tunnel aktif
[ ] Webhook URL WAHA sudah diupdate ke URL ngrok terbaru
[ ] Workflow n8n aktif (toggle hijau)
```
