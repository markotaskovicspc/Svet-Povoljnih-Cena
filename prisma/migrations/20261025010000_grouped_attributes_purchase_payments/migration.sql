ALTER TABLE "InboundInvoice" ADD COLUMN "paymentSnapshot" JSONB;

CREATE TABLE "AttributeSection" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX "AttributeSection_name_key" ON "AttributeSection"("name");

CREATE TABLE "AttributeOption" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sectionId" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "AttributeOption_sectionId_fkey" FOREIGN KEY ("sectionId")
    REFERENCES "AttributeSection"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AttributeOption_sectionId_value_key" ON "AttributeOption"("sectionId", "value");
CREATE INDEX "AttributeOption_sectionId_order_idx" ON "AttributeOption"("sectionId", "order");

CREATE TABLE "ProductAttributeAssignment" (
  "productId" TEXT NOT NULL,
  "optionId" TEXT NOT NULL,
  CONSTRAINT "ProductAttributeAssignment_pkey" PRIMARY KEY ("productId", "optionId"),
  CONSTRAINT "ProductAttributeAssignment_productId_fkey" FOREIGN KEY ("productId")
    REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductAttributeAssignment_optionId_fkey" FOREIGN KEY ("optionId")
    REFERENCES "AttributeOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ProductAttributeAssignment_optionId_idx" ON "ProductAttributeAssignment"("optionId");

CREATE TABLE "PurchaseOrderPayment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "purchaseOrderId" TEXT NOT NULL,
  "paidAt" DATE NOT NULL,
  "currency" "ErpCurrency" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "amountRsd" DECIMAL(12,2) NOT NULL,
  "notes" TEXT,
  "voidedAt" TIMESTAMP(3),
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseOrderPayment_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId")
    REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchaseOrderPayment_positive_amounts" CHECK ("amount" > 0 AND "amountRsd" > 0),
  CONSTRAINT "PurchaseOrderPayment_rsd_amount" CHECK ("currency" <> 'RSD' OR "amount" = "amountRsd")
);
CREATE INDEX "PurchaseOrderPayment_purchaseOrderId_paidAt_idx" ON "PurchaseOrderPayment"("purchaseOrderId", "paidAt");

CREATE FUNCTION prevent_paid_purchase_order_currency_change() RETURNS TRIGGER AS $$
DECLARE has_active_payments BOOLEAN;
BEGIN
  IF NEW.currency IS DISTINCT FROM OLD.currency THEN
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I."PurchaseOrderPayment" WHERE "purchaseOrderId" = $1 AND "voidedAt" IS NULL)', TG_TABLE_SCHEMA)
      INTO has_active_payments USING OLD.id;
    IF has_active_payments THEN
      RAISE EXCEPTION 'Valuta se ne može menjati dok porudžbenica ima aktivne uplate.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER purchase_order_payment_currency_guard BEFORE UPDATE OF currency ON "PurchaseOrder"
FOR EACH ROW EXECUTE FUNCTION prevent_paid_purchase_order_currency_change();

-- New tables are private immediately, including before the deploy hardener runs.
ALTER TABLE "AttributeSection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AttributeOption" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductAttributeAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseOrderPayment" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE api_role TEXT;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE "AttributeSection", "AttributeOption", "ProductAttributeAssignment", "PurchaseOrderPayment" FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;
