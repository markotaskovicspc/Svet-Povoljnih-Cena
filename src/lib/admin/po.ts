import {
  AllocationBasis,
  ErpCurrency,
  Prisma,
  PurchaseOrderStatus,
  StockMovementKind,
} from "@prisma/client";
import { db } from "@/lib/db";
import { adjustInventory, ensureDefaultWarehouse } from "@/lib/inventory";
import { buildPurchaseOrderPdf } from "@/lib/admin/po-pdf";
import { trackedDispatch } from "@/lib/email";
import {
  calculateDeliveryDate,
  calculatePurchaseOrderFinancials,
  calculateUnitLogistics,
  isPackQuantityValid,
  PURCHASE_ORDER_EMAIL_BODY,
  purchaseOrderCapacityWarnings,
  purchaseOrderEmailSubject,
} from "@/lib/admin/purchase-order";

const PURCHASE_ORDER_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  DRAFT: "U obradi",
  SENT: "Poslata",
  CONFIRMED: "Potvrđena",
  RECEIVED: "Primljena",
  CANCELLED: "Otkazana",
};

function isPrismaUniqueError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function dateAtUtcMidnight(value: Date) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

export async function createPurchaseOrder(now = new Date()) {
  const year = now.getUTCFullYear();
  const yy = String(year).slice(-2);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const existing = await db.purchaseOrder.findMany({
      where: { number: { endsWith: `/${yy}` } },
      select: { number: true },
    });
    const next =
      existing.reduce((maximum, order) => {
        const match = order.number.match(new RegExp(`^(\\d+)/${yy}$`));
        return match ? Math.max(maximum, Number(match[1])) : maximum;
      }, 0) + 1;
    try {
      return await db.purchaseOrder.create({
        data: {
          number: `${next}/${yy}`,
          status: PurchaseOrderStatus.DRAFT,
          orderDate: dateAtUtcMidnight(now),
        },
      });
    } catch (error) {
      if (!isPrismaUniqueError(error) || attempt === 5) throw error;
    }
  }
  throw new Error("Broj porudžbenice nije mogao da bude dodeljen.");
}

