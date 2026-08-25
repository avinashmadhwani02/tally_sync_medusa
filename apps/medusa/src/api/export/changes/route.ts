import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { prisma } from "../../../sync/db"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const q = req.query as Record<string, string | string[] | undefined>
  const sinceRaw = Array.isArray(q.since) ? q.since[0] : q.since
  const since = Number(sinceRaw)
  if (sinceRaw !== undefined && (!Number.isInteger(since) || since < 0)) {
    res.status(400).json({ ok: false, error: "`since` must be a run id (integer)." })
    return
  }
  try {
    const latestRun = await prisma.syncRun.findFirst({
      orderBy: { id: "desc" },
      select: { id: true },
    })
    const latestRunId = latestRun?.id ?? 0

    const where =
      sinceRaw === undefined
        ? { lastRunId: { not: null } }
        : { lastRunId: { gt: since } }

    const items = await prisma.stockItem.findMany({
      where,
      include: { company: { select: { name: true } } },
      orderBy: { lastRunId: "asc" },
    })

    res.json({
      ok: true,
      latestRunId,
      hasMore: false,
      count: items.length,
      items: items.map((i) => ({
        sku: i.sku,
        name: i.name,
        company: i.company.name,
        category: i.parent,
        unit: i.unit,
        quantity: i.closingQty,
        syncedAt: i.syncedAt,
        runId: i.lastRunId,
      })),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("Export changes failed:", err)
    res.status(500).json({ ok: false, error: message })
  }
}
