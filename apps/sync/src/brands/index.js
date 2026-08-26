/**
 * Brand registry. Only Walkaroo / Campus / ADDA are in scope.
 * ADDA parser is a stub until its naming rules are added.
 */
const walkaroo = require("./walkaroo")
const campus = require("./campus")
const adda = require("./adda")

const BRANDS = [walkaroo, campus, adda]
const ENABLED_BRANDS = BRANDS.filter((b) => b.enabled).map((b) => b.key)

function detectBrand(item) {
  for (const b of BRANDS) {
    if (b.isMatch?.(item)) return b
  }
  return null
}

/** "all" = every enabled brand. Also accepts "campus,walkaroo". */
function brandFilterAllows(filter, brandKey) {
  const raw = String(filter ?? "all").trim().toLowerCase()
  if (!raw || raw === "all" || raw === "*") return ENABLED_BRANDS.includes(brandKey)
  const wanted = raw.split(/[,\s]+/).filter(Boolean)
  return wanted.includes(String(brandKey || "").toLowerCase())
}

function parseStockRow(item, logger, ctx) {
  const brand = detectBrand(item)
  if (!brand) {
    logger?.debug("skipping item outside Walkaroo / Campus / ADDA", {
      name: item.name,
      parent: item.parent,
    })
    return {
      ok: false,
      skipped: true,
      reason: "not walkaroo/campus/adda",
      found: { parent: item.parent, name: item.name },
    }
  }
  const parse = brand.parseItem
  return parse(item, logger, ctx)
}

module.exports = {
  BRANDS,
  ENABLED_BRANDS,
  detectBrand,
  parseStockRow,
  brandFilterAllows,
  ALLOWED_BRANDS: BRANDS.map((b) => b.key),
}
