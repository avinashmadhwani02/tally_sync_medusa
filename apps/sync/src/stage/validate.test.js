const { test } = require("node:test")
const assert = require("node:assert/strict")
const { validateItems, groupByBrand } = require("./validate")

test("validateItems accepts well-formed rows", () => {
  assert.deepEqual(validateItems([{ name: "WALKAROO-X", parent: "Walkaroo" }]), [])
  assert.deepEqual(validateItems([]), [])
})

test("validateItems rejects non-arrays", () => {
  assert.equal(validateItems(null).length, 1)
  assert.equal(validateItems(undefined).length, 1)
  assert.equal(validateItems("items").length, 1)
})

test("validateItems flags missing names and non-object rows", () => {
  const problems = validateItems([
    { name: "", parent: "Walkaroo" },
    null,
    "not an object",
    { name: "  " },
  ])
  assert.equal(problems.length, 4)
  assert.ok(problems.some((p) => /missing name/.test(p)))
  assert.ok(problems.some((p) => /not an object/.test(p)))
})

test("groupByBrand tallies rows by parent (default '(none)')", () => {
  const counts = groupByBrand([
    { name: "a", parent: "Walkaroo" },
    { name: "b", parent: "Walkaroo" },
    { name: "c", parent: "Campus Shoes" },
    { name: "d" }, // no parent
    null, // skipped
  ])
  assert.deepEqual(counts, { Walkaroo: 2, "Campus Shoes": 1, "(none)": 1 })
})
