/**
 * Wariskan — Google Sheets Integration
 * Manages per-user "buku digital" spreadsheets via service account.
 *
 * Auth: set GOOGLE_SERVICE_ACCOUNT_KEY_PATH (preferred) or
 *       GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY in .env
 */

import { google }   from 'googleapis';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import 'dotenv/config';
import { formatRupiah, formatTanggalIndonesia, parseTanggalIndonesia } from './formatters.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const TRANSAKSI_TAB  = 'Transaksi';
const TRANSAKSI_COLS = 9; // columns A-I
const TRANSAKSI_HEADERS = [
  'ID',
  'Tanggal',
  'Kategori',
  'Nominal',
  'Pihak',
  'Item',
  'Status',
  'Jatuh Tempo',
  'Created At',
];

const CACHE_TTL_MS    = 5 * 60 * 1000;   // 5 minutes
const RETRY_DELAYS_MS = [200, 1000, 5000]; // exponential backoff

// Column positions (0-based index into each row array)
const COL = {
  ID: 0, TANGGAL: 1, KATEGORI: 2, NOMINAL: 3,
  PIHAK: 4, ITEM: 5, STATUS: 6, JATUH_TEMPO: 7, CREATED_AT: 8,
};

// Row background tint per transaction category (RGB 0–1 scale)
const CATEGORY_BG = {
  pemasukan:      { red: 0.910, green: 0.961, blue: 0.910 }, // #E8F5E9
  pengeluaran:    { red: 1.000, green: 0.922, blue: 0.933 }, // #FFEBEE
  hutang:         { red: 1.000, green: 0.992, blue: 0.906 }, // #FFFDE7
  piutang:        { red: 0.890, green: 0.949, blue: 0.992 }, // #E3F2FD
  bayar_hutang:   { red: 0.961, green: 0.961, blue: 0.961 }, // #F5F5F5
  terima_piutang: { red: 0.961, green: 0.961, blue: 0.961 }, // #F5F5F5
  unclear:        { red: 0.988, green: 0.945, blue: 0.902 }, // #FCF1E6
};

// ─── Module-level singletons ─────────────────────────────────────────────────

let _authClient = null;
const _metaCache = new Map(); // Map<spreadsheetId, { meta, expiresAt }>

// ─── Internal utilities ───────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isAuthError(err)    { const s = err.response?.status; return s === 401 || s === 403; }
function isQuotaError(err)   { return err.response?.status === 429; }
function isRetryable(err) {
  if (['ECONNRESET','ETIMEDOUT','ECONNREFUSED','ENETUNREACH'].includes(err.code)) return true;
  const s = err.response?.status;
  return s === 500 || s === 502 || s === 503;
}

function describeGoogleError(err) {
  const status = err.response?.status;
  const data = err.response?.data;
  const detail = data?.error_description ||
    data?.error?.message ||
    data?.message ||
    err.message ||
    'unknown_error';
  const code = data?.error || data?.error?.status || data?.error?.code || err.code;
  return [
    status ? `HTTP ${status}` : null,
    code ? String(code) : null,
    detail ? String(detail) : null,
  ].filter(Boolean).join(' - ');
}

/**
 * Retry wrapper with exponential backoff.
 * - Auth errors  → throws immediately with .isAuth = true
 * - Quota errors → throws immediately with .isQuota = true
 * - Network/5xx  → retries up to RETRY_DELAYS_MS.length times
 */
