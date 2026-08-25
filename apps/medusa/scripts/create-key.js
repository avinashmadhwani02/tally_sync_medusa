#!/usr/bin/env node
const path = require("path")
require("dotenv").config({ path: path.join(__dirname, "..", ".env") })
const { PrismaClient } = require("../src/generated/prisma")
const crypto = require("crypto")

const prisma = new PrismaClient()

function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex")
}

async function main() {
  const label = process.argv[2]
  if (!label) {
    console.error('Usage: npm run create-key -w @tally-sync/medusa -- "Avinash laptop"')
    process.exit(1)
  }
  const rand = crypto.randomBytes(16).toString("hex")
  const prefix = rand.slice(0, 8)
  const raw = `tsy_${prefix}_${crypto.randomBytes(24).toString("hex")}`
  const row = await prisma.apiKey.create({
    data: { label: label || "unnamed", keyHash: sha256(raw), prefix },
  })
  console.log(`\nAPI key created (id=${row.id}, label="${row.label}"):`)
  console.log(`\n  ${raw}\n`)
  console.log("Store it safely — it is shown only once.")
}

main()
  .catch((err) => {
    console.error("Failed:", err.message)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
