# Tally Sync — Monorepo

| App | Path | Description |
|---|---|---|
| `@tally-sync/desktop` | `apps/desktop` | Electron — Tally fetch, push to Medusa |
| `@tally-sync/medusa` | `apps/medusa` | Medusa 2 (admin + catalog) **and** Tally sync HTTP API |
| `@tally-sync/sync-service` | `apps/sync-service` | Deprecated — routes moved into Medusa |

## Setup

```bash
npm install
cp apps/medusa/.env.example apps/medusa/.env   # DATABASE_URL → tally_sync (no ?schema=)
createdb tally_sync                            # if needed
npm run prisma:migrate -w @tally-sync/medusa   # only if Prisma tables are missing
npm run medusa:migrate
npm run medusa:user -- -e admin@localhost -p 'ChangeMe1!'
npm run create-key -- "my laptop"              # tsy_… for the desktop
```

Desktop: `apps/desktop/.env`

```
SYNC_SERVICE_URL=http://localhost:9000
SYNC_SERVICE_KEY=tsy_…
TALLY_SOURCE=mock
```

## Running

```bash
npm run medusa          # http://localhost:9000  admin at /app
npm run desktop:mock
```

## Tally sync API (on Medusa)

Same paths as the old Express service. Header: `x-api-key`.

- `GET  /health` — Postgres check (no auth)
- `POST /sync/stock` — `{ company, tallyHost, syncedAt, trigger, items[] }` → Medusa variant inventory by SKU (`apps/medusa/src/sync/tally-to-medusa.config.ts`)
- `GET  /sync/runs`
- `GET  /export/changes?since=`

Prisma schema: `apps/medusa/prisma`. Explore: `npm run studio -w @tally-sync/medusa`.
