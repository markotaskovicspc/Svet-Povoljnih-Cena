import { SHIPMENT_STATUS_LABEL } from "@/lib/courier/status";
import { confirmReturnParcelArrival } from "@/lib/admin/return-arrival.server";
import { returnParcelNumbers, returnParcelArrived, displayReturnParcelNumber, normalizeReturnParcelNumber, type ReturnShipment } from "@/lib/admin/return-parcels";
import {
  canReceiveReclamationShipment,
  myGlsReturnStatusLabel,
} from "@/lib/mygls/return-booking";
import Link from "next/link";
import type { ReactNode } from "react";
import { markReturnLost } from "@/lib/admin/return-resolution.server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { processBackgroundJob } from "@/lib/background-jobs";
import { z } from "zod";
import {
  requireAdminAction,
  withAdminState,
  type AdminActionState,
} from "@/lib/admin";
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
      const parsed = receiveSchema.safeParse(
        Object.fromEntries(formData.entries()),
      );
      if (!parsed.success) {
        return {
          ok: false as const,
          error: "Izaberite povrat i magacin prijema.",
        };
      }
      const result = await receiveReclamationReturn({
        ...parsed.data,
        actorId,
      });
      revalidatePath("/admin/erp/povrati");
      revalidatePath("/admin/erp/preuzimanja/povrati");
      revalidatePath(
        `/admin/erp/reklamacije-dnevnik/${parsed.data.reclamationId}`,
      );
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
        return {
          ok: false as const,
          error: "Izaberite vraćeni komad i magacin prijema.",
        };
      }
      const result = await receiveReturnedOrderUnit({
        ...parsed.data,
        actorId,
      });
      after(async () => {
        await processBackgroundJob(result.jobId);
      });
      revalidatePath("/admin/erp/preuzimanja/povrati");
      revalidatePath("/admin/erp/povrati");
      revalidatePath("/admin/erp/stanje-po-magacinima");
      return {
        ok: true as const,
        entityId: parsed.data.orderItemId,
        message: `Komad robe je primljen u ${result.warehouse.code} · ${result.warehouse.name}. Automatska fiskalna refundacija je zakazana; osvežite pregled za rezultat.`,
      };
    },
  )(formData);
}

