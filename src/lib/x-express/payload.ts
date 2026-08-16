import "server-only";

import {
  Prisma,
  type PaymentMethod,
  type ShipmentPurpose,
} from "@prisma/client";
import { num } from "@/lib/api/_helpers";
import { XExpressConfigError, type XExpressConfig } from "./config";
import type {
  XExpressAddress,
  XExpressAddressCheckPayload,
  XExpressCreateOrderPayload,
} from "./types";

type OrderForPayload = {
  total: Prisma.Decimal | number | bigint;
  paymentMethod: PaymentMethod;
  shipFirstName: string;
  shipLastName: string;
  shipPhone: string;
  shipStreet: string;
  shipCompanyName?: string | null;
  notes?: string | null;
  guestEmail?: string | null;
  user?: { email?: string | null } | null;
  items: Array<{
    name: string;
    qty: number;
    product?: {
      packQty?: number | null;
      packGrossWeightKg?: Prisma.Decimal | number | null;
      grossWeightKg?: Prisma.Decimal | number | null;
      weightKg?: Prisma.Decimal | number | null;
    } | null;
  }>;
};

const X_EXPRESS_PHONE = /^(381[1-9][0-9]{7,8}|38167[0-9]{6,8})$/;
const X_EXPRESS_EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const X_EXPRESS_STREET_NUMBER =
  /^((bb|BB|b\.b\.|B\.B\.)(\/[-a-zžćčđšA-ZĐŠĆŽČ_0-9]+)*|(\d(-\d){0,1}[a-zžćčđšA-ZĐŠĆŽČ_0-9]{0,2})+(\/[-a-zžćčđšA-ZĐŠĆŽČ_0-9]+)*)$/;

export function isXExpressCashOnDelivery(method: PaymentMethod) {
  return method === "POUZECE_GOTOVINA" || method === "POUZECE_KARTICA";
}

export function splitXExpressStreet(value: string) {
  const normalized = cleanWhitespace(value);
  const match = normalized.match(
    /^(.*?)[,\s]+((?:bb|BB|b\.b\.|B\.B\.|\d)[\p{L}\d\s/.-]*)$/u,
  );
  if (!match) {
    return {
      streetName: providerName(normalized, 50, "Nepoznata ulica"),
      streetNumber: "bb",
    };
  }
  return {
    streetName: providerName(match[1], 50, "Nepoznata ulica"),
    streetNumber: normalizeXExpressStreetNumber(match[2]),
  };
}

export function normalizeXExpressPhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00381")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `381${digits.slice(1)}`;
  if (!X_EXPRESS_PHONE.test(digits)) {
    throw new XExpressConfigError(
      "Telefon za X Express mora biti validan broj u formatu 381...",
    );
  }
  return digits;
}

export function normalizeXExpressStreetNumber(value: string) {
  const normalized = cleanWhitespace(value).replace(/\s+/g, "").slice(0, 10);
  if (!X_EXPRESS_STREET_NUMBER.test(normalized)) {
    throw new XExpressConfigError(
      `Kućni broj „${normalized || value}” nije validan za X Express.`,
    );
  }
  return normalized;
}

export function buildXExpressAddressCheckPayload(args: {
  recipientName: string;
  townId: number;
  street: string;
  officialStreetName?: string | null;
}): XExpressAddressCheckPayload {
  const split = splitXExpressStreet(args.street);
  return {
    Name: providerName(args.recipientName, 50, "Kupac"),
    TownId: args.townId,
    StreetName: providerName(
      args.officialStreetName || split.streetName,
      50,
      "Nepoznata ulica",
    ),
    StreetNumber: split.streetNumber,
    Description: null,
  };
}

