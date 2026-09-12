import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import {
  createAdminReclamation,
  createGuestReclamation,
  createReclamation,
  getGuestOrderForReclamation,
  listOrdersForReclamation,
} from "@/lib/api/reclamations";
import { applyShipmentEvent } from "@/lib/courier/registry";
import {
  queueReclamationReplacement,
  removeReclamationReplacementFromPicking,
} from "@/lib/admin/pickup-batch.server";

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => null,
}));

const runId = `${Date.now()}-${process.pid}`;
const tag = `REK-IT-${runId}`;
const accessToken = `access-${runId}-0123456789`;

let userId = "";
let productId = "";
let orderId = "";
let orderItemId = "";
let warehouseId = "";

beforeAll(async () => {
  const user = await db.user.create({
    data: { email: `${tag.toLowerCase()}@example.invalid` },
  });
  userId = user.id;
  const warehouse = await db.warehouse.create({
    data: { code: `${tag}-DC`.slice(0, 40), name: `${tag} magacin` },
  });
  warehouseId = warehouse.id;
  const product = await db.product.create({
    data: {
      sku: `${tag}-SKU`,
      slug: `${tag}-sku`.toLowerCase(),
      name: `${tag} artikal`,
      description: "Izolovani artikal za reklamacioni integration test.",
      fullPrice: 1_000,
      isActive: false,
    },
  });
  productId = product.id;
  const order = await db.order.create({
    data: {
      number: `${tag}-ORDER`,
      userId,
      publicAccessTokenHash: createHash("sha256")
        .update(accessToken, "utf8")
        .digest("base64url"),
      status: "ISPORUCENO",
      channel: "WEB",
      subtotal: 3_000,
      total: 3_000,
      shippingMethod: "KURIR",
      paymentMethod: "POUZECE_GOTOVINA",
      shipFirstName: "QA",
      shipLastName: "Kupac",
      shipPhone: "+381641112223",
      shipStreet: "Bulevar oslobođenja 10",
      shipCity: "Novi Sad",
      shipPostalCode: "21000",
      termsAcceptedAt: new Date(),
      items: {
        create: {
          productId,
          sku: product.sku,
          name: product.name,
          qty: 3,
          unitPriceFull: 1_000,
          unitPriceSale: 1_000,
        },
      },
    },
    include: { items: true },
  });
  orderId = order.id;
  orderItemId = order.items[0]!.id;
});

