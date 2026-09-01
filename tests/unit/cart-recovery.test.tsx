import { beforeEach, describe, expect, it } from "vitest";
import {
  cartRecoverySubject,
  nextCartRecoverySendAt,
} from "@/lib/checkout/cart-recovery-policy";
import {
  buildCartRecoveryToken,
  verifyCartRecoveryToken,
} from "@/lib/checkout/cart-recovery-token";
import { CartRecoveryEmail } from "@/lib/email/templates/cart-recovery";
import { renderEmail } from "@/lib/email/render";
import { mergeRecoveredCartLines } from "@/lib/hooks/use-cart";

describe("abandoned cart recovery", () => {
  beforeEach(() => {
    process.env.CART_RECOVERY_TOKEN_SECRET = "test-cart-recovery-secret-32-characters";
  });

  it("schedules the three steps at 1h, 24h and 48h without catch-up bursts", () => {
    const activity = new Date("2026-09-01T10:00:00.000Z");
    expect(nextCartRecoverySendAt(activity, 0)?.toISOString()).toBe(
      "2026-09-01T11:00:00.000Z",
    );
    expect(nextCartRecoverySendAt(activity, 1)?.toISOString()).toBe(
      "2026-09-02T09:00:00.000Z",
    );
    expect(nextCartRecoverySendAt(activity, 2)?.toISOString()).toBe(
      "2026-09-02T10:00:00.000Z",
    );
    expect(nextCartRecoverySendAt(activity, 3)).toBeNull();
  });

  it("signs, verifies and expires recovery links", () => {
    const valid = buildCartRecoveryToken(
      "checkoutsession123",
      2,
      new Date(Date.now() + 60_000),
    );
    expect(verifyCartRecoveryToken(valid)).toMatchObject({
      sessionId: "checkoutsession123",
      step: 2,
    });
    expect(verifyCartRecoveryToken(`${valid}tampered`)).toBeNull();

    const expired = buildCartRecoveryToken(
      "checkoutsession123",
      1,
      new Date(Date.now() - 60_000),
    );
    expect(verifyCartRecoveryToken(expired)).toBeNull();
  });

  it("renders a readable SES-ready email with CTA, voucher and unsubscribe", async () => {
    const rendered = await renderEmail(
      CartRecoveryEmail({
        step: 3,
        items: [
          { name: "Ergo Lux stolica", sku: "ERGO-LUX", qty: 1, unitPrice: 2001 },
        ],
        cartTotal: 2001,
        resumeUrl: "https://example.com/checkout/nastavi/token",
        unsubscribeUrl: "https://example.com/api/email/unsubscribe/token",
        voucherCode: "VRATI-TEST123",
        discountPercent: 5,
      }),
    );
    expect(rendered.html).toContain("Ergo Lux stolica");
    expect(rendered.html).toContain("VRATI-TEST123");
    expect(rendered.html).toContain("checkout/nastavi/token");
    expect(rendered.html).toContain("api/email/unsubscribe/token");
    expect(rendered.text).toContain("Nastavi kupovinu");
    expect(rendered.text).not.toContain("promotivne mejlove");
    expect(cartRecoverySubject(3, 5)).toContain("5% popusta");
  });

  it("merges a recovered cart without lowering an existing quantity", () => {
    const lines = mergeRecoveredCartLines(
      [
        {
          sku: "ERGO-LUX",
          name: "Ergo Lux u postojećoj korpi",
          slug: "ergo-lux",
          qty: 3,
          unitPriceFull: 2_856,
          unitPriceSale: 2_001,
        },
      ],
      [
        {
          sku: "ERGO-LUX",
          name: "Ergo Lux aktuelni podaci",
          slug: "ergo-lux",
          qty: 1,
          unitPriceFull: 2_856,
          unitPriceSale: 2_100,
        },
      ],
    );

    expect(lines).toEqual([
      expect.objectContaining({
        sku: "ERGO-LUX",
        name: "Ergo Lux aktuelni podaci",
        qty: 3,
        unitPriceSale: 2_100,
      }),
    ]);
  });
});
