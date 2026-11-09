import "server-only";

import { db } from "@/lib/db";
import type { ErpRow } from "@/lib/admin/erp";
import { dateInputInTimeZone, resolveReportPeriod } from "@/lib/admin/report-period";
import { fiscalMerchandiseAmounts, ananasMerchandiseItems } from "@/lib/admin/fiscal-merchandise";
import { ananasInventorySku } from "@/lib/ananas/inventory-plan";
import { fiscalLevelingDifference, priceChangeLevelingDifference, roundKepMoney } from "./kep-ledger";
import { readRetailValueSnapshot, retailValueSnapshotTotal, type RetailValueSnapshot } from "./retail-value-snapshot";

type Company = "SPC" | "ANANAS";
type RetailHistory = {
  productId: string;
  price: number;
  validFrom: Date;
  validTo: Date | null;
  priceList: { code: string; active: boolean; validFrom: Date | null; validTo: Date | null };
};

function periodForYearToDate(now = new Date()) {
  return resolveReportPeriod({ range: "ytd" }, now);
}

function isInPeriod(value: Date | null, period: ReturnType<typeof periodForYearToDate>) {
  return Boolean(value && value >= period.start && value < period.endExclusive);
}

function row(
  id: string,
  date: Date,
  description: string,
  debit: number | null,
  credit: number | null,
  document: string | null = null,
): ErpRow {
  return {
    id,
    values: {
      date: dateInputInTimeZone(date),
      description,
      debit: debit === null ? null : roundKepMoney(debit),
      credit: credit === null ? null : roundKepMoney(credit),
      document,
    },
  };
}

function matchesSnapshot(snapshot: RetailValueSnapshot | null, items: Array<{ id: string; sku: string; qty: number }>) {
  if (!snapshot || snapshot.items.length !== items.length) return false;
  const byId = new Map(snapshot.items.map((item) => [item.sourceItemId, item]));
  return items.every((item) => {
    const saved = byId.get(item.id);
    return saved?.sku === item.sku && saved.qty === item.qty;
  });
}

function priceAt(history: RetailHistory[], at: Date): number | null {
  const entry = history
    .filter((candidate) =>
      candidate.validFrom <= at &&
      (!candidate.validTo || candidate.validTo >= at) &&
      candidate.priceList.active &&
      (!candidate.priceList.validFrom || candidate.priceList.validFrom <= at) &&
      (!candidate.priceList.validTo || candidate.priceList.validTo >= at),
    )
    .sort((left, right) =>
      right.validFrom.getTime() - left.validFrom.getTime() ||
      left.priceList.code.localeCompare(right.priceList.code),
    )[0];
  return entry && Number.isFinite(entry.price) && entry.price > 0 ? entry.price : null;
}

async function loadRetailHistory(productIds: string[]): Promise<Map<string, RetailHistory[]>> {
  if (!productIds.length) return new Map();
  const entries = await db.priceListEntry.findMany({
    where: { productId: { in: productIds }, priceList: { kind: "RETAIL" } },
    orderBy: [{ productId: "asc" }, { validFrom: "asc" }, { priceList: { code: "asc" } }],
    select: {
      productId: true,
      price: true,
      validFrom: true,
      validTo: true,
      priceList: { select: { code: true, active: true, validFrom: true, validTo: true } },
    },
  });
  const history = new Map<string, RetailHistory[]>();
  for (const entry of entries) {
    const items = history.get(entry.productId) ?? [];
    items.push({
      productId: entry.productId,
      price: Number(entry.price),
      validFrom: entry.validFrom,
      validTo: entry.validTo,
      priceList: entry.priceList,
    });
    history.set(entry.productId, items);
  }
  return history;
}

async function loadProductFullPrices(productIds: string[]): Promise<Map<string, number>> {
  if (!productIds.length) return new Map();
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, fullPrice: true },
  });
  return new Map(products.flatMap((product) => {
    const fullPrice = Number(product.fullPrice);
    return Number.isFinite(fullPrice) && fullPrice > 0 ? [[product.id, fullPrice]] : [];
  }));
}