export async function addPurchaseOrderItem(input: {
  purchaseOrderId: string;
  sku: string;
  qty: number;
}) {
  const sku = input.sku.trim();
  if (!sku) throw new Error("Šifra artikla je obavezna.");
  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    throw new Error("Količina mora biti ceo broj veći od 0.");
  }
  const order = await db.purchaseOrder.findUnique({
    where: { id: input.purchaseOrderId },
    select: {
      id: true,
      lockedAt: true,
      supplierId: true,
      orderDate: true,
      currency: true,
    },
  });
  if (!order) throw new Error("Porudžbenica ne postoji.");
  if (order.lockedAt) throw new Error("Proknjižena porudžbenica se ne može menjati.");

  const effectiveAt = order.orderDate ?? new Date();
  const product = await db.product.findFirst({
    where: {
      sku: { equals: sku, mode: "insensitive" },
      deletedAt: null,
    },
    select: {
      id: true,
      sku: true,
      name: true,
      attribute1: true,
      attribute2: true,
      attribute3: true,
      attribute4: true,
      sizeLabel: true,
      colorPrimary: true,
      colorSecondary: true,
      widthCm: true,
      depthCm: true,
      heightCm: true,
      weightKg: true,
      grossWeightKg: true,
      packQty: true,
      packWidthCm: true,
      packDepthCm: true,
      packHeightCm: true,
      packGrossWeightKg: true,
      fullPrice: true,
      customsRate: true,
      moq: true,
      supplierProductName: true,
      barcode: true,
      supplier: {
        select: {
          id: true,
          currency: true,
          parity: true,
          deliveryDays: true,
          transitDays: true,
        },
      },
      lookupAssignments: {
        where: { lookupValue: { kind: "CERTIFICATE", active: true } },
        select: { lookupValue: { select: { value: true } } },
      },
      purchasePrices: {
        where: {
          validFrom: { lte: effectiveAt },
          OR: [{ validTo: null }, { validTo: { gte: effectiveAt } }],
        },
        take: 1,
        orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }],
        select: {
          price: true,
          currency: true,
          parity: true,
          validFrom: true,
          supplierId: true,
        },
      },
    },
  });
  if (!product) {
    throw new Error(`Artikal sa šifrom ${sku} ne postoji u bazi artikala.`);
  }
  if (!product.supplier) {
    throw new Error(`Artikal ${product.sku} nema povezanog dobavljača.`);
  }
  if (order.supplierId && order.supplierId !== product.supplier.id) {
    throw new Error("Svi artikli porudžbenice moraju pripadati izabranom dobavljaču.");
  }
  const price = product.purchasePrices.find(
    (candidate) =>
      !candidate.supplierId || candidate.supplierId === product.supplier?.id,
  );
  if (!price) {
    throw new Error(
      `Artikal ${product.sku} nema važeću nabavnu cenu za datum porudžbenice.`,
    );
  }
  if (order.supplierId && order.currency !== price.currency) {
    throw new Error(
      `Važeća nabavna cena artikla ${product.sku} nije u valuti porudžbenice (${order.currency}).`,
    );
  }
  if (product.moq && input.qty < product.moq) {
    throw new Error(`Minimalna količina (MOQ) za ${product.sku} je ${product.moq}.`);
  }

  const logistics = calculateUnitLogistics({
    packQty: product.packQty,
    widthCm: Number(product.widthCm ?? 0),
    depthCm: Number(product.depthCm ?? 0),
    heightCm: Number(product.heightCm ?? 0),
    weightKg: Number(product.weightKg ?? 0),
    grossWeightKg: Number(product.grossWeightKg ?? 0),
    packWidthCm: Number(product.packWidthCm ?? 0),
    packDepthCm: Number(product.packDepthCm ?? 0),
    packHeightCm: Number(product.packHeightCm ?? 0),
    packGrossWeightKg: Number(product.packGrossWeightKg ?? 0),
  });
  const attributes =
    [
      product.attribute1,
      product.attribute2,
      product.attribute3,
      product.attribute4,
      product.sizeLabel,
    ]
      .filter((value, index, all) => Boolean(value) && all.indexOf(value) === index)
      .join(" / ") || null;
  const pattern =
    [product.colorPrimary, product.colorSecondary].filter(Boolean).join(" + ") ||
    null;
  const certificates =
    product.lookupAssignments
      .map((assignment) => assignment.lookupValue.value)
      .join(", ") || null;

  const item = await db.$transaction(async (tx) => {
    const created = await tx.purchaseOrderItem.create({
      data: {
        purchaseOrderId: order.id,
        productId: product.id,
        sku: product.sku,
        name: product.name,
        attributes,
        pattern,
        purchasePrice: price.price,
        currency: price.currency,
        parity: price.parity ?? product.supplier?.parity ?? null,
        priceValidFrom: price.validFrom,
        moq: product.moq,
        packQty: product.packQty,
        qty: input.qty,
        totalVolume: Number((logistics.volumeM3 * input.qty).toFixed(3)),
        totalWeight: Number((logistics.weightKg * input.qty).toFixed(3)),
        customsRate: product.customsRate,
        calcRetailPrice: product.fullPrice,
        supplierProductName: product.supplierProductName,
        certificates,
        barcode: product.barcode,
      },
    });
    if (!order.supplierId) {
      const orderDate = order.orderDate ?? dateAtUtcMidnight(new Date());
      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: {
          supplierId: product.supplier?.id,
          currency: price.currency ?? product.supplier?.currency ?? ErpCurrency.RSD,
          parity: price.parity ?? product.supplier?.parity ?? null,
          orderDate,
          deliveryDate: calculateDeliveryDate({
            orderDate,
            loadingDate: null,
            deliveryDays: product.supplier?.deliveryDays ?? null,
            transitDays: product.supplier?.transitDays ?? null,
          }),
        },
      });
    }
    return created;
  });
  await recomputePurchaseOrderTotals(order.id);
  return item;
}

