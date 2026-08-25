/**
 * Generic stock-item parsing engine.
 *
 * Per-group behaviour is DATA — see groupConfigs.js. This file only contains:
 *   - shared helpers (normalize, qty/MRP parsing, gender mapping)
 *   - named parse strategies (pure functions: Tally name -> structured fields)
 *   - the config-driven resolveGroupConfig() / parseStockItem()
 */

const { groups: GROUP_CONFIGS } = require("./groupConfigs");

const GENDER_TOKENS = {
  GENTS: "men", MEN: "men",
  BOYS: "kids", GIRLS: "kids", KIDS: "kids", KID: "kids",
  LADIES: "women", LADY: "women", WOMEN: "women", WOMAN: "women",
};

const SELLABLE_UNITS = ["PRS", "PCS", "PC", "PAIRS", "ST", "SET"];

function parseQty(closingQty) {
  const m = String(closingQty ?? "").match(/(-?\d+(?:\.\d+)?)/);
  const n = m ? parseFloat(m[1]) : NaN;
  return Number.isFinite(n) ? n : null;
}

function normalize(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
}

function genderFromToken(token) {
  if (!token) return null;
  const t = token.toUpperCase().replace(/[^A-Z]/g, "");
  if (t === "G") return "men";
  if (t === "L") return "women";
  if (t === "C" || t === "K") return "kids";
  return GENDER_TOKENS[t] || null;
}

