import { z } from "zod";
import { calculateSalesLineTotals } from "@/lib/admin/sales-order";

export const DISPATCH_NOTE_VAT_RATE = 20;
export const DISPATCH_SHIPMENT_METHODS = [
  { value: 1, label: "Sopstveni prevoz" },
  { value: 2, label: "Prevoznik" },
  { value: 3, label: "Prevoz primaoca" },
  { value: 4, label: "Lično preuzimanje" },
  { value: 5, label: "Lična dostava" },
] as const;

const dispatchLineSchema = z.object({
  orderItemId: z.string().trim().min(1).nullable().optional(),
  sku: z.string().trim().min(1, "Šifra artikla je obavezna.").max(120),
  qty: z.coerce
    .number()
    .int("Količina mora biti ceo broj.")
    .min(1, "Količina mora biti najmanje 1.")
    .max(999_999, "Količina je prevelika."),
});

const optionalDateInput = z
  .string()
  .trim()
  .max(40)
  .optional()
  .default("");

export const dispatchNoteInputSchema = z
  .object({
    issueDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Datum otpremnice nije ispravan."),
    issuerCustomerId: z.string().trim().min(1, "Firma izdavalac je obavezna."),
    receiverCustomerId: z.string().trim().min(1, "Firma primalac je obavezna."),
    sourceWarehouseId: z.string().trim().min(1, "Izvorni magacin je obavezan."),
    destinationWarehouseId: z.string().trim().nullable().optional(),
    priceListId: z.string().trim().min(1).nullable().optional(),
    showPrices: z.boolean().default(true),
    notes: z.string().trim().max(2_000, "Napomena može imati najviše 2.000 karaktera.").optional(),
    importFrom: optionalDateInput,
    importTo: optionalDateInput,
    shipmentMethod: z.coerce
      .number()
      .int()
      .refine(
        (value) => DISPATCH_SHIPMENT_METHODS.some((item) => item.value === value),
        "Način otpreme nije podržan.",
      ),
    actualDispatchAt: optionalDateInput,
    plannedDeliveryAt: optionalDateInput,
    carrierCustomerId: z.string().trim().min(1).nullable().optional(),
    licensePlate: z.string().trim().max(30).optional().default(""),
    courierFirstName: z.string().trim().max(100).optional().default(""),
    courierLastName: z.string().trim().max(100).optional().default(""),
    courierIdNumber: z.string().trim().max(50).optional().default(""),
    lines: z
      .array(dispatchLineSchema)
      .min(1, "Otpremnica mora imati najmanje jedan artikal."),
  })
  .superRefine((value, context) => {
    const internal = value.issuerCustomerId === value.receiverCustomerId;
    if (internal && !value.destinationWarehouseId) {
      context.addIssue({
        code: "custom",
        path: ["destinationWarehouseId"],
        message: "Odredišni magacin je obavezan za internu otpremnicu.",
      });
    }
    if (!internal && !value.priceListId) {
      context.addIssue({
        code: "custom",
        path: ["priceListId"],
        message: "Cenovnik je obavezan za eksternu otpremnicu.",
      });
    }
    if (
      internal &&
      value.destinationWarehouseId === value.sourceWarehouseId
    ) {
      context.addIssue({
        code: "custom",
        path: ["destinationWarehouseId"],
        message: "Izvorni i odredišni magacin moraju biti različiti.",
      });
    }
    if (value.importFrom && !/^\d{4}-\d{2}-\d{2}$/.test(value.importFrom)) {
      context.addIssue({
        code: "custom",
        path: ["importFrom"],
        message: "Početak perioda nije ispravan.",
      });
    }
    if (value.importTo && !/^\d{4}-\d{2}-\d{2}$/.test(value.importTo)) {
      context.addIssue({
        code: "custom",
        path: ["importTo"],
        message: "Kraj perioda nije ispravan.",
      });
    }
    if (value.importFrom && value.importTo && value.importFrom > value.importTo) {
      context.addIssue({
        code: "custom",
        path: ["importTo"],
        message: "Kraj perioda mora biti nakon početka perioda.",
      });
    }
    const seenManualSkus = new Set<string>();
    const seenOrderItems = new Set<string>();
    value.lines.forEach((line, index) => {
      if (line.orderItemId) {
        if (seenOrderItems.has(line.orderItemId)) {
          context.addIssue({
            code: "custom",
            path: ["lines", index, "orderItemId"],
            message: "Ista stavka porudžbine ne može biti dodata dva puta.",
          });
        }
        seenOrderItems.add(line.orderItemId);
        return;
      }
      const normalized = line.sku.toLocaleUpperCase("sr-Latn-RS");
      if (seenManualSkus.has(normalized)) {
        context.addIssue({
          code: "custom",
          path: ["lines", index, "sku"],
          message: "Ručna šifra može da postoji samo u jednom redu.",
        });
      }
      seenManualSkus.add(normalized);
    });
  });

