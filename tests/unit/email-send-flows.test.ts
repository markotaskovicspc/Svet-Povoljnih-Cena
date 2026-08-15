import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order, OrderStatus, Reclamation, ReclamationStatus } from "@/types";

const mocks = vi.hoisted(() => ({
  trackedDispatch: vi.fn(),
}));

vi.mock("@/lib/email/tracking", () => ({
  trackedDispatch: mocks.trackedDispatch,
}));

vi.mock("@/lib/email/config", () => ({
  getEmailConfig: () => ({
    provider: "resend",
    apiKey: "test-key",
    from: "Svet povoljnih cena <no-reply@svetpovoljnihcena.rs>",
    marketingFrom: "Svet povoljnih cena <ponude@svetpovoljnihcena.rs>",
    replyTo: "podrska@svetpovoljnihcena.rs",
    orderBcc: "porudzbine@svetpovoljnihcena.rs",
    reclamationsInbox: "reklamacije@svetpovoljnihcena.rs",
    commentsInbox: "komentar@svetpovoljnihcena.rs",
    inboundSecret: "test-inbound",
    resendWebhookSecret: "test-webhook",
    promotionsTopicId: "test-topic",
    newsletterSegmentId: null,
    unsubscribeSecret: "test-unsubscribe-secret",
    alertsCronSecret: "test-cron",
    baseUrl: "https://www.svetpovoljnihcena.rs",
  }),
}));

vi.mock("@/lib/email/unsubscribe", () => ({
  buildEmailUnsubscribeUrl: () =>
    "https://www.svetpovoljnihcena.rs/api/email/unsubscribe/test-token",
}));

import {
  sendBackInStockAlert,
  sendEmailConfirmation,
  sendFiscalReceipt,
  sendIpsPaymentConfirmation,
  sendMagicLink,
  sendOnSaleAlert,
  sendOrderConfirmation,
  sendOrderStatusChanged,
  sendOtpEmail,
  sendPasswordReset,
  sendReclamationReceipt,
  sendReclamationStatusChanged,
} from "@/lib/email/send";

const success = { ok: true as const, id: "resend-message-id", provider: "resend" as const };

const order: Order = {
  id: "SPC-AUDIT-0001",
  status: "kreirano",
  items: [
    {
      sku: "AUDIT-1",
      name: "Test proizvod",
      qty: 2,
      unitPriceFull: 1_200,
      unitPriceSale: 1_000,
      withAssembly: true,
      assemblyPrice: 300,
      categoryName: "Test kategorija",
      supplierIntegrationKey: "SPC",
    },
  ],
  subtotal: 2_000,
  savings: 400,
  shipping: 490,
  assemblyTotal: 600,
  voucherCode: "AUDIT",
  voucherDiscount: 100,
  firstPurchaseDiscount: 150,
  savedCardDiscount: 50,
  total: 2_790,
  shippingMethod: "kurir",
  paymentMethod: "ips",
  shippingAddress: {
    id: "address-audit",
    firstName: "Test",
    lastName: "Kupac",
    phone: "+381600000000",
    street: "Test 1",
    city: "Beograd",
    postalCode: "11000",
    country: "RS",
  },
  payment: {
    status: "paid",
    paymentReference: "IPS-AUDIT-1",
    paidAt: "2026-08-13T08:00:00.000Z",
  },
  createdAt: "2026-08-13T08:00:00.000Z",
  updatedAt: "2026-08-13T08:05:00.000Z",
};

const reclamation: Reclamation = {
  id: "R-AUDIT-1",
  orderId: order.id,
  sku: "AUDIT-1",
  customer: {
    firstName: "Test",
    lastName: "Kupac",
    email: "delivered@resend.dev",
    phone: "+381600000000",
  },
  description: "Kontrolisana test reklamacija.",
  photos: [],
  notifyVia: "email",
  status: "primljeno",
  createdAt: "2026-08-13T08:00:00.000Z",
};