export async function updatePurchaseOrderItem(input: {
  id: string;
  qty: number;
  purchasePrice: number;
  customsRate: number | null;
  calcRetailPrice: number | null;
}) {
  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    throw new Error("Količina mora biti ceo broj veći od 0.");
  }
  if (!Number.isFinite(input.purchasePrice) || input.purchasePrice < 0) {
    throw new Error("Nabavna cena mora biti nenegativan broj.");
  }
  if (
    input.customsRate != null &&
    (!Number.isFinite(input.customsRate) ||
      input.customsRate < 0 ||
      input.customsRate > 100)
  ) {
    throw new Error("Carinska stopa mora biti između 0 i 100.");
  }
  if (
    input.calcRetailPrice != null &&
    (!Number.isFinite(input.calcRetailPrice) || input.calcRetailPrice < 0)
  ) {
    throw new Error("Kalkulativna MPC mora biti nenegativan broj.");
  }
  const item = await db.purchaseOrderItem.findUnique({
    where: { id: input.id },
    include: {
      purchaseOrder: { select: { id: true, lockedAt: true } },
      product: {
        select: {
          packQty: true,
          widthCm: true,
          depthCm: true,
          heightCm: true,
          weightKg: true,
          grossWeightKg: true,
          packWidthCm: true,
          packDepthCm: true,
          packHeightCm: true,
          packGrossWeightKg: true,
        },
      },
    },
  });
  if (!item) throw new Error("Stavka ne postoji.");
  if (item.purchaseOrder.lockedAt) {
    throw new Error("Stavke proknjižene porudžbenice se ne mogu menjati.");
  }
  const logistics = calculateUnitLogistics({
    packQty: item.product?.packQty,
    widthCm: Number(item.product?.widthCm ?? 0),
    depthCm: Number(item.product?.depthCm ?? 0),
    heightCm: Number(item.product?.heightCm ?? 0),
    weightKg: Number(item.product?.weightKg ?? 0),
    grossWeightKg: Number(item.product?.grossWeightKg ?? 0),
    packWidthCm: Number(item.product?.packWidthCm ?? 0),
    packDepthCm: Number(item.product?.packDepthCm ?? 0),
    packHeightCm: Number(item.product?.packHeightCm ?? 0),
    packGrossWeightKg: Number(item.product?.packGrossWeightKg ?? 0),
  });
  await db.purchaseOrderItem.update({
    where: { id: item.id },
    data: {
      qty: input.qty,
      purchasePrice: input.purchasePrice,
      customsRate: input.customsRate,
      calcRetailPrice: input.calcRetailPrice,
      totalVolume: Number((logistics.volumeM3 * input.qty).toFixed(3)),
      totalWeight: Number((logistics.weightKg * input.qty).toFixed(3)),
    },
  });
  await recomputePurchaseOrderTotals(item.purchaseOrder.id);
}

export async function postPurchaseOrder(id: string, actorId: string) {
  await recomputePurchaseOrderTotals(id);
  const order = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      items: true,
      supplier: true,
      loadingLocation: true,
      receivingWarehouse: true,
      transportDefinition: true,
    },
  });
  if (!order) throw new Error("Porudžbenica ne postoji.");
  if (order.lockedAt) return order;
  if (!order.supplier) throw new Error("Izaberite dobavljača pre knjiženja.");
  if (!order.items.length) throw new Error("Porudžbenica mora imati bar jednu stavku.");
  if (!order.loadingLocation) throw new Error("Izaberite mesto utovara pre knjiženja.");
  if (!order.receivingWarehouse) throw new Error("Izaberite magacin za prijem pre knjiženja.");
  if (!order.transportDefinition) throw new Error("Izaberite tip transporta pre knjiženja.");
  const invalidPacks = order.items.filter(
    (item) => !isPackQuantityValid(item.qty, item.packQty),
  );
  if (invalidPacks.length) {
    throw new Error(
      `Količina nije deljiva pakovanjem: ${invalidPacks.map((item) => item.sku).join(", ")}.`,
    );
  }
  const warnings = purchaseOrderCapacityWarnings({
    totalVolumeM3: Number(order.totalVolume ?? 0),
    totalWeightKg: Number(order.totalWeight ?? 0),
    payloadM3:
      order.transportDefinition.payloadM3 == null
        ? null
        : Number(order.transportDefinition.payloadM3),
    payloadKg:
      order.transportDefinition.payloadKg == null
        ? null
        : Number(order.transportDefinition.payloadKg),
  });
  if (warnings.length) throw new Error(warnings.join(" "));
  const now = new Date();
  return db.$transaction(async (tx) => {
    const updated = await tx.purchaseOrder.update({
      where: { id },
      data: { lockedAt: now, postedAt: now },
    });
    await tx.purchaseOrderStatusEvent.create({
      data: {
        purchaseOrderId: id,
        status: order.status,
        note: "Porudžbenica je proknjižena i zaključana",
        actorId,
      },
    });
    return updated;
  });
}

