import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ErpRow } from "@/lib/admin/erp";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  getModule: vi.fn(),
  getDefinition: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ requireAdminAction: mocks.authorize }));
vi.mock("@/lib/admin/erp", () => ({
  getErpModule: mocks.getModule,
  getErpModuleDefinition: mocks.getDefinition,
  countArticleRows: vi.fn(),
}));

import { GET as exportRows } from "@/app/api/admin/erp/[module]/export/route";
import { GET as listRows } from "@/app/api/admin/erp/[module]/rows/route";

const columns = [
  { key: "orderDate", label: "Datum porudžbine", type: "date", defaultVisible: true },
  { key: "fiscalIssuedAt", label: "Datum fiskalizacije", type: "date", defaultVisible: true },
  { key: "totalNet", label: "Bez PDV-a", type: "money", defaultVisible: true },
  { key: "totalGross", label: "Sa PDV-om", type: "money", defaultVisible: true },
];
const context = () => ({ params: Promise.resolve({ module: "prodajni-nalozi" }) });

function setRows(rows: ErpRow[]) {
  mocks.getModule.mockResolvedValue({ title: "Pregled porudžbina", columns, rows });
}

async function readExport(query = "") {
  const response = await exportRows(new Request(
    `http://localhost/api/admin/erp/prodajni-nalozi/export?${query}`,
  ), context());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await response.arrayBuffer());
  return workbook.worksheets[0];
}

beforeEach(() => {
  mocks.authorize.mockResolvedValue(undefined);
  mocks.getDefinition.mockReturnValue({ columns });
});

describe("ERP Excel dates", () => {
  it("keeps the export and turnover summary on the same Belgrade day around midnight", async () => {
    const dates = [
      "2026-09-12T21:59:59.999Z", // Previous local day, excluded.
      "2026-09-12T22:24:22.192Z", // 13 September, 00:24.
      "2026-09-12T22:49:15.682Z", // 13 September, 00:49.
      "2026-09-13T21:59:59.999Z", // Last millisecond of the selected day.
      "2026-09-13T22:00:00.000Z", // Next local day, excluded.
    ];
    setRows(dates.map((orderDate, index) => ({
      id: `line-${index}`,
      detailId: `order-${index}`,
      values: { orderDate, fiscalIssuedAt: null, totalNet: 100, totalGross: 120 },
    })));
    const query = new URLSearchParams({
      filters: JSON.stringify([
        { columnKey: "orderDate", operator: "equals", value: "2026-09-13" },
      ]),
      pageSize: "1",
    }).toString();
    const response = await listRows(new Request(
      `http://localhost/api/admin/erp/prodajni-nalozi/rows?${query}`,
    ), context());
    const result = await response.json();
    expect(result.rows).toHaveLength(1);
    expect(result.summary).toEqual({
      orderCount: 3, rowCount: 3, totalNet: 300, totalGross: 360,
    });

    const sheet = await readExport(query);
    expect(sheet.rowCount).toBe(4);
    expect(sheet.getCell("A2").value).toEqual(new Date("2026-09-13T00:24:22.192Z"));
    expect(sheet.getCell("A3").value).toEqual(new Date("2026-09-13T00:49:15.682Z"));
    // XLSX serial numbers can round sub-second values by a millisecond.
    expect((sheet.getCell("A4").value as Date).toISOString()).toMatch(/^2026-09-13T23:59:59/);
    expect(sheet.getCell("A2").numFmt).toBe("dd.mm.yyyy hh:mm");
    expect([2, 3, 4].reduce((sum, row) => sum + Number(sheet.getCell(`D${row}`).value), 0))
      .toBe(result.summary.totalGross);
  });

  it.each([
    ["2026-01-12T23:24:00.000Z", "2026-01-13T00:24:00.000Z"],
    ["2026-03-29T00:30:00.000Z", "2026-03-29T01:30:00.000Z"],
    ["2026-03-29T01:30:00.000Z", "2026-03-29T03:30:00.000Z"],
    ["2026-10-25T00:30:00.000Z", "2026-10-25T02:30:00.000Z"],
    ["2026-10-25T01:30:00.000Z", "2026-10-25T02:30:00.000Z"],
  ])("exports local order and fiscal times across seasonal offsets: %s", async (input, expected) => {
    setRows([{ id: "one", values: { orderDate: input, fiscalIssuedAt: input } }]);
    const sheet = await readExport();
    expect(sheet.getCell("A2").value).toEqual(new Date(expected));
    expect(sheet.getCell("B2").value).toEqual(new Date(expected));
  });

  it("preserves calendar-only dates and blank or invalid date values", async () => {
    setRows([
      { id: "one", values: { orderDate: "2026-09-13", fiscalIssuedAt: null } },
      { id: "two", values: { orderDate: "invalid", fiscalIssuedAt: "" } },
    ]);
    const sheet = await readExport();
    expect(sheet.getCell("A2").value).toEqual(new Date("2026-09-13T00:00:00.000Z"));
    expect(sheet.getCell("A2").numFmt).toBe("dd.mm.yyyy");
    expect(sheet.getCell("B2").value).toBe("");
    expect(sheet.getCell("A3").value).toBe("invalid");
    expect(sheet.getCell("B3").value).toBe("");
  });
});
