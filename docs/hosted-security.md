# Hosted Sundry — the security model

Self-hosted Sundry has one user, one machine and an optional password, and that is a defensible
place to stop. **Hosted Sundry is a different product**: it holds a stranger's complete financial
history, on infrastructure one person operates, sold on a promise about privacy. This file is the
model that makes the security work *finite* — what we protect, from whom, what we deliberately do
not do, and what happens when it goes wrong anyway.

Every number here has a source. Where there is no source, it says so and names the judgement as
ours. That distinction is the point of the document: a plausible-sounding parameter with no
provenance is exactly the failure mode this file exists to prevent.

Most of this is not built yet — the server-side subset that is, is listed in §3.1.
`docs/demo-and-hosting-spec.md` covers the instance mechanics; this covers what has to be true
before a stranger pays and types real numbers in.

---

## 1. The threat model

**What we protect.** One person's expense history, receipt photographs, and the email address they
bought with. Not identity documents, not card numbers — Stripe holds those and we never see them.

**From whom, in the order these actually happen:**

1. **The internet's background noise.** Automated scanners, credential stuffing, mass exploitation
   of a freshly published CVE. This is the overwhelming majority of real attacks and it is defeated
   by boring hygiene: patching, a password that cannot be guessed, throttling, minimal surface.
2. **Someone who has the buyer's mailbox.** Password reset makes the mailbox the root of trust.
   This is the single most likely *targeted* compromise of an individual account and no amount of
   server-side cleverness prevents it.
3. **Someone who reaches the operator.** The Fly API token, the Stripe key, the registrar, the
   operator's laptop. Highest impact, and the least addressed by anything in the codebase.
4. **A curious or compromised platform.** Fly staff, a stolen drive, a snapshot. Partly addressed,
   partly accepted — see §4.

**Out of scope, by decision.** A targeted attacker with a budget, anyone with physical access to
the buyer's unlocked device, and the operator himself — the operator can read tenant data, and §4
says so out loud rather than implying otherwise.

**The consequence that sets the bar.** Because the ledger sits in a plaintext SQLite file, an
unauthorised access to a tenant volume is a personal data breach that must be reported to the
supervisory authority within 72 hours, and — since a complete financial history plus receipt
photographs crosses the "high risk" line — communicated to the customer too. GDPR Art 34(3)(a)'s
escape hatch, where notification is unnecessary because the data was unintelligible to the
attacker, **is not available to us**: hashing the password protects the credential, not the data.
That single fact is why detection and logging below are compliance artefacts and not conveniences.

---

## 2. Decisions, and the source that sets each one

### 2.1 Password storage

| Decision | Value | Source |
|---|---|---|
| Algorithm | Argon2id if we move the image to Node ≥ 24.7, otherwise scrypt as the sanctioned fallback | OWASP Password Storage CS |
| scrypt cost, if scrypt | **N=2^17, r=8, p=1** — or a documented equal-defense row | OWASP Password Storage CS |
| Calibration | a hash must take **under one second** on the machine size we sell | OWASP Password Storage CS |
| Salt | 16 bytes from `crypto.randomBytes`, per record, parameters stored PHC-style | OWASP Password Storage CS |
| Pepper | HMAC the password with a secret held **outside** the tenant volume, in Fly secrets | OWASP Password Storage CS |
| API form | async `crypto.scrypt`, never `scryptSync` | Node crypto docs |

**Two corrections to what this project believed before the sources were read.**

OWASP puts **Argon2id first** and scrypt second, "when the former is not available". Our earlier
plan chose scrypt without establishing unavailability — and the premise is now false anyway:
`crypto.argon2()` landed in Node 24.7.0, so on a runtime we build ourselves it is a standard-library
call with no native dependency. `CLAUDE.md` pins Node 22, which is the only thing making scrypt the
fallback. **Decide this before the first paying tenant**, because changing the hash afterwards means
a rehash-on-next-login path. This is not merely code taste: GDPR Art 32 makes "state of the art" the
legal test, and OWASP naming Argon2id first is the most citable evidence of what that phrase means.

And **N=16384 is not a work factor, it is Node's default.** OWASP's published scrypt minimum is
N=2^17 — eight times the memory — and the only row where 2^14 is acceptable pairs it with p=5, not
p=1. Note the interaction: 128·N·r at 2^17 is 128 MiB, which exceeds Node's 32 MiB `maxmem` default,
so `crypto.scrypt` **throws** unless `maxmem` is raised. Derive `maxmem` from N and r in code so it
cannot drift out of step with the cost.

