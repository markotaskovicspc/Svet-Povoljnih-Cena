-- One-time, explicitly requested waiver for SPC-2026-002747 only.
-- Run in a transaction after generating and verifying the revised PDF with
-- buildInvoicePdf/orderToPdfInput, then uploading it to the PRIVATE
-- order-receipts bucket at the versioned object key below. Do not send email.
-- Set transaction-local spc.repair_order_version to the source Order.updatedAt
-- (Postgres text) and spc.repair_pdf_sha256 to the verified uploaded PDF hash.
-- Preview with ROLLBACK; apply with COMMIT. This is not a schema migration.
DO $repair$
DECLARE
  target "Order"%ROWTYPE;
  payment "Payment"%ROWTYPE;
  invoice "Invoice"%ROWTYPE;
  action_name CONSTANT text := 'order.shipping-waiver.SPC-2026-002747';
  object_key CONSTANT text := 'SPC-2026-002747/PR-SPC-2026-002747-shipping-waived.pdf';
  pdf_hash text := current_setting('spc.repair_pdf_sha256', true);
BEGIN
  SELECT * INTO STRICT target FROM "Order"
  WHERE id = 'cmvuwi8p4001708jpy4okgah3' AND number = 'SPC-2026-002747'
  FOR UPDATE;
  SELECT * INTO STRICT payment FROM "Payment"
  WHERE "orderId" = target.id FOR UPDATE;
  SELECT * INTO STRICT invoice FROM "Invoice"
  WHERE "orderId" = target.id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM "AuditLog" WHERE action = action_name AND "entityId" = target.id) THEN
    IF target.shipping <> 0 OR target.total <> 158692
      OR payment.amount <> 158692 OR invoice.total <> 158692
      OR invoice.snapshot #>> '{order,totals,shipping}' IS DISTINCT FROM '0'
      OR invoice.snapshot #>> '{order,totals,total}' IS DISTINCT FROM '158692'
    THEN
      RAISE EXCEPTION 'Previously applied waiver has diverged; inspect manually';
    END IF;
    RAISE NOTICE 'Waiver already applied; no changes';
    RETURN;
  END IF;

  IF target."updatedAt"::text IS DISTINCT FROM current_setting('spc.repair_order_version', true)
    OR pdf_hash IS NULL OR pdf_hash !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'Missing verified PDF or order changed since PDF generation';
  END IF;
  IF target.channel <> 'WEB' OR target.status <> 'KREIRANO'
    OR target."paymentMethod" <> 'UPLATA_NA_RACUN'
    OR target.shipping <> 2499 OR target.total <> 161191
    OR target.subtotal <> 176325 OR target."assemblyTotal" <> 0
    OR target."firstPurchaseDiscount" IS DISTINCT FROM 17633
    OR COALESCE(target."voucherDiscount", 0) <> 0
    OR COALESCE(target."savedCardDiscount", 0) <> 0
    OR target."cancelledAt" IS NOT NULL OR target."stockRestoredAt" IS NOT NULL
  THEN
    RAISE EXCEPTION 'Order no longer matches the approved unpaid proforma';
  END IF;
  IF payment.id <> 'cmvuwi8pl001d08jp1rxn0f9u'
    OR payment.status <> 'PENDING' OR payment.provider <> 'MANUAL'
    OR payment.method <> 'UPLATA_NA_RACUN' OR payment.currency <> 'RSD'
    OR payment.amount <> target.total OR payment."paidAt" IS NOT NULL
    OR payment."providerRef" IS NOT NULL
  THEN
    RAISE EXCEPTION 'Payment no longer matches the unpaid manual bank transfer';
  END IF;
  IF invoice.id <> 'cmvuwi9ek001l08jpvhtdgon2' OR invoice.kind <> 'PROFORMA'
    OR invoice.number <> 'PR-SPC-2026-002747' OR invoice.total <> target.total
    OR invoice.snapshot #>> '{order,id}' IS DISTINCT FROM target.id
    OR (invoice.snapshot #>> '{order,totals,shipping}')::numeric IS DISTINCT FROM target.shipping
    OR (invoice.snapshot #>> '{order,totals,total}')::numeric IS DISTINCT FROM target.total
  THEN
    RAISE EXCEPTION 'Invoice no longer matches the approved proforma';
  END IF;
  IF EXISTS (SELECT 1 FROM "Shipment" WHERE "orderId" = target.id)
    OR EXISTS (SELECT 1 FROM "FiscalReceipt" WHERE "orderId" = target.id)
    OR EXISTS (SELECT 1 FROM "FiscalDocument" WHERE "orderId" = target.id)
    OR EXISTS (SELECT 1 FROM "PaymentRefund" WHERE "orderId" = target.id)
    OR EXISTS (SELECT 1 FROM "DispatchNote" WHERE "orderId" = target.id)
    OR EXISTS (SELECT 1 FROM "PickupBatchLine" WHERE "orderId" = target.id)
    OR EXISTS (SELECT 1 FROM "BackgroundJob"
      WHERE "payload"->>'orderId' = target.id AND status IN ('QUEUED', 'RETRY', 'RUNNING'))
  THEN
    RAISE EXCEPTION 'Fulfillment, fiscalization or background work requires manual review';
  END IF;

  UPDATE "Order" SET shipping = 0, total = total - shipping, "updatedAt" = now()
  WHERE id = target.id;
  UPDATE "Payment" SET amount = target.total - target.shipping, "updatedAt" = now()
  WHERE id = payment.id;
  UPDATE "Invoice" SET
    total = target.total - target.shipping,
    snapshot = jsonb_set(jsonb_set(snapshot, '{order,totals,shipping}', '0'),
      '{order,totals,total}', to_jsonb((target.total - target.shipping)::integer)),
    "pdfUrl" = NULL, "pdfObjectKey" = object_key,
    status = 'ISSUED', "emailedAt" = NULL, "emailError" = NULL, "updatedAt" = now()
  WHERE id = invoice.id;

  INSERT INTO "OrderStatusEvent" (id, "orderId", status, note)
  VALUES (gen_random_uuid()::text, target.id, target.status,
    'Po zahtevu Luke/Marka uklonjena dostava samo za ovaj predračun: 2.499,00 → 0,00 RSD. Ukupno: 161.191,00 → 158.692,00 RSD. Predračun obnovljen; mejl nije poslat.');
  INSERT INTO "AuditLog" (id, action, entity, "entityId", diff)
  VALUES (gen_random_uuid()::text, action_name, 'Order', target.id,
    jsonb_build_object(
      'reason', 'Explicit user request: waive shipping for this proforma only',
      'shippingBefore', target.shipping, 'shippingAfter', 0,
      'totalBefore', target.total, 'totalAfter', target.total - target.shipping,
      'paymentId', payment.id, 'invoiceId', invoice.id,
      'pdfObjectKeyBefore', invoice."pdfObjectKey", 'pdfObjectKeyAfter', object_key,
      'pdfSha256', pdf_hash, 'previousInvoiceStatus', invoice.status,
      'previousEmailedAt', invoice."emailedAt", 'emailSent', false));
END
$repair$;
