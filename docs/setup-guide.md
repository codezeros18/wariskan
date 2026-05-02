# Wariskan — Setup & Collaboration Guide
**Last updated:** 2 Mei 2026 | **Hackathon:** Code the Future by Skystar Capital

> Baca ini dari atas ke bawah sekali. Setelah itu gunakan sebagai referensi kalau ada yang lupa. Kalau masih bingung setelah baca ini, ping Builder 3 (PM Lead) — jangan tebak-tebak.

---

## 1. Project Overview

### Apa yang kita bangun?

**Wariskan** adalah AI bookkeeper berbasis WhatsApp yang dirancang khusus untuk pemilik warung kecil di Indonesia. Pengguna cukup mengirim foto struk, foto bukti transfer, atau pesan teks seperti *"beli gula 25rb, beli minyak 30rb"* — dan sistem akan otomatis mencatat transaksi, merangkum keuangan harian, serta mengingatkan utang/piutang. Tidak perlu aplikasi tambahan. Tidak perlu belajar software baru. Cukup WhatsApp.

### Agentic Loop (4 kalimat)

1. **Input masuk** via WhatsApp Cloud API (teks, gambar, atau voice note) dan diterima oleh webhook n8n.
2. **AI processing** — Claude/GPT mengekstrak data transaksi dari pesan atau gambar, lalu memformat hasilnya ke struktur JSON yang konsisten.
3. **Data disimpan** ke Supabase (database utama) dan Google Sheets (dashboard yang bisa dilihat pemilik warung langsung).
4. **Response dikirim balik** ke WhatsApp berupa konfirmasi transaksi, rangkuman saldo, atau reminder utang — semua dalam Bahasa Indonesia yang natural.

### Tech Stack at a Glance

| Layer | Tool | Keterangan |
|---|---|---|
| Messaging | WhatsApp Cloud API | Input/output ke pengguna |
| Orchestration | n8n (self-hosted, Railway) | Workflow automation engine |
| AI | Anthropic Claude + OpenAI | Ekstraksi transaksi, vision |
| Database | Supabase (PostgreSQL) | Penyimpanan data utama |
| Spreadsheet | Google Sheets + Service Account | Dashboard warung owner |
| Frontend | Lovable (export hari ke-6) | Dashboard internal tim |
| Runtime | Node.js 20 LTS | Helper scripts & utilities |
| Deploy | Railway | Hosting n8n instance |

### Responsibility per Builder

| Builder | Area | Detail |
|---|---|---|
| **Builder 1** | Backend & Database | Supabase schema, RLS policies, API endpoints jika ada |
| **Builder 2** | Integrations | WhatsApp Cloud API setup, Google Sheets sync, webhook handling |
| **Builder 3 (PM)** | AI + Fullstack + Infra | n8n workflows, prompt engineering, deployment, koordinasi tim |

> **Rule:** Kalau pekerjaan overlap, koordinasi dulu via WA grup sebelum mulai. Jangan dua orang kerjain hal yang sama.

---

## 2. Environment Setup

### 2.1 Prerequisites — Install Ini Dulu

**Node.js 20 LTS (wajib, jangan versi lain)**

```bash
# Cek versi yang sudah ada
node --version
# Harus output: v20.x.x

# Kalau belum ada atau versi beda, download di:
# https://nodejs.org/en/download (pilih "20 LTS")

# Atau pakai nvm (recommended):
nvm install 20
nvm use 20
```

**Docker Desktop** (untuk run n8n lokal)
- Download: https://www.docker.com/products/docker-desktop
- Verifikasi: `docker --version` dan `docker compose --version`

**Git**
```bash
git --version
# Harus output: git version 2.x.x
```

---

### 2.2 Clone Repo

```bash
# Clone project
git clone https://github.com/[ORG]/wariskan-mvp.git
cd wariskan-mvp

# Install dependencies
npm install

# Verifikasi struktur folder
ls
# Output yang diharapkan:
# README.md  docs/  n8n-workflows/  helpers/  prompts/  tests/  dashboard/
```

