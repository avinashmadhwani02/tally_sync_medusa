/**
 * Walkaroo — company-specific catalog map.
 *
 * Every Tally brand owns its own shape for turning raw Tally stock rows into
 * Medusa products + variants. That logic lives HERE (not in the shared engine),
 * so Walkaroo's conventions can evolve without disturbing Campus / ADDA etc.
 *
 * Raw Tally stock rows look like:
 *   "WLR72017 LADIES PAIR BRN [MRP-269.00]"   parent="Walkaroo" unit="PRS"
 *   "10574 GENTS PAIR GYTQ [MRP-659.00]"       parent="Walkaroo" unit="PCS"
 *
 * Understanding we build:
 *   - model   = article code (e.g. WLR72017)
 *   - gender  = GENTS / LADIES / BOYS / GIRLS / KIDS
 *   - color   = short code (e.g. BRN, CRM) -> human name (Brown, Cream)
 *   - The product is the *model + gender*; a color is a *variant* of it.
 *
 * We only keep the fields we care about for now: Name, quantity, color,
 * size, SKU ID. Everything else is ignored.
 */

const BRAND = "Walkaroo"
const PARENT = "Walkaroo"
const BRAND_SLUG = "WALKAROO"

const SELLABLE_UNITS = new Set(["PRS", "PCS", "PC", "PAIRS"])

const GENDER_NAMES = {
  GENTS: "Men", MEN: "Men",
  LADIES: "Women", LADY: "Women", WOMEN: "Women",
  BOYS: "Kids", GIRLS: "Kids", KIDS: "Kids",
}

/** Color-code -> human name. These are Walkaroo's own codes; add/refine here. */
const COLOR_NAMES = {
  BLK: "Black", BRN: "Brown", TAN: "Tan", WHT: "White",
  RED: "Red", BLU: "Blue", GRN: "Green", GRY: "Grey",
  GRE: "Grey", OLV: "Olive", PLM: "Plum", PRL: "Pearl",
  CRM: "Cream", MRN: "Maroon", BURG: "Burgundy", CML: "Camel",
  BGE: "Beige", CHK: "Check", MAV: "Mustard",
  NBLU: "Navy Blue", MBLU: "Mid Blue", TBLU: "True Blue", SBLU: "Sky Blue",
  LTBL: "Light Blue", DBLU: "Dark Blue", STBL: "Steel Blue",
  LGRY: "Light Grey", DGRY: "Dark Grey", CGRY: "Cool Grey",
  CGRN: "Light Green", DGRN: "Dark Green",
}

/** Two-tone colour-codes -> readable "X / Y". */
const COLOR_PAIRS = {
  BKOL: "Black / Olive", BKRD: "Black / Red", BKGY: "Black / Grey",
  BKGR: "Black / Green", BKBK: "Black / Black", BKTN: "Black / Tan",
  BLGY: "Blue / Grey", GYBL: "Grey / Blue", GNBG: "Green / Beige",
  OLBG: "Olive / Beige", BRBG: "Brown / Beige", BLGR: "Blue / Green",
  BLRD: "Blue / Red",
}

/** Colour display: prefer an explicit pair name, then single name, else code. */
function colorDisplay(code) {
  const c = String(code || "").toUpperCase()
  return COLOR_PAIRS[c] || COLOR_NAMES[c] || c
}

// ---- Field parsing ----------------------------------------------------------

/** Parse a Tally closing balance like "101.00 PRS" / "0.00 PCS" / "" -> number. */
function parseQty(closingQty) {
  const m = String(closingQty ?? "").match(/(-?\d+(?:\.\d+)?)/)
  const n = m ? parseFloat(m[1]) : NaN
  return Number.isFinite(n) ? n : null
}

function normalize(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase()
}

function genderFromToken(token) {
  const t = String(token || "").trim().toUpperCase()
  return GENDER_NAMES[t] || (t ? t[0] + t.slice(1).toLowerCase() : null)
}

