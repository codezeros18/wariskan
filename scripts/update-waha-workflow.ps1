$path = 'n8n-workflows\wariskan-base-workflow.json'
$wf = Get-Content -Raw $path | ConvertFrom-Json

$saveSheetsCode = @'
const data = $input.first().json;
const tx = data.savedTransaction || data.saveResult || null;

if (data.skipTransactionSave || data.saveFailed || data.duplicateTransaction || !tx?.id) {
  return [{ json: { ...data, sheetSkipped: true, sheetSkipReason: 'no_new_saved_transaction' } }];
}

const sheetId = data.user?.sheet_id || data.user?.sheetId || null;
if (!sheetId) {
  return [{ json: { ...data, sheetSkipped: true, sheetSkipReason: 'user_has_no_sheet_id' } }];
}

try {
  const baseUrl = ($env.HELPER_API_URL || 'http://localhost:3001').replace(/\/$/, '');
  const apiKey = $env.HELPER_API_KEY || 'dev';
  const result = await this.helpers.httpRequest({
    method: 'POST',
    url: `${baseUrl}/api/sheets/append`,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: {
      sheetId,
      transaction: {
        id: tx.id,
        tanggal: tx.tanggal,
        kategori: tx.category,
        nominal: tx.nominal,
        pihak: tx.pihak,
        item: tx.item,
        status: tx.status,
        jatuh_tempo: tx.jatuh_tempo,
      },
    },
    json: true,
    ignoreHttpStatusErrors: true,
  });

  return [{ json: { ...data, sheetResult: result, sheetSaved: result?.success === true, sheetSkipped: result?.skipped === true, sheetError: result?.error || null } }];
} catch (err) {
  return [{ json: { ...data, sheetSaved: false, sheetError: err.message } }];
}
'@

$buildReplyCode = @'
const input = $input.first().json;
let data = input;
try { data = { ...$('Validate JSON').first().json, ...input }; } catch (_) {}

const OWNER_JID = '6281284818862@c.us';
const money = (value) => `Rp ${Number(value ?? 0).toLocaleString('id-ID')}`;
const line = '------------------------';

function examples() {
  return [
    'Contoh yang gampang dibaca:',
    '- jual ayam 50rb',
    '- beli beras 125.000',
    '- hutang ke Bu Sari 1,5 juta untuk stok',
    '- piutang Pak Budi 75rb jatuh tempo Jumat',
  ].join('\n');
}

function failReply(reason) {
  return `Belum bisa saya catat.\n${reason}\n\nTolong kirim ulang dengan format lebih jelas ya.\n\n${examples()}`;
}

if (data.imageDownloadFailed) {
  return [{ json: { ...data, replyText: failReply('Fotonya belum berhasil saya unduh dari WhatsApp.'), to: OWNER_JID } }];
}

if (data.audioDownloadFailed || data.audioTranscriptionFailed) {
  const detail = data.audioTranscriptionError || data.audioDownloadReason || 'audio belum terbaca';
  return [{ json: { ...data, replyText: failReply(`Voice note belum berhasil saya transkrip. Detail: ${detail}`), to: OWNER_JID } }];
}

if (data.aiVisionFailed) {
  const detail = data.aiVisionError || 'gambar belum terbaca AI';
  return [{ json: { ...data, replyText: failReply(`Foto sudah masuk, tapi isi struk belum kebaca. Detail: ${detail}`), to: OWNER_JID } }];
}

if (data.commandResult?.type === 'query') {
  const s = data.commandResult.summary || {};
  let replyText = `Ringkasan Wariskan\n\nHari ini\nMasuk: ${money(s.todayIn)} | Keluar: ${money(s.todayOut)}\nSisa: ${money(s.todayNet)}\n\nBulan ini\nMasuk: ${money(s.monthIn)} | Keluar: ${money(s.monthOut)}\nSaldo kas estimasi: ${money(s.monthNet)}\nHutang aktif: ${money(s.hutang)} | Piutang aktif: ${money(s.piutang)}`;
  const debts = data.commandResult.debtRows || [];
  if (debts.length) {
    replyText += '\n\nHutang/piutang aktif:';
    for (const row of debts.slice(0, 5)) {
      replyText += `\n- ${row.category}: ${money(row.nominal)}${row.pihak ? ` (${row.pihak})` : ''}${row.item ? ` - ${row.item}` : ''}`;
    }
  }
  return [{ json: { ...data, replyText, to: OWNER_JID } }];
}

