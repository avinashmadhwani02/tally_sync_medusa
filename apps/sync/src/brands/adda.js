function isAdda(item) {
  const parent = String(item.parent || "").toLowerCase().replace(/[^a-z]/g, "")
  const name = String(item.name || "").toUpperCase()
  return parent.includes("adda") || name.startsWith("ADDA")
}

function parseItem(item, logger) {
  const name = String(item.name || "").trim()
  logger?.info("skipping ADDA item — parser not enabled yet", {
    name,
    parent: item.parent,
  })
  return {
    ok: false,
    skipped: true,
    reason: "ADDA parser not enabled yet",
    found: { parent: item.parent, name },
  }
}

module.exports = {
  key: "adda",
  label: "ADDA",
  enabled: false,
  isMatch: isAdda,
  isMatch: isAdda,
  parseItem,
  parseItem: parseItem,
}
