/**
 * Medusa client — idempotent Tally stock apply.
 *
 * One plan is one product with color/size variants. Existing products are
 * matched by tally_product_id / handle / variant SKU. Stock is set per variant.
 */
const identity = require("../identity")
const collectionStem = identity.collectionStem || identity.collectionStem

async function api(host, method, url, token, body) {
  const res = await fetch(`${host}${url}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = {}
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    /* keep raw */
  }
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${text.slice(0, 400)}`)
  return json
}

async function login(host, email, password) {
  const auth = await api(host, "POST", "/auth/user/emailpass", null, { email, password })
  if (!auth.token) throw new Error("Medusa login did not return a token — check MEDUSA_ADMIN_EMAIL / MEDUSA_ADMIN_PASSWORD")
  return auth.token
}

async function defaultStockLocation(host, token) {
  const loc = await api(host, "GET", "/admin/stock-locations?limit=1", token)
  const id = loc.stock_locations?.[0]?.id
  if (!id) throw new Error("No stock location found in Medusa")
  return id
}

async function listAll(host, token, path, key) {
  const out = []
  let offset = 0
  while (true) {
    const sep = path.includes("?") ? "&" : "?"
    const page = await api(host, "GET", `${path}${sep}limit=100&offset=${offset}`, token)
    const rows = page[key] || []
    out.push(...rows)
    offset += rows.length
    if (!rows.length || offset >= (page.count || 0)) break
  }
  return out
}

async function listCollections(host, token) {
  return listAll(host, token, "/admin/collections", "collections")
}

async function ensureCollection(host, token, brand, { dryRun = false } = {}) {
  const title = String(brand || "").trim()
  if (!title) throw new Error("collection brand is required")
  const stem = collectionStem(title)
  const all = await listCollections(host, token)
  const hit = all.find((c) => collectionStem(c.title) === stem || collectionStem(c.handle) === stem)
  if (hit) return hit.id
  if (dryRun) return null
  const handle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  const created = await api(host, "POST", "/admin/collections", token, {
    title,
    handle,
    metadata: { source: "tally-sync" },
  })
  return created.collection.id
}

function qtyAtLocation(invItem, locationId) {
  const levels = invItem?.location_levels || []
  const hit = levels.find((l) => l.location_id === locationId)
  if (!hit) return null
  const n = hit.stocked_quantity ?? hit.available_quantity
  return n == null ? null : Number(n)
}

function rupeeAmount(n) {
  if (n == null || n === "") return null
  const x = Number(n)
  if (!Number.isFinite(x)) return null
  return Math.round(x * 100) / 100
}

function sameRupee(a, b) {
  const x = rupeeAmount(a)
  const y = rupeeAmount(b)
  if (x == null && y == null) return true
  return x === y
}

function sameText(a, b) {
  return String(a ?? "").trim() === String(b ?? "").trim()
}

function priceForCurrency(variant, currency) {
  const want = String(currency || "inr").toLowerCase()
  const prices = variant?.prices || []
  return prices.find((p) => String(p.currency_code || "").toLowerCase() === want) || null
}

async function loadCatalog(host, token, locationId) {
  const products = await listAll(
    host,
    token,
    "/admin/products?fields=id,title,subtitle,handle,description,collection_id,metadata,*variants,*variants.prices,*variants.inventory_items",
    "products"
  )
  const invItems = await listAll(
    host,
    token,
    "/admin/inventory-items?fields=id,*location_levels",
    "inventory_items"
  )
  const invById = new Map(invItems.map((i) => [i.id, i]))

  const bySku = new Map()
  const byHandle = new Map()
  const byProductId = new Map()

  for (const p of products) {
    const variants = []
    for (const v of p.variants || []) {
      const invId =
        v.inventory_items?.[0]?.inventory_item_id ||
        v.inventory_items?.[0]?.id ||
        null
      const inv = invId ? invById.get(invId) : null
      const rec = {
        productId: p.id,
        variantId: v.id,
        sku: v.sku || "",
        handle: p.handle || "",
        title: v.title || "",
        metadata: v.metadata || {},
        prices: v.prices || [],
        invItemId: invId,
        quantity: qtyAtLocation(inv, locationId),
      }
      variants.push(rec)
      if (rec.sku) bySku.set(String(rec.sku).toUpperCase(), rec)
    }
    const rec = {
      id: p.id,
      handle: p.handle || "",
      title: p.title || "",
      subtitle: p.subtitle || null,
      description: p.description || null,
      metadata: p.metadata || {},
      variants,
    }
    if (rec.handle) byHandle.set(String(rec.handle).toLowerCase(), rec)
    const pid = rec.metadata.tally_product_id
    if (pid) byProductId.set(String(pid).toUpperCase(), rec)
  }

  return { bySku, byHandle, byProductId, productCount: products.length }
}

