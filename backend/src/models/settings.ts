/**
 * Settings model — a small key/value store for single-user preferences.
 *
 * Missing/invalid keys fall back to code-side defaults, so the app always has a
 * complete, valid AppSettings even before anything is saved.
 */

import { db } from '../config/database';
import { AppSettings, BtcUnit, Currency, ExpenseCategory } from '../types/expense.types';

export const DEFAULT_SETTINGS: AppSettings = {
  defaultCurrency: 'USD',
  defaultCategory: 'groceries',
  defaultBtcUnit: 'BTC',
  primaryCurrency: 'USD',
};

export const VALID_CURRENCIES: Currency[] = ['USD', 'PLN', 'BTC'];
export const VALID_CATEGORIES: ExpenseCategory[] = ['groceries', 'transport', 'media', 'entertainment', 'utilities', 'maintenance', 'other'];
export const VALID_BTC_UNITS: BtcUnit[] = ['BTC', 'sats'];

/** Read all settings, applying defaults for anything missing or invalid. */
export function getSettings(): AppSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const map = new Map(rows.map(r => [r.key, r.value]));

  const currency = map.get('defaultCurrency');
  const category = map.get('defaultCategory');
  const btcUnit = map.get('defaultBtcUnit');
  const primaryCurrency = map.get('primaryCurrency');

  return {
    defaultCurrency: VALID_CURRENCIES.includes(currency as Currency) ? (currency as Currency) : DEFAULT_SETTINGS.defaultCurrency,
    defaultCategory: VALID_CATEGORIES.includes(category as ExpenseCategory) ? (category as ExpenseCategory) : DEFAULT_SETTINGS.defaultCategory,
    defaultBtcUnit: VALID_BTC_UNITS.includes(btcUnit as BtcUnit) ? (btcUnit as BtcUnit) : DEFAULT_SETTINGS.defaultBtcUnit,
    primaryCurrency: VALID_CURRENCIES.includes(primaryCurrency as Currency) ? (primaryCurrency as Currency) : DEFAULT_SETTINGS.primaryCurrency,
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
