import Link from "next/link";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminAction, withAdminState, type AdminActionState } from "@/lib/admin";
import { receiveReclamationReturn } from "@/lib/admin/reclamation-fulfillment.server";
import { filterReturnWarehouses } from "@/lib/admin/return-warehouse";
import { listReturnedOrders } from "@/lib/admin/returned-orders.server";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle, StatCard } from "@/components/admin/card";
import { AdminActionForm } from "@/components/admin/action-form";
import { Field } from "@/components/admin/field";
import { SubmitButton } from "@/components/admin/submit-button";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Povrati · ERP",
  robots: { index: false, follow: false },
};

const receiveSchema = z.object({
  reclamationId: z.string().min(1),
  warehouseId: z.string().min(1),
});

async function receiveReturnAction(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";
  return withAdminState(
    {
      allowed: ["OPS"],
      action: "reclamation.return.receive",
      entity: "Reclamation",
    },
    async (actorId, formData: FormData) => {
      const parsed = receiveSchema.safeParse(Object.fromEntries(formData.entries()));
      if (!parsed.success) {
        return { ok: false as const, error: "Izaberite povrat i magacin oštećene robe." };
      }
      const result = await receiveReclamationReturn({
        ...parsed.data,
        actorId,
      });
      revalidatePath("/admin/erp/povrati");
      revalidatePath(`/admin/erp/reklamacije-dnevnik/${parsed.data.reclamationId}`);
      revalidatePath("/admin/erp/stanje-po-magacinima");
      return {
        ok: true as const,
        entityId: parsed.data.reclamationId,
        message: `Povrat je primljen i proknjižen u ${result.warehouse.code} · ${result.warehouse.name}.`,
        diff: {
          warehouseId: result.warehouse.id,
          movementId: result.movement.id,
          qty: result.movement.qty,
        },
      };
    },
  )(formData);
}

