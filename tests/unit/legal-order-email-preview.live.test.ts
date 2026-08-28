import { config } from "dotenv";
import { describe, expect, it } from "vitest";
import type { Order } from "@/types";

const enabled = process.env.SEND_LEGAL_ORDER_EMAIL_PREVIEWS === "1";

describe.skipIf(!enabled)("manual legal-order email previews", () => {
  it(
    "sends the corrected order and a future example only to the explicit preview inbox",
    async () => {
      config({ path: ".env.local", quiet: true });
      if (process.env.POSTGRES_URL_NON_POOLING) {
        process.env.DATABASE_URL = process.env.POSTGRES_URL_NON_POOLING;
      }
      const to = process.env.LEGAL_ORDER_EMAIL_PREVIEW_TO?.trim();
      if (!to) throw new Error("LEGAL_ORDER_EMAIL_PREVIEW_TO is required.");
      const sourceOrderId =
        process.env.LEGAL_ORDER_EMAIL_PREVIEW_SOURCE_ORDER_ID?.trim();
      const companyName =
        process.env.LEGAL_ORDER_EMAIL_PREVIEW_COMPANY_NAME?.trim();
      const pib = process.env.LEGAL_ORDER_EMAIL_PREVIEW_PIB?.trim();
      if (!sourceOrderId || !companyName || !pib || !/^\d{9}$/.test(pib)) {
        throw new Error(
          "Source order ID, company name and a nine-digit PIB are required.",
        );
      }

      const [{ loadOrderForEmail }, { sendOrderConfirmation }] =
        await Promise.all([
          import("@/lib/email/adapt"),
          import("@/lib/email/send"),
        ]);
      const loaded = await loadOrderForEmail(sourceOrderId);
      if (!loaded) throw new Error("The source preview order is not available.");

      const corrected: Order = {
        ...loaded.order,
        paymentMethod: "uplata_na_racun",
        payment: { status: "pending" },
        shippingAddress: {
          ...loaded.order.shippingAddress,
          companyName,
          pib,
        },
        billingAddress: undefined,
      };
      const futureExample: Order = {
        ...corrected,
        id: "SPC-2026-PRIMER-B2B",
        userId: "preview-only",
        guestEmail: undefined,
        customerEmail: to,
        shippingAddress: {
          ...corrected.shippingAddress,
          id: "preview-business-address",
          firstName: "Ime",
          lastName: "Prezime",
          phone: "0600000000",
          street: "Primer ulica 1",
          city: "Beograd",
          postalCode: "11000",
          companyName: "PRIMER FIRMA DOO — KONTROLNI PREGLED",
          pib: "000000000",
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const correctedResult = await sendOrderConfirmation({
        order: corrected,
        to,
        bcc: null,
        subjectPrefix: "[PREGLED 1/2 — ISPRAVLJENA VERZIJA]",
        previewMode: true,
        idempotencyKey: `legal-order-preview:${sourceOrderId}:corrected-v2`,
      });
      const futureResult = await sendOrderConfirmation({
        order: futureExample,
        to,
        bcc: null,
        subjectPrefix: "[PREGLED 2/2 — BUDUĆE PRAVNO LICE]",
        previewMode: true,
        idempotencyKey: "legal-order-preview:2026-08-28:future-business",
      });

      expect(correctedResult).toMatchObject({ ok: true, provider: "resend" });
      expect(futureResult).toMatchObject({ ok: true, provider: "resend" });
    },
    60_000,
  );
});
