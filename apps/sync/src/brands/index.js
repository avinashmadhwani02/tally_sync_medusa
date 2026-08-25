/**
 * Brand registry. Only Walkaroo / Campus / ADDA are in scope.
 * Campus and ADDA parsers are stubs until their naming rules are added.
 */
const walkaroo = require("./walkaroo")
const campus = require("./campus")
const adda = require("./adda")

const BRANDS = [walkaroo, campus, adda]

function detectBrand(item) {
  for (const b of BRANDS) {
    if (b.isMatch?.(item) || b.isMatch?.(item)) return b
  }
  return null
}

function parseStockRow(item, logger) {
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
  const parse = brand.parseItem || brand.parseItem
  return parse(item, logger)
}

module.exports = {
  BRANDS,
  detectBrand,
  parseStockRow,
  parseStockRow: parseStockRow,
  ALLOWED_BRANDS: BRANDS.map((b) => b.key),
}
