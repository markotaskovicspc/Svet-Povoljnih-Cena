"use server";
import { revalidatePath } from "next/cache";
import { withAdminState } from "@/lib/admin";
import type { AdminActionState } from "@/lib/admin/action-state";
import { resolveReportPeriod } from "@/lib/admin/report-period";
import { ananasError, syncAnanasDocuments } from "@/lib/ananas/sync";
import { syncAnanasOrders } from "@/lib/ananas/orders-sync";
import { configureAnanasInventory, postPendingAnanasInventory } from "@/lib/ananas/inventory.server";
import { advanceAnanasInventoryHistory } from "@/lib/ananas/inventory-history.server";

export async function saveAnanasInventory(_: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdminState({ module: "/admin/erp/ananas", allowed: ["OPS"], action: "ananas.inventory.configure", entity: "AdminSetting" }, async actorId => {
    const policy = await configureAnanasInventory(form.get("enabled") === "on", form.get("allowNegative") === "on", actorId);
    revalidatePath("/admin/erp/ananas");
    return { ok: true, entityId: "ananas-inventory", message: "Podešavanje Ananas lagera je sačuvano.", diff: policy };
  })();
}

export async function runAnanasInventoryHistory() {
  return withAdminState<[], Awaited<ReturnType<typeof advanceAnanasInventoryHistory>>>({ module: "/admin/erp/ananas", allowed: ["OPS"], action: "ananas.inventory.history", entity: "AdminSetting" }, async actorId => {
    const result = await advanceAnanasInventoryHistory(actorId);
    revalidatePath("/admin/erp/ananas"); revalidatePath("/admin/erp/stanje-po-magacinima");
    return { ok: true, entityId: "ananas-inventory", result, message: `Istorija do ${new Date(result.through).toLocaleDateString("sr-Latn-RS", { timeZone: "Europe/Belgrade" })}. Knjiženo ${result.posted} dokumenata.${result.needsReview ? " Preostale stavke traže proveru." : ""}`, diff: result };
  })();
}

export async function importAnanasOrders(_: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdminState({ module: "/admin/erp/ananas", allowed: ["OPS"], action: "ananas.orders.import", entity: "AnanasSyncRun" }, async () => {
    const period = resolveReportPeriod({ range: "custom", from: String(form.get("from") ?? ""), to: String(form.get("to") ?? "") });
    if (period.preset !== "custom") return { ok: false, message: "Izaberite ispravan period." };
    try {
      const result = await syncAnanasOrders(period.start, period.endExclusive);
      revalidatePath("/admin/erp/prodajni-nalozi"); revalidatePath("/admin/erp/ananas");
      return { ok: true, entityId: result.runId, message: `Uvezeno ${result.count} porudžbina; dodatno provereno ${result.checked} ranijih porudžbina. Bez promene lagera i fiskalizacije.` };
    } catch (error) {
      revalidatePath("/admin/erp/ananas");
      return { ok: false, message: ananasError(error) };
    }
  })();
}

export async function importAnanas(_: AdminActionState, form: FormData): Promise<AdminActionState> {
  const deadline = Date.now() + 210000;
  return withAdminState({ module: "/admin/erp/ananas", allowed: ["OPS"], action: "ananas.import", entity: "AnanasSyncRun" }, async () => {
    const from = String(form.get("from") ?? ""), to = String(form.get("to") ?? "");
    const period = resolveReportPeriod({ range: "custom", from, to });
    if (period.preset !== "custom") return { ok: false, message: "Izaberite ispravan period." };
    try {
      const result = await syncAnanasDocuments(period.start, period.endExclusive);
      const inventory = await postPendingAnanasInventory(40, undefined, deadline);
      revalidatePath("/admin/erp/ananas");
      revalidatePath("/admin");
      return { ok: true, entityId: result.runId, message: `Uvoz završen: ${result.count} dokumenata. Knjiženo na Ananas lager: ${inventory.posted}; za proveru: ${inventory.failed}. Postojeći računi nisu duplirani.` };
    } catch (error) {
      revalidatePath("/admin/erp/ananas");
      return { ok: false, message: ananasError(error) };
    }
  })();
}