export type DispatchNoteInput = z.infer<typeof dispatchNoteInputSchema>;

export function calculateDispatchLineTotals(
  qty: number,
  unitPriceGross: number,
  vatRate = DISPATCH_NOTE_VAT_RATE,
) {
  return calculateSalesLineTotals(qty, unitPriceGross, vatRate);
}

export function calculateDispatchTotals(
  lines: Array<{ qty: number; unitPriceGross: number; vatRate?: number }>,
) {
  return lines.reduce(
    (sum, line) => {
      const totals = calculateDispatchLineTotals(
        line.qty,
        line.unitPriceGross,
        line.vatRate,
      );
      sum.net += totals.totalNet;
      sum.vat += totals.totalVat;
      sum.gross += totals.totalGross;
      return sum;
    },
    { net: 0, vat: 0, gross: 0 },
  );
}

export function isInternalDispatch(input: {
  issuerCustomerId: string;
  receiverCustomerId: string;
}) {
  return input.issuerCustomerId === input.receiverCustomerId;
}

type UblParty = {
  name: string;
  pib: string;
  registrationNumber: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
  phone?: string | null;
  email?: string | null;
};

export type DispatchNoteUblInput = {
  id: string;
  number: string;
  issueDate: Date;
  internal: boolean;
  notes?: string | null;
  shipmentMethod: number;
  actualDispatchAt: Date;
  plannedDeliveryAt: Date;
  sourceOrderNumbers: string[];
  issuer: UblParty;
  receiver: UblParty;
  sourceWarehouse: {
    code: string;
    name: string;
    address: string;
    city: string;
  };
  deliveryLocation?: {
    code: string;
    name: string;
    address: string;
    city: string;
    postalCode?: string;
    country?: string;
  } | null;
  carrier?: UblParty | null;
  licensePlate?: string | null;
  courier?: {
    firstName: string;
    lastName: string;
    idNumber: string;
  } | null;
  items: Array<{
    sku: string;
    name: string;
    description?: string | null;
    sourceOrderNumber?: string | null;
    qty: number;
    palletQty?: number | null;
    attribute1?: string | null;
    attribute2?: string | null;
    attribute3?: string | null;
    attribute4?: string | null;
    color1?: string | null;
    color2?: string | null;
  }>;
};

function xml(value: string | number | null | undefined) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function datePart(value: Date) {
  return value.toISOString().slice(0, 10);
}

function timePart(value: Date) {
  return `${value.toISOString().slice(11, 19)}+00:00`;
}

function partyBodyXml(party: UblParty) {
  const contact = [
    party.phone
      ? `<cbc:Telephone>${xml(party.phone)}</cbc:Telephone>`
      : "",
    party.email
      ? `<cbc:ElectronicMail>${xml(party.email)}</cbc:ElectronicMail>`
      : "",
  ].join("");
  return `
      <cbc:EndpointID schemeID="9948">${xml(party.pib)}</cbc:EndpointID>
      <cac:PartyName><cbc:Name>${xml(party.name)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${xml(party.address)}</cbc:StreetName>
        <cbc:CityName>${xml(party.city)}</cbc:CityName>
        <cbc:PostalZone>${xml(party.postalCode)}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>${xml(party.country || "RS")}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>RS${xml(party.pib)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity><cbc:RegistrationName>${xml(party.name)}</cbc:RegistrationName>${party.registrationNumber ? `<cbc:CompanyID>${xml(party.registrationNumber)}</cbc:CompanyID>` : ""}</cac:PartyLegalEntity>
      ${contact ? `<cac:Contact>${contact}</cac:Contact>` : ""}
  `;
}