export default async function ReturnsPage({
  searchParams,
}: { searchParams?: Promise<{ view?: string; q?: string }> } = {}) {
  await requireAdminAction(["OPS"]);
  const params = await searchParams;
  const view = params?.view === "completed" ? "completed" : params?.view === "verification" ? "verification" : "active";
  const query = normalizeReturnParcelNumber(params?.q ?? "");
  const [
    reshipments,
    returnedOrders,
    reclamations,
    warehouses,
    movements,
    resolutions,
  ] = await Promise.all([
    db.orderReshipment.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
      include: {
        items: true,
        order: { select: { number: true } },
        sourceShipment: { include: { returnArrivals: true } },
        batch: true,
      },
    }),
    listReturnedOrders(),
    db.reclamation.findMany({
      where: { shipments: { some: { purpose: "RECLAMATION_RETURN" } } },
      orderBy: { createdAt: "desc" },
      take: 500,
      include: {
        order: { select: { number: true } },
        orderItem: { select: { name: true } },
        shipments: {
          where: { purpose: "RECLAMATION_RETURN" },
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { returnArrivals: true },
        },
      },
    }),
    db.warehouse.findMany({
      where: { active: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    db.stockMovement.findMany({
      where: {
        OR: [
          { idempotencyKey: { startsWith: "reclamation-return:" } },
          { idempotencyKey: { startsWith: "order-return:" } },
        ],
      },
      select: {
        id: true,
        idempotencyKey: true,
        warehouseId: true,
        createdAt: true,
        warehouse: { select: { code: true, name: true } },
      },
    }),
    db.returnResolution.findMany(),
  ]);
  const receiptByKey = new Map(movements.map((m) => [m.idempotencyKey, m]));
  const lostByKey = new Map(resolutions.map((r) => [r.key, r]));
  const jobs = movements.length
    ? await db.backgroundJob.findMany({
        where: {
          idempotencyKey: {
            in: movements
              .filter((m) => m.idempotencyKey?.startsWith("order-return:"))
              .map((m) => `return-fiscal:${m.id}`),
          },
        },
        select: { idempotencyKey: true, status: true, lastError: true },
      })
    : [];
  const jobByReceipt = new Map(jobs.map((j) => [j.idempotencyKey, j]));
  const paymentJobs = returnedOrders.orders.length
    ? await db.backgroundJob.findMany({
        where: {
          kind: "PAYMENT_REFUND",
          status: { not: "COMPLETED" },
          OR: returnedOrders.orders.map((order) => ({
            payload: { path: ["orderId"], equals: order.id },
          })),
        },
        select: { payload: true, lastError: true },
      })
    : [];
  const warehouseSelect = (
    <Field label="Magacin prijema">
      <select
        name="warehouseId"
        required
        className="h-9 max-w-full rounded-lg border border-input bg-background px-2"
        defaultValue=""
      >
        <option value="" disabled>
          Izaberite magacin
        </option>
        {warehouses.map((w) => (
          <option key={w.id} value={w.id}>
            {w.code} · {w.name}
          </option>
        ))}
      </select>
    </Field>
  );
  type Row = {
    key: string;
    kind: string;
    id: string;
    orderId: string;
    number: string;
    type: string;
    shipment: ReactNode;
    details: ReactNode;
    received: boolean;
    arrived: boolean;
    codes: string[];
    date: number;
  };
  const rows: Row[] = [];
  for (const retry of reshipments) {
    const key = `reshipment:${retry.id}`;
    const lost = lostByKey.has(key);
    rows.push({
      key,
      kind: "reshipment",
      arrived: Boolean(retry.sourceShipment.returnArrivals?.length) || retry.items.some((item) => item.receivedQty > 0),
      codes: returnParcelNumbers(retry.sourceShipment),
      id: retry.id,
      orderId: retry.orderId,
      number: retry.order.number,
      type: "Ponovno slanje",
      date: retry.createdAt?.getTime() ?? 0,
      received: retry.items.every((item) => item.receivedQty >= item.quantity),
      shipment: <ReturnShipmentCodes shipment={retry.sourceShipment} received={retry.items.every((item) => item.receivedQty >= item.quantity)} />,
      details: (
        <>
          <p className="text-sm text-ink-500">
            Razlog: {retry.reason} · Nova roba:{" "}
            {retry.batch ? (
              <Link
                className="underline"
                href={`/admin/erp/preuzimanja/${retry.batchId}`}
              >
                {retry.batch.number}
              </Link>
            ) : (
              "dostupna za učitavanje u picking"
            )}
          </p>
          <p className="text-xs text-ink-500">
            Prijem stare robe na lager, bez refundacije kupcu.
          </p>
          {retry.items.map((item) => (
            <div key={item.id} className="rounded-lg bg-muted p-3 text-sm">
              <p>
                {item.sku} · {item.name} · Primljeno {item.receivedQty}/
                {item.quantity} kom
              </p>
              {!lost && item.receivedQty < item.quantity ? (
                <AdminActionForm
                  action={receiveReshipmentReturnAction}
                  refreshOnSuccess
                  className="mt-2 flex flex-wrap items-end gap-3"
                >
                  <input type="hidden" name="itemId" value={item.id} />
                  <input
                    type="hidden"
                    name="unitNo"
                    value={item.receivedQty + 1}
                  />
                  {warehouseSelect}
                  <SubmitButton
                    size="sm"
                    disabled={!warehouses.length}
                    confirm="Potvrđujete da je 1 komad stare robe fizički primljen, pregledan i spreman za lager? Novac kupcu neće biti refundiran."
                  >
                    Primi 1 kom na lager
                  </SubmitButton>
                </AdminActionForm>
              ) : null}
            </div>
          ))}
        </>
      ),
    });
  }
  for (const order of returnedOrders.orders) {
    const key = `order:${order.id}`;
    const lost = lostByKey.has(key);
    const received = order.items.every((item) =>
      Array.from({ length: item.qty }, (_, index) =>
        receiptByKey.has(
          `order-return:${order.number}:${item.id}:${index + 1}`,
        ),
      ).every(Boolean),
    );
    rows.push({
      key,
      kind: "order",
      arrived: order.shipments.some((shipment) => shipment.returnArrivals?.length) || order.items.some((item) =>
        Array.from({ length: item.qty }, (_, i) => receiptByKey.has(`order-return:${order.number}:${item.id}:${i + 1}`)).some(Boolean)),
      codes: order.shipments.flatMap(returnParcelNumbers),
      id: order.id,
      orderId: order.id,
      number: order.number,
      type: "Povrat porudžbine",
      received,
      date: order.updatedAt?.getTime() ?? 0,
      shipment: order.shipments.length ? (
        order.shipments.map((shipment) => (
          <ReturnShipmentCodes key={shipment.id} shipment={shipment} received={received} />
        ))
      ) : (
        <>Povrat evidentiran na porudžbini, bez kurirske potvrde.</>
      ),
      details: (
        <>
          <p className="text-xs text-ink-500">
            Prijem pregledane robe vraća stanje i pokreće fiskalnu refundaciju.
          </p>
          {order.items.map((item) => (
            <div
              key={item.id}
              className="space-y-2 rounded-lg bg-muted p-3 text-sm"
            >
              <p>
                {item.sku} · {item.name} · {item.qty} kom
              </p>
              {Array.from({ length: item.qty }, (_, index) => {
                const unitNo = index + 1;
                const receipt = receiptByKey.get(
                  `order-return:${order.number}:${item.id}:${unitNo}`,
                );
                const job = receipt
                  ? jobByReceipt.get(`return-fiscal:${receipt.id}`)
                  : null;
                const receivedQty = Array.from({ length: item.qty }, (_, i) =>
                  receiptByKey.has(
                    `order-return:${order.number}:${item.id}:${i + 1}`,
                  ),
                ).filter(Boolean).length;
                const fiscalDone =
                  receivedQty > 0 &&
                  (item.fiscalLines ?? []).reduce(
                    (sum, line) => sum + line.refundedQty,
                    0,
                  ) >= receivedQty;
                return receipt ? (
                  <div
                    key={unitNo}
                    className="space-y-2 rounded-lg border border-border p-2"
                  >
                    <p className="text-xs text-success">
                      Komad {unitNo}/{item.qty} primljen{" "}
                      {formatDate(receipt.createdAt)} · {receipt.warehouse.code}
                    </p>
                    <p className="text-xs">
                      {job?.status === "COMPLETED" || fiscalDone
                        ? "Fiskalna refundacija obrađena."
                        : job?.lastError || "Fiskalna refundacija čeka obradu."}
                    </p>
                    {job?.status !== "COMPLETED" && !fiscalDone ? (
                      <AdminActionForm
                        action={receiveOrderUnitAction}
                        refreshOnSuccess
                        className="flex flex-wrap items-end gap-2"
                      >
                        <input type="hidden" name="orderId" value={order.id} />
                        <input
                          type="hidden"
                          name="orderItemId"
                          value={item.id}
                        />
                        <input type="hidden" name="unitNo" value={unitNo} />
                        <input
                          type="hidden"
                          name="warehouseId"
                          value={receipt.warehouseId}
                        />
                        <Field label="Identifikacija kupca (ako nedostaje)">
                          <input
                            name="buyerId"
                            maxLength={100}
                            placeholder="10:PIB ili drugi važeći ID"
                            className="h-9 rounded-lg border border-input px-2"
                          />
                        </Field>
                        <SubmitButton size="sm">
                          Dopuni / ponovi refundaciju
                        </SubmitButton>
                      </AdminActionForm>
                    ) : null}
                  </div>
                ) : lost ? (
                  <p key={unitNo} className="text-xs text-warning">
                    Komad {unitNo}/{item.qty}: izgubljen, nije primljen na
                    lager.
                  </p>
                ) : item.productId ? (
                  <AdminActionForm
                    key={unitNo}
                    action={receiveOrderUnitAction}
                    refreshOnSuccess
                    className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-2"
                  >
                    <input type="hidden" name="orderId" value={order.id} />
                    <input type="hidden" name="orderItemId" value={item.id} />
                    <input type="hidden" name="unitNo" value={unitNo} />
                    <p className="w-full text-xs">
                      Komad {unitNo}/{item.qty}
                    </p>
                    {warehouseSelect}
                    <Field label="Identifikacija kupca (ako nije na računu)">
                      <input
                        name="buyerId"
                        maxLength={100}
                        placeholder="10:PIB ili drugi važeći ID"
                        className="h-9 rounded-lg border border-input px-2"
                      />
                    </Field>
                    <SubmitButton
                      size="sm"
                      disabled={!warehouses.length}
                      confirm={`Potvrditi da je komad ${unitNo}/${item.qty} pregledan, vratiti jedan komad na stanje i pokrenuti fiskalnu refundaciju?`}
                    >
                      Primi komad
                    </SubmitButton>
                  </AdminActionForm>
                ) : (
                  <p key={unitNo} className="text-xs text-warning">
                    Komad nema vezan artikal lagera.
                  </p>
                );
              })}
            </div>
          ))}
          {(order.paymentRefunds ?? [])
            .filter((refund) => refund.status !== "COMPLETED")
            .map((refund, index) => (
              <p key={index} className="text-xs text-warning">
                {refund.error || "Povraćaj novca čeka obradu."}
              </p>
            ))}
          {paymentJobs
            .filter(
              (job) =>
                job.payload &&
                typeof job.payload === "object" &&
                !Array.isArray(job.payload) &&
                job.payload.orderId === order.id,
            )
            .map((job, index) => (
              <p key={index} className="text-xs text-warning">
                {job.lastError || "Povraćaj novca čeka proveru/obradu."}
              </p>
            ))}
        </>
      ),
    });
  }
  for (const reclamation of reclamations) {
    const key = `reclamation:${reclamation.id}`;
    const shipment = reclamation.shipments[0];
    const receipt = receiptByKey.get(`reclamation-return:${reclamation.id}`);
    rows.push({
      key,
      kind: "reclamation",
      arrived: Boolean(receipt) || Boolean(shipment?.returnArrivals?.length) || canReceiveReclamationShipment(shipment),
      codes: shipment ? returnParcelNumbers(shipment) : [],
      id: reclamation.id,
      orderId: reclamation.orderId,
      number: reclamation.order.number,
      type: "Reklamacioni povrat",
      received: Boolean(receipt),
      date: reclamation.createdAt?.getTime() ?? 0,
      shipment: shipment ? <><ReturnShipmentCodes shipment={shipment} received={Boolean(receipt)} /><p>{myGlsReturnStatusLabel(shipment)}</p></> : <>Bez povratne pošiljke</>,
      details: (
        <>
          <Link
            className="text-sm underline"
            href={`/admin/erp/reklamacije-dnevnik/${reclamation.id}`}
          >
            {reclamation.number}
          </Link>
          <p className="text-sm">
            {reclamation.sku} · {reclamation.orderItem?.name ?? "—"} ·{" "}
            {reclamation.quantity} kom
          </p>
          {receipt ? (
            <p className="text-sm text-success">
              Proknjiženo {formatDate(receipt.createdAt)} ·{" "}
              {receipt.warehouse.code} · {receipt.warehouse.name}
            </p>
          ) : lostByKey.has(key) ? null : canReceiveReclamationShipment(
              shipment,
            ) ? (
            <AdminActionForm
              action={receiveReturnAction}
              refreshOnSuccess
              className="flex flex-wrap items-end gap-2"
            >
              <input
                type="hidden"
                name="reclamationId"
                value={reclamation.id}
              />
              {warehouseSelect}
              <SubmitButton
                size="sm"
                disabled={!warehouses.length}
                confirm={`Magacioner je pregledao paket. Primiti ${reclamation.quantity} kom i proknjižiti u izabrani magacin?`}
              >
                Primi i proknjiži
              </SubmitButton>
            </AdminActionForm>
          ) : (
            <p className="text-xs text-ink-500">Čeka potvrdu kurira</p>
          )}
        </>
      ),
    });
  }
  const completed = (row: Row) => row.received || lostByKey.has(row.key);
  const activeCount = rows.filter((row) => !completed(row) && row.arrived).length;
  const verificationCount = rows.filter((row) => !completed(row) && !row.arrived).length;
  const completedCount = rows.filter(completed).length;
  const visible = rows
    .filter((row) => view === "completed" ? completed(row) : !completed(row) && row.arrived === (view === "active"))
    .filter((row) => !query || normalizeReturnParcelNumber(row.number).includes(query) || row.codes.some((code) => code.includes(query)))
    .sort((a, b) => b.date - a.date || a.key.localeCompare(b.key));
  return (
    <>
      <PageHeader
        title="Povrati za prijem"
        description="Fizički pristigli paketi su u aktivnim povratima. Kurirski povrati bez potvrde dolaska ostaju u pregledu Za proveru."
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp/preuzimanja", label: "Picking i preuzimanja" },
          { label: "Povrati za prijem" },
        ]}
        actions={
          <Link href="/admin/erp/preuzimanja" className="text-sm underline">
            Odlazni picking
          </Link>
        }
      />
      <main className="space-y-6 px-4 py-6 md:px-8">
        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard
            label="Pristigli povrati"
            value={String(activeCount)}
            tone="warning"
          />
          <StatCard label="Za proveru" value={String(verificationCount)} tone="warning" />
          <StatCard
            label="Primljeni povrati"
            value={String(rows.filter((row) => row.received).length)}
            tone="success"
          />
          <StatCard
            label="Izgubljene pošiljke"
            value={String(rows.filter((row) => lostByKey.has(row.key)).length)}
          />
        </div>
        <Card>
          <CardTitle description="Povrati porudžbina, reklamacija i prethodnih pošiljki nakon ponovnog slanja. Završeni prikaz zadržava evidenciju i obradu refundacije.">
            Svi povrati
          </CardTitle>
          <AdminActionForm action={confirmArrivalAction} refreshOnSuccess className="mb-5 flex flex-wrap items-end gap-3">
            <Field label="Kod fizički pristiglog paketa">
              <input name="code" required maxLength={40} placeholder="Skenirajte ili unesite kod sa adresnice" className="h-9 w-80 max-w-full rounded-lg border border-input px-2" />
            </Field>
            <SubmitButton size="sm" confirm="Potvrđujete da je paket fizički stigao? Ova potvrda ne knjiži lager i ne pokreće refundaciju.">Potvrdi dolazak</SubmitButton>
          </AdminActionForm>
          <p className="mb-4 text-xs text-ink-500">Brojevi ispod označavaju kurirske pakete. Prijem robe se knjiži po komadu; jedan paket može sadržati više komada.</p>
          <nav aria-label="Prikaz povrata" className="mb-5 flex flex-wrap gap-2">
            {(
              [
                ["active", "Aktivni", activeCount],
                ["verification", "Za proveru", verificationCount],
                ["completed", "Završeni", completedCount],
              ] as const
            ).map(([value, label, count]) => (
              <Link
                key={value}
                href={`/admin/erp/povrati?view=${value}${query ? `&q=${encodeURIComponent(query)}` : ""}`}
                aria-current={view === value ? "page" : undefined}
                className={`rounded-lg border px-4 py-2 text-sm ${view === value ? "bg-foreground text-background" : "border-border"}`}
              >
                {label} ({count})
              </Link>
            ))}
          </nav>
          <form className="mb-5 flex flex-wrap items-end gap-3">
            <input type="hidden" name="view" value={view} />
            <Field label="Pretraga po porudžbini ili kodu bilo kog paketa">
              <input name="q" defaultValue={params?.q ?? ""} className="h-9 w-80 max-w-full rounded-lg border border-input px-2" />
            </Field>
            <button className="rounded-lg border border-border px-3 py-2 text-sm">Pretraži</button>
            {query ? <Link href={`/admin/erp/povrati?view=${view}`} className="text-sm underline">Poništi pretragu</Link> : null}
          </form>
          {view === "verification" ? <p className="mb-4 text-sm text-warning">Dolazak ovih povrata nije potvrđen. Proverite kodove i fizičko stanje; nemojte ih zatvarati ili knjižiti samo na osnovu kurirskog statusa.</p> : null}
          {!warehouses.length && view !== "completed" ? (
            <p className="mb-4 text-sm text-warning">
              Nema aktivnog magacina za prijem povrata.
            </p>
          ) : null}
          <div className="space-y-4">
            {visible.map((row) => {
              const lost = lostByKey.get(row.key);
              return (
                <article
                  key={row.key}
                  data-return-key={row.key}
                  className="space-y-3 rounded-xl border border-border p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link
                      className="font-mono font-medium underline"
                      href={`/admin/erp/prodajni-nalozi/${row.orderId}`}
                    >
                      {row.number}
                    </Link>
                    <span className="text-xs text-ink-500">
                      {row.type} ·{" "}
                      {lost
                        ? "Izgubljena pošiljka"
                        : row.received
                          ? "Primljeno"
                          : row.arrived ? "Stiglo · čeka pregled i prijem" : "Dolazak nije potvrđen"}
                    </span>
                  </div>
                  <div className="break-words text-sm">{row.shipment}</div>
                  {row.details}
                  {lost ? (
                    <p className="text-sm text-warning">
                      Izgubljeno {formatDate(lost.createdAt)} · {lost.reason}.
                      Neprimljena roba nije vraćena na lager.
                    </p>
                  ) : !row.received ? (
                    <details className="border-t border-border pt-3">
                      <summary className="cursor-pointer text-sm text-warning">
                        Pošiljka izgubljena kod kurira
                      </summary>
                      <AdminActionForm
                        action={markLostAction}
                        refreshOnSuccess
                        className="mt-3 flex flex-wrap items-end gap-3"
                      >
                        <input type="hidden" name="kind" value={row.kind} />
                        <input type="hidden" name="id" value={row.id} />
                        <Field
                          label="Razlog / referenca prijave kuriru"
                          className="min-w-0 flex-1"
                        >
                          <input
                            name="reason"
                            required
                            minLength={5}
                            maxLength={500}
                            className="h-9 w-full rounded-lg border border-input px-2"
                          />
                        </Field>
                        <SubmitButton
                          size="sm"
                          variant="destructive"
                          confirm="Potvrditi da je neprimljena roba izgubljena kod kurira? Povrat prelazi u završene, bez povećanja lagera i bez automatske refundacije."
                        >
                          Označi kao izgubljenu
                        </SubmitButton>
                      </AdminActionForm>
                    </details>
                  ) : null}
                </article>
              );
            })}
          </div>
          {!visible.length ? (
            <p className="py-8 text-center text-sm text-ink-500">
              {query ? "Nema povrata za uneti kod u ovom pregledu. Proverite i ostale kartice." : view === "active"
                ? "Nema aktivnih povrata za prijem."
                : view === "verification" ? "Nema povrata za proveru." : "Nema završenih povrata."}
            </p>
          ) : null}
          {returnedOrders.total > returnedOrders.orders.length ? (
            <p className="mt-4 text-xs text-ink-500">
              Prikazano poslednjih {returnedOrders.orders.length} od{" "}
              {returnedOrders.total} vraćenih porudžbina.
            </p>
          ) : null}
          {reshipments.length === 500 || reclamations.length === 500 ? (
            <p className="mt-4 text-xs text-ink-500">
              Pregled obuhvata do 500 najnovijih povrata po vrsti.
            </p>
          ) : null}
        </Card>
      </main>
    </>
  );
}

