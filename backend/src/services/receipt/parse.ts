/**
 * Receipt text parsing.
 *
 * Pure, engine-agnostic heuristics that turn the raw OCR text of a receipt into
 * structured expense fields. Kept free of any OCR/HTTP dependency so it is fast
 * and exhaustively unit-testable (see tests/receipt-parse.test.ts). Tuned for
 * Polish fiscal receipts (comma decimals, "SUMA PLN", DD.MM.YYYY) as well as
 * common English ones.
 */

import { Currency } from '../../types/expense.types';
import { ReceiptExtraction } from './types';
import { autoCategorizeByKeywords } from '../categorize';

/**
 * Brand names we treat as the merchant/description when found anywhere in the
 * text. The header line of a receipt is often a legal entity ("JERONIMO
 * MARTINS POLSKA S.A."), so matching a recognizable brand yields a cleaner,
 * more categorizable description. Order matters only for display casing.
 */
const STORE_NAMES: string[] = [
  'Biedronka', 'Lidl', 'Kaufland', 'Carrefour', 'Auchan', 'Tesco', 'Żabka',
  'Dino', 'Netto', 'Aldi', 'Stokrotka', 'Rossmann', 'Hebe', 'Super-Pharm',
  'Orlen', 'BP', 'Shell', 'Lotos', 'Circle K', 'Amic',
  'Castorama', 'Leroy Merlin', 'OBI', 'Jysk', 'IKEA',
  'Media Markt', 'RTV Euro AGD', 'Empik', 'Allegro', 'Zalando',
  'McDonald', 'KFC', 'Burger King', 'Starbucks', 'Costa',
  'Netflix', 'Spotify', 'Play', 'Orange', 'Plus', 'T-Mobile',
];

/** Line prefixes that never denote a merchant name (metadata / legal boilerplate). */
const NON_MERCHANT_PREFIX = /^(nip|regon|krs|paragon|fiskalny|faktura|vat|tel\.?|ul\.|al\.|www\.|http|data|godz|kasa|kasjer|sprzeda)/i;

/**
 * Parse a single money-like token (e.g. "1 234,56", "1,234.56", "42,99",
 * "42.99") into a Number of major units. Handles both European (comma decimal,
 * dot/space thousands) and US (dot decimal, comma thousands) conventions by
 * treating the LAST separator as the decimal point.
 */
export function parseMoneyToken(raw: string): number | null {
  // Keep digits and separators only (strips currency symbols, letters, NBSP…).
  const s = raw.replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  let decimalIdx = -1;
  if (lastComma !== -1 || lastDot !== -1) {
    decimalIdx = Math.max(lastComma, lastDot);
    // A separator followed by 3 digits and nothing else is a thousands group,
    // not a decimal (e.g. "1.234" meaning one-thousand-two-hundred-thirty-four).
    const trailing = s.length - decimalIdx - 1;
    if (trailing === 3 && lastComma === -1 !== (lastDot === -1)) {
      // Only one kind of separator present and it groups thousands.
      decimalIdx = -1;
    }
  }

  let normalized: string;
  if (decimalIdx === -1) {
    normalized = s.replace(/[.,]/g, '');
  } else {
    const intPart = s.slice(0, decimalIdx).replace(/[.,]/g, '');
    const fracPart = s.slice(decimalIdx + 1).replace(/[.,]/g, '');
    normalized = `${intPart}.${fracPart}`;
  }

  const n = parseFloat(normalized);
  return isNaN(n) ? null : n;
}

// A single, self-contained money number: an integer part with optional
// space/dot/comma thousands GROUPS OF EXACTLY THREE digits, then at most one
// decimal part of 1–2 digits. Crucially, once the decimal part is consumed the
// number ends, so two space-separated amounts ("100,00 120,00") are matched as
// two tokens instead of being glued into one giant number.
const MONEY_TOKEN_RE = /\d{1,3}(?:[ .,]\d{3})*(?:[.,]\d{1,2})?/g;
// Same, but the decimal part (cents) is mandatory — used for the fallback that
// looks for the largest amount that actually has grosze/cents.
const MONEY_CENTS_RE = /\d{1,3}(?:[ .,]\d{3})*[.,]\d{2}(?!\d)/g;

/** Extract every money-like token from a line, in order of appearance. */
function moneyTokensInLine(line: string): number[] {
  const matches = line.match(MONEY_TOKEN_RE) || [];
  return matches
    .map(parseMoneyToken)
    .filter((n): n is number => n !== null && isFinite(n) && n > 0);
}

/**
 * Find the receipt total (in major units).
 *
 * Prefers amounts on lines labelled as the grand total, most-specific first
 * ("DO ZAPŁATY" / "SUMA PLN" > "SUMA"/"RAZEM"/"TOTAL"). Lines that look like
 * change/cash/card tendered are never treated as the total. Falls back to the
 * largest 2-decimal amount in the text, flagging low confidence via `labelled`.
 */
