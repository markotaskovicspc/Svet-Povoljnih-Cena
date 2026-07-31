import "server-only";

import {
  Prisma,
  type PaymentMethod,
  type ShipmentPurpose,
} from "@prisma/client";
import { num } from "@/lib/api/_helpers";
import {
  type PhysicalPackage,
  requireCompleteMyGlsPackages,
} from "@/lib/courier/packages";
import type { MyGlsConfig } from "./config";
import { MyGlsConfigError, toMyGlsDate } from "./config";
import type { MyGlsAddress, MyGlsParcel, MyGlsService } from "./types";

type OrderForMyGlsPayload = {
  id: string;
  number: string;
  total: Prisma.Decimal | number | bigint;
  paymentMethod: PaymentMethod;
  shipFirstName: string;
  shipLastName: string;
  shipPhone: string;
  shipStreet: string;
  shipCity: string;
  shipPostalCode: string;
  shipCountry: string;
  shipCompanyName?: string | null;
  guestEmail?: string | null;
  glsDeliveryPointId?: string | null;
  glsDeliveryPointName?: string | null;
  glsDeliveryPointAddress?: string | null;
  glsDeliveryPointCity?: string | null;
  glsDeliveryPointPostalCode?: string | null;
  notes?: string | null;
  user?: { email?: string | null } | null;
  items: { qty: number; name: string }[];
};

export function isMyGlsCashOnDelivery(method: PaymentMethod) {
  return method === "POUZECE_GOTOVINA" || method === "POUZECE_KARTICA";
}

export function buildMyGlsParcelForOrder(args: {
  cfg: MyGlsConfig;
  order: OrderForMyGlsPayload;
  pickupDate?: Date;
  packages: readonly PhysicalPackage[];
  purpose?: ShipmentPurpose;
}): MyGlsParcel {
  const { cfg, order } = args;
  const purpose = args.purpose ?? "ORDER_DELIVERY";
  if (!cfg.clientNumber) {
    throw new MyGlsConfigError("MyGLS client number nije podešen.");
  }

  const recipientName = `${order.shipFirstName} ${order.shipLastName}`.trim();
  const contactEmail = order.user?.email ?? order.guestEmail ?? null;
  const content = buildContent(order, cfg.defaultContent);
  const packages = completePackages(args.packages);
  const cod =
    purpose === "ORDER_DELIVERY" && isMyGlsCashOnDelivery(order.paymentMethod);
  if (order.paymentMethod === "POUZECE_KARTICA" && !cfg.codCardEnabled) {
    throw new MyGlsConfigError(
      "MyGLS kartično pouzeće nije ugovorno potvrđeno (MYGLS_COD_CARD_ENABLED=false).",
    );
  }
  const services: MyGlsService[] = [];

  if (cfg.contactServiceEnabled) {
    services.push({
      Code: "CS1",
      CS1Parameter: { Value: normalizePhone(order.shipPhone) },
    });
  }

  if (contactEmail && cfg.flexDeliveryServiceEnabled) {
    services.push({ Code: "FDS", FDSParameter: { Value: contactEmail } });
  }

  if (order.glsDeliveryPointId) {
    services.push({
      Code: "PSD",
      PSDParameter: { StringValue: order.glsDeliveryPointId },
    });
  }

  const merchantAddress = addressFromPickup(cfg);
  const customerAddress = addressFromOrder(order, recipientName, contactEmail);
  const reverse = purpose === "RECLAMATION_RETURN";
  const reference =
    purpose === "ORDER_DELIVERY"
      ? order.number
      : `${order.number}-${purpose === "RECLAMATION_RETURN" ? "POVRAT" : "ZAMENA"}`;

  const parcel: MyGlsParcel = {
    ClientNumber: cfg.clientNumber,
    ClientReference: reference.slice(0, 40),
    Count: packages.length,
    Content: content,
    CODAmount: cod ? num(order.total) : 0,
    CODReference: cod ? order.number : undefined,
    CODCurrency: cod ? "RSD" : undefined,
    PickupDate: toMyGlsDate(args.pickupDate ?? nextBusinessDay()),
    PickupAddress: reverse ? customerAddress : merchantAddress,
    DeliveryAddress: reverse ? merchantAddress : customerAddress,
    ServiceList: services.length ? services : undefined,
    SenderIdentityCardNumber: cfg.senderIdentityCardNumber,
    ParcelPropertyList: packages.map((pkg) => ({
      Content: (pkg.content?.trim() || content).slice(0, 120),
      PackageType: 2,
      Weight: pkg.weightKg,
      Height: pkg.heightCm,
      Width: pkg.widthCm,
      Length: pkg.depthCm,
    })),
  };

  if (order.glsDeliveryPointId && !reverse) {
    parcel.FinalDeliveryAddress = parcel.DeliveryAddress;
  }

  return parcel;
}

function addressFromPickup(cfg: MyGlsConfig): MyGlsAddress {
  return {
    Name: cfg.pickup.name,
    Street: cfg.pickup.street,
    HouseNumber: cfg.pickup.houseNumber,
    HouseNumberInfo: cfg.pickup.houseNumberInfo || null,
    City: cfg.pickup.city,
    ZipCode: cfg.pickup.postalCode,
    CountryIsoCode: cfg.pickup.country,
    ContactName: cfg.pickup.contactName,
    ContactPhone: normalizePhone(cfg.pickup.contactPhone),
    ContactEmail: cfg.pickup.contactEmail,
  };
}

function addressFromOrder(
  order: OrderForMyGlsPayload,
  recipientName: string,
  contactEmail: string | null,
): MyGlsAddress {
  const sourceStreet = order.glsDeliveryPointAddress ?? order.shipStreet;
  const street = splitStreet(sourceStreet, "Adresa isporuke");
  return {
    Name: order.shipCompanyName ?? recipientName,
    Street: street.street,
    HouseNumber: street.houseNumber,
    HouseNumberInfo: street.houseNumberInfo,
    City: order.glsDeliveryPointCity ?? order.shipCity,
    ZipCode: order.glsDeliveryPointPostalCode ?? order.shipPostalCode,
    CountryIsoCode: order.shipCountry || "RS",
    ContactName: recipientName,
    ContactPhone: normalizePhone(order.shipPhone),
    ContactEmail: contactEmail,
  };
}

function splitStreet(value: string, label: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  const match = normalized.match(/^(.*?)[,\s]+(\d+[a-zA-Z\/\-]*)\s*(.*)$/);
  if (!match?.[1] || !match[2]) {
    throw new MyGlsConfigError(
      `${label} mora sadržati ulicu i kućni broj za MyGLS nalog.`,
    );
  }
  return {
    street: match[1].trim().replace(/,$/, ""),
    houseNumber: match[2].trim(),
    houseNumberInfo: match[3]?.trim() || null,
  };
}

function normalizePhone(value: string) {
  const digits = value.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith("0")) return `+381${digits.slice(1)}`;
  return digits;
}

function buildContent(order: OrderForMyGlsPayload, fallback: string) {
  const itemNames = order.items.map((item) => item.name).filter(Boolean).slice(0, 3);
  return (itemNames.join(", ") || fallback).slice(0, 120);
}

function completePackages(packages: readonly PhysicalPackage[]) {
  try {
    return requireCompleteMyGlsPackages(packages);
  } catch (error) {
    throw new MyGlsConfigError(
      error instanceof Error ? error.message : "MyGLS paketi nisu ispravni.",
    );
  }
}

function nextBusinessDay() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const day = date.getDay();
  if (day === 0) date.setDate(date.getDate() + 1);
  if (day === 6) date.setDate(date.getDate() + 2);
  return date;
}
