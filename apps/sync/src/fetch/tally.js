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
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="StockItems" ISMODIFY="No">
            <TYPE>StockItem</TYPE>
            <FETCH>NAME, PARENT, BASEUNITS, CLOSINGBALANCE, PARTNUMBER</FETCH>
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
    rows.push({
      name,
      parent: field("PARENT"),
      unit: field("BASEUNITS"),
      closingQty: field("CLOSINGBALANCE"),
      partNumber: field("PARTNUMBER"),
    })
  }
  return rows
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
  const xml = await tallyPost(host, stockXml(company))
  const items = parseStockRows(xml)
  return {
    source: "tally",
    tallyHost: host,
    company,
    itemCount: items.length,
    fetchedAt: new Date().toISOString(),
    items,
  }
}

module.exports = { fetchStock, listCompanies, testConnection }