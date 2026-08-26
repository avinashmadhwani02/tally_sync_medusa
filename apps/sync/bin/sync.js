#!/usr/bin/env node
/**
 * Tally -> Medusa interactive sync CLI.
 *
 * Works in stages:
 *   fetch  — connect to Tally (read-only), pick a company, save stock as JSON
 *   push   — read that JSON, build the Medusa plan, upload (with --commit)
 *   all    — fetch then push in one go
 *
 * Configuration comes from apps/sync/.env (TALLY_HOST, MEDUSA_URL,
 * MEDUSA_ADMIN_EMAIL, MEDUSA_ADMIN_PASSWORD). Flags override env.
 *
 * Push defaults to a DRY-RUN (plan only). Pass --commit to write to Medusa.
 * Console shows a single updating status line. Full logs: apps/sync/data/runs/...
 * Pass --verbose to print every event.
 *
 * Usage:
 *   node apps/sync/bin/sync.js                       # interactive: pick a stage
 *   node apps/sync/bin/sync.js --step fetch          # fetch only -> local JSON
 *   node apps/sync/bin/sync.js --step push           # push last fetch (dry-run)
 *   node apps/sync/bin/sync.js --step push --commit
 *   node apps/sync/bin/sync.js --step push --brand campus --commit
 *   node apps/sync/bin/sync.js --step push --brand walkaroo --commit
 */
const util = require("../src/util")
const loadEnv = util.loadEnv || util.loadEnv
loadEnv()

const runMod = require("../src/run")
const { runPipeline } = runMod
const STEPS = runMod.STEPS || runMod.STEPS
const { select } = require("../src/prompt")

function arg(name, def) {
  const args = process.argv.slice(2)
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : def
}
function has(name) {
  return process.argv.slice(2).includes(`--${name}`)
}

async function main() {
    if (has("verbose")) process.env.LOG_VERBOSE = "1"

    const options = {
    company: arg("company", arg("comp", null)),
    brand: arg("brand", "all"),
    tallyHost: arg("host", process.env.TALLY_HOST || null),
    dataDir: arg("data-dir", null),
    from: arg("from", null),
    limit: Math.max(0, Number(arg("limit", 0))),
    push: has("commit") || has("push"),
    url: arg("url", process.env.MEDUSA_URL || "http://localhost:9000"),
    email: arg("email", process.env.MEDUSA_ADMIN_EMAIL || process.env.MEDUSA_ADMIN_EMAIL) || null,
    password: arg("password", process.env.MEDUSA_ADMIN_PASSWORD || process.env.MEDUSA_ADMIN_PASSWORD) || null,
    currency: arg("currency", process.env.SYNC_CURRENCY || "inr"),
    concurrency: Math.max(1, Number(arg("concurrency", 5))),
    step: arg("step", null),
  }

  if (!options.step) {
    if (has("commit") || has("push")) {
      options.step = "push"
    } else {
      const pick = await select({
        message: "What do you want to do?",
        choices: ["fetch  (Tally -> local JSON)", "push   (local JSON -> Medusa)", "all    (fetch then push)"],
      })
      if (!pick) {
        console.error("No stage selected. Pass --step fetch|push|all (STDIN is not interactive).")
        process.exit(1)
      }
      options.step = pick.split(/\s+/)[0]
    }
  }

  if (!STEPS.includes(options.step)) {
    console.error(`Unknown step "${options.step}". Valid: ${STEPS.join(", ")}`)
    process.exit(1)
  }

  return runPipeline(options)
}

main().catch((e) => {
  console.error("\n[sync] failed:", e.message)
  process.exit(1)
})
