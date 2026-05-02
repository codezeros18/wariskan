/**
 * Wariskan — Indonesian locale formatters.
 * Imported by googleSheetsHelper.js and any n8n Code node that needs formatting.
 */

const BULAN_SINGKAT  = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
const BULAN_LENGKAP  = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const HARI_LENGKAP   = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];

// Fast lookup for parseTanggalIndonesia
const BULAN_SINGKAT_IDX = Object.fromEntries(BULAN_SINGKAT.map((m, i) => [m, i]));

/**
 * formatRupiah(1250000) → "Rp 1.250.000"
 * Handles null, undefined, NaN, and string numbers.
 */
export function formatRupiah(amount) {
  const n = Number(amount);
  if (amount == null || isNaN(n)) return 'Rp 0';
  return 'Rp ' + Math.abs(Math.round(n)).toLocaleString('id-ID');
}

/**
 * formatTanggalIndonesia(new Date('2026-04-28')) → "28 Apr 2026"
 * Accepts Date object, ISO string, or any value parseable by new Date().
 */
export function formatTanggalIndonesia(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  const day   = String(d.getDate()).padStart(2, '0');
  const month = BULAN_SINGKAT[d.getMonth()];
  const year  = d.getFullYear();
  return `${day} ${month} ${year}`;
}

/**
 * formatTanggalLengkap(new Date('2026-04-28')) → "Selasa, 28 April 2026"
 */
export function formatTanggalLengkap(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  const hari  = HARI_LENGKAP[d.getDay()];
  const day   = d.getDate();
  const month = BULAN_LENGKAP[d.getMonth()];
  const year  = d.getFullYear();
  return `${hari}, ${day} ${month} ${year}`;
}

/**
 * parseTanggalIndonesia("28 Apr 2026") → Date(2026, 3, 28)
 * Returns null for unparseable input.
 */
export function parseTanggalIndonesia(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.trim().split(/\s+/);
  if (parts.length !== 3) return null;
  const [day, monthStr, year] = parts;
  const month = BULAN_SINGKAT_IDX[monthStr];
  if (month === undefined) return null;
  const d = new Date(parseInt(year, 10), month, parseInt(day, 10));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * formatNominal — alias for use in n8n Code nodes without import overhead.
 * formatNominal(25000) → "Rp 25.000"
 */
export const formatNominal = formatRupiah;
