import Link from "next/link";
import { notFound } from "next/navigation";
import type { NewsletterCampaignStatus, NewsletterRecipientStatus } from "@prisma/client";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { getEmailConfig } from "@/lib/email/config";
import { builtInNewsletterAudiences, selectedNewsletterAudiences } from "@/lib/newsletter/audience";
import { getNewsletterContactOverview } from "@/lib/newsletter/contact-overview";
import { NewsletterContactOverview } from "@/components/admin/newsletter-contact-overview";
import { isNewsletterTestAudience, newsletterAudienceLabel } from "@/lib/newsletter/audience-label";
import { newsletterDeliveryPolicy } from "@/lib/newsletter/delivery-policy";
import { newsletterRetrySummary } from "@/lib/newsletter/retry";
import { AdminActionForm } from "@/components/admin/action-form";
import { Card, CardTitle, StatCard } from "@/components/admin/card";
import { DataTable } from "@/components/admin/data-table";
import { Field } from "@/components/admin/field";
import { NewsletterBlockEditor } from "@/components/admin/newsletter-block-editor";
import { NewsletterEmailPreview } from "@/components/admin/newsletter-email-preview";
import { NewsletterTestSend } from "@/components/admin/newsletter-test-send";
import { NewsletterScheduleField } from "@/components/admin/newsletter-schedule-field";
import { PageHeader } from "@/components/admin/page-header";
import { SubmitButton } from "@/components/admin/submit-button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { newsletterCampaignLabels as campaignLabel, newsletterCount, newsletterRate, newsletterMetricExplanation } from "@/lib/newsletter/reporting";
import { NewsletterStatsRefresh } from "@/components/admin/newsletter-stats-refresh";
import { NewsletterBounces } from "@/components/admin/newsletter-bounces";
import {
  cancelNewsletterCampaignAction,
  deleteNewsletterCampaignDraftAction,
  duplicateNewsletterCampaignAction,
  retryNewsletterCampaignAction,
  saveNewsletterCampaignAction,
  saveNewsletterTemplateAction,
  scheduleNewsletterCampaignAction,
  sendNewsletterCampaignNowAction,
  sendNewsletterTestAction,
} from "../../actions";