describe("all transactional Resend send flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.trackedDispatch.mockResolvedValue(success);
  });

  it("renders order confirmation, purchase PDFs and a guarantee for non-Rabalux items", async () => {
    await expect(
      sendOrderConfirmation({ order, to: "delivered@resend.dev" }),
    ).resolves.toEqual(success);

    const input = mocks.trackedDispatch.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      kind: "order_confirmation",
      to: "delivered@resend.dev",
      bcc: "porudzbine@svetpovoljnihcena.rs",
      idempotencyKey: `order-conf:${order.id}`,
    });
    expect(input.html).toContain("Test proizvod");
    expect(input.text).toContain("SPC-AUDIT-0001");
    expect(input.attachments).toEqual([
      expect.objectContaining({ contentType: "application/pdf" }),
      expect.objectContaining({ contentType: "application/pdf" }),
      expect.objectContaining({
        filename: `garantni-list-${order.id}.pdf`,
        contentType: "application/pdf",
      }),
    ]);
    expect(input.attachments.every((item: { content: string }) => item.content.length > 100)).toBe(true);
  });

  it("does not attach a guarantee when every order item is Rabalux", async () => {
    await sendOrderConfirmation({
      order: {
        ...order,
        items: order.items.map((item) => ({
          ...item,
          supplierIntegrationKey: "RABALUX",
        })),
      },
      to: "delivered@resend.dev",
    });

    const input = mocks.trackedDispatch.mock.calls[0]?.[0];
    expect(input.attachments).toHaveLength(2);
    expect(
      input.attachments.some((attachment: { filename: string }) =>
        attachment.filename.startsWith("garantni-list-"),
      ),
    ).toBe(false);
  });

  it.each<OrderStatus>([
    "kreirano",
    "potvrdjeno",
    "u_pripremi",
    "spremno_za_isporuku",
    "u_isporuci",
    "isporuceno",
    "otkazano",
    "vraceno",
  ])("renders the order-status flow for %s", async (status) => {
    await sendOrderStatusChanged({
      order,
      status,
      to: "delivered@resend.dev",
      trackingUrl: "https://tracking.example/audit",
    });

    expect(mocks.trackedDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "order_status",
        idempotencyKey: `order-status:${order.id}:${status}`,
        tags: expect.objectContaining({ status }),
        html: expect.stringContaining("tracking.example/audit"),
      }),
    );
  });

  it("renders IPS payment and fiscal receipt flows with metadata and attachments", async () => {
    await sendIpsPaymentConfirmation({ order, to: "delivered@resend.dev" });
    await sendFiscalReceipt({
      order,
      to: "delivered@resend.dev",
      receiptNumber: "AUDIT-RECEIPT-1",
      qrUrl: "https://tax.example/audit",
      pdf: Buffer.from("synthetic fiscal pdf"),
      withdrawalForm: Buffer.from("synthetic withdrawal form"),
    });

    expect(mocks.trackedDispatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        kind: "ips_payment_confirmation",
        metadata: expect.objectContaining({ paymentReference: "IPS-AUDIT-1" }),
      }),
    );
    expect(mocks.trackedDispatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        kind: "fiscal_receipt",
        idempotencyKey: "fiscal:AUDIT-RECEIPT-1",
        attachments: [
          expect.objectContaining({ filename: "fiskalni-racun-AUDIT-RECEIPT-1.pdf" }),
          expect.objectContaining({ filename: `obrazac-za-odustajanje-${order.id}.pdf` }),
        ],
      }),
    );
  });

  it.each<ReclamationStatus>(["primljeno", "u_obradi", "reseno", "odbijeno"])(
    "renders reclamation receipt and status flow for %s",
    async (status) => {
      await sendReclamationReceipt({ reclamation, to: "delivered@resend.dev" });
      await sendReclamationStatusChanged({
        reclamation,
        status,
        to: "delivered@resend.dev",
      });

      expect(mocks.trackedDispatch).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          kind: "reclamation_receipt",
          idempotencyKey: `reclamation:${reclamation.id}`,
        }),
      );
      expect(mocks.trackedDispatch).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          kind: "reclamation_status",
          idempotencyKey: `reclamation-status:${reclamation.id}:${status}`,
        }),
      );
    },
  );

  it("renders password reset, OTP, email confirmation and escaped magic link flows", async () => {
    await sendPasswordReset({
      to: "delivered@resend.dev",
      token: "password-audit-token-with-sufficient-length",
    });
    await sendOtpEmail({ to: "delivered@resend.dev", code: "123456" });
    await sendEmailConfirmation({
      to: "delivered@resend.dev",
      token: "email-audit-token-with-sufficient-length",
      includeFirstPurchaseOffer: true,
      marketingUnsubscribeUrl: "https://www.svetpovoljnihcena.rs/unsubscribe/audit",
    });
    await sendMagicLink({
      to: "delivered@resend.dev",
      url: "https://www.svetpovoljnihcena.rs/nalog/prijava?x=1&y=\"audit\"",
    });

    expect(mocks.trackedDispatch.mock.calls.map(([input]) => input.kind)).toEqual([
      "password_reset",
      "otp",
      "email_confirmation",
      "magic_link",
    ]);
    expect(mocks.trackedDispatch.mock.calls[1]?.[0].subject).toContain("123456");
    expect(mocks.trackedDispatch.mock.calls[2]?.[0].html).toContain("unsubscribe/audit");
    expect(mocks.trackedDispatch.mock.calls[3]?.[0].html).toContain("&amp;y=&quot;audit&quot;");
    expect(mocks.trackedDispatch.mock.calls[3]?.[0].html).not.toContain('y="audit"');
  });

  it("renders both product-alert variants with safe manage links", async () => {
    const product = {
      id: "product-audit",
      sku: "AUDIT-1",
      slug: "test-proizvod",
      name: "Test proizvod",
      fullPrice: 1_200,
      salePrice: 999,
    };
    await sendBackInStockAlert({
      to: "delivered@resend.dev",
      userId: "user-audit",
      product,
    });
    await sendOnSaleAlert({
      to: "delivered@resend.dev",
      userId: "user-audit",
      product,
    });

    expect(mocks.trackedDispatch.mock.calls.map(([input]) => input.kind)).toEqual([
      "back_in_stock",
      "on_sale",
    ]);
    for (const [input] of mocks.trackedDispatch.mock.calls) {
      expect(input.html).toContain("api/email/unsubscribe/test-token");
      expect(input.idempotencyKey).toContain("user-audit:product-audit");
    }
  });

  it("does not dispatch recipient-optional flows when the address is empty", async () => {
    await sendOrderConfirmation({ order, to: "" });
    await sendOrderStatusChanged({ order, status: "potvrdjeno", to: "" });
    await sendIpsPaymentConfirmation({ order, to: "" });
    await sendFiscalReceipt({ order, to: "", receiptNumber: "AUDIT" });
    await sendReclamationReceipt({ reclamation, to: "" });
    await sendReclamationStatusChanged({ reclamation, status: "reseno", to: "" });
    await sendBackInStockAlert({
      to: "",
      userId: "user-audit",
      product: {
        id: "product-audit",
        sku: "AUDIT-1",
        slug: "test",
        name: "Test",
        fullPrice: 100,
      },
    });

    expect(mocks.trackedDispatch).not.toHaveBeenCalled();
  });
});
