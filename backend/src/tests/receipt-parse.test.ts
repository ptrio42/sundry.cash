/**
 * Unit tests for receipt text parsing heuristics.
 * These run without Tesseract — they feed raw OCR text straight to the parser.
 */

import {
  parseMoneyToken,
  parseAmount,
  parseDate,
  parseMerchant,
  guessCurrency,
  parseReceiptText,
} from '../services/receipt/parse';

// A realistic Polish grocery receipt (as OCR would roughly emit it).
const BIEDRONKA = `Biedronka
JERONIMO MARTINS POLSKA S.A.
ul. Przykladowa 1, 00-001 Warszawa
NIP 779-10-11-327
2024-01-15  14:32
PARAGON FISKALNY
Mleko 3,2%           2 x 3,49     6,98
Chleb razowy         1 x 4,20     4,20
SUMA PLN                         11,18
GOTOWKA                          20,00
RESZTA                            8,82`;

const ORLEN = `ORLEN
Stacja Paliw nr 123
15.01.2024
Pb95   40,00 L
DO ZAPLATY        250,00 PLN`;

const STARBUCKS = `Starbucks Coffee
123 Main St
01/15/2024
Latte            $4.50
Muffin           $3.25
TOTAL            $7.75`;

describe('parseMoneyToken', () => {
  it('parses comma-decimal (European) amounts', () => {
    expect(parseMoneyToken('11,18')).toBe(11.18);
    expect(parseMoneyToken('250,00')).toBe(250);
  });

  it('parses dot-decimal (US) amounts', () => {
    expect(parseMoneyToken('7.75')).toBe(7.75);
  });

  it('handles thousands separators with either convention', () => {
    expect(parseMoneyToken('1 234,56')).toBe(1234.56);
    expect(parseMoneyToken('1.234,56')).toBe(1234.56);
    expect(parseMoneyToken('1,234.56')).toBe(1234.56);
  });

  it('treats a lone 3-digit group as thousands, not decimals', () => {
    expect(parseMoneyToken('1.234')).toBe(1234);
    expect(parseMoneyToken('2,500')).toBe(2500);
  });

  it('strips currency symbols and returns null for non-numbers', () => {
    expect(parseMoneyToken('$4.50')).toBe(4.5);
    expect(parseMoneyToken('zł')).toBeNull();
  });
});

describe('parseAmount', () => {
  it('picks the SUMA PLN total, ignoring cash tendered and change', () => {
    const { amount, labelled } = parseAmount(BIEDRONKA);
    expect(amount).toBe(11.18);
    expect(labelled).toBe(true);
  });

  it('prefers DO ZAPLATY as the total', () => {
    expect(parseAmount(ORLEN).amount).toBe(250);
  });

  it('reads an English TOTAL line', () => {
    expect(parseAmount(STARBUCKS).amount).toBe(7.75);
  });

  it('falls back to the largest cents amount when unlabelled', () => {
    const { amount, labelled } = parseAmount('Item A 5,00\nItem B 12,50\nItem C 3,00');
    expect(amount).toBe(12.5);
    expect(labelled).toBe(false);
  });

  it('returns null when there is no amount', () => {
    expect(parseAmount('Thank you for your visit').amount).toBeNull();
  });

  it('does not glue two space-separated amounts on one line', () => {
    // Regression: the token regex used to merge "100,00 120,00" -> 10000120.
    expect(parseAmount('SUMA 100,00 120,00').amount).toBe(120);
    expect(parseAmount('RAZEM 2 x 5,00 10,00').amount).toBe(10);
  });

  it('reads a labelled total even when a tender word shares the line', () => {
    expect(parseAmount('SUMA PLN 234,56 gotowka').amount).toBe(234.56);
  });

  it('reads a space-grouped thousands total', () => {
    expect(parseAmount('DO ZAPLATY 1 234,56 PLN').amount).toBe(1234.56);
  });
});

describe('parseDate', () => {
  it('parses ISO dates', () => {
    expect(parseDate(BIEDRONKA)).toBe('2024-01-15');
  });

  it('parses European D.M.Y dates', () => {
    expect(parseDate(ORLEN)).toBe('2024-01-15');
  });

  it('falls back to US M/D/Y when day-first is invalid', () => {
    expect(parseDate(STARBUCKS)).toBe('2024-01-15');
  });

  it('handles 2-digit years', () => {
    expect(parseDate('Data: 05.03.24')).toBe('2024-03-05');
  });

  it('does not mistake a price for a date', () => {
    expect(parseDate('Cena 42,99')).toBeNull();
  });

  it('returns null when no date is present', () => {
    expect(parseDate('No date here')).toBeNull();
  });

  it('does not read a NIP/tax-id line as a date', () => {
    // Regression: "526-10-05-054" used to yield "2054-05-10".
    expect(parseDate('NIP 526-10-05-054')).toBeNull();
    expect(parseDate('NIP 779-10-11-327')).toBeNull();
  });

  it('rejects out-of-range years', () => {
    expect(parseDate('Data 10-11-327')).toBeNull();
  });
});

describe('parseMerchant', () => {
  it('recognizes a known store brand anywhere in the text', () => {
    expect(parseMerchant(BIEDRONKA)).toBe('Biedronka');
    expect(parseMerchant(ORLEN)).toBe('Orlen');
  });

  it('falls back to the first name-like line, skipping metadata', () => {
    const text = 'Kwiaciarnia Roza\nNIP 123-45-67-890\n2024-02-02\nRoze 25,00';
    expect(parseMerchant(text)).toBe('Kwiaciarnia Roza');
  });

  it('returns null when nothing looks like a name', () => {
    expect(parseMerchant('12345\n67,89')).toBeNull();
  });
});

describe('guessCurrency', () => {
  it('detects PLN from "PLN"/"zł"', () => {
    expect(guessCurrency('SUMA PLN 11,18').currency).toBe('PLN');
    expect(guessCurrency('Razem 11,18 zł').currency).toBe('PLN');
  });

  it('detects USD from "$"', () => {
    expect(guessCurrency('TOTAL $7.75').currency).toBe('USD');
  });

  it('flags EUR as unsupported', () => {
    const { currency, unsupported } = guessCurrency('TOTAL 9,90 €');
    expect(currency).toBeNull();
    expect(unsupported).toBe('EUR');
  });

  it('returns null when no currency is present', () => {
    expect(guessCurrency('TOTAL 7.75').currency).toBeNull();
  });
});

describe('parseReceiptText (integration)', () => {
  it('extracts a full expense from a Polish grocery receipt', () => {
    const r = parseReceiptText(BIEDRONKA, 0.9);
    expect(r.amount).toBe(11.18);
    expect(r.date).toBe('2024-01-15');
    expect(r.merchant).toBe('Biedronka');
    expect(r.currency).toBe('PLN');
    expect(r.category).toBe('groceries');
    expect(r.warnings).toHaveLength(0);
  });

  it('categorizes a fuel receipt as transport', () => {
    const r = parseReceiptText(ORLEN, 0.85);
    expect(r.amount).toBe(250);
    expect(r.category).toBe('transport');
    expect(r.currency).toBe('PLN');
  });

  it('warns when the total is unlabelled and confidence is low', () => {
    const r = parseReceiptText('Item 5,00\nItem 9,99', 0.3);
    expect(r.warnings.some(w => /guessed/i.test(w))).toBe(true);
    expect(r.warnings.some(w => /confidence/i.test(w))).toBe(true);
  });
});
