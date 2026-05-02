/**
 * Wariskan — Teks pesan keluar (Bahasa Indonesia)
 *
 * File ini berisi SEMUA teks yang diterima pengguna.
 * Tim non-teknis bisa langsung edit teks di sini tanpa menyentuh logika.
 *
 * PANDUAN EDIT:
 *   • Jangan ubah nama fungsi/variabel yang diekspor (export ...)
 *   • Emoji ✅ 📅 💰 bisa diganti, tapi jangan hapus variabel {placeholder}
 *   • WhatsApp markdown: *tebal*, _miring_, ~coret~
 */

import { formatRupiah, formatTanggalIndonesia } from './formatters.js';

// ─── Category labels & emoji ─────────────────────────────────────────────────

export const KATEGORI_LABEL = {
  pemasukan:      'Pemasukan',
  pengeluaran:    'Pengeluaran',
  hutang:         'Hutang',
  piutang:        'Piutang',
  bayar_hutang:   'Bayar Hutang',
  terima_piutang: 'Terima Piutang',
  unclear:        'Perlu Konfirmasi',
};

export const KATEGORI_EMOJI = {
  pemasukan:      '✅',
  pengeluaran:    '🛒',
  hutang:         '🔴',
  piutang:        '🔵',
  bayar_hutang:   '💸',
  terima_piutang: '💰',
  unclear:        '❓',
};

// ─── Status labels & emoji ────────────────────────────────────────────────────

export const STATUS_LABEL = {
  aktif:                'Aktif',
  lunas:                'Lunas ✅',
  dibatalkan:           'Dibatalkan',
  pending_confirmation: 'Menunggu Konfirmasi',
};

export const STATUS_EMOJI = {
  aktif:                '🔵',
  lunas:                '✅',
  dibatalkan:           '❌',
  pending_confirmation: '⏳',
};

// ─── Error messages ───────────────────────────────────────────────────────────
// Edit teks di sini untuk mengubah pesan error yang diterima pengguna.

export const ERROR = {
  cant_understand:
    `Maaf Bapak/Ibu, saya kurang mengerti pesan tadi 🙏\n\n` +
    `Coba kirim seperti contoh ini:\n` +
    `• _"Jualan hari ini 350rb"_\n` +
    `• _"Beli gula 25rb"_\n` +
    `• _"Bu Sari hutang beras 75rb"_\n\n` +
    `Atau kirim foto struk/nota 📸`,

  try_again:
    `Mohon maaf, ada kendala teknis sesaat 😔\n` +
    `Silakan coba kirim pesan lagi ya Bapak/Ibu.`,

  system_busy:
    `Sistem sedang sibuk sebentar 🕐\n` +
    `Pesan Bapak/Ibu sudah kami terima dan sedang antri diproses.\n` +
    `Harap tunggu sebentar ya.`,

  unsupported_message_type:
    `Maaf Bapak/Ibu, saya belum bisa membaca jenis pesan ini 🙏\n\n` +
    `Silakan kirim:\n` +
    `📝 Pesan teks\n` +
    `🎤 Pesan suara\n` +
    `📷 Foto struk atau nota`,
};

// ─── Transaction confirmation ─────────────────────────────────────────────────

/**
 * Pesan konfirmasi setelah transaksi berhasil dicatat.
 *
 * @param {{
 *   tanggal:     Date|string,
 *   kategori:    string,
 *   nominal:     number,
 *   pihak:       string|null,
 *   item:        string|null,
 *   status:      string,
 *   jatuh_tempo: Date|string|null
 * }} transaction
 */
