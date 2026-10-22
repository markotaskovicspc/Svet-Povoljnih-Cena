import { AnanasReturns } from "@/components/admin/ananas-returns";
import { ReturnReviewRequiredError } from "@/lib/admin/return-review-error";
import { SHIPMENT_STATUS_LABEL } from "@/lib/courier/status";
import { ReturnEvidenceDisclosure } from "@/components/admin/return-evidence-disclosure";
import { ScannedReturnPanel } from "@/components/admin/reclamation-return-notice";
import { ReturnScanner } from "@/components/admin/return-scanner";
import { scannedReturnPlan, receiveScannedReturn } from "@/lib/admin/scanned-return.server";
import { returnUnitParcelNumbers, returnItemParcelNumbers, returnParcelNumbers, returnParcelArrived, displayReturnParcelNumber, normalizeReturnParcelNumber, type ReturnShipment } from "@/lib/admin/return-parcels";
import {
  canReceiveReclamationShipment,
  myGlsReturnStatusLabel,
  scannedReturnStatusLabel,
} from "@/lib/mygls/return-booking";
import Link from "next/link";
import type { ReactNode } from "react";
import { markReturnLost } from "@/lib/admin/return-resolution.server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect, RedirectType } from "next/navigation";
import { enqueueBackgroundJob, processBackgroundJob } from "@/lib/background-jobs";
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
      allowed: ["OPS", "WAREHOUSE"],
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
      const jobIds = [result.refundJobId, result.refundNoticeJobId].filter((id): id is string => Boolean(id));
      if (jobIds.length) {
        try {
          after(async () => { for (const id of jobIds) { try { await processBackgroundJob(id); } catch { /* Durable retry; continue with the support notice. */ } } });
        } catch {
          // The durable queue/cron still sends the notice if scheduling is unavailable.
        }
      }
      revalidatePath("/admin/erp/povrati");
      revalidatePath("/admin/magacin/povrat");
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
      allowed: ["OPS", "WAREHOUSE"],
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
      revalidatePath("/admin/magacin/povrat");
      revalidatePath("/admin/erp/stanje-po-magacinima");
      return {
        ok: true as const,
        entityId: parsed.data.orderItemId,
        message: `Komad robe je primljen u ${result.warehouse.code} · ${result.warehouse.name}. Automatska fiskalna refundacija je zakazana; osvežite pregled za rezultat.`,
      };
    },
  )(formData);
}

