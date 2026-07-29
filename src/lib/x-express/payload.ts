import "server-only";

import {
  Prisma,
  type PaymentMethod,
  type ShipmentPurpose,
} from "@prisma/client";
import { num } from "@/lib/api/_helpers";
import type { XExpressConfig } from "./config";
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

export function isXExpressCashOnDelivery(method: PaymentMethod) {
  return method === "POUZECE_GOTOVINA" || method === "POUZECE_KARTICA";
}

export function splitXExpressStreet(value: string) {
  const normalized = providerText(value, 61);
  const match = normalized.match(/^(.*?)[,\s]+(\d[\p{L}\d\s/.-]*)$/u);
  if (!match) return { streetName: normalized.slice(0, 50), streetNumber: "bb" };
  return {
    streetName: providerText(match[1], 50),
    streetNumber: providerText(match[2], 10),
  };
}

export function normalizeXExpressPhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00381")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `381${digits.slice(1)}`;
  if (!digits.startsWith("381") || digits.length < 10 || digits.length > 15) {
    throw new Error("Telefon za X Express mora biti validan broj u formatu 381...");
  }
  return digits;
}

export function buildXExpressAddressCheckPayload(args: {
  recipientName: string;
  townId: number;
  street: string;
  officialStreetName?: string | null;
}): XExpressAddressCheckPayload {
  const split = splitXExpressStreet(args.street);
  return {
    Name: providerText(args.recipientName, 50),
    TownId: args.townId,
    StreetName: providerText(args.officialStreetName || split.streetName, 50),
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
}): XExpressCreateOrderPayload {
  const { cfg, order } = args;
  const purpose = args.purpose ?? "ORDER_DELIVERY";
  const reverse = purpose === "RECLAMATION_RETURN";
  const cod =
    purpose === "ORDER_DELIVERY" && isXExpressCashOnDelivery(order.paymentMethod);
  const recipientName = providerText(
    order.shipCompanyName || `${order.shipFirstName} ${order.shipLastName}`,
    50,
  );
  const recipientPhone = normalizeXExpressPhone(order.shipPhone);
  const senderPhone = normalizeXExpressPhone(cfg.pickup.contactPhone);
  const pickupAddress: XExpressAddress = {
    Name: providerText(cfg.pickup.name, 50),
    TownId: cfg.pickup.townId!,
    StreetName: providerText(cfg.pickup.streetName, 50),
    StreetNumber: providerText(cfg.pickup.streetNumber, 10),
    Latitude: cfg.pickup.latitude!,
    Longitude: cfg.pickup.longitude!,
    Description: providerText(cfg.pickup.description || "Preuzimanje robe", 50),
  };
  const deliveryStreet = splitXExpressStreet(order.shipStreet);
  const deliveryAddress: XExpressAddress = {
    Name: recipientName,
    TownId: args.townId,
    StreetName: providerText(
      args.officialStreetName || deliveryStreet.streetName,
      50,
    ),
    StreetNumber: deliveryStreet.streetNumber,
    Description: providerText(order.notes || "Isporuka webshop porudžbine", 50),
  };
  const content = providerText(
    order.items.map((item) => item.name).filter(Boolean).join(", ") ||
      cfg.defaultContent,
    50,
  );
  const masses = distributePackageMasses(order.items, args.trackingCodes.length);
  const returnAddress: XExpressAddress = {
    Name: pickupAddress.Name,
    TownId: pickupAddress.TownId,
    StreetName: pickupAddress.StreetName,
    StreetNumber: pickupAddress.StreetNumber,
    Description: providerText("Povrat pošiljke", 50),
  };

  return {
    ContractCode: cfg.contractCode,
    Reference: providerText(args.reference, 36),
    Sender: reverse
      ? {
          Name: recipientName,
          Phone: recipientPhone,
          ...((order.user?.email || order.guestEmail)
            ? { Email: providerText(order.user?.email || order.guestEmail || "", 100) }
            : {}),
        }
      : {
          Name: providerText(cfg.pickup.name, 50),
          Phone: senderPhone,
          ...(cfg.pickup.contactEmail
            ? { Email: providerText(cfg.pickup.contactEmail, 100) }
            : {}),
        },
    Recipient: reverse
      ? {
          Name: providerText(cfg.pickup.name, 50),
          Phone: senderPhone,
          ...(cfg.pickup.contactEmail
            ? { Email: providerText(cfg.pickup.contactEmail, 100) }
            : {}),
        }
      : {
          Name: recipientName,
          Phone: recipientPhone,
          ...((order.user?.email || order.guestEmail)
            ? { Email: providerText(order.user?.email || order.guestEmail || "", 100) }
            : {}),
        },
    ServicePayerId: cfg.servicePayerId,
    TypeId: cfg.serviceTypeId,
    Content: content,
    Waypoints: [
      {
        Address: reverse ? deliveryAddress : pickupAddress,
        Contact: reverse
          ? { Name: recipientName, Phone: recipientPhone }
          : {
              Name: providerText(cfg.pickup.contactName, 50),
              Phone: senderPhone,
            },
        WaypointType: "PICKUP",
      },
      {
        Address: reverse ? pickupAddress : deliveryAddress,
        Contact: reverse
          ? {
              Name: providerText(cfg.pickup.contactName, 50),
              Phone: senderPhone,
            }
          : { Name: recipientName, Phone: recipientPhone },
        WaypointType: "DELIVERY",
      },
      {
        Address: reverse ? deliveryAddress : { ...returnAddress },
        Contact: reverse
          ? { Name: recipientName, Phone: recipientPhone }
          : {
              Name: providerText(cfg.pickup.contactName, 50),
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
                Name: providerText(cfg.cod.name, 50),
                Amount: round(num(order.total), 2),
                Account: providerText(cfg.cod.account, 20),
                Address: providerText(cfg.cod.address, 100),
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

function providerText(value: string, max: number) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function round(value: number, decimals: number) {
  const scale = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}
