import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { prisma } from "../../sync/db"

export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ ok: true, db: "connected" })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({ ok: false, db: "unreachable", error: message })
  }
}