> `[ORG]` — minta link repo dari Builder 3 kalau belum dapat invite GitHub.

---

### 2.3 File `.env` — Konfigurasi Secrets

Buat file `.env` di root project. **JANGAN commit file ini ke Git.**

```bash
# Di root folder project:
cp .env.example .env
# Lalu edit .env dengan credentials yang dikirim via WA (encrypted)
```

Template `.env`:

```env
# ─── WhatsApp Cloud API ───────────────────────────────────────
WHATSAPP_TOKEN=YOUR_WHATSAPP_PERMANENT_TOKEN
WHATSAPP_PHONE_NUMBER_ID=YOUR_PHONE_NUMBER_ID
WHATSAPP_VERIFY_TOKEN=wariskan_webhook_verify_2026

# ─── Supabase (DEV) ──────────────────────────────────────────
SUPABASE_URL=https://XXXXXXXXXXXX.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIs...

# ─── Supabase (PROD) — jangan dipakai untuk testing! ─────────
SUPABASE_PROD_URL=https://YYYYYYYYYYYY.supabase.co
SUPABASE_PROD_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
SUPABASE_PROD_SERVICE_KEY=eyJhbGciOiJIUzI1NiIs...

# ─── AI APIs ─────────────────────────────────────────────────
ANTHROPIC_API_KEY=sk-ant-api03-...
OPENAI_API_KEY=sk-proj-...

# ─── Google Sheets ────────────────────────────────────────────
GOOGLE_SERVICE_ACCOUNT_EMAIL=wariskan-bot@PROJECT_ID.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
GOOGLE_SHEET_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms

# ─── n8n ─────────────────────────────────────────────────────
N8N_WEBHOOK_BASE_URL=https://wariskan-n8n.up.railway.app
N8N_API_KEY=YOUR_N8N_API_KEY

# ─── App Config ───────────────────────────────────────────────
NODE_ENV=development
PORT=3000
```

> Credentials asli dikirim via **WA grup "Wariskan Dev - Secrets"** dalam format terenkripsi. Jangan screenshot, jangan forward.

---

### 2.4 Run n8n Lokal (Development)

Buat file `docker-compose.yml` di root (sudah ada di repo):

```yaml
version: '3.8'
services:
  n8n:
    image: n8nio/n8n:latest
    restart: always
    ports:
      - "5678:5678"
    environment:
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=admin
      - N8N_BASIC_AUTH_PASSWORD=wariskan2026
      - WEBHOOK_URL=http://localhost:5678/
    volumes:
      - n8n_data:/home/node/.n8n

volumes:
  n8n_data:
```

```bash
# Start n8n
docker compose up -d

# Cek status
docker compose ps
# Output: n8n ... Up 0.0.0.0:5678->5678/tcp

# Buka browser
open http://localhost:5678
# Login: admin / wariskan2026
```

---

### 2.5 Verifikasi Environment

Jalankan script ini setelah setup:

```bash
npm run verify-env
```

Expected output:
```
✅ Node version: v20.x.x
✅ .env file found
✅ Supabase connection: OK
✅ Anthropic API: OK
✅ OpenAI API: OK
✅ Google Sheets: OK
✅ n8n local: running on :5678
```

Kalau ada yang ❌, lihat section Troubleshooting di bawah.

---

## 3. Working with Our Infrastructure

### 3.1 n8n — Workflow Engine

| | Dev | Prod |
|---|---|---|
| **URL** | `http://localhost:5678` | `https://wariskan-n8n.up.railway.app` |
| **User** | admin | admin |
| **Password** | wariskan2026 | *(dari Builder 3)* |

**Cara akses shared instance (Railway):**
1. Buka URL prod di atas
2. Login dengan credentials yang dikirim via WA
3. Untuk import workflow: klik ≡ menu → **Import from File** → pilih file JSON dari folder `n8n-workflows/`

