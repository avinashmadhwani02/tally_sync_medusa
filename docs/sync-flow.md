# Tally Sync — Entity Flow Map

How each entity flows from Tally → desktop app → sync-service → database.

> **Single source of truth in code:** the per-entity request/parse mapping lives
> in `apps/desktop/tally/entities.js` (the entity registry). To add an entity,
> add an entry there — the generic request builder, parser and fetcher in
> `apps/desktop/tallyClient.js` (`collectionXml`, `parseEntityRows`,
> `fetchEntity`) handle the rest. This doc is a human-readable snapshot.

Currently only **Stock** is implemented; the structure is designed so future
entities (ledgers, vouchers, etc.) can be added as new rows/columns.

---

## 1. Stock Items

### Step 1 — Fetch from Tally (request)

- **Where:** `apps/desktop/tallyClient.js` → `stockXml(companyName)` (called by `fetchStock()`)
- **Transport:** `POST http://{ip}:{port}` (Tally XML Server, default port 9000), `Content-Type: text/xml`
- **Request XML:**

```xml
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>StockItems</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>{companyName}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="StockItems" ISMODIFY="No">
            <TYPE>StockItem</TYPE>
            <FETCH>NAME, PARENT, BASEUNITS, CLOSINGBALANCE, PARTNUMBER</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>
```

- **Key knobs:**
  | Piece | Meaning |
  |---|---|
  | `<TYPE>StockItem</TYPE>` | Tally object type being exported |
  | `<FETCH>…</FETCH>` | Tally fields requested |
  | `SVCURRENTCOMPANY` | Scopes the export to the open company |

### Step 2 — Parse Tally XML → JSON

- **Where:** `apps/desktop/tallyClient.js` → `parseStockItems(parsed)`
- **Parser:** `fast-xml-parser` (`ignoreAttributes: false`, prefix `@_`)
- **Response path:** `ENVELOPE.BODY.DATA.COLLECTION.STOCKITEM` (array via `asArray`)
- **Field mapping:**

| Tally field | JSON key | Notes |
|---|---|---|
| `NAME` (or `@_NAME`) | `name` | required |
| `PARENT` | `parent` | stock group / category |
| `BASEUNITS` | `unit` | |
| `CLOSINGBALANCE` | `closingQty` | |
| `PARTNUMBER` | `partNumber` | used for SKU resolution server-side |

Resulting item shape:

```json
{ "name": "...", "parent": "...", "unit": "...", "closingQty": "...", "partNumber": "..." }
```

`fetchStock()` returns `{ ok, cmpInfo, items, rawXml }`.

### Step 3 — Push to sync-service

- **Where:** `apps/desktop/main.js` → IPC `tally:stock` → `syncStock()` (see `apps/desktop/main.js`)
- **Endpoint:** `POST /sync/stock`
- **Auth:** `x-api-key` header (required, validated by `requireApiKey`)
- **Payload:**

```json
{
  "company": "…",
  "tallyHost": "ip:port",
  "syncedAt": "ISO timestamp",
  "trigger": "manual | auto",
  "items": [{ "name": "…", "parent": "…", "unit": "…", "closingQty": "…", "partNumber": "…" }]
}
```

### Step 4 — Persist (sync-service)

- **Where:** `apps/sync-service/src/server.js` (`POST /sync/stock`) → `apps/sync-service/src/routes/stock.js` → `upsertStock()`
- **Behavior:**
  1. Upsert `Company` by name
  2. Create `SyncRun` record (trigger, itemCount, tallyHost, syncedAt)
  3. For each item (keyed by `companyId + name`): insert or update
     `StockItem` (parent, unit, closingQty, syncedAt, lastRunId)
  4. SKU resolution (`resolveSku`): keep existing SKU → else Tally `partNumber`
     (slugified, if free) → else `slugified-name-<random4hex>`
- **Response:** `{ ok, runId, companyId, tallyHost, trigger, itemCount, inserted, updated }`
- **On failure:** `recordFailedRun()` logs a `failed` SyncRun.

### Related endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health` | service + DB check (no auth) |
| `POST /sync/stock` | ingest stock items (auth) |
| `GET /sync/runs` | sync history, filters: company/trigger/status/limit (auth) |
| `GET /export/changes?since={runId}` | change feed for downstream DBs (auth) |

---

## Template: adding a new entity

1. **Request XML** — add a `xxxXml(companyName)` builder in `apps/desktop/tallyClient.js`
   (change `<ID>`, `<TYPE>`, `<FETCH>`).
2. **Parser** — add `parseXxx(parsed)` mapping Tally fields → JSON keys.
3. **Fetcher** — add `fetchXxx(ip, port, company)` returning `{ ok, items, … }`.
4. **IPC + push** — wire a handler in `apps/desktop/main.js` and POST to `POST /sync/xxx`.
5. **Backend** — add `POST /sync/xxx` in `apps/sync-service/src/server.js`
   plus `upsertXxx()` in `src/routes/xxx.js` and a Prisma model + migration.
