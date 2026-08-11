/**
 * Settings model — a small key/value store for single-user preferences.
 *
 * Missing/invalid keys fall back to code-side defaults, so the app always has a
 * complete, valid AppSettings even before anything is saved.
 */

import { db } from '../config/database';
import * as CategoryModel from '../models/category';
import * as CurrencyModel from '../models/currency';
import { AppSettings, BtcUnit } from '../types/expense.types';

export const DEFAULT_SETTINGS: AppSettings = {
  // 'groceries' is safe as a fallback because it is a built-in and built-ins
  // cannot be deleted — see docs/categories-currencies-spec.md.
  defaultCurrency: 'USD',
  defaultCategory: 'groceries',
  defaultBtcUnit: 'BTC',
  primaryCurrency: 'USD',
};

export const VALID_BTC_UNITS: BtcUnit[] = ['BTC', 'sats'];

/**
 * `defaultBtcUnit` stays special-cased rather than generalised into the
 * currency catalogue: satoshis are a Bitcoin display convention, not a property
 * every currency has, and inventing a "sub-unit name" column to hold one row's
 * worth of truth would be worse than this.
 */

/**
 * The code-side default currency, unless the user has disabled it — in which
 * case the first enabled one. Unlike categories there is no undeletable
 * built-in to fall back on: USD can be switched off, so the default has to be
 * derived rather than assumed.
 */
function fallbackCurrency(preferred: string): string {
  if (CurrencyModel.isEnabled(preferred)) return preferred;
  return CurrencyModel.enabledCodes()[0] ?? preferred;
}

/** Read all settings, applying defaults for anything missing or invalid. */
export function getSettings(): AppSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const map = new Map(rows.map(r => [r.key, r.value]));

  const currency = map.get('defaultCurrency');
  const category = map.get('defaultCategory');
  const btcUnit = map.get('defaultBtcUnit');
  const primaryCurrency = map.get('primaryCurrency');

  return {
    // All three re-checked against their tables on every read, so a saved
    // default whose category was deleted — or whose currency was disabled —
    // falls back instead of handing the UI something it cannot offer.
    defaultCurrency: CurrencyModel.isEnabled(currency) ? (currency as string) : fallbackCurrency(DEFAULT_SETTINGS.defaultCurrency),
    defaultCategory: CategoryModel.exists(category) ? (category as string) : DEFAULT_SETTINGS.defaultCategory,
    defaultBtcUnit: VALID_BTC_UNITS.includes(btcUnit as BtcUnit) ? (btcUnit as BtcUnit) : DEFAULT_SETTINGS.defaultBtcUnit,
    primaryCurrency: CurrencyModel.isEnabled(primaryCurrency) ? (primaryCurrency as string) : fallbackCurrency(DEFAULT_SETTINGS.primaryCurrency),
  };
}

/** Upsert the provided settings keys and return the full, current settings. */
export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  const applyAll = db.transaction((entries: [string, string][]) => {
    for (const [k, v] of entries) upsert.run(k, v);
  });

  const entries: [string, string][] = [];
  if (partial.defaultCurrency !== undefined) entries.push(['defaultCurrency', partial.defaultCurrency]);
  if (partial.defaultCategory !== undefined) entries.push(['defaultCategory', partial.defaultCategory]);
  if (partial.defaultBtcUnit !== undefined) entries.push(['defaultBtcUnit', partial.defaultBtcUnit]);
  if (partial.primaryCurrency !== undefined) entries.push(['primaryCurrency', partial.primaryCurrency]);

  if (entries.length > 0) applyAll(entries);
  return getSettings();
}
