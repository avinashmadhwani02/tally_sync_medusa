/**
 * Read-only Tally data previewer.
 *
 * Connects to a running Tally instance (XML export API), lists open
 * companies, fetches stock items and saves them to a local JSON file.
 *
 * This NEVER writes to Tally (all requests are Export / ISMODIFY="No")
 * and does NOT touch Medusa or the database.
 *
 * Usage:
 *   node scripts/fetch-stock-preview.js            # defaults to 127.0.0.1:9000
 *   node scripts/fetch-stock-preview.js 192.168.1.5 9000
 */
const fs = require("fs");
const path = require("path");
const { testConnection, fetchStock } = require("../tallyClient");

async function main() {
  const ip = process.argv[2] || "127.0.0.1";
  const port = process.argv[3] || "9000";

  console.log(`Connecting to Tally at http://${ip}:${port} ...`);
  const conn = await testConnection(ip, port);
  console.log(`✔ ${conn.message}`);
  console.log(`  Companies in Tally: ${conn.companies.join(", ") || "(none)"}`);

  if (conn.state !== "connected") {
    console.log("\nNo company is open in Tally. Open one there and re-run.");
    process.exit(1);
  }

  // Use the currently open company (first returned)
  const company = conn.companies[0];
  console.log(`\nFetching stock items for “${company}” ...`);
  const result = await fetchStock(ip, port, company);
  const items = result.items || [];
  console.log(`✔ Fetched ${items.length} stock items.`);

  const out = {
    fetchedAt: new Date().toISOString(),
    tallyHost: `${ip}:${port}`,
    company,
    cmpInfo: result.cmpInfo,
    itemCount: items.length,
    items,
  };

  const outDir = path.join(__dirname, "..", "tally-export");
  fs.mkdirSync(outDir, { recursive: true });
  const safe = String(company).replace(/[^a-z0-9-_ ]/gi, "_").trim();
  const outFile = path.join(outDir, `stock-${safe}.json`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`\nSaved → ${outFile}\n`);

  // Quick structural summary so we can see naming patterns
  const byParent = {};
  let withPartNo = 0;
  for (const it of items) {
    const p = it.parent || "(no parent)";
    byParent[p] = (byParent[p] || 0) + 1;
    if (it.partNumber) withPartNo++;
  }
  console.log("Items per stock group (parent):");
  for (const [p, n] of Object.entries(byParent).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${String(n).padStart(4)}  ${p}`);
  }
  console.log(`\nPart Numbers filled: ${withPartNo}/${items.length}`);
}

main().catch((err) => {
  console.error(`✖ ${err.message}`);
  process.exit(1);
});
