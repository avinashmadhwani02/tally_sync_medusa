const fs = require("fs");
const path = require("path");

const FIXTURES = path.join(__dirname, "fixtures");

function loadJson(name) {
  const file = path.join(FIXTURES, name);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testConnection(_ip, _port) {
  await delay(200);
  const data = loadJson("companies.json");
  return {
    ok: true,
    state: data.state,
    message: data.message,
    httpStatus: data.httpStatus,
    cmpInfo: data.cmpInfo,
    companies: data.companies,
    baseUrl: data.baseUrl,
  };
}

async function fetchStock(_ip, _port, companyName) {
  await delay(300);
  const byCompany = loadJson("stock.json");
  const row = byCompany[companyName];
  if (!row) {
    throw new Error(`No mock stock for company "${companyName}".`);
  }
  return {
    ok: true,
    cmpInfo: row.cmpInfo,
    items: row.items,
    rawXml: "",
  };
}

module.exports = { testConnection, fetchStock };
