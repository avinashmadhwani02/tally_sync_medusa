const { XMLParser } = require("fast-xml-parser");
const ENTITIES = require("./tally/entities");


const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

function escapeXml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function companiesXml() {
  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>AllCompanies</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="AllCompanies" ISMODIFY="No">
            <TYPE>Company</TYPE>
            <FETCH>NAME</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function collectionXml(entity, companyName) {
  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>${entity.collectionId}</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="${entity.collectionId}" ISMODIFY="No">
            <TYPE>${entity.tallyType}</TYPE>
            <FETCH>${entity.fetchFields.join(", ")}</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}


function asArray(value) {
  if (value == null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function parseCmpInfo(parsed) {
  const info = parsed?.ENVELOPE?.BODY?.DESC?.CMPINFO || {};
  const num = (k) => Number(info[k] ?? 0) || 0;
  return {
    company: num("COMPANY"),
    ledger: num("LEDGER"),
    group: num("GROUP"),
    stockItem: num("STOCKITEM"),
    stockGroup: num("STOCKGROUP"),
    voucher: num("VOUCHER"),
  };
}

function fieldText(v) {
  if (v == null || v === "") return "";
  if (typeof v === "object") return String(v["#text"] ?? v["@_NAME"] ?? "");
  return String(v);
}

function parseCompanies(parsed) {
  const col = parsed?.ENVELOPE?.BODY?.DATA?.COLLECTION || {};
  const rows = asArray(col.COMPANY);
  return rows
    .map((row) => {
      if (typeof row === "string") return row;
      return fieldText(row.NAME) || fieldText(row["@_NAME"]);
    })
    .filter(Boolean);
}

function parseEntityRows(parsed, entity) {
  const col = parsed?.ENVELOPE?.BODY?.DATA?.COLLECTION || {};
  const rows = asArray(col[entity.responseKey]);
  return rows.map((row) => entity.mapRow(row, fieldText));
}


function lineError(xml) {
  const m = xml.match(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/i);
  return m ? m[1].replace(/&apos;/g, "'").replace(/&amp;/g, "&") : null;
}

async function tallyPost(baseUrl, xml, timeoutMs = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "text/xml" },
      body: xml,
      signal: controller.signal,
    });
    const text = await response.text();
    const err = lineError(text);
    if (err) {
      throw new Error(err);
    }
    const parsed = parser.parse(text);
    const status = parsed?.ENVELOPE?.HEADER?.STATUS;
    if (status !== undefined && Number(status) === 0) {
      throw new Error("Tally returned STATUS 0 (request failed)");
    }
    return { text, parsed, httpStatus: response.status };
  } catch (e) {
    if (e.name === "AbortError") {
      throw new Error("Timed out — Tally did not respond. Check IP, port, and that Tally is running.");
    }
    if (e.cause?.code === "ECONNREFUSED" || e.message?.includes("fetch failed")) {
      throw new Error("Unreachable — wrong IP/port, firewall, or Tally not listening.");
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function testConnection(ip, port) {
  const baseUrl = `http://${ip}:${port}`;
  const { parsed, httpStatus } = await tallyPost(baseUrl, companiesXml(), 8000);
  const cmpInfo = parseCmpInfo(parsed);
  const companies = parseCompanies(parsed);
  if (cmpInfo.company < 1) {
    return {
      ok: true,
      state: "company_not_open",
      message: "Connected, but no company is open in Tally.",
      httpStatus,
      cmpInfo,
      companies,
      baseUrl,
    };
  }
  if (companies.length === 0) {
    return {
      ok: true,
      state: "company_not_open",
      message: "Connected, but Tally did not return any company.",
      httpStatus,
      cmpInfo,
      companies,
      baseUrl,
    };
  }
  return {
    ok: true,
    state: "connected",
    message: "Connected. A company is open in Tally.",
    httpStatus,
    cmpInfo,
    companies,
    baseUrl,
  };
}

async function fetchStock(ip, port, companyName) {
  return fetchEntity(ip, port, "stockItem", companyName);
}

/**
 * Generic entity fetcher — driven by the entity registry (tally/entities.js).
 * Builds the request XML, posts it to Tally, parses the rows and returns
 * `{ ok, cmpInfo, items, rawXml }` (itemsKey comes from the registry).
 */
async function fetchEntity(ip, port, entityKey, companyName) {
  const entity = ENTITIES[entityKey];
  if (!entity) throw new Error(`Unknown Tally entity: "${entityKey}"`);
  const baseUrl = `http://${ip}:${port}`;
  const { parsed, text } = await tallyPost(baseUrl, collectionXml(entity, companyName), 20000);
  const cmpInfo = parseCmpInfo(parsed);
  return { ok: true, cmpInfo, [entity.itemsKey]: parseEntityRows(parsed, entity), rawXml: text };
}

module.exports = { testConnection, fetchStock, fetchEntity, ENTITIES };

