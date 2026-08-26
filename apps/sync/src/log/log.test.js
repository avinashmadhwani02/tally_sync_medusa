const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { createLogger } = require("./index")

function tmpRun() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-log-"))
  return { dir, logger: createLogger({ runDir: path.join(dir, "run"), runId: "test-run" }) }
}

function readLines(file) {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
}

test("createLogger writes progress, events, and summary artifacts", () => {
  const { dir, logger } = tmpRun()
  logger.info("starting")
  logger.progress("transform", 2, 10)
  logger.warn("low stock", { sku: "A-1" })
  logger.finalize("done", { created: 3 })

  const runDir = path.join(dir, "run")
  assert.ok(fs.existsSync(path.join(runDir, "progress.json")))
  assert.ok(fs.existsSync(path.join(runDir, "events.jsonl")))
  assert.ok(fs.existsSync(path.join(runDir, "summary.json")))

  const progress = JSON.parse(fs.readFileSync(path.join(runDir, "progress.json"), "utf8"))
  assert.equal(progress.status, "done")
  assert.equal(progress.step, "transform")
  assert.equal(progress.done, 2)
  assert.equal(progress.total, 10)

  const summary = JSON.parse(fs.readFileSync(path.join(runDir, "summary.json"), "utf8"))
  assert.equal(summary.status, "done")
  assert.equal(summary.created, 3)

  const events = readLines(path.join(runDir, "events.jsonl"))
  const msgs = events.map((e) => e.msg)
  assert.ok(msgs.includes("starting"))
  assert.ok(events.some((e) => e.level === "warn" && e.sku === "A-1"))
  assert.ok(msgs.includes("run done"))
})

test("error events are persisted with level error", () => {
  const { dir, logger } = tmpRun()
  logger.error("boom", { step: "push" })
  const events = readLines(path.join(dir, "run", "events.jsonl"))
  assert.equal(events[0].level, "error")
  assert.equal(events[0].step, "push")
  assert.equal(events[0].msg, "boom")
})