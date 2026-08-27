-- Preserve every existing group recommendation while allowing an exact
-- source product to override the group rule for cross-sell suggestions.
ALTER TABLE "RecommendationRule"
  ALTER COLUMN "groupId" DROP NOT NULL,
  ADD COLUMN "sourceProductId" TEXT;

ALTER TABLE "RecommendationRule"
  ADD CONSTRAINT "RecommendationRule_sourceProductId_fkey"
  FOREIGN KEY ("sourceProductId") REFERENCES "Product"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecommendationRule"
  ADD CONSTRAINT "RecommendationRule_exactly_one_scope_check"
  CHECK (num_nonnulls("groupId", "sourceProductId") = 1);

CREATE INDEX "RecommendationRule_sourceProductId_idx"
  ON "RecommendationRule"("sourceProductId");
