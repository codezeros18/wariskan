/**
 * Wariskan - tiny local API for Google Sheets writes.
 *
 * n8n calls this helper after a transaction is saved to Supabase. The helper
 * keeps Google credentials and retry logic in one place, outside the workflow.
 */

import 'dotenv/config';
import { createServer } from 'node:http';
import { appendTransaction, createUserSheet, updateTransactionRow } from './googleSheetsHelper.js';
import { cleanupPendingTransactions, runDebtReminderJob, runReminderCreationJob, runWeeklyReportJob } from './scheduler.js';

const PORT = Number(process.env.HELPER_API_PORT || process.env.PORT || 3001);
const API_KEY = process.env.HELPER_API_KEY || 'dev';
const SCHEDULER_API_KEY = process.env.SCHEDULER_API_KEY || API_KEY;

function getHealthPayload() {
  return {
    ok: true,
    service: 'wariskan-sheets-api',
    googleAuthConfigured: Boolean(
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH ||
      (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY)
    ),
    googleTemplateConfigured: Boolean(process.env.GOOGLE_TEMPLATE_SHEET_ID),
    googleMasterSheetConfigured: Boolean(process.env.GOOGLE_MASTER_SHEET_ID),
    authMode: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH
      ? 'key_path'
      : process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY
        ? 'email_private_key'
        : 'missing',
    endpoints: {
      health: 'GET /health',
      create: 'POST /api/sheets/create',
      append: 'POST /api/sheets/append',
      update: 'POST /api/sheets/update',
      reminderCreation: 'POST /run/reminder-creation',
      debtReminder: 'POST /run/debt-reminder',
    },
  };
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function isAuthorized(req, expectedKey = API_KEY) {
  return req.headers['x-api-key'] === expectedKey;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function normalizeTransaction(tx = {}) {
  return {
    id: tx.id,
    userId: tx.userId || tx.user_id || null,
    userDisplayName: tx.userDisplayName || tx.displayName || tx.display_name || null,
    phoneNumber: tx.phoneNumber || tx.phone_number || tx.whatsapp_phone || null,
    tabName: tx.tabName || tx.sheetTab || tx.sheet_tab || null,
    tanggal: tx.tanggal || new Date().toISOString().slice(0, 10),
    kategori: tx.kategori || tx.category || 'unclear',
    nominal: Number(tx.nominal || 0),
    pihak: tx.pihak || null,
    item: tx.item || null,
    status: tx.status || 'aktif',
    jatuhTempo: tx.jatuhTempo || tx.jatuh_tempo || null,
    createdAt: tx.createdAt || tx.created_at || null,
  };
}

async function handleAppend(req, res) {
  const key = req.headers['x-api-key'];
  if (!isAuthorized(req)) {
    sendJson(res, 401, { success: false, error: 'unauthorized' });
    return;
  }

  const body = await readJsonBody(req);
  const sheetId = body.sheetId || body.sheet_id;

  if (!sheetId) {
    sendJson(res, 200, {
      success: false,
      skipped: true,
      reason: 'missing_sheet_id',
    });
    return;
  }

  const transaction = normalizeTransaction({
    ...(body.transaction || {}),
    userId: body.user?.id || body.userId || body.user_id || body.transaction?.userId || body.transaction?.user_id,
    userDisplayName: body.user?.display_name || body.user?.displayName || body.displayName || body.display_name || body.transaction?.userDisplayName,
    phoneNumber: body.user?.whatsapp_phone || body.phoneNumber || body.phone_number || body.transaction?.phoneNumber,
    tabName: body.sheetTab || body.sheet_tab || body.transaction?.tabName,
  });
  if (!transaction.id) {
    sendJson(res, 400, { success: false, error: 'missing_transaction_id' });
    return;
  }

  const result = await appendTransaction(sheetId, transaction);
  sendJson(res, result.success ? 200 : 207, result);
}

async function handleUpdate(req, res) {
  const key = req.headers['x-api-key'];
  if (!isAuthorized(req)) {
    sendJson(res, 401, { success: false, error: 'unauthorized' });
    return;
  }

  const body = await readJsonBody(req);
  const sheetId = body.sheetId || body.sheet_id;
  if (!sheetId) {
    sendJson(res, 200, {
      success: false,
      skipped: true,
      reason: 'missing_sheet_id',
    });
    return;
  }

  const transaction = normalizeTransaction({
    ...(body.transaction || {}),
    userId: body.user?.id || body.userId || body.user_id || body.transaction?.userId || body.transaction?.user_id,
    userDisplayName: body.user?.display_name || body.user?.displayName || body.displayName || body.display_name || body.transaction?.userDisplayName,
    phoneNumber: body.user?.whatsapp_phone || body.phoneNumber || body.phone_number || body.transaction?.phoneNumber,
    tabName: body.sheetTab || body.sheet_tab || body.transaction?.tabName,
  });
  if (!transaction.id) {
    sendJson(res, 400, { success: false, error: 'missing_transaction_id' });
    return;
  }

  const result = await updateTransactionRow(sheetId, transaction);
  sendJson(res, result.success ? 200 : 207, result);
}

async function handleCreate(req, res) {
  const key = req.headers['x-api-key'];
  if (!isAuthorized(req)) {
    sendJson(res, 401, { success: false, error: 'unauthorized' });
    return;
  }

  const body = await readJsonBody(req);
  const userId = body.userId || body.user_id;
  const displayName = body.displayName || body.display_name || body.name || 'Wariskan User';
  const phoneNumber = body.phoneNumber || body.phone_number || body.whatsapp_phone || '';

  if (!userId) {
    sendJson(res, 400, { success: false, error: 'missing_user_id' });
    return;
  }

  const result = await createUserSheet(userId, displayName, phoneNumber);
  sendJson(res, result.success ? 200 : 207, result);
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/') {
      sendJson(res, 200, getHealthPayload());
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, getHealthPayload());
      return;
    }

    if (req.method === 'POST' && req.url === '/api/sheets/append') {
      await handleAppend(req, res);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/sheets/update') {
      await handleUpdate(req, res);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/sheets/create') {
      await handleCreate(req, res);
      return;
    }

    if (req.method === 'POST' && req.url === '/run/reminder-creation') {
      if (!isAuthorized(req, SCHEDULER_API_KEY)) {
        sendJson(res, 401, { success: false, error: 'unauthorized' });
        return;
      }
      const result = await runReminderCreationJob();
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && req.url === '/run/debt-reminder') {
      if (!isAuthorized(req, SCHEDULER_API_KEY)) {
        sendJson(res, 401, { success: false, error: 'unauthorized' });
        return;
      }
      const body = await readJsonBody(req);
      const result = await runDebtReminderJob(body.user_id || body.userId || null);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && req.url === '/run/weekly-report') {
      if (!isAuthorized(req, SCHEDULER_API_KEY)) {
        sendJson(res, 401, { success: false, error: 'unauthorized' });
        return;
      }
      const body = await readJsonBody(req);
      const result = await runWeeklyReportJob(body.user_id || body.userId || null);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && req.url === '/run/cleanup') {
      if (!isAuthorized(req, SCHEDULER_API_KEY)) {
        sendJson(res, 401, { success: false, error: 'unauthorized' });
        return;
      }
      const result = await cleanupPendingTransactions();
      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, { success: false, error: 'not_found' });
  } catch (err) {
    const statusCode = err.isAuth ? 500 : 400;
    sendJson(res, statusCode, {
      success: false,
      error: err.message || 'unknown_error',
      isAuth: Boolean(err.isAuth),
      isQuota: Boolean(err.isQuota),
    });
  }
});

server.listen(PORT, () => {
  console.log(`[sheets-api] listening on http://localhost:${PORT}`);
});
