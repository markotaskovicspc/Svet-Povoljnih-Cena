import { describe, expect, it } from "vitest";
import {
  purchaseOrderAttachmentFilename,
  renderPurchaseOrderSupplierEmail,
} from "@/lib/admin/purchase-order-email";

describe("supplier purchase-order email", () => {
  it("renders a branded, client-safe HTML email with the exact order data", async () => {
    const email = await renderPurchaseOrderSupplierEmail("13/26");

    expect(email.subject).toBe("Order NO 13/26");
    expect(email.attachmentFilename).toBe("porudzbenica-13-26.pdf");
    expect(email.text).toBe(
      "Dear,\nPlease kindly confirm receipt of our new order.\nIf any parameters or specifications of the order are not suitable or require adjustment, please inform us by email and specify which parts need to be revised.\n\nBest regards",
    );
    expect(email.html).toMatch(/^<!doctype html>/);
    expect(email.html).toContain('lang="en"');
    expect(email.html).toContain("/documents/garantni-list-logo.jpeg");
    expect(email.html).toContain("Purchase order");
    expect(email.html).toContain("New order 13/26");
    expect(email.html).toContain("porudzbenica-13-26.pdf");
    expect(email.html).toContain("Please kindly confirm receipt of our new order.");
    expect(email.html).toContain("The complete order request is attached");
    expect(email.html).not.toContain("undefined");
    expect(email.html).not.toContain("<script");
  });

  it("uses a mail-client-safe attachment filename", () => {
    expect(purchaseOrderAttachmentFilename("104/26")).toBe(
      "porudzbenica-104-26.pdf",
    );
  });
});
