"use server";
import { revalidatePath } from "next/cache";
import { requireAdminAction, withAdminState } from "@/lib/admin";
import { carrierSchema, statementInputSchema } from "@/lib/courier/finance";
import { parseStatementFile } from "@/lib/courier/statement-file";
import { previewStatement, importStatement, linkStatementLine } from "@/lib/courier/finance.server";
const path = "/admin/erp/kurirski-obracun";
export async function previewCourierFile(form: FormData) {
  await requireAdminAction(["OPS"]);
  try {
    const file = form.get("file");
    if (!(file instanceof File) || file.size > 2 * 1024 * 1024) throw new Error("Izaberite datoteku do 2 MB.");
    const provider = carrierSchema.parse(form.get("provider"));
    const rows = await parseStatementFile(Buffer.from(await file.arrayBuffer()), file.name, provider, String(form.get("date") ?? ""));
    return { ok: true as const, preview: await previewStatement({ provider, filename: file.name, documentNo: form.get("documentNo"), rows }) };
  } catch (e) { return { ok: false as const, message: e instanceof Error ? e.message : "Uvoz nije pročitan." }; }
}
export async function confirmCourierFile(input: unknown, fingerprint: string) {
  return withAdminState({ allowed: ["OPS"], action: "courier.statement.import", entity: "CourierStatement" }, async actorId => {
    const result = await importStatement(statementInputSchema.parse(input), fingerprint, actorId);
    revalidatePath(path);
    return { ok: true as const, entityId: result.id, diff: result, message: result.alreadyImported ? "Dokument je već uvezen. Nema dupliranja." : `Uvezeno. Povezano ${result.matched} stavki.`, result };
  })();
}
export async function connectCourierLine(form: FormData) {
  return withAdminState({ allowed: ["OPS"], action: "courier.statement.link", entity: "CourierStatementLine" }, async () => {
    const id = String(form.get("id") ?? "");
    await linkStatementLine(id, String(form.get("trackingNo") ?? "").trim());
    revalidatePath(path);
    return { ok: true as const, entityId: id, message: "Stavka povezana sa pošiljkom." };
  })();
}