export async function changePurchaseOrderStatus(
  id: string,
  status: PurchaseOrderStatus,
  actorId: string,
) {
  if (status === PurchaseOrderStatus.SENT) {
    throw new Error("Status Poslata postavlja se komandom „Pošalji dobavljaču“.");
  }
  if (status === PurchaseOrderStatus.RECEIVED) {
    throw new Error("Status Primljena postavlja se prijemom u magacin.");
  }
  const order = await db.purchaseOrder.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!order) throw new Error("Porudžbenica ne postoji.");
  if (order.status === status) return;
  if (order.status === PurchaseOrderStatus.RECEIVED) {
    throw new Error("Status primljene porudžbenice ne može ručno da se menja.");
  }
  if (
    status === PurchaseOrderStatus.DRAFT &&
    order.status !== PurchaseOrderStatus.DRAFT
  ) {
    throw new Error("Poslata porudžbenica ne može da se vrati u status U obradi.");
  }
  if (
    status === PurchaseOrderStatus.CONFIRMED &&
    order.status !== PurchaseOrderStatus.SENT
  ) {
    throw new Error("Samo poslata porudžbenica može biti označena kao potvrđena.");
  }
  await db.$transaction([
    db.purchaseOrder.update({ where: { id }, data: { status } }),
    db.purchaseOrderStatusEvent.create({
      data: {
        purchaseOrderId: id,
        status,
        note: `Ručna promena statusa na ${PURCHASE_ORDER_STATUS_LABEL[status]}`,
        actorId,
      },
    }),
  ]);
}

export function allocateFreight(
  freightCost: number,
  lines: Array<{ id: string; purchasePrice: number; qty: number }>,
) {
  const total = lines.reduce((sum, line) => sum + line.purchasePrice * line.qty, 0);
  return new Map(
    lines.map((line) => [
      line.id,
      total > 0
        ? Number(((freightCost * line.purchasePrice * line.qty) / total).toFixed(2))
        : 0,
    ]),
  );
}

export function weightedAverageUnitCost(input: {
  existingQty: number;
  existingUnitCost: number;
  incomingQty: number;
  incomingUnitCost: number;
}) {
  if (
    Object.values(input).some(
      (value) => !Number.isFinite(value) || value < 0,
    )
  ) {
    throw new Error("Količine i jedinični troškovi moraju biti nenegativni brojevi.");
  }
  const totalQty = input.existingQty + input.incomingQty;
  if (totalQty === 0) return 0;
  return (
    (input.existingQty * input.existingUnitCost +
      input.incomingQty * input.incomingUnitCost) /
    totalQty
  );
}

type LandedCostLine = {
  id: string;
  purchasePrice: number;
  qty: number;
  totalWeight?: number | null;
  totalVolume?: number | null;
  manualAmount?: number | null;
};

/**
 * Allocates an order-level landed cost and reconciles exactly to cents.
 * AUTO_UTILIZATION uses the greater of each line's normalised weight/volume
 * utilisation, then normalises those weights back to 100%.
 */