The pepper matters more here than in a normal app, and for a structural reason: the tenant's entire
security state — password hash, session epoch, one-time tokens — lives in the same SQLite file as
the expenses, which is the file Fly snapshots daily. A pepper in Fly's secret store means a stolen
volume or snapshot yields no offline cracking target.

**Needs a measurement, not a document.** The smallest sellable Fly machine is `shared-cpu-1x` with
256 MB. One scrypt hash at OWASP's minimum reserves 128 MiB of that, alongside Node and
better-sqlite3. Before picking a row: hash with each of OWASP's five configurations on the exact
machine size, record wall time and RSS, then fire 5–10 concurrent logins and see whether it OOMs or
merely queues. The answer is a per-machine-size constant, and it may well be that 2^17/p=1 does not
fit — in which case a lower-N/higher-p row is the documented equal-defense trade, not a shrug.

### 2.2 Sessions and tokens

| Decision | Value | Source |
|---|---|---|
| Absolute cap | 30 days, anchored to `auth_time` that renewal copies verbatim | ASVS 7.3.2; NIST SP 800-63B-4 |
| Inactivity timeout | **7 days**, advanced by renewal — decided 2026-08-12 | ASVS 7.3.1 (L2) |
| Re-authentication | the password again before `DELETE /api/expenses/all`, whatever the session age | our judgement |
| Revocation | per-tenant `session_epoch` mixed into the signing key | ASVS 7.4.1 names this exact mechanism |
| Token payload | `jti` (≥128-bit CSPRNG), `iat`, `auth_time`, `exp`, `sub`, `typ`, key id — no PII | ASVS 7.2.3, 7.2.4, 9.2.2 |
| Signing key | `HMAC(AUTH_SECRET, session_epoch)`; `AUTH_SECRET` = 32 random bytes per instance, in Fly secrets | our judgement, see below |
| Where the token lives | `__Host-` cookie, `HttpOnly; Secure; SameSite=Strict`, plus a CSRF defence | OWASP Session Management CS; ASVS 3.5.1 |

**Single-factor password authentication is AAL1**, and NIST's AAL1 ceiling is a 30-day overall
session with an optional inactivity timeout. So our 30 days is not a middle-of-the-road choice — it
is exactly the top of the band we are entitled to. If MFA ever appears, or marketing ever implies
AAL2, the cap drops to 24 hours with a 1-hour idle timeout. ASVS 7.1.1 requires these numbers to be
*written down with the justification for deviating from 800-63B*; this table is that record.

**The inactivity timeout: 7 days idle, under the 30-day cap.** Today's 7-day TTL with no idle rule
is a 7-day idle window that expires even on a device in daily use, so this is an improvement in both
directions rather than a compromise between them. Someone who opens the app weekly stops seeing the
login screen at all; a device that goes quiet for a week needs the password, which is exactly today's
behaviour for the phone that matters — the lost one. The concession is bounded and singular: the
worst case grows from 7 days to 30.

OWASP's published band for high-value applications is 2–5 minutes and we are deliberately far outside
it. The justification, as ASVS 7.1.1 requires it to be written down: this is single-factor password
authentication, which pins us to AAL1 whatever we do, and NIST's AAL1 ceiling is a 30-day session
with the inactivity timeout optional — so 7 days idle is stricter than the standard we are entitled
to claim, not looser. A 5-minute timeout on an app people keep on a home screen does not produce a
more secure product; it produces a password written on a sticky note.

**One step-up, where the irreversible damage is.** `DELETE /api/expenses/all` asks for the password
again regardless of session age. That is the whole reason the rest can be comfortable: the cheap
exception buys the expensive convenience.

**The signing key must not be derived from the password hash.** That was this project's own earlier
idea and it fails twice: key material in the DB means every snapshot and backup mints live tokens,
and a reset to the *same* password reuses the salt, reproduces the digest, reproduces the key and
leaves an intruder logged in — failing in exactly the case the mechanism existed for. A separate
random `session_epoch`, rewritten on **every** password write and on account disable or delete,
holds in all of those cases. Generate a fresh salt on every write regardless.

**Two requirements we do not meet with a payload of `{exp}` alone.** ASVS 7.2.4 wants a new token on
every authentication — two logins in the same second currently produce byte-identical tokens. ASVS
7.5.2 wants the user to be able to see and end individual sessions, which nothing can do without an
identifier. One change buys both: a `jti` plus a small `sessions` table in the tenant's own SQLite
(`jti`, `issued_at`, `last_seen`, `user_agent`, `ip`, `revoked_at`). Verification stays a signature
check plus one indexed lookup, which is nothing with better-sqlite3 — and the same table is what
gives us the inactivity timeout and the audit trail below.

