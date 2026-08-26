const { test } = require("node:test")
const assert = require("node:assert/strict")
const { normalize, collectionStem } = require("./identity")

test("normalize collapses separators and uppercases", () => {
  assert.equal(normalize("Walkaroo Shoes! 123"), "WALKAROO-SHOES-123")
  assert.equal(normalize("  leading and trailing  "), "LEADING-AND-TRAILING")
  assert.equal(normalize(""), "")
  assert.equal(normalize(null), "")
  // strips diacritics then normalizes
  assert.equal(normalize("Café"), "CAFE")
})

test("collectionStem maps known brand names", () => {
  assert.equal(collectionStem("Walkaroo"), "walkaroo")
  assert.equal(collectionStem("Campus Shoes"), "campus")
  assert.equal(collectionStem("ADDA Shoes"), "adda")
  assert.equal(collectionStem("WOODLAND"), "woodland")
})

test("collectionStem falls back to slashed text or unknown", () => {
  assert.equal(collectionStem("Something Else"), "somethingelse")
  assert.equal(collectionStem(""), "unknown")
  assert.equal(collectionStem(null), "unknown")
})