export default async function ReturnsPage() {
  await requireAdminAction(["OPS"]);
  const [returnedOrders, reclamations, warehouseCandidates, movements] = await Promise.all([
    listReturnedOrders(),
    db.reclamation.findMany({
      where: { shipments: { some: { purpose: "RECLAMATION_RETURN" } } },
      orderBy: { createdAt: "desc" },
      take: 500,
      include: {
        order: { select: { number: true } },
        orderItem: { select: { name: true } },
        warehouse: { select: { code: true, name: true } },
        shipments: {
          where: { purpose: "RECLAMATION_RETURN" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    }),
    db.warehouse.findMany({
      where: { active: true, isDefault: false },
      orderBy: [{ code: "asc" }],
      select: { id: true, code: true, name: true, active: true, isDefault: true },
    }),
    db.stockMovement.findMany({
      where: { idempotencyKey: { startsWith: "reclamation-return:" } },
      select: { idempotencyKey: true, createdAt: true, warehouse: { select: { code: true, name: true } } },
    }),
  ]);
  const warehouses = filterReturnWarehouses(warehouseCandidates);
  const receiptByReclamation = new Map(
    movements.map((movement) => [
      movement.idempotencyKey?.slice("reclamation-return:".length),
      movement,
    ]),
  );
  const readyForReceipt = reclamations.filter((reclamation) =>
    ["DELIVERED", "RETURNED"].includes(reclamation.shipments[0]?.status ?? ""),
  );
  const posted = reclamations.filter((reclamation) => receiptByReclamation.has(reclamation.id));

  return (
    <>
      <PageHeader
        title="Povrati"
        description="Vraćene porudžbine i reklamacioni povrati, uz pregled kurirskih pošiljaka i prijem robe."
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          { label: "Povrati" },
        ]}
        actions={
          <Link
            href="/admin/erp/reklamacije-dnevnik"
            className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
          >
            Reklamacije
          </Link>
        }
      />
      <main className="space-y-6 px-4 py-6 md:px-8">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Vraćene porudžbine" value={String(returnedOrders.total)} />
          <StatCard label="Reklamacioni povrati" value={String(reclamations.length)} />
          <StatCard label="Reklamacije za prijem" value={String(readyForReceipt.filter((row) => !receiptByReclamation.has(row.id)).length)} tone="warning" />
          <StatCard label="Proknjižene reklamacije" value={String(posted.length)} tone="success" />
        </div>
        <Card>
          <CardTitle description="Porudžbine označene kao vraćene i redovne pošiljke koje je kurir vratio, uključujući povrate bez reklamacije. Status povrata nije potvrda prijema ili knjiženja na lager. Prikazane količine su iz porudžbine; stvarno vraćenu robu treba proveriti.">
            Povrati porudžbina
          </CardTitle>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-3 py-3">Porudžbina</th>
                  <th className="px-3 py-3">Artikli iz porudžbine / količina</th>
                  <th className="px-3 py-3">Kurir / povratna pošiljka</th>
                  <th className="px-3 py-3">Pregled</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {returnedOrders.orders.map((order) => (
                  <tr key={order.id}>
                    <td className="px-3 py-3 align-top">
                      <Link href={`/admin/erp/prodajni-nalozi/${order.id}`} className="font-mono font-medium text-walnut hover:underline">
                        {order.number}
                      </Link>
                      <p className="mt-1 text-xs text-ink-500">Evidentiran povrat</p>
                    </td>
                    <td className="space-y-2 px-3 py-3 align-top">
                      {order.items.map((item) => (
                        <div key={item.id}>
                          <span className="font-mono">{item.sku}</span> · {item.qty} kom
                          <p className="text-xs text-ink-500">{item.name}</p>
                        </div>
                      ))}
                    </td>
                    <td className="space-y-2 px-3 py-3 align-top">
                      {order.shipments.length ? order.shipments.map((shipment) => (
                        <div key={shipment.id}>
                          {shipment.provider ?? "Kurir"} · Vraćeno
                          <p className="font-mono text-xs text-ink-500">{shipment.trackingNo ?? "Bez broja za praćenje"}</p>
                          {shipment.lastStatusEventAt ? <p className="text-xs text-ink-500">{formatDate(shipment.lastStatusEventAt)}</p> : null}
                        </div>
                      )) : <span className="text-xs text-ink-500">Povrat evidentiran na porudžbini, bez kurirske potvrde.</span>}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <Link href={`/admin/erp/prodajni-nalozi/${order.id}`} className="text-walnut hover:underline">
                        Otvori porudžbinu
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!returnedOrders.total ? <p className="py-8 text-center text-sm text-ink-500">Nema evidentiranih povrata porudžbina.</p> : null}
          {returnedOrders.total > returnedOrders.orders.length ? <p className="mt-4 text-xs text-ink-500">Prikazano poslednjih {returnedOrders.orders.length} od {returnedOrders.total} vraćenih porudžbina.</p> : null}
        </Card>
        {!warehouses.length ? (
          <Card>
            <p className="text-sm text-warning">
              Nema aktivnog odvojenog magacina. U modulu „Magacini“ prvo napravite magacin
              „Oštećena/povratna roba“. Glavni DC namerno nije dozvoljen za ovaj prijem.
            </p>
          </Card>
        ) : null}
        <Card>
          <CardTitle description="Dugme za prijem je dostupno tek kada kurir označi povrat kao isporučen/vraćen. Knjiženje je idempotentno i isti povrat ne može dva puta povećati lager.">
            Reklamacioni povrati
          </CardTitle>
          <div className="overflow-x-auto">
            <table className="min-w-[1050px] w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-3 py-3">Reklamacija</th>
                  <th className="px-3 py-3">Porudžbina</th>
                  <th className="px-3 py-3">Artikal</th>
                  <th className="px-3 py-3 text-right">Kol.</th>
                  <th className="px-3 py-3">Kurir / status</th>
                  <th className="px-3 py-3">Prijem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {reclamations.map((reclamation) => {
                  const shipment = reclamation.shipments[0];
                  const receipt = receiptByReclamation.get(reclamation.id);
                  const canReceive = ["DELIVERED", "RETURNED"].includes(shipment?.status ?? "") && !receipt;
                  return (
                    <tr key={reclamation.id}>
                      <td className="px-3 py-3">
                        <Link href={`/admin/erp/reklamacije-dnevnik/${reclamation.id}`} className="font-mono font-medium text-walnut hover:underline">
                          {reclamation.number}
                        </Link>
                      </td>
                      <td className="px-3 py-3">{reclamation.order.number}</td>
                      <td className="px-3 py-3"><span className="font-mono">{reclamation.sku}</span><br /><span className="text-xs text-ink-500">{reclamation.orderItem?.name ?? "—"}</span></td>
                      <td className="px-3 py-3 text-right font-semibold">{reclamation.quantity}</td>
                      <td className="px-3 py-3">{shipment?.provider ?? "—"} · {shipment?.status ?? "—"}<br /><span className="text-xs text-ink-500">{shipment?.trackingNo ?? "bez broja za praćenje"}</span></td>
                      <td className="px-3 py-3">
                        {receipt ? (
                          <p className="text-success">Proknjiženo {formatDate(receipt.createdAt)}<br /><span className="text-xs">{receipt.warehouse.code} · {receipt.warehouse.name}</span></p>
                        ) : canReceive ? (
                          <AdminActionForm action={receiveReturnAction} className="flex items-end gap-2">
                            <input type="hidden" name="reclamationId" value={reclamation.id} />
                            <Field label="Magacin oštećene robe">
                              <select name="warehouseId" required className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm" defaultValue={warehouses[0]?.id ?? ""}>
                                <option value="" disabled>Izaberite</option>
                                {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}
                              </select>
                            </Field>
                            <SubmitButton size="sm" confirm={`Primiti ${reclamation.quantity} kom i proknjižiti u izabrani odvojeni magacin?`}>
                              Primi i proknjiži
                            </SubmitButton>
                          </AdminActionForm>
                        ) : (
                          <span className="text-xs text-ink-500">Čeka potvrdu kurira</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!reclamations.length ? <p className="py-8 text-center text-sm text-ink-500">Nema kreiranih reklamacionih povrata.</p> : null}
        </Card>
      </main>
    </>
  );
}

function formatDate(value: Date) {
  return value.toLocaleString("sr-Latn-RS", {
    timeZone: "Europe/Belgrade",
    dateStyle: "short",
    timeStyle: "short",
  });
}
