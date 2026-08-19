import { describe, expect, it } from "vitest";
import { getErpModuleDefinition } from "@/lib/admin/erp";
import {
  isStocktakeDispatchEditable,
  nextStocktakeDispatchNumber,
  stocktakeDeleteBlocker,
  STOCKTAKE_DESTINATION_NAME,
} from "@/lib/admin/stocktake-dispatch";

describe("ERP tačka 17 — Popisi", () => {
  it("exposes stocktake dispatch commands and the required warehouse labels", () => {
    const definition = getErpModuleDefinition("popisi");

    expect(definition?.number).toBe("17");
    expect(definition?.title).toBe("Popisi");
    expect(definition?.detailHrefBase).toBe("/admin/erp/popisi");
    expect(definition?.commands.map((command) => command.label)).toEqual([
      "Novi popis",
      "Uredi",
      "Proknjiži popis",
      "Arhiviraj",
      "Obriši nacrt",
      "Arhiva",
      "Vrati iz arhive",
      "Aktivni popisi",
    ]);
    expect(definition?.commands[0]?.action).toBe("stocktake.create");
    expect(definition?.commands[2]?.action).toBe("stocktake.post");
    expect(definition?.columns.map((column) => column.label)).toEqual([
      "Broj",
      "Magacin firme koja šalje robu",
      "Magacin firme koja prima robu",
      "Status",
      "Stavke",
      "Ukupna količina",
      "Proknjiženo",
      "Arhivirano",
      "Kreirano",
    ]);
    expect(STOCKTAKE_DESTINATION_NAME).toBe("Popis");
  });

  it("generates the next annual POP number without reusing gaps", () => {
    expect(
      nextStocktakeDispatchNumber(
        ["POP-2026-0001", "POP-2026-0003", "POP-2025-9999", "OTP-2026-0004"],
        2026,
      ),
    ).toBe("POP-2026-0004");
    expect(nextStocktakeDispatchNumber([], 2027)).toBe("POP-2027-0001");
  });

  it("allows changes only while the popis is a draft", () => {
    expect(isStocktakeDispatchEditable("DRAFT")).toBe(true);
    expect(isStocktakeDispatchEditable("DRAFT", new Date())).toBe(false);
    expect(isStocktakeDispatchEditable("POSTED")).toBe(false);
    expect(isStocktakeDispatchEditable("CANCELLED")).toBe(false);
  });

  it("deletes only drafts and keeps posted history in the archive", () => {
    expect(stocktakeDeleteBlocker("POP-2026-0001", "DRAFT")).toBeNull();
    expect(stocktakeDeleteBlocker("POP-2026-0001", "POSTED")).toContain(
      "mora ostati u evidenciji",
    );
    expect(stocktakeDeleteBlocker("POP-2026-0001", "CANCELLED")).toContain(
      "ne i obrisati",
    );
  });
});
