import { createHash, createHmac, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/order-access", () => ({
  createOrderAccessToken: () => randomBytes(32).toString("base64url"),
  createCheckoutOrderAccessToken: (checkoutSessionId: string) =>
    createHmac("sha256", "integration-test-secret")
      .update(checkoutSessionId)
      .digest("base64url"),
  hashOrderAccessToken: (token: string) =>
    createHash("sha256").update(token).digest("base64url"),
}));

import { db } from "@/lib/db";
import { createOrder, type CreateOrderInput } from "@/lib/api/checkout";
import {
  enqueueBackgroundJob,
  processBackgroundJob,
} from "@/lib/background-jobs";
import { restoreOrderReservations } from "@/lib/order-reservations";
import { effectiveSellableStock } from "@/lib/rabalux/allocation";
import {
  syncRabaluxCatalog,
  syncRabaluxStock,
} from "@/lib/rabalux/sync";
import { syncPendingRabaluxMedia } from "@/lib/rabalux/media";
import {
  consumeRabaluxSyncPreview,
  createRabaluxSyncPreview,
} from "@/lib/rabalux/admin-sync";

const PREFIX = "RAB-IT-";
let categoryId = "";
let groupId = "";
let supplierId = "";

beforeAll(async () => {
  process.env.EMAIL_PROVIDER = "none";
  process.env.RABALUX_ENABLED = "true";
  process.env.RABALUX_CATALOG_USER = "integration-user";
  process.env.RABALUX_CATALOG_PASS = "integration-pass";
  process.env.RABALUX_STOCK_USER = "integration-user";
  process.env.RABALUX_STOCK_PASS = "integration-pass";
  process.env.RABALUX_MIN_CATALOG_ROWS = "1";
  process.env.RABALUX_MIN_STOCK_ROWS = "1";
  await db.reclamation.deleteMany({
    where: { number: { startsWith: "R-IT-" } },
  });
  const oldProducts = await db.product.findMany({
    where: { sku: { startsWith: PREFIX } },
    select: { id: true },
  });
  const oldProductIds = oldProducts.map(({ id }) => id);
  await db.checkoutSession.deleteMany({
    where: { id: { startsWith: "rabalux-integration-" } },
  });
  if (oldProductIds.length) {
    const oldOrders = await db.order.findMany({
      where: { items: { some: { productId: { in: oldProductIds } } } },
      select: { id: true },
    });
    await db.order.deleteMany({
      where: { id: { in: oldOrders.map(({ id }) => id) } },
    });
    await db.stockMovement.deleteMany({
      where: { productId: { in: oldProductIds } },
    });
    await db.product.deleteMany({ where: { id: { in: oldProductIds } } });
  }
  await db.category.deleteMany({
    where: { path: "/rabalux-integration-test" },
  });
  await db.group.deleteMany({ where: { slug: "rabalux-integration-test" } });
  const supplier = await db.supplier.findUniqueOrThrow({
    where: { integrationKey: "RABALUX" },
  });
  supplierId = supplier.id;
  const category = await db.category.create({
    data: {
      name: "Rabalux integration test",
      slug: "rabalux-integration-test",
      path: "/rabalux-integration-test",
      level: 0,
    },
  });
  categoryId = category.id;
  const group = await db.group.create({
    data: {
      name: "Rabalux integration test",
      slug: "rabalux-integration-test",
    },
  });
  groupId = group.id;
});