export function buildXExpressCreateOrderPayload(args: {
  cfg: XExpressConfig;
  reference: string;
  trackingCodes: string[];
  order: OrderForPayload;
  townId: number;
  officialStreetName?: string | null;
  purpose?: ShipmentPurpose;
  collectCashOnDelivery?: boolean;
}): XExpressCreateOrderPayload {
  const { cfg, order } = args;
  const purpose = args.purpose ?? "ORDER_DELIVERY";
  if (purpose === "RECLAMATION_RETURN") {
    throw new XExpressConfigError(
      "X Express povrat od kupca zahteva tačne pickup koordinate kupca. Koristite MyGLS ili ručni nalog dok koordinate nisu evidentirane.",
    );
  }
  const cod =
    purpose === "ORDER_DELIVERY" &&
    args.collectCashOnDelivery !== false &&
    isXExpressCashOnDelivery(order.paymentMethod);
  const codAccount = cod ? normalizeXExpressAccount(cfg.cod.account) : undefined;
  const recipientName = providerName(
    order.shipCompanyName || `${order.shipFirstName} ${order.shipLastName}`,
    50,
    "Kupac",
  );
  const recipientPhone = normalizeXExpressPhone(order.shipPhone);
  const senderPhone = normalizeXExpressPhone(cfg.pickup.contactPhone);
  const senderName = providerName(cfg.pickup.name, 50, "Pošiljalac");
  const senderContactName = providerName(
    cfg.pickup.contactName,
    50,
    senderName,
  );
  const senderEmail = optionalProviderEmail(cfg.pickup.contactEmail);
  const recipientEmail = optionalProviderEmail(
    order.user?.email || order.guestEmail || "",
  );
  const pickupAddress: XExpressAddress = {
    Name: senderName,
    TownId: cfg.pickup.townId!,
    StreetName: providerName(cfg.pickup.streetName, 50, "Nepoznata ulica"),
    StreetNumber: normalizeXExpressStreetNumber(cfg.pickup.streetNumber),
    Latitude: cfg.pickup.latitude!,
    Longitude: cfg.pickup.longitude!,
    Description: providerDescription(
      cfg.pickup.description || "Preuzimanje robe",
      50,
      "Preuzimanje robe",
    ),
  };
  const deliveryStreet = splitXExpressStreet(order.shipStreet);
  const deliveryAddress: XExpressAddress = {
    Name: recipientName,
    TownId: args.townId,
    StreetName: providerName(
      args.officialStreetName || deliveryStreet.streetName,
      50,
      "Nepoznata ulica",
    ),
    StreetNumber: deliveryStreet.streetNumber,
    Description: providerDescription(
      order.notes || "Isporuka webshop porudžbine",
      50,
      "Isporuka webshop porudžbine",
    ),
  };
  const content = providerContent(
    order.items.map((item) => item.name).filter(Boolean).join(", ") ||
      cfg.defaultContent,
    50,
    "Webshop porudžbina",
  );
  const masses = distributePackageMasses(order.items, args.trackingCodes.length);
  const returnAddress: XExpressAddress = {
    Name: pickupAddress.Name,
    TownId: pickupAddress.TownId,
    StreetName: pickupAddress.StreetName,
    StreetNumber: pickupAddress.StreetNumber,
    Description: providerDescription("Povrat pošiljke", 50, "Povrat pošiljke"),
  };

  return {
    ContractCode: cfg.contractCode,
    Reference: providerReference(args.reference),
    Sender: {
      Name: senderName,
      Phone: senderPhone,
      ...(senderEmail ? { Email: senderEmail } : {}),
    },
    Recipient: {
      Name: recipientName,
      Phone: recipientPhone,
      ...(recipientEmail ? { Email: recipientEmail } : {}),
    },
    ServicePayerId: cfg.servicePayerId,
    TypeId: cfg.serviceTypeId,
    Content: content,
    Waypoints: [
      {
        Address: pickupAddress,
        Contact: {
          Name: senderContactName,
          Phone: senderPhone,
        },
        WaypointType: "PICKUP",
      },
      {
        Address: deliveryAddress,
        Contact: { Name: recipientName, Phone: recipientPhone },
        WaypointType: "DELIVERY",
      },
      {
        Address: { ...returnAddress },
        Contact: {
          Name: senderContactName,
          Phone: senderPhone,
        },
        WaypointType: "RETURN",
      },
    ],
    ...(cod
      ? {
          Options: [
            {
              OptionTypeId: 2 as const,
              Data: {
                Name: providerName(cfg.cod.name, 50, senderName),
                Amount: round(num(order.total), 2),
                Account: codAccount!,
                Address: providerName(cfg.cod.address, 50, pickupAddress.StreetName),
              },
            },
          ],
        }
      : {}),
    Packages: args.trackingCodes.map((code, index) => ({
      Code: code,
      Mass: masses[index]!,
      Content: content,
    })),
  };
}

