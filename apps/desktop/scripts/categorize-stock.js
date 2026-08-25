/**
 * Dry-run categorization report.
 *
 * Reads a Tally stock export produced by fetch-stock-preview.js, parses every
 * item via tally/shoeParser.js and writes per-group JSON reports to
 * tally-export/analysis/<group>.json plus a summary to stdout.
 *
 * Read-only: touches no database, no Medusa, no Tally.
 *
 * Usage:
 *   node scripts/categorize-stock.js [path-to-export.json]
 */
const fs = require("fs");
const path = require("path");
const { parseStockItem } = require("../tally/shoeParser");

const DEFAULT_EXPORT = path.join(__dirname, "..", "tally-export", "stock-RR FOOTWEAR.json");

function main() {
  const file = process.argv[2] || DEFAULT_EXPORT;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const items = data.items || [];
  console.log(`Loaded ${items.length} items from ${file}\n`);

  const groups = new Map();
  for (const it of items) {
    const parsed = parseStockItem(it);
    const g = parsed.group || "(none)";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(parsed);
  }

  const outDir = path.join(__dirname, "..", "tally-export", "analysis");
  fs.mkdirSync(outDir, { recursive: true });

  const summary = [];
  for (const [group, rows] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const inStock = rows.filter((r) => r.quantity != null && r.quantity > 0);
    const clean = inStock.filter((r) => r.warnings.length === 0);
    const priced = clean.filter((r) => r.mrpPaise != null);
    const genders = {};
    for (const r of clean) if (r.gender) genders[r.gender] = (genders[r.gender] || 0) + 1;

    fs.writeFileSync(
      path.join(outDir, `${group.replace(/[^a-z0-9]+/gi, "_")}.json`),
      JSON.stringify({ group, total: rows.length, inStockCount: inStock.length, items: inStock }, null, 2)
    );

    summary.push({
      group,
      total: rows.length,
      inStock: inStock.length,
      cleanParsed: clean.length,
      withPrice: priced.length,
      totalPairs: Math.round(inStock.reduce((s, r) => s + (r.quantity || 0), 0)),
      genders,
      sampleSku: clean[0]?.sku,
      sampleWarnings: inStock.find((r) => r.warnings.length)?.warnings,
    });
  }

  console.table(
    summary.map((s) => ({
      Group: s.group,
      Total: s.total,
      InStock: s.inStock,
      CleanOK: s.cleanParsed,
      Priced: s.withPrice,
      Pairs: s.totalPairs,
      Genders: JSON.stringify(s.genders),
    }))
  );

  console.log("\nSample SKUs per group:");
  for (const s of summary) console.log(`  ${s.group}: ${s.sampleSku || "(none)"}`);

  const totals = summary.reduce(
    (acc, s) => ({
      inStock: acc.inStock + s.inStock,
      clean: acc.clean + s.cleanParsed,
      pairs: acc.pairs + s.totalPairs,
    }),
    { inStock: 0, clean: 0, pairs: 0 }
  );
  console.log(
    `\nTOTAL in-stock: ${totals.inStock} | cleanly parsed & sellable: ${totals.clean} | pairs: ${totals.pairs}`
  );
  console.log(`\nPer-group reports written to ${outDir}`);
}

main();
