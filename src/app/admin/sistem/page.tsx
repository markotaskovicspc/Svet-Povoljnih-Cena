import { Card, CardTitle, StatCard } from "@/components/admin/card";
import { PageHeader } from "@/components/admin/page-header";
import { requireAdminAction } from "@/lib/admin";
import {
  externalMonitoringIsConnected,
  getIntegrationReadiness,
  getOperationsSnapshot,
  type IntegrationReadiness,
} from "@/lib/admin/system-status";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Monitoring i backup",
  robots: { index: false, follow: false },
};

function StatusBadge({
  ready,
  readyLabel = "Spremno",
  pendingLabel = "Nije povezano",
}: {
  ready: boolean;
  readyLabel?: string;
  pendingLabel?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-1 text-xs font-medium",
        ready
          ? "bg-success/10 text-success"
          : "bg-warning/10 text-warning",
      )}
    >
      {ready ? readyLabel : pendingLabel}
    </span>
  );
}

function IntegrationRow({ item }: { item: IntegrationReadiness }) {
  return (
    <div className="rounded-xl border border-border/60 px-4 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink-900">{item.label}</h3>
          <p className="mt-1 text-xs text-ink-500">{item.description}</p>
        </div>
        <StatusBadge ready={item.ready} />
      </div>
      {!item.ready ? (
        <p className="mt-3 break-words text-xs leading-5 text-ink-500">
          Nedostaje u trenutnom environment-u:{" "}
          <span className="font-mono text-ink-700">
            {item.missing.join(", ")}
          </span>
        </p>
      ) : null}
    </div>
  );
}

function formatCheckedAt(value: string) {
  return new Intl.DateTimeFormat("sr-Latn-RS", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Europe/Belgrade",
  }).format(new Date(value));
}

