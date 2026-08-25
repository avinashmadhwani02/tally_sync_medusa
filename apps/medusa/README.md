# `@tally-sync/medusa`

Medusa 2 (admin + catalog) and **Tally sync routes**. Postgres database: `tally_sync` (shared with Prisma tables `companies`, `stock_items`, `api_keys`, `sync_runs`).

## Run

```bash
npm run medusa                 # http://localhost:9000/app
npm run create-key -- "laptop" # desktop x-api-key
```

Tally API (from the desktop):

- `POST /sync/stock` — maps Tally rows onto **Medusa inventory** (see `src/sync/tally-to-medusa.config.ts`)
- `GET /sync/runs`
- `GET /health`

Set each variant’s SKU in Admin to the Tally Part Number. Qty like `"29 Nos"` is parsed to `29`. Rows that do not match a variant are returned as `unmatched` and are not written to `stock_items`.

