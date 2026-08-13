# Deployment

This app ships as two containers — an Express/SQLite backend and an nginx-served
React frontend that reverse-proxies `/api` to the backend.

## Run with Docker Compose (recommended)

```bash
docker compose up --build
```

- Frontend: <http://localhost:8847>
- The frontend calls the API via the relative `/api` path; nginx proxies it to
  the backend container, so there is nothing to configure.
- Data persists in `./data` on the host (bind-mounted to the backend's
  `/app/data`).

To stop: `docker compose down` (add `-v` to also drop the named volume).

Both containers declare a healthcheck, so `docker compose up -d --wait` returns
only once the app is actually serving — use it if a deploy gates on health. Both
probes address **`127.0.0.1`**, not `localhost`: the busybox `wget` in these
images resolves `localhost` to `[::1]` first, and nginx listens on IPv4 only, so
a probe written the other way reported the frontend `unhealthy` forever while it
served every request fine.

## Access from other devices (phones on your LAN)

The frontend container publishes port **8847** on all interfaces, so once the
stack runs on an always-on machine (home server, NAS, spare laptop),
every device on the same network shares one database:

1. Find the host machine's LAN IP (e.g. `ipconfig getifaddr en0` on macOS,
   `hostname -I` on Linux) — say `192.168.1.20`.
2. On any phone/laptop on the network, open **`http://192.168.1.20:8847`**.
3. On a phone, use the browser's **Add to Home Screen** — the app installs as a
   full-screen PWA; tap the **+** and choose **Scan a receipt** to go straight to
   the camera. Receipt photos up to 10 MB are accepted (nginx
   `client_max_body_size` is set to 12 MB).

All devices talk to the same backend and the same SQLite database in `./data`,
so expenses added from any phone show up everywhere — one shared "bucket".

> **Recommended for a shared bucket:** set `APP_PASSWORD` on the backend so a
> device on the network can't add or wipe expenses without the password. Auth is
> off by default (open on a trusted LAN); setting the variable turns it on.

## Configuration

| Variable             | Where     | Default             | Purpose                                   |
| -------------------- | --------- | ------------------- | ----------------------------------------- |
| `PORT`               | backend   | `5000`              | API listen port                           |
| `DB_PATH`            | backend   | `<cwd>/data/…`      | SQLite file location                      |
| `APP_PASSWORD`       | backend   | unset (API open)    | Enables auth; required for anything with a public hostname |
| `AUTH_SECRET`        | backend   | unset (falls back to the password) | Independent token-signing key — `openssl rand -hex 32` |
| `AUTH_REQUIRED`      | backend   | `false`             | Fail closed: no password ⇒ refuse to boot, guarded routes answer 503. Set on any instance a stranger can reach |
| `TRUST_PROXY`        | backend   | `1`                 | Proxies that append to `X-Forwarded-For`: 1 = bundled nginx, 2 = a front proxy in front of it |
| `CORS_ORIGINS`       | backend   | empty (allow nothing) | Cross-origin callers, comma-separated. Empty is correct for every setup here |
| `DEMO_MODE`          | backend   | `false`             | The UI shows a fictional-data banner      |
| `RECEIPTS_ENABLED`   | backend   | `true`              | Off ⇒ `/api/receipts` answers 403 and the Scan tab disappears |
| `VITE_API_BASE_URL`  | frontend  | `/api`              | Override only for non-proxied setups      |

See `backend/.env.example`, `frontend/.env.example` and
[`deploy/instance.env.example`](../deploy/instance.env.example) — the last one
documents every auth knob in detail, with the generation commands.

## Serving `frontend/dist/` with your own web server

**The security headers do not travel with the build output.** The CSP, HSTS,
`X-Frame-Options` and the rest of the SPA's response headers live in
[`frontend/security-headers.conf`](../frontend/security-headers.conf), and the
only thing that ships them is the bundled nginx image —
`frontend/Dockerfile` copies that file into the container as an nginx snippet.
Serve `frontend/dist/` with your own Apache, Caddy or nginx and you get **no
security headers at all**: no CSP, no HSTS, nothing. The app will work; it just
loses every protection that file provides.

If you bring your own server, port the headers yourself and treat
`frontend/security-headers.conf` as the reference set — its comments explain
each value, including the two CSP hashes that admit `index.html`'s inline
blocks. Two traps to carry over:

- The API responses must **not** get these headers a second time: Express sets
  its own (see `backend/src/config/security.ts`), so whatever proxies `/api`
  must leave them alone or every API response carries two CSP headers.
