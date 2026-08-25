/**
 * Stable identity helpers for matching Medusa catalog rows.
 */
function normalize(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase()
}

function collectionStem(title) {
  const c = String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
  if (c.includes("walk")) return "walkaroo"
  if (c.includes("campus")) return "campus"
  if (c.includes("adda")) return "adda"
  return c || "unknown"
}

module.exports = {
  normalize,
  collectionStem,
  collectionStem: collectionStem,
}
