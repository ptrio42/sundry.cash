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
| `VITE_API_BASE_URL`  | frontend  | `/api`              | Override only for non-proxied setups      |

See `backend/.env.example` and `frontend/.env.example`.

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
only layer that can reclaim it, took the backend from 459 MB to **447 MB** with
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
