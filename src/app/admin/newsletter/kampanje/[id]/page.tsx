import { notFound } from "next/navigation";
import type { NewsletterCampaignStatus, NewsletterRecipientStatus } from "@prisma/client";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { getEmailConfig } from "@/lib/email/config";
import { AdminActionForm } from "@/components/admin/action-form";
import { Card, CardTitle, StatCard } from "@/components/admin/card";
import { DataTable } from "@/components/admin/data-table";
import { Field } from "@/components/admin/field";
import { NewsletterBlockEditor } from "@/components/admin/newsletter-block-editor";
import { NewsletterEmailPreview } from "@/components/admin/newsletter-email-preview";
import { NewsletterScheduleField } from "@/components/admin/newsletter-schedule-field";
import { PageHeader } from "@/components/admin/page-header";
import { SubmitButton } from "@/components/admin/submit-button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  approveNewsletterCampaignAction,
  cancelNewsletterCampaignAction,
  deleteNewsletterCampaignDraftAction,
  duplicateNewsletterCampaignAction,
  retryNewsletterCampaignAction,
  saveNewsletterCampaignAction,
  saveNewsletterTemplateAction,
  scheduleNewsletterCampaignAction,
  sendNewsletterCampaignNowAction,
  sendNewsletterTestAction,
  submitNewsletterReviewAction,
} from "../../actions";

export const dynamic = "force-dynamic";

const campaignLabel: Record<NewsletterCampaignStatus, string> = {
  DRAFT: "Nacrt",
  IN_REVIEW: "Na proveri",
  APPROVED: "Odobrena",
  SCHEDULED: "Zakazana",
  PREPARING: "Priprema primalaca",
  SENDING: "Provider šalje",
  SENT: "Poslata",
  CANCELLED: "Otkazana",
  PARTIAL_FAILED: "Delimična greška",
  FAILED: "Greška slanja",
};

const recipientLabel: Record<NewsletterRecipientStatus, string> = {
  QUEUED: "Čeka",
  SENT: "Poslata",
  DELIVERED: "Isporučena",
  OPENED: "Otvorena",
  CLICKED: "Klik",
  BOUNCED: "Bounce",
  COMPLAINED: "Prijavljena",
  FAILED: "Greška",
  UNSUBSCRIBED: "Odjavljen pre slanja",
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await db.newsletterCampaign.findUnique({ where: { id }, select: { title: true } });
  return { title: campaign ? `${campaign.title} — Newsletter` : "Newsletter kampanja", robots: { index: false, follow: false } };
}

