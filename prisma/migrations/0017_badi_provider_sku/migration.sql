-- badi.rs fiscalization: persist the badi-assigned NUMERIC sku per internal SKU.
-- Receipt items must reference this numeric value (badi rejects string skus),
-- so we store it alongside the internal string sku in FiscalProductSync.

ALTER TABLE "FiscalProductSync"
  ADD COLUMN "providerSku" INTEGER;
