# Wariskan — AI Bookkeeper WhatsApp
**Hackathon:** Code the Future by Skystar Capital  
**Status terakhir diupdate:** 4 Mei 2026

---

## Apa yang sudah jalan ✅

Pipeline utama **sudah bekerja end-to-end**:

1. WhatsApp webhook menerima pesan masuk
2. Payload di-parse dan user di-lookup/create di Supabase
3. Pesan teks dikirim ke **Claude (`claude-haiku-4-5-20251001`)** untuk ekstraksi transaksi
4. Claude mengembalikan JSON terstruktur: `{ category, nominal, item, confidence }`
5. Data disimpan ke **Supabase** (tabel `transactions`)
6. Reply teks dikonfirmasi dalam Bahasa Indonesia: *"✅ Dicatat! Pengeluaran Rp 25.000 untuk gula sudah masuk ke buku 📒"*

**Yang belum selesai:**
- Reply WhatsApp belum bisa diterima di HP pengguna (lihat bagian [Known Issues](#known-issues))
- Google Sheets integration (node dinonaktifkan sementara)
- Whisper STT untuk voice note (node placeholder)
- Claude Vision untuk foto struk (node placeholder)

---

## Cara Run (Windows, PowerShell)

### Prasyarat
- Node.js 18+ terinstall
- Docker Desktop terinstall dan **sudah jalan**
- ngrok atau Cloudflare Tunnel untuk expose localhost ke internet

### 1. Jalankan WaHA (WhatsApp gateway)

WaHA berjalan di Docker. Jalankan setiap kali laptop dinyalakan:

```powershell
docker start waha
```

Jika container belum ada (pertama kali / setelah reset Docker):
```powershell
docker run -d --name waha -p 3000:3000 -v D:/waha-data:/app/.sessions -e WHATSAPP_API_KEY=wariskan123 devlikeapro/waha
```

Cek status WaHA:
```powershell
curl http://localhost:3000/api/sessions/default -H "X-Api-Key: wariskan123"
```
Status harus `"WORKING"`. Kalau `"STOPPED"`, jalankan:
```powershell
curl -X POST http://localhost:3000/api/sessions/default/start -H "X-Api-Key: wariskan123"
```

**Scan QR (jika session baru / expired):**
```powershell
# Ambil QR code
curl "http://localhost:3000/api/default/auth/qr?format=image" -H "X-Api-Key: wariskan123" --output D:/waha-qr.png
# Buka gambar
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

Gunakan **ngrok** atau **Cloudflare Tunnel**:

```powershell
# Dengan ngrok:
ngrok http 5678
```

Catat URL yang muncul, contoh: `https://abc123.ngrok.io`

Webhook URL untuk Meta:
```
https://abc123.ngrok.io/webhook/whatsapp-webhook
```

### 4. Import workflow ke n8n

1. Buka `http://localhost:5678`
2. Buat workflow baru → **⋮ → Import from file**
3. Pilih `D:\wariskan\n8n-workflows\wariskan-base-workflow.json`
4. **Save** dan **Activate** (toggle hijau kanan atas)

---

## Kredensial & API Keys

Semua key sudah diisi di `start-n8n.ps1`. Berikut penjelasan dan cara refresh jika expired:

### Supabase
| Key | Lokasi |
|-----|--------|
| `SUPABASE_URL` | Supabase dashboard → Settings → API |
| `SUPABASE_SERVICE_KEY` | Supabase dashboard → Settings → API → `service_role` key |

Tidak perlu direfresh — berlaku permanen.

### WhatsApp Cloud API (Meta)
| Key | Cara Refresh |
|-----|-------------|
| `WHATSAPP_TOKEN` | **Expired setiap 24 jam!** → [developers.facebook.com](https://developers.facebook.com) → App → WhatsApp → API Setup → copy token baru |
| `WHATSAPP_PHONE_NUMBER_ID` | Sama halaman, tidak berubah |
| `WHATSAPP_VERIFY_TOKEN` | Bebas, sudah di-set ke `wariskan_webhook_verify_2026` |
| `META_APP_SECRET` | Meta App Dashboard → App Settings → Basic |

**Setelah refresh token**, update di `start-n8n.ps1` baris 11, lalu restart n8n.

### Anthropic (Claude)
| Key | Lokasi |
|-----|--------|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API Keys |

Sudah ada **$5 credit**. Monitor pemakaian di Anthropic console.

### OpenAI (Whisper STT)
| Key | Lokasi |
|-----|--------|
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) → API Keys |

Dipakai untuk Whisper STT (voice note) — belum diimplementasi.

### WaHA
| Key | Nilai |
|-----|-------|
| API Key | `wariskan123` |
| Port | `3000` |
| Session | `default` |

WaHA terhubung ke nomor WhatsApp: **+62 812-8481-8862** (nomor Lintang).

---

## Arsitektur Workflow n8n

```
[WhatsApp Message masuk]
        ↓
[Parse WhatsApp Payload]  ← format WaHA: { event, payload: { from, body, type } }
        ↓
[Get or Create User]      ← lookup/create di Supabase tabel users
        ↓
[Log Incoming Message]    ← catat ke tabel incoming_messages
        ↓
[Route by Message Type]
    ├── text → [Handle Text] → [Claude Extract] → [Validate JSON] → [Save to Supabase]
    ├── audio → [Download Audio] → [Whisper STT] → [Claude Extract] → ... (placeholder)
    ├── image → [Download Image] → [Claude Vision] → ... (placeholder)
    └── other → [Send Unsupported Reply]
        ↓
[Build Reply Message]     ← buat teks konfirmasi Bahasa Indonesia
        ↓
[Send WhatsApp Reply]     ← kirim via WaHA API ke http://localhost:3000/api/sendText
```

---

## Known Issues

### 1. Reply WhatsApp belum sampai ke HP (PRIORITAS UTAMA)
**Gejala:** Pipeline berjalan sukses, wamid/wahaResult dikembalikan, tapi pesan tidak muncul di HP.

**Sudah dicoba:**
- Meta Cloud API → API accept (wamid), tapi pesan tidak muncul
- WaHA → terhubung ke nomor pribadi (+62 812-8481-8862), webhook terkonfigurasi
- Self-messaging via WhatsApp → WaHA tidak trigger webhook untuk pesan "fromMe"

**Root cause yang belum dikonfirmasi:**
- Meta: Kemungkinan pesan masuk ke tab **Updates** atau **Business** di WhatsApp (bukan inbox utama) — belum dicek
- WaHA: Nomor bot = nomor pribadi, sehingga tidak bisa dipakai untuk demo solo

**Yang perlu dilakukan tim:**
- Cek tab **Updates** di WhatsApp untuk pesan dari Meta test number (+1 555-xxx-xxxx)
- ATAU gunakan nomor kedua untuk WaHA (SIM terpisah / WhatsApp Business)
- ATAU deploy ke Railway (public URL) sehingga Meta webhook lebih stabil

### 2. Google Sheets integration
**Gejala:** Node "Save to Google Sheets" menghasilkan `#ERROR!` di sel.

**Root cause:** Ekspresi n8n ditulis secara literal ke sel, bukan nilainya.

**Node saat ini:** Dinonaktifkan dari alur utama.

**Yang perlu dilakukan:** Fix mapping kolom di node Google Sheets — pastikan menggunakan Fixed mode, bukan Expression mode untuk field yang berisi nilai statis.

### 3. WaHA session reset setiap Docker restart
Jika Docker Desktop restart, session WaHA perlu scan QR ulang kecuali volume `-v D:/waha-data:/app/.sessions` berhasil menyimpan session.

---

## Struktur File

```
D:\wariskan\
├── start-n8n.ps1                    ← Script untuk jalankan n8n (sudah ada semua env var)
├── README.md                        ← File ini
├── .env.example                     ← Template env vars (tidak pakai .env, semua di start-n8n.ps1)
├── n8n-workflows/
│   ├── wariskan-base-workflow.json  ← Workflow utama (IMPORT INI ke n8n)
│   ├── wariskan-daily-reminder.json ← Workflow reminder harian (belum aktif)
│   ├── wariskan-weekly-report.json  ← Workflow laporan mingguan (belum aktif)
│   └── wariskan-demo-trigger.json   ← Workflow untuk demo (belum aktif)
├── helpers/
│   ├── whatsappHelper.js            ← Helper kirim pesan WhatsApp
│   ├── googleSheetsHelper.js        ← Helper Google Sheets
│   ├── formatters.js                ← Format nominal Rupiah, tanggal
│   ├── messages.js                  ← Template pesan Bahasa Indonesia
│   ├── scheduler.js                 ← Helper scheduler
│   └── webhookSecurity.js           ← Validasi webhook signature Meta
└── docs/
    ├── setup-guide.md               ← Guide kolaborasi tim (detail per builder)
    └── security-checklist.md        ← Checklist keamanan
```

---

## Supabase Database

**Project URL:** `https://oigrftmbfzflyznlgnyc.supabase.co`

Tabel yang sudah ada:
- `users` — data pengguna (whatsapp_phone, display_name, sheet_id)
- `transactions` — data transaksi (user_id, category, nominal, item, raw_text)
- `incoming_messages` — log pesan masuk

User yang sudah terdaftar: **Lintang Balakosa Ardhana** (`id: 3a8c818a-f264-49ef-9a54-c46508384175`)

---

## Selanjutnya yang Bisa Dikerjakan Tim

### Prioritas 1 — Fix WhatsApp Delivery
Pilih salah satu:
- **Opsi A:** Cek tab Updates di WhatsApp (apakah reply Meta sudah masuk ke sana)
- **Opsi B:** Daftarkan nomor WhatsApp kedua ke WaHA sebagai nomor bot
- **Opsi C:** Deploy n8n ke Railway agar webhook URL permanen dan lebih stabil

### Prioritas 2 — Voice Note (Whisper STT)
Node `Download Audio Media` dan `Whisper STT` sudah ada di workflow tapi belum diimplementasi. Perlu:
1. Download audio dari WaHA/Meta menggunakan media URL
2. Kirim ke OpenAI Whisper API (`/v1/audio/transcriptions`)
3. Hasil transcript diteruskan ke Claude Extract

### Prioritas 3 — Foto Struk (Claude Vision)
Node `Download Image Media` dan `Claude Vision` sudah ada tapi belum diimplementasi. Perlu:
1. Download gambar dari WaHA/Meta
2. Kirim ke Claude dengan `image_url` atau base64
3. Ekstrak data transaksi dari gambar struk

### Prioritas 4 — Google Sheets Fix
Fix node "Save to Google Sheets" agar tidak menghasilkan `#ERROR!`.

### Prioritas 5 — Deploy ke Railway
Saat ini n8n berjalan di localhost. Untuk production:
1. Deploy n8n ke Railway dengan environment variables dari `start-n8n.ps1`
2. Update webhook URL di Meta developer console
3. Update WaHA webhook URL

---

## Quick Checklist Setiap Sesi Development

```
[ ] Docker Desktop sudah jalan
[ ] docker start waha
[ ] WaHA status WORKING (curl check)
[ ] .\start-n8n.ps1 dijalankan di terminal
[ ] ngrok/cloudflare tunnel aktif
[ ] Workflow n8n aktif (toggle hijau)
[ ] WHATSAPP_TOKEN masih valid (expires 24 jam dari generate)
```
