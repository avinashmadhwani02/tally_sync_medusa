/**
 * Shared Tally -> Medusa sync engine used by the per-company scripts
 * (sync-campus.js / sync-adda.js / sync-walkaroo.js).
 *
 * A company script calls:
 *   const { runSync } = require("./sync-lib")
 *   runSync({ brand: "Campus Shoes" })
 *
 * Brands that have a dedicated module in ./companies (e.g. Walkaroo) are
 * mapped to Medusa products+variants by THAT module — each company owns how
 * its raw Tally rows become catalog data (one product, many colour variants,
 * aggregated quantities, per-company SKU scheme).
 *
 * Brands without a module fall back to the generic one-row-per-product
 * behaviour below.
 */
const fs = require("fs")
const path = require("path")
require("dotenv").config({ path: path.join(__dirname, "..", ".env") })

const { COMPANY_MODULES } = require("./companies")
const log = require("./log")

// ---------- CLI helpers ----------

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      args[key] = /^--(write|dry-run)$/.test(argv[i]) ? true : argv[++i]
    } else args._.push(argv[i])
  }
  return args
}

// ---------- generic helpers ----------

/** Deterministic SKU from Tally parent (brand) + item name. */
function generateSku(parent, name) {
  const norm = (s) =>
    String(s || "")
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toUpperCase()
  return `${norm(parent)}-${norm(name)}`
}

/** Parse closingQty like "12.00 PRS" -> 12 */
function parseQty(closingQty) {
  const m = String(closingQty ?? "").match(/(-?\d+(?:\.\d+)?)/)
  const n = m ? parseFloat(m[1]) : NaN
  return Number.isFinite(n) ? n : null
}

// ---------- legacy brand config map ----------

const BRAND_CONFIG = {
  "Campus Shoes": { parse: parseCampus, titlePrefix: "Campus" },
  ADDA: { parse: parseMrpSuffix, titlePrefix: "ADDA" },
  Walkaroo: { parse: parseWalkaroo, titlePrefix: "Walkaroo" },
}

function resolveBrandConfig(brand) {
  return BRAND_CONFIG[brand] || { parse: parseMrpSuffix, titlePrefix: brand }
}

/** Parse a Tally item name into {title, subtitle, gender, mrp}. */
function parseBrandName(brand, name) {
  const cfg = resolveBrandConfig(brand)
  const parsed = cfg.parse(name) || {
    title: String(name).trim(),
    subtitle: null,
    gender: null,
    mrp: null,
  }
  if (parsed && !parsed.title.startsWith(cfg.titlePrefix)) {
    parsed.title = `${cfg.titlePrefix} ${parsed.title}`.trim()
  }
  return parsed
}

// ---------- per-brand name parsers (legacy / non-module brands) ----------

const GENDER_TOKENS = {
  GENTS: "Men", MEN: "Men", BOYS: "Kids", GIRLS: "Kids", KIDS: "Kids",
  LADIES: "Women", LADY: "Women", WOMEN: "Women",
}

/**
 * Campus: "11G-677-NORTH PLUS_G" / "22C-150K-TOKYO CH_C"
 * model = "11G-677", colorway = rest, gender from _G/_L/_C/_K suffix.
 */
function parseCampus(name) {
  const m = String(name).match(/^([0-9]{1,2}[A-Z][A-Z0-9]?)-([A-Z0-9]+)-(.+)_([GLCK])$/i)
  if (!m) return null
  return {
    title: `Campus ${m[1]}-${m[2]}`,
    subtitle: m[3].trim(),
    gender: { G: "Men", L: "Women", C: "Kids", K: "Kids" }[m[4].toUpperCase()] || null,
    mrp: null,
  }
}

/** ADDA & friends: "AUDI MRP1049" / "APPOLO NAVY MRP 799" */
function parseMrpSuffix(name) {
  const text = String(name).trim()
  let mrp = null
  const withoutMrp = text.replace(/\s*\bMRP\s*(\d+(?:\.\d+)?)\s*$/i, (_, p) => {
    mrp = parseFloat(p)
    return ""
  })
  const words = withoutMrp.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return null
  return {
    title: words[0],
    subtitle: words.slice(1).join(" ") || null,
    gender: null,
    mrp: Number.isFinite(mrp) && mrp > 0 ? mrp : null,
  }
}

