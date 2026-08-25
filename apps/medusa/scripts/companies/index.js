/**
 * Company / brand module registry.
 *
 * Separation of concern: each footwear company owns how its raw Tally stock
 * rows become Medusa products + variants. Add a company here and it will be
 * used automatically by the CLI (see sync-lib.js), instead of the generic
 * one-row-per-product behaviour.
 *
 * Companies are keyed by the Tally stock group (parent) name.
 */
const walkaroo = require("./walkaroo")

const COMPANY_MODULES = {
  Walkaroo: walkaroo,
  // Campus:   require("./campus"),
  // ADDA:     require("./adda"),
  // … add each company's module here.
}

module.exports = { COMPANY_MODULES }