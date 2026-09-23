import Image from "next/image";
import Link from "next/link";
import {
  ReclamationRequest,
  ReclamationStatus,
  ReclamationType,
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import {
  withAdminState,
  requireAdminAction,
  type AdminActionState,
} from "@/lib/admin";
import {
  removeReclamationUploads,
  signReclamationPhotoUrls,
  uploadAdminReclamationPhoto,
} from "@/lib/api/uploads";
import { db } from "@/lib/db";
import { logOperationalError } from "@/lib/monitoring";
import { Card, CardTitle } from "@/components/admin/card";
import { ErpGrid } from "@/components/admin/erp-grid";
import { Field } from "@/components/admin/field";
import { PageHeader } from "@/components/admin/page-header";
import { SubmitButton } from "@/components/admin/submit-button";
import { AdminActionForm } from "@/components/admin/action-form";
import { Textarea } from "@/components/ui/textarea";
import { getErpModule } from "@/lib/admin/erp";
import {
  createAdminReclamation,
  createReclamationSchema,
  lookupOrderForReclamation,
} from "@/lib/api/reclamations";
import { ReclamationOrderFields } from "@/components/admin/reclamation-order-search";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Reklamacije",
  robots: { index: false, follow: false },
};

const STATUS_LABELS: Record<ReclamationStatus, string> = {
  PRIMLJENO: "Primljeno",
  U_OBRADI: "U obradi",
  RESENO: "Rešeno",
  ODBIJENO: "Odbijeno",
};

const TYPE_LABELS: Record<string, string> = {
  FIZICKO_OSTECENJE: "Fizičko oštećenje",
  KVAR: "Kvar",
  NIJE_UNETO: "Nije uneto",
};

const REQUEST_LABELS: Record<ReclamationRequest, string> = {
  POPRAVKA: "Popravka",
  ZAMENA: "Zamena",
  POVRACAJ_NOVCA: "Povraćaj novca",
  UMANJENJE_CENE: "Umanjenje cene",
};

async function createManualReclamation(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";

  return withAdminState(
    {
      allowed: ["OPS"],
      action: "reclamation.manualCreate",
      entity: "Reclamation",
    },
    async (actorId, actionData: FormData) => {
      const photoFiles = actionData
        .getAll("photos")
        .filter((value): value is File => value instanceof File && value.size > 0);
      if (photoFiles.length > 5) {
        return { ok: false as const, error: "Možete dodati najviše 5 fotografija." };
      }
      const parsed = createReclamationSchema.safeParse({
        orderNumberOrFiscal: actionData.get("orderNumberOrFiscal"),
        sku: actionData.get("sku"),
        quantity: Number(actionData.get("quantity")),
        description: actionData.get("description"),
        photos: [],
      });
      if (!parsed.success) {
        return {
          ok: false as const,
          error:
            parsed.error.issues[0]?.message ??
            "Podaci za reklamaciju nisu ispravni.",
        };
      }

      const typeRaw = String(actionData.get("type") ?? "").trim();
      const requestRaw = String(actionData.get("request") ?? "").trim();
      const type = typeRaw ? (typeRaw as ReclamationType) : null;
      const request = requestRaw ? (requestRaw as ReclamationRequest) : null;
      if (type && !Object.values(ReclamationType).includes(type)) {
        return { ok: false as const, error: "Tip reklamacije nije ispravan." };
      }
      if (request && !Object.values(ReclamationRequest).includes(request)) {
        return { ok: false as const, error: "Zahtev kupca nije ispravan." };
      }

      const order = await lookupOrderForReclamation(parsed.data.orderNumberOrFiscal);
      if (!order) return { ok: false as const, error: "Porudžbina nije pronađena." };
      const orderItem = order.items.find((item) => item.sku === parsed.data.sku);
      if (!orderItem) {
        return {
          ok: false as const,
          error: "SKU mora biti stavka iz izabrane porudžbine.",
        };
      }

      const uploaded: Array<{ url: string; bytes: number }> = [];
      try {
        for (const file of photoFiles) {
          uploaded.push(
            await uploadAdminReclamationPhoto(file, {
              orderNumber: order.number,
              sku: orderItem.sku,
            }),
          );
        }
      } catch (error) {
        await removeReclamationUploads(uploaded.map((photo) => photo.url));
        return {
          ok: false as const,
          error: error instanceof Error ? error.message : "Upload fotografije nije uspeo.",
        };
      }

      let result: Awaited<ReturnType<typeof createAdminReclamation>>;
      try {
        result = await createAdminReclamation(
          { ...parsed.data, photos: uploaded, type, request },
          actorId,
        );
      } catch (error) {
        logOperationalError("reclamation.manual_create_failed", error, { orderId: order.id });
        await removeReclamationUploads(uploaded.map((photo) => photo.url));
        return { ok: false as const, error: "Unos reklamacije trenutno nije uspeo. Pokušajte ponovo." };
      }
      if (!result.ok) {
        await removeReclamationUploads(uploaded.map((photo) => photo.url));
        const errors: Record<typeof result.reason, string> = {
          ORDER_NOT_FOUND: "Porudžbina nije pronađena.",
          ORDER_NOT_DELIVERED:
            "Status porudžbine ne dozvoljava unos reklamacije.",
          ITEM_NOT_FOUND: "Stavka nije pronađena u porudžbini.",
          UNAUTHORIZED: "Nemate pravo da unesete ovu reklamaciju.",
          INVALID_PHOTO: "Priložena fotografija nije ispravna.",
          QUANTITY_EXCEEDED:
            "Količina prijave mora biti od 1 do kupljene količine artikla (najviše 999).",
        };
        return { ok: false as const, error: errors[result.reason] };
      }

      revalidatePath("/admin/erp/reklamacije-dnevnik");
      revalidatePath("/nalog/reklamacije");
      return {
        ok: true as const,
        entityId: result.id,
        message: `Reklamacija ${result.number} je ručno evidentirana.`,
        diff: {
          number: result.number,
          orderNumberOrFiscal: parsed.data.orderNumberOrFiscal,
          sku: parsed.data.sku,
          quantity: parsed.data.quantity,
          type,
          request,
        },
      };
    },
  )(formData);
}

