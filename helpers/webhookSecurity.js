/**
 * Wariskan — Webhook security helpers
 *
 * Verifies, deduplicates, rate-limits, and logs incoming Meta webhook requests.
 * Zero external dependencies — uses node:crypto only.
 *
 * Usage (Node.js scripts):
 *   import { validateSignature, processIncomingWebhook } from './webhookSecurity.js'
 *
 * Usage (n8n Code nodes):
 *   See n8n-workflows/webhook-security-code-node.js for a self-contained paste-in.
 *
 * Required env vars:
 *   META_APP_SECRET          Your Meta App Secret (from Meta Developer Console)
 *   WHATSAPP_VERIFY_TOKEN    Verify token you set in Meta webhook settings
 *   SUPABASE_URL             Supabase project URL
 *   SUPABASE_SERVICE_KEY     Service role key (bypasses RLS)
 *
 * Optional env vars:
 *   WH_RATE_LIMIT_PER_MIN    Max inbound messages per user per minute (default: 30)
 *   WH_BLOCKED_PHONES        Comma-separated E.164 phones to permanently block
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

// ─── Config (lazy, read at call time) ────────────────────────────────────────

function cfg() {
  return {
    appSecret:    process.env.META_APP_SECRET        ?? '',
    verifyToken:  process.env.WHATSAPP_VERIFY_TOKEN  ?? '',
    supabaseUrl:  process.env.SUPABASE_URL           ?? '',
    supabaseKey:  process.env.SUPABASE_SERVICE_KEY   ?? '',
    rateLimit:    parseInt(process.env.WH_RATE_LIMIT_PER_MIN ?? '30', 10),
  };
}

// ─── 1. Webhook Verification (GET) ───────────────────────────────────────────

/**
 * Validate the initial Meta webhook subscription challenge (GET request).
 * Meta sends: ?hub.mode=subscribe&hub.verify_token=TOKEN&hub.challenge=NONCE
 *
 * @param {Record<string,string>} query          Parsed query string parameters
 * @param {string}                [expectedToken] Defaults to WHATSAPP_VERIFY_TOKEN env
 * @returns {{ valid: boolean, challenge?: string, reason?: string }}
 */
export function verifyWebhook(query, expectedToken = cfg().verifyToken) {
  if (query['hub.mode'] !== 'subscribe') {
    return { valid: false, reason: `unexpected hub.mode: ${query['hub.mode']}` };
  }
  if (!expectedToken) {
    return { valid: false, reason: 'WHATSAPP_VERIFY_TOKEN not set' };
  }
  if (query['hub.verify_token'] !== expectedToken) {
    return { valid: false, reason: 'verify_token mismatch' };
  }
  if (!query['hub.challenge']) {
    return { valid: false, reason: 'missing hub.challenge' };
  }
  return { valid: true, challenge: query['hub.challenge'] };
}

// ─── 2. Signature Validation (POST) ──────────────────────────────────────────

/**
 * Validate the X-Hub-Signature-256 header on incoming Meta webhook POST requests.
 * Uses HMAC-SHA256 + constant-time comparison to prevent timing oracle attacks.
 *
 * IMPORTANT: rawBody must be the exact bytes Meta signed — before any JSON.parse().
 * In n8n, configure the Webhook node to output binary data so you can access rawBody.
 * See n8n-workflows/webhook-security-code-node.js for the full n8n workaround.
 *
 * @param {string|Buffer} rawBody    Raw request body before parsing
 * @param {string}        signature  X-Hub-Signature-256 header value ("sha256=<hex>")
 * @param {string}        [secret]   App secret (defaults to META_APP_SECRET env)
 * @returns {boolean}
 */
export function validateSignature(rawBody, signature, secret = cfg().appSecret) {
  if (!secret) throw new Error('[webhookSecurity] META_APP_SECRET not configured');
  if (!signature?.startsWith('sha256=')) return false;

  const provided = signature.slice(7);

  // Reject non-hex or wrong-length signatures before the constant-time check
  if (!/^[0-9a-f]{64}$/i.test(provided)) return false;

  const expected = createHmac('sha256', secret)
    .update(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'))
    .digest('hex');

  return timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(provided,  'hex'),
  );
}

// ─── Supabase REST helpers (internal) ────────────────────────────────────────

function _sbHeaders(key, extra = {}) {
  return {
    'apikey':        key,
    'Authorization': `Bearer ${key}`,
    'Content-Type':  'application/json',
    ...extra,
  };
}

async function _sbGet(url, key, table, params = {}) {
  const u = new URL(`${url}/rest/v1/${table}`);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  const res = await fetch(u.toString(), { headers: _sbHeaders(key) });
  if (!res.ok) throw new Error(`[webhookSecurity] Supabase GET ${table} ${res.status}`);
  return res.json();
}

