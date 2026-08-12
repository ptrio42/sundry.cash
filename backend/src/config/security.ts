/**
 * The server's security posture: who is in front of us, who may call us from
 * another origin, and what headers every response carries.
 *
 * All three used to be one-line constants in `server.ts` that were right for
 * exactly one deployment — the bundled `docker compose`. They are read from the
 * environment here instead, on every call, so a test can flip one without
 * reloading the module graph (the shape `config/instance.ts` established).
 *
 * Where a value comes from a published source it is cited. Where it is our
 * judgement it says so — docs/hosted-security.md is the standard being kept.
 */

import type { CorsOptions } from 'cors';
import type { HelmetOptions } from 'helmet';

/** What `app.set('trust proxy', …)` accepts and we support. */
export type TrustProxySetting = number | boolean | string;

/**
 * How many proxies sit between the client and this process.
 *
 * The number is a *hop count of things that append to `X-Forwarded-For`*, and
 * Express reads it from the right: with `n`, `req.ip` is the (n+1)th address
 * from the end of the chain, so entries a client forged on the left are ignored.
 * Get it too low and every request resolves to a proxy's address — the per-IP
 * login limiter becomes one global bucket that any visitor can trip against the
 * owner. Get it too high and a client can forge its own address into `req.ip`
 * and step around the limiter entirely.
 *
 *   TRUST_PROXY=1  browser -> bundled nginx -> backend        (the default; the
 *                  `docker compose up` install and dev, unchanged)
 *   TRUST_PROXY=2  browser -> Caddy/Fly -> bundled nginx -> backend
 *                  Fly's proxy sets `Fly-Client-IP` and forwards an XFF that
 *                  already has entries in it, then the in-container nginx
 *                  appends its own hop: with 1 every request resolves to a
 *                  Fly-owned address. docs/hosted-security.md §2.4 names this
 *                  exact trap.
 *   TRUST_PROXY=0  nothing in front; use the socket address (a bare `npm start`
 *                  on a public port).
 *
 * Also accepts anything Express does — `loopback`, `uniquelocal`, or a
 * comma-separated list of addresses/CIDRs, which is the precise answer when the
 * hop count varies. `true` is accepted but warned about: it trusts the whole
 * chain, which is the forgery case above, and express-rate-limit's own
 * validator rejects it for the same reason.
 */
export function resolveTrustProxy(raw: string | undefined = process.env.TRUST_PROXY): TrustProxySetting {
  const value = (raw ?? '').trim();
  if (value === '') return 1; // unchanged default: the bundled nginx, one hop

  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;

  // A bare integer is a hop count. Reject a negative or fractional one rather
  // than letting Express coerce it into something surprising.
  if (/^\d+$/.test(value)) return Number(value);

  // Named or address-based settings pass through to Express verbatim.
  return value;
}

/** Boot-time complaints about the proxy setting. Empty is the normal case. */
export function trustProxyWarnings(setting: TrustProxySetting = resolveTrustProxy()): string[] {
  if (setting === true) {
    return [
      'TRUST_PROXY=true trusts every entry in X-Forwarded-For, so a client can choose the ' +
      'address the login rate limiter counts against. Set it to the number of proxies in front ' +
      'of this process instead (1 for the bundled nginx, 2 behind an additional front proxy).',
    ];
  }
  return [];
}

/**
 * Origins allowed to call the API from a browser on another origin.
 *
 * Empty by default, and that is not an oversight: nginx serves the SPA and
 * proxies `/api` on the *same* origin in production, and the Vite dev server
 * proxies `/api` too (see `vite.config.ts`), so neither of the two supported
 * setups needs a single CORS header. `cors()` with no options answered every
 * origin with `Access-Control-Allow-Origin: *`, which made `POST /api/auth/login`
 * a cross-origin oracle any page could query — docs/hosted-security.md §3
 * finding 7.
 *
 * `CORS_ORIGINS` is a comma-separated allowlist for the one setup that does need
 * it: a frontend served from somewhere else, pointed straight at this port with
 * no proxy. Exact string match, no wildcards — a regex here is how an allowlist
 * for `https://app.example.com` also admits `https://app.example.com.evil.net`.
 */
export function allowedOrigins(raw: string | undefined = process.env.CORS_ORIGINS): string[] {
  return (raw ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

export function corsOptions(): CorsOptions {
  return {
    // A function rather than a static list because the list is read per request:
    // the whole config layer reads env on every call, and a value captured at
    // import time cannot be tested without resetting the module registry.
    origin(requestOrigin, callback) {
      // No Origin header at all: same-origin, curl, or a native client. Nothing
      // to allow and nothing to deny — CORS is a browser mechanism.
      if (!requestOrigin) {
        callback(null, false);
        return;
      }
      callback(null, allowedOrigins().includes(requestOrigin));
    },
    // The API takes a bearer token in a header, never a cookie, so credentialed
    // cross-origin requests are not a thing we need to enable.
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };
}

/**
 * Headers for this process's responses, which are JSON and receipt images —
 * never a rendered page. The SPA's own policy is nginx's job and lives in
 * `frontend/nginx.conf`; this is the API half of the same posture.
 *
 * Values follow OWASP's HTTP Security Response Headers cheat sheet except where
 * noted:
 *   - HSTS: the cheat sheet publishes `max-age=63072000; includeSubDomains;
 *     preload`. We keep the two years and `includeSubDomains` and drop
 *     `preload` — our judgement: preloading is effectively irreversible and
 *     this is a self-hoster's own domain, which may serve other things over
 *     plain HTTP. Browsers ignore the header on a non-secure origin, so a LAN
 *     install over http is unaffected either way.
 *   - `X-Frame-Options: DENY` is the published value. The cheat sheet notes it
 *     is meaningless on a JSON API; it costs one header and the API also serves
 *     receipt images, which *can* be framed.
 *   - Referrer-Policy: the sheet publishes `strict-origin-when-cross-origin`;
 *     helmet's default `no-referrer` is stricter and nothing here ever links
 *     out, so we take the stricter one. A deliberate deviation in the safe
 *     direction.
 *   - CSP: the cheat sheet publishes no policy at all, so this one is ours. For
 *     a response that must never render as a document, `default-src 'none'` is
 *     the whole policy: no script, no frame, no form, no base tag can do
 *     anything if a browser is ever talked into treating a JSON body or an
 *     uploaded image as HTML.
 */
export function helmetOptions(): HelmetOptions {
  return {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'none'"],
        'form-action': ["'none'"],
      },
    },
    // Two years, per the cheat sheet's published max-age. `preload` omitted on
    // purpose (see above).
    strictTransportSecurity: {
      maxAge: 63072000,
      includeSubDomains: true,
      preload: false,
    },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
  };
}