afterAll(async () => {
  await db.reclamation.deleteMany({
    where: { number: { startsWith: "R-IT-" } },
  });
  const products = await db.product.findMany({
    where: { sku: { startsWith: PREFIX } },
    select: { id: true },
  });
  const productIds = products.map(({ id }) => id);
  await db.checkoutSession.deleteMany({
    where: { id: { startsWith: "rabalux-integration-" } },
  });
  if (productIds.length) {
    const orders = await db.order.findMany({
      where: { items: { some: { productId: { in: productIds } } } },
      select: { id: true },
    });
    await db.order.deleteMany({
      where: { id: { in: orders.map(({ id }) => id) } },
    });
    await db.stockMovement.deleteMany({
      where: { productId: { in: productIds } },
    });
    await db.product.deleteMany({ where: { id: { in: productIds } } });
  }
  await db.backgroundJob.deleteMany();
  await db.emailProviderEvent.deleteMany();
  await db.emailMessage.deleteMany();
  await db.category.deleteMany({
    where: {
      OR: [
        { path: "/rabalux-integration-test" },
        { path: { startsWith: "/rabalux-integration-feed" } },
      ],
    },
  });
  await db.group.deleteMany({
    where: {
      slug: { in: ["rabalux-integration-test", "rabalux-integration-feed-tip"] },
    },
  });
  await db.$disconnect();
});

async function createProduct(args: {
  suffix: string;
  warehouseStock: number;
  supplierStock: number;
}) {
  const sku = `${PREFIX}${args.suffix}`;
  return db.product.create({
    data: {
      sku,
      slug: sku.toLowerCase(),
      name: `Test ${args.suffix}`,
      description: "Lokalni integracioni test",
      groupId,
      fullPrice: 1_000,
      widthCm: 10,
      depthCm: 10,
      heightCm: 10,
      packWidthCm: 12,
      packDepthCm: 12,
      packHeightCm: 12,
      stock: args.warehouseStock,
      supplierStock: args.supplierStock,
      supplierReservedStock: 0,
      supplierId,
      supplierExternalId: `IT-${args.suffix}`,
      isActive: true,
      categories: { create: { categoryId } },
      media: {
        create: {
          kind: "IMAGE",
          url: `rabalux/IT-${args.suffix}/ready.jpg`,
          syncStatus: "READY",
        },
      },
    },
  });
}

function orderInput(
  lines: Array<{ sku: string; qty: number }>,
  checkoutSessionId: string,
): CreateOrderInput {
  return {
    checkoutSessionId,
    guestEmail: "integration@example.test",
    lines,
    shipping: {
      firstName: "Test",
      lastName: "Kupac",
      phone: "0601234567",
      street: "Test ulica 1",
      city: "Beograd",
      postalCode: "11000",
      country: "RS",
    },
    billingSameAsShipping: true,
    shippingMethod: "KAMION",
    paymentMethod: "POUZECE_GOTOVINA",
    consent: true,
  };
}

