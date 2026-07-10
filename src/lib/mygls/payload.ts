import "server-only";

import { Prisma, type PaymentMethod } from "@prisma/client";
import { num } from "@/lib/api/_helpers";
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
}): MyGlsParcel {
  const { cfg, order } = args;
  if (!cfg.clientNumber) {
    throw new MyGlsConfigError("MyGLS client number nije podešen.");
  }

  const recipientName = `${order.shipFirstName} ${order.shipLastName}`.trim();
  const contactEmail = order.user?.email ?? order.guestEmail ?? null;
  const content = buildContent(order, cfg.defaultContent);
  const cod = isMyGlsCashOnDelivery(order.paymentMethod);
  const services: MyGlsService[] = [
    { Code: "CS1", CS1Parameter: { Value: normalizePhone(order.shipPhone) } },
  ];

  if (contactEmail) {
    services.push({ Code: "FDS", FDSParameter: { Value: contactEmail } });
  }

  if (order.glsDeliveryPointId) {
    services.push({
      Code: "PSD",
      PSDParameter: { StringValue: order.glsDeliveryPointId },
    });
  }

  const parcel: MyGlsParcel = {
    ClientNumber: cfg.clientNumber,
    ClientReference: order.number,
    Count: packageCount(order.items),
    Content: content,
    CODAmount: cod ? num(order.total) : 0,
    CODReference: cod ? order.number : undefined,
    CODCurrency: cod ? "RSD" : undefined,
    PickupDate: toMyGlsDate(args.pickupDate ?? nextBusinessDay()),
    PickupAddress: addressFromPickup(cfg),
    DeliveryAddress: addressFromOrder(order, recipientName, contactEmail),
    ServiceList: services,
    SenderIdentityCardNumber: cfg.senderIdentityCardNumber,
    ParcelPropertyList: [
      {
        Content: content,
        PackageType: 2,
        Weight: Math.max(1, packageCount(order.items) * 3),
        // Production PrintLabels rejects parcels without dimensions
        // (ErrorCode 13 "Invalid data in 'Height'/'Width'/'Length'",
        // verified live 2026-07-10). Default box in cm.
        Height: 30,
        Width: 40,
        Length: 50,
      },
    ],
  };

  if (order.glsDeliveryPointId) {
    parcel.FinalDeliveryAddress = parcel.DeliveryAddress;
  }

  return parcel;
}

function addressFromPickup(cfg: MyGlsConfig): MyGlsAddress {
  const street = splitStreet(cfg.pickup.street, "MyGLS pickup adresa");
  return {
    Name: cfg.pickup.name,
    Street: street.street,
    HouseNumber: street.houseNumber,
    HouseNumberInfo: street.houseNumberInfo,
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

function packageCount(items: { qty: number }[]) {
  return Math.max(1, Math.min(99, items.reduce((sum, item) => sum + item.qty, 0)));
}

function buildContent(order: OrderForMyGlsPayload, fallback: string) {
  const itemNames = order.items.map((item) => item.name).filter(Boolean).slice(0, 3);
  return (itemNames.join(", ") || fallback).slice(0, 120);
}

function nextBusinessDay() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const day = date.getDay();
  if (day === 0) date.setDate(date.getDate() + 1);
  if (day === 6) date.setDate(date.getDate() + 2);
  return date;
}
