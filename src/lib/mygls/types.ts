import type { OrderStatus, ShipmentStatus } from "@prisma/client";

export interface MyGlsAddress {
  Name: string;
  Street: string;
  HouseNumber: string;
  HouseNumberInfo?: string | null;
  City: string;
  ZipCode: string;
  CountryIsoCode: string;
  ContactName?: string | null;
  ContactPhone?: string | null;
  ContactEmail?: string | null;
}

export interface MyGlsService {
  Code: string;
  Value?: string | number | null;
  PSDParameter?: { StringValue?: string; IntegerValue?: number };
  CS1Parameter?: { Value: string };
  FDSParameter?: { Value: string };
  FSSParameter?: { Value: string };
  SM2Parameter?: { Value: string };
}

export interface MyGlsParcelProperty {
  Content: string;
  PackageType: number;
  Height?: number;
  Length?: number;
  Width?: number;
  Weight?: number;
}

export interface MyGlsParcel {
  ClientNumber: number;
  ClientReference: string;
  Count: number;
  CODAmount?: number;
  CODReference?: string;
  CODCurrency?: "RSD";
  Content: string;
  PickupDate?: string;
  PickupAddress: MyGlsAddress;
  DeliveryAddress: MyGlsAddress;
  FinalDeliveryAddress?: MyGlsAddress;
  ServiceList?: MyGlsService[];
  SenderIdentityCardNumber: string;
  ParcelPropertyList?: MyGlsParcelProperty[];
}

export interface MyGlsErrorInfo {
  ErrorCode?: number;
  ErrorDescription?: string;
  ClientReferenceList?: string[];
  ParcelIdList?: number[];
}

export interface MyGlsPrintDataInfo {
  ClientReference?: string;
  ParcelId?: number;
  ParcelNumber?: number;
  ParcelNumberWithCheckdigit?: number;
  Sort?: string;
  Displaylanguage?: string;
  PIN?: string;
  [key: string]: unknown;
}

export interface MyGlsPrintLabelsResponse {
  Labels?: number[] | string | null;
  PrintLabelsErrorList?: MyGlsErrorInfo[];
  PrintDataInfoList?: MyGlsPrintDataInfo[];
  [key: string]: unknown;
}

export interface MyGlsPrepareLabelsResponse {
  PrepareLabelsErrorList?: MyGlsErrorInfo[];
  ParcelInfoList?: Array<{ ClientReference?: string; ParcelId?: number }>;
  [key: string]: unknown;
}

export interface MyGlsGetPrintedLabelsResponse {
  Labels?: number[] | string | null;
  GetPrintedLabelsErrorList?: MyGlsErrorInfo[];
  PrintDataInfoList?: MyGlsPrintDataInfo[];
  [key: string]: unknown;
}

export interface MyGlsDeleteLabelsResponse {
  DeleteLabelsErrorList?: MyGlsErrorInfo[];
  SuccessfullyDeletedList?: Array<{ ParcelId?: number; SubParcelIdList?: number[] }>;
  [key: string]: unknown;
}

export interface MyGlsModifyCODResponse {
  ModifyCODError?: MyGlsErrorInfo[];
  Successful?: boolean;
  [key: string]: unknown;
}

export interface MyGlsParcelStatus {
  StatusCode?: string;
  StatusDate?: string;
  StatusDescription?: string;
  StatusInfo?: string;
  [key: string]: unknown;
}

export interface MyGlsParcelStatusResponse {
  ClientReference?: string;
  DeliveryCountryCode?: string;
  DeliveryZipCode?: string;
  GetParcelStatusErrors?: MyGlsErrorInfo[];
  ParcelNumber?: number;
  ParcelStatusList?: MyGlsParcelStatus[];
  POD?: number[] | string | null;
  Weight?: number | null;
  [key: string]: unknown;
}

export interface MyGlsParcelListStatusesResponse {
  GetParcelListStatusesErrors?: MyGlsErrorInfo[];
  ParcelList?: Array<{
    ParcelNumber?: number;
    Weight?: number | null;
    ClientNumber?: number;
    ClientReference?: string;
    ParcelStatusList?: MyGlsParcelStatus[];
  }>;
  [key: string]: unknown;
}

export interface MyGlsStatusEvent {
  trackingNo: string;
  parcelNumber: number;
  providerStatusCode: string;
  status: ShipmentStatus;
  orderStatus: OrderStatus | null;
  message?: string | null;
  occurredAt?: Date;
  providerEventId?: string;
  raw: unknown;
}

export interface MyGlsDeliveryPoint {
  Id?: number;
  Address?: Partial<MyGlsAddress> & {
    ContactEmail?: string | null;
    ContactPhone?: string | null;
  };
  Latitude?: number;
  Longitude?: number;
  Matchcode?: string;
  LegacyId?: string;
  DeliveryPointType?: number;
  Dropoffpoint?: boolean;
  CardPaymentAllowed?: boolean;
  CodHandler?: boolean;
  [key: string]: unknown;
}

export interface MyGlsCachedMasterDataResponse {
  ErrorCode?: number;
  ErrorDescription?: string;
  IsChanged?: boolean;
  LastUpdateTime?: string;
  Data?: number[] | string | null;
  [key: string]: unknown;
}

export interface MyGlsLocation {
  Id?: number | string;
  Name?: string;
  ZipCode?: string;
  City?: string;
  Routing?: unknown;
  StreetList?: unknown[];
  [key: string]: unknown;
}
