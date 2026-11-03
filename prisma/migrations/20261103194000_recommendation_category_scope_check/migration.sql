-- Keep the existing exactly-one-scope invariant while allowing categories.
-- One ALTER statement replaces the constraint atomically; existing group and
-- product rules remain valid for both the old and new application versions.
ALTER TABLE "RecommendationRule"
  DROP CONSTRAINT "RecommendationRule_exactly_one_scope_check",
  ADD CONSTRAINT "RecommendationRule_exactly_one_scope_check"
    CHECK (num_nonnulls("groupId", "sourceProductId", "categoryId") = 1);
