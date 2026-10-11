"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdminAction, withAdminState, type AdminActionState } from "@/lib/admin";
import { MAX_PURCHASE_ORDER_IMPORT_ROWS, MAX_PURCHASE_ORDER_IMPORT_QTY, parsePurchaseOrderImportRows, parsePurchaseOrderImportCsv } from "@/lib/admin/purchase-order-import";
import { purchaseOrderImportPreview, applyPurchaseOrderImport } from "@/lib/admin/purchase-order-import.server";

const rowsSchema = z.array(z.object({ row: z.number().int().min(2), sku: z.string().trim().min(1).max(100), qty: z.number().int().min(1).max(MAX_PURCHASE_ORDER_IMPORT_QTY) })).min(1).max(MAX_PURCHASE_ORDER_IMPORT_ROWS);

export async function previewPurchaseOrderImport(form: FormData) {
  await requireAdminAction(["OPS"]);
  try {
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 512_000) throw new Error("Izaberite CSV ili XLSX datoteku do 500 KB.");
    let rows;
    if (file.name.toLowerCase().endsWith(".csv")) rows = parsePurchaseOrderImportCsv(await file.text());
    else if (file.name.toLowerCase().endsWith(".xlsx")) {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const sheet = workbook.worksheets[0];
      if (!sheet || sheet.rowCount > MAX_PURCHASE_ORDER_IMPORT_ROWS + 1 || sheet.columnCount > 20) throw new Error("Prvi list mora imati do 500 artikala i do 20 kolona.");
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
      rows = parsePurchaseOrderImportRows(records);
    } else throw new Error("Podržani su CSV i XLSX formati.");
    const result = await purchaseOrderImportPreview(db, String(form.get("orderId") ?? ""), rows);
    const preview = { rows: result.rows, fingerprint: result.fingerprint, valid: result.valid, orderNumber: result.orderNumber, supplierName: result.supplierName, orderDate: result.orderDate, currency: result.currency };
    return { ok: true as const, preview, input: rows };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Datoteka nije pročitana." };
  }
}

export async function applyPurchaseOrderImportAction(_state: AdminActionState, form: FormData) {
  return withAdminState({ allowed: ["OPS"], action: "po.items.import", entity: "PurchaseOrder" }, async (_actor, data: FormData) => {
    const orderId = z.string().min(1).max(100).parse(data.get("orderId"));
    const input = rowsSchema.parse(JSON.parse(String(data.get("rows") ?? "[]")));
    const fingerprint = z.string().regex(/^[a-f0-9]{64}$/).parse(data.get("fingerprint"));
    const count = await applyPurchaseOrderImport(orderId, input, fingerprint);
    revalidatePath(`/admin/erp/porudzbenice/${orderId}`);
    revalidatePath("/admin/erp/porudzbenice");
    revalidatePath("/admin/erp/porudzbenice-po-artiklima");
    return { ok: true as const, entityId: orderId, message: `Uvezeno ${count} stavki porudžbenice.`, diff: { count, rows: input } };
  })(form);
}
