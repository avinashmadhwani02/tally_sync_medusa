#!/usr/bin/env node
/**
 * Backfill — assign existing Tally-synced products to their brand collections.
 *
 * Products carry metadata.tally_parent = brand (set at sync time). This pages
 * all Medusa products, groups them by brand, ensures a collection exists per
 * brand, and attaches the products to it.
 *
 * Usage: node scripts/backfill-collections.js [--email ..] [--password ..]
 */
const { ensureCollection } = require("./sync-lib")
const path = require("path")
require("dotenv").config({ path: path.join(__dirname, "..", ".env") })

const argv = process.argv.slice(2)
function f(name, def) {
  const i = argv.indexOf(`--${name}`)
  return i !== -1 && argv[i + 1] ? argv[i + 1] : def
}
const [email, password] = [f("email", process.env.MEDUSA_ADMIN_EMAIL), f("password", process.env.MEDUSA_ADMIN_PASSWORD)]
const MEDUSA_URL = f("url", process.env.MEDUSA_URL || "http://localhost:9000")

async function api(method, url, token, body) {
  const res = await fetch(`${MEDUSA_URL}${url}`, {
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

async function main() {
  if (!email || !password) throw new Error("Set MEDUSA_ADMIN_EMAIL / MEDUSA_ADMIN_PASSWORD")
  const auth = await api("POST", "/auth/user/emailpass", null, { email, password })
  const token = auth.token
  console.log("Authenticated.")

  // group existing products by their brand
  const byBrand = new Map()
  let offset = 0
  while (true) {
    const page = await api("GET", `/admin/products?limit=200&offset=${offset}&fields=id,variants.sku,metadata`, token)
    const prods = page.products || []
    for (const p of prods) {
      const brand = p.metadata?.tally_parent
      if (!brand) continue
      if (!byBrand.has(brand)) byBrand.set(brand, [])
      byBrand.get(brand).push(p.id)
    }
    offset += prods.length
    if (offset >= (page.count || 0) || !prods.length) break
  }

  for (const [brand, ids] of byBrand) {
    const colId = await ensureCollection(MEDUSA_URL, token, brand)
    let done = 0
    for (const pid of ids) {
      await api("POST", `/admin/products/${pid}`, token, { collection_id: colId })
      done++
      if (done % 50 === 0) console.log(`  ${brand}: ${done}/${ids.length}`)
    }
    console.log(`  ${brand}: ${done}/${ids.length} products -> collection ${colId}`)
  }
  console.log("\nDone.")
}

main().catch((e) => {
  console.error("Failed:", e.message)
  process.exit(1)
})