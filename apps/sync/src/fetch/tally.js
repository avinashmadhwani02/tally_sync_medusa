/**
 * Tally live fetch adapter (experimental — NOT the default).
 *
 * The desktop app had a working Tally Cloud client over HTTP XML
 * (apps/desktop/tallyClient.js). Rather than depend on its fast-xml-parser
 * dependency, we keep this module as a thin, self-contained adapter that
 * targets the same request/parse contract.
 *
 * NOTE: not exercised against a live Tally instance in this environment, so it
 * is intentionally strict and will throw a clear error if the response shape
 * is unexpected. Prefer --source export with a @@file until verified.
 */
"use strict"

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;")
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** Tally date like 25-Aug-2026. ClosingBalance is blank unless a period is set. */
function tallyDate(d) {
  return `${d.getDate()}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`
}

function periodDates(now = new Date()) {
  const fyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return {
    from: `1-Apr-${fyYear}`,
    to: tallyDate(now),
  }
}

function periodVarsXml() {
  const { from, to } = periodDates()
  return `<SVFROMDATE TYPE="Date">${from}</SVFROMDATE>
        <SVTODATE TYPE="Date">${to}</SVTODATE>
        <SVCURRENTDATE TYPE="Date">${to}</SVCURRENTDATE>`
}

function qtyNumber(v) {
  const m = String(v ?? "").match(/-?\d+(?:\.\d+)?/)
  return m ? parseFloat(m[0]) : 0
}

function isDummyBatch(name) {
  const n = String(name || "").trim()
  return !n || n === "." || /^primary(\s+batch)?$/i.test(n)
}

function stockXml(company) {
  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>StockItems</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY>
        ${periodVarsXml()}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="StockItems" ISMODIFY="No">
            <TYPE>Stock Item</TYPE>
            <NATIVEMETHOD>Name, Parent, BaseUnits, ClosingBalance, OpeningBalance, PartNo</NATIVEMETHOD>
            <FETCH>NAME, PARENT, BASEUNITS, CLOSINGBALANCE, OPENINGBALANCE, PARTNUMBER, BATCHALLOCATIONS.*</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`
}

/**
 * Tolerant parser for the STOCKITEM rows Tally returns.
 *
 * Tally's real XML puts the item name in an ATTRIBUTE and gives most fields a
 * type attribute, e.g.:
 *   <STOCKITEM NAME="10574 GENTS PAIR OGRN [MRP-659.00]" RESERVEDNAME="">
 *     <PARENT TYPE="String">Walkaroo</PARENT>
 *     <BASEUNITS TYPE="String">PCS</BASEUNITS>
 *     <CLOSINGBALANCE TYPE="Quantity"> 1.00 PCS</CLOSINGBALANCE>
 *   </STOCKITEM>
 * so tag matching must allow attributes (`<TAG ...>`), and NAME must be read
 * from the attribute (falling back to the nested <NAME> in LANGUAGENAME.LIST).
 */
function parseStockRows(xml) {
  const rows = []
  const rowRe = /<STOCKITEM\b([^>]*)>([\s\S]*?)<\/STOCKITEM>/g
  let m
  while ((m = rowRe.exec(xml)) !== null) {
    const attrs = m[1]
    const body = m[2]
    const attr = (name) => {
      const r = new RegExp(`\\b${name}="([^"]*)"`, "i")
      const f = attrs.match(r)
      return f ? decodeXmlEntities(f[1].trim()) : ""
    }
    // matches <TAG>...</TAG> and <TAG ATTR="..">...</TAG>
    const field = (tag) => {
      const r = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i")
      const f = body.match(r)
      return f ? decodeXmlEntities(f[1].trim()) : ""
    }
    const name = attr("NAME") || field("NAME")
    if (!name) continue // skip structural rows without a real item name
    const batches = parseNestedBatches(body)
    rows.push({
      name,
      parent: field("PARENT"),
      unit: field("BASEUNITS"),
      closingQty: field("CLOSINGBALANCE") || field("CLOSINGQTY") || field("CLBALQTY"),
      partNumber: field("PARTNUMBER"),
      batches,
    })
  }
  return rows
}

