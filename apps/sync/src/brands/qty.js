function parseQty(closingQty) {
  const m = String(closingQty ?? "").match(/(-?\d+(?:\.\d+)?)/)
  const n = m ? parseFloat(m[1]) : NaN
  return Number.isFinite(n) ? n : 0
}

function parseRate(v) {
  const m = String(v ?? "").match(/(\d+(?:\.\d+)?)/)
  const n = m ? parseFloat(m[1]) : NaN
  return Number.isFinite(n) ? n : null
}

module.exports = { parseQty, parseRate }