**On `localStorage`, be precise about why.** The Session Management Cheat Sheet says not to put
tokens there; ASVS 5.0 §14.3.3 explicitly *permits* it with conditions. So "the standard forbids it"
would be an overstatement — the honest argument is that the trade is asymmetric. CSRF has a complete
specified mitigation; XSS token theft has no equivalent. We take the cookie and pay the CSRF tax
deliberately: `__Host-` prefix, `HttpOnly`, `Secure`, `SameSite=Strict`, plus an ASVS 3.5.1 defence —
for a JSON-only API, requiring a custom non-safelisted header on every state-changing call, which
cannot be forged cross-site without a preflight. `SameSite` alone is not the defence.

**Logging is not optional here.** ASVS V16 wants every authentication operation logged, successes
and failures, with when/where/who/what and no sensitive values. For us it is also the only way to
answer "how many data subjects, and what was read" inside the 72-hour clock — log issuance, renewal,
expiry rejection, epoch-bump revocation and every login attempt, with the `jti`, never the token.

### 2.3 The claim link and password reset

| Decision | Value | Source |
|---|---|---|
| Token | 32 bytes from `crypto.randomBytes`, base64url | ASVS 6.5.2 — above the 112-bit line |
| At rest | `sha256(token)` only, never the token | Forgot Password CS; ASVS 6.5.2 |
| Single use | one conditional `UPDATE … WHERE used_at IS NULL`; zero rows changed = refusal | ASVS 6.5.1 |
| Claim link lifetime | 72 h — a deliberate deviation, recorded here | ASVS 6.4.1 (no figure published) |
| Reset link lifetime | 1 h — deviation from the only published number, 10 min | ASVS 6.5.5 |
| Rate limiting | **per account**, not per IP | Forgot Password CS |
| Response wording | one message whether or not the address exists, in constant time | Authentication CS |
| After a reset | send them to the normal login form; do not auto-login | Forgot Password CS |
| Notification | email the owner on every password write | Forgot Password CS; ASVS 6.3.7 |

The widely repeated "128 bits, per OWASP" for reset tokens **is not in any OWASP document** — the
cheat sheet says CSPRNG and "sufficiently long" and stops. We pick 256 bits for a concrete reason:
ASVS 6.5.2 sets 112 bits as the line above which a plain hash may replace a password-hashing
algorithm for storage, so 256 bits lets `sha256` be the correct storage choice rather than a corner
cut.

**Keeping the token in the URL fragment is our decision, not OWASP's.** The cheat sheet documents
the query string and mitigates it; no fetched OWASP document mentions the fragment at all. We differ
in the safer direction — a fragment is never transmitted, so it cannot reach Fly's proxy logs, our
access log, or a `Referer` header. It does **not** close browser history, browser cache, or the
family laptop, so: clear it with `history.replaceState` the moment it is read, set
`Referrer-Policy: no-referrer` on the claim and reset pages anyway, and keep the cheat sheet's other
controls, which are not redundant.

Two traps this design already avoids, and must keep avoiding. We email a claim *token* and let the
buyer choose the password, rather than emailing a generated starter password that quietly becomes
permanent — ASVS 6.4.1 exists because of that pattern; do not "simplify" onboarding into it later.
And the enumeration-safe response must do equal work in both branches: an early
`if (!user) return …` is measurably faster and is itself the oracle.

**The claim route must also be gated on "no password row exists"**, not only on a valid token.
Otherwise a replayed link is a takeover of a year of data, and a claim executed against a populated
database shows a new buyer the previous owner's ledger.

**Delivery is part of the security design, not an afterthought.** The whole flow rests on an email
arriving. Gmail's sender requirements have been mandatory since February 2024: SPF or DKIM, valid
forward and reverse DNS, TLS in transit, spam complaints under 0.3%. Set SPF, DKIM and DMARC on a
dedicated transactional subdomain before launch. A buyer who pays €5, receives nothing and cannot
get in does not file a bug report — they file a chargeback. Separately, and worth testing rather
than assuming: corporate mail scanners rewrite links, and a wrapper that re-encodes our URL could
put the token into someone else's query string and click logs.

### 2.4 The instance on Fly

