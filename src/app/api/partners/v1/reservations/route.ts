import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  authenticatePartner,
  partnerRateLimitHeaders,
} from "@/lib/partners/auth";
import { syncProductChannelAvailability } from "@/lib/channel-availability.server";

class ReservationRequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
  }
}

export async function POST(request: Request) {
  const auth = await authenticatePartner(request, "reservations:write");
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      {
        status: auth.status,
        headers: auth.rateLimit ? partnerRateLimitHeaders(auth.rateLimit) : undefined,
      },
    );
  }

  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return NextResponse.json(
      { ok: false, error: "Idempotency-Key je obavezan (najviše 200 znakova)." },
      { status: 400, headers: partnerRateLimitHeaders(auth.rateLimit) },
    );
  }
  const body = (await request.json().catch(() => null)) as
    | { sku?: unknown; qty?: unknown; externalRef?: unknown; expiresAt?: unknown }
    | null;
  const sku = typeof body?.sku === "string" ? body.sku.trim() : "";
  const externalRef =
    typeof body?.externalRef === "string" ? body.externalRef.trim() : "";
  const qty = typeof body?.qty === "number" ? body.qty : Number.NaN;
  const expiresAt =
    typeof body?.expiresAt === "string" && body.expiresAt
      ? new Date(body.expiresAt)
      : null;
  if (
    !sku ||
    !externalRef ||
    externalRef.length > 200 ||
    !Number.isInteger(qty) ||
    qty <= 0 ||
    qty > 10_000 ||
    (expiresAt && Number.isNaN(expiresAt.getTime()))
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Obavezni su sku, externalRef i pozitivna celobrojna qty; expiresAt mora biti ISO datum.",
      },
      { status: 400, headers: partnerRateLimitHeaders(auth.rateLimit) },
    );
  }

  try {
    const product = await db.product.findUnique({
      where: { sku },
      select: { id: true, sku: true, name: true },
    });
    if (!product) throw new ReservationRequestError("Artikal nije pronađen.", 404);

    const outcome = await db.$transaction(async (tx) => {
      const existing = await tx.partnerReservation.findUnique({
        where: {
          clientId_idempotencyKey: {
            clientId: auth.client.id,
            idempotencyKey,
          },
        },
      });
      if (existing) return { reservation: existing, idempotent: true };

      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Product" WHERE "id" = ${product.id} FOR UPDATE`,
      );
      const warehouse = await tx.warehouse.findFirst({
        where: { active: true },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      });
      if (!warehouse) {
        throw new ReservationRequestError("Aktivan magacin nije konfigurisan.", 409);
      }
      const [stock, reservations] = await Promise.all([
        tx.warehouseStock.findUnique({
          where: {
            warehouseId_productId: {
              warehouseId: warehouse.id,
              productId: product.id,
            },
          },
          select: { qty: true },
        }),
        tx.partnerReservation.aggregate({
          where: {
            productId: product.id,
            status: "ACTIVE",
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            AND: [
              {
                OR: [{ warehouseId: warehouse.id }, { warehouseId: null }],
              },
            ],
          },
          _sum: { qty: true },
        }),
      ]);
      const physical = stock?.qty ?? 0;
      const reserved = reservations._sum.qty ?? 0;
      if (physical - reserved < qty) {
        throw new ReservationRequestError(
          `Nedovoljno raspoloživo. Raspoloživo: ${Math.max(physical - reserved, 0)}.`,
          409,
        );
      }
      const reservation = await tx.partnerReservation.create({
        data: {
          clientId: auth.client.id,
          productId: product.id,
          warehouseId: warehouse.id,
          externalRef,
          idempotencyKey,
          qty,
          expiresAt,
        },
      });
      await tx.stockMovement.create({
        data: {
          idempotencyKey: `partner-reservation:${auth.client.id}:${idempotencyKey}`,
          warehouseId: warehouse.id,
          productId: product.id,
          kind: "PARTNER_RESERVATION",
          sku: product.sku,
          qty: -qty,
          note: `Rezervacija partnera ${auth.client.name}; fizičko stanje nije promenjeno`,
          balanceAfterWarehouse: physical,
          balanceAfterTotal: physical,
        },
      });
      await syncProductChannelAvailability(tx, product.id);
      return { reservation, idempotent: false };
    });

    await db.auditLog.create({
      data: {
        action: outcome.idempotent
          ? "partner.reservation.idempotent"
          : "partner.reservation.create",
        entity: "PartnerReservation",
        entityId: outcome.reservation.id,
        diff: {
          clientId: auth.client.id,
          sku,
          qty,
          externalRef,
        },
      },
    });
    return NextResponse.json(
      {
        ok: true,
        idempotent: outcome.idempotent,
        reservation: {
          id: outcome.reservation.id,
          externalRef: outcome.reservation.externalRef,
          sku,
          product: product.name,
          qty: outcome.reservation.qty,
          status: outcome.reservation.status,
          expiresAt: outcome.reservation.expiresAt?.toISOString() ?? null,
          createdAt: outcome.reservation.createdAt.toISOString(),
        },
      },
      {
        status: outcome.idempotent ? 200 : 201,
        headers: partnerRateLimitHeaders(auth.rateLimit),
      },
    );
  } catch (error) {
    if (error instanceof ReservationRequestError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.status, headers: partnerRateLimitHeaders(auth.rateLimit) },
      );
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { ok: false, error: "externalRef je već upotrebljen za ovog partnera." },
        { status: 409, headers: partnerRateLimitHeaders(auth.rateLimit) },
      );
    }
    throw error;
  }
}
