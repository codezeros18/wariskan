/**
 * Wariskan — Google Sheets Manual Test Suite
 * Run: npm run test-sheets
 *
 * SETUP BEFORE RUNNING:
 *   1. Create .env with at minimum:
 *        GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./service-account-key.json  (or EMAIL + PRIVATE_KEY)
 *        GOOGLE_SHEET_ID=<a real sheet the service account has Editor access to>
 *        GOOGLE_TEMPLATE_SHEET_ID=<your template sheet ID>
 *   2. Share the test sheet with the service account email as Editor.
 *   3. The sheet must have a tab named exactly "Transaksi" with a header row in row 1.
 *
 * Tests are grouped:
 *   [UNIT]   — no API calls, always run
 *   [SHEETS] — calls Google Sheets API, requires GOOGLE_SHEET_ID in .env
 *   [DRIVE]  — calls Google Drive API, requires GOOGLE_TEMPLATE_SHEET_ID in .env
 */

import 'dotenv/config';
import {
  formatRupiah,
  formatTanggalIndonesia,
  formatTanggalLengkap,
  parseTanggalIndonesia,
} from '../helpers/formatters.js';

import {
  createUserSheet,
  appendTransaction,
  updateTransactionStatus,
  getTransactionsInRange,
  getSheetSummary,
  clearMetadataCache,
} from '../helpers/googleSheetsHelper.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ ${message}`);
    failed++;
    errors.push(message);
  }
}

function assertEqual(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function section(name) {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`📋 ${name}`);
  console.log('─'.repeat(50));
}