| Fact | Consequence |
|---|---|
| Volumes are encrypted at rest by default (LUKS, Fly holds the keys) | Protects a drive that is not mounted. Not our app, not a compromised machine, not Fly staff. Never let marketing turn this into "nobody can read your data". |
| A volume is one slice of one NVMe on one host, no replication, "not a backup" | One tenant = one single point of loss. **Losing it is itself a notifiable breach** under Art 4(12). Ship an off-Fly encrypted backup before taking money. |
| Daily snapshots, 5-day retention by default, **no API to delete an individual snapshot** | "We delete your data" cannot be honoured by destroying a volume. `fly apps destroy` is the one documented action that removes volumes *and* snapshots. Set `snapshot_retention` deliberately and disclose the window. |
| Snapshot encryption and location are undocumented | Do not assert either to a customer. Ask Fly in writing if a DPA annex needs it. |
| Autostop kills the process; in-memory state does not survive | The login limiter's in-memory store is wiped every idle period. Move the counter into the tenant's SQLite. |
| Cold start ≈ 2 s | The first click on a claim link and the login POST are both cold. Show a pending state; do not put a short client-side timeout on auth calls. |
| An app with no declared service is not routed; default is deny | Pre-provision with no service block, add it at claim time. **But** an HTTP app gets a shared Anycast IPv4 on first deploy — assert `fly ips list` is empty, `fly ips release` if not. |
| Private ≠ isolated: org apps share a WireGuard mesh and resolve over `.internal` | An unclaimed instance is reachable from every other machine in the org. It must refuse to serve data when no password row exists, rather than relying on the network. |
| Secrets are write-only; setting one restarts the Machine | Generate `AUTH_SECRET` at provisioning, set it, discard it — we can never read it back. Rotation is the break-glass logout; `session_epoch` is the everyday one. |
| Fly sets `Fly-Client-IP`; XFF arrives with entries already in it | `app.set('trust proxy', 1)` is **wrong** here with an in-container nginx: every request resolves to a Fly-owned address, so one visitor's failed logins throttle the owner. |
| Fly is US-based, offers a DPA, is SOC 2 Type II, has EU regions but **no documented residency guarantee** | Pin machines and volumes to `fra`/`ams` and say that is where the data sits. Do not write "your data never leaves the EU". Name Fly as the sole infrastructure sub-processor. |

**Restoring a snapshot rolls back the security state**, because the password hash, the session epoch
and the one-time-token table live in the same file as the expenses: a restore un-revokes sessions,
resurrects the previous password and un-burns used tokens. Any recovery runbook must bump the epoch
and invalidate outstanding tokens immediately after a restore.

---

## 3. What the internal review found

An adversarial review of the current code and the proposed design produced 51 confirmed findings.
De-duplicated, they are seven, and all seven are consequences of the model above rather than
surprises. **These block taking money, not shipping the landing page.**

1. **Fail-open is the largest risk.** `isAuthEnabled()` means "a password resolved" and `requireAuth`
   is an unconditional `next()` when it does not. Moving the password into SQLite inherits that: an
   empty or unmigrated table turns a paying customer's instance into an open API. Worse,
   `config/database.ts` swallows migration errors by design, and the frontend fails open on
   `getAuthStatus`. Fix: `AUTH_REQUIRED` baked into the hosted image, `503` rather than `next()`, a
   read that distinguishes "no row" from "read failed", a boot assertion, and an external check that
   an unauthenticated `GET /api/expenses` returns 401.
2. **Brute force.** The limiter is in-memory (wiped by autostop), keyed per IP (defeated by
   rotation), behind a `trust proxy` value that makes every client look like one address. But the
   load-bearing control is elsewhere: **there is no password policy anywhere**, and we are handing
   password choice to a non-technical buyer on a public host.
3. **One-time tokens** — §2.3. Exploitable by whoever sees the link, with no prerequisite.
4. **Recycling a pool instance** leaks the previous owner's ledger, and wiping only the `.db` leaves
   the receipt photographs, since `receiptsDir` derives from `DB_PATH`. Never recycle: destroy the
   app, provision fresh.
5. **Certificate Transparency publishes the customer list.** Public certificates are logged with no
   opt-out, and the newer log policy caps the merge delay at one minute — the name is public before
   the customer first loads the page. Use opaque instance names and a single `*.sundry.cash`
   wildcard obtained via DNS-01; **never** issue a per-host certificate, because one is permanent.
   Unverified and worth checking directly: whether Fly issues a per-app certificate for
   `<app>.fly.dev`, which would leak the same list by another route.