**Rules n8n:**
- Workflow yang sudah aktif di prod **jangan diedit langsung** — duplicate dulu, edit di copy-nya, test, baru replace
- Selalu export workflow setelah selesai edit dan simpan ke `n8n-workflows/` sebelum commit

---

### 3.2 Supabase — Database

| | Dev | Prod |
|---|---|---|
| **Project** | wariskan-dev | wariskan-prod |
| **Dashboard** | `https://app.supabase.com` | sama |
| **Credentials** | dari `.env` DEV section | dari `.env` PROD section — **readonly untuk Builder 1&2** |

**Akses Dashboard:**
1. Login ke `https://app.supabase.com` dengan akun yang sudah di-invite
2. Pilih project `wariskan-dev` untuk development
3. **Jangan touching project `wariskan-prod`** tanpa koordinasi Builder 3

**Tabel utama yang perlu diketahui:**

```
transactions     — semua transaksi warung
users            — data pemilik warung (phone number, nama, dll)
debts            — catatan utang/piutang
daily_summaries  — rangkuman harian yang sudah di-generate
```

---

### 3.3 Google Sheets — Dashboard Warung

Service account yang dipakai: `wariskan-bot@[PROJECT_ID].iam.gserviceaccount.com`

**Cara share Google Sheet ke service account:**
1. Buka sheet yang mau dihubungkan
2. Klik **Share** (pojok kanan atas)
3. Tambahkan email service account di atas
4. Set permission: **Editor**
5. Uncheck "Notify people" → klik **Share**

**Template sheet sudah ada di:**
`https://docs.google.com/spreadsheets/d/[SHEET_ID]` *(link lengkap dari Builder 3)*

Struktur sheet:
- Tab `Transaksi` — raw transactions
- Tab `Harian` — daily summary
- Tab `Utang Piutang` — debt tracker

---

### 3.4 WhatsApp Cloud API

| | Sandbox (Testing) | Production |
|---|---|---|
| **Nomor** | +1 (555) TEST-NUM | *(setelah approval Meta)* |
| **Cara test** | Kirim pesan ke nomor sandbox | — |
| **Token** | `WHATSAPP_TOKEN` di `.env` | Token production (beda) |

**Untuk testing lokal dengan webhook:**
```bash
# Install ngrok kalau belum ada
npm install -g ngrok

# Expose local port ke internet
ngrok http 5678

# Copy URL yang muncul (contoh: https://abc123.ngrok-free.app)
# Set sebagai Webhook URL di Meta Developer Console
```

**Meta Developer Console:** `https://developers.facebook.com/apps/[APP_ID]`
*(App ID dari Builder 3)*

---

### 3.5 AI APIs — Anthropic & OpenAI

**Shared team keys** ada di `.env`. **Jangan buat key baru pakai akun pribadi.**

**Rate limits yang perlu diingat:**

| API | Tier kita | Limit |
|---|---|---|
| Anthropic Claude | Tier 2 | 40 req/min, $50/day |
| OpenAI GPT-4o | Tier 1 | 500 req/min |

**Best practices:**
- Untuk **ekstraksi transaksi teks** → pakai Claude Haiku (murah, cepat)
- Untuk **vision/image processing** → pakai Claude Sonnet atau GPT-4o Vision
- **Jangan panggil LLM di dalam loop tanpa rate limiting**
- Monitor usage di: `https://console.anthropic.com` dan `https://platform.openai.com/usage`

---

## 4. Daily Workflow Rules

### Jadwal Harian

| Waktu | Kegiatan | Platform | Durasi |
|---|---|---|---|
| **08:30 WIB** | Daily standup | WA Grup / Huddle | 15 menit |
| **21:00 WIB** | Daily check-in | WA Grup / Huddle | 30 menit |

**Format standup (3 kalimat, wajib):**
```
✅ Kemarin: [selesai apa]
🔨 Hari ini: [mau ngerjain apa]
🚧 Blocker: [ada hambatan tidak? kalau tidak, tulis "clear"]
```

---

### Git Workflow

