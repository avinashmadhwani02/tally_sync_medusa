function isCampus(item) {
  const parent = String(item.parent || "").toLowerCase()
  const name = String(item.name || "").toUpperCase()
  return parent.includes("campus") || name.startsWith("CAMPUS")
}

function parseItem(item, logger) {
  const name = String(item.name || "").trim()
  logger?.info("skipping Campus item — parser not enabled yet", {
    name,
    parent: item.parent,
  })
  return {
    ok: false,
    skipped: true,
    reason: "Campus parser not enabled yet",
    found: { parent: item.parent, name },
  }
}

module.exports = {
  key: "campus",
  label: "Campus",
  enabled: false,
  isMatch: isCampus,
  isMatch: isCampus,
  parseItem,
  parseItem: parseItem,
}
