const { test } = require("node:test")
const assert = require("node:assert/strict")
const { select, text } = require("./prompt")

// Force non-interactive regardless of whether the runner has a TTY, so the
// prompt helpers take their deterministic default path instead of waiting.
function forceNonInteractive() {
  Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true })
  Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true })
}

test("select returns SYNC_SELECT_DEFAULT instead of prompting when not a TTY", async () => {
  forceNonInteractive()
  process.env.SYNC_SELECT_DEFAULT = "walkaroo"
  const picked = await select({ message: "Pick", choices: ["walkaroo", "campus"] })
  assert.equal(picked, "walkaroo")
  delete process.env.SYNC_SELECT_DEFAULT
})

test("select returns null when non-interactive and no default set", async () => {
  forceNonInteractive()
  const picked = await select({ message: "Pick", choices: ["walkaroo"] })
  assert.equal(picked, null)
})

test("text returns the default (or null) when not interactive", async () => {
  forceNonInteractive()
  assert.equal(await text({ message: "Name", def: "RR FOOTWEAR" }), "RR FOOTWEAR")
  assert.equal(await text({ message: "Name" }), null)
})