function mrpToPaise(mrp) {
  if (mrp == null) return null;
  const n = parseFloat(String(mrp).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

// ---------------------------------------------------------------- strategies
// Each strategy returns { model, gender, genderToken, color, colorCode,
//                         mrpPaise, sizeInfo } or null if it doesn't match.

const COLOR_WORDS = new Set([
  "BLACK", "BLK", "BROWN", "BRN", "TAN", "NAVY", "GREY", "GRAY", "OLIVE",
  "OLV", "WHITE", "WHT", "BLUE", "BLU", "RED", "GREEN", "GRN", "PINK",
  "MAROON", "BEIGE", "YELLOW", "OFFWHITE", "MULTI",
]);

const STRATEGIES = {
  // "BX1260 GENTS PAIR BRN [MRP-259.50]"
  walkarooPair(name) {
    const m = String(name).match(
      /^([A-Z0-9]+)\s+(GENTS|LADIES|LADY|WOMEN|MEN|BOYS|GIRLS|KIDS)\s+PAIR\s+([A-Z]+)\s*\[MRP[- ]?([\d.]+)\]/i
    );
    if (!m) return null;
    return {
      model: m[1],
      gender: genderFromToken(m[2]),
      genderToken: m[2].toUpperCase(),
      colorCode: m[3].toUpperCase(),
      color: m[3],
      mrpPaise: mrpToPaise(m[4]),
      sizeInfo: null,
    };
  },

  // "22C-181-HASLEY CH_C" (yearcode-article-model_genderSuffix)
  campusFull(name) {
    const m = String(name).match(/^([0-9]{1,2}[A-Z])-([A-Z0-9]+)-(.+)_([GLCK])$/i);
    if (!m) return null;
    return {
      model: `${m[1]}-${m[2]}-${m[3]}`,
      gender: genderFromToken(m[4]),
      genderToken: m[4].toUpperCase(),
      colorCode: m[4].toUpperCase(),
      color: null,
      mrpPaise: null,
      sizeInfo: null,
    };
  },

  // relaxed: any "-G/-L/-C/-K" suffix ("CS-1258S_G", "BINGO-151B_G")
  campusSuffix(name) {
    const r = String(name).match(/^(.+)_([GLCK])$/);
    if (!r) return null;
    return {
      model: r[1],
      gender: genderFromToken(r[2]),
      genderToken: r[2].toUpperCase(),
      colorCode: r[2].toUpperCase(),
      color: null,
      mrpPaise: null,
      sizeInfo: null,
    };
  },

  // "APPOLO NAVY MRP799" / "Discovery Mrp689"
  mrpTail(name) {
    const m = String(name).match(/^(.+?)\s+MRP\s*([\d.]+)$/i);
    if (!m) return null;
    const words = m[1].trim().split(/\s+/);
    let model = words;
    let color = null;
    const last = words[words.length - 1];
    if (words.length > 1 && COLOR_WORDS.has(last.toUpperCase())) {
      color = last;
      model = words.slice(0, -1);
    }
    return {
      model: model.join(" "),
      gender: null,
      genderToken: null,
      colorCode: color ? color.toUpperCase() : null,
      color,
      mrpPaise: mrpToPaise(m[2]),
      sizeInfo: null,
    };
  },

  // "AL 631 GYOR 6-8 MRP 199.50" | "6231 BROWN 40-44 MRP3395" |
  // "4491 DBROWN MRP2795 39X44" | "6116 CAMEL W"
  sizeRange(name) {
    const s = String(name);
    // "4974 Navy 1045" — article + color + trailing code, no MRP/size
    let w = s.match(/^(\d{3,4})\s+([A-Z]{2,})\s+(\d{3,4})$/i);
    if (w) {
      return { model: `${w[1]}-${w[3]}`, gender: null, genderToken: null, colorCode: w[2].toUpperCase(), color: w[2], mrpPaise: null, sizeInfo: null };
    }
    let m = s.match(/^([A-Z0-9]+(?:[- ][A-Z0-9]+)*?\d[A-Z0-9-]*)\s+([A-Z]+)\s+(\d{1,2}-\d{1,2}|\d{1,2}X\d{1,2})\s+(?:MRP\s*)?([\d.]+)?$/i);
    if (m) {
      return { model: m[1].trim(), gender: null, genderToken: null, colorCode: m[2].toUpperCase(), color: m[2], mrpPaise: mrpToPaise(m[4]), sizeInfo: m[3] };
    }
    m = s.match(/^([A-Z0-9]+(?:[- ][A-Z0-9]+)*?\d[A-Z0-9-]*)\s+([A-Z]+)\s+MRP\s*([\d.]*)\s*(\d{1,2}-\d{1,2}|\d{1,2}X\d{1,2})?\s*$/i);
    if (m) {
      return { model: m[1].trim(), gender: null, genderToken: null, colorCode: m[2].toUpperCase(), color: m[2], mrpPaise: mrpToPaise(m[3]), sizeInfo: m[4] || null };
    }
    m = s.match(/^([A-Z0-9]+(?:[- ][A-Z0-9]+)*?\d[A-Z0-9-]*)\s+([A-Z]+)(?:\s+([A-Z0-9]{1,3}))?\s*$/i);
    if (!m) return null;
    return { model: m[1].trim(), gender: null, genderToken: null, colorCode: m[2].toUpperCase(), color: m[2], mrpPaise: null, sizeInfo: null };
  },
};

// ------------------------------------------------------------------- engine

/** Find the group config whose match.parent equals (or contains) the group. */
function resolveGroupConfig(group) {
  const g = String(group || "").trim().toLowerCase();
  const exact = GROUP_CONFIGS.find((c) => c.match.parent && c.match.parent.trim().toLowerCase() === g);
  if (exact) return exact;
  const partial = GROUP_CONFIGS.find((c) => c.match.parent && g.includes(c.match.parent.trim().toLowerCase()));
  if (partial) return partial;
  return GROUP_CONFIGS.find((c) => !c.match.parent); // default entry
}

/**
 * Parse one Tally stock row into catalog fields using group config.
 * Returns { ok, sku, brand, sync, gender, model, color, colorCode,
 *            mrpPaise, sizeInfo, quantity, unit, warnings[] }
 */
function parseStockItem(item) {
  const warnings = [];
  const group = item.parent || "";
  const name = String(item.name || "").trim().replace(/\s+MRP\s*$/i, "");
  const config = resolveGroupConfig(group);

  let parsed = null;
  for (const strategyName of config.parse || []) {
    const fn = STRATEGIES[strategyName];
    if (!fn) throw new Error(`Unknown parse strategy "${strategyName}" in group config "${config.key}"`);
    parsed = fn(name);
    if (parsed) break;
  }
  if (!parsed) {
    parsed = { model: name, gender: null, genderToken: null, colorCode: null, color: null, mrpPaise: null, sizeInfo: null };
    warnings.push("no pattern matched — used raw name");
  }

  const quantity = parseQty(
    item.closingQty ?? item.closingQty ?? item.closingBalance ?? item.closingBalance
  );
  if (quantity == null) warnings.push("no closing quantity");

  const unit = String(item.unit || "").trim().toUpperCase();
  if (!SELLABLE_UNITS.includes(unit) && quantity != null && quantity > 0) {
    warnings.push(`unit "${unit}" is not PRS/PCS — review before syncing`);
  }

  const fields = {
    ...parsed,
    brand: config.brand,
    ...(config.priceFromName ? {} : { mrpPaise: null }),
  };

  const rawParts = ["RRF", config.brand, ...(config.skuParts || []).map((k) => fields[k])]
    .filter(Boolean)
    .map((p) => normalize(p))
    .filter(Boolean)
  const skuParts = rawParts.filter((part, i) => i === 0 || part !== rawParts[i - 1]);
  let sku = skuParts.join("-");
  if (config.priceFromName && fields.mrpPaise != null) sku += `-MRP${fields.mrpPaise}`;
  if (!sku.replace(/^RRF-/, "")) {
    sku = `RRF-UNKNOWN-${normalize(name)}`;
    warnings.push("empty SKU parts");
  }
  if (!config.sync) warnings.push(`group "${group}" has sync disabled in groupConfigs.js`);

  return {
    ok: warnings.length === 0,
    sku,
    tallyName: name,
    group,
    groupKey: config.key,
    brand: config.brand,
    syncAllowed: !!config.sync,
    gender: parsed.gender,
    model: parsed.model,
    color: parsed.color,
    colorCode: parsed.colorCode,
    mrpPaise: parsed.mrpPaise,
    sizeInfo: parsed.sizeInfo,
    quantity,
    unit: unit || null,
    warnings,
  };
}

module.exports = {
  parseStockItem,
  resolveGroupConfig,
  parseQty,
  normalize,
  STRATEGIES,
  SELLABLE_UNITS,
};