export function allocateLandedCost(
  totalCost: number,
  lines: LandedCostLine[],
  basis: AllocationBasis = "AUTO_UTILIZATION",
) {
  if (!Number.isFinite(totalCost) || totalCost < 0) {
    throw new Error("Trošak za raspodelu mora biti nenegativan broj.");
  }
  if (!lines.length) return new Map<string, number>();
  if (basis === "MANUAL") {
    const manualTotal = lines.reduce((sum, line) => sum + (line.manualAmount ?? 0), 0);
    if (Math.abs(manualTotal - totalCost) > 0.009) {
      throw new Error("Ručna raspodela mora tačno da se usaglasi sa ukupnim troškom.");
    }
    return new Map(lines.map((line) => [line.id, Number((line.manualAmount ?? 0).toFixed(2))]));
  }

  const totalValue = lines.reduce(
    (sum, line) => sum + Math.max(line.purchasePrice * line.qty, 0),
    0,
  );
  const totalWeight = lines.reduce(
    (sum, line) => sum + Math.max(line.totalWeight ?? 0, 0),
    0,
  );
  const totalVolume = lines.reduce(
    (sum, line) => sum + Math.max(line.totalVolume ?? 0, 0),
    0,
  );
  const weights = lines.map((line) => {
    const valueShare =
      totalValue > 0 ? Math.max(line.purchasePrice * line.qty, 0) / totalValue : 0;
    const weightShare =
      totalWeight > 0 ? Math.max(line.totalWeight ?? 0, 0) / totalWeight : 0;
    const volumeShare =
      totalVolume > 0 ? Math.max(line.totalVolume ?? 0, 0) / totalVolume : 0;
    if (basis === "VALUE") return valueShare;
    if (basis === "WEIGHT") return weightShare || valueShare;
    if (basis === "VOLUME") return volumeShare || valueShare;
    return Math.max(weightShare, volumeShare) || valueShare;
  });
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const cents = Math.round(totalCost * 100);
  let assignedCents = 0;
  const result = new Map<string, number>();
  lines.forEach((line, index) => {
    const lineCents =
      index === lines.length - 1
        ? cents - assignedCents
        : Math.round(cents * (weightTotal > 0 ? weights[index] / weightTotal : 1 / lines.length));
    assignedCents += lineCents;
    result.set(line.id, lineCents / 100);
  });
  return result;
}