async function withRetry(fn, label) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (isAuthError(err)) {
        const e = new Error(`[Sheets] Auth error on "${label}": ${describeGoogleError(err)}`);
        e.isAuth = true;
        throw e;
      }
      if (isQuotaError(err)) {
        const e = new Error(`[Sheets] Quota exceeded on "${label}"`);
        e.isQuota = true;
        throw e;
      }
      if (!isRetryable(err) || attempt === RETRY_DELAYS_MS.length) break;
      const delay = RETRY_DELAYS_MS[attempt];
      console.warn(`[Sheets] "${label}" attempt ${attempt + 1} failed — retrying in ${delay}ms: ${err.message}`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

/**
 * Wraps a public function to always return { success, data?, error?, queued? }.
 * Auth errors are re-thrown so ops team gets a hard crash (not silent failure).
 */
async function safeCall(fn, label) {
  try {
    const data = await fn();
    return { success: true, data };
  } catch (err) {
    if (err.isAuth) throw err; // hard fail — misconfiguration, ops must fix
    if (err.isQuota) {
      console.warn(`[Sheets] Quota exceeded for "${label}" — item queued`);
      return { success: false, error: 'quota_exceeded', queued: true };
    }
    console.error(`[Sheets] "${label}" error:`, err.message);
    return { success: false, error: err.message };
  }
}

// ─── Authentication (lazy singleton) ─────────────────────────────────────────

async function getAuthClient() {
  if (_authClient) return _authClient;

  const scopes = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
  ];

  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;

  if (keyPath && existsSync(keyPath)) {
    const key = JSON.parse(await readFile(keyPath, 'utf8'));
    _authClient = new google.auth.GoogleAuth({ credentials: key, scopes });
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    _authClient = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        // .env often stores literal \n — normalize to real newlines
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes,
    });
  } else {
    const e = new Error(
      '[Sheets] Auth not configured. Set GOOGLE_SERVICE_ACCOUNT_KEY_PATH or ' +
      'GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY in .env'
    );
    e.isAuth = true;
    throw e;
  }

  return _authClient;
}

async function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: await getAuthClient() });
}

async function getDriveClient() {
  return google.drive({ version: 'v3', auth: await getAuthClient() });
}

// ─── Metadata cache ───────────────────────────────────────────────────────────

/**
 * Fetches and caches spreadsheet metadata for CACHE_TTL_MS.
 * Returns { title: string, tabs: { [tabName]: numericSheetId } }
 * The numeric sheetId is required for batchUpdate formatting requests.
 */
async function getSpreadsheetMeta(spreadsheetId) {
  const cached = _metaCache.get(spreadsheetId);
  if (cached && Date.now() < cached.expiresAt) return cached.meta;

  const sheets = await getSheetsClient();
  const { data } = await withRetry(
    () => sheets.spreadsheets.get({ spreadsheetId }),
    `getSpreadsheetMeta(${spreadsheetId})`
  );

  const meta = {
    title: data.properties.title,
    tabs: Object.fromEntries(
      data.sheets.map((s) => [s.properties.title, s.properties.sheetId])
    ),
  };

  _metaCache.set(spreadsheetId, { meta, expiresAt: Date.now() + CACHE_TTL_MS });
  return meta;
}

// ─── Date handling for Sheets ─────────────────────────────────────────────────

// Dates are written as ISO "YYYY-MM-DD" (USER_ENTERED → Sheets stores as date serial).
// When reading with UNFORMATTED_VALUE, date cells come back as serial numbers.
// Google Sheets epoch: December 30, 1899.
function sheetsSerialToDate(serial) {
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
}

function toISODate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0]; // "2026-04-28"
}

function parseSheetDate(value) {
  if (!value && value !== 0) return null;
  if (typeof value === 'number') return sheetsSerialToDate(value);
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value); // ISO fallback
    // Indonesian formatted string fallback (if column format overrides)
    return parseTanggalIndonesia?.(value) ?? null;
  }
  return null;
}

// ─── Row parsing ──────────────────────────────────────────────────────────────

function padRow(row, len) {
  return [...row, ...Array(Math.max(0, len - row.length)).fill('')];
}

function rowToTransaction(row) {
  const r = padRow(row, TRANSAKSI_COLS);
  return {
    id:         r[COL.ID]         || null,
    tanggal:    parseSheetDate(r[COL.TANGGAL]),
    kategori:   r[COL.KATEGORI]   || '',
    nominal:    parseInt(String(r[COL.NOMINAL]).replace(/[^\d]/g, ''), 10) || 0,
    pihak:      r[COL.PIHAK]      || null,
    item:       r[COL.ITEM]       || null,
    status:     r[COL.STATUS]     || '',
    jatuhTempo: parseSheetDate(r[COL.JATUH_TEMPO]),
    createdAt:  parseSheetDate(r[COL.CREATED_AT]),
  };
}