function findExistingProduct(catalog, plan) {
  if (plan.productId && catalog.byProductId.has(String(plan.productId).toUpperCase())) {
    return catalog.byProductId.get(String(plan.productId).toUpperCase())
  }
  if (plan.handle && catalog.byHandle.has(String(plan.handle).toLowerCase())) {
    return catalog.byHandle.get(String(plan.handle).toLowerCase())
  }
  for (const v of plan.variants || []) {
    const rec = catalog.bySku.get(String(v.sku).toUpperCase())
    if (rec) {
      return catalog.byHandle.get(String(rec.handle).toLowerCase()) || {
        id: rec.productId,
        handle: rec.handle,
        variants: [rec],
        metadata: {},
      }
    }
  }
  return null
}

async function setStock(host, token, invItemId, locationId, qty) {
  const body = { stocked_quantity: Math.max(0, qty) }
  try {
    await api(
      host,
      "POST",
      `/admin/inventory-items/${invItemId}/location-levels/${locationId}`,
      token,
      body
    )
  } catch (e) {
    if (!String(e.message).includes("404") && !String(e.message).includes("not found")) throw e
    await api(
      host,
      "POST",
      `/admin/inventory-items/${invItemId}/location-levels`,
      token,
      { location_id: locationId, stocked_quantity: Math.max(0, qty) }
    )
  }
}

function inventoryIdForVariant(v) {
  return v?.inventory_items?.[0]?.inventory_item_id || v?.inventory_items?.[0]?.id || null
}

async function loadProductVariants(host, token, productId) {
  const vFull = await api(host, "GET", `/admin/products/${productId}?fields=*variants.inventory_items`, token)
  return vFull.product?.variants || []
}

async function setVariantStocks(host, token, locationId, medusaVariants, planVariants, logger) {
  const bySku = new Map()
  for (const v of medusaVariants) {
    if (v.sku) bySku.set(String(v.sku).toUpperCase(), v)
  }
  for (const pv of planVariants) {
    const mv = bySku.get(String(pv.sku).toUpperCase())
    if (!mv) {
      logger?.warn("variant missing on Medusa product after create/update", { sku: pv.sku })
      continue
    }
    const invItemId = inventoryIdForVariant(mv)
    if (!invItemId) throw new Error(`inventory item not ready for SKU ${pv.sku}`)
    logger?.info("setting Medusa stock", { sku: pv.sku, qty: pv.quantity, color: pv.color, size: pv.size || null })
    await setStock(host, token, invItemId, locationId, pv.quantity)
  }
}

async function createProduct(host, token, plan, collectionId, locationId, logger) {
  logger?.info("creating Medusa product", {
    product: plan.productId,
    title: plan.product.title,
    handle: plan.product.handle,
    gender: plan.product?.metadata?.gender,
    variants: plan.variants.map((v) => ({
      sku: v.sku,
      color: v.color,
      size: v.size,
      qty: v.quantity,
      mrp: v.mrp,
    })),
  })
  const res = await api(host, "POST", "/admin/products", token, {
    ...plan.product,
    collection_id: collectionId || undefined,
  })
  const id = res.product?.id
  if (!id) throw new Error("product missing after create")
  const variants = await loadProductVariants(host, token, id)
  await setVariantStocks(host, token, locationId, variants, plan.variants, logger)
  logger?.info("created Medusa product", { product: plan.productId, medusaId: id, variantCount: variants.length })
  return { productId: id }
}

async function updateProductFields(host, token, existing, plan, logger) {
  const next = plan.product || {}
  const productChanges = []
  const productPatch = {}

  if (next.title && !sameText(existing.title, next.title)) {
    productPatch.title = next.title
    productChanges.push({ field: "title", from: existing.title, to: next.title })
  }
  if (!sameText(existing.subtitle, next.subtitle)) {
    productPatch.subtitle = next.subtitle || null
    productChanges.push({ field: "subtitle", from: existing.subtitle, to: next.subtitle || null })
  }
  if (next.description && !sameText(existing.description, next.description)) {
    productPatch.description = next.description
    productChanges.push({ field: "description", from: existing.description, to: next.description })
  }

  const genderFrom = existing.metadata?.gender
  const genderTo = next.metadata?.gender
  if (!sameText(genderFrom, genderTo) || !sameText(existing.metadata?.tally_gender, next.metadata?.tally_gender)) {
    productChanges.push({ field: "gender", from: genderFrom || null, to: genderTo || null })
  }
  if (next.metadata) {
    productPatch.metadata = { ...(existing.metadata || {}), ...next.metadata }
  }

  if (productChanges.length) {
    logger?.info("updating Medusa product fields", {
      product: plan.productId,
      medusaId: existing.id,
      changes: productChanges,
    })
    await api(host, "POST", `/admin/products/${existing.id}`, token, productPatch)
  }
  return productChanges
}

