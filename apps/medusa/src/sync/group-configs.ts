/**
 * Group configuration registry (Medusa-side port of apps/desktop/tally/groupConfigs.js).
 * HOW each Tally stock group is interpreted — data, not logic.
 */

export type GroupConfig = {
  key: string
  match: { parent?: string }
  brand: string | null
  parse: string[]
  skuParts: string[]
  priceFromName: boolean
  sync: boolean
}

export const GROUP_CONFIGS: GroupConfig[] = [
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
    sync: false,
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
  {
    key: "default",
    match: {},
    brand: null,
    parse: [],
    skuParts: [],
    priceFromName: false,
    sync: false,
  },
]
