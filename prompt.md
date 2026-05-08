You are pair-programming with me on "Wariskan" — a WhatsApp-based AI 
bookkeeper for Indonesian small warung owners. Built in 8 days for a 
hackathon (Code the Future by Skystar Capital).

I AM: Builder 3 (fullstack) + PM Lead + AI tools operator + researcher.
TEAM: 2 other builders who do NOT use AI tools. They need clear, 
ready-to-execute instructions from me.

CURRENT TASK: Generate a setup guide document I can share to my team 
in Notion. They should be able to follow it without asking me questions.

The guide must include:

1. **Project overview** (1 page max, plain language):
   - What we're building (one paragraph)
   - The agentic loop in 4 sentences
   - Tech stack at-a-glance
   - Each builder's responsibility area

2. **Environment setup** (step by step, with screenshots placeholders):
   - Node.js version we use (specify exact: Node 20 LTS)
   - Git clone repo command
   - .env file template with all required keys (placeholders for 
     security)
   - How to run n8n locally for development (Docker compose)
   - How to verify environment is working

3. **Working with our infrastructure**:
   - n8n shared instance (Railway URL) — credentials & how to access
   - Supabase project — URL, anon key, service key (separate dev/prod)
   - Google Sheets service account — how to use, how to share sheets 
     with it
   - WhatsApp Cloud API — sandbox number for testing, production 
     number procedure
   - Anthropic API & OpenAI API — shared team keys, rate limit 
     awareness

4. **Daily workflow rules**:
   - Daily standup 08:30 WIB (15 min)
   - Daily check-in 21:00 WIB (30 min)
   - Git branch naming: feat/[name]-[feature]
   - Commit message format
   - When to ask for help (rule: stuck >30 min = ask)
   - Slack/WA channel etiquette

5. **Resource links**:
   - Project repo
   - Notion workspace
   - n8n live workflow URL
   - WhatsApp test number
   - Documentation (n8n docs, Anthropic docs, etc.)

6. **Common troubleshooting**:
   - "I can't access n8n" → check VPN/IP whitelist
   - "My API call returns 401" → check env file, refresh token
   - "Webhook not triggering" → verify n8n URL, check ngrok/Railway
   - 5-7 common issues with quick resolutions

CONSTRAINTS:
- Bahasa: Indonesia + Inggris technical (sesuai gaya engineering 
  Indonesia)
- Format: markdown ready to paste to Notion
- Tone: professional but friendly, NOT corporate
- Length: 4-6 pages, scannable

Generate this in full, ready for me to paste and share tonight.

Generate complete Supabase PostgreSQL setup for "Wariskan" — WhatsApp 
bookkeeper for Indonesian warungs. I'm Builder 3 doing fullstack.

DELIVER: A single SQL file `001_initial_schema.sql` that I can paste 
into Supabase SQL Editor and run once.

REQUIREMENTS:

1. **Enable extensions**: uuid-ossp, pgcrypto