describe("Rabalux checkout integration", () => {
  it("repeats catalog sync without duplicates, preserves overrides and keeps stock reservations", async () => {
    let revision = 1;
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/id/332")) {
        const name = revision === 1 ? "Feed naziv" : "Promenjeni feed naziv";
        const price = revision === 1 ? "1000" : "2500";
        return new Response(
          `<?xml version="1.0"?><Products><Product>
            <Sku>IT-SYNC</Sku><Name>${name}</Name><Ean11>5999999999999</Ean11>
            <Product_category>Rabalux integration feed</Product_category>
            <Type>Rabalux integration feed tip</Type>
            <Recommended_price>${price}</Recommended_price>
            <Description>Integracioni feed</Description>
            <Product_fhdimages><Image>rabaluxkep.plugin.hu/images/IT-SYNC_fhd.jpg</Image></Product_fhdimages>
          </Product></Products>`,
          { status: 200 },
        );
      }
      if (url.includes("/id/11")) {
        return new Response(
          [
            '"Article number";Description;"International Article Number (EAN/UPC)";"Product type";"Product category";Status;"Available quantity";"Unit of Measure";"Next arrival date"',
            'IT-SYNC;"Test";5999999999999;"Tip";"Kategorija";"";3;PCS;2026.09.10',
          ].join("\n"),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected integration-test URL: ${url}`);
    });

    const runIds: string[] = [];
    try {
      const first = await syncRabaluxCatalog();
      runIds.push(first.runId);
      const second = await syncRabaluxCatalog();
      runIds.push(second.runId);
      expect(first).toMatchObject({ read: 1, created: 1, mediaQueued: 1 });
      expect(second).toMatchObject({ read: 1, created: 0, mediaQueued: 0 });

      const initial = await db.product.findUniqueOrThrow({
        where: {
          supplierId_supplierExternalId: {
            supplierId,
            supplierExternalId: "IT-SYNC",
          },
        },
      });
      expect(
        await db.product.count({
          where: { supplierId, supplierExternalId: "IT-SYNC" },
        }),
      ).toBe(1);

      await db.product.update({
        where: { id: initial.id },
        data: {
          name: "Ručni naziv",
          fullPrice: 777,
          supplierReservedStock: 2,
          syncOverrides: { fields: ["name", "pricing"] },
        },
      });
      revision = 2;
      const third = await syncRabaluxCatalog();
      runIds.push(third.runId);
      const stockRun = await syncRabaluxStock();
      runIds.push(stockRun.runId);
      const mediaRun = await syncPendingRabaluxMedia(1);
      runIds.push(mediaRun.runId);
      expect(mediaRun).toMatchObject({ read: 1, ok: 1, failed: 0 });
      expect(
        await db.backgroundJob.count({
          where: {
            kind: "RABALUX_MEDIA_PRODUCT",
            payload: { path: ["assetType"], equals: "MEDIA" },
          },
        }),
      ).toBe(1);
      const preview = await createRabaluxSyncPreview(
        "integration-admin",
        "catalog",
      );
      runIds.push(preview.token.split(".")[0]);
      expect(preview.summary).toMatchObject({ catalogRows: 1, stockRows: 1 });
      await expect(
        consumeRabaluxSyncPreview({
          actorId: "another-admin",
          target: "catalog",
          token: preview.token,
          phrase: preview.phrase,
          reason: "Integraciona provera",
        }),
      ).rejects.toThrow("drugom administratoru");
      await expect(
        consumeRabaluxSyncPreview({
          actorId: "integration-admin",
          target: "catalog",
          token: preview.token,
          phrase: preview.phrase,
          reason: "Integraciona provera",
        }),
      ).resolves.toMatchObject({ runId: preview.token.split(".")[0] });
      await expect(
        consumeRabaluxSyncPreview({
          actorId: "integration-admin",
          target: "catalog",
          token: preview.token,
          phrase: preview.phrase,
          reason: "Ponovljen zahtev",
        }),
      ).rejects.toThrow("već je iskorišćena");

      const updated = await db.product.findUniqueOrThrow({
        where: { id: initial.id },
        select: {
          name: true,
          fullPrice: true,
          supplierStock: true,
          supplierReservedStock: true,
        },
      });
      expect(updated.name).toBe("Ručni naziv");
      expect(Number(updated.fullPrice)).toBe(777);
      expect(updated.supplierStock).toBe(3);
      expect(updated.supplierReservedStock).toBe(2);
      expect(
        effectiveSellableStock({
          warehouseStock: 0,
          supplierStock: updated.supplierStock,
          supplierReservedStock: updated.supplierReservedStock,
        }),
      ).toBe(1);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
      await db.backgroundJob.deleteMany({
        where: { kind: "RABALUX_MEDIA_PRODUCT" },
      });
      await db.product.deleteMany({
        where: { supplierId, supplierExternalId: "IT-SYNC" },
      });
      if (runIds.length) {
        await db.importRun.deleteMany({ where: { id: { in: runIds } } });
      }
    }
  });

  it("serializes shared category creation and scopes child slug collisions", async () => {
    const originalFetch = globalThis.fetch;
    const products = Array.from({ length: 8 }, (_, index) => {
      const root = index < 6 ? "Rabalux collision A" : "Rabalux collision B";
      return `<Product>
        <Sku>IT-CAT-${index + 1}</Sku><Name>Collision ${index + 1}</Name>
        <Ean11>59999999999${String(index).padStart(2, "0")}</Ean11>
        <Product_category>${root}</Product_category><Type>Shared child</Type>
        <Recommended_price>1000</Recommended_price><Description>Collision test</Description>
        <Product_fhdimages><Image>rabaluxkep.plugin.hu/images/IT-CAT-${index + 1}.jpg</Image></Product_fhdimages>
      </Product>`;
    }).join("");
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      if (String(input).includes("/id/332")) {
        return new Response(`<?xml version="1.0"?><Products>${products}</Products>`, {
          status: 200,
        });
      }
      throw new Error(`Unexpected integration-test URL: ${String(input)}`);
    });

    let runId = "";
    try {
      const result = await syncRabaluxCatalog();
      runId = result.runId;
      expect(result).toMatchObject({ read: 8, ok: 8, failed: 0, created: 8 });

      const categories = await db.category.findMany({
        where: {
          path: {
            in: [
              "/rabalux-collision-a/shared-child",
              "/rabalux-collision-b/shared-child",
            ],
          },
        },
        select: { path: true, slug: true },
        orderBy: { path: "asc" },
      });
      expect(categories).toHaveLength(2);
      expect(new Set(categories.map(({ slug }) => slug)).size).toBe(2);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
      await db.backgroundJob.deleteMany({
        where: { kind: "RABALUX_MEDIA_PRODUCT" },
      });
      await db.product.deleteMany({
        where: {
          supplierId,
          supplierExternalId: { startsWith: "IT-CAT-" },
        },
      });
      if (runId) await db.importRun.delete({ where: { id: runId } });
      await db.category.deleteMany({
        where: {
          level: { gt: 0 },
          path: { startsWith: "/rabalux-collision-" },
        },
      });
      await db.category.deleteMany({
        where: { path: { startsWith: "/rabalux-collision-" } },
      });
      await db.group.deleteMany({ where: { slug: "shared-child" } });
    }
  });

  it("creates a retry-safe mixed-stock fulfillment and sends one supplier email", async () => {
    const mixed = await createProduct({
      suffix: "MIXED",
      warehouseStock: 2,
      supplierStock: 5,
    });
    const supplierOnly = await createProduct({
      suffix: "SUPPLIER",
      warehouseStock: 0,
      supplierStock: 1,
    });
    const input = orderInput(
      [
        { sku: mixed.sku, qty: 4 },
        { sku: supplierOnly.sku, qty: 1 },
      ],
      "rabalux-integration-idempotent-001",
    );

    const first = await createOrder(input, null);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const retry = await createOrder(input, null);
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.data.id).toBe(first.data.id);

    const order = await db.order.findUniqueOrThrow({
      where: { id: first.data.id },
      include: {
        items: { orderBy: { sku: "asc" } },
        supplierFulfillments: { include: { items: true } },
      },
    });
    expect(order.items).toHaveLength(2);
    expect(
      order.items.find((item) => item.sku === mixed.sku),
    ).toMatchObject({ warehouseReservedQty: 2, supplierReservedQty: 2 });
    expect(
      order.items.find((item) => item.sku === supplierOnly.sku),
    ).toMatchObject({ warehouseReservedQty: 0, supplierReservedQty: 1 });
    expect(order.supplierFulfillments).toHaveLength(1);
    expect(order.supplierFulfillments[0].items).toHaveLength(2);
    expect(order.supplierFulfillments[0].status).toBe("SENT");
    expect(
      await db.emailMessage.count({
        where: {
          kind: "supplier_order",
          tags: { path: ["fulfillment"], equals: order.supplierFulfillments[0].id },
        },
      }),
    ).toBe(1);

    process.env.RABALUX_ENABLED = "false";
    const disabledSend = await enqueueBackgroundJob({
      kind: "SUPPLIER_ORDER_EMAIL",
      payload: {
        fulfillmentId: order.supplierFulfillments[0].id,
        dispatchKey: "integration-disabled-send",
      },
      idempotencyKey: `supplier-order-disabled:${order.supplierFulfillments[0].id}`,
    });
    await db.backgroundJob.update({
      where: { id: disabledSend.id },
      data: { availableAt: new Date(0) },
    });
    const disabledResult = await processBackgroundJob(disabledSend.id);
    const disabledEmailCount = await db.emailMessage.count({
      where: {
        kind: "supplier_order",
        tags: { path: ["fulfillment"], equals: order.supplierFulfillments[0].id },
      },
    });
    await db.backgroundJob.delete({ where: { id: disabledSend.id } });
    process.env.RABALUX_ENABLED = "true";
    expect(disabledResult).toMatchObject({ claimed: true, ok: false });
    expect(disabledEmailCount).toBe(1);

    await db.supplierFulfillment.update({
      where: { id: order.supplierFulfillments[0].id },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
    });
    const terminalResend = await enqueueBackgroundJob({
      kind: "SUPPLIER_ORDER_EMAIL",
      payload: {
        fulfillmentId: order.supplierFulfillments[0].id,
        dispatchKey: "integration-terminal-resend",
      },
      idempotencyKey: `supplier-order-terminal:${order.supplierFulfillments[0].id}:${Date.now()}`,
    });
    await db.backgroundJob.update({
      where: { id: terminalResend.id },
      data: { availableAt: new Date(0) },
    });
    expect(await processBackgroundJob(terminalResend.id)).toMatchObject({
      claimed: true,
      ok: true,
    });
    expect(
      await db.supplierFulfillment.findUniqueOrThrow({
        where: { id: order.supplierFulfillments[0].id },
        select: { status: true },
      }),
    ).toEqual({ status: "CONFIRMED" });
    expect(
      await db.emailMessage.count({
        where: {
          kind: "supplier_order",
          tags: { path: ["fulfillment"], equals: order.supplierFulfillments[0].id },
        },
      }),
    ).toBe(1);

    await db.product.update({
      where: { id: mixed.id },
      data: { supplierStock: 3 },
    });
    const refreshed = await db.product.findUniqueOrThrow({
      where: { id: mixed.id },
      select: { stock: true, supplierStock: true, supplierReservedStock: true },
    });
    expect(refreshed.supplierReservedStock).toBe(2);
    expect(
      effectiveSellableStock({
        warehouseStock: refreshed.stock,
        supplierStock: refreshed.supplierStock,
        supplierReservedStock: refreshed.supplierReservedStock,
      }),
    ).toBe(1);

    const cancellationIds = await db.$transaction(async (tx) => {
      const freshOrder = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { items: true },
      });
      return (
        await restoreOrderReservations(tx, {
          orderId: order.id,
          orderNumber: order.number,
          items: freshOrder.items,
          reasonKey: "integration-cancel",
          note: "Lokalni integracioni test otkazivanja",
        })
      ).supplierCancellationIds;
    });
    expect(cancellationIds).toEqual([order.supplierFulfillments[0].id]);
    const cancellationJob = await enqueueBackgroundJob({
      kind: "SUPPLIER_CANCEL_EMAIL",
      payload: { fulfillmentId: cancellationIds[0] },
      idempotencyKey: `supplier-cancel:${cancellationIds[0]}`,
    });
    const cancellationResult = await processBackgroundJob(cancellationJob.id);
    expect(cancellationResult).toMatchObject({ claimed: true, ok: true });
    await db.$transaction((tx) =>
      restoreOrderReservations(tx, {
        orderId: order.id,
        orderNumber: order.number,
        items: order.items,
        reasonKey: "integration-cancel",
        note: "Ponovljen zahtev",
      }),
    );

    const [mixedAfter, supplierAfter, cancellationCount] = await Promise.all([
      db.product.findUniqueOrThrow({ where: { id: mixed.id } }),
      db.product.findUniqueOrThrow({ where: { id: supplierOnly.id } }),
      db.emailMessage.count({
        where: {
          kind: "supplier_order_cancellation",
          tags: { path: ["fulfillment"], equals: order.supplierFulfillments[0].id },
        },
      }),
    ]);
    expect(mixedAfter.stock).toBe(2);
    expect(mixedAfter.supplierReservedStock).toBe(0);
    expect(supplierAfter.supplierReservedStock).toBe(0);
    expect(cancellationCount).toBe(1);

    const orderItem = order.items.find((item) => item.sku === mixed.sku)!;
    const reclamation = await db.reclamation.create({
      data: {
        number: `R-IT-${Date.now()}`,
        orderId: order.id,
        orderItemId: orderItem.id,
        productId: orderItem.productId,
        sku: orderItem.sku,
        customerFirst: "Test",
        customerLast: "Kupac",
        customerEmail: "integration@example.test",
        description: "Artikal je oštećen u transportu.",
        notifyVia: "EMAIL",
        type: "FIZICKO_OSTECENJE",
        request: "ZAMENA",
      },
    });
    const reclamationJob = await enqueueBackgroundJob({
      kind: "SUPPLIER_RECLAMATION_EMAIL",
      payload: { reclamationId: reclamation.id },
      idempotencyKey: `supplier-reclamation:${reclamation.id}`,
    });
    expect(await processBackgroundJob(reclamationJob.id)).toMatchObject({
      claimed: true,
      ok: true,
    });
    const reclamationRetry = await enqueueBackgroundJob({
      kind: "SUPPLIER_RECLAMATION_EMAIL",
      payload: { reclamationId: reclamation.id },
      idempotencyKey: `supplier-reclamation:${reclamation.id}`,
    });
    expect(await processBackgroundJob(reclamationRetry.id)).toMatchObject({
      claimed: false,
    });
    expect(
      await db.emailMessage.count({
        where: {
          kind: "supplier_reclamation",
          idempotencyKey: `supplier-reclamation:${reclamation.id}`,
        },
      }),
    ).toBe(1);
  });

  it("serializes parallel supplier-only checkout so only one order can reserve stock", async () => {
    const product = await createProduct({
      suffix: "RACE",
      warehouseStock: 0,
      supplierStock: 2,
    });
    const [left, right] = await Promise.all([
      createOrder(
        orderInput(
          [{ sku: product.sku, qty: 2 }],
          "rabalux-integration-race-left",
        ),
        null,
      ),
      createOrder(
        orderInput(
          [{ sku: product.sku, qty: 2 }],
          "rabalux-integration-race-right",
        ),
        null,
      ),
    ]);
    expect([left.ok, right.ok].sort()).toEqual([false, true]);
    const fresh = await db.product.findUniqueOrThrow({
      where: { id: product.id },
      select: { supplierReservedStock: true },
    });
    expect(fresh.supplierReservedStock).toBe(2);
  });

  it("uses both feature controls as a full supplier-stock and sync kill switch", async () => {
    const product = await createProduct({
      suffix: "KILL-SWITCH",
      warehouseStock: 0,
      supplierStock: 5,
    });
    const fetchSpy = vi.fn();
    const originalFetch = globalThis.fetch;
    try {
      process.env.RABALUX_ENABLED = "false";
      const envDisabled = await createOrder(
        orderInput(
          [{ sku: product.sku, qty: 1 }],
          "rabalux-integration-kill-env",
        ),
        null,
      );
      expect(envDisabled).toMatchObject({
        ok: false,
        error: { code: "OUT_OF_STOCK", sku: product.sku },
      });
      vi.stubGlobal("fetch", fetchSpy);
      await expect(syncRabaluxStock()).rejects.toThrow("disabled");
      expect(fetchSpy).not.toHaveBeenCalled();

      process.env.RABALUX_ENABLED = "true";
      await db.supplier.update({
        where: { id: supplierId },
        data: { enabled: false },
      });
      const supplierDisabled = await createOrder(
        orderInput(
          [{ sku: product.sku, qty: 1 }],
          "rabalux-integration-kill-supplier",
        ),
        null,
      );
      expect(supplierDisabled).toMatchObject({
        ok: false,
        error: { code: "OUT_OF_STOCK", sku: product.sku },
      });
      await expect(syncRabaluxCatalog()).rejects.toThrow("disabled");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      process.env.RABALUX_ENABLED = "true";
      await db.supplier.update({
        where: { id: supplierId },
        data: { enabled: true },
      });
      vi.stubGlobal("fetch", originalFetch);
    }
  });
});
