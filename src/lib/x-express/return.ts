import { XExpressConfigError } from "./config";

// Provider contract: https://www.x-express.rs/devportal/addshipment.php
// Coordinates are required at PICKUP; never reuse the merchant's coordinates
// for a customer's collection address. Saved shipment payloads retain them.
export type XExpressPickupCoordinates = { latitude: number; longitude: number };

export type XExpressReturnDestination = {
  name: string;
  townId: number;
  city: string;
  postalCode: string;
  streetName: string;
  streetNumber: string;
  contactName: string;
  phone: string;
  email?: string | null;
};

export function requireReturnPickupCoordinates(
  value: XExpressPickupCoordinates | undefined,
): XExpressPickupCoordinates {
  if (!value || !Number.isFinite(value.latitude) || !Number.isFinite(value.longitude) ||
      Math.abs(value.latitude) > 90 || Math.abs(value.longitude) > 180 ||
      value.latitude === 0 || value.longitude === 0) {
    throw new XExpressConfigError(
      "Za X Express unesite tačnu lokaciju preuzimanja kod kupca u polje „Lokacija kupca“ (npr. 44.812345, 20.461234).",
    );
  }
  return value;
}

export function parseReturnPickupCoordinates(value: string) {
  if (!value.trim()) return undefined;
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  return requireReturnPickupCoordinates(match ? {
    latitude: Number(match[1]), longitude: Number(match[2]),
  } : undefined);
}
