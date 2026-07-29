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