if (data.commandResult?.type === 'delete_last') {
  const tx = data.commandResult.transaction;
  const replyText = data.commandResult.notFound
    ? 'Belum ada transaksi aktif yang bisa dihapus.'
    : `Transaksi terakhir sudah dibatalkan.\n${tx.category}: ${money(tx.nominal)}${tx.item ? ` - ${tx.item}` : ''}`;
  return [{ json: { ...data, replyText, to: OWNER_JID } }];
}

if (data.commandResult?.type === 'update_last') {
  const tx = data.commandResult.transaction;
  let replyText = 'Saya belum menangkap koreksinya. Contoh: koreksi nominal 52000';
  if (data.commandResult.notFound) replyText = 'Belum ada transaksi aktif yang bisa dikoreksi.';
  else if (tx) replyText = `Transaksi terakhir sudah dikoreksi.\n${tx.category}: ${money(tx.nominal)}${tx.item ? ` - ${tx.item}` : ''}${tx.pihak ? `\nPihak: ${tx.pihak}` : ''}`;
  return [{ json: { ...data, replyText, to: OWNER_JID } }];
}

if (data.saveFailed) {
  const ext = data.extractedData ?? {};
  const detail = data.saveError ? `\nDetail teknis: ${String(data.saveError).slice(0, 220)}` : '';
  return [{ json: { ...data, replyText: `Transaksi belum berhasil disimpan.\nKategori terbaca: ${ext.category || 'unclear'}\nNominal: ${money(ext.nominal || 0)}${detail}\n\nData belum aman masuk database, jadi tolong cek Supabase/env sebelum demo.`, to: OWNER_JID } }];
}

if (data.duplicateTransaction) {
  const tx = data.savedTransaction || {};
  return [{ json: { ...data, replyText: `Pesan ini sudah pernah saya catat, jadi tidak saya duplikat.\n${tx.category || 'Transaksi'}: ${money(tx.nominal)}`, to: OWNER_JID } }];
}

const tx = data.savedTransaction || data.saveResult || {};
const ext = data.extractedData ?? {};
const category = tx.category || ext.category || 'unclear';
const nominal = Number(tx.nominal ?? ext.nominal ?? 0) || 0;
const labels = {
  pemasukan: 'Pemasukan',
  pengeluaran: 'Pengeluaran',
  hutang: 'Hutang',
  piutang: 'Piutang',
  bayar_hutang: 'Bayar hutang',
  terima_piutang: 'Terima piutang',
  unclear: 'Tidak jelas',
};

let summary = null;
try {
  const BASE = $env.SUPABASE_URL;
  const KEY = $env.SUPABASE_SERVICE_KEY;
  if (BASE && KEY && data.user?.id) {
    const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
    const startMonth = new Date();
    startMonth.setDate(1);
    const monthDate = startMonth.toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const rows = await this.helpers.httpRequest({
      method: 'GET',
      url: `${BASE}/rest/v1/transactions?user_id=eq.${data.user.id}&tanggal=gte.${monthDate}&status=eq.aktif&select=id,category,nominal,tanggal,status`,
      headers,
      json: true,
      ignoreHttpStatusErrors: true,
    });
    if (Array.isArray(rows)) {
      const summaryRows = [...rows];
      if (tx?.id && tx.status !== 'dibatalkan' && !summaryRows.some((row) => row.id === tx.id)) {
        summaryRows.push({ id: tx.id, category, nominal, tanggal: tx.tanggal || today, status: tx.status || 'aktif' });
      }
      summary = summaryRows.reduce((acc, row) => {
        const amount = Number(row.nominal || 0);
        const isToday = row.tanggal === today;
        if (row.category === 'pemasukan' || row.category === 'terima_piutang') { acc.monthIn += amount; if (isToday) acc.todayIn += amount; }
        if (row.category === 'pengeluaran' || row.category === 'bayar_hutang') { acc.monthOut += amount; if (isToday) acc.todayOut += amount; }
        if (row.category === 'hutang') acc.hutang += amount;
        if (row.category === 'piutang') acc.piutang += amount;
        return acc;
      }, { monthIn: 0, monthOut: 0, todayIn: 0, todayOut: 0, hutang: 0, piutang: 0 });
      summary.monthNet = summary.monthIn - summary.monthOut;
      summary.todayNet = summary.todayIn - summary.todayOut;
    }
  }
} catch (err) {
  console.log(`[Build Reply Message] summary skipped: ${err.message}`);
}