/**
 * Walkaroo (legacy fallback): "12305 GENTS PAIR BLWT [MRP-329.00]".
 * New Walkaroo logic lives in ./companies/walkaroo.js.
 */
function parseWalkaroo(name) {
  const text = String(name).trim()
  const mrpM = text.match(/\[\s*MRP[- ]?(\d+(?:\.\d+)?)\s*\]\s*$/i)
  if (!mrpM) return parseMrpSuffix(text)
  const mrp = parseFloat(mrpM[1])
  const rest = text.slice(0, mrpM.index).trim()
  const words = rest.split(/\s+/).filter(Boolean)
  const model = words[0] || text
  let subtitle = words.slice(1).filter((w) => !/^pair$/i.test(w)).join(" ")
  let gender = null
  if (subtitle && GENDER_TOKENS[subtitle.split(/\s+/)[0].toUpperCase()]) {
    gender = GENDER_TOKENS[subtitle.split(/\s+/)[0].toUpperCase()]
    subtitle = subtitle.split(/\s+/).slice(1).join(" ")
  }
  return {
    title: `Walkaroo ${model}`,
    subtitle: subtitle || null,
    gender,
    mrp: Number.isFinite(mrp) && mrp > 0 ? mrp : null,
  }
}
// ---------- API helpers ----------

async function api(medusaUrl, method, url, token, body) {
  const res = await fetch(`${medusaUrl}${url}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = {}
  try { json = text ? JSON.parse(text) : {} } catch { /* keep raw */ }
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${text.slice(0, 400)}`)
  return json
}

/**
 * Ensure a Medusa collection exists for the brand and return its id,
 * matching by title or a deterministic handle.
 */
