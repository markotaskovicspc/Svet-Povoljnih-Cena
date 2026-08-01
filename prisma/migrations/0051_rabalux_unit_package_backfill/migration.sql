-- Rabalux "Unique box" values were previously stored in the generic transport
-- package columns. Preserve them as the individual article package baseline.
UPDATE "Product" AS product
SET
  "unitPackWidthCm" = COALESCE(product."unitPackWidthCm", product."packWidthCm"),
  "unitPackDepthCm" = COALESCE(product."unitPackDepthCm", product."packDepthCm"),
  "unitPackHeightCm" = COALESCE(product."unitPackHeightCm", product."packHeightCm")
FROM "Supplier" AS supplier
WHERE product."supplierId" = supplier.id
  AND supplier."integrationKey" = 'RABALUX';
