import "server-only";

import { gunzipSync } from "node:zlib";
import {
  buildMyGlsUrl,
  myGlsAuthBase,
  redactMyGlsSecrets,
  requireMyGlsEnabled,
  type MyGlsConfig,
  MyGlsProviderError,
} from "./config";
import type {
  MyGlsCachedMasterDataResponse,
  MyGlsDeleteLabelsResponse,
  MyGlsGetPrintedLabelsResponse,
  MyGlsModifyCODResponse,
  MyGlsParcel,
  MyGlsParcelListStatusesResponse,
  MyGlsParcelStatusResponse,
  MyGlsPrepareLabelsResponse,
  MyGlsPrintLabelsResponse,
} from "./types";

export class MyGlsClient {
  constructor(
    private readonly cfg: MyGlsConfig = requireMyGlsEnabled(),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  printLabels(args: {
    parcelList: MyGlsParcel[];
    printPosition?: number;
    showPrintDialog?: boolean;
    typeOfPrinter?: string;
    hidePhoneNumberOnLabels?: boolean;
  }) {
    return this.parcel<MyGlsPrintLabelsResponse>("PrintLabels", {
      ParcelList: args.parcelList,
      PrintPosition: args.printPosition ?? 1,
      ShowPrintDialog: args.showPrintDialog ?? false,
      TypeOfPrinter: args.typeOfPrinter ?? this.cfg.typeOfPrinter,
      HidePhoneNumberOnLabels: args.hidePhoneNumberOnLabels ?? false,
    });
  }

  prepareLabelsV2(parcelList: MyGlsParcel[]) {
    return this.parcel<MyGlsPrepareLabelsResponse>("PrepareLabelsV2", { ParcelList: parcelList });
  }

  getPrintedLabels(parcelIdList: number[]) {
    return this.parcel<MyGlsGetPrintedLabelsResponse>("GetPrintedLabels", {
      ParcelIdList: parcelIdList,
      PrintPosition: 1,
      ShowPrintDialog: false,
      TypeOfPrinter: this.cfg.typeOfPrinter,
    });
  }

  deleteLabels(parcelIdList: number[]) {
    return this.parcel<MyGlsDeleteLabelsResponse>("DeleteLabels", { ParcelIdList: parcelIdList });
  }

  modifyCOD(args: { parcelId?: number; parcelNumber?: number; codAmount: number }) {
    return this.parcel<MyGlsModifyCODResponse>("ModifyCOD", {
      ParcelId: args.parcelId ?? null,
      ParcelNumber: args.parcelNumber ?? null,
      CODAmount: args.codAmount,
    });
  }

  getParcelList(args: {
    pickupDateFrom?: string | Date | null;
    pickupDateTo?: string | Date | null;
    printDateFrom?: string | Date | null;
    printDateTo?: string | Date | null;
  }) {
    return this.parcel("GetParcelList", {
      PickupDateFrom: serializeDate(args.pickupDateFrom),
      PickupDateTo: serializeDate(args.pickupDateTo),
      PrintDateFrom: serializeDate(args.printDateFrom),
      PrintDateTo: serializeDate(args.printDateTo),
    });
  }

  getParcelStatuses(args: {
    parcelNumber: number;
    returnPOD?: boolean;
    languageIsoCode?: string;
  }) {
    return this.parcel<MyGlsParcelStatusResponse>("GetParcelStatuses", {
      ParcelNumber: args.parcelNumber,
      ReturnPOD: args.returnPOD ?? false,
      LanguageIsoCode: args.languageIsoCode ?? "EN",
    });
  }

  getParcelListStatuses(args: {
    parcelNumberList: number[];
    returnPOD?: boolean;
    languageIsoCode?: string;
  }) {
    return this.parcel<MyGlsParcelListStatusesResponse>("GetParcelListStatuses", {
      ParcelNumberList: args.parcelNumberList,
      ReturnPOD: args.returnPOD ?? false,
      LanguageIsoCode: args.languageIsoCode ?? "EN",
    });
  }

  getDeliveryPoints(lastUpdateTime?: string | Date | null) {
    return this.master<MyGlsCachedMasterDataResponse>("GetDeliveryPoints", {
      CountryIsoCode: "RS",
      LastUpdateTime: serializeDate(lastUpdateTime),
    });
  }

  getLocations(lastUpdateTime?: string | Date | null) {
    return this.master<MyGlsCachedMasterDataResponse>("GetLocations", {
      CountryIsoCode: "RS",
      LastUpdateTime: serializeDate(lastUpdateTime),
    });
  }

  private parcel<T>(method: string, body: Record<string, unknown>) {
    return this.request<T>("ParcelService", method, body);
  }

  private master<T>(method: string, body: Record<string, unknown>) {
    return this.request<T>("MasterDataService", method, body);
  }

  private async request<T>(
    serviceName: "ParcelService" | "MasterDataService",
    methodName: string,
    body: Record<string, unknown>,
    attempt = 0,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const requestBody = { ...myGlsAuthBase(this.cfg), ...body };
    const url = buildMyGlsUrl(this.cfg, serviceName, methodName);

    try {
      const res = await this.fetchImpl(url, {
        method: "POST",
        cache: "no-store",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const rawText = await res.text();
      const json = rawText ? safeJson(rawText) : {};
      if (!res.ok) {
        if (res.status >= 500 && attempt < 2) {
          await delay(350 * (attempt + 1));
          return this.request(serviceName, methodName, body, attempt + 1);
        }
        throw new MyGlsProviderError(
          readErrorMessage(json) ?? `MyGLS zahtev nije uspeo (HTTP ${res.status}).`,
          readErrorCode(json),
          redactMyGlsSecrets(json),
        );
      }
      throwOnErrors(json);
      return json as T;
    } catch (err) {
      if (err instanceof MyGlsProviderError) throw err;
      const message =
        err instanceof Error && err.name === "AbortError"
          ? "MyGLS zahtev je istekao."
          : err instanceof Error
            ? err.message
            : "MyGLS zahtev nije uspeo.";
      throw new MyGlsProviderError(message);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function bytesFromMyGls(value: unknown): Buffer {
  if (Array.isArray(value)) {
    return Buffer.from(value.map((n) => Number(n) & 255));
  }
  if (typeof value === "string" && value.trim()) {
    return Buffer.from(value, "base64");
  }
  return Buffer.alloc(0);
}

export function decompressMyGlsJson<T>(value: unknown): T[] {
  const bytes = bytesFromMyGls(value);
  if (!bytes.length) return [];
  const text = gunzipSync(bytes).toString("utf8");
  const parsed = JSON.parse(text) as unknown;
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serializeDate(value: string | Date | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function allErrorLists(value: unknown): unknown[] {
  if (!isRecord(value)) return [];
  return Object.entries(value)
    .filter(([key, list]) => /Error/i.test(key) && Array.isArray(list))
    .flatMap(([, list]) => list as unknown[]);
}

function readErrorMessage(value: unknown) {
  if (!isRecord(value)) return null;
  const error = allErrorLists(value)[0];
  if (isRecord(error)) {
    const desc = error.ErrorDescription ?? error.errorDescription ?? error.Message;
    if (typeof desc === "string" && desc.trim()) return desc.trim();
  }
  const desc = value.ErrorDescription ?? value.error ?? value.message;
  return typeof desc === "string" && desc.trim() ? desc.trim() : null;
}

function readErrorCode(value: unknown) {
  if (!isRecord(value)) return undefined;
  const error = allErrorLists(value)[0];
  if (isRecord(error)) {
    const code = error.ErrorCode ?? error.errorCode;
    return code == null ? undefined : String(code);
  }
  const code = value.ErrorCode ?? value.code;
  return code == null ? undefined : String(code);
}

function throwOnErrors(value: unknown) {
  if (!isRecord(value)) return;
  const directErrorCode = value.ErrorCode;
  if (typeof directErrorCode === "number" && directErrorCode !== 0) {
    throw new MyGlsProviderError(
      readErrorMessage(value) ?? "MyGLS odgovor sadrži grešku.",
      String(directErrorCode),
      redactMyGlsSecrets(value),
    );
  }
  const errors = allErrorLists(value).filter((error) => {
    if (!isRecord(error)) return true;
    const code = Number(error.ErrorCode ?? 0);
    return Number.isFinite(code) ? code !== 0 : true;
  });
  if (errors.length) {
    throw new MyGlsProviderError(
      readErrorMessage(value) ?? "MyGLS odgovor sadrži grešku.",
      readErrorCode(value),
      redactMyGlsSecrets(value),
    );
  }
}