function randomUUID() {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── [UNIT] Formatter Tests ───────────────────────────────────────────────────

function testFormatters() {
  section('[UNIT] formatters.js');

  // formatRupiah
  assertEqual(formatRupiah(1250000), 'Rp 1.250.000', 'formatRupiah(1250000)');
  assertEqual(formatRupiah(0),       'Rp 0',          'formatRupiah(0)');
  assertEqual(formatRupiah(25000),   'Rp 25.000',     'formatRupiah(25000)');
  assertEqual(formatRupiah(-50000),  'Rp 50.000',     'formatRupiah negative → abs');
  assertEqual(formatRupiah(null),    'Rp 0',          'formatRupiah(null) → Rp 0');
  assertEqual(formatRupiah('abc'),   'Rp 0',          'formatRupiah(NaN string) → Rp 0');
  assertEqual(formatRupiah('59500'), 'Rp 59.500',     'formatRupiah(string number)');

  // formatTanggalIndonesia
  const d = new Date(2026, 3, 28); // April 28, 2026
  assertEqual(formatTanggalIndonesia(d),             '28 Apr 2026', 'formatTanggalIndonesia(Date)');
  assertEqual(formatTanggalIndonesia('2026-01-01'),  '01 Jan 2026', 'formatTanggalIndonesia(ISO string)');
  assertEqual(formatTanggalIndonesia(null),          '',            'formatTanggalIndonesia(null) → empty');
  assertEqual(formatTanggalIndonesia(new Date(2026, 4, 1)), '01 Mei 2026', 'formatTanggalIndonesia May');

  // formatTanggalLengkap
  // April 28 2026 is a Tuesday = Selasa
  assert(formatTanggalLengkap(d).startsWith('Selasa'), 'formatTanggalLengkap starts with Selasa');
  assert(formatTanggalLengkap(d).includes('April'),    'formatTanggalLengkap includes April');
  assert(formatTanggalLengkap(d).includes('2026'),     'formatTanggalLengkap includes year');
  assertEqual(formatTanggalLengkap(null), '', 'formatTanggalLengkap(null) → empty');

  // parseTanggalIndonesia
  const parsed = parseTanggalIndonesia('28 Apr 2026');
  assert(parsed instanceof Date,    'parseTanggalIndonesia returns Date');
  assert(parsed.getFullYear() === 2026, 'parseTanggalIndonesia year=2026');
  assert(parsed.getMonth()   === 3,    'parseTanggalIndonesia month=3 (April)');
  assert(parsed.getDate()    === 28,   'parseTanggalIndonesia day=28');
  assertEqual(parseTanggalIndonesia('01 Mei 2026')?.getMonth(), 4, 'parseTanggalIndonesia Mei=4');
  assertEqual(parseTanggalIndonesia(null),        null, 'parseTanggalIndonesia(null) → null');
  assertEqual(parseTanggalIndonesia(''),          null, 'parseTanggalIndonesia(empty) → null');
  assertEqual(parseTanggalIndonesia('garbage'),   null, 'parseTanggalIndonesia(garbage) → null');
  assertEqual(parseTanggalIndonesia('28 abc 26'), null, 'parseTanggalIndonesia(bad month) → null');

  // Round-trip: formatTanggalIndonesia ↔ parseTanggalIndonesia
  const original = new Date(2026, 11, 25); // Dec 25
  const formatted = formatTanggalIndonesia(original);
  const reparsed  = parseTanggalIndonesia(formatted);
  assert(reparsed?.getDate()    === 25, 'Round-trip: day preserved');
  assert(reparsed?.getMonth()   === 11, 'Round-trip: month preserved (Des=11)');
  assert(reparsed?.getFullYear() === 2026, 'Round-trip: year preserved');
}

// ─── [SHEETS] Integration Tests ───────────────────────────────────────────────

async function testAppendTransaction(sheetId) {
  section('[SHEETS] appendTransaction');

  const txId = randomUUID();
  const tx   = {
    id:         txId,
    tanggal:    new Date(),
    kategori:   'pemasukan',
    nominal:    350000,
    pihak:      null,
    item:       'Penjualan harian — test',
    status:     'aktif',
    jatuhTempo: null,
  };

  console.log(`  → Appending transaction id=${txId}`);
  const res = await appendTransaction(sheetId, tx);

  assert(res.success === true,     'appendTransaction returns success=true');
  assert(typeof res.data?.rowNumber === 'number', 'appendTransaction returns numeric rowNumber');
  console.log(`  → Row appended at row #${res.data?.rowNumber}`);

  // Test pengeluaran (red row)
  const tx2 = {
    id:         randomUUID(),
    tanggal:    new Date(),
    kategori:   'pengeluaran',
    nominal:    125000,
    pihak:      'Toko Indah',
    item:       'Gula 5kg — test',
    status:     'aktif',
    jatuhTempo: null,
  };
  const res2 = await appendTransaction(sheetId, tx2);
  assert(res2.success === true, 'appendTransaction pengeluaran returns success');

  // Test hutang with jatuh tempo (yellow row)
  const tx3 = {
    id:         randomUUID(),
    tanggal:    new Date(),
    kategori:   'hutang',
    nominal:    200000,
    pihak:      'Bu Tini Test',
    item:       'Stok beras — test',
    status:     'aktif',
    jatuhTempo: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
  };
  const res3 = await appendTransaction(sheetId, tx3);
  assert(res3.success === true, 'appendTransaction hutang with jatuh tempo returns success');

  // Return first txId for downstream tests
  return { txId, rowNumber: res.data?.rowNumber };
}

async function testUpdateTransactionStatus(sheetId, txId) {
  section('[SHEETS] updateTransactionStatus');

  if (!txId) {
    console.log('  ⚠️  Skipped — no txId from appendTransaction test');
    return;
  }

  console.log(`  → Looking for txId=${txId}`);

  // Update to 'lunas' (should also apply strikethrough)
  const res = await updateTransactionStatus(sheetId, txId, 'lunas');
  assert(res.success === true,       'updateTransactionStatus returns success');
  assert(res.data?.updated === true, 'updateTransactionStatus found and updated the row');
  console.log(`  → Updated row #${res.data?.rowNumber} to 'lunas' (strikethrough applied)`);

  // Test with non-existent ID
  const notFound = await updateTransactionStatus(sheetId, 'non-existent-id-12345', 'lunas');
  assert(notFound.success === true,          'Non-existent ID: still returns success');
  assert(notFound.data?.updated === false,   'Non-existent ID: updated=false');
  assert(notFound.data?.rowNumber === null,  'Non-existent ID: rowNumber=null');
}

async function testGetTransactionsInRange(sheetId) {
  section('[SHEETS] getTransactionsInRange');

  const today = new Date();
  const start = new Date(today); start.setDate(start.getDate() - 7);
  const end   = new Date(today);

  console.log(`  → Fetching transactions from last 7 days`);
  const res = await getTransactionsInRange(sheetId, start, end);

  assert(res.success === true,    'getTransactionsInRange returns success');
  assert(Array.isArray(res.data), 'getTransactionsInRange returns an array');
  console.log(`  → Found ${res.data?.length} transactions in range`);

  // Each item should have expected shape
  if (res.data?.length > 0) {
    const first = res.data[0];
    assert(typeof first.id       === 'string', 'Transaction has string id');
    assert(first.tanggal instanceof Date,      'Transaction.tanggal is a Date');
    assert(typeof first.kategori === 'string', 'Transaction has string kategori');
    assert(typeof first.nominal  === 'number', 'Transaction.nominal is a number');
    assert(first.tanggal >= start,             'Transaction date is within start range');
    assert(first.tanggal <= end,               'Transaction date is within end range');
  } else {
    console.log('  ℹ️  No transactions found in range (sheet may be freshly created)');
  }

  // Future range should return empty
  const futureStart = new Date(2099, 0, 1);
  const futureEnd   = new Date(2099, 0, 31);
  const futureRes   = await getTransactionsInRange(sheetId, futureStart, futureEnd);
  assert(futureRes.success === true,          'Future range returns success');
  assertEqual(futureRes.data?.length, 0,      'Future range returns empty array');
}

async function testGetSheetSummary(sheetId) {
  section('[SHEETS] getSheetSummary');

  const res = await getSheetSummary(sheetId);

  assert(res.success === true, 'getSheetSummary returns success');

  const d = res.data;
  assert(typeof d?.totalTransaksi   === 'number', 'totalTransaksi is number');
  assert(typeof d?.totalPemasukan   === 'number', 'totalPemasukan is number');
  assert(typeof d?.totalPengeluaran === 'number', 'totalPengeluaran is number');
  assert(typeof d?.netCashflow      === 'number', 'netCashflow is number');
  assert(typeof d?.hutangAktif?.count === 'number',  'hutangAktif.count is number');
  assert(typeof d?.hutangAktif?.total === 'number',  'hutangAktif.total is number');
  assert(typeof d?.piutangAktif?.count === 'number', 'piutangAktif.count is number');

  assert(
    d?.netCashflow === d?.totalPemasukan - d?.totalPengeluaran,
    'netCashflow = pemasukan - pengeluaran'
  );
  assert(d?.totalPemasukan >= 0,   'totalPemasukan is non-negative');
  assert(d?.totalPengeluaran >= 0, 'totalPengeluaran is non-negative');

  console.log('  → Summary:');
  console.log(`     Total transaksi : ${d?.totalTransaksi}`);
  console.log(`     Pemasukan       : ${formatRupiah(d?.totalPemasukan)}`);
  console.log(`     Pengeluaran     : ${formatRupiah(d?.totalPengeluaran)}`);
  console.log(`     Net cashflow    : ${formatRupiah(d?.netCashflow)}`);
  console.log(`     Hutang aktif    : ${d?.hutangAktif?.count} item, total ${formatRupiah(d?.hutangAktif?.total)}`);
  console.log(`     Piutang aktif   : ${d?.piutangAktif?.count} item, total ${formatRupiah(d?.piutangAktif?.total)}`);
}

async function testMetadataCache(sheetId) {
  section('[SHEETS] Metadata cache');

  // First call — cold cache
  const start1 = Date.now();
  await getSheetSummary(sheetId);
  const cold = Date.now() - start1;

  // Second call — warm cache (should be significantly faster)
  const start2 = Date.now();
  await getSheetSummary(sheetId);
  const warm = Date.now() - start2;

  console.log(`  → Cold fetch: ${cold}ms | Warm fetch: ${warm}ms`);
  assert(warm < cold || warm < 200, 'Warm cache fetch is fast (< cold or < 200ms)');

  // After clear, should re-fetch
  clearMetadataCache(sheetId);
  const start3 = Date.now();
  await getSheetSummary(sheetId);
  const afterClear = Date.now() - start3;
  console.log(`  → After cache clear: ${afterClear}ms`);
  assert(afterClear > 0, 'After cache clear, re-fetches successfully');
}

// ─── [DRIVE] createUserSheet test ─────────────────────────────────────────────

async function testCreateUserSheet() {
  section('[DRIVE] createUserSheet');

  const templateId = process.env.GOOGLE_TEMPLATE_SHEET_ID;
  if (!templateId) {
    console.log('  ⚠️  GOOGLE_TEMPLATE_SHEET_ID not set — skipping Drive test');
    return null;
  }

  console.log('  → Creating sheet from template...');
  const res = await createUserSheet(
    'test-user-id-001',
    'Test Warung',
    '+6281234560001'
  );

  assert(res.success === true,                  'createUserSheet returns success');
  assert(typeof res.data?.sheetId === 'string', 'createUserSheet returns sheetId string');
  assert(res.data?.sheetUrl?.startsWith('https'), 'createUserSheet returns valid sheetUrl');

  console.log(`  → Created: ${res.data?.sheetUrl}`);
  console.log('  ⚠️  Remember to delete this test sheet from Google Drive!');

  return res.data?.sheetId;
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🧪 Wariskan — Google Sheets Test Suite');
  console.log(`   Date: ${new Date().toISOString()}\n`);

  // ── Unit tests (always run) ───────────────────────────────────────────────
  testFormatters();

  // ── Integration tests (require env vars) ─────────────────────────────────
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (!sheetId) {
    console.log('\n⚠️  GOOGLE_SHEET_ID not set — skipping Sheets integration tests');
    console.log('   Add it to .env pointing to a sheet the service account can edit.\n');
  } else {
    clearMetadataCache(); // start clean

    const { txId } = await testAppendTransaction(sheetId);
    await testGetTransactionsInRange(sheetId);
    await testUpdateTransactionStatus(sheetId, txId);
    await testGetSheetSummary(sheetId);
    await testMetadataCache(sheetId);
  }

  // ── Drive test (requires template ID) ────────────────────────────────────
  await testCreateUserSheet();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Result: ${passed} passed, ${failed} failed`);
  if (errors.length > 0) {
    console.log('\nFailed assertions:');
    errors.forEach((e) => console.log(`  ✗ ${e}`));
  }
  console.log('═'.repeat(50));

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('\n💥 Unexpected error:', err.message);
  if (err.isAuth) {
    console.error('   This is an auth error — check your service account config in .env');
  }
  process.exit(1);
});