async function updateVariantFields(host, token, existing, plan, logger) {
  const live = await loadProductVariants(host, token, existing.id)
  const liveBySku = new Map(live.map((v) => [String(v.sku || "").toUpperCase(), v]))
  const currency = String(plan.product?.variants?.[0]?.prices?.[0]?.currency_code || "inr").toLowerCase()
  const variantChanges = []

  for (const pv of plan.variants) {
    const lv = liveBySku.get(String(pv.sku).toUpperCase())
    if (!lv) continue
    const payloadVar = (plan.product.variants || []).find((v) => v.sku === pv.sku)
    const wantMrp = rupeeAmount(pv.mrp)
    const currentPrice = priceForCurrency(lv, currency)
    const haveMrp = rupeeAmount(currentPrice?.amount)
    const patch = {}
    const fields = []

    if (payloadVar?.title && !sameText(lv.title, payloadVar.title)) {
      patch.title = payloadVar.title
      fields.push({ field: "title", from: lv.title, to: payloadVar.title })
    }
    if (wantMrp != null && !sameRupee(haveMrp, wantMrp)) {
      patch.prices = currentPrice?.id
        ? [{ id: currentPrice.id, amount: wantMrp, currency_code: currency }]
        : [{ amount: wantMrp, currency_code: currency }]
      fields.push({ field: "mrp", from: haveMrp, to: wantMrp })
    }
    if (payloadVar?.metadata) {
      patch.metadata = { ...(lv.metadata || {}), ...payloadVar.metadata }
    }

    if (fields.length || patch.metadata) {
      if (fields.length) {
        logger?.info("updating Medusa variant", {
          product: plan.productId,
          sku: pv.sku,
          changes: fields,
        })
      }
      await api(host, "POST", `/admin/products/${existing.id}/variants/${lv.id}`, token, patch)
      variantChanges.push({ sku: pv.sku, changes: fields })
    }
  }
  return variantChanges
}

function diffExisting(existing, plan) {
  const existingBySku = new Map((existing.variants || []).map((v) => [String(v.sku).toUpperCase(), v]))
  const currency = String(plan.product?.variants?.[0]?.prices?.[0]?.currency_code || "inr").toLowerCase()
  const variantDiff = []
  let changed = false
  for (const pv of plan.variants) {
    const ev = existingBySku.get(String(pv.sku).toUpperCase())
    const qtyFrom = ev?.quantity == null ? null : Number(ev.quantity)
    const qtyTo = Number(pv.quantity)
    const price = priceForCurrency(ev, currency)
    const mrpFrom = rupeeAmount(price?.amount ?? ev?.metadata?.tally_mrp)
    const mrpTo = rupeeAmount(pv.mrp)
    const row = { sku: pv.sku, color: pv.color, qtyFrom, qtyTo, mrpFrom, mrpTo }
    if (!ev) {
      row.added = true
      changed = true
    }
    if (qtyFrom !== qtyTo) changed = true
    if (mrpTo != null && !sameRupee(mrpFrom, mrpTo)) changed = true
    variantDiff.push(row)
  }
  const genderFrom = existing.metadata?.gender
  const genderTo = plan.product?.metadata?.gender
  if (!sameText(existing.title, plan.product?.title)) changed = true
  if (!sameText(existing.subtitle, plan.product?.subtitle)) changed = true
  if (!sameText(genderFrom, genderTo)) changed = true
  return { changed, variantDiff, genderFrom, genderTo }
}

async function syncExistingProduct(host, token, existing, plan, locationId, logger) {
  const productChanges = await updateProductFields(host, token, existing, plan, logger)
  await createMissingVariants(host, token, existing, plan, locationId, logger)
  const variantChanges = await updateVariantFields(host, token, existing, plan, logger)
  const live = await loadProductVariants(host, token, existing.id)
  await setVariantStocks(host, token, locationId, live, plan.variants, logger)
  return { productChanges, variantChanges }
}

