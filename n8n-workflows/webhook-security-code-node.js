/**
 * Wariskan — n8n Code Node: Webhook Security Guard
 * ──────────────────────────────────────────────────
 * Paste this entire file into an n8n Code node (v2) placed immediately
 * after your "WhatsApp Messages (POST)" webhook node.
 *
 * Node name suggestion: "Security Guard"
 * Language: JavaScript
 *
 * ── Setup: Raw Body Access (required for HMAC validation) ──────────────────
 * In the Webhook node → Options → set "Raw Body" to ON.
 * This makes the raw request bytes available as binary data.
 * Without this, signature validation falls back to re-stringified JSON
 * (acceptable for hackathon, not exact for production).
 *
 * ── n8n Variables required ─────────────────────────────────────────────────
 * Set these in n8n Settings → Variables (or pass via $env):
 *   META_APP_SECRET          Your Meta App Secret
 *   SUPABASE_URL             Your Supabase project URL
 *   SUPABASE_SERVICE_KEY     Supabase service role key
 *   WH_RATE_LIMIT_PER_MIN   (optional) Max messages/min per user, default 30
 *
 * ── What this node does ────────────────────────────────────────────────────
 * 1. Validates X-Hub-Signature-256 (HMAC-SHA256 from Meta)
 * 2. Extracts first message from Meta's delivery envelope
 * 3. Checks for duplicate message IDs (idempotency)
 * 4. Checks per-user rate limit (30 messages/minute)
 * 5. Logs to Supabase incoming_messages
 * 6. Outputs { messageId, phone, type, text, timestamp, payload }
 *    OR { skip: true, reason: '...' } for messages that should be ignored
 *
 * ── Wire this node's output ────────────────────────────────────────────────
 * Connect to an IF node: condition = {{ $json.skip !== true }}
 *   True branch  → your existing "Route by Message Type" switch
 *   False branch → "Respond OK" node (send 200, do nothing)
 */

// ─── Config ──────────────────────────────────────────────────────────────────

const APP_SECRET   = $env.META_APP_SECRET       ?? '';
const SB_URL       = $env.SUPABASE_URL          ?? '';
const SB_KEY       = $env.SUPABASE_SERVICE_KEY  ?? '';
const RATE_LIMIT   = parseInt($env.WH_RATE_LIMIT_PER_MIN ?? '30', 10);

// ─── Crypto (available in self-hosted n8n) ────────────────────────────────────

const crypto = require('crypto');

// ─── HMAC Signature Validation ────────────────────────────────────────────────

function validateSignature(rawBody, signature, secret) {
  if (!secret) return true; // not configured — skip (warn below)
  if (!signature?.startsWith('sha256=')) return false;
  const provided = signature.slice(7);
  if (!/^[0-9a-f]{64}$/i.test(provided)) return false;

  const expected = crypto.createHmac('sha256', secret)
    .update(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'))
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(provided,  'hex'),
    );
  } catch {
    return false;
  }
}

// ─── Get raw body ─────────────────────────────────────────────────────────────

// Attempt 1: true raw body from binary data (requires "Raw Body" ON in Webhook node)
// Attempt 2: fall back to re-stringified JSON (whitespace may differ from original)
let rawBody;
const binaryData = $input.first().binary;
if (binaryData?.data?.data) {
  rawBody = Buffer.from(binaryData.data.data, 'base64').toString('utf8');
} else {
  rawBody = JSON.stringify($input.first().json);
  if (!APP_SECRET) {
    // Safe — no signature check anyway
  } else {
    console.warn('[Security] Raw body not available — signature validation is approximate. Enable "Raw Body" in Webhook node for exact validation.');
  }
}

// ─── Headers ─────────────────────────────────────────────────────────────────

// n8n exposes headers differently depending on version; try all common paths
const hdrs = $input.first().headers
          ?? $input.first().json?.headers
          ?? {};

// ─── 1. Signature check ───────────────────────────────────────────────────────

const sig = hdrs['x-hub-signature-256'] ?? hdrs['X-Hub-Signature-256'] ?? '';

if (APP_SECRET && !validateSignature(rawBody, sig, APP_SECRET)) {
  // Hard reject — throw causes n8n to return 500, but that's fine (Meta will retry)
  // For a cleaner rejection, return early with an error response node instead.
  throw new Error('[Security] Invalid X-Hub-Signature-256 — request rejected');
}

if (!APP_SECRET) {
  console.warn('[Security] META_APP_SECRET not set — skipping signature validation');
}

// ─── 2. Parse & extract message ──────────────────────────────────────────────

const payload = $input.first().json;
const msgObj  = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

if (!msgObj) {
  // Delivery receipt or read receipt — acknowledge and stop
  console.log('[Security] No message in payload (status update) — skipping');
  return [{ json: { skip: true, reason: 'no_message' } }];
}

const messageId = msgObj.id;
const phone     = msgObj.from;
const type      = msgObj.type;
const text      = msgObj.text?.body ?? null;
const timestamp = new Date(parseInt(msgObj.timestamp, 10) * 1000).toISOString();

// ─── Supabase helper ──────────────────────────────────────────────────────────

async function sbGet(table, params) {
  if (!SB_URL || !SB_KEY) return [];
  const url = new URL(`${SB_URL}/rest/v1/${table}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  return res.ok ? res.json() : [];
}

// ─── 3. Deduplication ────────────────────────────────────────────────────────

const dups = await sbGet('incoming_messages', {
  whatsapp_message_id: `eq.${messageId}`,
  select:              'id',
  limit:               '1',
});
if (Array.isArray(dups) && dups.length > 0) {
  console.log(`[Security] Duplicate ${messageId} — skipping`);
  return [{ json: { skip: true, reason: 'duplicate' } }];
}

// ─── 4. Rate limiting ────────────────────────────────────────────────────────

const since = new Date(Date.now() - 60_000).toISOString();
const recent = await sbGet('incoming_messages', {
  phone_from:  `eq.${phone}`,
  received_at: `gte.${since}`,
  select:      'id',
  limit:       String(RATE_LIMIT + 1),
});
if (Array.isArray(recent) && recent.length >= RATE_LIMIT) {
  console.warn(`[Security] Rate limit hit for ${phone}`);
  return [{ json: { skip: true, reason: 'rate_limited', phone } }];
}

// ─── 5. Log to incoming_messages ─────────────────────────────────────────────

if (SB_URL && SB_KEY) {
  try {
    await fetch(`${SB_URL}/rest/v1/incoming_messages`, {
      method:  'POST',
      headers: {
        apikey:           SB_KEY,
        Authorization:    `Bearer ${SB_KEY}`,
        'Content-Type':   'application/json',
        Prefer:           'return=minimal',
      },
      body: JSON.stringify({
        whatsapp_message_id: messageId,
        phone_from:          phone,
        message_type:        type,
        raw_text:            text?.slice(0, 2000) ?? null,
        raw_payload:         payload,
        received_at:         timestamp,
        status:              'received',
      }),
    });
  } catch (err) {
    // Log failure must not block message processing
    console.error('[Security] Logging failed:', err.message);
  }
}

// ─── Pass through to message router ──────────────────────────────────────────

return [{
  json: { messageId, phone, type, text, timestamp, payload },
}];
