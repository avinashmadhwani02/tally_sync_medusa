const { test } = require("node:test")
const assert = require("node:assert/strict")
const {
  parseStockRows,
  parseBatchRows,
  parseNestedBatches,
  parseCompanies,
  parseStockSummary,
} = require("./tally")

test("parseStockRows reads NAME from attribute and body fields (with type attrs)", () => {
  const xml = `<COLLECTION>
  <STOCKITEM NAME="WALKAROO-WLR72017-LADIES-PAIR-BRN-MRP-269-00" RESERVEDNAME="">
    <PARENT TYPE="String">Walkaroo</PARENT>
    <BASEUNITS TYPE="String">PCS</BASEUNITS>
    <CLOSINGBALANCE TYPE="Quantity"> 2.00 PCS</CLOSINGBALANCE>
    <PARTNUMBER TYPE="String">PN123</PARTNUMBER>
  </STOCKITEM>
  </COLLECTION>`
  const rows = parseStockRows(xml)
  assert.equal(rows.length, 1)
  const r = rows[0]
  assert.equal(r.name, "WALKAROO-WLR72017-LADIES-PAIR-BRN-MRP-269-00")
  assert.equal(r.parent, "Walkaroo")
  assert.equal(r.unit, "PCS")
  assert.equal(r.closingQty, "2.00 PCS")
  assert.equal(r.partNumber, "PN123")
})

test("parseStockRows keeps ungrouped rows and skips rows with no real name", () => {
  const xml = `<COLLECTION>
    <STOCKITEM NAME="NoParent"><CLOSINGBALANCE> 1.00</CLOSINGBALANCE></STOCKITEM>
    <STOCKITEM RESERVEDNAME=""><BASEUNITS>PCS</BASEUNITS></STOCKITEM>
  </COLLECTION>`
  const rows = parseStockRows(xml)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, "NoParent")
  assert.equal(rows[0].parent, "")
})

test("parseNestedBatches collects non-dummy batch allocations with fields", () => {
  const body = `
    <BATCHALLOCATIONS.LIST><GODOWNNAME>Main</GODOWNNAME><BATCHNAME>S2641A-02-C2</BATCHNAME><OPENINGBALANCE> 4.00 PRS</OPENINGBALANCE></BATCHALLOCATIONS.LIST>
    <BATCHALLOCATIONS.LIST><GODOWNNAME>Main</GODOWNNAME><BATCHNAME>Primary Batch</BATCHNAME><OPENINGBALANCE> 1.00 PRS</OPENINGBALANCE></BATCHALLOCATIONS.LIST>`
  const batches = parseNestedBatches(body)
  assert.equal(batches.length, 1)
  assert.equal(batches[0].name, "S2641A-02-C2")
  assert.equal(batches[0].openingQty, "4.00 PRS")
  assert.equal(batches[0].godown, "Main")
})

test("parseBatchRows handles BATCH and BATCHES.LIST shapes and skips dummy batches", () => {
  const xml = `
    <COLLECTION>
      <BATCH NAME="B1"><PARENT>Article A</PARENT><CLOSINGBALANCE> 3.00</CLOSINGBALANCE></BATCH>
      <BATCHES.LIST><STOCKITEMNAME>Article B</STOCKITEMNAME><BATCHNAME>B2</BATCHNAME><CLOSINGBALANCE> 5.00</CLOSINGBALANCE></BATCHES.LIST>
      <BATCH NAME="Primary"><PARENT>Article A</PARENT><CLOSINGBALANCE> 0</CLOSINGBALANCE></BATCH>
    </COLLECTION>`
  const rows = parseBatchRows(xml)
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]))
  assert.equal(rows.length, 2)
  assert.equal(byName["B1"].parent, "Article A")
  assert.equal(byName["B1"].closingQty, "3.00")
  assert.equal(byName["B2"].parent, "Article B")
})

test("parseCompanies reads NAME attribute", () => {
  const xml = `<ENVELOPE><DATA><COMPANY NAME="RR FOOTWEAR"></COMPANY></DATA></ENVELOPE>`
  assert.deepEqual(parseCompanies(xml), ["RR FOOTWEAR"])
})

test("parseCompanies reads nested NAME element", () => {
  const xml = `<ENVELOPE><DATA><COMPANY><NAME>Walkaroo Ltd</NAME></COMPANY></DATA></ENVELOPE>`
  assert.deepEqual(parseCompanies(xml), ["Walkaroo Ltd"])
})

test("parseCompanies reads plain text content", () => {
  const xml = `<ENVELOPE><DATA><COMPANY>Campus Shoes</COMPANY></DATA></ENVELOPE>`
  assert.deepEqual(parseCompanies(xml), ["Campus Shoes"])
})

test("parseCompanies does not return the count from the CMPINFO block", () => {
  const xml = `<ENVELOPE><CMPINFO><COMPANY>3</COMPANY></CMPINFO><DATA><COMPANY NAME="RR FOOTWEAR"></COMPANY></DATA></ENVELOPE>`
  assert.deepEqual(parseCompanies(xml), ["RR FOOTWEAR"])
})

test("parseCompanies throws on a Tally LINEERROR", () => {
  const xml = `<ENVELOPE><LINEERROR>a custom tally error</LINEERROR><DATA></DATA></ENVELOPE>`
  assert.throws(() => parseCompanies(xml), /Tally reported an error: a custom tally error/)
})

test("parseStockSummary extracts closing qty keyed by (uppercased) name", () => {
  const xml = `<DATA>
      <ROWS><STKMNAME>WALKAROO-X</STKMNAME><STKCLOSQTY> 4.00 PCS</STKCLOSQTY></ROWS>
      <ROWS><STKMNAME>ZeroItem</STKMNAME><STKCLOSQTY> 0</STKCLOSQTY></ROWS>
  </DATA>`
  const out = parseStockSummary(xml)
  assert.equal(out.get("WALKAROO-X"), "4.00 PCS")
  assert.equal(out.has("ZEROITEM"), false)
  assert.equal(out.size, 1)
})