function parseNestedBatches(body) {
  const batches = []
  const re = /<BATCHALLOCATIONS\.LIST\b[^>]*>([\s\S]*?)<\/BATCHALLOCATIONS\.LIST>/gi
  let m
  while ((m = re.exec(body)) !== null) {
    const block = m[1]
    const field = (tag) => {
      const r = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i")
      const f = block.match(r)
      return f ? decodeXmlEntities(f[1].trim()) : ""
    }
    const name = field("BATCHNAME") || field("NAME")
    if (isDummyBatch(name)) continue
    batches.push({
      name,
      parent: null,
      closingQty: field("CLOSINGBALANCE"),
      openingQty: field("OPENINGBALANCE"),
      godown: field("GODOWNNAME"),
      rate: field("CLOSINGRATE") || field("OPENINGRATE"),
    })
  }
  return batches
}

/**
 * Stock Item BATCHALLOCATIONS.LIST is the opening split, not current stock.
 * Article CLOSINGBALANCE is current. If Tally did not send per-batch closing,
 * keep opening qtys and reduce the smallest batches so the total matches.
 */
function resolveBatchQuantities(batches, articleClosingQty) {
  const rows = (batches || []).map((b) => ({
    ...b,
    opening: qtyNumber(b.openingQty),
    closing: qtyNumber(b.closingQty),
  }))
  if (rows.some((b) => qtyNumber(b.closingQty))) {
    return rows.map((b) => ({
      ...b,
      qty: b.closing,
      qtySource: "closing",
    }))
  }
  const openSum = rows.reduce((s, b) => s + b.opening, 0)
  const target = qtyNumber(articleClosingQty)
  if (!target || openSum === target) {
    return rows.map((b) => ({
      ...b,
      qty: b.opening,
      qtySource: "opening",
    }))
  }
  if (openSum < target) {
    return rows.map((b) => ({
      ...b,
      qty: b.opening,
      qtySource: "opening",
    }))
  }
  let surplus = Math.round((openSum - target) * 1000) / 1000
  const fitted = new Map(rows.map((b) => [b.name, b.opening]))
  const order = [...rows].sort((a, b) => a.opening - b.opening || String(a.name).localeCompare(String(b.name)))
  for (const b of order) {
    if (surplus <= 0) break
    const cur = fitted.get(b.name)
    const take = Math.min(cur, surplus)
    fitted.set(b.name, cur - take)
    surplus -= take
  }
  return rows.map((b) => ({
    ...b,
    qty: fitted.get(b.name),
    qtySource: "fitted-to-article-closing",
  }))
}

function batchesXml(company) {
  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>Batches</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY>
        ${periodVarsXml()}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="Batches" ISMODIFY="No">
            <TYPE>Batch</TYPE>
            <FETCH>NAME, PARENT, CLOSINGBALANCE</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`
}

function parseBatchRows(xml) {
  const rows = []
  const re = /<(?:BATCH|BATCHES\.LIST)\b([^>]*)>([\s\S]*?)<\/(?:BATCH|BATCHES\.LIST)>/gi
  let m
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1]
    const body = m[2]
    const attr = (name) => {
      const r = new RegExp(`\\b${name}="([^"]*)"`, "i")
      const f = attrs.match(r)
      return f ? decodeXmlEntities(f[1].trim()) : ""
    }
    const field = (tag) => {
      const r = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i")
      const f = body.match(r)
      return f ? decodeXmlEntities(f[1].trim()) : ""
    }
    const name = attr("NAME") || field("NAME") || field("BATCHNAME")
    const parent = field("PARENT") || field("STOCKITEMNAME")
    const closingQty = field("CLOSINGBALANCE") || field("BILLEDQTY") || field("ACTUALQTY")
    if (isDummyBatch(name)) continue
    rows.push({ name, parent, closingQty })
  }
  return rows
}

function mergeBatches(a, b) {
  const out = []
  const seen = new Set()
  for (const batch of [...(a || []), ...(b || [])]) {
    const key = `${batch.parent || ""}::${batch.name}`.toUpperCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(batch)
  }
  return out
}

