/**
 * Generic stock-item parsing engine (TS port of apps/desktop/tally/shoeParser.js).
 * Behaviour is driven by group-configs.ts.
 */

import { GROUP_CONFIGS, type GroupConfig } from "./group-configs"

export type TallyStockItem = {
  name?: string
  partNumber?: string
  sku?: string
  parent?: string
  unit?: string
  closingQty?: string
}

export type ParsedStockItem = {
  ok: boolean
  sku: string
  tallyName: string
  group: string
  groupKey: string
  brand: string | null
  syncAllowed: boolean
  gender: string | null
  model: string
  color: string | null
  colorCode: string | null
  mrpPaise: number | null
  sizeInfo: string | null
  quantity: number | null
  unit: string | null
  warnings: string[]
}

const GENDER_TOKENS: Record<string, string> = {
  GENTS: "men", MEN: "men",
  BOYS: "kids", GIRLS: "kids", KIDS: "kids", KID: "kids",
  LADIES: "women", LADY: "women", WOMEN: "women", WOMAN: "women",
}

const SELLABLE_UNITS = ["PRS", "PCS", "PC", "PAIRS", "ST", "SET"]

function parseQty(closingQty: unknown): number | null {
  const m = String(closingQty ?? "").match(/(-?\d+(?:\.\d+)?)/)
  const n = m ? parseFloat(m[1]) : NaN
  return Number.isFinite(n) ? n : null
}

export function normalize(text: unknown): string {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase()
}

function genderFromToken(token?: string | null): string | null {
  if (!token) return null
  const t = token.toUpperCase().replace(/[^A-Z]/g, "")
  if (t === "G") return "men"
  if (t === "L") return "women"
  if (t === "C" || t === "K") return "kids"
  return GENDER_TOKENS[t] || null
}

function mrpToPaise(mrp: unknown): number | null {
  if (mrp == null) return null
  const n = parseFloat(String(mrp).replace(/[^0-9.]/g, ""))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null
}

type ParsedFields = {
  model: string
  gender: string | null
  genderToken: string | null
  color: string | null
  colorCode: string | null
  mrpPaise: number | null
  sizeInfo: string | null
}

const COLOR_WORDS = new Set([
  "BLACK", "BLK", "BROWN", "BRN", "TAN", "NAVY", "GREY", "GRAY", "OLIVE",
  "OLV", "WHITE", "WHT", "BLUE", "BLU", "RED", "GREEN", "GRN", "PINK",
  "MAROON", "BEIGE", "YELLOW", "OFFWHITE", "MULTI",
])

const STRATEGIES: Record<string, (name: string) => ParsedFields | null> = {
  walkarooPair(name) {
    const m = name.match(
      /^([A-Z0-9]+)\s+(GENTS|LADIES|LADY|WOMEN|MEN|BOYS|GIRLS|KIDS)\s+PAIR\s+([A-Z]+)\s*\[MRP[- ]?([\d.]+)\]/i
    )
    if (!m) return null
    return {
      model: m[1],
      gender: genderFromToken(m[2]),
      genderToken: m[2].toUpperCase(),
      colorCode: m[3].toUpperCase(),
      color: m[3],
      mrpPaise: mrpToPaise(m[4]),
      sizeInfo: null,
    }
  },

  campusFull(name) {
    const m = name.match(/^([0-9]{1,2}[A-Z])-([A-Z0-9]+)-(.+)_([GLCK])$/i)
    if (!m) return null
    return {
      model: `${m[1]}-${m[2]}-${m[3]}`,
      gender: genderFromToken(m[4]),
      genderToken: m[4].toUpperCase(),
      colorCode: m[4].toUpperCase(),
      color: null,
      mrpPaise: null,
      sizeInfo: null,
    }
  },

  campusSuffix(name) {
    const r = name.match(/^(.+)_([GLCK])$/)
    if (!r) return null
    return {
      model: r[1],
      gender: genderFromToken(r[2]),
      genderToken: r[2].toUpperCase(),
      colorCode: r[2].toUpperCase(),
      color: null,
      mrpPaise: null,
      sizeInfo: null,
    }
  },

  mrpTail(name) {
    const m = name.match(/^(.+?)\s+MRP\s*([\d.]+)$/i)
    if (!m) return null
    const words = m[1].trim().split(/\s+/)
    let model = words
    let color: string | null = null
    const last = words[words.length - 1]
    if (words.length > 1 && COLOR_WORDS.has(last.toUpperCase())) {
      color = last
      model = words.slice(0, -1)
    }
    return {
      model: model.join(" "),
      gender: null,
      genderToken: null,
      colorCode: color ? color.toUpperCase() : null,
      color,
      mrpPaise: mrpToPaise(m[2]),
      sizeInfo: null,
    }
  },

  sizeRange(name) {
    const s = String(name)
    // "4974 Navy 1045" — article + color + trailing code, no MRP/size
    let w = s.match(/^(\d{3,4})\s+([A-Z]{2,})\s+(\d{3,4})$/i)
    if (w) {
      return { model: `${w[1]}-${w[3]}`, gender: null, genderToken: null, colorCode: w[2].toUpperCase(), color: w[2], mrpPaise: null, sizeInfo: null }
    }
    let m = s.match(/^([A-Z0-9]+(?:[- ][A-Z0-9]+)*?\d[A-Z0-9-]*)\s+([A-Z]+)\s+(\d{1,2}-\d{1,2}|\d{1,2}X\d{1,2})\s+(?:MRP\s*)?([\d.]+)?$/i)
    if (m) {
      return { model: m[1].trim(), gender: null, genderToken: null, colorCode: m[2].toUpperCase(), color: m[2], mrpPaise: mrpToPaise(m[4]), sizeInfo: m[3] }
    }
    m = s.match(/^([A-Z0-9]+(?:[- ][A-Z0-9]+)*?\d[A-Z0-9-]*)\s+([A-Z]+)\s+MRP\s*([\d.]*)\s*(\d{1,2}-\d{1,2}|\d{1,2}X\d{1,2})?\s*$/i)
    if (m) {
      return { model: m[1].trim(), gender: null, genderToken: null, colorCode: m[2].toUpperCase(), color: m[2], mrpPaise: mrpToPaise(m[3]), sizeInfo: m[4] || null }
    }
    m = s.match(/^([A-Z0-9]+(?:[- ][A-Z0-9]+)*?\d[A-Z0-9-]*)\s+([A-Z]+)(?:\s+([A-Z0-9]{1,3}))?\s*$/i)
    if (!m) return null
    return { model: m[1].trim(), gender: null, genderToken: null, colorCode: m[2].toUpperCase(), color: m[2], mrpPaise: null, sizeInfo: null }
  },
}