function distributePackageMasses(
  items: OrderForPayload["items"],
  packageCount: number,
) {
  const count = Math.max(1, packageCount);
  const measuredTotal = items.reduce((sum, item) => {
    const packWeight = positive(item.product?.packGrossWeightKg);
    const grossWeight = positive(item.product?.grossWeightKg);
    const netWeight = positive(item.product?.weightKg);
    if (packWeight) {
      const packQty = Math.max(1, item.product?.packQty ?? 1);
      return sum + Math.ceil(item.qty / packQty) * packWeight;
    }
    return sum + item.qty * (grossWeight || netWeight || 0);
  }, 0);
  const total = measuredTotal > 0 ? measuredTotal : count;
  const base = round(total / count, 3);
  const masses = Array.from({ length: count }, () => Math.max(0.1, base));
  const current = masses.reduce((sum, mass) => sum + mass, 0);
  masses[count - 1] = Math.max(0.1, round(masses[count - 1]! + total - current, 3));
  return masses;
}

function positive(value: Prisma.Decimal | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function providerName(value: string, max: number, fallback: string) {
  const cleaned = cleanWhitespace(value)
    .replace(/&/g, " i ")
    .replace(/[^\-a-zžćčđšA-ZĐŠĆŽČ_0-9.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
  if (cleaned) return cleaned;
  const safeFallback = cleanWhitespace(fallback)
    .replace(/[^\-a-zžćčđšA-ZĐŠĆŽČ_0-9.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
  if (safeFallback) return safeFallback;
  throw new XExpressConfigError("Obavezno tekstualno polje za X Express je prazno.");
}

function providerContent(value: string, max: number, fallback: string) {
  return sanitizeProviderContent(value, max) ||
    sanitizeProviderContent(fallback, max) ||
    "Roba";
}

function sanitizeProviderContent(value: string, max: number) {
  return cleanWhitespace(value)
    .replace(/&/g, " i ")
    .replace(/\+/g, " plus ")
    .replace(/[.]/g, " ")
    .replace(/[^\-,()\/a-zžćčđšA-ZĐŠĆŽČ_0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

function providerDescription(value: string, max: number, fallback: string) {
  return sanitizeProviderDescription(value, max) ||
    sanitizeProviderDescription(fallback, max) ||
    "Lokacija";
}

function sanitizeProviderDescription(value: string, max: number) {
  return cleanWhitespace(value)
    .replace(/&/g, " i ")
    .replace(/\+/g, " plus ")
    .replace(/[^\-a-zžćčđšA-ZĐŠĆŽČ():\/\\,._0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

function normalizeXExpressAccount(value: string) {
  const account = cleanWhitespace(value);
  if (!/^\d{3}-\d{13}-\d{2}$/.test(account)) {
    throw new XExpressConfigError(
      "X Express COD račun mora biti u formatu 3-13-2 cifre.",
    );
  }
  const checksum = account
    .replace(/\D/g, "")
    .split("")
    .reduce((remainder, digit) => (remainder * 10 + Number(digit)) % 97, 0);
  if (checksum !== 1) {
    throw new XExpressConfigError(
      "X Express COD račun nema ispravan MOD97 kontrolni broj.",
    );
  }
  return account;
}

function providerReference(value: string) {
  const cleaned = cleanWhitespace(value)
    .replace(/[^\-#$a-zžćčđšA-ZĐŠĆŽČ_0-9,:;+()\/.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 36)
    .trim();
  if (!cleaned) {
    throw new XExpressConfigError("X Express Reference ne sme biti prazan.");
  }
  return cleaned;
}

function optionalProviderEmail(value: string) {
  const email = cleanWhitespace(value);
  if (!email || email.length > 50 || !X_EXPRESS_EMAIL.test(email)) {
    return undefined;
  }
  return email;
}

function cleanWhitespace(value: string) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function round(value: number, decimals: number) {
  const scale = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}