/** Mark a purchase order as sent to the supplier (spec §4.1.3). */
export async function sendPurchaseOrder(id: string, actorId: string) {
  const order = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      loadingLocation: true,
      receivingWarehouse: true,
      transportDefinition: true,
      items: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) throw new Error("Porudžbenica ne postoji.");
  if (order.status === PurchaseOrderStatus.RECEIVED) {
    throw new Error("Primljena porudžbenica ne može ponovo da se šalje.");
  }
  if (order.status === PurchaseOrderStatus.CANCELLED) {
    throw new Error("Otkazana porudžbenica ne može da se šalje.");
  }
  if (!order.items.length) {
    throw new Error("Porudžbenica mora imati bar jednu stavku.");
  }
  if (!order.supplier?.email) {
    throw new Error("Dobavljač mora imati kontakt email pre slanja porudžbenice.");
  }
  if (!order.loadingLocation) {
    throw new Error("Izaberite mesto utovara pre slanja porudžbenice.");
  }
  if (!order.receivingWarehouse) {
    throw new Error("Izaberite magacin za prijem pre slanja porudžbenice.");
  }
  if (!order.transportDefinition) {
    throw new Error("Izaberite tip transporta pre slanja porudžbenice.");
  }
  const invalidPacks = order.items.filter(
    (item) => item.packQty && item.packQty > 0 && item.qty % item.packQty !== 0,
  );
  if (invalidPacks.length) {
    throw new Error(
      `Količina nije deljiva pakovanjem: ${invalidPacks.map((item) => item.sku).join(", ")}.`,
    );
  }
  const warnings = purchaseOrderCapacityWarnings({
    totalVolumeM3: Number(order.totalVolume ?? 0),
    totalWeightKg: Number(order.totalWeight ?? 0),
    payloadM3:
      order.transportDefinition?.payloadM3 == null
        ? null
        : Number(order.transportDefinition.payloadM3),
    payloadKg:
      order.transportDefinition?.payloadKg == null
        ? null
        : Number(order.transportDefinition.payloadKg),
  });
  if (warnings.length) throw new Error(warnings.join(" "));
  const pdf = buildPurchaseOrderPdf({
    ...order,
    freightCost: Number(order.freightCost),
    totalPrice: Number(order.totalPrice),
    totalVolume: Number(order.totalVolume ?? 0),
    totalWeight: Number(order.totalWeight ?? 0),
    exchangeRate: Number(order.exchangeRate),
    freightExchangeRate: Number(order.freightExchangeRate),
    items: order.items.map((item) => ({
      ...item,
      purchasePrice: Number(item.purchasePrice),
      totalVolume: Number(item.totalVolume ?? 0),
      totalWeight: Number(item.totalWeight ?? 0),
      customsRate: Number(item.customsRate ?? 0),
      calcRetailPrice:
        item.calcRetailPrice == null ? null : Number(item.calcRetailPrice),
      bmPct: item.bmPct == null ? null : Number(item.bmPct),
    })),
  });
  const html = PURCHASE_ORDER_EMAIL_BODY.split("\n")
    .map((line) => (line ? `<p>${escapeHtml(line)}</p>` : "<br>"))
    .join("");
  const result = await trackedDispatch({
    kind: "purchase_order",
    to: order.supplier.email,
    subject: purchaseOrderEmailSubject(order.number),
    html,
    text: PURCHASE_ORDER_EMAIL_BODY,
    attachments: [
      {
        filename: `porudzbenica-${order.number.replaceAll("/", "-")}.pdf`,
        content: pdf.toString("base64"),
        contentType: "application/pdf",
      },
    ],
    tags: { kind: "purchase_order", purchase_order: order.id },
    metadata: { purchaseOrderId: order.id, supplierId: order.supplier.id },
    idempotencyKey: `purchase-order:${order.id}:send:${order.updatedAt.toISOString()}`,
  });
  if (!result.ok) throw new Error(`Slanje porudžbenice nije uspelo: ${result.error}`);
  await db.$transaction([
    db.purchaseOrder.update({
      where: { id },
      data: {
        status: PurchaseOrderStatus.SENT,
        orderDate: dateAtUtcMidnight(new Date()),
        pdfUrl: `/api/admin/purchase-orders/${order.id}/pdf`,
      },
    }),
    db.purchaseOrderStatusEvent.create({
      data: {
        purchaseOrderId: id,
        status: PurchaseOrderStatus.SENT,
        note: "Poslato dobavljaču",
        actorId,
      },
    }),
  ]);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Receive a purchase order into stock (spec §4 "Proknjiži" / prijemnica):
 * sets receivedQty, posts WarehouseStock + StockMovement, recomputes
 * weighted-average COGS per line (spec §5.1), and flips status to RECEIVED.
 * Idempotent — a PO already RECEIVED is skipped.
 */
