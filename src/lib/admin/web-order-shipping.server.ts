import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { createShipmentForOrder } from "@/lib/courier";
import { readShipmentAssignment } from "@/lib/courier/shipment-assignment";
import {
  deleteMyGlsLabelsForShipment,
  MYGLS_PROVIDER,
} from "@/lib/mygls";
import { issueBuyerReceiptForOrder } from "@/lib/receipts";
import { X_EXPRESS_PROVIDER } from "@/lib/x-express/config";
import {
  normalizeWebOrderShippingAddress,
  normalizeWebOrderShippingPhone,
  planWebOrderShippingEdit,
  shippingEditPickupBatchBlockReason,
  type WebOrderShippingAddressInput,
} from "./web-order-shipping";

const EDITABLE_ORDER_STATUSES = [
  "KREIRANO",
  "POTVRDJENO",
  "U_PRIPREMI",
  "SPREMNO_ZA_ISPORUKU",
] as const;

type ShippingEditMode = "ADDRESS" | "PHONE";

type ReplacementRecipe = {
  shipmentId: string;
  provider: typeof MYGLS_PROVIDER | typeof X_EXPRESS_PROVIDER;
  trackingNo: string | null;
  orderItemIds: string[];
  codAmount: number | undefined;
  supplierFulfillmentId: string | undefined;
  announceXExpress: boolean;
};

export type UpdateWebOrderShippingContactInput = {
  orderId: string;
  actorId: string;
  expectedUpdatedAt: string;
  mode: ShippingEditMode;
  address?: {
    street: unknown;
    city: unknown;
    postalCode: unknown;
  };
  phone?: unknown;
  replaceWaybills: boolean;
  confirmXExpressCancellation: boolean;
  clearDeliveryPoint: boolean;
};

export type UpdateWebOrderShippingContactResult = {
  orderId: string;
  orderNumber: string;
  mode: ShippingEditMode;
  previous: Record<string, string | null>;
  next: Record<string, string | null>;
  replacedWaybills: number;
  replacementErrors: string[];
  receiptRefreshed: boolean;
  receiptError: string | null;
};

