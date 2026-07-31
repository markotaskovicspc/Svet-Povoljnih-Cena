// Acceptance: CAT-01
import ExcelJS from "exceljs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";
import { nextAvailableArticleSku } from "@/lib/article-sku";

loadEnv({ path: ".env.local" });
loadEnv();

test.describe("article master acceptance", () => {
  test.skip(
    process.env.E2E_ARTICLE_MASTER !== "1",
    "Set E2E_ARTICLE_MASTER=1 to run the isolated article-master suite.",
  );

  test.setTimeout(900_000);
  const runId = `${Date.now()}-${process.pid}`;
  const tag = `QA-ARTICLE-${runId}`;
  const adminEmail = `qa.article.${runId}@example.invalid`;
  const adminPassword = `QaArticle!${runId}x`;
  let db: PrismaClient;
  let productId = "";
  let productSku = "";
  let productSlug = "";
  let warehouseId = "";
  let secondaryWarehouseId = "";
  let supplierId = "";
  let rootCategoryId = "";
  let generatedProductId = "";

  test.beforeAll(async () => {
    db = createDatabaseClient();
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    await db.adminUser.create({
      data: {
        email: adminEmail,
        passwordHash,
        role: "SUPER",
        enabled: true,
        firstName: "QA",
        lastName: "Article master",
      },
    });
    await db.warehouse.updateMany({
      data: { isDefault: false },
    });
    const warehouse = await db.warehouse.upsert({
      where: { code: "DC" },
      create: {
        code: "DC",
        name: "Distributivni centar",
        active: true,
        isDefault: true,
      },
      update: {
        active: true,
        isDefault: true,
      },
    });
    warehouseId = warehouse.id;
    const secondaryWarehouse = await db.warehouse.create({
      data: {
        code: `STORE-${runId}`.slice(0, 40),
        name: `${tag} prodavnica`,
        active: true,
        isDefault: false,
      },
    });
    secondaryWarehouseId = secondaryWarehouse.id;
    const rootCategory = await db.category.create({
      data: {
        name: `${tag} korenska kategorija`,
        slug: `qa-root-${runId}`,
        path: `/qa-root-${runId}`,
        level: 0,
      },
    });
    rootCategoryId = rootCategory.id;
    const supplier = await db.supplier.create({
      data: {
        code: `DOB-${runId}`.slice(0, 40),
        name: `${tag} dobavljač`,
        parity: "DAP",
        deliveryDays: 14,
      },
    });
    supplierId = supplier.id;
    const product = await db.product.create({
      data: {
        sku: `QA-${runId}`.slice(0, 80),
        slug: `qa-article-${runId}`,
        name: `${tag} početni`,
        shortName: "Početni",
        description: "Početni opis",
        shortDescription: "Početni opis",
        fullPrice: 1000,
        stock: 12,
        widthCm: 10,
        depthCm: 20,
        heightCm: 30,
        articleStatus: "UZ",
        isActive: false,
        availableWebManual: true,
        availableWholesaleManual: true,
        availableExportManual: true,
        warehouseStocks: {
          create: [
            { warehouseId, qty: 8 },
            { warehouseId: secondaryWarehouseId, qty: 4 },
          ],
        },
        media: {
          create: {
            kind: "IMAGE",
            url: `products/${runId}/qa.jpg`,
            thumbUrl: `products/${runId}/qa-thumb.jpg`,
            cardUrl: `products/${runId}/qa-card.jpg`,
            pdpUrl: `products/${runId}/qa-pdp.jpg`,
            alt: `${tag} fotografija`,
            order: 0,
          },
        },
      },
    });
    productId = product.id;
    productSku = product.sku;
    productSlug = product.slug;
    await db.priceList.create({
      data: {
        code: `QA-RETAIL-${runId}`.slice(0, 80),
        name: `${tag} maloprodajni cenovnik`,
        kind: "RETAIL",
        currency: "RSD",
        active: true,
        validFrom: new Date("2026-01-01T00:00:00.000Z"),
        entries: {
          create: {
            productId,
            price: 1000,
            validFrom: new Date("2026-01-01T00:00:00.000Z"),
          },
        },
      },
    });
    const partner = await db.partnerApiClient.create({
      data: {
        name: `${tag} partner`,
        keyPrefix: `qa_${runId}`.slice(0, 80),
        keyHash: "qa",
        scopes: ["inventory:read"],
      },
    });
    await db.partnerReservation.create({
      data: {
        clientId: partner.id,
        productId,
        warehouseId,
        externalRef: `${tag}-partner`,
        idempotencyKey: `${tag}-partner`,
        qty: 1,
      },
    });
    const order = await db.order.create({
      data: {
        number: `QA-ORD-${runId}`.slice(0, 80),
        guestEmail: `buyer.${runId}@example.invalid`,
        status: "KREIRANO",
        subtotal: 2000,
        total: 2000,
        shippingMethod: "KURIR",
        paymentMethod: "POUZECE_GOTOVINA",
        shipFirstName: "QA",
        shipLastName: "Kupac",
        shipPhone: "0600000000",
        shipStreet: "Test 1",
        shipCity: "Beograd",
        shipPostalCode: "11000",
        termsAcceptedAt: new Date(),
        items: {
          create: {
            productId,
            sku: product.sku,
            name: product.name,
            qty: 2,
            unitPriceFull: 1000,
            unitPriceSale: 1000,
            warehouseId,
            warehouseReservedQty: 2,
          },
        },
      },
    });
    await db.stockMovement.create({
      data: {
        idempotencyKey: `${tag}-movement`,
        warehouseId,
        productId,
        orderId: order.id,
        kind: "SALE_RESERVATION",
        sku: product.sku,
        qty: -2,
        note: "QA rezervacija",
        balanceAfterWarehouse: 8,
        balanceAfterTotal: 8,
      },
    });
  });

  test.afterAll(async () => {
    if (!db) return;
    try {
      await cleanup();
    } finally {
      await db.$disconnect();
    }
  });

  test("edits the full card, calculates stock/channels and imports XLSX", async ({
    context,
    page,
  }) => {
    const runtimeErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });
    page.on("pageerror", (error) => {
      runtimeErrors.push(error.message);
    });
    await context.addCookies([
      {
        name: "spc_cookie_consent",
        value: "essential",
        url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3107",
      },
    ]);
    await login(page);

    await page.goto(`/admin/erp/artikli/${productId}`, {
      waitUntil: "load",
    });
    const productForm = page
      .locator("form")
      .filter({ has: page.getByRole("button", { name: "Sačuvaj izmene" }) });
    await expect(productForm.locator('input[name="sku"]')).toBeEditable();
    expect(
      await productForm
        .locator('[name="sku"], [name="shortDescription"], [name="name"]')
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute("name")),
        ),
    ).toEqual(["sku", "shortDescription", "name"]);
    productSku = `QA-MANUAL-${runId}`.slice(0, 80);
    await productForm.locator('input[name="sku"]').fill(productSku);
    const shortNameInput = page.getByLabel("Kratki naziv");
    await expect(shortNameInput).toBeVisible();
    await page.waitForTimeout(750);
    await shortNameInput.fill("N2212");
    await page.getByLabel("Status artikla").selectOption("SP");
    await page.locator('select[name="supplierId"]').selectOption(supplierId);
    await page.locator('select[name="categoryId"]').selectOption(rootCategoryId);
    await page.getByLabel("Nova grupa").fill(`${tag} grupa`);
    await page.getByLabel("Nova kolekcija").fill(`${tag} kolekcija`);
    await page
      .getByLabel("Kratki opis za kartice, naziv i dokumente")
      .fill("Otvorena polica");
    await page.getByLabel("Atribut 1").fill("Hrast");
    await page.getByLabel("Atribut 2").fill("Metal");
    await page.getByLabel("Boja 1").fill("Natur");
    await page.getByLabel("Benefiti (odvojeni zarezom)").fill("Masiv, Laka montaža");
    await page.getByLabel("Sertifikati (odvojeni zarezom)").fill("FSC");
    await page.locator('textarea[name="materialText"]').fill("Hrast + čelik");
    await page.locator('input[name="stock"]').fill("25");
    await page
      .locator('input[name="stockAdjustmentReason"]')
      .fill("QA usklađivanje fizičkog stanja");
    await page.getByLabel("Novo do").fill("2027-12-31");
    await expect(page.locator('input[name="tncFrom"]')).toHaveCount(0);
    await expect(page.locator('input[name="tncUntil"]')).toHaveCount(0);
    const richTextEditor = page.getByRole("textbox", {
      name: "Formatirani opis za sajt",
    });
    await richTextEditor.click();
    await richTextEditor.pressSequentially("Kursor ostaje stabilan", { delay: 10 });
    await expect(richTextEditor).toContainText("Kursor ostaje stabilan");
    await richTextEditor.evaluate(
      (element) => {
        element.innerHTML =
          '<h2 onclick="alert(1)">Naslov</h2><p>Bezbedan <strong>opis</strong></p>';
        element.dispatchEvent(new InputEvent("input", { bubbles: true }));
      },
    );
    await page.getByRole("button", { name: "Sačuvaj izmene" }).click();
    await expect
      .poll(async () => {
        const product = await db.product.findUniqueOrThrow({
          where: { id: productId },
          select: {
            sku: true,
            name: true,
            shortName: true,
            shortDescription: true,
            description: true,
            stock: true,
            articleStatus: true,
            isNew: true,
            materialText: true,
            availableWebAuto: true,
            availableWholesaleAuto: true,
            availableExportAuto: true,
            supplier: { select: { parity: true, deliveryDays: true } },
            collection: { select: { name: true } },
            syncOverrides: true,
            categories: {
              select: {
                category: {
                  select: {
                    name: true,
                    parent: { select: { id: true, name: true } },
                  },
                },
              },
            },
            lookupAssignments: {
              select: { lookupValue: { select: { kind: true, value: true } } },
            },
          },
        });
        return {
          sku: product.sku,
          name: product.name,
          shortName: product.shortName,
          shortDescription: product.shortDescription,
          description: product.description,
          stock: product.stock,
          status: product.articleStatus,
          isNew: product.isNew,
          material: product.materialText,
          channels: [
            product.availableWebAuto,
            product.availableWholesaleAuto,
            product.availableExportAuto,
          ],
          parity: product.supplier?.parity,
          deliveryDays: product.supplier?.deliveryDays,
          collection: product.collection?.name,
          overrides:
            product.syncOverrides &&
            typeof product.syncOverrides === "object" &&
            !Array.isArray(product.syncOverrides) &&
            Array.isArray(product.syncOverrides.fields)
              ? product.syncOverrides.fields
              : [],
          category: product.categories[0]?.category.name,
          categoryParentId: product.categories[0]?.category.parent?.id,
          lookups: product.lookupAssignments
            .map((row) => `${row.lookupValue.kind}:${row.lookupValue.value}`)
            .sort(),
        };
      }, { timeout: 120_000 })
      .toEqual({
        sku: productSku,
        name: `${tag} kolekcija Otvorena polica N2212`,
        shortName: "N2212",
        shortDescription: "Otvorena polica",
        description: "<h2>Naslov</h2><p>Bezbedan <strong>opis</strong></p>",
        stock: 27,
        status: "SP",
        isNew: true,
        material: "Hrast + čelik",
        channels: [true, true, true],
        parity: "DAP",
        deliveryDays: 14,
        collection: `${tag} kolekcija`,
        overrides: expect.arrayContaining([
          "description",
          "flags",
          "grouping",
          "identity",
          "name",
        ]),
        category: `${tag} korenska kategorija`,
        categoryParentId: undefined,
        lookups: [
          "ATTRIBUTE:Hrast",
          "ATTRIBUTE:Metal",
          "BENEFIT:Laka montaža",
          "BENEFIT:Masiv",
          "CERTIFICATE:FSC",
          "COLOR:Natur",
        ],
      });
    await expect(productForm.locator('input[name="sku"]')).toHaveValue(productSku);
    await expect(productForm.locator('[name="shortDescription"]')).toHaveValue(
      "Otvorena polica",
    );
    await expect(productForm.locator('select[name="articleStatus"]')).toHaveValue(
      "SP",
    );

    const mediaForm = page
      .locator("form")
      .filter({ has: page.getByRole("button", { name: "Sačuvaj medij" }) });
    await expect(mediaForm).toHaveCount(1);
    await mediaForm.locator('input[name="order"]').fill("2");
    await mediaForm.locator('input[name="alt"]').fill(`${tag} izmenjen alt`);
    await mediaForm.getByRole("button", { name: "Sačuvaj medij" }).click();
    await expect(mediaForm.getByRole("status")).toContainText("Medij je sačuvan", {
      timeout: 120_000,
    });
    await page.reload({ waitUntil: "load" });
    await expect(
      page
        .locator("form")
        .filter({ has: page.getByRole("button", { name: "Sačuvaj medij" }) })
        .locator('input[name="alt"]'),
    ).toHaveValue(`${tag} izmenjen alt`);
    await expect
      .poll(() =>
        db.productMedia.findFirst({
          where: { productId },
          select: { alt: true, order: true },
        }),
      )
      .toEqual({ alt: `${tag} izmenjen alt`, order: 2 });

    const declarationSection = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Deklaracija", exact: true }),
    });
    await expect(declarationSection).toHaveCount(1);
    await declarationSection
      .locator('input[name="label"]')
      .fill(`${tag} deklaracija`);
    await declarationSection
      .locator('input[name="file"]')
      .setInputFiles(path.resolve("public/logo.jpeg"));
    await declarationSection
      .getByRole("button", { name: "Dodaj dokument", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Dokument je dodat.", {
      timeout: 120_000,
    });
    await expect
      .poll(
        () =>
          db.productAttachment.count({
            where: { productId, label: `${tag} deklaracija` },
          }),
        { timeout: 120_000 },
      )
      .toBe(1);
    await page.reload({ waitUntil: "load" });

    const attachmentLabel = declarationSection.locator(
      'input[aria-label="Naziv dokumenta"]',
    );
    await expect(attachmentLabel).toHaveCount(1);
    await attachmentLabel.fill(`${tag} deklaracija v2`);
    await declarationSection
      .getByRole("button", { name: "Sačuvaj naziv dokumenta", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Dokument je sačuvan.", {
      timeout: 120_000,
    });
    await page.reload({ waitUntil: "load" });
    const reloadedDeclarationSection = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Deklaracija", exact: true }),
    });
    await expect(
      reloadedDeclarationSection.locator(
        'input[aria-label="Naziv dokumenta"]',
      ),
    ).toHaveValue(`${tag} deklaracija v2`);

    await clickConfirmation(
      page,
      reloadedDeclarationSection.getByRole("button", {
        name: "Obriši dokument",
        exact: true,
      }),
      true,
    );
    await expect(page.getByRole("status")).toContainText("Dokument je obrisan.", {
      timeout: 120_000,
    });
    await expect
      .poll(() => db.productAttachment.count({ where: { productId } }), {
        timeout: 120_000,
      })
      .toBe(0);

    await page.goto(`/p/${productSlug}`, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: `${tag} kolekcija Otvorena polica N2212`,
      }),
    ).toBeVisible();

    await page.goto(`/admin/erp/artikli/${productId}`, { waitUntil: "load" });
    await expect(page.getByLabel("Web check")).toBeChecked();
    await page.waitForTimeout(500);
    await page.getByLabel("Web check").uncheck();
    await page.getByRole("button", { name: "Sačuvaj izmene" }).click();
    await expect
      .poll(
        () =>
          db.product.findUniqueOrThrow({
            where: { id: productId },
            select: { availableWebManual: true },
          }),
        { timeout: 120_000 },
      )
      .toEqual({ availableWebManual: false });
    await expect
      .poll(
        async () => (await page.request.get(`/p/${productSlug}`)).status(),
        { timeout: 120_000 },
      )
      .toBe(404);

    await page.goto(`/admin/erp/artikli/${productId}`, { waitUntil: "load" });
    await page.waitForTimeout(500);
    await page.getByLabel("Web check").check();
    await page.getByRole("button", { name: "Sačuvaj izmene" }).click();
    await expect
      .poll(
        () =>
          db.product.findUniqueOrThrow({
            where: { id: productId },
            select: { availableWebManual: true },
          }),
        { timeout: 120_000 },
      )
      .toEqual({ availableWebManual: true });

    await page.goto(`/admin/erp/artikli/${productId}/zalihe`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByText("Fizičko stanje").first()).toBeVisible();
    await expect(page.getByText("29", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("3", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("26", { exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole("cell", { name: `${tag} prodavnica` }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /QA-ORD-/ }).first()).toBeVisible();
    await expect(page.getByText(`${tag} partner`)).toBeVisible();
    await page
      .getByRole("combobox", { name: "Magacin", exact: true })
      .selectOption(warehouseId);
    await page.getByRole("textbox", { name: "Kupac", exact: true }).fill("QA Kupac");
    await page.getByRole("button", { name: "Primeni", exact: true }).click();
    await expect(
      page.getByRole("link", {
        name: new RegExp(`QA-ORD-${runId}.*QA Kupac`),
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Nema kretanja za izabrane filtere."),
    ).toHaveCount(0);

    const rowsResponse = await page.request.get(
      `/api/admin/erp/artikli/rows?warehouseId=${warehouseId}&q=${encodeURIComponent(productSku)}&searchColumn=sku&columns=${encodeURIComponent(
        JSON.stringify([
          "sku",
          "stockTotal",
          "reservedStock",
          "availableTotal",
          "stockDc",
          "availableDc",
          "webAuto",
          "wholesaleAuto",
          "exportAuto",
        ]),
      )}`,
    );
    expect(rowsResponse.ok()).toBe(true);
    const rowsPayload = (await rowsResponse.json()) as {
      rows: Array<{ id: string; values: Record<string, unknown> }>;
    };
    expect(rowsPayload.rows.find((row) => row.id === productId)?.values).toMatchObject({
      stockTotal: 29,
      reservedStock: 3,
      availableTotal: 26,
      stockDc: 25,
      availableDc: 22,
      webAuto: true,
      wholesaleAuto: true,
      exportAuto: true,
    });
    const secondaryRowsResponse = await page.request.get(
      `/api/admin/erp/artikli/rows?warehouseId=${secondaryWarehouseId}&q=${encodeURIComponent(productSku)}&searchColumn=sku&columns=${encodeURIComponent(
        JSON.stringify([
          "sku",
          "stockTotal",
          "reservedStock",
          "availableTotal",
          "stockDc",
          "availableDc",
        ]),
      )}`,
    );
    expect(secondaryRowsResponse.ok()).toBe(true);
    const secondaryRowsPayload = (await secondaryRowsResponse.json()) as {
      rows: Array<{ id: string; values: Record<string, unknown> }>;
    };
    expect(
      secondaryRowsPayload.rows.find((row) => row.id === productId)?.values,
    ).toMatchObject({
      stockTotal: 29,
      reservedStock: 0,
      availableTotal: 26,
      stockDc: 4,
      availableDc: 4,
    });

    const exportResponse = await page.request.get(
      `/api/admin/erp/artikli/export?warehouseId=${warehouseId}`,
    );
    expect(exportResponse.ok()).toBe(true);
    expect(exportResponse.headers()["content-type"]).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const exportedWorkbook = new ExcelJS.Workbook();
    await exportedWorkbook.xlsx.load((await exportResponse.body()) as never);
    const exportedSheet = exportedWorkbook.worksheets[0]!;
    const exportedHeaders = (exportedSheet.getRow(1).values as unknown[])
      .slice(1)
      .map(String);
    expect(exportedHeaders).toEqual(
      expect.arrayContaining([
        "Foto",
        "Šifra",
        "Ukupno fizičko stanje",
        "Rezervisano",
        "Ukupno raspoloživo",
      ]),
    );
    const exportedSkuColumn = exportedHeaders.indexOf("Šifra") + 1;
    const exportedPhotoColumn = exportedHeaders.indexOf("Foto") + 1;
    const exportedProductRow = exportedSheet
      .getRows(2, exportedSheet.rowCount - 1)
      ?.find((row) => row.getCell(exportedSkuColumn).text === productSku);
    expect(exportedProductRow?.getCell(exportedPhotoColumn).text).toContain(
      `/products/${runId}/qa-thumb.jpg`,
    );

    const importWorkbook = new ExcelJS.Workbook();
    const sheet = importWorkbook.addWorksheet("Artikli");
    sheet.addRow([
      "Kratki naziv",
      "Status",
      "Foto",
      "Dobavljač",
      "Kategorija",
      "Podgrupa",
      "Grupa",
      "Kolekcija",
      "Atribut 1",
      "Boja 1",
      "Benefiti",
      "Opis za sajt",
      "Zalihe",
      "Web check",
      "VP check",
      "INO check",
      "Sertifikati",
      "Novo do",
      "T&C od",
      "T&C do",
      "MPC",
    ]);
    sheet.addRow([
      `${tag} XLSX`,
      "DTZ",
      "https://placehold.co/48x48.png",
      `${tag} dobavljač`,
      `${tag} kategorija`,
      `${tag} podgrupa`,
      `${tag} XLSX grupa`,
      `${tag} XLSX kolekcija`,
      "Bambus",
      "Crna",
      "Sklopivo",
      "<p>XLSX opis</p>",
      22,
      "Da",
      "Da",
      "Da",
      "FSC",
      new Date("2027-06-30T00:00:00Z"),
      new Date("2026-08-01T00:00:00Z"),
      new Date("2026-12-31T00:00:00Z"),
      4999,
    ]);
    const xlsx = Buffer.from(await importWorkbook.xlsx.writeBuffer());
    await page.goto("/admin/erp/artikli/import", {
      waitUntil: "domcontentloaded",
    });
    await page.getByLabel("XLSX datoteka").setInputFiles({
      name: `article-master-qa-${runId}.xlsx`,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: xlsx,
    });
    const initialImportResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/admin/erp/articles/import") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Proveri i uvezi" }).click();
    const initialImportResponse = await initialImportResponsePromise;
    const initialImportPayload = await initialImportResponse.json();
    expect(initialImportResponse.ok(), JSON.stringify(initialImportPayload)).toBe(true);
    await expect(page.getByRole("status")).toContainText("Uvezeno artikala: 1", {
      timeout: 120_000,
    });
    await expect
      .poll(
        () =>
          db.product.findFirst({
            where: { shortName: `${tag} XLSX` },
            select: {
              stock: true,
              availableWebAuto: true,
              availableWholesaleAuto: true,
              availableExportAuto: true,
            },
          }),
        { timeout: 120_000 },
      )
      .toMatchObject({
        stock: 22,
        availableWebAuto: true,
        availableWholesaleAuto: true,
        availableExportAuto: true,
      });
    const imported = await db.product.findFirstOrThrow({
      where: { shortName: `${tag} XLSX` },
      select: {
        sku: true,
        name: true,
        stock: true,
        availableWebAuto: true,
        availableWholesaleAuto: true,
        availableExportAuto: true,
        isNew: true,
        tncFrom: true,
        tncUntil: true,
        media: {
          where: { kind: "IMAGE" },
          take: 1,
          orderBy: { order: "asc" },
          select: { url: true },
        },
        categories: { select: { category: { select: { name: true } } } },
      },
    });
    expect(imported).toMatchObject({
      name: `${tag} XLSX kolekcija ${tag} XLSX`,
      stock: 22,
      availableWebAuto: true,
      availableWholesaleAuto: true,
      availableExportAuto: true,
      isNew: true,
    });
    expect(imported.sku).toMatch(/^\d+$/);
    expect(Number(imported.sku)).toBeGreaterThan(100_000);
    expect(imported.categories[0]?.category.name).toBe(`${tag} podgrupa`);
    expect(imported.media[0]?.url).toBe(
      "https://placehold.co/48x48.png",
    );
    expect(imported.tncFrom?.toISOString().slice(0, 10)).toBe("2026-08-01");
    expect(imported.tncUntil?.toISOString().slice(0, 10)).toBe("2026-12-31");

    const partialWorkbook = new ExcelJS.Workbook();
    const partialSheet = partialWorkbook.addWorksheet("Artikli");
    partialSheet.addRow(["Šifra", "Kratki naziv", "Ukupno fizičko stanje"]);
    partialSheet.addRow([productSku, "N2212 Excel", 12]);
    await page.getByLabel("XLSX datoteka").setInputFiles({
      name: `article-master-partial-update-${runId}.xlsx`,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(await partialWorkbook.xlsx.writeBuffer()),
    });
    const partialImportResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/admin/erp/articles/import") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Proveri i uvezi" }).click();
    const partialImportResponse = await partialImportResponsePromise;
    const partialImportPayload = await partialImportResponse.json();
    expect(partialImportResponse.ok(), JSON.stringify(partialImportPayload)).toBe(true);
    await expect(page.getByRole("status")).toContainText("Uvezeno artikala: 1", {
      timeout: 120_000,
    });
    const preserved = await db.product.findUniqueOrThrow({
      where: { id: productId },
      select: {
        name: true,
        shortName: true,
        articleStatus: true,
        supplierId: true,
        groupId: true,
        collection: { select: { name: true } },
        description: true,
        materialText: true,
        attribute1: true,
        colorPrimary: true,
        stock: true,
        isNew: true,
        availableWebAuto: true,
        availableWholesaleAuto: true,
        availableExportAuto: true,
        categories: {
          select: {
            category: {
              select: {
                name: true,
                parentId: true,
              },
            },
          },
        },
        lookupAssignments: {
          select: {
            lookupValue: { select: { kind: true, value: true } },
          },
        },
      },
    });
    expect(preserved).toMatchObject({
      name: `${tag} kolekcija Otvorena polica N2212 Excel`,
      shortName: "N2212 Excel",
      articleStatus: "SP",
      supplierId,
      collection: { name: `${tag} kolekcija` },
      description: "<h2>Naslov</h2><p>Bezbedan <strong>opis</strong></p>",
      materialText: "Hrast + čelik",
      attribute1: "Hrast",
      colorPrimary: "Natur",
      stock: 14,
      isNew: true,
      availableWebAuto: true,
      availableWholesaleAuto: false,
      availableExportAuto: false,
    });
    expect(preserved.groupId).toBeTruthy();
    expect(preserved.categories[0]?.category).toMatchObject({
      name: `${tag} korenska kategorija`,
      parentId: null,
    });
    expect(
      preserved.lookupAssignments
        .map((item) => `${item.lookupValue.kind}:${item.lookupValue.value}`)
        .sort(),
    ).toEqual([
      "ATTRIBUTE:Hrast",
      "ATTRIBUTE:Metal",
      "BENEFIT:Laka montaža",
      "BENEFIT:Masiv",
      "CERTIFICATE:FSC",
      "COLOR:Natur",
    ]);

    const rejectedWorkbook = new ExcelJS.Workbook();
    const rejectedSheet = rejectedWorkbook.addWorksheet("Artikli");
    rejectedSheet.addRow([
      "Kratki naziv",
      "Status",
      "Dobavljač",
      "T&C od",
      "T&C do",
    ]);
    rejectedSheet.addRow([`${tag} ne sme biti upisan`, "SP", "", "", ""]);
    rejectedSheet.addRow([
      `${tag} neispravan`,
      "POGREŠAN",
      "Dobavljač koji ne postoji",
      "2027-12-31",
      "2027-01-01",
    ]);
    await page.getByLabel("XLSX datoteka").setInputFiles({
      name: "article-master-rejected.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(await rejectedWorkbook.xlsx.writeBuffer()),
    });
    await page.getByRole("button", { name: "Proveri i uvezi" }).click();
    const importAlert = page
      .getByRole("alert")
      .filter({ hasText: "Cela datoteka je odbijena" });
    await expect(importAlert).toBeVisible();
    await expect(importAlert).toContainText(
      "Status mora biti SP, IT, DTZ, DOB, ARH ili UZ",
    );
    await expect(importAlert).toContainText(
      "T&C datum od ne može biti posle datuma do",
    );
    expect(
      await db.product.count({
        where: {
          shortName: {
            in: [`${tag} ne sme biti upisan`, `${tag} neispravan`],
          },
        },
      }),
    ).toBe(0);

    const unexpectedRuntimeErrors = runtimeErrors.filter(
      (message) =>
        !message.includes("server responded with a status of 404") &&
        !message.includes("server responded with a status of 422"),
    );
    expect(unexpectedRuntimeErrors).toEqual([]);
  });

  test("creates the smallest numeric SKU and rejects a duplicate manual SKU", async ({
    page,
  }) => {
    await login(page);
    const existingSkus = await db.product.findMany({ select: { sku: true } });
    const expectedSku = nextAvailableArticleSku(
      existingSkus.map(({ sku }) => sku),
    );

    await page.goto("/admin/erp/artikli", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(10_000);
    await page.getByRole("button", { name: "Unos novog", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/erp\/artikli\/[^/]+$/, {
      timeout: 180_000,
    });
    generatedProductId = new URL(page.url()).pathname.split("/").pop() ?? "";
    expect(generatedProductId).not.toBe("");
    const generated = await db.product.findUniqueOrThrow({
      where: { id: generatedProductId },
      select: { sku: true },
    });
    expect(generated.sku).toBe(expectedSku);

    const form = page
      .locator("form")
      .filter({ has: page.getByRole("button", { name: "Sačuvaj izmene" }) });
    const skuInput = form.locator('input[name="sku"]');
    await skuInput.fill(productSku);
    await form.getByRole("button", { name: "Sačuvaj izmene" }).click();
    const requiredFieldsAlert = form.getByRole("alert");
    await expect(requiredFieldsAlert).toContainText(
      "Popunite obavezna polja pre čuvanja",
    );
    await expect(requiredFieldsAlert).toContainText("Širina (cm)");
    await expect(requiredFieldsAlert).toContainText("Dubina (cm)");
    await expect(requiredFieldsAlert).toContainText("Visina (cm)");
    await expect(requiredFieldsAlert).toBeFocused();

    await form.locator('input[name="widthCm"]').fill("1");
    await form.locator('input[name="depthCm"]').fill("1");
    await form.locator('input[name="heightCm"]').fill("1");
    await form.getByRole("button", { name: "Sačuvaj izmene" }).click();
    await expect(form.getByRole("alert")).toContainText("već postoji", {
      timeout: 180_000,
    });
    await expect(form.getByRole("alert")).toBeFocused();
    await expect(
      db.product.findUniqueOrThrow({
        where: { id: generatedProductId },
        select: { sku: true },
      }),
    ).resolves.toEqual({ sku: expectedSku });

    const qaSku = `QA-AUTO-${runId}`.slice(0, 80);
    await form.locator('input[name="widthCm"]').fill("1");
    await form.locator('input[name="depthCm"]').fill("1");
    await form.locator('input[name="heightCm"]').fill("1");
    await skuInput.fill(qaSku);
    await form.getByLabel("Kratki naziv").fill(`${tag} automatska šifra`);
    await form.getByRole("button", { name: "Sačuvaj izmene" }).click();
    await expect
      .poll(
        () =>
          db.product.findUniqueOrThrow({
            where: { id: generatedProductId },
            select: { sku: true },
          }),
        { timeout: 120_000 },
      )
      .toEqual({ sku: qaSku });
    await expect(form.locator('input[name="sku"]')).toHaveValue(qaSku);
  });

  test("filters, edits, saves a view and archives through the canonical grid", async ({
    page,
  }) => {
    const runtimeErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });
    page.on("pageerror", (error) => {
      runtimeErrors.push(error.message);
    });
    await login(page);
    await db.product.update({
      where: { id: productId },
      data: { supplierId },
    });
    const currentProduct = await db.product.findUniqueOrThrow({
      where: { id: productId },
      select: {
        shortName: true,
        shortDescription: true,
        articleStatus: true,
        collection: { select: { name: true } },
      },
    });
    const gridCollection = await db.collection.create({
      data: {
        name: `${tag} grid kolekcija`,
        slug: `qa-grid-collection-${runId}`,
      },
    });

    await page.goto("/admin/erp/artikli", { waitUntil: "domcontentloaded" });
    // In Next development mode the HMR client can connect just after the first
    // paint and remount client state once. Let hydration/Fast Refresh settle
    // before testing stateful grid controls; next start does not need this.
    await page.waitForTimeout(10_000);
    const headerLabels = (await page.getByRole("columnheader").allTextContents()).map(
      (label) => label.trim(),
    );
    expect(headerLabels.indexOf("Šifra")).toBeLessThan(
      headerLabels.indexOf("Kratki opis"),
    );
    expect(headerLabels.indexOf("Kratki opis")).toBeLessThan(
      headerLabels.indexOf("Kratki naziv"),
    );
    const warehouseContext = page.getByRole("combobox", {
      name: "Kontekst zaliha",
      exact: true,
    });
    await expect(warehouseContext).toBeVisible({ timeout: 120_000 });
    await expect(
      warehouseContext.locator(`option[value="${secondaryWarehouseId}"]`),
    ).toHaveCount(1, { timeout: 120_000 });
    await warehouseContext.selectOption(secondaryWarehouseId, {
      timeout: 30_000,
    });
    const newFilterColumn = page.getByRole("combobox", {
      name: "Kolona za novi filter",
      exact: true,
    });
    await expect(newFilterColumn).toBeVisible({ timeout: 120_000 });
    await newFilterColumn.selectOption("sku", { timeout: 30_000 });
    await expect(newFilterColumn).toHaveValue("sku");
    await page
      .getByRole("button", { name: "Filter", exact: true })
      .click({ timeout: 30_000 });
    const skuFilter = page.getByRole("textbox", {
      name: "Filter Šifra",
      exact: true,
    });
    await expect(skuFilter).toBeVisible();
    await skuFilter.fill(productSku);
    await expect(page.getByText(productSku, { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Uredi podržana polja", exact: true })
      .click();
    await page
      .getByRole("button", { name: currentProduct.shortName ?? "—", exact: true })
      .click({ timeout: 30_000 });
    const inlineShortName = page.getByRole("textbox", {
      name: "Izmeni Kratki naziv",
      exact: true,
    });
    await expect(inlineShortName).toBeVisible();
    await inlineShortName.fill("N2212 Grid");
    await inlineShortName.press("Enter");
    await expect(page.getByText(/1 snimljenih izmena/)).toBeVisible({
      timeout: 120_000,
    });
    await expect
      .poll(async () => {
        const inlineUpdated = await db.product.findUniqueOrThrow({
          where: { id: productId },
          select: { shortName: true, name: true },
        });
        return inlineUpdated;
      }, { timeout: 120_000 })
      .toEqual({
        shortName: "N2212 Grid",
        name: [
          currentProduct.collection?.name,
          currentProduct.shortDescription,
          "N2212 Grid",
        ]
          .filter(Boolean)
          .join(" "),
      });
    const articleRow = page.locator("tbody tr").filter({ hasText: productSku });
    await articleRow
      .getByRole("button", {
        name: currentProduct.shortDescription ?? "—",
        exact: true,
      })
      .click();
    const inlineShortDescription = articleRow.getByRole("textbox", {
      name: "Izmeni Kratki opis",
      exact: true,
    });
    await inlineShortDescription.fill("Grid opis koji ostaje");
    await inlineShortDescription.press("Enter");
    await expect(page.getByText(/2 snimljenih izmena/)).toBeVisible({
      timeout: 120_000,
    });

    await articleRow
      .getByRole("button", {
        name: currentProduct.collection?.name ?? "—",
        exact: true,
      })
      .click();
    await articleRow
      .getByRole("combobox", { name: "Izmeni Kolekcija", exact: true })
      .selectOption(gridCollection.name);
    await expect(page.getByText(/3 snimljenih izmena/)).toBeVisible({
      timeout: 120_000,
    });

    await articleRow
      .getByRole("button", { name: currentProduct.articleStatus, exact: true })
      .click();
    await articleRow
      .getByRole("combobox", { name: "Izmeni Status", exact: true })
      .selectOption("DOB");
    await expect(page.getByText(/4 snimljenih izmena/)).toBeVisible({
      timeout: 120_000,
    });

    await articleRow
      .getByRole("button", { name: productSku, exact: true })
      .click();
    const inlineSku = page.getByRole("textbox", {
      name: "Izmeni Šifra",
      exact: true,
    });
    const gridSku = `QA-GRID-${runId}`.slice(0, 80);
    await inlineSku.fill(gridSku);
    await inlineSku.press("Enter");
    await expect(page.getByText(/5 snimljenih izmena/)).toBeVisible({
      timeout: 120_000,
    });
    productSku = gridSku;
    await skuFilter.fill(productSku);

    await expect
      .poll(async () => {
        const product = await db.product.findUniqueOrThrow({
          where: { id: productId },
          select: {
            sku: true,
            name: true,
            articleStatus: true,
            shortDescription: true,
            collection: { select: { name: true } },
            syncOverrides: true,
          },
        });
        const overrides =
          product.syncOverrides &&
          typeof product.syncOverrides === "object" &&
          !Array.isArray(product.syncOverrides) &&
          Array.isArray(product.syncOverrides.fields)
            ? product.syncOverrides.fields
            : [];
        return {
          sku: product.sku,
          name: product.name,
          status: product.articleStatus,
          shortDescription: product.shortDescription,
          collection: product.collection?.name,
          overrides,
        };
      }, { timeout: 120_000 })
      .toEqual({
        sku: productSku,
        name: `${gridCollection.name} Grid opis koji ostaje N2212 Grid`,
        status: "DOB",
        shortDescription: "Grid opis koji ostaje",
        collection: gridCollection.name,
        overrides: expect.arrayContaining([
          "description",
          "flags",
          "grouping",
          "identity",
        ]),
      });
    const warehouseColumnCheckbox = page.getByRole("checkbox", {
      name: "Fizičko po magacinu",
      exact: true,
    });
    if (!(await warehouseColumnCheckbox.isChecked())) {
      await warehouseColumnCheckbox.click();
    }
    const viewName = `${tag} dnevni pogled`;
    await page.getByRole("button", { name: "Snimi pogled" }).click();
    await page.getByRole("textbox", { name: "Naziv ERP pogleda" }).fill(viewName);
    await page.getByRole("button", { name: "Sačuvaj pogled", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      `Pogled „${viewName}” je snimljen`,
      { timeout: 120_000 },
    );
    await expect
      .poll(async () => {
        const view = await db.adminSavedView.findFirst({
          where: { module: "artikli", name: viewName },
          select: { filters: true, columns: true },
        });
        return view;
      }, { timeout: 120_000 })
      .toMatchObject({
        filters: [
          expect.objectContaining({
            columnKey: "sku",
            value: productSku,
          }),
        ],
        columns: expect.objectContaining({
          visibleColumns: expect.arrayContaining(["stockDc"]),
          context: { warehouseId: secondaryWarehouseId },
        }),
      });

    await page
      .getByRole("button", { name: `Obriši pogled ${viewName}`, exact: true })
      .click();
    await page
      .getByRole("button", {
        name: `Otkaži brisanje pogleda ${viewName}`,
        exact: true,
      })
      .click();
    await expect(page.getByRole("button", { name: viewName, exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: `Obriši pogled ${viewName}`, exact: true })
      .click();
    await page
      .getByRole("button", {
        name: `Potvrdi brisanje pogleda ${viewName}`,
        exact: true,
      })
      .click();
    await expect(page.getByRole("status")).toContainText(
      `Pogled „${viewName}” je obrisan`,
      { timeout: 120_000 },
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(10_000);
    await page
      .getByPlaceholder("Brza pretraga po vidljivim kolonama")
      .fill(productSku);
    const persistedRow = page.locator("tbody tr").filter({ hasText: productSku });
    await expect(persistedRow).toContainText("Grid opis koji ostaje");
    await expect(persistedRow).toContainText(gridCollection.name);
    await expect(persistedRow).toContainText("DOB");
    await expect
      .poll(async () =>
        db.adminSavedView.count({ where: { module: "artikli", name: viewName } }),
      )
      .toBe(0);

    const sacrificial = await db.product.create({
      data: {
        sku: `QA-DELETE-${runId}`.slice(0, 80),
        slug: `qa-delete-${runId}`,
        name: `${tag} za arhiviranje`,
        shortName: `${tag} za arhiviranje`,
        description: "QA",
        fullPrice: 1,
        articleStatus: "SP",
        isActive: true,
      },
    });
    await page.goto("/admin/erp/artikli", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(10_000);
    await page
      .getByPlaceholder("Brza pretraga po vidljivim kolonama")
      .fill(sacrificial.sku);
    await expect(page.getByText(sacrificial.sku, { exact: true })).toBeVisible();
    const sacrificialCheckbox = page.getByRole("checkbox", {
      name: `Izaberi red ${sacrificial.id}`,
    });
    await sacrificialCheckbox.click({ timeout: 30_000 });
    await expect(sacrificialCheckbox).toBeChecked();
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toBe("Arhivirati izabrane artikle?");
      await dialog.dismiss();
    });
    await page
      .getByRole("button", { name: "Arhiviraj (1)" })
      .click({ timeout: 30_000 });
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: sacrificial.id } }))
        .articleStatus,
    ).toBe("SP");
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toBe("Arhivirati izabrane artikle?");
      await dialog.accept();
    });
    await page
      .getByRole("button", { name: "Arhiviraj (1)" })
      .click({ timeout: 30_000 });
    await expect(page.getByRole("status")).toContainText("Obrisano: 1", {
      timeout: 120_000,
    });
    await expect
      .poll(async () => {
        const archived = await db.product.findUniqueOrThrow({
          where: { id: sacrificial.id },
          select: { articleStatus: true, isActive: true, deletedAt: true },
        });
        return {
          articleStatus: archived.articleStatus,
          isActive: archived.isActive,
          deleted: Boolean(archived.deletedAt),
        };
      }, { timeout: 120_000 })
      .toEqual({
        articleStatus: "ARH",
        isActive: false,
        deleted: true,
      });
    const unexpectedRuntimeErrors = runtimeErrors.filter(
      (message) =>
        !message.includes("server responded with a status of 404") &&
        !message.includes("server responded with a status of 422"),
    );
    expect(unexpectedRuntimeErrors).toEqual([]);
  });

  async function login(page: Page) {
    const callbackUrl = `/admin/erp/artikli/${productId}`;
    await page.goto(
      `/admin/prijava?callbackUrl=${encodeURIComponent(callbackUrl)}`,
      {
        waitUntil: "domcontentloaded",
      },
    );
    await page.getByLabel("E-pošta").fill(adminEmail);
    await page.getByLabel("Lozinka").fill(adminPassword);
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await expect(page).toHaveURL(new RegExp(`${callbackUrl}$`), {
      timeout: 180_000,
    });
  }

  async function cleanup() {
    const admin = await db.adminUser.findUnique({
      where: { email: adminEmail },
      select: { id: true },
    });
    const taggedProducts = await db.product.findMany({
      where: {
        OR: [
          { id: productId || "__missing__" },
          { id: generatedProductId || "__missing__" },
          { sku: { contains: runId } },
          { name: { startsWith: tag } },
        ],
      },
      select: { id: true },
    });
    const productIds = taggedProducts.map((product) => product.id);
    await db.stockMovement.deleteMany({
      where: {
        OR: [
          { idempotencyKey: { contains: runId } },
          ...(productIds.length
            ? [{ productId: { in: productIds } }]
            : []),
        ],
      },
    });
    await db.order.deleteMany({
      where: {
        OR: [
          { number: { contains: runId } },
          { guestEmail: { contains: runId } },
          ...(productIds.length
            ? [{ items: { some: { productId: { in: productIds } } } }]
            : []),
        ],
      },
    });
    await db.partnerReservation.deleteMany({
      where: { idempotencyKey: { contains: tag } },
    });
    await db.partnerApiClient.deleteMany({
      where: { name: { startsWith: tag } },
    });
    if (productIds.length) {
      await db.product.deleteMany({ where: { id: { in: productIds } } });
    }
    await db.priceList.deleteMany({ where: { name: { startsWith: tag } } });
    await db.group.deleteMany({ where: { name: { startsWith: tag } } });
    await db.collection.deleteMany({ where: { name: { startsWith: tag } } });
    await db.category.deleteMany({ where: { name: { startsWith: tag } } });
    await db.supplier.deleteMany({ where: { name: { startsWith: tag } } });
    await db.warehouse.deleteMany({
      where: { code: { startsWith: `STORE-${runId}`.slice(0, 40) } },
    });
    if (admin) await db.auditLog.deleteMany({ where: { actorId: admin.id } });
    await db.rateLimitBucket.deleteMany({
      where: { key: { contains: adminEmail } },
    });
    await db.adminUser.deleteMany({ where: { email: adminEmail } });
  }
});

async function clickConfirmation(
  page: Page,
  locator: Locator,
  accept: boolean,
) {
  const dialogPromise = page.waitForEvent("dialog");
  const clickPromise = locator.click();
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe("confirm");
  if (accept) await dialog.accept();
  else await dialog.dismiss();
  await clickPromise;
}

function createDatabaseClient() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required for article acceptance.");
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: raw,
      max: 1,
      connectionTimeoutMillis: 60_000,
    }),
  });
}
