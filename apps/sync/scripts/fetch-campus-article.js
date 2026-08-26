#!/usr/bin/env node
/**
 * Fetch ONE Campus article from Tally, including the size/color rows that
 * appear when you expand the item in Stock Summary.
 *
 * Does not upload to Medusa. Tries several Tally XML shapes and prints
 * whichever one returns the exploded variants.
 *
 *   node scripts/fetch-campus-article.js
 *   node scripts/fetch-campus-article.js --item "22C-166A-TECH CH_C"
 *   node scripts/fetch-campus-article.js --company "RR FOOTWEAR"
 */
const path = require("path")
const fs = require("fs")
const { loadEnv, findRepoRoot, writeJson } = require("../src/util")
const { listCompanies } = require("../src/fetch/tally")
const { probeCampusArticle } = require("../src/fetch/campus-article")
const { parseItem } = require("../src/brands/campus")

loadEnv()

function arg(name, def) {
  const args = process.argv.slice(2)
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : def
}

function printRow(r, prefix = "  ") {
  const sku = r.sku ? `${r.sku.sku}  color=${r.sku.color}  size=${r.sku.size}` : "(unparsed sku)"
  console.log(`${prefix}${r.name}`)
  const src = r.qtySource ? `  (${r.qtySource} qty)` : ""
  console.log(`${prefix}  qty=${r.closingQty || r.qty || 0}${src}  rate=${r.rate || "-"}  ${sku}`)
}

async function main() {
  const host = arg("host", process.env.TALLY_HOST)
  const item = arg("item", "22C-166A-TECH CH_C")
  if (!host) throw new Error("TALLY_HOST missing. Set apps/sync/.env or pass --host ip:port")

  console.log(`Tally host : ${host}`)
  const companies = await listCompanies({ host })
  if (!companies.length) throw new Error("Tally is up but no company is open")
  const company = arg("company", companies.length === 1 ? companies[0] : "RR FOOTWEAR")
  if (!companies.includes(company)) {
    throw new Error(`Company "${company}" not open. Open companies: ${companies.join(", ")}`)
  }
  console.log(`Company    : ${company}`)
  console.log(`Article    : ${item}`)
  console.log("")

  const only = String(arg("methods", "") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  const includeSlow = process.argv.slice(2).includes("--slow")
  const probe = await probeCampusArticle({ host, company, item, only, includeSlow })
  const root = findRepoRoot()
  const outDir = path.join(root, "apps", "sync", "data", "probe", "campus-article")
  fs.mkdirSync(outDir, { recursive: true })

  for (const m of probe.methods) {
    fs.writeFileSync(path.join(outDir, `${m.key}.xml`), m.xml || m.error || "")
    const { xml, xmlPreview, ...rest } = m
    writeJson(path.join(outDir, `${m.key}.json`), { ...rest, xmlPreview })
  }

  console.log("Methods tried (best first):")
  for (const m of probe.methods) {
    const v = (m.variants || []).length
    const withQty = (m.variants || []).filter((x) => x.qty > 0).length
    const err = m.error ? `  error=${m.error.slice(0, 120)}` : ""
    console.log(`  [${m.score} qty-rows / ${v} variants / ${withQty} with qty]  ${m.key}  ${m.ms}ms${err}`)
  }
  console.log("")

  const best = probe.best
  const articleRow = probe.methods.map((m) => m.parent).find(Boolean)
  if (articleRow) {
    console.log("Article (Stock Item master — this is what the main fetch gets):")
    printRow(articleRow)
    console.log("")
  }

  if (!best || best.score === 0) {
    console.log("Size/color rows (the 4 lines under the article in Tally) were not in the Stock Item master.")
    console.log("Those rows are Tally batches shown only after you expand the item.")
    console.log(`Raw XML saved under ${outDir}`)
    writeJson(path.join(outDir, "summary.json"), { ...probe, methods: probe.methods.map(({ xml, ...m }) => m) })
    process.exitCode = 2
    return
  }

  console.log(`Using method: ${best.key} — ${best.label}`)
  if (best.parent) {
    console.log("Article:")
    printRow(best.parent)
  }
  console.log(`Variants (${best.variants.length}):`)
  for (const v of best.variants) printRow(v)

  const variantQty = best.variants.reduce((s, v) => s + v.qty, 0)
  const parentQty = best.parent?.qty || 0
  console.log("")
  console.log(`Variant qty sum : ${variantQty}`)
  console.log(`Article qty     : ${parentQty}`)
  if (parentQty && Math.abs(variantQty - parentQty) > 0.01) {
    console.log("Note: sums differ — some sizes may be missing or article row is a total.")
  }

  const parsed = best.variants.map((v) =>
    parseItem({
      name: v.name,
      parent: item,
      article: item,
      closingQty: v.closingQty,
      unit: "PRS",
    })
  )
  writeJson(path.join(outDir, "parsed-variants.json"), parsed)
  writeJson(path.join(outDir, "summary.json"), {
    item,
    company,
    method: best.key,
    parent: best.parent,
    variants: best.variants,
    parsed,
  })
  console.log("")
  console.log(`Saved: ${outDir}`)
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
