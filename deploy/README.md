# Hosting several instances on one host

The guide that used to live here has moved to
[`docs/DEPLOYMENT.md` § Hosting several instances on one host](../docs/DEPLOYMENT.md#hosting-several-instances-on-one-host)
— it was written here while two branches were editing that file, and both have
landed. This directory keeps only the host-configuration files themselves:

| File | What it is |
| --- | --- |
| `instance.env.example` | Template for one instance. Copy to `deploy/<name>.env`. |
| `Caddyfile` | Front proxy: hostname → instance port, with automatic TLS. |
| `reset-demo.sh` | Nightly wipe-and-reseed for the public demo. |

**`deploy/*.env` is gitignored and must stay that way.** A filled-in instance
file holds a real password; only the `.example` belongs in git.
