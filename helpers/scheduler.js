/**
 * Wariskan — Scheduler
 * Automated jobs: debt reminders, weekly reports, reminder creation, cleanup.
 *
 * AS MODULE:  import { runDebtReminderJob } from './helpers/scheduler.js'
 * AS SERVER:  node helpers/scheduler.js          (starts HTTP server)
 *             SCHEDULER_PORT=3001 (default)
 *             SCHEDULER_API_KEY=secret (optional auth)
 */

import http from 'http';
import { sendDebtReminder, sendWeeklyReport, sendText } from './whatsappHelper.js';

// ─── WIB date utilities (UTC+7, no DST) ──────────────────────────────────────

const WIB_MS = 7 * 3600_000;

/** Current date as YYYY-MM-DD in Asia/Jakarta. */
function wibToday(utcMs = Date.now()) {
  return new Date(utcMs + WIB_MS).toISOString().split('T')[0];
}

/**
 * Convert a WIB date string + WIB hour → UTC ISO string.
 *   wibToUTCISO('2026-04-28', 9) → '2026-04-28T02:00:00.000Z'
 */
function wibToUTCISO(wibDateStr, wibHour = 9) {
  const utcHour = wibHour - 7;
  if (utcHour >= 0) {
    return `${wibDateStr}T${String(utcHour).padStart(2, '0')}:00:00.000Z`;
  }
  // Hour crosses midnight — previous day in UTC
  const d = new Date(`${wibDateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return `${d.toISOString().split('T')[0]}T${String(24 + utcHour).padStart(2, '0')}:00:00.000Z`;
}

/** Add N days to a YYYY-MM-DD string, return new date string. */
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

/**
 * Return {startDate, endDate} for the previous Mon–Sun week (in WIB).
 * Always returns the completed week so reports cover a full 7-day period.
 */
function getPreviousWeekRange() {
  const todayStr = wibToday();
  const today    = new Date(`${todayStr}T00:00:00Z`);
  const dow      = today.getUTCDay(); // 0=Sun … 6=Sat

  // Monday of current week
  const thisMon = new Date(today);
  thisMon.setUTCDate(today.getUTCDate() - (dow === 0 ? 6 : dow - 1));

  // Last Monday = 7 days before
  const lastMon = new Date(thisMon);
  lastMon.setUTCDate(thisMon.getUTCDate() - 7);

  return {
    startDate: lastMon.toISOString().split('T')[0],
    endDate:   addDays(lastMon.toISOString().split('T')[0], 6),
  };
}

/** remind_at timestamps (UTC ISO) for all three reminder types of one transaction. */
function getRemindAtTimes(jatuhTempoDateStr) {
  return {
    h_minus_1: wibToUTCISO(addDays(jatuhTempoDateStr, -1), 9),
    on_due:    wibToUTCISO(jatuhTempoDateStr, 9),
    overdue:   wibToUTCISO(addDays(jatuhTempoDateStr,  3), 9),
  };
}

// ─── Supabase REST helpers ────────────────────────────────────────────────────

function sbHeaders(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return {
    apikey:        key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function sbGet(path) {
  const res = await fetch(`${process.env.SUPABASE_URL}${path}`, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`SB GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sbPost(path, body) {
  const res = await fetch(`${process.env.SUPABASE_URL}${path}`, {
    method:  'POST',
    headers: sbHeaders({ Prefer: 'return=representation' }),
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`SB POST ${path} → ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function sbPatch(path, body) {
  const res = await fetch(`${process.env.SUPABASE_URL}${path}`, {
    method:  'PATCH',
    headers: sbHeaders({ Prefer: 'return=minimal' }),
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`SB PATCH ${path} → ${res.status}: ${await res.text()}`);
}

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg)  { console.log(`[${new Date().toISOString()}] ${msg}`); }
function warn(msg) { console.warn(`[${new Date().toISOString()}] ⚠️  ${msg}`); }

function makeResult(job) {
  return {
    job,
    startedAt:      new Date().toISOString(),
    processedCount: 0,
    skippedCount:   0,
    errors:         [],
  };
}

function finalise(result) {
  result.finishedAt = new Date().toISOString();
  result.durationMs = new Date(result.finishedAt) - new Date(result.startedAt);
  result.success    = result.errors.length === 0;
  return result;
}

// ─── Transaction aggregation helper ──────────────────────────────────────────

function aggregateForReport(txns) {
  let pemasukan = 0, pengeluaran = 0;
  const hutangItems = [], piutangItems = [];

  for (const t of txns) {
    if (t.status === 'dibatalkan') continue;
    if (t.category === 'pemasukan')   pemasukan   += t.nominal;
    if (t.category === 'pengeluaran') pengeluaran += t.nominal;
    if (t.category === 'hutang'  && t.status === 'aktif')
      hutangItems.push({ pihak: t.pihak, nominal: t.nominal, jatuh_tempo: t.jatuh_tempo });
    if (t.category === 'piutang' && t.status === 'aktif')
      piutangItems.push({ pihak: t.pihak, nominal: t.nominal, jatuh_tempo: t.jatuh_tempo });
  }

  const sum = (arr) => arr.reduce((s, i) => s + i.nominal, 0);

  return {
    total_pemasukan:   pemasukan,
    total_pengeluaran: pengeluaran,
    net_cashflow:      pemasukan - pengeluaran,
    hutang_aktif:  { count: hutangItems.length,  total: sum(hutangItems),  items: hutangItems },
    piutang_aktif: { count: piutangItems.length, total: sum(piutangItems), items: piutangItems },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB 1 — runDebtReminderJob
// Query reminders where status=pending AND remind_at<=NOW(), send WA, mark sent.
// ─────────────────────────────────────────────────────────────────────────────

export async function runDebtReminderJob(targetUserId = null) {
  log(`▶ runDebtReminderJob${targetUserId ? ` (user: ${targetUserId})` : ' (all users)'}`);
  const result = makeResult('debt_reminder');

  const nowISO    = new Date().toISOString();
  const userFilter = targetUserId ? `&user_id=eq.${targetUserId}` : '';
  const selectPath =
    `/rest/v1/reminders` +
    `?status=eq.pending&remind_at=lte.${nowISO}${userFilter}` +
    `&select=*,users(whatsapp_phone,display_name),transactions(nominal,pihak,item,category,jatuh_tempo,status)` +
    `&order=remind_at.asc`;

  const reminders = await sbGet(selectPath);
  log(`  → ${reminders.length} pending reminder(s) found`);

  for (const rem of reminders) {
    const { users: user, transactions: tx } = rem;

    if (!user?.whatsapp_phone) {
      warn(`  Reminder ${rem.id}: no phone — skipping`);
      result.skippedCount++;
      continue;
    }

    if (tx.status !== 'aktif') {
      log(`  Reminder ${rem.id}: transaction no longer aktif (${tx.status}) — cancelling`);
      await sbPatch(`/rest/v1/reminders?id=eq.${rem.id}`, { status: 'cancelled' });
      result.skippedCount++;
      continue;
    }

    try {
      const daysOverdue = rem.reminder_type === 'overdue'
        ? Math.max(0, Math.floor((Date.now() - new Date(tx.jatuh_tempo).getTime()) / 86_400_000))
        : 0;

      log(`  Sending ${rem.reminder_type} → ${user.whatsapp_phone} (${tx.pihak}, Rp ${tx.nominal})`);

      const waRes = await sendDebtReminder(
        user.whatsapp_phone,
        { pihak: tx.pihak, nominal: tx.nominal, jatuh_tempo: tx.jatuh_tempo, item: tx.item, category: tx.category },
        rem.reminder_type,
        daysOverdue
      );

      const newStatus = waRes.success ? 'sent' : 'failed';
      await sbPatch(`/rest/v1/reminders?id=eq.${rem.id}`, {
        status:  newStatus,
        sent_at: new Date().toISOString(),
      });

      if (waRes.success) {
        log(`  ✓ Reminder ${rem.id} sent (wamid: ${waRes.messageId ?? 'mock'})`);
        result.processedCount++;
      } else {
        throw new Error(waRes.error ?? 'WA send failed');
      }
    } catch (err) {
      warn(`  ✗ Reminder ${rem.id} failed: ${err.message}`);
      await sbPatch(`/rest/v1/reminders?id=eq.${rem.id}`, { status: 'failed' }).catch(() => {});
      result.errors.push({ reminderId: rem.id, phone: user.whatsapp_phone, error: err.message });
    }
  }

  finalise(result);
  log(`◀ runDebtReminderJob done in ${result.durationMs}ms — processed: ${result.processedCount}, skipped: ${result.skippedCount}, errors: ${result.errors.length}`);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB 2 — runWeeklyReportJob
// Generate and send last week's financial summary to each active user.
// Idempotent: skips users who already received a report for this period.
// ─────────────────────────────────────────────────────────────────────────────

export async function runWeeklyReportJob(targetUserId = null) {
  const { startDate, endDate } = getPreviousWeekRange();
  log(`▶ runWeeklyReportJob — period: ${startDate} to ${endDate}${targetUserId ? ` (user: ${targetUserId})` : ''}`);
  const result = makeResult('weekly_report');
  result.period = { startDate, endDate };

  const usersPath = targetUserId
    ? `/rest/v1/users?id=eq.${targetUserId}&select=id,whatsapp_phone,display_name`
    : `/rest/v1/users?select=id,whatsapp_phone,display_name&order=created_at.asc`;

  const users = await sbGet(usersPath);
  log(`  → ${users.length} user(s) to process`);

  for (const user of users) {
    if (!user.whatsapp_phone) {
      result.skippedCount++;
      continue;
    }

    try {
      // ── Idempotency check ──────────────────────────────────────────────────
      const existing = await sbGet(
        `/rest/v1/weekly_reports?user_id=eq.${user.id}&period_start=eq.${startDate}&period_end=eq.${endDate}&select=id`
      );
      if (existing.length > 0) {
        log(`  Skip ${user.whatsapp_phone}: report already sent for ${startDate}–${endDate}`);
        result.skippedCount++;
        continue;
      }

      // ── Fetch transactions for the week ────────────────────────────────────
      const txns = await sbGet(
        `/rest/v1/transactions` +
        `?user_id=eq.${user.id}&tanggal=gte.${startDate}&tanggal=lte.${endDate}` +
        `&status=neq.dibatalkan&select=category,nominal,pihak,jatuh_tempo,status`
      );

      // ── Compute aggregates ────────────────────────────────────────────────
      const stats      = aggregateForReport(txns);
      const reportData = { period_start: startDate, period_end: endDate, ...stats };

      log(`  Sending weekly report → ${user.whatsapp_phone} (${txns.length} txns, net: ${stats.net_cashflow})`);

      const waRes = await sendWeeklyReport(user.whatsapp_phone, reportData);

      if (!waRes.success) throw new Error(waRes.error ?? 'WA send failed');

      // ── Log to weekly_reports (UNIQUE constraint prevents duplicates) ──────
      await sbPost('/rest/v1/weekly_reports', {
        user_id:      user.id,
        period_start: startDate,
        period_end:   endDate,
        report_data:  reportData,
        sent_at:      new Date().toISOString(),
      }).catch((err) => {
        // Unique constraint violation = already inserted by concurrent run — ignore
        if (!err.message.includes('23505')) throw err;
      });

      log(`  ✓ Report sent to ${user.whatsapp_phone}`);
      result.processedCount++;
    } catch (err) {
      warn(`  ✗ Report for ${user.id} failed: ${err.message}`);
      result.errors.push({ userId: user.id, phone: user.whatsapp_phone, error: err.message });
    }
  }

  finalise(result);
  log(`◀ runWeeklyReportJob done in ${result.durationMs}ms — sent: ${result.processedCount}, skipped: ${result.skippedCount}, errors: ${result.errors.length}`);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB 3 — runReminderCreationJob
// Scan all aktif hutang/piutang with jatuh_tempo and create missing reminders.
// Idempotent: uses INSERT ON CONFLICT DO NOTHING (via Supabase unique constraint).
// ─────────────────────────────────────────────────────────────────────────────

export async function runReminderCreationJob() {
  log('▶ runReminderCreationJob');
  const result = makeResult('reminder_creation');
  const nowISO = new Date().toISOString();

  const txns = await sbGet(
    `/rest/v1/transactions` +
    `?status=eq.aktif&category=in.(hutang,piutang)&jatuh_tempo=not.is.null` +
    `&select=id,user_id,jatuh_tempo,category`
  );

  log(`  → ${txns.length} aktif hutang/piutang with jatuh_tempo found`);

  for (const tx of txns) {
    const times = getRemindAtTimes(tx.jatuh_tempo);

    for (const [type, remindAt] of Object.entries(times)) {
      // Skip reminders whose time is more than 24 hours in the past (no point sending)
      if (new Date(remindAt).getTime() < Date.now() - 86_400_000) {
        result.skippedCount++;
        continue;
      }

      // Check for existing reminder of this type for this transaction
      const existing = await sbGet(
        `/rest/v1/reminders` +
        `?transaction_id=eq.${tx.id}&reminder_type=eq.${type}&status=neq.cancelled&select=id`
      );

      if (existing.length > 0) {
        result.skippedCount++;
        continue;
      }

      try {
        await sbPost('/rest/v1/reminders', {
          user_id:        tx.user_id,
          transaction_id: tx.id,
          reminder_type:  type,
          remind_at:      remindAt,
          status:         'pending',
        });

        log(`  + Created ${type} reminder for tx ${tx.id} at ${remindAt}`);
        result.processedCount++;
      } catch (err) {
        // Unique constraint race = already created — ignore
        if (err.message.includes('23505')) {
          result.skippedCount++;
        } else {
          warn(`  ✗ Failed to create ${type} reminder for tx ${tx.id}: ${err.message}`);
          result.errors.push({ txId: tx.id, type, error: err.message });
        }
      }
    }
  }

  finalise(result);
  log(`◀ runReminderCreationJob done in ${result.durationMs}ms — created: ${result.processedCount}, skipped: ${result.skippedCount}`);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB 4 — cleanupPendingTransactions
// Mark stale pending_confirmation transactions (>1 hour) as dibatalkan.
// Sends a gentle notification to the user.
// ─────────────────────────────────────────────────────────────────────────────

export async function cleanupPendingTransactions() {
  log('▶ cleanupPendingTransactions');
  const result  = makeResult('cleanup');
  const cutoff  = new Date(Date.now() - 3_600_000).toISOString(); // 1 hour ago

  const stale = await sbGet(
    `/rest/v1/transactions` +
    `?status=eq.pending_confirmation&created_at=lte.${cutoff}` +
    `&select=id,user_id,raw_input,users(whatsapp_phone)` +
    `&order=created_at.asc`
  );

  log(`  → ${stale.length} stale pending_confirmation transaction(s) found`);

  for (const tx of stale) {
    try {
      await sbPatch(`/rest/v1/transactions?id=eq.${tx.id}`, { status: 'dibatalkan' });

      const phone = tx.users?.whatsapp_phone;
      if (phone) {
        await sendText(
          phone,
          `Catatan: pesan tadi (_"${(tx.raw_input ?? '').slice(0, 60)}"_) tidak sempat dikonfirmasi dan sudah otomatis dibatalkan 🙏\nKirim ulang bila masih ingin dicatat ya.`,
          'cleanup_notification'
        );
      }

      log(`  ✓ Cancelled tx ${tx.id} (${phone ?? 'no phone'})`);
      result.processedCount++;
    } catch (err) {
      warn(`  ✗ Cleanup failed for tx ${tx.id}: ${err.message}`);
      result.errors.push({ txId: tx.id, error: err.message });
    }
  }

  finalise(result);
  log(`◀ cleanupPendingTransactions done in ${result.durationMs}ms — cleaned: ${result.processedCount}`);
  return result;
}

// ─── Demo job dispatcher ──────────────────────────────────────────────────────

const JOB_MAP = {
  'debt-reminder':     (uid) => runDebtReminderJob(uid ?? null),
  'weekly-report':     (uid) => runWeeklyReportJob(uid ?? null),
  'reminder-creation': ()    => runReminderCreationJob(),
  'cleanup':           ()    => cleanupPendingTransactions(),
};

export async function runJob(jobType, userId = null) {
  const fn = JOB_MAP[jobType];
  if (!fn) {
    throw new Error(`Unknown job_type: "${jobType}". Valid: ${Object.keys(JOB_MAP).join(', ')}`);
  }
  return fn(userId);
}

// ─── Built-in HTTP server ─────────────────────────────────────────────────────
// Start via:  node helpers/scheduler.js
// Or import:  import { startServer } from './helpers/scheduler.js'

export function startServer(port = parseInt(process.env.SCHEDULER_PORT ?? '3001', 10)) {
  const API_KEY = process.env.SCHEDULER_API_KEY; // optional — if set, require X-Api-Key header

  async function parseBody(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    return raw ? JSON.parse(raw) : {};
  }

  function send(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  }

  const server = http.createServer(async (req, res) => {
    // ── Optional API key check ───────────────────────────────────────────────
    if (API_KEY && req.headers['x-api-key'] !== API_KEY) {
      return send(res, 401, { error: 'Unauthorised — set X-Api-Key header' });
    }

    const url    = req.url?.split('?')[0] ?? '/';
    const method = req.method ?? 'GET';

    // ── Health check ─────────────────────────────────────────────────────────
    if (method === 'GET' && url === '/health') {
      return send(res, 200, { status: 'ok', ts: new Date().toISOString(), jobs: Object.keys(JOB_MAP) });
    }

    if (method !== 'POST') {
      return send(res, 405, { error: 'Method not allowed' });
    }

    try {
      const body = await parseBody(req);
      let result;

      if (url === '/run/debt-reminder')     result = await runDebtReminderJob(body.user_id ?? null);
      else if (url === '/run/weekly-report')     result = await runWeeklyReportJob(body.user_id ?? null);
      else if (url === '/run/reminder-creation') result = await runReminderCreationJob();
      else if (url === '/run/cleanup')           result = await cleanupPendingTransactions();
      else if (url === '/demo/run-job')          result = await runJob(body.job_type, body.user_id);
      else return send(res, 404, { error: `Unknown route: ${url}`, routes: ['/run/debt-reminder', '/run/weekly-report', '/run/reminder-creation', '/run/cleanup', '/demo/run-job', '/health'] });

      send(res, 200, result);
    } catch (err) {
      warn(`Server error on ${url}: ${err.message}`);
      send(res, 500, { error: err.message });
    }
  });

  server.listen(port, () => {
    log(`Scheduler server listening on :${port}`);
    log(`Routes: GET /health  POST /run/{debt-reminder,weekly-report,reminder-creation,cleanup}  POST /demo/run-job`);
    if (API_KEY) log('API key auth: ENABLED (X-Api-Key header required)');
    else         log('API key auth: DISABLED (set SCHEDULER_API_KEY to enable)');
  });

  return server;
}

// ─── Entry point (run directly) ───────────────────────────────────────────────

if (process.argv[1]?.endsWith('scheduler.js')) {
  // Running as script: load dotenv then start server
  import('dotenv').then(({ config }) => {
    config();
    startServer();
  }).catch(() => {
    // dotenv not available — env vars must already be set
    startServer();
  });
}
