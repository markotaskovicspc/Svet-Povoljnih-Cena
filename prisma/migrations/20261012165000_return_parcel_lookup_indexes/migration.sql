-- Parcel lookup checks every identity source to reject ambiguous matches.
-- Index the same JSON expressions emitted by Prisma (#>), rather than scanning
-- and decompressing raw courier responses (including label PDFs) on every scan.
-- Run each statement outside a transaction; concurrent builds preserve writes.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Shipment_providerParcelNumbers_gin_idx"
ON "Shipment" USING GIN ("providerParcelNumbers" jsonb_path_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Shipment_gls_printLabels_parcels_gin_idx"
ON "Shipment" USING GIN (("rawCreateResponse" #> '{PrintLabelsInfoList}'::text[]) jsonb_path_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Shipment_gls_printData_parcels_gin_idx"
ON "Shipment" USING GIN (("rawCreateResponse" #> '{PrintDataInfoList}'::text[]) jsonb_path_ops);

ANALYZE "Shipment";
