/**
 * Jest `setupFiles` hook — the floor under DB_PATH, before the module registry
 * loads any app code.
 *
 * Without it, `config/database.ts` falls back to `<cwd>/data/expenses.db`, which
 * under Jest is the developer's REAL expense database. The suite would then
 * insert fixtures into it and overwrite the seeded FX rates — exactly what had
 * happened here: 40 fixture rows had accumulated in a live ledger and PLN was
 * left at a test value.
 *
 * This sets the floor and nothing more. The path each *file* actually uses is
 * narrowed by `db-per-file.ts`, a `setupFilesAfterEnv` hook, which is what gives
 * every suite a database of its own; it cannot be done here, because `expect`
 * does not exist yet at this point and there is no other way to ask which test
 * file is about to run.
 *
 * Keeping both means a broken config degrades rather than detonates: drop the
 * per-file hook and the suite still never touches the real database — it just
 * shares one again, under a directory named `unassigned`, so the symptom says
 * what happened.
 */
import { UNASSIGNED_DATA_DIR } from './paths';
import path from 'path';

process.env.DB_PATH = path.join(UNASSIGNED_DATA_DIR, 'expenses.db');
