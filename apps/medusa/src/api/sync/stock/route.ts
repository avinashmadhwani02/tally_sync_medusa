import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { TallySyncRequest } from "../../../sync/require-api-key"
import { applyTallyToMedusaInventory } from "../../../sync/apply-tally-inventory"
import { recordFailedRun, recordSuccessfulRun } from "../../../sync/stock"
import type { TallyStockItem } from "../../../sync/tally-to-medusa.config"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body || {}) as {
    company?: string
    tallyHost?: string
    syncedAt?: string
    trigger?: string
    items?: TallyStockItem[]
  }
  const { company, tallyHost, syncedAt, trigger, items } = body
  if (!company || !Array.isArray(items)) {
    res.status(400).json({ ok: false, error: "`company` and `items[]` are required." })
    return
  }
  const apiKeyId = (req as TallySyncRequest).tallyApiKey?.id ?? null
  try {
    const inventory = await applyTallyToMedusaInventory(req.scope, items)
    const run = await recordSuccessfulRun({
      company,
      tallyHost,
      syncedAt,
      trigger,
      apiKeyId,
      itemCount: items.length,
      updated: inventory.updated,
      unmatched: inventory.unmatched,
    })
    const prefix = (req as TallySyncRequest).tallyApiKey?.prefix
    const label = (req as TallySyncRequest).tallyApiKey?.label
    console.log(
      `[sync] ${trigger || "manual"} key="${prefix}…" (${label}) company="${company}" run=#${run.runId} status=${run.status} updated=${inventory.updated} failed=${inventory.unmatched.length}`
    )
    res.json({
      ok: true,
      runId: run.runId,
      companyId: run.companyId,
      tallyHost: tallyHost || null,
      trigger: trigger || "manual",
      mode: inventory.mode,
      status: run.status,
      itemCount: items.length,
      syncableTotal: inventory.syncableTotal,
      outOfStockCount: inventory.outOfStockCount,
      updated: inventory.updated,
      inventoryUpdates: inventory.inventoryUpdates,
      createdProducts: inventory.createdProducts,
      wouldCreateProducts: inventory.wouldCreateProducts,
      wouldCreateVariants: inventory.wouldCreateVariants,
      plannedSample: inventory.plannedSample,
      failed: inventory.unmatched.length,
      unmatched: inventory.unmatched,
      report: run.report,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("Stock sync failed:", err)
    await recordFailedRun({
      company,
      trigger,
      apiKeyId,
      tallyHost,
      errorMessage: message,
      itemCount: items.length,
    })
    res.status(500).json({ ok: false, error: message })
  }
}
