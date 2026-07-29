ALTER TABLE "FiscalDocumentLine"
  ADD COLUMN "unitCogs" DECIMAL(12,2),
  ADD COLUMN "serviceGross" DECIMAL(12,2) NOT NULL DEFAULT 0;

UPDATE "FiscalDocumentLine" line
SET "unitCogs" = product.cogs
FROM "Product" product
WHERE product.id = line."productId"
  AND line."unitCogs" IS NULL;

UPDATE "FiscalDocumentLine"
SET "serviceGross" = "totalGross"
WHERE "orderItemId" IS NULL;

UPDATE "FiscalDocumentLine" line
SET "serviceGross" = ROUND(
  line."totalGross"
  * item."assemblyPrice"
  / NULLIF(item."unitPriceSale" + item."assemblyPrice", 0),
  2
)
FROM "OrderItem" item
WHERE item.id = line."orderItemId"
  AND item."withAssembly" = true
  AND item."assemblyPrice" IS NOT NULL
  AND item."assemblyPrice" > 0;

ALTER TABLE "FiscalDocumentLine"
  ADD CONSTRAINT "FiscalDocumentLine_serviceGross_bounds"
  CHECK ("serviceGross" >= 0 AND "serviceGross" <= "totalGross");
