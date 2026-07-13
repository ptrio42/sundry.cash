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

## Umbrel packaging (self-hosting) — status

The repo includes an Umbrel app manifest (`umbrel-app.yml`) and packaging
scripts. **Known limitation:** Umbrel installs store apps by *pulling* images,
not by building from source, so the Umbrel compose must reference published
images (e.g. `ghcr.io/<user>/expense-tracker-backend:<tag>`) rather than `build:`
directives. Publishing those images via CI and wiring them into the manifest is
the remaining step before this installs cleanly on a stock Umbrel. Until then,
use the Docker Compose flow above.