export const dynamic = "force-dynamic";



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
  const [campaign, savedAudiences, products, recipients, contactOverview, retrySummary] = await Promise.all([
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
    getNewsletterContactOverview(),
    newsletterRetrySummary(id),
  ]);
  if (!campaign) notFound();
  const audiences = [...builtInNewsletterAudiences, ...savedAudiences.map((audience) => ({ ...audience, description: "" }))];
  const actorIds = Array.from(new Set([campaign.createdById, campaign.updatedById, campaign.approvedById, ...campaign.versions.map((version) => version.createdById)].filter((value): value is string => Boolean(value))));
  const actors = actorIds.length ? await db.adminUser.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true, firstName: true, lastName: true } }) : [];
  const actorName = new Map(actors.map((actor) => [actor.id, [actor.firstName, actor.lastName].filter(Boolean).join(" ") || actor.email]));
  const editable = campaign.status === "DRAFT" || campaign.status === "IN_REVIEW";
  const cfg = getEmailConfig();
  const snapshotAudiences = selectedNewsletterAudiences(campaign.audienceFilterSnapshot);
  const selectedAudiences = snapshotAudiences.length
    ? snapshotAudiences
    : campaign.audience
      ? [{ id: campaign.audience.id, name: campaign.audience.name }]
      : [];
  const selectedAudienceIds = new Set(selectedAudiences.map((audience) => audience.id));
  const selectedAudienceLabel = selectedAudiences.length
    ? selectedAudiences.map((audience) => newsletterAudienceLabel(audience.name)).join(", ")
    : "publika nije izabrana";

  return (
    <>
      <PageHeader
        title={campaign.title}
        description={`${campaignLabel[campaign.status]} · verzija ${campaign.versions[0]?.version ?? 1} · ${selectedAudienceLabel}${campaign.includeContactsWithoutConsent ? " · uključeni kontakti bez saglasnosti" : ""}`}
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/newsletter", label: "Newsletter" },
          { label: campaign.title },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <AdminActionForm action={duplicateNewsletterCampaignAction}>
              <input type="hidden" name="id" value={campaign.id} />
              <SubmitButton variant="outline" pendingLabel="Kopiram…">Napravi kopiju</SubmitButton>
            </AdminActionForm>
            <AdminActionForm action={duplicateNewsletterCampaignAction}>
              <input type="hidden" name="id" value={campaign.id} />
              <input type="hidden" name="allContacts" value="on" />
              <SubmitButton variant="outline" pendingLabel="Pripremam…" confirm="Napraviti nacrt iste poruke za sve kontakte, uključujući one bez saglasnosti? Odjavljene i blokirane adrese se izostavljaju. Slanje bez saglasnosti nosi rizik za SES nalog. Ovaj korak još ne šalje mejlove.">Kopiraj za sve kontakte</SubmitButton>
            </AdminActionForm>
          </div>
        }
      />
      <main className="space-y-6 px-4 py-6 md:px-8">
        <WorkflowCard campaign={campaign} retrySummary={retrySummary} />
        <NewsletterContactOverview counts={contactOverview} />
        {campaign.failureReason ? (
          <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <strong>Slanje nije završeno:</strong> {campaign.failureReason}
          </div>
        ) : null}
        {campaign.includeContactsWithoutConsent ? (
          <div role="alert" className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
            <strong>Upozorenje:</strong> ova kampanja uključuje i kontakte bez zabeležene saglasnosti. To ne menja njihove saglasnosti i nosi rizik ograničenja SES naloga.
            Izričito odjavljene, potisnute i provider opt-out adrese ostaju isključene.
          </div>
        ) : null}

        <section aria-label="Rezultati kampanje" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-lg text-ink-900">Rezultati kampanje</h2>
            <NewsletterStatsRefresh key={campaign.updatedAt.toISOString()} protectEditor observedAt={new Date().toLocaleTimeString("sr-Latn-RS", { timeZone: "Europe/Belgrade" })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Primaoci ove kampanje" value={newsletterCount(campaign.recipients)} hint={campaign.recipients == null ? "broj primalaca još nije izračunat" : campaign.audienceMode === "FIXED" ? "fiksirana lista primalaca" : "izračunato za ovu kampanju"} />
            <StatCard label="Isporučeno" value={newsletterCount(campaign.delivered)} hint="potvrđena isporuka; ne garantuje glavni inbox" tone="success" />
            <StatCard label="Open rate — otvaranja" value={newsletterRate(campaign.opened, campaign.delivered)} hint={`${newsletterCount(campaign.opened)} primalaca sa evidentiranim otvaranjem`} />
            <StatCard label="CTR — klikovi" value={newsletterRate(campaign.clicked, campaign.delivered)} hint={`${newsletterCount(campaign.clicked)} primalaca je kliknulo na link`} />
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-2 rounded-xl border border-border/60 bg-surface p-4 text-sm">
            <div><dt className="inline text-ink-500">SES prihvatio: </dt><dd className="inline font-medium">{newsletterCount(retrySummary.accepted)}</dd></div>
            <div><dt className="inline text-ink-500">Čeka slanje: </dt><dd className="inline font-medium">{newsletterCount(retrySummary.queued)}</dd></div>
            <div><dt className="inline text-ink-500">Odbijena isporuka (bounce): </dt><dd className="inline font-medium"><NewsletterBounces campaignId={campaign.id} count={campaign.bounced} /></dd></div>
            <div><dt className="inline text-ink-500">Prijave spama: </dt><dd className="inline font-medium">{newsletterCount(campaign.complained)}</dd></div>
            <div><dt className="inline text-ink-500">Odjave: </dt><dd className="inline font-medium">{newsletterCount(campaign.unsubscribed)}</dd></div>
          </dl>
          <p className="text-xs text-ink-500">{newsletterMetricExplanation} Evidentirano otvaranje nije pouzdan dokaz da je osoba pročitala poruku.</p>
        </section>

        <div id="test-email" className="scroll-mt-6">
          <Card>
            <CardTitle description="Prvo sačuvajte izmene. Test šalje poslednju sačuvanu verziju samo na unetu adresu, bez slanja grupama.">Pošalji test pre slanja grupama</CardTitle>
            <NewsletterTestSend key={campaign.updatedAt.toISOString()} campaignId={campaign.id} savedVersion={campaign.updatedAt.toISOString()} email={admin.email ?? ""} action={sendNewsletterTestAction} />
            {cfg.provider === "none" ? <p className="mt-3 text-xs text-warning">Provider je „none“: test će biti evidentiran kao simulirano slanje.</p> : null}
          </Card>
        </div>

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
              <input type="hidden" name="topicKey" value="promotions" />
              <div className="grid gap-4 lg:grid-cols-2">
                <Field label="Interni naziv"><Input name="title" required maxLength={160} defaultValue={campaign.title} /></Field>
                <Field label="Naslov mejla"><Input name="subject" required maxLength={200} defaultValue={campaign.subject} /></Field>
                <Field label="Preview tekst"><Input name="previewText" maxLength={240} defaultValue={campaign.previewText ?? ""} /></Field>
                <Field label="Način publike" hint="Dinamička se preračunava neposredno pre slanja; fiksna se zamrzava pri zakazivanju.">
                  <select key={`audience-mode:${campaign.updatedAt.getTime()}`} name="audienceMode" defaultValue={campaign.audienceMode} className="h-8 rounded-lg border border-input bg-surface px-2 text-sm">
                    <option value="DYNAMIC">Dinamička — osveži kontakte pre slanja</option>
                    <option value="FIXED">Fiksna — zamrzni listu pri zakazivanju</option>
                  </select>
                </Field>
                <Field
                  label="Publike"
                  hint="Označite jednu ili više. Kontakt koji pripada u više označenih publika dobiće poruku samo jednom."
                  className="lg:col-span-2"
                >
                  <div
                    key={`audiences:${campaign.updatedAt.getTime()}`}
                    role="group"
                    aria-label="Izbor publika"
                    className="grid max-h-64 gap-2 overflow-y-auto rounded-xl border border-border/70 bg-muted-bg/30 p-3 sm:grid-cols-2"
                  >
                    {audiences.map((audience) => (
                      <div key={audience.id} className="rounded-lg bg-surface px-3 py-2 text-sm shadow-sm">
                        <label className="flex cursor-pointer items-start gap-3">
                          <input
                            type="checkbox"
                            name="audienceIds"
                            value={audience.id}
                            defaultChecked={selectedAudienceIds.has(audience.id)}
                            className="mt-0.5 size-4 accent-[#123f5a]"
                          />
                          <span>
                            <strong className="font-medium text-ink-900">{newsletterAudienceLabel(audience.name)}</strong>
                            <span className="block text-xs text-ink-500">
                              {isNewsletterTestAudience(audience.name) ? "Sačuvana test lista — nije grupa kupaca." : audience.description || (typeof audience.estimatedCount === "number"
                                ? `do ${audience.estimatedCount.toLocaleString("sr-Latn-RS")} kontakata`
                                : "broj još nije izračunat")}
                            </span>
                          </span>
                        </label>
                        {isNewsletterTestAudience(audience.name) ? <a href="#test-email" className="mt-2 block font-medium text-walnut underline">Izaberi adresu i pošalji test →</a> : null}
                      </div>
                    ))}
                    {!audiences.length ? (
                      <p className="text-sm text-ink-500">Još nema sačuvanih publika.</p>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs text-ink-500">
                    Imaš svoj spisak? <Link href="/admin/newsletter?view=contacts" className="font-medium text-walnut hover:underline">Uvezi CSV/Excel ili nalepi kontakte</Link>
                    {" "}ili <Link href="/admin/newsletter?view=audiences" className="font-medium text-walnut hover:underline">napravi novi segment</Link>.
                  </p>
                </Field>
                <p className="text-sm text-ink-600 lg:col-span-2">Podrazumevano se uključuju samo kontakti sa zabeleženom saglasnošću. Odjavljeni kontakti, odbijene adrese i prijave spama automatski se izostavljaju.</p>
                <label className="flex items-start gap-3 rounded-xl border border-border/70 p-3 text-sm text-ink-500 lg:col-span-2">
                  <input type="checkbox" name="includeContactsWithoutConsent" defaultChecked={campaign.includeContactsWithoutConsent} aria-describedby="no-consent-warning" className="mt-1" />
                  <span>Uključi i kontakte bez zabeležene saglasnosti
                    <span id="no-consent-warning" className="mt-1 block text-xs">Proširuje izabrane grupe, bez promene saglasnosti. Odjavljene i blokirane adrese ostaju isključene. Neželjena masovna pošta može dovesti do ograničenja SES naloga; sporije slanje ne uklanja taj rizik.</span>
                  </span>
                </label>
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
                campaignId={campaign.id}
                initialContent={campaign.content}
                products={products.map((product) => ({ sku: product.sku, name: product.shortName ?? product.name }))}
              />
              <div className="flex flex-wrap items-center gap-3">
                <SubmitButton pendingLabel="Čuvam i proveravam…">Sačuvaj novu verziju</SubmitButton>
                <a href="#test-email" className="text-sm font-medium text-walnut underline">Pošalji test na svoju adresu</a>
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

        <div>
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
  retrySummary,
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
    includeContactsWithoutConsent: boolean;
  };
  retrySummary: Awaited<ReturnType<typeof newsletterRetrySummary>>;
}) {
  const pacing = newsletterDeliveryPolicy();
  return (
    <Card>
      <CardTitle description="Administrator može odmah pokrenuti slanje ili izabrati termin. Sadržaj i primaoci proveravaju se automatski pre slanja. Šalje se poslednja sačuvana verzija.">Kontrola slanja</CardTitle>
      <p className="mb-4 rounded-xl bg-muted-bg p-3 text-sm">Postepeno slanje: najviše {pacing.batchSize} mejlova po paketu, sa najmanje {pacing.intervalMs / 1000} sekundi razmaka. Tempo se deli između newsletter kampanja; obrada reda i SES ograničenja mogu produžiti slanje.</p>
      {campaign.status === "FAILED" || campaign.status === "PARTIAL_FAILED" ? (
        <p className="mb-4 text-sm text-ink-600">Čeka slanje: {retrySummary.queued}. Potvrđeno odbijeno, može ponovo: {retrySummary.retryable}. Nepoznat ishod, potrebna provera SES-a: {retrySummary.unknown}. Već prihvaćene poruke se ne ponavljaju.</p>
      ) : null}
      <p className="mb-4 text-sm">Status: <strong>{campaignLabel[campaign.status]}</strong> · Primaoci: <strong>{campaign.recipients?.toLocaleString("sr-Latn-RS") ?? "proveriće se pre slanja"}</strong></p>
      <div className="flex flex-wrap items-end gap-3">
        {["DRAFT", "IN_REVIEW", "APPROVED"].includes(campaign.status) ? (
          <>
            <AdminActionForm action={sendNewsletterCampaignNowAction}>
              <input type="hidden" name="id" value={campaign.id} />
              <SubmitButton className="min-h-12 px-6 text-base" pendingLabel="Proveravam i pokrećem…" confirm={`Poslati poslednju sačuvanu verziju kampanje za ${campaign.recipients == null ? "izabranu publiku" : `${campaign.recipients} primalaca`}?${campaign.includeContactsWithoutConsent ? " Uključeni su i kontakti bez zabeležene saglasnosti." : ""} Slanje ide postepeno.`}>Pošalji kampanju</SubmitButton>
            </AdminActionForm>
            <AdminActionForm action={scheduleNewsletterCampaignAction} className="w-full sm:w-auto sm:min-w-80">
              <input type="hidden" name="id" value={campaign.id} />
              <NewsletterScheduleField defaultIso={campaign.scheduledAt?.toISOString()} />
              <SubmitButton className="mt-2" pendingLabel="Zakazujem…">Zakaži</SubmitButton>
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
            {retrySummary.unknown > 0 ? (
              <>
                <input type="hidden" name="retryUnknownAcknowledged" value="on" />
                <p className="mb-3 max-w-xl text-sm text-ink-600">Za {retrySummary.unknown} poruka prethodni ishod nije potvrđen. Ponovni pokušaj može poslati duplikat.</p>
              </>
            ) : null}
            <SubmitButton
              variant="outline"
              pendingLabel="Vraćam u red…"
              confirm={retrySummary.unknown > 0
                ? `Pokušati ponovo? Uključeno je ${retrySummary.unknown} poruka sa nepoznatim ishodom, pa neke mogu stići dvaput. Poruke sa zabeleženom potvrdom slanja se preskaču.`
                : "Ponovo pokušati slanje neposlatih poruka? Poruke sa zabeleženom potvrdom slanja se preskaču."}
            >
              Pokušaj ponovo
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
      {campaign.sentAt && retrySummary.accepted > 0 ? <p className="mt-2 text-sm text-ink-700">Prihvaćeno za slanje: <strong>{formatDate(campaign.sentAt)}</strong></p> : null}
      <p className="mt-4 text-sm">SES prihvatio: <strong>{retrySummary.accepted}</strong> · Čeka: <strong>{retrySummary.queued}</strong> · Greške: <strong>{retrySummary.failed}</strong>. Prihvatanje nije potvrda isporuke.</p>
      {campaign.audienceBreakdown ? <details className="mt-4"><summary className="cursor-pointer text-sm">Detalji izabrane publike</summary><pre className="mt-4 overflow-auto rounded-lg bg-muted-bg p-3 text-xs text-ink-700">{JSON.stringify(campaign.audienceBreakdown, null, 2)}</pre></details> : null}
    </Card>
  );
}

function StatusPill({ status, label }: { status: string; label: string }) {
  const good = status === "SENT" || status === "DELIVERED" || status === "OPENED" || status === "CLICKED";
  const bad = status === "FAILED" || status === "BOUNCED" || status === "COMPLAINED";
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", good ? "bg-success/15 text-success" : bad ? "bg-destructive/15 text-destructive" : "bg-muted-bg text-ink-700")}>{label}</span>;
}

function formatDate(date: Date) {
  return date.toLocaleString("sr-Latn-RS", { timeZone: "Europe/Belgrade", dateStyle: "short", timeStyle: "short" });
}