/** Extract 1-based row number from a Sheets API range string like "'Transaksi'!A5:H5" */
function rowNumFromRange(rangeStr) {
  const m = rangeStr?.match(/:?[A-Z](\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function quoteSheetTab(tabName) {
  return `'${String(tabName).replace(/'/g, "''")}'`;
}

function buildUserTabName(displayName, phoneNumber, userId) {
  const baseName = String(displayName || 'user')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'user';
  const suffix = String(phoneNumber || userId || '').replace(/\D/g, '').slice(-4) ||
    String(userId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 4) ||
    '0000';
  return `${baseName}-${suffix}`.slice(0, 90);
}

function getTransactionTab(meta, preferredTabName = TRANSAKSI_TAB) {
  if (preferredTabName && meta.tabs[preferredTabName] !== undefined) {
    return { name: preferredTabName, id: meta.tabs[preferredTabName] };
  }

  if (meta.tabs[TRANSAKSI_TAB] !== undefined) {
    return { name: TRANSAKSI_TAB, id: meta.tabs[TRANSAKSI_TAB] };
  }

  const firstTab = Object.entries(meta.tabs)[0];
  if (!firstTab) {
    throw new Error('[Sheets] No tab found in spreadsheet.');
  }

  console.warn(`[Sheets] Tab "${TRANSAKSI_TAB}" not found; using first tab "${firstTab[0]}" instead.`);
  return { name: firstTab[0], id: firstTab[1] };
}

async function ensureTransactionTab(spreadsheetId, tabName) {
  const sheets = await getSheetsClient();
  let meta = await getSpreadsheetMeta(spreadsheetId);
  if (meta.tabs[tabName] !== undefined) {
    return { name: tabName, id: meta.tabs[tabName], created: false };
  }

  await withRetry(
    () => sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: tabName } } }],
      },
    }),
    `ensureTransactionTab:add(${tabName})`
  );

  _metaCache.delete(spreadsheetId);
  meta = await getSpreadsheetMeta(spreadsheetId);

  await withRetry(
    () => sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${quoteSheetTab(tabName)}!A1:I1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [TRANSAKSI_HEADERS] },
    }),
    `ensureTransactionTab:headers(${tabName})`
  );

  return { name: tabName, id: meta.tabs[tabName], created: true };
}

// ─── Formatting request builders ──────────────────────────────────────────────

function buildBgColorRequest(numericTabId, rowIndex, color) {
  return {
    repeatCell: {
      range: {
        sheetId:          numericTabId,
        startRowIndex:    rowIndex,
        endRowIndex:      rowIndex + 1,
        startColumnIndex: 0,
        endColumnIndex:   TRANSAKSI_COLS,
      },
      cell: {
        userEnteredFormat: { backgroundColor: color },
      },
      fields: 'userEnteredFormat.backgroundColor',
    },
  };
}

function buildStrikethroughRequest(numericTabId, rowIndex) {
  return {
    repeatCell: {
      range: {
        sheetId:          numericTabId,
        startRowIndex:    rowIndex,
        endRowIndex:      rowIndex + 1,
        startColumnIndex: 0,
        endColumnIndex:   TRANSAKSI_COLS,
      },
      cell: {
        userEnteredFormat: {
          textFormat: { strikethrough: true },
        },
      },
      fields: 'userEnteredFormat.textFormat.strikethrough',
    },
  };
}