2. **Tables** (with full definitions, indexes, foreign keys, RLS 
   policies):

   a. `users`
      - id UUID PK default uuid_generate_v4()
      - whatsapp_phone TEXT UNIQUE NOT NULL (format +62...)
      - display_name TEXT
      - sheet_id TEXT UNIQUE (Google Sheet ID)
      - sheet_url TEXT
      - timezone TEXT DEFAULT 'Asia/Jakarta'
      - created_at, updated_at TIMESTAMPTZ
      - last_active_at TIMESTAMPTZ
      - Index: whatsapp_phone

   b. `transactions`
      - id UUID PK
      - user_id UUID FK → users(id) ON DELETE CASCADE
      - raw_input TEXT NOT NULL
      - input_type TEXT CHECK IN ('text', 'voice', 'image')
      - transcript TEXT (for voice, the Whisper output)
      - category TEXT CHECK IN ('pemasukan', 'pengeluaran', 'hutang', 
        'piutang', 'bayar_hutang', 'terima_piutang', 'unclear')
      - nominal BIGINT NOT NULL DEFAULT 0
      - pihak TEXT
      - item TEXT
      - tanggal DATE NOT NULL DEFAULT CURRENT_DATE
      - jatuh_tempo DATE
      - status TEXT CHECK IN ('aktif', 'lunas', 'dibatalkan', 
        'pending_confirmation') DEFAULT 'aktif'
      - confidence TEXT CHECK IN ('high', 'medium', 'low')
      - ai_model_version TEXT (track which Claude version processed)
      - parent_transaction_id UUID FK → transactions(id) (for linking 
        bayar_hutang to original hutang)
      - created_at TIMESTAMPTZ
      - Indexes: 
        - (user_id, tanggal DESC)
        - (user_id, status, jatuh_tempo) WHERE status = 'aktif'
        - (user_id, category)

   c. `reminders`
      - id UUID PK
      - user_id UUID FK
      - transaction_id UUID FK
      - reminder_type TEXT CHECK IN ('h_minus_1', 'on_due', 'overdue')
      - remind_at TIMESTAMPTZ NOT NULL
      - sent_at TIMESTAMPTZ
      - status TEXT CHECK IN ('pending', 'sent', 'failed', 'cancelled')
      - created_at
      - Index: (status, remind_at) WHERE status = 'pending'

   d. `incoming_messages` (raw audit log)
      - id UUID PK
      - user_id UUID FK (nullable, for unknown senders)
      - whatsapp_message_id TEXT UNIQUE
      - payload JSONB NOT NULL
      - message_type TEXT (text/audio/image/other)
      - processed BOOLEAN DEFAULT false
      - processing_error TEXT
      - received_at TIMESTAMPTZ
      - Index: (whatsapp_message_id), (processed, received_at)

   e. `weekly_reports` (track sent reports)
      - id UUID PK
      - user_id UUID FK
      - period_start DATE
      - period_end DATE
      - report_data JSONB
      - sent_at TIMESTAMPTZ
      - UNIQUE(user_id, period_start, period_end)

3. **Row Level Security (RLS)**: Enable on all tables. For MVP, 
   policies allow service_role full access only. Note: we're not 
   exposing this to client directly, only n8n service backend.

4. **Helper functions** (PostgreSQL functions):
   - `get_active_debts(p_user_id UUID)`: returns all active hutang 
     transactions for a user
   - `get_active_credits(p_user_id UUID)`: returns all active piutang
   - `get_weekly_aggregate(p_user_id UUID, p_start DATE, p_end DATE)`: 
     returns aggregated stats
   - `link_payment_to_debt(p_user_id UUID, p_pihak TEXT, p_nominal 
     BIGINT)`: when user says "bayar Bu Endang 180rb", find the 
     matching open debt and link it

5. **Seed data** for development (5 sample users, 30 sample 
   transactions across various categories) so I can test queries 
   without WhatsApp setup.

6. **Comments**: Every table and non-obvious column has SQL COMMENT.

OUTPUT:
- Full SQL file (single block, copy-paste ready)
- Brief usage notes after SQL (how to test, what to do next)
- ER diagram in Mermaid syntax (separate code block)

CONSTRAINTS:
- Production-grade but not over-engineered
- Indonesian timezone considerations (Asia/Jakarta UTC+7)
- Currency stored in BIGINT (rupiah, no decimals — 1000 rupiah = 1000)

Generate a Node.js module `googleSheetsHelper.js` for Wariskan project.

CONTEXT: Each warung user gets their own Google Sheet as a "buku 
digital". I (Builder 3) need this module to:
1. Create new sheets from a template when a user first onboards
2. Append transaction rows when AI extracts new data
3. Read aggregate data for weekly reports
4. Update specific rows when transactions are linked (e.g., debt paid)

REQUIREMENTS:

1. **Authentication**: Use service account (JSON key file). Path 
   configurable via env: GOOGLE_SERVICE_ACCOUNT_KEY_PATH.

2. **Template-based sheet creation**:
   - We have a template Google Sheet (ID: env GOOGLE_TEMPLATE_SHEET_ID)
   - Function: createUserSheet(userId, displayName, phoneNumber)
     - Copies template via Drive API
     - Renames to "Wariskan - {displayName} - {phoneLast4}"
     - Sets sharing: anyone with link can VIEW (for family sharing)
     - Returns: { sheetId, sheetUrl }