function receiptAmount(
  snapshotValue: unknown,
  items: Array<{ id: string; productId: string | null; sku: string; qty: number }>,
  bookedAt: Date,
  history: Map<string, RetailHistory[]>,
  fullPrices: Map<string, number>,
) {
  const snapshot = readRetailValueSnapshot(snapshotValue);
  if (matchesSnapshot(snapshot, items)) {
    return { amount: retailValueSnapshotTotal(snapshot!), missing: [] as string[], fallback: [] as string[] };
  }
  let amount = 0;
  const missing: string[] = [];
  const fallback: string[] = [];
  for (const item of items) {
    const historicalPrice = item.productId ? priceAt(history.get(item.productId) ?? [], bookedAt) : null;
    const price = historicalPrice ?? (item.productId ? fullPrices.get(item.productId) ?? null : null);
    if (price === null) missing.push(item.sku);
    else {
      amount += item.qty * price;
      if (historicalPrice === null) fallback.push(item.sku);
    }
  }
  return { amount: missing.length ? null : roundKepMoney(amount), missing, fallback };
}

function appendReceiptRow(
  rows: ErpRow[],
  args: {
    id: string;
    date: Date;
    description: string;
    items: Array<{ id: string; productId: string | null; sku: string; qty: number }>;
    snapshot: unknown;
    history: Map<string, RetailHistory[]>;
    fullPrices: Map<string, number>;
    document: string;
    direction: "debit" | "credit";
  },
) {
  const result = receiptAmount(args.snapshot, args.items, args.date, args.history, args.fullPrices);
  const missingSuffix = result.missing.length
    ? ` · nedostaje istorijska MP cena: ${[...new Set(result.missing)].join(", ")}`
    : "";
  const fallbackSuffix = result.fallback.length
    ? ` · korišćena MP cena iz kartice artikla bez istorije: ${[...new Set(result.fallback)].join(", ")}`
    : "";
  rows.push(row(
    args.id,
    args.date,
    `${args.description}${missingSuffix}${fallbackSuffix}`,
    args.direction === "debit" ? result.amount : 0,
    args.direction === "credit" ? result.amount : 0,
    args.document,
  ));
}

