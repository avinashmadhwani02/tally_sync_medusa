const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { slug, readJson, writeJson, loadEnv, findRepoRoot } = require("./util")

test("findRepoRoot locates the directory containing .git", () => {
  const root = findRepoRoot()
  assert.ok(fs.existsSync(path.join(root, ".git")))
  // The repo root must be an ancestor of this module (apps/sync/src), so the
  // assertion is independent of the local checkout directory's name.
  const src = path.resolve(__dirname)
  assert.ok(
    src === root || src.startsWith(root + path.sep),
    `expected repo root ${root} to be an ancestor of ${src}`
  )
})

test("slug produces a lowercase filesystem-safe name", () => {
  assert.equal(slug("RR FOOTWEAR"), "rr-footwear")
  assert.equal(slug("Walkaroo & Co."), "walkaroo-co")
  assert.equal(slug("  spaces  "), "spaces")
  assert.equal(slug(""), "unknown")
  assert.equal(slug(null), "unknown")
})

test("writeJson then readJson round-trips an object", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-util-"))
  const file = path.join(dir, "nested", "a.json")
  writeJson(file, { hello: "world", n: 5 })
  assert.deepEqual(readJson(file), { hello: "world", n: 5 })
})

test("readJson throws a useful error on invalid JSON", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-util-"))
  const file = path.join(dir, "bad.json")
  fs.writeFileSync(file, "{ not json")
  assert.throws(() => readJson(file), /Invalid JSON/)
})

test("loadEnv does not override an env var that is already set", () => {
  const key = `SYNC_TEST_KEEP_${Date.now()}`
  process.env[key] = "preset"
  loadEnv()
  assert.equal(process.env[key], "preset")
  delete process.env[key]
})

test("loadEnv runs without throwing when no .env files exist", () => {
  assert.doesNotThrow(() => loadEnv())
})