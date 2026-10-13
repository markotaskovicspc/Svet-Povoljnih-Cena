import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));
import { buildDispatchNotePdf, dispatchNotePagesSvg } from "@/lib/admin/dispatch-note-print.server";
import { dispatchNoteFixture } from "../helpers/dispatch-note-fixture";

it("renders an A4 dispatch note with barcode, SKU, quantity and signature spaces like the reference", async () => {
  const note = dispatchNoteFixture();
  const [svg] = dispatchNotePagesSvg(note);
  expect(svg).toContain('viewBox="0 0 595 842"');
  for (const value of ["Pošiljalac:", "Primalac:", "ACODE", "SKU", "Količina", "8605079400014", "FLEX SEAT", "Robu izdao", "Robu primio"]) expect(svg).toContain(value);
  expect(svg).toContain('fill="#19647e"');
  expect(svg).not.toContain("Vrednost sa PDV-om");
  expect(svg).not.toContain("168.000");
  const pdf = await buildDispatchNotePdf(note);
  const doc = await PDFDocument.load(pdf);
  expect(doc.getPageCount()).toBe(1);
  expect(doc.getPage(0).getSize()).toEqual({ width: 595, height: 842 });
  if (process.env.DISPATCH_PREVIEW_DIR) {
    mkdirSync(process.env.DISPATCH_PREVIEW_DIR, { recursive: true });
    writeFileSync(join(process.env.DISPATCH_PREVIEW_DIR, "otpremnica-pregled.pdf"), pdf);
  }
});

it("preserves price visibility and internal transfers always hide prices", () => {
  const note = dispatchNoteFixture({ showPrices: true });
  const svg = dispatchNotePagesSvg(note).join("");
  expect(svg).toContain("Cena (RSD)");
  expect(svg).toContain("Vrednost sa PDV-om: 168.000,00 RSD");
  const internal = dispatchNotePagesSvg({ ...note, type: "INTERNAL" }).join("");
  expect(internal).toContain("Interni prenos");
  expect(internal).not.toContain("168.000");
  expect(internal).not.toContain("Cena (RSD)");
});

it("paginates long names and notes without dropping any printed text or items", async () => {
  const note = dispatchNoteFixture({ showPrices: true });
  note.notes = "Napomena sa srpskim slovima čćšžđ. ".repeat(55) + "KRAJ_NAPOMENE";
  note.items = Array.from({ length: 35 }, (_, i) => ({ ...note.items[0],
    sku: `ART-${i + 1}`, name: i === 0 ? "Dugačak naziv ".repeat(250) + "KRAJ_NAZIVA" : `Stolica ${i + 1} čćšžđ Љубичаста`,
    shortDescription: i === 0 ? "Dugačak opis ".repeat(250) + "KRAJ_OPISA" : null,
  }));
  const svgs = dispatchNotePagesSvg(note);
  const joined = svgs.join("");
  expect(svgs.length).toBeGreaterThan(3);
  expect(joined).toContain("KRAJ_NAPOMENE");
  expect(joined).toContain("KRAJ_NAZIVA");
  expect(joined).not.toContain("KRAJ_OPISA");
  expect(joined).toContain("ART-35");
  expect(joined).toContain("Љубичаста");
  expect(joined).toContain("1. nast.");
  for (const svg of svgs) {
    const rowEdges = [...svg.matchAll(/<rect x="[^\"]+" y="([\d.]+)" width="[^\"]+" height="([\d.]+)" fill="#fff" stroke=/g)];
    for (const [, y, height] of rowEdges) expect(Number(y) + Number(height)).toBeLessThanOrEqual(685);
  }
  if (process.env.DISPATCH_PREVIEW_DIR) {
    mkdirSync("tmp/pdfs/dispatch", { recursive: true });
    for (const [index, svg] of svgs.entries()) writeFileSync(`tmp/pdfs/dispatch/stress-${index + 1}.svg`, svg);
    writeFileSync("tmp/pdfs/dispatch/stress.pdf", await buildDispatchNotePdf(note));
    writeFileSync("tmp/pdfs/dispatch/prices.pdf", await buildDispatchNotePdf(dispatchNoteFixture({ showPrices: true })));
    writeFileSync("tmp/pdfs/dispatch/internal.pdf", await buildDispatchNotePdf(dispatchNoteFixture({ type: "INTERNAL", showPrices: true })));
  }
});

it("escapes document values instead of allowing SVG markup", () => {
  const note = dispatchNoteFixture({ receiverName: '<script>&"' });
  expect(dispatchNotePagesSvg(note).join("")).toContain("&lt;script&gt;&amp;&quot;");
});

it("uses compact names instead of long catalog descriptions and attributes", async () => {
  const note = dispatchNoteFixture();
  note.items = [
    { ...note.items[0], shortName: "BON APPETIT", name: "3u1 set za doručak BON APPETIT", subgroup: "Kuvanje i pečenje", shortDescription: "Snaga 1050 W / Kapacitet rerne 7 L", attribute1: "DUGAČKI_ATRIBUT", color1: "CRNA" },
    { ...note.items[0], shortName: "   ", name: "Kancelarijska stolica FLEX SEAT" },
  ];
  const [svg] = dispatchNotePagesSvg(note);
  expect(svg).toContain("BON APPETIT");
  expect(svg).toContain("FLEX SEAT");
  expect(svg).not.toContain("Podgrupa:");
  expect(svg).not.toContain("Snaga 1050");
  expect(svg).not.toContain("DUGAČKI_ATRIBUT");
  const nameRows = [...svg.matchAll(/<rect x="245" y="[\d.]+" width="245" height="([\d.]+)" fill="#fff" stroke=/g)];
  expect(nameRows.slice(0, 2).map(match => Number(match[1]))).toEqual([25, 25]);
  if (process.env.DISPATCH_PREVIEW_DIR) writeFileSync(join(process.env.DISPATCH_PREVIEW_DIR, "otpremnica-kratki-nazivi.pdf"), await buildDispatchNotePdf(note));
});
