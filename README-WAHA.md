# Wariskan — Panduan Setup (Versi WaHA / WhatsApp HTTP API)

> Versi ini pakai WaHA — software open source yang jalanin WhatsApp Web di Docker. Nomor botnya adalah nomor HP beneran (bukan nomor test Meta), jadi demo-nya terlihat lebih natural. Tapi ada satu catch: nomor yang dipakai bot harus berbeda dari nomor yang dipakai buat ngirim pesan.

---

## Bedanya WaHA vs Meta

| | Meta Cloud API | WaHA |
|---|---|---|
| Nomor bot | Nomor test Meta (+1 555-xxx-xxxx) | Nomor HP beneran |
| Kelihatannya | Nomor asing dari US | Nomor lokal Indonesia |
| Setup | Perlu akun developer Meta | Cukup scan QR WhatsApp |
| Limitasi | Reply kadang tidak muncul di sandbox | Bot = nomor kamu, perlu HP kedua untuk test |
| Untuk demo | Kurang meyakinkan | Lebih meyakinkan |

**Rekomendasi untuk hackathon:** Pakai WaHA dengan nomor kedua (SIM card murah / nomor WhatsApp lain) sebagai nomor bot.

---

## Gambaran Singkat

Pipeline sudah jalan. Yang sudah bekerja:
- WaHA menerima pesan yang masuk ke nomor bot ✅
- n8n memproses pesan ✅
- Claude mengekstrak data transaksi ✅
- Data tersimpan di Supabase ✅
- Reply dikirim balik via WaHA API ✅

**Yang belum resolve:** Perlu nomor WhatsApp kedua untuk nomor bot (nomor yang terhubung ke WaHA). Nomor yang saat ini terhubung ke WaHA adalah +62 812-8481-8862 (nomor Lintang sendiri) — ini bikin testing jadi susah karena bot = nomor sendiri.

---

## Yang Kamu Butuhkan Sebelum Mulai

### 1. Software
- **Docker Desktop** — untuk jalanin WaHA
- **Node.js 18+** — untuk jalanin n8n
- **ngrok** atau **Cloudflare Tunnel** — untuk expose localhost ke internet

Cek apakah sudah terinstall:
```powershell
docker --version
node --version
```

### 2. Nomor WhatsApp untuk Bot

Ini yang **paling penting**. Kamu butuh nomor WhatsApp yang **khusus untuk bot**, bukan nomor pribadi. Pilihannya:

- **Nomor kedua** — beli SIM card murah, daftarkan WhatsApp
- **WhatsApp Business** — buat akun WhatsApp Business dengan nomor berbeda
- **Minta nomor teman** — yang bersedia nomornya dipakai sementara

Nomor ini yang akan di-scan QR-nya ke WaHA. Kalau sudah punya, lanjut ke langkah berikutnya.

### 3. Credentials

Semua sudah ada di `start-n8n.ps1`. Yang perlu diperhatikan:

| Credential | Info |
|---|---|
| `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | Sudah diisi, tidak berubah |
| `ANTHROPIC_API_KEY` | Sudah diisi, ada $5 credit |
| WaHA API Key | `wariskan123` (diset saat jalanin Docker) |

---

## Cara Jalanin (Step by Step)

### Step 1 — Jalankan Docker Desktop

Buka Docker Desktop dari Start Menu. Tunggu sampai icon Docker di taskbar tidak loading lagi (icon paus berhenti animasi).

### Step 2 — Jalankan WaHA

Cek apakah container WaHA sudah ada:
```powershell
docker ps -a
```

Kalau ada container bernama `waha` tapi statusnya `Exited`:
```powershell
docker start waha
```

Kalau belum ada sama sekali (pertama kali setup):
```powershell
docker run -d --name waha -p 3000:3000 -v D:/waha-data:/app/.sessions -e WHATSAPP_API_KEY=wariskan123 devlikeapro/waha
```

Tunggu 5 detik, lalu cek status:
```powershell
curl http://localhost:3000/api/sessions/default -H "X-Api-Key: wariskan123"
```

Status harus `"WORKING"`. Kalau `"STOPPED"`:
```powershell
curl -X POST http://localhost:3000/api/sessions/default/start -H "X-Api-Key: wariskan123"
```

### Step 3 — Scan QR (kalau session belum aktif atau expired)

Kalau status bukan WORKING, berarti perlu scan QR ulang:

```powershell
# Ambil QR code sebagai gambar
curl "http://localhost:3000/api/default/auth/qr?format=image" -H "X-Api-Key: wariskan123" --output D:/waha-qr.png

