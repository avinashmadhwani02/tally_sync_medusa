/**
 * Walkaroo stock names.
 *
 * Typical Tally name (hyphenated):
 *   WALKAROO-WLR72017-LADIES-PAIR-BRN-MRP-269-00
 *   WALKAROO-WLR72017-LADIES-PAIR-CRM-MRP-269-00
 *
 * Same product id WALKAROO-WLR72017, two color variants (BRN / CRM).
 *
 * Also seen as a group row:
 *   parent = Walkaroo
 *   name   = WLR72017 LADIES PAIR BRN [MRP-269.00]
 */
const { parseQty } = require("./qty")

const GENDER = new Set([
  "GENTS", "LADIES", "LADY", "WOMEN", "MEN", "BOYS", "GIRLS", "KIDS", "KID",
])
const UNIT_TOKENS = new Set(["PAIR", "PAIRS", "PCS", "PC", "PRS"])

const COLOR_NAMES = {
  BRN: "Brown",
  CRM: "Cream",
  BLK: "Black",
  WHT: "White",
  BLU: "Blue",
  GRN: "Green",
  OGRN: "Olive Green",
  PNK: "Pink",
  RED: "Red",
  GRY: "Grey",
  GRAY: "Grey",
  GREY: "Grey",
  NVY: "Navy",
  NAVY: "Navy",
  TAN: "Tan",
  BGE: "Beige",
  BEG: "Beige",
  YLW: "Yellow",
  YEL: "Yellow",
  OLIVE: "Olive",
  OLV: "Olive",
  MAROON: "Maroon",
  MULTI: "Multi",
  WHITE: "White",
  BLACK: "Black",
  BROWN: "Brown",
  CREAM: "Cream",
}

function isWalkaroo(item) {
  const parent = String(item.parent || "").toLowerCase()
  const name = String(item.name || "").toUpperCase()
  return parent.includes("walkaroo") || name.startsWith("WALKAROO")
}

function colorLabel(code) {
  if (!code) return null
  const key = String(code).toUpperCase()
  return COLOR_NAMES[key] || code
}

const GENDER_LABELS = {
  GENTS: "Men",
  MEN: "Men",
  LADIES: "Women",
  LADY: "Women",
  WOMEN: "Women",
  BOYS: "Kids",
  GIRLS: "Kids",
  KIDS: "Kids",
  KID: "Kids",
}

function genderLabel(token) {
  if (!token) return null
  return GENDER_LABELS[String(token).toUpperCase()] || token
}

function parseMrpTokens(tokens, mrpIdx) {
  const a = tokens[mrpIdx + 1]
  const b = tokens[mrpIdx + 2]
  if (a == null) return null
  if (b != null && /^\d+$/.test(a) && /^\d{1,2}$/.test(b)) {
    return parseFloat(`${a}.${b}`)
  }
  const n = parseFloat(String(a).replace(/[^0-9.]/g, ""))
  return Number.isFinite(n) ? n : null
}

function parseHyphenOrSpace(name) {
  const raw = String(name || "").trim()
  if (!raw) return null

  const tokens = raw
    .replace(/[\[\]]/g, " ")
    .split(/[-\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
  if (!tokens.length) return null

  const upper = tokens.map((t) => t.toUpperCase())
  let i = 0
  if (upper[0] === "WALKAROO") i = 1
  if (i >= upper.length) return null

  const model = upper[i++]
  if (!model || GENDER.has(model) || UNIT_TOKENS.has(model) || model === "MRP") return null

  let gender = null
  if (GENDER.has(upper[i])) gender = upper[i++]

  if (UNIT_TOKENS.has(upper[i])) i++

  const mrpIdx = upper.findIndex((t, idx) => idx >= i && t === "MRP")
  const beforeMrp = mrpIdx === -1 ? upper.slice(i) : upper.slice(i, mrpIdx)
  if (!beforeMrp.length) return null

  let color = beforeMrp[0]
  let size = null
  if (beforeMrp.length >= 2) {
    const last = beforeMrp[beforeMrp.length - 1]
    if (/^\d{1,2}$/.test(last)) {
      size = last
      color = beforeMrp.slice(0, -1).join("-") || color
    } else if (beforeMrp.length > 1) {
      color = beforeMrp.join("-")
    }
  }

  const mrp = mrpIdx === -1 ? null : parseMrpTokens(upper, mrpIdx)

  return {
    brand: "Walkaroo",
    model,
    productId: `WALKAROO-${model}`,
    gender,
    genderLabel: genderLabel(gender),
    color,
    colorName: colorLabel(color),
    size,
    mrp,
  }
}

function parseItem(item, logger) {
  const name = String(item.name || "").trim()
  const parent = String(item.parent || "").trim()
  const unit = String(item.unit || "").trim() || null
  const qty = parseQty(item.closingQty)

  logger?.info("reading Walkaroo stock", { name, parent, qty, unit })

  const parsed = parseHyphenOrSpace(name)
  if (!parsed) {
    logger?.warn("could not parse Walkaroo name — skipped", { name, parent })
    return {
      ok: false,
      skipped: true,
      reason: "unrecognized Walkaroo name pattern",
      found: { parent, name },
    }
  }

  const sku = parsed.size
    ? `${parsed.productId}-${parsed.color}-${parsed.size}`
    : `${parsed.productId}-${parsed.color}`

  const result = {
    ok: true,
    brand: "walkaroo",
    brandLabel: "Walkaroo",
    productId: parsed.productId,
    handle: parsed.productId.toLowerCase(),
    title: `Walkaroo ${parsed.model}`,
    model: parsed.model,
    gender: parsed.gender,
    genderLabel: parsed.genderLabel,
    color: parsed.color,
    colorName: parsed.colorName,
    size: parsed.size,
    sku,
    quantity: qty,
    unit,
    mrp: parsed.mrp,
    found: { parent, name },
  }

  logger?.info("extracted Walkaroo fields", {
    name,
    product: result.productId,
    sku: result.sku,
    color: result.color,
    colorName: result.colorName,
    size: result.size || "(none)",
    qty: result.quantity,
    mrp: result.mrp,
    gender: result.gender,
    genderLabel: result.genderLabel,
  })

  return result
}

module.exports = {
  key: "walkaroo",
  label: "Walkaroo",
  enabled: true,
  isMatch: isWalkaroo,
  isMatch: isWalkaroo,
  parseItem,
  parseItem: parseItem,
  parseHyphenOrSpace,
  parseHyphenOrSpace: parseHyphenOrSpace,
  genderLabel,
}
