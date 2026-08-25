import { describe, expect, it } from "vitest";
import {
  SUPPLIER_ALLOCATION,
  calculateSalesLineTotals,
  manualOrderNumberPrefix,
  manualSalesOrderInputSchema,
  resolveSalesOrderWarehouse,
  roundSalesMoney,
} from "@/lib/admin/sales-order";

const validInput = {
  channel: "VP",
  customerId: "customer-1",
  priceListId: "price-list-1",
  status: "KREIRANO",
  paid: false,
  sefAccepted: false,
  lines: [
    {
      sku: "SKU-1",
      qty: 2,
      unitPrice: 1_200,
      allocation: "warehouse-1",
    },
  ],
};

describe("pravilo magacina prodajne porudžbine", () => {
  it("DOB sa stanjem u DC-u automatski bira DC", () => {
    expect(
      resolveSalesOrderWarehouse({
        articleStatus: "DOB",
        dcAvailableQty: 1,
        defaultWarehouseId: "dc",
      }),
    ).toEqual({ type: "WAREHOUSE", warehouseId: "dc" });
  });

  it("DOB bez stanja u DC-u automatski bira dobavljača", () => {
    expect(
      resolveSalesOrderWarehouse({
        articleStatus: "DOB",
        dcAvailableQty: 0,
        defaultWarehouseId: "dc",
      }),
    ).toEqual({ type: "SUPPLIER" });
  });

  it.each(["SP", "IT", "DTZ", "ARH", "UZ"])(
    "status %s bira DC i kada je stanje nula",
    (articleStatus) => {
      expect(
        resolveSalesOrderWarehouse({
          articleStatus,
          dcAvailableQty: 0,
          defaultWarehouseId: "dc",
        }),
      ).toEqual({ type: "WAREHOUSE", warehouseId: "dc" });
    },
  );

  it("vraća prazno kada obavezni DC nije definisan", () => {
    expect(
      resolveSalesOrderWarehouse({
        articleStatus: "SP",
        dcAvailableQty: 5,
        defaultWarehouseId: null,
      }),
    ).toBeNull();
  });
});

describe("obračun prodajne stavke", () => {
  it("računa bruto, neto i PDV po šifri sa stopom 20%", () => {
    expect(calculateSalesLineTotals(3, 120)).toEqual({
      totalNet: 300,
      totalGross: 360,
      totalVat: 60,
    });
  });

  it("zaokružuje novac na dve decimale", () => {
    expect(roundSalesMoney(10.005)).toBe(10.01);
    expect(calculateSalesLineTotals(3, 99.99)).toEqual({
      totalNet: 249.98,
      totalGross: 299.97,
      totalVat: 49.99,
    });
  });
});

describe("validacija ručne MP/VP/INO porudžbine", () => {
  it("prihvata MP kanal", () => {
    expect(
      manualSalesOrderInputSchema.safeParse({
        ...validInput,
        channel: "MP",
      }).success,
    ).toBe(true);
  });

  it("prihvata kompletnu VP porudžbinu", () => {
    expect(manualSalesOrderInputSchema.safeParse(validInput).success).toBe(true);
  });

  it("prihvata INO kanal i dobavljačku alokaciju", () => {
    const parsed = manualSalesOrderInputSchema.safeParse({
      ...validInput,
      channel: "INO",
      lines: [
        {
          ...validInput.lines[0],
          allocation: SUPPLIER_ALLOCATION,
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("odbija WEB/Ananas ručni unos", () => {
    expect(
      manualSalesOrderInputSchema.safeParse({
        ...validInput,
        channel: "WEB",
      }).success,
    ).toBe(false);
  });

  it("odbija nultu, decimalnu i negativnu količinu", () => {
    for (const qty of [0, 1.5, -1]) {
      expect(
        manualSalesOrderInputSchema.safeParse({
          ...validInput,
          lines: [{ ...validInput.lines[0], qty }],
        }).success,
      ).toBe(false);
    }
  });

  it("odbija negativnu cenu i prazan magacin", () => {
    expect(
      manualSalesOrderInputSchema.safeParse({
        ...validInput,
        lines: [
          {
            ...validInput.lines[0],
            unitPrice: -0.01,
            allocation: "",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("odbija praznu porudžbinu", () => {
    expect(
      manualSalesOrderInputSchema.safeParse({
        ...validInput,
        lines: [],
      }).success,
    ).toBe(false);
  });

  it("odbija red čija bruto vrednost ne staje u Decimal(12,2)", () => {
    expect(
      manualSalesOrderInputSchema.safeParse({
        ...validInput,
        lines: [{ ...validInput.lines[0], qty: 11, unitPrice: 999_999_999.99 }],
      }).success,
    ).toBe(false);
  });

  it("odbija zbir porudžbine koji ne staje u Decimal(12,2)", () => {
    expect(
      manualSalesOrderInputSchema.safeParse({
        ...validInput,
        lines: [
          { ...validInput.lines[0], sku: "SKU-1", qty: 6, unitPrice: 900_000_000 },
          { ...validInput.lines[0], sku: "SKU-2", qty: 6, unitPrice: 900_000_000 },
        ],
      }).success,
    ).toBe(false);
  });

  it("odbija duplu šifru bez obzira na veličinu slova", () => {
    const parsed = manualSalesOrderInputSchema.safeParse({
      ...validInput,
      lines: [
        validInput.lines[0],
        { ...validInput.lines[0], sku: "sku-1" },
      ],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toContain(
        "samo u jednom redu",
      );
    }
  });

  it("numeracija koristi odvojene MP, VP i INO prefikse", () => {
    expect(manualOrderNumberPrefix("MP")).toBe("MP");
    expect(manualOrderNumberPrefix("VP")).toBe("VP");
    expect(manualOrderNumberPrefix("INO")).toBe("INO");
  });
});
