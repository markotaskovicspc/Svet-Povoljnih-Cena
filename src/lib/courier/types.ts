import type { ShipmentService, ShipmentStatus } from "@prisma/client";

/**
 * Phase 4C — Couriers.
 *
 * Two services are integrated:
 *
 *   COURIER_SMALL  — parcel courier for boxable items (≤ 30 kg, ≤ 1.2 m).
 *                    Real provider in v1: BEX Express (REST + HMAC).
 *   COURIER_BULKY  — kamionska isporuka for furniture (krevet, ormar, …).
 *                    Real provider in v1: in-house dispatch + sub-contractor
 *                    accessed via a small REST shim.
 *
 * Both expose the same `CourierAdapter` shape so the rest of the app only
 * talks to `routeService(order)` + `getAdapter(service)` and never branches
 * on the concrete provider.
 */

/** Minimum order projection an adapter needs to create a waybill. */
export interface CourierOrderInput {
  /** Human-friendly order number, used as the customer reference. */
  orderNumber: string;
  /** RSD total (for COD calculation). */
  total: number;
  /** Whether payment is on delivery (pouzeće → COD amount = total). */
  cashOnDelivery: boolean;
  recipient: {
    firstName: string;
    lastName: string;
    phone: string;
    street: string;
    city: string;
    postalCode: string;
    country: string;
    companyName?: string | null;
  };
  /** Notes printed on the waybill / shown to the driver. */
  notes?: string | null;
  /** Number of parcels (small) or pallets/items (bulky). Defaults to 1. */
  packageCount?: number;
  /** Total weight in kg (best-effort estimate). */
  weightKg?: number;
}

export interface CourierShipmentResult {
  /** Provider tracking / waybill number. */
  trackingNo: string;
  /** Absolute URL to the printable label PDF. */
  labelUrl: string;
  /** Optional raw provider response for debugging. */
  raw?: unknown;
}

export interface CourierWebhookEvent {
  /** Tracking number used to look up the shipment. */
  trackingNo: string;
  /** Mapped status. */
  status: ShipmentStatus;
  /** Free-form provider message ("Pošiljka preuzeta", "Adresant odsutan", …). */
  message?: string;
  /** Event timestamp from the provider, falls back to "now" if missing. */
  occurredAt?: Date;
  /** Raw provider payload, persisted for audit. */
  raw?: unknown;
}

export interface CourierAdapter {
  service: ShipmentService;
  /** Display name shown in admin / on labels. */
  label: string;
  /**
   * Create a waybill at the provider.
   * Implementations must be idempotent on `orderNumber` — a retry must
   * return the existing waybill instead of opening a new one.
   */
  createWaybill(input: CourierOrderInput): Promise<CourierShipmentResult>;
  /**
   * Verify a webhook signature (HMAC, shared secret, …).
   * Throw `CourierConfigError` when the integration is not configured so
   * callers can return 503 instead of 401.
   */
  verifyWebhookSignature(req: {
    headers: Headers;
    rawBody: string;
  }): boolean;
  /** Parse a verified webhook body into a normalized event. */
  parseWebhookEvent(rawBody: string): CourierWebhookEvent;
}

export class CourierConfigError extends Error {}
export class CourierProviderError extends Error {
  constructor(
    message: string,
    public readonly providerCode?: string,
  ) {
    super(message);
  }
}