export function buildTransactionConfirmation(transaction) {
  const { tanggal, kategori, nominal, pihak, item, status, jatuh_tempo } = transaction;

  const katLabel  = KATEGORI_LABEL[kategori] ?? kategori;
  const katEmoji  = KATEGORI_EMOJI[kategori] ?? '📝';
  const statEmoji = STATUS_EMOJI[status]     ?? '🔵';
  const statLabel = STATUS_LABEL[status]     ?? status;

  const lines = [
    `✅ *Sudah saya catat:*\n`,
    `📅 ${formatTanggalIndonesia(tanggal)}`,
    `🏷️ ${katEmoji} ${katLabel}`,
    `💰 ${formatRupiah(nominal)}`,
    `👤 ${pihak || '—'}`,
    `📝 ${item  || '—'}`,
    `📌 ${statEmoji} ${statLabel}`,
  ];

  if (jatuh_tempo) {
    lines.push(`🗓️ Jatuh tempo: *${formatTanggalIndonesia(jatuh_tempo)}*`);
  }

  return lines.join('\n');
}

/**
 * Pesan konfirmasi saat AI tidak yakin — minta konfirmasi dari user.
 *
 * @param {string} rawInput   Pesan asli dari user
 * @param {number} nominal    Nominal yang berhasil diekstrak (bisa 0)
 */
export function buildClarificationRequest(rawInput, nominal = 0) {
  const nominalText = nominal > 0 ? ` Rp ${nominal.toLocaleString('id-ID')}` : '';
  return (
    `🤔 Saya kurang yakin dengan pesan ini:\n` +
    `_"${rawInput}"_\n\n` +
    `${nominalText ? `Nominalnya${nominalText} — ini ` : 'Ini '}` +
    `pemasukan atau pengeluaran?\n\n` +
    `Balas:\n` +
    `• _"pemasukan${nominalText}"_\n` +
    `• _"pengeluaran${nominalText}"_\n` +
    `• Atau jelaskan ulang ya Bapak/Ibu 🙏`
  );
}

// ─── Debt / credit reminders ──────────────────────────────────────────────────

const _REMINDER_HEADER = {
  h_minus_1: `🔔 *Pengingat Besok*`,
  on_due:    `⏰ *Pengingat Hari Ini*`,
  overdue:   `📌 *Sudah Melewati Jatuh Tempo*`,
};

const _REMINDER_CLOSING = {
  h_minus_1: `Semoga lancar ya Bapak/Ibu! 🙏`,
  on_due:    `Jangan lupa hari ini ya Bapak/Ibu 🙏`,
  overdue:   (aksi, nominal) =>
    `Bila sudah selesai, cukup balas:\n_"${aksi} ${formatRupiah(nominal)}"_\n\nTerima kasih 🙏`,
};

/**
 * Pesan reminder hutang atau piutang.
 *
 * @param {{
 *   pihak:       string,
 *   nominal:     number,
 *   jatuh_tempo: Date|string,
 *   item:        string|null,
 *   category:    'hutang'|'piutang'
 * }} debt
 * @param {'h_minus_1'|'on_due'|'overdue'} urgency
 * @param {number} [daysOverdue]  Hanya dipakai untuk urgency='overdue'
 */
export function buildDebtReminder(debt, urgency, daysOverdue = 0) {
  const { pihak, nominal, jatuh_tempo, item, category } = debt;
  const isHutang = category === 'hutang';

  const subjek     = isHutang ? `Hutang ke *${pihak}*`  : `Piutang dari *${pihak}*`;
  const aksiBalas  = isHutang ? `sudah bayar ke ${pihak}` : `sudah terima dari ${pihak}`;
  const debtEmoji  = isHutang ? '💸' : '💰';
  const tglFmt     = formatTanggalIndonesia(jatuh_tempo);

  const lines = [
    _REMINDER_HEADER[urgency],
    '',
  ];

  if (urgency === 'overdue') {
    lines.push(`Sudah *${daysOverdue} hari* lewat dari jatuh tempo _(${tglFmt})_:\n`);
  } else if (urgency === 'h_minus_1') {
    lines.push(`Besok _(${tglFmt})_ adalah jatuh tempo:\n`);
  } else {
    lines.push(`Hari ini _(${tglFmt})_ adalah jatuh tempo:\n`);
  }

  lines.push(`${debtEmoji} ${subjek}`);
  lines.push(`💰 ${formatRupiah(nominal)}`);
  if (item) lines.push(`📝 ${item}`);
  lines.push('');

  const closing = typeof _REMINDER_CLOSING[urgency] === 'function'
    ? _REMINDER_CLOSING[urgency](aksiBalas, nominal)
    : _REMINDER_CLOSING[urgency];

  lines.push(closing);
  return lines.join('\n');
}

