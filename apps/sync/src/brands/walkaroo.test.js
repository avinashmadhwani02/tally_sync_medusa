const { test } = require("node:test")
const assert = require("node:assert/strict")
const { parseHyphenOrSpace, parseItem } = require("./walkaroo")

test("hyphenated Walkaroo names share a product and split on color", () => {
  const a = parseHyphenOrSpace("WALKAROO-WLR72017-LADIES-PAIR-BRN-MRP-269-00")
  const b = parseHyphenOrSpace("WALKAROO-WLR72017-LADIES-PAIR-CRM-MRP-269-00")
  assert.equal(a.productId, "WALKAROO-WLR72017")
  assert.equal(b.productId, "WALKAROO-WLR72017")
  assert.equal(a.color, "BRN")
  assert.equal(a.colorName, "Brown")
  assert.equal(b.color, "CRM")
  assert.equal(b.colorName, "Cream")
  assert.equal(a.gender, "LADIES")
  assert.equal(a.genderLabel, "Women")
  assert.equal(a.mrp, 269)
  assert.equal(a.size, null)
})

test("space-separated Walkaroo group names", () => {
  const p = parseHyphenOrSpace("WLR72017 LADIES PAIR BRN [MRP-269.00]")
  assert.equal(p.productId, "WALKAROO-WLR72017")
  assert.equal(p.color, "BRN")
  assert.equal(p.mrp, 269)
})

test("optional size token before MRP", () => {
  const p = parseHyphenOrSpace("WALKAROO-WLR72017-LADIES-PAIR-BRN-8-MRP-269-00")
  assert.equal(p.size, "8")
  assert.equal(p.color, "BRN")
})

test("parseItem builds variant sku and quantity", () => {
  const row = parseItem({
    name: "WALKAROO-WLR72017-LADIES-PAIR-BRN-MRP-269-00",
    parent: "Walkaroo",
    closingQty: "4.00 PCS",
    unit: "PCS",
  })
  assert.equal(row.ok, true)
  assert.equal(row.sku, "WALKAROO-WLR72017-BRN")
  assert.equal(row.quantity, 4)
})
