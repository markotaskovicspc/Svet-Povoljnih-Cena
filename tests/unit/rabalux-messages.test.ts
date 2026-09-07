import { describe, expect, it } from "vitest";
import {
  supplierCancellationIdempotencyKey,
  supplierCancellationMessage,
  supplierOrderIdempotencyKey,
  supplierOrderMessage,
  supplierShippingDocumentsIdempotencyKey,
  supplierShippingDocumentsMessage,
} from "@/lib/rabalux/messages";

describe("Rabalux supplier email", () => {
  const items = [
    { externalSku: "7996", name: "Rabalux plafonjera", qty: 2 },
    { externalSku: "5324", name: "Rabalux lampa", qty: 1 },
  ];

  it("asks for immediate preparation with original supplier SKUs, names and quantities", () => {
    const message = supplierOrderMessage({
      orderNumber: "SPC-2026-000123",
      items,
    });
    expect(message.text).toContain("SPC-2026-000123");
    expect(message.text).toContain("7996 | Rabalux plafonjera × 2");
    expect(message.text).not.toContain("RAB-7996");
    expect(message.text).not.toMatch(/telefon|adresa|kupac/i);
    expect(message.text).toMatch(/potvrdite dostupnost/i);
    expect(message.text).toMatch(/mesto preuzimanja/i);
    expect(message.text).not.toMatch(
      /NE SLATI|uplata|prodajna cena|popust|trošak dostave|ukupni iznos/i,
    );
    expect(message.html).toContain("Naziv artikla");
  });

  it("sends shipping instructions without prices or non-Rabalux lines", () => {
    const message = supplierShippingDocumentsMessage({
      orderNumber: "SPC-2026-000123",
      trackingNo: "AAA8503000010",
      items,
    });
    expect(message.text).toContain("7996 × 2");
    expect(message.text).toContain("AAA8503000010");
    expect(message.subject).toContain("Adresnica i kurirski nalog");
    expect(message.text).toContain("preuzimanje robe na Rabalux adresi");
    expect(message.text).not.toMatch(/cena|12[.,]999|DC-/i);
    expect(message.text).not.toMatch(/garant|predračun|predracun/i);
    expect(supplierShippingDocumentsIdempotencyKey("ful-1")).toBe(
      "supplier-shipping-documents:ful-1:initial",
    );
  });

  it("uses a stable initial key for retries and an explicit key for resends", () => {
    expect(supplierOrderIdempotencyKey("ful-1")).toBe(
      supplierOrderIdempotencyKey("ful-1"),
    );
    expect(supplierOrderIdempotencyKey("ful-1", "manual-2")).not.toBe(
      supplierOrderIdempotencyKey("ful-1"),
    );
  });

  it("creates a separate idempotent cancellation notice", () => {
    const message = supplierCancellationMessage({
      orderNumber: "SPC-2026-000123",
      items,
    });
    expect(message.subject).toContain("Otkazivanje");
    expect(supplierCancellationIdempotencyKey("ful-1")).toBe(
      "supplier-cancel:ful-1",
    );
  });
});