export default async function SystemStatusPage() {
  await requireAdminAction(["OPS"]);

  const [snapshot] = await Promise.all([getOperationsSnapshot()]);
  const integrations = getIntegrationReadiness();
  const monitoringConnected = externalMonitoringIsConnected();
  const deployment =
    process.env.VERCEL_ENV === "production"
      ? "Vercel produkcija"
      : process.env.VERCEL_ENV === "preview"
        ? "Vercel preview"
        : "Lokalno";
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);

  return (
    <>
      <PageHeader
        title="Monitoring i backup"
        description="Jedno mesto za proveru sistema. Tajne i njihove vrednosti se ovde nikada ne prikazuju."
      />

      <div className="space-y-8 px-8 py-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
          <span>{deployment}</span>
          {commit ? <span>Commit {commit}</span> : null}
          <span>Provereno {formatCheckedAt(snapshot.checkedAt)}</span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Baza"
            value={snapshot.database.ok ? "Radi" : "Ne radi"}
            hint={
              snapshot.database.latencyMs === null
                ? "Veza ka bazi nije dostupna"
                : `Odgovor ${snapshot.database.latencyMs} ms`
            }
            tone={snapshot.database.ok ? "success" : "danger"}
          />
          <StatCard
            label="Spoljni monitoring"
            value={monitoringConnected ? "Povezan" : "Za povezivanje"}
            hint="Alarm kada sajt ili server prijave grešku"
            tone={monitoringConnected ? "success" : "warning"}
          />
          <StatCard
            label="Backup baze"
            value="Za povezivanje"
            hint="Kasnije povezujemo potvrdu iz Supabase-a"
            tone="warning"
          />
          <StatCard
            label="Backup fajlova"
            value="Za povezivanje"
            hint="Slike, računi i dokumenti iz Storage-a"
            tone="warning"
          />
        </div>

        <Card>
          <CardTitle description="Ovo su stvarni brojevi iz baze. Istorijske greške ostaju vidljive dok se ne obrade.">
            Operativno stanje
          </CardTitle>
          {snapshot.queues ? (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              <StatCard
                label="Email greške"
                value={String(snapshot.queues.failedEmails)}
                tone={snapshot.queues.failedEmails ? "danger" : "success"}
              />
              <StatCard
                label="Pošiljke greške"
                value={String(snapshot.queues.failedShipments)}
                tone={snapshot.queues.failedShipments ? "danger" : "success"}
              />
              <StatCard
                label="Fiskalne greške"
                value={String(snapshot.queues.failedFiscalDocuments)}
                tone={
                  snapshot.queues.failedFiscalDocuments ? "danger" : "success"
                }
              />
              <StatCard
                label="Pozadinske greške"
                value={String(snapshot.queues.failedBackgroundJobs)}
                tone={
                  snapshot.queues.failedBackgroundJobs ? "danger" : "success"
                }
              />
              <StatCard
                label="Poslovi na čekanju"
                value={String(snapshot.queues.queuedBackgroundJobs)}
                tone={
                  snapshot.queues.queuedBackgroundJobs ? "warning" : "success"
                }
              />
            </div>
          ) : (
            <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-ink-700">
              Baza trenutno nije dostupna, pa redovi za obradu nisu provereni.
            </div>
          )}
        </Card>

        <Card>
          <CardTitle description="Circuit breaker, approval red, stale run-ovi i media retry stanje.">
            Rabalux integracija
          </CardTitle>
          {snapshot.rabalux ? (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard
                label="Media greške"
                value={String(snapshot.rabalux.failedMediaJobs)}
                tone={snapshot.rabalux.failedMediaJobs ? "danger" : "success"}
              />
              <StatCard
                label="Media retry"
                value={String(snapshot.rabalux.retryMediaJobs)}
                tone={snapshot.rabalux.retryMediaJobs ? "warning" : "success"}
              />
              <StatCard
                label="Stale sync"
                value={String(snapshot.rabalux.staleRuns)}
                tone={snapshot.rabalux.staleRuns ? "danger" : "success"}
              />
              <StatCard
                label="Čeka odobrenje"
                value={String(snapshot.rabalux.pendingApprovals)}
                tone={snapshot.rabalux.pendingApprovals ? "warning" : "success"}
              />
              <StatCard
                label="Mapping konflikti"
                value={String(snapshot.rabalux.pendingMappings)}
                tone={snapshot.rabalux.pendingMappings ? "warning" : "success"}
              />
              <StatCard
                label="Poslednji katalog"
                value={snapshot.rabalux.lastCatalogSuccessAt ? new Date(snapshot.rabalux.lastCatalogSuccessAt).toLocaleString("sr-RS") : "—"}
                tone={snapshot.rabalux.lastCatalogSuccessAt ? "success" : "warning"}
              />
              <StatCard
                label="Poslednji lager"
                value={snapshot.rabalux.lastStockSuccessAt ? new Date(snapshot.rabalux.lastStockSuccessAt).toLocaleString("sr-RS") : "—"}
                tone={snapshot.rabalux.lastStockSuccessAt ? "success" : "warning"}
              />
            </div>
          ) : (
            <p className="text-sm text-ink-500">Rabalux dobavljač nije dostupan u bazi.</p>
          )}
        </Card>

        <Card>
          <CardTitle description="Prikazuju se samo nazivi promenljivih koje nedostaju, nikada njihove vrednosti.">
            Spoljne integracije
          </CardTitle>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {integrations.map((item) => (
              <IntegrationRow key={item.id} item={item} />
            ))}
          </div>
        </Card>

        <Card>
          <CardTitle description="Kartice su već spremne u adminu; stvarni status uključujemo kada izaberemo servis i povežemo njegov API.">
            Šta još povezujemo
          </CardTitle>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-border/60 p-4">
              <StatusBadge ready={monitoringConnected} />
              <h3 className="mt-3 text-sm font-semibold text-ink-900">
                Monitoring
              </h3>
              <p className="mt-1 text-xs leading-5 text-ink-500">
                Provera sajta i automatski alarm kada nešto prestane da radi.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 p-4">
              <StatusBadge ready={false} />
              <h3 className="mt-3 text-sm font-semibold text-ink-900">
                Backup baze
              </h3>
              <p className="mt-1 text-xs leading-5 text-ink-500">
                Kopija narudžbina, proizvoda, korisnika i podešavanja.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 p-4">
              <StatusBadge ready={false} />
              <h3 className="mt-3 text-sm font-semibold text-ink-900">
                Backup fajlova
              </h3>
              <p className="mt-1 text-xs leading-5 text-ink-500">
                Odvojena kopija slika, računa, nalepnica i priloga.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