export function resolveGroupConfig(group?: string | null): GroupConfig {
  const g = String(group || "").trim().toLowerCase()
  const exact = GROUP_CONFIGS.find((c) => c.match.parent && c.match.parent.trim().toLowerCase() === g)
  if (exact) return exact
  const partial = GROUP_CONFIGS.find((c) => c.match.parent && g.includes(c.match.parent.trim().toLowerCase()))
  if (partial) return partial
  return GROUP_CONFIGS.find((c) => !c.match.parent)!
}

export function parseStockItem(item: TallyStockItem): ParsedStockItem {
  const warnings: string[] = []
  const group = item.parent || ""
  const name = String(item.name || "").trim().replace(/\s+MRP\s*$/i, "")
  const config = resolveGroupConfig(group)

  let parsed: ParsedFields | null = null
  for (const strategyName of config.parse || []) {
    const fn = STRATEGIES[strategyName]
    if (!fn) throw new Error(`Unknown parse strategy "${strategyName}" in group config "${config.key}"`)
    parsed = fn(name)
    if (parsed) break
  }
  if (!parsed) {
    parsed = { model: name, gender: null, genderToken: null, colorCode: null, color: null, mrpPaise: null, sizeInfo: null }
    warnings.push("no pattern matched — used raw name")
  }

  const quantity = parseQty(item.closingQty)
  if (quantity == null) warnings.push("no closing quantity")

  const unit = String(item.unit || "").trim().toUpperCase()
  if (!SELLABLE_UNITS.includes(unit) && quantity != null && quantity > 0) {
    warnings.push(`unit "${unit}" is not PRS/PCS — review before syncing`)
  }

  const fields = {
    ...parsed,
    brand: config.brand,
    ...(config.priceFromName ? {} : { mrpPaise: null }),
  }

  const rawParts = ["RRF", config.brand, ...(config.skuParts || []).map((k) => (fields as Record<string, unknown>)[k])]
    .filter(Boolean)
    .map((p) => normalize(p))
    .filter(Boolean)
  const skuParts = rawParts.filter((part, i) => i === 0 || part !== rawParts[i - 1])
  let sku = skuParts.join("-")
  if (config.priceFromName && fields.mrpPaise != null) sku += `-MRP${fields.mrpPaise}`
  if (skuParts.length < 2) {
    sku = `RRF-UNKNOWN-${normalize(name)}`
    warnings.push("empty SKU parts")
  }
  if (!config.sync) warnings.push(`group "${group}" has sync disabled in group-configs.ts`)

  return {
    ok: warnings.length === 0,
    sku,
    tallyName: name,
    group,
    groupKey: config.key,
    brand: config.brand,
    syncAllowed: !!config.sync,
    gender: parsed.gender,
    model: parsed.model,
    color: parsed.color,
    colorCode: parsed.colorCode,
    mrpPaise: parsed.mrpPaise,
    sizeInfo: parsed.sizeInfo,
    quantity,
    unit: unit || null,
    warnings,
  }
}