const isWeak = category === 'unclear' || nominal <= 0 || data._usedFallbackExtraction || ext.confidence === 'low';
let replyText = isWeak
  ? `[Perlu dicek] Saya belum yakin ini transaksi yang benar.\n`
  : `[Tercatat] ${labels[category] ?? category}\n`;

replyText += `Nominal: ${money(nominal)}\n`;
if (tx.item || ext.item) replyText += `Item: ${tx.item || ext.item}\n`;
if (tx.pihak || ext.pihak) replyText += `Pihak: ${tx.pihak || ext.pihak}\n`;
if (data.transcript) replyText += `\nTranscript: "${String(data.transcript).slice(0, 160)}"\n`;

if (data.sheetSaved) replyText += `\nGoogle Sheet: tersimpan`;
else if (data.sheetSkipped) replyText += `\nGoogle Sheet: belum aktif untuk user ini`;
else if (data.sheetError) replyText += `\nGoogle Sheet: belum tersimpan (${String(data.sheetError).slice(0, 80)})`;

if (summary) {
  replyText += `\n\n${line}\nRingkasan hari ini\nMasuk: ${money(summary.todayIn)} | Keluar: ${money(summary.todayOut)}\nSisa hari ini: ${money(summary.todayNet)}\n\nBulan ini\nMasuk: ${money(summary.monthIn)} | Keluar: ${money(summary.monthOut)}\nSaldo kas estimasi: ${money(summary.monthNet)}`;
  if (summary.hutang || summary.piutang) replyText += `\nHutang: ${money(summary.hutang)} | Piutang: ${money(summary.piutang)}`;
}

if (isWeak) {
  replyText += `\n\nTolong koreksi atau kirim ulang ya.\n${examples()}`;
} else {
  replyText += `\n\nKalau salah, balas: koreksi nominal 52000 / hapus terakhir / ringkasan`;
}

return [{ json: { ...data, replyText, to: OWNER_JID, summary } }];
'@

$saveSheets = $wf.nodes | Where-Object { $_.name -eq 'Save to Google Sheets' }
$saveSheets.type = 'n8n-nodes-base.code'
$saveSheets.typeVersion = 2
$saveSheets.disabled = $false
$saveSheets.parameters = [pscustomobject]@{ jsCode = $saveSheetsCode }
$saveSheets.notes = 'Calls local helpers/sheetsApiServer.js. Safe: returns original item even if Sheets is skipped or fails.'

$buildReply = $wf.nodes | Where-Object { $_.name -eq 'Build Reply Message' }
$buildReply.parameters.jsCode = $buildReplyCode

$saveToSheetsConnection = New-Object System.Collections.ArrayList
[void]$saveToSheetsConnection.Add(@([pscustomobject]@{ node = 'Save to Google Sheets'; type = 'main'; index = 0 }))
$buildReplyConnection = New-Object System.Collections.ArrayList
[void]$buildReplyConnection.Add(@([pscustomobject]@{ node = 'Build Reply Message'; type = 'main'; index = 0 }))

$wf.connections.'Save to Supabase'.main = $saveToSheetsConnection
$wf.connections.'Save to Google Sheets'.main = $buildReplyConnection

$json = $wf | ConvertTo-Json -Depth 100
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Resolve-Path $path), $json, $utf8NoBom)