export async function ReturnsWorkspace({
  searchParams, warehouseMode = false,
}: { searchParams?: Promise<{ view?: string; q?: string; evidence?: string; camera?: string; warehouse?: string; received?: string }>; warehouseMode?: boolean } = {}) {
  await requireAdminAction(warehouseMode ? ["OPS", "WAREHOUSE"] : ["OPS"]);
  const returnHref = warehouseMode ? "/admin/magacin/povrat" : "/admin/erp/povrati";
  const params = await searchParams;
  const view = params?.view === "completed" ? "completed" : params?.view === "verification" ? "verification" : "active";
  const query = normalizeReturnParcelNumber(params?.q ?? "");
  const loadEvidence = params?.evidence === "1" || Boolean(params?.view);
  const scanResult = (async () => {
    if (!query || !/^[A-Z0-9]{5,40}$/.test(query)) return { scanPlan: null, scanError: "" };
    try { return { scanPlan: await scannedReturnPlan(query), scanError: "" }; }
    catch (error) {
      let notice = "";
      if (error instanceof ReturnReviewRequiredError && error.shipmentId && error.parcelNumber) {
        try {
          const job = await enqueueBackgroundJob({
            kind: "RETURN_REVIEW_OFFICE_EMAIL",
            payload: { shipmentId: error.shipmentId, parcelNumber: error.parcelNumber },
            idempotencyKey: `return-review:${error.shipmentId}:${error.parcelNumber}`,
          });
          after(() => processBackgroundJob(job.id));
          notice = " Obaveštenje za office je evidentirano za slanje.";
        } catch (noticeError) {
          console.error("[return-review] scheduling failed", noticeError);
          notice = " Obaveštenje nije potvrđeno. Obavestite office ručno.";
        }
      }
      return { scanPlan: null, scanError: (error instanceof Error ? error.message : "Paket nije pronađen.") + notice };
    }
  })();
  const [
    reshipments,
    returnedOrders,
    reclamations,
    warehouses,
    movements,
    resolutions,
    { scanPlan, scanError },
    ananasReturns,
  ] = await Promise.all([
    loadEvidence ? db.orderReshipment.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
      include: {
        items: true,
        order: { select: { number: true } },
        sourceShipment: { include: { returnArrivals: true } },
        batch: true,
      },
    }) : [],
    loadEvidence ? listReturnedOrders() : { orders: [], total: 0 },
    loadEvidence ? db.reclamation.findMany({
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
    }) : [],
    db.warehouse.findMany({
      where: { active: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, isDefault: true },
    }),
    loadEvidence ? db.stockMovement.findMany({
      where: {
        OR: [
          { idempotencyKey: { startsWith: "reclamation-return:" } },
          { idempotencyKey: { startsWith: "order-return:" } },
        ],
      },
      select: {
        id: true,
        qty: true,
        idempotencyKey: true,
        warehouseId: true,
        createdAt: true,
        warehouse: { select: { code: true, name: true } },
      },
    }) : [],
    loadEvidence ? db.returnResolution.findMany() : [],
    scanResult,
    AnanasReturns({ query, warehouseMode }),
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
    <Field label="Magacin prijema" className={warehouseMode ? "w-full min-w-0" : undefined}>
      <select
        name="warehouseId"
        required
        className="h-9 w-full min-w-0 max-w-full rounded-lg border border-input bg-background px-2"
        defaultValue={warehouses.some(w => w.id === params?.warehouse) ? params?.warehouse : ""}
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
                href={warehouseMode ? `/admin/magacin/picking/${retry.batchId}` : `/admin/erp/preuzimanja/${retry.batchId}`}
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
                    value={Array.from({ length: item.quantity }, (_, i) => i + 1).find(unit => !receiptByKey.has(`reshipment-return:${item.id}:${unit}`)) ?? item.receivedQty + 1}
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
              <ReturnItemCodes item={item} shipments={order.shipments} />
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
                    {!warehouseMode && job?.status !== "COMPLETED" && !fiscalDone ? (
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
                    <ReturnItemCodes item={item} shipments={order.shipments} unitNo={unitNo} />
                    {warehouseSelect}
                    {!warehouseMode && <Field label="Identifikacija kupca (ako nije na računu)">
                      <input
                        name="buyerId"
                        maxLength={100}
                        placeholder="10:PIB ili drugi važeći ID"
                        className="h-9 rounded-lg border border-input px-2"
                      />
                    </Field>}
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
    const partialReceipts = movements.filter(m => m.idempotencyKey?.startsWith(`reclamation-return:${reclamation.id}:parcel:`));
    const partialQty = partialReceipts.reduce((sum, m) => sum + (m.qty ?? 0), 0);
    const received = Boolean(receipt) || partialQty >= reclamation.quantity;
    rows.push({
      key,
      kind: "reclamation",
      arrived: received || Boolean(shipment?.returnArrivals?.length) || canReceiveReclamationShipment(shipment),
      codes: shipment ? returnParcelNumbers(shipment) : [],
      id: reclamation.id,
      orderId: reclamation.orderId,
      number: reclamation.order.number,
      type: "Reklamacioni povrat",
      received,
      date: reclamation.createdAt?.getTime() ?? 0,
      shipment: shipment ? <><ReturnShipmentCodes shipment={shipment} received={received} /><p>{myGlsReturnStatusLabel(shipment)}</p></> : <>Bez povratne pošiljke</>,
      details: (
        <>
          {warehouseMode ? <p>{reclamation.number}</p> : <Link className="text-sm underline" href={`/admin/erp/reklamacije-dnevnik/${reclamation.id}`}>{reclamation.number}</Link>}
          <p className="text-sm">
            {reclamation.sku} · {reclamation.orderItem?.name ?? "—"} ·{" "}
            {reclamation.quantity} kom · Primljeno {receipt ? reclamation.quantity : partialQty}/{reclamation.quantity}
          </p>
          {received ? (
            <p className="text-sm text-success">
              Proknjiženo {formatDate((receipt ?? partialReceipts.at(-1)!).createdAt)} ·{" "}
              {(receipt ?? partialReceipts.at(-1)!).warehouse.code} · {(receipt ?? partialReceipts.at(-1)!).warehouse.name}
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
  const filterQuery = scanPlan?.code ?? query;
  const visible = rows
    .filter((row) => query || (view === "completed" ? completed(row) : !completed(row) && row.arrived === (view === "active")))
    .filter((row) => !query || normalizeReturnParcelNumber(row.number).includes(query) || row.codes.some((code) => code.includes(filterQuery)))
    .sort((a, b) => b.date - a.date || a.key.localeCompare(b.key));
  return (
    <>
      {!warehouseMode && <PageHeader
        title="Povrati za prijem"
        description="Skenirajte paket, proverite sadržaj, izaberite magacin i potvrdite prijem."
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
      />}
      <main className={`min-w-0 space-y-6 px-4 py-6 md:px-8 ${warehouseMode && scanPlan && !scanPlan.received ? "pb-44 md:pb-6" : ""}`}>
        {warehouseMode && <div><h1 className="text-xl font-semibold">Prijem povrata</h1><p className="mt-1 text-sm text-ink-500">Skenirajte paket, pregledajte robu i potvrdite prijem.</p></div>}
        {warehouseMode && params?.received === "1" && <p role="status" className="rounded-lg border border-success/40 bg-success/10 p-3 text-success">Paket je primljen. Spremno za sledeći paket.</p>}
        <Card>
          <CardTitle>Prijem povratnog paketa</CardTitle>
          <ReturnScanner basePath={returnHref} key={`${params?.q ?? ""}:${params?.camera ?? ""}`} initialCode={params?.q ?? ""} initialCamera={params?.camera === "1"} awaitingReceipt={Boolean(scanPlan && !scanPlan.received)} warehouseId={params?.warehouse ?? ""}>
          {scanError ? <p role="alert" className="mt-4 text-warning">{scanError}</p> : null}
          {scanPlan ? <ScannedReturnPanel reclamationNumber={scanPlan.kind === "reclamation" ? scanPlan.shipment.reclamation?.number ?? "Povezana reklamacija" : null}>
            {warehouseMode ? <div className="space-y-4 break-words">
              <div><p className="font-mono font-semibold">{scanPlan.shipment.reclamation?.number ?? scanPlan.shipment.order.number}</p><p className="text-sm text-ink-500">Paket {returnParcelNumbers(scanPlan.shipment).indexOf(scanPlan.code) + 1}/{scanPlan.shipment.packageCount} · {scanPlan.shipment.provider}</p><p className="break-all font-mono text-sm">{displayReturnParcelNumber(scanPlan.code, scanPlan.shipment.provider)}</p><p className="text-sm">{scannedReturnStatusLabel(scanPlan.shipment, scanPlan.code)}</p></div>
              <ul className="space-y-3">{scanPlan.lines.map(line => <li key={line.id} className="rounded-lg bg-muted p-3"><p className="font-mono font-semibold">{line.sku}</p><p>{line.name}</p>{line.description && <p className="text-sm text-ink-500">{line.description}</p>}<p className="mt-2 font-semibold">U ovom paketu: {line.units.length} kom</p></li>)}</ul>
            </div> : (            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="bg-muted-bg/70 text-left text-xs uppercase tracking-[0.08em] text-ink-500">
                  <tr>
                    <th className="px-3 py-3">Izvor</th>
                    <th className="px-3 py-3">Artikli u povratu</th>
                    <th className="px-3 py-3 text-right">Paketa</th>
                    <th className="px-3 py-3">Skenirani paket i status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  <tr className="align-top">
                    <td className="px-3 py-3">
                      <Link href={scanPlan.shipment.reclamation ? `/admin/erp/reklamacije-dnevnik/${scanPlan.shipment.reclamation.id}` : `/admin/erp/prodajni-nalozi/${scanPlan.shipment.orderId}`} className="font-medium text-walnut hover:underline">
                        {scanPlan.shipment.reclamation?.number ?? scanPlan.shipment.order.number}
                      </Link>
                      <p className="mt-1 text-xs text-ink-500">{scanPlan.shipment.order.number} · {scanPlan.kind === "reclamation" ? "Reklamacioni povrat" : scanPlan.kind === "reshipment" ? "Povrat stare pošiljke" : "Povrat porudžbine"}</p>
                    </td>
                    <td className="px-3 py-3">
                      <ul className="space-y-2">
                        {scanPlan.lines.map(line => <li key={line.id}>
                          <span className="font-mono font-semibold">{line.sku}</span>{" "}
                          <span>{line.name}</span>{" "}
                          <strong className="whitespace-nowrap">× {line.totalQuantity}</strong>
                          <p className="text-xs text-ink-500">{line.description || "Bez dodatnih podataka"}</p>
                          <p className="mt-1 font-medium">U skeniranom paketu: {line.units.length} kom</p>
                        </li>)}
                      </ul>
                    </td>
                    <td className="px-3 py-3 text-right text-lg font-semibold tabular-nums">{scanPlan.shipment.packageCount}</td>
                    <td className="px-3 py-3">
                      <p className="font-medium">Paket {returnParcelNumbers(scanPlan.shipment).indexOf(scanPlan.code) + 1}/{scanPlan.shipment.packageCount}</p>
                      <p className="mt-1 font-mono">{displayReturnParcelNumber(scanPlan.code, scanPlan.shipment.provider)}</p>
                      <p className="mt-1 text-xs text-ink-500">{scanPlan.shipment.provider} · {scannedReturnStatusLabel(scanPlan.shipment, scanPlan.code)}</p>
                      <p className="mt-1 text-xs">{scanPlan.received ? "Primljeno" : "Čeka pregled i prijem"}</p>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            )}
            {scanPlan.received ? <p className={scanPlan.kind === "reclamation" ? "text-amber-900" : "text-success"}>Već primljeno. Ponovni sken ne uvećava lager.</p> : <AdminActionForm action={receiveScannedAction} preserveValues toastOnSuccess={warehouseMode} className={warehouseMode ? "fixed inset-x-0 bottom-0 z-30 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 border-t border-border bg-surface text-foreground p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg md:static md:flex md:flex-wrap md:border-0 md:p-0 md:shadow-none" : "flex flex-wrap items-end gap-3"}>
              <input type="hidden" name="code" value={params?.q ?? ""} />
              <input type="hidden" name="returnTo" value={returnHref} />
              {warehouseSelect}
              {!warehouseMode && scanPlan.kind === "order" ? <Field label="Identifikacija kupca (ako nije na računu)"><input name="buyerId" maxLength={100} className="h-9 rounded-lg border border-input px-2" /></Field> : null}
              <SubmitButton className="h-11" disabled={!warehouses.length}>Potvrdi prijem</SubmitButton>
              <p className="col-span-full w-full text-xs text-muted-foreground">Potvrdom prijema potvrđujete da ste pregledali sadržaj paketa. Ako je roba oštećena, izaberite magacin za proveru vraćene robe.</p>
            </AdminActionForm>}
          </ScannedReturnPanel> : null}
          </ReturnScanner>
        </Card>
        <details className="rounded-xl border border-border p-4" open={Boolean(query.includes("-"))}><summary className="min-h-11 cursor-pointer py-2 font-semibold">Ananas povrati i ID-evi pošiljki</summary><div className="mt-3">{ananasReturns}</div></details>
        <ReturnEvidenceDisclosure loaded={loadEvidence} href={`${returnHref}?evidence=1${query ? `&q=${encodeURIComponent(params?.q ?? "")}` : ""}`} >
        {!warehouseMode && <div className="grid gap-4 sm:grid-cols-4">
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
        </div>}
        <Card>
          <CardTitle description="Povrati porudžbina, reklamacija i prethodnih pošiljki nakon ponovnog slanja. Završeni prikaz zadržava evidenciju i obradu refundacije.">
            Svi povrati
          </CardTitle>
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
                href={`${returnHref}?view=${value}${query ? `&q=${encodeURIComponent(query)}` : ""}`}
                aria-current={view === value ? "page" : undefined}
                className={`rounded-lg border px-4 py-2 text-sm ${view === value ? "bg-foreground text-background" : "border-border"}`}
              >
                {label} ({count})
              </Link>
            ))}
          </nav>
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
                    {warehouseMode ? <h2 className="break-words font-mono font-medium">{row.number}</h2> : <Link className="font-mono font-medium underline" href={`/admin/erp/prodajni-nalozi/${row.orderId}`}>{row.number}</Link>}
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
                  {warehouseMode ? <details className="rounded-lg border p-3"><summary className="min-h-11 cursor-pointer py-2 font-medium">Prikaži robu i prijem</summary><div className="mt-2 space-y-3">{row.details}</div></details> : row.details}
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
        </ReturnEvidenceDisclosure>
      </main>
    </>
  );
}

async function markLostAction(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    { allowed: ["OPS", "WAREHOUSE"], action: "return.lost", entity: "ReturnResolution" },
    async (actorId, data: FormData) => {
      const result = await markReturnLost({
        kind: String(data.get("kind") ?? ""),
        id: String(data.get("id") ?? ""),
        reason: String(data.get("reason") ?? ""),
        actorId,
      });
      revalidatePath("/admin/erp/povrati");
      revalidatePath("/admin/magacin/povrat");
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
      allowed: ["OPS", "WAREHOUSE"],
      action: "order.reshipment.return.receive",
      entity: "OrderReshipmentItem",
    },
    async (actorId, data: FormData) => {
      const itemId = String(data.get("itemId") ?? "");
      const warehouseId = String(data.get("warehouseId") ?? "");
      const unitNo = Number(data.get("unitNo"));
      await receiveReshipmentReturn({ itemId, warehouseId, unitNo, actorId });
      revalidatePath("/admin/erp/povrati");
      revalidatePath("/admin/magacin/povrat");
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

async function receiveScannedAction(_state: AdminActionState, formData: FormData) {
  "use server";
  const state = await withAdminState(
    { allowed: ["OPS", "WAREHOUSE"], action: "return.parcel.receive", entity: "Shipment" },
    async (actorId, data: FormData) => {
      const result = await receiveScannedReturn({ code: String(data.get("code") ?? ""), warehouseId: String(data.get("warehouseId") ?? ""), buyerId: String(data.get("buyerId") ?? "").trim() || undefined, actorId });
      after(async () => { for (const jobId of result.jobIds) { try { await processBackgroundJob(jobId); } catch { /* Durable retry; continue with the support notice. */ } } });
      revalidatePath("/admin/erp/povrati");
      revalidatePath("/admin/magacin/povrat");
      revalidatePath("/admin/erp/preuzimanja/povrati");
      revalidatePath("/admin/erp/reklamacije-dnevnik", "layout");
      revalidatePath("/admin/erp/stanje-po-magacinima");
      return { ok: true as const, entityId: result.orderId, message: result.alreadyReceived ? "Paket je već primljen." : `Paket je primljen u ${result.warehouse.code} · ${result.warehouse.name}.`, diff: { warehouseId: result.warehouse.id } };
    },
  )(formData);
  // Redirect only after receipt AND its audit have succeeded; errors stay on the parcel.
  if (state.ok) {
    const admin = await requireAdminAction(["OPS", "WAREHOUSE"]);
    const returnTo = admin.role === "WAREHOUSE" || formData.get("returnTo") === "/admin/magacin/povrat" ? "/admin/magacin/povrat" : "/admin/erp/povrati";
    redirect(`${returnTo}?camera=1&warehouse=${encodeURIComponent(String(formData.get("warehouseId") ?? ""))}${returnTo === "/admin/magacin/povrat" ? "&received=1" : ""}`, RedirectType.replace);
  }
  return state;
}

function ReturnItemCodes({ item, shipments, unitNo }: {
  item: { id: string; sku: string; qty: number };
  unitNo?: number;
  shipments: readonly ReturnShipment[];
}) {
  const match = unitNo ? returnUnitParcelNumbers(item, shipments, unitNo) : null;
  const parcels = match?.parcels ?? returnItemParcelNumbers(item, shipments);
  return <p className="w-full text-xs text-ink-500">
    {parcels.length ? <>{match?.exact ? "Paket: " : "Paketi artikla: "}{parcels.map(({ shipment, code }) =>
      `${displayReturnParcelNumber(code, shipment.provider)} (${returnParcelArrived(shipment, code) ? "dolazak potvrđen" : "dolazak nije potvrđen"})`
    ).join(" · ")}</> : "Broj paketa za artikal nije povezan — proverite sadržaj i adresnicu."}
  </p>;
}