# Buka gambarnya
Start-Process "D:\waha-qr.png"
```

Scan QR yang muncul pakai WhatsApp **nomor bot** (bukan nomor pribadi kamu):
- Buka WhatsApp nomor bot di HP
- Tap ⋮ → **Linked Devices** → **Link a Device**
- Scan QR

> QR expired dalam ~20 detik. Kalau expired, jalankan command curl lagi untuk QR baru.

Setelah scan berhasil, cek lagi:
```powershell
curl http://localhost:3000/api/sessions/default -H "X-Api-Key: wariskan123"
```
Harus ada `"status": "WORKING"` dan `"me": { "id": "nomor@c.us" }`.

### Step 4 — Jalankan n8n

```powershell
cd D:\wariskan
.\start-n8n.ps1
```

n8n jalan di `http://localhost:5678`. Jangan tutup terminal ini.

### Step 5 — Expose ke internet

WaHA butuh mengirim webhook ke n8n. Kalau n8n ada di localhost, WaHA masih bisa karena keduanya di komputer yang sama. Tapi kalau mau Meta juga (atau deploy), butuh URL publik.

Untuk development lokal, WaHA webhook ke n8n localhost sudah oke:
```
http://localhost:5678/webhook/whatsapp-webhook
```

### Step 6 — Pastikan WaHA kirim webhook ke n8n

Cek konfigurasi webhook WaHA:
```powershell
curl http://localhost:3000/api/sessions/default -H "X-Api-Key: wariskan123"
```

Di output-nya, pastikan ada:
```json
"config": {
  "webhooks": [
    { "url": "http://localhost:5678/webhook/whatsapp-webhook", "events": ["message"] }
  ]
}
```

Kalau belum ada atau URL-nya salah, set ulang:
```powershell
curl -X PUT http://localhost:3000/api/sessions/default -H "X-Api-Key: wariskan123" -H "Content-Type: application/json" -d "{\"config\":{\"webhooks\":[{\"url\":\"http://localhost:5678/webhook/whatsapp-webhook\",\"events\":[\"message\"]}]}}"
```

### Step 7 — Import workflow & aktifkan

1. Buka `http://localhost:5678`
2. Buat workflow baru → **⋮ → Import from file**
3. Pilih `n8n-workflows/wariskan-base-workflow.json`
4. **Save** dan **Activate** (toggle hijau kanan atas)

> File workflow ini sudah dalam format WaHA (Parse Payload dan Send Reply sudah disesuaikan).

### Step 8 — Test!

Dari HP pribadi kamu, kirim pesan ke nomor bot (nomor yang tadi di-scan QR-nya):
```
beli gula 25rb
```

Cek di n8n → **Executions** → harus ada execution baru yang masuk.  
Kalau berhasil, bot akan reply dari nomor bot ke HP kamu.

---

## Format Pesan yang Bisa Dipahami Bot

Bot mengerti pesan dalam Bahasa Indonesia natural:

| Jenis | Contoh pesan |
|---|---|
| Pengeluaran | `beli gula 25rb`, `bayar listrik 150000`, `beli bensin 50k` |
| Pemasukan | `jual ayam 350rb`, `terima pembayaran 200rb` |
| Hutang | `hutang ke Pak Budi 100rb` |
| Piutang | `Bu Sari hutang 75rb` |

---

## Cara Kerja WaHA (Penjelasan Singkat)

WaHA itu basically WhatsApp Web yang dijalankan di dalam Docker. Ketika kamu scan QR, HP kamu "menghubungkan" nomor WhatsApp-nya ke WaHA — sama seperti kamu buka WhatsApp Web di browser. Bedanya, WaHA punya API sehingga n8n bisa:

1. **Menerima** pesan yang masuk ke nomor bot (via webhook)
2. **Mengirim** pesan dari nomor bot (via API)

WaHA kirim POST ke n8n setiap ada pesan masuk dengan format:
```json
{
  "event": "message",
  "session": "default",
  "payload": {
    "from": "6281234567890@c.us",
    "body": "beli gula 25rb",
    "type": "chat",
    "fromMe": false
  }
}
```

n8n memproses ini dan balas lewat:
```
POST http://localhost:3000/api/sendText
{ "session": "default", "chatId": "6281234567890@c.us", "text": "reply..." }
```

---

## Troubleshooting

### WaHA status STOPPED terus
```powershell
# Restart container
docker restart waha

# Tunggu 10 detik, cek lagi
curl http://localhost:3000/api/sessions/default -H "X-Api-Key: wariskan123"
```

### WaHA status SCAN_QR_CODE (harus scan ulang)
Session expired (biasa terjadi kalau HP nomor bot restart atau WhatsApp logout). Scan QR ulang (Step 3).

