import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { prisma } from "../../../sync/db"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const q = req.query as Record<string, string | string[] | undefined>
  const get = (k: string) => {
    const v = q[k]
    return Array.isArray(v) ? v[0] : v
  }
  const limit = Math.min(Number(get("limit")) || 100, 500)
  const where: Record<string, unknown> = {}
  if (get("company")) {
    where.company = { name: String(get("company")) }
  }
  if (["manual", "auto"].includes(String(get("trigger") || ""))) {
    where.trigger = get("trigger")
  }
  if (["success", "failed", "partial"].includes(String(get("status") || ""))) {
    where.status = get("status")
  }
  try {
    const runs = await prisma.syncRun.findMany({
      where,
      orderBy: { syncedAt: "desc" },
      take: limit,
      include: {
        company: { select: { name: true } },
        apiKey: { select: { label: true, prefix: true } },
      },
    })
    res.json({
      ok: true,
      count: runs.length,
      runs: runs.map((r) => ({
        id: r.id,
        company: r.company.name,
        keyLabel: r.apiKey?.label ?? null,
        trigger: r.trigger,
        status: r.status,
        itemCount: r.itemCount,
        inserted: r.inserted,
        updated: r.updated,
        failed: r.failedCount,
        report: r.report,
        error: r.errorMessage,
        tallyHost: r.tallyHost,
        syncedAt: r.syncedAt,
      })),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("Listing sync runs failed:", err)
    res.status(500).json({ ok: false, error: message })
  }
}
