/**
 * Turn Tally stock rows into Medusa product plans.
 *
 * One Tally row is one variant. Rows that share a productId (e.g. Walkaroo
 * WALKAROO-WLR72017 in brown and cream) become one product with color/size variants.
 */
const { parseStockRow } = require("../brands")

/** MRP as rupees, e.g. 269.00 — not paise. */
function rupeeAmount(mrp) {
  if (mrp == null || mrp === "") return null
  const n = Number(mrp)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100) / 100
}

function variantTitle(row) {
  const color = row.colorName || row.color || "Default"
  return row.size ? `${color} / ${row.size}` : color
}

function genderForGroup(group) {
  const hit = group.variants.find((v) => v.gender || v.genderLabel)
  if (!hit) return { token: null, label: null }
  return { token: hit.gender || null, label: hit.genderLabel || hit.gender || null }
}

function buildProductPayload(group, currency) {
  const colors = [...new Set(group.variants.map((v) => v.colorName || v.color || "Default"))]
  const sizes = [...new Set(group.variants.map((v) => v.size).filter(Boolean))]
  const gender = genderForGroup(group)
  const options = [{ title: "Color", values: colors }]
  if (sizes.length) options.push({ title: "Size", values: sizes })

  const variants = group.variants.map((v) => {
    const opts = { Color: v.colorName || v.color || "Default" }
    if (sizes.length) opts.Size = v.size || "OS"
    const mrpRupees = rupeeAmount(v.mrp)
    return {
      title: variantTitle(v),
      sku: v.sku,
      allow_backorder: false,
      manage_inventory: true,
      options: opts,
      prices: mrpRupees != null ? [{ amount: mrpRupees, currency_code: currency }] : [],
      metadata: {
        tally_mrp: mrpRupees,
        tally_gender: v.gender || gender.token,
        gender: v.genderLabel || gender.label,
        tally_color: v.color,
        tally_size: v.size || null,
      },
    }
  })

  return {
    title: group.title,
    subtitle: gender.label || null,
    handle: group.handle,
    description: `${group.brandLabel} ${group.model}${gender.label ? ` · ${gender.label}` : ""}`.trim(),
    status: "published",
    options,
    variants,
    metadata: {
      tally_product_id: group.productId,
      tally_brand: group.brandLabel,
      tally_model: group.model,
      tally_gender: gender.token,
      gender: gender.label,
      source: "tally-sync",
    },
  }
}

function transformItems(items, opts = {}) {
  const {
    brand: brandFilter = "walkaroo",
    limit = 0,
    currency = "inr",
    logger = null,
  } = opts

  const want = brandFilter ? String(brandFilter).trim().toLowerCase() : "walkaroo"
  const skipped = { outOfScope: 0, notEnabled: 0, parseFailed: 0, noStock: 0 }
  const products = new Map()

  logger?.info("transforming Tally rows into products", {
    totalRows: (items || []).length,
    brand: want,
  })

  for (const item of items || []) {
    const parsed = parseStockRow(item, logger)
    if (!parsed || parsed.skipped || !parsed.ok) {
      if (parsed?.reason && /not walkaroo\/campus\/adda/i.test(parsed.reason)) skipped.outOfScope++
      else if (parsed?.reason && /not enabled/.test(parsed.reason)) skipped.notEnabled++
      else skipped.parseFailed++
      continue
    }
    if (want && parsed.brand !== want) {
      skipped.notEnabled++
      continue
    }

    const key = parsed.productId
    if (!products.has(key)) {
      products.set(key, {
        productId: parsed.productId,
        handle: parsed.handle,
        title: parsed.title,
        brand: parsed.brand,
        brandLabel: parsed.brandLabel,
        model: parsed.model,
        variants: [],
      })
    }
    const group = products.get(key)
    const existing = group.variants.find(
      (v) => v.color === parsed.color && String(v.size || "") === String(parsed.size || "")
    )
    if (existing) {
      existing.quantity += parsed.quantity
      existing.tallyNames.push(parsed.found.name)
      logger?.info("aggregated quantity onto existing variant", {
        product: key,
        sku: existing.sku,
        added: parsed.quantity,
        total: existing.quantity,
      })
    } else {
      group.variants.push({
        sku: parsed.sku,
        color: parsed.color,
        colorName: parsed.colorName,
        size: parsed.size,
        quantity: parsed.quantity,
        mrp: parsed.mrp,
        gender: parsed.gender,
        genderLabel: parsed.genderLabel,
        unit: parsed.unit,
        tallyNames: [parsed.found.name],
        found: parsed.found,
      })
    }
  }

  const plans = []
  for (const group of products.values()) {
    const totalQty = group.variants.reduce((s, v) => s + v.quantity, 0)
    const zeroStock = totalQty <= 0
    if (zeroStock) skipped.noStock++

    const payload = buildProductPayload(group, currency)
    logger?.info("built product from variants", {
      product: group.productId,
      title: group.title,
      gender: payload.metadata.gender,
      variantCount: group.variants.length,
      variants: group.variants.map((v) => ({
        sku: v.sku,
        color: v.color,
        size: v.size || null,
        qty: v.quantity,
        mrp: v.mrp,
        gender: v.genderLabel || v.gender || null,
      })),
      totalQty,
    })

    plans.push({
      productId: group.productId,
      sku: group.productId,
      handle: group.handle,
      title: group.title,
      brand: group.brand,
      quantity: totalQty,
      zeroStock,
      variants: group.variants,
      found: { parent: group.brandLabel, name: group.productId },
      rule: { brand: group.brandLabel, model: group.model, gender: payload.metadata.tally_gender },
      product: payload,
    })
  }

  const withStock = plans.filter((p) => !p.zeroStock)
  const out = limit > 0 ? withStock.slice(0, limit) : plans

  logger?.info("transform complete", {
    products: out.length,
    variants: out.reduce((s, p) => s + p.variants.length, 0),
    skipped,
  })

  return {
    selectedCount: out.filter((p) => !p.zeroStock).length,
    filteredCount: (items || []).length,
    skipped,
    plans: out,
  }
}

module.exports = { transformItems, transformItems: transformItems }
