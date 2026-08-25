import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { PrintPageButton } from "@/components/admin/print-page-button";
import { AutoPrintOnLoad } from "@/components/admin/auto-print-on-load";
import { readShipmentAssignment } from "@/lib/courier/shipment-assignment";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Štampa naloga za preuzimanje · ERP",
  robots: { index: false, follow: false },
};

export default async function PickupBatchPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ section?: string; autoprint?: string }>;
}) {
  await requireAdminAction(["OPS"]);
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const section = query.section === "labels" ? "labels" : "picking";
  const printAll = query.autoprint === "1";
  const showPicking = printAll || section === "picking";
  const showLabels = printAll || section === "labels";
  const batch = await db.pickupBatch.findUnique({
    where: { id },
    include: {
      lines: {
        orderBy: [{ orderId: "asc" }, { packageNo: "asc" }],
        include: {
          order: { select: { id: true, number: true } },
          reclamation: {
            select: {
              number: true,
              warehouse: { select: { code: true, name: true } },
            },
          },
          orderItem: {
            select: {
              id: true,
              sku: true,
              name: true,
              qty: true,
              product: { select: { packQty: true } },
            },
          },
        },
      },
    },
  });
  if (!batch) notFound();

  const orderIds = Array.from(new Set(batch.lines.map((line) => line.orderId)));
  const reclamationIds = batch.lines
    .map((line) => line.reclamationId)
    .filter((id): id is string => Boolean(id));
  const shipmentRows = orderIds.length || reclamationIds.length
    ? await db.shipment.findMany({
        where: {
          provider: batch.provider,
          status: { not: "FAILED" },
          OR: [
            ...(orderIds.length
              ? [{ orderId: { in: orderIds }, purpose: "ORDER_DELIVERY" as const }]
              : []),
            ...(reclamationIds.length
              ? [{
                  reclamationId: { in: reclamationIds },
                  purpose: "RECLAMATION_REPLACEMENT" as const,
                }]
              : []),
          ],
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          orderId: true,
          reclamationId: true,
          purpose: true,
          trackingNo: true,
          provider: true,
          rawCreateResponse: true,
        },
      })
    : [];
  const shipments = batch.lines.reduce<typeof shipmentRows>((matched, line) => {
    if (matched.some((shipment) => shipment.id === shipmentForLine(shipmentRows, line)?.id)) {
      return matched;
    }
    const shipment = shipmentForLine(shipmentRows, line);
    return shipment ? [...matched, shipment] : matched;
  }, []);
  const picking = aggregatePicking(batch.lines);
  const packageLabels = batch.lines.map((line) => ({
    ...line,
    packageQty: quantityInPackage(batch.lines, line),
  }));

  return (
    <main className="mx-auto max-w-[1200px] space-y-8 bg-white p-6 text-black print:max-w-none print:p-0">
      {query.autoprint === "1" ? <AutoPrintOnLoad /> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/admin/erp/preuzimanja/${batch.id}`}
          className="text-sm text-walnut hover:underline"
        >
          ← Nazad na nalog
        </Link>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/admin/erp/preuzimanja/${batch.id}/stampa?section=${
              showPicking ? "labels" : "picking"
            }`}
            className="inline-flex h-9 items-center rounded-lg border border-black bg-white px-3 text-sm font-medium"
          >
            {showPicking ? "Otvori etikete i adresnice" : "Otvori picking listu"}
          </Link>
          <PrintPageButton
            label={showPicking ? "Štampaj picking listu" : "Štampaj interne etikete"}
          />
        </div>
      </div>

      {showPicking ? <section>
        <header className="border-b-2 border-black pb-4">
          <p className="text-xs font-bold uppercase tracking-[0.16em]">Svet povoljnih cena · magacin</p>
          <h1 className="mt-1 text-3xl font-bold">Zbirna picking lista</h1>
          <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-4">
            <dt>Nalog</dt><dd className="font-bold">{batch.number}</dd>
            <dt>Kurir</dt><dd className="font-bold">{providerLabel(batch.provider)}</dd>
            <dt>Termin</dt><dd className="font-bold">{formatDateTime(batch.pickupDate)}</dd>
            <dt>Paketa</dt><dd className="font-bold">{batch.lines.length}</dd>
          </dl>
        </header>
        <table className="mt-5 w-full border-collapse text-sm">
          <thead>
            <tr className="border-y-2 border-black text-left">
              <th className="w-12 py-2">✓</th>
              <th className="py-2">Interna šifra</th>
              <th className="py-2">Naziv artikla</th>
              <th className="py-2">Porudžbine</th>
              <th className="py-2 text-right">Komada</th>
              <th className="py-2 text-right">Paketa</th>
            </tr>
          </thead>
          <tbody>
            {picking.map((row) => (
              <tr key={row.sku} className="border-b border-black/30 align-top">
                <td className="py-3"><span className="inline-block size-5 border border-black" /></td>
                <td className="py-3 font-mono font-bold">{row.sku}</td>
                <td className="py-3">{row.name}</td>
                <td className="py-3">{row.orders.join(", ")}</td>
                <td className="py-3 text-right text-lg font-bold">{row.qty}</td>
                <td className="py-3 text-right">{row.packageCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-10 grid grid-cols-2 gap-12 text-sm">
          <p className="border-t border-black pt-2">Pripremio</p>
          <p className="border-t border-black pt-2">Kontrolisao</p>
        </div>
      </section> : null}

      {showLabels ? <section className="rounded-xl border border-black/20 bg-stone-50 p-5 print:hidden">
        <header>
          <h2 className="text-2xl font-bold">Kurirske adresnice</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6">
            MyGLS adresnica je originalni PDF koji vraća MyGLS, u A4 2×2 formatu
            podešenom na našem nalogu. X Express API ne vraća PDF; za njega ERP
            pravi transportnu etiketu iz neizmenjenih podataka koje je X Express
            prihvatio pri kreiranju naloga.
          </p>
          {shipments.length ? (
            <ul className="mt-2 flex flex-wrap gap-2">
              {shipments.map((shipment) => {
                const line = batch.lines.find((candidate) => shipmentMatchesLine(shipment, candidate));
                return (
                  <li key={shipment.id}>
                    <a
                      href={`/api/admin/shipments/${shipment.id}/label`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex flex-col rounded-lg border border-black bg-white px-3 py-2 text-sm"
                    >
                      <span className="font-bold">
                        {providerLabelAction(shipment.provider)}
                      </span>
                      <span>
                        {sourceLabel(line)} · {shipment.trackingNo ?? "broj još nije dodeljen"}
                      </span>
                      <span className="text-xs text-black/65">
                        {providerLabelFormat(shipment.provider)}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-3 text-sm font-medium">
              Adresnice još nisu kreirane kod {providerLabel(batch.provider)}.
              Prvo kreirajte kurirske pošiljke na nalogu za preuzimanje.
            </p>
          )}
        </header>
      </section> : null}

      {showLabels ? <section aria-labelledby="internal-package-labels-title" className="print:break-before-page">
        <header className="mb-5">
          <h2 id="internal-package-labels-title" className="text-2xl font-bold">
            Interne magacinske etikete
          </h2>
          <p className="mt-1 text-sm">
            Dopuna uz kurirsku adresnicu za lakše pakovanje. Ove etikete nisu
            kurirske adresnice i ne mogu da ih zamene.
          </p>
        </header>
        <div className="grid grid-cols-2 gap-3 print:gap-2">
          {packageLabels.map((line) => (
            <article
              key={line.id}
              className="flex min-h-56 break-inside-avoid flex-col justify-between border-2 border-black p-4"
            >
              <div>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.12em]">
                      Interna magacinska etiketa
                    </p>
                    <p className="mt-1 font-mono text-lg font-bold">{sourceLabel(line)}</p>
                    {line.reclamation?.warehouse ? (
                      <p className="text-xs">
                        {line.reclamation.warehouse.code} · {line.reclamation.warehouse.name}
                      </p>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <p className="text-xs">Paket</p>
                    <p className="text-3xl font-black">
                      {line.packageNo}/{packageCountForGroup(batch.lines, line.lineGroupKey)}
                    </p>
                  </div>
                </div>
                <p className="mt-5 font-mono text-2xl font-black">{line.orderItem?.sku ?? "—"}</p>
                <p className="mt-1 text-lg font-bold">{line.orderItem?.name ?? "Nepoznat artikal"}</p>
                <p className="mt-2 text-xs">Kurir: {providerLabel(batch.provider)}</p>
              </div>
              <div className="mt-5 flex items-end justify-between border-t border-black pt-3">
                <p>Količina u paketu</p>
                <p className="text-4xl font-black">{line.packageQty}</p>
              </div>
            </article>
          ))}
        </div>
      </section> : null}
    </main>
  );
}

type PrintLine = {
  id: string;
  orderId: string;
  orderItemId: string | null;
  reclamationId: string | null;
  purpose: "ORDER_DELIVERY" | "RECLAMATION_RETURN" | "RECLAMATION_REPLACEMENT";
  lineGroupKey: string;
  quantity: number | null;
  packageNo: number;
  order: { id: string; number: string };
  reclamation: {
    number: string;
    warehouse: { code: string; name: string } | null;
  } | null;
  orderItem: {
    id: string;
    sku: string;
    name: string;
    qty: number;
    product: { packQty: number | null } | null;
  } | null;
};

function aggregatePicking(lines: PrintLine[]) {
  const rows = new Map<string, {
    sku: string;
    name: string;
    qty: number;
    packageCount: number;
    orders: Set<string>;
    logicalItems: Set<string>;
  }>();
  for (const line of lines) {
    if (!line.orderItem) continue;
    const row = rows.get(line.orderItem.sku) ?? {
      sku: line.orderItem.sku,
      name: line.orderItem.name,
      qty: 0,
      packageCount: 0,
      orders: new Set<string>(),
      logicalItems: new Set<string>(),
    };
    row.packageCount += 1;
    row.orders.add(sourceLabel(line));
    const logicalItem = `${line.lineGroupKey}:${line.orderItem.id}`;
    if (!row.logicalItems.has(logicalItem)) {
      row.logicalItems.add(logicalItem);
      row.qty += line.quantity ?? line.orderItem.qty;
    }
    rows.set(row.sku, row);
  }
  return Array.from(rows.values())
    .map((row) => ({ ...row, orders: Array.from(row.orders).sort() }))
    .sort((left, right) => left.sku.localeCompare(right.sku, "sr-Latn", { numeric: true }));
}

function quantityInPackage(lines: PrintLine[], target: PrintLine) {
  const item = target.orderItem;
  if (!item) return 0;
  const itemLines = lines
    .filter(
      (line) =>
        line.lineGroupKey === target.lineGroupKey &&
        line.orderItem?.id === item.id,
    )
    .sort((left, right) => left.packageNo - right.packageNo);
  const index = itemLines.findIndex((line) => line.id === target.id);
  const packQty = Math.max(1, item.product?.packQty ?? 1);
  const quantity = target.quantity ?? item.qty;
  return Math.max(0, Math.min(packQty, quantity - index * packQty));
}

function packageCountForGroup(lines: PrintLine[], lineGroupKey: string) {
  return lines.filter((line) => line.lineGroupKey === lineGroupKey).length;
}

function sourceLabel(line: Pick<PrintLine, "order" | "reclamation" | "purpose"> | undefined) {
  if (!line) return "Nepoznata pošiljka";
  return line.purpose === "RECLAMATION_REPLACEMENT"
    ? `Zamena · ${line.reclamation?.number ?? line.order.number}`
    : line.order.number;
}

function shipmentMatchesLine(
  shipment: {
    orderId: string;
    reclamationId: string | null;
    purpose: "ORDER_DELIVERY" | "RECLAMATION_RETURN" | "RECLAMATION_REPLACEMENT";
    rawCreateResponse: unknown;
  },
  line: Pick<PrintLine, "orderId" | "orderItemId" | "reclamationId" | "purpose">,
) {
  if (line.purpose === "RECLAMATION_REPLACEMENT") {
    return (
      shipment.purpose === "RECLAMATION_REPLACEMENT" &&
      shipment.reclamationId === line.reclamationId
    );
  }
  const assignment = readShipmentAssignment(shipment.rawCreateResponse);
  return (
    shipment.purpose === "ORDER_DELIVERY" &&
    shipment.orderId === line.orderId &&
    (assignment == null ||
      Boolean(line.orderItemId && assignment.orderItemIds.includes(line.orderItemId)))
  );
}

function shipmentForLine<T extends Parameters<typeof shipmentMatchesLine>[0]>(
  shipments: readonly T[],
  line: Parameters<typeof shipmentMatchesLine>[1],
) {
  return shipments.find((shipment) => shipmentMatchesLine(shipment, line));
}

function providerLabel(provider: string | null) {
  return provider === "MYGLS" ? "MyGLS" : provider === "X_EXPRESS" ? "X Express" : provider ?? "Kurir";
}

function providerLabelFormat(provider: string | null) {
  return provider === "MYGLS"
    ? "Originalni MyGLS PDF · A4 2×2"
    : provider === "X_EXPRESS"
      ? "ERP etiketa 95×138 mm · podaci prihvaćeni kroz X Express API"
      : "Format kurirske službe";
}

function providerLabelAction(provider: string | null) {
  return provider === "MYGLS"
    ? "Otvori zvaničnu MyGLS adresnicu"
    : provider === "X_EXPRESS"
      ? "Otvori X Express ERP etiketu"
      : `Otvori ${providerLabel(provider)} adresnicu`;
}

function formatDateTime(value: Date | null) {
  return value
    ? value.toLocaleString("sr-Latn-RS", {
        timeZone: "Europe/Belgrade",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "Nije zakazan";
}
