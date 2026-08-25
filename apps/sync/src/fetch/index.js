const { fetchStock, listCompanies } = require("./tally")

// The pipeline only ever runs on data fetched live from Tally.
async function fetchItems(o) {
  return fetchStock({ host: o.tallyHost || o.tallyHost, company: o.company })
}

module.exports = {
  fetchItems,
  listCompanies,
  fetchItems: fetchItems,
  listCompanies: listCompanies,
}