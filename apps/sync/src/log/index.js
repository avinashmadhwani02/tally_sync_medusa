const fs = require("fs")
const path = require("path")
const pino = require("pino")

/**
 * Run logger: pretty console (pino) + JSONL audit file in the run directory.
 */
function createLogger({ runDir, runId }) {
  fs.mkdirSync(runDir, { recursive: true })
  const eventsPath = path.join(runDir, "events.jsonl")
  const progressPath = path.join(runDir, "progress.json")
  const summaryPath = path.join(runDir, "summary.json")

  const pretty = pino({
    level: process.env.LOG_LEVEL || "info",
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:HH:MM:ss",
        ignore: "pid,hostname",
        messageFormat: "{msg}",
        singleLine: false,
      },
    },
  })

  const progress = {
    runId,
    status: "running",
    step: null,
    done: 0,
    total: 0,
    updatedAt: new Date().toISOString(),
  }

  function writeJsonl(step, level, fields) {
    const line = { ts: new Date().toISOString(), runId, step, level, ...fields }
    fs.appendFileSync(eventsPath, JSON.stringify(line) + "\n")
    return line
  }

  function emit(level, msg, fields = {}) {
    const step = fields.step || progress.step || "sync"
    const { step: _s, ...rest } = fields
    pretty[level]({ ...rest }, msg)
    writeJsonl(step, level, { msg, ...rest })
  }

  function event(step, level, fields = {}) {
    const msg = fields.msg || fields.step || step
    pretty[level === "error" ? "error" : level === "warn" ? "warn" : level === "debug" ? "debug" : "info"](
      { step, ...fields },
      typeof msg === "string" ? msg : step
    )
    return writeJsonl(step, level, fields)
  }

  function progressStep(step, done, total) {
    progress.step = step
    progress.done = done
    progress.total = total
    progress.updatedAt = new Date().toISOString()
    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2))
  }

  function finalize(status, stats) {
    progress.status = status
    progress.updatedAt = new Date().toISOString()
    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2))
    fs.writeFileSync(
      summaryPath,
      JSON.stringify({ runId, status, date: new Date().toISOString(), ...stats }, null, 2)
    )
    const verb = status === "done" ? "info" : "error"
    pretty[verb]({ status, ...stats }, `run ${status}`)
  }

  fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2))

  return {
    info: (msg, fields) => emit("info", msg, fields || {}),
    warn: (msg, fields) => emit("warn", msg, fields || {}),
    error: (msg, fields) => emit("error", msg, fields || {}),
    debug: (msg, fields) => emit("debug", msg, fields || {}),
    event,
    progress: progressStep,
    finalize,
    paths: { runDir, eventsPath, progressPath, summaryPath },
  }
}

module.exports = { createLogger, createLogger: createLogger }
