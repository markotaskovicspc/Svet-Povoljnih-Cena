import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { parsePhoneImport } from "@/lib/messaging/contact-import";
import { resolveAudience, type AudienceFilter } from "@/lib/viber/audience";
import { audienceDescription } from "@/lib/viber/ui";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const actor = await requireAdminAction(["ADS"], "/admin/viber");
  const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return reply({ error: "Izaberite Excel tabelu." }, 400);
    const channel = form.get("channel") === "SMS" ? "SMS" : "VIBER";
    const column = form.get("column");
    let parsed;
    try { parsed = await parsePhoneImport(file, column === null || column === "" ? undefined : Number(column)); }
    catch (e) { return reply({ error: e instanceof Error ? e.message : "Tabela nije ispravna." }, 400); }
    const combine = form.get("combine") === "true";
    const filter: AudienceFilter = { channel, importedContacts: parsed.contacts, ...(combine ? { allStoredPhones: true, phoneScope: "current" } : {}) };
    const eligibleImported = await resolveAudience({ ...filter, allStoredPhones: false });
    const eligible = combine ? await resolveAudience(filter) : eligibleImported;
    const preview = { totalRows: parsed.totalRows, unique: parsed.contacts.length, duplicates: parsed.duplicates, invalid: parsed.invalidRows.length, invalidRows: parsed.invalidRows.slice(0, 10), blocked: parsed.contacts.length - eligibleImported.length, eligible: eligible.length, samples: parsed.contacts.slice(0, 5), columns: parsed.columns, phoneColumn: parsed.phoneColumn, digest: parsed.digest };
    if (form.get("mode") !== "commit") return reply(preview);
    if (form.get("digest") !== parsed.digest) return reply({ error: "Tabela je promenjena. Ponovo pregledajte uvoz." }, 400);
    if (form.get("confirmed") !== "true") return reply({ error: `Potvrdite da su kontakti zainteresovani za ${channel} poruke.` }, 400);
    const name = String(form.get("name") ?? "").trim().slice(0, 120);
    if (!name || !eligible.length || !parsed.contacts.length) return reply({ error: "Unesite naziv liste i izaberite tabelu sa važećim brojevima za slanje." }, 400);
    filter.importSource = { fileName: file.name.slice(0, 160), actorId: actor.id, importedAt: new Date().toISOString(), declaration: `Operator potvrđuje da su kontakti zainteresovani za ${channel} poruke.` };
    // Retrying a timed-out save cannot create duplicate lists. Existing audiences stay immutable.
    const id = "phoneimport_" + createHash("sha256").update(JSON.stringify([actor.id, channel, parsed.digest, combine, name])).digest("hex");
    const audience = await db.viberAudienceQuery.upsert({ where: { id }, create: { id, name, filter: filter as never }, update: {}, select: { id: true, name: true } });
    return reply({ ...preview, audience: { ...audience, description: audienceDescription(filter) } });
  } catch {
    return reply({ error: "Uvoz nije potvrđen. Pokušajte ponovo sa istom tabelom." }, 500);
  }
}
