import type { OrderStatus, ShipmentStatus } from "@prisma/client";

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

/** Exact PascalCase contract used by POST /api/order/add. */
export interface XExpressParty {
  Name: string;
  Phone: string;
  Email?: string;
}

export interface XExpressAddress {
  Name: string;
  TownId: number;
  StreetName: string;
  StreetNumber: string;
  Latitude?: number;
  Longitude?: number;
  Description: string;
}

export interface XExpressContact {
  Name: string;
  Phone: string;
}

export interface XExpressWaypoint {
  Address: XExpressAddress;
  Contact: XExpressContact;
  WaypointType: "PICKUP" | "DELIVERY" | "RETURN";
}

export interface XExpressCashOnDeliveryOption {
  OptionTypeId: 2;
  Data: {
    Name: string;
    Amount: number;
    Account: string;
    Address: string;
  };
}

export interface XExpressPackage {
  Code: string;
  Mass: number;
  Content: string;
}

export interface XExpressCreateOrderPayload {
  ContractCode: string;
  Reference: string;
  Sender: XExpressParty;
  Recipient: XExpressParty;
  ServicePayerId: number;
  TypeId: number;
  Content: string;
  Waypoints: XExpressWaypoint[];
  Options?: XExpressCashOnDeliveryOption[];
  Packages: XExpressPackage[];
}

export interface XExpressCreateOrderResponse {
  requestGuid: string;
  trackingNo: string;
  labelUrl: null;
  providerOrderId: null;
  providerShipmentId: string;
  providerStatusCode: null;
  raw: unknown;
}

/** Exact PascalCase contract used by POST /api/order/check-address. */
export interface XExpressAddressCheckPayload {
  Name: string;
  TownId: number;
  StreetName: string;
  StreetNumber: string;
  Description: string | null;
}

export interface XExpressAddressCheckResponse {
  valid: true;
  area: string;
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