export async function updateWebOrderShippingContact(
  input: UpdateWebOrderShippingContactInput,
): Promise<UpdateWebOrderShippingContactResult> {
  if (!input.orderId) throw new Error("Nedostaje porudžbina.");
  const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
  if (Number.isNaN(expectedUpdatedAt.getTime())) {
    throw new Error("Stranica je zastarela. Osvežite je i pokušajte ponovo.");
  }

  const normalizedAddress =
    input.mode === "ADDRESS"
      ? normalizeWebOrderShippingAddress(
          input.address ?? { street: "", city: "", postalCode: "" },
        )
      : null;
  const normalizedPhone =
    input.mode === "PHONE"
      ? normalizeWebOrderShippingPhone(input.phone)
      : null;

  const order = await db.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      number: true,
      channel: true,
      status: true,
      updatedAt: true,
      cancelledAt: true,
      stockRestoredAt: true,
      shipStreet: true,
      shipCity: true,
      shipPostalCode: true,
      shipPhone: true,
      shipXExpressTownId: true,
      shipXExpressStreetId: true,
      glsDeliveryPointId: true,
      invoices: {
        where: { kind: "PROFORMA" },
        select: { id: true },
        take: 1,
      },
      shipments: {
        where: { purpose: "ORDER_DELIVERY", status: { not: "FAILED" } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          purpose: true,
          status: true,
          provider: true,
          providerShipmentId: true,
          trackingNo: true,
          rawCreateResponse: true,
        },
      },
      pickupBatchLines: {
        where: {
          purpose: "ORDER_DELIVERY",
          batch: { status: { not: "CANCELLED" } },
        },
        select: {
          batch: {
            select: {
              number: true,
              status: true,
              externalBookedAt: true,
            },
          },
        },
      },
    },
  });
  if (!order) throw new Error("Porudžbina ne postoji.");
  if (order.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
    throw new Error(
      "Porudžbina je u međuvremenu promenjena. Osvežite stranicu i pokušajte ponovo.",
    );
  }
  if (order.channel !== "WEB") {
    throw new Error("Ova akcija je dostupna samo za WEB porudžbine.");
  }
  if (
    !EDITABLE_ORDER_STATUSES.includes(
      order.status as (typeof EDITABLE_ORDER_STATUSES)[number],
    ) ||
    order.cancelledAt ||
    order.stockRestoredAt
  ) {
    throw new Error(
      "Adresa i telefon mogu da se menjaju samo pre nego što pošiljka krene ka kupcu.",
    );
  }
  const pickupBatchBlockReason = shippingEditPickupBatchBlockReason(
    order.pickupBatchLines.map((line) => line.batch),
  );
  if (pickupBatchBlockReason) throw new Error(pickupBatchBlockReason);

  const waybillPlan = planWebOrderShippingEdit(order.shipments);
  if (waybillPlan.kind === "BLOCKED") throw new Error(waybillPlan.reason);
  if (waybillPlan.kind === "REPLACE_WAYBILLS" && !input.replaceWaybills) {
    throw new Error(
      "Potvrdite da staru adresnicu treba poništiti i napraviti novu.",
    );
  }
  if (
    waybillPlan.kind === "REPLACE_WAYBILLS" &&
    waybillPlan.manuallyCancelledXExpressShipments.length > 0 &&
    !input.confirmXExpressCancellation
  ) {
    throw new Error(
      "Potvrdite da je stara X Express adresnica ručno poništena kod kurira.",
    );
  }

  const addressChanged = Boolean(
    normalizedAddress &&
      (normalizedAddress.street !== order.shipStreet ||
        normalizedAddress.city !== order.shipCity ||
        normalizedAddress.postalCode !== order.shipPostalCode),
  );
  const phoneChanged = Boolean(
    normalizedPhone && normalizedPhone !== normalizeStoredPhone(order.shipPhone),
  );
  if (!addressChanged && !phoneChanged) {
    throw new Error("Novi podaci su isti kao postojeći; nema izmene za čuvanje.");
  }
  if (
    input.mode === "ADDRESS" &&
    order.glsDeliveryPointId &&
    !input.clearDeliveryPoint
  ) {
    throw new Error(
      "Potvrdite da se postojeće GLS mesto preuzimanja uklanja i da isporuka ide na novu adresu.",
    );
  }

  const activeXExpress = order.shipments.some(
    (shipment) => shipment.provider === X_EXPRESS_PROVIDER,
  );
  const xExpressAddress = normalizedAddress
    ? await resolveXExpressAddressIds({
        address: normalizedAddress,
        previous: {
          street: order.shipStreet,
          city: order.shipCity,
          postalCode: order.shipPostalCode,
          townId: order.shipXExpressTownId,
          streetId: order.shipXExpressStreetId,
        },
        required: activeXExpress,
      })
    : null;

  const recipes = waybillPlan.activeShipments.map((shipment) => {
    const assignment = readShipmentAssignment(shipment.rawCreateResponse);
    return {
      shipmentId: shipment.id,
      provider: shipment.provider as ReplacementRecipe["provider"],
      trackingNo: shipment.trackingNo,
      orderItemIds: assignment?.orderItemIds ?? [],
      codAmount: assignment?.codAmount,
      supplierFulfillmentId: assignment?.supplierFulfillmentId,
      announceXExpress:
        shipment.provider === X_EXPRESS_PROVIDER &&
        Boolean(shipment.providerShipmentId),
    } satisfies ReplacementRecipe;
  });

  if (waybillPlan.kind === "REPLACE_WAYBILLS") {
    await retireWaybillsForReplacement(recipes);
  }

  let previous: Record<string, string | null>;
  let next: Record<string, string | null>;
  if (input.mode === "ADDRESS") {
    previous = {
      street: order.shipStreet,
      city: order.shipCity,
      postalCode: order.shipPostalCode,
      glsDeliveryPointId: order.glsDeliveryPointId,
    };
    next = {
      street: normalizedAddress!.street,
      city: normalizedAddress!.city,
      postalCode: normalizedAddress!.postalCode,
      glsDeliveryPointId: null,
    };
  } else {
    previous = { phone: order.shipPhone };
    next = { phone: normalizedPhone! };
  }

  await db.$transaction(async (tx) => {
    const updated = await tx.order.updateMany({
      where: { id: order.id, updatedAt: order.updatedAt },
      data:
        input.mode === "ADDRESS"
          ? {
              shipStreet: normalizedAddress!.street,
              shipCity: normalizedAddress!.city,
              shipPostalCode: normalizedAddress!.postalCode,
              shipXExpressTownId: xExpressAddress?.townId ?? null,
              shipXExpressStreetId: xExpressAddress?.streetId ?? null,
              ...(order.glsDeliveryPointId
                ? {
                    glsDeliveryPointId: null,
                    glsDeliveryPointName: null,
                    glsDeliveryPointAddress: null,
                    glsDeliveryPointCity: null,
                    glsDeliveryPointPostalCode: null,
                  }
                : {}),
            }
          : { shipPhone: normalizedPhone! },
    });
    if (updated.count !== 1) {
      throw new Error(
        "Porudžbina je u međuvremenu promenjena. Proverite adresnice i osvežite stranicu.",
      );
    }
    await tx.orderStatusEvent.create({
      data: {
        orderId: order.id,
        status: order.status,
        actorId: input.actorId,
        note:
          input.mode === "ADDRESS"
            ? "Adresa isporuke je izmenjena u adminu."
            : "Broj telefona za isporuku je izmenjen u adminu.",
      },
    });
  });

  const replacementErrors: string[] = [];
  let replacedWaybills = 0;
  for (const recipe of recipes) {
    try {
      await createShipmentForOrder(order.id, {
        orderItemIds: recipe.orderItemIds,
        provider: recipe.provider,
        codAmount: recipe.codAmount,
        supplierFulfillmentId: recipe.supplierFulfillmentId,
        announceXExpress: recipe.announceXExpress,
      });
      replacedWaybills += 1;
    } catch (error) {
      replacementErrors.push(
        `${providerLabel(recipe.provider)}${
          recipe.trackingNo ? ` ${recipe.trackingNo}` : ""
        }: ${error instanceof Error ? error.message : "nova adresnica nije kreirana"}`,
      );
    }
  }

  let receiptRefreshed = false;
  let receiptError: string | null = null;
  if (order.invoices.length) {
    try {
      const receipt = await issueBuyerReceiptForOrder(order.id, {
        sendEmail: false,
        invalidateExistingPdfOnUploadFailure: true,
      });
      receiptRefreshed = receipt.ok;
      receiptError = receipt.ok ? null : receipt.error;
      if (receipt.ok) {
        await db.invoice.update({
          where: { id: receipt.invoiceId },
          data: { status: "ISSUED", emailedAt: null, emailError: null },
        });
      }
    } catch (error) {
      receiptError =
        error instanceof Error ? error.message : "Predračun nije osvežen.";
    }
  }

  return {
    orderId: order.id,
    orderNumber: order.number,
    mode: input.mode,
    previous,
    next,
    replacedWaybills,
    replacementErrors,
    receiptRefreshed,
    receiptError,
  };
}

