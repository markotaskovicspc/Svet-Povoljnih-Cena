import Link from "next/link";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { processBackgroundJob } from "@/lib/background-jobs";
import { z } from "zod";
import { requireAdminAction, withAdminState, type AdminActionState } from "@/lib/admin";
import { receiveReclamationReturn } from "@/lib/admin/reclamation-fulfillment.server";
import {
  listReturnedOrders,
  receiveReturnedOrderUnit,
} from "@/lib/admin/returned-orders.server";
import { db } from "@/lib/db";
import { receiveReshipmentReturn } from "@/lib/admin/order-reshipment.server";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle, StatCard } from "@/components/admin/card";
import { AdminActionForm } from "@/components/admin/action-form";
import { Field } from "@/components/admin/field";
import { SubmitButton } from "@/components/admin/submit-button";

export const dynamic = "force-dynamic";
export const maxDuration = 180;
export const metadata = {
  title: "Povrati za prijem · Picking",
  robots: { index: false, follow: false },
};

const receiveSchema = z.object({
  reclamationId: z.string().min(1),
  warehouseId: z.string().min(1),
});
const receiveOrderUnitSchema = z.object({
  orderId: z.string().min(1),
  orderItemId: z.string().min(1),
  unitNo: z.coerce.number().int().positive(),
  buyerId: z.string().trim().max(100).optional(),
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
        return { ok: false as const, error: "Izaberite povrat i magacin prijema." };
      }
      const result = await receiveReclamationReturn({
        ...parsed.data,
        actorId,
      });
      revalidatePath("/admin/erp/povrati");
      revalidatePath("/admin/erp/preuzimanja/povrati");
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

async function receiveOrderUnitAction(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";
  return withAdminState(
    {
      allowed: ["OPS"],
      action: "order.return.receive",
      entity: "OrderItem",
    },
    async (actorId, actionData: FormData) => {
      const parsed = receiveOrderUnitSchema.safeParse(
        Object.fromEntries(actionData.entries()),
      );
      if (!parsed.success) {
        return { ok: false as const, error: "Izaberite vraćeni paket i magacin prijema." };
      }
      const result = await receiveReturnedOrderUnit({
        ...parsed.data,
        actorId,
      });
      after(async () => { await processBackgroundJob(result.jobId); });
      revalidatePath("/admin/erp/preuzimanja/povrati");
      revalidatePath("/admin/erp/povrati");
      revalidatePath("/admin/erp/stanje-po-magacinima");
      return {
        ok: true as const,
        entityId: parsed.data.orderItemId,
        message: `Paket je primljen u ${result.warehouse.code} · ${result.warehouse.name}. Automatska fiskalna refundacija je zakazana; osvežite pregled za rezultat.`,
      };
    },
  )(formData);
}

export default async function ReturnsPage() {
  await requireAdminAction(["OPS"]);
  const reshipments = await db.orderReshipment.findMany({ orderBy: { createdAt: "desc" }, take: 500, include: { items: true, order: { select: { number: true } }, sourceShipment: true, batch: true } });
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
      where: { active: true },
      orderBy: [{ code: "asc" }],
      select: { id: true, code: true, name: true, active: true, isDefault: true },
    }),
    db.stockMovement.findMany({
      where: {
        OR: [
          { idempotencyKey: { startsWith: "reclamation-return:" } },
          { idempotencyKey: { startsWith: "order-return:" } },
        ],
      },
      select: { id: true, idempotencyKey: true, warehouseId: true, createdAt: true, warehouse: { select: { code: true, name: true } } },
    }),
  ]);
  const jobs = movements.length ? await db.backgroundJob.findMany({
    where: { idempotencyKey: { in: movements.filter(row => row.idempotencyKey?.startsWith("order-return:")).map(row => `return-fiscal:${row.id}`) } },
    select: { idempotencyKey: true, status: true, lastError: true },
  }) : [];
  const jobByReceipt = new Map(jobs.map(job => [job.idempotencyKey, job]));
  const paymentJobs = returnedOrders.orders.length ? await db.backgroundJob.findMany({
    where: { kind: "PAYMENT_REFUND", status: { not: "COMPLETED" }, OR: returnedOrders.orders.map(order => ({ payload: { path: ["orderId"], equals: order.id } })) },
    select: { payload: true, lastError: true },
  }) : [];
  const warehouses = warehouseCandidates;
  const receiptByReclamation = new Map(
    movements
      .filter((movement) => movement.idempotencyKey?.startsWith("reclamation-return:"))
      .map((movement) => [
        movement.idempotencyKey?.slice("reclamation-return:".length),
        movement,
      ]),
  );
  const orderReceiptByKey = new Map(
    movements
      .filter((movement) => movement.idempotencyKey?.startsWith("order-return:"))
      .map((movement) => [movement.idempotencyKey, movement]),
  );
  const readyForReceipt = reclamations.filter((reclamation) =>
    ["DELIVERED", "RETURNED"].includes(reclamation.shipments[0]?.status ?? ""),
  );
  const posted = reclamations.filter((reclamation) => receiptByReclamation.has(reclamation.id));

  return (
    <>
      <PageHeader
        title="Povrati za prijem"
        description="Poseban picking tok za pregled vraćenih paketa, izbor magacina i bezbedno knjiženje robe na stanje."
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          { href: "/admin/erp/preuzimanja", label: "Picking i preuzimanja" },
          { label: "Povrati za prijem" },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/erp/preuzimanja"
              className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
            >
              Odlazni picking
            </Link>
            <Link
              href="/admin/erp/reklamacije-dnevnik"
              className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
            >
              Reklamacije
            </Link>
          </div>
        }
      />
      <main className="space-y-6 px-4 py-6 md:px-8">
        <Card>
          <CardTitle description="Kupcu se šalje nova roba. Stara pošiljka ostaje ovde do fizičkog prijema i pregleda. Prijem vraća samo robu na lager, bez refundacije kupcu.">Povrati prethodnih pošiljki nakon ponovnog slanja</CardTitle>
          <div className="space-y-4">
            {reshipments.length === 0 ? <p className="text-sm text-ink-500">Nema očekivanih povrata po ponovnom slanju.</p> : null}
            {reshipments.map(retry => <div key={retry.id} className="space-y-3 rounded-lg border border-border p-4">
              <p><Link className="font-medium underline" href={`/admin/erp/prodajni-nalozi/${retry.orderId}`}>{retry.order.number}</Link> · Stara pošiljka: {retry.sourceShipment.provider} / {retry.sourceShipment.trackingNo ?? retry.sourceShipmentId} · {retry.sourceShipment.status}</p>
              <p className="text-sm">Razlog: {retry.reason} · Nova roba: <Link className="underline" href={`/admin/erp/preuzimanja/${retry.batchId}`}>{retry.batch.number}</Link></p>
              {retry.items.map(item => <div key={item.id} className="rounded-lg bg-muted p-3 text-sm">
                <p>{item.sku} · {item.name} · Primljeno {item.receivedQty}/{item.quantity} kom</p>
                {item.receivedQty < item.quantity ? <AdminActionForm action={receiveReshipmentReturnAction} refreshOnSuccess className="mt-2 flex flex-wrap items-end gap-3">
                  <input type="hidden" name="itemId" value={item.id} />
                  <input type="hidden" name="unitNo" value={item.receivedQty + 1} />
                  <Field label="Magacin prijema"><select name="warehouseId" required className="h-9 rounded-lg border border-input px-2"><option value="">Izaberite magacin</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></Field>
                  <SubmitButton size="sm" confirm="Potvrđujete da je 1 komad stare robe fizički primljen, pregledan i spreman za lager? Novac kupcu neće biti refundiran.">Primi 1 kom na lager</SubmitButton>
                </AdminActionForm> : <p className="text-success">Povrat primljen.</p>}
              </div>)}
            </div>)}
          </div>
        </Card>
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
                          <div className="mt-2 space-y-2">
                            {Array.from({ length: item.qty }, (_, index) => {
                              const unitNo = index + 1;
                              const receipt = orderReceiptByKey.get(
                                `order-return:${order.number}:${item.id}:${unitNo}`,
                              );
                              const job = receipt ? jobByReceipt.get(`return-fiscal:${receipt.id}`) : null;
                              const receivedQty = [...orderReceiptByKey.keys()].filter(key => key?.startsWith(`order-return:${order.number}:${item.id}:`)).length;
                              const fiscalDone = receivedQty > 0 && (item.fiscalLines ?? []).reduce((sum, line) => sum + line.refundedQty, 0) >= receivedQty;
                              return receipt ? (
                                <div key={unitNo} className="space-y-2 rounded-lg border border-border p-2">
                                  <p className="text-xs text-success">Paket {unitNo}/{item.qty} primljen {formatDate(receipt.createdAt)} · {receipt.warehouse.code}</p>
                                  <p className="text-xs">{(job?.status === "COMPLETED" || fiscalDone)
                                    ? "Fiskalna refundacija obrađena."
                                    : job?.lastError || "Fiskalna refundacija čeka obradu."}</p>
                                  {(order.paymentRefunds ?? []).filter(refund => refund.status !== "COMPLETED").map((refund, index) => (
                                    <p key={index} className="text-xs text-warning">{refund.error || "Povraćaj novca čeka obradu."}</p>
                                  ))}
                                  {paymentJobs.filter(job => job.payload && typeof job.payload === "object" && !Array.isArray(job.payload) && job.payload.orderId === order.id).map((job, index) => (
                                    <p key={`payment-${index}`} className="text-xs text-warning">{job.lastError || "Povraćaj novca čeka proveru/obradu."}</p>
                                  ))}
                                  {job?.status !== "COMPLETED" && !fiscalDone && (
                                    <AdminActionForm action={receiveOrderUnitAction} className="flex flex-wrap items-end gap-2">
                                      <input type="hidden" name="orderId" value={order.id} />
                                      <input type="hidden" name="orderItemId" value={item.id} />
                                      <input type="hidden" name="unitNo" value={unitNo} />
                                      <input type="hidden" name="warehouseId" value={receipt.warehouseId} />
                                      <Field label="Identifikacija kupca (ako nedostaje)">
                                        <input name="buyerId" maxLength={100} placeholder="10:PIB ili drugi važeći ID" className="h-8 rounded-lg border border-input px-2 text-sm" />
                                      </Field>
                                      <SubmitButton size="sm">Dopuni / ponovi refundaciju</SubmitButton>
                                    </AdminActionForm>
                                  )}
                                </div>
                              ) : item.productId ? (
                                <AdminActionForm key={unitNo} action={receiveOrderUnitAction} className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-2">
                                  <input type="hidden" name="orderId" value={order.id} />
                                  <input type="hidden" name="orderItemId" value={item.id} />
                                  <input type="hidden" name="unitNo" value={unitNo} />
                                  <Field label={`Paket ${unitNo}/${item.qty}`}>
                                    <select name="warehouseId" required className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm" defaultValue={warehouses[0]?.id ?? ""}>
                                      <option value="" disabled>Magacin prijema</option>
                                      {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}
                                    </select>
                                  </Field>
                                  <Field label="Identifikacija kupca (ako nije na računu)">
                                    <input name="buyerId" maxLength={100} placeholder="10:PIB ili drugi važeći ID" className="h-8 rounded-lg border border-input px-2 text-sm" />
                                  </Field>
                                  <SubmitButton size="sm" disabled={!warehouses.length} confirm={`Potvrditi da je paket ${unitNo}/${item.qty} pregledan, vratiti jedan komad na stanje i pokrenuti fiskalnu refundaciju?`}>
                                    Primi paket
                                  </SubmitButton>
                                </AdminActionForm>
                              ) : (
                                <p key={unitNo} className="text-xs text-warning">Paket nema vezan artikal lagera.</p>
                              );
                            })}
                          </div>
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
              Nema aktivnog magacina u koji pregledana vraćena roba može da se primi.
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
                            <Field label="Magacin prijema">
                              <select name="warehouseId" required className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm" defaultValue={warehouses[0]?.id ?? ""}>
                                <option value="" disabled>Izaberite</option>
                                {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}
                              </select>
                            </Field>
                            <SubmitButton size="sm" confirm={`Magacioner je pregledao paket. Primiti ${reclamation.quantity} kom i proknjižiti u izabrani magacin?`}>
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

async function receiveReshipmentReturnAction(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState({ allowed: ["OPS"], action: "order.reshipment.return.receive", entity: "OrderReshipmentItem" }, async (actorId, data: FormData) => {
    const itemId = String(data.get("itemId") ?? "");
    const warehouseId = String(data.get("warehouseId") ?? "");
    const unitNo = Number(data.get("unitNo"));
    await receiveReshipmentReturn({ itemId, warehouseId, unitNo, actorId });
    revalidatePath("/admin/erp/povrati");
    revalidatePath("/admin/erp/preuzimanja/povrati");
    revalidatePath("/admin/erp/stanje-po-magacinima");
    return { ok: true as const, entityId: itemId, diff: { warehouseId, unitNo }, message: "Stara roba je primljena na lager. Refundacija nije pokrenuta." };
  })(formData);
}

function formatDate(value: Date) {
  return value.toLocaleString("sr-Latn-RS", {
    timeZone: "Europe/Belgrade",
    dateStyle: "short",
    timeStyle: "short",
  });
}
