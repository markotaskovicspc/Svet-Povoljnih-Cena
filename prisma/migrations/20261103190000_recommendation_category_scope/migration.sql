-- Nullable scope preserves existing product and group rules.
ALTER TABLE "RecommendationRule" ADD COLUMN "categoryId" TEXT;
CREATE INDEX "RecommendationRule_categoryId_idx" ON "RecommendationRule"("categoryId");
ALTER TABLE "RecommendationRule" ADD CONSTRAINT "RecommendationRule_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
