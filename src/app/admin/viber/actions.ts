"use server";
import { parseBelgradePricingDateTime } from "@/lib/admin/pricing-date-time";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withAdminState, requireAdminAction, type AdminActionState } from "@/lib/admin";
import { audienceFormFilter } from "@/lib/viber/ui";
import { STORED_PHONES_CONSENT, parseAudienceFilter, countAudience } from "@/lib/viber/audience";
import { campaignDraftSchema, sendCampaign } from "@/lib/viber/campaign";
import { dispatch } from "@/lib/viber/transport";
import { isViberReady, isSmsReady } from "@/lib/viber/config";
import { editMessageWithAi } from "@/lib/messaging/ai";
import { envValue } from "@/lib/env";

function channelFromForm(form: FormData): "VIBER" | "SMS" { return form.get("channel") === "SMS" ? "SMS" : "VIBER"; }
function ready(form: FormData) { return channelFromForm(form) === "SMS" ? isSmsReady() : isViberReady(); }
function filterFromForm(form: FormData) {
  return audienceFormFilter({ channel: channelFromForm(form), name: String(form.get("audienceName") || "Publika kampanje"), cities: String(form.get("cities") || ""), from: String(form.get("from") || ""), to: String(form.get("to") || ""), everyone: form.get("everyone") === "true", allStoredPhones: form.get("allStoredPhones") === "true" });
}
async function resolveFilter(form: FormData) {
  const audienceId = String(form.get("audienceId") || "");
  if (audienceId) {
    const row = await db.viberAudienceQuery.findUniqueOrThrow({ where: { id: audienceId } });
    const filter = parseAudienceFilter(row.filter);
    if ((filter.channel ?? "VIBER") !== channelFromForm(form)) throw new Error("Publika pripada drugom kanalu.");
    return filter;
  }
  return filterFromForm(form);
}
export async function previewAudience(form: FormData) {
  await requireAdminAction(["ADS"]);
  try { return { ok: true, count: await countAudience(await resolveFilter(form)) }; }
  catch { return { ok: false, error: "Proverite gradove i period kupovine. Broj primalaca trenutno nije dostupan." }; }
}
export async function saveViberDraft(state: AdminActionState, form: FormData) {
  return withAdminState({ allowed: ["ADS"], action: "viber.campaignSave", entity: "ViberCampaign" }, async (_actor, f: FormData) => {
    const id = String(f.get("id") || "");
    const scheduledRaw = String(f.get("scheduledAt") || "");
    const schedule = f.get("mode") === "scheduled";
    if (schedule && envValue("VIBER_SCHEDULED_CAMPAIGNS_ENABLED") !== "true") return { ok: false as const, error: "Zakazivanje još nije omogućeno. Sačuvajte nacrt i pošaljite ga ručno." };
    const scheduledAt = schedule ? parseBelgradePricingDateTime(scheduledRaw) : null;
    if (schedule && (!scheduledAt || !Number.isFinite(scheduledAt.getTime()) || scheduledAt <= new Date())) return { ok: false as const, error: "Izaberite budući datum i vreme slanja." };
    const parsed = campaignDraftSchema.safeParse({ audienceId: String(f.get("audienceId") || "new"), title: String(f.get("title") || "").trim(), body: String(f.get("body") || "").trim(), imageUrl: String(f.get("imageUrl") || "") || null, ctaLabel: String(f.get("ctaLabel") || "") || null, ctaUrl: String(f.get("ctaUrl") || "") || null, scheduledAt: scheduledAt?.toISOString() ?? null });
    if (!parsed.success) return { ok: false as const, error: "Proverite naziv, tekst, sliku i dugme (do 30 znakova)." };
    const m = parsed.data;
    const channel = channelFromForm(f);
    if (channel === "SMS" && (m.imageUrl || m.ctaLabel || m.ctaUrl)) return { ok: false as const, error: "SMS podržava samo tekst; link unesite direktno u poruku." };
    if (channel === "VIBER" && m.body.length > 1000) return { ok: false as const, error: "NTH Viber dozvoljava do 1000 znakova." };
    if (Boolean(m.ctaLabel) !== Boolean(m.ctaUrl) || (m.imageUrl && !m.ctaUrl)) return { ok: false as const, error: "Dodajte i tekst i link dugmeta. Poruka sa slikom zahteva dugme." };
    if ([m.imageUrl, m.ctaUrl].some((url) => url && !/^https?:\/\//.test(url))) return { ok: false as const, error: "Link mora da počinje sa https:// ili http://." };
    const filter = await resolveFilter(f);
    if (id) {
      const existing = await db.viberCampaign.findUniqueOrThrow({ where: { id }, include: { audience: true } });
      if ((parseAudienceFilter(existing.audience.filter).channel ?? "VIBER") !== channel) throw new Error("Nacrt pripada drugom kanalu.");
    }
    const saved = await db.$transaction(async (tx) => {
      let audienceId = String(f.get("audienceId") || "");
      if (!audienceId) {
        const audience = await tx.viberAudienceQuery.create({ data: { name: String(f.get("audienceName") || `Publika · ${m.title}`).slice(0,120), filter: (filter.allStoredPhones && filter.phoneScope !== "current" ? { ...filter, consentEvidence: STORED_PHONES_CONSENT } : filter) as Prisma.InputJsonValue } });
        audienceId = audience.id;
      }
      const data = { audienceId, title: m.title, body: m.body, imageUrl: m.imageUrl, ctaLabel: m.ctaLabel, ctaUrl: m.ctaUrl, status: schedule ? "SCHEDULED" as const : "DRAFT" as const, scheduledAt };
      if (id) {
        const result = await tx.viberCampaign.updateMany({ where: { id, status: { in: ["DRAFT", "SCHEDULED"] } }, data });
        if (!result.count) throw new Error("Pokrenuta kampanja se ne menja. Napravite kopiju.");
        return { id, audienceId };
      }
      return tx.viberCampaign.create({ data, select: { id: true, audienceId: true } });
    });
    revalidatePath("/admin/viber");
    return { ok: true as const, entityId: saved.id, message: schedule ? "Kampanja je zakazana." : "Nacrt je sačuvan. Još ništa nije poslato.", result: { ...saved, consentEvidence: filter.allStoredPhones && filter.phoneScope !== "current" ? STORED_PHONES_CONSENT : undefined } };
  })(form);
}
export async function launchViberCampaign(state: AdminActionState, form: FormData) {
  return withAdminState({ allowed: ["ADS"], action: "viber.campaignSend", entity: "ViberCampaign" }, async (_actor, f: FormData) => {
    const id = String(f.get("id") || "");
    if (!ready(f)) return { ok: false as const, error: "Slanje trenutno nije omogućeno." };
    const preview = await db.viberCampaign.findUniqueOrThrow({ where: { id }, include: { audience: true } });
    if ((parseAudienceFilter(preview.audience.filter).channel ?? "VIBER") !== channelFromForm(f)) throw new Error("Kampanja pripada drugom kanalu.");
    if (!await countAudience(parseAudienceFilter(preview.audience.filter))) return { ok: false as const, error: "Publika nema primaoce sa Viber saglasnošću. Izmenite izbor publike." };
    const result = await sendCampaign(id);
    revalidatePath("/admin/viber");
    return { ok: true as const, entityId: id, message: `Predato u red za slanje: ${result.delivered}. Greške: ${result.failed}. Isporuku pratite u rezultatima.`, tone: result.failed ? "warning" as const : "success" as const };
  })(form);
}
export async function testViberMessage(state: AdminActionState, form: FormData) {
  return withAdminState({ allowed: ["ADS"], action: "viber.campaignTest", entity: "ViberCampaign" }, async (_actor, f: FormData) => {
    const id = String(f.get("id") || "");
    const c = await db.viberCampaign.findUniqueOrThrow({ where: { id }, include: { audience: true } });
    if ((parseAudienceFilter(c.audience.filter).channel ?? "VIBER") !== channelFromForm(f)) throw new Error("Nacrt pripada drugom kanalu.");
    const result = await dispatch({ channel: channelFromForm(f), to: String(f.get("phone") || ""), text: c.body.replace(/\{ime\}/g, "Test korisnik"), imageUrl: c.imageUrl, cta: c.ctaLabel && c.ctaUrl ? { label: c.ctaLabel, url: c.ctaUrl } : null, requestId: `test:${randomUUID()}` });
    if (!result.ok) return { ok: false as const, error: "Test nije predat za slanje. Proverite broj (+381…) i da li je slanje omogućeno." };
    return { ok: true as const, entityId: id, message: "Test poruka je predata za slanje samo na uneti broj. Status proverite u rezultatima." };
  })(form);
}
export async function deleteViberDraft(state: AdminActionState, form: FormData) {
  return withAdminState({ allowed: ["ADS"], action: "viber.campaignDelete", entity: "ViberCampaign" }, async (_actor, f: FormData) => {
    const id = String(f.get("id") || "");
    const existing = await db.viberCampaign.findUniqueOrThrow({ where: { id }, include: { audience: true } });
    if ((parseAudienceFilter(existing.audience.filter).channel ?? "VIBER") !== channelFromForm(f)) throw new Error("Nacrt pripada drugom kanalu.");
    const result = await db.viberCampaign.deleteMany({ where: { id, status: "DRAFT" } });
    if (!result.count) return { ok: false as const, error: "Možete obrisati samo nacrt. Istorija pokrenutih kampanja ostaje sačuvana." };
    revalidatePath("/admin/viber");return { ok: true as const, entityId: id, message: "Nacrt je obrisan." };
  })(form);
}

export async function suggestMessageEdit(form: FormData) {
  await requireAdminAction(["ADS"]);
  try { return { ok: true, text: await editMessageWithAi({ channel: channelFromForm(form), body: String(form.get("body") ?? ""), instruction: String(form.get("instruction") ?? "") }) }; }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : "AI predlog nije uspeo. Originalna poruka je sačuvana." }; }
}