### Docker tidak bisa jalan / error I/O
Biasanya karena storage Docker penuh. Docker sudah dikonfigurasi simpan data di D drive (`D:\docker-data\DockerDesktopWSL`). Pastikan D drive masih ada space.

### Execution n8n tidak muncul setelah kirim pesan
1. Pastikan WaHA status WORKING
2. Pastikan webhook config benar (Step 6)
3. Pastikan workflow n8n aktif (toggle hijau)
4. Pastikan kamu kirim dari HP yang berbeda dari nomor bot

### Bot reply tidak sampai
Cek di execution n8n → node `Send WhatsApp Reply` → apakah ada error?
- Error `No phone number` → senderPhone tidak terambil dari payload
- Error koneksi → WaHA tidak jalan (`docker start waha`)

---

## Selanjutnya yang Bisa Dikerjakan

### Setup Nomor Bot Permanen (Prioritas 1)
Disconnect nomor +62 812-8481-8862 dari WaHA (itu nomor pribadi Lintang). Sambungkan nomor baru yang memang khusus untuk Wariskan bot.

Cara disconnect nomor lama:
1. Di HP Lintang → WhatsApp → Linked Devices → hapus WaHA dari list
2. Di WaHA, hapus session: `curl -X DELETE http://localhost:3000/api/sessions/default -H "X-Api-Key: wariskan123"`
3. Buat session baru dengan nomor bot yang baru (scan QR dari HP nomor bot)

### Voice Note — Whisper STT (Prioritas 2)
Di WaHA, audio dikirim sebagai `type: "audio"` atau `type: "ptt"` (push to talk). Yang perlu diimplementasi di node `Whisper STT`:

```javascript
// payload.mediaUrl berisi URL download audio dari WaHA
const audioUrl = $json.mediaId; // atau payload.mediaUrl

// Download audio
const audioData = await this.helpers.httpRequest({
  method: 'GET',
  url: audioUrl,
  headers: { 'X-Api-Key': 'wariskan123' },
  encoding: 'arraybuffer'
});

// Kirim ke Whisper
const transcript = await this.helpers.httpRequest({
  method: 'POST',
  url: 'https://api.openai.com/v1/audio/transcriptions',
  headers: { 'Authorization': `Bearer ${$env.OPENAI_API_KEY}` },
  body: { file: audioData, model: 'whisper-1' }
});
```

### Foto Struk — Claude Vision (Prioritas 3)
Di WaHA, gambar dikirim sebagai `type: "image"`. Yang perlu diimplementasi di node `Claude Vision`:

```javascript
// Download gambar dari WaHA
const imageData = await this.helpers.httpRequest({
  method: 'GET', 
  url: $json.mediaId, // URL gambar dari WaHA
  headers: { 'X-Api-Key': 'wariskan123' },
  encoding: 'base64'
});

// Kirim ke Claude Vision
// (lanjutkan ke Claude Extract dengan image sebagai input)
```

### Google Sheets Fix (Prioritas 4)
Node sudah ada tapi error `#ERROR!`. Fix: Di node Append Row, pastikan setiap field pakai Fixed mode (nilai langsung), bukan Expression mode yang nulis `={{ }}` ke sel.

### Deploy ke Server (Prioritas 5)
Supaya tidak perlu laptop menyala terus:
1. Deploy n8n ke Railway/Render
2. Deploy WaHA ke VPS (butuh Docker di server)
3. Update webhook URL di WaHA config ke URL server

---

## Cek Cepat Sebelum Testing

```
[ ] Docker Desktop sudah jalan
[ ] docker start waha
[ ] WaHA status WORKING (curl check)
[ ] WaHA webhook config benar (url ke localhost:5678)
[ ] start-n8n.ps1 sudah dijalankan
[ ] Workflow n8n aktif (toggle hijau)
[ ] Kirim pesan dari HP yang BERBEDA dari nomor bot
[ ] Cek Executions di n8n setelah kirim pesan
```

---

## Info Teknis Penting

- **WaHA API Key:** `wariskan123`
- **WaHA Port:** `3000`
- **WaHA Dashboard:** `http://localhost:3000/dashboard`
- **n8n URL:** `http://localhost:5678`
- **Webhook path:** `/webhook/whatsapp-webhook`
- **Supabase URL:** `https://oigrftmbfzflyznlgnyc.supabase.co`
- **Nomor yang terhubung saat ini:** +62 812-8481-8862 (GANTI dengan nomor bot!)
- **Session WaHA:** `default`
- **Docker volume:** `D:/waha-data` (session tersimpan di sini)
