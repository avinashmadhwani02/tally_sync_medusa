const { test } = require("node:test")
const assert = require("node:assert/strict")
const { detectBrand, parseStockRow, brandFilterAllows, ENABLED_BRANDS, ALLOWED_BRANDS } = require("./index")

const walkaroo = { name: "WALKAROO-WLR72017-LADIES-PAIR-BRN-MRP-269-00", parent: "Walkaroo", closingQty: "2 PCS" }
const campus = { name: "S2641A-02-C2", parent: "Campus Shoes", article: "22C-166A-TECH CH_C", closingQty: "4" }
const adda = { name: "ADDASOMETHING MRP499", parent: "ADDA", closingQty: "3" }
const nike = { name: "Some Foreign Brand", parent: "Nike", closingQty: "9" }

test("registry exposes only enabled brands plus full allowed list", () => {
  assert.deepEqual(ENABLED_BRANDS, ["walkaroo", "campus"])
  assert.deepEqual(ALLOWED_BRANDS, ["walkaroo", "campus", "adda"])
})

test("detectBrand maps parent/name to the right parser", () => {
  assert.equal(detectBrand(walkaroo)?.key, "walkaroo")
  assert.equal(detectBrand(campus)?.key, "campus")
  assert.equal(detectBrand(adda)?.key, "adda")
  assert.equal(detectBrand(nike), null)
})

test("detectBrand also matches Walkaroo by name without a matching parent", () => {
  assert.equal(detectBrand({ name: "WALKAROO-WLR72017", parent: "OTHER" })?.key, "walkaroo")
})

test("parseStockRow parses enabled brands and skips out-of-scope groups", () => {
  const w = parseStockRow(walkaroo)
  assert.equal(w.ok, true)
  assert.equal(w.brand, "walkaroo")

  const n = parseStockRow(nike)
  assert.equal(n.ok, false)
  assert.equal(n.skipped, true)
  assert.match(n.reason, /not walkaroo\/campus\/adda/i)
})

test("parseStockRow reports ADDA as not-enabled yet", () => {
  const a = parseStockRow(adda)
  assert.equal(a.ok, false)
  assert.equal(a.skipped, true)
  assert.match(a.reason, /not enabled/i)
})

test("brandFilterAllows: 'all' means every enabled brand", () => {
  assert.equal(brandFilterAllows("all", "walkaroo"), true)
  assert.equal(brandFilterAllows("all", "campus"), true)
  assert.equal(brandFilterAllows("all", "adda"), false) // adda is not enabled
})

test("brandFilterAllows: specific list is case/whitespace tolerant", () => {
  assert.equal(brandFilterAllows("walkaroo", "walkaroo"), true)
  assert.equal(brandFilterAllows("CAMPUS", "campus"), true)
  assert.equal(brandFilterAllows("campus,walkaroo", "campus"), true)
  assert.equal(brandFilterAllows(" walkaroo ", "walkaroo"), true)
  assert.equal(brandFilterAllows("campus", "walkaroo"), false)
  assert.equal(brandFilterAllows("nike", "walkaroo"), false)
})

test("brandFilterAllows: empty / '*' means all enabled", () => {
  assert.equal(brandFilterAllows("", "walkaroo"), true)
  assert.equal(brandFilterAllows("*", "campus"), true)
  assert.equal(brandFilterAllows(null, "walkaroo"), true)
  assert.equal(brandFilterAllows(undefined, "campus"), true)
})
