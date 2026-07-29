import { notFound } from "next/navigation";
import Link from "next/link";
import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdminAction, withAdminState } from "@/lib/admin";
import type { AdminActionState } from "@/lib/admin/action-state";
import { dateInputValue, optionalDateInput } from "@/lib/article-master";
import { resolveRetailPrice } from "@/lib/pricing/retail-price";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/admin/submit-button";
import { AdminActionForm } from "@/components/admin/action-form";
import { formatRsd } from "@/lib/format";
import { lockSupplierOwnedFields } from "@/lib/rabalux/ownership.server";

export const dynamic = "force-dynamic";

const entrySchema = z.object({
  priceListId: z.string().min(1),
  sku: z.string().trim().min(1).max(80),
  price: z.coerce.number().positive().max(999_999_999),
  validFrom: z.string().min(10).max(10),
  validTo: z.string().max(10).optional().nullable(),
});

async function saveEntry(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    { allowed: ["OPS"], action: "priceList.entry.upsert", entity: "PriceListEntry" },
    async (actorId, actionData: FormData) => {
      const parsed = entrySchema.safeParse(Object.fromEntries(actionData));
      if (!parsed.success) {
        return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Neispravan unos." };
      }
      const validFrom = optionalDateInput(parsed.data.validFrom);
      const validTo = optionalDateInput(parsed.data.validTo);
      if (!validFrom) return { ok: false as const, error: "Datum važenja od je obavezan." };
      if (validTo && validFrom > validTo) {
        return { ok: false as const, error: "Datum važenja od ne može biti posle datuma do." };
      }
      const [priceList, product] = await Promise.all([
        db.priceList.findUnique({ where: { id: parsed.data.priceListId } }),
        db.product.findFirst({
          where: {
            sku: { equals: parsed.data.sku, mode: "insensitive" },
            deletedAt: null,
          },
          select: { id: true, sku: true, fullPrice: true },
        }),
      ]);
      if (!priceList) return { ok: false as const, error: "Cenovnik ne postoji." };
      if (!product) return { ok: false as const, error: "Artikal sa ovom šifrom ne postoji." };

      const saved = await db.$transaction(async (tx) => {
        const entry = await tx.priceListEntry.upsert({
          where: {
            priceListId_productId_validFrom: {
              priceListId: priceList.id,
              productId: product.id,
              validFrom,
            },
          },
          create: {
            priceListId: priceList.id,
            productId: product.id,
            price: parsed.data.price,
            validFrom,
            validTo,
          },
          update: { price: parsed.data.price, validTo },
        });
        if (priceList.kind === "RETAIL") {
          const candidates = await tx.priceListEntry.findMany({
            where: {
              productId: product.id,
              priceList: { kind: "RETAIL", active: true },
            },
            include: { priceList: true },
            orderBy: { validFrom: "desc" },
          });
          const resolved = resolveRetailPrice(candidates, product.fullPrice);
          await tx.product.update({
            where: { id: product.id },
            data: { fullPrice: resolved.price },
          });
          await lockSupplierOwnedFields(tx, product.id, actorId, ["pricing"]);
        }
        return entry;
      });
      updateTag("catalog-products");
      updateTag("catalog-pricing");
      revalidatePath(`/admin/cenovnici/${priceList.id}`);
      return {
        ok: true as const,
        entityId: saved.id,
        diff: {
          priceListId: priceList.id,
          productId: product.id,
          sku: product.sku,
          price: parsed.data.price,
          validFrom,
          validTo,
        },
        message: `Cena za ${product.sku} je sačuvana.`,
      };
    },
  )(formData);
}