export async function receivePurchaseOrder(
  id: string,
  actorId: string,
): Promise<{ received: boolean; postedLines: number; warehouseName: string | null }> {
  const order = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      items: { include: { product: { select: { id: true, cogs: true } } } },
      receivingWarehouse: true,
    },
  });
  if (!order) throw new Error("Porudžbenica ne postoji.");
  if (order.status === PurchaseOrderStatus.RECEIVED) {
    return { received: false, postedLines: 0, warehouseName: null };
  }

  let postedLines = 0;
  let warehouseName: string | null = null;
  const received = await db.$transaction(async (tx) => {
    const locked = await tx.purchaseOrder.updateMany({
      where: { id, status: { not: PurchaseOrderStatus.RECEIVED } },
      data: { status: PurchaseOrderStatus.RECEIVED },
    });
    if (locked.count !== 1) return false;
    const warehouse =
      order.receivingWarehouse?.active
        ? order.receivingWarehouse
        : await ensureDefaultWarehouse(tx);
    warehouseName = warehouse.name;
    const freightRsd = Number(order.freightCost) * Number(order.freightExchangeRate);
    const allocations = allocateLandedCost(
      freightRsd,
      order.items.map((item) => ({
        id: item.id,
        purchasePrice: Number(item.purchasePrice),
        qty: item.qty,
        totalWeight: Number(item.totalWeight ?? 0),
        totalVolume: Number(item.totalVolume ?? 0),
        manualAmount: Number(item.freightAllocated ?? 0),
      })),
      order.allocationBasis,
    );
    for (const item of order.items) {
      const freightAllocated = allocations.get(item.id) ?? 0;
      await tx.purchaseOrderItem.update({
        where: { id: item.id },
        data: { receivedQty: item.qty, freightAllocated },
      });
      if (item.productId && item.qty > 0) {
        const onHand = await tx.warehouseStock.aggregate({
          _sum: { qty: true },
          where: { productId: item.productId },
        });
        const oldQty = onHand._sum.qty ?? 0;
        const purchaseRsd = Number(item.purchasePrice) * Number(order.exchangeRate);
        const customsRsd = purchaseRsd * (Number(item.customsRate ?? 0) / 100);
        const additionalPerUnit = Number(item.additionalCostAllocated ?? 0) / item.qty;
        const newCogs =
          purchaseRsd + customsRsd + freightAllocated / item.qty + additionalPerUnit;
        const oldCogs = item.product?.cogs != null ? Number(item.product.cogs) : newCogs;
        const finalCogs = weightedAverageUnitCost({
          existingQty: oldQty,
          existingUnitCost: oldCogs,
          incomingQty: item.qty,
          incomingUnitCost: newCogs,
        });
        await tx.product.update({
          where: { id: item.productId },
          data: { cogs: Number(finalCogs.toFixed(2)) },
        });
        await adjustInventory(tx, {
          idempotencyKey: `purchase-order:${order.id}:receive:${item.id}`,
          warehouseId: warehouse.id,
          productId: item.productId,
          sku: item.sku,
          qtyDelta: item.qty,
          kind: StockMovementKind.PURCHASE_RECEIPT,
          note: `Prijem po porudžbenici ${order.number}`,
          actorId,
        });
        postedLines += 1;
      }
    }
    await tx.purchaseOrderStatusEvent.create({
      data: {
        purchaseOrderId: id,
        status: PurchaseOrderStatus.RECEIVED,
        note: `Prijem proknjižen na magacin ${warehouse.name}; transport ${Number(order.freightCost).toFixed(2)} ${order.currency} raspoređen u COGS`,
        actorId,
      },
    });
    await tx.purchaseOrder.update({
      where: { id },
      data: { lockedAt: order.lockedAt ?? new Date(), postedAt: new Date() },
    });
    return true;
  });

  return { received, postedLines: received ? postedLines : 0, warehouseName };
}

/** Recompute purchase-order header totals from its line items. */
export async function recomputePurchaseOrderTotals(id: string) {
  const order = await db.purchaseOrder.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!order) throw new Error("Porudžbenica ne postoji.");
  const items = order.items;
  let totalVolume = 0;
  let totalWeight = 0;
  let totalPrice = 0;
  for (const item of items) {
    totalVolume += Number(item.totalVolume ?? 0);
    totalWeight += Number(item.totalWeight ?? 0);
    totalPrice += Number(item.purchasePrice) * item.qty;
  }
  const financials = calculatePurchaseOrderFinancials({
    exchangeRate: Number(order.exchangeRate),
    freightCost: Number(order.freightCost),
    freightExchangeRate: Number(order.freightExchangeRate),
    lines: items.map((item) => ({
      id: item.id,
      qty: item.qty,
      purchasePrice: Number(item.purchasePrice),
      calcRetailPrice:
        item.calcRetailPrice == null ? null : Number(item.calcRetailPrice),
      customsRatePct:
        item.customsRate == null ? null : Number(item.customsRate),
      totalVolumeM3: Number(item.totalVolume ?? 0),
      totalWeightKg: Number(item.totalWeight ?? 0),
    })),
  });
  await db.$transaction([
    ...financials.lines.map((line) =>
      db.purchaseOrderItem.update({
        where: { id: line.id },
        data: {
          freightAllocated: line.freightAllocatedRsd,
          bmPct: line.bmPct,
        },
      }),
    ),
    db.purchaseOrder.update({
      where: { id },
      data: {
        totalVolume: Number(totalVolume.toFixed(3)),
        totalWeight: Number(totalWeight.toFixed(3)),
        totalPrice: Number(totalPrice.toFixed(2)),
        bmPct: financials.totalBmPct,
      },
    }),
  ]);
}
