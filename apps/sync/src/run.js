const fs = require("fs")
const path = require("path")
const { findRepoRoot, writeJson, readJson, slug } = require("./util")
const { fetchItems, listCompanies } = require("./fetch")
const { validateItems, groupByBrand } = require("./stage/validate")
const { transformItems } = require("./transform")
const { createLogger } = require("./log")
const { select } = require("./prompt")
const {
  login,
  defaultStockLocation,
  loadCatalog,
  applyPlans,
} = require("./push/medusa")

const STEPS = ["all", "fetch", "push"]

function resolveDataDir(o) {
  const root = findRepoRoot()
  const dataDir = o.dataDir
    ? path.resolve(o.dataDir)
    : path.join(root, "apps", "sync", "data")
  fs.mkdirSync(dataDir, { recursive: true })
  return dataDir
}

function newRun(dataDir, label) {
  const runId = `${label}-${new Date().toISOString().replace(/[:.]/g, "-")}`
  const runDir = path.join(dataDir, "runs", runId)
  const logger = createLogger({ runDir, runId })
  return { runId, runDir, logger }
}

function fetchedPathFor(dataDir, company) {
  return path.join(dataDir, "fetched", `${slug(company)}.json`)
}

function latestPath(dataDir) {
  return path.join(dataDir, "fetched", "latest.json")
}

function tallyHostOf(o) {
  return o.tallyHost || o.tallyHost || null
}

async function runFetch(o) {
  const dataDir = resolveDataDir(o)
  const { runId, runDir, logger } = newRun(dataDir, "fetch")
  const tallyHost = tallyHostOf(o)
  logger.info("fetch starting", { host: tallyHost, company: o.company || "?" })

  try {
    if (!tallyHost) {
      throw new Error(
        "Tally host required. Set TALLY_HOST in apps/sync/.env (or pass --host <ip:port>)."
      )
    }

    logger.info("connecting to Tally", { host: tallyHost })
    const companies = await listCompanies({ host: tallyHost })
    if (!companies.length) {
      throw new Error(
        `Connected to Tally at ${tallyHost}, but no company is open. Open a company in Tally and retry.`
      )
    }
    logger.info("Tally connected", { companies })

    if (!o.company) {
      if (companies.length === 1) {
        o.company = companies[0]
      } else {
        const choice = await select({ message: "Select a company:", choices: companies })
        if (!choice) throw new Error("No company selected (or STDIN is not interactive — pass --company)")
        o.company = choice
      }
    }
    logger.info("using Tally company", { company: o.company })

    logger.info("fetching stock items", { company: o.company })
    const src = await fetchItems({ ...o, tallyHost, tallyHost })
    logger.info("fetched stock", {
      company: src.company,
      itemCount: src.items.length,
      articlesWithBatches: src.articlesWithBatches || 0,
      batchCount: src.batchCount || 0,
    })

    const problems = validateItems(src.items)
    if (problems.length) {
      logger.error("fetched data failed validation", { problems: problems.slice(0, 20), total: problems.length })
      throw new Error(`Fetched data failed validation with ${problems.length} problem(s). See ${logger.paths.eventsPath}`)
    }
    const byBrand = groupByBrand(src.items)
    logger.info("stock grouped by Tally parent", { byBrand })

    const outFile = fetchedPathFor(dataDir, src.company)
    writeJson(outFile, src)
    writeJson(latestPath(dataDir), src)
    writeJson(path.join(runDir, "fetched.json"), src)

    const preview = transformItems(src.items, { brand: o.brand || "all", logger })
    const brandCounts = {}
    for (const p of preview.plans) {
      brandCounts[p.brand] = (brandCounts[p.brand] || 0) + 1
    }
    logger.finalize("done", {
      company: src.company,
      itemCount: src.items.length,
      articlesWithBatches: src.articlesWithBatches || 0,
      file: outFile,
      productsByBrand: brandCounts,
    })
    logger.clearStatus?.()
    console.log(`\n[fetch] done. ${src.items.length} item(s) from "${src.company}".`)
    console.log(`  saved : ${outFile}`)
    console.log(`  tally parents: ${Object.entries(byBrand).sort((a, b) => b[1] - a[1]).map(([b, c]) => `${b} (${c})`).join(", ")}`)
    console.log(`  products parsed: ${Object.entries(brandCounts).map(([b, c]) => `${b} (${c})`).join(", ") || "(none)"}  variants: ${preview.plans.reduce((s, p) => s + p.variants.length, 0)}`)
    return { src, file: outFile, runId }
  } catch (e) {
    logger.finalize("failed", { error: e.message })
    throw e
  }
}

