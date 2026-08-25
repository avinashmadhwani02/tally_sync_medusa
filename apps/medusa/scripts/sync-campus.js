#!/usr/bin/env node
/**
 * Tally -> Medusa sync for CAMPUS SHOES.
 * Usage: node scripts/sync-campus.js [--write] [--limit N] [--email ..] [--password ..]
 */
const { runSync } = require("./sync-lib")

runSync({ brand: "Campus Shoes", titlePrefix: "Campus" })