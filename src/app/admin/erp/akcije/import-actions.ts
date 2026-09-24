"use server";
import { z } from "zod";
import { revalidatePath, updateTag } from "next/cache";
import { db } from "@/lib/db";
import { requireAdminAction, withAdminState, type AdminActionState } from "@/lib/admin";
import { parseActionPriceRows, parseActionPriceText, MAX_ACTION_IMPORT_ROWS } from "@/lib/admin/action-price-import";
import { actionPriceImportPreview } from "@/lib/admin/action-price-import.server";
const rowsSchema = z.array(z.object({ row: z.number().int().min(2), sku: z.string().trim().min(1).max(100), salePrice: z.number().finite().positive() })).min(1).max(MAX_ACTION_IMPORT_ROWS);
export async function previewActionPriceImport(form: FormData) {
  await requireAdminAction(["CONTENT"]);
  try {
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 512_000) throw new Error("Izaberite CSV ili XLSX datoteku do 500 KB.");
    let rows;
    if (file.name.toLowerCase().endsWith(".xlsx")) {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const sheet = workbook.worksheets[0];
      if (!sheet || sheet.rowCount > MAX_ACTION_IMPORT_ROWS + 1 || sheet.columnCount > 20) throw new Error("Prvi list mora imati do 500 artikala i do 20 kolona.");
      const records: string[][] = [];
      sheet.eachRow({ includeEmpty: true }, row => {
        const cells: string[] = [];
        for (let i = 1; i <= sheet.columnCount; i++) {
          const cell = row.getCell(i);
          if (cell.type === ExcelJS.ValueType.Formula || cell.type === ExcelJS.ValueType.Error) throw new Error(`Red ${row.number}: koristite vrednosti, bez formula i Excel grešaka.`);
          cells.push(cell.text);
        }
        records.push(cells);
      });
      rows = parseActionPriceRows(records);
    } else if (file.name.toLowerCase().endsWith(".csv")) rows = parseActionPriceText(await file.text());
    else throw new Error("Podržani su CSV i XLSX formati.");
    const preview = await actionPriceImportPreview(db, String(form.get("actionId") ?? ""), rows);
    return { ok: true as const, preview, input: rows };
  } catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "Uvoz nije pročitan." }; }
}
export async function applyActionPriceImport(_state: AdminActionState, form: FormData) {
  return withAdminState({ allowed: ["CONTENT"], action: "action.products.import", entity: "Action" }, async (_actor, data: FormData) => {
    const actionId = String(data.get("actionId") ?? "");
    const input = rowsSchema.parse(JSON.parse(String(data.get("rows") ?? "[]")));
    const rows = parseActionPriceRows([["Šifra", "Akcijska cena"], ...input.map(row => [row.sku, row.salePrice.toFixed(2)])]);
    if (input.some(row => Math.abs(row.salePrice * 100 - Math.round(row.salePrice * 100)) > 0.000001)) throw new Error("Cena sme imati najviše dve decimale.");
    // Preserve original spreadsheet row numbers for the preview fingerprint.
    rows.forEach((row, i) => { row.row = input[i].row; });
    const count = await db.$transaction(async tx => {
      const preview = await actionPriceImportPreview(tx, actionId, rows);
      if (!preview.valid) throw new Error("Uvoz sadrži greške. Ponovite pregled.");
      if (preview.fingerprint !== data.get("fingerprint")) throw new Error("Podaci su se promenili od pregleda. Ponovo učitajte datoteku i proverite cene.");
      for (const row of preview.rows) {
        const productId = row.productId!;
        await tx.actionProduct.upsert({ where: { actionId_productId: { actionId, productId } }, create: { actionId, productId, salePrice: row.salePrice }, update: { salePrice: row.salePrice } });
      }
      await tx.action.update({ where: { id: actionId }, data: { products: { connect: preview.rows.map(row => ({ id: row.productId! })) } } });
      return rows.length;
    }, { isolationLevel: "Serializable", timeout: 60_000 });
    updateTag("catalog-pricing"); updateTag("catalog-products"); updateTag("storefront-home");
    revalidatePath("/admin/erp/akcije"); revalidatePath("/", "layout");
    return { ok: true as const, entityId: actionId, message: `Uvezeno ${count} akcijskih cena.`, diff: { count, rows }, result: undefined };
  })(form);
}
