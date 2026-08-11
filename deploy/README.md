# Hosting several instances on one host

Sundry is not multi-tenant and this directory does not make it so. One instance
is one user, one container pair, one SQLite file, one password. A "hosted
account" is therefore a container with its own volume and its own password —
which is exactly what makes onboarding a customer by hand viable long before
self-serve accounts exist.

Everything here is host configuration, not application code: an env file per
instance, one front proxy, and a cron script for the demo.

> This will be folded into [`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md) once the
> demo-seed branch lands — both branches were editing that file.

## What is in here

| File | What it is |
| --- | --- |
| `instance.env.example` | Template for one instance. Copy to `deploy/<name>.env`. |
| `Caddyfile` | Front proxy: hostname → instance port, with automatic TLS. |
| `reset-demo.sh` | Nightly wipe-and-reseed for the public demo. |

**`deploy/*.env` is gitignored and must stay that way.** A filled-in instance
file holds a real password; only the `.example` belongs in git. The repo's hard
rule about `.env` files exists for the database's sake, and a hosting directory
is exactly where it gets forgotten.

## One instance

```bash
cp deploy/instance.env.example deploy/acme.env
$EDITOR deploy/acme.env                    # COMPOSE_PROJECT_NAME, INSTANCE, HTTP_PORT, DATA_DIR, APP_PASSWORD
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

### Set a password on anything with a hostname

With no `APP_PASSWORD` the API is fully open. That is deliberate for localhost
and wrong for a public name — someone who finds the port can read the ledger,
add to it, or wipe it. Set `APP_PASSWORD`, and set `AUTH_SECRET` to an
independent random value so a leaked token is not also an oracle for the
password:

```bash
openssl rand -base64 24
```

The one instance that legitimately runs open is the demo, because there is
nothing in it — see below.

## The front proxy and TLS

One Caddy maps hostnames to instance ports. Caddy is here because it obtains and
renews Let's Encrypt certificates by itself: adding a customer is a four-line
block and a reload, not a certificate task.

```
sundry.cash          → landing page (static files)
demo.sundry.cash     → the demo instance's port
<customer>.sundry.cash → that customer's port
```

Edit [`Caddyfile`](Caddyfile) — real hostnames, real email, one block per
instance — then:

```bash
caddy run --config /srv/sundry/deploy/Caddyfile
```

Set `BIND_ADDR=127.0.0.1` in every proxied instance's env file. Without it the
container also publishes on every interface, so the app answers on a bare port
over plain HTTP and the certificate is decoration.

> **Known limitation: the login rate limiter sees the proxy, not the client.**
> The backend sets `trust proxy: 1` for the bundled nginx. Behind Caddy there are
> two hops, so `express-rate-limit` counts every failed login against one
> address. Ten wrong passwords from anyone then lock out everyone for fifteen
> minutes — annoying rather than dangerous, and it needs a code change
> (`server.ts`) to fix properly. Worth knowing before the first customer.

## The demo instance

The demo adds two flags on top of a normal instance, and
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
cp deploy/instance.env.example deploy/demo.env   # project/INSTANCE=demo, HTTP_PORT=8848, no password
docker compose -f docker-compose.yml -f docker-compose.demo.yml \
  --env-file deploy/demo.env up -d
```

### Nightly reset

[`reset-demo.sh`](reset-demo.sh) stops the backend, deletes the database file
(and its `-wal`/`-shm` sidecars), runs the seed and starts the backend again.
It reads `DB_PATH` from `deploy/demo.env`, because the seed script refuses to
run without an explicit one — its default would be a real ledger.

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
