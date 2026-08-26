/**
 * Campus stock names.
 *
 * Tally Stock Summary shows an article with total qty:
 *   22C-166A-TECH CH_C    18.00 PRS
 * Press Enter to see size/color rows (batches or child items):
 *   S2641A-02-C2  S.GRN/WHT    1.00 PRS
 *   S2754-01-C3                2.00 PRS
 *
 * Size token is gender letter + number:
 *   C2 / C3  = Kids (Child) size 2 / 3
 *   G7 / G8  = Men (Gents)
 *   L5 / L6  = Women (Ladies)
 *   K1       = Kids
 *
 * Article suffix _C / _G / _L / _K is the same gender mapping.
 */
const { parseQty, parseRate } = require("./qty")

const SIZE_GENDER = {
  C: { token: "KIDS", label: "Kids" },
  K: { token: "KIDS", label: "Kids" },
  G: { token: "GENTS", label: "Men" },
  L: { token: "LADIES", label: "Women" },
}

const ARTICLE_RE = /^(\d{1,2}[A-Z]-[\w]+-.+)_([GLCK])$/i
const SKU_RE = /^(S[A-Z0-9]+)-(\d{2})-([GLCK])(\d{1,2})(?:\s+(.+))?$/i

function isCampus(item) {
  const parent = String(item.parent || "")
  const name = String(item.name || "")
  const article = String(item.article || "")
  if (/campus/i.test(parent) || /campus/i.test(name) || /campus/i.test(article)) return true
  if (parseArticle(name) || parseArticle(parent) || parseArticle(article)) return true
  if (parseSku(name) && (parseArticle(parent) || parseArticle(article))) return true
  return false
}

function parseArticle(name) {
  const m = String(name || "").trim().match(ARTICLE_RE)
  if (!m) return null
  const letter = m[2].toUpperCase()
  const g = SIZE_GENDER[letter]
  return {
    article: String(name).trim(),
    model: m[1].trim(),
    genderLetter: letter,
    gender: g?.token || letter,
    genderLabel: g?.label || letter,
  }
}

function parseSku(name) {
  const raw = String(name || "").trim()
  const m = raw.match(SKU_RE)
  if (!m) return null
  const letter = m[3].toUpperCase()
  const g = SIZE_GENDER[letter]
  const colorText = (m[5] || "").trim() || null
  const size = `${letter}${m[4]}`
  return {
    sku: `${m[1].toUpperCase()}-${m[2]}-${size}`,
    style: m[1].toUpperCase(),
    colorCode: m[2],
    color: colorText || m[2],
    colorName: colorText || m[2],
    size,
    sizeNumber: m[4],
    genderLetter: letter,
    gender: g?.token || letter,
    genderLabel: g?.label || letter,
  }
}

function productIdFor(article) {
  const parsed = parseArticle(article)
  const model = parsed?.model || String(article || "").trim()
  const slug = String(model)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase()
  return `CAMPUS-${slug}`
}

function parseItem(item, logger, ctx = {}) {
  const name = String(item.name || "").trim()
  const parent = String(item.parent || "").trim()
  const articleName = String(item.article || "").trim()
  const unit = String(item.unit || "").trim() || null
  const qty = parseQty(item.closingQty)

  logger?.info("reading Campus stock", { name, parent, article: articleName || null, qty, unit })

  const skuParsed = parseSku(name)
  const articleParsed = parseArticle(name)

  // Outer Stock Summary row — skip when size/color rows exist so qty is not doubled.
  if (articleParsed && !skuParsed) {
    const hasSkus = ctx.campusArticlesWithSkus?.has(name.toUpperCase())
    if (hasSkus || qty <= 0) {
      logger?.info("skipping Campus article header — waiting for size/color rows", {
        name,
        qty,
        hasSkus: Boolean(hasSkus),
      })
      return {
        ok: false,
        skipped: true,
        reason: "campus article header (size/color rows carry the stock)",
        found: { parent, name },
      }
    }
    const productId = productIdFor(name)
    const result = {
      ok: true,
      brand: "campus",
      brandLabel: "Campus",
      productId,
      handle: productId.toLowerCase(),
      title: `Campus ${articleParsed.model}`,
      model: articleParsed.model,
      gender: articleParsed.gender,
      genderLabel: articleParsed.genderLabel,
      color: "Default",
      colorName: "Default",
      size: null,
      sku: productId,
      quantity: qty,
      unit,
      mrp: parseRate(item.rate || item.mrp),
      found: { parent, name, article: name },
    }
    logger?.info("using Campus article total as stock (no size/color rows fetched)", {
      name,
      product: result.productId,
      qty,
    })
    return result
  }

  if (!skuParsed) {
    logger?.warn("could not parse Campus name — skipped", { name, parent, article: articleName })
    return {
      ok: false,
      skipped: true,
      reason: "unrecognized Campus name pattern",
      found: { parent, name },
    }
  }

  const article =
    articleName ||
    (parseArticle(parent) ? parent : null) ||
    `${skuParsed.style}`

  const articleMeta = parseArticle(article)
  const gender = skuParsed.gender || articleMeta?.gender
  const genderLabel = skuParsed.genderLabel || articleMeta?.genderLabel
  const productId = productIdFor(article)
  const model = articleMeta?.model || article

  const result = {
    ok: true,
    brand: "campus",
    brandLabel: "Campus",
    productId,
    handle: productId.toLowerCase(),
    title: `Campus ${model}`,
    model,
    gender,
    genderLabel,
    color: skuParsed.color,
    colorName: skuParsed.colorName,
    size: skuParsed.size,
    sku: skuParsed.sku,
    quantity: qty,
    unit,
    mrp: parseRate(item.rate || item.mrp),
    found: { parent, name, article },
  }

  logger?.info("extracted Campus fields", {
    name,
    article,
    product: result.productId,
    sku: result.sku,
    color: result.color,
    size: result.size,
    qty: result.quantity,
    gender: result.gender,
    genderLabel: result.genderLabel,
  })

  return result
}

module.exports = {
  key: "campus",
  label: "Campus",
  enabled: true,
  isMatch: isCampus,
  parseItem,
  parseArticle,
  parseSku,
}