async function createMissingVariants(host, token, existing, plan, locationId, logger) {
  const have = new Set((existing.variants || []).map((v) => String(v.sku).toUpperCase()))
  for (const pv of plan.variants) {
    if (have.has(String(pv.sku).toUpperCase())) continue
    const payload = (plan.product.variants || []).find((v) => v.sku === pv.sku)
    if (!payload) continue
    logger?.info("adding missing variant to existing product", {
      product: plan.productId,
      sku: pv.sku,
      color: pv.color,
      qty: pv.quantity,
      mrp: pv.mrp,
    })
    await api(host, "POST", `/admin/products/${existing.id}/variants`, token, payload)
  }
}

function logLine(logger, entry) {
  if (entry.action === "update") {
    logger?.info("upload update", entry)
  } else if (entry.action === "create") {
    logger?.info("upload create", entry)
  } else if (entry.action === "skip") {
    logger?.info("upload skip", entry)
  } else if (entry.action === "fail") {
    logger?.error("upload failed", entry)
  } else {
    logger?.debug("upload unchanged", entry)
  }
}

async function applyPlans({
  host,
  token,
  locationId,
  plans,
  catalog,
  concurrency = 4,
  logger,
  dryRun = false,
}) {
  const collectionCache = new Map()
  async function collectionFor(plan) {
    const brand = plan.found?.parent || plan.rule?.brand
    if (!brand) return null
    const stem = collectionStem(brand)
    if (collectionCache.has(stem)) return collectionCache.get(stem)
    const id = await ensureCollection(host, token, brand, { dryRun })
    collectionCache.set(stem, id)
    return id
  }

  const summary = {
    unchanged: 0,
    updated: 0,
    created: 0,
    skipped: 0,
    failed: 0,
    changes: [],
  }

  async function applyOne(plan) {
    const existing = findExistingProduct(catalog, plan)
    const name = plan.title || plan.productId

    if (existing) {
      const diff = diffExisting(existing, plan)
      if (!diff.changed) {
        summary.unchanged++
        const entry = { action: "unchanged", sku: plan.productId, name, variants: diff.variantDiff }
        logger?.debug("product already matches Tally", entry)
        summary.changes.push(entry)
        return
      }
      if (!dryRun) {
        await syncExistingProduct(host, token, existing, plan, locationId, logger)
      } else {
        logger?.info("dry-run would update product", {
          product: plan.productId,
          gender: { from: diff.genderFrom, to: diff.genderTo },
          variants: diff.variantDiff,
        })
      }
      summary.updated++
      const entry = {
        action: "update",
        sku: plan.productId,
        name,
        variants: diff.variantDiff,
        dryRun,
      }
      logLine(logger, entry)
      summary.changes.push(entry)
      return
    }

    if (plan.zeroStock || plan.quantity <= 0) {
      summary.skipped++
      const entry = { action: "skip", sku: plan.productId, name, reason: "not in Medusa and qty is 0 — will not create" }
      logLine(logger, entry)
      summary.changes.push(entry)
      return
    }

    if (!dryRun) {
      const colId = await collectionFor(plan)
      await createProduct(host, token, plan, colId, locationId, logger)
    } else {
      logger?.info("dry-run would create product", {
        product: plan.productId,
        title: plan.title,
        variants: plan.variants.map((v) => ({ sku: v.sku, color: v.color, size: v.size, qty: v.quantity, mrp: v.mrp })),
      })
    }
    summary.created++
    const entry = {
      action: "create",
      sku: plan.productId,
      name,
      from: null,
      to: plan.quantity,
      variants: plan.variants.map((v) => ({ sku: v.sku, qty: v.quantity })),
      dryRun,
    }
    logLine(logger, entry)
    summary.changes.push(entry)
  }

  for (let i = 0; i < plans.length; i += concurrency) {
    const batch = plans.slice(i, i + concurrency)
    const results = await Promise.allSettled(batch.map(applyOne))
    results.forEach((r, j) => {
      if (r.status === "rejected") {
        summary.failed++
        const plan = batch[j]
        const entry = {
          action: "fail",
          sku: plan.productId,
          name: plan.title,
          error: r.reason?.message,
        }
        logLine(logger, entry)
        summary.changes.push(entry)
      }
    })
    logger?.progress("push", Math.min(i + concurrency, plans.length), plans.length)
  }

  return summary
}

module.exports = {
  api,
  login,
  defaultStockLocation,
  defaultStockLocation: defaultStockLocation,
  loadCatalog,
  loadCatalog: loadCatalog,
  applyPlans,
  applyPlans: applyPlans,
  ensureCollection,
  listCollections,
  loadCatalog,
  loadCatalog: loadCatalog,
  findExistingProduct,
  applyPlans,
  applyPlans: applyPlans,
}