6. **Sliding renewal** needs `auth_time` and a hard cap, or the cap is decorative — §2.2.
7. **`cors()` with no options** makes the login route a cross-origin oracle. It is also unnecessary:
   nginx serves the SPA same-origin.

Explicitly **not** worth fixing, per the same review: receipt upload path traversal, the
pool-allocation race, and "one Fly token is everything" — the last is true and is the definition of
operating a hosting service, not a vulnerability.

### 3.1 What has been implemented (branch `feat/auth-hardening`)

Seven server-side changes, all of them things a decision does not block. Each is covered by tests,
because a security control with no test is one that gets removed by accident.

| Change | Where | Note |
|---|---|---|
| `AUTH_REQUIRED` — fail **closed** | `config/auth.ts`, `middleware/auth.ts`, `server.ts` | Set it and a missing password is fatal at boot *and* answers 503 on every guarded route. Unset, the opt-in default is byte-for-byte what it was: a laptop install does not change. `/auth/status` reports `authRequired: true` in the broken state, because the frontend reads `false` as "render the app". |
| `TRUST_PROXY` replaces the hardcoded `1` | `config/security.ts` | 1 = bundled nginx, 2 = a front proxy (Caddy, or Fly) in front of it. Tests pin the resolved `req.ip` for both chains, including the §2.4 trap where a Fly-shaped chain read with `1` resolves every visitor to a Fly address. |
| Login throttling moved into SQLite | `models/rateLimit.ts`, `middleware/rateLimit.ts` | An `express-rate-limit` store over better-sqlite3, so autostop no longer wipes the counter — plus a per-instance backstop with a doubling delay (5 free, then 1s→15min) for the attacker who simply rotates address. The schedule is our judgement and says so. |
| CORS allowlisted | `config/security.ts` | Default allows **nothing**: nginx and the Vite dev proxy both serve the SPA same-origin, so no supported setup needs a CORS header. `CORS_ORIGINS` is exact-match, no regex. |
| A real CSP, plus the rest of the header list | `frontend/security-headers.conf`, `config/security.ts` | The SPA gets a strict policy with the two inline blocks admitted **by hash**; the API gets `default-src 'none'`. HSTS / `X-Frame-Options: DENY` / nosniff / `Referrer-Policy` / `Permissions-Policy` on both. Verified in a browser against the built app, not by reading the header back. |
| `AUTH_SECRET` fallback warned about, and refused when it matters | `config/auth.ts`, `deploy/instance.env.example` | Still falls back for backward compatibility, warns loudly at boot, and is **fatal** under `AUTH_REQUIRED`. The example env now says `openssl rand -hex 32`. |
| The error handler stopped echoing `err.message` | `server.ts` | Status only on the wire; the detail stays in the log. |

Two things worth correcting in this document rather than leaving for the next reader:

