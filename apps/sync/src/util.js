const fs = require("fs")
const path = require("path")

/** Walk up from this module until we find the repo root (marked by a .git dir). */
function findRepoRoot() {
  let d = __dirname
  for (;;) {
    if (fs.existsSync(path.join(d, ".git"))) return d
    const up = path.dirname(d)
    if (up === d) throw new Error("Could not locate repo root (.git)")
    d = up
  }
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8")
  try {
    return JSON.parse(raw)
  } catch (e) {
    throw new Error(`Invalid JSON in ${filePath}: ${e.message}`)
  }
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2))
}

/**
 * Minimal .env loader (no dependency). Reads simple KEY=VALUE lines and sets
 * them on process.env unless already defined (real env always wins). Loads,
 * in order: apps/sync/.env then apps/medusa/.env (so Medusa creds are shared).
 * Silently ignores files that don't exist.
 */
function loadEnv() {
  let root
  try {
    root = findRepoRoot()
  } catch {
    root = process.cwd()
  }
  const files = [
    path.join(root, "apps", "sync", ".env"),
    path.join(root, "apps", "medusa", ".env"),
  ]
  for (const file of files) {
    if (!fs.existsSync(file)) continue
    const text = fs.readFileSync(file, "utf8")
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith("#")) continue
      const eq = line.indexOf("=")
      if (eq === -1) continue
      const key = line.slice(0, eq).trim()
      let val = line.slice(eq + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      if (key && process.env[key] === undefined) process.env[key] = val
    }
  }
}

/** Filesystem-safe slug for a company/label used in stored file names. */
function slug(text) {
  return String(text || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "unknown"
}

module.exports = {
  findRepoRoot,
  readJson,
  writeJson,
  loadEnv,
  slug,
  findRepoRoot: findRepoRoot,
  readJson: readJson,
  writeJson: writeJson,
  loadEnv: loadEnv,
  slug: slug,
}