async function purchaseOrdersBefore(period: ReturnType<typeof periodForYearToDate>) {
  return db.purchaseOrder.findMany({
    where: { status: "RECEIVED", postedAt: { lt: period.endExclusive } },
    orderBy: [{ postedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      number: true,
      postedAt: true,
      retailValueSnapshot: true,
      items: { orderBy: { id: "asc" }, select: { id: true, productId: true, sku: true, name: true, qty: true } },
    },
  });
}

async function ananasDispatchNotesBefore(period: ReturnType<typeof periodForYearToDate>) {
  return db.dispatchNote.findMany({
    where: {
      type: "CUSTOMER",
      status: "POSTED",
      receiverName: { contains: "Ananas", mode: "insensitive" },
      postedAt: { not: null, lt: period.endExclusive },
    },
    orderBy: [{ postedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      number: true,
      issueDate: true,
      postedAt: true,
      receiverName: true,
      retailValueSnapshot: true,
      priceList: { select: { code: true, kind: true } },
      items: { orderBy: { id: "asc" }, select: { id: true, productId: true, sku: true, name: true, qty: true, unitPriceGross: true } },
    },
  });
}

async function getKepRows(company: Company, take: number, skip: number): Promise<ErpRow[]> {
  const period = periodForYearToDate();
  const [purchaseOrders, dispatchNotes] = await Promise.all([
    company === "SPC" ? purchaseOrdersBefore(period) : Promise.resolve([]),
    ananasDispatchNotesBefore(period),
  ]);
  const relevantOrders = purchaseOrders.filter((order) => {
    const snapshot = readRetailValueSnapshot(order.retailValueSnapshot);
    const effectiveDate = snapshot ? new Date(snapshot.bookedAt) : order.postedAt;
    return isInPeriod(effectiveDate, period);
  });
  const relevantNotes = dispatchNotes.filter((note) => isInPeriod(note.postedAt, period));
  const productIds = [...new Set([
    ...relevantOrders.flatMap((order) => order.items.flatMap((item) => item.productId ? [item.productId] : [])),
    ...relevantNotes.flatMap((note) => note.items.flatMap((item) => item.productId ? [item.productId] : [])),
  ])];
  const [history, fullPrices] = await Promise.all([
    loadRetailHistory(productIds),
    loadProductFullPrices(productIds),
  ]);
  const rows: ErpRow[] = [];

  if (company === "SPC") {
    for (const order of relevantOrders) {
      const snapshot = readRetailValueSnapshot(order.retailValueSnapshot);
      const date = snapshot ? new Date(snapshot.bookedAt) : order.postedAt!;
      appendReceiptRow(rows, {
        id: `purchase:${order.id}`,
        date,
        description: `Prijem robe po porudžbenici ${order.number}`,
        items: order.items,
        snapshot: order.retailValueSnapshot,
        history,
        fullPrices,
        document: order.number,
        direction: "debit",
      });
    }
  }

  for (const note of relevantNotes) {
    const snapshot = readRetailValueSnapshot(note.retailValueSnapshot);
    const date = snapshot ? new Date(snapshot.bookedAt) : note.postedAt ?? note.issueDate;
    const noteItems = note.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      sku: item.sku,
      qty: item.qty,
    }));
    if (snapshot && matchesSnapshot(snapshot, noteItems)) {
      appendReceiptRow(rows, {
        id: `${company === "SPC" ? "transfer-out" : "transfer-in"}:${note.id}`,
        date,
        description: `Otpremnica Ananasu ${note.number}`,
        items: noteItems,
        snapshot,
        history,
        fullPrices,
        document: note.number,
        direction: company === "SPC" ? "credit" : "debit",
      });
      continue;
    }
    let amount = 0;
    const missing: string[] = [];
    const fallback: string[] = [];
    for (const item of note.items) {
      const historicalPrice = item.productId ? priceAt(history.get(item.productId) ?? [], date) : null;
      const savedMpPrice = note.priceList?.kind === "RETAIL" && note.priceList.code.toUpperCase() === "MP"
        ? Number(item.unitPriceGross)
        : null;
      const articleFullPrice = item.productId ? fullPrices.get(item.productId) : null;
      const price = historicalPrice ?? (savedMpPrice && savedMpPrice > 0 ? savedMpPrice : articleFullPrice ?? null);
      if (price === null) missing.push(item.sku);
      else {
        amount += item.qty * price;
        if (historicalPrice === null && !(savedMpPrice && savedMpPrice > 0)) fallback.push(item.sku);
      }
    }
    const fullValue = missing.length ? null : roundKepMoney(amount);
    rows.push(row(
      `${company === "SPC" ? "transfer-out" : "transfer-in"}:${note.id}`,
      date,
      `Otpremnica Ananasu ${note.number}${missing.length ? ` · nedostaje istorijska MP cena: ${[...new Set(missing)].join(", ")}` : ""}${fallback.length ? ` · korišćena MP cena iz kartice artikla bez istorije: ${[...new Set(fallback)].join(", ")}` : ""}`,
      company === "ANANAS" ? fullValue : 0,
      company === "SPC" ? fullValue : 0,
      note.number,
    ));
  }

  if (company === "SPC") {
    const documents = await db.fiscalDocument.findMany({
      where: {
        kind: { in: ["SALE", "REFUND"] },
        status: "ISSUED",
        issuedAt: { gte: period.start, lt: period.endExclusive },
        order: { is: { channel: { not: "ANANAS" } } },
      },
      select: { kind: true, totalGross: true, issuedAt: true },
      orderBy: [{ issuedAt: "asc" }, { id: "asc" }],
    });
    const daily = new Map<string, { date: Date; sale: number; refund: number; sales: number; refunds: number }>();
    for (const document of documents) {
      if (!document.issuedAt) continue;
      const day = dateInputInTimeZone(document.issuedAt);
      const current = daily.get(day) ?? { date: document.issuedAt, sale: 0, refund: 0, sales: 0, refunds: 0 };
      if (document.kind === "SALE") {
        current.sale += Number(document.totalGross);
        current.sales += 1;
      } else {
        current.refund += Number(document.totalGross);
        current.refunds += 1;
      }
      daily.set(day, current);
    }
    for (const [day, total] of daily) {
      const detail = [
        total.sales ? `${total.sales} fiskalizovanih računa` : "",
        total.refunds ? `${total.refunds} refundacija` : "",
      ].filter(Boolean).join(", ");
      rows.push(row(`fiscal:${company}:${day}`, total.date, `Dnevno razduženje po fiskalizaciji · ${detail}`, total.refund, total.sale));
    }
  } else {
    const documents = await db.ananasDocument.findMany({
      where: { kind: { in: ["SALE", "REFUND"] }, issuedAt: { gte: period.start, lt: period.endExclusive } },
      select: { id: true, kind: true, fiscalNumber: true, issuedAt: true, gross: true },
      orderBy: [{ issuedAt: "asc" }, { id: "asc" }],
    });
    const daily = new Map<string, { date: Date; sale: number; refund: number; sales: number; refunds: number }>();
    for (const document of documents) {
      const day = dateInputInTimeZone(document.issuedAt);
      const current = daily.get(day) ?? { date: document.issuedAt, sale: 0, refund: 0, sales: 0, refunds: 0 };
      if (document.kind === "SALE") {
        current.sale += Number(document.gross);
        current.sales += 1;
      } else {
        current.refund += Number(document.gross);
        current.refunds += 1;
      }
      daily.set(day, current);
    }
    for (const [day, total] of daily) {
      const detail = [
        total.sales ? `${total.sales} Ananas računa` : "",
        total.refunds ? `${total.refunds} Ananas refundacija` : "",
      ].filter(Boolean).join(", ");
      rows.push(row(`fiscal:${company}:${day}`, total.date, `Dnevno razduženje po fiskalizaciji · ${detail}`, total.refund, total.sale));
    }
  }

  rows.sort((left, right) =>
    String(left.values.date).localeCompare(String(right.values.date)) || left.id.localeCompare(right.id),
  );
  return rows.slice(skip, skip + take);
}

