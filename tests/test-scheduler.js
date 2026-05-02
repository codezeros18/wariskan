/**
 * Wariskan — Scheduler test runner
 *
 * Usage:
 *   node tests/test-scheduler.js --job=weekly-report
 *   node tests/test-scheduler.js --job=debt-reminder --user=a0000001-0000-0000-0000-000000000001
 *   node tests/test-scheduler.js --job=all
 *   node tests/test-scheduler.js --help
 *
 * Requires .env with SUPABASE_URL, SUPABASE_SERVICE_KEY, WHATSAPP_* set.
 * Set WHATSAPP_MOCK_MODE=true to avoid real WA sends during testing.
 */

import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Bootstrap .env ──────────────────────────────────────────────────────────

const __dir   = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, '..', '.env');

if (existsSync(envPath)) {
  const { default: dotenv } = await import('dotenv');
  dotenv.config({ path: envPath });
  console.log('[test-scheduler] Loaded .env');
} else {
  console.warn('[test-scheduler] .env not found — using existing process.env');
}

// ── Help text ───────────────────────────────────────────────────────────────

const HELP = `
Wariskan Scheduler Test Runner
───────────────────────────────
Usage:
  node tests/test-scheduler.js --job=<job> [--user=<uuid>] [--dry-run]

Options:
  --job      Required. One of:
               debt-reminder      Send due debt/piutang reminders
               weekly-report      Send weekly financial reports
               reminder-creation  Create upcoming reminder rows in DB
               cleanup            Cancel stale pending transactions
               all                Run all jobs in sequence

  --user     Optional. Target a single user UUID.
             Omit to run across ALL users (use with care in prod!).

  --dry-run  Print what would run without executing.
  --help     Show this help.

Examples:
  # Test weekly report for one user (safe, mock WA)
  WHATSAPP_MOCK_MODE=true node tests/test-scheduler.js \\
    --job=weekly-report \\
    --user=a0000001-0000-0000-0000-000000000001

  # Test all jobs for one user
  WHATSAPP_MOCK_MODE=true node tests/test-scheduler.js --job=all --user=<uuid>

  # Reminder creation for all users (DB write, no WA)
  node tests/test-scheduler.js --job=reminder-creation
`.trim();

// ── Parse CLI args ──────────────────────────────────────────────────────────

const VALID_JOBS = ['debt-reminder', 'weekly-report', 'reminder-creation', 'cleanup', 'all'];

let args;
try {
  const parsed = parseArgs({
    args:    process.argv.slice(2),
    options: {
      job:     { type: 'string'  },
      user:    { type: 'string'  },
      'dry-run': { type: 'boolean', default: false },
      help:    { type: 'boolean', default: false },
    },
    strict: true,
  });
  args = parsed.values;
} catch (err) {
  console.error('[test-scheduler] Argument error:', err.message);
  console.error('Run with --help for usage.');
  process.exit(1);
}

if (args.help) {
  console.log(HELP);
  process.exit(0);
}

if (!args.job) {
  console.error('[test-scheduler] Error: --job is required.\n');
  console.log(HELP);
  process.exit(1);
}

if (!VALID_JOBS.includes(args.job)) {
  console.error(`[test-scheduler] Unknown job: "${args.job}". Valid: ${VALID_JOBS.join(', ')}`);
  process.exit(1);
}

// ── Env check ───────────────────────────────────────────────────────────────

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error('[test-scheduler] Missing env vars:', missing.join(', '));
  console.error('Copy .env.example → .env and fill in your dev credentials.');
  process.exit(1);
}

const mockMode = process.env.WHATSAPP_MOCK_MODE === 'true';
if (!mockMode) {
  console.warn('[test-scheduler] ⚠️  WHATSAPP_MOCK_MODE is not "true" — real WA messages WILL be sent!');
}

// ── Run ─────────────────────────────────────────────────────────────────────

const job    = args.job;
const userId = args.user ?? null;
const dryRun = args['dry-run'] ?? false;

console.log('');
console.log('═'.repeat(55));
console.log('  Wariskan Scheduler Test Runner');
console.log('═'.repeat(55));
console.log(`  Job      : ${job}`);
console.log(`  User     : ${userId ?? '(all users)'}`);
console.log(`  Mock WA  : ${mockMode}`);
console.log(`  Dry run  : ${dryRun}`);
console.log(`  Time     : ${new Date().toISOString()}`);
console.log('═'.repeat(55));
console.log('');

if (dryRun) {
  console.log('[test-scheduler] DRY RUN — no jobs will be executed.');
  process.exit(0);
}

// ── Import scheduler (after env is loaded) ──────────────────────────────────

let scheduler;
try {
  scheduler = await import('../helpers/scheduler.js');
} catch (err) {
  console.error('[test-scheduler] Failed to import scheduler.js:', err.message);
  console.error(err.stack);
  process.exit(1);
}

const {
  runDebtReminderJob,
  runWeeklyReportJob,
  runReminderCreationJob,
  cleanupPendingTransactions,
} = scheduler;

// ── Job runner ───────────────────────────────────────────────────────────────

async function runOne(jobName, fn, uid) {
  console.log(`\n▶ Starting: ${jobName}${uid ? ` (user: ${uid})` : ''}`);
  const t0 = Date.now();
  try {
    const result = await fn(uid);
    const ms = Date.now() - t0;

    console.log(`\n✅ ${jobName} completed in ${ms}ms`);
    console.log(`   Processed : ${result.processedCount}`);
    console.log(`   Skipped   : ${result.skippedCount}`);
    if (result.errors?.length > 0) {
      console.log(`   Errors    : ${result.errors.length}`);
      result.errors.forEach((e, i) => console.log(`     [${i+1}] ${e}`));
    }

    return { jobName, success: result.success, ms, result };
  } catch (err) {
    const ms = Date.now() - t0;
    console.error(`\n❌ ${jobName} threw after ${ms}ms:`, err.message);
    if (process.env.NODE_ENV !== 'production') console.error(err.stack);
    return { jobName, success: false, ms, error: err.message };
  }
}

// ── Execute ──────────────────────────────────────────────────────────────────

const JOB_MAP = {
  'debt-reminder':     runDebtReminderJob,
  'weekly-report':     runWeeklyReportJob,
  'reminder-creation': runReminderCreationJob,
  'cleanup':           () => cleanupPendingTransactions(),
};

const jobsToRun = job === 'all'
  ? Object.entries(JOB_MAP)
  : [[job, JOB_MAP[job]]];

const results = [];

for (const [name, fn] of jobsToRun) {
  const uid = name === 'cleanup' ? null : userId;  // cleanup is always global
  const res = await runOne(name, fn, uid);
  results.push(res);
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('\n');
console.log('═'.repeat(55));
console.log('  SUMMARY');
console.log('═'.repeat(55));

let allOk = true;
for (const r of results) {
  const icon = r.success ? '✅' : '❌';
  console.log(`  ${icon} ${r.jobName.padEnd(22)} ${r.ms}ms`);
  if (!r.success) allOk = false;
}

console.log('═'.repeat(55));
console.log('');

process.exit(allOk ? 0 : 1);
