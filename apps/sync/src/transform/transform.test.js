const { test } = require("node:test")
const assert = require("node:assert/strict")
const { transformItems } = require("./index")

test("aggregates Walkaroo colors onto one product", () => {
  const { plans } = transformItems([
    { name: "WALKAROO-WLR72017-LADIES-PAIR-BRN-MRP-269-00", parent: "Walkaroo", closingQty: "2 PCS" },
    { name: "WALKAROO-WLR72017-LADIES-PAIR-CRM-MRP-269-00", parent: "Walkaroo", closingQty: "5 PCS" },
    { name: "SOME OTHER BRAND ITEM", parent: "Nike", closingQty: "10 PCS" },
  ])
  assert.equal(plans.length, 1)
  assert.equal(plans[0].productId, "WALKAROO-WLR72017")
  assert.equal(plans[0].variants.length, 2)
  assert.equal(plans[0].quantity, 7)
  const colors = plans[0].variants.map((v) => v.color).sort()
  assert.deepEqual(colors, ["BRN", "CRM"])
  assert.equal(plans[0].product.options[0].title, "Color")
  assert.equal(plans[0].product.metadata.gender, "Women")
  assert.equal(plans[0].product.metadata.tally_gender, "LADIES")
  assert.equal(plans[0].product.subtitle, "Women")
  assert.equal(plans[0].product.variants[0].prices[0].amount, 269)
  assert.equal(plans[0].product.variants[0].prices[0].currency_code, "inr")
})

test("sums quantity when the same variant appears twice", () => {
  const { plans } = transformItems([
    { name: "WALKAROO-WLR72017-LADIES-PAIR-BRN-MRP-269-00", parent: "Walkaroo", closingQty: "2 PCS" },
    { name: "WALKAROO-WLR72017-LADIES-PAIR-BRN-MRP-269-00", parent: "Walkaroo", closingQty: "3 PCS" },
  ])
  assert.equal(plans[0].variants.length, 1)
  assert.equal(plans[0].variants[0].quantity, 5)
})
