const fs = require("fs")
const path = require("path")

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

function isVerbose() {
  return process.env.LOG_VERBOSE === "1" || process.env.LOG_LEVEL === "debug"
}

function isTty() {
  return Boolean(process.stdout.isTTY)
}

/**
 * Quiet console: one updating status line. Full detail stays in the run JSONL.
 * Pass --verbose (or LOG_VERBOSE=1) to print every event.
 */
function createLogger({ runDir, runId }) {
  fs.mkdirSync(runDir, { recursive: true })
  const eventsPath = path.join(runDir, "events.jsonl")
  const progressPath = path.join(runDir, "progress.json")
  const summaryPath = path.join(runDir, "summary.json")

  const progress = {
    runId,
    status: "running",
    step: null,
    done: 0,
    total: 0,
    updatedAt: new Date().toISOString(),
  }

  let frame = 0
  let statusActive = false
  let lastNonTty = 0

  function writeJsonl(step, level, fields) {
    const line = { ts: new Date().toISOString(), runId, step, level, ...fields }
    fs.appendFileSync(eventsPath, JSON.stringify(line) + "\n")
    return line
  }

  function cols() {
    return Math.max(20, process.stdout.columns || 80)
  }

  function clearStatus() {
    if (!statusActive || !isTty()) return
    process.stdout.write(`\r${" ".repeat(cols())}\r`)
    statusActive = false
  }

  function status(text) {
    const msg = String(text || "").replace(/\s+/g, " ").trim()
    if (!msg) return
    if (isVerbose()) {
      console.log(msg)
      return
    }
    if (isTty()) {
      const spin = FRAMES[frame++ % FRAMES.length]
      const budget = cols() - 3
      const clipped = msg.length > budget ? `${msg.slice(0, budget - 1)}…` : msg
      process.stdout.write(`\r${spin} ${clipped}${" ".repeat(Math.max(0, budget - clipped.length))}`)
      statusActive = true
      return
    }
    const now = Date.now()
    if (now - lastNonTty < 1500) return
    lastNonTty = now
    console.log(msg)
  }

  function printLine(kind, msg) {
    clearStatus()
    const prefix = kind === "error" ? "error" : kind === "warn" ? "warn" : "info"
    console[kind === "error" ? "error" : "log"](`[${prefix}] ${msg}`)
  }

  function emit(level, msg, fields = {}) {
    const step = fields.step || progress.step || "sync"
    const { step: _s, sticky, ...rest } = fields
    writeJsonl(step, level, { msg, ...rest })

    const sku = rest.sku || rest.product || rest.name || ""
    const line = sku ? `${msg}  ${sku}` : msg

    if (level === "error" || level === "warn") {
      printLine(level, line)
      return
    }
    if (sticky || isVerbose()) {
      printLine("info", typeof msg === "string" ? line : JSON.stringify({ msg, ...rest }))
      return
    }
    status(line)
  }

  function progressStep(step, done, total, extra = "") {
    progress.step = step
    progress.done = done
    progress.total = total
    progress.updatedAt = new Date().toISOString()
    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2))
    const frac = total ? `${done}/${total}` : `${done}`
    status(`${step}  ${frac}${extra ? `  ${extra}` : ""}`)
  }

  function finalize(statusName, stats) {
    progress.status = statusName
    progress.updatedAt = new Date().toISOString()
    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2))
    fs.writeFileSync(
      summaryPath,
      JSON.stringify({ runId, status: statusName, date: new Date().toISOString(), ...stats }, null, 2)
    )
    writeJsonl(progress.step || "sync", statusName === "done" ? "info" : "error", {
      msg: `run ${statusName}`,
      ...stats,
    })
    clearStatus()
  }

  fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2))

  return {
    info: (msg, fields) => emit("info", msg, fields || {}),
    warn: (msg, fields) => emit("warn", msg, fields || {}),
    error: (msg, fields) => emit("error", msg, fields || {}),
    debug: (msg, fields) => {
      writeJsonl(fields?.step || progress.step || "sync", "debug", { msg, ...(fields || {}) })
      if (isVerbose()) printLine("info", msg)
    },
    tick: status,
    clearStatus,
    event: (step, level, fields = {}) => emit(level || "info", fields.msg || step, { step, ...fields }),
    progress: progressStep,
    finalize,
    paths: { runDir, eventsPath, progressPath, summaryPath },
  }
}

module.exports = { createLogger }
