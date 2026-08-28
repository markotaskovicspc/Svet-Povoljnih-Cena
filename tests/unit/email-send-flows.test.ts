import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
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
    orderBcc: "office@svetpovoljnihcena.rs",
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
  sendGuestReclamationLink,
  sendIpsPaymentConfirmation,
  sendMagicLink,
  sendOnSaleAlert,
  sendOrderConfirmation,
  sendOrderItemsChanged,
  sendOrderStatusChanged,
  sendWarehouseOrderCancellation,
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
      sendOrderConfirmation({
        order,
        to: "delivered@resend.dev",
        accessToken: "guest-order-access-token-123456789",
      }),
    ).resolves.toEqual(success);

    const input = mocks.trackedDispatch.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      kind: "order_confirmation",
      to: "delivered@resend.dev",
      bcc: "porudzbine@svetpovoljnihcena.rs",
      idempotencyKey: `order-conf:${order.id}`,
    });
    expect(input.html).toContain("Test proizvod");
    expect(input.html).toContain("/documents/garantni-list-logo.jpeg");
    expect(input.html).toContain("Porudžbina je primljena");
    expect(input.html).toContain("Dokumenta u prilogu");
    expect(input.html).toContain("Garantni list je popunjen");
    expect(input.html).toContain("Garantni list - garancija 1 (jedna) godina");
    expect(input.html).toContain("Predračun sa pregledom cena i PDV-a");
    expect(input.html).toContain("Plaćeno");
    expect(input.html).not.toContain("Svet Akcija");
    expect(input.html).toContain("/reklamacije/prijava?order=");
    expect(input.html).toContain("guest-order-access-token-123456789");
    expect(input.html).toContain("Vrednost artikala");
    expect(input.html).toContain("Popust za prvu kupovinu");
    expect(input.html).toContain("Popust za sačuvanu karticu");
    expect(input.text).toContain("SPC-AUDIT-0001");
    expect(input.metadata).toEqual({
      orderId: order.id,
      attachmentNames: [
        `predracun-racun-${order.id}.pdf`,
        `obrazac-za-odustajanje-${order.id}.pdf`,
        `garantni-list-${order.id}.pdf`,
      ],
      attachmentCount: 3,
      guaranteeItemCount: 1,
      businessBuyer: false,
      previewMode: false,
    });
    expect(input.attachments).toEqual([
      expect.objectContaining({ contentType: "application/pdf" }),
      expect.objectContaining({ contentType: "application/pdf" }),
      expect.objectContaining({
        filename: `garantni-list-${order.id}.pdf`,
        contentType: "application/pdf",
      }),
    ]);
    expect(input.attachments.every((item: { content: string }) => item.content.length > 100)).toBe(true);

    if (process.env.ORDER_EMAIL_SAMPLE_DIR) {
      const previewOrder: Order = {
        ...order,
        id: "SPC-2026-PREGLED",
        items: [
          {
            ...order.items[0]!,
            sku: "110087",
            name: "Trpezarijska stolica URBAN SEAT",
            qty: 3,
            unitPriceFull: 1_999,
            unitPriceSale: 1_499,
            withAssembly: false,
            assemblyPrice: null,
          },
          {
            ...order.items[0]!,
            sku: "110185",
            name: "Korpa za veš CLEAN BOX",
            qty: 1,
            unitPriceFull: 2_999,
            unitPriceSale: 2_427,
            withAssembly: false,
            assemblyPrice: null,
          },
          {
            ...order.items[0]!,
            sku: "110086",
            name: "Trpezarijska stolica ELEGANCE SEAT",
            qty: 1,
            unitPriceFull: 3_099,
            unitPriceSale: 2_570,
            withAssembly: false,
            assemblyPrice: null,
          },
        ],
        subtotal: 9_494,
        savings: 2_601,
        shipping: 599,
        assemblyTotal: 0,
        voucherCode: null,
        voucherDiscount: null,
        firstPurchaseDiscount: null,
        savedCardDiscount: null,
        total: 10_093,
        paymentMethod: "uplata_na_racun",
        payment: { status: "pending" },
        shippingAddress: {
          ...order.shippingAddress,
          firstName: "Milan",
          lastName: "Jovanović",
          street: "QA test ulica 20",
          city: "Novi Sad",
          postalCode: "21000",
          companyName: "KUPAC PRAVNO LICE DOO NOVI SAD",
          pib: "109876543",
        },
      };
      await sendOrderConfirmation({
        order: previewOrder,
        to: "preview@example.invalid",
        accessToken: "preview-access-token-123456789",
      });
      const previewInput = mocks.trackedDispatch.mock.calls.at(-1)?.[0];
      await mkdir(process.env.ORDER_EMAIL_SAMPLE_DIR, { recursive: true });
      await Promise.all([
        writeFile(
          `${process.env.ORDER_EMAIL_SAMPLE_DIR}/order-confirmation.html`,
          previewInput.html,
        ),
        writeFile(
          `${process.env.ORDER_EMAIL_SAMPLE_DIR}/order-confirmation.txt`,
          previewInput.text,
        ),
        ...previewInput.attachments.map((attachment: { filename: string; content: string }) =>
          writeFile(
            `${process.env.ORDER_EMAIL_SAMPLE_DIR}/${attachment.filename}`,
            Buffer.from(attachment.content, "base64"),
          ),
        ),
      ]);
    }
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
    expect(input.html).not.toContain("Garantni list je popunjen");
    expect(input.metadata).toMatchObject({
      attachmentCount: 2,
      guaranteeItemCount: 0,
    });
    expect(
      input.attachments.some((attachment: { filename: string }) =>
        attachment.filename.startsWith("garantni-list-"),
      ),
    ).toBe(false);
  });

  it("renders business identity, bank instructions and the complete document set", async () => {
    await sendOrderConfirmation({
      order: {
        ...order,
        paymentMethod: "uplata_na_racun",
        payment: { status: "pending" },
        shippingAddress: {
          ...order.shippingAddress,
          firstName: "Milan",
          lastName: "Jovanović",
          companyName: "Kupac d.o.o.",
          pib: "109876543",
        },
      },
      to: "owner@example.test",
      bcc: null,
      subjectPrefix: "[PREGLED]",
      previewMode: true,
    });

    const input = mocks.trackedDispatch.mock.calls[0]?.[0];
    expect(input.subject).toContain("[PREGLED]");
    expect(input.bcc).toBeNull();
    expect(input.html).toContain("Kontrolni pregled");
    expect(input.html).toContain("Kupac d.o.o.");
    expect(input.html).toContain("109876543");
    expect(input.html).toContain("Podaci za uplatu");
    expect(input.html).toContain("265-3310310005375-34");
    expect(input.html).toContain("Obrazac za odustanak od kupovine");
    expect(input.html).not.toContain("Pogledaj porudžbinu");
    expect(input.attachments).toHaveLength(3);
    expect(
      input.attachments.some((attachment: { filename: string }) =>
        attachment.filename.startsWith("obrazac-za-odustajanje-"),
      ),
    ).toBe(true);
    expect(input.metadata).toMatchObject({
      attachmentCount: 3,
      guaranteeItemCount: 1,
      businessBuyer: true,
      previewMode: true,
    });
  });

  it("shows customer-friendly cash-on-delivery labels instead of raw values", async () => {
    await sendOrderConfirmation({
      order: {
        ...order,
        paymentMethod: "pouzece_gotovina",
        payment: { status: "pending" },
      },
      to: "delivered@resend.dev",
    });

    const input = mocks.trackedDispatch.mock.calls[0]?.[0];
    expect(input.html).toContain("Pouzeće - gotovina");
    expect(input.html).toContain("Plaćanje prilikom isporuke");
    expect(input.html).not.toContain("pouzece_gotovina");
    expect(input.html).not.toContain(">pending<");
  });

  it("keeps attachment copy aligned when purchase documents are disabled", async () => {
    await sendOrderConfirmation({
      order,
      to: "delivered@resend.dev",
      attachInvoice: false,
    });

    const input = mocks.trackedDispatch.mock.calls[0]?.[0];
    expect(input.html).not.toContain("Predračun sa pregledom cena i PDV-a");
    expect(input.html).not.toContain("Obrazac za odustanak od kupovine");
    expect(input.html).toContain("Garantni list - garancija");
    expect(input.attachments).toHaveLength(1);
    expect(input.metadata).toMatchObject({
      attachmentCount: 1,
      guaranteeItemCount: 1,
    });
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

  it("obaveštava kupca o uklonjenoj stavci i potvrđuje da ostale ostaju", async () => {
    await sendOrderItemsChanged({
      order: {
        ...order,
        total: 1_490,
      },
      to: "delivered@resend.dev",
      itemName: "Test proizvod",
      sku: "AUDIT-1",
      previousQty: 2,
      newQty: 0,
      idempotencyKey: "order-items-changed:audit-operation",
    });

    const input = mocks.trackedDispatch.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      kind: "order_items_changed",
      to: "delivered@resend.dev",
      bcc: "office@svetpovoljnihcena.rs",
      idempotencyKey: "order-items-changed:audit-operation",
    });
    expect(input.subject).toContain(order.id);
    expect(input.html).toContain("Test proizvod");
    expect(input.html).toContain("2 → 0");
    expect(input.html).toContain("Sve ostale stavke ostaju potvrđene");
    expect(input.text).toContain("1.490");
  });

  it("obaveštava kupca kada je novi artikal dodat u porudžbinu", async () => {
    await sendOrderItemsChanged({
      order: {
        ...order,
        total: 3_490,
      },
      to: "delivered@resend.dev",
      itemName: "Novi test proizvod",
      sku: "AUDIT-NEW",
      previousQty: 0,
      newQty: 2,
      idempotencyKey: "order-items-changed:add-operation",
    });

    const input = mocks.trackedDispatch.mock.calls[0]?.[0];
    expect(input.html).toContain("Novi artikal je dodat");
    expect(input.html).toContain("Novi test proizvod");
    expect(input.html).toContain("0 → 2");
    expect(input.text).toContain("3.490");
  });

  it("šalje magacinu broj naloga kada kupac otkaže već učitanu porudžbinu", async () => {
    await sendWarehouseOrderCancellation({
      to: ["dc@example.invalid"],
      orderNumber: order.id,
      pickupBatchNumbers: ["PRE-2026-00501"],
      removedPickupLines: 0,
      activeShipmentCount: 1,
      idempotencyKey: "warehouse-order-cancel:audit",
    });

    const input = mocks.trackedDispatch.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      kind: "warehouse_order_cancelled",
      to: ["dc@example.invalid"],
      idempotencyKey: "warehouse-order-cancel:audit",
    });
    expect(input.subject).toContain("HITNO");
    expect(input.html).toContain("PRE-2026-00501");
    expect(input.html).toContain("aktivan kurirski nalog");
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
      expect(mocks.trackedDispatch.mock.calls[0]?.[0].html).toContain(
        "/nalog/reklamacije",
      );
    },
  );

  it("renders a valid guest reclamation recovery link without account-only actions", async () => {
    await sendGuestReclamationLink({
      order,
      to: "guest@example.invalid",
      accessToken: "guest-reclamation-recovery-token-0123456789",
    });
    await sendReclamationReceipt({
      reclamation,
      to: "guest@example.invalid",
      guest: true,
    });
    await sendReclamationStatusChanged({
      reclamation,
      status: "u_obradi",
      to: "guest@example.invalid",
      guest: true,
      idempotencyKey: "reclamation-status:event-audit",
    });

    const recovery = mocks.trackedDispatch.mock.calls[0]?.[0];
    expect(recovery).toMatchObject({
      kind: "guest_reclamation_link",
      to: "guest@example.invalid",
      subject: expect.stringContaining(order.id),
      idempotencyKey: expect.stringContaining(
        `guest-reclamation-link:${order.id}:`,
      ),
    });
    expect(recovery.html).toContain(
      `/reklamacije/prijava?order=${encodeURIComponent(order.id)}&amp;token=guest-reclamation-recovery-token-0123456789`,
    );
    expect(mocks.trackedDispatch.mock.calls[1]?.[0].html).not.toContain(
      "/nalog/reklamacije",
    );
    expect(mocks.trackedDispatch.mock.calls[2]?.[0]).toMatchObject({
      idempotencyKey: "reclamation-status:event-audit",
      html: expect.not.stringContaining("/nalog/reklamacije"),
    });
  });

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
    await sendOrderItemsChanged({
      order,
      to: "",
      itemName: "Test proizvod",
      sku: "AUDIT-1",
      previousQty: 2,
      newQty: 1,
      idempotencyKey: "order-items-changed:empty",
    });
    await sendOrderStatusChanged({ order, status: "potvrdjeno", to: "" });
    await sendIpsPaymentConfirmation({ order, to: "" });
    await sendFiscalReceipt({ order, to: "", receiptNumber: "AUDIT" });
    await sendReclamationReceipt({ reclamation, to: "" });
    await sendReclamationStatusChanged({ reclamation, status: "reseno", to: "" });
    await sendGuestReclamationLink({
      order,
      to: "",
      accessToken: "guest-reclamation-recovery-token-0123456789",
    });
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
