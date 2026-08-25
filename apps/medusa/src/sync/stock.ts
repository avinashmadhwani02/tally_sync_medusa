import { prisma } from "./db"
import type { MapSkip } from "./tally-to-medusa.config"

const TRIGGERS = ["manual", "auto"] as const
const MAX_UNMATCHED_IN_REPORT = 200

export type SyncReport = {
  tallyItems: number
  updated: number
  failed: number
  unmatched: MapSkip[]
}

function runStatus(updated: number, failed: number) {
  if (failed === 0 && updated >= 0) return "success"
  if (updated > 0 && failed > 0) return "partial"
  if (updated === 0 && failed > 0) return "failed"
  return "success"
}

export async function recordSuccessfulRun({
  company,
  tallyHost,
  syncedAt,
  trigger = "manual",
  apiKeyId = null,
  itemCount,
  updated,
  unmatched,
}: {
  company: string
  tallyHost?: string | null
  syncedAt?: string
  trigger?: string
  apiKeyId?: number | null
  itemCount: number
  updated: number
  unmatched: MapSkip[]
}) {
  if (!TRIGGERS.includes(trigger as (typeof TRIGGERS)[number])) trigger = "manual"
  const syncedAtDate = syncedAt ? new Date(syncedAt) : new Date()
  const failed = unmatched.length
  const status = runStatus(updated, failed)
  const report: SyncReport = {
    tallyItems: itemCount,
    updated,
    failed,
    unmatched: unmatched.slice(0, MAX_UNMATCHED_IN_REPORT),
  }

  const comp = await prisma.company.upsert({
    where: { name: company },
    create: { name: company },
    update: { updatedAt: new Date() },
  })
  const run = await prisma.syncRun.create({
    data: {
      companyId: comp.id,
      apiKeyId,
      trigger: trigger as "manual" | "auto",
      status,
      itemCount,
      inserted: 0,
      updated,
      failedCount: failed,
      report: report as object,
      tallyHost: tallyHost || null,
      syncedAt: syncedAtDate,
      errorMessage:
        failed > 0
          ? `${failed} of ${itemCount} item(s) did not update Medusa inventory`
          : null,
    },
  })
  return { runId: run.id, companyId: comp.id, status, report }
}

export async function recordFailedRun({
  company,
  trigger = "manual",
  apiKeyId = null,
  tallyHost = null,
  errorMessage,
  itemCount = 0,
}: {
  company?: string
  trigger?: string
  apiKeyId?: number | null
  tallyHost?: string | null
  errorMessage: string
  itemCount?: number
}) {
  if (!company) return
  try {
    const comp = await prisma.company.upsert({
      where: { name: company },
      create: { name: company },
      update: {},
    })
    await prisma.syncRun.create({
      data: {
        companyId: comp.id,
        apiKeyId,
        trigger: (TRIGGERS.includes(trigger as "manual" | "auto") ? trigger : "manual") as
          | "manual"
          | "auto",
        status: "failed",
        itemCount,
        failedCount: itemCount,
        report: {
          tallyItems: itemCount,
          updated: 0,
          failed: itemCount,
          unmatched: [],
          error: String(errorMessage).slice(0, 1000),
        },
        errorMessage: String(errorMessage).slice(0, 1000),
        tallyHost,
      },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("Could not record failed sync run:", msg)
  }
}
