/**
 * Tally -> Medusa sync pipeline.
 *
 *   1. Parse every Tally row via shoe-parser.ts (config-driven per brand group)
 *   2. Rows matching an existing variant SKU -> update inventory levels
 *   3. Rows with a NEW syncable SKU -> auto-create products:
 *        product  = brand + model (+ gender), explicit unique handle
 *        variant  = one per color/MRP row, SKU = deterministic RRF-* sku
 *        price    = MRP parsed from the Tally name (INR), when available
 *        collection = one per brand (auto-created)
 *      ...then set their inventory levels too.
 *
 * Self-healing: every inventory_item_id is verified against the inventory
 * module before use; dangling links (from previously interrupted runs) are
 * repaired by creating a fresh inventory item and relinking the variant.
 *
 * SAFETY: defaults to DRY-RUN. Nothing is written unless
 *   TALLY_SYNC_MODE=write
 */

import type { MedusaContainer } from "@medusajs/framework"
import {
  createCollectionsWorkflow,
  createInventoryItemsWorkflow,
  createInventoryLevelsWorkflow,
  createProductsWorkflow,
  updateInventoryLevelsWorkflow,
} from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  parseStockItem,
  normalize,
  type ParsedStockItem,
  type TallyStockItem,
} from "./shoe-parser"

type MapSkip = { name: string; sku: string | null; reason: string }

type VariantRow = {
  id: string
  sku: string | null
  inventory_items?: Array<{
    id: string
    location_levels?: Array<{
      id: string
      location_id: string
      stocked_quantity?: number
    }>
  }>
}

type LevelOp = {
  sku: string
  variant_id: string
  inventory_item_id: string
  location_id: string
  stocked_quantity: number
  level_id?: string
}

const SYNC_MODE = (process.env.TALLY_SYNC_MODE || "dry-run").toLowerCase()
const WRITE_MODE = SYNC_MODE === "write"
const CURRENCY_CODE = process.env.TALLY_CURRENCY || "inr"

async function defaultLocationId(container: MedusaContainer): Promise<string | null> {
  const configured = process.env.TALLY_STOCK_LOCATION_ID
  if (configured) return configured
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "stock_location", fields: ["id"] })
  return ((data || []) as Array<{ id: string }>)[0]?.id ?? null
}

async function variantsBySku(container: MedusaContainer, skus: string[]): Promise<VariantRow[]> {
  if (!skus.length) return []
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product_variant",
    fields: [
      "id",
      "sku",
      "inventory_items.id",
      "inventory_items.location_levels.id",
      "inventory_items.location_levels.location_id",
      "inventory_items.location_levels.stocked_quantity",
    ],
    filters: { sku: { $in: skus } },
  })
  return (data || []) as unknown as VariantRow[]
}

function buildLevelOps(
  rows: ParsedStockItem[],
  variants: VariantRow[],
  locationId: string,
  onMissing?: (row: ParsedStockItem) => void
): LevelOp[] {
  const ops: LevelOp[] = []
  for (const row of rows) {
    const v = variants.find((x) => x.sku === row.sku)
    if (!v) {
      onMissing?.(row)
      continue
    }
    const item = v.inventory_items?.[0]
    if (!item?.id) {
      onMissing?.(row)
      continue
    }
    const level = item.location_levels?.find((l) => l.location_id === locationId)
    ops.push({
      sku: row.sku,
      variant_id: v.id,
      inventory_item_id: item.id,
      location_id: locationId,
      stocked_quantity: row.quantity!,
      level_id: level?.id,
    })
  }
  return ops
}

/**
 * Verify every op's inventory_item_id against the inventory module.
 * Dangling ids are repaired: a fresh inventory item is created for the SKU
 * and linked to the variant, so the level can be written.
 */
async function sanitizeOps(
  container: MedusaContainer,
  ops: LevelOp[],
  stats: { repaired: number }
): Promise<LevelOp[]> {
  if (!ops.length) return ops
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const ids = [...new Set(ops.map((o) => o.inventory_item_id))]
  const { data } = await query.graph({
    entity: "inventory_item",
    fields: ["id"],
    filters: { id: ids },
  })
  const valid = new Set(((data || []) as Array<{ id: string }>).map((i) => i.id))

  const ok = ops.filter((o) => valid.has(o.inventory_item_id))
  const broken = ops.filter((o) => !valid.has(o.inventory_item_id))

  if (broken.length) {
    console.warn(`[sync] repairing ${broken.length} dangling inventory item link(s)...`)
    const res = await createInventoryItemsWorkflow(container).run({
      input: {
        items: broken.map((b) => ({
          sku: b.sku,
          requires_shipping: true,
        })),
      },
    })
    const link = container.resolve(ContainerRegistrationKeys.LINK)
    for (let i = 0; i < broken.length; i++) {
      const newItem = res.result[i]
      const b = broken[i]
      try {
        await link.create({
          [Modules.PRODUCT]: { variant_id: b.variant_id },
          [Modules.INVENTORY]: { inventory_item_id: newItem.id },
        })
        ok.push({ ...b, inventory_item_id: newItem.id, level_id: undefined })
        stats.repaired++
      } catch (e) {
        console.warn(`[sync] could not relink variant ${b.variant_id}:`, (e as Error).message)
      }
    }
  }
  return ok
}