// ─── Weekly report ────────────────────────────────────────────────────────────

/**
 * Laporan mingguan lengkap dalam satu pesan WhatsApp.
 *
 * @param {{
 *   period_start:    Date|string,
 *   period_end:      Date|string,
 *   total_pemasukan:    number,
 *   total_pengeluaran:  number,
 *   net_cashflow:       number,
 *   hutang_aktif:    { count: number, total: number, items?: Array },
 *   piutang_aktif:   { count: number, total: number, items?: Array }
 * }} reportData
 */
export function buildWeeklyReport(reportData) {
  const {
    period_start,
    period_end,
    total_pemasukan   = 0,
    total_pengeluaran = 0,
    net_cashflow      = 0,
    hutang_aktif      = { count: 0, total: 0, items: [] },
    piutang_aktif     = { count: 0, total: 0, items: [] },
  } = reportData;

  const SEP    = `\n${'─'.repeat(30)}\n`;
  const surplus = net_cashflow >= 0;

  const lines = [
    `📊 *Laporan Mingguan Wariskan*`,
    `🗓️ _${formatTanggalIndonesia(period_start)} – ${formatTanggalIndonesia(period_end)}_`,
    SEP.trimStart(),
    `💰 *RINGKASAN KEUANGAN*\n`,
    `✅ Pemasukan    : *${formatRupiah(total_pemasukan)}*`,
    `🛒 Pengeluaran  : *${formatRupiah(total_pengeluaran)}*`,
    `${surplus ? '📈' : '📉'} Net Cashflow  : *${formatRupiah(Math.abs(net_cashflow))}* _${surplus ? '(surplus)' : '(defisit)'}_`,
  ];

  // Hutang aktif section
  if (hutang_aktif.count > 0) {
    lines.push(SEP);
    lines.push(`🔴 *HUTANG AKTIF (${hutang_aktif.count} item)*\n`);
    (hutang_aktif.items ?? []).slice(0, 5).forEach((d) => {
      let row = `• ${d.pihak}: ${formatRupiah(d.nominal)}`;
      if (d.jatuh_tempo) row += ` _(jt: ${formatTanggalIndonesia(d.jatuh_tempo)})_`;
      lines.push(row);
    });
    if (hutang_aktif.count > 5) {
      lines.push(`_...dan ${hutang_aktif.count - 5} lainnya_`);
    }
    lines.push(`\nTotal: *${formatRupiah(hutang_aktif.total)}*`);
  }

  // Piutang aktif section
  if (piutang_aktif.count > 0) {
    lines.push(SEP);
    lines.push(`🔵 *PIUTANG AKTIF (${piutang_aktif.count} item)*\n`);
    (piutang_aktif.items ?? []).slice(0, 5).forEach((d) => {
      let row = `• ${d.pihak}: ${formatRupiah(d.nominal)}`;
      if (d.jatuh_tempo) row += ` _(jt: ${formatTanggalIndonesia(d.jatuh_tempo)})_`;
      lines.push(row);
    });
    if (piutang_aktif.count > 5) {
      lines.push(`_...dan ${piutang_aktif.count - 5} lainnya_`);
    }
    lines.push(`\nTotal: *${formatRupiah(piutang_aktif.total)}*`);
  }

  // Motivational closing
  lines.push(SEP);
  if (surplus && net_cashflow > 0) {
    lines.push(`💡 Alhamdulillah, minggu ini *surplus ${formatRupiah(net_cashflow)}!*\nSemangat terus Bapak/Ibu 💪`);
  } else if (net_cashflow === 0) {
    lines.push(`💡 Minggu ini pemasukan dan pengeluaran seimbang.\nSemoga minggu depan makin meningkat! 💪`);
  } else {
    lines.push(`💡 Minggu ini pengeluaran sedikit lebih besar.\nMari cermati pengeluaran minggu depan ya 🙏`);
  }

  lines.push(`\nTerima kasih sudah pakai Wariskan! 🙏`);
  lines.push(`_Balas pesan ini untuk catat transaksi_`);

  return lines.join('\n');
}

