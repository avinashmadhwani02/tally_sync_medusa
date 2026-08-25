-- AlterTable
ALTER TABLE "sync_runs" ADD COLUMN "failed_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sync_runs" ADD COLUMN "report" JSONB;
