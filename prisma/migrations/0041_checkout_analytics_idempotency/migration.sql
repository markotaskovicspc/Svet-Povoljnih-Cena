-- Exactly one consented first-party checkout completion event may point at an order.
CREATE UNIQUE INDEX "AnalyticsEvent_checkout_completed_order_key"
  ON "AnalyticsEvent"("orderId")
  WHERE "orderId" IS NOT NULL AND "type" = 'CHECKOUT_COMPLETED';