async function markLostAction(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    { allowed: ["OPS"], action: "return.lost", entity: "ReturnResolution" },
    async (actorId, data: FormData) => {
      const result = await markReturnLost({
        kind: String(data.get("kind") ?? ""),
        id: String(data.get("id") ?? ""),
        reason: String(data.get("reason") ?? ""),
        actorId,
      });
      revalidatePath("/admin/erp/povrati");
      revalidatePath("/admin/erp/preuzimanja/povrati");
      revalidatePath(`/admin/erp/prodajni-nalozi/${result.orderId}`);
      return {
        ok: true as const,
        entityId: result.key,
        message:
          "Pošiljka je označena kao izgubljena i prebačena u završene povrate. Lager nije uvećan.",
      };
    },
  )(formData);
}

async function receiveReshipmentReturnAction(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";
  return withAdminState(
    {
      allowed: ["OPS"],
      action: "order.reshipment.return.receive",
      entity: "OrderReshipmentItem",
    },
    async (actorId, data: FormData) => {
      const itemId = String(data.get("itemId") ?? "");
      const warehouseId = String(data.get("warehouseId") ?? "");
      const unitNo = Number(data.get("unitNo"));
      await receiveReshipmentReturn({ itemId, warehouseId, unitNo, actorId });
      revalidatePath("/admin/erp/povrati");
      revalidatePath("/admin/erp/preuzimanja/povrati");
      revalidatePath("/admin/erp/stanje-po-magacinima");
      return {
        ok: true as const,
        entityId: itemId,
        diff: { warehouseId, unitNo },
        message:
          "Stara roba je primljena na lager. Refundacija nije pokrenuta.",
      };
    },
  )(formData);
}

