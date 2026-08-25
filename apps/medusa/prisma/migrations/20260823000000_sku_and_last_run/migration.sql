-- Add SKU identity + change-tracking cursor to stock_items
ALTER TABLE "stock_items" ADD COLUMN "sku" TEXT;
ALTER TABLE "stock_items" ADD COLUMN "last_run_id" INTEGER;

CREATE UNIQUE INDEX "stock_items_sku_key" ON "stock_items"("sku");
CREATE INDEX "stock_items_last_run_id_idx" ON "stock_items"("last_run_id");

ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_last_run_id_fkey" FOREIGN KEY ("last_run_id") REFERENCES "sync_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