afterAll(async () => {
  if (orderId) await db.reclamation.deleteMany({ where: { orderId } });
  if (orderId) await db.order.deleteMany({ where: { id: orderId } });
  if (productId) await db.product.deleteMany({ where: { id: productId } });
  if (warehouseId) await db.warehouse.deleteMany({ where: { id: warehouseId } });
  if (userId) await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

describe("quantity-aware reclamation fulfillment", () => {
  it("removes only the selected replacement, allows requeue, and protects courier work", async () => {
    await db.product.update({
      where: { id: productId },
      data: { unitPackWidthCm: 30, unitPackDepthCm: 20, unitPackHeightCm: 10, grossWeightKg: 2 },
    });
    const claim = await db.reclamation.create({
      data: {
        number: `${tag}-PICKING`, orderId, orderItemId, productId,
        sku: `${tag}-SKU`, quantity: 2, replacementQty: 2,
        customerFirst: "QA", customerLast: "Picking", description: "Picking removal regression",
        notifyVia: "EMAIL", decision: "PRIHVACENA", resolution: "ZAMENA_ARTIKLA",
        warehouseId, warehouseStatus: "READY",
      },
    });
    const queued = await queueReclamationReplacement(claim.id, userId);
    if (!queued.queued) throw new Error(queued.reason);
    const batchId = queued.batchId;
    let shipmentId: string | undefined;
    try {
      const otherLine = await db.pickupBatchLine.create({
        data: { batchId, orderId, orderItemId, lineGroupKey: `order:${orderId}:X_EXPRESS` },
      });
      const removed = await removeReclamationReplacementFromPicking(claim.id, userId);
      expect(removed).toMatchObject({ removedLineCount: 2, reclamationIds: [claim.id], lineGroupKey: `reclamation:${claim.id}` });
      expect(await db.pickupBatchLine.count({ where: { reclamationId: claim.id } })).toBe(0);
      expect(await db.pickupBatchLine.findUnique({ where: { id: otherLine.id } })).not.toBeNull();
      expect(await db.reclamationStatusEvent.count({
        where: { reclamationId: claim.id, note: `Zamena je uklonjena iz picking naloga ${removed.batchNumber}.` },
      })).toBe(1);
      await expect(removeReclamationReplacementFromPicking(claim.id, userId)).rejects.toThrow("više nije u picking");

      await db.reclamation.update({
        where: { id: claim.id },
        data: { resolution: "ZAMENA_DELA", replacementQty: 0, resolutionNote: "Naslon" },
      });
      expect((await queueReclamationReplacement(claim.id, userId)).queued).toBe(true);
      expect(await db.pickupBatchLine.findMany({ where: { reclamationId: claim.id } })).toMatchObject([{ quantity: 0 }]);

      await db.pickupBatch.update({ where: { id: batchId }, data: { labelsCreationStartedAt: new Date() } });
      await expect(removeReclamationReplacementFromPicking(claim.id, userId)).rejects.toThrow("zaključan");
      await db.pickupBatch.update({ where: { id: batchId }, data: { labelsCreationStartedAt: null, status: "BOOKED" } });
      await expect(removeReclamationReplacementFromPicking(claim.id, userId)).rejects.toThrow("Samo novi nalog");
      await db.pickupBatch.update({ where: { id: batchId }, data: { status: "DRAFT" } });
      const shipment = await db.shipment.create({
        data: { orderId, reclamationId: claim.id, purpose: "RECLAMATION_REPLACEMENT", service: "COURIER_SMALL", provider: "X_EXPRESS", status: "CREATED" },
      });
      shipmentId = shipment.id;
      await expect(removeReclamationReplacementFromPicking(claim.id, userId)).rejects.toThrow("Kurirski nalog za zamenu već postoji");
      expect(await db.pickupBatchLine.count({ where: { reclamationId: claim.id } })).toBe(1);
      await db.shipment.update({ where: { id: shipmentId }, data: { status: "FAILED" } });
      await expect(removeReclamationReplacementFromPicking(claim.id, userId)).resolves.toMatchObject({ removedLineCount: 1 });
    } finally {
      if (shipmentId) await db.shipment.delete({ where: { id: shipmentId } });
      await db.pickupBatch.delete({ where: { id: batchId } });
      await db.reclamation.delete({ where: { id: claim.id } });
    }
  });

  it("does not expose or accept customer and guest claims before delivery", async () => {
    const input = {
      orderNumberOrFiscal: `${tag}-ORDER`,
      sku: `${tag}-SKU`,
      quantity: 1,
      description: "Prerana reklamacija pre potvrđene isporuke.",
      photos: [],
    };
    await db.order.update({
      where: { id: orderId },
      data: { status: "U_ISPORUCI" },
    });
    try {
      await expect(createReclamation(input, userId)).resolves.toEqual({
        ok: false,
        reason: "ORDER_NOT_DELIVERED",
      });
      await expect(listOrdersForReclamation(userId)).resolves.toEqual([]);
    } finally {
      await db.order.update({
        where: { id: orderId },
        data: { status: "ISPORUCENO" },
      });
    }

    const guestToken = `${accessToken}-guest`;
    const guestOrder = await db.order.create({
      data: {
        number: `${tag}-GUEST`,
        guestEmail: `${tag.toLowerCase()}.guest@example.invalid`,
        publicAccessTokenHash: createHash("sha256")
          .update(guestToken, "utf8")
          .digest("base64url"),
        status: "U_ISPORUCI",
        channel: "WEB",
        subtotal: 1_000,
        total: 1_000,
        shippingMethod: "KURIR",
        paymentMethod: "POUZECE_GOTOVINA",
        shipFirstName: "Gost",
        shipLastName: "Kupac",
        shipPhone: "+381641112224",
        shipStreet: "Test 1",
        shipCity: "Novi Sad",
        shipPostalCode: "21000",
        termsAcceptedAt: new Date(),
        items: {
          create: {
            productId,
            sku: `${tag}-SKU`,
            name: `${tag} artikal`,
            qty: 1,
            unitPriceFull: 1_000,
            unitPriceSale: 1_000,
          },
        },
      },
    });
    const guestInput = {
      ...input,
      orderNumberOrFiscal: guestOrder.number,
    };
    try {
      await expect(
        getGuestOrderForReclamation(guestOrder.number, guestToken),
      ).resolves.toBeNull();
      await expect(
        createGuestReclamation(guestInput, guestToken),
      ).resolves.toEqual({ ok: false, reason: "ORDER_NOT_DELIVERED" });

      await db.order.update({
        where: { id: guestOrder.id },
        data: { status: "ISPORUCENO" },
      });
      await expect(
        getGuestOrderForReclamation(guestOrder.number, guestToken),
      ).resolves.toMatchObject({ number: guestOrder.number });
    } finally {
      await db.reclamation.deleteMany({ where: { orderId: guestOrder.id } });
      await db.order.delete({ where: { id: guestOrder.id } });
    }
  });

  it("allows an audited manual reclamation regardless of the order status", async () => {
    const manualOrder = await db.order.create({
      data: {
        number: `${tag}-MANUAL`,
        guestEmail: "manual-reclamation@example.invalid",
        status: "U_PRIPREMI",
        channel: "WEB",
        subtotal: 1_000,
        total: 1_000,
        shippingMethod: "KURIR",
        paymentMethod: "POUZECE_GOTOVINA",
        shipFirstName: "Ručni",
        shipLastName: "Kupac",
        shipPhone: "+381641112225",
        shipStreet: "Test 2",
        shipCity: "Novi Sad",
        shipPostalCode: "21000",
        termsAcceptedAt: new Date(),
        items: {
          create: {
            productId,
            sku: `${tag}-SKU`,
            name: `${tag} artikal`,
            qty: 1,
            unitPriceFull: 1_000,
            unitPriceSale: 1_000,
          },
        },
      },
    });

    const input = {
      orderNumberOrFiscal: manualOrder.number,
      sku: `${tag}-SKU`,
      quantity: 1,
      description: "Operater evidentira telefonsku prijavu kupca.",
      photos: [],
      type: "KVAR" as const,
      request: "ZAMENA" as const,
    };

    try {
      const created = await createAdminReclamation(input, "integration-admin");
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const saved = await db.reclamation.findUniqueOrThrow({
        where: { id: created.id },
        include: { events: true },
      });
      expect(saved).toMatchObject({
        userId: null,
        type: "KVAR",
        request: "ZAMENA",
        purchaseDate: expect.any(Date),
      });
      expect(saved.events).toEqual([
        expect.objectContaining({
          status: "PRIMLJENO",
          actorId: "integration-admin",
          note: "Reklamacija ručno uneta u administraciji",
        }),
      ]);
    } finally {
      await db.reclamation.deleteMany({ where: { orderId: manualOrder.id } });
      await db.order.delete({ where: { id: manualOrder.id } });
    }
  });

  it("serializes numbers while allowing repeated reports within each purchased quantity", async () => {
    const input = {
      orderNumberOrFiscal: `${tag}-ORDER`,
      sku: `${tag}-SKU`,
      quantity: 2,
      customerFirst: "QA",
      customerLast: "Kupac",
      customerPhone: "+381641112223",
      description: "Konkurentna reklamacija za dva komada.",
      notifyVia: "PHONE" as const,
      photos: [],
      accessToken,
    };

    const concurrent = await Promise.all([
      createReclamation(input, userId),
      createReclamation(input, userId),
    ]);
    expect(concurrent.every((result) => result.ok)).toBe(true);
    expect(new Set(concurrent.map((result) => result.ok && result.number)).size).toBe(2);

    const finalUnit = await createReclamation(
      { ...input, quantity: 1, description: "Poslednji raspoloživ komad." },
      userId,
    );
    expect(finalUnit.ok).toBe(true);
    await expect(
      createReclamation(
        { ...input, quantity: 4, description: "Preko kupljene količine." },
        userId,
      ),
    ).resolves.toEqual({ ok: false, reason: "QUANTITY_EXCEEDED" });

    const aggregate = await db.reclamation.aggregate({
      where: { orderItemId },
      _sum: { quantity: true },
      _count: true,
    });
    expect(aggregate).toMatchObject({ _sum: { quantity: 5 }, _count: 3 });
    const orders = await listOrdersForReclamation(userId);
    expect(orders[0].items[0]).toMatchObject({ purchasedQty: 3 });
    expect(orders[0].items[0].reclamations).toHaveLength(3);
  });

  it("does not close on a return, but closes idempotently on delivered replacement", async () => {
    const reclamation = await db.reclamation.findFirstOrThrow({
      where: { orderItemId },
      orderBy: { createdAt: "asc" },
    });
    await db.reclamation.update({
      where: { id: reclamation.id },
      data: {
        decision: "PRIHVACENA",
        resolution: "ZAMENA_ARTIKLA",
        warehouseId,
        warehouseStatus: "READY",
      },
    });
    const [returnShipment, replacementShipment] = await Promise.all([
      db.shipment.create({
        data: {
          orderId,
          reclamationId: reclamation.id,
          warehouseId,
          reclamationQty: reclamation.quantity,
          purpose: "RECLAMATION_RETURN",
          service: "COURIER_SMALL",
          trackingNo: `${tag}-RETURN`,
        },
      }),
      db.shipment.create({
        data: {
          orderId,
          reclamationId: reclamation.id,
          warehouseId,
          reclamationQty: reclamation.quantity,
          purpose: "RECLAMATION_REPLACEMENT",
          service: "COURIER_SMALL",
          trackingNo: `${tag}-REPLACEMENT`,
        },
      }),
    ]);

    await applyShipmentEvent("COURIER_SMALL", {
      trackingNo: returnShipment.trackingNo!,
      status: "DELIVERED",
      providerEventId: `${tag}-return-delivered`,
    });
    expect(
      await db.reclamation.findUnique({
        where: { id: reclamation.id },
        select: { status: true, resolvedAt: true },
      }),
    ).toEqual({ status: "PRIMLJENO", resolvedAt: null });

    const replacementEvent = {
      trackingNo: replacementShipment.trackingNo!,
      status: "DELIVERED" as const,
      providerEventId: `${tag}-replacement-delivered`,
    };
    await applyShipmentEvent("COURIER_SMALL", replacementEvent);
    await applyShipmentEvent("COURIER_SMALL", replacementEvent);

    const resolved = await db.reclamation.findUniqueOrThrow({
      where: { id: reclamation.id },
      include: { events: { where: { status: "RESENO" } } },
    });
    expect(resolved.status).toBe("RESENO");
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
    expect(resolved.warehouseStatus).toBe("HANDED_OVER");
    expect(resolved.events).toHaveLength(1);
  });
});