export default async function ReclamationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; reclamation?: string }>;
}) {
  await requireAdminAction(["OPS"]);
  const sp = await searchParams;
  const status = sp.status as ReclamationStatus | undefined;
  const where = {
    ...(status && Object.values(ReclamationStatus).includes(status) ? { status } : {}),
    ...(sp.reclamation ? { id: sp.reclamation } : {}),
  };

  const [items, erpModule] =
    await Promise.all([
      db.reclamation.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          photos: true,
          order: { select: { number: true } },
          orderItem: { select: { name: true, qty: true } },
          product: { select: { name: true } },
        },
      }),
      getErpModule("reklamacije-dnevnik"),
    ]);

  // Photo bucket is private — swap stored canonical URLs for signed ones.
  const signedPhotoUrls = await signReclamationPhotoUrls(
    items.flatMap((reclamation) => reclamation.photos.map((photo) => photo.url)),
  );

  return (
    <>
      <PageHeader
        title="Reklamacije"
        description="Ručni unos, dnevnik i operativna obrada reklamacija"
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          { label: "Dnevnik reklamacija" },
        ]}
        actions={<div className="flex flex-wrap gap-2"><Link href="/admin/erp/preuzimanja/povrati" className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted">Povrati za prijem</Link><Link href="/admin/erp/reklamacije-izvestaji" className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted">Reklamacije – izveštaji</Link><a href="/api/admin/erp/reklamacije-dnevnik/export" download className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted">Preuzmi XLSX</a></div>}
      />
      <div className="space-y-10 px-8 py-6">
        <details className="group rounded-xl border border-border bg-surface">
          <summary className="cursor-pointer list-none px-5 py-4 font-semibold text-ink-900 marker:hidden">
            + Ručno evidentiraj reklamaciju
            <span className="ml-2 text-sm font-normal text-ink-500">Forma je sakrivena dok je ne otvorite.</span>
          </summary>
        <Card className="rounded-t-none border-x-0 border-b-0">
          <CardTitle description="Za telefonsku, prodajnu ili drugu prijavu koju operater evidentira u ime kupca. Možete izabrati porudžbinu bez obzira na njen status, uključujući ponovne prijave već reklamiranih artikala.">
            Ručni unos reklamacije
          </CardTitle>
          <AdminActionForm
            action={createManualReclamation}
            refreshOnSuccess
            className="mt-4 grid gap-4 lg:grid-cols-2"
            testId="manual-reclamation-form"
          >
            <ReclamationOrderFields />
            <Field label="Tip reklamacije">
              <select
                name="type"
                defaultValue=""
                className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
              >
                <option value="">Nije uneto</option>
                {Object.values(ReclamationType).map((type) => (
                  <option key={type} value={type}>
                    {TYPE_LABELS[type] ?? type}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Zahtev kupca">
              <select
                name="request"
                defaultValue=""
                className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
              >
                <option value="">Nije uneto</option>
                {Object.values(ReclamationRequest).map((request) => (
                  <option key={request} value={request}>
                    {REQUEST_LABELS[request]}
                  </option>
                ))}
              </select>
            </Field>
            <div className="lg:col-span-2">
              <Field label="Opis prijave">
                <Textarea
                  name="description"
                  minLength={5}
                  maxLength={250}
                  rows={3}
                  required
                  placeholder="Unesite opis problema tačno kako ga je kupac prijavio."
                />
              </Field>
            </div>
            <div className="lg:col-span-2">
              <Field label="Fotografije" hint="Do 5 JPG, PNG ili WebP fotografija, najviše 2 MB po fajlu.">
                <input
                  name="photos"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                  multiple
                  className="block w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm"
                />
              </Field>
            </div>
            <div className="flex justify-end lg:col-span-2">
              <SubmitButton pendingLabel="Evidentiram…">
                Evidentiraj reklamaciju
              </SubmitButton>
            </div>
          </AdminActionForm>
        </Card>
        </details>
        {erpModule ? (
          <section aria-labelledby="reclamation-grid" className="space-y-3">
            <div>
              <h2 id="reclamation-grid" className="font-display text-2xl text-ink-900">
                Dnevnik za filtere i izvoz
              </h2>
              <p className="text-sm text-ink-500">
                Zajednički ERP grid sa sačuvanim pogledima, izborom kolona i XLSX izvozom.
              </p>
            </div>
            <ErpGrid module={erpModule} />
          </section>
        ) : null}
        <section aria-labelledby="reclamation-operations" className="space-y-4">
          <SectionHeading
            id="reclamation-operations"
            eyebrow="Operativa"
            title="Obrada reklamacija"
            description={`${formatInteger(items.length)} prikazanih reklamacija · klik na fotografiju otvara puni format`}
          />
          <nav aria-label="Filter statusa reklamacije" className="flex flex-wrap gap-2 text-xs">
            <FilterLink href="/admin/erp/reklamacije-dnevnik" label="Sve" active={!status} />
            {Object.values(ReclamationStatus).map((reclamationStatus) => (
              <FilterLink
                key={reclamationStatus}
                href={`/admin/erp/reklamacije-dnevnik?status=${reclamationStatus}`}
                label={STATUS_LABELS[reclamationStatus]}
                active={status === reclamationStatus}
              />
            ))}
          </nav>

          <div className="space-y-4">
            {items.length === 0 ? (
              <Card>
                <p className="text-sm text-ink-500">Nema reklamacija.</p>
              </Card>
            ) : (
              items.map((reclamation) => (
                <Card key={reclamation.id}>
                  <span id={`reclamation-${reclamation.id}`} className="scroll-mt-24" />
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-sm">{reclamation.number}</p>
                      <p className="text-xs text-ink-500">
                        Narudžbina{" "}
                        <Link
                          href={`/admin/erp/prodajni-nalozi/${reclamation.orderId}`}
                          className="text-walnut hover:underline"
                        >
                          {reclamation.order.number}
                        </Link>{" "}
                        · {reclamation.orderItem?.name ?? reclamation.product?.name ?? "Nepoznat artikal"}
                        {" · "}SKU {reclamation.sku} · količina {reclamation.quantity}
                        {" · "}{reclamation.customerFirst}{" "}
                        {reclamation.customerLast}
                      </p>
                      <p className="mt-1 text-xs text-ink-500">
                        Kupac prati status kroz portal „Moj nalog → Reklamacije”.
                      </p>
                    </div>
                    <span className="rounded-full bg-muted-bg px-2 py-0.5 text-[11px]">
                      {STATUS_LABELS[reclamation.status]}
                    </span>
                  </div>
                  <div className="mt-3">
                    <Link
                      href={`/admin/erp/reklamacije-dnevnik/${reclamation.id}`}
                      className="inline-flex h-9 items-center rounded-lg bg-ink-900 px-3 text-sm font-medium text-white hover:bg-walnut"
                    >
                      Otvori detalj i obradu
                    </Link>
                  </div>
                  <p className="mt-3 max-w-2xl text-sm text-ink-700">
                    {reclamation.description}
                  </p>
                  {reclamation.photos.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {reclamation.photos.map((photo) => (
                        <a
                          key={photo.id}
                          href={signedPhotoUrls.get(photo.url) ?? photo.url}
                          target="_blank"
                          rel="noreferrer"
                          className="relative block size-20 overflow-hidden rounded-md border border-border/60"
                        >
                          <Image
                            src={signedPhotoUrls.get(photo.url) ?? photo.url}
                            alt=""
                            fill
                            sizes="80px"
                            className="object-cover"
                          />
                        </a>
                      ))}
                    </div>
                  ) : null}

                </Card>
              ))
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function SectionHeading({
  id,
  eyebrow,
  title,
  description,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-walnut">
        {eyebrow}
      </p>
      <h2 id={id} className="mt-1 font-display text-2xl text-ink-900">
        {title}
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-ink-500">{description}</p>
    </div>
  );
}

function FilterLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-full px-3 py-1 ${
        active
          ? "bg-walnut text-white"
          : "bg-muted-bg text-ink-700 hover:bg-muted-bg/70"
      }`}
    >
      {label}
    </Link>
  );
}

function formatInteger(value: number) {
  return value.toLocaleString("sr-Latn-RS");
}
