# Security

Sundry has **one credential per instance**, however many people use it: no accounts table, no
`user_id` column, one SQLite file and one optional password. A household can share an instance — and
is meant to — but they share the password, so there is no per-person access, no per-person
revocation, and nothing that could serve as an audit trail. Removing one person's access means
changing the password for everyone.

What has changed is where it runs. There are now two deployment models, and they have different
threat models — read the section that applies to you.

## Reporting a vulnerability

Email **security@entereighth.com**. I aim to reply within **five working days** — and if two weeks
pass with nothing, assume the message went astray and send it again rather than concluding the
address is a black hole. There is no bounty programme and no on-call rota; there is one person who
reads that address.

Useful things to include: the version or commit, which deployment model you were looking at, and
enough detail to reproduce. If you found it against a hosted instance that is not yours, please stop
before touching anyone's data and tell me instead.

When the repository is public, GitHub's private security advisory flow becomes a second route. Until
then, email is the only one — an earlier version of this file pointed at a GitHub issue tracker that
does not exist yet.

**Supported version:** whatever is on `main`. There are no maintained release branches.

## If you host it yourself

**1. Authentication is off unless you turn it on.** With no `APP_PASSWORD` set, every API route is
reachable with no credentials — including `DELETE /api/expenses/all`. That default exists so a
localhost install needs zero setup, and it is the wrong default the moment the port is reachable by
anyone else.

Before exposing it beyond your own machine:

- Set `APP_PASSWORD`.
- Set `AUTH_SECRET` to an independent random value (`openssl rand -hex 32`). Left empty, the token
  signing key falls back to the password itself, and the signed payload is known plaintext — one
  leaked token then becomes an offline, unthrottled cracker for your password. The app warns about
  this at boot.
- Set `AUTH_REQUIRED=true`. The app then refuses to start without a password and answers `503` on
  every guarded route rather than serving your ledger open, which is what it would otherwise do if a
  password went missing through a configuration mistake.
- Set `TRUST_PROXY` to the number of proxies in front of the app that append to `X-Forwarded-For` —
  1 for the bundled nginx, 2 if you put your own reverse proxy in front of that. Too low and every
  client resolves to the same address, which turns the per-IP login limit into one global bucket that
  any visitor can trip against you.
- Put it behind HTTPS. There is a Caddyfile in `deploy/` for the boring version of that.

**2. A LAN or a VPN is still the calmest place for it.** It can be exposed safely with the settings
above, and the hosted instances are exposed, but understand what you do not get: no audit log, no
MFA, no per-session revocation, and a session that lasts 7 days with no inactivity timeout.

**3. Security headers only ship with the bundled nginx.** `frontend/security-headers.conf` — the
Content-Security-Policy, HSTS, `X-Frame-Options`, `X-Content-Type-Options` — reaches the container
through `frontend/Dockerfile`. If you serve `frontend/dist/` with your own web server you get none of
them; use that file as the reference set.

**Login throttling.** Failed logins are limited to 10 per 15 minutes per IP (successful logins do not
count), and the counter lives in your SQLite file rather than in process memory, so it survives a
restart. Behind that sits a per-instance backstop: after 5 consecutive failures each further attempt
waits, doubling from one second up to 15 minutes, whatever address it comes from. A global lockout is
a legitimate control here in a way it never is for a product with accounts, because one password
means one blast radius: it locks out whoever shares that password — you, or your household — and only
until the wrong guesses stop. Nobody outside can use it to lock out anybody in particular.

## If you pay for a hosted instance

The full model is `docs/hosted-security.md`: what is protected, from whom, what is deliberately not
done, and what happens if it goes wrong. Three things from it belong here.

**Your data is not encrypted in a way that puts it beyond me.** The disk is encrypted at rest by the
platform, which protects a drive that is not currently mounted and nothing else. The ledger and your
receipt photographs sit in a plain SQLite file that the software — and therefore its operator — can
read. Anyone claiming otherwise about a product that computes insights on the server is claiming
something the architecture does not support.

