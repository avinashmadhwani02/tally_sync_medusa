#!/usr/bin/env node
/**
 * Tally -> Medusa sync for WALKAROO.
 *
 * Walkaroo's per-company mapping (model -> gender -> colour variants with
 * aggregated quantities) lives in scripts/companies/walkaroo.js and is used
 * automatically via the COMPANY_MODULES registry in scripts/companies.
 *
 * Usage: node scripts/sync-walkaroo.js [--write] [--limit N] [--email ..] [--password ..]
 */
const { runSync } = require("./sync-lib")

runSync({ brand: "Walkaroo" })