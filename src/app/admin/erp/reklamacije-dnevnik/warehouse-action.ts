"use server";

import { withAdminState, type AdminActionState } from "@/lib/admin";
import { saveReclamationWarehouse } from "@/lib/admin/reclamation-fulfillment.server";

export async function saveWarehouseAction(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    { allowed: ["OPS"], action: "reclamation.warehouseUpdate", entity: "Reclamation" },
    async (actorId, formData: FormData) => {
      const id = String(formData.get("id") ?? "");
      const warehouseId = String(formData.get("warehouseId") ?? "");
      if (!id || !warehouseId) {
        return { ok: false as const, error: "Izaberite magacin." };
      }
      const rows = String(formData.get("replacementPackageRows") ?? "").split(",").filter(Boolean);
      const entered = rows.map((row) => Object.fromEntries(
        ["weightKg", "widthCm", "depthCm", "heightCm"].map((key) => [key, Number(formData.get(`replacementPackage.${row}.${key}`))]),
      ));
      const packages = entered.length && entered.some((pkg) => Object.values(pkg).some((value) => value !== 0)) ? entered : undefined;
      const saved = await saveReclamationWarehouse({ reclamationId: id, warehouseId, packages, actorId });
      // This page and the ERP lists are force-dynamic. Return the durable
      // save/audit result before the client requests the refreshed page.
      // revalidatePath here would keep the form pending during that render.
      return {
        ok: true as const,
        entityId: id,
        diff: { warehouseId: saved.warehouseId, warehouseStatus: saved.warehouseStatus, replacementReadyAt: saved.replacementReadyAt?.toISOString() ?? null },
        message: saved.replacementReadyAt
          ? "Spremnost je sačuvana. Zamena će ući u picking tek na klik „Učitaj porudžbine“ u nalogu odgovarajućeg kurira."
          : "Magacinski zadatak je sačuvan.",
      };
    },
  )(formData);
}