- If you use nginx, remember `add_header` in a `location` **replaces** all
  headers inherited from the server block — which is exactly why the bundled
  config `include`s the snippet per location.

## Hosting several instances on one host

Sundry is not multi-tenant and this section does not make it so. One instance
is one user, one container pair, one SQLite file, one password. A "hosted
account" is therefore a container with its own volume and its own password —
which is exactly what makes onboarding a customer by hand viable long before
self-serve accounts exist.

Everything you need is host configuration, not application code: an env file
per instance (template in
[`deploy/instance.env.example`](../deploy/instance.env.example)), one front
proxy ([`deploy/Caddyfile`](../deploy/Caddyfile)), and a cron script for the
demo ([`deploy/reset-demo.sh`](../deploy/reset-demo.sh)).

**`deploy/*.env` is gitignored and must stay that way.** A filled-in instance
file holds a real password; only the `.example` belongs in git. The repo's hard
rule about `.env` files exists for the database's sake, and a hosting setup is
exactly where it gets forgotten.

### One instance

```bash
cp deploy/instance.env.example deploy/acme.env
$EDITOR deploy/acme.env                    # COMPOSE_PROJECT_NAME, INSTANCE, HTTP_PORT, DATA_DIR, APP_PASSWORD, AUTH_SECRET
docker compose --env-file deploy/acme.env up -d
```

The env file carries `COMPOSE_PROJECT_NAME` itself (verified against Compose
v5.0.1), so the project name travels with `--env-file` instead of having to be
retyped in front of every command — get that wrong once on a `down` and you have
stopped somebody else's instance. The explicit form still works if you prefer
it:

```bash
COMPOSE_PROJECT_NAME=acme docker compose --env-file deploy/acme.env up -d
```

That project name namespaces everything Compose creates — the network, the
volumes, the internal service names. It does **not** namespace two things, and
both are host-wide:

- **`container_name`**, which comes from `INSTANCE` (`acme-backend`,
  `acme-frontend`). Two instances that both leave it at the default collide with
  "container name already in use".
- **the published port**, which comes from `HTTP_PORT`. Second instance, second
  port.

Add `DATA_DIR` (one directory per instance — nothing is ever shared) and you
have the four variables that must differ. The rest have defaults, and those
defaults are the original single-instance install: `docker compose up --build`
with no env file still gives you `sundry-backend`, `./data` and port 8847.

Day-to-day, pass the same env file to every command — it is what tells Compose
which project you mean:

```bash
docker compose --env-file deploy/acme.env logs -f backend
docker compose --env-file deploy/acme.env down
```

### Auth on anything with a hostname

With no `APP_PASSWORD` the API is fully open. That is deliberate for localhost
and wrong for a public name — someone who finds the port can read the ledger,
add to it, or wipe it. Three variables, and a public instance sets all three:

- `APP_PASSWORD` — the password itself: `openssl rand -base64 24`.
- `AUTH_SECRET` — an independent token-signing key: `openssl rand -hex 32`.
  Left empty, tokens are signed with the password itself, and one captured
  token becomes an offline, unthrottled cracker for it.
- `AUTH_REQUIRED=true` — turns the opt-in into a requirement. If the password
  or the secret ever fails to resolve, the backend refuses to boot and every
  guarded route answers 503 instead of quietly serving the ledger open.

The template sets `AUTH_REQUIRED=true` already, so a copied env file fails
loudly until the two secrets are filled in. The one instance that legitimately
runs open is the demo, because there is nothing real in it — see below.

### The front proxy and TLS

One Caddy maps hostnames to instance ports. Caddy is here because it obtains and
renews Let's Encrypt certificates by itself: adding a customer is a four-line
block and a reload, not a certificate task.

```
demo.<your-domain>       → the demo instance's port
<customer>.<your-domain> → that customer's port
```

Edit [`deploy/Caddyfile`](../deploy/Caddyfile) — real hostnames, real email, one
block per instance — then:

```bash
caddy run --config /srv/sundry/deploy/Caddyfile
```

Two settings make a proxied instance correct, and both live in its env file:

- **`BIND_ADDR=127.0.0.1`** — without it the container also publishes on every
  interface, so the app answers on a bare port over plain HTTP and the
  certificate is decoration.
- **`TRUST_PROXY=2`** — behind Caddy there are two proxies appending to
  `X-Forwarded-For` (Caddy, then the bundled nginx). At the default `1` the
  login rate limiter counts every visitor as the proxy's address, so one
  stranger's failed logins throttle the owner. See
  `backend/src/config/security.ts` for the values.

