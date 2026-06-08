import "server-only";

import { Prisma, type PaymentMethod } from "@prisma/client";
import { num } from "@/lib/api/_helpers";
import type { XExpressCreateOrderPayload, XExpressLocationCode } from "./types";

type OrderForPayload = {
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
  notes?: string | null;
  items: { qty: number }[];
};

export function isXExpressCashOnDelivery(method: PaymentMethod) {
  return method === "POUZECE_GOTOVINA" || method === "POUZECE_KARTICA";
}

export function buildXExpressCreateOrderPayload(args: {
  contractCode: string;
  trackingNo: string;
  order: OrderForPayload;
  location?: Pick<XExpressLocationCode, "code"> | null;
}): XExpressCreateOrderPayload {
  const cod = isXExpressCashOnDelivery(args.order.paymentMethod);
  return {
    contractCode: args.contractCode,
    shipmentCode: args.trackingNo,
    reference: args.order.number,
    externalOrderId: args.order.id,
    recipient: {
      firstName: args.order.shipFirstName,
      lastName: args.order.shipLastName,
      companyName: args.order.shipCompanyName,
      phone: args.order.shipPhone,
      street: args.order.shipStreet,
      city: args.order.shipCity,
      postalCode: args.order.shipPostalCode,
      country: args.order.shipCountry,
      locationCode: args.location?.code ?? null,
    },
    payment: {
      method: args.order.paymentMethod,
      type: cod ? "COD" : "PREPAID",
      codAmount: cod ? num(args.order.total) : 0,
      currency: "RSD",
    },
    parcels: {
      count: Math.max(
        1,
        args.order.items.reduce((sum, item) => sum + item.qty, 0),
      ),
      weightKg: 5,
    },
    notes: args.order.notes ?? null,
  };
}
