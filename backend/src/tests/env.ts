/**
 * Jest `setupFiles` hook — runs before the module registry loads any app code.
 *
 * Without this, `config/database.ts` falls back to `<cwd>/data/expenses.db`,
 * which under Jest is the developer's REAL expense database. The suite would
 * then insert fixtures into it and overwrite the seeded FX rates — exactly what
 * had happened here: 40 fixture rows had accumulated in a live ledger and PLN
 * was left at a test value.
 *
 * Pointing DB_PATH at a throwaway file fixes it in one place, because
 * `services/receipt/storage.ts` derives the receipts directory from DB_PATH
 * too — so uploaded images land in the temp dir as well.
 */
import path from 'path';
import { TEST_DATA_DIR } from './paths';

process.env.DB_PATH = path.join(TEST_DATA_DIR, 'expenses.db');
