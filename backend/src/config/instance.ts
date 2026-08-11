/**
 * What kind of instance this process is.
 *
 * Sundry runs as one instance per person: a laptop, a customer's container, or
 * the public demo. These flags are the difference between them, and they are
 * read from the environment on every call rather than captured at import time —
 * the same shape `config/auth.ts` uses for APP_PASSWORD, so a test (or a
 * restart with a different env file) can flip one without reloading the module
 * graph.
 *
 * The two flags are deliberately independent. DEMO_MODE must not imply
 * RECEIPTS_ENABLED=false: a customer instance might want uploads off for
 * reasons that have nothing to do with a demo, and a local demo might want them
 * on. `docker-compose.demo.yml` sets both; nothing here couples them.
 */

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'off']);

/**
 * Read a boolean environment variable.
 *
 * Anything unrecognised falls back to the documented default — including the
 * empty string, which is what Compose writes for an unset `${VAR:-}` and must
 * therefore mean "not configured" rather than "false". Because a typo
 * (`RECEIPTS_ENABLED=flase`) silently resolves to the default, `server.ts` logs
 * the flags it resolved at start-up: the operator sees what the instance
 * actually decided, not what they meant to write.
 */
function flag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;

  const value = raw.trim().toLowerCase();
  if (TRUTHY.has(value)) return true;
  if (FALSY.has(value)) return false;
  return fallback;
}

/** Public demo: the frontend says so in a banner. Off unless asked for. */
export function isDemoMode(): boolean {
  return flag('DEMO_MODE', false);
}

/**
 * Whether this instance offers receipt scanning. On by default, because a
 * self-hosted install should have every feature it shipped with; off is for a
 * public instance, where an open OCR endpoint is a free compute service for
 * the internet running Tesseract on someone's CPU.
 */
export function isReceiptsEnabled(): boolean {
  return flag('RECEIPTS_ENABLED', true);
}