async function stockAtPriceChange(productIds: string[], company: Company, from: Date) {
  if (!productIds.length) return new Map<string, { current: number; movements: Array<{ date: Date; qty: number }> }>();
  const [warehouses, products, stocks, movements] = await Promise.all([
    db.warehouse.findMany({ select: { id: true, name: true } }),
    db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, stock: true } }),
    db.warehouseStock.findMany({ where: { productId: { in: productIds } }, select: { productId: true, warehouseId: true, qty: true } }),
    db.stockMovement.findMany({
      where: { productId: { in: productIds }, createdAt: { gte: from } },
      select: { productId: true, warehouseId: true, qty: true, createdAt: true },
    }),
  ]);
  const ananasIds = new Set(warehouses.filter((warehouse) => /^ananas$/i.test(warehouse.name.trim())).map((warehouse) => warehouse.id));
  const relevantIds = new Set(warehouses.filter((warehouse) => company === "ANANAS" ? ananasIds.has(warehouse.id) : !ananasIds.has(warehouse.id)).map((warehouse) => warehouse.id));
  const allCurrent = new Map<string, number>();
  const current = new Map<string, number>();
  for (const stock of stocks) {
    allCurrent.set(stock.productId, (allCurrent.get(stock.productId) ?? 0) + stock.qty);
    if (relevantIds.has(stock.warehouseId)) current.set(stock.productId, (current.get(stock.productId) ?? 0) + stock.qty);
  }
  if (company === "SPC") {
    for (const product of products) {
      const legacyResidual = Math.max(0, product.stock - (allCurrent.get(product.id) ?? 0));
      if (legacyResidual) current.set(product.id, (current.get(product.id) ?? 0) + legacyResidual);
    }
  }
  const byProduct = new Map<string, Array<{ date: Date; qty: number }>>();
  for (const movement of movements) {
    if (!relevantIds.has(movement.warehouseId)) continue;
    const list = byProduct.get(movement.productId!) ?? [];
    list.push({ date: movement.createdAt, qty: movement.qty });
    byProduct.set(movement.productId!, list);
  }
  return new Map(productIds.map((productId) => [productId, {
    current: current.get(productId) ?? 0,
    movements: byProduct.get(productId) ?? [],
  }]));
}

