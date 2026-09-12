CREATE TABLE "ProductArDailyCount" (
  "day" DATE NOT NULL,
  "slug" TEXT NOT NULL,
  "event" TEXT NOT NULL CHECK ("event" IN ('model_opened', 'ar_clicked', 'ar_qr_landed')),
  "count" INTEGER NOT NULL DEFAULT 0 CHECK ("count" >= 0),
  PRIMARY KEY ("day", "slug", "event")
);
ALTER TABLE "ProductArDailyCount" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ProductArDailyCount" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "ProductArDailyCount" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "ProductArDailyCount" FROM authenticated;
  END IF;
END $$;