function transactionToSheetRow(transaction) {
  const {
    id,
    tanggal,
    kategori,
    nominal,
    pihak,
    item,
    status,
    jatuhTempo,
    createdAt,
  } = transaction;

  return [
    id,
    toISODate(tanggal),
    kategori,
    formatRupiah(nominal),
    pihak ?? '',
    item ?? '',
    status,
    jatuhTempo ? toISODate(jatuhTempo) : '',
    createdAt ? new Date(createdAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '',
  ];
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a new user spreadsheet by copying the template.
 * Template ID must be set via GOOGLE_TEMPLATE_SHEET_ID env var.
 * The service account must have at least Editor access to the template.
 *
 * @param {string} userId       Supabase user UUID (for logging)
 * @param {string} displayName  Display name of the warung owner
 * @param {string} phoneNumber  WhatsApp number in E.164 format (+628...)
 * @returns {{ success, data: { sheetId, sheetUrl } }}
 */
export async function createUserSheet(userId, displayName, phoneNumber) {
  return safeCall(async () => {
    const masterSheetId = process.env.GOOGLE_MASTER_SHEET_ID;
    if (masterSheetId) {
      const tabName = buildUserTabName(displayName, phoneNumber, userId);
      const tab = await ensureTransactionTab(masterSheetId, tabName);
      return {
        sheetId: masterSheetId,
        sheetUrl: `https://docs.google.com/spreadsheets/d/${masterSheetId}/edit`,
        sheetTab: tab.name,
        tabCreated: tab.created,
      };
    }

    const templateId = process.env.GOOGLE_TEMPLATE_SHEET_ID;
    const drive      = await getDriveClient();
    const sheets     = await getSheetsClient();
    const phoneLast4 = String(phoneNumber).replace(/\D/g, '').slice(-4);
    const fileName   = `Wariskan - ${displayName} - ${phoneLast4}`;

    let fileId;
    let sheetUrl;

    if (templateId) {
      // Copy the template when configured.
      const { data: copied } = await withRetry(
        () => drive.files.copy({
          fileId:      templateId,
          requestBody: { name: fileName },
          fields:      'id,webViewLink',
        }),
        `drive.files.copy(userId=${userId})`
      );
      fileId = copied.id;
      sheetUrl = copied.webViewLink;
    } else {
      // No template: create a ready-to-use spreadsheet with the expected tab.
      const { data: created } = await withRetry(
        () => sheets.spreadsheets.create({
          requestBody: {
            properties: { title: fileName },
            sheets: [{ properties: { title: TRANSAKSI_TAB } }],
          },
          fields: 'spreadsheetId,spreadsheetUrl',
        }),
        `spreadsheets.create(userId=${userId})`
      );

      fileId = created.spreadsheetId;
      sheetUrl = created.spreadsheetUrl;

      await withRetry(
        () => sheets.spreadsheets.values.update({
          spreadsheetId: fileId,
          range: `${quoteSheetTab(TRANSAKSI_TAB)}!A1:I1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [TRANSAKSI_HEADERS],
          },
        }),
        `spreadsheets.create:headers(userId=${userId})`
      );
    }

    // Share: anyone with link can view (warung owner can share with family).
    // Some Google Workspace policies block public link sharing; writing still works
    // because the service account owns or copied the file, so don't fail creation.
    try {
      await withRetry(
        () => drive.permissions.create({
          fileId,
          requestBody: { role: 'reader', type: 'anyone' },
          fields:      'id',
        }),
        `drive.permissions.create(fileId=${fileId})`
      );
    } catch (err) {
      console.warn(`[Sheets] Public sharing skipped for ${fileId}: ${err.message}`);
    }

    return { sheetId: fileId, sheetUrl };
  }, 'createUserSheet');
}

/**
 * Append a single transaction row to the "Transaksi" sheet tab.
 * Dates are written as ISO "YYYY-MM-DD" so Sheets treats them as dates.
 * Row background is colored by transaction category.
 *
 * @param {string} sheetId      Google Spreadsheet ID
 * @param {{
 *   id:         string,
 *   tanggal:    Date|string,
 *   kategori:   string,
 *   nominal:    number,
 *   pihak:      string|null,
 *   item:       string|null,
 *   status:     string,
 *   jatuhTempo: Date|string|null,
 *   createdAt:  Date|string|null
 * }} transaction
 * @returns {{ success, data: { rowNumber } }}
 */
export async function appendTransaction(sheetId, transaction) {
  return safeCall(async () => {
    const {
      id,
      tanggal,
      kategori,
      nominal,
      pihak,
      item,
      status,
      jatuhTempo,
      createdAt,
      tabName,
      userDisplayName,
      phoneNumber,
      userId,
    } = transaction;

    const sheets = await getSheetsClient();
    const masterSheetId = process.env.GOOGLE_MASTER_SHEET_ID;
    const preferredTabName = tabName ||
      (masterSheetId && sheetId === masterSheetId
        ? buildUserTabName(userDisplayName, phoneNumber, userId)
        : TRANSAKSI_TAB);
    const tab = masterSheetId && sheetId === masterSheetId
      ? await ensureTransactionTab(sheetId, preferredTabName)
      : getTransactionTab(await getSpreadsheetMeta(sheetId), preferredTabName);

    const row = transactionToSheetRow({ id, tanggal, kategori, nominal, pihak, item, status, jatuhTempo, createdAt });

    // Append the row; INSERT_ROWS avoids overwriting formulas below existing data
    const appendRes = await withRetry(
      () => sheets.spreadsheets.values.append({
        spreadsheetId:    sheetId,
        range:            `${quoteSheetTab(tab.name)}!A:I`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody:      { values: [row] },
      }),
      `appendTransaction(${id})`
    );

    const updatedRange = appendRes.data.updates?.updatedRange ?? '';
    const rowNum       = rowNumFromRange(updatedRange);

    // Apply category background color in the same batch
    const color = CATEGORY_BG[kategori] ?? CATEGORY_BG.unclear;
    if (rowNum !== null) {
      await withRetry(
        () => sheets.spreadsheets.batchUpdate({
          spreadsheetId: sheetId,
          requestBody: {
            requests: [buildBgColorRequest(tab.id, rowNum - 1, color)],
          },
        }),
        `appendTransaction:color(${id})`
      );
    }

    return { rowNumber: rowNum, sheetTab: tab.name };
  }, 'appendTransaction');
}

/**
 * Update an existing transaction row by ID.
 * Used when WhatsApp commands correct or cancel the latest transaction.
 *
 * @param {string} sheetId
 * @param {object} transaction
 * @returns {{ success, data: { rowNumber, updated } }}
 */
export async function updateTransactionRow(sheetId, transaction) {
  return safeCall(async () => {
    const masterSheetId = process.env.GOOGLE_MASTER_SHEET_ID;
    const preferredTabName = transaction.tabName ||
      (masterSheetId && sheetId === masterSheetId
        ? buildUserTabName(transaction.userDisplayName, transaction.phoneNumber, transaction.userId)
        : TRANSAKSI_TAB);
    const tab = masterSheetId && sheetId === masterSheetId
      ? await ensureTransactionTab(sheetId, preferredTabName)
      : getTransactionTab(await getSpreadsheetMeta(sheetId), preferredTabName);

    const sheets = await getSheetsClient();
    const { data: colData } = await withRetry(
      () => sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `${quoteSheetTab(tab.name)}!A:A`,
      }),
      `updateTransactionRow:find(${transaction.id})`
    );

    const rows = colData.values ?? [];
    const rowIdx = rows.findIndex((r) => r[0] === transaction.id);
    if (rowIdx === -1) {
      return { rowNumber: null, updated: false, sheetTab: tab.name };
    }

    const rowNum = rowIdx + 1;
    await withRetry(
      () => sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${quoteSheetTab(tab.name)}!A${rowNum}:I${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [transactionToSheetRow(transaction)] },
      }),
      `updateTransactionRow:write(${transaction.id})`
    );

    const requests = [
      buildBgColorRequest(tab.id, rowIdx, CATEGORY_BG[transaction.kategori] ?? CATEGORY_BG.unclear),
    ];
    if (transaction.status === 'dibatalkan') {
      requests.push(buildStrikethroughRequest(tab.id, rowIdx));
    }

    await withRetry(
      () => sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { requests },
      }),
      `updateTransactionRow:format(${transaction.id})`
    );

    return { rowNumber: rowNum, updated: true, sheetTab: tab.name };
  }, 'updateTransactionRow');
}

/**
 * Find a transaction by ID in column A and update its status in column G.
 * If newStatus === 'lunas', applies strikethrough formatting to the entire row.
 *
 * @param {string} sheetId
 * @param {string} transactionId  UUID matching column A
 * @param {string} newStatus      e.g. 'lunas', 'dibatalkan'
 * @returns {{ success, data: { rowNumber, updated } }}
 */
export async function updateTransactionStatus(sheetId, transactionId, newStatus) {
  return safeCall(async () => {
    const sheets = await getSheetsClient();
    const meta   = await getSpreadsheetMeta(sheetId);
    const tabId  = meta.tabs[TRANSAKSI_TAB];

    // Read column A to locate the row (IDs are text — FORMATTED_VALUE is fine)
    const { data: colData } = await withRetry(
      () => sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range:         `${TRANSAKSI_TAB}!A:A`,
      }),
      `updateTransactionStatus:find(${transactionId})`
    );

    const rows    = colData.values ?? [];
    const rowIdx  = rows.findIndex((r) => r[0] === transactionId); // 0-based

    if (rowIdx === -1) {
      return { rowNumber: null, updated: false };
    }

    const rowNum = rowIdx + 1; // 1-based for A1 notation

    // Update status cell
    await withRetry(
      () => sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: [{ range: `${TRANSAKSI_TAB}!G${rowNum}`, values: [[newStatus]] }],
        },
      }),
      `updateTransactionStatus:write(${transactionId})`
    );

    // Strikethrough entire row when marking lunas
    if (newStatus === 'lunas' && tabId !== undefined) {
      await withRetry(
        () => sheets.spreadsheets.batchUpdate({
          spreadsheetId: sheetId,
          requestBody: {
            requests: [buildStrikethroughRequest(tabId, rowIdx)],
          },
        }),
        `updateTransactionStatus:strikethrough(${transactionId})`
      );
    }

    return { rowNumber: rowNum, updated: true };
  }, 'updateTransactionStatus');
}

/**
 * Read all transactions from "Transaksi" tab within a date range.
 * Uses UNFORMATTED_VALUE so date cells return serials, not locale-dependent strings.
 *
 * @param {string}     sheetId
 * @param {Date|string} startDate  Inclusive start
 * @param {Date|string} endDate    Inclusive end
 * @returns {{ success, data: Array<transaction> }}
 */
export async function getTransactionsInRange(sheetId, startDate, endDate) {
  return safeCall(async () => {
    const sheets = await getSheetsClient();

    const { data } = await withRetry(
      () => sheets.spreadsheets.values.get({
        spreadsheetId:    sheetId,
        range:            `${TRANSAKSI_TAB}!A:I`,
        valueRenderOption: 'UNFORMATTED_VALUE', // dates → serial numbers, text → strings
      }),
      `getTransactionsInRange(${sheetId})`
    );

    const rows = data.values ?? [];
    if (rows.length <= 1) return []; // header only or empty sheet

    const start = new Date(startDate); start.setHours(0, 0, 0, 0);
    const end   = new Date(endDate);   end.setHours(23, 59, 59, 999);

    return rows
      .slice(1) // skip header row
      .map(rowToTransaction)
      .filter((t) => t.id && t.tanggal && t.tanggal >= start && t.tanggal <= end);
  }, 'getTransactionsInRange');
}

/**
 * Aggregate quick stats across the entire "Transaksi" sheet.
 * Excludes 'dibatalkan' transactions from sums.
 *
 * @param {string} sheetId
 * @returns {{ success, data: {
 *   totalTransaksi, totalPemasukan, totalPengeluaran, netCashflow,
 *   hutangAktif: { count, total }, piutangAktif: { count, total }
 * }}}
 */
export async function getSheetSummary(sheetId) {
  return safeCall(async () => {
    const sheets = await getSheetsClient();

    const { data } = await withRetry(
      () => sheets.spreadsheets.values.get({
        spreadsheetId:    sheetId,
        range:            `${TRANSAKSI_TAB}!A:I`,
        valueRenderOption: 'UNFORMATTED_VALUE',
      }),
      `getSheetSummary(${sheetId})`
    );

    const rows = (data.values ?? []).slice(1).map(rowToTransaction);

    let totalPemasukan   = 0;
    let totalPengeluaran = 0;
    let hutangCount = 0,  hutangTotal  = 0;
    let piutangCount = 0, piutangTotal = 0;

    for (const t of rows) {
      if (t.status === 'dibatalkan') continue;
      if (t.kategori === 'pemasukan')   totalPemasukan   += t.nominal;
      if (t.kategori === 'pengeluaran') totalPengeluaran += t.nominal;
      if (t.kategori === 'hutang'  && t.status === 'aktif') { hutangCount++;  hutangTotal  += t.nominal; }
      if (t.kategori === 'piutang' && t.status === 'aktif') { piutangCount++; piutangTotal += t.nominal; }
    }

    return {
      totalTransaksi:  rows.length,
      totalPemasukan,
      totalPengeluaran,
      netCashflow:     totalPemasukan - totalPengeluaran,
      hutangAktif:     { count: hutangCount,  total: hutangTotal },
      piutangAktif:    { count: piutangCount, total: piutangTotal },
    };
  }, 'getSheetSummary');
}

/**
 * Force-invalidate the metadata cache for a specific sheet (or all sheets).
 * Call this after structural changes (renaming tabs, etc.).
 *
 * @param {string} [spreadsheetId]  Omit to clear entire cache
 */
export function clearMetadataCache(spreadsheetId) {
  if (spreadsheetId) {
    _metaCache.delete(spreadsheetId);
  } else {
    _metaCache.clear();
  }
}
