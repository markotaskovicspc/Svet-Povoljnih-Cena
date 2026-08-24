"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withAdminState, type AdminActionState } from "@/lib/admin";
import { db } from "@/lib/db";
import {
  audienceFilterJson,
  newsletterAudienceFilterSchema,
  previewNewsletterAudience,
  selectedNewsletterAudiences,
} from "@/lib/newsletter/audience";
import {
  approveNewsletterCampaign,
  cancelNewsletterCampaign,
  createNewsletterCampaign,
  duplicateNewsletterCampaign,
  retryNewsletterCampaign,
  saveCampaignAsTemplate,
  saveCampaignSchema,
  saveNewsletterCampaign,
  scheduleNewsletterCampaign,
  sendNewsletterCampaignTest,
  submitNewsletterCampaignForReview,
} from "@/lib/newsletter/campaigns";
import { withdrawMarketingEmail } from "@/lib/newsletter/contacts";
import {
  importNewsletterContacts,
  previewNewsletterContactImport,
} from "@/lib/newsletter/contact-import";

const allowed = ["ADS"] as const;

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function parseJson(raw: string, label: string) {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${label} nije ispravan.`);
  }
}

function serbianCount(
  count: number,
  singular: string,
  paucal: string,
  plural: string,
) {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  if (mod10 === 1 && mod100 !== 11) return `${count} ${singular}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} ${paucal}`;
  }
  return `${count} ${plural}`;
}

function refreshCampaign(id?: string) {
  revalidatePath("/admin/newsletter");
  if (id) revalidatePath(`/admin/newsletter/kampanje/${id}`);
}

export async function createNewsletterCampaignAction(
  _state: AdminActionState,
  formData: FormData,
) {
  const state = await withAdminState(
    { allowed, action: "newsletter.campaign.create", entity: "NewsletterCampaign" },
    async (actorId, formData: FormData) => {
      const templateId = value(formData, "templateId") || null;
      const campaign = await createNewsletterCampaign(actorId, templateId);
      return {
        ok: true as const,
        entityId: campaign.id,
        message: "Kampanja je kreirana.",
        result: { id: campaign.id },
        diff: { templateId },
      };
    },
  )(formData);
  if (state.ok && state.result?.id) redirect(`/admin/newsletter/kampanje/${state.result.id}`);
  return state;
}

export async function saveNewsletterCampaignAction(
  _state: AdminActionState,
  formData: FormData,
) {
  const state = await withAdminState(
    { allowed, action: "newsletter.campaign.save", entity: "NewsletterCampaign" },
    async (actorId, formData: FormData) => {
      const audienceIds = formData.getAll("audienceIds")
        .map((item) => String(item).trim())
        .filter(Boolean);
      const legacyAudienceId = value(formData, "audienceId");
      const parsed = saveCampaignSchema.safeParse({
        id: value(formData, "id"),
        title: value(formData, "title"),
        subject: value(formData, "subject"),
        previewText: value(formData, "previewText"),
        fromName: value(formData, "fromName"),
        fromEmail: value(formData, "fromEmail"),
        replyTo: value(formData, "replyTo"),
        audienceIds: audienceIds.length
          ? audienceIds
          : legacyAudienceId
            ? [legacyAudienceId]
            : [],
        audienceMode: value(formData, "audienceMode") || "DYNAMIC",
        includeContactsWithoutConsent:
          formData.get("includeContactsWithoutConsent") === "on",
        topicKey: value(formData, "topicKey") || "promotions",
        content: parseJson(value(formData, "content"), "Sadržaj kampanje"),
      });
      if (!parsed.success) {
        return {
          ok: false as const,
          error: parsed.error.issues[0]?.message ?? "Kampanja nije ispravna.",
        };
      }
      const result = await saveNewsletterCampaign(parsed.data, actorId);
      refreshCampaign(parsed.data.id);
      return {
        ok: true as const,
        entityId: parsed.data.id,
        message: result.warnings.length
          ? `Nacrt je sačuvan. Upozorenje: ${result.warnings.join(" ")}`
          : "Nacrt i nova verzija su sačuvani.",
        result,
        diff: {
          title: parsed.data.title,
          audienceIds: parsed.data.audienceIds,
          audienceMode: parsed.data.audienceMode,
          includeContactsWithoutConsent: parsed.data.includeContactsWithoutConsent,
          blockCount: parsed.data.content.length,
        },
      };
    },
  )(formData);
  return state;
}

export async function submitNewsletterReviewAction(
  _state: AdminActionState,
  formData: FormData,
) {
  return campaignAction(
    formData,
    "newsletter.campaign.submitReview",
    async (id, actorId) => {
      const result = await submitNewsletterCampaignForReview(id, actorId);
      return {
        message: `Kampanja je na proveri. Podobno: ${serbianCount(result.recipientCount, "primalac", "primaoca", "primalaca")}.`,
        diff: { recipients: result.recipientCount, warnings: result.warnings },
      };
    },
  );
}

export async function approveNewsletterCampaignAction(
  _state: AdminActionState,
  formData: FormData,
) {
  return campaignAction(formData, "newsletter.campaign.approve", async (id, actorId) => {
    await approveNewsletterCampaign(id, actorId);
    return { message: "Kampanja je odobrena i spremna za zakazivanje." };
  });
}

export async function scheduleNewsletterCampaignAction(
  _state: AdminActionState,
  formData: FormData,
) {
  return campaignAction(formData, "newsletter.campaign.schedule", async (id, actorId) => {
    const scheduledAt = new Date(value(formData, "scheduledAtIso"));
    if (Number.isNaN(scheduledAt.getTime())) throw new Error("Izaberite ispravan datum i vreme slanja.");
    await scheduleNewsletterCampaign(id, scheduledAt, actorId);
    return { message: `Kampanja je zakazana za ${scheduledAt.toLocaleString("sr-Latn-RS", { timeZone: "Europe/Belgrade" })}.`, diff: { scheduledAt } };
  });
}

export async function sendNewsletterCampaignNowAction(
  _state: AdminActionState,
  formData: FormData,
) {
  return campaignAction(formData, "newsletter.campaign.sendNow", async (id, actorId) => {
    await scheduleNewsletterCampaign(id, new Date(), actorId);
    return { message: "Kampanja je stavljena u red za slanje odmah." };
  });
}

export async function cancelNewsletterCampaignAction(
  _state: AdminActionState,
  formData: FormData,
) {
  return campaignAction(formData, "newsletter.campaign.cancel", async (id, actorId) => {
    await cancelNewsletterCampaign(id, actorId);
    return { message: "Kampanja je otkazana." };
  });
}

export async function retryNewsletterCampaignAction(
  _state: AdminActionState,
  formData: FormData,
) {
  return campaignAction(formData, "newsletter.campaign.retry", async (id, actorId) => {
    await retryNewsletterCampaign(id, actorId);
    return { message: "Kampanja je ponovo stavljena u red za slanje." };
  });
}

export async function duplicateNewsletterCampaignAction(
  _state: AdminActionState,
  formData: FormData,
) {
  const state = await withAdminState(
    { allowed, action: "newsletter.campaign.duplicate", entity: "NewsletterCampaign" },
    async (actorId, formData: FormData) => {
      const sourceId = value(formData, "id");
      const campaign = await duplicateNewsletterCampaign(sourceId, actorId);
      return {
        ok: true as const,
        entityId: campaign.id,
        message: "Kopija kampanje je kreirana.",
        result: { id: campaign.id },
        diff: { sourceId },
      };
    },
  )(formData);
  if (state.ok && state.result?.id) redirect(`/admin/newsletter/kampanje/${state.result.id}`);
  return state;
}

export async function sendNewsletterTestAction(
  _state: AdminActionState,
  formData: FormData,
) {
  return campaignAction(formData, "newsletter.campaign.test", async (id) => {
    const email = value(formData, "email");
    await sendNewsletterCampaignTest(id, email);
    return { message: `Test poruka je poslata na ${email}.`, diff: { email } };
  });
}

export async function saveNewsletterTemplateAction(
  _state: AdminActionState,
  formData: FormData,
) {
  return campaignAction(formData, "newsletter.template.create", async (id, actorId) => {
    const template = await saveCampaignAsTemplate(id, value(formData, "name"), actorId);
    revalidatePath("/admin/newsletter");
    return { message: "Šablon je sačuvan.", diff: { templateId: template.id, name: template.name } };
  }, "NewsletterTemplate");
}

export async function deleteNewsletterCampaignDraftAction(
  _state: AdminActionState,
  formData: FormData,
) {
  const state = await withAdminState(
    { allowed, action: "newsletter.campaign.deleteDraft", entity: "NewsletterCampaign" },
    async (_actorId, formData: FormData) => {
      const id = value(formData, "id");
      const campaign = await db.newsletterCampaign.findUnique({ where: { id }, select: { status: true } });
      if (!campaign) return { ok: false as const, error: "Kampanja nije pronađena." };
      if (campaign.status !== "DRAFT") return { ok: false as const, error: "Može se obrisati samo nacrt." };
      await db.newsletterCampaign.delete({ where: { id } });
      return { ok: true as const, entityId: id, message: "Nacrt je obrisan." };
    },
  )(formData);
  if (state.ok) redirect("/admin/newsletter");
  return state;
}

export async function saveNewsletterAudienceAction(
  _state: AdminActionState,
  formData: FormData,
) {
  return withAdminState(
    { allowed, action: "newsletter.audience.save", entity: "NewsletterAudience" },
    async (actorId, formData: FormData) => {
      const id = value(formData, "id");
      const name = z.string().trim().min(1).max(160).parse(value(formData, "name"));
      const description = z.string().trim().max(500).parse(value(formData, "description"));
      const filter = newsletterAudienceFilterSchema.parse(parseJson(value(formData, "filter"), "Filter publike"));
      const preview = await previewNewsletterAudience(filter);
      const data = {
        name,
        description: description || null,
        filter: audienceFilterJson(filter),
        estimatedCount: preview.count,
        estimatedAt: new Date(),
        updatedById: actorId,
      };
      const audience = id
        ? await db.newsletterAudience.update({ where: { id }, data })
        : await db.newsletterAudience.create({ data: { ...data, createdById: actorId } });
      revalidatePath("/admin/newsletter");
      return {
        ok: true as const,
        entityId: audience.id,
        message: `Publika je sačuvana. Trenutno odgovara ${serbianCount(preview.count, "kontakt", "kontakta", "kontakata")}.`,
        result: preview,
        diff: { name, estimatedCount: preview.count, filter },
      };
    },
  )(formData);
}

export async function deleteNewsletterAudienceAction(
  _state: AdminActionState,
  formData: FormData,
) {
  return withAdminState(
    { allowed, action: "newsletter.audience.delete", entity: "NewsletterAudience" },
    async (_actorId, formData: FormData) => {
      const id = value(formData, "id");
      const campaigns = await db.newsletterCampaign.findMany({
        select: { audienceId: true, audienceFilterSnapshot: true },
      });
      const used = campaigns.filter((campaign) =>
        campaign.audienceId === id ||
        selectedNewsletterAudiences(campaign.audienceFilterSnapshot)
          .some((audience) => audience.id === id),
      ).length;
      if (used) return { ok: false as const, error: `Publika se koristi u ${used} kampanja i ne može da se obriše.` };
      await db.newsletterAudience.delete({ where: { id } });
      revalidatePath("/admin/newsletter");
      return { ok: true as const, entityId: id, message: "Publika je obrisana." };
    },
  )(formData);
}

export async function deleteNewsletterTemplateAction(
  _state: AdminActionState,
  formData: FormData,
) {
  return withAdminState(
    { allowed, action: "newsletter.template.delete", entity: "NewsletterTemplate" },
    async (_actorId, formData: FormData) => {
      const id = value(formData, "id");
      await db.newsletterTemplate.delete({ where: { id } });
      revalidatePath("/admin/newsletter");
      return { ok: true as const, entityId: id, message: "Šablon je obrisan." };
    },
  )(formData);
}

export async function unsubscribeMarketingContactAction(
  _state: AdminActionState,
  formData: FormData,
) {
  return withAdminState(
    { allowed, action: "newsletter.contact.unsubscribe", entity: "MarketingContact" },
    async (_actorId, formData: FormData) => {
      const id = value(formData, "id");
      const contact = await db.marketingContact.findUnique({ where: { id } });
      if (!contact) return { ok: false as const, error: "Kontakt nije pronađen." };
      await withdrawMarketingEmail(contact.email, "admin");
      revalidatePath("/admin/newsletter");
      return { ok: true as const, entityId: id, message: `${contact.email} je odjavljen.`, diff: { email: contact.email } };
    },
  )(formData);
}

export async function previewNewsletterContactImportAction(
  _state: AdminActionState,
  formData: FormData,
) {
  return withAdminState(
    {
      allowed,
      action: "newsletter.contactImport.preview",
      entity: "MarketingContact",
    },
    async (_actorId, formData: FormData) => {
      const file = formData.get("contactsFile");
      if (!(file instanceof File) || file.size === 0) {
        return { ok: false as const, error: "Izaberite CSV ili XLSX fajl." };
      }
      const result = await previewNewsletterContactImport(file);
      return {
        ok: true as const,
        message: importSummary("Provera završena, ništa nije upisano.", result),
        result,
        diff: { fileName: file.name, ...result },
      };
    },
  )(formData);
}

export async function importNewsletterContactsAction(
  _state: AdminActionState,
  formData: FormData,
) {
  return withAdminState(
    {
      allowed,
      action: "newsletter.contactImport.commit",
      entity: "MarketingContact",
    },
    async (actorId, formData: FormData) => {
      const file = formData.get("contactsFile");
      const listName = value(formData, "listName");
      if (!(file instanceof File) || file.size === 0) {
        return { ok: false as const, error: "Izaberite CSV ili XLSX fajl." };
      }
      if (!listName) {
        return { ok: false as const, error: "Unesite naziv liste kontakata." };
      }
      const result = await importNewsletterContacts(file, actorId, listName);
      revalidatePath("/admin/newsletter");
      return {
        ok: true as const,
        message: `${importSummary("Uvoz je završen.", result)} Publika „${result.audience.name}” je spremna za izbor u nacrtu.`,
        result,
        diff: { fileName: file.name, listName, ...result },
      };
    },
  )(formData);
}

function importSummary(
  prefix: string,
  result: {
    uniqueValid: number;
    explicitConsent: number;
    withoutConsent: number;
    invalidRows: number;
    duplicateRows: number;
  },
) {
  return `${prefix} Ispravnih: ${result.uniqueValid}; redova sa izričitom saglasnošću: ${result.explicitConsent}; bez zabeležene saglasnosti (mogu se uključiti u nacrt uz upozorenje): ${result.withoutConsent}; neispravnih: ${result.invalidRows}; duplikata u fajlu: ${result.duplicateRows}.`;
}

async function campaignAction(
  formData: FormData,
  action: string,
  fn: (id: string, actorId: string) => Promise<{ message: string; diff?: unknown }>,
  entity = "NewsletterCampaign",
) {
  return withAdminState(
    { allowed, action, entity },
    async (actorId, formData: FormData) => {
      const id = value(formData, "id");
      if (!id) return { ok: false as const, error: "Kampanja nije izabrana." };
      const result = await fn(id, actorId);
      refreshCampaign(id);
      return { ok: true as const, entityId: id, message: result.message, diff: result.diff };
    },
  )(formData);
}
