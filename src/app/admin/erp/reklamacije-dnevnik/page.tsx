import { ReclamationActionDialogs } from "@/components/admin/reclamation-action-dialogs";
import Link from "next/link";
import {
  ReclamationRequest,
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
  uploadAdminReclamationPhoto,
} from "@/lib/api/uploads";
import { logOperationalError } from "@/lib/monitoring";
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

const TYPE_LABELS: Record<string, string> = {
  FIZICKO_OSTECENJE: "Fizičko oštećenje",
  KVAR: "Kvar",
  POGRESNO_ISPORUCENO: "Pogrešno isporučeno",
  NIJE_ISPORUCENO: "Nije isporučeno",
  ODUSTANAK: "Odustanak",
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
    { module: "/admin/erp/reklamacije-dnevnik",
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

export default async function ReclamationsPage() {
  await requireAdminAction(["OPS"], "/admin/erp/reklamacije-dnevnik");
  const erpModule = await getErpModule("reklamacije-dnevnik");

  const manualForm = (
    <AdminActionForm
      action={createManualReclamation}
      refreshOnSuccess
      className="grid gap-4 lg:grid-cols-2"
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
  );

  return (
    <>
      <PageHeader
        title="Reklamacije"
        compact
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          { label: "Dnevnik reklamacija" },
        ]}
        actions={<div className="flex flex-wrap items-center gap-2"><ReclamationActionDialogs manualForm={manualForm} /><span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-border sm:block" /><Link href="/admin/erp/preuzimanja/povrati" className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted">Povrati za prijem</Link><Link href="/admin/erp/reklamacije-izvestaji" className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted">Reklamacije – izveštaji</Link><a href="/api/admin/erp/reklamacije-dnevnik/export" download className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted">Preuzmi XLSX</a></div>}
      />
      <div className="px-2 pt-2">
        {erpModule ? <ErpGrid module={erpModule} compactToolbar /> : null}
      </div>
    </>
  );
}

