/**
 * Picks the Tally data source. Production default is HTTP.
 * Mock is only loaded when TALLY_SOURCE=mock (see npm run start:mock).
 */
function getTallySource() {
  if (process.env.TALLY_SOURCE === "mock") {
    return require("./mock/mockTallySource");
  }
  return require("../tallyClient");
}

module.exports = { getTallySource };
