const { test } = require("node:test")
const assert = require("node:assert/strict")
const { parseArticle, parseSku, parseItem } = require("./campus")

test("article suffix _C is kids", () => {
  const a = parseArticle("22C-166A-TECH CH_C")
  assert.equal(a.model, "22C-166A-TECH CH")
  assert.equal(a.genderLetter, "C")
  assert.equal(a.genderLabel, "Kids")
})

test("C2 / C3 are kids sizes; G and L are men / women", () => {
  const kid = parseSku("S2641A-02-C2 S.GRN/WHT")
  assert.equal(kid.sku, "S2641A-02-C2")
  assert.equal(kid.size, "C2")
  assert.equal(kid.genderLabel, "Kids")
  assert.equal(kid.color, "S.GRN/WHT")

  const men = parseSku("S2641A-02-G8")
  assert.equal(men.size, "G8")
  assert.equal(men.genderLabel, "Men")

  const women = parseSku("S2754-01-L6 NAVY/BLK")
  assert.equal(women.size, "L6")
  assert.equal(women.genderLabel, "Women")
  assert.equal(women.color, "NAVY/BLK")
})

test("size/color row becomes a variant under the article product", () => {
  const row = parseItem({
    name: "S2641A-02-C2 S.GRN/WHT",
    parent: "22C-166A-TECH CH_C",
    article: "22C-166A-TECH CH_C",
    closingQty: "1.00 PRS",
    unit: "PRS",
  })
  assert.equal(row.ok, true)
  assert.equal(row.productId, "CAMPUS-22C-166A-TECH-CH")
  assert.equal(row.sku, "S2641A-02-C2")
  assert.equal(row.size, "C2")
  assert.equal(row.color, "S.GRN/WHT")
  assert.equal(row.genderLabel, "Kids")
  assert.equal(row.quantity, 1)
})

test("article header is skipped when size/color rows exist", () => {
  const row = parseItem(
    {
      name: "22C-166A-TECH CH_C",
      parent: "Campus Shoes",
      closingQty: "18.00 PRS",
    },
    null,
    { campusArticlesWithSkus: new Set(["22C-166A-TECH CH_C"]) }
  )
  assert.equal(row.ok, false)
  assert.equal(row.skipped, true)
})

test("Tally batch name without colour text is a variant under the article", () => {
  const row = parseItem({
    name: "S2641A-02-C2",
    parent: "Campus Shoes",
    article: "22C-166A-TECH CH_C",
    closingQty: "4",
    unit: "PRS",
    rate: "635.80/PRS",
  })
  assert.equal(row.ok, true)
  assert.equal(row.productId, "CAMPUS-22C-166A-TECH-CH")
  assert.equal(row.sku, "S2641A-02-C2")
  assert.equal(row.size, "C2")
  assert.equal(row.color, "02")
  assert.equal(row.quantity, 4)
  assert.equal(row.mrp, 635.8)
})

test("article header is used as stock when Tally did not send size rows", () => {
  const row = parseItem({
    name: "22C-166A-TECH CH_C",
    parent: "Campus Shoes",
    closingQty: "18.00 PRS",
  })
  assert.equal(row.ok, true)
  assert.equal(row.quantity, 18)
  assert.equal(row.productId, "CAMPUS-22C-166A-TECH-CH")
})
