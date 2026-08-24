import Link from "next/link";
import type { MarketingContactStatus, NewsletterCampaignStatus } from "@prisma/client";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { getEmailConfig } from "@/lib/email/config";
import {
  emptyAudienceFilter,
  selectedNewsletterAudiences,
} from "@/lib/newsletter/audience";
import { marketingContactMigrationPreview } from "@/lib/newsletter/contacts";
import { AdminActionForm } from "@/components/admin/action-form";
import { Card, CardTitle, StatCard } from "@/components/admin/card";
import { DataTable } from "@/components/admin/data-table";
import { Field } from "@/components/admin/field";
import { NewsletterAudienceBuilder } from "@/components/admin/newsletter-audience-builder";
import { PageHeader } from "@/components/admin/page-header";
import { SubmitButton } from "@/components/admin/submit-button";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  createNewsletterCampaignAction,
  deleteNewsletterAudienceAction,
  deleteNewsletterTemplateAction,
  saveNewsletterAudienceAction,
  importNewsletterContactsAction,
  previewNewsletterContactImportAction,
  unsubscribeMarketingContactAction,
} from "./actions";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Newsletter centar",
  robots: { index: false, follow: false },
};

const views = [
  ["campaigns", "Kampanje"],
  ["audiences", "Publike"],
  ["contacts", "Kontakti i saglasnosti"],
  ["templates", "Šabloni"],
  ["settings", "Podešavanja"],
] as const;

const campaignLabel: Record<NewsletterCampaignStatus, string> = {
  DRAFT: "Nacrt",
  IN_REVIEW: "Na proveri",
  APPROVED: "Odobrena",
  SCHEDULED: "Zakazana",
  PREPARING: "Priprema",
  SENDING: "Slanje",
  SENT: "Poslata",
  CANCELLED: "Otkazana",
  PARTIAL_FAILED: "Delimična greška",
  FAILED: "Greška",
};

const contactLabel: Record<MarketingContactStatus, string> = {
  PENDING: "Čeka potvrdu",
  ACTIVE: "Aktivan",
  UNSUBSCRIBED: "Odjavljen",
  SUPPRESSED: "Potisnut",
};

