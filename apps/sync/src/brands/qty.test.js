const { test } = require("node:test")
const assert = require("node:assert/strict")
const { parseQty, parseRate } = require("./qty")

test("parseQty extracts a leading signed number", () => {
  assert.equal(parseQty("4.00 PCS"), 4)
  assert.equal(parseQty("18.00 PRS"), 18)
  assert.equal(parseQty("-3.5 PCS"), -3.5)
  assert.equal(parseQty(" 12 "), 12)
})

test("parseQty falls back to 0 on unparseable input", () => {
  assert.equal(parseQty(""), 0)
  assert.equal(parseQty(null), 0)
  assert.equal(parseQty(undefined), 0)
  assert.equal(parseQty("no numerical content"), 0)
  assert.equal(parseQty(NaN), 0)
})

test("parseRate extracts a decimal number (e.g. price per unit)", () => {
  assert.equal(parseRate("635.80/PRS"), 635.8)
  assert.equal(parseRate("269.00"), 269)
  assert.equal(parseRate("0"), 0)
})

test("parseRate returns null on unparseable input", () => {
  assert.equal(parseRate(""), null)
  assert.equal(parseRate(null), null)
  assert.equal(parseRate(undefined), null)
  assert.equal(parseRate("abc"), null)
})