### The demo instance

The seed script itself — what it generates and its refusals — is covered in
*The public demo instance* below; this section is the container mechanics. The
demo adds two flags on top of a normal instance, and
[`docker-compose.demo.yml`](../docker-compose.demo.yml) is the whole difference:

- `DEMO_MODE=true` — the UI shows a banner saying the data is fictional and
  resets nightly. **The banner is what makes the demo honest, not distorted
  data:** the seed uses believable amounts and real shop names on purpose, so
  the disclosure has to live in the UI.
- `RECEIPTS_ENABLED=false` — `/api/receipts` answers 403 and the Scan Receipt
  tab disappears. OCR is Tesseract on this machine's CPU, and the demo has no
  password: an open scan endpoint is a free compute service for the internet.

The two flags are independent in the code. A customer instance can switch
uploads off without pretending to be a demo, and a demo on a laptop can leave
them on; only this compose file sets both.

> `RECEIPTS_ENABLED=false` gates the whole `/api/receipts` router, reading
> included — the flag means "this instance does not do receipts", not "it has
> stopped accepting new ones". On an instance that already has receipt photos,
> turning it off makes those images unviewable too (the table says "Could not
> load the receipt image"; nothing is deleted, and turning the flag back on
> restores them). Fine for a demo, worth knowing before you set it on a
> customer's box.

The demo stays **writable** on purpose — a visitor who cannot add an expense has
not tried the product. That includes the Wipe Database button, so a bored
visitor can empty the ledger until the next reset. If that turns out to matter
once the demo is public, run `reset-demo.sh` more often than nightly; hiding the
button is a code change and a worse demo.

```bash
cp deploy/instance.env.example deploy/demo.env
$EDITOR deploy/demo.env   # project/INSTANCE=demo, HTTP_PORT=8848, no password — and AUTH_REQUIRED=false
docker compose -f docker-compose.yml -f docker-compose.demo.yml \
  --env-file deploy/demo.env up -d
```

> The template ships with `AUTH_REQUIRED=true`, which is right for a customer
> and fatal for a passwordless demo — the backend will refuse to boot. Set
> `AUTH_REQUIRED=false` in `demo.env`; the demo is the one instance that runs
> open on purpose.

#### Nightly reset

[`deploy/reset-demo.sh`](../deploy/reset-demo.sh) stops the backend, deletes the
database file (and its `-wal`/`-shm` sidecars), runs the seed and starts the
backend again. It reads `DB_PATH` from `deploy/demo.env`, because the seed
script refuses to run without an explicit one — its default would be a real
ledger.

```bash
chmod +x deploy/reset-demo.sh          # once
0 4 * * * /srv/sundry/deploy/reset-demo.sh >> /var/log/sundry-demo-reset.log 2>&1
```

The seed runs as **build output**, not through `ts-node`: the image's command is
`node dist/server.js`, so the reset calls `node dist/scripts/seed.js`. The script
checks that file exists and fails loudly if it does not — a demo that silently
stops resetting looks fine for a week and then reads as abandoned.

Point `ENV_FILE` at another file to reset a different instance, if you ever want
a second demo:

```bash
ENV_FILE=/srv/sundry/deploy/demo-pl.env /srv/sundry/deploy/reset-demo.sh
```

## Receipt scanning and OCR language data

`RECEIPTS_ENABLED` defaults to `true`, and the image is built so that promise
holds on a machine that has never run the app before.

Tesseract needs a `*.traineddata` file per language. The two the app defaults to
— `pol` and `eng`, ~5.6 MB gzipped — are **baked into the backend image**: the
Dockerfile runs `npm run tessdata`, which copies them out of the
`@tesseract.js-data` packages (devDependencies, so they arrive with the same
`npm ci` and the same `package-lock.json` integrity check as everything else)
into `/app/tessdata`, and then prunes the packages away. Nothing is fetched at
runtime and nothing is fetched from a second network host at build time. The
image did not grow: clearing npm's cache inside the `npm ci` layer, which is the
only layer that can reclaim it, took the backend from 463 MB to **451 MB** with
the language data now inside it.

That replaces a download on first scan, which is where this used to break: with
no local copy, tesseract.js fetches the data from a CDN *inside its worker
thread*, and when that fetch failed the library never settled the promise it had
returned — the scan hung until nginx answered `504 Gateway Time-out` and
`data/tesseract/` stayed empty, so every retry did it again. The extractor now
imposes its own ceilings and turns a failure into a 500 with a message
(`src/services/receipt/tesseract.ts`).

