/**
 * Probe Tally for ONE Campus stock item and the size/color rows you see
 * after expanding it in Stock Summary (those are Tally batches, not
 * separate stock items).
 *
 * The main fetch only lists Stock Item masters, so Campus looks like
 * 1 variant (the article) with a total qty. This module tries several
 * XML exports until the exploded rows come back.
 */
"use strict"

const { parseSku } = require("../brands/campus")
const { resolveBatchQuantities } = require("./tally")

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;")
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function tallyDate(d) {
  return `${d.getDate()}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`
}

function periodDates(now = new Date()) {
  const fyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return { from: `1-Apr-${fyYear}`, to: tallyDate(now) }
}

function periodVarsXml() {
  const { from, to } = periodDates()
  return `<SVFROMDATE TYPE="Date">${from}</SVFROMDATE>
        <SVTODATE TYPE="Date">${to}</SVTODATE>
        <SVCURRENTDATE TYPE="Date">${to}</SVCURRENTDATE>`
}

function decodeXml(s) {
  return String(s || "")
    .replace(/&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

function innerText(xml) {
  return decodeXml(String(xml || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
}

function qtyNumber(v) {
  const m = String(v ?? "").match(/-?\d+(?:\.\d+)?/)
  return m ? parseFloat(m[0]) : 0
}

function isDummy(name) {
  const n = String(name || "").trim()
  return !n || n === "." || /^primary(\s+batch)?$/i.test(n)
}

async function tallyPost(host, body, timeoutMs = 60000) {
  const [ip, portStr] = String(host).split(":")
  const port = portStr ? Number(portStr) : 9000
  const url = `http://${ip}:${port}`
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "text/xml" },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`Tally POST ${url} -> HTTP ${res.status}`)
  return res.text()
}

function envelopeCollection({ company, id, type, childOf, filterName, filterFormula, fetch, native }) {
  const child = childOf
    ? `\n            <CHILDOF>${escapeXml(childOf)}</CHILDOF>`
    : ""
  const filter = filterName
    ? `\n            <FILTER>${filterName}</FILTER>`
    : ""
  const nativeXml = native
    ? `\n            <NATIVEMETHOD>${native}</NATIVEMETHOD>`
    : ""
  const system = filterName && filterFormula
    ? `\n          <SYSTEM TYPE="Formulae" NAME="${filterName}">${filterFormula}</SYSTEM>`
    : ""
  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>${id}</ID>
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
          <COLLECTION NAME="${id}" ISMODIFY="No">
            <TYPE>${type}</TYPE>${child}${filter}${nativeXml}
            <FETCH>${fetch}</FETCH>
          </COLLECTION>${system}
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`
}

function wrapCollection(company, innerTdl) {
  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>ProbeCol</ID>
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
${innerTdl}
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`
}

function methodsFor(company, item) {
  const quoted = `"${item}"`
  const fetchItem = "NAME, PARENT, BASEUNITS, CLOSINGBALANCE, PARTNUMBER, BATCHES"

  return [
    {
      key: "walk-batches",
      label: "Stock Item filtered, WALK Batches",
      xml: wrapCollection(company, `          <COLLECTION NAME="ProbeCol" ISMODIFY="No">
            <TYPE>Stock Item</TYPE>
            <FILTER>IsThisItem</FILTER>
            <WALK>Batches</WALK>
            <NATIVEMETHOD>Name, Parent, ClosingBalance, ClosingRate, ClosingValue</NATIVEMETHOD>
            <FETCH>NAME, PARENT, CLOSINGBALANCE, CLOSINGRATE, CLOSINGVALUE</FETCH>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="IsThisItem">$Name = ${quoted}</SYSTEM>`),
    },
    {
      key: "object-batch",
      isDefault: false,
      label: "Object export of one Batch name",
      xml: `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Object</TYPE>
    <SUBTYPE>Batch</SUBTYPE>
    <ID TYPE="Name">S2641A-02-C2</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY>
        ${periodVarsXml()}
        <SVSTOCKITEMNAME>${escapeXml(item)}</SVSTOCKITEMNAME>
      </STATICVARIABLES>
      <FETCHLIST>
        <FETCH>Name</FETCH>
        <FETCH>Parent</FETCH>
        <FETCH>ClosingBalance</FETCH>
        <FETCH>OpeningBalance</FETCH>
        <FETCH>ClosingRate</FETCH>
      </FETCHLIST>
    </DESC>
  </BODY>
</ENVELOPE>`,
    },
    {
      key: "source-walk-batches",
      isDefault: false,
      label: "Source collection Stock Item, WALK Batches (closing on batch objects)",
      xml: wrapCollection(company, `          <COLLECTION NAME="SrcItems" ISMODIFY="No">
            <TYPE>Stock Item</TYPE>
            <FILTER>IsThisItem</FILTER>
          </COLLECTION>
          <COLLECTION NAME="ProbeCol" ISMODIFY="No">
            <SOURCECOLLECTION>SrcItems</SOURCECOLLECTION>
            <WALK>Batches</WALK>
            <NATIVEMETHOD>Name, Parent, ClosingBalance, OpeningBalance, ClosingRate</NATIVEMETHOD>
            <FETCH>NAME, PARENT, CLOSINGBALANCE, OPENINGBALANCE, CLOSINGRATE</FETCH>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="IsThisItem">$Name = ${quoted}</SYSTEM>`),
    },
    {
      key: "batch-childof",
      isDefault: false,
      label: "TYPE Batch CHILDOF quoted article (unescaped quotes)",
      xml: wrapCollection(company, `          <COLLECTION NAME="ProbeCol" ISMODIFY="No">
            <TYPE>Batch</TYPE>
            <CHILDOF>${quoted}</CHILDOF>
            <NATIVEMETHOD>Name, Parent, ClosingBalance, OpeningBalance, ClosingRate</NATIVEMETHOD>
            <FETCH>NAME, PARENT, CLOSINGBALANCE, OPENINGBALANCE, CLOSINGRATE</FETCH>
          </COLLECTION>`),
    },
    {
      key: "fetch-batches-star",
      isDefault: true,
      label: "Stock Item FETCH BatchAllocations.*",
      xml: wrapCollection(company, `          <COLLECTION NAME="ProbeCol" ISMODIFY="No">
            <TYPE>Stock Item</TYPE>
            <FILTER>IsThisItem</FILTER>
            <FETCH>Name, Parent, BaseUnits, ClosingBalance, OpeningBalance, BatchAllocations.*</FETCH>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="IsThisItem">$Name = ${quoted}</SYSTEM>`),
    },
    {
      key: "walk-batch-allocations",
      label: "Stock Item WALK BatchAllocations",
      xml: wrapCollection(company, `          <COLLECTION NAME="ProbeCol" ISMODIFY="No">
            <TYPE>Stock Item</TYPE>
            <FILTER>IsThisItem</FILTER>
            <WALK>BatchAllocations</WALK>
            <FETCH>BATCHNAME, BILLEDQTY, ACTUALQTY, CLOSINGBALANCE, AMOUNT, GODOWNNAME</FETCH>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="IsThisItem">$Name = ${quoted}</SYSTEM>`),
    },
    {
      key: "walk-vouchers-batches",
      slow: true,
      label: "Vouchers WALK inventory entries then batch allocations",
      xml: wrapCollection(company, `          <COLLECTION NAME="ProbeCol" ISMODIFY="No">
            <TYPE>Voucher</TYPE>
            <WALK>AllInventoryEntries, BatchAllocations</WALK>
            <FETCH>DATE, VOUCHERNUMBER, VOUCHERTYPENAME, STOCKITEMNAME, BATCHNAME, BILLEDQTY, ACTUALQTY, AMOUNT, GODOWNNAME</FETCH>
          </COLLECTION>`),
    },
    {
      key: "vouchers-fetch-inventory",
      slow: true,
      label: "Vouchers FETCH inventory + batch allocations lists",
      xml: wrapCollection(company, `          <COLLECTION NAME="ProbeCol" ISMODIFY="No">
            <TYPE>Voucher</TYPE>
            <FETCH>DATE, VOUCHERNUMBER, VOUCHERTYPENAME, ALLINVENTORYENTRIES.LIST, ALLINVENTORYENTRIES.BATCHALLOCATIONS.LIST</FETCH>
          </COLLECTION>`),
    },
    {
      key: "summary-group-no-company",
      slow: true,
      label: "Stock Summary for group Campus Shoes",
      xml: `<ENVELOPE>
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
        ${periodVarsXml()}
        <EXPLODEFLAG>Yes</EXPLODEFLAG>
        <ISITEMWISE>Yes</ISITEMWISE>
        <DSPSHOWBATCHWISE>Yes</DSPSHOWBATCHWISE>
        <STOCKGROUPNAME>Campus Shoes</STOCKGROUPNAME>
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>`,
    },
    {
      key: "summary-legacy-export",
      slow: true,
      label: "Legacy Export Data Stock Summary for one item",
      xml: `<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Stock Summary</REPORTNAME>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
          ${periodVarsXml()}
          <EXPLODEFLAG>Yes</EXPLODEFLAG>
          <ISITEMWISE>Yes</ISITEMWISE>
          <DSPSHOWBATCHWISE>Yes</DSPSHOWBATCHWISE>
          <STOCKITEMNAME>${escapeXml(item)}</STOCKITEMNAME>
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`,
    },
    {
      key: "stock-item-fetch-star",
      isDefault: true,
      label: "Stock Item FETCH * (all fields including nested lists)",
      xml: wrapCollection(company, `          <COLLECTION NAME="ProbeCol" ISMODIFY="No">
            <TYPE>Stock Item</TYPE>
            <FILTER>IsThisItem</FILTER>
            <FETCH>*</FETCH>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="IsThisItem">$Name = ${quoted}</SYSTEM>`),
    },
    {
      key: "child-stock-items",
      label: "Stock Items CHILDOF article (if variants are child items)",
      xml: envelopeCollection({
        company,
        id: "ProbeCol",
        type: "Stock Item",
        childOf: item,
        fetch: "NAME, PARENT, BASEUNITS, CLOSINGBALANCE",
        native: "Name, Parent, BaseUnits, ClosingBalance",
      }),
    },
    {
      key: "sku-name-filter",
      label: "Stock Items whose name contains S2641A",
      xml: wrapCollection(company, `          <COLLECTION NAME="ProbeCol" ISMODIFY="No">
            <TYPE>Stock Item</TYPE>
            <FILTER>IsSkuPrefix</FILTER>
            <FETCH>NAME, PARENT, BASEUNITS, CLOSINGBALANCE</FETCH>
            <NATIVEMETHOD>Name, Parent, BaseUnits, ClosingBalance</NATIVEMETHOD>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="IsSkuPrefix">$$StringContains:$Name:"S2641A"</SYSTEM>`),
    },
    {
      key: "stock-item-by-name",
      label: "Stock Item filtered by $Name",
      xml: envelopeCollection({
        company,
        id: "OneStockItem",
        type: "Stock Item",
        filterName: "IsThisItem",
        filterFormula: `$Name = ${quoted}`,
        fetch: fetchItem,
        native: "Name, Parent, BaseUnits, ClosingBalance",
      }),
    },
  ]
}

function lineError(xml) {
  const m = String(xml || "").match(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/i)
  return m ? innerText(m[1]) : null
}

function tagHits(xml, tag) {
  const re = new RegExp(`<${tag}\\b`, "gi")
  return (String(xml).match(re) || []).length
}

function fieldIn(body, tag) {
  const r = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i")
  const f = String(body || "").match(r)
  return f ? f[1] : ""
}

function qtyFromBlock(body) {
  return (
    fieldIn(body, "CLOSINGBALANCE") ||
    fieldIn(body, "OPENINGBALANCE") ||
    fieldIn(body, "BILLEDQTY") ||
    fieldIn(body, "ACTUALQTY") ||
    fieldIn(body, "DSPCLQTY")
  )
}

function rateFromBlock(body) {
  return (
    fieldIn(body, "CLOSINGRATE") ||
    fieldIn(body, "OPENINGRATE") ||
    fieldIn(body, "RATE") ||
    fieldIn(body, "DSPCLRATE")
  )
}

function collectNamedRows(xml) {
  const rows = []
  const seen = new Set()
  const push = (name, qty, rate, extra = {}) => {
    const n = innerText(name)
    if (isDummy(n)) return
    const key = `${extra.godown || ""}::${n}`.toUpperCase()
    if (seen.has(key)) return
    seen.add(key)
    const qtyText = innerText(qty) || ""
    rows.push({
      name: n,
      closingQty: qtyText,
      qty: qtyNumber(qtyText),
      rate: innerText(rate) || "",
      sku: parseSku(n),
      ...extra,
    })
  }

  const allocRe = /<BATCHALLOCATIONS\.LIST\b[^>]*>([\s\S]*?)<\/BATCHALLOCATIONS\.LIST>/gi
  let m
  while ((m = allocRe.exec(xml)) !== null) {
    const body = m[1]
    push(fieldIn(body, "BATCHNAME") || fieldIn(body, "NAME"), qtyFromBlock(body), rateFromBlock(body), {
      tag: "BATCHALLOCATIONS.LIST",
      godown: innerText(fieldIn(body, "GODOWNNAME")),
      qtySource: fieldIn(body, "CLOSINGBALANCE") ? "closing" : fieldIn(body, "OPENINGBALANCE") ? "opening" : "",
    })
  }

  const batchRe = /<(?:BATCH|BATCHES\.LIST)\b([^>]*)>([\s\S]*?)<\/(?:BATCH|BATCHES\.LIST)>/gi
  while ((m = batchRe.exec(xml)) !== null) {
    const attrName = (m[1].match(/\bNAME="([^"]*)"/i) || [])[1]
    const body = m[2]
    const name = attrName || fieldIn(body, "NAME") || fieldIn(body, "BATCHNAME")
    push(name, qtyFromBlock(body), rateFromBlock(body), {
      tag: "BATCH",
      parent: innerText(fieldIn(body, "PARENT")),
      qtySource: fieldIn(body, "CLOSINGBALANCE") ? "closing" : fieldIn(body, "OPENINGBALANCE") ? "opening" : "",
    })
  }
  const itemRe = /<STOCKITEM\b([^>]*)>([\s\S]*?)<\/STOCKITEM>/gi
  while ((m = itemRe.exec(xml)) !== null) {
    const attrName = (m[1].match(/\bNAME="([^"]*)"/i) || [])[1]
    const body = m[2]
    const name = attrName || fieldIn(body, "NAME")
    const itemBody = body.replace(/<BATCHALLOCATIONS\.LIST\b[\s\S]*?<\/BATCHALLOCATIONS\.LIST>/gi, "")
    push(name, qtyFromBlock(itemBody), rateFromBlock(itemBody), {
      tag: "STOCKITEM",
      parent: innerText(fieldIn(body, "PARENT")),
    })
  }

  const nameTags = "DSPACCNAME|DSPDISPNAME|SSITEMNAME|SSBATCHNAME|DSPBATCHNAME"
  const nameRe = new RegExp(`<(${nameTags})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`, "gi")
  const qtyRe = /<(DSPCLQTY|SSCLQTY|CLOSINGBALANCE|DSPSTKCL)\b[^>]*>([\s\S]*?)<\/\1>/i
  const rateRe = /<(DSPCLRATE|SSCLRATE|CLOSINGRATE|RATE)\b[^>]*>([\s\S]*?)<\/\1>/i
  while ((m = nameRe.exec(xml)) !== null) {
    const window = xml.slice(m.index, m.index + 2000)
    const q = window.match(qtyRe)
    const r = window.match(rateRe)
    push(m[2], q ? q[2] : "", r ? r[2] : "", { tag: m[1] })
  }

  return rows
}

function classifyRows(rows, article) {
  const art = String(article).trim().toUpperCase()
  const parent = rows.find((r) => r.name.toUpperCase() === art) || null
  const variants = rows.filter((r) => {
    if (r.name.toUpperCase() === art) return false
    return Boolean(r.sku) || /^S[A-Z0-9]+-\d{2}-[GLCK]\d+/i.test(r.name)
  })
  return { parent, variants, other: rows.filter((r) => r !== parent && !variants.includes(r)) }
}

async function probeCampusArticle({ host, company, item, only = [], includeSlow = false }) {
  const results = []
  const all = methodsFor(company, item)
  let selected
  if (only.length) selected = all.filter((m) => only.includes(m.key))
  else if (includeSlow) selected = all
  else selected = all.filter((m) => m.isDefault)
  for (const method of selected) {
    const started = Date.now()
    let xml = ""
    let error = null
    try {
      xml = await tallyPost(host, method.xml)
    } catch (e) {
      error = e.message
    }
    const err = error || lineError(xml)
    const rows = xml ? collectNamedRows(xml) : []
    const classified = classifyRows(rows, item)
    if (classified.parent && classified.variants.length) {
      const fitted = resolveBatchQuantities(
        classified.variants.map((v) => ({
          name: v.name,
          rate: v.rate,
          godown: v.godown,
          openingQty: v.qtySource === "closing" ? "" : v.closingQty,
          closingQty: v.qtySource === "closing" ? v.closingQty : "",
        })),
        classified.parent.closingQty
      )
      const byName = new Map(classified.variants.map((v) => [v.name, v]))
      classified.variants = fitted.map((b) => ({
        ...(byName.get(b.name) || { name: b.name, sku: parseSku(b.name) }),
        qty: b.qty,
        closingQty: String(b.qty),
        qtySource: b.qtySource,
        rate: b.rate || byName.get(b.name)?.rate,
      }))
    }
    results.push({
      key: method.key,
      label: method.label,
      ms: Date.now() - started,
      error: err,
      xmlBytes: xml.length,
      xmlPreview: xml.slice(0, 2500),
      xml,
      tagCounts: xml
        ? {
            STOCKITEM: tagHits(xml, "STOCKITEM"),
            BATCH: tagHits(xml, "BATCH"),
            "BATCHES.LIST": tagHits(xml, "BATCHES\\.LIST"),
            BATCHALLOCATIONS: tagHits(xml, "BATCHALLOCATIONS\\.LIST"),
            DSPCLQTY: tagHits(xml, "DSPCLQTY"),
            LINEERROR: tagHits(xml, "LINEERROR"),
          }
        : {},
      rows,
      ...classified,
      score: classified.variants.filter((v) => v.qty > 0).length,
    })
  }

  results.sort((a, b) => b.score - a.score || (b.variants?.length || 0) - (a.variants?.length || 0))
  return {
    item,
    company,
    host,
    period: periodDates(),
    fetchedAt: new Date().toISOString(),
    best: results[0] || null,
    methods: results,
  }
}

module.exports = {
  probeCampusArticle,
  collectNamedRows,
  classifyRows,
  methodsFor,
  tallyPost,
}
