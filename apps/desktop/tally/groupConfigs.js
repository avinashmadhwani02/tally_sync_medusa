/**
 * Group configuration registry — HOW each Tally stock group is interpreted.
 *
 * This is data, not logic. The generic engine lives in shoeParser.js;
 * adding a brand / renaming a group / changing SKU composition should only
 * ever require editing this file.
 *
 * Fields:
 *   key            : internal id (lowercase)
 *   match.parent   : Tally stock group name this config handles
 *   brand          : brand label used in SKUs and product titles
 *   parse          : ordered list of named strategies (see shoeParser.js)
 *   skuParts       : which parsed fields compose the SKU, in order
 *                    ("mrp" is appended automatically when priceFromName)
 *   priceFromName  : whether MRP is expected inside the item name
 *   sync           : only groups with sync:true are allowed into Medusa
 */

module.exports = {
  groups: [
    {
      key: "walkaroo",
      match: { parent: "Walkaroo" },
      brand: "Walkaroo",
      parse: ["walkarooPair"],
      skuParts: ["model", "genderToken", "colorCode"],
      priceFromName: true,
      sync: true,
    },
    {
      key: "campus",
      match: { parent: "Campus Shoes" },
      brand: "Campus",
      parse: ["campusFull", "campusSuffix"],
      skuParts: ["model", "genderToken", "colorCode"],
      priceFromName: false,
      sync: true,
    },
    {
      key: "adda",
      match: { parent: "ADDA" },
      brand: "ADDA",
      parse: ["mrpTail"],
      skuParts: ["model", "genderToken", "colorCode"],
      priceFromName: true,
      sync: true,
    },
    {
      key: "aqualite",
      match: { parent: "AQUALITE" },
      brand: "Aqualite",
      parse: ["sizeRange"],
      skuParts: ["model", "genderToken", "colorCode", "sizeInfo"],
      priceFromName: true,
      sync: true,
    },
    {
      key: "woodland",
      match: { parent: "WOODLAND" },
      brand: "Woodland",
      parse: ["sizeRange", "mrpTail"],
      skuParts: ["model", "genderToken", "colorCode", "sizeInfo"],
      priceFromName: true,
      sync: true,
    },
    {
      key: "primary-mixed",
      match: { parent: " Primary" },
      brand: "Primary Mixed",
      parse: ["walkarooPair"],
      skuParts: ["model", "genderToken", "colorCode"],
      priceFromName: true,
      sync: false, // review before enabling
    },
    {
      key: "shoe-factory",
      match: { parent: "SHOE FACTORY" },
      brand: "Shoe Factory",
      parse: ["mrpTail"],
      skuParts: ["model", "genderToken", "colorCode"],
      priceFromName: true,
      sync: true,
    },
    // Everything not listed above is NOT synced (safe default).
    {
      key: "default",
      match: {}, 
      brand: null,
      parse: [],
      skuParts: [],
      priceFromName: false,
      sync: false,
    },
  ],
};