export function parseAmount(text: string): { amount: number | null; labelled: boolean } {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Lines that hold a tendered/change/tax amount — never the grand total.
  const EXCLUDE = /reszta|got[oó]wk|karta|zap[lł]acono|wp[lł]ata|zaliczka|\bptu\b|podatek|\bvat\b|rabat/i;
  const TOTAL_PRIORITY: RegExp[] = [
    /do\s*zap[lł]at|suma\s*pln|razem\s*pln|amount\s*due/i,
    /\bsuma\b|\brazem\b|\btotal\b|\bdo\s*zap/i,
  ];

  for (const priority of TOTAL_PRIORITY) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // A line carrying an explicit total label ("SUMA"/"RAZEM"/"DO ZAPŁATY")
      // IS the total — we don't apply EXCLUDE here (tender/change lines don't
      // carry those labels), so a total isn't dropped just because OCR merged a
      // tender word like "gotówka" onto the same line.
      if (!priority.test(line)) continue;

      // Total is usually the last number on the label line; if the line has no
      // number (label alone), look at the next line.
      let tokens = moneyTokensInLine(line);
      if (tokens.length === 0 && i + 1 < lines.length) {
        tokens = moneyTokensInLine(lines[i + 1]);
      }
      if (tokens.length > 0) {
        return { amount: tokens[tokens.length - 1], labelled: true };
      }
    }
  }

  // Fallback: largest amount that has cents (two decimals) — usually the total,
  // but could be the cash tendered, so callers should warn on !labelled.
  let best: number | null = null;
  for (const line of lines) {
    if (EXCLUDE.test(line)) continue;
    for (const raw of line.match(MONEY_CENTS_RE) || []) {
      const n = parseMoneyToken(raw);
      if (n !== null && n > 0 && (best === null || n > best)) best = n;
    }
  }
  return { amount: best, labelled: false };
}

/** True when (y, m, d) form a real, plausibly-recent calendar date. The year
 *  bound rejects nonsense like the "327" pulled out of a tax ID. */
function isRealDate(y: number, m: number, d: number): boolean {
  if (y < 2000 || y > 2099) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Find the first plausible date and return it as ISO `YYYY-MM-DD`.
 * Recognizes ISO (2024-01-15) and day-first D.M.Y / D/M/Y / D-M-Y with 2- or
 * 4-digit years. Returns null when no valid date is present.
 */
export function parseDate(text: string): string | null {
  // Skip tax-ID / account / phone lines: their digit groups (e.g. a NIP like
  // "526-10-05-054") can otherwise be misread as a date.
  const SKIP = /\b(nip|regon|krs|iban|konto|tel|fax)\b/i;
  const lines = text.split(/\r?\n/).filter(l => !SKIP.test(l));

  // ISO first — unambiguous — across all eligible lines.
  for (const line of lines) {
    const iso = line.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (iso) {
      const [, y, m, d] = iso.map(Number);
      if (isRealDate(y, m, d)) return `${y}-${pad(m)}-${pad(d)}`;
    }
  }

  // Then numeric D.M.Y / D/M/Y / D-M-Y. Prefer day-first (the dominant European
  // format); fall back to month-first (US) when that's the only valid reading,
  // e.g. "01/15/2024".
  for (const line of lines) {
    for (const match of line.matchAll(/\b(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})\b/g)) {
      const a = Number(match[1]);
      const b = Number(match[2]);
      let y = Number(match[3]);
      if (y < 100) y += 2000; // 2-digit year → 20xx
      if (isRealDate(y, b, a)) return `${y}-${pad(b)}-${pad(a)}`; // a=day, b=month
      if (isRealDate(y, a, b)) return `${y}-${pad(a)}-${pad(b)}`; // a=month, b=day (US)
    }
  }

  return null;
}

/**
 * Guess the merchant / description. Prefers a recognizable brand found anywhere
 * in the text; otherwise falls back to the first "name-like" line near the top.
 */
export function parseMerchant(text: string): string | null {
  const lower = text.toLowerCase();
  for (const store of STORE_NAMES) {
    if (lower.includes(store.toLowerCase())) return store;
  }

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 8)) {
    const letters = (line.match(/\p{L}/gu) || []).length;
    if (letters < 3) continue;                 // skip numeric / separator lines
    if (NON_MERCHANT_PREFIX.test(line)) continue;
    if (/^\d/.test(line) && letters < 5) continue;
    return line.replace(/\s+/g, ' ').slice(0, 60).trim();
  }

  return null;
}

/** Guess the currency from symbols/codes present in the text. */
export function guessCurrency(text: string): { currency: Currency | null; unsupported: string | null } {
  // Note: `\b` is ASCII-only, so it doesn't fire around "ł" — match "zł"
  // literally instead of relying on a word boundary after it.
  if (/\bpln\b|zł|\bzl\b|z[lł]ot/i.test(text)) return { currency: 'PLN', unsupported: null };
  if (/\busd\b|\$/.test(text)) return { currency: 'USD', unsupported: null };
  if (/₿|\bbtc\b/i.test(text)) return { currency: 'BTC', unsupported: null };
  if (/€|\beur\b/i.test(text)) return { currency: null, unsupported: 'EUR' };
  if (/£|\bgbp\b/i.test(text)) return { currency: null, unsupported: 'GBP' };
  return { currency: null, unsupported: null };
}

/**
 * Turn raw OCR text into a full ReceiptExtraction: amount, date, merchant,
 * currency, a keyword-based category, and human-readable warnings for anything
 * the user should double-check.
 */
export function parseReceiptText(rawText: string, confidence: number): ReceiptExtraction {
  const { amount, labelled } = parseAmount(rawText);
  const date = parseDate(rawText);
  const merchant = parseMerchant(rawText);
  const { currency, unsupported } = guessCurrency(rawText);
  const category = autoCategorizeByKeywords(`${merchant ?? ''} ${rawText}`);

  const warnings: string[] = [];
  if (amount === null) warnings.push('Could not detect the total amount — please enter it manually.');
  else if (!labelled) warnings.push('The total was guessed (no "SUMA/TOTAL" label found) — please verify the amount.');
  if (date === null) warnings.push('Could not detect the date — defaulting to today.');
  if (merchant === null) warnings.push('Could not detect the store name — please add a description.');
  if (unsupported) warnings.push(`Detected ${unsupported}, which isn't a supported currency — pick one manually.`);
  if (confidence < 0.55) warnings.push('Low OCR confidence — the photo may be blurry or poorly lit.');

  return { amount, date, merchant, currency, category, rawText, confidence, warnings };
}