async function runPush(o, preloaded) {
  const dataDir = resolveDataDir(o)
  const { runId, runDir, logger } = newRun(dataDir, "push")
  logger.info("push starting", { mode: o.push ? "write" : "dry-run" })

  try {
    let src = preloaded
    if (!src) {
      const file = o.from
        ? path.resolve(o.from)
        : (o.company ? fetchedPathFor(dataDir, o.company) : latestPath(dataDir))
      if (!fs.existsSync(file)) {
        throw new Error(
          `No fetched data found at ${file}. Run the fetch step first (node bin/sync.js --step fetch).`
        )
      }
      src = readJson(file)
      logger.info("loaded fetched JSON", { file, itemCount: src.items?.length || 0 })
    }
    o.company = o.company || src.company
    if (!o.brand) o.brand = "all"
    logger.info("push brand filter", { brand: o.brand })

    const transformed = transformItems(src.items, {
      brand: o.brand,
      limit: o.limit,
      currency: o.currency || "inr",
      company: o.company,
      logger,
    })
    const { plans } = transformed
    writeJson(path.join(runDir, "plan.json"), {
      meta: { company: o.company, brand: o.brand, runId },
      selectedCount: transformed.selectedCount,
      skipped: transformed.skipped,
      plans,
    })
    logger.info("push plan ready", {
      products: plans.length,
      variants: plans.reduce((s, p) => s + (p.variants?.length || 0), 0),
      skipped: transformed.skipped,
    })

    const stateKey = `${slug(o.company)}--${slug(o.brand || "all")}`
    const statePath = path.join(dataDir, "state", `${stateKey}.json`)
    const prev = readJsonSafe(statePath)
    const diff = computeDiff(prev, plans)
    logger.info("diff vs last committed state", {
      toCreate: diff.toCreate.length,
      toUpdate: diff.toUpdate.length,
      toRemove: diff.toRemove.length,
    })

    const skipped = transformed.skipped || {}
    logger.clearStatus?.()
    console.log(`\n[push] plan for "${o.company}" / ${o.brand}:`)
    console.log(`  products : ${plans.filter((p) => !p.zeroStock).length} in-stock, ${plans.length} including zero-qty`)
    console.log(`  variants : ${plans.reduce((s, p) => s + (p.variants?.length || 0), 0)}`)
    console.log(`  skipped  : out-of-scope ${skipped.outOfScope || 0}, not-enabled ${skipped.notEnabled || 0}, parse-failed ${skipped.parseFailed || 0}, zero-qty ${skipped.noStock || 0}`)

    if (!plans.length) {
      logger.finalize("done", { mode: o.push ? "write" : "dry-run", note: "nothing to sync" })
      console.log(`\n[push] nothing to sync.`)
      return { mode: o.push ? "write" : "dry-run", runId, created: 0, updated: 0, failed: 0 }
    }

    if (!o.email || !o.password) {
      throw new Error("Medusa admin credentials required (set MEDUSA_ADMIN_EMAIL / MEDUSA_ADMIN_PASSWORD)")
    }
    const host = o.url
    const dryRun = !o.push
    logger.info("connecting to Medusa", { host, mode: dryRun ? "dry-run" : "WRITE" })
    const token = await login(host, o.email, o.password)
    const locationId = await defaultStockLocation(host, token)
    logger.info("loading existing Medusa catalog")
    const catalog = await loadCatalog(host, token, locationId)
    logger.info("catalog loaded", { productCount: catalog.productCount, locationId })

    logger.info("applying product plans", { count: plans.length, dryRun })
    const res = await applyPlans({
      host, token, locationId, plans, catalog,
      concurrency: o.concurrency, logger, dryRun,
    })

    const changed = (res.changes || []).filter((c) => c.action !== "unchanged")
    writeJson(path.join(runDir, "changes.json"), changed)
    if (!dryRun) writeJson(statePath, mapState(plans))
    logger.finalize(res.failed ? "failed" : "done", {
      mode: dryRun ? "dry-run" : "write",
      unchanged: res.unchanged,
      updated: res.updated,
      created: res.created,
      skipped: res.skipped,
      failed: res.failed,
    })

    logger.clearStatus?.()
    console.log(`\n[push] ${dryRun ? "dry-run" : "write"} complete.`)
    console.log(`  unchanged : ${res.unchanged}  (already matched Tally — not written)`)
    console.log(`  updated   : ${res.updated}  (quantity changed)`)
    console.log(`  created   : ${res.created}  (new in Medusa)`)
    console.log(`  skipped   : ${res.skipped}  (zero stock, not in Medusa)`)
    console.log(`  failed    : ${res.failed}`)
    console.log(`  changes   : ${path.join(runDir, "changes.json")}`)
    if (dryRun && (res.updated || res.created)) {
      console.log(`\n  Re-run with --commit to apply ${res.updated + res.created} write(s).`)
    }
    return { mode: dryRun ? "dry-run" : "write", runId, ...res }
  } catch (e) {
    logger.finalize("failed", { error: e.message })
    throw e
  }
}

async function runPipeline(o) {
  const step = o.step || "all"
  if (step === "fetch") return runFetch(o)
  if (step === "push") return runPush(o)
  const fetched = await runFetch(o)
  return runPush(o, fetched.src)
}

function readJsonSafe(p) {
  try { return readJson(p) } catch { return {} }
}

function computeDiff(prev, plans) {
  const toCreate = []
  const toUpdate = []
  const now = new Set()
  for (const p of plans) {
    for (const v of p.variants || [{ sku: p.sku, quantity: p.quantity }]) {
      now.add(v.sku)
      if (v.sku in prev) {
        if (Number(prev[v.sku]) !== v.quantity) toUpdate.push(v.sku)
      } else {
        toCreate.push(v.sku)
      }
    }
  }
  const toRemove = Object.keys(prev).filter((s) => !now.has(s))
  return { toCreate, toUpdate, toRemove }
}

function mapState(plans) {
  const out = {}
  for (const p of plans) {
    for (const v of p.variants || []) out[v.sku] = v.quantity
  }
  return out
}

module.exports = {
  runPipeline,
  runFetch,
  runPush,
  STEPS,
  runPipeline,
  runFetch,
  runPush,
}
