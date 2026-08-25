/**
 * Catalog reset — wipes ALL Medusa catalog + inventory data (products,
 * variants, options, collections, inventory items/levels/reservations and
 * their link tables) so the Tally sync can rebuild from scratch.
 *
 * KEEPS: stock locations, sales channels, regions, api keys, Prisma tables
 * (companies, sync_runs, ...), users — nothing else has to be re-set-up.
 *
 * Usage:  node scripts/reset-catalog.js [--yes]
 *         (without --yes it only prints what it would do)
 */
const { Client } = require("pg");
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const TABLES = [
  // link tables first (they reference the others)
  "product_variant_inventory_item",
  "product_variant_option",
  "product_variant_product_image",
  "product_variant_price_set",
  // product module
  "product_option_value",
  "product_option",
  "product_variant",
  "product_image",
  "product_tag",
  "product_type",
  "product_collection",
  "product_category_products",
  "product",
  // inventory module
  "reservation_item",
  "inventory_level",
  "inventory_item",
];

async function main() {
  const apply = process.argv.includes("--yes");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const existing = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1)`,
    [TABLES]
  );
  const found = existing.rows.map((r) => r.table_name);
  console.log(apply ? "TRUNCATING:" : "WOULD TRUNCATE:", found.join(", "));

  if (!apply) {
    console.log("\nDry-run. Re-run with --yes to actually wipe.\n");
  } else {
    await client.query(`TRUNCATE TABLE ${found.map((t) => `"${t}"`).join(", ")} CASCADE`);
    console.log("\n✔ Catalog wiped. Restart Medusa and run the sync with TALLY_SYNC_MODE=write.");
  }
  await client.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
