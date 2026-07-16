import type { OrderStatus, PaymentMethod, ShipmentStatus } from "@prisma/client";

export interface XExpressLocationCode {
  code: string;
  name: string;
  postalCode?: string | null;
  municipality?: string | null;
  city?: string | null;
  settlement?: string | null;
  raw: unknown;
}

export interface XExpressMunicipality {
  id: number;
  name: string;
  postalCode?: string | null;
  priority?: number | null;
  raw: unknown;
}

export interface XExpressTown {
  id: number;
  name: string;
  displayName?: string | null;
  municipalityId?: number | null;
  postalCode?: string | null;
  priority?: number | null;
  cutOffPickupTime?: string | null;
  raw: unknown;
}

export interface XExpressStreet {
  id: number;
  streetId?: number | null;
  name: string;
  simpleName?: string | null;
  townId: number;
  official: boolean;
  deleted: boolean;
  raw: unknown;
}

export interface XExpressStatusCode {
  code: string;
  label: string;
  labelEn?: string | null;
  shipmentStatus: ShipmentStatus;
  orderStatus: OrderStatus | null;
  raw: unknown;
}

export interface XExpressRecipient {
  firstName: string;
  lastName: string;
  companyName?: string | null;
  phone: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  locationCode?: string | null;
}

export interface XExpressCreateOrderPayload {
  contractCode: string;
  shipmentCode: string;
  reference: string;
  externalOrderId: string;
  recipient: XExpressRecipient;
  payment: {
    method: PaymentMethod;
    type: "PREPAID" | "COD";
    codAmount: number;
    currency: "RSD";
  };
  parcels: {
    count: number;
    weightKg: number;
  };
  notes?: string | null;
}

export interface XExpressCreateOrderResponse {
  trackingNo: string;
  labelUrl?: string | null;
  providerOrderId?: string | null;
  providerShipmentId?: string | null;
  providerStatusCode?: string | null;
  raw: unknown;
}

export interface XExpressAddressCheckPayload {
  townId: number;
  streetId?: number | null;
  street: string;
  city: string;
  postalCode: string;
}

export interface XExpressAddressCheckResponse {
  valid: boolean;
  message?: string | null;
  raw: unknown;
}

export interface XExpressTrackingEvent {
  trackingNo: string;
  providerStatusCode: string;
  status: ShipmentStatus;
  message?: string | null;
  occurredAt?: Date;
  providerEventId?: string | null;
  raw: unknown;
}

export interface XExpressNotifyData {
  ContractId: string;
  NotifyId: string;
  OrderCode?: string | null;
  ReferenceId: string;
  ReferenceGuid?: string | null;
  Status: string;
  StatusTime: string;
}