Three consequences worth knowing:

- **Running outside Docker**, `npm run install:all` does *not* stage the data —
  run `npm run tessdata --prefix backend` once if you want a laptop to scan
  offline. Without it the first scan still works, by downloading.
- **Another language** (`RECEIPT_OCR_LANGS=deu`) is not in the image, so it is
  downloaded and cached under `TESSERACT_CACHE_PATH`. The bundle is only used
  when it covers *every* requested language — tesseract.js reads one directory
  and fails the whole worker on a language it cannot find there, rather than
  falling back per language. To bundle more, add `@tesseract.js-data/<lang>` to
  `backend/package.json` and rebuild.
- **A strictly no-egress instance** should set `TESSERACT_LANG_PATH` explicitly
  at the folder holding its `*.traineddata.gz` (`/app/tessdata` in the image).
  Set, it is never second-guessed: a language missing from that folder is an
  error, not a reason to reach for the network.

## The public demo instance

`demo.sundry.cash` serves a throwaway ledger produced by `backend/src/scripts/seed.ts`
— a few hundred fictional expenses over eighteen months, generated relative to
the day it runs so the last 30 days always contain spending (the apex
`sundry.cash` serves the static landing page from `/srv/sundry/landing` — see
`deploy/Caddyfile`):

```bash
DB_PATH=./data/demo.db npm run seed --prefix backend
```

The script refuses to run without an explicit `DB_PATH`, refuses one that
resolves to `<cwd>/data/expenses.db`, and refuses a database that already holds
expenses unless it is passed `--force` (which wipes and reports the count). It
is deterministic: the same anchor produces the same ledger, so a reset does not
move the demo under anyone's feet.

Three rules for running it in public:

- **Reset on a schedule.** Drop the file, re-seed, restart. Daily is enough.
  Delete the `-wal` / `-shm` sidecars along with the database, exactly as in
  *Backups and restore* below.

  ```bash
  docker compose stop backend
  rm -f data/demo.db data/demo.db-wal data/demo.db-shm
  DB_PATH=./data/demo.db npm run seed --prefix backend
  docker compose start backend
  ```

- **Disable or hard rate-limit receipt upload.** With no `APP_PASSWORD` the API
  is fully open by design, and OCR is CPU on your box: an open `/api/receipts`
  endpoint is a free compute service for the internet.
- **Keep it separate.** Its own `DB_PATH`, its own container, its own volume. It
  shares nothing with any real instance.

## Networking / "no internet" note

An earlier revision set `dns: 0.0.0.0` on the compose services to block internet
access. That was removed: it also disabled Docker's embedded DNS, so nginx could
no longer resolve the `backend` service name and the app failed to start. For a
genuine no-egress posture, put the backend on a dedicated `internal: true`
network (which blocks outbound routing while still resolving service names) and
keep only the frontend on a network with a published port.


## Backups and restore

Everything Sundry owns lives in one directory: `./data` (the compose bind mount,
`/app/data` inside the container). It holds the SQLite database **and** the
receipt images — so `data/` is the unit of backup, not `expenses.db` alone.

The database runs in **WAL mode**, which means two sidecar files sit next to it:
`expenses.db-wal` and `expenses.db-shm`. Copying only `expenses.db` while the
app is running can therefore lose the most recent writes.

**The safe way — an online backup, no downtime:**

```bash
sqlite3 data/expenses.db ".backup 'backup/expenses.db'"
```

`.backup` takes a consistent snapshot of a live database, WAL included. Pair it
with the images:

```bash
mkdir -p backup && sqlite3 data/expenses.db ".backup 'backup/expenses.db'" && cp -r data/receipts backup/
```

**The simple way — stop first:**

```bash
docker compose stop backend && cp -r data backup-$(date +%F) && docker compose start backend
```

**Restore:** stop the backend, put the files back at `data/`, delete any stale
`-wal` / `-shm` sidecars, then start it again.

```bash
docker compose stop backend
rm -f data/expenses.db-wal data/expenses.db-shm
cp backup/expenses.db data/expenses.db && cp -r backup/receipts data/
docker compose start backend
```

Schema migrations run automatically and idempotently on boot, so restoring a
database from an older version of the app is fine — it will be brought up to
date the first time the backend starts.

There is no scheduled-backup mechanism built in; wire the command above into
cron or your NAS's own backup tooling.
