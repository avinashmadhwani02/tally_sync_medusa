/**
 * Stage — structural validation of a fetched stock export, before any writes.
 * Returns a list of problems; an empty array means "safe to transform".
 */
function validateItems(items) {
  const problems = []
  if (!Array.isArray(items)) return ["items is not an array"]

  items.forEach((it, i) => {
    if (it == null || typeof it !== "object") {
      problems.push(`items[${i}]: not an object`)
      return
    }
    // A usable stock row only needs a name; parent/partNumber can be blank
    // (ungrouped items are simply filtered out during transform, not fatal).
    if (!String(it.name || "").trim()) problems.push(`items[${i}]: missing name`)
  })
  return problems
}

/** Count items by brand (parent) for reporting. */
function groupByBrand(items) {
  const counts = {}
  for (const it of items) {
    if (!it) continue
    const b = String(it.parent || "(none)")
    counts[b] = (counts[b] || 0) + 1
  }
  return counts
}

module.exports = {
  validateItems,
  groupByBrand,
  validateItems: validateItems,
  groupByBrand: groupByBrand,
}