export default async function NewsletterCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requireAdminAction(["ADS"]);
  const { id } = await params;
  const [campaign, audiences, products, recipients] = await Promise.all([
    db.newsletterCampaign.findUnique({
      where: { id },
      include: {
        audience: true,
        versions: { orderBy: { version: "desc" }, take: 20 },
      },
    }),
    db.newsletterAudience.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, estimatedCount: true } }),
    db.product.findMany({
      where: { isActive: true, deletedAt: null, availableWebManual: true },
      orderBy: { updatedAt: "desc" },
      take: 1_000,
      select: { sku: true, name: true, shortName: true },
    }),
    db.newsletterCampaignRecipient.findMany({ where: { campaignId: id }, orderBy: { updatedAt: "desc" }, take: 200 }),
  ]);
  if (!campaign) notFound();
  const actorIds = Array.from(new Set([campaign.createdById, campaign.updatedById, campaign.approvedById, ...campaign.versions.map((version) => version.createdById)].filter((value): value is string => Boolean(value))));
  const actors = actorIds.length ? await db.adminUser.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true, firstName: true, lastName: true } }) : [];
  const actorName = new Map(actors.map((actor) => [actor.id, [actor.firstName, actor.lastName].filter(Boolean).join(" ") || actor.email]));
  const editable = campaign.status === "DRAFT" || campaign.status === "IN_REVIEW";
  const cfg = getEmailConfig();

  return (
    <>
      <PageHeader
        title={campaign.title}
        description={`${campaignLabel[campaign.status]} · verzija ${campaign.versions[0]?.version ?? 1}${campaign.audience ? ` · ${campaign.audience.name}` : " · publika nije izabrana"}`}
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/newsletter", label: "Newsletter" },
          { label: campaign.title },
        ]}
        actions={
          <AdminActionForm action={duplicateNewsletterCampaignAction}>
            <input type="hidden" name="id" value={campaign.id} />
            <SubmitButton variant="outline" pendingLabel="Kopiram…">Napravi kopiju</SubmitButton>
          </AdminActionForm>
        }
      />
      <main className="space-y-6 px-4 py-6 md:px-8">
        {campaign.failureReason ? (
          <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <strong>Slanje nije završeno:</strong> {campaign.failureReason}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Primaoci" value={(campaign.recipients ?? recipients.length).toLocaleString("sr-Latn-RS")} hint={campaign.audienceMode === "FIXED" ? "fiksirana lista" : "računaju se pri slanju"} />
          <StatCard label="Isporučeno" value={(campaign.delivered ?? 0).toLocaleString("sr-Latn-RS")} tone="success" />
          <StatCard label="Otvoreno" value={(campaign.opened ?? 0).toLocaleString("sr-Latn-RS")} hint={rate(campaign.opened ?? 0, campaign.delivered ?? 0)} />
          <StatCard label="Kliknuto" value={(campaign.clicked ?? 0).toLocaleString("sr-Latn-RS")} hint={rate(campaign.clicked ?? 0, campaign.delivered ?? 0)} />
        </div>

        <WorkflowCard campaign={campaign} currentAdminId={admin.id} />

        {editable ? (
          <Card>
            <CardTitle description="Čuvanje uvek pravi novu verziju. Izmena kampanje koja je na proveri vraća je u nacrt.">Sadržaj i podešavanja</CardTitle>
            <AdminActionForm
              action={saveNewsletterCampaignAction}
              className="space-y-6"
              id="newsletter-campaign-editor"
              testId="newsletter-campaign-editor"
            >
              <input type="hidden" name="id" value={campaign.id} />
              <div className="grid gap-4 lg:grid-cols-2">
                <Field label="Interni naziv"><Input name="title" required maxLength={160} defaultValue={campaign.title} /></Field>
                <Field label="Naslov mejla"><Input name="subject" required maxLength={200} defaultValue={campaign.subject} /></Field>
                <Field label="Preview tekst"><Input name="previewText" maxLength={240} defaultValue={campaign.previewText ?? ""} /></Field>
                <Field label="Publika">
                  <select key={`audience:${campaign.updatedAt.getTime()}`} name="audienceId" required defaultValue={campaign.audienceId ?? ""} className="h-8 rounded-lg border border-input bg-surface px-2 text-sm">
                    <option value="">Izaberite publiku</option>
                    {audiences.map((audience) => <option key={audience.id} value={audience.id}>{audience.name}{typeof audience.estimatedCount === "number" ? ` (${audience.estimatedCount})` : ""}</option>)}
                  </select>
                </Field>
                <Field label="Način publike" hint="Dinamička se preračunava neposredno pre slanja; fiksna se zamrzava pri zakazivanju.">
                  <select key={`audience-mode:${campaign.updatedAt.getTime()}`} name="audienceMode" defaultValue={campaign.audienceMode} className="h-8 rounded-lg border border-input bg-surface px-2 text-sm">
                    <option value="DYNAMIC">Dinamička</option>
                    <option value="FIXED">Fiksna lista</option>
                  </select>
                </Field>
                <Field label="Tema saglasnosti"><Input name="topicKey" defaultValue={campaign.topicKey} readOnly /></Field>
              </div>
              <details className="rounded-xl border border-border/70 p-4">
                <summary className="cursor-pointer text-sm font-medium">Pošiljalac i reply-to (opciono)</summary>
                <div className="mt-4 grid gap-4 lg:grid-cols-3">
                  <Field label="Ime pošiljaoca"><Input name="fromName" maxLength={120} defaultValue={campaign.fromName ?? ""} placeholder="Podrazumevano iz okruženja" /></Field>
                  <Field label="Email pošiljaoca"><Input name="fromEmail" type="email" defaultValue={campaign.fromEmail ?? ""} placeholder={cfg.marketingFrom} /></Field>
                  <Field label="Reply-to"><Input name="replyTo" type="email" defaultValue={campaign.replyTo ?? ""} placeholder={cfg.replyTo ?? ""} /></Field>
                </div>
              </details>
              <NewsletterBlockEditor
                initialContent={campaign.content}
                products={products.map((product) => ({ sku: product.sku, name: product.shortName ?? product.name }))}
              />
              <div className="flex flex-wrap items-center gap-3">
                <SubmitButton pendingLabel="Čuvam i proveravam…">Sačuvaj novu verziju</SubmitButton>
                <span className="text-xs text-ink-500">Posle čuvanja, donji tačan HTML pregled će biti osvežen.</span>
              </div>
            </AdminActionForm>
          </Card>
        ) : (
          <Card>
            <CardTitle>Sadržaj je zaključan</CardTitle>
            <p className="text-sm text-ink-700">Odobrena, zakazana ili poslata kampanja se ne menja u mestu. Napravite kopiju za izmene i novi ciklus odobravanja.</p>
          </Card>
        )}

        <Card>
          <CardTitle description="Ovo je sačuvani, server-renderovani HTML koji će dobiti provider.">Tačan pregled mejla</CardTitle>
          <NewsletterEmailPreview html={campaign.html ?? ""} />
        </Card>

        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardTitle description="Test koristi trenutno sačuvanu verziju i nikad ne menja status kampanje.">Test mejl</CardTitle>
            <AdminActionForm action={sendNewsletterTestAction} className="flex flex-wrap items-end gap-3" id="newsletter-campaign-test-send" testId="newsletter-campaign-test-send">
              <input type="hidden" name="id" value={campaign.id} />
              <Field label="Adresa za test" className="min-w-64 flex-1"><Input name="email" type="email" required defaultValue={admin.email ?? ""} /></Field>
              <SubmitButton variant="outline" pendingLabel="Šaljem…">Pošalji test</SubmitButton>
            </AdminActionForm>
            {cfg.provider === "none" ? <p className="mt-3 text-xs text-warning">Provider je „none“: test će biti evidentiran kao simulirano slanje.</p> : null}
          </Card>
          <Card>
            <CardTitle>Sačuvaj kao šablon</CardTitle>
            <AdminActionForm action={saveNewsletterTemplateAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="id" value={campaign.id} />
              <Field label="Naziv šablona" className="min-w-64 flex-1"><Input name="name" required maxLength={160} /></Field>
              <SubmitButton variant="outline">Sačuvaj šablon</SubmitButton>
            </AdminActionForm>
          </Card>
        </div>

        <Card>
          <CardTitle description="Svako čuvanje pravi neizmenjivu kopiju sadržaja i beleži administratora.">Verzije</CardTitle>
          <DataTable
            columns={[
              { key: "version", label: "Verzija" },
              { key: "subject", label: "Naslov" },
              { key: "actor", label: "Autor" },
              { key: "date", label: "Vreme" },
            ]}
            rows={campaign.versions.map((version) => ({ id: version.id, cells: { version: `v${version.version}`, subject: version.subject, actor: version.createdById ? actorName.get(version.createdById) ?? version.createdById : "sistem", date: formatDate(version.createdAt) } }))}
            empty="Nema verzija."
          />
        </Card>

        {recipients.length ? (
          <Card>
            <CardTitle description="Prikazano je najnovijih 200 zapisa; isporuke, otvaranja i klikovi dolaze iz potpisanih webhook događaja.">Primaoci i događaji</CardTitle>
            <DataTable
              columns={[
                { key: "email", label: "Email" },
                { key: "status", label: "Status" },
                { key: "sent", label: "Poslato" },
                { key: "engagement", label: "Interakcija" },
              ]}
              rows={recipients.map((recipient) => ({
                id: recipient.id,
                cells: {
                  email: <span className="font-mono text-xs">{recipient.email}</span>,
                  status: <StatusPill status={recipient.status} label={recipientLabel[recipient.status]} />,
                  sent: recipient.sentAt ? formatDate(recipient.sentAt) : "—",
                  engagement: recipient.clickedAt ? `Klik ${formatDate(recipient.clickedAt)}` : recipient.openedAt ? `Otvoreno ${formatDate(recipient.openedAt)}` : recipient.failureReason ?? "—",
                },
              }))}
            />
          </Card>
        ) : null}
      </main>
    </>
  );
}

function WorkflowCard({
  campaign,
  currentAdminId,
}: {
  campaign: {
    id: string;
    status: NewsletterCampaignStatus;
    recipients: number | null;
    createdById: string | null;
    approvedById: string | null;
    approvedAt: Date | null;
    scheduledAt: Date | null;
    sentAt: Date | null;
    audienceBreakdown: unknown;
  };
  currentAdminId: string;
}) {
  const threshold = Number.parseInt(process.env.NEWSLETTER_TWO_PERSON_APPROVAL_THRESHOLD ?? "1000", 10) || 1_000;
  const needsSecondAdmin = (campaign.recipients ?? 0) >= threshold && campaign.createdById === currentAdminId;
  return (
    <Card>
      <CardTitle description="Tok je: nacrt → provera → odobrenje → zakazivanje/slanje. Podobnost kontakata se proverava ponovo neposredno pre slanja.">Kontrola slanja</CardTitle>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        {(["DRAFT", "IN_REVIEW", "APPROVED", "SCHEDULED", "SENT"] as NewsletterCampaignStatus[]).map((step, index) => (
          <span key={step} className={cn("rounded-full px-3 py-1", workflowReached(campaign.status, step) ? "bg-walnut text-white" : "bg-muted-bg text-ink-500")}>{index + 1}. {campaignLabel[step]}</span>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {campaign.status === "DRAFT" ? (
          <AdminActionForm action={submitNewsletterReviewAction}>
            <input type="hidden" name="id" value={campaign.id} />
            <SubmitButton pendingLabel="Proveravam publiku i sadržaj…">Pošalji na proveru</SubmitButton>
          </AdminActionForm>
        ) : null}
        {campaign.status === "IN_REVIEW" ? (
          <div>
            <AdminActionForm action={approveNewsletterCampaignAction}>
              <input type="hidden" name="id" value={campaign.id} />
              <SubmitButton disabled={needsSecondAdmin}>Odobri kampanju</SubmitButton>
            </AdminActionForm>
            {needsSecondAdmin ? <p className="mt-1 text-xs text-warning">Za {campaign.recipients} primalaca odobrenje mora dati drugi administrator.</p> : null}
          </div>
        ) : null}
        {campaign.status === "APPROVED" ? (
          <>
            <AdminActionForm action={scheduleNewsletterCampaignAction} className="min-w-80">
              <input type="hidden" name="id" value={campaign.id} />
              <NewsletterScheduleField defaultIso={campaign.scheduledAt?.toISOString()} />
              <SubmitButton className="mt-2" pendingLabel="Zakazujem…">Zakaži</SubmitButton>
            </AdminActionForm>
            <AdminActionForm action={sendNewsletterCampaignNowAction}>
              <input type="hidden" name="id" value={campaign.id} />
              <SubmitButton variant="outline" confirm={`Staviti kampanju za ${campaign.recipients ?? 0} primalaca u red za slanje odmah?`}>Pošalji odmah</SubmitButton>
            </AdminActionForm>
          </>
        ) : null}
        {campaign.status === "APPROVED" || campaign.status === "SCHEDULED" ? (
          <AdminActionForm action={cancelNewsletterCampaignAction}>
            <input type="hidden" name="id" value={campaign.id} />
            <SubmitButton variant="destructive" confirm="Otkazati ovu kampanju? Ako je provider već napravio zakazani broadcast, biće otkazan i tamo.">Otkaži</SubmitButton>
          </AdminActionForm>
        ) : null}
        {campaign.status === "FAILED" || campaign.status === "PARTIAL_FAILED" ? (
          <AdminActionForm action={retryNewsletterCampaignAction}>
            <input type="hidden" name="id" value={campaign.id} />
            <SubmitButton
              variant="outline"
              pendingLabel="Vraćam u red…"
              confirm="Ponovo pokušati slanje iste kampanje? Idempotency zaštita sprečava duplikat ako je provider već prihvatio prethodni pokušaj."
            >
              Ponovi slanje
            </SubmitButton>
          </AdminActionForm>
        ) : null}
        {campaign.status === "DRAFT" ? (
          <AdminActionForm action={deleteNewsletterCampaignDraftAction}>
            <input type="hidden" name="id" value={campaign.id} />
            <SubmitButton variant="destructive" confirm="Trajno obrisati ovaj nacrt i sve njegove verzije?">Obriši nacrt</SubmitButton>
          </AdminActionForm>
        ) : null}
      </div>
      {campaign.scheduledAt ? <p className="mt-4 text-sm text-ink-700">Zakazano: <strong>{formatDate(campaign.scheduledAt)}</strong></p> : null}
      {campaign.sentAt ? <p className="mt-2 text-sm text-ink-700">Prihvaćeno za slanje: <strong>{formatDate(campaign.sentAt)}</strong></p> : null}
      {campaign.audienceBreakdown ? <pre className="mt-4 overflow-auto rounded-lg bg-muted-bg p-3 text-xs text-ink-700">{JSON.stringify(campaign.audienceBreakdown, null, 2)}</pre> : null}
    </Card>
  );
}

function StatusPill({ status, label }: { status: string; label: string }) {
  const good = status === "SENT" || status === "DELIVERED" || status === "OPENED" || status === "CLICKED";
  const bad = status === "FAILED" || status === "BOUNCED" || status === "COMPLAINED";
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", good ? "bg-success/15 text-success" : bad ? "bg-destructive/15 text-destructive" : "bg-muted-bg text-ink-700")}>{label}</span>;
}

function workflowReached(current: NewsletterCampaignStatus, step: NewsletterCampaignStatus) {
  const rank: Partial<Record<NewsletterCampaignStatus, number>> = { DRAFT: 0, IN_REVIEW: 1, APPROVED: 2, SCHEDULED: 3, PREPARING: 3, SENDING: 4, SENT: 4 };
  return (rank[current] ?? -1) >= (rank[step] ?? 99);
}

function formatDate(date: Date) {
  return date.toLocaleString("sr-Latn-RS", { timeZone: "Europe/Belgrade", dateStyle: "short", timeStyle: "short" });
}

function rate(value: number, base: number) {
  return base > 0 ? `${((value / base) * 100).toFixed(1)}% od isporučenih` : "bez podataka";
}
