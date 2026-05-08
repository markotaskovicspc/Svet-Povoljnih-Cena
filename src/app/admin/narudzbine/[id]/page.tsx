import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { OrderStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { withAdmin, requireAdminAction } from "@/lib/admin";
import { num } from "@/lib/api/_helpers";
import { formatRsd } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { SubmitButton } from "@/components/admin/submit-button";
import { Textarea } from "@/components/ui/textarea";
import { DataTable } from "@/components/admin/data-table";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Narudžbina",
  robots: { index: false, follow: false },
};

const updateStatus = withAdmin(
  { allowed: ["OPS"], action: "order.statusUpdate", entity: "Order" },
  async (actorId, formData: FormData) => {
    const id = String(formData.get("id") ?? "");
    const status = String(formData.get("status") ?? "") as OrderStatus;
    const note = String(formData.get("note") ?? "").trim() || null;
    if (!id || !Object.values(OrderStatus).includes(status)) {
      return { ok: false as const, error: "Nedostaje ID ili status." };
    }
    await db.$transaction([
      db.order.update({ where: { id }, data: { status } }),
      db.orderStatusEvent.create({
        data: { orderId: id, status, note, actorId },
      }),
    ]);
    revalidatePath(`/admin/narudzbine/${id}`);
    revalidatePath("/admin/narudzbine");
    return { ok: true as const, entityId: id, diff: { status, note } };
  },
);

const markFiscalized = withAdmin(
  { allowed: ["OPS"], action: "order.markFiscalized", entity: "Order" },
  async (_a, formData: FormData) => {
    const id = String(formData.get("id") ?? "");
    const receiptNumber = String(formData.get("receiptNumber") ?? "").trim();
    if (!id || !receiptNumber) {
      return { ok: false as const, error: "Nedostaje broj fiskalnog računa." };
    }
    await db.fiscalReceipt.upsert({
      where: { orderId: id },
      create: { orderId: id, receiptNumber },
      update: { receiptNumber },
    });
    revalidatePath(`/admin/narudzbine/${id}`);
    return { ok: true as const, entityId: id, diff: { receiptNumber } };
  },
);

export default async function OrderDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminAction(["OPS"]);
  const { id } = await params;
  const order = await db.order.findUnique({
    where: { id },
    include: {
      items: true,
      events: { orderBy: { createdAt: "desc" } },
      payments: { orderBy: { createdAt: "desc" } },
      shipments: { include: { events: { orderBy: { occurredAt: "desc" } } } },
      invoices: true,
      fiscal: true,
      reclamations: { select: { id: true, number: true, status: true } },
    },
  });
  if (!order) notFound();

  return (
    <>
      <PageHeader
        title={`Narudžbina ${order.number}`}
        description={`${order.shipFirstName} ${order.shipLastName} · ${order.shipCity}`}
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/narudzbine", label: "Narudžbine" },
          { label: order.number },
        ]}
      />
      <div className="grid grid-cols-1 gap-6 px-8 py-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardTitle>Stavke</CardTitle>
            <DataTable
              columns={[
                { key: "sku", label: "SKU" },
                { key: "name", label: "Naziv" },
                { key: "qty", label: "Kol", align: "right" },
                { key: "price", label: "Cena", align: "right" },
                { key: "subtotal", label: "Ukupno", align: "right" },
              ]}
              rows={order.items.map((it) => ({
                id: it.id,
                cells: {
                  sku: <span className="font-mono text-xs">{it.sku}</span>,
                  name: it.name,
                  qty: it.qty,
                  price: formatRsd(num(it.unitPriceSale)),
                  subtotal: formatRsd(num(it.unitPriceSale) * it.qty),
                },
              }))}
              empty="Bez stavki."
            />
          </Card>

          <Card>
            <CardTitle>Adresa isporuke</CardTitle>
            <p className="text-sm text-ink-700">
              {order.shipFirstName} {order.shipLastName}
              <br />
              {order.shipStreet}
              <br />
              {order.shipPostalCode} {order.shipCity}
              <br />
              {order.shipPhone}
            </p>
          </Card>

          <Card>
            <CardTitle>Status timeline</CardTitle>
            <ul className="space-y-2 text-sm">
              {order.events.map((e) => (
                <li key={e.id} className="flex gap-3 text-ink-700">
                  <span className="font-mono text-xs text-ink-500">
                    {e.createdAt.toLocaleString("sr-Latn-RS")}
                  </span>
                  <span className="font-medium">{e.status}</span>
                  {e.note ? <span className="text-ink-500">— {e.note}</span> : null}
                </li>
              ))}
              {order.events.length === 0 ? (
                <li className="text-sm text-ink-500">Bez događaja.</li>
              ) : null}
            </ul>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardTitle>Iznos</CardTitle>
            <dl className="space-y-1 text-sm">
              <Row k="Subtotal" v={formatRsd(num(order.subtotal))} />
              <Row k="Ušteda" v={`− ${formatRsd(num(order.savings))}`} />
              <Row k="Dostava" v={formatRsd(num(order.shipping))} />
              <Row k="Montaža" v={formatRsd(num(order.assemblyTotal))} />
              {order.voucherCode ? (
                <Row
                  k={`Vaučer ${order.voucherCode}`}
                  v={`− ${formatRsd(num(order.voucherDiscount))}`}
                />
              ) : null}
              <Row k="Ukupno" v={<strong>{formatRsd(num(order.total))}</strong>} />
            </dl>
          </Card>

          <Card>
            <CardTitle>Promena statusa</CardTitle>
            <form action={updateStatus} className="space-y-3">
              <input type="hidden" name="id" value={order.id} />
              <Field label="Novi status">
                <select
                  name="status"
                  defaultValue={order.status}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  {Object.values(OrderStatus).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Napomena">
                <Textarea name="note" rows={2} />
              </Field>
              <div className="flex justify-end">
                <SubmitButton size="sm">Sačuvaj</SubmitButton>
              </div>
            </form>
          </Card>

          <Card>
            <CardTitle description={order.fiscal?.receiptNumber ?? "Nije fiskalizovano"}>
              Fiskalizacija
            </CardTitle>
            <form action={markFiscalized} className="space-y-2">
              <input type="hidden" name="id" value={order.id} />
              <Field label="Broj fiskalnog računa">
                <input
                  name="receiptNumber"
                  defaultValue={order.fiscal?.receiptNumber ?? ""}
                  required
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2 font-mono text-sm"
                />
              </Field>
              <div className="flex justify-end">
                <SubmitButton size="sm">Sačuvaj</SubmitButton>
              </div>
            </form>
          </Card>

          {order.reclamations.length > 0 ? (
            <Card>
              <CardTitle>Reklamacije</CardTitle>
              <ul className="space-y-1 text-sm">
                {order.reclamations.map((r) => (
                  <li key={r.id}>
                    <span className="font-mono text-xs">{r.number}</span> · {r.status}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between text-ink-700">
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