async function resolveXExpressAddressIds(args: {
  address: WebOrderShippingAddressInput;
  previous: {
    street: string;
    city: string;
    postalCode: string;
    townId: number | null;
    streetId: number | null;
  };
  required: boolean;
}) {
  const sameTown =
    args.address.city === args.previous.city &&
    args.address.postalCode === args.previous.postalCode;
  if (sameTown && args.previous.townId) {
    return {
      townId: args.previous.townId,
      streetId:
        args.address.street === args.previous.street
          ? args.previous.streetId
          : null,
    };
  }

  const towns = await db.xExpressTown.findMany({
    where: {
      active: true,
      postalCode: args.address.postalCode,
      OR: [
        { name: { equals: args.address.city, mode: "insensitive" } },
        { displayName: { equals: args.address.city, mode: "insensitive" } },
      ],
    },
    select: { id: true },
    take: 2,
  });
  if (towns.length !== 1) {
    if (args.required) {
      throw new Error(
        "Izaberite grad i poštanski broj koji tačno odgovaraju X Express šifarniku.",
      );
    }
    return { townId: null, streetId: null };
  }
  return { townId: towns[0]!.id, streetId: null };
}

async function retireWaybillsForReplacement(recipes: ReplacementRecipe[]) {
  // Provider cancellations can fail independently. Do external MyGLS
  // cancellations before retiring local/manual X Express rows so a MyGLS
  // configuration or API failure cannot unnecessarily invalidate X labels.
  const orderedRecipes = [...recipes].sort((left, right) =>
    left.provider === right.provider
      ? 0
      : left.provider === MYGLS_PROVIDER
        ? -1
        : 1,
  );
  for (const recipe of orderedRecipes) {
    if (recipe.provider === MYGLS_PROVIDER) {
      await deleteMyGlsLabelsForShipment(recipe.shipmentId);
      continue;
    }

    const retired = await db.shipment.updateMany({
      where: {
        id: recipe.shipmentId,
        provider: X_EXPRESS_PROVIDER,
        status: "CREATED",
      },
      data: {
        status: "FAILED",
        providerOrderId: null,
        providerShipmentId: null,
        trackingNo: null,
        providerParcelNumbers: [] as Prisma.InputJsonValue,
        providerStatusCode: "ADDRESS_REPLACED",
        syncError: "Adresnica poništena zbog izmene podataka isporuke.",
      },
    });
    if (retired.count !== 1) {
      throw new Error(
        "X Express adresnica je u međuvremenu promenjena. Osvežite stranicu pre ponovnog pokušaja.",
      );
    }
    await db.shipmentEvent.create({
      data: {
        shipmentId: recipe.shipmentId,
        status: "FAILED",
        providerStatusCode: "ADDRESS_REPLACED",
        message: `Stara X Express adresnica${
          recipe.trackingNo ? ` ${recipe.trackingNo}` : ""
        } poništena zbog izmene podataka isporuke`,
      },
    });
  }
}

function normalizeStoredPhone(value: string) {
  try {
    return normalizeWebOrderShippingPhone(value);
  } catch {
    return value.replace(/\D/g, "");
  }
}

function providerLabel(provider: string) {
  return provider === MYGLS_PROVIDER ? "MyGLS" : "X Express";
}