async function writeLevels(container: MedusaContainer, ops: LevelOp[]) {
  const creates = ops.filter((o) => !o.level_id)
  const updates = ops.filter((o) => o.level_id)
  if (creates.length) {
    await createInventoryLevelsWorkflow(container).run({
      input: {
        inventory_levels: creates.map((o) => ({
          inventory_item_id: o.inventory_item_id,
          location_id: o.location_id,
          stocked_quantity: o.stocked_quantity,
        })),
      },
    })
  }
  if (updates.length) {
    await updateInventoryLevelsWorkflow(container).run({
      input: {
        updates: updates.map((o) => ({
          id: o.level_id!,
          inventory_item_id: o.inventory_item_id,
          location_id: o.location_id,
          stocked_quantity: o.stocked_quantity,
        })),
      },
    })
  }
  return ops.length
}

/** Group new rows into products: key = groupKey|model|gender, variant per row. */
function groupIntoProducts(rows: ParsedStockItem[]) {
  const map = new Map<
    string,
    { brand: string; model: string; gender: string | null; variants: ParsedStockItem[] }
  >()
  for (const row of rows) {
    const key = `${row.groupKey}|${row.model}|${row.gender || ""}`
    if (!map.has(key)) {
      map.set(key, { brand: row.brand!, model: row.model, gender: row.gender, variants: [] })
    }
    map.get(key)!.variants.push(row)
  }
  return [...map.values()]
}

/** Ensure a collection exists per brand; returns brand -> collection_id. */
async function ensureCollections(
  container: MedusaContainer,
  brands: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (!brands.length) return result
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product_collection",
    fields: ["id", "title"],
  })
  const byTitle = new Map(
    ((data || []) as Array<{ id: string; title: string }>).map((c) => [c.title.toLowerCase(), c.id])
  )
  const missing = brands.filter((b) => !byTitle.has(b.toLowerCase()))
  if (missing.length && WRITE_MODE) {
    const created = await createCollectionsWorkflow(container).run({
      input: { collections: missing.map((name) => ({ title: name })) },
    })
    for (const c of created.result as Array<{ id: string; title?: string }>) {
      if (c.title) byTitle.set(c.title.toLowerCase(), c.id)
    }
  }
  for (const b of brands) {
    const id = byTitle.get(b.toLowerCase())
    if (id) result.set(b, id)
  }
  return result
}

