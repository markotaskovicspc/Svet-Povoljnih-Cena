"use server";
import { revalidatePath } from "next/cache";
import { withAdminState } from "@/lib/admin";
import type { AdminActionState } from "@/lib/admin/action-state";
import { resolveReportPeriod } from "@/lib/admin/report-period";
import { ananasError, syncAnanasDocuments } from "@/lib/ananas/sync";

export async function importAnanas(_: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdminState({ allowed: ["OPS"], action: "ananas.import", entity: "AnanasSyncRun" }, async () => {
    const from = String(form.get("from") ?? ""), to = String(form.get("to") ?? "");
    const period = resolveReportPeriod({ range: "custom", from, to });
    if (period.preset !== "custom") return { ok: false, message: "Izaberite ispravan period." };
    try {
      const result = await syncAnanasDocuments(period.start, period.endExclusive);
      revalidatePath("/admin/erp/ananas");
      revalidatePath("/admin");
      return { ok: true, entityId: result.runId, message: `Uvoz završen: ${result.count} dokumenata. Postojeći računi nisu duplirani.` };
    } catch (error) { return { ok: false, message: ananasError(error) }; }
  })();
}
