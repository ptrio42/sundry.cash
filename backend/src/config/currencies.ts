/**
 * The currency catalogue we ship.
 *
 * Currencies are rows the user can enable or disable — never invent. The reason
 * is `minorUnits`: `config/money.ts` multiplies by it at the model boundary, so
 * it decides what every stored integer *means*. A user typing "3 decimals" for
 * a currency that has 2 would silently reinterpret their whole history, and
 * there is no way to detect it after the fact. Shipping the exponent makes it
 * right by construction, and enabling EUR then costs one row.
 *
 * Curation rule for anyone adding to this list:
 *   - Every ISO 4217 currency whose exponent is NOT 2 is here, because those
 *     are the ones a hand-written guess gets wrong (JPY has no minor unit;
 *     KWD has three; CLF has four).
 *   - Plus the 2-decimal currencies of the larger economies.
 *   - BTC is deliberately non-ISO, kept for the satoshi handling the app has
 *     always had.
 * Adding one is a code change on purpose. `locale` only steers Intl formatting.
 */

export interface CatalogueEntry {
  code: string;
  minorUnits: number;
  symbol: string;
  locale: string | null;
  /**
   * Whether `Intl.NumberFormat` can format this as `style: 'currency'`.
   *
   * It cannot be inferred: 'BTC' is a well-formed three-letter code, so Intl
   * accepts it and renders "BTC 1.00" instead of throwing. Recording it here
   * is what lets the frontend keep the ₿ prefix without a hardcoded
   * `currency === 'BTC'` branch.
   */
  iso: boolean;
}

/** Enabled on a fresh install and on upgrade, so behaviour is unchanged. */
export const DEFAULT_ENABLED_CURRENCIES = ['USD', 'PLN', 'BTC'];

const CENTS = 100;

