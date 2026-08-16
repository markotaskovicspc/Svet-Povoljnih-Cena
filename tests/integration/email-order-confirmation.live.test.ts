import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { loadOrderForEmail, sendOrderConfirmation } from "@/lib/email";
import { __resetEmailConfig } from "@/lib/email/config";

const enabled = process.env.EMAIL_LIVE_CANARY === "1";
const orderNumber =
  process.env.EMAIL_CANARY_ORDER_NUMBER ?? "QA-BROWSER-FLOW-001";

describe.skipIf(!enabled)("Resend order confirmation live canary", () => {
  afterAll(async () => {
    await db.$disconnect();
  });

  it("renders and sends the real order-confirmation template to the Resend test sink", async () => {
    expect(process.env.EMAIL_PROVIDER).toBe("resend");
    const order = await db.order.findUniqueOrThrow({
      where: { number: orderNumber },
      select: { id: true },
    });
    const loaded = await loadOrderForEmail(order.id);
    expect(loaded).not.toBeNull();

    __resetEmailConfig();
    const result = await sendOrderConfirmation({
      order: loaded!.order,
      to: "delivered@resend.dev",
      idempotencyKey: `order-confirmation-live-canary:${order.id}:${Date.now()}`,
    });

    expect(result).toMatchObject({ ok: true, provider: "resend" });
    if (!result.ok) return;

    const tracked = await db.emailMessage.findUniqueOrThrow({
      where: { providerMessageId: result.id },
    });
    expect(tracked).toMatchObject({
      kind: "order_confirmation",
      recipient: "delivered@resend.dev",
      status: "SENT",
      provider: "resend",
    });
  }, 30_000);
});
