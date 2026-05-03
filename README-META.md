# Wariskan — Panduan Setup (Versi Meta WhatsApp Cloud API)

> Versi ini pakai API resmi dari Meta. Nomor botnya adalah nomor test dari Meta (+1 555-xxx-xxxx). Cocok untuk production nantinya, tapi untuk testing ada beberapa limitasi sandbox yang perlu diperhatikan.

---

## Gambaran Singkat

Pipeline Wariskan **sudah jalan 100% dari sisi kode**. Artinya:
- Pesan masuk ✅
- Claude ekstrak data transaksi ✅  
- Simpan ke Supabase ✅
- Build reply text ✅
- Kirim reply ke WhatsApp API ✅ (API-nya accept, balik `wamid`)

**Yang belum confirmed:** Reply-nya benar-benar muncul di HP penerima. Kemungkinan besar ini masalah kecil di sisi Meta sandbox atau WhatsApp app-nya nyimpen di folder yang salah. Bukan masalah kode.

---

## Yang Kamu Butuhkan Sebelum Mulai

### 1. Software
- **Node.js 18+** — untuk jalanin n8n
- **ngrok** atau **Cloudflare Tunnel** — untuk expose localhost ke internet (Meta butuh URL publik)

Cek apakah sudah terinstall:
```powershell
node --version
ngrok --version
```

### 2. Akun & Credentials

Semua key sudah ada di `start-n8n.ps1`. Tapi beberapa bisa expired, ini penjelasannya:

| Credential | Dimana dapat | Keterangan |
|---|---|---|
| `WHATSAPP_TOKEN` | [developers.facebook.com](https://developers.facebook.com) → App → WhatsApp → API Setup | **⚠️ EXPIRES SETIAP 24 JAM! Harus refresh manual** |
| `WHATSAPP_PHONE_NUMBER_ID` | Halaman yang sama | Tidak berubah, sudah diisi |
| `WHATSAPP_VERIFY_TOKEN` | Bebas, sudah diset `wariskan_webhook_verify_2026` | Tidak berubah |
| `META_APP_SECRET` | Meta App → Settings → Basic | Tidak berubah |
| `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | Supabase dashboard → Settings → API | Tidak berubah |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) | Tidak berubah, sudah ada $5 credit |

---

## Cara Jalanin (Step by Step)

### Step 1 — Pastikan workflow dalam format Meta

Workflow yang ada di `n8n-workflows/wariskan-base-workflow.json` **saat ini dalam format WaHA**. Kalau mau pakai Meta, ada 2 node yang perlu diganti kodenya:

**Node: Parse WhatsApp Payload** — ganti kodenya dengan ini:
```javascript
const body = $input.first().json.body;

if (!body?.entry?.length) {
  return [{ json: { _skip: true, reason: 'Empty or invalid payload — possible Meta test ping' } }];
}

const value   = body.entry[0]?.changes?.[0]?.value;
const message = value?.messages?.[0];
const contact = value?.contacts?.[0];

if (!message) {
  return [{ json: { _skip: true, reason: 'Status update, no message to process' } }];
}

const messageType = message.type;

return [{
  json: {
    senderPhone:   message.from,
    messageId:     message.id,
    messageType,
    timestamp:     new Date(parseInt(message.timestamp, 10) * 1000).toISOString(),
    textContent:   message.text?.body ?? null,
    mediaId:       message.audio?.id ?? message.image?.id ?? message.document?.id ?? null,
    mediaMimeType: message.audio?.mime_type ?? message.image?.mime_type ?? null,
    senderName:    contact?.profile?.name ?? null,
    waPhoneId:     value?.metadata?.phone_number_id ?? null,
    rawPayload:    JSON.stringify(body),
    _skip:         false,
  }
}];
```

**Node: Send WhatsApp Reply** — ganti kodenya dengan ini:
```javascript
if ($json._skip) return [$input.first()];

const phone   = $('Parse WhatsApp Payload').item.json.senderPhone ?? $json.senderPhone ?? $json.to ?? "";
const message = $json.replyText ?? $json.confirmationMessage ?? "Transaksi dicatat!";
const token   = $env.WHATSAPP_TOKEN;
const phoneId = $env.WHATSAPP_PHONE_NUMBER_ID;

const result = await this.helpers.httpRequest({
  method:  'POST',
  url:     `https://graph.facebook.com/v18.0/${phoneId}/messages`,
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type':  'application/json',
  },
  body: {
    messaging_product: 'whatsapp',
    to:   phone,
    type: 'text',
    text: { body: message },
  },
});

return [{ json: { ...($input.first().json), whatsappResult: result } }];
```

> Cara ganti kode di n8n: buka workflow → klik node yang mau diubah → klik kode yang ada → hapus → paste kode baru → Save.

### Step 2 — Refresh WhatsApp Token

Token Meta expired setiap 24 jam. Sebelum testing, selalu refresh dulu:

1. Buka [developers.facebook.com](https://developers.facebook.com)
2. Pilih app Wariskan → **WhatsApp** → **API Setup**
3. Di bagian "Access Token", klik tombol untuk generate/copy token baru
4. Buka file `start-n8n.ps1`, update baris `WHATSAPP_TOKEN` dengan token baru
5. Save file

### Step 3 — Jalankan n8n

```powershell
cd D:\wariskan
.\start-n8n.ps1
```

n8n jalan di `http://localhost:5678`. Jangan tutup terminal ini.

