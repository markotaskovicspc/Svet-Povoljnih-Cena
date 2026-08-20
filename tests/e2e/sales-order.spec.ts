// Acceptance: SALE-01
// Acceptance: SALE-02
// Acceptance: CRM-01
import ExcelJS from "exceljs";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

const expect = baseExpect.configure({ timeout: 30_000 });

test.describe("ERP pregled i ručne VP/INO porudžbine", () => {
  test.skip(
    process.env.E2E_SALES_ORDERS !== "1",
    "Set E2E_SALES_ORDERS=1 to run the isolated sales-order suite.",
  );
  test.describe.configure({ mode: "serial" });
  test.setTimeout(600_000);

  const runId = `${Date.now()}-${process.pid}`;
  const fixture = {
    adminEmail: `qa.sales.order.${runId}@example.invalid`,
    adminPassword: `QaSalesOrder!${runId}x`,
    customerEmail: `qa.customer.${runId}@example.invalid`,
    customerCompany: `QA kupac ${runId}`,
    customerPib: `${runId.replace(/\D/g, "").slice(-9).padStart(9, "1")}`,
    uiCompany: `QA otpremnica firma ${runId}`,
    uiCompanyPib: `8${runId.replace(/\D/g, "").slice(-8).padStart(8, "2")}`,
    uiCompanyRegistration: `7${runId.replace(/\D/g, "").slice(-7).padStart(7, "3")}`,
    supplierName: `QA prodajni dobavljač ${runId}`,
    priceListCode: `QA-VP-${runId}`.slice(0, 70),
    dcSku: `QA-SALE-DC-${runId}`.slice(0, 90),
    supplierSku: `QA-SALE-DOB-${runId}`.slice(0, 90),
  };

  let db: PrismaClient;
  let adminId = "";
  let customerId = "";
  let uiCompanyId = "";
  let supplierId = "";
  let priceListId = "";
  let dcWarehouseId = "";
  let createdWarehouse = false;
  let dcProductId = "";
  let supplierProductId = "";
  let dispatchId = "";
  let orderId: string | null = null;
  let webOrderId: string | null = null;
  let fiscalOrderId: string | null = null;
  let legacyFiscalOrderId: string | null = null;
  let webOrderNumber = "";

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
        lastName: "Sales order",
      },
      select: { id: true },
    });
    adminId = admin.id;

    const customer = await db.customer.create({
      data: {
        companyName: fixture.customerCompany,
        pib: fixture.customerPib,
        address: "Bulevar testova 10",
        city: "Beograd",
        postalCode: "11000",
        country: "RS",
        phone: "+38160111222",
        email: fixture.customerEmail,
      },
      select: { id: true },
    });
    customerId = customer.id;

    const supplier = await db.supplier.create({
      data: {
        code: `QA-SALE-${runId}`.slice(0, 70),
        name: fixture.supplierName,
        email: `qa.supplier.${runId}@example.invalid`,
        fulfillmentMode: "NONE",
      },
      select: { id: true },
    });
    supplierId = supplier.id;

    const existingDc = await db.warehouse.findFirst({
      where: { active: true, isDefault: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (existingDc) {
      dcWarehouseId = existingDc.id;
    } else {
      const dc = await db.warehouse.create({
        data: {
          code: `QA-DC-${runId}`.slice(0, 30),
          name: `QA distributivni centar ${runId}`,
          active: true,
          isDefault: true,
        },
        select: { id: true },
      });
      dcWarehouseId = dc.id;
      createdWarehouse = true;
    }

    const priceList = await db.priceList.create({
      data: {
        code: fixture.priceListCode,
        name: `QA VP cenovnik ${runId}`,
        kind: "WHOLESALE",
        currency: "RSD",
        active: true,
        validFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
      select: { id: true },
    });
    priceListId = priceList.id;

    const [dcProduct, supplierProduct] = await Promise.all([
      db.product.create({
        data: {
          sku: fixture.dcSku,
          slug: `qa-sales-dc-${runId}`,
          name: `QA DC artikal ${runId}`,
          shortName: `QA DC kratki ${runId}`,
          description: "QA artikal sa DC stanjem",
          shortDescription: "Kratki opis DC artikla",
          fullPrice: 1_440,
          articleStatus: "SP",
          stock: 10,
          supplier: { connect: { id: supplierId } },
          group: {
            connectOrCreate: {
              where: { slug: `qa-sales-group-${runId}` },
              create: {
                slug: `qa-sales-group-${runId}`,
                name: `QA grupa ${runId}`,
              },
            },
          },
          collection: {
            connectOrCreate: {
              where: { slug: `qa-sales-collection-${runId}` },
              create: {
                slug: `qa-sales-collection-${runId}`,
                name: `QA kolekcija ${runId}`,
              },
            },
          },
          attribute1: "A1",
          attribute2: "A2",
          attribute3: "A3",
          attribute4: "A4",
          colorPrimary: "Plava",
          colorSecondary: "Bela",
          palletQty: 48,
        },
        select: { id: true },
      }),
      db.product.create({
        data: {
          sku: fixture.supplierSku,
          slug: `qa-sales-dob-${runId}`,
          name: `QA DOB artikal ${runId}`,
          shortName: `QA DOB kratki ${runId}`,
          description: "QA artikal kod dobavljača",
          shortDescription: "Kratki opis DOB artikla",
          fullPrice: 720,
          articleStatus: "DOB",
          stock: 0,
          supplierStock: 20,
          supplierReservedStock: 0,
          supplier: { connect: { id: supplierId } },
          supplierExternalId: `QA-EXT-${runId}`.slice(0, 100),
        },
        select: { id: true },
      }),
    ]);
    dcProductId = dcProduct.id;
    supplierProductId = supplierProduct.id;

    await Promise.all([
      db.warehouseStock.create({
        data: {
          warehouseId: dcWarehouseId,
          productId: dcProductId,
          qty: 10,
        },
      }),
      db.warehouseStock.create({
        data: {
          warehouseId: dcWarehouseId,
          productId: supplierProductId,
          qty: 0,
        },
      }),
      db.priceListEntry.create({
        data: {
          priceListId,
          productId: dcProductId,
          price: 1_200,
          validFrom: new Date("2026-01-01T00:00:00.000Z"),
        },
      }),
      db.priceListEntry.create({
        data: {
          priceListId,
          productId: supplierProductId,
          price: 600,
          validFrom: new Date("2026-01-01T00:00:00.000Z"),
        },
      }),
    ]);

    const webOrder = await db.order.create({
      data: {
        number: `QA-WEB-${runId}`,
        channel: "WEB",
        subtotal: 0,
        total: 0,
        shippingMethod: "KURIR",
        paymentMethod: "UPLATA_NA_RACUN",
        shipFirstName: "QA",
        shipLastName: "WEB",
        shipPhone: "+38160000000",
        shipStreet: "Test 1",
        shipCity: "Beograd",
        shipPostalCode: "11000",
        guestEmail: `qa.web.${runId}@example.invalid`,
        termsAcceptedAt: new Date(),
      },
      select: { id: true, number: true },
    });
    webOrderId = webOrder.id;
    webOrderNumber = webOrder.number;
  });

  test.afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await db?.$disconnect();
    }
  });

  test("OPS korisnik prolazi pregled, validacije, kreiranje, izmenu, zaštite i brisanje", async ({
    context,
    page,
  }) => {
    page.setDefaultTimeout(15_000);
    await context.addCookies([
      {
        name: "spc_cookie_consent",
        value: "essential",
        url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
      },
    ]);
    await login(page);
    await page.setViewportSize({ width: 1280, height: 720 });

    await test.step("admin kreira firmu spremnu za VP/INO i otpremnice", async () => {
      await page.goto("/admin/erp/kupci", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Novi kupac / firma" }).click();
      const dialog = page.getByRole("dialog", { name: "Novi kupac / firma" });
      await dialog.getByLabel("Vrsta kupca *").selectOption("Firma");
      await dialog.getByLabel("Ime i prezime / naziv firme *").fill(fixture.uiCompany);
      await dialog.getByLabel("PIB firme").fill(fixture.uiCompanyPib);
      await dialog
        .getByLabel("Matični broj firme")
        .fill(fixture.uiCompanyRegistration);
      await dialog.getByLabel("Adresa").fill("Bulevar otpremnica 12");
      await dialog.getByLabel("Mesto").fill("Beograd");
      await dialog.getByLabel("Poštanski broj").fill("11000");
      await dialog.getByLabel("Država (ISO 2)").fill("RS");
      await dialog.getByLabel("Telefon").fill("+381601234567");
      await dialog
        .getByLabel("E-mail")
        .fill(`qa.dispatch.company.${runId}@example.invalid`);
      const submitCompany = dialog.getByRole("button", {
        name: "Novi kupac / firma",
      });
      await expect(submitCompany).toBeVisible();
      await submitCompany.click();
      await expect(page.getByRole("status")).toContainText(
        `Firma „${fixture.uiCompany}” je kreirana`,
      );

      const company = await db.customer.findFirstOrThrow({
        where: { companyName: fixture.uiCompany },
        select: { id: true, pib: true, registrationNumber: true, country: true },
      });
      uiCompanyId = company.id;
      expect(company).toMatchObject({
        pib: fixture.uiCompanyPib,
        registrationNumber: fixture.uiCompanyRegistration,
        country: "RS",
      });

      await page.goto("/admin/erp/otpremnice/nova", {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByLabel("Firma koja izdaje", { exact: true })).toContainText(
        fixture.uiCompany,
      );
      await expect(page.getByLabel("Firma koja prima", { exact: true })).toContainText(
        fixture.uiCompany,
      );
    });

    await test.step("totali su na vrhu, a šifra, količina i naziv su prve kolone", async () => {
      const dispatchForm = page.locator("form").filter({
        has: page.getByLabel("Firma koja izdaje", { exact: true }),
      });
      const formText = (await dispatchForm.textContent()) ?? "";
      expect(formText.indexOf("Vrednost bez PDV-a")).toBeGreaterThanOrEqual(0);
      expect(formText.indexOf("Vrednost bez PDV-a")).toBeLessThan(
        formText.indexOf("Uzglavlje otpremnice"),
      );

      const headers = await dispatchForm.locator("table thead th").allTextContents();
      expect(headers.slice(0, 3)).toEqual([
        "Šifra artikla",
        "Količina",
        "Naziv",
      ]);
    });

    await test.step("otpremnica preuzima i prikazuje komade na paleti u UI, bazi, Excelu i PDF-u", async () => {
      await page.getByLabel("Firma koja izdaje", { exact: true }).selectOption(
        uiCompanyId,
      );
      await page.getByLabel("Firma koja prima", { exact: true }).selectOption(
        customerId,
      );
      await page.getByLabel("Magacin iz kog se izdaje").selectOption(
        dcWarehouseId,
      );
      await page.getByLabel("Cenovnik otpremnice").selectOption(priceListId);
      await page.getByLabel("Šifra artikla red 1").fill(fixture.dcSku);
      await page.getByRole("button", { name: "Učitaj", exact: true }).click();

      const draftRow = page.getByRole("row").filter({
        has: page.getByLabel("Šifra artikla red 1"),
      });
      await expect(draftRow.getByText("48", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("columnheader", { name: "Kom/paleta", exact: true }),
      ).toBeVisible();
      await page.getByLabel("Količina red 1").fill("2");
      await page.getByLabel("Registarska oznaka vozila").fill("BG-QA-48");
      await page.getByRole("button", { name: "Kreiraj otpremnicu" }).click();
      await expect(page).toHaveURL(
        /\/admin\/erp\/otpremnice\/(?!nova$)[^/?]+$/,
      );
      dispatchId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
      expect(dispatchId).not.toBe("");

      const storedDispatch = await db.dispatchNote.findUniqueOrThrow({
        where: { id: dispatchId },
        include: { items: true },
      });
      expect(storedDispatch.items).toHaveLength(1);
      expect(storedDispatch.items[0]).toMatchObject({
        sku: fixture.dcSku,
        qty: 2,
        palletQty: 48,
      });

      const savedRow = page.getByRole("row").filter({
        has: page.getByLabel("Šifra artikla red 1"),
      });
      await expect(savedRow.getByText("48", { exact: true })).toBeVisible();

      const excelResponse = await page.request.get(
        `/api/admin/dispatch-notes/${dispatchId}/excel`,
      );
      expect(excelResponse.status()).toBe(200);
      expect(excelResponse.headers()["content-type"]).toContain(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load((await excelResponse.body()) as never);
      const itemsSheet = workbook.getWorksheet("Stavke");
      expect(itemsSheet).toBeDefined();
      const headerValues = itemsSheet!.getRow(1).values;
      const palletColumn = Array.isArray(headerValues)
        ? headerValues.findIndex((value) => value === "Komada na paleti")
        : -1;
      expect(palletColumn).toBeGreaterThan(0);
      expect(itemsSheet!.getRow(2).getCell(palletColumn).value).toBe(48);

      const pdfResponse = await page.request.get(
        `/api/admin/dispatch-notes/${dispatchId}/pdf`,
      );
      expect(pdfResponse.status()).toBe(200);
      expect(pdfResponse.headers()["content-type"]).toContain("application/pdf");
      expect((await pdfResponse.body()).byteLength).toBeGreaterThan(1_000);
    });

    await test.step("pregled sadrži sve zahtevane komande i kolone", async () => {
      await page.goto("/admin/erp/prodajni-nalozi", {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByRole("heading", { name: "Pregled porudžbina" }),
      ).toBeVisible();
      for (const command of ["Nova", "Uredi", "Obriši"]) {
        await expect(
          page
            .getByRole("button", { name: command, exact: true })
            .or(page.getByRole("link", { name: command, exact: true })),
        ).toBeVisible();
      }
      for (const header of [
        "Broj porudžbine",
        "Ime i prezime kupca / firma",
        "PIB",
        "Cenovnik",
        "Adresa",
        "Mesto",
        "Poštanski broj",
        "Telefon",
        "E-mail",
        "Šifra artikla",
        "Dobavljač",
        "Kategorija artikala",
        "Grupa artikla",
        "Podgrupa artikla",
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
        "MP cena",
        "Ukupno bez PDV-a po šifri",
        "Ukupno sa PDV-om po šifri",
        "Magacin",
        "Status porudžbine",
        "Fiskalizovano",
        "Fakturisano",
        "Prihvaćeno na SEF-u",
        "Plaćeno",
      ]) {
        await expect(
          page.getByRole("columnheader").filter({
            has: page.getByRole("button", { name: header, exact: true }),
          }),
        ).toBeVisible();
      }
    });

    await test.step("API odbija nepostojeću šifru, duplikat i brisanje WEB porudžbine", async () => {
      const missing = await page.request.get(
        `/api/admin/erp/sales-orders/products?sku=${encodeURIComponent(
          `NE-POSTOJI-${runId}`,
        )}&priceListId=${encodeURIComponent(priceListId)}`,
      );
      expect(missing.status()).toBe(400);
      expect((await missing.json()).error).toContain("ne postoji");

      const duplicate = await page.request.post(
        "/api/admin/erp/sales-orders",
        {
          data: {
            channel: "VP",
            customerId,
            priceListId,
            status: "KREIRANO",
            paid: false,
            sefAccepted: false,
            lines: [
              {
                sku: fixture.dcSku,
                qty: 1,
                unitPrice: 1_200,
                allocation: dcWarehouseId,
              },
              {
                sku: fixture.dcSku.toLowerCase(),
                qty: 1,
                unitPrice: 1_200,
                allocation: dcWarehouseId,
              },
            ],
          },
        },
      );
      expect(duplicate.status()).toBe(400);
      expect((await duplicate.json()).error).toContain("samo u jednom redu");

      const webDelete = await page.request.delete(
        `/api/admin/erp/sales-orders/${webOrderId}`,
      );
      expect(webDelete.status()).toBe(400);
      expect((await webDelete.json()).error).toContain("WEB i Ananas");

      await page.goto(
        `/admin/erp/prodajni-nalozi/${webOrderId}?mode=edit`,
        { waitUntil: "domcontentloaded" },
      );
      await expect(
        page.getByRole("heading", {
          name: `Porudžbina ${webOrderNumber}`,
          exact: true,
        }),
      ).toHaveCount(1);
      await expect(page.getByLabel("Vrsta porudžbine")).toHaveValue("WEB");
      await expect(page.getByLabel("Vrsta porudžbine")).toBeDisabled();
      await expect(
        page.getByText("Ova porudžbina je samo za pregled:", {
          exact: false,
        }),
      ).toBeVisible();
      await page.goto("/admin/erp/prodajni-nalozi", {
        waitUntil: "domcontentloaded",
      });
    });

    await test.step("Nova forma automatski popunjava kupca, cenovnik, artikle i magacin", async () => {
      await page.getByRole("button", { name: "Nova", exact: true }).click();
      await expect(page).toHaveURL(/\/admin\/erp\/prodajni-nalozi\/nova$/);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(
        page.getByRole("heading", { name: "Nova porudžbina" }),
      ).toBeVisible();
      await expect(page.locator('form[data-client-ready="true"]')).toHaveCount(1);
      await page.getByLabel("Kupac").selectOption(customerId);
      await page.getByLabel("Cenovnik").selectOption(priceListId);
      await expect(
        page.getByText(fixture.customerCompany, { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(fixture.customerPib, { exact: true }),
      ).toBeVisible();

      await page.getByLabel("Šifra artikla red 1").fill(fixture.dcSku);
      await page.getByRole("button", { name: "Učitaj", exact: true }).click();
      await expect(
        page.getByText(`QA DC kratki ${runId}`, { exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("MP cena red 1")).toHaveValue("1200");
      await expect(page.getByLabel("Magacin red 1")).toHaveValue(
        dcWarehouseId,
      );
      await page.getByLabel("Količina red 1").fill("2");

      await page.getByRole("button", { name: "Dodaj šifru" }).click();
      await page.getByLabel("Šifra artikla red 2").fill(fixture.supplierSku);
      await page.getByRole("button", { name: "Učitaj", exact: true }).last().click();
      await expect(
        page.getByText(`QA DOB kratki ${runId}`, { exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("MP cena red 2")).toHaveValue("600");
      await expect(page.getByLabel("Magacin red 2")).toHaveValue(
        "SUPPLIER",
      );
      await page.getByLabel("Količina red 2").fill("3");
      await page.getByLabel("MP cena red 2").fill("550");
      await expect(
        page.getByText("4.050,00 RSD", { exact: true }).last(),
      ).toBeVisible();

      await page.getByRole("button", { name: "Kreiraj porudžbinu" }).click();
      await expect(page).toHaveURL(
        new RegExp("/admin/erp/prodajni-nalozi/(?!nova$)[^/?]+$"),
      );
      await expect(
        page.getByRole("heading", {
          name: /Porudžbina VP-\d{4}-\d{5}/,
        }),
      ).toBeVisible();
    });

    await test.step("baza čuva red po šifri, snimke, vrednosti i obe vrste rezervacije", async () => {
      const order = await db.order.findFirstOrThrow({
        where: { customerId, channel: "VP" },
        orderBy: { createdAt: "desc" },
        include: {
          items: { orderBy: { sku: "asc" } },
          payments: true,
          supplierFulfillments: { include: { items: true } },
        },
      });
      orderId = order.id;
      expect(order.number).toMatch(/^VP-\d{4}-\d{5}$/);
      expect(order.items).toHaveLength(2);
      expect(order.shipCompanyName).toBe(fixture.customerCompany);
      expect(order.shipPib).toBe(fixture.customerPib);
      expect(Number(order.total)).toBe(4_050);
      expect(Number(order.subtotal)).toBe(4_050);
      const dcLine = order.items.find((item) => item.sku === fixture.dcSku)!;
      const supplierLine = order.items.find(
        (item) => item.sku === fixture.supplierSku,
      )!;
      expect(dcLine.warehouseId).toBe(dcWarehouseId);
      expect(dcLine.warehouseReservedQty).toBe(2);
      expect(dcLine.supplierReservedQty).toBe(0);
      expect(dcLine.attribute1).toBe("A1");
      expect(dcLine.attribute4).toBe("A4");
      expect(supplierLine.warehouseId).toBeNull();
      expect(supplierLine.supplierReservedQty).toBe(3);
      expect(Number(supplierLine.unitPriceSale)).toBe(550);
      expect(order.supplierFulfillments).toHaveLength(1);
      expect(order.supplierFulfillments[0]?.items).toHaveLength(1);
      expect(order.payments[0]?.status).toBe("PENDING");

      const [dcStock, products] = await Promise.all([
        db.warehouseStock.findUniqueOrThrow({
          where: {
            warehouseId_productId: {
              warehouseId: dcWarehouseId,
              productId: dcProductId,
            },
          },
        }),
        db.product.findMany({
          where: { id: { in: [dcProductId, supplierProductId] } },
        }),
      ]);
      expect(dcStock.qty).toBe(10);
      expect(products.find((product) => product.id === dcProductId)?.stock).toBe(
        10,
      );
      expect(
        products.find((product) => product.id === supplierProductId)
          ?.supplierReservedStock,
      ).toBe(3);
    });

    await test.step("broj iz pregleda otvara celu porudžbinu, a Uredi bez gubitka zalihe menja količinu i statuse", async () => {
      await page.goto("/admin/erp/prodajni-nalozi", {
        waitUntil: "domcontentloaded",
      });
      const order = await db.order.findUniqueOrThrow({
        where: { id: orderId! },
        select: { number: true },
      });
      await page.getByRole("link", { name: order.number, exact: true }).first().click();
      await expect(page).toHaveURL(
        new RegExp(`/admin/erp/prodajni-nalozi/${orderId}$`),
        { timeout: 90_000 },
      );
      await expect(
        page.getByRole("heading", {
          name: `Porudžbina ${order.number}`,
          exact: true,
        }),
      ).toHaveCount(1);
      await expect(page.getByLabel("Šifra artikla red 1")).toBeDisabled();
      await page.getByRole("link", { name: "Uredi", exact: true }).click();
      await expect(page).toHaveURL(/mode=edit/);
      await expect(
        page.getByRole("heading", {
          name: `Porudžbina ${order.number}`,
          exact: true,
        }),
      ).toHaveCount(1);
      await page.getByLabel("Količina red 1").fill("10");
      await page.getByLabel("Količina red 2").fill("20");
      await page.getByLabel("Plaćeno").check();
      await page.getByLabel("Prihvaćeno na SEF-u").check();
      await page.getByRole("button", { name: "Sačuvaj porudžbinu" }).click();
      await expect(page).toHaveURL(
        new RegExp(`/admin/erp/prodajni-nalozi/${orderId}$`),
        { timeout: 90_000 },
      );

      const [updated, dcStock, dcProduct, supplierProduct] = await Promise.all([
        db.order.findUniqueOrThrow({
          where: { id: orderId! },
          include: { items: true, payments: true },
        }),
        db.warehouseStock.findUniqueOrThrow({
          where: {
            warehouseId_productId: {
              warehouseId: dcWarehouseId,
              productId: dcProductId,
            },
          },
        }),
        db.product.findUniqueOrThrow({ where: { id: dcProductId } }),
        db.product.findUniqueOrThrow({ where: { id: supplierProductId } }),
      ]);
      expect(Number(updated.total)).toBe(23_000);
      expect(
        updated.items.find((item) => item.sku === fixture.dcSku)
          ?.warehouseReservedQty,
      ).toBe(10);
      expect(updated.payments.some((payment) => payment.status === "PAID")).toBe(
        true,
      );
      expect(updated.sefAcceptedAt).not.toBeNull();
      expect(dcStock.qty).toBe(10);
      expect(dcProduct.stock).toBe(10);
      expect(dcProduct.dcAvailableQty).toBe(0);
      expect(supplierProduct.supplierReservedStock).toBe(20);
    });

    await test.step("pregled odbija brisanje plaćene porudžbine", async () => {
      await page.goto("/admin/erp/prodajni-nalozi", {
        waitUntil: "domcontentloaded",
      });
      const row = page
        .getByRole("row")
        .filter({ hasText: fixture.dcSku })
        .filter({ hasText: /^.*VP-\d{4}-\d{5}.*$/ })
        .first();
      await row
        .getByRole("checkbox", { name: /^Izaberi red / })
        .click();
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Obriši (1)" }).click();
      await expect(
        page.getByText(/Plaćena porudžbina .* ne može da se obriše/),
      ).toBeVisible();
      expect(await db.order.findUnique({ where: { id: orderId! } })).not.toBeNull();
    });

    await test.step("posle skidanja oznake Plaćeno komanda Obriši vraća sve rezervacije i čuva ledger", async () => {
      await page.goto(
        `/admin/erp/prodajni-nalozi/${orderId}?mode=edit`,
        { waitUntil: "domcontentloaded" },
      );
      await page.getByLabel("Plaćeno").uncheck();
      await page.getByLabel("Prihvaćeno na SEF-u").uncheck();
      await page.getByRole("button", { name: "Sačuvaj porudžbinu" }).click();
      await expect(page).toHaveURL(
        new RegExp(`/admin/erp/prodajni-nalozi/${orderId}$`),
        { timeout: 90_000 },
      );
      await page.goto("/admin/erp/prodajni-nalozi", {
        waitUntil: "domcontentloaded",
      });
      const row = page.getByRole("row").filter({ hasText: fixture.dcSku }).first();
      await row
        .getByRole("checkbox", { name: /^Izaberi red / })
        .click();
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Obriši (1)" }).click();
      await expect(page.getByText("Obrisano porudžbina: 1.")).toBeVisible();

      const [deleted, dcStock, dcProduct, supplierProduct, movements] =
        await Promise.all([
          db.order.findUnique({ where: { id: orderId! } }),
          db.warehouseStock.findUniqueOrThrow({
            where: {
              warehouseId_productId: {
                warehouseId: dcWarehouseId,
                productId: dcProductId,
              },
            },
          }),
          db.product.findUniqueOrThrow({ where: { id: dcProductId } }),
          db.product.findUniqueOrThrow({ where: { id: supplierProductId } }),
          db.stockMovement.findMany({
            where: { productId: dcProductId },
          }),
        ]);
      expect(deleted).toBeNull();
      orderId = null;
      expect(dcStock.qty).toBe(10);
      expect(dcProduct.stock).toBe(10);
      expect(supplierProduct.supplierReservedStock).toBe(0);
      expect(movements).toHaveLength(0);
    });

    await test.step("fiskalizacija skida fizički DC lager tačno jednom", async () => {
      const fiscalOrderNumber = `QA-FISCAL-${runId}`;
      const fiscalOrder = await db.$transaction(async (tx) => {
        const created = await tx.order.create({
          data: {
            number: fiscalOrderNumber,
            status: "KREIRANO",
            channel: "WEB",
            subtotal: 3_000,
            total: 3_000,
            shippingMethod: "KURIR",
            paymentMethod: "UPLATA_NA_RACUN",
            shipFirstName: "QA",
            shipLastName: "Fiskalizacija",
            shipPhone: "+38160111999",
            shipStreet: "Bulevar fiskalizacije 1",
            shipCity: "Beograd",
            shipPostalCode: "11000",
            guestEmail: `qa.fiscal.${runId}@example.invalid`,
            termsAcceptedAt: new Date(),
            items: {
              create: {
                productId: dcProductId,
                sku: fixture.dcSku,
                name: `QA DC artikal ${runId}`,
                qty: 3,
                unitPriceFull: 1_000,
                unitPriceSale: 1_000,
                warehouseId: dcWarehouseId,
                warehouseReservedQty: 3,
              },
            },
          },
          select: { id: true },
        });
        await tx.product.update({
          where: { id: dcProductId },
          data: { dcAvailableQty: 7 },
        });
        return created;
      });
      fiscalOrderId = fiscalOrder.id;

      const before = await db.warehouseStock.findUniqueOrThrow({
        where: {
          warehouseId_productId: {
            warehouseId: dcWarehouseId,
            productId: dcProductId,
          },
        },
      });
      expect(before.qty).toBe(10);

      await page.goto(`/admin/erp/prodajni-nalozi/${fiscalOrderId}`, {
        waitUntil: "domcontentloaded",
      });
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Izdaj fiskalni račun" }).click();
      await expect(
        page.getByRole("button", { name: "Ponovo pošalji fiskalni račun" }),
      ).toBeVisible({ timeout: 90_000 });

      const [document, item, stock, product, movements] = await Promise.all([
        db.fiscalDocument.findFirstOrThrow({
          where: { orderId: fiscalOrderId!, kind: "SALE", status: "ISSUED" },
        }),
        db.orderItem.findFirstOrThrow({ where: { orderId: fiscalOrderId! } }),
        db.warehouseStock.findUniqueOrThrow({
          where: {
            warehouseId_productId: {
              warehouseId: dcWarehouseId,
              productId: dcProductId,
            },
          },
        }),
        db.product.findUniqueOrThrow({ where: { id: dcProductId } }),
        db.stockMovement.findMany({
          where: { orderId: fiscalOrderId!, kind: "SALE_RESERVATION" },
        }),
      ]);
      expect(item.warehouseReservedQty).toBe(0);
      expect(stock.qty).toBe(7);
      expect(product.stock).toBe(7);
      expect(product.dcAvailableQty).toBe(7);
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({
        qty: -3,
        fiscalDocumentId: document.id,
      });

      page.once("dialog", (dialog) => dialog.accept());
      await page
        .getByRole("button", { name: "Ponovo pošalji fiskalni račun" })
        .click();
      await expect
        .poll(() =>
          db.stockMovement.count({
            where: { orderId: fiscalOrderId!, kind: "SALE_RESERVATION" },
          }),
        )
        .toBe(1);
      expect(
        (
          await db.warehouseStock.findUniqueOrThrow({
            where: {
              warehouseId_productId: {
                warehouseId: dcWarehouseId,
                productId: dcProductId,
              },
            },
          })
        ).qty,
      ).toBe(7);
    });

    await test.step("stara rezervacija bez reference na magacin fiskalizuje se bez duplog skidanja", async () => {
      const legacyOrderNumber = `QA-LEGACY-FISCAL-${runId}`;
      const legacyOrder = await db.$transaction(async (tx) => {
        const created = await tx.order.create({
          data: {
            number: legacyOrderNumber,
            status: "KREIRANO",
            channel: "WEB",
            subtotal: 2_000,
            total: 2_000,
            shippingMethod: "KURIR",
            paymentMethod: "UPLATA_NA_RACUN",
            shipFirstName: "QA",
            shipLastName: "Stara rezervacija",
            shipPhone: "+38160111998",
            shipStreet: "Bulevar stare rezervacije 1",
            shipCity: "Beograd",
            shipPostalCode: "11000",
            guestEmail: `qa.legacy.fiscal.${runId}@example.invalid`,
            termsAcceptedAt: new Date(),
            items: {
              create: {
                productId: dcProductId,
                sku: fixture.dcSku,
                name: `QA DC artikal ${runId}`,
                qty: 2,
                unitPriceFull: 1_000,
                unitPriceSale: 1_000,
                warehouseReservedQty: 2,
              },
            },
          },
          select: { id: true, items: { select: { id: true } } },
        });
        await tx.warehouseStock.update({
          where: {
            warehouseId_productId: {
              warehouseId: dcWarehouseId,
              productId: dcProductId,
            },
          },
          data: { qty: { decrement: 2 } },
        });
        await tx.product.update({
          where: { id: dcProductId },
          data: { stock: 5, dcAvailableQty: 5 },
        });
        await tx.stockMovement.create({
          data: {
            idempotencyKey: `legacy-reservation:${created.id}`,
            warehouseId: dcWarehouseId,
            productId: dcProductId,
            orderId: created.id,
            orderItemId: created.items[0].id,
            kind: "SALE_RESERVATION",
            sku: fixture.dcSku,
            qty: -2,
            note: "QA simulacija stare rezervacije bez warehouseId na stavci",
          },
        });
        return created;
      });
      legacyFiscalOrderId = legacyOrder.id;

      await page.goto(`/admin/erp/prodajni-nalozi/${legacyFiscalOrderId}`, {
        waitUntil: "domcontentloaded",
      });
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Izdaj fiskalni račun" }).click();
      await expect(
        page.getByRole("button", { name: "Ponovo pošalji fiskalni račun" }),
      ).toBeVisible({ timeout: 90_000 });

      const [item, stock, product, movements] = await Promise.all([
        db.orderItem.findFirstOrThrow({ where: { orderId: legacyFiscalOrderId! } }),
        db.warehouseStock.findUniqueOrThrow({
          where: {
            warehouseId_productId: {
              warehouseId: dcWarehouseId,
              productId: dcProductId,
            },
          },
        }),
        db.product.findUniqueOrThrow({ where: { id: dcProductId } }),
        db.stockMovement.findMany({
          where: { orderId: legacyFiscalOrderId!, kind: "SALE_RESERVATION" },
        }),
      ]);
      expect(item.warehouseId).toBeNull();
      expect(item.warehouseReservedQty).toBe(0);
      expect(stock.qty).toBe(5);
      expect(product.stock).toBe(5);
      expect(product.dcAvailableQty).toBe(5);
      expect(movements).toHaveLength(1);
      expect(movements[0].qty).toBe(-2);

      page.once("dialog", (dialog) => dialog.accept());
      await page
        .getByRole("button", { name: "Ponovo pošalji fiskalni račun" })
        .click();
      await expect
        .poll(() =>
          db.stockMovement.count({
            where: {
              orderId: legacyFiscalOrderId!,
              kind: "SALE_RESERVATION",
            },
          }),
        )
        .toBe(1);
    });
  });

  async function login(page: Page) {
    await page.goto("/admin/prijava?callbackUrl=%2Fadmin", {
      waitUntil: "domcontentloaded",
    });
    await page.getByLabel("E-pošta").fill(fixture.adminEmail);
    await page.getByLabel("Lozinka").fill(fixture.adminPassword);
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 90_000 });
  }

  async function cleanup() {
    if (!db) return;
    if (dispatchId) {
      await db.dispatchNote.deleteMany({ where: { id: dispatchId } });
      dispatchId = "";
    }
    await db.order.deleteMany({
      where: {
        OR: [
          ...(customerId ? [{ customerId }] : []),
          ...(orderId ? [{ id: orderId }] : []),
          ...(webOrderId ? [{ id: webOrderId }] : []),
          ...(fiscalOrderId ? [{ id: fiscalOrderId }] : []),
          ...(legacyFiscalOrderId ? [{ id: legacyFiscalOrderId }] : []),
        ],
      },
    });
    orderId = null;
    webOrderId = null;
    fiscalOrderId = null;
    legacyFiscalOrderId = null;
    await db.stockMovement.deleteMany({
      where: {
        productId: {
          in: [dcProductId, supplierProductId].filter(Boolean),
        },
      },
    });
    await db.product.deleteMany({
      where: { id: { in: [dcProductId, supplierProductId].filter(Boolean) } },
    });
    await db.priceList.deleteMany({ where: { id: priceListId } });
    await db.customer.deleteMany({
      where: { id: { in: [customerId, uiCompanyId].filter(Boolean) } },
    });
    await db.supplier.deleteMany({ where: { id: supplierId } });
    await db.group.deleteMany({ where: { slug: `qa-sales-group-${runId}` } });
    await db.collection.deleteMany({
      where: { slug: `qa-sales-collection-${runId}` },
    });
    if (createdWarehouse) {
      await db.warehouse.deleteMany({ where: { id: dcWarehouseId } });
    }
    await db.auditLog.deleteMany({ where: { actorId: adminId } });
    await db.rateLimitBucket.deleteMany({
      where: { key: { contains: fixture.adminEmail } },
    });
    await db.adminUser.deleteMany({ where: { id: adminId } });
  }
});

function createDatabaseClient() {
  const raw = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL,
  ].find((value) => value?.trim());
  if (!raw) {
    throw new Error("DATABASE_URL is required for sales-order E2E tests.");
  }
  const url = new URL(raw);
  const schema = url.searchParams.get("schema")?.trim() || undefined;
  url.searchParams.delete("schema");
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    url.searchParams.set(
      "sslmode",
      process.env.DATABASE_SSLMODE?.trim() || "no-verify",
    );
    url.searchParams.delete("uselibpqcompat");
  }
  return new PrismaClient({
    adapter: new PrismaPg(
      {
        connectionString: url.toString(),
        max: 2,
        connectionTimeoutMillis: 15_000,
      },
      { schema },
    ),
  });
}
