/**
 * Tally → Medusa inventory
 *
 * This is the only mapping you should need to edit.
 *
 * Medusa already owns products, variants, photos, and inventory records.
 * Tally only sends: name, partNumber, unit, closingQty (e.g. "29 Nos").
 *
 * Rule: a Tally row updates Medusa stock when we can find a variant whose
 * SKU equals the value returned by `skuFromTallyItem`.
 * Set that SKU on the variant in Medusa Admin (same as Tally Part Number).
 */

export type TallyStockItem = {
  name?: string
  partNumber?: string
  sku?: string
  parent?: string
  unit?: string
  closingQty?: string
}

export type MappedInventory = {
  sku: string
  quantity: number
  name: string
  unit: string | null
}

export type MapSkip = {
  name: string
  sku: string | null
  reason: string
}

/** Optional: pin a warehouse. If empty, the first Medusa stock location is used. */
export const STOCK_LOCATION_ID = process.env.TALLY_STOCK_LOCATION_ID || ""

/**
 * Which Tally field is the Medusa variant SKU.
 * Prefer Part Number. Fall back to an explicit sku, never a generated id.
 */
export function skuFromTallyItem(item: TallyStockItem): string | null {
  const raw = item.partNumber || item.sku
  if (!raw || !String(raw).trim()) return null
  return String(raw).trim()
}

/**
 * Tally closing balance is text like "29 Nos" or "150.5 Mtr".
 * Medusa inventory is a number. We take the leading number.
 */
export function quantityFromTallyItem(item: TallyStockItem): number | null {
  const text = String(item.closingQty ?? "").trim()
  const m = text.match(/^(-?\d+(?:\.\d+)?)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

/** Convert one Tally row into a Medusa stock update, or explain why it was skipped. */
export function mapTallyItem(item: TallyStockItem): MappedInventory | MapSkip {
  const name = String(item.name || "").trim() || "(unnamed)"
  const sku = skuFromTallyItem(item)
  if (!sku) {
    return { name, sku: null, reason: "no SKU (set Tally Part Number, then the same SKU on the Medusa variant)" }
  }
  const quantity = quantityFromTallyItem(item)
  if (quantity === null) {
    return { name, sku, reason: `cannot parse quantity from "${item.closingQty ?? ""}"` }
  }
  return {
    sku,
    quantity,
    name,
    unit: item.unit ? String(item.unit) : null,
  }
}

export function mapTallyItems(items: TallyStockItem[]) {
  const ready: MappedInventory[] = []
  const skipped: MapSkip[] = []
  for (const item of items) {
    if (!item) continue
    const mapped = mapTallyItem(item)
    if ("reason" in mapped) skipped.push(mapped)
    else ready.push(mapped)
  }
  return { ready, skipped }
}
