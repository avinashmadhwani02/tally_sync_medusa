/**
 * One-shot cleanup: remove the accidental "RR FOOTWEAR" company collection
 * and its products, plus any empty duplicate Campus collection.
 *
 * Usage: node src/push/cleanup-rr-footwear.js
 */
const { loadEnv } = require("../util")
loadEnv()
const {
  login,
  listCollections,
  deleteProductsInCollection,
  deleteCollection,
  api,
} = require("./medusa")

const HOST = process.env.MEDUSA_URL || "http://localhost:9000"
const EMAIL = process.env.MEDUSA_ADMIN_EMAIL
const PASSWORD = process.env.MEDUSA_ADMIN_PASSWORD

async function productCount(host, token, collectionId) {
  const page = await api(
    host,
    "GET",
    `/admin/products?collection_id=${collectionId}&limit=1&fields=id`,
    token
  )
  return page.count ?? page.products?.length ?? 0
}

async function main() {
  if (!EMAIL || !PASSWORD) throw new Error("MEDUSA_ADMIN_EMAIL / MEDUSA_ADMIN_PASSWORD required")
  console.log(`[cleanup] logging in to ${HOST} …`)
  const token = await login(HOST, EMAIL, PASSWORD)
  const collections = await listCollections(HOST, token)
  console.log("[cleanup] collections:")
  for (const c of collections) {
    const n = await productCount(HOST, token, c.id)
    console.log(`  - ${c.title}  handle=${c.handle}  products=${n}  id=${c.id}`)
  }

  const drop = collections.filter((c) => {
    const title = String(c.title || "").trim().toLowerCase()
    const handle = String(c.handle || "").toLowerCase()
    return (
      title === "rr footwear" ||
      handle === "rr-footwear-collection" ||
      handle === "rr-footwear"
    )
  })

  const emptyCampus = []
  for (const c of collections) {
    const title = String(c.title || "").trim().toLowerCase()
    if (title !== "campus shoes") continue
    const n = await productCount(HOST, token, c.id)
    if (n === 0) emptyCampus.push(c)
  }

  const targets = [...drop, ...emptyCampus]
  if (!targets.length) {
    console.log("[cleanup] nothing to remove.")
    return
  }

  for (const c of targets) {
    console.log(`[cleanup] deleting products in "${c.title}" (${c.handle}) …`)
    const n = await deleteProductsInCollection(HOST, token, c.id)
    console.log(`[cleanup]   deleted ${n} product(s)`)
    await deleteCollection(HOST, token, c.id)
    console.log(`[cleanup]   deleted collection ${c.id}`)
  }
}

main().catch((e) => {
  console.error("[cleanup] failed:", e.message)
  process.exit(1)
})