**Branch naming:**
```
feat/[namabuilder]-[feature]

Contoh:
feat/budi-supabase-schema
feat/andi-whatsapp-webhook
feat/reza-debt-reminder
```

**Commit message format:**
```
[type]: [deskripsi singkat dalam bahasa Indonesia/Inggris]

type:
  feat     — fitur baru
  fix      — bug fix
  chore    — setup, config, dependencies
  docs     — dokumentasi
  refactor — refactor tanpa tambah fitur

Contoh:
feat: tambah ekstraksi transaksi dari foto struk
fix: perbaiki parsing nominal dengan titik ribuan
chore: setup supabase client dengan service key
```

**Workflow:**
```bash
# 1. Selalu pull main dulu sebelum mulai
git checkout main
git pull origin main

# 2. Buat branch baru
git checkout -b feat/[nama]-[feature]

# 3. Kerja, commit dengan format di atas
git add [file-yang-relevan]
git commit -m "feat: deskripsi singkat"

# 4. Push dan buat PR ke main
git push origin feat/[nama]-[feature]
# Buat Pull Request di GitHub → assign ke Builder 3 untuk review
```

> **Jangan push langsung ke `main`.** Selalu lewat PR, minimal 1 approval.

---

### Rule: Kapan Harus Minta Bantuan

> **Stuck lebih dari 30 menit = wajib ping di WA grup.**

Jangan buang waktu terlalu lama stuck sendirian. Kita hackathon, waktu mepet. Cara ping yang benar:

```
🚧 BUTUH BANTUAN
Problem: [deskripsi masalah]
Sudah coba: [apa yang sudah dicoba]
Error message: [paste error-nya]
File: [nama file dan line number]
```

---

### Etika WA & Komunikasi

- **WA Grup "Wariskan Dev"** — untuk koordinasi teknis dan update progress
- **WA Grup "Wariskan Dev - Secrets"** — HANYA untuk sharing credentials. Pesan otomatis hapus 24 jam.
- **Jangan diskusi panjang di WA** — kalau butuh diskusi lebih dari 5 pesan, langsung huddle/call
- **Notion** — untuk dokumentasi yang perlu disimpan permanen
- **GitHub Issues** — untuk bug report dan task tracking
- Kalau ada yang tidak aktif >2 jam di jam kerja tanpa notice, ping langsung

---

## 5. Resource Links

| Resource | Link | Keterangan |
|---|---|---|
| **GitHub Repo** | `https://github.com/[ORG]/wariskan-mvp` | Main repo |
| **Notion Workspace** | `https://notion.so/[WORKSPACE]/wariskan` | Dokumentasi & planning |
| **n8n Live** | `https://wariskan-n8n.up.railway.app` | Workflow production |
| **Supabase Dev** | `https://app.supabase.com/project/[DEV_ID]` | Database development |
| **WhatsApp Test** | `+1 555 TEST-NUM` | Sandbox testing |
| **Meta Dev Console** | `https://developers.facebook.com/apps/[APP_ID]` | WA API config |
| **Railway Dashboard** | `https://railway.app/project/[PROJECT_ID]` | Deployment monitoring |

### Dokumentasi Referensi

| Docs | Link |
|---|---|
| n8n Docs | https://docs.n8n.io |
| Anthropic API Docs | https://docs.anthropic.com |
| OpenAI API Docs | https://platform.openai.com/docs |
| Supabase Docs | https://supabase.com/docs |
| WhatsApp Cloud API | https://developers.facebook.com/docs/whatsapp/cloud-api |
| Google Sheets API | https://developers.google.com/sheets/api |

> Link yang ada `[placeholder]` — minta dari Builder 3 via WA. Semua link akan diupdate di Notion setelah hackathon mulai.

---

## 6. Common Troubleshooting

### ❌ "Saya tidak bisa akses n8n (Railway)"

**Penyebab paling umum:** IP whitelist atau session expired.

```
Coba urutan ini:
1. Refresh halaman dan coba login ulang
2. Cek apakah URL-nya benar: https://wariskan-n8n.up.railway.app
3. Coba dari browser lain atau incognito mode
4. Kalau masih gagal → ping Builder 3 untuk cek Railway logs
```