function formatDate(value: Date) {
  return value.toLocaleString("sr-Latn-RS", {
    timeZone: "Europe/Belgrade",
    dateStyle: "short",
    timeStyle: "short",
  });
}

function ReturnShipmentCodes({ shipment, received = false }: { shipment: ReturnShipment & { status?: string }; received?: boolean }) {
  const codes = returnParcelNumbers(shipment);
  return <div className="space-y-1 rounded-lg border border-border p-2">
    <p>{shipment.provider ?? "Kurir"} · Broj paketa: {shipment.packageCount ?? codes.length} · Status kurira: {SHIPMENT_STATUS_LABEL[(shipment.status ?? "RETURNED") as keyof typeof SHIPMENT_STATUS_LABEL] ?? shipment.status}</p>
    {codes.map((code, index) => <p key={code} className="break-all font-mono text-xs">
      Paket {index + 1}/{shipment.packageCount ?? codes.length} · {displayReturnParcelNumber(code, shipment.provider)} · {received ? "Roba primljena" : returnParcelArrived(shipment, code) ? "Dolazak potvrđen" : "Dolazak nije potvrđen"}
    </p>)}
    {codes.length < (shipment.packageCount ?? 1) ? <p className="text-xs text-warning">Nedostaju kodovi za deo paketa — proverite adresnice.</p> : null}
  </div>;
}

async function confirmArrivalAction(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    { allowed: ["OPS"], action: "return.parcel.arrival", entity: "ReturnParcelArrival" },
    async (actorId, data: FormData) => {
      const result = await confirmReturnParcelArrival({ code: String(data.get("code") ?? ""), actorId });
      revalidatePath("/admin/erp/povrati");
      revalidatePath("/admin/erp/preuzimanja/povrati");
      return { ok: true as const, entityId: result.arrival.id, message: "Dolazak paketa je potvrđen. Lager i refundacija čekaju pregled i prijem robe.", diff: { orderId: result.orderId, parcelNumber: result.arrival.parcelNumber } };
    },
  )(formData);
}
