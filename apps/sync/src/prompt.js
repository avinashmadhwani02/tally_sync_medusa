const readline = require("readline")

function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY)
}

/**
 * Interactive single/multi select over a list of choices.
 * Returns the chosen value (or, for multi-select, an array).
 * Returns the default when STDIN is not a TTY (e.g. piped / CI) so nothing hangs.
 */
async function select({ message, choices, multi = false, pageSize = 20 }) {
  const def = process.env.SYNC_SELECT_DEFAULT
  if (!isInteractive()) return def || null
  if (!choices || !choices.length) return null

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const printChoices = () => {
    console.log(`\n${message}`)
    choices.forEach((c, i) => console.log(`  [${i + 1}] ${c}`))
  }

  if (!multi) {
    return new Promise((resolve) => {
      printChoices()
      rl.question(`Select [1-${choices.length}]: `, (ans) => {
        rl.close() // only now — after the user has answered
        const idx = parseInt(ans.trim(), 10) - 1
        const value = Number.isInteger(idx) && choices[idx] != null ? choices[idx] : null
        resolve(value)
      })
    })
  }

  return new Promise((resolve) => {
    printChoices()
    rl.question(`Select (comma-separated numbers, or "all"): `, (ans) => {
      rl.close()
      const trimmed = ans.trim().toLowerCase()
      if (trimmed === "all" || trimmed === "") {
        resolve(choices)
        return
      }
      const out = trimmed
        .split(/[\s,;]+/)
        .map((x) => parseInt(x, 10) - 1)
        .filter((i) => Number.isInteger(i) && choices[i] != null)
        .map((i) => choices[i])
      resolve(out)
    })
  })
}

/** Simple free-text prompt with an optional default. */
async function text({ message, def = "" }) {
  if (!isInteractive()) return def || null
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(`${message}${def ? ` [${def}]` : ""}: `, (ans) => {
      rl.close()
      resolve(ans.trim() || def || null)
    })
  })
}

module.exports = { isInteractive, select, text, select: select }