---

### ❌ "API call return 401 Unauthorized"

**Penyebab:** Token expired, salah key, atau `.env` tidak ter-load.

```bash
# Verifikasi .env ter-load dengan benar
node -e "require('dotenv').config(); console.log(process.env.ANTHROPIC_API_KEY?.slice(0,10))"
# Output harus: sk-ant-api

# Kalau undefined:
# 1. Pastikan file namanya persis ".env" (bukan ".env.txt" atau "env")
# 2. Pastikan kamu di folder root project saat run script
# 3. Copy ulang key dari WA Secrets grup
```

---

### ❌ "Webhook WhatsApp tidak trigger"

**Urutan debug:**

```
1. Cek n8n workflow aktif (toggle ON di n8n dashboard)
2. Pastikan Webhook URL di Meta Developer Console = URL n8n yang benar
   → kalau local: ngrok URL + /webhook/[path]
   → kalau production: Railway URL + /webhook/[path]
3. Cek Meta Console → Webhooks → test dengan "Send Test"
4. Lihat n8n execution log — apakah request masuk tapi error di tengah?
5. Kalau pakai ngrok: pastikan ngrok masih jalan (session 2 jam gratis)
```

---

### ❌ "Google Sheets tidak terupdate"

```
1. Pastikan sheet sudah di-share ke service account email (lihat section 3.3)
2. Cek GOOGLE_SHEET_ID di .env — ambil dari URL sheet:
   https://docs.google.com/spreadsheets/d/[INI_YANG_DIAMBIL]/edit
3. Pastikan GOOGLE_PRIVATE_KEY di .env ada newline \n yang benar
   (common issue: copy-paste menghilangkan format)
4. Test koneksi: node helpers/googleSheets.js
```

---

### ❌ "Error: Cannot find module '...'"

```bash
# Hapus node_modules dan install ulang
rm -rf node_modules package-lock.json
npm install
```

---

### ❌ "n8n Docker tidak mau start"

```bash
# Cek apakah port 5678 sudah dipakai
lsof -i :5678   # Mac/Linux
netstat -ano | findstr :5678   # Windows

# Kalau ada yang pakai port itu, kill dulu
# Atau ganti port di docker-compose.yml: "5679:5678"

# Reset n8n data kalau perlu (hati-hati, data lokal hilang)
docker compose down -v
docker compose up -d
```

---

### ❌ "Claude/OpenAI balik error 429 (Rate Limit)"

```
Ini terjadi kalau terlalu banyak request dalam waktu singkat.

1. Tambahkan delay antar request (sudah ada helper di helpers/formatters.js)
2. Cek usage di Anthropic Console — kalau mendekati daily limit, beritahu Builder 3
3. Untuk testing volume tinggi, gunakan stress-test.js dengan flag --slow
4. Jangan run stress test di prod environment
```

---

## Appendix: Checklist Onboarding

Copy-paste ini ke Notion task kamu dan centang satu per satu:

```
[ ] Node.js 20 LTS terinstall (node --version = v20.x.x)
[ ] Docker Desktop terinstall dan jalan
[ ] Repo sudah di-clone
[ ] npm install sukses tanpa error
[ ] File .env sudah dibuat dan diisi dengan credentials dari WA
[ ] n8n lokal jalan di http://localhost:5678
[ ] npm run verify-env semua ✅
[ ] Bisa akses Supabase dashboard
[ ] Bisa akses n8n Railway (production)
[ ] Sudah kirim pesan test ke WhatsApp sandbox
[ ] Sudah baca dan paham Git workflow
[ ] Sudah set reminder 08:30 dan 21:00 WIB di HP
```

---

*Dokumen ini dikelola oleh Builder 3. Update terakhir otomatis di-push ke Notion setiap ada perubahan major. Kalau ada yang outdated atau salah, langsung ping — jangan diam-diam dipakai yang salah.*