export async function applyTallyToMedusaInventory(
  container: MedusaContainer,
  items: TallyStockItem[]
) {
  const parsedAll = (items || []).map((i) => parseStockItem(i))

  const outOfStockCount = parsedAll.filter(
    (p) => p.syncAllowed && (p.quantity == null || p.quantity <= 0)
  ).length

  const unmatched: MapSkip[] = []
  for (const p of parsedAll) {
    const isSellable = p.syncAllowed && p.ok && p.quantity != null && p.quantity > 0
    if (isSellable) continue
    if (p.quantity == null || p.quantity <= 0) continue // out of stock — counted above
    if (unmatched.length >= 200) break
    unmatched.push({ name: p.tallyName, sku: p.sku, reason: p.warnings.join("; ") || "skipped" })
  }

  const syncable = parsedAll.filter(
    (p) => p.syncAllowed && p.ok && p.quantity != null && p.quantity > 0
  )

  const locationId = await defaultLocationId(container)
  if (!locationId) {
    throw new Error(
      "No Medusa stock location. Create one in Admin (Settings → Stock Locations) or set TALLY_STOCK_LOCATION_ID."
    )
  }

  const repairStats = { repaired: 0 }

  // ---- Phase 1: existing variants
  const skus = [...new Set(syncable.map((r) => r.sku))]
  const knownVariants = await variantsBySku(container, skus)
  const knownSkuSet = new Set(knownVariants.map((v) => v.sku))
  const existingOps = buildLevelOps(syncable, knownVariants, locationId)

  // ---- Phase 2: unknown SKUs -> products to create
  const newRows = syncable.filter((r) => !knownSkuSet.has(r.sku))
  const productGroups = groupIntoProducts(newRows)
  const brands = [...new Set(productGroups.map((g) => g.brand!))]
  const brandCollectionIds = await ensureCollections(container, brands)

  const usedHandles = new Set<string>()
  const handleFor = (brand: string, model: string, gender: string | null): string => {
    const base =
      normalize(`${brand}-${model}-${gender ?? "unisex"}`)
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "") || "product"
    let handle = base
    let n = 2
    while (usedHandles.has(handle)) handle = `${base}-${n++}`
    usedHandles.add(handle)
    return handle
  }

  const plannedProducts = productGroups.map((g) => ({
    handle: handleFor(g.brand!, g.model, g.gender),
    title: `${g.brand} ${g.model}${g.gender ? ` (${g.gender})` : ""}`,
    subtitle: `Synced from Tally group "${g.variants[0].group}"`,
    collection_id: brandCollectionIds.get(g.brand!) ?? undefined,
    options: [{ title: "Color", values: [...new Set(g.variants.map((v) => v.color || v.colorCode || "Standard"))] }],
    variants: g.variants.map((v) => ({
      title: `${g.brand} ${g.model} ${v.color || v.colorCode || ""}`.trim(),
      sku: v.sku,
      manage_inventory: true,
      prices: v.mrpPaise != null ? [{ amount: v.mrpPaise, currency_code: CURRENCY_CODE }] : [],
      options: { Color: v.color || v.colorCode || "Standard" },
    })),
  }))

  let createdProducts = 0
  let createdVariants = 0
  let totalWritten = 0
  let pendingStock = 0

  if (WRITE_MODE) {
    // 1. stock updates for pre-existing variants
    const sanitizedExisting = await sanitizeOps(container, existingOps, repairStats)
    totalWritten += await writeLevels(container, sanitizedExisting)

    // 2. create missing products — in chunks so one bad row can't abort all
    if (plannedProducts.length) {
      const CHUNK = 50
      const failedChunks: string[] = []
      for (let i = 0; i < plannedProducts.length; i += CHUNK) {
        const chunk = plannedProducts.slice(i, i + CHUNK)
        try {
          const res = await createProductsWorkflow(container).run({
            input: { products: chunk },
          })
          createdProducts += res.result.length
          createdVariants += res.result.reduce(
            (n: number, p: { variants?: unknown[] }) => n + (p.variants?.length || 0),
            0
          )
        } catch (e) {
          console.error(`[sync] product chunk ${i}-${i + chunk.length} failed:`, (e as Error).message)
          failedChunks.push(`${chunk[0].title}…`)
          // Retry this chunk one-by-one so only truly bad products are skipped
          for (const p of chunk) {
            try {
              const res = await createProductsWorkflow(container).run({
                input: { products: [p] },
              })
              createdProducts += res.result.length
              createdVariants += res.result.reduce(
                (n: number, x: { variants?: unknown[] }) => n + (x.variants?.length || 0),
                0
              )
            } catch (e2) {
              console.error(`[sync] product "${p.title}" failed:`, (e2 as Error).message)
              unmatched.push({ name: p.title, sku: p.variants?.[0]?.sku ?? null, reason: `create failed: ${(e2 as Error).message}` })
            }
          }
        }
      }
    }

    // 3. attach stock to newly created variants.
    // Their inventory items are created ASYNC after product creation, so poll.
    if (createdVariants > 0) {
      const maxAttempts = 10
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const freshVariants = await variantsBySku(container, newRows.map((r) => r.sku))
        const ops = buildLevelOps(newRows, freshVariants, locationId)
        const sanitized = await sanitizeOps(container, ops, repairStats)
        pendingStock = ops.length - sanitized.length
        if (sanitized.length) {
          totalWritten += await writeLevels(container, sanitized)
        }
        if (pendingStock === 0) break
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 1500))
        } else {
          console.warn(
            `[sync] ${pendingStock} new variants had no inventory item yet — their stock will attach on the next sync run.`
          )
        }
      }
    }
  }

  return {
    mode: WRITE_MODE ? "write" : "dry-run",
    updated: WRITE_MODE ? totalWritten : 0,
    inventoryUpdates: existingOps.length,
    createdProducts: WRITE_MODE ? createdProducts : 0,
    wouldCreateProducts: plannedProducts.length,
    wouldCreateVariants: plannedProducts.reduce((n, p) => n + p.variants.length, 0),
    plannedSample: plannedProducts.slice(0, 5),
    repairedLinks: WRITE_MODE ? repairStats.repaired : 0,
    pendingStock: WRITE_MODE ? pendingStock : 0,
    unmatched,
    outOfStockCount,
    locationId,
    parsedTotal: parsedAll.length,
    syncableTotal: syncable.length,
  }
}