- **§2.4's row about `trust proxy` is right about the consequence and imprecise about the number.**
  It says `app.set('trust proxy', 1)` is wrong on Fly "with an in-container nginx", which is true,
  but the fix is not "do not trust a proxy" — it is to count the hops that *append* to
  `X-Forwarded-For`, which on that topology is two (Fly's proxy, then nginx). `Fly-Client-IP` is a
  second, simpler answer that Express cannot use without a custom key generator; the hop count is
  the one that needs no new mechanism, and it is what shipped.
- **Finding 2 bundles two controls with different lifetimes.** Brute force is fixed here; the
  password policy it names in the same breath is not, because it belongs with the move of the
  password into the database and the Argon2id-versus-scrypt decision in §6. Splitting them is what
  made this branch shippable without waiting on a measurement.

---

## 4. What we deliberately do not do

This list is what makes the plan finite. Each is a decision, not an oversight.

- **No end-to-end encryption.** It is the single largest structural risk reduction available, and it
  is a direct trade against the feature the product is sold on: findings are scored server-side, and
  a server holding ciphertext has nothing to rank. So the honest answer to "can the operator read my
  expenses" is **yes, technically** — and the marketing must say something no stronger than that.
- **No customer MFA.** On a single-user instance it adds an account-recovery problem a one-person
  operator cannot support, and the mailbox already gates recovery either way.
- **No log aggregation, SIEM or alerting stack** beyond a per-tenant authentication log.
- **No certification** — SOC 2, ISO 27001. Meaningless at this size and enormously expensive.
- **No bug bounty with payouts.** A `security.txt` and a monitored address instead: RFC 9116 makes
  `Contact` and `Expires` mandatory, at `/.well-known/security.txt`, served as
  `text/plain; charset=utf-8`. Use a role address, not a personal one, and diarise the `Expires`
  date — a lapsed file is invalid and reads worse than none.
- **No claim of data residency** beyond "the machine and its volume are pinned to Frankfurt".

---

## 5. If it goes wrong

Four capabilities, each prepared in advance, because none of them can be improvised at midnight.

**Detect.** A per-tenant authentication log, plus an email to the owner on a login from a new device
and on every password write. Without this the 72-hour clock cannot even start, and Art 33(3)(a) —
"the approximate number of data subjects and records concerned" — is unanswerable.

**Contain.** One documented command that stops the machines. Rotating `AUTH_SECRET` invalidates every
session at once; rotating the Fly and Stripe tokens closes the operator path. Written down before it
is needed.

**Recover.** An off-Fly encrypted backup of the SQLite file and the receipts directory — Fly's own
documentation says a single volume is not a backup, and Art 4(12) makes losing it a breach in its
own right. **Restore it once, on purpose, and record how long it took**; an untested backup is not a
backup. After any restore, bump the session epoch and invalidate outstanding one-time tokens.

**Report.** Notification to UODO goes through the e-service on `biznes.gov.pl` and requires a
qualified electronic signature or a Profil Zaufany — **arrange that before launch**, because there is
no paper fallback and it cannot be obtained inside 72 hours. Keep an internal breach register from
day one: Art 33(5) requires it even for breaches you decide not to notify. Assume any unauthorised
access to a tenant volume also crosses Art 34's "high risk" line and must be told to the customer,
in plain language, at the verified address they bought with.

---

## 6. Open, and not answerable by a document

- **Argon2id or scrypt** — i.e. whether to move the image to Node ≥ 24.7. Decide before the first
  paying tenant; afterwards it needs a rehash-on-login path.
- **The scrypt or Argon2 cost row**, which is a measurement on the machine size we actually sell.
- **The inactivity timeout value**, which is a product decision constrained by §2.2.
- **Whether Fly issues per-app certificates for `.fly.dev`** — one `openssl s_client` away.
- **Four questions for a Polish lawyer, in one session, before the pricing page goes live:** whether
  we are controller or processor for the expense rows themselves (Recital 18 says we are in scope as
  the provider of the means; the boundary is contested); whether a trial starts the 14-day
  withdrawal clock; the wording of the Art 6(1) pre-purchase disclosure; and VAT OSS registration.
  Adjacent and equally unavoidable: signing the Fly and email-provider DPAs (Art 28) and writing the
  one-page record of processing (Art 30 — do not assume the under-250-employee exemption, since a
  subscription is by definition not "occasional").

Two consumer-law facts that land on the landing page rather than the code: the price must be shown
**inclusive of tax**, with the trader's real name, geographical address and email, the subscription's
duration and how to cancel, and the withdrawal information including the model form. And the 14-day
withdrawal right **applies to a hosted service and cannot be waived** with the "start immediately and
lose your right" tick-box, which is the digital-*content* mechanism and does not apply here.

---

## 7. Sources

Everything above was fetched and read on 2026-08-12; where a source publishes no figure, this file
says so rather than inventing one.

- OWASP Cheat Sheet Series — Password Storage, Session Management, Forgot Password, Authentication,
  Cross-Site Request Forgery Prevention, HTTP Security Response Headers
- OWASP ASVS 5.0 — V3 (Web Frontend), V6 (Authentication), V7 (Session Management), V9
  (Self-contained Tokens), V14 (Data Protection), V16 (Logging)
- NIST SP 800-63B-4 — authenticator assurance levels and session lifetimes
- Node.js v22 `crypto` documentation; Node.js v24.7.0 release notes (`crypto.argon2`)
- Fly.io documentation — volumes, snapshots, machine states, autostop/autostart, services, Flycast,
  secrets, request headers, regions, compliance, privacy policy
- GDPR Articles 4, 28, 30, 32, 33, 34 and Recital 18; EDPB Guidelines 07/2020;
  UODO / biznes.gov.pl breach-notification service
- Consumer Rights Directive 2011/83/EU, Articles 6, 9, 14, 16
- RFC 6962 (Certificate Transparency), Chrome CT Log Policy, CA/Browser Forum Baseline Requirements
- RFC 9116 (`security.txt`); Google Gmail sender requirements
