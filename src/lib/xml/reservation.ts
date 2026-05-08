import "server-only";

import { db } from "@/lib/db";

/**
 * Phase 4A item 6 — supplier reservation callback.
 *
 * When an order is placed we already decrement local stock optimistically
 * (see `createOrder` in `lib/api/checkout.ts`). The supplier still needs
 * to know about the reservation so they can:
 *
 *   - Hold the units against their own warehouse stock.
 *   - Schedule pickup / shipment to our depot.
 *   - Update their next XML feed snapshot to reflect the reservation.
 *
 * Each supplier publishes their own reservation endpoint URL. We look it
 * up from the same `Supplier` row that owns the product feed; if the
 * supplier is missing a callback URL we no-op silently (the import-only
 * pattern is valid for vendors that prefer to reconcile via the next
 * snapshot).
 *
 * The callback is intentionally fire-and-forget from the caller's POV:
 * checkout never blocks on it. Failures are logged but do not roll back
 * the order — out-of-band tooling reconciles divergent stock counts
 * during the next import run.
 */

export interface ReservationLine {
  productId: string;
  qty: number;
}

export interface ReservationRequest {
  orderNumber: string;
  lines: ReservationLine[];
}

interface SupplierReservationPayload {
  externalId: string;
  qty: number;
}

/**
 * Group reservation lines by supplier and notify each one. Resolves once
 * every callback has either succeeded or hit its own error, so callers
 * can `void` the promise without dangling work.
 */
export async function notifySuppliersOfReservation(
  req: ReservationRequest,
): Promise<void> {
  const products = await db.product.findMany({
    where: { id: { in: req.lines.map((l) => l.productId) } },
    select: {
      id: true,
      supplierExternalId: true,
      supplier: {
        select: {
          id: true,
          name: true,
          enabled: true,
          notes: true,
          // Reservation callback URL is conventionally the feed URL with
          // its last path segment swapped for "reservations". Suppliers
          // that need a different scheme expose it here in `notes` (a
          // dedicated column would be added in 4A.1 once we onboard the
          // first supplier with a non-conventional endpoint).
          feedUrl: true,
        },
      },
    },
  });

  const bySupplier = new Map<
    string,
    {
      supplierId: string;
      supplierName: string;
      url: string;
      lines: SupplierReservationPayload[];
    }
  >();
  for (const line of req.lines) {
    const product = products.find((p) => p.id === line.productId);
    if (!product?.supplier?.enabled) continue;
    if (!product.supplier.feedUrl || !product.supplierExternalId) continue;

    const url = deriveReservationUrl(product.supplier.feedUrl);
    const bucket = bySupplier.get(product.supplier.id) ?? {
      supplierId: product.supplier.id,
      supplierName: product.supplier.name,
      url,
      lines: [],
    };
    bucket.lines.push({ externalId: product.supplierExternalId, qty: line.qty });
    bySupplier.set(product.supplier.id, bucket);
  }

  await Promise.allSettled(
    [...bySupplier.values()].map((bucket) =>
      postReservation(bucket.url, {
        orderNumber: req.orderNumber,
        items: bucket.lines,
      }).catch((err) => {
        // Logged for the admin XML import dashboard; we deliberately do
        // NOT rethrow — checkout has already committed.
        console.error(
          `[supplier-reservation] ${bucket.supplierName} failed:`,
          err instanceof Error ? err.message : err,
        );
      }),
    ),
  );
}

function deriveReservationUrl(feedUrl: string): string {
  try {
    const u = new URL(feedUrl);
    const segments = u.pathname.split("/").filter(Boolean);
    if (segments.length) segments[segments.length - 1] = "reservations";
    else segments.push("reservations");
    u.pathname = `/${segments.join("/")}`;
    u.search = "";
    return u.toString();
  } catch {
    return feedUrl;
  }
}

async function postReservation(
  url: string,
  body: { orderNumber: string; items: SupplierReservationPayload[] },
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "SvetPovoljnihCena-Reservation/1.0",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Reservation POST → ${url} returned ${res.status}`);
  }
}