async function _sbPost(url, key, table, body) {
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method:  'POST',
    headers: _sbHeaders(key, { 'Prefer': 'return=minimal' }),
    body:    JSON.stringify(body),
  });
  // 201 Created or 204 No Content are both success
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[webhookSecurity] Supabase POST ${table} ${res.status}: ${text}`);
  }
}

function _sbCfg(override = {}) {
  const base = cfg();
  return {
    url: override.url ?? base.supabaseUrl,
    key: override.key ?? base.supabaseKey,
  };
}

// ─── 3. Idempotency Check ─────────────────────────────────────────────────────

/**
 * Return true if this WhatsApp message ID has already been logged.
 * Meta retries failed webhook deliveries — this prevents double-processing.
 * Fails open (returns false) if Supabase is unreachable so messages aren't dropped.
 *
 * @param {string}                     messageId   WhatsApp message ID (wamid.xxx)
 * @param {{ url?: string, key?: string }} [sbCfg]
 * @returns {Promise<boolean>}
 */
export async function isDuplicateMessage(messageId, sbCfg = {}) {
  const { url, key } = _sbCfg(sbCfg);
  if (!url || !key) return false;

  try {
    const rows = await _sbGet(url, key, 'incoming_messages', {
      whatsapp_message_id: `eq.${messageId}`,
      select:              'id',
      limit:               '1',
    });
    return Array.isArray(rows) && rows.length > 0;
  } catch (err) {
    console.warn('[webhookSecurity] isDuplicateMessage check failed — failing open:', err.message);
    return false;
  }
}

// ─── 4. Per-User Rate Limiting ────────────────────────────────────────────────

/**
 * Check whether a phone number has exceeded the inbound rate limit.
 * Counts messages logged in the last 60 seconds in incoming_messages.
 * Fails open (allowed: true) if Supabase is unreachable.
 *
 * @param {string}                        phone   E.164 phone number
 * @param {{ url?: string, key?: string }} [sbCfg]
 * @returns {Promise<{ allowed: boolean, count?: number, retryAfter?: number }>}
 */
export async function checkUserRateLimit(phone, sbCfg = {}) {
  const { url, key } = _sbCfg(sbCfg);
  const limit = cfg().rateLimit;
  if (!url || !key) return { allowed: true };

  try {
    const since = new Date(Date.now() - 60_000).toISOString();
    // Fetch one extra to detect over-limit without counting the full table
    const rows = await _sbGet(url, key, 'incoming_messages', {
      phone_from:  `eq.${phone}`,
      received_at: `gte.${since}`,
      select:      'id',
      limit:       String(limit + 1),
    });
    const count = Array.isArray(rows) ? rows.length : 0;
    if (count >= limit) return { allowed: false, count, retryAfter: 60 };
    return { allowed: true, count };
  } catch (err) {
    console.warn('[webhookSecurity] checkUserRateLimit failed — failing open:', err.message);
    return { allowed: true };
  }
}

// ─── 5. Abuse / Spam Detection ────────────────────────────────────────────────

// Permanent blocklist loaded once from env (comma-separated E.164 phones)
const _BLOCKLIST = new Set(
  (process.env.WH_BLOCKED_PHONES ?? '')
    .split(',')
    .map((p) => p.trim().replace(/^\+/, ''))
    .filter(Boolean),
);

/**
 * Detect basic abuse patterns:
 *  1. Static blocklist  (WH_BLOCKED_PHONES env var)
 *  2. Message flood     (≥5 identical texts from same phone in 5 minutes)
 *  3. Repeated failures (last 10 recorded transactions all low-confidence/cancelled)
 *
 * Fails open — never blocks a message if DB is unavailable.
 *
 * @param {string}                        phone
 * @param {string}                        messageText
 * @param {{ url?: string, key?: string }} [sbCfg]
 * @returns {Promise<{ is_abuse: boolean, reason?: string }>}
 */
export async function detectAbuse(phone, messageText, sbCfg = {}) {
  const normalised = phone.replace(/^\+/, '');

  // 1. Static blocklist (fast, no DB)
  if (_BLOCKLIST.has(normalised)) {
    return { is_abuse: true, reason: 'blocked_phone' };
  }

  const { url, key } = _sbCfg(sbCfg);
  if (!url || !key) return { is_abuse: false };

  try {
    const since5m = new Date(Date.now() - 5 * 60_000).toISOString();

    // 2. Identical message flood
    if (messageText?.trim()) {
      const dupes = await _sbGet(url, key, 'incoming_messages', {
        phone_from:  `eq.${phone}`,
        raw_text:    `eq.${messageText.slice(0, 500)}`,
        received_at: `gte.${since5m}`,
        select:      'id',
        limit:       '5',
      });
      if (Array.isArray(dupes) && dupes.length >= 5) {
        return { is_abuse: true, reason: 'message_flood' };
      }
    }

    // 3. Repeated low-quality inputs — look up user_id first, then transactions
    const users = await _sbGet(url, key, 'users', {
      whatsapp_phone: `eq.${phone}`,
      select:         'id',
      limit:          '1',
    });
    if (Array.isArray(users) && users.length > 0) {
      const txns = await _sbGet(url, key, 'transactions', {
        user_id: `eq.${users[0].id}`,
        select:  'confidence,status',
        order:   'created_at.desc',
        limit:   '10',
      });
      if (Array.isArray(txns) && txns.length >= 10) {
        const allBad = txns.every(
          (t) => t.confidence === 'low' || t.status === 'dibatalkan',
        );
        if (allBad) return { is_abuse: true, reason: 'repeated_low_quality_input' };
      }
    }

    return { is_abuse: false };
  } catch (err) {
    console.warn('[webhookSecurity] detectAbuse failed — failing open:', err.message);
    return { is_abuse: false };
  }
}

// ─── 6. Composite Webhook Middleware ──────────────────────────────────────────

/**
 * Full incoming webhook pipeline — validates, deduplicates, rate-limits,
 * detects abuse, logs, and extracts the first message from Meta's envelope.
 *
 * Designed to be called at the top of your POST handler.
 * Returns 200 for duplicates and abuse so Meta doesn't retry indefinitely.
 *
 * @param {{
 *   rawBody:  string|Buffer,
 *   headers:  Record<string, string>,
 *   parsed?:  object,
 * }} req
 * @param {{ url?: string, key?: string }} [sbCfg]
 * @returns {Promise<{
 *   ok:          boolean,
 *   statusCode:  number,
 *   reason?:     string,
 *   blocked?:    boolean,
 *   retryAfter?: number,
 *   message?: {
 *     messageId: string,
 *     phone:     string,
 *     type:      string,
 *     text:      string|null,
 *     timestamp: string,
 *     payload:   object,
 *   }
 * }>}
 */
export async function processIncomingWebhook(req, sbCfg = {}) {
  const { rawBody, headers } = req;
  const { appSecret } = cfg();

  // 1. Signature validation (skip gracefully if appSecret not yet configured)
  if (appSecret) {
    const sig = headers['x-hub-signature-256'] ?? headers['X-Hub-Signature-256'] ?? '';
    if (!validateSignature(rawBody, sig, appSecret)) {
      return { ok: false, reason: 'invalid_signature', statusCode: 401 };
    }
  } else {
    console.warn('[webhookSecurity] META_APP_SECRET not set — skipping signature check');
  }

  // 2. Parse payload
  let payload;
  try {
    payload = req.parsed ?? JSON.parse(
      typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'),
    );
  } catch {
    return { ok: false, reason: 'invalid_json', statusCode: 400 };
  }

  // 3. Extract first message from Meta's delivery envelope
  const msgObj = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  if (!msgObj) {
    // Status updates (delivery receipts, read receipts) — acknowledge silently
    return { ok: true, reason: 'no_message', statusCode: 200 };
  }

  const messageId = msgObj.id;
  const phone     = msgObj.from;
  const type      = msgObj.type;
  const timestamp = new Date(parseInt(msgObj.timestamp, 10) * 1000).toISOString();
  const text      = msgObj.text?.body ?? null;

  // 4. Deduplication — Meta retries if your server doesn't respond fast enough
  if (await isDuplicateMessage(messageId, sbCfg)) {
    return { ok: true, reason: 'duplicate', statusCode: 200 };
  }

  // 5. Rate limiting
  const rateCheck = await checkUserRateLimit(phone, sbCfg);
  if (!rateCheck.allowed) {
    return { ok: false, reason: 'rate_limited', statusCode: 429, retryAfter: rateCheck.retryAfter };
  }

  // 6. Abuse detection — return 200 to Meta (don't reveal blocking); flag for caller
  if (text) {
    const abuse = await detectAbuse(phone, text, sbCfg);
    if (abuse.is_abuse) {
      console.warn(`[webhookSecurity] Blocked ${phone}: ${abuse.reason}`);
      return { ok: true, reason: `abuse_${abuse.reason}`, statusCode: 200, blocked: true };
    }
  }

  // 7. Log to incoming_messages (failure here must not drop the message)
  const { url, key } = _sbCfg(sbCfg);
  if (url && key) {
    try {
      await _sbPost(url, key, 'incoming_messages', {
        whatsapp_message_id: messageId,
        phone_from:          phone,
        message_type:        type,
        raw_text:            text?.slice(0, 2000) ?? null,
        raw_payload:         payload,
        received_at:         timestamp,
        status:              'received',
      });
    } catch (err) {
      console.error('[webhookSecurity] Failed to log incoming message:', err.message);
    }
  }

  return {
    ok:         true,
    statusCode: 200,
    message:    { messageId, phone, type, text, timestamp, payload },
  };
}
