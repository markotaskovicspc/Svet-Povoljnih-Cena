import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

test.describe("article master acceptance", () => {
  test.skip(
    process.env.E2E_ARTICLE_MASTER !== "1",
    "Set E2E_ARTICLE_MASTER=1 to run the isolated article-master suite.",
  );

  test.setTimeout(240_000);
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
            url: "/logo.svg",
            thumbUrl: "/logo.svg",
            cardUrl: "/logo.svg",
            pdpUrl: "/logo.svg",
            alt: `${tag} fotografija`,
            order: 0,
          },
        },
      },
    });
    productId = product.id;
    productSku = product.sku;
    productSlug = product.slug;
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
    await db?.$disconnect();
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

    await page.goto(`/admin/proizvodi/${productId}`, {
      waitUntil: "load",
    });
    const shortNameInput = page.getByLabel("Kratki naziv");
    await expect(shortNameInput).toBeVisible();
    await page.waitForTimeout(750);
    await shortNameInput.fill("N2212");
    await page.getByLabel("Status artikla").selectOption("SP");
    await page.locator('select[name="supplierId"]').selectOption(supplierId);
    await page.getByLabel("Nova grupa").fill(`${tag} grupa`);
    await page.getByLabel("Nova kolekcija").fill(`${tag} kolekcija`);
    await page.getByLabel("Kratak opis").fill("Otvorena polica");
    await page.getByLabel("Atribut 1").fill("Hrast");
    await page.getByLabel("Atribut 2").fill("Metal");
    await page.getByLabel("Boja 1").fill("Natur");
    await page.getByLabel("Benefiti (odvojeni zarezom)").fill("Masiv, Laka montaža");
    await page.getByLabel("Sertifikati (odvojeni zarezom)").fill("FSC");
    await page.locator('textarea[name="materialText"]').fill("Hrast + čelik");
    await page.getByLabel("Stanje").fill("25");
    await page.getByLabel("Novo do").fill("2027-12-31");
    await page.getByLabel("T&C od").fill("2026-08-01");
    await page.getByLabel("T&C do").fill("2026-12-31");
    await page.getByRole("textbox", { name: "Formatirani opis za sajt" }).evaluate(
      (element) => {
        element.innerHTML =
          '<h2 onclick="alert(1)">Naslov</h2><p>Bezbedan <strong>opis</strong></p>';
        element.dispatchEvent(new InputEvent("input", { bubbles: true }));
      },
    );
    await page.getByRole("button", { name: "Sačuvaj izmene" }).click();
    await expect(page.getByRole("status").first()).toContainText("Proizvod je sačuvan");
    await page
      .getByRole("textbox", { name: "Nova kategorija", exact: true })
      .fill(`${tag} ručna podgrupa`);
    await page
      .locator('select[name="parentCategoryId"]')
      .selectOption(rootCategoryId);
    await page.getByRole("button", { name: "Sačuvaj kategoriju" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Kategorija proizvoda je sačuvana" }),
    ).toBeVisible();

    await expect
      .poll(async () => {
        const product = await db.product.findUniqueOrThrow({
          where: { id: productId },
          select: {
            name: true,
            shortName: true,
            description: true,
            stock: true,
            articleStatus: true,
            isNew: true,
            materialText: true,
            availableWebAuto: true,
            availableWholesaleAuto: true,
            availableExportAuto: true,
            supplier: { select: { parity: true, deliveryDays: true } },
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
          name: product.name,
          shortName: product.shortName,
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
          category: product.categories[0]?.category.name,
          categoryParentId: product.categories[0]?.category.parent?.id,
          lookups: product.lookupAssignments
            .map((row) => `${row.lookupValue.kind}:${row.lookupValue.value}`)
            .sort(),
        };
      })
      .toEqual({
        name: `${tag} kolekcija Otvorena polica N2212`,
        shortName: "N2212",
        description: "<h2>Naslov</h2><p>Bezbedan <strong>opis</strong></p>",
        stock: 27,
        status: "SP",
        isNew: true,
        material: "Hrast + čelik",
        channels: [true, true, true],
        parity: "DAP",
        deliveryDays: 14,
        category: `${tag} ručna podgrupa`,
        categoryParentId: rootCategoryId,
        lookups: [
          "ATTRIBUTE:Hrast",
          "ATTRIBUTE:Metal",
          "BENEFIT:Laka montaža",
          "BENEFIT:Masiv",
          "CERTIFICATE:FSC",
          "COLOR:Natur",
        ],
      });

    await page.goto(`/p/${productSlug}`, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: `${tag} kolekcija Otvorena polica N2212`,
      }),
    ).toBeVisible();

    await page.goto(`/admin/proizvodi/${productId}`, { waitUntil: "load" });
    await expect(page.getByLabel("Web check")).toBeChecked();
    await page.waitForTimeout(500);
    await page.getByLabel("Web check").uncheck();
    await page.getByRole("button", { name: "Sačuvaj izmene" }).click();
    await expect(page.getByRole("status").first()).toContainText("Proizvod je sačuvan");
    const hiddenResponse = await page.goto(`/p/${productSlug}`, {
      waitUntil: "domcontentloaded",
    });
    expect(hiddenResponse?.status()).toBe(404);

    await page.goto(`/admin/proizvodi/${productId}`, { waitUntil: "load" });
    await page.waitForTimeout(500);
    await page.getByLabel("Web check").check();
    await page.getByRole("button", { name: "Sačuvaj izmene" }).click();
    await expect(page.getByRole("status").first()).toContainText("Proizvod je sačuvan");

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
      `/api/admin/erp/artikli/rows?warehouseId=${warehouseId}&columns=${encodeURIComponent(
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
      `/api/admin/erp/artikli/rows?warehouseId=${secondaryWarehouseId}&columns=${encodeURIComponent(
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
    expect(exportedProductRow?.getCell(exportedPhotoColumn).text).toBe("/logo.svg");

    const importWorkbook = new ExcelJS.Workbook();
    const sheet = importWorkbook.addWorksheet("Artikli");
    sheet.addRow([
      "Kratki naziv",
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
      name: "article-master-qa.xlsx",
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
    expect((await initialImportResponsePromise).ok()).toBe(true);
    await expect(page.getByRole("status")).toContainText("Uvezeno artikala: 1");
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
    expect(imported.sku).toMatch(/^NOV-\d{4}-\d{5}$/);
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
      name: "article-master-partial-update.xlsx",
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
    expect((await partialImportResponsePromise).ok()).toBe(true);
    await expect(page.getByRole("status")).toContainText("Uvezeno artikala: 1");
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
      name: `${tag} ručna podgrupa`,
      parentId: rootCategoryId,
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

    await page.goto("/admin/erp/artikli", { waitUntil: "networkidle" });
    await page
      .getByRole("combobox", {
        name: "Kontekst zaliha",
        exact: true,
      })
      .selectOption(secondaryWarehouseId);
    const newFilterColumn = page.getByRole("combobox", {
      name: "Kolona za novi filter",
      exact: true,
    });
    await newFilterColumn.selectOption("sku");
    await expect(newFilterColumn).toHaveValue("sku");
    await page.getByRole("button", { name: "Filter", exact: true }).click();
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
    await page.getByRole("button", { name: "N2212 Excel", exact: true }).click();
    const inlineShortName = page.getByRole("textbox", {
      name: "Izmeni Kratki naziv",
      exact: true,
    });
    await expect(inlineShortName).toBeVisible();
    await inlineShortName.fill("N2212 Grid");
    await inlineShortName.press("Enter");
    await expect(page.getByText(/1 snimljenih izmena/)).toBeVisible();
    await expect
      .poll(async () => {
        const inlineUpdated = await db.product.findUniqueOrThrow({
          where: { id: productId },
          select: { shortName: true, name: true },
        });
        return inlineUpdated;
      })
      .toEqual({
        shortName: "N2212 Grid",
        name: `${tag} kolekcija Otvorena polica N2212 Grid`,
      });
    const warehouseColumnCheckbox = page.getByRole("checkbox", {
      name: "Fizičko po magacinu",
      exact: true,
    });
    if (!(await warehouseColumnCheckbox.isChecked())) {
      await warehouseColumnCheckbox.click();
    }
    const viewName = `${tag} dnevni pogled`;
    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("prompt");
      await dialog.accept(viewName);
    });
    await page.getByRole("button", { name: "Snimi pogled" }).click();
    await expect(page.getByRole("status")).toContainText(
      `Pogled „${viewName}” je snimljen`,
    );
    await expect
      .poll(async () => {
        const view = await db.adminSavedView.findFirst({
          where: { module: "artikli", name: viewName },
          select: { filters: true, columns: true },
        });
        return view;
      })
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
    await page.goto("/admin/erp/artikli", { waitUntil: "networkidle" });
    await page
      .getByPlaceholder("Brza pretraga po vidljivim kolonama")
      .fill(sacrificial.sku);
    await expect(page.getByText(sacrificial.sku, { exact: true })).toBeVisible();
    await page
      .getByRole("checkbox", { name: `Izaberi red ${sacrificial.id}` })
      .click();
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toBe("Arhivirati izabrane artikle?");
      await dialog.dismiss();
    });
    await page.getByRole("button", { name: "Arhiviraj (1)" }).click();
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: sacrificial.id } }))
        .articleStatus,
    ).toBe("SP");
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toBe("Arhivirati izabrane artikle?");
      await dialog.accept();
    });
    await page.getByRole("button", { name: "Arhiviraj (1)" }).click();
    await expect(page.getByRole("status")).toContainText("Obrisano: 1");
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
      })
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
    await page.goto("/admin/prijava?callbackUrl=%2Fadmin", {
      waitUntil: "domcontentloaded",
    });
    await page.getByLabel("E-pošta").fill(adminEmail);
    await page.getByLabel("Lozinka").fill(adminPassword);
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
  }
});

function createDatabaseClient() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required for article acceptance.");
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: raw,
      max: 1,
      connectionTimeoutMillis: 10_000,
    }),
  });
}