export default async function NewsletterPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; audienceId?: string }>;
}) {
  await requireAdminAction(["ADS"]);
  const params = await searchParams;
  const view = views.some(([key]) => key === params.view) ? params.view! : "campaigns";
  const q = params.q?.trim() ?? "";

  const [campaignStatus, contactStatus, recentCampaigns] = await Promise.all([
    db.newsletterCampaign.groupBy({ by: ["status"], _count: { _all: true } }),
    db.marketingContact.groupBy({ by: ["status"], _count: { _all: true } }),
    db.newsletterCampaign.findMany({
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: { audience: { select: { name: true } } },
    }),
  ]);
  const statusCount = Object.fromEntries(campaignStatus.map((row) => [row.status, row._count._all]));
  const contactsCount = Object.fromEntries(contactStatus.map((row) => [row.status, row._count._all]));
  const sentMetrics = recentCampaigns.reduce(
    (sum, campaign) => ({
      recipients: sum.recipients + (campaign.recipients ?? 0),
      delivered: sum.delivered + (campaign.delivered ?? 0),
      opened: sum.opened + (campaign.opened ?? 0),
      clicked: sum.clicked + (campaign.clicked ?? 0),
    }),
    { recipients: 0, delivered: 0, opened: 0, clicked: 0 },
  );

  return (
    <>
      <PageHeader
        title="Newsletter centar"
        description="Kampanje, saglasnosti, segmentacija, zakazivanje i rezultati na jednom mestu."
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Newsletter" }]}
        actions={
          <AdminActionForm action={createNewsletterCampaignAction} className="flex items-center gap-2">
            <SubmitButton pendingLabel="Kreiram…">+ Nova kampanja</SubmitButton>
          </AdminActionForm>
        }
      />
      <main className="space-y-6 px-4 py-6 md:px-8">
        <nav className="flex flex-wrap gap-2" aria-label="Newsletter sekcije">
          {views.map(([key, label]) => (
            <Link
              key={key}
              href={`/admin/newsletter?view=${key}`}
              className={cn(buttonVariants({ variant: view === key ? "secondary" : "outline", size: "sm" }))}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Aktivni kontakti" value={(contactsCount.ACTIVE ?? 0).toLocaleString("sr-Latn-RS")} hint={`${contactsCount.PENDING ?? 0} čeka potvrdu`} tone="success" />
          <StatCard label="Nacrti i provera" value={((statusCount.DRAFT ?? 0) + (statusCount.IN_REVIEW ?? 0)).toLocaleString("sr-Latn-RS")} />
          <StatCard label="Isporučeno" value={sentMetrics.delivered.toLocaleString("sr-Latn-RS")} hint={`od ${sentMetrics.recipients.toLocaleString("sr-Latn-RS")} adresiranih`} />
          <StatCard label="Otvaranje / klik" value={`${rate(sentMetrics.opened, sentMetrics.delivered)} / ${rate(sentMetrics.clicked, sentMetrics.delivered)}`} hint="za prikazane kampanje" />
        </div>

        {view === "campaigns" ? <CampaignsView campaigns={recentCampaigns} /> : null}
        {view === "audiences" ? <AudiencesView selectedId={params.audienceId} /> : null}
        {view === "contacts" ? <ContactsView q={q} /> : null}
        {view === "templates" ? <TemplatesView /> : null}
        {view === "settings" ? <SettingsView contactsCount={contactsCount} /> : null}
      </main>
    </>
  );
}

async function CampaignsView({
  campaigns,
}: {
  campaigns: Awaited<ReturnType<typeof db.newsletterCampaign.findMany<{ include: { audience: { select: { name: true } } } }>>>;
}) {
  const templates = await db.newsletterTemplate.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  return (
    <>
      <Card>
        <CardTitle description="Kreirajte prazan nacrt ili krenite od ranije sačuvanog šablona.">Nova kampanja</CardTitle>
        <AdminActionForm action={createNewsletterCampaignAction} className="flex flex-wrap items-end gap-3">
          <Field label="Šablon" className="min-w-64 flex-1">
            <select name="templateId" className="h-8 rounded-lg border border-input bg-surface px-2 text-sm">
              <option value="">Prazna kampanja</option>
              {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
          </Field>
          <SubmitButton pendingLabel="Kreiram…">Kreiraj nacrt</SubmitButton>
        </AdminActionForm>
      </Card>
      <DataTable
        columns={[
          { key: "campaign", label: "Kampanja" },
          { key: "audience", label: "Publika" },
          { key: "status", label: "Status" },
          { key: "schedule", label: "Termin" },
          { key: "results", label: "Rezultati" },
        ]}
        rows={campaigns.map((campaign) => ({
          id: campaign.id,
          cells: {
            campaign: <div><Link href={`/admin/newsletter/kampanje/${campaign.id}`} className="font-medium text-walnut hover:underline">{campaign.title}</Link><p className="max-w-md truncate text-xs text-ink-500">{campaign.subject}</p></div>,
            audience: <span>{campaignAudienceNames(campaign)}<br /><span className="text-xs text-ink-500">{campaign.audienceMode === "FIXED" ? "fiksna lista" : "dinamička"}</span></span>,
            status: <StatusPill status={campaign.status} label={campaignLabel[campaign.status]} />,
            schedule: campaign.sentAt ? formatDate(campaign.sentAt) : campaign.scheduledAt ? formatDate(campaign.scheduledAt) : "—",
            results: <span className="text-xs">{campaign.delivered ?? 0} isporučeno · {campaign.opened ?? 0} otvoreno · {campaign.clicked ?? 0} klik</span>,
          },
        }))}
        empty="Nema newsletter kampanja."
      />
    </>
  );
}

async function AudiencesView({ selectedId }: { selectedId?: string }) {
  const [audiences, contacts, campaigns] = await Promise.all([
    db.newsletterAudience.findMany({ orderBy: { updatedAt: "desc" }, include: { _count: { select: { campaigns: true } } } }),
    db.marketingContact.findMany({ where: { status: "ACTIVE" }, orderBy: { email: "asc" }, take: 500, select: { id: true, email: true } }),
    db.newsletterCampaign.findMany({ orderBy: { createdAt: "desc" }, take: 200, select: { id: true, title: true } }),
  ]);
  const selected = audiences.find((audience) => audience.id === selectedId) ?? null;
  return (
    <div className="grid gap-6 2xl:grid-cols-[360px_minmax(0,1fr)]">
      <div className="space-y-3">
        <Card>
          <CardTitle description="Segmenti se računaju nad kontaktima sa aktivnom saglasnošću.">Sačuvane publike</CardTitle>
          <Link href="/admin/newsletter?view=audiences" className={buttonVariants({ variant: "outline", size: "sm" })}>+ Nova publika</Link>
        </Card>
        {audiences.map((audience) => (
          <Card key={audience.id} className={selected?.id === audience.id ? "border-walnut" : ""}>
            <Link href={`/admin/newsletter?view=audiences&audienceId=${audience.id}`} className="font-medium text-walnut hover:underline">{audience.name}</Link>
            <p className="mt-1 text-xs text-ink-500">{audience.estimatedCount ?? "—"} procenjeno · {audience._count.campaigns} kampanja</p>
            {audience.description ? <p className="mt-2 text-sm text-ink-700">{audience.description}</p> : null}
            <AdminActionForm action={deleteNewsletterAudienceAction} className="mt-3">
              <input type="hidden" name="id" value={audience.id} />
              <SubmitButton variant="ghost" size="sm" confirm={`Obrisati publiku „${audience.name}“?`}>Obriši</SubmitButton>
            </AdminActionForm>
          </Card>
        ))}
      </div>
      <Card>
        <CardTitle description="AND/OR pravila, ručni izbor i isključenja kampanja mogu se kombinovati.">{selected ? `Uredi: ${selected.name}` : "Nova publika"}</CardTitle>
        <AdminActionForm action={saveNewsletterAudienceAction} className="space-y-5">
          <input type="hidden" name="id" value={selected?.id ?? ""} />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Naziv"><Input name="name" required maxLength={160} defaultValue={selected?.name ?? ""} /></Field>
            <Field label="Opis"><Input name="description" maxLength={500} defaultValue={selected?.description ?? ""} /></Field>
          </div>
          <NewsletterAudienceBuilder initialFilter={selected?.filter ?? emptyAudienceFilter()} contacts={contacts} campaigns={campaigns} />
          <SubmitButton pendingLabel="Čuvam i računam…">Sačuvaj publiku</SubmitButton>
        </AdminActionForm>
      </Card>
    </div>
  );
}

async function ContactsView({ q }: { q: string }) {
  const contacts = await db.marketingContact.findMany({
    where: q ? { email: { contains: q, mode: "insensitive" } } : {},
    orderBy: { updatedAt: "desc" },
    take: 500,
    include: { consentEvents: { orderBy: { occurredAt: "desc" }, take: 1 } },
  });
  return (
    <>
      <Card>
        <CardTitle description="Prvo proverite fajl bez upisa. Samo red sa izričitom vrednošću da/yes/true/1 u koloni consent postaje aktivan; svi ostali ostaju evidentirani bez zabeležene saglasnosti. U nacrtu ih možete uključiti uz jasno upozorenje. Ranija odjava ili potiskivanje uvek imaju prednost.">
          Uvoz kontakata iz CSV/XLSX
        </CardTitle>
        <div className="mb-4 rounded-lg border border-warning/25 bg-warning/10 px-4 py-3 text-sm text-warning">
          <strong>Važno:</strong> stara baza bez dokaza saglasnosti može da se uveze.
          Ti kontakti se u nacrtu uključuju posebnom opcijom uz upozorenje; izričite odjave i potiskivanja nikada se ne zaobilaze.
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <AdminActionForm
            action={previewNewsletterContactImportAction}
            preserveValues
            className="rounded-lg border border-border p-4"
          >
            <Field label="CSV ili XLSX fajl" hint="Do 20 MB i 100.000 redova. Obavezna kolona: email.">
              <Input name="contactsFile" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required />
            </Field>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <SubmitButton variant="outline" pendingLabel="Proveravam…">
                Proveri bez upisa
              </SubmitButton>
              <a
                href="data:text/csv;charset=utf-8,email%2Cime%2Cprezime%2Cconsent%2Cdatum_saglasnosti%2Cizvor%0Akupac%40primer.rs%2CAna%2CAni%C4%87%2Cda%2C2026-08-24%2Cstara-baza"
                download="newsletter-kontakti-sablon.csv"
                className="text-sm text-walnut underline-offset-4 hover:underline"
              >
                Preuzmi CSV šablon
              </a>
            </div>
          </AdminActionForm>
          <AdminActionForm
            action={importNewsletterContactsAction}
            className="space-y-3 rounded-lg border border-border p-4"
          >
            <Field
              label="Naziv liste / publike"
              hint="Na primer: Sajam avgust 2026. Posle uvoza ova lista će se automatski pojaviti među publikama u nacrtu."
            >
              <Input name="listName" required maxLength={150} placeholder="Sajam avgust 2026" />
            </Field>
            <Field label="CSV ili XLSX fajl za upis" hint="Za veliku bazu koristite isti fajl koji ste prethodno proverili.">
              <Input name="contactsFile" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required />
            </Field>
            <div className="mt-3 rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">
              Redovi bez izričite saglasnosti biće uvezeni sa statusom „bez zabeležene saglasnosti“. Njih kasnije možete uključiti u pojedinačnu kampanju uz upozorenje, bez menjanja tog statusa.
            </div>
            <SubmitButton
              className="mt-3"
              pendingLabel="Uvozim…"
              confirm="Uvesti kontakte? Postojeće odjave i potiskivanja neće biti ponovo aktivirani."
            >
              Uvezi kontakte
            </SubmitButton>
          </AdminActionForm>
        </div>
      </Card>
      <Card>
        <CardTitle description="Kratak operativni redosled za svaku novu kampanju.">
          Kako se koristi Newsletter centar
        </CardTitle>
        <ol className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-5">
          {[
            ["1", "Kontakti", "Dajte listi naziv i uvezite CSV/XLSX; publika od uvezenih kontakata pravi se automatski."],
            ["2", "Publika", "U nacrtu ček-boksovima spojite jednu ili više lista i segmenata."],
            ["3", "Kampanja", "Napravite nacrt, sadržaj i test poruku na internu adresu."],
            ["4", "Provera", "Pošaljite na odobrenje; za veliku publiku važi kontrola drugog administratora."],
            ["5", "Slanje", "Zakažite termin i posle pratite isporuku, otvaranja, klikove i odjave."],
          ].map(([step, title, description]) => (
            <li key={step} className="rounded-lg bg-muted-bg/60 p-3">
              <p className="font-semibold text-ink-900">{step}. {title}</p>
              <p className="mt-1 text-ink-600">{description}</p>
            </li>
          ))}
        </ol>
      </Card>
      <Card>
        <form className="flex items-end gap-3" method="get">
          <input type="hidden" name="view" value="contacts" />
          <Field label="Pretraga email-a" className="flex-1"><Input name="q" defaultValue={q} /></Field>
          <SubmitButton>Filtriraj</SubmitButton>
        </form>
      </Card>
      <DataTable
        columns={[
          { key: "email", label: "Kontakt" },
          { key: "source", label: "Izvor" },
          { key: "lists", label: "Liste" },
          { key: "consent", label: "Saglasnost" },
          { key: "dates", label: "Datumi" },
          { key: "action", label: "" },
        ]}
        rows={contacts.map((contact) => ({
          id: contact.id,
          cells: {
            email: <div><span className="font-mono text-xs">{contact.email}</span><p className="text-xs text-ink-500">{[contact.firstName, contact.lastName].filter(Boolean).join(" ") || "bez imena"}</p></div>,
            source: contact.source ?? "—",
            lists: contact.tags?.length ? <span className="text-xs">{contact.tags.join(", ")}</span> : "—",
            consent: <div><StatusPill status={contact.status} label={contactLabel[contact.status]} /><p className="mt-1 text-[11px] text-ink-500">{contact.consentEvents[0] ? `${contact.consentEvents[0].type} · ${contact.consentEvents[0].source}` : "bez događaja"}</p></div>,
            dates: <span className="text-xs">Prijava: {contact.subscribedAt ? formatDate(contact.subscribedAt) : "—"}<br />Odjava: {contact.unsubscribedAt ? formatDate(contact.unsubscribedAt) : "—"}</span>,
            action: contact.status === "ACTIVE" || contact.status === "PENDING" ? (
              <AdminActionForm action={unsubscribeMarketingContactAction}>
                <input type="hidden" name="id" value={contact.id} />
                <SubmitButton variant="outline" size="sm" confirm={`Odjaviti ${contact.email} iz marketing poruka?`}>Odjavi</SubmitButton>
              </AdminActionForm>
            ) : null,
          },
        }))}
        empty="Nema kontakata."
      />
    </>
  );
}

async function TemplatesView() {
  const templates = await db.newsletterTemplate.findMany({ orderBy: { updatedAt: "desc" } });
  return (
    <DataTable
      columns={[
        { key: "name", label: "Šablon" },
        { key: "subject", label: "Naslov poruke" },
        { key: "updated", label: "Izmenjen" },
        { key: "actions", label: "" },
      ]}
      rows={templates.map((template) => ({
        id: template.id,
        cells: {
          name: <span className="font-medium">{template.name}</span>,
          subject: template.subject ?? "—",
          updated: formatDate(template.updatedAt),
          actions: <div className="flex flex-wrap gap-2"><AdminActionForm action={createNewsletterCampaignAction}><input type="hidden" name="templateId" value={template.id} /><SubmitButton variant="outline" size="sm">Nova kampanja</SubmitButton></AdminActionForm><AdminActionForm action={deleteNewsletterTemplateAction}><input type="hidden" name="id" value={template.id} /><SubmitButton variant="ghost" size="sm" confirm={`Obrisati šablon „${template.name}“?`}>Obriši</SubmitButton></AdminActionForm></div>,
        },
      }))}
      empty="Nema sačuvanih šablona. Šablon možete napraviti iz editora kampanje."
    />
  );
}

async function SettingsView({ contactsCount }: { contactsCount: Record<string, number> }) {
  const [migration, jobs] = await Promise.all([
    marketingContactMigrationPreview(),
    db.backgroundJob.groupBy({
      by: ["kind"],
      where: { kind: { in: ["NEWSLETTER_CAMPAIGN_SEND", "NEWSLETTER_SYNC"] }, completedAt: null },
      _count: { _all: true },
    }),
  ]);
  const cfg = getEmailConfig();
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardTitle description="Prikazuje samo spremnost, nikad vrednosti tajni.">Provider i isporuka</CardTitle>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 text-sm">
          <dt>Email provider</dt><dd><Ready value={cfg.provider === "resend"}>{cfg.provider}</Ready></dd>
          <dt>API ključ</dt><dd><Ready value={Boolean(cfg.apiKey)} /></dd>
          <dt>Marketing pošiljalac</dt><dd><Ready value={Boolean(cfg.marketingFrom)} /></dd>
          <dt>Resend dozvola za promotivne poruke</dt><dd><Ready value={Boolean(cfg.promotionsTopicId)} /></dd>
          <dt>Resend webhook potpis</dt><dd><Ready value={Boolean(cfg.resendWebhookSecret)} /></dd>
          <dt>Unsubscribe potpis</dt><dd><Ready value={Boolean(cfg.unsubscribeSecret)} /></dd>
        </dl>
        {cfg.provider === "none" ? <p className="mt-4 rounded-lg bg-warning/10 p-3 text-sm text-warning">Razvojni režim: slanje kampanje je simulirano. Production sa providerom „none“ je blokiran.</p> : null}
      </Card>
      <Card>
        <CardTitle description="Pregled migracije starog NewsletterSubscriber i nalog saglasnosti u kanonske kontakte.">Saglasnosti i migracija</CardTitle>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 text-sm">
          <dt>Stari aktivni newsletter zapisi</dt><dd>{migration.legacyActiveSubscribers}</dd>
          <dt>Marketing saglasnosti naloga</dt><dd>{migration.accountOptIns}</dd>
          <dt>Aktivni kanonski kontakti</dt><dd>{contactsCount.ACTIVE ?? 0}</dd>
          <dt>Potiskivanja</dt><dd>{migration.suppressions}</dd>
          <dt>Konflikti (odjava ima prednost)</dt><dd>{migration.conflicts}</dd>
        </dl>
      </Card>
      <Card className="xl:col-span-2">
        <CardTitle>Red pozadinskih poslova</CardTitle>
        <div className="flex flex-wrap gap-3 text-sm">
          {jobs.length ? jobs.map((job) => <span key={job.kind} className="rounded-full bg-muted-bg px-3 py-1">{job.kind}: {job._count._all}</span>) : <span className="text-ink-500">Nema newsletter poslova koji čekaju.</span>}
        </div>
      </Card>
    </div>
  );
}

function StatusPill({ status, label }: { status: string; label: string }) {
  const tone = status === "ACTIVE" || status === "SENT" || status === "DELIVERED"
    ? "bg-success/15 text-success"
    : status === "FAILED" || status === "SUPPRESSED" || status === "COMPLAINED" || status === "BOUNCED"
      ? "bg-destructive/15 text-destructive"
      : status === "SCHEDULED" || status === "APPROVED" || status === "IN_REVIEW" || status === "PENDING"
        ? "bg-warning/15 text-warning"
        : "bg-muted-bg text-ink-700";
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", tone)}>{label}</span>;
}

function campaignAudienceNames(campaign: {
  audience: { name: string } | null;
  audienceFilterSnapshot: unknown;
}) {
  const selected = selectedNewsletterAudiences(campaign.audienceFilterSnapshot);
  return selected.length
    ? selected.map((audience) => audience.name).join(", ")
    : campaign.audience?.name ?? "—";
}

function Ready({ value, children }: { value: boolean; children?: React.ReactNode }) {
  return <span className={value ? "text-success" : "text-destructive"}>{children ?? (value ? "Spremno" : "Nedostaje")}</span>;
}

function formatDate(date: Date) {
  return date.toLocaleString("sr-Latn-RS", { timeZone: "Europe/Belgrade", dateStyle: "short", timeStyle: "short" });
}

function rate(value: number, base: number) {
  return base > 0 ? `${((value / base) * 100).toFixed(1)}%` : "0%";
}
