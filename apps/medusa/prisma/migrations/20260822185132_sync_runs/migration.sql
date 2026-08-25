-- CreateEnum
CREATE TYPE "SyncTrigger" AS ENUM ('manual', 'auto');

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "api_key_id" INTEGER,
    "trigger" "SyncTrigger" NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'success',
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "inserted" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "tally_host" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sync_runs_company_id_idx" ON "sync_runs"("company_id");

-- CreateIndex
CREATE INDEX "sync_runs_synced_at_idx" ON "sync_runs"("synced_at");

-- AddForeignKey
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;