// ─── Onboarding welcome ───────────────────────────────────────────────────────

/**
 * Pesan sambutan untuk pengguna baru.
 *
 * @param {{ display_name?: string, sheet_url?: string }} userData
 */
export function buildOnboardingWelcome(userData) {
  const { display_name, sheet_url } = userData ?? {};
  const sapa = display_name ? `Halo *${display_name}*!` : `Halo Bapak/Ibu!`;

  const lines = [
    `${sapa} Selamat datang di *Wariskan* 🎉`,
    ``,
    `Saya adalah asisten keuangan digital warung Bapak/Ibu.`,
    `Cukup kirim pesan ke sini untuk mencatat:`,
    ``,
    `📝 Pemasukan & Pengeluaran`,
    `💸 Hutang & Piutang`,
    `📸 Foto struk atau nota`,
    `🎤 Pesan suara`,
    ``,
    `*Contoh pesan:*`,
    `• _"Jualan 350rb"_`,
    `• _"Beli gula 25rb di Pak Ahmad"_`,
    `• _"Bu Sari hutang beras 5kg = 75rb, bayar Senin"_`,
    `• Atau langsung foto stuknya!`,
  ];

  if (sheet_url) {
    lines.push(``);
    lines.push(`📊 *Buku digital Bapak/Ibu sudah siap:*`);
    lines.push(sheet_url);
    lines.push(`_(Bisa dibuka di HP atau laptop, bisa dibagikan ke keluarga)_`);
  }

  lines.push(``);
  lines.push(`Mulai catat sekarang ya Bapak/Ibu! 💪`);

  return lines.join('\n');
}

// ─── Misc system messages ─────────────────────────────────────────────────────

/** Pesan saat status hutang/piutang berhasil diupdate menjadi lunas. */
export function buildLunasConfirmation(pihak, nominal, category) {
  const isHutang = category === 'hutang' || category === 'bayar_hutang';
  return (
    `✅ *Tercatat lunas!*\n\n` +
    `${isHutang ? '💸' : '💰'} ${isHutang ? `Hutang ke *${pihak}*` : `Piutang dari *${pihak}*`}\n` +
    `💰 ${formatRupiah(nominal)}\n\n` +
    `Semoga usahanya makin lancar Bapak/Ibu 🙏`
  );
}

/** Pesan balasan saat user mengirim "saldo" atau "ringkasan". */
export function buildQuickSummary({ totalPemasukan, totalPengeluaran, netCashflow, hutangAktif, piutangAktif }) {
  return (
    `📊 *Ringkasan Hari Ini*\n\n` +
    `✅ Pemasukan   : ${formatRupiah(totalPemasukan)}\n` +
    `🛒 Pengeluaran : ${formatRupiah(totalPengeluaran)}\n` +
    `📈 Net          : ${formatRupiah(Math.abs(netCashflow))} ${netCashflow >= 0 ? '(surplus)' : '(defisit)'}\n\n` +
    `🔴 Hutang aktif  : ${hutangAktif.count} item (${formatRupiah(hutangAktif.total)})\n` +
    `🔵 Piutang aktif : ${piutangAktif.count} item (${formatRupiah(piutangAktif.total)})`
  );
}
