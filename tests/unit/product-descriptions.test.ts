import { describe, expect, it } from "vitest";
import {
  hasMeaningfulProductDescription,
  preserveExistingProductDescriptions,
  resolveImportedFullDescription,
  resolveImportedShortDescription,
} from "@/lib/product-descriptions";

describe("tok opisa proizvoda", () => {
  it("prepoznaje vizuelno prazan rich text", () => {
    expect(hasMeaningfulProductDescription("<p><br></p>")).toBe(false);
    expect(hasMeaningfulProductDescription("<p>&nbsp;</p>")).toBe(false);
    expect(hasMeaningfulProductDescription("<p>Puni opis</p>")).toBe(true);
  });

  it("ne briše postojeće opise zbog praznih Excel ćelija", () => {
    expect(
      resolveImportedFullDescription({
        columnPresent: true,
        incoming: "",
        current: "<p>Admin puni opis</p>",
      }),
    ).toBe("<p>Admin puni opis</p>");
    expect(
      resolveImportedShortDescription({
        columnPresent: true,
        incoming: "   ",
        current: "Admin kratki opis",
      }),
    ).toBe("Admin kratki opis");
  });

  it("prihvata nove neprazne vrednosti iz Excel uvoza", () => {
    expect(
      resolveImportedFullDescription({
        columnPresent: true,
        incoming: "Novi puni opis",
        current: "<p>Stari opis</p>",
      }),
    ).toBe("<p>Novi puni opis</p>");
    expect(
      resolveImportedShortDescription({
        columnPresent: true,
        incoming: "  Novi kratki opis  ",
        current: "Stari kratki opis",
      }),
    ).toBe("Novi kratki opis");
  });

  it("čuva postojeće opise i kada kolona nije uključena u Excel", () => {
    expect(
      resolveImportedFullDescription({
        columnPresent: false,
        incoming: "Ignoriši me",
        current: "<p>Admin puni opis</p>",
      }),
    ).toBe("<p>Admin puni opis</p>");
    expect(
      resolveImportedShortDescription({
        columnPresent: false,
        incoming: "Ignoriši me",
        current: "Admin kratki opis",
      }),
    ).toBe("Admin kratki opis");
  });

  it("ne dozvoljava praznom supplier polju da pregazi admin sadržaj", () => {
    expect(
      preserveExistingProductDescriptions(
        {
          name: "Dobavljački naziv",
          description: "",
          shortDescription: null,
        },
        {
          description: "<p>Admin puni opis</p>",
          shortDescription: "Admin kratki opis",
        },
      ),
    ).toEqual({ name: "Dobavljački naziv" });
  });

  it("dozvoljava supplier-u da osveži opis kada šalje sadržaj", () => {
    expect(
      preserveExistingProductDescriptions(
        {
          description: "<p>Novi supplier opis</p>",
          shortDescription: "Novi kratki opis",
        },
        {
          description: "<p>Stari supplier opis</p>",
          shortDescription: "Stari kratki opis",
        },
      ),
    ).toEqual({
      description: "<p>Novi supplier opis</p>",
      shortDescription: "Novi kratki opis",
    });
  });
});
