import { z } from "zod";
import { isValidHouseNumber, splitStreetAndHouseNumber } from "@/lib/address/house-number";

export const reclamationAddressSchema = z.object({
  shipFirstName: z.string().trim().min(1).max(100),
  shipLastName: z.string().trim().min(1).max(100),
  shipPhone: z.string().trim().min(6).max(40),
  shipStreet: z.string().trim().min(1).max(200),
  shipHouseNumber: z.string().trim().refine(isValidHouseNumber, "Unesite ispravan kućni broj ili bb."),
  shipCity: z.string().trim().min(1).max(100),
  shipPostalCode: z.string().trim().regex(/^\d{5}$/, "Unesite petocifreni poštanski broj."),
  shipXExpressTownId: z.number().int().positive().nullable(),
});
export type ReclamationAddress = z.infer<typeof reclamationAddressSchema>;

/** Apply only to a courier's in-memory order, preserving the original sale. */
export function withReclamationAddress<T>(order: T, address: unknown): T {
  if (address == null) return order;
  const parsed = reclamationAddressSchema.parse(address);
  return { ...order, ...parsed, shipCountry: "RS", shipCompanyName: null,
    shipXExpressStreetId: null, glsDeliveryPointId: null, glsDeliveryPointName: null,
    glsDeliveryPointAddress: null, glsDeliveryPointCity: null, glsDeliveryPointPostalCode: null };
}

export function reclamationAddressDefaults(order: {
  shipFirstName: string; shipLastName: string; shipPhone: string;
  shipStreet: string; shipHouseNumber: string | null; shipCity: string;
  shipPostalCode: string; shipXExpressTownId: number | null;
}, address: unknown): ReclamationAddress {
  const effective = withReclamationAddress(order, address);
  const split = splitStreetAndHouseNumber(effective.shipStreet, effective.shipHouseNumber);
  return { shipFirstName: effective.shipFirstName, shipLastName: effective.shipLastName,
    shipPhone: effective.shipPhone, shipStreet: split.street, shipHouseNumber: split.houseNumber ?? "",
    shipCity: effective.shipCity, shipPostalCode: effective.shipPostalCode,
    shipXExpressTownId: effective.shipXExpressTownId };
}
