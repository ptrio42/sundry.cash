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

## Access from other devices (phones on your LAN)

The frontend container publishes port **8847** on all interfaces, so once the
stack runs on an always-on machine (home server, NAS, spare laptop),
every device on the same network shares one database:

1. Find the host machine's LAN IP (e.g. `ipconfig getifaddr en0` on macOS,
   `hostname -I` on Linux) — say `192.168.1.20`.
2. On any phone/laptop on the network, open **`http://192.168.1.20:8847`**.
3. On a phone, use the browser's **Add to Home Screen** — the app installs as a
   full-screen PWA and **Scan Receipt** opens the camera directly. Receipt photos
   up to 10 MB are accepted (nginx `client_max_body_size` is set to 12 MB).

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

## The public demo instance

`sundry.cash` serves a throwaway ledger produced by `backend/src/scripts/seed.ts`
— a few hundred fictional expenses over eighteen months, generated relative to
the day it runs so the last 30 days always contain spending:

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
