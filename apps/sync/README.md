# apps/sync — Tally → Medusa sync CLI

An interactive CLI that pulls stock from a **live Tally** company (read-only)
and uploads it to **Medusa**, in explicit stages:

```
fetch  (Tally  -> local JSON)
push   (local JSON -> Medusa)
```

- **fetch** connects to Tally, lets you pick a company, and saves the stock as
  local JSON (`data/fetched/<company>.json` + `data/fetched/latest.json`).
- **push** reads that JSON, builds a deterministic Medusa plan (SKU + product
  payload) and uploads it. Defaults to a **dry-run**; pass `--commit` to write.

## Configuration (env)

All connection details live in `apps/sync/.env` (see `.env.example`). Flags
override env. Medusa admin creds are also read from `apps/medusa/.env`.

```env
TALLY_HOST=103.171.134.98:17942     # live Tally XML server ip:port (read-only)
MEDUSA_URL=http://localhost:9000
MEDUSA_ADMIN_EMAIL=avi@example.com
MEDUSA_ADMIN_PASSWORD=roserose
SYNC_CURRENCY=inr
```

If Tally is unreachable or has no company open, the CLI exits with a clear
error (connection refused / timeout / no company).

## Usage

```bash
cd apps/sync

# Interactive — pick a stage (fetch / push / all), then a company / brand
node bin/sync.js

# Stage 1: fetch from Tally into local JSON
node bin/sync.js --step fetch                       # pick company interactively
node bin/sync.js --step fetch --company "RR FOOTWEAR"

# Stage 2: push the last fetch to Medusa (dry-run, prints the plan)
node bin/sync.js --step push
node bin/sync.js --step push --brand Walkaroo       # only one brand
node bin/sync.js --step push --brand Walkaroo --commit   # actually upload

# Both stages in one go
node bin/sync.js --step all
```

npm shortcuts (from `apps/sync`): `npm run fetch`, `npm run push`,
`npm run push:commit`.

### Flags

| Flag | Meaning | Default |
|---|---|---|
| `--step` | `fetch` \| `push` \| `all` | interactive picker |
| `--company` / `--comp` | Tally company | interactive (auto if only one open) |
| `--brand` | only sync this Tally group (e.g. `Walkaroo`) | all |
| `--host` | live Tally `ip:port` | `TALLY_HOST` |
| `--from` | explicit fetched JSON to push | `data/fetched/latest.json` |
| `--commit` / `--push` | actually write to Medusa | off (dry-run) |
| `--limit N` | cap items | all |
| `--concurrency N` | parallel push batches | 5 |
| `--email` / `--password` | Medusa admin | env |
| `--url` | Medusa base URL | `MEDUSA_URL` |
| `--currency` | price currency | `SYNC_CURRENCY` or `inr` |

## SKUs & understanding each company's names

Tally has no SKU, so the pipeline **synthesizes a deterministic one** and parses
each company's naming convention. That logic is the shared, config-driven parser
in `apps/desktop/tally/` (`shoeParser.js` + `groupConfigs.js`) — a single source
of truth used by both the desktop app and this CLI.

- SKU shape: `RRF-<BRAND>-<MODEL>-<...>-MRP<paise>`
  (e.g. `RRF-WALKAROO-10574-GENTS-OGRN-MRP65900`).
- Each Tally stock **group** (Walkaroo, Campus Shoes, ADDA, AQUALITE, WOODLAND,
  SHOE FACTORY, …) has a parse strategy + which fields compose the SKU.
- Only groups marked `sync: true` are uploaded; unconfigured groups (Relaxo,
  OTHER ITEM, Nike, …) are **skipped** and reported, never silently synced.
- Only items with stock (`quantity > 0`) become plans.

Add or change a company by editing `apps/desktop/tally/groupConfigs.js`.

## The run log (observability)

Every run writes to `apps/sync/data/runs/<runId>/`:
- `events.jsonl` — every step, one JSON per line (full audit trail)
- `progress.json` — current step + counts (a UI can poll this)
- `summary.json` — final status + stats
- `plan.json` — the exact transform plan (push runs)
- `fetched.json` — the staged fetch (fetch runs)

State for diffs is stored in `apps/sync/data/state/`.

## Notes

- Tally access is **read-only** — the CLI only ever sends `Export` requests.
- `data/` and `.env` are gitignored.
- Push is idempotent by SKU: existing SKUs get a stock update, new SKUs create
  the product + variant, with per-item failure isolation.