async function ensureCollection(medusaUrl, token, brand) {
  const handle = String(brand || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  const want = String(brand || "").trim().toLowerCase()
  const existing = await api(medusaUrl, "GET", "/admin/collections?limit=100", token)
  const hit = (existing.collections || []).find(
    (c) =>
      String(c.title || "").trim().toLowerCase() === want ||
      c.handle === handle ||
      c.handle === `${handle}-collection` ||
      c.handle === `${handle}-collection-collection`
  )
  if (hit) return hit.id
  const created = await api(medusaUrl, "POST", "/admin/collections", token, {
    title: brand,
    handle,
    metadata: { tally_source: "collection", source: "tally-sync-script" },
  })
  return created.collection.id
}

// ----------------------------------------------------------------------------
// Plan building — a plan is one Medusa product with one or more variants.
//   { sku, product, stock: { [sku]: qty }, quantity }
// ----------------------------------------------------------------------------

/** Module-based: the company module turns raw rows directly into products. */
function buildPlans(module, items, opts) {
  return module.buildProducts(items, opts).map((product) => ({
    sku: product.variants[0]?.sku || "",
    product,
    stock: product.stock || {},
    quantity: product.stock?.[product.variants[0]?.sku] ?? 0,
  }))
}

/** Legacy fallback (no module): one product per raw Tally row. */
function buildLegacyPlans(brand, exportData, all, lim, currency) {
  const withQty = all.filter((i) => (parseQty(i.closingQty) ?? -1) > 0)
  const base = withQty.length ? withQty : all
  const picked = lim > 0 ? base.slice(0, lim) : base
  return picked.map((item) => {
    const sku = generateSku(item.parent, item.name)
    const parsed = parseBrandName(brand, item.name)
    const qty = parseQty(item.closingQty) ?? 0
    const variant = {
      title: item.name,
      sku,
      allow_backorder: false,
      manage_inventory: true,
      options: { Size: "Free Size" },
      ...(parsed.mrp != null
        ? { prices: [{ amount: Math.round(parsed.mrp * 100), currency_code: currency }] }
        : { prices: [] }),
    }
    return {
      sku,
      quantity: qty,
      stock: { [sku]: qty },
      product: {
        title: parsed.title,
        subtitle: parsed.subtitle,
        handle: sku.toLowerCase(),
        description: `${brand} ${item.name} (synced from Tally ${exportData.company})`,
        status: "published",
        options: [{ title: "Size", values: ["Free Size"] }],
        variants: [variant],
        metadata: {
          tally_parent: item.parent,
          tally_name: item.name,
          tally_unit: item.unit || null,
          tally_mrp: parsed.mrp ?? null,
          tally_gender: parsed.gender,
          source: "tally-sync-script",
        },
      },
    }
  })
}
// ----------------------------------------------------------------------------
// Sync engine
// ----------------------------------------------------------------------------

/**
 * Set (upsert) the stocked quantity for one variant at the default location.
 * Fetches the variant fresh so we always have its inventory item id.
 */
async function setVariantInventory(ctx, productId, sku, qty) {
  const vFull = await api(
    ctx.medusaUrl,
    "GET",
    `/admin/products/${productId}?fields=*variants.inventory_items`,
    ctx.token
  )
  const variant = (vFull.product?.variants || []).find((x) => x.sku === sku)
  if (!variant) throw new Error(`variant "${sku}" not found on product ${productId}`)
  const invItem = variant.inventory_items?.[0]
  const invId = invItem?.inventory_item_id || invItem?.id
  if (!invId) throw new Error(`no inventory item for variant "${sku}"`)
  await api(
    ctx.medusaUrl,
    "POST",
    `/admin/inventory-items/${invId}/location-levels/${ctx.locationId}`,
    ctx.token,
    { stocked_quantity: Math.max(0, qty) }
  )
}

/** Create one product (all variants) and set inventory for each variant. */
async function createPlan(ctx, plan, collectionId) {
  const res = await api(ctx.medusaUrl, "POST", "/admin/products", ctx.token, {
    ...plan.product,
    collection_id: collectionId,
  })
  const product = res.product
  if (!product?.id) throw new Error("product missing after creation")
  for (const v of plan.product.variants) {
    await setVariantInventory(ctx, product.id, v.sku, plan.stock[v.sku] ?? 0)
  }
  return product
}

/** Push one plan's stock for a product that already exists in Medusa. */
async function updatePlan(ctx, plan, existingProduct) {
  // Add any variants the product does not have yet.
  for (const v of plan.product.variants) {
    const present = (existingProduct.variants || []).some((x) => x.sku === v.sku)
    if (!present) {
      await api(ctx.medusaUrl, "POST", `/admin/products/${existingProduct.id}/variants`, ctx.token, {
        ...v,
        prices: v.prices || [],
      })
    }
  }
  for (const v of plan.product.variants) {
    await setVariantInventory(ctx, existingProduct.id, v.sku, plan.stock[v.sku] ?? 0)
  }
  return "updated"
}

async function runSync(options = {}) {
  const {
    brand = "Walkaroo",
    file = process.env.TALLY_SYNC_FILE ||
      path.join(__dirname, "..", "..", "desktop", "tally-export", "stock-RR FOOTWEAR.json"),
    concurrency = 5,
    currency = process.env.TALLY_CURRENCY || "inr",
    company = "RR FOOTWEAR",
  } = options
const argv = parseArgs(process.argv.slice(2))
  const WRITE = argv.write === true
  const lim = argv.limit ? Number(argv.limit) : 0 // 0 = all
  const CONCURRENCY = argv.concurrency ? Number(argv.concurrency) : concurrency
  const MEDUSA_URL = argv.url || process.env.MEDUSA_URL || "http://localhost:9000"
  const EMAIL = argv.email || process.env.MEDUSA_ADMIN_EMAIL
  const PASSWORD = argv.password || process.env.MEDUSA_ADMIN_PASSWORD

  // ── READ ─────────────────────────────────────────────────────────────────
  const exportData = JSON.parse(fs.readFileSync(file, "utf8"))
  log.header(`${brand} → Medusa Sync`)
  log.section("READ STOCK")
  log.kv("source file", file)
  log.kv("company", exportData.company)
  log.kv("fetched at", exportData.fetchedAt)
  log.kv("rows in export", exportData.itemCount ?? exportData.items?.length ?? 0)

  const all = (exportData.items || []).filter((i) => i.parent === brand)
  const module = COMPANY_MODULES[brand]
  const sellableUnits = module?.SELLABLE_UNITS
  const sellable = sellableUnits ? all.filter((i) => sellableUnits.has(String(i.unit || "").trim().toUpperCase())) : all
  const inStock = sellable.filter((i) => (parseQty(i.closingQty) ?? -1) > 0)
  log.kv(`rows for ${brand}`, `${all.length} total · ${sellable.length} sellable · ${inStock.length} in stock`)
  if (all && all.length === 0) {
    log.warn(`No rows found for "${brand}" in this export. Check the company (Tally stock group) matches "${brand}".`)
  }

  // ── TRANSFORM ─────────────────────────────────────────────────────────
  log.section("TRANSFORM — raw Tally rows → Medusa catalog")
  let plans
  if (module) plans = buildPlans(module, all, { company: exportData.company, currency })
  else plans = buildLegacyPlans(brand, exportData, all, lim, currency)
  if (lim > 0) plans = plans.slice(0, lim)

  const variants = plans.reduce((n, p) => n + (p.product.variants?.length || 0), 0)
  log.ok(
    `Built ${plans.length > 0 ? `${plans.length} products` : "0 products"} and ${variants} variant(s) ${
      module ? `via "${brand}" company module` : "via generic one-row-per-product mapping"
    }`
  )

  const SHOW = Math.min(plans.length, 8)
  if (SHOW > 0) log.info(`Previewing the first ${SHOW} of ${plans.length} product(s):`)
  for (const p of plans.slice(0, SHOW)) {
    log.rule()
    log.kv("product", p.product.title, 12)
    log.kv("handle", p.product.handle, 12)
    const opts = (p.product.options || []).map((o) => `${o.title}=[${o.values.join(", ")}]`).join(" · ")
    log.kv("options", opts, 12)
    p.product.variants.forEach((v, idx) => {
      const isLast = idx === p.product.variants.length - 1
      const optColor = v.options?.Color
      const colorPart = optColor ? `  (${optColor})` : ""
      const optSize = v.options?.Size || "?"
      log.branch(`${v.sku}${colorPart}  size=${optSize}  qty=${p.stock[v.sku] ?? 0}`, isLast)
    })
  }
  log.rule()

  if (!WRITE) {
    log.section("DRY-RUN COMPLETE")
    log.ok(`${plans.length} product(s) / ${variants} variant(s) ready to upload to ${MEDUSA_URL}`)
    log.dim("Nothing was written. Re-run with --write to push to Medusa.")
    return { mode: "dry-run", planned: plans.length, plannedVariants: variants }
  }

  // ── WRITE MODE ───────────────────────────────────────────────────────
  log.section("MEDUSA TARGET")
  log.kv("medusa url", MEDUSA_URL)
  log.kv("mode", "write (--write)")
  log.kv("concurrency", CONCURRENCY)
  log.kv("currency", currency)

  // 3. authenticate
  log.section("AUTH")
  log.step(`Authenticating with Medusa (${EMAIL})…`)
  if (!EMAIL || !PASSWORD) {
    log.fail("Missing credentials. Set MEDUSA_ADMIN_EMAIL / MEDUSA_ADMIN_PASSWORD or pass --email/--password.")
    throw new Error("Set MEDUSA_ADMIN_EMAIL / MEDUSA_ADMIN_PASSWORD (or pass --email/--password)")
  }
  const auth = await api(MEDUSA_URL, "POST", "/auth/user/emailpass", null, { email: EMAIL, password: PASSWORD })
  const token = auth.token
  log.ok("Authenticated.")

  // 4. default stock location
  log.section("MEDUSA SETUP")
  log.step("Resolving default stock location…")
  const loc = await api(MEDUSA_URL, "GET", "/admin/stock-locations?limit=1", token)
  const locationId = loc.stock_locations?.[0]?.id
  if (!locationId) {
    log.fail("No stock location found in Medusa.")
    throw new Error("No stock location found in Medusa")
  }
  log.ok(`Stock location: ${locationId}`)

  log.step(`Ensuring collection "${brand}"…`)
  const collectionId = await ensureCollection(MEDUSA_URL, token, brand)
  log.ok(`Collection "${brand}" ready: ${collectionId}`)

  // 5. find existing products + variants (by product handle and variant sku)
  log.section("RECONCILE — match planned products against what Medusa already has")
  const existingByHandle = new Map()
  const existingSkus = new Set()
  let offset = 0
  while (true) {
    const page = await api(
      MEDUSA_URL,
      "GET",
      `/admin/products?limit=200&offset=${offset}&fields=id,handle,*variants.sku,*variants.inventory_items`,
      token
    )
    for (const p of page.products || []) {
      if (p.handle) existingByHandle.set(p.handle, p)
      for (const v of p.variants || []) if (v.sku) existingSkus.add(v.sku)
    }
    offset += page.products?.length || 0
    if (offset >= (page.count || 0) || !page.products?.length) break
  }
  const todo = plans.filter((p) => !existingByHandle.has(p.product.handle))
  const toUpdate = plans.filter((p) => existingByHandle.has(p.product.handle))
  const skipped = plans.length - todo.length - toUpdate.length
  log.kv("existing products in Medusa", existingByHandle.size)
  log.kv("to create", todo.length)
  log.kv("to update (stock)", toUpdate.length)
  log.kv("skipped", skipped)

  const ctx = { medusaUrl: MEDUSA_URL, token, locationId }
  const describePlan = (p) => {
    const names = p.product.variants.map((v) => `${v.sku}@${p.stock[v.sku] ?? 0}`)
    const list = names.length <= 3 ? ` [${names.join(", ")}]` : ` [${names[0]}, … ${names.length - 1} more]`
    return `${p.product.title}${list}`
  }

  // 6. create new products (product + all its variants + inventory)
  log.section("UPLOAD → CREATE NEW PRODUCTS")
  if (todo.length === 0) log.ok("No new products to create.")
  let created = 0
  const createFailures = []
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY)
    log.step(`Creating batch ${i / CONCURRENCY + 1} (${batch.length} product(s))…`)
    const results = await Promise.allSettled(batch.map((p) => createPlan(ctx, p, collectionId)))
    results.forEach((r, j) => {
      if (r.status === "fulfilled") {
        created++
        log.ok(`created ${describePlan(batch[j])}`)
      } else {
        createFailures.push({ sku: batch[j].sku, error: r.reason?.message })
        log.fail(`create ${batch[j].product.title}: ${r.reason?.message}`)
      }
    })
  }

  // 7. update stock on existing products (add missing variants + set quantities)
  log.section("UPLOAD → UPDATE INVENTORY")
  if (toUpdate.length === 0) log.ok("No existing products to update.")
  let updated = 0
  const updateFailures = []
  for (let i = 0; i < toUpdate.length; i += CONCURRENCY) {
    const batch = toUpdate.slice(i, i + CONCURRENCY)
    log.step(`Updating batch ${i / CONCURRENCY + 1} (${batch.length} product(s))…`)
    const results = await Promise.allSettled(
      batch.map((p) => updatePlan(ctx, p, existingByHandle.get(p.product.handle)))
    )
    results.forEach((r, j) => {
      if (r.status === "fulfilled") {
        updated++
        log.dim(`updated ${describePlan(batch[j])}`)
      } else {
        updateFailures.push({ sku: batch[j].sku, error: r.reason?.message })
        log.fail(`update ${batch[j].product.title}: ${r.reason?.message}`)
      }
    })
  }

  // 8. summary
  log.section("SUMMARY")
  log.divider()
  log.kv("plans", plans.length)
  log.kv("created (new products)", created)
  log.kv("updated (inventory)", updated)
  log.kv("skipped (already present)", skipped)
  log.kv("create failures", createFailures.length)
  log.kv("update failures", updateFailures.length)
  log.divider()
  const totalFailed = createFailures.length + updateFailures.length
  if (totalFailed === 0) {
    log.ok(`Sync complete: ${created} created, ${updated} updated, ${skipped} skipped.`)
  } else {
    log.fail(`Sync finished with ${totalFailed} failure(s). See lines above.`)
  }
  if (totalFailed) process.exitCode = 1
  return {
    mode: "write",
    created,
    updated,
    skipped,
    failed: totalFailed,
  }
}

module.exports = {
  COMPANY_MODULES,
  BRAND_CONFIG,
  parseArgs,
  runSync,
  ensureCollection,
  generateSku,
  parseQty,
  parseBrandName,
}