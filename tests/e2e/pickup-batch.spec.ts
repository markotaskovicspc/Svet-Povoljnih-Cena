// Acceptance: EXT-GLS-01
import {
  expect as baseExpect,
  test,
  type Locator,
  type Page,
} from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

const expect = baseExpect.configure({ timeout: 30_000 });

test.describe("Modul 13 — nalozi za preuzimanje", () => {
  test.skip(
    process.env.E2E_PICKUP_BATCHES !== "1" || !databaseUrl(),
    "Set E2E_PICKUP_BATCHES=1 and provide an isolated database URL.",
  );
  test.describe.configure({ mode: "serial" });
  test.setTimeout(360_000);

  const runId = `${Date.now()}-${process.pid}`;
  const fixture = {
    adminEmail: `qa.pickup.${runId}@example.invalid`,
    adminPassword: `QaPickup!${runId}x`,
    eligibleOrder: `QA-PICKUP-ELIGIBLE-${runId}`,
    wrongStatusOrder: `QA-PICKUP-STATUS-${runId}`,
    wrongWarehouseOrder: `QA-PICKUP-WH-${runId}`,
    truckOrder: `QA-PICKUP-TRUCK-${runId}`,
    fiscalizedOrder: `QA-PICKUP-FISCAL-${runId}`,
    skuA: `QA-PICKUP-A-${runId}`.slice(0, 90),
    skuZ: `QA-PICKUP-Z-${runId}`.slice(0, 90),
    skuOther: `QA-PICKUP-O-${runId}`.slice(0, 90),
    collection: `QA kolekcija preuzimanja ${runId}`,
  };

  let db: PrismaClient;
  let adminId = "";
  let dcWarehouseId = "";
  let createdDcWarehouse = false;
  let otherWarehouseId = "";
  let collectionId = "";
  const productIds: string[] = [];
  const orderIds: string[] = [];
  const batchIds: string[] = [];
  let eligibleOrderId = "";
  let firstBatchId = "";
  let firstBatchNumber = "";
  let secondBatchId = "";
  let secondBatchNumber = "";

  test.beforeAll(async () => {
    db = createDatabaseClient();
    const passwordHash = await bcrypt.hash(fixture.adminPassword, 12);
    const admin = await db.adminUser.create({
      data: {
        email: fixture.adminEmail,
        passwordHash,
        role: "OPS",
        enabled: true,
        firstName: "QA",
        lastName: "Modul 13",
      },
      select: { id: true },
    });
    adminId = admin.id;
    const existingDc = await db.warehouse.findFirst({
      where: { active: true, isDefault: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const dc =
      existingDc ??
      (await db.warehouse.create({
        data: {
          code: `QA-DC-${runId}`.slice(0, 30),
          name: `QA DC ${runId}`,
          isDefault: true,
          active: true,
        },
        select: { id: true },
      }));
    createdDcWarehouse = !existingDc;
    const [other, collection] = await Promise.all([
      db.warehouse.create({
        data: {
          code: `QA-WH-${runId}`.slice(0, 30),
          name: `QA drugi magacin ${runId}`,
          active: true,
        },
        select: { id: true },
      }),
      db.collection.create({
        data: {
          slug: `qa-pickup-${runId}`,
          name: fixture.collection,
        },
        select: { id: true },
      }),
    ]);
    dcWarehouseId = dc.id;
    otherWarehouseId = other.id;
    collectionId = collection.id;

    const products = await Promise.all([
      createProduct({
        sku: fixture.skuZ,
        slug: `qa-pickup-z-${runId}`,
        barcode: `861${runId.replace(/\D/g, "").slice(-10).padStart(10, "0")}`,
        shortName: `Kratki Z ${runId}`,
        shortDescription: `Opis Z ${runId}`,
        attribute1: "Z-A1",
        attribute2: "Z-A2",
        attribute3: "Z-A3",
        attribute4: "Z-A4",
        colorPrimary: "Zelena",
        colorSecondary: "Crna",
      }),
      createProduct({
        sku: fixture.skuA,
        slug: `qa-pickup-a-${runId}`,
        barcode: `862${runId.replace(/\D/g, "").slice(-10).padStart(10, "0")}`,
        shortName: `Kratki A ${runId}`,
        shortDescription: `Opis A ${runId}`,
        attribute1: "A-A1",
        attribute2: "A-A2",
        attribute3: "A-A3",
        attribute4: "A-A4",
        colorPrimary: "Plava",
        colorSecondary: "Bela",
      }),
      createProduct({
        sku: fixture.skuOther,
        slug: `qa-pickup-o-${runId}`,
        barcode: `863${runId.replace(/\D/g, "").slice(-10).padStart(10, "0")}`,
        shortName: `Kratki O ${runId}`,
        shortDescription: `Opis O ${runId}`,
        attribute1: "O-A1",
        attribute2: "O-A2",
        attribute3: "O-A3",
        attribute4: "O-A4",
        colorPrimary: "Siva",
        colorSecondary: "Braon",
      }),
    ]);
    productIds.push(...products.map((product) => product.id));

    const eligible = await createOrder({
      number: fixture.eligibleOrder,
      status: "KREIRANO",
      shippingMethod: "KURIR",
      lines: [
        { product: products[0]!, warehouseId: null, qty: 2 },
        { product: products[1]!, warehouseId: dcWarehouseId, qty: 3 },
      ],
    });
    eligibleOrderId = eligible.id;
    orderIds.push(eligible.id);

    const wrongStatus = await createOrder({
      number: fixture.wrongStatusOrder,
      status: "POTVRDJENO",
      shippingMethod: "KURIR",
      lines: [{ product: products[2]!, warehouseId: dcWarehouseId, qty: 1 }],
    });
    const wrongWarehouse = await createOrder({
      number: fixture.wrongWarehouseOrder,
      status: "KREIRANO",
      shippingMethod: "KURIR",
      lines: [{ product: products[2]!, warehouseId: otherWarehouseId, qty: 1 }],
    });
    const truck = await createOrder({
      number: fixture.truckOrder,
      status: "KREIRANO",
      shippingMethod: "KAMION",
      lines: [{ product: products[2]!, warehouseId: dcWarehouseId, qty: 1 }],
    });
    const fiscalized = await createOrder({
      number: fixture.fiscalizedOrder,
      status: "KREIRANO",
      shippingMethod: "KURIR",
      lines: [{ product: products[2]!, warehouseId: dcWarehouseId, qty: 1 }],
    });
    await db.fiscalReceipt.create({
      data: {
        orderId: fiscalized.id,
        receiptNumber: `QA-PICKUP-RCPT-${runId}`,
      },
    });
    orderIds.push(wrongStatus.id, wrongWarehouse.id, truck.id, fiscalized.id);
  });

  test.afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await db?.$disconnect();
    }
  });

  test("OPS admin prolazi kompletan lokalni tok bez GLS poziva", async ({
    context,
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
    await context.addCookies([
      { name: "spc_cookie_consent", value: "essential", url: baseUrl },
    ]);

    await test.step("ruta je zaštićena, a OPS admin vidi traženi pregled", async () => {
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
      const overviewHeading = page.getByRole("heading", {
        name: "Nalozi za preuzimanje (Kurirske službe)",
        exact: true,
      });
      await expect(overviewHeading).toHaveCount(1);
      await expect(overviewHeading).toBeVisible();
      for (const command of [
        "Novi",
        "Uredi",
        "Obriši",
      ]) {
        await expect(
          page.getByRole("button", { name: command, exact: true }),
        ).toBeVisible();
      }
      const postCommand = page.getByRole("button", {
        name: /^(Proknjiži|Kreiraj adresnice)$/,
      });
      await expect(postCommand).toBeVisible();
      await expect(postCommand).toBeDisabled();
      for (const header of [
        "Status",
        "Broj naloga",
        "Kurirska služba",
        "Datum naloga",
      ]) {
        await expect(
          page.getByRole("columnheader").filter({
            has: page.getByRole("button", { name: header, exact: true }),
          }),
        ).toBeVisible();
      }
    });

    await test.step("pravila dostave prikazuju automatske uloge oba kurira", async () => {
      await page.goto("/admin/dostava", { waitUntil: "domcontentloaded" });
      await expect(
        page.getByRole("heading", { name: "Automatski izbor kurira" }),
      ).toBeVisible();
      await expect(
        page.getByText("Paket je do 30 kg i svaka strana je do 60 cm."),
      ).toBeVisible();
      await expect(
        page.getByText(/bar jedna strana preko 60 cm/),
      ).toBeVisible();
      await expect(page.getByLabel("Kurirska služba")).toHaveCount(0);
      await page.goto("/admin/erp/preuzimanja", {
        waitUntil: "domcontentloaded",
      });
    });

    await test.step("Novi otvara editabilan nalog i datum se čuva", async () => {
      await page.getByRole("button", { name: "Novi", exact: true }).click();
      const createDialog = page.getByRole("dialog");
      await expect(
        createDialog.getByRole("option", {
          name: "X Express — sve stranice do 60 cm",
          exact: true,
        }),
      ).toBeAttached();
      await expect(
        createDialog.getByRole("option", {
          name: "MyGLS — bar jedna stranica preko 60 cm",
          exact: true,
        }),
      ).toBeAttached();
      await expect(
        createDialog.getByText("Unesite šifru da proverite naziv artikla."),
      ).toHaveCount(0);
      await createDialog.getByLabel("Kurirska služba").selectOption("MYGLS");
      await createDialog.getByRole("button", { name: "Novi", exact: true }).click();
      await expect(page).toHaveURL(
        /\/admin\/erp\/preuzimanja\/[^/?]+\?mode=edit$/,
      );
      firstBatchId = page.url().split("/").at(-1)!.split("?")[0]!;
      batchIds.push(firstBatchId);
      const batch = await db.pickupBatch.findUniqueOrThrow({
        where: { id: firstBatchId },
      });
      firstBatchNumber = batch.number;
      expect(batch.status).toBe("DRAFT");
      expect(batch.courier).toBe("COURIER_SMALL");
      expect(batch.provider).toBe("MYGLS");

      const heading = page.getByRole("heading", {
        name: `Nalog za preuzimanje ${firstBatchNumber}`,
        exact: true,
      });
      await expect(heading).toHaveCount(1);
      await expect(heading).toBeVisible();
      await expect(page.getByText("Datum naloga", { exact: true })).toBeVisible();
      const postButton = page.getByRole("button", {
        name: "Kreiraj adresnice",
        exact: true,
      });
      const blockReason = page.locator("#pickup-posting-block-reason");
      await expect(postButton).toBeDisabled();
      await expect(postButton).toHaveAttribute(
        "aria-describedby",
        "pickup-posting-block-reason",
      );
      await expect(blockReason).toContainText(
        "Učitajte bar jednu odgovarajuću kurirsku porudžbinu iz DC magacina",
      );
      await expect(page.getByText("Kliknite „Učitaj sve nefiskalizovane“.", { exact: false })).toBeVisible();
      const pickupStart = new Date(Date.now() + 72 * 60 * 60_000);
      const pickupEnd = new Date(pickupStart.getTime() + 2 * 60 * 60_000);
      await page.getByLabel("Početak preuzimanja").fill(pickupStart.toISOString().slice(0, 16));
      await page.getByLabel("Kraj preuzimanja").fill(pickupEnd.toISOString().slice(0, 16));
      await page.getByRole("button", { name: "Sačuvaj termin" }).click();
      await expect(
        page.getByRole("status").filter({
          hasText: "Termin preuzimanja je sačuvan",
        }),
      ).toBeVisible();
      const savedWindow = await db.pickupBatch.findUniqueOrThrow({
        where: { id: firstBatchId },
      });
      expect(savedWindow.pickupDate).not.toBeNull();
      expect(savedWindow.pickupWindowEnd?.getTime()).toBeGreaterThan(
        savedWindow.pickupDate!.getTime(),
      );
    });

    await test.step("Učitaj bira samo KREIRANO + kurir + DC i menja status", async () => {
      await page
        .getByRole("button", { name: "Učitaj sve nefiskalizovane", exact: true })
        .click();
      await expect(
        page.getByRole("status").filter({
          hasText: "Učitano redova: 5 iz 1 porudžbina",
        }),
      ).toBeVisible();
      const [batch, orders] = await Promise.all([
        db.pickupBatch.findUniqueOrThrow({
          where: { id: firstBatchId },
          include: { lines: { orderBy: { packageNo: "asc" } } },
        }),
        db.order.findMany({
          where: { id: { in: orderIds } },
          orderBy: { number: "asc" },
          select: { id: true, number: true, status: true },
        }),
      ]);
      expect(batch.lines).toHaveLength(5);
      expect(new Set(batch.lines.map((line) => line.orderId))).toEqual(
        new Set([eligibleOrderId]),
      );
      expect(
        orders.find((order) => order.id === eligibleOrderId)?.status,
      ).toBe("U_PRIPREMI");
      expect(
        orders.find((order) => order.number === fixture.wrongStatusOrder)?.status,
      ).toBe("POTVRDJENO");
      expect(
        orders.find((order) => order.number === fixture.wrongWarehouseOrder)
          ?.status,
      ).toBe("KREIRANO");
      expect(
        orders.find((order) => order.number === fixture.truckOrder)?.status,
      ).toBe("KREIRANO");
      expect(
        orders.find((order) => order.number === fixture.fiscalizedOrder)?.status,
      ).toBe("KREIRANO");
      expect(
        await db.orderStatusEvent.count({
          where: {
            orderId: eligibleOrderId,
            status: "U_PRIPREMI",
            actorId: adminId,
          },
        }),
      ).toBe(1);
    });

    await test.step("svih 13 kolona se popunjava i redovi su sortirani po šifri", async () => {
      for (const header of [
        "Broj porudžbine",
        "Bar kod",
        "Šifra artikla",
        "Kolekcija",
        "Kratki opis artikla",
        "Kratki naziv artikla",
        "Atribut 1",
        "Atribut 2",
        "Atribut 3",
        "Atribut 4",
        "Boja 1",
        "Boja 2",
        "Količina",
      ]) {
        await expect(
          page.getByRole("columnheader", { name: header, exact: true }),
        ).toBeVisible();
      }
      const rows = page.locator("tbody tr");
      await expect(rows).toHaveCount(5);
      await expect(rows.nth(0)).toContainText(fixture.skuA);
      await expect(rows.nth(3)).toContainText(fixture.skuZ);
      await expect(rows.nth(0)).toContainText(fixture.collection);
      await expect(rows.nth(0)).toContainText(`Kratki A ${runId}`);
      await expect(rows.nth(0)).toContainText(`Opis A ${runId}`);
      await expect(rows.nth(0)).toContainText("A-A1");
      await expect(rows.nth(0)).toContainText("A-A4");
      await expect(rows.nth(0)).toContainText("Plava");
      await expect(rows.nth(0)).toContainText("Bela");
      await expect(rows.nth(0)).toContainText("3");
    });

    await test.step("cele dimenzije paketa prolaze HTML validaciju i čuvaju se", async () => {
      const firstRow = page.locator("tbody tr").first();
      const lineId = await firstRow.locator('input[name="lineId"]').getAttribute("value");
      expect(lineId).toBeTruthy();
      await firstRow.getByLabel("kg", { exact: true }).fill("1.25");
      await firstRow.getByLabel("Š", { exact: true }).fill("70");
      await firstRow.getByLabel("D", { exact: true }).fill("20");
      await firstRow.getByLabel("V", { exact: true }).fill("30");
      await expect(
        firstRow.locator('input[type="number"]:invalid'),
      ).toHaveCount(0);
      await firstRow
        .getByRole("button", { name: "Sačuvaj mere", exact: true })
        .click();
      await expect(
        firstRow.getByRole("status").filter({
          hasText: "Stvarne mere paketa su sačuvane",
        }),
      ).toBeVisible();
      const savedLine = await db.pickupBatchLine.findUniqueOrThrow({
        where: { id: lineId! },
      });
      expect(Number(savedLine.weightKg)).toBe(1.25);
      expect(Number(savedLine.widthCm)).toBe(70);
      expect(Number(savedLine.depthCm)).toBe(20);
      expect(Number(savedLine.heightCm)).toBe(30);
    });

    await test.step("ista porudžbina ne može u drugi nalog čak ni ako joj se status ručno vrati", async () => {
      await db.order.update({
        where: { id: eligibleOrderId },
        data: { status: "KREIRANO" },
      });
      await page.getByRole("button", { name: "Novi MyGLS", exact: true }).click();
      await expect.poll(() => pickupBatchIdFromUrl(page.url())).not.toBe(
        firstBatchId,
      );
      await expect(page).toHaveURL(/\?mode=edit$/);
      secondBatchId = pickupBatchIdFromUrl(page.url());
      batchIds.push(secondBatchId);
      secondBatchNumber = (
        await db.pickupBatch.findUniqueOrThrow({ where: { id: secondBatchId } })
      ).number;
      await expect(
        page.getByRole("heading", {
          name: `Nalog za preuzimanje ${secondBatchNumber}`,
          exact: true,
        }),
      ).toHaveCount(1);
      await page
        .getByRole("button", { name: "Učitaj sve nefiskalizovane", exact: true })
        .click();
      await expect(
        page.getByRole("status").filter({
          hasText: "Nema novih porudžbina koje odgovaraju ovom kuriru",
        }),
      ).toBeVisible();
      expect(
        await db.pickupBatchLine.count({ where: { batchId: secondBatchId } }),
      ).toBe(0);
      expect(
        await db.pickupBatchLine.count({ where: { batchId: firstBatchId } }),
      ).toBe(5);
      await db.order.update({
        where: { id: eligibleOrderId },
        data: { status: "U_PRIPREMI" },
      });
    });

    await test.step("pregled, dupli klik, Uredi i Excel rade", async () => {
      await page.goto("/admin/erp/preuzimanja", {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByText(firstBatchNumber, { exact: true })).toBeVisible();
      await expect(page.getByText(secondBatchNumber, { exact: true })).toBeVisible();

      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Excel", exact: true }).click();
      const download = await downloadPromise;
      const filePath = await download.path();
      expect(filePath).toBeTruthy();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath!);
      expect(workbook.worksheets[0]?.getRow(1).values).toEqual([
        undefined,
        "Status",
        "Broj naloga",
        "Kurirska služba",
        "Datum naloga",
        "Datum preuzimanja",
        "Broj redova",
      ]);

      const secondRow = page.getByRole("row").filter({
        has: page.getByText(secondBatchNumber, { exact: true }),
      });
      await secondRow.getByText(secondBatchNumber, { exact: true }).dblclick();
      await expect(page).toHaveURL(
        new RegExp(`/admin/erp/preuzimanja/${secondBatchId}$`),
      );
      await expect(
        page.getByRole("heading", {
          name: `Nalog za preuzimanje ${secondBatchNumber}`,
          exact: true,
        }),
      ).toHaveCount(1);
      await page.getByRole("link", { name: "Uredi", exact: true }).click();
      await expect(page).toHaveURL(/\?mode=edit$/);
      await expect(
        page.getByRole("link", { name: "Završi uređivanje", exact: true }),
      ).toHaveCount(1);
      await page
        .getByRole("link", { name: "Završi uređivanje", exact: true })
        .click();
      await expect(page).toHaveURL(
        new RegExp(`/admin/erp/preuzimanja/${secondBatchId}$`),
      );
      await expect(page.getByLabel("Početak preuzimanja")).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Učitaj sve nefiskalizovane", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText("Kliknite „Uredi“, pa „Učitaj sve nefiskalizovane“.", {
          exact: true,
        }),
      ).toBeVisible();
      await page.getByRole("link", { name: "Uredi", exact: true }).click();
      await expect(page).toHaveURL(/\?mode=edit$/);
    });

    await test.step("Kreiranje adresnica je blokirano i direktni API ne može da zaobiđe obavezni termin", async () => {
      await expect(
        page.getByRole("button", { name: "Kreiraj adresnice", exact: true }),
      ).toBeDisabled();
      const response = await page.request.post(
        "/api/admin/erp/preuzimanja/commands",
        {
          data: { action: "pickup.post", ids: [secondBatchId] },
        },
      );
      expect(response.status()).toBe(400);
      expect((await response.json()).error).toContain(
        "Početak i kraj termina preuzimanja su obavezni",
      );
      expect(
        (
          await db.pickupBatch.findUniqueOrThrow({ where: { id: secondBatchId } })
        ).status,
      ).toBe("DRAFT");
      expect(
        (
          await db.pickupBatch.findUniqueOrThrow({ where: { id: secondBatchId } })
        ).labelsCreationStartedAt,
      ).toBeNull();
    });

    await test.step("Obriši u detalju briše prazan nalog", async () => {
      await acceptConfirmation(
        page,
        page.getByRole("button", { name: "Obriši", exact: true }),
      );
      await expect(page).toHaveURL(/\/admin\/erp\/preuzimanja$/);
      await expect
        .poll(() => db.pickupBatch.findUnique({ where: { id: secondBatchId } }))
        .toBeNull();
      batchIds.splice(batchIds.indexOf(secondBatchId), 1);
    });

    await test.step("uklanjanje porudžbine briše sve njene redove i vraća Kreirano", async () => {
      await page.goto(`/admin/erp/preuzimanja/${firstBatchId}?mode=edit`, {
        waitUntil: "domcontentloaded",
      });
      await acceptConfirmation(
        page,
        page
          .getByRole("button", { name: "Ukloni porudžbinu", exact: true })
          .first(),
      );
      await expect
        .poll(() =>
          db.pickupBatchLine.count({ where: { batchId: firstBatchId } }),
        )
        .toBe(0);
      await expect(
        page.getByText("Nalog još nema učitanih porudžbina.", { exact: true }),
      ).toBeVisible();
      expect(
        (
          await db.order.findUniqueOrThrow({ where: { id: eligibleOrderId } })
        ).status,
      ).toBe("KREIRANO");
      expect(
        await db.orderStatusEvent.count({
          where: {
            orderId: eligibleOrderId,
            status: "KREIRANO",
            actorId: adminId,
          },
        }),
      ).toBe(1);
    });

    await test.step("ponovno učitavanje radi, a brisanje iz pregleda opet vraća status", async () => {
      await page
        .getByRole("button", { name: "Učitaj sve nefiskalizovane", exact: true })
        .click();
      await expect(
        page.getByRole("status").filter({
          hasText: "Učitano redova: 5 iz 1 porudžbina",
        }),
      ).toBeVisible();
      await page.goto("/admin/erp/preuzimanja", {
        waitUntil: "domcontentloaded",
      });
      const row = page.getByRole("row").filter({
        has: page.getByText(firstBatchNumber, { exact: true }),
      });
      await row.getByRole("checkbox").click();
      await acceptConfirmation(
        page,
        page.getByRole("button", { name: /Obriši \(1\)/ }),
      );
      await expect(
        page.getByRole("status").filter({ hasText: "Obrisano naloga: 1" }),
      ).toBeVisible();
      await expect
        .poll(() => db.pickupBatch.findUnique({ where: { id: firstBatchId } }))
        .toBeNull();
      batchIds.splice(batchIds.indexOf(firstBatchId), 1);
      expect(
        (
          await db.order.findUniqueOrThrow({ where: { id: eligibleOrderId } })
        ).status,
      ).toBe("KREIRANO");
    });

    expect(pageErrors).toEqual([]);
  });

  async function createProduct(input: {
    sku: string;
    slug: string;
    barcode: string;
    shortName: string;
    shortDescription: string;
    attribute1: string;
    attribute2: string;
    attribute3: string;
    attribute4: string;
    colorPrimary: string;
    colorSecondary: string;
  }) {
    return db.product.create({
      data: {
        ...input,
        name: input.shortName,
        description: input.shortDescription,
        fullPrice: 1_000,
        collectionId,
        packWidthCm: 70,
        packDepthCm: 20,
        packHeightCm: 20,
        packGrossWeightKg: 1.25,
      },
      select: {
        id: true,
        sku: true,
        name: true,
        shortName: true,
        shortDescription: true,
        attribute1: true,
        attribute2: true,
        attribute3: true,
        attribute4: true,
        colorPrimary: true,
        colorSecondary: true,
      },
    });
  }

  async function createOrder(input: {
    number: string;
    status: "KREIRANO" | "POTVRDJENO";
    shippingMethod: "KURIR" | "KAMION";
    lines: Array<{
      product: {
        id: string;
        sku: string;
        name: string;
        shortName: string | null;
        shortDescription: string | null;
        attribute1: string | null;
        attribute2: string | null;
        attribute3: string | null;
        attribute4: string | null;
        colorPrimary: string | null;
        colorSecondary: string | null;
      };
      warehouseId: string | null;
      qty: number;
    }>;
  }) {
    return db.order.create({
      data: {
        number: input.number,
        status: input.status,
        channel: "WEB",
        subtotal: 1_000,
        total: 1_000,
        shippingMethod: input.shippingMethod,
        paymentMethod: "POUZECE_GOTOVINA",
        shipFirstName: "QA",
        shipLastName: "Pickup",
        shipPhone: "+38160111222",
        shipStreet: "Test 13",
        shipCity: "Beograd",
        shipPostalCode: "11000",
        guestEmail: `qa.order.${input.number}@example.invalid`,
        termsAcceptedAt: new Date(),
        items: {
          create: input.lines.map(({ product, warehouseId, qty }) => ({
            productId: product.id,
            sku: product.sku,
            name: product.name,
            qty,
            unitPriceFull: 1_000,
            unitPriceSale: 1_000,
            warehouseId,
            warehouseReservedQty: qty,
            collectionName: fixture.collection,
            shortDescriptionSnapshot: product.shortDescription,
            shortNameSnapshot: product.shortName,
            attribute1: product.attribute1,
            attribute2: product.attribute2,
            attribute3: product.attribute3,
            attribute4: product.attribute4,
            color1: product.colorPrimary,
            color2: product.colorSecondary,
          })),
        },
      },
      select: { id: true },
    });
  }

  async function cleanup() {
    if (!db) return;
    if (batchIds.length) {
      await db.pickupBatch.deleteMany({
        where: { id: { in: Array.from(new Set(batchIds)) } },
      });
    }
    if (orderIds.length) {
      await db.fiscalReceipt.deleteMany({
        where: { orderId: { in: orderIds } },
      });
      await db.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (productIds.length) {
      await db.product.deleteMany({ where: { id: { in: productIds } } });
    }
    if (collectionId) {
      await db.collection.deleteMany({ where: { id: collectionId } });
    }
    if (createdDcWarehouse || otherWarehouseId) {
      await db.warehouse.deleteMany({
        where: {
          id: {
            in: [createdDcWarehouse ? dcWarehouseId : "", otherWarehouseId].filter(
              Boolean,
            ),
          },
        },
      });
    }
    if (adminId) {
      await db.auditLog.deleteMany({ where: { actorId: adminId } });
    }
    await db.rateLimitBucket.deleteMany({
      where: { key: { contains: fixture.adminEmail } },
    });
    await db.adminUser.deleteMany({ where: { email: fixture.adminEmail } });
  }
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
  if (!raw) throw new Error("Database URL is required for Modul 13 acceptance.");
  const url = new URL(raw);
  const schema = url.searchParams.get("schema")?.trim() || undefined;
  url.searchParams.delete("schema");
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (!isLocal && process.env.E2E_ALLOW_REMOTE_DATABASE !== "1") {
    throw new Error(
      "Remote Modul 13 acceptance requires E2E_ALLOW_REMOTE_DATABASE=1.",
    );
  }
  if (!isLocal) {
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

function pickupBatchIdFromUrl(value: string) {
  return new URL(value).pathname.split("/").at(-1) ?? "";
}
