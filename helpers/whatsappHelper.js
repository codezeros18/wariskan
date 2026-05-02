/**
 * Wariskan — WhatsApp Cloud API helper
 *
 * Centralises all outgoing WhatsApp messages.
 * Features: rate limiting (token bucket), async queue, mock mode,
 *           Supabase logging, standardised result shape.
 *
 * Works in:
 *   • Node.js 20+ scripts   → import { sendText } from './whatsappHelper.js'
 *   • n8n Code nodes        → const { sendText } = await import('/path/to/whatsappHelper.js')
 *
 * NOTE: Don't import dotenv here — entry points (scripts/n8n) handle that.
 *       All env vars are read lazily from process.env at call time.
 */

import {
  buildTransactionConfirmation,
  buildDebtReminder,
  buildWeeklyReport,
  buildOnboardingWelcome,
  ERROR,
} from './messages.js';

// ─── Config (lazy — read at call time, never at import time) ──────────────────

function cfg() {
  return {
    token:         process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    apiVersion:    process.env.WHATSAPP_API_VERSION ?? 'v18.0',
    supabaseUrl:   process.env.SUPABASE_URL,
    supabaseKey:   process.env.SUPABASE_SERVICE_KEY,
    mockMode:      process.env.WHATSAPP_MOCK_MODE === 'true',
    // Token bucket: max messages per second. Default 20 — conservative for shared key.
    rateLimit:     parseInt(process.env.WHATSAPP_RATE_LIMIT_PER_SEC ?? '20', 10),
  };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Convert common Markdown to WhatsApp-flavoured markdown.
 * WA uses: *bold*, _italic_, ~strikethrough~, ```code```
 * Standard MD uses **bold**, __italic__ — normalize those.
 */
function toWAMarkdown(text) {
  if (!text || typeof text !== 'string') return String(text ?? '');
  return text
    .replace(/\*\*(.+?)\*\*/gs, '*$1*')    // **bold** → *bold*
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/gs, '$&')  // keep existing *bold*
    .replace(/(?<!_)__(.+?)__(?!_)/gs, '_$1_');               // __italic__ → _italic_
}

/** Truncate a message to WhatsApp's 4096-char limit, appending a notice if cut. */
function truncate(text, limit = 4096) {
  if (text.length <= limit) return text;
  const cutoff  = limit - 40;
  return text.slice(0, cutoff) + '\n\n_[Pesan dipotong — terlalu panjang]_';
}

// ─── Token Bucket rate limiter ────────────────────────────────────────────────

class TokenBucket {
  /**
   * @param {number} capacity    Max burst size (tokens)
   * @param {number} refillRate  Tokens added per second
   */
  constructor(capacity, refillRate) {
    this._capacity   = capacity;
    this._tokens     = capacity;
    this._refillRate = refillRate;
    this._lastRefill = Date.now();
  }

  /** Attempt to consume one token. Returns true if successful. */
  consume() {
    this._refill();
    if (this._tokens >= 1) {
      this._tokens -= 1;
      return true;
    }
    return false;
  }

  /** Milliseconds until at least one token is available. 0 = available now. */
  msUntilAvailable() {
    this._refill();
    if (this._tokens >= 1) return 0;
    return Math.ceil((1 - this._tokens) / this._refillRate * 1000);
  }

  _refill() {
    const now     = Date.now();
    const elapsed = (now - this._lastRefill) / 1000;
    this._tokens  = Math.min(this._capacity, this._tokens + elapsed * this._refillRate);
    this._lastRefill = now;
  }
}

// ─── Message queue ────────────────────────────────────────────────────────────

const MAX_RETRIES   = 3;
const RETRY_DELAYS  = [500, 2000, 5000]; // ms between retries

class MessageQueue {
  constructor(rateLimiter) {
    this._limiter    = rateLimiter;
    this._queue      = [];   // [{ job, resolve, reject, attempts }]
    this._processing = false;
  }

  /**
   * Add a job to the queue. Returns a Promise that resolves with the job's result.
   * If tokens are available immediately, executes without delay.
   */
  enqueue(job) {
    return new Promise((resolve, reject) => {
      this._queue.push({ job, resolve, reject, attempts: 0 });
      this._drain();
    });
  }

