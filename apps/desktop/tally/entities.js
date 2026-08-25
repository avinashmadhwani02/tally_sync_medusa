/**
 * Entity registry — the single source of truth for how each entity is
 * fetched from Tally and converted into JSON.
 *
 * To add a new entity (ledger, voucher, …), add an entry here:
 *   - collectionId / tallyType : go into the request XML (<ID> and <TYPE>)
 *   - fetchFields              : Tally fields requested (<FETCH>)
 *   - responseKey              : key under ENVELOPE.BODY.DATA.COLLECTION
 *                                that holds the rows
 *   - itemsKey                 : key used in the result of fetchEntity()
 *   - mapRow(row, fieldText)   : converts one parsed XML row into JSON
 *
 * Everything else (request XML building, parsing, fetching) is generic —
 * see tallyClient.js.
 */
module.exports = {
  stockItem: {
    label: "stock items",
    collectionId: "StockItems",
    tallyType: "StockItem",
    fetchFields: ["NAME", "PARENT", "BASEUNITS", "CLOSINGBALANCE", "PARTNUMBER"],
    responseKey: "STOCKITEM",
    itemsKey: "items",
    mapRow(row, fieldText) {
      return {
        name: fieldText(row.NAME) || fieldText(row["@_NAME"]),
        parent: fieldText(row.PARENT),
        unit: fieldText(row.BASEUNITS),
        closingQty: fieldText(row.CLOSINGBALANCE),
        partNumber: fieldText(row.PARTNUMBER),
      };
    },
  },
};