function partyXml(
  tag: "DespatchSupplierParty" | "DeliveryCustomerParty",
  party: UblParty,
) {
  return `<cac:${tag}><cac:Party>${partyBodyXml(party)}</cac:Party></cac:${tag}>`;
}

function shipmentStageXml(input: DispatchNoteUblInput) {
  if (input.shipmentMethod <= 3 && input.carrier) {
    return `<cac:ShipmentStage>
      <cbc:ID>1</cbc:ID>
      <cac:CarrierParty>${partyBodyXml(input.carrier)}</cac:CarrierParty>
      ${
        input.licensePlate
          ? `<cac:TransportMeans><cac:RoadTransport><cbc:LicensePlateID>${xml(input.licensePlate)}</cbc:LicensePlateID></cac:RoadTransport></cac:TransportMeans>`
          : ""
      }
    </cac:ShipmentStage>`;
  }
  if (input.shipmentMethod >= 4 && input.courier) {
    return `<cac:ShipmentStage>
      <cbc:ID>1</cbc:ID>
      <cac:MasterPerson>
        <cbc:FirstName>${xml(input.courier.firstName)}</cbc:FirstName>
        <cbc:FamilyName>${xml(input.courier.lastName)}</cbc:FamilyName>
        <cac:IdentityDocumentReference><cbc:ID>${xml(input.courier.idNumber)}</cbc:ID><cbc:DocumentType>Lična karta</cbc:DocumentType></cac:IdentityDocumentReference>
      </cac:MasterPerson>
    </cac:ShipmentStage>`;
  }
  return "";
}

/**
 * Builds the UTF-8 UBL 2.1 DespatchAdvice accepted by the Serbian
 * eOtpremnica API. The element order follows the current Ministry of Finance
 * examples; prices intentionally do not belong to the government UBL payload.
 */