  async _drain() {
    if (this._processing) return;
    this._processing = true;

    while (this._queue.length > 0) {
      const wait = this._limiter.msUntilAvailable();
      if (wait > 0) await sleep(wait);

      this._limiter.consume();
      const item = this._queue[0];

      try {
        const result = await item.job();
        item.resolve(result);
        this._queue.shift();
      } catch (err) {
        item.attempts++;
        const isRetryable = err.status === 429 || err.status >= 500 || err.code === 'ECONNRESET';

        if (!isRetryable || item.attempts >= MAX_RETRIES) {
          item.reject(err);
          this._queue.shift();
        } else {
          const delay = RETRY_DELAYS[item.attempts - 1] ?? 5000;
          console.warn(`[WA] Retry ${item.attempts}/${MAX_RETRIES} in ${delay}ms — ${err.message}`);
          await sleep(delay);
        }
      }
    }

    this._processing = false;
  }
}

// ─── Module-level singletons (created lazily on first call) ──────────────────

let _rateLimiter = null;
let _queue       = null;

function getQueue() {
  if (_queue) return _queue;
  const { rateLimit } = cfg();
  _rateLimiter = new TokenBucket(rateLimit, rateLimit);
  _queue       = new MessageQueue(_rateLimiter);
  return _queue;
}

// ─── Core API caller ──────────────────────────────────────────────────────────

/**
 * Send a raw payload to the WhatsApp Cloud API.
 * Used internally; consumers should use the typed functions below.
 *
 * @param {string} phoneNumber  E.164 without leading +, e.g. "6281234567890"
 * @param {object} payload      WhatsApp message object
 * @returns {{ success: boolean, messageId?: string, mock?: boolean }}
 */
async function _sendViaAPI(phoneNumber, payload) {
  const { token, phoneNumberId, apiVersion, mockMode } = cfg();

  // ── Mock mode ────────────────────────────────────────────────────────────
  if (mockMode) {
    const mockId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    console.log(`[WA MOCK] → ${phoneNumber} [${payload.type}]:`, JSON.stringify(payload).slice(0, 200));
    return { success: true, mock: true, messageId: mockId };
  }

  // ── Validate config ──────────────────────────────────────────────────────
  if (!token || !phoneNumberId) {
    throw Object.assign(
      new Error('[WA] WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set in env'),
      { isConfig: true }
    );
  }

  // ── Send ─────────────────────────────────────────────────────────────────
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
  const res  = await fetch(url, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  });

  const data = await res.json();

  if (!res.ok) {
    const err = new Error(
      `[WA] API error ${res.status}: ${data?.error?.message ?? JSON.stringify(data)}`
    );
    err.status   = res.status;
    err.waError  = data?.error;
    throw err;
  }

  return {
    success:   true,
    messageId: data.messages?.[0]?.id,
    data,
  };
}

// ─── Supabase logging ─────────────────────────────────────────────────────────

/**
 * Log every outgoing message to Supabase `outgoing_messages` table.
 * Failures are swallowed — logging must never break the send path.
 *
 * Required table (run once in Supabase SQL Editor):
 *   CREATE TABLE IF NOT EXISTS outgoing_messages (
 *     id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 *     phone        TEXT NOT NULL,
 *     message_type TEXT NOT NULL,
 *     content      TEXT NOT NULL,
 *     wa_message_id TEXT,
 *     status       TEXT NOT NULL DEFAULT 'sent',
 *     error        TEXT,
 *     sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *   );
 */
async function _logOutgoing(phone, messageType, content, result) {
  const { supabaseUrl, supabaseKey, mockMode } = cfg();

  if (mockMode) {
    console.log(`[WA LOG MOCK] phone=${phone} type=${messageType} status=${result.success ? 'sent' : 'failed'}`);
    return;
  }

  if (!supabaseUrl || !supabaseKey) return; // silently skip if Supabase not configured

  try {
    await fetch(`${supabaseUrl}/rest/v1/outgoing_messages`, {
      method:  'POST',
      headers: {
        'apikey':        supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        phone,
        message_type:  messageType,
        content:       typeof content === 'string' ? content.slice(0, 2000) : JSON.stringify(content),
        wa_message_id: result.messageId ?? null,
        status:        result.success ? 'sent' : 'failed',
        error:         result.error    ?? null,
        sent_at:       new Date().toISOString(),
      }),
    });
  } catch (err) {
    // Log to console only — outgoing log failure must not surface to users
    console.error('[WA] Outgoing log failed:', err.message);
  }
}

// ─── Public result helper ─────────────────────────────────────────────────────

function ok(result)           { return { success: true,  ...result }; }
function fail(err, extra = {}) {
  return { success: false, error: err?.message ?? String(err), ...extra };
}

// ─── Core send function ───────────────────────────────────────────────────────

