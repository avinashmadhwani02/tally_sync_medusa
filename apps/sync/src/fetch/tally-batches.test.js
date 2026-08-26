const { test } = require("node:test")
const assert = require("node:assert/strict")
const { resolveBatchQuantities, parseStockRows, expandWithBatches } = require("./tally")

test("fits opening batches down to article closing by reducing smallest lots first", () => {
  const batches = [
    { name: "S2641A-02-C2", openingQty: "4" },
    { name: "S2641A-02-C3", openingQty: "4" },
    { name: "S2641A-02-C4", openingQty: "5" },
    { name: "S2641A-02-C5", openingQty: "5" },
    { name: "S2641A-03-C2", openingQty: "1" },
    { name: "S2641A-03-C3", openingQty: "1" },
    { name: "S2641A-03-C4", openingQty: "1" },
    { name: "S2641A-03-C5", openingQty: "1" },
  ]
  const out = resolveBatchQuantities(batches, "18.00 PRS")
  const byName = Object.fromEntries(out.map((b) => [b.name, b.qty]))
  assert.equal(out.reduce((s, b) => s + b.qty, 0), 18)
  assert.equal(byName["S2641A-02-C2"], 4)
  assert.equal(byName["S2641A-02-C5"], 5)
  assert.equal(byName["S2641A-03-C2"], 0)
  assert.equal(byName["S2641A-03-C5"], 0)
})

test("expandWithBatches turns Campus article allocations into size rows totaling closing qty", () => {
  const xml = `<COLLECTION>
    <STOCKITEM NAME="22C-166A-TECH CH_C" RESERVEDNAME="">
      <PARENT TYPE="String">Campus Shoes</PARENT>
      <BASEUNITS TYPE="String">PRS</BASEUNITS>
      <CLOSINGBALANCE TYPE="Quantity"> 18.00 PRS</CLOSINGBALANCE>
      <BATCHALLOCATIONS.LIST>
        <GODOWNNAME>Main Location</GODOWNNAME>
        <BATCHNAME>S2641A-02-C2</BATCHNAME>
        <OPENINGBALANCE> 4.00 PRS</OPENINGBALANCE>
        <OPENINGRATE>635.80/PRS</OPENINGRATE>
      </BATCHALLOCATIONS.LIST>
      <BATCHALLOCATIONS.LIST>
        <GODOWNNAME>Main Location</GODOWNNAME>
        <BATCHNAME>S2641A-02-C3</BATCHNAME>
        <OPENINGBALANCE> 4.00 PRS</OPENINGBALANCE>
        <OPENINGRATE>635.80/PRS</OPENINGRATE>
      </BATCHALLOCATIONS.LIST>
      <BATCHALLOCATIONS.LIST>
        <GODOWNNAME>Main Location</GODOWNNAME>
        <BATCHNAME>S2641A-02-C4</BATCHNAME>
        <OPENINGBALANCE> 5.00 PRS</OPENINGBALANCE>
        <OPENINGRATE>635.80/PRS</OPENINGRATE>
      </BATCHALLOCATIONS.LIST>
      <BATCHALLOCATIONS.LIST>
        <GODOWNNAME>Main Location</GODOWNNAME>
        <BATCHNAME>S2641A-02-C5</BATCHNAME>
        <OPENINGBALANCE> 5.00 PRS</OPENINGBALANCE>
        <OPENINGRATE>635.80/PRS</OPENINGRATE>
      </BATCHALLOCATIONS.LIST>
      <BATCHALLOCATIONS.LIST>
        <GODOWNNAME>Main Location</GODOWNNAME>
        <BATCHNAME>S2641A-03-C2</BATCHNAME>
        <OPENINGBALANCE> 1.00 PRS</OPENINGBALANCE>
      </BATCHALLOCATIONS.LIST>
      <BATCHALLOCATIONS.LIST>
        <GODOWNNAME>Main Location</GODOWNNAME>
        <BATCHNAME>S2641A-03-C3</BATCHNAME>
        <OPENINGBALANCE> 1.00 PRS</OPENINGBALANCE>
      </BATCHALLOCATIONS.LIST>
      <BATCHALLOCATIONS.LIST>
        <GODOWNNAME>Main Location</GODOWNNAME>
        <BATCHNAME>S2641A-03-C4</BATCHNAME>
        <OPENINGBALANCE> 1.00 PRS</OPENINGBALANCE>
      </BATCHALLOCATIONS.LIST>
      <BATCHALLOCATIONS.LIST>
        <GODOWNNAME>Main Location</GODOWNNAME>
        <BATCHNAME>S2641A-03-C5</BATCHNAME>
        <OPENINGBALANCE> 1.00 PRS</OPENINGBALANCE>
      </BATCHALLOCATIONS.LIST>
    </STOCKITEM>
  </COLLECTION>`
  const items = parseStockRows(xml)
  assert.equal(items.length, 1)
  assert.equal(items[0].batches.length, 8)
  const { items: rows, articlesWithBatches } = expandWithBatches(items)
  assert.equal(articlesWithBatches, 1)
  assert.equal(rows.length, 4)
  assert.equal(rows.reduce((s, r) => s + Number(r.closingQty), 0), 18)
  assert.equal(rows[0].article, "22C-166A-TECH CH_C")
  assert.equal(rows[0].parent, "Campus Shoes")
})