async function deleteEntry(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    { allowed: ["OPS"], action: "priceList.entry.delete", entity: "PriceListEntry" },
    async (actorId, actionData: FormData) => {
      const id = String(actionData.get("id") ?? "");
      const entry = await db.priceListEntry.findUnique({
        where: { id },
        select: {
          id: true,
          priceListId: true,
          productId: true,
          product: { select: { fullPrice: true } },
          priceList: { select: { kind: true } },
        },
      });
      if (!entry) return { ok: false as const, error: "Stavka više ne postoji." };
      await db.$transaction(async (tx) => {
        await tx.priceListEntry.delete({ where: { id: entry.id } });
        if (entry.priceList.kind === "RETAIL") {
          const candidates = await tx.priceListEntry.findMany({
            where: {
              productId: entry.productId,
              priceList: { kind: "RETAIL", active: true },
            },
            include: { priceList: true },
            orderBy: { validFrom: "desc" },
          });
          const resolved = resolveRetailPrice(candidates, entry.product.fullPrice);
          await tx.product.update({
            where: { id: entry.productId },
            data: { fullPrice: resolved.price },
          });
          await lockSupplierOwnedFields(tx, entry.productId, actorId, ["pricing"]);
        }
      });
      updateTag("catalog-products");
      updateTag("catalog-pricing");
      revalidatePath(`/admin/cenovnici/${entry.priceListId}`);
      return {
        ok: true as const,
        entityId: entry.id,
        diff: entry,
        message: "Stavka cenovnika je obrisana i važeća MP cena je ponovo izračunata.",
      };
    },
  )(formData);
}

export default async function PriceListDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sku?: string }>;
}) {
  await requireAdminAction(["OPS"]);
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const priceList = await db.priceList.findUnique({
    where: { id },
    include: {
      entries: {
        where: search.sku
          ? { product: { sku: { contains: search.sku, mode: "insensitive" } } }
          : undefined,
        include: { product: { select: { id: true, sku: true, name: true } } },
        orderBy: [{ validFrom: "desc" }, { product: { sku: "asc" } }],
        take: 500,
      },
    },
  });
  if (!priceList) notFound();
  return (
    <>
      <PageHeader
        title={priceList.name}
        description={`${priceList.code} · ${priceList.kind} · ${priceList.currency}`}
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp/cenovnici", label: "Cenovnici" },
          { label: priceList.code },
        ]}
      />
      <div className="grid gap-6 px-8 py-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="overflow-x-auto">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <CardTitle>Stavke ({priceList.entries.length})</CardTitle>
            <form className="flex gap-2">
              <Input name="sku" defaultValue={search.sku ?? ""} placeholder="Filtriraj po SKU" />
              <SubmitButton>Traži</SubmitButton>
            </form>
          </div>
          <table className="mt-4 w-full min-w-[760px] text-left text-sm">
            <thead className="border-b text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="py-2">SKU</th>
                <th>Naziv</th>
                <th className="text-right">Cena</th>
                <th>Važi od</th>
                <th>Važi do</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {priceList.entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="py-3 font-mono">
                    <Link href={`/admin/erp/artikli/${entry.product.id}`} className="text-walnut hover:underline">
                      {entry.product.sku}
                    </Link>
                  </td>
                  <td>{entry.product.name}</td>
                  <td className="text-right font-semibold">{formatRsd(Number(entry.price))}</td>
                  <td>{entry.validFrom.toLocaleDateString("sr-Latn-RS")}</td>
                  <td>{entry.validTo?.toLocaleDateString("sr-Latn-RS") ?? "—"}</td>
                  <td className="text-right">
                    <AdminActionForm action={deleteEntry}>
                      <input type="hidden" name="id" value={entry.id} />
                      <SubmitButton size="xs" variant="destructive">Obriši</SubmitButton>
                    </AdminActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card className="xl:sticky xl:top-6">
          <CardTitle description="Isti SKU i datum ažuriraju postojeću stavku. Aktivna RETAIL stavka odmah postaje izvor MP cene.">
            Dodaj ili izmeni cenu
          </CardTitle>
          <AdminActionForm action={saveEntry} className="mt-4 space-y-3">
            <input type="hidden" name="priceListId" value={priceList.id} />
            <Field label="SKU">
              <Input name="sku" required defaultValue={search.sku ?? ""} />
            </Field>
            <Field label="Cena">
              <Input name="price" type="number" min={0.01} step="0.01" required />
            </Field>
            <Field label="Važi od">
              <Input name="validFrom" type="date" required defaultValue={dateInputValue(new Date())} />
            </Field>
            <Field label="Važi do">
              <Input name="validTo" type="date" />
            </Field>
            <SubmitButton>Sačuvaj stavku</SubmitButton>
          </AdminActionForm>
        </Card>
      </div>
    </>
  );
}