/**
 * Queue and send a WhatsApp text message.
 * All higher-level functions delegate here.
 *
 * @param {string} phoneNumber  Recipient in E.164 (with or without leading +)
 * @param {string} message      Message body (WhatsApp markdown supported)
 * @param {string} [logType]    Label for the outgoing_messages.message_type column
 * @returns {{ success: boolean, messageId?: string, mock?: boolean, error?: string }}
 */
export async function sendText(phoneNumber, message, logType = 'text') {
  // Normalise phone: strip leading +
  const to      = String(phoneNumber).replace(/^\+/, '');
  const body    = truncate(toWAMarkdown(message));
  const payload = { to, type: 'text', text: { body, preview_url: false } };

  let result;
  try {
    result = await getQueue().enqueue(() => _sendViaAPI(to, payload));
    result = ok(result);
  } catch (err) {
    console.error(`[WA] sendText to ${to} failed:`, err.message);
    result = fail(err);
  }

  await _logOutgoing(to, logType, body, result);
  return result;
}

// ─── Typed send functions ─────────────────────────────────────────────────────

/**
 * Send a standardised transaction confirmation.
 *
 * @param {string} phoneNumber
 * @param {{
 *   tanggal: Date|string, kategori: string, nominal: number,
 *   pihak?: string, item?: string, status: string, jatuh_tempo?: Date|string|null
 * }} transaction
 */
export async function sendTransactionConfirmation(phoneNumber, transaction) {
  const message = buildTransactionConfirmation(transaction);
  return sendText(phoneNumber, message, 'transaction_confirmation');
}

/**
 * Send a debt or credit reminder.
 *
 * @param {string} phoneNumber
 * @param {{
 *   pihak: string, nominal: number, jatuh_tempo: Date|string,
 *   item?: string, category: 'hutang'|'piutang'
 * }} debt
 * @param {'h_minus_1'|'on_due'|'overdue'} urgency
 * @param {number} [daysOverdue]
 */
export async function sendDebtReminder(phoneNumber, debt, urgency, daysOverdue = 0) {
  const message = buildDebtReminder(debt, urgency, daysOverdue);
  return sendText(phoneNumber, message, `reminder_${urgency}`);
}

/**
 * Send a weekly financial report.
 *
 * @param {string} phoneNumber
 * @param {{
 *   period_start: Date|string, period_end: Date|string,
 *   total_pemasukan: number, total_pengeluaran: number, net_cashflow: number,
 *   hutang_aktif:  { count: number, total: number, items?: Array },
 *   piutang_aktif: { count: number, total: number, items?: Array }
 * }} reportData
 */
export async function sendWeeklyReport(phoneNumber, reportData) {
  const message = buildWeeklyReport(reportData);
  return sendText(phoneNumber, message, 'weekly_report');
}

/**
 * Send the first-time onboarding welcome.
 *
 * @param {string} phoneNumber
 * @param {{ display_name?: string, sheet_url?: string }} userData
 */
export async function sendOnboardingWelcome(phoneNumber, userData) {
  const message = buildOnboardingWelcome(userData);
  return sendText(phoneNumber, message, 'onboarding_welcome');
}

/**
 * Send a user-friendly error message.
 *
 * @param {string} phoneNumber
 * @param {'cant_understand'|'try_again'|'system_busy'|'unsupported_message_type'} errorType
 */
export async function sendError(phoneNumber, errorType) {
  const message = ERROR[errorType] ?? ERROR.try_again;
  return sendText(phoneNumber, message, `error_${errorType}`);
}

/**
 * Send a raw custom message (for ad-hoc use in n8n Code nodes).
 * Identical to sendText but skips markdown conversion — use when you
 * have already formatted the string with WA markdown manually.
 *
 * @param {string} phoneNumber
 * @param {string} rawMessage    Pre-formatted WA markdown string
 */
export async function sendRaw(phoneNumber, rawMessage) {
  const to      = String(phoneNumber).replace(/^\+/, '');
  const body    = truncate(rawMessage);
  const payload = { to, type: 'text', text: { body, preview_url: false } };

  let result;
  try {
    result = ok(await getQueue().enqueue(() => _sendViaAPI(to, payload)));
  } catch (err) {
    result = fail(err);
  }

  await _logOutgoing(to, 'raw', body, result);
  return result;
}

// ─── Queue introspection (for monitoring / n8n dashboards) ───────────────────

/** Returns current queue depth and rate limiter token count. */
export function getQueueStats() {
  if (!_queue) return { queueDepth: 0, tokensAvailable: null };
  return {
    queueDepth:      _queue._queue.length,
    tokensAvailable: Math.floor(_rateLimiter._tokens),
  };
}