export const CURRENCY_CATALOGUE: CatalogueEntry[] = [
  // --- Non-ISO ---------------------------------------------------------
  { code: 'BTC', minorUnits: 100_000_000, symbol: '₿', locale: 'en-US', iso: false },

  // --- Zero minor units ------------------------------------------------
  { code: 'BIF', minorUnits: 1, symbol: 'FBu', locale: 'fr-BI', iso: true },
  { code: 'CLP', minorUnits: 1, symbol: '$', locale: 'es-CL', iso: true },
  { code: 'DJF', minorUnits: 1, symbol: 'Fdj', locale: 'fr-DJ', iso: true },
  { code: 'GNF', minorUnits: 1, symbol: 'FG', locale: 'fr-GN', iso: true },
  { code: 'ISK', minorUnits: 1, symbol: 'kr', locale: 'is-IS', iso: true },
  { code: 'JPY', minorUnits: 1, symbol: '¥', locale: 'ja-JP', iso: true },
  { code: 'KMF', minorUnits: 1, symbol: 'CF', locale: 'fr-KM', iso: true },
  { code: 'KRW', minorUnits: 1, symbol: '₩', locale: 'ko-KR', iso: true },
  { code: 'PYG', minorUnits: 1, symbol: '₲', locale: 'es-PY', iso: true },
  { code: 'RWF', minorUnits: 1, symbol: 'RF', locale: 'rw-RW', iso: true },
  { code: 'UGX', minorUnits: 1, symbol: 'USh', locale: 'en-UG', iso: true },
  { code: 'VND', minorUnits: 1, symbol: '₫', locale: 'vi-VN', iso: true },
  { code: 'VUV', minorUnits: 1, symbol: 'VT', locale: 'en-VU', iso: true },
  { code: 'XAF', minorUnits: 1, symbol: 'FCFA', locale: 'fr-CM', iso: true },
  { code: 'XOF', minorUnits: 1, symbol: 'CFA', locale: 'fr-SN', iso: true },
  { code: 'XPF', minorUnits: 1, symbol: 'CFP', locale: 'fr-PF', iso: true },

  // --- Three minor units -----------------------------------------------
  { code: 'BHD', minorUnits: 1_000, symbol: '.د.ب', locale: 'ar-BH', iso: true },
  { code: 'IQD', minorUnits: 1_000, symbol: 'ع.د', locale: 'ar-IQ', iso: true },
  { code: 'JOD', minorUnits: 1_000, symbol: 'د.ا', locale: 'ar-JO', iso: true },
  { code: 'KWD', minorUnits: 1_000, symbol: 'د.ك', locale: 'ar-KW', iso: true },
  { code: 'LYD', minorUnits: 1_000, symbol: 'ل.د', locale: 'ar-LY', iso: true },
  { code: 'OMR', minorUnits: 1_000, symbol: 'ر.ع.', locale: 'ar-OM', iso: true },
  { code: 'TND', minorUnits: 1_000, symbol: 'د.ت', locale: 'ar-TN', iso: true },

  // --- Four minor units ------------------------------------------------
  { code: 'CLF', minorUnits: 10_000, symbol: 'UF', locale: 'es-CL', iso: true },
  { code: 'UYW', minorUnits: 10_000, symbol: 'UP', locale: 'es-UY', iso: true },

  // --- Two minor units, larger economies -------------------------------
  { code: 'AED', minorUnits: CENTS, symbol: 'د.إ', locale: 'ar-AE', iso: true },
  { code: 'ARS', minorUnits: CENTS, symbol: '$', locale: 'es-AR', iso: true },
  { code: 'AUD', minorUnits: CENTS, symbol: '$', locale: 'en-AU', iso: true },
  { code: 'BGN', minorUnits: CENTS, symbol: 'лв', locale: 'bg-BG', iso: true },
  { code: 'BRL', minorUnits: CENTS, symbol: 'R$', locale: 'pt-BR', iso: true },
  { code: 'CAD', minorUnits: CENTS, symbol: '$', locale: 'en-CA', iso: true },
  { code: 'CHF', minorUnits: CENTS, symbol: 'CHF', locale: 'de-CH', iso: true },
  { code: 'CNY', minorUnits: CENTS, symbol: '¥', locale: 'zh-CN', iso: true },
  { code: 'CZK', minorUnits: CENTS, symbol: 'Kč', locale: 'cs-CZ', iso: true },
  { code: 'DKK', minorUnits: CENTS, symbol: 'kr', locale: 'da-DK', iso: true },
  { code: 'EGP', minorUnits: CENTS, symbol: 'E£', locale: 'ar-EG', iso: true },
  { code: 'EUR', minorUnits: CENTS, symbol: '€', locale: 'de-DE', iso: true },
  { code: 'GBP', minorUnits: CENTS, symbol: '£', locale: 'en-GB', iso: true },
  { code: 'HKD', minorUnits: CENTS, symbol: 'HK$', locale: 'zh-HK', iso: true },
  { code: 'HUF', minorUnits: CENTS, symbol: 'Ft', locale: 'hu-HU', iso: true },
  { code: 'IDR', minorUnits: CENTS, symbol: 'Rp', locale: 'id-ID', iso: true },
  { code: 'ILS', minorUnits: CENTS, symbol: '₪', locale: 'he-IL', iso: true },
  { code: 'INR', minorUnits: CENTS, symbol: '₹', locale: 'en-IN', iso: true },
  { code: 'MXN', minorUnits: CENTS, symbol: '$', locale: 'es-MX', iso: true },
  { code: 'MYR', minorUnits: CENTS, symbol: 'RM', locale: 'ms-MY', iso: true },
  { code: 'NOK', minorUnits: CENTS, symbol: 'kr', locale: 'nb-NO', iso: true },
  { code: 'NZD', minorUnits: CENTS, symbol: '$', locale: 'en-NZ', iso: true },
  { code: 'PHP', minorUnits: CENTS, symbol: '₱', locale: 'en-PH', iso: true },
  { code: 'PLN', minorUnits: CENTS, symbol: 'zł', locale: 'pl-PL', iso: true },
  { code: 'RON', minorUnits: CENTS, symbol: 'lei', locale: 'ro-RO', iso: true },
  { code: 'RSD', minorUnits: CENTS, symbol: 'дин', locale: 'sr-RS', iso: true },
  { code: 'SAR', minorUnits: CENTS, symbol: '﷼', locale: 'ar-SA', iso: true },
  { code: 'SEK', minorUnits: CENTS, symbol: 'kr', locale: 'sv-SE', iso: true },
  { code: 'SGD', minorUnits: CENTS, symbol: 'S$', locale: 'en-SG', iso: true },
  { code: 'THB', minorUnits: CENTS, symbol: '฿', locale: 'th-TH', iso: true },
  { code: 'TRY', minorUnits: CENTS, symbol: '₺', locale: 'tr-TR', iso: true },
  { code: 'UAH', minorUnits: CENTS, symbol: '₴', locale: 'uk-UA', iso: true },
  { code: 'USD', minorUnits: CENTS, symbol: '$', locale: 'en-US', iso: true },
  { code: 'ZAR', minorUnits: CENTS, symbol: 'R', locale: 'en-ZA', iso: true },
];
