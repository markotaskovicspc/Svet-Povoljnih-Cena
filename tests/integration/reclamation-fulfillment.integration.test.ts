import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import {
  createAdminReclamation,
  createReclamation,
  listOrdersForReclamation,
} from "@/lib/api/reclamations";
import { applyShipmentEvent } from "@/lib/courier/registry";

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
  it("offers and accepts reclamations only after delivery", async () => {
    const cancelled = await db.order.create({
      data: {
        number: `${tag}-CANCELLED`,
        userId,
        status: "OTKAZANO",
        channel: "WEB",
        subtotal: 1_000,
        total: 1_000,
        shippingMethod: "KURIR",
        paymentMethod: "POUZECE_GOTOVINA",
        shipFirstName: "QA",
        shipLastName: "Otkazano",
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

    try {
      const offered = await listOrdersForReclamation(userId);
      expect(offered.map((order) => order.number)).toContain(`${tag}-ORDER`);
      expect(offered.map((order) => order.number)).not.toContain(cancelled.number);
      await expect(
        createReclamation(
          {
            orderNumberOrFiscal: cancelled.number,
            sku: `${tag}-SKU`,
            quantity: 1,
            description: "Otkazana porudžbina ne sme u reklamacije.",
            photos: [],
          },
          userId,
        ),
      ).resolves.toEqual({ ok: false, reason: "ORDER_NOT_DELIVERED" });
    } finally {
      await db.order.delete({ where: { id: cancelled.id } });
    }
  });

  it("lets OPS record a guest reclamation with an audit-bearing status event", async () => {
    const manualOrder = await db.order.create({
      data: {
        number: `${tag}-MANUAL`,
        guestEmail: "manual-reclamation@example.invalid",
        status: "ISPORUCENO",
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

    try {
      const created = await createAdminReclamation(
        {
          orderNumberOrFiscal: manualOrder.number,
          sku: `${tag}-SKU`,
          quantity: 1,
          description: "Operater evidentira telefonsku prijavu kupca.",
          photos: [],
          type: "KVAR",
          request: "ZAMENA",
        },
        "integration-admin",
      );
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

  it("serializes concurrent quantities and never exceeds the purchased amount", async () => {
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
    expect(concurrent.filter((result) => result.ok)).toHaveLength(1);
    expect(concurrent.filter((result) => !result.ok)).toEqual([
      { ok: false, reason: "QUANTITY_EXCEEDED" },
    ]);

    const finalUnit = await createReclamation(
      { ...input, quantity: 1, description: "Poslednji raspoloživ komad." },
      userId,
    );
    expect(finalUnit.ok).toBe(true);
    await expect(
      createReclamation(
        { ...input, quantity: 1, description: "Preko kupljene količine." },
        userId,
      ),
    ).resolves.toEqual({ ok: false, reason: "QUANTITY_EXCEEDED" });

    const aggregate = await db.reclamation.aggregate({
      where: { orderItemId },
      _sum: { quantity: true },
      _count: true,
    });
    expect(aggregate).toMatchObject({ _sum: { quantity: 3 }, _count: 2 });
    expect(await listOrdersForReclamation(userId)).toEqual([]);
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
