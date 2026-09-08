import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { PDFDocument } from "pdf-lib";

test.describe("Rabalux COD fulfillment — isolated acceptance", () => {
  test.skip(
    process.env.E2E_RABALUX !== "1" || !databaseUrl(),
    "Run through npm run test:e2e:rabalux.",
  );
  test.describe.configure({ mode: "serial" });
  test.setTimeout(360_000);

  const runId = `${Date.now()}-${process.pid}`;
  const fixture = {
    sku: `RAB-E2E-${runId}`.slice(0, 64),
    dcSku: `DC-E2E-${runId}`.slice(0, 64),
    sourceSku: `E2E-${runId}`.slice(0, 64),
    checkoutSessionId: `rabalux-e2e-${runId}`,
    buyerPhone: "+381601234567",
    townId: 99_100_001,
  };
  let db: PrismaClient;

  test.beforeAll(async () => {
    db = createDatabaseClient();
    await db.xExpressTown.create({ data: {
      id: 9902026, name: "Beograd", postalCode: "11000", active: true,
    } });
    const supplier = await db.supplier.upsert({
      where: { integrationKey: "RABALUX" },
      update: {
        email: "infosrb@rabalux.com",
        fulfillmentMode: "EMAIL",
        enabled: true,
      },
      create: {
        name: "Rabalux",
        integrationKey: "RABALUX",
        email: "infosrb@rabalux.com",
        fulfillmentMode: "EMAIL",
        enabled: true,
      },
    });
    await db.warehouse.create({
      data: {
        code: `QA-RAB-DC-${runId}`.slice(0, 30),
        name: `QA Rabalux DC ${runId}`,
        isDefault: true,
        active: true,
      },
    });
    const parentCategory = await db.category.create({
      data: {
        name: `QA Rabalux root ${runId}`,
        slug: `qa-rabalux-root-${runId}`,
        path: `/qa-rabalux-root-${runId}`,
        level: 0,
      },
    });
    const [category, group, priceList] = await Promise.all([
      db.category.create({
        data: {
          name: `QA Rabalux ${runId}`,
          slug: `qa-rabalux-${runId}`,
          path: `${parentCategory.path}/qa-rabalux-${runId}`,
          level: 1,
          parentId: parentCategory.id,
        },
      }),
      db.group.create({
        data: {
          name: `QA Rabalux ${runId}`,
          slug: `qa-rabalux-${runId}`,
        },
      }),
      db.priceList.create({
        data: {
          code: `QA-RAB-${runId}`.slice(0, 40),
          name: `QA Rabalux MP ${runId}`,
          kind: "RETAIL",
          active: true,
        },
      }),
    ]);
    const product = await db.product.create({
      data: {
        sku: fixture.sku,
        slug: fixture.sku.toLowerCase(),
        name: "QA Rabalux COD proizvod",
        description: "Izolovani Rabalux fulfillment fixture.",
        groupId: group.id,
        fullPrice: 1_500,
        packQty: 1,
        grossWeightKg: 1.25,
        unitPackWidthCm: 88,
        unitPackDepthCm: 20,
        unitPackHeightCm: 15,
        stock: 0,
        dcAvailableQty: 0,
        supplierStock: 12,
        supplierApprovalStatus: "APPROVED",
        supplierApprovedAt: new Date(),
        lastSupplierStockSyncAt: new Date(),
        supplierId: supplier.id,
        supplierExternalId: fixture.sourceSku,
        isActive: true,
        categories: { create: { categoryId: category.id } },
        media: {
          create: {
            kind: "IMAGE",
            url: `rabalux/${fixture.sourceSku}/ready.jpg`,
            syncStatus: "READY",
          },
        },
      },
    });
    const dcProduct = await db.product.create({
      data: {
        sku: fixture.dcSku,
        slug: fixture.dcSku.toLowerCase(),
        name: "QA DC COD proizvod",
        description: "Izolovani DC fixture za mešovitu porudžbinu.",
        groupId: group.id,
        fullPrice: 1_000,
        packQty: 1,
        grossWeightKg: 2,
        unitPackWidthCm: 40,
        unitPackDepthCm: 30,
        unitPackHeightCm: 20,
        stock: 5,
        dcAvailableQty: 5,
        isActive: true,
        categories: { create: { categoryId: category.id } },
        media: {
          create: {
            kind: "IMAGE",
            url: `qa/${fixture.dcSku}/ready.jpg`,
            syncStatus: "READY",
          },
        },
      },
    });
    await db.priceListEntry.createMany({
      data: [
        {
          priceListId: priceList.id,
          productId: product.id,
          price: 1_500,
          validFrom: new Date(Date.now() - 60_000),
        },
        {
          priceListId: priceList.id,
          productId: dcProduct.id,
          price: 1_000,
          validFrom: new Date(Date.now() - 60_000),
        },
      ],
    });
    await db.xExpressTown.create({
      data: {
        id: fixture.townId,
        name: "Beograd",
        displayName: "Beograd - 11000",
        postalCode: "11000",
        active: true,
      },
    });
  });

  test.afterAll(async () => {
    await db?.$disconnect();
  });

  test("mixed COD checkout emails only Rabalux lines, books pickup without COD and sends the waybill once", async ({
    request,
  }) => {
    const checkoutData = {
      checkoutSessionId: fixture.checkoutSessionId,
      guestEmail: "qa.rabalux.order@example.invalid",
      lines: [
        { sku: fixture.sku, qty: 1 },
        { sku: fixture.dcSku, qty: 1 },
      ],
      shipping: {
        firstName: "QA",
        lastName: "Kupac",
        phone: fixture.buyerPhone,
        street: "Testna ulica 1",
        city: "Beograd",
        postalCode: "11000",
        xExpressTownId: fixture.townId,
        country: "RS",
      },
      billingSameAsShipping: true,
      shippingMethod: "KURIR",
      paymentMethod: "POUZECE_GOTOVINA",
      consent: true,
    };

    const firstResponse = await request.post("/api/checkout/order", {
      data: checkoutData,
    });
    const first = await firstResponse.json();
    expect(firstResponse.status(), JSON.stringify(first)).toBe(201);
    expect(first.ok).toBe(true);

    const retryResponse = await request.post("/api/checkout/order", {
      data: checkoutData,
    });
    const retry = await retryResponse.json();
    expect(retryResponse.status(), JSON.stringify(retry)).toBe(201);
    expect(retry.ok).toBe(true);
    expect(retry.data.id).toBe(first.data.id);

    const orderId = first.data.id as string;
    const queued = await db.backgroundJob.findFirstOrThrow({ where: {
      kind: "SUPPLIER_SHIPPING_DOCUMENTS_EMAIL",
      payload: { path: ["fulfillmentId"], equals:
        (await db.supplierFulfillment.findFirstOrThrow({ where: { orderId } })).id },
    } });
    expect(queued.status).toBe("QUEUED");
    expect(queued.availableAt.getTime()).toBeGreaterThan(Date.now());
    expect(await db.shipment.count({ where: { orderId } })).toBe(0);
    // Advance only this fixture to the next day; exercise the real cron route.
    await db.order.update({ where: { id: orderId }, data: {
      createdAt: new Date(Date.now() - 2 * 86400000),
    } });
    await db.backgroundJob.update({ where: { id: queued.id }, data: { availableAt: new Date(0) } });
    const cron = await request.post("/api/cron/background-jobs", { headers: {
      authorization: `Bearer ${process.env.BACKGROUND_JOBS_CRON_SECRET}`,
    } });
    expect(cron.ok()).toBe(true);
    await expect
      .poll(
        async () =>
          db.supplierFulfillment.findFirst({
            where: { orderId },
            select: { status: true, lastError: true },
          }),
        { timeout: 120_000 },
      )
      .toEqual({ status: "PICKUP_READY", lastError: null });

    const [
      order,
      fulfillment,
      supplierEmails,
      supplierOrderJobs,
      documentJobs,
      invoice,
    ] = await Promise.all([
      db.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { shipments: true, items: true },
      }),
      db.supplierFulfillment.findFirstOrThrow({
        where: { orderId },
        include: { items: true },
      }),
      db.emailMessage.findMany({
        where: {
          kind: {
            in: ["supplier_order", "supplier_shipping_documents"],
          },
        },
        orderBy: { createdAt: "asc" },
      }),
      db.backgroundJob.findMany({
        where: {
          kind: "SUPPLIER_ORDER_EMAIL",
          idempotencyKey: { contains: ":checkout" },
        },
      }),
      db.backgroundJob.findMany({
        where: {
          kind: "SUPPLIER_SHIPPING_DOCUMENTS_EMAIL",
          idempotencyKey: { contains: ":checkout" },
        },
      }),
      db.invoice.findUniqueOrThrow({
        where: { orderId_kind: { orderId, kind: "PROFORMA" } },
      }),
    ]);

    expect(order.shipments).toHaveLength(1);
    expect(order.shipments[0]).toMatchObject({
      provider: "X_EXPRESS",
      status: "CREATED",
    });
    expect(order.shipments[0]?.providerShipmentId).toBeTruthy();
    expect(order.shipments[0]?.labelUrl).toContain("/label");
    expect(order.items).toHaveLength(2);
    expect(fulfillment.items).toHaveLength(1);
    expect(supplierEmails).toHaveLength(2);
    const orderEmail = supplierEmails.find(
      (message) => message.kind === "supplier_order",
    );
    const shippingEmail = supplierEmails.find(
      (message) => message.kind === "supplier_shipping_documents",
    );
    expect(orderEmail).toMatchObject({
      status: "SENT",
      recipient: "infosrb@rabalux.com",
    });
    expect(orderEmail?.subject).not.toMatch(/1[.,]?500|2[.,]?490|garanc/i);
    expect(orderEmail?.subject).toContain("priprema artikala");
    expect(orderEmail?.metadata).toMatchObject({
      attachmentCount: 2,
      supplierItemCount: 1,
      attachmentNames: [
        `predracun-rabalux-${order.number}.pdf`,
        `obrazac-za-odustajanje-${order.number}.pdf`,
      ],
    });
    expect(shippingEmail).toMatchObject({
      status: "SENT",
      recipient: "infosrb@rabalux.com",
    });
    expect(shippingEmail?.subject).toContain("Adresnica i kurirski nalog");
    expect(shippingEmail?.metadata).toMatchObject({
      attachmentCount: 2,
      supplierItemCount: 1,
      provider: "X_EXPRESS",
      courierRequestAccepted: true,
      codCollectionPlan: "DC_FULL_ORDER",
      attachmentNames: [
        `adresnica-${order.number}.pdf`,
        `pak-lista-${order.number}.pdf`,
      ],
    });
    expect(JSON.stringify(shippingEmail)).not.toMatch(
      /1[.,]?500|2[.,]?490|garantni-list|predračun|predracun/i,
    );
    expect(supplierOrderJobs).toHaveLength(1);
    expect(documentJobs).toHaveLength(1);
    expect(documentJobs[0]).toMatchObject({ status: "COMPLETED" });

    const snapshot = invoice.snapshot as {
      order?: { customer?: { phone?: string } };
    };
    expect(snapshot.order?.customer?.phone).toBe(fixture.buyerPhone);
    expect(invoice.pdfObjectKey).toBeTruthy();
    const storageBaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(storageBaseUrl).toMatch(/^http:\/\/127\.0\.0\.1:/);
    const pdfResponse = await fetch(
      `${storageBaseUrl}/storage/v1/object/order-receipts/${invoice.pdfObjectKey}`,
    );
    expect(pdfResponse.ok).toBe(true);
    expect(pdfResponse.headers.get("cache-control")).toBe("private, no-store");
    const buyerPdf = await PDFDocument.load(await pdfResponse.arrayBuffer());
    expect(buyerPdf.getPageCount()).toBeGreaterThan(0);

    const providerBaseUrl = process.env.MYGLS_BASE_URL;
    const providerLog = await fetch(`${providerBaseUrl}/requests`).then(
      (response) => response.json(),
    );
    const courierRequests = providerLog.requests.filter(
      (entry: { method: string }) => entry.method === "XExpressCreateOrder",
    );
    expect(courierRequests).toHaveLength(1);
    const payload = courierRequests[0].body;
    expect(payload).toMatchObject({
      Reference: order.shipments[0].id,
      Sender: { Name: "Rabalux QA magacin", Phone: "38160111223", Email: "rabalux-qa@example.invalid" },
      Waypoints: expect.arrayContaining([
        expect.objectContaining({
          WaypointType: "PICKUP",
          Address: expect.objectContaining({ Name: "Rabalux QA magacin", TownId: 9902026, StreetName: "Industrijska", StreetNumber: "12" }),
          Contact: { Name: "Rabalux QA", Phone: "38160111223" },
        }),
      ]),
    });
    expect(payload.Packages).toHaveLength(1);
    expect(payload.Options ?? []).toHaveLength(0);
    expect(JSON.stringify(payload)).not.toContain("QA DC COD proizvod");
    expect(providerLog.requests.filter((entry: { method: string }) => entry.method === "PrintLabels")).toHaveLength(0);
  });
});

function createDatabaseClient() {
  const raw = databaseUrl();
  if (!raw) throw new Error("Rabalux acceptance database URL is required.");
  const url = new URL(raw);
  const schema = url.searchParams.get("schema")?.trim() || undefined;
  url.searchParams.delete("schema");
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    if (process.env.E2E_ALLOW_REMOTE_DATABASE !== "1") {
      throw new Error("Remote Rabalux acceptance requires explicit approval.");
    }
    url.searchParams.set("sslmode", "no-verify");
    url.searchParams.delete("uselibpqcompat");
  }
  return new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: url.toString(), max: 2 },
      { schema },
    ),
  });
}

function databaseUrl() {
  return [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL,
  ].find((value) => value?.trim());
}