const NAME_RE =
  /^([A-Za-z0-9]+)\s+(GENTS|LADIES|LADY|WOMEN|MEN|BOYS|GIRLS|KIDS)\s+\S+(?:\s+\S+)*?\s+([A-Za-z0-9]{2,4})\s*\[?\s*MRP-?\s*([\d.]+)\s*\]?$/i

/**
 * Parse one raw Tally stock item name for Walkaroo.
 * Returns { model, gender, genderToken, color, colorName } or null.
 */
function parseName(name) {
  const m = String(name || "").match(NAME_RE)
  if (!m) return null
  const color = m[3].toUpperCase()
  const colorName = colorDisplay(color)
  return {
    model: m[1].toUpperCase(),
    gender: genderFromToken(m[2]),
    genderToken: m[2].toUpperCase(),
    color,
    colorName,
  }
}
// ---- Product / variant building ---------------------------------------------

/**
 * Turn raw Walkaroo Tally rows into Medusa product+variants.
 * Returns an array of products; each has `.variants[]` (the Medusa create
 * payload, minus collection_id) plus a `.stock` map of `{ [sku]: quantity }`
 * for the sync engine.
 *
 * @param {Array} items raw tally stock rows filtered to this brand
 */
function buildProducts(items, opts = {}) {
  const { company = "RR FOOTWEAR" } = opts

  // productKey -> { model, genderToken, gender, colors: Map<code,{qty,colorName}> }
  const groups = new Map()
  for (const item of items) {
    const parsed = parseName(item.name)
    if (!parsed) continue
    const unit = String(item.unit || "").trim().toUpperCase()
    if (!SELLABLE_UNITS.has(unit)) continue // CTN / CASE etc are not sellable
    const qty = parseQty(item.closingQty)
    if (qty == null || qty <= 0) continue

    const pkey = `${parsed.model}|${parsed.genderToken}`
    const group = groups.get(pkey) || {
      model: parsed.model,
      genderToken: parsed.genderToken,
      gender: parsed.gender,
      colors: new Map(),
    }
    const color = group.colors.get(parsed.color) || { qty: 0 }
    color.qty += qty
    color.colorName = parsed.colorName
    group.colors.set(parsed.color, color)
    groups.set(pkey, group)
  }

  const products = []
  for (const group of groups.values()) {
    const model = group.model
    const genderWord = group.genderToken.toLowerCase()
    const title = `${BRAND} ${model} ${genderWord}`
    const handle = `${slugify(`${BRAND_SLUG}-${model}`)}-${genderWord}-free`
    const colorNames = {}
    const variants = []
    const stock = {}

    for (const [code, c] of group.colors) {
      const sku = `${BRAND_SLUG}-${model}-${group.genderToken}-${code}`
      const variantTitle = `${title} ${c.colorName}`
      colorNames[c.colorName] = true
      variants.push({
        title: variantTitle,
        sku,
        allow_backorder: false,
        manage_inventory: true,
        options: { Size: "Free Size", Color: c.colorName },
        prices: [],
      })
      stock[sku] = Math.round(c.qty)
    }

    products.push({
      title,
      description: `${title} — ${company}`,
      subtitle: `${BRAND} ${model}`,
      handle,
      status: "published",
      options: [
        { title: "Color", values: Object.keys(colorNames) },
        { title: "Size", values: ["Free Size"] },
      ],
      variants,
      stock,
      metadata: {
        tally_parent: PARENT,
        tally_model: model,
        tally_gender: group.gender || null,
        color_codes: [...group.colors.keys()],
        source: "tally-sync-script",
      },
    })
  }

  return products
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

module.exports = {
  brand: BRAND,
  parent: PARENT,
  parseName,
  parseQty,
  colorDisplay,
  buildProducts,
  SELLABLE_UNITS,
  COLOR_NAMES,
  GENDER_NAMES,
}