**A breach means you hear about it.** Unauthorised access to an instance is a personal data breach:
reported to the supervisory authority within 72 hours of my becoming aware, and communicated to you,
because a complete financial history plus receipt photographs is not a low-risk payload.

**You can leave.** The data is a folder: one SQLite database and your receipt images. Export is
built in, and the same image you were running is the one you can run yourself.

## Known accepted risk: `xlsx` (SheetJS)

`npm audit` reports two **high** advisories against `xlsx@0.18.5` with **no fix available**:

| Advisory | Type |
| --- | --- |
| [GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) | Prototype pollution |
| [GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9) | Regular-expression denial of service |

**Why it cannot simply be upgraded.** 0.18.5 is the last version SheetJS published to npm; the
project now distributes from its own CDN, so there is no newer package for npm to resolve to. The
advisory range is `*` and `fixAvailable` is `false` — `npm audit fix` cannot help.

**What the actual exposure is here.** The library is reached in exactly three places:

- `POST /api/import/preview` and `POST /api/import/confirm` — `xlsx.read()` on an uploaded file.
  This is the real attack surface: parsing a hostile spreadsheet.
- `GET /api/expenses/export` — `xlsx.write()` from data already in your own database. Writing does
  not parse untrusted input.

So triggering either advisory requires **uploading a malicious spreadsheet to an instance**. With a
password set, that means an authenticated request; without one, anyone who can reach the port.
Uploads are capped at 5 MB, which bounds the ReDoS impact to one request handler.

**The honest summary:** for one person importing their own files onto their own hardware this is a
low practical risk, and it is disclosed here rather than left for you to find in a red Dependabot
alert. Two things change that calculation, and both are now real: importing spreadsheets you did not
create, and hosting instances where the person uploading is not the person running the server.

**Migration options**, in rough order of effort: vendor the current SheetJS build from
`cdn.sheetjs.com` instead of npm; or replace it with `exceljs` in `routes/import.ts` and
`routes/expenses.ts`. The parsing logic is already isolated to those two files.

## Other deliberate choices

- **Receipt images** are served from `GET /api/receipts/:filename` behind the same auth gate. The
  filename is validated against path traversal in `services/receipt/storage.ts` — basename equality,
  rejection of separators and null bytes, and an independent `path.resolve` containment check.
- **Tokens** are HMAC-SHA256 with a 7-day expiry, held in browser storage, with no server-side
  revocation list and no inactivity timeout. Changing `AUTH_SECRET` (or `APP_PASSWORD`) invalidates
  every outstanding token, which is the only "sign out everywhere" there is. Replacing this with a
  cookie, a per-session identifier and an idle timeout is specified in `docs/hosted-security.md` §2.2
  and not yet built.
- **CSRF** is handled structurally rather than with a token: the credential is a bearer header that
  browsers do not attach to cross-origin requests on their own, and CORS is an exact-match allowlist
  that is empty by default. Moving the token into a cookie would change that trade and requires the
  anti-forgery control named in the same section.
- **The backend process runs unprivileged.** `backend/docker-entrypoint.sh` starts as root only long
  enough to `chown` the bind-mounted `./data` volume — whose ownership comes from the host and so
  cannot be baked into the image — then `exec`s the server as the `node` user via `su-exec`. Declaring
  `USER node` outright instead would break every existing install with `SQLITE_CANTOPEN` on upgrade.
  The nginx container follows the standard model: the master process binds port 80 as root and its
  workers run as the unprivileged `nginx` user.
- **Backups are not automated,** but the database runs in WAL mode so it can be snapshotted live with
  `sqlite3 data/expenses.db ".backup 'backup/expenses.db'"`. Back up the whole `data/` directory — it
  holds the receipt images too, and WAL adds `-wal`/`-shm` sidecars that make a bare copy of
  `expenses.db` unsafe. Recipes are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
