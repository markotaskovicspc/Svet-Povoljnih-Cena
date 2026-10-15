"use server";
import { withAdminState, type AdminActionState } from "@/lib/admin";
import { saveReclamationAddress } from "@/lib/admin/reclamation-address.server";

// Acknowledge the committed change first; the form refreshes the page separately.
export async function saveAddressAction(_state: AdminActionState, formData: FormData) {
  return withAdminState(
    { allowed: ["OPS"], action: "reclamation.addressUpdate", entity: "Reclamation" },
    async (_actorId, data: FormData) => {
      const id = String(data.get("id") ?? "");
      if (!id) return { ok: false as const, error: "Reklamacija nije izabrana." };
      const fields = ["shipFirstName", "shipLastName", "shipPhone", "shipStreet", "shipHouseNumber", "shipCity", "shipPostalCode"];
      const address = Object.fromEntries(fields.map(key => [key, String(data.get(key) ?? "")]));
      const diff = await saveReclamationAddress(id, { ...address, shipXExpressTownId: Number(data.get("shipXExpressTownId")) || null });
      return { ok: true as const, entityId: id, diff, message: "Adresa reklamacije je sačuvana za preuzimanje i slanje zamene." };
    },
  )(formData);
}

