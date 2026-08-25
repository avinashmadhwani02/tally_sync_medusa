#!/usr/bin/env node
/**
 * Tally -> Medusa sync for ADDA.
 * Usage: node scripts/sync-adda.js [--write] [--limit N] [--email ..] [--password ..]
 */
const { runSync } = require("./sync-lib")

runSync({ brand: "ADDA", titlePrefix: "ADDA" })