export function buildDispatchNoteUbl(input: DispatchNoteUblInput) {
  const delivery = input.deliveryLocation
    ? {
        address: input.deliveryLocation.address,
        city: input.deliveryLocation.city,
        postalCode: input.deliveryLocation.postalCode ?? "",
        country: input.deliveryLocation.country ?? "RS",
      }
    : input.receiver;
  const sourceOrderReference = Array.from(new Set(input.sourceOrderNumbers))
    .join(", ")
    .trim();
  if (sourceOrderReference.length > 500) {
    throw new Error(
      "Zajednička referenca porudžbina prelazi dozvoljenih 500 karaktera; podelite otpremnicu.",
    );
  }
  const orderReference = sourceOrderReference
    ? `<cac:OrderReference><cbc:ID>${xml(sourceOrderReference)}</cbc:ID></cac:OrderReference>`
    : "";
  const properties = (
    item: DispatchNoteUblInput["items"][number],
  ) =>
    [
      ["Atribut 1", item.attribute1],
      ["Atribut 2", item.attribute2],
      ["Atribut 3", item.attribute3],
      ["Atribut 4", item.attribute4],
      ["Boja 1", item.color1],
      ["Boja 2", item.color2],
      ["Komada na paleti", item.palletQty ? String(item.palletQty) : null],
    ]
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
      .map(
        ([name, value]) =>
          `<cac:AdditionalItemProperty><cbc:Name>${xml(name)}</cbc:Name><cbc:Value>${xml(value)}</cbc:Value></cac:AdditionalItemProperty>`,
      )
      .join("");
  const lines = input.items
    .map(
      (item, index) => `<cac:DespatchLine>
    <cbc:ID>${index + 1}</cbc:ID>
    <cbc:DeliveredQuantity unitCode="H87">${item.qty}</cbc:DeliveredQuantity>
    ${item.sourceOrderNumber ? "<cac:OrderLineReference><cbc:LineID>N/A</cbc:LineID></cac:OrderLineReference>" : ""}
    <cac:Item>
      ${item.description ? `<cbc:Description>${xml(item.description)}</cbc:Description>` : ""}
      <cbc:Name>${xml(item.name)}</cbc:Name>
      <cac:SellersItemIdentification><cbc:ID>${xml(item.sku)}</cbc:ID></cac:SellersItemIdentification>
      ${properties(item)}
    </cac:Item>
  </cac:DespatchLine>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<DespatchAdvice xmlns="urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2"
 xmlns:cec="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
 xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
 xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
 xmlns:sbt="http://mfin.gov.rs/srbdt/srbdtext">
  <cec:UBLExtensions>
    <cec:UBLExtension>
      <cec:ExtensionContent>
        <sbt:SrbDtExt>
          <sbt:ShipmentMethod><cbc:ShipmentMethodType>${input.shipmentMethod}</cbc:ShipmentMethodType></sbt:ShipmentMethod>
        </sbt:SrbDtExt>
      </cec:ExtensionContent>
    </cec:UBLExtension>
  </cec:UBLExtensions>
  <cbc:CustomizationID>urn:fdc:mfin.gov.rs:logistics:trns:despatch_advice:1:2025.12</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:logistics:bis:despatch_advice_only:1</cbc:ProfileID>
  <cbc:ID>${xml(input.number)}</cbc:ID>
  <cbc:IssueDate>${datePart(input.issueDate)}</cbc:IssueDate>
  <cbc:DespatchAdviceTypeCode>${input.internal ? "Int" : "Ext"}</cbc:DespatchAdviceTypeCode>
  ${input.notes ? `<cbc:Note>${xml(input.notes)}</cbc:Note>` : ""}
  ${orderReference}
  ${partyXml("DespatchSupplierParty", input.issuer)}
  ${partyXml("DeliveryCustomerParty", input.receiver)}
  <cac:Shipment>
    <cbc:ID>${xml(input.id)}</cbc:ID>
    ${shipmentStageXml(input)}
    <cac:Delivery>
      <cac:DeliveryAddress>
        <cbc:StreetName>${xml(delivery.address)}</cbc:StreetName>
        <cbc:CityName>${xml(delivery.city)}</cbc:CityName>
        ${delivery.postalCode ? `<cbc:PostalZone>${xml(delivery.postalCode)}</cbc:PostalZone>` : ""}
        <cac:Country><cbc:IdentificationCode>${xml(delivery.country || "RS")}</cbc:IdentificationCode></cac:Country>
      </cac:DeliveryAddress>
      <cac:EstimatedDeliveryPeriod>
        <cbc:EndDate>${datePart(input.plannedDeliveryAt)}</cbc:EndDate>
        <cbc:EndTime>${timePart(input.plannedDeliveryAt)}</cbc:EndTime>
      </cac:EstimatedDeliveryPeriod>
      <cac:Despatch>
        <cbc:ActualDespatchDate>${datePart(input.actualDispatchAt)}</cbc:ActualDespatchDate>
        <cbc:ActualDespatchTime>${timePart(input.actualDispatchAt)}</cbc:ActualDespatchTime>
        <cac:DespatchAddress>
          <cbc:ID>${xml(input.sourceWarehouse.code)}</cbc:ID>
          <cbc:StreetName>${xml(input.sourceWarehouse.address)}</cbc:StreetName>
          <cbc:CityName>${xml(input.sourceWarehouse.city)}</cbc:CityName>
          <cac:Country><cbc:IdentificationCode>RS</cbc:IdentificationCode></cac:Country>
        </cac:DespatchAddress>
      </cac:Despatch>
    </cac:Delivery>
  </cac:Shipment>
  ${lines}
</DespatchAdvice>`;
}