function innerText(xml) {
  return decodeXmlEntities(String(xml || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
}

function stockSummaryXml(company) {
  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Stock Summary</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY>
        ${periodVarsXml()}
        <EXPLODEFLAG>Yes</EXPLODEFLAG>
        <ISITEMWISE>Yes</ISITEMWISE>
        <DSPSHOWBATCHWISE>Yes</DSPSHOWBATCHWISE>
        <DSPSHOWALLITEMS>Yes</DSPSHOWALLITEMS>
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>`
}

function parseStockSummary(xml) {
  const qtyByName = new Map()
  const nameTags = "DSPACCNAME|DSPDISPNAME|SSITEMNAME|STKMNAME|BATCHNAME|SSBATCHNAME|DSPBATCHNAME"
  const qtyTags = "DSPCLQTY|SSCLQTY|DSPSTKCL|STKCLOSQTY|CLOSINGBALANCE|CLQTY|DSPCLBLQTY"
  const nameRe = new RegExp(`<(${nameTags})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`, "gi")
  const qtyRe = new RegExp(`<(${qtyTags})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`, "i")
  let m
  while ((m = nameRe.exec(xml)) !== null) {
    const name = innerText(m[2])
    if (!name || isDummyBatch(name)) continue
    const window = xml.slice(m.index, m.index + 2500)
    const q = window.match(qtyRe)
    const closingQty = q ? innerText(q[2]) : ""
    if (!qtyNumber(closingQty)) continue
    qtyByName.set(name.toUpperCase(), closingQty)
  }
  return qtyByName
}

function applyQtyByName(rows, qtyByName) {
  if (!qtyByName || !qtyByName.size) return 0
  let filled = 0
  for (const row of rows || []) {
    if (qtyNumber(row.closingQty) > 0) continue
    const hit = qtyByName.get(String(row.name || "").trim().toUpperCase())
    if (!hit) continue
    row.closingQty = hit
    filled += 1
  }
  return filled
}

/** Turn batch-wise articles into one Tally row per size/color. */
function expandWithBatches(items, extraBatches = []) {
  const extraByParent = new Map()
  for (const b of extraBatches) {
    const key = String(b.parent || "").trim()
    if (!key) continue
    if (!extraByParent.has(key)) extraByParent.set(key, [])
    extraByParent.get(key).push(b)
  }

  const out = []
  let expanded = 0
  for (const item of items) {
    const nested = (item.batches || []).map((b) => ({ ...b, parent: item.name }))
    const extra = extraByParent.get(item.name) || []
    const batches = mergeBatches(nested, extra).filter((b) => !isDummyBatch(b.name))
    const resolved = resolveBatchQuantities(batches, item.closingQty)
    const usable = resolved.filter((b) => !isDummyBatch(b.name) && qtyNumber(b.qty) > 0)
    if (!usable.length) {
      const { batches: _drop, ...rest } = item
      out.push(rest)
      continue
    }
    expanded += 1
    for (const b of usable) {
      out.push({
        name: b.name,
        parent: item.parent,
        article: item.name,
        unit: item.unit,
        closingQty: `${b.qty}`,
        rate: b.rate,
        partNumber: item.partNumber,
        source: "batch",
        qtySource: b.qtySource,
      })
    }
  }
  return { items: out, articlesWithBatches: expanded }
}

function companiesXml() {
  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>AllCompanies</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="AllCompanies" ISMODIFY="No">
            <TYPE>Company</TYPE>
            <FETCH>NAME</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`
}

/** Parse <COMPANY> rows to a list of company names.
 * Tally returns names in different shapes depending on version/platform:
 *   <COMPANY><NAME>X</NAME></COMPANY>
 *   <COMPANY NAME="X">X</COMPANY>
 *   <COMPANY>X</COMPANY>
 */
function parseCompanies(xml) {
  const err = xml.match(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/i)
  if (err) throw new Error(`Tally reported an error: ${decodeXmlEntities(err[1].trim())}`)
  // Scope to the DATA collection so we don't pick up the <COMPANY>N</COMPANY>
  // *count* that lives inside the CMPINFO block.
  const dataM = xml.match(/<DATA>([\s\S]*?)<\/DATA>/i)
  const scope = dataM ? dataM[1] : xml.replace(/<CMPINFO>[\s\S]*?<\/CMPINFO>/i, "")
  const names = []
  const re = /<COMPANY\b([^>]*)>([\s\S]*?)<\/COMPANY>/g
  let m
  while ((m = re.exec(scope)) !== null) {
    const attrs = m[1]
    const body = m[2]
    // 1) explicit NAME="..." attribute
    let n = (attrs.match(/\bNAME="([^"]*)"/i) || [])[1]
    // 2) nested <NAME> element
    if (!n) n = (body.match(/<NAME>([\s\S]*?)<\/NAME>/s) || [])[1]
    // 3) plain text content
    if (!n) n = body.replace(/<[^>]+>/g, "").trim()
    n = decodeXmlEntities(String(n || "").trim())
    if (n && !names.includes(n)) names.push(n)
  }
  return names
}

function decodeXmlEntities(s) {
  return s
    .replace(/&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

/** Human-readable message for network-level failures against Tally. */
function connectionError(host, err) {
  // undici wraps the real cause, sometimes more than one level deep
  let e = err
  const codes = []
  while (e) {
    if (e.code) codes.push(e.code)
    if (e.name === "AbortError" || e.name === "TimeoutError") codes.push("ETIMEDOUT")
    e = e.cause
  }
  const code = codes[0]
  if (code === "ECONNREFUSED") {
    return `Cannot connect to Tally at ${host} — connection refused. Is Tally running with its XML server enabled on that ip:port?`
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return `Cannot resolve Tally host "${host}" — check the IP address.`
  }
  if (codes.includes("ETIMEDOUT") || codes.includes("UND_ERR_CONNECT_TIMEOUT")) {
    return `Timed out connecting to Tally at ${host} — host may be down, unreachable, or the port is wrong/firewalled.`
  }
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH") {
    return `Tally host ${host} is unreachable — check the network/VPN.`
  }
  return `Failed to connect to Tally at ${host}: ${err.message}`
}

/** POST an Export request to the Tally XML server and return the response text. */
async function tallyPost(host, body, timeoutMs = 60000) {
  if (!host) throw new Error("Tally host required (expected ip:port)")
  const [ip, portStr] = host.split(":")
  const port = portStr ? Number(portStr) : 9000
  if (!ip) throw new Error(`Malformed tally host "${host}" (expected ip:port)`)
  const url = `http://${ip}:${port}`
  let res
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "text/xml" },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw new Error(connectionError(`${ip}:${port}`, err))
  }
  if (!res.ok) throw new Error(`Tally POST ${url} -> HTTP ${res.status}`)
  return res.text()
}

/**
 * Verify Tally is reachable and answering XML requests.
 * Throws a descriptive Error when it isn't; returns company names when it is.
 */
async function testConnection({ host }) {
  const xml = await tallyPost(host, companiesXml())
  return parseCompanies(xml)
}

/** List the companies open on the Tally server (used for the interactive picker). */
async function listCompanies({ host }) {
  return testConnection({ host })
}

async function fetchStock({ host, company }) {
  if (!host || !company) throw new Error("Tally host and company are required for live fetch")
  const xml = await tallyPost(host, stockXml(company), 180000)
  const parsed = parseStockRows(xml)
  const expanded = expandWithBatches(parsed, [])
  return {
    source: "tally",
    tallyHost: host,
    company,
    itemCount: expanded.items.length,
    articlesWithBatches: expanded.articlesWithBatches,
    batchCount: parsed.reduce((s, i) => s + (i.batches?.length || 0), 0),
    period: periodDates(),
    fetchedAt: new Date().toISOString(),
    items: expanded.items,
  }
}

module.exports = {
  fetchStock,
  listCompanies,
  testConnection,
  parseStockRows,
  parseBatchRows,
  parseStockSummary,
  parseNestedBatches,
  resolveBatchQuantities,
  expandWithBatches,
}