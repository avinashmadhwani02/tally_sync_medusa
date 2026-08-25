import crypto from "crypto"
import { prisma } from "./db"

export function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex")
}

export async function createApiKey(label: string) {
  const rand = crypto.randomBytes(16).toString("hex")
  const prefix = rand.slice(0, 8)
  const raw = `tsy_${prefix}_${crypto.randomBytes(24).toString("hex")}`
  const row = await prisma.apiKey.create({
    data: { label: label || "unnamed", keyHash: sha256(raw), prefix },
  })
  return { id: row.id, label: row.label, apiKey: raw }
}

export async function verifyApiKey(raw: string | undefined | null) {
  if (!raw || typeof raw !== "string" || !raw.startsWith("tsy_")) return null
  const keyHash = sha256(raw)
  const row = await prisma.apiKey.findFirst({
    where: { keyHash, active: true },
  })
  if (!row) return null
  await prisma.apiKey.update({
    where: { id: row.id },
    data: { lastUsedAt: new Date() },
  })
  return row
}
