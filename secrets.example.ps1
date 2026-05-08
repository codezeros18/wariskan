# Wariskan — Template secrets
# Salin file ini jadi secrets.ps1 lalu isi dengan key asli kamu
# cp secrets.example.ps1 secrets.ps1

# ── Supabase ──────────────────────────────────────────────────
$env:SUPABASE_URL         = "https://xxxx.supabase.co"
$env:SUPABASE_SERVICE_KEY = "eyJhbGci..."

# ── WhatsApp Cloud API ────────────────────────────────────────
# Token EXPIRES SETIAP 24 JAM — refresh dari developers.facebook.com
$env:WHATSAPP_VERIFY_TOKEN    = "wariskan_webhook_verify_2026"
$env:WHATSAPP_TOKEN           = "EAAN..."
$env:WHATSAPP_PHONE_NUMBER_ID = "1234567890"
$env:WHATSAPP_MOCK_MODE       = "false"

# ── Meta App ──────────────────────────────────────────────────
$env:META_APP_SECRET = "your_meta_app_secret"

# ── AI APIs ───────────────────────────────────────────────────
$env:ANTHROPIC_API_KEY = "sk-ant-api03-..."
$env:OPENAI_API_KEY    = "sk-proj-..."
$env:OPENAI_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe"

# ── Google Sheets helper API ─────────────────────────────────
$env:HELPER_API_URL = "http://localhost:3001"
$env:HELPER_API_KEY = "dev"
$env:GOOGLE_MASTER_SHEET_ID = "YOUR_MASTER_SPREADSHEET_ID"

# ── WaHA (kalau pakai WaHA) ───────────────────────────────────
# WaHA jalan di Docker port 3000, API key diset saat docker run
$env:WHATSAPP_PROVIDER = "waha"
$env:WAHA_BASE_URL = "http://localhost:3000"
$env:WAHA_API_KEY = "wariskan123"
$env:WAHA_SESSION = "default"
$env:WAHA_OWNER_CHAT_ID = "6281284818862@c.us"

# ── Scheduler ─────────────────────────────────────────────────
$env:SCHEDULER_BASE_URL = "http://localhost:3001"
$env:SCHEDULER_API_KEY  = "dev"