### Step 4 — Expose ke internet

Meta butuh URL publik untuk kirim webhook ke n8n. Jalankan ngrok:

```powershell
ngrok http 5678
```

Catat URL yang keluar, contoh: `https://abc123.ngrok-free.app`

Webhook URL kamu: `https://abc123.ngrok-free.app/webhook/whatsapp-webhook`

### Step 5 — Set webhook di Meta

1. Buka [developers.facebook.com](https://developers.facebook.com) → App → **WhatsApp** → **Configuration**
2. Di bagian Webhook, klik **Edit**
3. Masukkan webhook URL dari ngrok tadi
4. Verify token: `wariskan_webhook_verify_2026`
5. Klik **Verify and Save**
6. Subscribe ke event `messages`

### Step 6 — Verifikasi nomor penerima (PENTING!)

Ini yang sering kelewat. Di Meta sandbox, kamu hanya bisa kirim pesan ke nomor yang sudah diverifikasi:

1. Di halaman **API Setup**, bagian **"Step 2: Send and receive messages"**
2. Di field **"To"**, klik **"Manage phone number list"**
3. Tambahkan nomormu → verifikasi dengan OTP
4. Setelah OTP masuk dan diverifikasi, baru bisa terima reply

### Step 7 — Import workflow & test

1. Buka `http://localhost:5678`
2. Buat workflow baru → **⋮ → Import from file**
3. Pilih `wariskan-base-workflow.json`
4. Save dan Activate (toggle hijau)
5. Kirim pesan ke nomor Meta test (+1 555-xxx-xxxx)
6. Cek Executions di n8n — harus ada execution baru

---

## Kalau Reply Tidak Muncul di HP

Ini masalah yang belum resolve. Kemungkinan penyebabnya:

**1. Cek tab yang salah di WhatsApp**
WhatsApp versi baru punya beberapa tab: **Chats**, **Updates**, **Calls**. Pesan dari nomor bisnis kadang masuk ke tab **Updates** bukan **Chats**. Cek semua tab!

**2. Buka chat dulu baru kirim**
Di WhatsApp, cari nomor +1 555-xxx-xxxx, buka chat-nya, baru kirim pesan dari sana. Jangan kirim dari tempat lain.

**3. Token expired**
Kalau ada error 401 di execution n8n → token expired → refresh (Step 2 di atas).

**4. Nomor belum diverifikasi**
Kalau ada error 400 di execution → nomor belum masuk list (Step 6 di atas).

---

## Selanjutnya yang Bisa Dikerjakan

### Fix WhatsApp Delivery (Prioritas 1)
- Konfirmasi apakah reply masuk ke tab Updates di WhatsApp
- Kalau sudah bisnis verified di Meta, bisa pakai nomor Indonesia asli (bukan +1 555)
- Pertimbangkan deploy n8n ke Railway agar URL permanen (tidak perlu ngrok)

### Voice Note — Whisper STT (Prioritas 2)
Node `Download Audio Media` → `Whisper STT` sudah ada di workflow tapi isinya placeholder. Yang perlu diimplementasi:
```
1. Ambil mediaId dari pesan WhatsApp
2. Download audio dari: https://graph.facebook.com/v18.0/{mediaId}
   Header: Authorization: Bearer {WHATSAPP_TOKEN}
3. Kirim ke OpenAI Whisper: POST https://api.openai.com/v1/audio/transcriptions
   Body: file (audio), model: whisper-1
4. Hasil transcript masuk ke Claude Extract
```

### Foto Struk — Claude Vision (Prioritas 3)
Node `Claude Vision` sudah ada tapi placeholder. Yang perlu diimplementasi:
```
1. Download gambar dari Meta media URL
2. Convert ke base64
3. Kirim ke Claude dengan format:
   { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "..." } }
4. Prompt: "Ekstrak data transaksi dari struk ini..."
```

### Google Sheets (Prioritas 4)
Node sudah ada tapi error `#ERROR!` karena ekspresi n8n ditulis literal ke sel. Fix: Di node Append Row, pastikan setiap field menggunakan **Fixed** mode, bukan Expression mode yang menulis `={{ }}` ke sel.

### Deploy ke Railway (Prioritas 5)
Untuk production dan demo yang stabil:
1. Buat project di [railway.app](https://railway.app)
2. Deploy n8n dengan semua env var dari `start-n8n.ps1`
3. Update webhook URL di Meta ke URL Railway yang permanen

---

## Cek Cepat Sebelum Testing

```
[ ] Token WHATSAPP_TOKEN masih valid (generate baru kalau >24 jam)
[ ] start-n8n.ps1 sudah dijalankan
[ ] ngrok aktif dan URL sudah diupdate di Meta webhook config
[ ] Nomor HP sudah diverifikasi di Meta test recipient list
[ ] Workflow n8n aktif (toggle hijau)
[ ] Cek Executions di n8n setelah kirim pesan
```

---

## Info Supabase

- **URL:** `https://oigrftmbfzflyznlgnyc.supabase.co`
- Tabel: `users`, `transactions`, `incoming_messages`
- User test yang sudah ada: **Lintang Balakosa Ardhana** (id: `3a8c818a-f264-49ef-9a54-c46508384175`)
