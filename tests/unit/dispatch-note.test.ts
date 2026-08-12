import { describe, expect, it } from "vitest";
import {
  buildDispatchNoteUbl,
  calculateDispatchLineTotals,
  calculateDispatchTotals,
  dispatchNoteInputSchema,
} from "@/lib/admin/dispatch-note";
import { buildPdf } from "@/lib/email/pdf";

const validInput = {
  issueDate: "2026-07-25",
  issuerCustomerId: "issuer",
  receiverCustomerId: "receiver",
  sourceWarehouseId: "warehouse-a",
  destinationWarehouseId: null,
  priceListId: "price-list-1",
  showPrices: true,
  shipmentMethod: 1,
  actualDispatchAt: "2026-07-25T08:00:00.000Z",
  plannedDeliveryAt: "2026-07-25T10:00:00.000Z",
  lines: [{ sku: "SKU-1", qty: 2, orderItemId: null }],
};

describe("dispatch note", () => {
  it("requires a different destination warehouse for an internal transfer", () => {
    const parsed = dispatchNoteInputSchema.safeParse({
      ...validInput,
      receiverCustomerId: validInput.issuerCustomerId,
      destinationWarehouseId: validInput.sourceWarehouseId,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.message).join(" ")).toContain(
        "moraju biti različiti",
      );
    }
  });

  it("calculates line and document totals from gross prices", () => {
    expect(calculateDispatchLineTotals(3, 120)).toEqual({
      totalNet: 300,
      totalVat: 60,
      totalGross: 360,
    });
    expect(
      calculateDispatchTotals([
        { qty: 3, unitPriceGross: 120 },
        { qty: 1, unitPriceGross: 240 },
      ]),
    ).toEqual({ net: 500, vat: 100, gross: 600 });
  });

  it("builds the current Serbian DespatchAdvice and escapes item data", () => {
    const ubl = buildDispatchNoteUbl({
      id: "dispatch-1",
      number: "POR-1",
      issueDate: new Date("2026-07-25T00:00:00.000Z"),
      internal: false,
      notes: "Pažnja & provera",
      shipmentMethod: 2,
      actualDispatchAt: new Date("2026-07-25T08:00:00.000Z"),
      plannedDeliveryAt: new Date("2026-07-25T10:00:00.000Z"),
      sourceOrderNumbers: ["POR-1"],
      issuer: {
        name: "Izdavalac",
        pib: "123",
        registrationNumber: "11111111",
        address: "Ulica 1",
        city: "Beograd",
        postalCode: "11000",
        country: "RS",
      },
      receiver: {
        name: "Kupac & partner",
        pib: "456",
        registrationNumber: "22222222",
        address: "Ulica 2",
        city: "Novi Sad",
        postalCode: "21000",
        country: "RS",
      },
      sourceWarehouse: {
        code: "DC",
        name: "Distributivni centar",
        address: "Ulica 1",
        city: "Beograd",
      },
      deliveryLocation: {
        code: "NS",
        name: "Magacin Novi Sad",
        address: "Interna 3",
        city: "Novi Sad",
        country: "RS",
      },
      carrier: {
        name: "Prevoznik",
        pib: "789",
        registrationNumber: "33333333",
        address: "Put 4",
        city: "Beograd",
        postalCode: "11000",
        country: "RS",
      },
      licensePlate: "BG-123-AA",
      items: [
        {
          sku: "SKU<&>",
          name: "Artikal & test",
          sourceOrderNumber: "POR-1",
          qty: 2,
          palletQty: 24,
          attribute1: "A&B",
        },
      ],
    });
    expect(ubl).toContain(
      "urn:fdc:mfin.gov.rs:logistics:trns:despatch_advice:1:2025.12",
    );
    expect(ubl).toContain("<cbc:DespatchAdviceTypeCode>Ext</cbc:DespatchAdviceTypeCode>");
    expect(ubl).toContain("SKU&lt;&amp;&gt;");
    expect(ubl).toContain("Kupac &amp; partner");
    expect(ubl).toContain("<cbc:StreetName>Interna 3</cbc:StreetName>");
    expect(ubl).toContain("<cac:CarrierParty>");
    expect(ubl).toContain("<cbc:LicensePlateID>BG-123-AA</cbc:LicensePlateID>");
    expect(ubl).toContain("<cbc:LineID>N/A</cbc:LineID>");
    expect(ubl).toContain("<cbc:Name>Komada na paleti</cbc:Name>");
    expect(ubl).toContain("<cbc:Value>24</cbc:Value>");
    expect(ubl).not.toContain("<cac:Price>");
  });

  it("uses one official purchase-order reference for a combined dispatch", () => {
    const shared = {
      name: "Firma",
      pib: "123",
      registrationNumber: "11111111",
      address: "Ulica 1",
      city: "Beograd",
      postalCode: "11000",
      country: "RS",
    };
    const ubl = buildDispatchNoteUbl({
      id: "dispatch-2",
      number: "OTP-2026-00001",
      issueDate: new Date("2026-07-25T00:00:00.000Z"),
      internal: false,
      shipmentMethod: 4,
      actualDispatchAt: new Date("2026-07-25T08:00:00.000Z"),
      plannedDeliveryAt: new Date("2026-07-25T10:00:00.000Z"),
      sourceOrderNumbers: ["VP-1", "VP-2", "VP-1"],
      issuer: shared,
      receiver: { ...shared, pib: "456", registrationNumber: "22222222" },
      sourceWarehouse: {
        code: "DC",
        name: "Distributivni centar",
        address: "Ulica 1",
        city: "Beograd",
      },
      courier: {
        firstName: "Ana",
        lastName: "Anić",
        idNumber: "123456789",
      },
      items: [{ sku: "SKU-1", name: "Artikal", qty: 1 }],
    });
    expect(ubl.match(/<cac:OrderReference>/g)).toHaveLength(1);
    expect(ubl).toContain("<cbc:ID>VP-1, VP-2</cbc:ID>");
    expect(ubl).toContain("<cac:MasterPerson>");
    expect(ubl).toContain("<cbc:DocumentType>Lična karta</cbc:DocumentType>");
  });

  it("keeps long printouts on multiple PDF pages", () => {
    const pdf = buildPdf(
      "Otpremnica TEST",
      Array.from({ length: 140 }, (_, index) => ({
        text: `Stavka ${index + 1}`,
      })),
    ).toString("binary");
    expect(pdf.match(/\/Type \/Page\b/g)?.length).toBeGreaterThan(1);
  });
});
