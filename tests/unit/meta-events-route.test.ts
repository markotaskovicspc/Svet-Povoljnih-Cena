import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "@/types";

const mocks = vi.hoisted(() => ({
  capiConfig: vi.fn(),
  sendCapi: vi.fn(),
  getOrder: vi.fn(),
  checkRateLimit: vi.fn(),
  operationalError: vi.fn(),
}));

vi.mock("@/lib/analytics/meta-capi.server", () => ({
  getMetaCapiConfig: mocks.capiConfig,
  sendMetaCapiEvent: mocks.sendCapi,
}));
vi.mock("@/lib/api/orders", () => ({
  getPublicOrderForConfirmation: mocks.getOrder,
}));
vi.mock("@/lib/security/rate-limit", () => ({
  checkRateLimitForRequest: mocks.checkRateLimit,
  getClientIp: () => "203.0.113.10",
  rateLimitJson: () => new Response(null, { status: 429 }),
}));
vi.mock("@/lib/monitoring", () => ({
  logOperationalError: mocks.operationalError,
}));

import { POST } from "@/app/api/analytics/meta/events/route";

describe("Meta server event route", () => {
  beforeEach(() => {
    mocks.capiConfig.mockReturnValue({ pixelId: "4622399164665144" });
    mocks.sendCapi.mockResolvedValue({ sent: true });
    mocks.checkRateLimit.mockResolvedValue({ ok: true });
    mocks.getOrder.mockReset();
  });

  it("refuses both browser-derived and server events without marketing consent", async () => {
    const response = await postEvent(
      { eventName: "PageView", eventId: "pageview:event-1", path: "/" },
      "spc_cookie_consent=analytics",
    );

    expect(response.status).toBe(403);
    expect(mocks.sendCapi).not.toHaveBeenCalled();
  });

  it("sends a consented event with matching cookies and source context", async () => {
    const response = await postEvent(
      {
        eventName: "ViewContent",
        eventId: "viewcontent:event-1",
        path: "/p/test",
        customData: {
          currency: "RSD",
          value: 999,
          content_ids: ["SKU-1"],
          content_type: "product",
          contents: [{ id: "SKU-1", quantity: 1, item_price: 999 }],
        },
      },
      "spc_cookie_consent=all; _fbp=fb.1.123.456",
    );

    expect(response.status).toBe(202);
    expect(mocks.sendCapi).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "ViewContent",
        eventId: "viewcontent:event-1",
        eventSourceUrl: "https://www.svetpovoljnihcena.rs/p/test",
        clientIpAddress: "203.0.113.10",
        clientUserAgent: "Test Browser",
        fbp: "fb.1.123.456",
      }),
    );
  });

  it("rebuilds Purchase data from an authorized order and fixes its dedupe ID", async () => {
    const order = sampleOrder();
    mocks.getOrder.mockResolvedValue(order);
    const response = await postEvent(
      {
        eventName: "Purchase",
        eventId: "purchase:forged",
        path: "/checkout/potvrda",
        customData: { currency: "RSD", value: 1 },
        orderNumber: order.id,
        orderAccessToken: "valid-order-access-token-123456",
      },
      "spc_cookie_consent=all",
    );

    expect(response.status).toBe(202);
    expect(mocks.getOrder).toHaveBeenCalledWith(
      order.id,
      "valid-order-access-token-123456",
    );
    expect(mocks.sendCapi).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "Purchase",
        eventId: "purchase:SPC-2026-0001",
        customData: expect.objectContaining({
          value: 1_800,
          order_id: "SPC-2026-0001",
        }),
      }),
    );
  });
});

function postEvent(body: unknown, cookie: string) {
  return POST(
    new Request("https://www.svetpovoljnihcena.rs/api/analytics/meta/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "user-agent": "Test Browser",
      },
      body: JSON.stringify(body),
    }),
  );
}

function sampleOrder(): Order {
  return {
    id: "SPC-2026-0001",
    status: "kreirano",
    items: [
      {
        sku: "SKU-1",
        name: "Test",
        qty: 2,
        unitPriceFull: 1_000,
        unitPriceSale: 900,
      },
    ],
    subtotal: 1_800,
    savings: 200,
    shipping: 350,
    assemblyTotal: 0,
    total: 2_150,
    shippingMethod: "kurir",
    paymentMethod: "pouzece_gotovina",
    shippingAddress: {
      id: "shipping",
      firstName: "Test",
      lastName: "Kupac",
      phone: "0600000000",
      street: "Test 1",
      city: "Beograd",
      postalCode: "11000",
      country: "RS",
    },
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  };
}