3. **Sheet structure** (template will have):
   - Sheet 1 "Transaksi": columns A-H
     A: ID Transaksi
     B: Tanggal
     C: Kategori
     D: Nominal (formatted "Rp 1.250.000")
     E: Pihak
     F: Item
     G: Status
     H: Jatuh Tempo
   - Sheet 2 "Ringkasan": auto-calculated using formulas (we'll set 
     up template manually)
   - Sheet 3 "Hutang Aktif": filtered view
   - Sheet 4 "Piutang Aktif": filtered view

4. **Functions to implement**:

   a. `appendTransaction(sheetId, transaction)`:
      - Appends to "Transaksi" sheet
      - transaction = { id, tanggal, kategori, nominal, pihak, item, 
        status, jatuhTempo }
      - Format nominal as "Rp X.XXX.XXX"
      - Format dates as "DD MMM YYYY" (Indonesian: "28 Apr 2026")
      - Color-code rows by category (use formatting):
        * pemasukan: green tint
        * pengeluaran: red tint
        * hutang: yellow tint
        * piutang: blue tint
        * bayar_hutang/terima_piutang: gray
      - Returns row number on success

   b. `updateTransactionStatus(sheetId, transactionId, newStatus)`:
      - Find row by transactionId in column A
      - Update column G (Status)
      - If status='lunas', strike-through the row

   c. `getTransactionsInRange(sheetId, startDate, endDate)`:
      - Read all rows in date range
      - Return array of transaction objects

   d. `getSheetSummary(sheetId)`:
      - Returns quick stats: total transactions, total income, total 
        expenses, active debts, active credits

5. **Error handling**:
   - Quota errors: log + return queued status, don't throw
   - Auth errors: throw with clear message for ops team
   - Network errors: retry 3x with exponential backoff (200ms, 1s, 5s)
   - Always return { success: bool, data?, error? } pattern

6. **Performance**:
   - Use batchUpdate where possible
   - Cache spreadsheet metadata for 5 min
   - Lazy load auth client (singleton)

7. **Indonesian formatting helpers** (export separately):
   - formatRupiah(number) → "Rp 1.250.000"
   - formatTanggalIndonesia(date) → "28 Apr 2026"
   - formatTanggalLengkap(date) → "Senin, 28 April 2026"

OUTPUT:
- googleSheetsHelper.js (production-ready)
- A separate test file `test-sheets.js` with manual test cases I can 
  run (npm run test-sheets)
- Brief README section: setup steps, how to create the template sheet, 
  how to share folder with service account email
- .env.example update with required vars

CONSTRAINTS:
- ES modules (type: "module" in package.json)
- Modern Node.js (20+)
- Dependencies: only googleapis, dotenv
- No TypeScript (keep simple for team)

Generate an n8n workflow JSON file (importable) that I can use as the 
foundation for Wariskan's WhatsApp message handling.

CONTEXT: I'm Builder 3, setting up infrastructure for tim. Builders 1 
and 2 will extend these workflows with AI logic. They need a clean 
starting structure.

CREATE: A workflow JSON file `wariskan-base-workflow.json` with these 
nodes connected:

1. **Webhook Trigger node**:
   - Path: /whatsapp-webhook
   - HTTP Method: POST
   - Response: "Immediately" with empty 200

2. **Webhook Verification IF node**:
   - For Meta GET verification challenge handling
   - If hub.mode == 'subscribe' AND hub.verify_token matches env, 
     respond with hub.challenge

3. **Function node "Parse WhatsApp Payload"**:
   - JavaScript that extracts:
     - sender phone
     - message id
     - message type (text/audio/image/document)
     - text content (if text)
     - media id (if voice/image)
     - timestamp
   - Output: structured object

4. **Postgres node "Log Incoming Message"**:
   - Insert to incoming_messages table
   - Mark processed=false

5. **Switch node "Route by Message Type"**:
   - Branch 1: text → Function "Handle Text"
   - Branch 2: audio → HTTP Request "Download Media"
   - Branch 3: image → HTTP Request "Download Media"
   - Branch 4: other → Function "Send Unsupported Reply"

