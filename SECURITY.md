# Security

Sundry is a **single-user, self-hosted** application. It is designed to run on a machine you control —
localhost, a home server, or a NAS on your own LAN — and it stores real financial data in a local
SQLite file. Everything below assumes that model.

## Reporting a vulnerability

Open a GitHub issue. If you would rather not disclose publicly, use GitHub's private
[security advisory](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
flow on this repository. This is a personal project, not a product with an on-call rota — expect a
best-effort reply, not an SLA.

## The two things that matter most when you deploy this

**1. Authentication is off unless you turn it on.** With no `APP_PASSWORD` set, every API route is
reachable with no credentials — including `DELETE /api/expenses/all`. That default exists so a
localhost install needs zero setup, and it is a bad default the moment the port is reachable by
anyone else. **Set `APP_PASSWORD` before exposing this beyond your own machine**, and set
`AUTH_SECRET` to an independent random value so a leaked token is not also a password oracle.

**2. Do not put this on the public internet.** There is no multi-tenancy, no account model, no audit
log, and no CSRF protection beyond the bearer-token scheme. A LAN or a VPN/Tailscale network is the
intended blast radius.

Login is rate-limited to 10 failed attempts per 15 minutes per IP (successful logins do not count).
Behind the bundled nginx the app trusts one proxy hop so the limit applies per client rather than to
the whole network.

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

So triggering either advisory requires **uploading a malicious spreadsheet to your own instance**.
With `APP_PASSWORD` set, that means an authenticated request; without it, anyone who can reach the
port. Uploads are capped at 5 MB, which bounds the ReDoS impact to one request handler on a
single-user server. The frontend does not depend on `xlsx` at all — CSV export is generated in the
browser without it.

**The honest summary:** for the intended deployment (one person, own hardware, own files) this is a
low practical risk, and it is disclosed here rather than left for you to discover in a red Dependabot
alert. If you intend to import spreadsheets you did not create, that changes the calculation.

**Migration options**, in rough order of effort: vendor the current SheetJS build from
`cdn.sheetjs.com` instead of npm; or replace it with `exceljs` in `routes/import.ts` and
`routes/expenses.ts`. The parsing logic is already isolated to those two files.

## Other deliberate choices

- **Receipt images** are served from `GET /api/receipts/:filename` behind the same auth gate. The
  filename is validated against path traversal in `services/receipt/storage.ts` — basename equality,
  rejection of separators and null bytes, and an independent `path.resolve` containment check.
- **Tokens** are HMAC-SHA256 with a 7-day expiry and no server-side revocation list. Changing
  `AUTH_SECRET` (or `APP_PASSWORD`) invalidates every outstanding token.
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
