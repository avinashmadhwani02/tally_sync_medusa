const { test } = require("node:test")
const assert = require("node:assert/strict")
const { computeDiff, mapState, STEPS } = require("./run")

test("STEPS lists all supported pipeline stages", () => {
  assert.deepEqual(STEPS, ["all", "fetch", "push"])
})

test("computeDiff: nothing changes when state already matches", () => {
  const diff = computeDiff({ A: 5 }, [{ variants: [{ sku: "A", quantity: 5 }] }])
  assert.deepEqual(diff, { toCreate: [], toUpdate: [], toRemove: [] })
})

test("computeDiff flags new, changed and removed SKUs", () => {
  const plans = [
    { variants: [{ sku: "A", quantity: 7 }, { sku: "B", quantity: 2 }] },
  ]
  const diff = computeDiff({ A: 5, Z: 9 }, plans)
  assert.deepEqual(diff.toUpdate, ["A"])
  assert.deepEqual(diff.toCreate, ["B"])
  assert.deepEqual(diff.toRemove, ["Z"])
})

test("mapState flattens variants into sku -> quantity", () => {
  const state = mapState([{ variants: [{ sku: "A", quantity: 5 }, { sku: "B", quantity: 2 }] }])
  assert.deepEqual(state, { A: 5, B: 2 })
})

test("mapState handles plans without a variants array", () => {
  assert.deepEqual(mapState([{ sku: "S", quantity: 1 }]), {})
})