6. **Function node "Get or Create User"**:
   - Query Supabase for user by phone
   - If not exists: INSERT, also call createUserSheet (placeholder)
   - Pass user data downstream

7. **Placeholder nodes** (Builder 1 & 2 will implement):
   - "Whisper STT" (HTTP Request to OpenAI) — basic structure only
   - "Claude Extract" (HTTP Request to Anthropic) — basic structure 
     only
   - "Validate JSON" (Function node) — basic structure only
   - "Save to Supabase" (Postgres Insert)
   - "Save to Google Sheets" (HTTP Request to your helper API)

8. **Final node "Send WhatsApp Reply"**:
   - HTTP Request POST to graph.facebook.com/v18.0/{phone-id}/messages
   - Body: { messaging_product, to, type, text }
   - Headers: Authorization Bearer + content type

REQUIREMENTS:
- All credentials referenced via n8n credential types (don't hardcode)
- All env-dependent values use n8n environment variables
- Add sticky notes on canvas explaining each section (Indonesian)
- Add explicit error handling: connect each major node to "Send Error 
  Notification to Slack" (placeholder webhook)

OUTPUT FORMAT:
- The JSON file (full content, importable to n8n via 
  Workflow → Import from File)
- Visual description of node layout (so I can verify after import)
- Setup checklist:
  [ ] Set credentials (Anthropic, OpenAI, Postgres/Supabase, Meta)
  [ ] Set environment variables
  [ ] Activate webhook
  [ ] Test with sample payload
- Test payload examples (sample WhatsApp webhook bodies for text, 
  voice, image)

CONSTRAINTS:
- n8n version: latest (1.x)
- Use only standard nodes (no community nodes for portability)
- Webhook must respond <2 seconds (process async after acknowledgment)

Generate `whatsappHelper.js` module for Wariskan.

PURPOSE: Centralize all outgoing WhatsApp messages so format is 
consistent across the system.

REQUIREMENTS:

1. **Functions**:

   a. `sendText(phoneNumber, message)`:
      - Send plain text message via WhatsApp Cloud API
      - Auto-handle markdown formatting (*bold*, _italic_)
      - Log every send to Supabase 'outgoing_messages' table
      
   b. `sendTransactionConfirmation(phoneNumber, transaction)`:
      - Standardized format:

Generate a scheduler module for Wariskan that runs daily/weekly jobs.

CONTEXT: We need automated reminders and weekly reports. For demo, 
also need MANUAL TRIGGER mode (button to demonstrate during pitch 
without waiting for cron).

CREATE TWO MODES:

**Mode 1: Cron (production)**
- Runs continuously, n8n Schedule Trigger node
- Daily 09:00 WIB: check debts, send reminders
- Sunday 20:00 WIB: generate and send weekly reports
- Hourly: cleanup orphaned pending_confirmation transactions

**Mode 2: Manual Trigger (for demo)**
- HTTP endpoint that accepts: { job_type, user_id (optional, 
  default: all) }
- Runs the same logic as cron but on-demand
- Returns execution summary

DELIVERABLES:

1. **Module: `scheduler.js`** with functions:

   a. `runDebtReminderJob(targetUserId = null)`:
      - Query reminders table where status='pending' AND remind_at <= NOW()
      - Group by user
      - For each: send WhatsApp via whatsappHelper
      - Mark reminder as sent
      - Log execution
      - Return { processed_count, errors[] }

   b. `runWeeklyReportJob(targetUserId = null)`:
      - Compute last week's date range (Mon-Sun)
      - For each active user (or specified user):
        - Skip if already sent for this period (check weekly_reports)
        - Compute aggregates from transactions
        - Format report
        - Send via whatsappHelper.sendWeeklyReport
        - Log to weekly_reports table
      - Return summary

   c. `runReminderCreationJob()`:
      - For all hutang/piutang transactions with status='aktif' AND 
        jatuh_tempo set
      - Create reminders if not yet created:
        * h_minus_1: jatuh_tempo - 1 day at 09:00 WIB
        * on_due: jatuh_tempo at 09:00 WIB
        * overdue: jatuh_tempo + 3 days at 09:00 WIB (only if still 
          aktif)
      - Idempotent (won't create duplicates)

   d. `cleanupPendingTransactions()`:
      - Mark pending_confirmation transactions older than 1 hour as 
        'dibatalkan'
      - Notify user gently

2. **n8n Workflows** (separate from main message handler):
   
   a. "Wariskan - Daily Reminder Cron"
      - Schedule trigger: 0 9 * * * (Asia/Jakarta)
      - HTTP request to scheduler endpoint /run/debt-reminder
   
   b. "Wariskan - Weekly Report Cron"
      - Schedule trigger: 0 20 * * 0 (Sunday 20:00 Asia/Jakarta)
      - HTTP request to /run/weekly-report
   
   c. "Wariskan - Manual Demo Trigger"
      - Webhook trigger: /demo/run-job
      - Accepts JSON: { job_type, user_id }
      - Calls appropriate scheduler function
      - Returns result
      - **THIS IS THE ONE WE USE DURING LIVE DEMO**

3. **Demo-friendly considerations**:
   - Manual trigger must execute in <5 seconds (judges watching)
   - Output of demo trigger should show in n8n execution log nicely 
     (for "see, the agent is doing it" moment)
   - Add console.log for each major step (visible in execution view)

4. **Idempotency**:
   - Re-running any job for same period must not duplicate sends
   - Use weekly_reports unique constraint
   - Use reminders status check

OUTPUT:
- scheduler.js
- Three n8n workflow JSONs
- Test script: `node test-scheduler.js --job=weekly-report --user=[id]`
- Setup instructions

CONSTRAINTS:
- All times in Asia/Jakarta timezone
- Use date-fns (or dayjs) for date math, not native Date
- Logs verbose enough for demo, terse enough for production

Generate webhook security helpers for Wariskan WhatsApp integration.

CONTEXT: Our n8n receives webhooks from Meta. Need to verify these 
are legitimate (not spoofed) and handle properly.

REQUIREMENTS:

1. **WhatsApp Webhook Verification** (initial GET request from Meta):
   - Function: verifyWebhook(query, expectedToken)
   - Returns: { valid: bool, challenge?: string }
   - Logic per Meta docs

2. **WhatsApp Webhook Signature Validation** (POST requests):
   - Function: validateSignature(rawBody, signature, appSecret)
   - Uses HMAC-SHA256
   - Returns boolean
   - Implement constant-time comparison to prevent timing attacks

3. **Idempotency**:
   - Function: isDuplicateMessage(messageId, supabase)
   - Check if whatsapp_message_id already in incoming_messages
   - Prevents double-processing if Meta retries

4. **Rate limiting per user**:
   - Function: checkUserRateLimit(phone, supabase)
   - Max 30 messages per minute per user (prevent abuse)
   - Returns { allowed: bool, retryAfter?: seconds }

5. **Spam/abuse detection** (basic):
   - Function: detectAbuse(phone, message, supabase)
   - Flags: too many failed transactions in row, repeated nonsense, 
     known spam phones
   - Returns { is_abuse: bool, reason?: string }

6. **Webhook handler middleware** (composable):
   - Function: processIncomingWebhook(req, supabase) that:
     1. Verifies signature
     2. Checks idempotency
     3. Logs to incoming_messages
     4. Returns 200 immediately (process async)
     5. Returns parsed message for downstream

7. **Security headers/practices**:
   - Document required Meta App settings
   - Document App secret rotation procedure
   - Document what to do if webhook URL leaked

OUTPUT:
- webhookSecurity.js module
- Integration example with n8n Webhook node (Function node code that 
  calls these helpers)
- Brief security checklist for hackathon submission (judges will care 
  about basic security hygiene)

CONSTRAINTS:
- Zero dependencies for crypto operations (use native node:crypto)
- Production-ready (we're submitting this)

You are helping me operate AI tools (Claude Code, Codex) on behalf of 
my teammates who don't have access. I'm Builder 3 / PM Lead for 
Wariskan hackathon.

CONTEXT: Today my teammate Builder 1 came to me and said:
"[PASTE WHAT BUILDER 1 ASKED FOR — e.g., 'Whisper integration is 
returning empty transcripts for some voice notes. I checked the 
audio quality and it seems fine. Help me debug.']"

MY TASK: 
1. Translate Builder 1's natural language description into a precise 
   technical prompt
2. Run it through Claude Code or Codex
3. Validate the output works
4. Hand off to Builder 1 with clear instructions on what to do

STEP 1: Help me draft the precise prompt to send to Claude Code.

The prompt should:
- Include all relevant context Builder 1 mentioned
- Specify expected output format (code? debug steps? explanation?)
- Be self-contained (Claude Code shouldn't need to ask follow-ups)
- Include constraints (we have 8 days, don't suggest refactoring 
  whole system)

After I get the response, help me:

STEP 2: Validate the Claude Code output:
- Does it actually solve the problem?
- Any obvious bugs?
- Missing edge cases?
- Suggest 2-3 quick tests Builder 1 should run

STEP 3: Format the handoff to Builder 1:
- A short message in Bahasa Indonesia explaining what Claude Code 
  generated
- Tagged code block they can copy
- 3 bullet checklist of what to verify
- "If this doesn't work, send me [X] info and I'll iterate"

Generate Step 1 (the precise prompt) now. Then wait for me to share 
the AI output, and we'll do Steps 2 and 3 together.

Generate a daily status check-in template for Wariskan team (3 
builders, 8-day hackathon, currently on Day [X]).

CONTEXT: I'm PM Lead. We have:
- Daily standup 08:30 WIB (15 min)
- Daily check-in 21:00 WIB (30 min)

GENERATE:

1. **Standup template** (morning, share in WA group at 08:00):

2. **Check-in template** (evening, share before 21:00 meeting):

3. **Crisis template** (jika ada milestone slip):

4. **Emoji/symbol legend** for the team to use:
   - 🟢 On track
   - 🟡 Slight risk
   - 🔴 Blocked
   - ✅ Done
   - 🔄 In progress
   - ⏸️ Paused
   - 🐛 Bug found

5. **Daily 1-page progress dashboard** template (Notion friendly):
   - Visual progress bar per major component
   - Bug count
   - Days remaining
   - Risk register top 3

OUTPUT: All four templates in markdown, ready to copy to Notion / WA.

Build a clean, professional dashboard for "Wariskan" — an AI 
bookkeeping system for Indonesian small business owners (warung). 
This dashboard is for our hackathon demo to judges (Skystar Capital 
VC).

PURPOSE: Show judges, in real-time, that our agentic AI is processing 
transactions across multiple users.

DESIGN STYLE:
- Modern, professional, slightly warm (like fintech but friendlier)
- Indonesian context: rupiah formatting, Indonesian language UI
- Color scheme: warm earth tones (terracotta accent #C46B4D, 
  background #FAF7F2, dark text #2D2A26, success green #5B8A3F)
- Typography: Inter or similar clean sans-serif
- Mobile-responsive but optimized for laptop demo

LAYOUT (single page):

**Top Header**:
- Logo "Wariskan" + tagline "Asisten Pencatat Warung"
- Right side: Live indicator (green dot pulsing) + "Sistem Aktif"
- Date/time live (Asia/Jakarta)

**Hero Stats Row** (4 cards horizontal):
- Card 1: "Pengguna Aktif" — large number "12" subtitle "warung onboard"
- Card 2: "Transaksi Hari Ini" — "47" subtitle "tercatat otomatis"
- Card 3: "Total Tercatat" — "Rp 8.450.000" subtitle "minggu ini"
- Card 4: "Akurasi AI" — "93%" subtitle "ekstraksi otomatis"
(All numbers should be reactive — see "Data" section)

**Live Activity Feed** (left column, ~60% width):
- Title: "Aktivitas Real-time"
- Subtitle: "Transaksi yang baru saja diproses oleh AI agent"
- Scrollable list of recent transactions, newest on top
- Each item shows:
  - Timestamp (relative: "baru saja", "2 menit lalu")
  - User initials in colored circle (e.g., "MS" for Mbak Sari)
  - Category badge (color-coded: green=pemasukan, red=pengeluaran, 
    yellow=hutang, blue=piutang)
  - Brief description: "{user} mencatat {category}: Rp {amount} ke 
    {pihak}"
  - Input type icon (🎤 voice / 📷 image / 💬 text)
- Animation: new items slide in from top with subtle fade
- Show last 15 items

**Right Column** (~40% width):

  Section A: "Kesehatan Sistem"
  - Mini gauge / progress bar untuk:
    - Latency rata-rata: "4.2 detik" (green if <10s)
    - Whisper success rate: "96%"
    - Claude JSON validity: "98%"
    - Sheet write success: "100%"
  
  Section B: "Distribusi Kategori (7 hari)"
  - Donut chart:
    - Pemasukan
    - Pengeluaran
    - Hutang
    - Piutang
    - Lainnya
  - Legend with percentages
  
  Section C: "Top Warung Aktif"
  - List 5 most active users (anonymized: "Warung MS", "Warung BS", 
    etc.)
  - Number of transactions this week
  - Total volume

**Bottom Section**:
- "Tentang Wariskan" — 2-paragraph elevator pitch with team credit
- Architecture diagram embedded (placeholder for now, I'll add image)

**Data source**:
- For demo: use mock data from a JSON file (provide nice realistic 
  Indonesian sample data — names like Mbak Sari, Pak Slamet, Bu Yati, 
  with realistic warung transactions)
- The mock should include at least 30 transactions across 12 users 
  spanning last 7 days
- Implement a "Demo Mode" toggle in top-right that, when enabled, 
  simulates new transactions appearing every 8-15 seconds (for live 
  pitch dramatics)
- Stretch: connect to real Supabase via REST API later (just leave 
  hooks for it)

INTERACTIONS:
- Click on activity feed item: expand to show transcript / JSON output
- Hover on stats: subtle elevation
- Demo mode toggle: starts/stops simulated stream

PROFESSIONAL POLISH:
- Loading states (skeletons, not spinners)
- Empty states
- Error states (gracefully handled)
- All text in Bahasa Indonesia
- Numbers formatted Indonesian style (1.250.000 not 1,250,000)
- Footer: "Wariskan v0.1 — Built for Code the Future 2026"

EXCLUDE:
- No login/auth (this is a public demo dashboard)
- No actual data mutation (read-only)
- No charts library bloat — use lightweight (Chart.js or Recharts ok)
- Keep total bundle small

Make it look like a polished SaaS product, not a hackathon demo. 
Judges should think "this team has product taste."

The dashboard looks great but needs adjustments for the hackathon 
demo:

1. The "Demo Mode" simulation is too fast. Slow it down to 1 new 
   transaction every 12-18 seconds (random within range). Make 
   transition smoother.

2. Add a "Story Mode" toggle (next to Demo Mode):
   - When activated, plays a scripted sequence of 6 transactions over 
     90 seconds
   - Each transaction tells the story of "Mbak Sari's typical day" 
     (morning sales, supplier debt, midday transactions, etc.)
   - This is for our pitch — predictable, narratable
   - Add a "Reset Story" button

3. The architecture diagram section: replace placeholder with this 
   mermaid diagram embedded:
   [paste your mermaid diagram from earlier]

4. Add a hidden "Trigger Demo Action" button (visible only with ?demo 
   in URL):
   - Three buttons: "Send Hutang Reminder Demo", "Send Weekly Report 
     Demo", "Process Voice Note (Sample)"
   - When clicked: makes HTTP POST to our n8n webhook (URL: 
     placeholder for now), shows loading state, then displays the 
     simulated outcome
   - This is for live demo — we click during pitch

5. Make stats more impressive but believable:
   - Active users: 12 → 8 (more realistic for early stage)
   - Transactions today: 47 → keep, looks good
   - AI accuracy: 93% → 91% (humbler is better, judges respect honesty)

6. Add a small badge near hero: "Code the Future 2026 — Tim Wariskan"

7. Mobile responsive check: ensure activity feed remains readable on 
   tablet (judges might check on iPad).

8. Performance: ensure dashboard loads in <2 seconds. Optimize 
   images, lazy-load chart.

Apply these changes.