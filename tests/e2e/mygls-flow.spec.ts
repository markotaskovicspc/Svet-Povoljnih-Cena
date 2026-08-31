import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { PDFDocument } from "pdf-lib";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

test.describe("MyGLS — isolated end-to-end acceptance", () => {
  test.skip(
    process.env.E2E_MYGLS_FLOW !== "1" || !databaseUrl(),
    "Run through npm run test:e2e:mygls:isolated.",
  );
  test.describe.configure({ mode: "serial" });
  test.setTimeout(360_000);

  const runId = `${Date.now()}-${process.pid}`;
  const fixture = {
    adminEmail: `qa.mygls.${runId}@example.invalid`,
    adminPassword: `QaMyGLS!${runId}x`,
    orderNumber: `QA-MYGLS-${runId}`,
    sku: `QA-MYGLS-${runId}`.slice(0, 90),
  };
  let db: PrismaClient;
  let batchId = "";

  test.beforeAll(async () => {
    db = createDatabaseClient();
    const passwordHash = await bcrypt.hash(fixture.adminPassword, 12);
    const [admin, collection] = await Promise.all([
      db.adminUser.create({
        data: {
          email: fixture.adminEmail,
          passwordHash,
          role: "OPS",
          enabled: true,
          firstName: "QA",
          lastName: "MyGLS",
        },
      }),
      db.collection.create({
        data: {
          slug: `qa-mygls-${runId}`,
          name: `QA MyGLS kolekcija ${runId}`,
        },
      }),
    ]);
    expect(admin.role).toBe("OPS");
    const warehouse =
      (await db.warehouse.findFirst({
        where: { active: true, isDefault: true },
        orderBy: { createdAt: "asc" },
      })) ??
      (await db.warehouse.create({
        data: {
          code: `QA-GLS-${runId}`.slice(0, 30),
          name: `QA MyGLS DC ${runId}`,
          isDefault: true,
          active: true,
        },
      }));

    const product = await db.product.create({
      data: {
        sku: fixture.sku,
        barcode: `860${runId.replace(/\D/g, "").slice(-10).padStart(10, "0")}`,
        slug: `qa-mygls-${runId}`,
        name: "QA GLS artikal sa decimalnom visinom",
        shortName: "QA GLS artikal",
        description: "Izolovani acceptance artikal.",
        shortDescription: "MyGLS Int32 regresioni slučaj.",
        fullPrice: 1_000,
        collectionId: collection.id,
        packQty: 6,
        grossWeightKg: 7.25,
        packGrossWeightKg: 43.5,
        unitPackWidthCm: 88,
        unitPackDepthCm: 44,
        unitPackHeightCm: 6.5,
      },
    });

    await db.order.create({
      data: {
        number: fixture.orderNumber,
        status: "KREIRANO",
        channel: "WEB",
        subtotal: 12_000,
        total: 12_000,
        shippingMethod: "KURIR",
        paymentMethod: "POUZECE_GOTOVINA",
        shipFirstName: "QA",
        shipLastName: "MyGLS kupac",
        shipPhone: "+38160111222",
        shipStreet: "Testna 13A sprat 2",
        shipCity: "Beograd",
        shipPostalCode: "11000",
        shipCountry: "RS",
        guestEmail: `qa.order.${runId}@example.invalid`,
        termsAcceptedAt: new Date(),
        items: {
          create: {
            productId: product.id,
            sku: product.sku,
            name: product.name,
            qty: 12,
            unitPriceFull: 1_000,
            unitPriceSale: 1_000,
            warehouseId: warehouse.id,
            warehouseReservedQty: 12,
            collectionName: collection.name,
            shortNameSnapshot: product.shortName,
            shortDescriptionSnapshot: product.shortDescription,
          },
        },
      },
    });
  });

  test.afterAll(async () => {
    await db?.$disconnect();
  });

  test("kreira, čuva, spaja i štampa GLS adresnice bez produkcionih resursa", async ({
    context,
    page,
  }) => {
    const baseUrl = process.env.PLAYWRIGHT_BASE_URL ||
      `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3026"}`;
    const providerUrl = process.env.MYGLS_BASE_URL;
    const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(providerUrl).toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect(storageUrl).toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect(databaseUrl()).toContain("schema=mygls_e2e_");

    await context.addCookies([
      { name: "spc_cookie_consent", value: "essential", url: baseUrl },
    ]);

    await test.step("lokalni provider simulira originalnu Int32 grešku", async () => {
      const response = await fetch(
        `${providerUrl}/ParcelService.svc/json/PrintLabels`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ParcelList: [
              {
                PickupDate: `/Date(${Date.now()})/`,
                Count: 1,
                ParcelPropertyList: [
                  { Height: 6.5, Width: 88, Length: 44, Weight: 7.25 },
                ],
              },
            ],
          }),
        },
      );
      expect(response.ok).toBe(true);
      const body = await response.json();
      expect(body.PrintLabelsErrorList[0].ErrorDescription).toContain(
        "The value '6.5' cannot be parsed as the type 'Int32'",
      );
    });

    await test.step("OPS admin formira MyGLS nalog sa 12 komada u 12 paketa", async () => {
      await page.goto("/admin/erp/preuzimanja", {
        waitUntil: "domcontentloaded",
      });
      await expect(page).toHaveURL(/\/admin\/prijava/);
      await page.getByLabel("E-pošta").fill(fixture.adminEmail);
      await page.getByLabel("Lozinka").fill(fixture.adminPassword);
      await page.getByRole("button", { name: "Prijavi se" }).click();
      await expect(page).toHaveURL(/\/admin\/erp\/preuzimanja$/, {
        timeout: 90_000,
      });

      await page.getByRole("button", { name: "Novi", exact: true }).click();
      const createDialog = page.getByRole("dialog");
      await createDialog.getByLabel("Kurirska služba").selectOption("MYGLS");
      await createDialog.getByRole("button", { name: "Novi", exact: true }).click();
      await expect(page).toHaveURL(
        /\/admin\/erp\/preuzimanja\/[^/?]+\?mode=edit$/,
      );
      batchId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
      expect(batchId).not.toBe("");

      await page
        .getByRole("button", { name: "Učitaj porudžbine", exact: true })
        .click();
      await expect(page.getByRole("status")).toContainText(
        "Učitano paketa: 12 iz 1 porudžbina",
      );
      const groupRow = page.getByRole("row").filter({
        has: page.getByRole("link", {
          name: fixture.orderNumber,
          exact: true,
        }),
      });
      await expect(groupRow).toBeVisible();
      await expect(groupRow).toContainText("× 12");
      await expect(groupRow.locator("td").nth(2)).toHaveText("12");

      const lines = await db.pickupBatchLine.findMany({
        where: { batchId },
        orderBy: { packageNo: "asc" },
      });
      expect(lines).toHaveLength(12);
      expect(lines.every((line) => line.quantity === 12)).toBe(true);
      expect(lines.every((line) => Number(line.heightCm) === 6.5)).toBe(true);
      expect(lines.every((line) => Number(line.weightKg) === 7.25)).toBe(true);
      expect(new Set(lines.map((line) => line.lineGroupKey).values()).size).toBe(1);

      await db.pickupBatch.update({
        where: { id: batchId },
        data: {
          labelsCreationStartedAt: new Date(),
          configurationIssue:
            "There was an error deserializing the object of type GLS.MyGLS.ServiceData.APIDTOs.LabelOperations.PrintLabelsRequest. The value '6.5' cannot be parsed as the type 'Int32'.",
        },
      });
      await page.goto(`/admin/erp/preuzimanja/${batchId}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByText("Prethodni pokušaj nije uspeo:"),
      ).toBeVisible();
      await expect(
        page.getByText("Dugme „Kreiraj adresnice i pošalji“ je dostupno"),
      ).toBeVisible();
    });

    let popup: Page | null = null;
    await test.step("jedan klik šalje MyGLS zahtev i otvara provider PDF za štampu", async () => {
      const postButton = page.getByRole("button", {
        name: "Kreiraj adresnice i pošalji",
        exact: true,
      });
      await expect(postButton).toBeEnabled();
      const popupPromise = context.waitForEvent("page");
      const dialogPromise = page.waitForEvent("dialog");
      const clickPromise = postButton.click();
      const dialog = await dialogPromise;
      expect(dialog.type()).toBe("confirm");
      await dialog.accept();
      const openedPopup = await popupPromise;
      popup = openedPopup;
      const popupLabelResponse = openedPopup.waitForResponse(
        (response) =>
          response.url().includes(`/api/admin/erp/preuzimanja/${batchId}/labels`) &&
          response.status() === 200,
        { timeout: 120_000 },
      );
      await clickPromise;

      await expect(page.getByRole("status")).toContainText(
        "1 pošiljki je uspešno poslato u sistem kurira",
        { timeout: 120_000 },
      );
      const printResponse = await popupLabelResponse;
      expect(printResponse.headers()["content-type"]).toContain("application/pdf");
      expect(printResponse.headers()["x-courier-label-count"]).toBe("12");
    });

    let shipmentId = "";
    await test.step("provider payload zaokružuje samo dimenzije, ne i težinu", async () => {
      const [batch, shipments, requestLog, storageHealth] = await Promise.all([
        db.pickupBatch.findUniqueOrThrow({ where: { id: batchId } }),
        db.shipment.findMany({
          where: { order: { number: fixture.orderNumber } },
          include: { events: true },
        }),
        fetch(`${providerUrl}/requests`).then((response) => response.json()),
        fetch(`${storageUrl}/health`).then((response) => response.json()),
      ]);
      expect(batch.status).toBe("BOOKED");
      expect(batch.labelsCreationStartedAt).not.toBeNull();
      expect(batch.labelsCreatedAt).not.toBeNull();
      expect(batch.externalBookedAt).not.toBeNull();
      expect(batch.externalBookingChannel).toBe("MYGLS_API");
      expect(batch.externalBookingReference).toBe("PrintLabels");
      expect(batch.manifestRef).toBe("MYGLS:MYGLS_API:PrintLabels");

      expect(shipments).toHaveLength(1);
      const shipment = shipments[0]!;
      shipmentId = shipment.id;
      expect(shipment.provider).toBe("MYGLS");
      expect(shipment.status).toBe("CREATED");
      expect(shipment.packageCount).toBe(12);
      expect(shipment.trackingNo).toMatch(/^\d+$/);
      expect(shipment.labelObjectKey).toBe(
        `mygls/${fixture.orderNumber}/${shipment.id}.pdf`,
      );
      expect(shipment.labelUrl).toBe(`/api/admin/shipments/${shipment.id}/label`);
      expect(shipment.labelUrl).not.toContain("/storage/v1/object/public/");
      expect(shipment.events.some((event) => event.status === "CREATED")).toBe(true);
      expect(storageHealth).toMatchObject({ ok: true, objects: 1 });

      const providerRequests = requestLog.requests.filter(
        (request: { method: string }) => request.method === "PrintLabels",
      );
      expect(providerRequests).toHaveLength(2);
      const successfulPayload = providerRequests[1].body;
      expect(successfulPayload.Password).toHaveLength(64);
      expect(successfulPayload.ClientNumberList).toEqual([123456]);
      expect(successfulPayload.ParcelList).toHaveLength(1);
      const parcel = successfulPayload.ParcelList[0];
      expect(parcel.ClientReference).toBe(fixture.orderNumber);
      expect(parcel.Count).toBe(12);
      expect(parcel.CODAmount).toBe(12_000);
      expect(parcel.PickupDate).toMatch(/^\/Date\(\d+\)\/$/);
      expect(parcel.PickupAddress.HouseNumber).toBe("1");
      expect(parcel.DeliveryAddress).toMatchObject({
        Street: "Testna",
        HouseNumber: "13A",
        HouseNumberInfo: "sprat 2",
        City: "Beograd",
        ZipCode: "11000",
      });
      expect(parcel.ServiceList.map((service: { Code: string }) => service.Code)).toEqual([
        "CS1",
        "FDS",
      ]);
      expect(parcel.ParcelPropertyList).toHaveLength(12);
      for (const property of parcel.ParcelPropertyList) {
        expect(property).toMatchObject({
          Width: 88,
          Length: 44,
          Height: 7,
          Weight: 7.25,
        });
        expect(Number.isInteger(property.Width)).toBe(true);
        expect(Number.isInteger(property.Length)).toBe(true);
        expect(Number.isInteger(property.Height)).toBe(true);
      }
    });

    await test.step("zbirna i pojedinačna privatna adresnica su validni PDF-ovi", async () => {
      const [batchLabels, shipmentLabel] = await Promise.all([
        page.request.get(`/api/admin/erp/preuzimanja/${batchId}/labels`),
        page.request.get(`/api/admin/shipments/${shipmentId}/label`),
      ]);
      expect(batchLabels.status()).toBe(200);
      expect(batchLabels.headers()["content-type"]).toContain("application/pdf");
      expect(batchLabels.headers()["cache-control"]).toBe("private, no-store");
      expect(batchLabels.headers()["x-courier-label-source"]).toBe(
        "mygls-provider-pdfs-merged",
      );
      expect(batchLabels.headers()["x-courier-label-count"]).toBe("12");
      const batchPdfBytes = await batchLabels.body();
      expect(batchPdfBytes.subarray(0, 4).toString()).toBe("%PDF");
      const batchPdf = await PDFDocument.load(batchPdfBytes);
      expect(batchPdf.getPageCount()).toBe(12);

      expect(shipmentLabel.status()).toBe(200);
      expect(shipmentLabel.headers()["content-type"]).toContain("application/pdf");
      expect(shipmentLabel.headers()["cache-control"]).toBe("private, no-store");
      expect(shipmentLabel.headers()["x-courier-label-source"]).toBe(
        "mygls-provider-pdf",
      );
      const shipmentPdf = await PDFDocument.load(await shipmentLabel.body());
      expect(shipmentPdf.getPageCount()).toBe(12);
    });

    await test.step("picking štampa razlikuje komade od fizičkih paketa", async () => {
      await page.goto(
        `/admin/erp/preuzimanja/${batchId}/stampa?section=picking`,
        { waitUntil: "domcontentloaded" },
      );
      await expect(page.getByRole("heading", { name: "Zbirna picking lista" })).toBeVisible();
      await expect(page.getByText("Paketa").last()).toBeVisible();
      const row = page.getByRole("row").filter({
        has: page.getByText(fixture.sku, { exact: true }),
      });
      await expect(row).toContainText("12");
      await expect(row).toContainText("12");
      await expect(
        page.getByRole("link", { name: "Otvori sve kurirske adresnice" }),
      ).toHaveAttribute("href", `/api/admin/erp/preuzimanja/${batchId}/labels`);
    });

    await test.step("fizičko preuzimanje se beleži jednom i šalje u izolovani outbox", async () => {
      await page.goto(`/admin/erp/preuzimanja/${batchId}`, {
        waitUntil: "domcontentloaded",
      });
      await acceptConfirmation(
        page,
        page.getByRole("button", { name: "Sve preuzeto", exact: true }),
      );
      await expect(page.getByRole("status")).toContainText(
        "Kurir je evidentiran za sve pošiljke (1/1) i pakete (12/12)",
      );
      const [batch, lines, jobs] = await Promise.all([
        db.pickupBatch.findUniqueOrThrow({ where: { id: batchId } }),
        db.pickupBatchLine.findMany({ where: { batchId } }),
        db.backgroundJob.findMany({
          where: {
            kind: "COURIER_HANDOVER",
            idempotencyKey: { startsWith: `courier-handover:${batchId}:` },
          },
        }),
      ]);
      expect(batch.status).toBe("PICKED_UP");
      expect(lines.every((line) => line.courierPickedUpAt != null)).toBe(true);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.status).toBe("QUEUED");
      expect(jobs[0]!.payload).toMatchObject({
        batchId,
        batchNumber: batch.number,
        shipmentId,
      });
    });

    await popup?.close().catch(() => undefined);
  });
});

async function acceptConfirmation(page: Page, trigger: Locator) {
  const dialogPromise = page.waitForEvent("dialog");
  const clickPromise = trigger.click();
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe("confirm");
  await dialog.accept();
  await clickPromise;
}

function createDatabaseClient() {
  const raw = databaseUrl();
  if (!raw) throw new Error("MyGLS acceptance database URL is required.");
  const url = new URL(raw);
  const schema = url.searchParams.get("schema")?.trim() || undefined;
  url.searchParams.delete("schema");
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    if (process.env.E2E_ALLOW_REMOTE_DATABASE !== "1") {
      throw new Error("Remote MyGLS acceptance requires explicit approval.");
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