async function getPriceLevelingRows(take: number, skip: number): Promise<ErpRow[]> {
  const period = periodForYearToDate();
  const [purchaseOrders, dispatchNotes, fiscalLines, ananasDocuments] = await Promise.all([
    purchaseOrdersBefore(period),
    ananasDispatchNotesBefore(period),
    db.fiscalDocumentLine.findMany({
      where: {
        fiscalDocument: { is: {
          kind: { in: ["SALE", "REFUND"] },
          status: "ISSUED",
          issuedAt: { gte: period.start, lt: period.endExclusive },
          order: { is: { channel: { not: "ANANAS" } } },
        } },
      },
      orderBy: [{ fiscalDocument: { issuedAt: "asc" } }, { id: "asc" }],
      select: {
        id: true, productId: true, sku: true, shortName: true, qty: true,
        totalGross: true, totalNet: true, serviceGross: true, vatRate: true,
        orderItem: { select: { unitPriceFull: true } },
        fiscalDocument: { select: { id: true, receiptNumber: true, kind: true, issuedAt: true, order: { select: { number: true } } } },
      },
    }),
    db.ananasDocument.findMany({
      where: { kind: { in: ["SALE", "REFUND"] }, issuedAt: { gte: period.start, lt: period.endExclusive } },
      orderBy: [{ issuedAt: "asc" }, { id: "asc" }],
      select: { id: true, kind: true, fiscalNumber: true, issuedAt: true, items: true },
    }),
  ]);

  const firstReceipt = new Map<Company, Map<string, Date>>([
    ["SPC", new Map()],
    ["ANANAS", new Map()],
  ]);
  for (const order of purchaseOrders) {
    const snapshot = readRetailValueSnapshot(order.retailValueSnapshot);
    const date = snapshot ? new Date(snapshot.bookedAt) : order.postedAt;
    if (!date) continue;
    for (const item of order.items) {
      if (!item.productId) continue;
      const map = firstReceipt.get("SPC")!;
      const previous = map.get(item.productId);
      if (!previous || date < previous) map.set(item.productId, date);
    }
  }
  for (const note of dispatchNotes) {
    const snapshot = readRetailValueSnapshot(note.retailValueSnapshot);
    const date = snapshot ? new Date(snapshot.bookedAt) : note.postedAt ?? note.issueDate;
    for (const item of note.items) {
      if (!item.productId) continue;
      const map = firstReceipt.get("ANANAS")!;
      const previous = map.get(item.productId);
      if (!previous || date < previous) map.set(item.productId, date);
    }
  }
  const productIds = [...new Set([
    ...firstReceipt.get("SPC")!.keys(),
    ...firstReceipt.get("ANANAS")!.keys(),
    ...fiscalLines.flatMap((line) => line.productId ? [line.productId] : []),
  ])];
  const ananasSkus = [...new Set(ananasDocuments.flatMap((document) => ananasMerchandiseItems(document.items).map((item) => ananasInventorySku(item.sku))))];
  const [history, products, stockForSpc, stockForAnanas] = await Promise.all([
    loadRetailHistory(productIds),
    db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, sku: true, name: true, fullPrice: true } }),
    stockAtPriceChange([...firstReceipt.get("SPC")!.keys()], "SPC", period.start),
    stockAtPriceChange([...firstReceipt.get("ANANAS")!.keys()], "ANANAS", period.start),
  ]);
  const productById = new Map(products.map((product) => [product.id, product]));
  const productBySku = new Map(products.map((product) => [product.sku, product]));
  if (ananasSkus.length) {
    const ananasProducts = await db.product.findMany({ where: { sku: { in: ananasSkus } }, select: { id: true, sku: true, name: true, fullPrice: true } });
    for (const product of ananasProducts) {
      productById.set(product.id, product);
      productBySku.set(product.sku, product);
    }
    const missingHistoryIds = ananasProducts.map((product) => product.id).filter((id) => !history.has(id));
    const ananasHistory = await loadRetailHistory(missingHistoryIds);
    for (const [id, rows] of ananasHistory) history.set(id, rows);
  }

  const rows: ErpRow[] = [];
  for (const company of ["SPC", "ANANAS"] as const) {
    const firstReceiptByProduct = firstReceipt.get(company)!;
    const stock = company === "SPC" ? stockForSpc : stockForAnanas;
    for (const [productId, receiptDate] of firstReceiptByProduct) {
      const productHistory = history.get(productId) ?? [];
      const changeDates = [...new Map(productHistory
        .filter((entry) => entry.validFrom >= period.start && entry.validFrom < period.endExclusive && entry.validFrom > receiptDate)
        .map((entry) => [entry.validFrom.getTime(), entry.validFrom])).values()]
        .sort((left, right) => left.getTime() - right.getTime());
      for (const effectiveAt of changeDates) {
        const previousMpc = priceAt(productHistory, new Date(effectiveAt.getTime() - 1));
        const nextMpc = priceAt(productHistory, effectiveAt);
        if (previousMpc === null || nextMpc === null || Math.abs(previousMpc - nextMpc) < 0.005) continue;
        const balance = stock.get(productId);
        const qtyAtChange = balance
          ? balance.current - balance.movements.filter((movement) => movement.date > effectiveAt).reduce((total, movement) => total + movement.qty, 0)
          : 0;
        const product = productById.get(productId);
        const valueDifference = priceChangeLevelingDifference({ qtyAtChange, previousMpc, nextMpc });
        rows.push({
          id: `price:${company}:${productId}:${effectiveAt.toISOString()}`,
          values: {
            date: dateInputInTimeZone(effectiveAt),
            company,
            sku: product?.sku ?? null,
            name: product?.name ?? null,
            type: "Promena MP cene",
            quantity: qtyAtChange,
            fullMpc: roundKepMoney(previousMpc),
            actualMpc: roundKepMoney(nextMpc),
            valueDifference,
            document: "Cenovnik MP",
          },
        });
      }
    }
  }

  for (const line of fiscalLines) {
    if (!line.fiscalDocument.issuedAt || line.qty <= 0) continue;
    const amounts = fiscalMerchandiseAmounts({
      qty: line.qty,
      totalGross: Number(line.totalGross),
      totalNet: Number(line.totalNet),
      serviceGross: Number(line.serviceGross),
      vatRate: Number(line.vatRate),
    });
    const actualMpc = amounts.unit;
    const historyMpc = line.productId
      ? priceAt(history.get(line.productId) ?? [], line.fiscalDocument.issuedAt)
      : null;
    const articleMpc = line.productId ? productById.get(line.productId)?.fullPrice : null;
    const usedArticleFallback = line.orderItem?.unitPriceFull == null && historyMpc === null && articleMpc != null;
    const fullMpc = line.orderItem?.unitPriceFull != null
      ? Number(line.orderItem.unitPriceFull)
      : historyMpc ?? (articleMpc == null ? null : Number(articleMpc));
    if (fullMpc !== null && Math.abs(fullMpc - actualMpc) < 0.005) continue;
    const isRefund = line.fiscalDocument.kind === "REFUND";
    rows.push({
      id: `fiscal-level:${line.fiscalDocument.id}:${line.id}`,
      values: {
        date: dateInputInTimeZone(line.fiscalDocument.issuedAt),
        company: "SPC",
        sku: line.sku,
        name: line.shortName,
        type: fullMpc === null ? "Nedostaje istorijska MP cena" : usedArticleFallback ? isRefund ? "Povraćaj popusta · cena iz kartice artikla" : "Popust pri fiskalizaciji · cena iz kartice artikla" : isRefund ? "Povraćaj popusta" : "Popust pri fiskalizaciji",
        quantity: line.qty,
        fullMpc: fullMpc === null ? null : roundKepMoney(fullMpc),
        actualMpc: roundKepMoney(actualMpc),
        valueDifference: fullMpc === null ? null : fiscalLevelingDifference({ kind: isRefund ? "REFUND" : "SALE", qty: line.qty, fullMpc, actualMpc }),
        document: line.fiscalDocument.receiptNumber ?? line.fiscalDocument.order.number,
      },
    });
  }

  for (const document of ananasDocuments) {
    for (const [index, item] of ananasMerchandiseItems(document.items).entries()) {
      const sku = ananasInventorySku(item.sku);
      const product = productBySku.get(sku);
      const historyMpc = product ? priceAt(history.get(product.id) ?? [], document.issuedAt) : null;
      const fullMpc = historyMpc ?? (product ? Number(product.fullPrice) : null);
      const usedArticleFallback = historyMpc === null && fullMpc !== null;
      const actualMpc = item.quantity ? item.gross / item.quantity : 0;
      if (fullMpc !== null && Math.abs(fullMpc - actualMpc) < 0.005) continue;
      const isRefund = document.kind === "REFUND";
      rows.push({
        id: `ananas-level:${document.id}:${index}`,
        values: {
          date: dateInputInTimeZone(document.issuedAt),
          company: "ANANAS",
          sku,
          name: item.name,
          type: fullMpc === null ? "Nedostaje istorijska MP cena" : usedArticleFallback ? isRefund ? "Povraćaj popusta · cena iz kartice artikla" : "Popust pri fiskalizaciji · cena iz kartice artikla" : isRefund ? "Povraćaj popusta" : "Popust pri fiskalizaciji",
          quantity: item.quantity,
          fullMpc: fullMpc === null ? null : roundKepMoney(fullMpc),
          actualMpc: roundKepMoney(actualMpc),
          valueDifference: fullMpc === null ? null : fiscalLevelingDifference({ kind: isRefund ? "REFUND" : "SALE", qty: item.quantity, fullMpc, actualMpc }),
          document: document.fiscalNumber,
        },
      });
    }
  }

  rows.sort((left, right) =>
    String(left.values.date).localeCompare(String(right.values.date)) ||
    String(left.values.company).localeCompare(String(right.values.company)) ||
    String(left.values.sku).localeCompare(String(right.values.sku)) ||
    left.id.localeCompare(right.id),
  );
  return rows.slice(skip, skip + take);
}

export async function accountingKepRows(slug: "kep-spc" | "kep-ananas" | "nivelacije", take = 100, skip = 0) {
  if (slug === "kep-spc") return getKepRows("SPC", take, skip);
  if (slug === "kep-ananas") return getKepRows("ANANAS", take, skip);
  return getPriceLevelingRows(take, skip);
}
