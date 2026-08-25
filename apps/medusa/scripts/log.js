/**
 * Minimal zero-dependency console logger for the Tally -> Medusa CLI.
 *
 * Why not a library: this file has no imports so it always works, has no
 * install step, and gives us a single consistent voice for every stage
 * (read -> transform -> upload). Terminal colours are enabled automatically
 * when output is a TTY and disabled otherwise, or you can force them off with
 * NO_COLOR=1.
 */

const RESET = "\u001b[0m"
const C = {
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  magenta: "\u001b[35m",
  cyan: "\u001b[36m",
}

const enableColor =
  !process.env.NO_COLOR &&
  !!(process.stdout && typeof process.stdout.isatty === "function" && process.stdout.isatty())

function paint(text, ...codes) {
  if (!enableColor) return text
  return `${codes.map((c) => c).join("")}${text}${RESET}`
}

const print = (line = "") => console.log(line)

/** Big banner at the start of a run. */
function header(title) {
  const line = "=".repeat(Math.max(20, title.length + 4))
  print(paint(line, C.dim))
  print(paint(`  ${title}  `, C.bold, C.cyan))
  print(paint(line, C.dim))
  print("")
}

/** A small labelled section break with a boxed title. */
function section(title) {
  print("")
  print(paint(`─── ${title} ───`, C.bold, C.magenta))
}

/** Key/value line, left-padded so values align. */
function kv(label, value, width = 16) {
  const v = value === undefined || value === null ? "—" : String(value)
  print(`  ${paint(label.padEnd(width), C.cyan)} ${v}`)
}

function info(msg) {
  print(paint(`   ${msg}`, C.blue))
}

function ok(msg) {
  print(paint(`   ✔ ${msg}`, C.green))
}

function warn(msg) {
  print(paint(`   ⚠ ${msg}`, C.yellow))
}

function fail(msg) {
  print(paint(`   ✗ ${msg}`, C.red))
}

function step(msg) {
  print(paint(`   → ${msg}`, C.magenta))
}

function dim(msg) {
  print(paint(`   ${msg}`, C.dim))
}

function rule() {
  print(paint("   ────────────────────────────────────────────", C.dim))
}

/** Print an inline list item ("├─", "└─" style). */
function branch(msg, last = false) {
  print(paint(`   ${last ? "└─" : "├─"} ${msg}`, C.magenta))
}

/** A compact full-width divider. */
function divider() {
  print(paint("─".repeat(80), C.dim))
}

module.exports = { header, section, kv, info, ok, warn, fail, step, dim, rule, branch, divider }